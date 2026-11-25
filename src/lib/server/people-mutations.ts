import "server-only";
import type { PoolClient } from "pg";
import { statusLabels, workflowTemplates, type EmployeeFilters, type EmployeeInput, type EmployeeStatus, type WorkflowKind } from "@/lib/people";
import { transaction } from "./db";
import { employeeColumns, employeeFilterValues, employeeFrom, employeeOrder, employeeWhere, type ActivityEvent, type Employee } from "./directory";
import type { Member } from "./member";

export class PeopleError extends Error {}

async function runAsAdmin<T>(member: Member, run: (client: PoolClient) => Promise<T>) {
  return transaction(async (client) => {
    // Serialize reporting-line changes and role grants with the same transaction lock.
    await client.query("SELECT pg_advisory_xact_lock(142050, 2)");
    const { rowCount } = await client.query("SELECT 1 FROM workspace_members WHERE user_id = $1 AND role = 'admin'", [member.id]);
    if (!rowCount) throw new PeopleError("Administrator access is required.");
    return run(client);
  });
}

async function audit(client: PoolClient, member: Member, event: ActivityEvent, options: { employeeId?: string; teamId?: string; detail?: string } = {}) {
  const { employeeId = null, teamId = null, detail = "" } = options;
  await client.query("INSERT INTO activity_log (actor_id, event, employee_id, team_id, detail) VALUES ($1, $2, $3, $4, $5)", [member.id, event, employeeId, teamId, detail]);
}

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
    "INSERT INTO workflow_tasks (workflow_id, title, position) SELECT $1, title, ordinal FROM unnest($2::text[]) WITH ORDINALITY AS task(title, ordinal)",
    [workflow.id, workflowTemplates[kind]],
  );
  await audit(client, member, "workflow.started", { employeeId, detail: statusLabels[kind] });
}

function employeeValues(input: EmployeeInput) {
  return [input.firstName, input.lastName, input.email, input.title, input.teamId, input.managerId, input.employmentType, input.hireDate, input.location];
}

export function createEmployee(member: Member, input: EmployeeInput & { initialStatus: "onboarding" | "active" }) {
  return runAsAdmin(member, async (client) => {
    await ensureManager(client, input.managerId);
    const { rows: [employee] } = await client.query<{ id: string }>(
      `INSERT INTO employees (first_name, last_name, email, title, team_id, manager_id, employment_type, hire_date, location, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [...employeeValues(input), input.initialStatus],
    );
    await audit(client, member, "employee.created", { employeeId: employee.id, detail: statusLabels[input.initialStatus] });
    if (input.initialStatus === "onboarding") await startWorkflow(client, member, employee.id, "onboarding");
    return employee.id;
  });
}

export function updateEmployee(member: Member, input: EmployeeInput & { id: string; version: number; lastDay: string | null }) {
  return runAsAdmin(member, async (client) => {
    const employee = await currentEmployee(client, input.id, input.version);
    if (employee.status === "archived") throw new PeopleError("Archived profiles are read-only.");
    const lastDay = employee.status === "offboarding" ? input.lastDay : null;
    if (employee.status === "offboarding" && (!lastDay || lastDay < input.hireDate)) {
      throw new PeopleError("The last day must be on or after the start date.");
    }
    if (input.managerId !== employee.managerId) await ensureManager(client, input.managerId, input.id);
    await client.query(
      `UPDATE employees SET first_name = $1, last_name = $2, email = $3, title = $4, team_id = $5, manager_id = $6, employment_type = $7,
       hire_date = $8, location = $9, last_day = $10, version = version + 1, updated_at = now() WHERE id = $11`, [...employeeValues(input), lastDay, input.id],
    );
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
    }
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
       version = version + 1, updated_at = now() WHERE id = $1`, [input.id, input.hireDate],
    );
    await startWorkflow(client, member, input.id, "onboarding");
  });
}

export function saveTeam(member: Member, name: string, existing?: { id: string; version: number }) {
  return runAsAdmin(member, async (client) => {
    const { rows } = existing ? await client.query<{ id: string }>(
      "UPDATE teams SET name = $1, version = version + 1 WHERE id = $2 AND version = $3 RETURNING id", [name, existing.id, existing.version],
    ) : await client.query<{ id: string }>("INSERT INTO teams (name) VALUES ($1) RETURNING id", [name]);
    if (!rows[0]) throw new PeopleError("This team changed while you were editing. Reload it and try again.");
    await audit(client, member, existing ? "team.updated" : "team.created", { teamId: rows[0].id });
    return rows[0].id;
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
