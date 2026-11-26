import "server-only";
import { z } from "zod";
import {
  addMonths, deviceKindLabels, deviceStatusLabels, obligationLabels, recurrenceLabels, reportViews, roleStatusLabels, type DeviceKind, type DeviceStatus, type ObligationCategory, type plannedRoleFields, type Recurrence,
  type ReportFilters, type ReportView, type RoleStatus, type saveViewFields,
} from "@/lib/domains/workplace";
import { today, workDate } from "@/lib/operations";
import { employmentLabels, employmentTypes, formatDate } from "@/lib/people";
import { pool } from "./db";
import { employedOn, headcountBetween, peopleValues, peopleWhere, workforceBreakdown } from "./insights";
import { requireAdmin, type Member } from "./member";
import { timeOffBalances } from "./time-off";
import { audit, ensureCurrentTeam, PeopleError, runAsAdmin } from "./write";

export type Table = { id: string; title: string; caption: string; columns: string[]; rows: string[][]; numeric: number[]; note?: string };
export type PlannedRole = { id: string; title: string; teamId: string | null; teamName: string | null; targetStart: string; status: RoleStatus; version: number };
export type SavedView = { id: string; name: string; query: string };

const maxMonths = 24;
const dateRangeViews: ReadonlySet<ReportView> = new Set(["headcount", "turnover"]);

export function reportUsesDateRange(view: ReportView) {
  return dateRangeViews.has(view);
}

export function reportFilters(params: Record<string, string | string[] | undefined>): ReportFilters {
  const date = (value: unknown, fallback: string) => { const parsed = workDate.safeParse(value); return parsed.success ? parsed.data : fallback; };
  const now = today();
  const requestedTo = date(params.to, now);
  const to = requestedTo > now ? now : requestedTo;
  let from = date(params.from, addMonths(`${to.slice(0, 7)}-01`, -11));
  const earliest = addMonths(`${to.slice(0, 7)}-01`, 1 - maxMonths);
  if (from > to || from < earliest) from = from > to ? addMonths(`${to.slice(0, 7)}-01`, -11) : earliest;
  const teamId = z.uuid().safeParse(params.team);
  return { teamId: teamId.success ? teamId.data : "", location: typeof params.location === "string" ? params.location.trim().slice(0, 100) : "", type: employmentTypes.find((type) => type === params.type) ?? "", from, to };
}

export function reportView(value: unknown): ReportView {
  return reportViews.find((view) => view === value) ?? "headcount";
}

export function reportQuery(view: ReportView, filters: ReportFilters) {
  const params = new URLSearchParams();
  if (view !== "headcount") params.set("view", view);
  const defaults = reportFilters({});
  if (filters.teamId) params.set("team", filters.teamId);
  if (filters.location) params.set("location", filters.location);
  if (filters.type) params.set("type", filters.type);
  if (reportUsesDateRange(view) && filters.from !== defaults.from) params.set("from", filters.from);
  if (reportUsesDateRange(view) && filters.to !== defaults.to) params.set("to", filters.to);
  return params.toString();
}

const percent = (part: number, whole: number) => whole ? `${Math.round(part / whole * 100)}%` : "None";
const number = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
const monthName = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

async function headcountTables(filters: ReportFilters): Promise<Table[]> {
  const [months, people] = await Promise.all([headcountBetween(filters.from, filters.to, filters), workforceBreakdown(filters, 200, filters.to)]);
  const total = people.types.reduce((sum, row) => sum + row.people, 0);
  const attribution = "Historical people are attributed to their current team, location and employment type; earlier profile changes are not reconstructed.";
  return [
    { id: "months", title: "Joiners and leavers", caption: `Joiners, leavers and headcount, ${formatDate(filters.from)} to ${formatDate(filters.to)}`, columns: ["Month", "Joined", "Left", "Headcount"], numeric: [1, 2, 3], rows: [...months].reverse().map((row) => [monthName.format(new Date(`${row.month}T00:00:00Z`)), String(row.joined), String(row.left), String(row.people)]), note: attribution },
    { id: "teams", title: "By team", caption: `People by team at ${formatDate(filters.to)}`, columns: ["Team", "People", "Share"], numeric: [1, 2], rows: people.teams.map((row) => [row.team, String(row.people), percent(row.people, total)]), note: attribution },
    { id: "types", title: "By employment type", caption: `People by employment type at ${formatDate(filters.to)}`, columns: ["Employment type", "People", "Share"], numeric: [1, 2], rows: people.types.map((row) => [employmentLabels[row.type], String(row.people), percent(row.people, total)]), note: attribution },
    { id: "locations", title: "By location", caption: `People by location at ${formatDate(filters.to)}`, columns: ["Location", "People", "Share"], numeric: [1, 2], rows: people.locations.map((row) => [row.location, String(row.people), percent(row.people, total)]), note: attribution },
  ];
}

