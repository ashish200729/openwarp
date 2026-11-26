import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { activityLabels } from "@/lib/activity";
import { routineAction, routineConditions, routineTrigger, type routineFields, type RoutineAction, type RoutineConditions, type RoutineTrigger } from "@/lib/domains/platform";
import { isoDate } from "@/lib/operations";
import { pool, transaction } from "./db";
import type { Member } from "./member";
import { notify } from "./notify";
import { lockActivity, systemAudit } from "./platform-settings";
import { queueDelivery } from "./webhooks";
import { audit, PeopleError, runAsAdmin } from "./write";

export type Routine = { id: string; name: string; state: "draft" | "active"; trigger: RoutineTrigger; conditions: RoutineConditions; action: RoutineAction; version: number; activeFrom: Date | null; lastRun: Date | null; lastOutcome: string | null };
export type RoutineRun = { id: string; outcome: "done" | "skipped" | "failed"; detail: string; employeeId: string | null; employeeName: string; at: Date };

type Subject = { id: string; firstName: string; fullName: string; title: string };
type Live = Pick<Routine, "id" | "name" | "trigger" | "conditions" | "action" | "version"> & { activeFrom: Date; lastOccurrence: string };

const columns = `r.id, r.name, r.state, r.trigger, r.conditions, r.action, r.version, r.active_from AS "activeFrom"`;
const matching = `e.status <> 'archived' AND ($1::uuid IS NULL OR e.team_id = $1) AND ($2::text IS NULL OR e.employment_type = $2) AND ($3::text IS NULL OR e.status = $3)`;
const subjectColumns = `e.id, e.first_name AS "firstName", concat_ws(' ', e.first_name, e.last_name) AS "fullName", e.title`;
const conditionValues = (conditions: RoutineConditions) => [conditions.teamId, conditions.employmentType, conditions.status];
const personal = /\{\{\s*(first_name|full_name|title)\s*\}\}/;
const routineMaxAttempts = 6;
const scheduleBatchSize = 500;

type RunResult = { outcome: "done" | "skipped" | "failed" | null; retryable: boolean };
type RunRow = { id: string; outcome: "done" | "skipped" | "failed"; attempts: number; nextAttemptAt: Date; routineVersion: number | null };
type ActivityRow = { id: string; event: string; employeeId: string | null; detail: string; at: Date };

// A routine can't start another one, and a schedule that tells administrators or a webhook has no one person to name.
export const routineEvents = Object.keys(activityLabels).filter((event) => !event.startsWith("routine."));
const oncePerOccurrence = (trigger: RoutineTrigger, action: RoutineAction) => trigger.kind === "schedule" && (action.kind === "webhook" || action.kind === "notify" && action.audience === "admins");
export const needsPerson = (trigger: RoutineTrigger) => trigger.kind !== "schedule";

function requireAdminMember(member: Member) {
  if (member.role !== "admin") throw new PeopleError("Administrator access is required.");
}

export async function listRoutines(member: Member) {
  requireAdminMember(member);
  const { rows } = await pool().query<Routine>(
    `SELECT ${columns}, last.created_at AS "lastRun", last.outcome AS "lastOutcome" FROM routines r
     LEFT JOIN LATERAL (SELECT created_at, outcome FROM routine_runs WHERE routine_id = r.id ORDER BY id DESC LIMIT 1) last ON true ORDER BY lower(r.name), r.id LIMIT 200`,
  );
  return rows;
}

export async function readRoutine(member: Member, id: string) {
  requireAdminMember(member);
  const { rows } = await pool().query<Routine>(`SELECT ${columns}, NULL AS "lastRun", NULL AS "lastOutcome" FROM routines r WHERE r.id = $1`, [id]);
  if (!rows[0]) return null;
  const { rows: runs } = await pool().query<RoutineRun>(
    `SELECT n.id::text, n.outcome, n.detail, n.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", n.created_at AS at
     FROM routine_runs n LEFT JOIN employees e ON e.id = n.employee_id WHERE n.routine_id = $1 ORDER BY n.id DESC LIMIT 60`, [id],
  );
  return { routine: rows[0], runs };
}

