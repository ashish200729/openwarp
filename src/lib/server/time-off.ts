import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { leaveLeft, leaveYear, type adjustmentFields, type LeaveAdjustment, type LeavePolicy, type LeaveRequest, type policyFields, type recordTimeOffFields } from "@/lib/domains/time";
import { addDays, formatDays, today, weekdaysBetween, type RequestState, type timeOffFields } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { pool } from "./db";
import type { Member } from "./member";
import { notify, notifyDeciders } from "./notify";
import { audit, PeopleError, requireDecider, requireOwnEmployee, runAsAdmin, runAsMember } from "./write";

type Queryable = Pick<PoolClient, "query">;

export type TimeOffRequest = {
  id: string; employeeId: string; employeeName: string; typeName: string; startsOn: string; endsOn: string; days: number;
  halfDay: boolean; note: string; state: RequestState; decidedBy: string | null;
};
export type Absence = { employeeId: string; name: string; startsOn: string; endsOn: string };
export type Balance = { typeId: string; name: string; allowance: number | null; used: number; pending: number; booked: number };

const columns = `r.id, r.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", t.name AS "typeName",
  to_char(r.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(r.ends_on, 'YYYY-MM-DD') AS "endsOn", r.days::float8 AS days,
  r.half_day AS "halfDay", r.note, r.state, u.name AS "decidedBy"`;
const from = `FROM time_off_requests r JOIN employees e ON e.id = r.employee_id JOIN time_off_types t ON t.id = r.type_id LEFT JOIN "user" u ON u.id = r.decided_by`;

export type LeaveType = Omit<LeavePolicy, "annualDays"> & { id: string; name: string; annualDays: number | null; waitingDays: number; noticeDays: number; active: boolean; version: number };
export type Adjustment = { id: string; typeName: string; effectiveOn: string; days: number; reason: string; createdBy: string };
export type Coverage = { teamName: string | null; people: number; away: string[] };

const policyColumns = `id, name, annual_days AS "annualDays", accrual, carryover_days::float8 AS "carryoverDays", max_balance_days::float8 AS "maxBalanceDays", negative_days::float8 AS "negativeDays",
  waiting_days AS "waitingDays", notice_days AS "noticeDays", to_char(tracked_from, 'YYYY-MM-DD') AS "trackedFrom", active, policy_version AS version`;

async function leaveHistory(client: Queryable, employeeId: string) {
  const { rows: [person] } = await client.query<{ hireDate: string }>("SELECT to_char(hire_date, 'YYYY-MM-DD') AS \"hireDate\" FROM employees WHERE id = $1", [employeeId]);
  const { rows: requests } = await client.query<LeaveRequest & { typeId: string }>(
    `SELECT type_id AS "typeId", to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", days::float8 AS days, state = 'pending' AS pending FROM time_off_requests WHERE employee_id = $1 AND state IN ('pending', 'approved')`, [employeeId],
  );
  const { rows: adjustments } = await client.query<LeaveAdjustment & { typeId: string }>(
    `SELECT type_id AS "typeId", to_char(effective_on, 'YYYY-MM-DD') AS "effectiveOn", days::float8 AS days FROM time_off_adjustments WHERE employee_id = $1`, [employeeId],
  );
  return { hireDate: person?.hireDate ?? today(), of: (typeId: string) => ({ requests: requests.filter((entry) => entry.typeId === typeId), adjustments: adjustments.filter((entry) => entry.typeId === typeId) }) };
}

type TimeOffInput = z.infer<typeof timeOffFields>;