async function turnoverTables(filters: ReportFilters): Promise<Table[]> {
  const values = [...peopleValues(filters), filters.from, filters.to];
  const end = "least($5::date, current_date)";
  const [teams, tenure, anniversaries] = await Promise.all([
    pool().query<{ team: string; opening: number; closing: number; joined: number; left: number; kept: number }>(
      `SELECT coalesce(t.name, 'No team') AS team,
       count(DISTINCT e.id) FILTER (WHERE ep.starts_on <= $4::date AND (ep.ends_on IS NULL OR ep.ends_on >= $4::date))::int AS opening,
       count(DISTINCT e.id) FILTER (WHERE ep.starts_on <= ${end} AND (ep.ends_on IS NULL OR ep.ends_on >= ${end}))::int AS closing,
       count(*) FILTER (WHERE ep.starts_on BETWEEN $4::date AND ${end})::int AS joined,
       count(*) FILTER (WHERE ep.ends_on BETWEEN $4::date AND ${end})::int AS left,
       count(DISTINCT e.id) FILTER (WHERE ep.starts_on <= $4::date AND (ep.ends_on IS NULL OR ep.ends_on >= $4::date)
         AND ep.starts_on <= ${end} AND (ep.ends_on IS NULL OR ep.ends_on >= ${end}))::int AS kept
       FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN employment_periods ep ON ep.employee_id = e.id
       WHERE ${peopleWhere}
       GROUP BY 1
       HAVING count(*) FILTER (WHERE ep.starts_on <= ${end} AND (ep.ends_on IS NULL OR ep.ends_on >= ${end})
         OR ep.starts_on BETWEEN $4::date AND ${end} OR ep.ends_on BETWEEN $4::date AND ${end}) > 0
       ORDER BY 1 LIMIT 100`, values,
    ),
    pool().query<{ band: number; people: number }>(
      `SELECT width_bucket((current_date - ep.starts_on) / 365.25, ARRAY[0, 1, 2, 3, 5, 10]::numeric[]) AS band, count(*)::int AS people
       FROM employees e JOIN LATERAL (
         SELECT starts_on FROM employment_periods
         WHERE employee_id = e.id AND starts_on <= current_date AND (ends_on IS NULL OR ends_on >= current_date)
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) ep ON true
       WHERE ${peopleWhere} GROUP BY 1 ORDER BY 1`, peopleValues(filters),
    ),
    pool().query<{ name: string; team: string; on: string; years: number }>(
      `SELECT concat_ws(' ', e.first_name, e.last_name) AS name, coalesce(t.name, 'No team') AS team, to_char(n.day, 'YYYY-MM-DD') AS "on", n.years FROM employees e LEFT JOIN teams t ON t.id = e.team_id
       JOIN LATERAL (
         SELECT starts_on, ends_on FROM employment_periods
         WHERE employee_id = e.id AND starts_on <= current_date AND (ends_on IS NULL OR ends_on >= current_date)
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) ep ON true
       CROSS JOIN LATERAL (SELECT y AS years, (ep.starts_on + make_interval(years => y))::date AS day FROM (SELECT extract(year FROM age(current_date - 1, ep.starts_on))::int + 1 AS y) v) n
       WHERE e.status IN ('active', 'offboarding') AND ep.starts_on < current_date AND n.day <= current_date + 60 AND (ep.ends_on IS NULL OR ep.ends_on >= n.day) AND ${peopleWhere} ORDER BY n.day, lower(e.last_name), e.id LIMIT 200`, peopleValues(filters),
    ),
  ]);
  const bands = ["Under 1 year", "1 to 2 years", "2 to 3 years", "3 to 5 years", "5 to 10 years", "10 years or more"];
  const tenured = tenure.rows.reduce((sum, row) => sum + row.people, 0);
  const totals = teams.rows.reduce((sum, row) => ({ opening: sum.opening + row.opening, closing: sum.closing + row.closing, joined: sum.joined + row.joined, left: sum.left + row.left, kept: sum.kept + row.kept }), { opening: 0, closing: 0, joined: 0, left: 0, kept: 0 });
  const line = (name: string, row: typeof totals) => [name, String(row.opening), String(row.joined), String(row.left), String(row.closing), percent(row.left, (row.opening + row.closing) / 2), percent(row.kept, row.opening)];
  return [
    { id: "turnover", title: "Turnover and retention by team", caption: `Turnover and retention by team, ${formatDate(filters.from)} to ${formatDate(filters.to)}`, columns: ["Team", "At start", "Joined", "Left", "At end", "Turnover", "Retention"], numeric: [1, 2, 3, 4, 5, 6], rows: [...teams.rows.map((row) => line(row.team, row)), ...(teams.rows.length > 1 ? [line("All teams", totals)] : [])], note: "Turnover is leavers divided by average headcount. Historical people are attributed to their current team, location and employment type; earlier profile changes are not reconstructed." },
    { id: "tenure", title: "Tenure", caption: "Current people by length of service", columns: ["Length of service", "People", "Share"], numeric: [1, 2], rows: bands.map((band, index) => { const people = tenure.rows.find((row) => row.band === index + 1)?.people ?? 0; return [band, String(people), percent(people, tenured)]; }) },
    { id: "anniversaries", title: "Work anniversaries, next 60 days", caption: "Upcoming work anniversaries", columns: ["Person", "Team", "Date", "Years"], numeric: [3], rows: anniversaries.rows.map((row) => [row.name, row.team, formatDate(row.on), String(row.years)]) },
  ];
}

