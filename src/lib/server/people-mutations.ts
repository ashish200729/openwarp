import "server-only";
import type { PoolClient } from "pg";
import { statusLabels, type EmployeeFilters, type EmployeeInput, type EmployeeStatus, type WorkflowKind } from "@/lib/people";
import { employeeColumns, employeeFilterValues, employeeFrom, employeeOrder, employeeWhere, type Employee } from "./directory";
import type { Member } from "./member";
import { archiveBlockers, onOffboarding, onOnboarding } from "./modules";
import { audit, ensureCurrentTeam, PeopleError, runAsAdmin } from "./write";

export { PeopleError };

async function currentEmployee(client: PoolClient, id: string, version?: number) {
  const { rows } = await client.query<{ version: number; status: EmployeeStatus; managerId: string | null; hireDate: string; lastDay: string | null }>(
    `SELECT version, status, manager_id AS "managerId", to_char(hire_date, 'YYYY-MM-DD') AS "hireDate", to_char(last_day, 'YYYY-MM-DD') AS "lastDay"
     FROM employees WHERE id = $1`, [id],
  );
  const employee = rows[0];
  if (!employee) throw new PeopleError("This employee could not be found.");
  if (version !== undefined && employee.version !== version) throw new PeopleError("This profile changed while you were editing. Reload it and try again.");
  return employee;
}

async function ensureManager(client: PoolClient, managerId: string | null, employeeId: string | null = null) {
  if (!managerId) return;
  const { rows } = await client.query<{ status: EmployeeStatus; cycle: boolean }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, manager_id, status FROM employees WHERE id = $1
       UNION
       SELECT m.id, m.manager_id, m.status FROM ancestors a JOIN employees m ON a.manager_id = m.id
     ) SELECT status, EXISTS (SELECT 1 FROM ancestors WHERE id = $2) AS cycle FROM ancestors WHERE id = $1`,
    [managerId, employeeId],
  );
  if (!rows[0] || rows[0].status !== "active") throw new PeopleError("Choose an active manager.");
  if (rows[0].cycle) throw new PeopleError("This reporting line would create a loop. Choose a different manager.");
}

async function startWorkflow(client: PoolClient, member: Member, employeeId: string, kind: WorkflowKind) {
  const { rows: [workflow] } = await client.query<{ id: string }>("INSERT INTO employee_workflows (employee_id, kind) VALUES ($1, $2) RETURNING id", [employeeId, kind]);
  await client.query(
    "INSERT INTO workflow_tasks (workflow_id, title, position) SELECT $1, title, row_number() OVER (ORDER BY position, id) FROM checklist_templates WHERE kind = $2",
    [workflow.id, kind],
  );
  await audit(client, member, "workflow.started", { employeeId, detail: statusLabels[kind] });
  await (kind === "onboarding" ? onOnboarding : onOffboarding)(client, member, employeeId);
}

// Job history keeps names as text, so later renames don't rewrite what was true at the time.
async function recordJob(client: PoolClient, employeeId: string, changedOn: string | null = null) {
  await client.query(
    `INSERT INTO job_changes (employee_id, title, team_name, manager_name, employment_type, changed_on)
     SELECT e.id, e.title, coalesce(t.name, ''), concat_ws(' ', m.first_name, m.last_name), e.employment_type, coalesce($2::date, current_date)
     FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN employees m ON m.id = e.manager_id
     WHERE e.id = $1 AND NOT EXISTS (
       SELECT 1 FROM (SELECT * FROM job_changes WHERE employee_id = $1 ORDER BY id DESC LIMIT 1) last
       WHERE last.title = e.title AND last.team_name = coalesce(t.name, '') AND last.manager_name = concat_ws(' ', m.first_name, m.last_name) AND last.employment_type = e.employment_type
     )`, [employeeId, changedOn],
  );
}

export async function insertEmployee(client: PoolClient, member: Member, input: EmployeeInput & { initialStatus: "onboarding" | "active" }) {
  await ensureCurrentTeam(client, input.teamId);
  await ensureManager(client, input.managerId);
  const { rows: [employee] } = await client.query<{ id: string }>(
    `INSERT INTO employees (first_name, last_name, email, title, team_id, manager_id, employment_type, hire_date, location, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [...employeeValues(input), input.initialStatus],
  );
  await recordJob(client, employee.id, input.hireDate);
  await client.query(`UPDATE workspace_members m SET employee_id = $1 FROM "user" u WHERE u.id = m.user_id AND lower(u.email) = $2 AND m.employee_id IS NULL`, [employee.id, input.email]);
  await audit(client, member, "employee.created", { employeeId: employee.id, detail: statusLabels[input.initialStatus] });
  if (input.initialStatus === "onboarding") await startWorkflow(client, member, employee.id, "onboarding");
  return employee.id;
}

function employeeValues(input: EmployeeInput) {
  return [input.firstName, input.lastName, input.email, input.title, input.teamId, input.managerId, input.employmentType, input.hireDate, input.location];
}

