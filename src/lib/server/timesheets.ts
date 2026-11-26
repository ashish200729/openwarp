import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { addDays } from "@/lib/operations";
import {
  decimalHours, formatMinutes, formatWeekday, sheetLabels, splitWeek, timesheetUrl, weekDays, weekStart, type clockFields, type DayTotal, type entryFields, type entryRemovalFields, type eventLabels,
  type sheetCommandFields, type SheetState, type TimePolicy, type trackingFields,
} from "@/lib/domains/time";
import { pool } from "./db";
import type { Member } from "./member";
import { notify, notifyDeciders } from "./notify";
import { audit, PeopleError, requireDecider, requireOwnEmployee, runAsAdmin, runAsMember, type Actor } from "./write";

type Queryable = Pick<PoolClient, "query">;
export type TimeSettings = TimePolicy & { timeZone: string; tracking: boolean; trackSalaried: boolean; lateAfterMinutes: number; version: number };
export type RunningEntry = { id: string; day: string; startedAt: Date; breakStartedAt: Date | null; breakMinutes: number; now: Date };
export type TimeEntry = { id: string; day: string; start: string; end: string | null; overnight: boolean; minutes: number; breakMinutes: number; source: "clock" | "manual"; note: string; version: number };
export type EntryEvent = { id: string; kind: keyof typeof eventLabels; day: string; from: string | null; to: string; reason: string; actor: string; at: string };
export type Sheet = {
  employeeId: string; employeeName: string; title: string; week: string; state: SheetState; version: number; note: string; decidedBy: string | null; tracks: boolean; archived: boolean;
  entries: TimeEntry[]; days: DayTotal[]; events: EntryEvent[]; away: { day: string; typeName: string; halfDay: boolean }[]; multiplierBp: number; running: boolean; today: string;
};
export type SheetRow = { employeeId: string; name: string; email: string; teamName: string; state: SheetState; week: string; days: DayTotal[]; regular: number; overtime: number; running: boolean; decidedBy: string | null };
export type SheetFilters = { state: SheetState | "all"; teamId: string; query: string };

export async function readTimeSettings(client: Queryable = pool()) {
  const { rows } = await client.query<TimeSettings>(
    `SELECT time_zone AS "timeZone", tracking, track_salaried AS "trackSalaried", weekly_overtime_minutes AS "weeklyOvertimeMinutes", daily_overtime_minutes AS "dailyOvertimeMinutes",
     overtime_multiplier_bp AS "overtimeMultiplierBp", paid_break_minutes AS "paidBreakMinutes", auto_break_minutes AS "autoBreakMinutes", auto_break_after_minutes AS "autoBreakAfterMinutes",
     late_after_minutes AS "lateAfterMinutes", version FROM time_settings`,
  );
  return rows[0];
}

export function saveTimeSettings(member: Member, input: z.infer<typeof trackingFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM pg_timezone_names WHERE name = $1", [input.timeZone]);
    if (!rowCount) throw new PeopleError("The database doesn’t know that time zone. Choose a different one.");
    const { rowCount: saved } = await client.query(
      `UPDATE time_settings SET time_zone = $2, tracking = $3, track_salaried = $4, weekly_overtime_minutes = $5, daily_overtime_minutes = $6, overtime_multiplier_bp = $7,
       paid_break_minutes = $8, auto_break_minutes = $9, auto_break_after_minutes = $10, late_after_minutes = $11, version = version + 1 WHERE version = $1`,
      [input.version, input.timeZone, input.tracking, input.trackSalaried, input.weeklyHours, input.dailyHours, input.multiplier, input.paidBreak, input.autoBreak, input.autoBreakAfter, input.lateAfter],
    );
    if (!saved) throw new PeopleError("These settings changed while you were editing. Reload and try again.");
    await audit(client, member, "settings.updated", { detail: "Time tracking" });
  });
}

