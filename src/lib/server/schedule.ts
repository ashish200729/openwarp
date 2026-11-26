import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { formatWeekday, weekStart, type shiftFields } from "@/lib/domains/time";
import { addDays } from "@/lib/operations";
import { pool } from "./db";
import type { Member } from "./member";
import { notify } from "./notify";
import { tracksSql } from "./timesheets";
import { audit, PeopleError, runAsMember, type Actor } from "./write";

export type Attendance = { kind: "missed" } | { kind: "late"; minutes: number } | { kind: "absent" };
export type Shift = {
  id: string; employeeId: string; name: string; day: string; start: string; end: string; overnight: boolean; role: string; note: string; published: boolean; version: number; manages: boolean; own: boolean;
  away: boolean; attendance: Attendance | null;
};
export type Schedulable = { id: string; name: string };

const startsAt = "(s.day + s.starts_at)";
const endsAt = "(s.day + s.ends_at + CASE WHEN s.ends_at <= s.starts_at THEN interval '1 day' ELSE interval '0' END)";
// Approved full days off that a shift touches, including the morning an overnight shift runs into.
const awaySql = `EXISTS (SELECT 1 FROM time_off_requests r WHERE r.employee_id = s.employee_id AND r.state = 'approved' AND NOT r.half_day AND r.starts_on <= (${endsAt} - interval '1 minute')::date AND r.ends_on >= s.day)`;