export function createEmployee(member: Member, input: EmployeeInput & { initialStatus: "onboarding" | "active" }) {
  return runAsAdmin(member, (client) => insertEmployee(client, member, input));
}

export function updateEmployee(member: Member, input: EmployeeInput & { id: string; version: number; lastDay: string | null }) {
  return runAsAdmin(member, async (client) => {
    const employee = await currentEmployee(client, input.id, input.version);
    if (employee.status === "archived") throw new PeopleError("Archived profiles are read-only.");
    const lastDay = employee.status === "offboarding" ? input.lastDay : null;
    if (employee.status === "offboarding" && (!lastDay || lastDay < input.hireDate)) {
      throw new PeopleError("The last day must be on or after the start date.");
    }
    await ensureCurrentTeam(client, input.teamId);
    if (input.managerId !== employee.managerId) await ensureManager(client, input.managerId, input.id);
    await client.query(
      `UPDATE employees SET first_name = $1, last_name = $2, email = $3, title = $4, team_id = $5, manager_id = $6, employment_type = $7,
       hire_date = $8, location = $9, last_day = $10, version = version + 1, updated_at = now() WHERE id = $11`, [...employeeValues(input), lastDay, input.id],
    );
    await recordJob(client, input.id);
    await audit(client, member, "employee.updated", { employeeId: input.id });
  });
}

export function startOffboarding(member: Member, input: { id: string; version: number; lastDay: string }) {
  return runAsAdmin(member, async (client) => {
    const employee = await currentEmployee(client, input.id, input.version);
    if (employee.status !== "active") throw new PeopleError("Offboarding can only start for an active employee.");
    if (input.lastDay < employee.hireDate) throw new PeopleError("The last day must be on or after the start date.");
    await client.query("UPDATE employees SET status = 'offboarding', last_day = $2, version = version + 1, updated_at = now() WHERE id = $1", [input.id, input.lastDay]);
    await startWorkflow(client, member, input.id, "offboarding");
  });
}

async function requireOpenWorkflow(client: PoolClient, input: { id: string; workflowId: string }) {
  const { rows } = await client.query<{ kind: WorkflowKind }>(
    `SELECT w.kind FROM employee_workflows w JOIN employees e ON e.id = w.employee_id
     WHERE w.id = $1 AND w.employee_id = $2 AND w.state = 'open' AND w.kind = e.status`, [input.workflowId, input.id],
  );
  if (!rows[0]) throw new PeopleError("This checklist is no longer open.");
  return rows[0];
}

export function setTask(member: Member, input: { id: string; workflowId: string; taskId: string; completed: boolean }) {
  return runAsAdmin(member, async (client) => {
    await requireOpenWorkflow(client, input);
    const { rows } = await client.query<{ title: string }>(
      `UPDATE workflow_tasks SET completed_by = $3::text, completed_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END
       WHERE id = $1 AND workflow_id = $2 AND (completed_at IS NOT NULL) <> $4 RETURNING title`,
      [input.taskId, input.workflowId, input.completed ? member.id : null, input.completed],
    );
    if (rows[0]) {
      await audit(client, member, input.completed ? "task.completed" : "task.reopened", { employeeId: input.id, detail: rows[0].title });
    } else {
      const { rowCount } = await client.query("SELECT 1 FROM workflow_tasks WHERE id = $1 AND workflow_id = $2", [input.taskId, input.workflowId]);
      if (!rowCount) throw new PeopleError("This task could not be found. Reload the checklist and try again.");
    }
  });
}

async function revokeAccess(client: PoolClient, member: Member, employeeId: string) {
  const { rows } = await client.query<{ userId: string; role: string }>(`SELECT user_id AS "userId", role FROM workspace_members WHERE employee_id = $1 AND role <> 'disabled'`, [employeeId]);
  if (!rows[0]) return;
  const { userId, role } = rows[0];
  if (userId === member.id) throw new PeopleError("You can’t archive your own profile. Ask another administrator.");
  await client.query("UPDATE workspace_members SET role = 'disabled' WHERE user_id = $1", [userId]);
  await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
  await audit(client, member, "account.role_changed", { subjectUserId: userId, detail: `${role} to disabled` });
}

export function closeWorkflow(member: Member, input: { id: string; workflowId: string; operation: "complete" | "cancel" }) {
  return runAsAdmin(member, async (client) => {
    const { kind } = await requireOpenWorkflow(client, input);
    const complete = input.operation === "complete";
    if (complete) {
      const { rowCount } = await client.query("SELECT 1 FROM workflow_tasks WHERE workflow_id = $1 AND completed_at IS NULL LIMIT 1", [input.workflowId]);
      if (rowCount) throw new PeopleError("Complete every task before closing the checklist.");
    }
    const archive = complete ? kind === "offboarding" : kind === "onboarding";
    if (archive) {
      const { rowCount } = await client.query("SELECT 1 FROM employees WHERE manager_id = $1 AND status <> 'archived' LIMIT 1", [input.id]);
      if (rowCount) throw new PeopleError("Reassign this employee’s direct reports before archiving their profile.");
      const blockers = await archiveBlockers(client, input.id);
      if (blockers.length) throw new PeopleError(blockers.join(" "));
    }
    if (archive) await revokeAccess(client, member, input.id);
    await client.query("UPDATE employee_workflows SET state = $2, closed_at = now() WHERE id = $1", [input.workflowId, complete ? "completed" : "cancelled"]);
    await client.query(
      `UPDATE employees SET status = $2, last_day = CASE WHEN $2 = 'archived' THEN last_day ELSE NULL END,
       version = version + 1, updated_at = now() WHERE id = $1`, [input.id, archive ? "archived" : "active"],
    );
    await audit(client, member, complete ? "workflow.completed" : "workflow.cancelled", { employeeId: input.id, detail: statusLabels[kind] });
  });
}

