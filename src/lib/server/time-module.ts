import "server-only";
import type { PoolClient } from "pg";
import { formatWeekday, timesheetUrl, weekStart } from "@/lib/domains/time";
import { addDays } from "@/lib/operations";
import { pool } from "./db";
import type { Member } from "./member";
import type { Todo } from "./modules";
import { companyToday, pendingSheets, tracksSql } from "./timesheets";
import { audit } from "./write";

export async function todos(member: Member): Promise<Todo[]> {
  const items: Todo[] = [];
  if (member.employeeId) {
    const week = addDays(weekStart(await companyToday()), -7);
    const { rowCount } = await pool().query(
      `SELECT 1 FROM employees e CROSS JOIN time_settings t LEFT JOIN timesheets w ON w.employee_id = e.id AND w.week_start = $2::date
       WHERE e.id = $1 AND e.status <> 'archived' AND ${tracksSql} AND e.hire_date <= $2::date + 6 AND (e.last_day IS NULL OR e.last_day >= $2::date) AND coalesce(w.state, 'open') IN ('open', 'returned')`, [member.employeeId, week],
    );
    if (rowCount) items.push({ key: `timesheet-${week}`, href: `/workspace/timesheets?week=${week}`, title: "Submit last week’s timesheet", detail: `${formatWeekday(week)} to ${formatWeekday(addDays(week, 6))}`, meta: "" });
  }
  if (member.role === "admin" || member.managesPeople) {
    for (const sheet of await pendingSheets(member)) items.push({ key: `timesheet-${sheet.employeeId}-${sheet.week}`, href: timesheetUrl(sheet.employeeId, sheet.week), title: `${sheet.name} submitted a timesheet`, detail: `Week of ${formatWeekday(sheet.week)}`, meta: "" });
  }
  return items;
}

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export async function onOnboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {}

// Nobody can work a shift after their last day.
export async function onOffboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {
  const { rowCount } = await client.query("DELETE FROM shifts s USING employees e WHERE e.id = s.employee_id AND e.id = $1 AND s.day > e.last_day", [employeeId]);
  if (rowCount) await audit(client, member, "shift.deleted", { employeeId, detail: `${rowCount} after the last day` });
}

export async function archiveBlockers(client: PoolClient, employeeId: string): Promise<string[]> {
  const { rows } = await client.query<{ week: string; running: boolean }>(
    `SELECT to_char(t.week_start, 'YYYY-MM-DD') AS week, coalesce(bool_or(x.ended_at IS NULL) FILTER (WHERE x.id IS NOT NULL), false) AS running
     FROM timesheets t LEFT JOIN time_entries x ON x.timesheet_id = t.id AND x.removed_at IS NULL
     WHERE t.employee_id = $1 AND t.state IN ('open', 'submitted', 'returned') GROUP BY t.id HAVING t.state = 'submitted' OR count(x.id) > 0 ORDER BY t.week_start`, [employeeId],
  );
  const blockers = rows.some((row) => row.running) ? ["Close this employee’s running time entry."] : [];
  if (rows.length) blockers.push(`Approve this employee’s ${rows.length === 1 ? "timesheet" : "timesheets"} for the ${rows.length === 1 ? "week" : "weeks"} of ${rows.map((row) => row.week).join(", ")}.`);
  return blockers;
}

export type PaidHours = { regular: number; overtime: number };

// Approved timesheet hours by employee id for an inclusive date range. The overtime split was stored when each full week was approved.
export async function approvedHours(client: Pick<PoolClient, "query">, start: string, end: string): Promise<Map<string, PaidHours>> {
  const { rows } = await client.query<PaidHours & { employeeId: string }>(
    `SELECT t.employee_id AS "employeeId", round(sum(d.regular_minutes) / 60.0, 2)::float8 AS regular, round(sum(d.overtime_minutes) / 60.0, 2)::float8 AS overtime
     FROM timesheets t JOIN timesheet_days d ON d.timesheet_id = t.id WHERE t.state IN ('approved', 'locked') AND d.day BETWEEN $1 AND $2 GROUP BY t.employee_id`, [start, end],
  );
  return new Map(rows.map(({ employeeId, regular, overtime }) => [employeeId, { regular, overtime }]));
}

// A regular run with exactly this period is the one being decided. Other approved runs count for sheets that were approved before them.
const paidBy = (period: string) => `EXISTS (SELECT 1 FROM pay_runs r JOIN pay_run_lines l ON l.pay_run_id = r.id
  WHERE r.kind = 'regular' AND ${period} AND l.employee_id = t.employee_id AND coalesce(l.hours, 0) + coalesce(l.overtime_hours, 0) > 0
  AND r.period_start <= t.week_start + 6 AND r.period_end >= t.week_start AND NOT EXISTS (SELECT 1 FROM pay_runs v WHERE v.reverses_id = r.id AND v.state = 'approved'))`;
const thisRun = "r.period_start = $1::date AND r.period_end = $2::date";

// Called when a pay run or a reversal for this range is approved, after a reversal is marked approved. It locks the sheets of people paid for hours, and unlocks those that no run pays any more.
export async function lockTimesheets(client: PoolClient, start: string, end: string): Promise<void> {
  const set = (state: string) => `UPDATE timesheets t SET state = '${state}', version = version + 1 WHERE t.week_start <= $2::date AND t.week_start + 6 >= $1::date`;
  await client.query(`${set("locked")} AND t.state = 'approved' AND ${paidBy(thisRun)}`, [start, end]);
  await client.query(`${set("approved")} AND t.state = 'locked' AND NOT ${paidBy(`(${thisRun} OR r.state = 'approved' AND r.approved_at >= t.decided_at)`)}`, [start, end]);
}

// Timesheets waiting on this member, for the navigation count.
export async function pendingTimesheets(member: Member): Promise<number> {
  if (member.role !== "admin" && !member.managesPeople) return 0;
  const { rows } = await pool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM timesheets t JOIN employees e ON e.id = t.employee_id WHERE t.state = 'submitted' AND e.status <> 'archived' AND ($1 = 'admin' OR e.manager_id = $2)`, [member.role, member.employeeId],
  );
  return rows[0].count;
}
