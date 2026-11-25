import "server-only";
import { type EmployeeFilters, type EmployeeStatus, type EmploymentType, type WorkflowKind } from "@/lib/people";
import { pool } from "./db";
import { requireAdmin, type Member, type Role } from "./member";

export type Employee = {
  id: string; firstName: string; lastName: string; email: string; title: string;
  teamId: string | null; teamName: string | null; managerId: string | null;
  managerName: string | null; employmentType: EmploymentType; status: EmployeeStatus;
  hireDate: string; lastDay: string | null; location: string; version: number;
};
export type Team = { id: string; name: string; version: number; people: number };
export type Workflow = { id: string; kind: WorkflowKind; state: "open" | "completed" | "cancelled"; openedAt: Date; closedAt: Date | null };
export type Task = { id: string; title: string; completedAt: Date | null; completedBy: string | null };
export type OpenWorkflow = Workflow & { employeeId: string; employeeName: string; title: string; targetDate: string; completed: number; total: number };

export const employeeColumns = `
  e.id, e.first_name AS "firstName", e.last_name AS "lastName", e.email, e.title,
  e.team_id AS "teamId", t.name AS "teamName", e.manager_id AS "managerId",
  concat_ws(' ', m.first_name, m.last_name) AS "managerName", e.employment_type AS "employmentType", e.status,
  to_char(e.hire_date, 'YYYY-MM-DD') AS "hireDate", to_char(e.last_day, 'YYYY-MM-DD') AS "lastDay", e.location, e.version`;
export const employeeFrom = `FROM employees e LEFT JOIN teams t ON e.team_id = t.id LEFT JOIN employees m ON e.manager_id = m.id`;
export const employeeOrder = `ORDER BY lower(e.last_name), lower(e.first_name), e.id`;
export const employeeWhere = `WHERE e.status = ANY($1::text[])
  AND ($2::uuid IS NULL OR e.team_id = $2)
  AND ($3 = '' OR strpos(lower(concat_ws(' ', e.first_name, e.last_name, e.email, e.title, t.name, e.location)), lower($3)) > 0)`;

export function employeeFilterValues(role: Role, filters: EmployeeFilters) {
  const statuses = role === "viewer" ? ["active"] : filters.status === "current" ? ["active", "onboarding", "offboarding"] : [filters.status];
  return [statuses, filters.teamId || null, filters.query];
}

export async function listEmployees(member: Member, filters: EmployeeFilters, size = 15) {
  const values = employeeFilterValues(member.role, filters);
  const counts = await pool().query<{ total: number }>(`SELECT count(*)::int AS total ${employeeFrom} ${employeeWhere}`, values);
  const total = counts.rows[0].total;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(filters.page, pages);
  const { rows } = await pool().query<Employee>(`SELECT ${employeeColumns} ${employeeFrom} ${employeeWhere} ${employeeOrder} LIMIT $4 OFFSET $5`, [...values, size, (page - 1) * size]);
  return { employees: rows, total, page, pages };
}

export async function employeeProfile(member: Member, id: string) {
  const { rows } = await pool().query<Employee>(
    `SELECT ${employeeColumns} ${employeeFrom} WHERE e.id = $1 AND ($2 = 'admin' OR e.status = 'active')`, [id, member.role],
  );
  if (!rows[0]) return null;
  const employee = rows[0];
  const [reports, managers, workflows] = await Promise.all([
    pool().query<{ id: string; name: string; title: string; status: EmployeeStatus }>(
      `SELECT id, concat_ws(' ', first_name, last_name) AS name, title, status
       FROM employees WHERE manager_id = $1 AND status <> 'archived' AND ($2 = 'admin' OR status = 'active')
       ORDER BY lower(last_name), lower(first_name), id`, [id, member.role],
    ),
    pool().query<{ id: string; name: string; status: EmployeeStatus }>(
      `WITH RECURSIVE chain AS (
         SELECT id, manager_id, first_name, last_name, status, ARRAY[id] AS path, 1 AS depth FROM employees WHERE id = $1
         UNION ALL
         SELECT m.id, m.manager_id, m.first_name, m.last_name, m.status, c.path || m.id, c.depth + 1
         FROM chain c JOIN employees m ON m.id = c.manager_id WHERE NOT (m.id = ANY(c.path))
       ) SELECT id, concat_ws(' ', first_name, last_name) AS name, status
       FROM chain WHERE depth > 1 AND ($2 = 'admin' OR status = 'active') ORDER BY depth DESC`, [id, member.role],
    ),
    member.role === "admin" ? pool().query<Workflow>(
      `SELECT id, kind, state, opened_at AS "openedAt", closed_at AS "closedAt" FROM employee_workflows
       WHERE employee_id = $1 ORDER BY opened_at DESC, id DESC`, [id],
    ) : Promise.resolve({ rows: [] as Workflow[] }),
  ]);
  const open = workflows.rows.find((workflow) => workflow.state === "open");
  const tasks = open ? (await pool().query<Task>(
    `SELECT t.id, t.title, t.completed_at AS "completedAt", u.name AS "completedBy"
     FROM workflow_tasks t LEFT JOIN "user" u ON u.id = t.completed_by WHERE t.workflow_id = $1 ORDER BY t.position`, [open.id],
  )).rows : [];
  return { employee, reports: reports.rows, managers: managers.rows, workflows: workflows.rows, open, tasks };
}