export async function listRoutinePeople(member: Member) {
  requireAdminMember(member);
  const { rows } = await pool().query<{ id: string; name: string }>("SELECT id, concat_ws(' ', first_name, last_name) AS name FROM employees WHERE status <> 'archived' ORDER BY lower(last_name), lower(first_name), id LIMIT 2000");
  return rows;
}

async function checkDefinition(client: PoolClient, input: Pick<Routine, "trigger" | "conditions" | "action">) {
  const { trigger, conditions, action } = input;
  if (trigger.kind === "event" && !routineEvents.includes(trigger.event)) throw new PeopleError("Choose an event from the list.");
  if (trigger.kind === "date" && trigger.date === "document" && trigger.offset < 0) throw new PeopleError("A document can only be followed up after it’s added.");
  if (oncePerOccurrence(trigger, action) && personal.test(`${action.title} ${action.kind === "notify" ? action.body : ""}`)) throw new PeopleError("This message isn’t about one person, so it can only use {{date}}.");
  if (conditions.teamId && !(await client.query("SELECT 1 FROM teams WHERE id = $1 AND archived_at IS NULL", [conditions.teamId])).rowCount) throw new PeopleError("Choose a current team.");
  if (action.kind === "webhook" && !(await client.query("SELECT 1 FROM webhook_endpoints WHERE id = $1", [action.endpointId])).rowCount) throw new PeopleError("Choose a webhook.");
}

// An edit puts an active routine back on from now, so a changed trigger never applies to the past.
export function saveRoutine(member: Member, input: z.infer<typeof routineFields>) {
  return runAsAdmin(member, async (client) => {
    await checkDefinition(client, input);
    if (input.id) {
      const { rowCount } = await client.query(
        `UPDATE routines SET name = $2, trigger = $3, conditions = $4, action = $5, active_from = CASE WHEN state = 'active' THEN now() END, last_occurrence = '', updated_by = $6, version = version + 1 WHERE id = $1 AND version = $7`,
        [input.id, input.name, input.trigger, input.conditions, input.action, member.id, input.version],
      );
      if (!rowCount) throw new PeopleError("This routine changed while you were editing. Reload and try again.");
      await audit(client, member, "routine.updated", { detail: input.name });
      return input.id;
    }
    const { rows } = await client.query<{ id: string }>("INSERT INTO routines (name, trigger, conditions, action, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id", [input.name, input.trigger, input.conditions, input.action, member.id]);
    await audit(client, member, "routine.created", { detail: input.name });
    return rows[0].id;
  });
}

export function commandRoutine(member: Member, input: { id: string; operation: "activate" | "pause" | "delete" }) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<Pick<Routine, "name" | "state" | "trigger" | "conditions" | "action">>("SELECT name, state, trigger, conditions, action FROM routines WHERE id = $1 FOR UPDATE", [input.id]);
    const routine = rows[0];
    if (!routine) throw new PeopleError("This routine could not be found.");
    if (input.operation === "delete") {
      await client.query("DELETE FROM routines WHERE id = $1", [input.id]);
      await audit(client, member, "routine.deleted", { detail: routine.name });
      return;
    }
    const activate = input.operation === "activate";
    if ((routine.state === "active") === activate) return;
    if (activate) await checkDefinition(client, routine);
    await client.query("UPDATE routines SET state = $2, active_from = CASE WHEN $2 = 'active' THEN now() END, last_occurrence = '', updated_by = $3, version = version + 1 WHERE id = $1", [input.id, activate ? "active" : "draft", member.id]);
    await audit(client, member, activate ? "routine.activated" : "routine.paused", { detail: routine.name });
  });
}