// Today in the company time zone. Work days and weeks follow it, whatever the server’s clock is set to.
export async function companyToday(client: Queryable = pool()) {
  const { rows } = await client.query<{ day: string }>("SELECT to_char(now() AT TIME ZONE time_zone, 'YYYY-MM-DD') AS day FROM time_settings");
  return rows[0].day;
}

// True for a person e who must keep a timesheet under settings t: hourly people always, salaried people when the company asks for it.
export const tracksSql = `(t.tracking AND (t.track_salaried OR (SELECT c.basis FROM compensation c WHERE c.employee_id = e.id AND c.effective_on <= current_date ORDER BY c.effective_on DESC LIMIT 1) IS NOT DISTINCT FROM 'hourly'))`;
const canSee = `($1 = 'admin' OR e.manager_id = $2)`;
const open = "ended_at IS NULL AND removed_at IS NULL";
const editable = (state: SheetState) => state === "open" || state === "returned";

async function lockedSheet(client: PoolClient, employeeId: string, week: string) {
  await client.query("INSERT INTO timesheets (employee_id, week_start) VALUES ($1, $2) ON CONFLICT (employee_id, week_start) DO NOTHING", [employeeId, week]);
  const { rows } = await client.query<{ id: string; state: SheetState; version: number }>("SELECT id, state, version FROM timesheets WHERE employee_id = $1 AND week_start = $2 FOR UPDATE", [employeeId, week]);
  return rows[0];
}

async function editableSheet(client: PoolClient, employeeId: string, week: string) {
  const sheet = await lockedSheet(client, employeeId, week);
  if (sheet.state === "submitted") throw new PeopleError("This timesheet is waiting for approval. Withdraw it to make changes.");
  if (!editable(sheet.state)) throw new PeopleError(sheet.state === "locked" ? "This timesheet was paid and can’t change." : "This timesheet is approved. Ask an administrator to reopen it.");
  await client.query("UPDATE timesheets SET version = version + 1 WHERE id = $1", [sheet.id]);
  return sheet.id;
}

async function requireEmployedOn(client: PoolClient, employeeId: string, day: string) {
  const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND hire_date <= $2 AND (last_day IS NULL OR last_day >= $2)", [employeeId, day]);
  if (!rowCount) throw new PeopleError("That day is outside this person’s employment dates.");
}

async function logEvent(client: PoolClient, member: Member, entryId: string, kind: keyof typeof eventLabels, reason = "", from: { startedAt: Date; endedAt: Date | null; breakMinutes: number } | null = null) {
  await client.query(
    `INSERT INTO time_entry_events (entry_id, kind, from_started_at, from_ended_at, from_break_minutes, started_at, ended_at, break_minutes, reason, actor_id)
     SELECT id, $2, $3, $4, $5, started_at, ended_at, break_minutes, $6, $7 FROM time_entries WHERE id = $1`,
    [entryId, kind, from?.startedAt ?? null, from?.endedAt ?? null, from?.breakMinutes ?? null, reason, member.id],
  );
}

export async function readRunning(member: Member) {
  if (!member.employeeId) return null;
  const { rows } = await pool().query<RunningEntry>(
    `SELECT id, to_char(work_date, 'YYYY-MM-DD') AS day, started_at AS "startedAt", break_started_at AS "breakStartedAt", break_minutes AS "breakMinutes", now() AS now FROM time_entries WHERE employee_id = $1 AND ${open}`, [member.employeeId],
  );
  return rows[0] ?? null;
}