// The checks every request passes, whoever enters it. Balance, notice and waiting rules can be lifted by an administrator.
async function prepare(client: PoolClient, employeeId: string, input: TimeOffInput, { own, limits }: { own: boolean; limits: boolean }) {
  if (input.startsOn.slice(0, 4) !== input.endsOn.slice(0, 4)) throw new PeopleError("Request each calendar year separately.");
  const { rowCount: employed } = await client.query(
    "SELECT 1 FROM employees WHERE id = $1 AND hire_date <= $2::date AND (last_day IS NULL OR last_day >= $3::date)",
    [employeeId, input.startsOn, input.endsOn],
  );
  if (!employed) throw new PeopleError("Those dates are outside this person’s employment dates.");
  const { rows: [type] } = await client.query<LeaveType>(`SELECT ${policyColumns} FROM time_off_types WHERE id = $1 AND active`, [input.typeId]);
  if (!type) throw new PeopleError("Choose an available time off type.");
  const { rows: holidays } = await client.query<{ day: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM holidays WHERE day BETWEEN $1 AND $2", [input.startsOn, input.endsOn]);
  const weekdays = weekdaysBetween(input.startsOn, input.endsOn, new Set(holidays.map((holiday) => holiday.day)));
  if (!weekdays) throw new PeopleError("Those dates are all weekends or company holidays.");
  const days = input.halfDay ? 0.5 : weekdays;
  const { rowCount: overlapping } = await client.query(
    `SELECT 1 FROM time_off_requests WHERE employee_id = $1 AND state IN ('pending', 'approved') AND starts_on <= $3 AND ends_on >= $2
     AND NOT (half_day AND $4 AND (SELECT count(*) FROM time_off_requests WHERE employee_id = $1 AND state IN ('pending', 'approved') AND starts_on = $2 AND half_day) < 2) LIMIT 1`,
    [employeeId, input.startsOn, input.endsOn, input.halfDay],
  );
  if (overlapping) throw new PeopleError(own ? "You already have a request on those dates." : "This person already has a request on those dates.");
  if (own && limits && type.noticeDays && input.startsOn < addDays(today(), type.noticeDays)) throw new PeopleError(`${type.name} needs ${formatDays(type.noticeDays)} of notice. The earliest first day is ${formatDate(addDays(today(), type.noticeDays))}.`);
  const history = await leaveHistory(client, employeeId);
  if (own && limits && type.waitingDays && input.startsOn < addDays(history.hireDate, type.waitingDays)) throw new PeopleError(`${type.name} can be used from ${formatDate(addDays(history.hireDate, type.waitingDays))}.`);
  if (limits && type.annualDays !== null) {
    const { requests, adjustments } = history.of(input.typeId);
    const left = Math.max(leaveLeft({ ...type, annualDays: type.annualDays }, history.hireDate, requests, adjustments, input.startsOn), 0);
    if (days > left) throw new PeopleError(`That is ${formatDays(days)}, and ${own ? "you have" : "this person has"} ${formatDays(left)} of ${type.name} left for the year${type.accrual === "monthly" ? " by then, after time off already booked" : ""}.`);
  }
  return { type, days };
}

export async function requestTimeOff(member: Member, input: TimeOffInput) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const { type, days } = await prepare(client, employeeId, input, { own: true, limits: true });
    await client.query("INSERT INTO time_off_requests (employee_id, type_id, starts_on, ends_on, days, half_day, note) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [employeeId, input.typeId, input.startsOn, input.endsOn, days, input.halfDay, input.note]);
    await audit(client, member, "time_off.requested", { employeeId, detail: formatDays(days) });
    await notifyDeciders(client, member, employeeId, { title: `${member.name} requested ${type.name.toLowerCase()}`, body: `${input.startsOn} to ${input.endsOn}, ${formatDays(days)}`, href: "/workspace/time-off" });
  });
}

// An administrator enters time off for someone, approved straight away. Notice and waiting rules don't apply.
export function recordTimeOff(member: Member, input: z.infer<typeof recordTimeOffFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [input.employeeId]);
    if (!rowCount) throw new PeopleError("Archived profiles are read-only.");
    const { days } = await prepare(client, input.employeeId, input, { own: false, limits: !input.overBalance });
    await client.query("INSERT INTO time_off_requests (employee_id, type_id, starts_on, ends_on, days, half_day, note, state, decided_by, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, now())",
      [input.employeeId, input.typeId, input.startsOn, input.endsOn, days, input.halfDay, input.note, member.id]);
    await audit(client, member, "time_off.recorded", { employeeId: input.employeeId, detail: formatDays(days) });
    await notify(client, member, { employeeId: input.employeeId }, { title: "Time off was entered for you", body: `${input.startsOn} to ${input.endsOn}, ${formatDays(days)}`, href: "/workspace/time-off" });
  });
}