export async function listSchedulable(member: Member) {
  if (member.role !== "admin" && !member.managesPeople) return [];
  const { rows } = await pool().query<Schedulable>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name FROM employees e WHERE e.status <> 'archived' AND ($1 = 'admin' OR e.manager_id = $2) ORDER BY lower(e.last_name), lower(e.first_name), e.id`, [member.role, member.employeeId],
  );
  return rows;
}

// Drafts, notes on other people's shifts and attendance are for the people who plan them.
export async function listShifts(member: Member, week: string, teamId = "") {
  const { rows } = await pool().query<Omit<Shift, "attendance"> & { tracked: boolean; begun: boolean; over: boolean; lateMinutes: number | null; grace: number }>(
    `SELECT * FROM (
       SELECT s.id, s.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS name, to_char(s.day, 'YYYY-MM-DD') AS day, to_char(s.starts_at, 'HH24:MI') AS start, to_char(s.ends_at, 'HH24:MI') AS end,
       s.ends_at <= s.starts_at AS overnight, s.role, s.published_at IS NOT NULL AS published, s.version, m.manages, coalesce(s.employee_id = $2, false) AS own,
       CASE WHEN m.manages OR s.employee_id = $2 THEN s.note ELSE '' END AS note, m.manages AND ${awaySql} AS away,
       m.manages AND tracked.tracks AS tracked, ${startsAt} AT TIME ZONE tracked.time_zone + make_interval(mins => tracked.late_after_minutes) < now() AS begun, ${endsAt} AT TIME ZONE tracked.time_zone < now() AS over,
       tracked.late_after_minutes AS grace, CASE WHEN m.manages THEN (SELECT (extract(epoch FROM min(x.started_at) - ${startsAt} AT TIME ZONE tracked.time_zone) / 60)::int FROM time_entries x
         WHERE x.employee_id = s.employee_id AND x.removed_at IS NULL AND x.started_at < ${endsAt} AT TIME ZONE tracked.time_zone AND coalesce(x.ended_at, now()) > ${startsAt} AT TIME ZONE tracked.time_zone) END AS "lateMinutes",
       e.last_name
       FROM shifts s JOIN employees e ON e.id = s.employee_id
       CROSS JOIN LATERAL (SELECT ${tracksSql} AS tracks, t.time_zone, t.late_after_minutes FROM time_settings t) tracked
       CROSS JOIN LATERAL (SELECT ($1 = 'admin' OR e.manager_id IS NOT DISTINCT FROM $2::uuid AND $2 IS NOT NULL) AS manages) m
       WHERE s.day BETWEEN $3::date AND $3::date + 6 AND ($4 = '' OR e.team_id::text = $4) AND e.status <> 'archived'
       AND (m.manages OR s.published_at IS NOT NULL AND (s.employee_id = $2 OR e.team_id = (SELECT self.team_id FROM employees self WHERE self.id = $2)))
     ) visible ORDER BY lower(last_name), name, "employeeId", day, start LIMIT 1000`, [member.role, member.employeeId, week, teamId],
  );
  return rows.map(({ tracked, begun, over, lateMinutes, grace, ...shift }): Shift => {
    const attendance: Attendance | null = !tracked || !shift.published || !begun || shift.away ? null
      : lateMinutes === null ? { kind: over ? "missed" : "absent" } : lateMinutes > grace ? { kind: "late", minutes: lateMinutes } : null;
    return { ...shift, attendance };
  });
}

async function requirePlanner(client: PoolClient, actor: Actor, employeeId: string) {
  if (actor.role === "admin") return;
  const { rowCount } = actor.employeeId ? await client.query(
    "SELECT 1 FROM employees e JOIN employees m ON m.id = e.manager_id WHERE e.id = $1 AND m.id = $2 AND m.status = 'active'", [employeeId, actor.employeeId],
  ) : { rowCount: 0 };
  if (!rowCount) throw new PeopleError("Only this person’s manager or an administrator can plan their shifts.");
}

type Times = { employeeId: string; day: string; start: string; end: string; id?: string | null };

// Why this shift can't go ahead, or null. The schedule is kept in company local time, so no zone conversion is needed.
async function conflict(client: PoolClient, { employeeId, day, start, end, id = null }: Times) {
  const { rows: [found] } = await client.query<{ employed: boolean; shift: boolean; away: boolean; halfDay: boolean }>(
    `WITH s AS (SELECT $1::uuid AS employee_id, $2::date AS day, $3::time AS starts_at, $4::time AS ends_at), planned AS (SELECT s.*, ${startsAt} AS begins, ${endsAt} AS finishes, ${awaySql} AS away FROM s)
     SELECT EXISTS (SELECT 1 FROM employees e WHERE e.id = p.employee_id AND e.status <> 'archived' AND e.hire_date <= p.day AND (e.last_day IS NULL OR e.last_day >= p.day)) AS employed, p.away,
     EXISTS (SELECT 1 FROM shifts s WHERE s.employee_id = p.employee_id AND s.id IS DISTINCT FROM $5::uuid AND s.day BETWEEN p.day - 1 AND p.day + 1 AND ${startsAt} < p.finishes AND ${endsAt} > p.begins) AS shift,
     EXISTS (SELECT 1 FROM time_off_requests r WHERE r.employee_id = p.employee_id AND r.state = 'approved' AND r.half_day AND r.starts_on = p.day) AS "halfDay"
     FROM planned p`, [employeeId, day, start, end, id],
  );
  const reason = !found.employed ? "That day is outside this person’s employment dates." : found.shift ? "This overlaps another shift for this person." : found.away ? "This person has approved time off then." : null;
  return { reason, halfDay: found.halfDay };
}

const span = (shift: { day: string; start: string; end: string }) => `${formatWeekday(shift.day)}, ${shift.start} to ${shift.end}`;

export function saveShift(member: Member, input: z.infer<typeof shiftFields>) {
  return runAsMember(member, async (client, actor) => {
    await requirePlanner(client, actor, input.employeeId);
    const { rows: [before] } = input.id ? await client.query<{ employeeId: string; version: number; published: boolean }>(
      `SELECT employee_id AS "employeeId", version, published_at IS NOT NULL AS published FROM shifts WHERE id = $1 FOR UPDATE`, [input.id],
    ) : { rows: [] };
    if (input.id && !before) throw new PeopleError("This shift was deleted. Reload the schedule.");
    if (before && before.version !== input.version) throw new PeopleError("This shift changed while you were editing. Reload and try again.");
    if (before) await requirePlanner(client, actor, before.employeeId);
    const { reason, halfDay } = await conflict(client, { ...input, id: input.id || null });
    if (reason) throw new PeopleError(reason);
    const values = [input.employeeId, input.day, input.start, input.end, input.role, input.note];
    if (before) await client.query("UPDATE shifts SET employee_id = $2, day = $3, starts_at = $4, ends_at = $5, role = $6, note = $7, version = version + 1 WHERE id = $1", [input.id, ...values]);
    else await client.query("INSERT INTO shifts (employee_id, day, starts_at, ends_at, role, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", [...values, member.id]);
    await audit(client, member, before ? "shift.updated" : "shift.created", { employeeId: input.employeeId, detail: span(input) });
    if (before?.published) {
      const href = `/workspace/schedule?week=${weekStart(input.day)}`;
      await notify(client, member, { employeeId: input.employeeId }, { title: before.employeeId === input.employeeId ? "Your shift changed" : "You have a new shift", body: span(input), href });
      if (before.employeeId !== input.employeeId) await notify(client, member, { employeeId: before.employeeId }, { title: "Your shift was moved to someone else", body: span(input), href });
    }
    return halfDay;
  });
}

export function deleteShift(member: Member, input: { id: string; version: number }) {
  return runAsMember(member, async (client, actor) => {
    const { rows: [shift] } = await client.query<{ employeeId: string; day: string; start: string; end: string; published: boolean; version: number }>(
      `SELECT employee_id AS "employeeId", to_char(day, 'YYYY-MM-DD') AS day, to_char(starts_at, 'HH24:MI') AS start, to_char(ends_at, 'HH24:MI') AS end, published_at IS NOT NULL AS published, version FROM shifts WHERE id = $1 FOR UPDATE`, [input.id],
    );
    if (!shift) throw new PeopleError("This shift was already deleted.");
    await requirePlanner(client, actor, shift.employeeId);
    if (shift.version !== input.version) throw new PeopleError("This shift changed while you were looking at it. Reload and try again.");
    await client.query("DELETE FROM shifts WHERE id = $1", [input.id]);
    await audit(client, member, "shift.deleted", { employeeId: shift.employeeId, detail: span(shift) });
    if (shift.published) await notify(client, member, { employeeId: shift.employeeId }, { title: "Your shift was cancelled", body: span(shift), href: `/workspace/schedule?week=${weekStart(shift.day)}` });
    return weekStart(shift.day);
  });
}

// Managers publish and copy their direct reports' shifts. Administrators do it for everyone, or for one team.
const scope = `($1 = 'admin' OR EXISTS (SELECT 1 FROM employees m WHERE m.id = $2 AND m.id = e.manager_id AND m.status = 'active')) AND ($4 = '' OR e.team_id::text = $4)`;

export function publishWeek(member: Member, input: { week: string; team: string }) {
  return runAsMember(member, async (client, actor) => {
    const { rows } = await client.query<{ employeeId: string; day: string; start: string; end: string }>(
      `SELECT s.employee_id AS "employeeId", to_char(s.day, 'YYYY-MM-DD') AS day, to_char(s.starts_at, 'HH24:MI') AS start, to_char(s.ends_at, 'HH24:MI') AS end FROM shifts s JOIN employees e ON e.id = s.employee_id
       WHERE s.published_at IS NULL AND s.day BETWEEN $3::date AND $3::date + 6 AND e.status <> 'archived' AND ${scope} AND ${awaySql} LIMIT 1`, [actor.role, actor.employeeId, input.week, input.team],
    );
    if (rows[0]) throw new PeopleError(`A draft on ${span(rows[0])} falls on approved time off. Move or delete it, then publish.`);
    const { rows: published } = await client.query<{ employeeId: string }>(
      `UPDATE shifts s SET published_at = now(), version = s.version + 1 FROM employees e
       WHERE e.id = s.employee_id AND s.published_at IS NULL AND s.day BETWEEN $3::date AND $3::date + 6 AND e.status <> 'archived' AND ${scope} RETURNING s.employee_id AS "employeeId"`, [actor.role, actor.employeeId, input.week, input.team],
    );
    if (!published.length) throw new PeopleError("There are no drafts to publish this week.");
    const count = (shifts: unknown[]) => `${shifts.length} ${shifts.length === 1 ? "shift" : "shifts"}`;
    for (const employeeId of new Set(published.map((shift) => shift.employeeId))) {
      const own = published.filter((shift) => shift.employeeId === employeeId);
      await notify(client, member, { employeeId }, { title: "Your shifts were published", body: `Week of ${formatWeekday(input.week)}, ${count(own)}`, href: `/workspace/schedule?week=${input.week}` });
    }
    await audit(client, member, "shift.published", { detail: `Week of ${input.week}, ${count(published)}` });
    return published.length;
  });
}

// Copies into next week as drafts. A shift that would clash there is left out and counted.
export function copyWeek(member: Member, input: { week: string; team: string }) {
  return runAsMember(member, async (client, actor) => {
    const { rows } = await client.query<Times & { role: string; note: string }>(
      `SELECT s.employee_id AS "employeeId", to_char(s.day + 7, 'YYYY-MM-DD') AS day, to_char(s.starts_at, 'HH24:MI') AS start, to_char(s.ends_at, 'HH24:MI') AS end, s.role, s.note FROM shifts s JOIN employees e ON e.id = s.employee_id
       WHERE s.day BETWEEN $3::date AND $3::date + 6 AND e.status <> 'archived' AND ${scope} ORDER BY s.day, s.starts_at, s.id LIMIT 1000`, [actor.role, actor.employeeId, input.week, input.team],
    );
    if (!rows.length) throw new PeopleError("There are no shifts to copy this week.");
    let copied = 0;
    for (const shift of rows) {
      if ((await conflict(client, shift)).reason) continue;
      await client.query("INSERT INTO shifts (employee_id, day, starts_at, ends_at, role, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", [shift.employeeId, shift.day, shift.start, shift.end, shift.role, shift.note, member.id]);
      copied += 1;
    }
    if (!copied) throw new PeopleError("Every shift would overlap another shift, time off or someone’s last day next week, so nothing was copied.");
    await audit(client, member, "shift.copied", { detail: `To the week of ${addDays(input.week, 7)}, ${copied} of ${rows.length}` });
    return { copied, skipped: rows.length - copied };
  });
}