const balanceLimit = 1000;

async function timeOffTables(filters: ReportFilters): Promise<Table[]> {
  const { rows: people } = await pool().query<{ id: string }>(`SELECT e.id FROM employees e WHERE e.status IN ('active', 'offboarding') AND ${employedOn("current_date")} AND ${peopleWhere} ORDER BY e.id LIMIT ${balanceLimit + 1}`, peopleValues(filters));
  const included = people.slice(0, balanceLimit);
  const year = Number(today().slice(0, 4));
  const totals = new Map<string, { name: string; allowance: number; used: number; pending: number; left: number; limited: boolean }>();
  // Balances come from the time off module one person at a time, a few at once so other pages keep their connections.
  for (let index = 0; index < included.length; index += 4) {
    for (const balances of await Promise.all(included.slice(index, index + 4).map((person) => timeOffBalances(person.id, year)))) {
      for (const balance of balances) {
        const total = totals.get(balance.typeId) ?? { name: balance.name, allowance: 0, used: 0, pending: 0, left: 0, limited: false };
        total.used += balance.used;
        total.pending += balance.pending;
        if (balance.allowance !== null) {
          total.limited = true;
          total.allowance += balance.allowance;
          total.left += balance.allowance - balance.used;
        }
        totals.set(balance.typeId, total);
      }
    }
  }
  return [{
    id: "liability", title: `Days outstanding, ${year}`, caption: `Time off outstanding by type in ${year}`, columns: ["Type", "Allowance", "Approved", "Waiting", "Outstanding"], numeric: [1, 2, 3, 4],
    rows: [...totals.values()].map((row) => [row.name, row.limited ? number(row.allowance) : "No limit", number(row.used), number(row.pending), row.limited ? number(row.left) : "Not applicable"]),
    note: `Days for ${included.length} active and offboarding ${included.length === 1 ? "person" : "people"}. Outstanding is the allowance less approved days. It is a count of days, not an amount of money.${people.length > balanceLimit ? ` Only the first ${balanceLimit} are counted. Narrow the filters to see the rest.` : ""}`,
  }];
}

export async function listPlannedRoles(filters: Pick<ReportFilters, "teamId">) {
  await requireAdmin();
  const { rows } = await pool().query<PlannedRole>(
    `SELECT r.id, r.title, r.team_id AS "teamId", t.name AS "teamName", to_char(r.target_start, 'YYYY-MM-DD') AS "targetStart", r.status, r.version FROM planned_roles r LEFT JOIN teams t ON t.id = r.team_id
     WHERE ($1 = '' OR r.team_id = NULLIF($1, '')::uuid) ORDER BY r.status IN ('filled', 'dropped'), r.target_start, lower(r.title), r.id LIMIT 300`, [filters.teamId],
  );
  return rows;
}

