import "server-only";
import { activityLabels, type ActivityEvent } from "@/lib/activity";
import { addMonths } from "@/lib/domains/workplace";
import { today } from "@/lib/operations";
import type { EmploymentType } from "@/lib/people";
import { pool } from "./db";
import type { Activity } from "./directory";
import { requireAdmin, type Member } from "./member";
import { audit, PeopleError, runAsAdmin } from "./write";

export type OrgPerson = { id: string; name: string; title: string; teamName: string | null; managerId: string | null };
export type Movement = { id: string; name: string; title: string; date: string };

export async function readOrg(member: Member) {
  const { rows } = await pool().query<OrgPerson>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name, e.title, t.name AS "teamName", e.manager_id AS "managerId"
     FROM employees e LEFT JOIN teams t ON t.id = e.team_id WHERE e.status = 'active' OR ($1 = 'admin' AND e.status <> 'archived')
     ORDER BY lower(e.last_name), lower(e.first_name), e.id LIMIT 2001`, [member.role],
  );
  return rows;
}

// Large directories expand one reporting level at a time. A hidden manager makes their visible report a root.
export async function orgLevel(member: Member, managerId: string | null, requested: number) {
  const manager = managerId ? (await pool().query<{ name: string }>(
    `SELECT concat_ws(' ', first_name, last_name) AS name FROM employees WHERE id=$1 AND (status='active' OR ($2='admin' AND status<>'archived'))`, [managerId, member.role],
  )).rows[0] : null;
  if (managerId && !manager) return null;
  const from = `FROM employees e WHERE (e.status='active' OR ($1='admin' AND e.status<>'archived'))
    AND (CASE WHEN $2::uuid IS NOT NULL THEN e.manager_id=$2 ELSE NOT EXISTS
      (SELECT 1 FROM employees m WHERE m.id=e.manager_id AND (m.status='active' OR ($1='admin' AND m.status<>'archived'))) END)`;
  const args = [member.role, managerId];
  const { rows: [count] } = await pool().query<{ total: number }>(`SELECT count(*)::int AS total ${from}`, args);
  const pages = Math.max(1, Math.ceil(count.total / 50));
  const page = Math.min(requested, pages);
  const { rows: people } = await pool().query<OrgPerson & { reports: number }>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name, e.title, e.manager_id AS "managerId",
      (SELECT name FROM teams t WHERE t.id=e.team_id) AS "teamName",
      (SELECT count(*)::int FROM employees r WHERE r.manager_id=e.id AND (r.status='active' OR ($1='admin' AND r.status<>'archived'))) AS reports
      ${from} ORDER BY lower(e.last_name), lower(e.first_name), e.id LIMIT 50 OFFSET $3`, [...args, (page - 1) * 50],
  );
  return { manager, people, pages, page };
}

export type PeopleFilters = { teamId: string; location: string; type: string };
export const noFilters: PeopleFilters = { teamId: "", location: "", type: "" };
// Placeholders $1 to $3 narrow any query over employees e.
export const peopleWhere = `(NULLIF($1, '') IS NULL OR e.team_id = NULLIF($1, '')::uuid) AND ($2 = '' OR lower(trim(e.location)) = lower($2)) AND ($3 = '' OR e.employment_type = $3)`;
export const peopleValues = (filters: PeopleFilters) => [filters.teamId, filters.location, filters.type];
export const employedOn = (day: string) => `(e.hire_date <= ${day} AND (e.last_day IS NULL AND e.status <> 'archived' OR e.last_day >= ${day}))`;

export async function headcountBetween(from: string, to: string, filters: PeopleFilters = noFilters) {
  await requireAdmin();
  const { rows } = await pool().query<{ month: string; people: number; joined: number; left: number }>(
    `WITH months AS (SELECT generate_series(date_trunc('month', $4::date), date_trunc('month', least($5::date, current_date)), interval '1 month')::date AS first),
     spans AS (SELECT first, greatest(first, $4::date) AS opens, least((first + interval '1 month' - interval '1 day')::date, $5::date, current_date) AS closes FROM months)
     SELECT to_char(s.first, 'YYYY-MM-DD') AS month, count(*) FILTER (WHERE ${employedOn("s.closes")})::int AS people,
     count(*) FILTER (WHERE e.hire_date BETWEEN s.opens AND s.closes)::int AS joined, count(*) FILTER (WHERE e.last_day BETWEEN s.opens AND s.closes)::int AS left
     FROM spans s LEFT JOIN employees e ON ${peopleWhere} GROUP BY s.first ORDER BY s.first`, [...peopleValues(filters), from, to],
  );
  return rows;
}

export function headcountByMonth(months: number) {
  const now = today();
  return headcountBetween(addMonths(`${now.slice(0, 7)}-01`, 1 - months), now);
}