export function rehireEmployee(member: Member, input: { id: string; version: number; hireDate: string }) {
  return runAsAdmin(member, async (client) => {
    const employee = await currentEmployee(client, input.id, input.version);
    if (employee.status !== "archived") throw new PeopleError("Only archived profiles can start a new onboarding checklist.");
    if (employee.lastDay && input.hireDate < employee.lastDay) throw new PeopleError("The new start date must be on or after the previous last day.");
    await client.query(
      `UPDATE employees SET status = 'onboarding', hire_date = $2, last_day = NULL, manager_id = NULL,
       team_id = (SELECT id FROM teams WHERE id = employees.team_id AND archived_at IS NULL),
       version = version + 1, updated_at = now() WHERE id = $1`, [input.id, input.hireDate],
    );
    await recordJob(client, input.id, input.hireDate);
    await startWorkflow(client, member, input.id, "onboarding");
  });
}

export function saveTeam(member: Member, name: string, existing?: { id: string; version: number }) {
  return runAsAdmin(member, async (client) => {
    const { rows } = existing ? await client.query<{ id: string; previous: string }>(
      `WITH previous AS (SELECT id, name FROM teams WHERE id = $2 AND version = $3 AND archived_at IS NULL)
       UPDATE teams t SET name = $1, version = version + 1 FROM previous WHERE t.id = previous.id RETURNING t.id, previous.name AS previous`, [name, existing.id, existing.version],
    ) : await client.query<{ id: string; previous: null }>("INSERT INTO teams (name) VALUES ($1) RETURNING id, NULL AS previous", [name]);
    if (!rows[0]) throw new PeopleError("This team changed while you were editing. Reload it and try again.");
    await audit(client, member, existing ? "team.updated" : "team.created", { teamId: rows[0].id, detail: rows[0].previous ? `${rows[0].previous} → ${name}` : name });
    return rows[0].id;
  });
}

export function archiveTeam(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rowCount: used } = await client.query("SELECT 1 FROM employees WHERE team_id = $1 AND status <> 'archived' LIMIT 1", [id]);
    if (used) throw new PeopleError("Move everyone out of this team before archiving it.");
    const { rows: references } = await client.query<{ area: string }>(
      `SELECT 'announcements' AS area WHERE EXISTS (SELECT 1 FROM announcements WHERE team_id=$1 AND removed_at IS NULL AND (expires_on IS NULL OR expires_on >= current_date))
       UNION ALL SELECT 'active routines' WHERE EXISTS (SELECT 1 FROM routines WHERE state='active' AND conditions->>'teamId'=$1::uuid::text)
       UNION ALL SELECT 'training assignment rules' WHERE EXISTS (SELECT 1 FROM course_rules r JOIN courses c ON c.id=r.course_id WHERE r.team_id=$1 AND c.archived_at IS NULL)
       UNION ALL SELECT 'app access defaults' WHERE EXISTS (SELECT 1 FROM app_defaults d JOIN apps a ON a.id=d.app_id WHERE d.team_id=$1 AND a.archived_at IS NULL)
       UNION ALL SELECT 'planned roles' WHERE EXISTS (SELECT 1 FROM planned_roles WHERE team_id=$1 AND status IN ('planned','open'))`, [id],
    );
    if (references.length) throw new PeopleError(`Before archiving this team, update its ${references.map(row => row.area).join(", ")}.`);
    const { rows } = await client.query<{ name: string }>("UPDATE teams SET archived_at = now(), version = version + 1 WHERE id = $1 AND archived_at IS NULL RETURNING name", [id]);
    if (!rows[0]) throw new PeopleError("This team is already archived.");
    await audit(client, member, "team.archived", { teamId: id });
  });
}

export function exportEmployees(member: Member, filters: EmployeeFilters) {
  const maxRows = 10_000;
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<Employee>(
      `SELECT ${employeeColumns} ${employeeFrom} ${employeeWhere} ${employeeOrder} LIMIT $4`,
      [...employeeFilterValues(member.role, filters), maxRows + 1],
    );
    if (rows.length > maxRows) throw new PeopleError("The export exceeds 10,000 records. Narrow your directory filters.");
    await audit(client, member, "employee.exported", { detail: `${rows.length} records` });
    return rows;
  });
}