// Clock times are kept to the minute so that an entry, its edits and its neighbors compare exactly.
export function clock(member: Member, { operation }: z.infer<typeof clockFields>) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const { rows: [running] } = await client.query<{ id: string; onBreak: boolean; long: boolean; week: string }>(
      `SELECT id, break_started_at IS NOT NULL AS "onBreak", date_trunc('minute', now()) - started_at > interval '24 hours' AS long, to_char(date_trunc('week', work_date), 'YYYY-MM-DD') AS week
       FROM time_entries WHERE employee_id = $1 AND ${open} FOR UPDATE`, [employeeId],
    );
    if (operation === "clock_in") {
      if (running) throw new PeopleError("You’re already clocked in.");
      const { tracking } = await readTimeSettings(client);
      if (!tracking) throw new PeopleError("Time tracking is turned off for this company.");
      const day = await companyToday(client);
      await requireEmployedOn(client, employeeId, day);
      const sheetId = await editableSheet(client, employeeId, weekStart(day));
      const { rows: [entry] } = await client.query<{ id: string }>(
        "INSERT INTO time_entries (timesheet_id, employee_id, work_date, started_at, source) VALUES ($1, $2, $3, date_trunc('minute', now()), 'clock') RETURNING id", [sheetId, employeeId, day],
      );
      await logEvent(client, member, entry.id, "clocked_in");
      return;
    }
    if (!running) throw new PeopleError("You aren’t clocked in.");
    await editableSheet(client, employeeId, running.week);
    if (operation === "break_start") {
      if (running.onBreak) throw new PeopleError("You’re already on a break.");
      await client.query("UPDATE time_entries SET break_started_at = date_trunc('minute', now()), version = version + 1 WHERE id = $1", [running.id]);
      await logEvent(client, member, running.id, "break_started");
      return;
    }
    if (operation === "break_end" && !running.onBreak) throw new PeopleError("You aren’t on a break.");
    if (running.long) throw new PeopleError("This entry has run for more than 24 hours. Edit it and enter when you stopped.");
    const leaving = operation === "clock_out";
    await client.query(
      `UPDATE time_entries SET break_minutes = break_minutes + coalesce(extract(epoch FROM date_trunc('minute', now()) - break_started_at) / 60, 0)::int, break_started_at = NULL,
       ended_at = CASE WHEN $2 THEN date_trunc('minute', now()) END, version = version + 1 WHERE id = $1`, [running.id, leaving],
    );
    if (running.onBreak) await logEvent(client, member, running.id, "break_ended");
    if (leaving) await logEvent(client, member, running.id, "clocked_out");
  });
}

// People change their own open week. An administrator can do it for someone else and must say why.
async function entryAccess(client: PoolClient, actor: Actor, employeeId: string) {
  if (actor.employeeId === employeeId) {
    await requireOwnEmployee(client, actor);
    return true;
  }
  if (actor.role !== "admin") throw new PeopleError("You can only change your own time.");
  const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [employeeId]);
  if (!rowCount) throw new PeopleError("Archived profiles are read-only.");
  return false;
}

async function currentEntry(client: PoolClient, input: { id: string; employeeId: string; version: number }) {
  const { rows } = await client.query<{ week: string; source: "clock" | "manual"; version: number; startedAt: Date; endedAt: Date | null; breakMinutes: number }>(
    `SELECT to_char(date_trunc('week', work_date), 'YYYY-MM-DD') AS week, source, version, started_at AS "startedAt", ended_at AS "endedAt", break_minutes AS "breakMinutes"
     FROM time_entries WHERE id = $1 AND employee_id = $2 AND removed_at IS NULL FOR UPDATE`, [input.id, input.employeeId],
  );
  if (!rows[0]) throw new PeopleError("This entry was removed. Reload the timesheet.");
  if (rows[0].version !== input.version) throw new PeopleError("This entry changed while you were editing. Reload and try again.");
  return rows[0];
}