export async function listTeams(member: Member) {
  const { rows } = await pool().query<Team>(
    `SELECT t.id, t.name, t.version, count(e.id)::int AS people
     FROM teams t LEFT JOIN employees e ON e.team_id = t.id AND ($1 = 'admin' AND e.status <> 'archived' OR e.status = 'active')
     GROUP BY t.id ORDER BY lower(t.name), t.id`, [member.role],
  );
  return rows;
}

export async function listManagerOptions(employee?: Employee) {
  await requireAdmin();
  const { rows } = await pool().query<{ id: string; name: string; title: string }>(
    `SELECT id, concat_ws(' ', first_name, last_name) AS name, title FROM employees
     WHERE (status = 'active' OR id = $2::uuid) AND id IS DISTINCT FROM $1::uuid ORDER BY lower(last_name), lower(first_name), id`,
    [employee?.id ?? null, employee?.managerId ?? null],
  );
  return rows;
}

export async function readOverview(member: Member) {
  const [counts, tasks, starts, teams] = await Promise.all([
    pool().query<{ status: EmployeeStatus; count: number }>(
      `SELECT status, count(*)::int AS count FROM employees WHERE ($1 = 'admin' AND status <> 'archived') OR status = 'active' GROUP BY status`, [member.role],
    ),
    member.role === "admin" ? pool().query<{ total: number; completed: number }>(
      `SELECT count(*)::int AS total, count(t.completed_at)::int AS completed FROM workflow_tasks t
       JOIN employee_workflows w ON w.id = t.workflow_id WHERE w.state = 'open'`,
    ) : Promise.resolve({ rows: [{ total: 0, completed: 0 }] }),
    listEmployees(member, { query: "", status: "current", teamId: "", page: 1 }, 5),
    listTeams(member),
  ]);
  return { counts: counts.rows, tasks: tasks.rows[0], people: starts.employees, teams };
}

export async function listOpenWorkflows(page: number) {
  await requireAdmin();
  const size = 24;
  const { rows: [{ total }] } = await pool().query<{ total: number }>("SELECT count(*)::int AS total FROM employee_workflows WHERE state = 'open'");
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  const { rows } = await pool().query<OpenWorkflow>(
    `SELECT w.id, w.kind, w.state, w.opened_at AS "openedAt", w.closed_at AS "closedAt", e.id AS "employeeId",
     concat_ws(' ', e.first_name, e.last_name) AS "employeeName", e.title,
     to_char(CASE WHEN w.kind = 'onboarding' THEN e.hire_date ELSE e.last_day END, 'YYYY-MM-DD') AS "targetDate",
     count(t.completed_at)::int AS completed, count(t.id)::int AS total
     FROM employee_workflows w JOIN employees e ON e.id = w.employee_id JOIN workflow_tasks t ON t.workflow_id = w.id WHERE w.state = 'open'
     GROUP BY w.id, e.id ORDER BY "targetDate", lower(e.last_name), w.id LIMIT $1 OFFSET $2`, [size, (current - 1) * size],
  );
  return { workflows: rows, total, page: current, pages };
}

export const activityLabels = {
  "employee.created": "Added an employee", "employee.updated": "Updated an employee", "employee.exported": "Exported the directory",
  "team.created": "Created a team", "team.updated": "Renamed a team", "workflow.started": "Started a checklist",
  "workflow.completed": "Completed a checklist", "workflow.cancelled": "Cancelled a checklist", "task.completed": "Completed a task",
  "task.reopened": "Reopened a task", "account.created": "Created an account", "account.role_changed": "Changed workspace access",
  "account.password_reset": "Reset an account password",
} as const;
export type ActivityEvent = keyof typeof activityLabels;
export type Activity = { id: string; event: ActivityEvent; actor: string | null; subject: string; employeeId: string | null; detail: string; at: Date };

export function activityCursor(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n ? value : null;
}

export async function listActivity({ before = null, employeeId = null, size = 20 }: { before?: string | null; employeeId?: string | null; size?: number } = {}) {
  await requireAdmin();
  const { rows } = await pool().query<Activity>(
    `SELECT a.id::text, a.event, u.name AS actor, a.employee_id AS "employeeId",
     coalesce(e.first_name || ' ' || e.last_name, t.name, s.name, '') AS subject, a.detail, a.created_at AS at
     FROM activity_log a LEFT JOIN "user" u ON u.id = a.actor_id LEFT JOIN employees e ON e.id = a.employee_id
     LEFT JOIN teams t ON t.id = a.team_id LEFT JOIN "user" s ON s.id = a.subject_user_id
     WHERE ($1::bigint IS NULL OR a.id < $1) AND ($2::uuid IS NULL OR a.employee_id = $2)
     ORDER BY a.id DESC LIMIT $3`, [before, employeeId, size + 1],
  );
  const entries = rows.slice(0, size);
  return { entries, next: rows.length > size ? entries.at(-1)!.id : null };
}