export function adjustBalance(member: Member, input: z.infer<typeof adjustmentFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [input.employeeId]);
    if (!rowCount) throw new PeopleError("Archived profiles are read-only.");
    const { rowCount: limited } = await client.query("SELECT 1 FROM time_off_types WHERE id = $1 AND annual_days IS NOT NULL", [input.typeId]);
    if (!limited) throw new PeopleError("This type has no limit, so it has no balance to adjust.");
    if (input.effectiveOn > today()) throw new PeopleError("The adjustment date can’t be in the future.");
    await client.query("INSERT INTO time_off_adjustments (employee_id, type_id, effective_on, days, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6)", [input.employeeId, input.typeId, input.effectiveOn, input.days, input.reason, member.id]);
    await audit(client, member, "time_off.adjusted", { employeeId: input.employeeId, detail: formatDays(input.days) });
    await notify(client, member, { employeeId: input.employeeId }, { title: "Your time off balance was adjusted", body: formatDays(input.days), href: `/workspace/people/${input.employeeId}/time-off` });
  });
}

export async function listAdjustments(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return [];
  const { rows } = await pool().query<Adjustment>(
    `SELECT a.id::text, t.name AS "typeName", to_char(a.effective_on, 'YYYY-MM-DD') AS "effectiveOn", a.days::float8 AS days, a.reason, u.name AS "createdBy"
     FROM time_off_adjustments a JOIN time_off_types t ON t.id = a.type_id JOIN "user" u ON u.id = a.created_by WHERE a.employee_id = $1 ORDER BY a.id DESC LIMIT 60`, [employeeId],
  );
  return rows;
}

export async function listLeavePolicies() {
  const { rows } = await pool().query<LeaveType>(`SELECT ${policyColumns} FROM time_off_types ORDER BY active DESC, annual_days IS NULL, lower(name)`);
  return rows;
}

export function savePolicy(member: Member, input: z.infer<typeof policyFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ name: string }>(
      `UPDATE time_off_types SET accrual = $3, carryover_days = $4, max_balance_days = $5, waiting_days = $6, negative_days = $7, notice_days = $8, tracked_from = $9, policy_version = policy_version + 1 WHERE id = $1 AND policy_version = $2 RETURNING name`,
      [input.id, input.version, input.accrual, input.carryoverDays, input.maxBalanceDays, input.waitingDays, input.negativeDays, input.noticeDays, input.trackedFrom],
    );
    if (!rows[0]) throw new PeopleError("This policy changed while you were editing. Reload and try again.");
    await audit(client, member, "settings.updated", { detail: `Time off policy: ${rows[0].name}` });
  });
}

// How many of each requester's team are already away on the requested days. People without a team are counted with others who share their manager.
export async function teamCoverage(member: Member, requests: TimeOffRequest[]) {
  if (!requests.length || (member.role !== "admin" && !member.managesPeople)) return new Map<string, Coverage>();
  const { rows } = await pool().query<Coverage & { id: string }>(
    `SELECT r.id, t.name AS "teamName", count(c.id)::int AS people,
     coalesce(array_agg(concat_ws(' ', c.first_name, c.last_name) ORDER BY lower(c.last_name), c.id) FILTER (WHERE EXISTS (
       SELECT 1 FROM time_off_requests o WHERE o.employee_id = c.id AND o.state = 'approved' AND o.starts_on <= r.ends_on AND o.ends_on >= r.starts_on)), '{}') AS away
     FROM time_off_requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN teams t ON t.id = e.team_id
     JOIN employees c ON c.id <> e.id AND c.status IN ('active', 'offboarding') AND (c.team_id = e.team_id OR e.team_id IS NULL AND c.manager_id = e.manager_id)
     WHERE r.id = ANY($3::uuid[]) AND ($1 = 'admin' OR e.manager_id = $2) GROUP BY r.id, t.name`, [member.role, member.employeeId, requests.map((request) => request.id)],
  );
  return new Map(rows.map(({ id, ...coverage }) => [id, coverage]));
}