export async function runRoutineNow(member: Member, input: { id: string; employeeId: string | null }) {
  const found = await runAsAdmin(member, async (client) => {
    const { rows } = await client.query<Live>(`SELECT id, name, trigger, conditions, action, version, coalesce(active_from, now()) AS "activeFrom", last_occurrence AS "lastOccurrence" FROM routines WHERE id = $1`, [input.id]);
    const routine = rows[0];
    if (!routine) throw new PeopleError("This routine could not be found.");
    await checkDefinition(client, routine);
    let subjects: Subject[] = [];
    if (needsPerson(routine.trigger)) {
      subjects = await matchingPeople(client, routine.conditions);
      if (!input.employeeId) throw new PeopleError("Choose a person to run this for.");
      subjects = subjects.filter((subject) => subject.id === input.employeeId);
      if (!subjects.length) throw new PeopleError("That person doesn’t match this routine’s conditions.");
    }
    await audit(client, member, "routine.started", { detail: routine.name });
    return { routine, subjects };
  });
  const key = `manual:${randomUUID()}`;
  if (found.routine.trigger.kind === "schedule" && !oncePerOccurrence(found.routine.trigger, found.routine.action)) {
    return runScheduledPeople(found.routine, key);
  }
  return runFor(found.routine, key, found.subjects);
}

async function matchingPeople(client: Pick<PoolClient, "query">, conditions: RoutineConditions, afterId: string | null = null, limit = 5000) {
  const { rows } = await client.query<Subject>(`SELECT ${subjectColumns} FROM employees e WHERE ${matching} AND ($4::uuid IS NULL OR e.id > $4) ORDER BY e.id LIMIT $5`, [...conditionValues(conditions), afterId, limit]);
  return rows;
}

// A schedule that tells administrators or a webhook acts once. Every other combination acts once for each person.
async function runFor(routine: Live, key: string, subjects: Subject[]) {
  const total = { done: 0, skipped: 0, failed: 0 };
  if (oncePerOccurrence(routine.trigger, routine.action)) {
    const outcome = await runOnce(routine, key, null);
    if (outcome.outcome) total[outcome.outcome] += 1;
    return total;
  }
  for (const subject of subjects) {
    const outcome = await runOnce(routine, `${key}:${subject.id}`, subject);
    if (outcome.outcome) total[outcome.outcome] += 1;
  }
  return total;
}

const databaseCode = (error: unknown) => typeof error === "object" && error && "code" in error ? String(error.code) : error instanceof Error ? error.name : "unknown";

function retryDelay(attempt: number) {
  return Math.min(60 * 3 ** Math.max(0, attempt - 1), 43_200);
}

function retryableOccurrence(occurrence: string) {
  return !occurrence.startsWith("manual:");
}

async function runOnce(routine: Live, occurrence: string, subject: Subject | null): Promise<RunResult> {
  try {
    return await transaction(async (client) => {
      await lockActivity(client);
      return record(client, routine, occurrence, subject);
    });
  } catch (error) {
    console.error("OpenWarp could not run a routine", databaseCode(error));
    throw error;
  }
}

async function findRun(client: PoolClient, routineId: string, occurrence: string) {
  const { rows } = await client.query<RunRow>(
    `SELECT id::text, outcome, attempts, next_attempt_at AS "nextAttemptAt", routine_version AS "routineVersion" FROM routine_runs WHERE routine_id = $1 AND occurrence = $2 FOR UPDATE`, [routineId, occurrence],
  );
  return rows[0] ?? null;
}