export function saveEntry(member: Member, input: z.infer<typeof entryFields>) {
  return runAsMember(member, async (client, actor) => {
    const own = await entryAccess(client, actor, input.employeeId);
    const settings = await readTimeSettings(client);
    if (own && actor.role !== "admin" && !settings.tracking) throw new PeopleError("Time tracking is turned off for this company.");
    const week = weekStart(input.day);
    if (week !== input.week) throw new PeopleError("Choose a day in the week you’re editing.");
    const before = input.id ? await currentEntry(client, { ...input, id: input.id }) : null;
    if (before && before.week !== week) throw new PeopleError("This entry belongs to a different week. Reload and try again.");
    if (!input.reason && (!own || before?.source === "clock")) throw new PeopleError(own ? "Enter a reason for changing a clocked entry." : "Enter a reason for changing someone else’s time.");
    await requireEmployedOn(client, input.employeeId, input.day);
    const { rows: [span] } = await client.query<{ startedAt: Date; endedAt: Date; minutes: number; future: boolean }>(
      `SELECT started AS "startedAt", ended AS "endedAt", (extract(epoch FROM ended - started) / 60)::int AS minutes, ended > now() AS future
       FROM (SELECT ($1::date + $2::time) AT TIME ZONE $4 AS started, ($1::date + $3::time + CASE WHEN $3::time <= $2::time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE $4 AS ended) span`,
      [input.day, input.start, input.end, settings.timeZone],
    );
    if (span.minutes <= 0 || span.minutes > 1440) throw new PeopleError("An entry can be at most 24 hours.");
    if (span.future) throw new PeopleError("An entry can’t end in the future. An end time before the start means the next day.");
    if (input.breakMinutes > span.minutes) throw new PeopleError("The break is longer than the entry.");
    const { rowCount: overlapping } = await client.query(
      `SELECT 1 FROM time_entries WHERE employee_id = $1 AND removed_at IS NULL AND id IS DISTINCT FROM $4::uuid AND started_at < $3 AND coalesce(ended_at, 'infinity') > $2 LIMIT 1`,
      [input.employeeId, span.startedAt, span.endedAt, input.id || null],
    );
    if (overlapping) throw new PeopleError("This overlaps another entry. Change the times or edit the other entry.");
    const sheetId = await editableSheet(client, input.employeeId, week);
    const values = [input.day, span.startedAt, span.endedAt, input.breakMinutes, input.note];
    let id = input.id;
    if (id) await client.query("UPDATE time_entries SET work_date = $2, started_at = $3, ended_at = $4, break_minutes = $5, break_started_at = NULL, note = $6, version = version + 1 WHERE id = $1", [id, ...values]);
    else {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO time_entries (timesheet_id, employee_id, work_date, started_at, ended_at, break_minutes, note, source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual') RETURNING id", [sheetId, input.employeeId, ...values],
      );
      id = rows[0].id;
    }
    await logEvent(client, member, id, before ? "edited" : "added", input.reason, before);
    await audit(client, member, before ? "time_entry.edited" : "time_entry.added", { employeeId: input.employeeId, detail: `${input.day}, ${formatMinutes(span.minutes)}` });
    if (!own) await notify(client, member, { employeeId: input.employeeId }, { title: "An administrator changed your timesheet", body: formatWeekday(input.day), href: timesheetUrl(input.employeeId, week) });
  });
}

export function removeEntry(member: Member, input: z.infer<typeof entryRemovalFields>) {
  return runAsMember(member, async (client, actor) => {
    const own = await entryAccess(client, actor, input.employeeId);
    const before = await currentEntry(client, input);
    await editableSheet(client, input.employeeId, before.week);
    await client.query("UPDATE time_entries SET removed_at = now(), version = version + 1 WHERE id = $1", [input.id]);
    await logEvent(client, member, input.id, "removed", input.reason, before);
    await audit(client, member, "time_entry.removed", { employeeId: input.employeeId, detail: `Week of ${before.week}` });
    if (!own) await notify(client, member, { employeeId: input.employeeId }, { title: "An administrator changed your timesheet", body: `Week of ${before.week}`, href: timesheetUrl(input.employeeId, before.week) });
  });
}

type EntryMinutes = { employeeId: string; week: string; day: string; minutes: number; breakMinutes: number; open: boolean };