export async function decideTimeOff(member: Member, input: { id: string; decision: "approved" | "declined" | "cancelled" }) {
  return runAsMember(member, async (client, actor) => {
    const { rows } = await client.query<{ employeeId: string; state: RequestState; days: number; past: boolean }>(
      `SELECT employee_id AS "employeeId", state, days::float8 AS days, starts_on <= current_date AS past FROM time_off_requests WHERE id = $1`, [input.id],
    );
    const request = rows[0];
    if (!request) throw new PeopleError("This request could not be found.");
    if (input.decision === "cancelled") {
      const own = actor.employeeId === request.employeeId;
      if (!own && actor.role !== "admin") throw new PeopleError("You can only cancel your own requests.");
      if (!["pending", "approved"].includes(request.state)) throw new PeopleError("This request is already closed.");
      if (request.state === "approved" && request.past && actor.role !== "admin") throw new PeopleError("Time off that has started can only be cancelled by an administrator.");
    } else {
      await requireDecider(client, actor, request.employeeId);
      if (request.state !== "pending") throw new PeopleError("This request was already decided.");
    }
    await client.query("UPDATE time_off_requests SET state = $2, decided_by = $3, decided_at = now() WHERE id = $1", [input.id, input.decision, member.id]);
    await audit(client, member, `time_off.${input.decision}`, { employeeId: request.employeeId, detail: formatDays(request.days) });
    await notify(client, member, { employeeId: request.employeeId }, { title: `Your time off was ${input.decision}`, body: formatDays(request.days), href: "/workspace/time-off" });
  });
}

export async function ownTimeOff(member: Member) {
  if (!member.employeeId) return [];
  const { rows } = await pool().query<TimeOffRequest>(`SELECT ${columns} ${from} WHERE r.employee_id = $1 ORDER BY r.starts_on DESC, r.id LIMIT 40`, [member.employeeId]);
  return rows;
}

export async function employeeTimeOff(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return [];
  const { rows } = await pool().query<TimeOffRequest>(`SELECT ${columns} ${from} WHERE r.employee_id = $1 ORDER BY r.starts_on DESC, r.id LIMIT 12`, [employeeId]);
  return rows;
}

export async function pendingTimeOff(member: Member) {
  const { rows } = await pool().query<TimeOffRequest>(
    `SELECT ${columns} ${from} WHERE r.state = 'pending' AND e.status <> 'archived' AND ($1 = 'admin' OR e.manager_id = $2) ORDER BY r.starts_on, r.id LIMIT 60`, [member.role, member.employeeId],
  );
  return rows;
}

// The allowance is what has been granted so far. With monthly accrual, time off that starts later is counted apart in booked because the days for it are still to come.
export async function timeOffBalances(employeeId: string, year: number) {
  const day = today();
  const asOf = year === Number(day.slice(0, 4)) ? day : year < Number(day.slice(0, 4)) ? `${year}-12-31` : `${year}-01-01`;
  const [types, history] = await Promise.all([listLeavePolicies(), leaveHistory(pool(), employeeId)]);
  return types.filter((type) => type.active).map(({ annualDays, ...type }): Balance => {
    const { requests, adjustments } = history.of(type.id);
    const { allowance, taken } = leaveYear({ ...type, annualDays: annualDays ?? 0 }, history.hireDate, requests, adjustments, year, asOf);
    const counted = type.accrual === "monthly" && annualDays !== null ? taken.filter((entry) => entry.startsOn <= asOf) : taken;
    const sum = (entries: typeof taken, pending: boolean) => entries.filter((entry) => entry.pending === pending).reduce((total, entry) => total + entry.days, 0);
    return { typeId: type.id, name: type.name, allowance: annualDays === null ? null : allowance, used: sum(counted, false), pending: sum(counted, true), booked: sum(taken, false) + sum(taken, true) - sum(counted, false) - sum(counted, true) };
  });
}

// The shared calendar shows that someone is away. The type and note stay with the employee and their deciders.
// Anyone still on the books counts, including people working out their notice: leave can only be booked
// inside their employment dates, so only archived records drop out.
export async function listAbsences(start: string, end: string) {
  const { rows } = await pool().query<Absence>(
    `SELECT e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS name, to_char(r.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(r.ends_on, 'YYYY-MM-DD') AS "endsOn"
     FROM time_off_requests r JOIN employees e ON e.id = r.employee_id
     WHERE r.state = 'approved' AND e.status <> 'archived' AND r.starts_on <= $2 AND r.ends_on >= $1 ORDER BY r.starts_on, lower(e.last_name), e.id LIMIT 300`, [start, end],
  );
  return rows;
}