async function claimRun(client: PoolClient, routine: Live, occurrence: string, subject: Subject | null) {
  const { rows: current } = await client.query<{ version: number }>("SELECT version FROM routines WHERE id = $1", [routine.id]);
  if (!current[0] || current[0].version !== routine.version) return null;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO routine_runs (routine_id, occurrence, employee_id, outcome, detail, attempts, next_attempt_at, routine_version)
     VALUES ($1, $2, $3, 'failed', '', 0, now(), $4) ON CONFLICT (routine_id, occurrence) DO NOTHING RETURNING id::text`, [routine.id, occurrence, subject?.id ?? null, routine.version],
  );
  if (rows[0]) return { id: rows[0].id, attempts: 0, retryable: true };
  const existing = await findRun(client, routine.id, occurrence);
  if (!existing) return null;
  if (existing.routineVersion !== routine.version) return { id: existing.id, attempts: existing.attempts, retryable: false, claimed: false };
  if (existing.outcome !== "failed") return { id: existing.id, attempts: existing.attempts, retryable: false, claimed: false };
  if (existing.attempts >= routineMaxAttempts) return { id: existing.id, attempts: existing.attempts, retryable: false, claimed: false };
  if (existing.nextAttemptAt.getTime() > Date.now()) return { id: existing.id, attempts: existing.attempts, retryable: true, claimed: false };
  return { id: existing.id, attempts: existing.attempts, retryable: retryableOccurrence(occurrence), claimed: true };
}

async function failRun(client: PoolClient, run: { id: string; attempts: number }, occurrence: string) {
  const attempts = Math.min(run.attempts + 1, routineMaxAttempts);
  const retryable = retryableOccurrence(occurrence) && attempts < routineMaxAttempts;
  await client.query(
    `UPDATE routine_runs SET outcome = 'failed', detail = 'Something went wrong.', attempts = $2,
       next_attempt_at = now() + make_interval(secs => $3) WHERE id = $1`, [run.id, attempts, retryable ? retryDelay(attempts) : 0],
  );
  return retryable;
}

async function record(client: PoolClient, routine: Live, occurrence: string, subject: Subject | null): Promise<RunResult> {
  const claim = await claimRun(client, routine, occurrence, subject);
  if (!claim) return { outcome: null, retryable: false };
  if (claim.claimed === false) return { outcome: null, retryable: claim.retryable };
  await client.query("SAVEPOINT routine_action");
  try {
    const { skipped, detail } = await act(client, routine, subject);
    await client.query("UPDATE routine_runs SET outcome = $2, detail = $3, next_attempt_at = now() WHERE id = $1", [claim.id, skipped ? "skipped" : "done", detail.slice(0, 300)]);
    await client.query("RELEASE SAVEPOINT routine_action");
    return { outcome: skipped ? "skipped" : "done", retryable: false };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT routine_action");
    const retryable = await failRun(client, claim, occurrence);
    await client.query("RELEASE SAVEPOINT routine_action");
    console.error("OpenWarp could not run a routine", databaseCode(error));
    return { outcome: "failed", retryable };
  }
}

function fill(template: string, subject: Subject | null) {
  const values: Record<string, string> = { first_name: subject?.firstName ?? "", full_name: subject?.fullName ?? "", title: subject?.title ?? "", date: isoDate(Date.now()) };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => values[name] ?? whole);
}

async function act(client: PoolClient, routine: Live, subject: Subject | null): Promise<{ skipped?: boolean; detail: string }> {
  const { action } = routine;
  if (action.kind === "webhook") {
    const { rowCount } = await client.query("SELECT 1 FROM webhook_endpoints WHERE id = $1 AND state = 'active'", [action.endpointId]);
    if (!rowCount) return { skipped: true, detail: "The webhook is off or was deleted." };
    await queueDelivery(client, action.endpointId, { id: randomUUID(), event: "routine.message", time: new Date().toISOString(), employee_id: subject?.id ?? null, detail: fill(action.title, subject) });
    return { detail: "Sent to the webhook." };
  }
  if (action.kind === "task") {
    if (!subject) return { skipped: true, detail: "There is no person to add a task for." };
    const title = fill(action.title, subject).slice(0, 180);
    const { rowCount } = await client.query(
      `INSERT INTO workflow_tasks (workflow_id, title, position) SELECT w.id, $2, (SELECT coalesce(max(position), 0) + 1 FROM workflow_tasks WHERE workflow_id = w.id)
       FROM employee_workflows w WHERE w.employee_id = $1 AND w.state = 'open' AND NOT EXISTS (SELECT 1 FROM workflow_tasks t WHERE t.workflow_id = w.id AND t.title = $2)`, [subject.id, title],
    );
    if (!rowCount) return { skipped: true, detail: "No open checklist, or it already has this task." };
    await systemAudit(client, null, "routine.task_added", { employeeId: subject.id, detail: `${routine.name}: ${title}` });
    return { detail: `Added “${title}”.` };
  }
  const notice = { title: fill(action.title, subject), body: fill(action.body, subject), href: subject ? `/workspace/people/${subject.id}` : "/workspace" };
  if (action.audience === "admins") {
    await notify(client, null, { role: "admin" }, notice);
    return { detail: "Notified administrators." };
  }
  if (!subject) return { skipped: true, detail: "There is no person to notify." };
  const { rowCount } = await client.query(
    "SELECT 1 FROM workspace_members m WHERE m.role <> 'disabled' AND m.employee_id = CASE WHEN $2 THEN $1::uuid ELSE (SELECT manager_id FROM employees WHERE id = $1) END", [subject.id, action.audience === "person"],
  );
  if (!rowCount) return { skipped: true, detail: action.audience === "person" ? "This person has no account." : "Their manager has no account." };
  await notify(client, null, action.audience === "person" ? { employeeId: subject.id } : { managerOf: subject.id }, notice);
  return { detail: action.audience === "person" ? "Notified the person." : "Notified their manager." };
}

// The most recent moment a schedule was due, at or before now.
export function lastDue(trigger: Extract<RoutineTrigger, { kind: "schedule" }>, now: Date) {
  const [hours, minutes] = trigger.time.split(":").map(Number);
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes));
  if (due > now) due.setUTCDate(due.getUTCDate() - 1);
  if (trigger.frequency === "weekly") due.setUTCDate(due.getUTCDate() - (due.getUTCDay() - trigger.weekday + 7) % 7);
  if (trigger.frequency === "monthly") {
    if (due.getUTCDate() < trigger.monthDay) due.setUTCMonth(due.getUTCMonth() - 1, trigger.monthDay);
    else due.setUTCDate(trigger.monthDay);
  }
  return due;
}

async function activeRoutines(client: Pick<PoolClient, "query"> = pool()) {
  const { rows } = await client.query<Live>(`SELECT id, name, trigger, conditions, action, version, active_from AS "activeFrom", last_occurrence AS "lastOccurrence" FROM routines WHERE state = 'active' ORDER BY id`);
  return rows.filter((routine) => routineTrigger.safeParse(routine.trigger).success && routineConditions.safeParse(routine.conditions).success && routineAction.safeParse(routine.action).success);
}

async function readRoutineActivity(client: PoolClient) {
  await lockActivity(client);
  const { rows } = await client.query<ActivityRow>(
    `SELECT id::text, event, employee_id AS "employeeId", detail, created_at AS at FROM activity_log
     WHERE id > (SELECT position FROM activity_cursors WHERE consumer = 'routines') ORDER BY id LIMIT 200`,
  );
  return rows;
}

async function advanceRoutineActivity(client: PoolClient, id: string) {
  await client.query("UPDATE activity_cursors SET position = $1 WHERE consumer = 'routines' AND position < $1", [id]);
}

async function runEvents(stopped: () => boolean) {
  for (let batch = 0; batch < 10 && !stopped(); batch += 1) {
    const result = await transaction(async (client) => {
      const activity = await readRoutineActivity(client);
      if (!activity.length) return { count: 0, blocked: false };
      const routines = (await activeRoutines(client)).filter((routine) => routine.trigger.kind === "event");
      let blocked = false;
      for (const routine of routines) for (const row of activity) {
        if (routine.trigger.kind !== "event" || routine.trigger.event !== row.event || row.at < routine.activeFrom) continue;
        const { rows } = row.employeeId ? await client.query<Subject>(`SELECT ${subjectColumns} FROM employees e WHERE ${matching} AND e.id = $4`, [...conditionValues(routine.conditions), row.employeeId]) : { rows: [] };
        const conditional = conditionValues(routine.conditions).some((value) => value !== null);
        // An event about no one, such as a settings change, still reaches administrators and webhooks when nothing narrows the routine.
        if (!rows[0] && (row.employeeId || conditional)) continue;
        await client.query("SAVEPOINT run");
        try {
          const run = await record(client, routine, `activity:${row.id}`, rows[0] ?? null);
          blocked ||= run.retryable;
          await client.query("RELEASE SAVEPOINT run");
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT run");
          throw error;
        }
      }
      if (!blocked) await advanceRoutineActivity(client, activity.at(-1)!.id);
      return { count: activity.length, blocked };
    });
    if (result.count < 200 || result.blocked) return;
  }
}

async function retryScheduledFailures(routine: Live) {
  const { rows } = await pool().query<Subject & { occurrence: string; employeeId: string | null; status: string | null; teamId: string | null; employmentType: string | null }>(
    `SELECT n.occurrence, n.employee_id AS "employeeId", e.status, e.team_id AS "teamId", e.employment_type AS "employmentType", ${subjectColumns}
     FROM routine_runs n LEFT JOIN employees e ON e.id = n.employee_id
     WHERE n.routine_id = $1 AND n.routine_version = $2 AND n.outcome = 'failed' AND n.attempts < $3 AND n.next_attempt_at <= now() AND n.occurrence LIKE 'schedule:%'
     ORDER BY n.id LIMIT 500`, [routine.id, routine.version, routineMaxAttempts],
  );
  for (const row of rows) {
    const stamp = row.occurrence.slice("schedule:".length, "schedule:".length + 16);
    const due = new Date(`${stamp}:00Z`);
    if (Number.isNaN(due.getTime())) {
      await settleFailed(routine.id, row.occurrence, "The scheduled occurrence could not be parsed.");
      continue;
    }
    if (due < routine.activeFrom || Date.now() - due.getTime() > 86_400_000) {
      await settleFailed(routine.id, row.occurrence, "The scheduled occurrence expired before it could be retried.");
      continue;
    }
    const matches = !row.employeeId || (row.status !== "archived" && (!routine.conditions.teamId || routine.conditions.teamId === row.teamId) && (!routine.conditions.employmentType || routine.conditions.employmentType === row.employmentType) && (!routine.conditions.status || routine.conditions.status === row.status));
    if (!matches) {
      await settleSkipped(routine.id, row.occurrence, "The person no longer matches this routine.");
      continue;
    }
    await runOnce(routine, row.occurrence, row.employeeId ? row : null);
  }
}

async function settleSkipped(routineId: string, occurrence: string, detail: string) {
  await transaction(async (client) => {
    await lockActivity(client);
    await client.query("UPDATE routine_runs SET outcome = 'skipped', detail = $3, next_attempt_at = now() WHERE routine_id = $1 AND occurrence = $2 AND outcome = 'failed'", [routineId, occurrence, detail]);
  });
}

async function settleFailed(routineId: string, occurrence: string, detail: string) {
  await transaction(async (client) => {
    await lockActivity(client);
    await client.query("UPDATE routine_runs SET outcome = 'failed', attempts = $3, detail = $4, next_attempt_at = now() WHERE routine_id = $1 AND occurrence = $2 AND outcome = 'failed'", [routineId, occurrence, routineMaxAttempts, detail]);
  });
}

async function runScheduledPeople(routine: Live, key: string) {
  const total = { done: 0, skipped: 0, failed: 0 };
  let afterId: string | null = null;
  while (true) {
    const subjects = await matchingPeople(pool(), routine.conditions, afterId, scheduleBatchSize);
    if (!subjects.length) return total;
    const batch = await runFor(routine, key, subjects);
    total.done += batch.done;
    total.skipped += batch.skipped;
    total.failed += batch.failed;
    afterId = subjects.at(-1)!.id;
  }
}

async function runSchedule(routine: Live, trigger: Extract<RoutineTrigger, { kind: "schedule" }>) {
  await retryScheduledFailures(routine);
  const due = lastDue(trigger, new Date());
  const occurrence = due.toISOString().slice(0, 16);
  // A server that was off for more than a day skips what it missed.
  if (due < routine.activeFrom || Date.now() - due.getTime() > 86_400_000 || routine.lastOccurrence === occurrence) return;
  if (oncePerOccurrence(routine.trigger, routine.action)) await runFor(routine, `schedule:${occurrence}`, []);
  else await runScheduledPeople(routine, `schedule:${occurrence}`);
  await pool().query("UPDATE routines SET last_occurrence = $2 WHERE id = $1 AND state = 'active' AND version = $3", [routine.id, occurrence, routine.version]);
}

// Looks back three days, so a short outage doesn't lose a date.
async function runDates(routine: Live, trigger: Extract<RoutineTrigger, { kind: "date" }>) {
  const window = "BETWEEN greatest(current_date - 3, $5::timestamptz::date) AND current_date";
  const fresh = (key: string) => `(NOT EXISTS (SELECT 1 FROM routine_runs n WHERE n.routine_id = $6 AND n.occurrence = ${key}) OR EXISTS (SELECT 1 FROM routine_runs n WHERE n.routine_id = $6 AND n.routine_version = (SELECT version FROM routines WHERE id = $6) AND n.occurrence = ${key} AND n.outcome = 'failed' AND n.attempts < ${routineMaxAttempts} AND n.next_attempt_at <= now()))`;
  const values = [...conditionValues(routine.conditions), trigger.offset, routine.activeFrom, routine.id];
  if (trigger.date === "document") {
    const key = `concat('document:', d.id, ':', e.id)`;
    const { rows } = await pool().query<Subject & { key: string }>(
      `SELECT ${subjectColumns}, ${key} AS key FROM documents d JOIN employees e ON d.employee_id IS NULL OR d.employee_id = e.id
       WHERE ${matching} AND d.needs_acknowledgement AND d.archived_at IS NULL AND d.created_at::date + $4::int ${window}
       AND NOT EXISTS (SELECT 1 FROM document_acknowledgements a WHERE a.document_id = d.id AND a.employee_id = e.id) AND ${fresh(key)} ORDER BY d.id, e.id LIMIT 1000`, values,
    );
    for (const { key: occurrence, ...subject } of rows) await runOnce(routine, occurrence, subject);
    return;
  }
  const column = trigger.date === "start_date" ? "e.hire_date" : "e.last_day";
  const key = `concat('${trigger.date}:', e.id, ':', ${column})`;
  const { rows } = await pool().query<Subject & { key: string }>(
    `SELECT ${subjectColumns}, ${key} AS key FROM employees e WHERE ${matching} AND ${column} + $4::int ${window} AND ${fresh(key)} ORDER BY e.id LIMIT 1000`, values,
  );
  for (const { key: occurrence, ...subject } of rows) await runOnce(routine, occurrence, subject);
}

export async function runRoutines(stopped: () => boolean) {
  await runEvents(stopped);
  for (const routine of await activeRoutines()) {
    if (stopped()) return;
    if (routine.trigger.kind === "schedule") await runSchedule(routine, routine.trigger);
    if (routine.trigger.kind === "date") await runDates(routine, routine.trigger);
  }
}