async function weekMinutes(client: Queryable, employeeIds: string[], weeks: string[]) {
  const ordered = [...weeks].sort();
  const { rows } = await client.query<EntryMinutes>(
    `SELECT employee_id AS "employeeId", to_char(date_trunc('week', work_date), 'YYYY-MM-DD') AS week, to_char(work_date, 'YYYY-MM-DD') AS day,
     coalesce(extract(epoch FROM ended_at - started_at) / 60, 0)::int AS minutes, CASE WHEN ended_at IS NULL THEN 0 ELSE break_minutes END AS "breakMinutes", ended_at IS NULL AS open
     FROM time_entries WHERE removed_at IS NULL AND employee_id = ANY($1::uuid[]) AND date_trunc('week', work_date)::date = ANY($2::date[]) AND work_date BETWEEN $3 AND $4`,
    [employeeIds, ordered, ordered[0], addDays(ordered.at(-1)!, 6)],
  );
  return rows;
}

async function storedDays(client: Queryable, sheetIds: string[]) {
  const { rows } = await client.query<DayTotal & { sheetId: string }>(
    `SELECT timesheet_id AS "sheetId", to_char(day, 'YYYY-MM-DD') AS day, regular_minutes AS regular, overtime_minutes AS overtime, break_minutes AS breaks FROM timesheet_days WHERE timesheet_id = ANY($1::uuid[]) ORDER BY day`, [sheetIds],
  );
  return rows;
}