async function planTables(filters: ReportFilters): Promise<Table[]> {
  const [{ rows }, roles] = await Promise.all([pool().query<{ team: string; people: number; open: number; filled: number; late: number }>(
    `SELECT coalesce(t.name, 'No team') AS team, coalesce(p.people, 0)::int AS people, coalesce(r.open, 0)::int AS open, coalesce(r.filled, 0)::int AS filled, coalesce(r.late, 0)::int AS late
     FROM (SELECT e.team_id, count(*) AS people FROM employees e WHERE ${employedOn("current_date")} AND ${peopleWhere} GROUP BY 1) p
     FULL JOIN (SELECT team_id, count(*) FILTER (WHERE status IN ('planned', 'open')) AS open, count(*) FILTER (WHERE status = 'filled') AS filled, count(*) FILTER (WHERE status IN ('planned', 'open') AND target_start < current_date) AS late
       FROM planned_roles WHERE NULLIF($1, '') IS NULL OR team_id = NULLIF($1, '')::uuid GROUP BY 1) r ON coalesce(r.team_id::text, '') = coalesce(p.team_id::text, '')
     LEFT JOIN teams t ON t.id = coalesce(p.team_id, r.team_id) ORDER BY 1`, peopleValues(filters),
  ), listPlannedRoles(filters)]);
  return [
    { id: "plan", title: "Plan against actual", caption: "Headcount plan against current headcount by team", columns: ["Team", "Now", "Roles to fill", "Plan", "Filled", "Past target start"], numeric: [1, 2, 3, 4, 5], rows: rows.map((row) => [row.team, String(row.people), String(row.open), String(row.people + row.open), String(row.filled), String(row.late)]), note: "Plan is the current headcount plus roles that are planned or open." },
    { id: "roles", title: "Planned roles", caption: "Planned roles", columns: ["Role", "Team", "Target start", "Status"], numeric: [], rows: roles.map((role) => [role.title, role.teamName ?? "No team", formatDate(role.targetStart), roleStatusLabels[role.status]]) },
  ];
}

async function workplaceTables(filters: ReportFilters): Promise<Table[]> {
  const values = peopleValues(filters);
  const [training, obligations, devices, apps] = await Promise.all([
    pool().query<{ title: string; assigned: number; completed: number; overdue: number }>(
      `SELECT c.title, count(*)::int AS assigned, count(*) FILTER (WHERE a.state = 'completed')::int AS completed, count(*) FILTER (WHERE a.state = 'open' AND a.due_on < current_date)::int AS overdue
       FROM training_assignments a JOIN courses c ON c.id = a.course_id JOIN employees e ON e.id = a.employee_id WHERE a.state <> 'cancelled' AND a.opens_on <= current_date AND c.archived_at IS NULL AND ${employedOn("current_date")} AND ${peopleWhere} GROUP BY c.id ORDER BY lower(c.title) LIMIT 300`, values,
    ),
    pool().query<{ name: string; category: ObligationCategory; recurrence: Recurrence; due: string | null; overdue: boolean }>(
      `SELECT o.name, o.category, o.recurrence, to_char(c.due_on, 'YYYY-MM-DD') AS due, coalesce(c.due_on < current_date, false) AS overdue FROM obligations o LEFT JOIN obligation_occurrences c ON c.obligation_id = o.id AND c.state = 'open' WHERE o.archived_at IS NULL ORDER BY c.due_on NULLS LAST, lower(o.name) LIMIT 300`,
    ),
    pool().query<{ kind: DeviceKind; status: DeviceStatus; count: number }>(
      `SELECT d.kind, d.status, count(*)::int AS count FROM devices d LEFT JOIN device_assignments a ON a.device_id = d.id AND a.returned_at IS NULL LEFT JOIN employees e ON e.id = a.employee_id
       WHERE ($1 = '' AND $2 = '' AND $3 = '') OR (e.id IS NOT NULL AND ${employedOn("current_date")} AND ${peopleWhere}) GROUP BY 1, 2 ORDER BY 1, 2`, values,
    ),
    pool().query<{ name: string; used: number; seats: number | null; renews: string | null }>(
      `SELECT p.name, count(e.id)::int AS used, p.seats, to_char(p.renews_on, 'YYYY-MM-DD') AS renews FROM apps p LEFT JOIN app_grants g ON g.app_id = p.id AND g.state = 'granted' LEFT JOIN employees e ON e.id = g.employee_id AND ${employedOn("current_date")} AND ${peopleWhere}
       WHERE p.archived_at IS NULL GROUP BY p.id ORDER BY lower(p.name) LIMIT 300`, values,
    ),
  ]);
  const statuses = Object.keys(deviceStatusLabels) as DeviceStatus[];
  const kinds = [...new Set(devices.rows.map((row) => row.kind))];
  return [
    { id: "training", title: "Training", caption: "Current training progress by course", columns: ["Course", "Assigned", "Completed", "Overdue", "Complete"], numeric: [1, 2, 3, 4], rows: training.rows.map((row) => [row.title, String(row.assigned), String(row.completed), String(row.overdue), percent(row.completed, row.assigned)]) },
    { id: "compliance", title: "Compliance", caption: "Current obligations and their next date", columns: ["Obligation", "Category", "Repeats", "Next date", "Status"], numeric: [], rows: obligations.rows.map((row) => [row.name, obligationLabels[row.category], recurrenceLabels[row.recurrence], row.due ? formatDate(row.due) : "None", row.overdue ? "Overdue" : row.due ? "Upcoming" : "Complete"]) },
    { id: "devices", title: "Devices", caption: "Current devices by type and status", columns: ["Type", ...statuses.map((status) => deviceStatusLabels[status]), "Total"], numeric: statuses.map((_, index) => index + 1).concat(statuses.length + 1), rows: kinds.map((kind) => {
      const counts = statuses.map((status) => devices.rows.find((row) => row.kind === kind && row.status === status)?.count ?? 0);
      return [deviceKindLabels[kind], ...counts.map(String), String(counts.reduce((sum, count) => sum + count, 0))];
    }) },
    { id: "apps", title: "Apps", caption: "Current recorded app access", columns: ["App", "People with access", "Seats", "Renews"], numeric: [1, 2], rows: apps.rows.map((row) => [row.name, String(row.used), row.seats === null ? "Not set" : String(row.seats), row.renews ? formatDate(row.renews) : "Not set"]) },
  ];
}