export async function workforceBreakdown(filters: PeopleFilters = noFilters, locationLimit = 6) {
  await requireAdmin();
  const where = `e.status <> 'archived' AND ${peopleWhere}`;
  const values = peopleValues(filters);
  const [types, locations, teams, tenure] = await Promise.all([
    pool().query<{ type: EmploymentType; people: number }>(`SELECT e.employment_type AS type, count(*)::int AS people FROM employees e WHERE ${where} GROUP BY 1 ORDER BY 2 DESC, 1`, values),
    pool().query<{ location: string; people: number }>(`SELECT coalesce(nullif(min(trim(e.location)), ''), 'No location') AS location, count(*)::int AS people FROM employees e WHERE ${where} GROUP BY lower(trim(e.location)) ORDER BY 2 DESC, 1 LIMIT $4`, [...values, locationLimit]),
    pool().query<{ team: string; people: number }>(`SELECT coalesce(t.name, 'No team') AS team, count(*)::int AS people FROM employees e LEFT JOIN teams t ON t.id = e.team_id WHERE ${where} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 100`, values),
    pool().query<{ years: number | null }>(`SELECT avg((current_date - e.hire_date) / 365.25)::float8 AS years FROM employees e WHERE ${where} AND e.hire_date <= current_date`, values),
  ]);
  return { types: types.rows, locations: locations.rows, teams: teams.rows, tenure: tenure.rows[0].years };
}

export async function upcomingMoves() {
  await requireAdmin();
  const { rows } = await pool().query<Movement & { kind: "start" | "leave" }>(
    `SELECT id, concat_ws(' ', first_name, last_name) AS name, title, to_char(CASE WHEN status = 'onboarding' THEN hire_date ELSE last_day END, 'YYYY-MM-DD') AS date,
     CASE WHEN status = 'onboarding' THEN 'start' ELSE 'leave' END AS kind FROM employees
     WHERE (status = 'onboarding' AND hire_date >= current_date - 7) OR (status = 'offboarding' AND last_day >= current_date - 7) ORDER BY 4, 2 LIMIT 8`,
  );
  return rows;
}

export async function searchWorkspace(member: Member, query: string) {
  const { rows } = await pool().query<{ kind: "person" | "team"; id: string; label: string; detail: string }>(
    `(SELECT 'person' AS kind, e.id, concat_ws(' ', e.first_name, e.last_name) AS label, e.title AS detail FROM employees e
      WHERE ($1 = 'admin' OR e.status = 'active') AND strpos(lower(concat_ws(' ', e.first_name, e.last_name, e.email, e.title)), lower($2)) > 0 ORDER BY e.status = 'archived', lower(e.last_name), e.id LIMIT 7)
     UNION ALL
     (SELECT 'team', t.id, t.name, 'Team' FROM teams t WHERE t.archived_at IS NULL AND strpos(lower(t.name), lower($2)) > 0 ORDER BY lower(t.name) LIMIT 4)`, [member.role, query],
  );
  return rows;
}

export type ActivityFilters = { person: string; actor: string; group: string; from: string; to: string };
export const activityGroups = [...new Set(Object.keys(activityLabels).map((event) => event.split(".")[0]))].sort().map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1).replaceAll("_", " ") }));

const activityColumns = `a.id::text, a.event, coalesce(a.actor_name, u.name) AS actor, a.employee_id AS "employeeId", coalesce(a.subject_name, e.first_name || ' ' || e.last_name, t.name, s.name, '') AS subject, a.detail, a.created_at AS at
  FROM activity_log a LEFT JOIN "user" u ON u.id = a.actor_id LEFT JOIN employees e ON e.id = a.employee_id LEFT JOIN teams t ON t.id = a.team_id LEFT JOIN "user" s ON s.id = a.subject_user_id`;
const activityWhere = `($1 = '' OR strpos(lower(concat_ws(' ', a.subject_name, e.first_name, e.last_name, t.name, s.name)), lower($1)) > 0) AND ($2 = '' OR a.actor_id = $2) AND ($3 = '' OR split_part(a.event, '.', 1) = $3)
  AND ($4 = '' OR a.created_at >= NULLIF($4, '')::date) AND ($5 = '' OR a.created_at < NULLIF($5, '')::date + 1)`;
const activityValues = (filters: ActivityFilters) => [filters.person, filters.actor, filters.group, filters.from, filters.to];

export async function searchActivity(filters: ActivityFilters, before: string | null, size = 20) {
  await requireAdmin();
  const { rows } = await pool().query<Activity>(`SELECT ${activityColumns} WHERE ${activityWhere} AND ($6::bigint IS NULL OR a.id < $6) ORDER BY a.id DESC LIMIT $7`, [...activityValues(filters), before, size + 1]);
  const entries = rows.slice(0, size);
  return { entries, next: rows.length > size ? entries.at(-1)!.id : null };
}

export async function activityActors() {
  await requireAdmin();
  const { rows } = await pool().query<{ id: string; name: string }>(`SELECT u.id, u.name FROM "user" u WHERE EXISTS (SELECT 1 FROM activity_log a WHERE a.actor_id = u.id) ORDER BY lower(u.name), u.id LIMIT 500`);
  return rows;
}

export function exportActivity(member: Member, filters: ActivityFilters) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<Activity>(`SELECT ${activityColumns} WHERE ${activityWhere} ORDER BY a.id DESC LIMIT 20001`, activityValues(filters));
    if (rows.length > 20_000) throw new PeopleError("The export exceeds 20,000 entries. Choose a shorter date range.");
    await audit(client, member, "activity.exported", { detail: `${rows.length} entries` });
    return [["Time (UTC)", "Event", "Person", "Subject", "Detail"], ...rows.map((row) => [row.at.toISOString(), activityLabels[row.event as ActivityEvent] ?? row.event, row.actor ?? "Workspace operator", row.subject, row.detail])];
  });
}