export function commandSheet(member: Member, input: z.infer<typeof sheetCommandFields>) {
  return runAsMember(member, async (client, actor) => {
    const { employeeId, week, operation } = input;
    if (weekStart(week) !== week) throw new PeopleError("Choose a week that starts on Monday.");
    const own = actor.employeeId === employeeId;
    if (operation === "submit" || operation === "withdraw") await entryAccess(client, actor, employeeId);
    else if (operation === "reopen") { if (actor.role !== "admin") throw new PeopleError("Only an administrator can reopen a timesheet."); }
    else await requireDecider(client, actor, employeeId);
    const { rows: [person] } = await client.query<{ name: string; archived: boolean }>("SELECT concat_ws(' ', first_name, last_name) AS name, status = 'archived' AS archived FROM employees WHERE id = $1", [employeeId]);
    if (!person) throw new PeopleError("This employee could not be found.");
    if (person.archived) throw new PeopleError("Archived profiles are read-only.");
    if (operation === "submit") {
      if (week > await companyToday(client)) throw new PeopleError("This week hasn’t started yet.");
      const { rowCount: employed } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND hire_date <= $2::date + 6 AND (last_day IS NULL OR last_day >= $2::date)", [employeeId, week]);
      if (!employed) throw new PeopleError("That week is outside this person’s employment dates.");
    }
    const { rows: [existing] } = await client.query<{ version: number }>("SELECT version FROM timesheets WHERE employee_id = $1 AND week_start = $2", [employeeId, week]);
    if ((existing?.version ?? 0) !== input.version) throw new PeopleError("This timesheet changed while you were looking at it. Check it and try again.");
    const sheet = await lockedSheet(client, employeeId, week);
    const detail = `Week of ${week}`;
    const href = timesheetUrl(employeeId, week);
    const expect = (allowed: boolean, message: string) => { if (!allowed) throw new PeopleError(message); };
    const update = (set: string, values: unknown[] = []) => client.query(`UPDATE timesheets SET ${set}, version = version + 1 WHERE id = $1`, [sheet.id, ...values]);

    if (operation === "submit") {
      expect(editable(sheet.state), "This timesheet was already submitted.");
      const { rowCount: running } = await client.query(`SELECT 1 FROM time_entries WHERE timesheet_id = $1 AND ${open}`, [sheet.id]);
      expect(!running, "Clock out before submitting this week.");
      await update("state = 'submitted', submitted_at = now(), decided_by = NULL, decided_at = NULL");
      await audit(client, member, "timesheet.submitted", { employeeId, detail });
      await notifyDeciders(client, member, employeeId, { title: `${person.name} submitted a timesheet`, body: detail, href });
    } else if (operation === "withdraw") {
      expect(sheet.state === "submitted", "Only a timesheet waiting for approval can be withdrawn.");
      await update("state = 'open', submitted_at = NULL");
      await audit(client, member, "timesheet.withdrawn", { employeeId, detail });
    } else if (operation === "approve") {
      expect(sheet.state === "submitted", "This timesheet isn’t waiting for approval.");
      const settings = await readTimeSettings(client);
      const days = splitWeek(week, await weekMinutes(client, [employeeId], [week]), settings);
      await client.query("INSERT INTO timesheet_days (timesheet_id, day, regular_minutes, overtime_minutes, break_minutes) SELECT $1, d.* FROM unnest($2::date[], $3::int[], $4::int[], $5::int[]) d",
        [sheet.id, days.map((day) => day.day), days.map((day) => day.regular), days.map((day) => day.overtime), days.map((day) => day.breaks)]);
      await update("state = 'approved', note = '', decided_by = $2, decided_at = now(), overtime_multiplier_bp = $3", [member.id, settings.overtimeMultiplierBp]);
      await audit(client, member, "timesheet.approved", { employeeId, detail });
      await notify(client, member, { employeeId }, { title: "Your timesheet was approved", body: detail, href });
    } else if (operation === "return") {
      expect(sheet.state === "submitted", "This timesheet isn’t waiting for approval.");
      expect(Boolean(input.note), "Write a note that says what to change.");
      await update("state = 'returned', note = $2, decided_by = $3, decided_at = now()", [input.note, member.id]);
      await audit(client, member, "timesheet.returned", { employeeId, detail });
      await notify(client, member, { employeeId }, { title: "Your timesheet was returned", body: `${detail}. Read the note, then submit it again.`, href });
    } else {
      expect(sheet.state !== "locked", "This timesheet was paid and can’t be reopened. Reverse its pay run first.");
      expect(sheet.state === "approved", "Only an approved timesheet can be reopened.");
      await client.query("DELETE FROM timesheet_days WHERE timesheet_id = $1", [sheet.id]);
      await update("state = 'open', submitted_at = NULL, decided_by = NULL, decided_at = NULL, overtime_multiplier_bp = NULL");
      await audit(client, member, "timesheet.reopened", { employeeId, detail });
      if (!own) await notify(client, member, { employeeId }, { title: "Your timesheet was reopened", body: `${detail}. Submit it again after the changes.`, href });
    }
  });
}