export async function reportTables(view: ReportView, filters: ReportFilters): Promise<Table[]> {
  await requireAdmin();
  return { headcount: headcountTables, turnover: turnoverTables, time_off: timeOffTables, plan: planTables, workplace: workplaceTables }[view](filters);
}

export async function exportReport(member: Member, view: ReportView, filters: ReportFilters, id: string) {
  const table = (await reportTables(view, filters)).find((entry) => entry.id === id);
  if (!table) return null;
  await runAsAdmin(member, (client) => audit(client, member, "report.exported", { detail: `${table.title}, ${table.rows.length} rows` }));
  return table;
}

export async function listLocations() {
  await requireAdmin();
  const { rows } = await pool().query<{ location: string }>("SELECT min(trim(location)) AS location FROM employees WHERE trim(location) <> '' GROUP BY lower(trim(location)) ORDER BY 1 LIMIT 300");
  return rows.map((row) => row.location);
}

export function savePlannedRole(member: Member, input: z.infer<typeof plannedRoleFields>) {
  return runAsAdmin(member, async (client) => {
    await ensureCurrentTeam(client, input.teamId);
    const values = [input.title, input.teamId, input.targetStart, input.status];
    const { rowCount } = input.id ? await client.query("UPDATE planned_roles SET title = $1, team_id = $2, target_start = $3, status = $4, version = version + 1 WHERE id = $5 AND version = $6", [...values, input.id, input.version])
      : await client.query("INSERT INTO planned_roles (title, team_id, target_start, status) VALUES ($1, $2, $3, $4)", values);
    if (!rowCount) throw new PeopleError("This role changed while you were editing. Reload it and try again.");
    await audit(client, member, input.id ? "role.updated" : "role.planned", { teamId: input.teamId ?? undefined, detail: input.title });
  });
}

export async function listViews(member: Member) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<SavedView>("SELECT id, name, query FROM report_views WHERE user_id = $1 ORDER BY lower(name) LIMIT 50", [member.id]);
  return rows;
}

// The saved query is rebuilt from its parsed parts, so only known filters are stored.
export function saveView(member: Member, input: z.infer<typeof saveViewFields>) {
  return runAsAdmin(member, async (client) => {
    const params = Object.fromEntries(new URLSearchParams(input.query));
    const { rowCount } = await client.query("INSERT INTO report_views (user_id, name, query) SELECT $1, $2, $3 WHERE (SELECT count(*) FROM report_views WHERE user_id = $1) < 50 ON CONFLICT DO NOTHING", [member.id, input.name, reportQuery(reportView(params.view), reportFilters(params))]);
    if (!rowCount) throw new PeopleError("Use a different name. You can save up to 50 views.");
    await audit(client, member, "report.saved", { detail: input.name });
  });
}

export async function removeView(member: Member, id: string) {
  await runAsAdmin(member, (client) => client.query("DELETE FROM report_views WHERE id = $1 AND user_id = $2", [id, member.id]));
}