// The person themselves, their manager and administrators can open a sheet.
export async function readSheet(member: Member, employeeId: string, week: string): Promise<Sheet | null> {
  const { rows: [person] } = await pool().query<{ name: string; title: string; archived: boolean; tracks: boolean }>(
    `SELECT concat_ws(' ', e.first_name, e.last_name) AS name, e.title, e.status = 'archived' AS archived, ${tracksSql} AS tracks FROM employees e CROSS JOIN time_settings t
     WHERE e.id = $3 AND (${canSee} OR e.id = $2)`, [member.role, member.employeeId, employeeId],
  );
  if (!person) return null;
  const [settings, today, { rows: [sheet] }, { rows: entries }, { rows: events }, { rows: away }] = await Promise.all([
    readTimeSettings(), companyToday(),
    pool().query<{ id: string; state: SheetState; version: number; note: string; decidedBy: string | null; multiplierBp: number | null }>(
      `SELECT t.id, t.state, t.version, t.note, u.name AS "decidedBy", t.overtime_multiplier_bp AS "multiplierBp" FROM timesheets t LEFT JOIN "user" u ON u.id = t.decided_by WHERE t.employee_id = $1 AND t.week_start = $2`, [employeeId, week],
    ),
    pool().query<TimeEntry>(
      `SELECT t.id, to_char(t.work_date, 'YYYY-MM-DD') AS day, to_char(t.started_at AT TIME ZONE s.time_zone, 'HH24:MI') AS start, to_char(t.ended_at AT TIME ZONE s.time_zone, 'HH24:MI') AS end,
       coalesce((t.ended_at AT TIME ZONE s.time_zone)::date > t.work_date, false) AS overnight, coalesce(extract(epoch FROM t.ended_at - t.started_at) / 60, 0)::int AS minutes, t.break_minutes AS "breakMinutes", t.source, t.note, t.version
       FROM time_entries t CROSS JOIN time_settings s WHERE t.employee_id = $1 AND t.work_date BETWEEN $2::date AND $2::date + 6 AND t.removed_at IS NULL ORDER BY t.started_at, t.id`, [employeeId, week],
    ),
    pool().query<EntryEvent>(
      `SELECT v.id::text, v.kind, to_char(t.work_date, 'YYYY-MM-DD') AS day, u.name AS actor, v.reason, to_char(v.created_at AT TIME ZONE s.time_zone, 'YYYY-MM-DD HH24:MI') AS at,
       CASE WHEN v.kind = 'edited' THEN concat(to_char(v.from_started_at AT TIME ZONE s.time_zone, 'HH24:MI'), ' to ', coalesce(to_char(v.from_ended_at AT TIME ZONE s.time_zone, 'HH24:MI'), 'running'), ', ', v.from_break_minutes, 'm break') END AS "from",
       concat(to_char(v.started_at AT TIME ZONE s.time_zone, 'HH24:MI'), ' to ', coalesce(to_char(v.ended_at AT TIME ZONE s.time_zone, 'HH24:MI'), 'running'), ', ', v.break_minutes, 'm break') AS "to"
       FROM time_entry_events v JOIN time_entries t ON t.id = v.entry_id CROSS JOIN time_settings s JOIN "user" u ON u.id = v.actor_id
       WHERE t.employee_id = $1 AND t.work_date BETWEEN $2::date AND $2::date + 6 ORDER BY v.id DESC LIMIT 200`, [employeeId, week],
    ),
    pool().query<{ day: string; typeName: string; halfDay: boolean }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, t.name AS "typeName", r.half_day AS "halfDay" FROM time_off_requests r JOIN time_off_types t ON t.id = r.type_id
       CROSS JOIN LATERAL generate_series(greatest(r.starts_on, $2::date), least(r.ends_on, $2::date + 6), interval '1 day') d
       WHERE r.employee_id = $1 AND r.state = 'approved' AND r.starts_on <= $2::date + 6 AND r.ends_on >= $2::date AND extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = d::date) ORDER BY d`, [employeeId, week],
    ),
  ]);
  const state = sheet?.state ?? "open";
  const days = sheet && (state === "approved" || state === "locked") ? await storedDays(pool(), [sheet.id])
    : splitWeek(week, entries.filter((entry) => entry.end !== null), settings);
  return {
    employeeId, employeeName: person.name, title: person.title, week, state, version: sheet?.version ?? 0, note: sheet?.note ?? "", decidedBy: sheet?.decidedBy ?? null, tracks: person.tracks, archived: person.archived,
    entries, days, events, away, multiplierBp: sheet?.multiplierBp ?? settings.overtimeMultiplierBp, running: entries.some((entry) => entry.end === null), today,
  };
}

type SheetBase = Omit<SheetRow, "days" | "regular" | "overtime" | "running"> & { sheetId: string | null };

async function sheetRows(client: Queryable, people: SheetBase[]): Promise<SheetRow[]> {
  if (!people.length) return [];
  const settings = await readTimeSettings(client);
  const minutes = await weekMinutes(client, [...new Set(people.map((person) => person.employeeId))], [...new Set(people.map((person) => person.week))]);
  const stored = await storedDays(client, people.flatMap((person) => person.sheetId && (person.state === "approved" || person.state === "locked") ? [person.sheetId] : []));
  return people.map(({ sheetId, ...person }) => {
    const own = minutes.filter((entry) => entry.employeeId === person.employeeId && entry.week === person.week);
    const kept = stored.filter((day) => day.sheetId === sheetId);
    const days = kept.length ? kept : splitWeek(person.week, own, settings);
    return { ...person, days, regular: days.reduce((sum, day) => sum + day.regular, 0), overtime: days.reduce((sum, day) => sum + day.overtime, 0), running: own.some((entry) => entry.open) };
  });
}

const rowColumns = `e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS name, e.email, coalesce(m.name, '') AS "teamName"`;

export async function listWeek(member: Member, week: string, filters: SheetFilters, client: Queryable = pool()) {
  const { rows } = await client.query<SheetBase>(
    `SELECT ${rowColumns}, coalesce(w.state, 'open') AS state, $3::text AS week, w.id AS "sheetId", u.name AS "decidedBy"
     FROM employees e CROSS JOIN time_settings t LEFT JOIN timesheets w ON w.employee_id = e.id AND w.week_start = $3::date LEFT JOIN teams m ON m.id = e.team_id LEFT JOIN "user" u ON u.id = w.decided_by
     WHERE ${canSee} AND (EXISTS (SELECT 1 FROM time_entries x WHERE x.timesheet_id = w.id AND x.removed_at IS NULL) OR w.state <> 'open'
       OR (e.status <> 'archived' AND ${tracksSql} AND e.hire_date <= $3::date + 6 AND (e.last_day IS NULL OR e.last_day >= $3::date)))
     AND ($4 = 'all' OR coalesce(w.state, 'open') = $4) AND ($5 = '' OR e.team_id::text = $5) AND ($6 = '' OR concat_ws(' ', e.first_name, e.last_name, e.email) ILIKE '%' || $6 || '%')
     ORDER BY lower(e.last_name), lower(e.first_name), e.id LIMIT 500`,
    [member.role, member.employeeId, week, filters.state, filters.teamId, filters.query.replace(/[\\%_]/g, "\\$&")],
  );
  return sheetRows(client, rows);
}

export async function pendingSheets(member: Member) {
  const { rows } = await pool().query<SheetBase>(
    `SELECT ${rowColumns}, t.state, to_char(t.week_start, 'YYYY-MM-DD') AS week, t.id AS "sheetId", NULL AS "decidedBy"
     FROM timesheets t JOIN employees e ON e.id = t.employee_id LEFT JOIN teams m ON m.id = e.team_id
     WHERE t.state = 'submitted' AND e.status <> 'archived' AND ${canSee} ORDER BY t.week_start, lower(e.last_name), e.id LIMIT 60`, [member.role, member.employeeId],
  );
  return sheetRows(pool(), rows);
}

export function exportWeek(member: Member, week: string) {
  return runAsAdmin(member, async (client) => {
    const rows = await listWeek(member, week, { state: "all", teamId: "", query: "" }, client);
    await audit(client, member, "timesheet.exported", { detail: `Week of ${week}` });
    const hours = (minutes: number) => decimalHours(minutes).toFixed(2);
    return {
      name: `openwarp-timesheets-${week}`,
      rows: [["Employee", "Email", "Team", "Week starting", "Status", ...weekDays(week), "Regular hours", "Overtime hours", "Total hours", "Decided by"],
        ...rows.map((row) => [row.name, row.email, row.teamName, week, sheetLabels[row.state], ...row.days.map((day) => hours(day.regular + day.overtime)), hours(row.regular), hours(row.overtime), hours(row.regular + row.overtime), row.decidedBy ?? ""])],
    };
  });
}
