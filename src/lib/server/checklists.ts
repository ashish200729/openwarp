import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type { addTaskFields, bulkTaskFields, ownTaskFields, planTaskFields } from "@/lib/domains/workplace";
import { formatDate, workflowKinds, type WorkflowKind } from "@/lib/people";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { notify } from "./notify";
import { audit, PeopleError, runAsAdmin, runAsMember } from "./write";

export type Progress = { done: number; total: number };
export type Checklist = {
  id: string; kind: WorkflowKind; employeeId: string; employeeName: string; firstName: string; title: string; targetDate: string; completed: number; total: number; overdue: number;
  devices: Progress; apps: Progress; training: Progress;
};
export type ChecklistTask = {
  id: string; title: string; dueOn: string | null; overdue: boolean; assigneeId: string | null; assignee: string | null; completedAt: Date | null; completedBy: string | null;
  workflowId: string; kind: WorkflowKind; employeeId: string; employeeName: string;
};
export type ChecklistFilters = { query: string; kind: WorkflowKind | ""; overdue: boolean; view: "people" | "tasks"; page: number };
export type AccountOption = { id: string; name: string };

export function checklistFilters(params: Record<string, string | string[] | undefined>): ChecklistFilters {
  return {
    query: typeof params.q === "string" ? params.q.trim().slice(0, 120) : "", kind: workflowKinds.find((kind) => kind === params.kind) ?? "", overdue: params.overdue === "1",
    view: params.view === "tasks" ? "tasks" : "people", page: typeof params.page === "string" && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1,
  };
}

const target = "CASE WHEN w.kind = 'onboarding' THEN e.hire_date ELSE e.last_day END";
const open = "w.state = 'open' AND w.kind = e.status";
const matches = `($1 = '' OR strpos(lower(concat_ws(' ', e.first_name, e.last_name, e.title, e.email)), lower($1)) > 0) AND ($2 = '' OR w.kind = $2)`;
const taskOverdue = "t.completed_at IS NULL AND coalesce(t.due_on < current_date, false)";

export async function listChecklists(filters: ChecklistFilters) {
  await requireAdmin();
  const size = 24;
  const late = `(EXISTS (SELECT 1 FROM workflow_tasks t WHERE t.workflow_id = w.id AND t.completed_at IS NULL AND (t.due_on < current_date OR ${target} < current_date)))`;
  const where = `WHERE ${open} AND ${matches} AND (NOT $3 OR ${late})`;
  const values = [filters.query, filters.kind, filters.overdue];
  const { rows: [{ total }] } = await pool().query<{ total: number }>(`SELECT count(*)::int AS total FROM employee_workflows w JOIN employees e ON e.id = w.employee_id ${where}`, values);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(filters.page, pages);
  const { rows } = await pool().query<Omit<Checklist, "devices" | "apps" | "training"> & { deviceDone: number; deviceTotal: number; appDone: number; appTotal: number; trainingDone: number; trainingTotal: number }>(
    `SELECT w.id, w.kind, e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", e.first_name AS "firstName", e.title, to_char(${target}, 'YYYY-MM-DD') AS "targetDate",
     c.completed, c.total, c.overdue, c."deviceDone", c."deviceTotal", c."appDone", c."appTotal", tr."trainingDone", tr."trainingTotal"
     FROM employee_workflows w JOIN employees e ON e.id = w.employee_id
     CROSS JOIN LATERAL (SELECT count(t.completed_at)::int AS completed, count(*)::int AS total, count(*) FILTER (WHERE ${taskOverdue})::int AS overdue,
       count(t.completed_at) FILTER (WHERE t.area = 'device')::int AS "deviceDone", count(*) FILTER (WHERE t.area = 'device')::int AS "deviceTotal",
       count(t.completed_at) FILTER (WHERE t.area = 'app')::int AS "appDone", count(*) FILTER (WHERE t.area = 'app')::int AS "appTotal" FROM workflow_tasks t WHERE t.workflow_id = w.id) c
     CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE a.state = 'completed')::int AS "trainingDone", count(*)::int AS "trainingTotal"
       FROM training_assignments a WHERE a.employee_id = e.id AND a.state <> 'cancelled' AND a.created_at >= w.opened_at) tr
     ${where} ORDER BY ${target}, lower(e.last_name), w.id LIMIT $4 OFFSET $5`, [...values, size, (page - 1) * size],
  );
  const checklists: Checklist[] = rows.map(({ deviceDone, deviceTotal, appDone, appTotal, trainingDone, trainingTotal, ...row }) => ({
    ...row, devices: { done: deviceDone, total: deviceTotal }, apps: { done: appDone, total: appTotal }, training: { done: trainingDone, total: trainingTotal },
  }));
  return { checklists, total, page, pages };
}

const taskColumns = `t.id, t.title, to_char(t.due_on, 'YYYY-MM-DD') AS "dueOn", ${taskOverdue} AS overdue, t.assignee_id AS "assigneeId", a.name AS assignee,
  t.completed_at AS "completedAt", c.name AS "completedBy", w.id AS "workflowId", w.kind, e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName"`;
const taskFrom = `FROM workflow_tasks t JOIN employee_workflows w ON w.id = t.workflow_id JOIN employees e ON e.id = w.employee_id
  LEFT JOIN "user" a ON a.id = t.assignee_id LEFT JOIN "user" c ON c.id = t.completed_by`;

export async function listOpenTasks(filters: ChecklistFilters) {
  await requireAdmin();
  const { rows } = await pool().query<ChecklistTask>(
    `SELECT ${taskColumns} ${taskFrom} WHERE ${open} AND t.completed_at IS NULL AND ${matches} AND (NOT $3 OR t.due_on < current_date OR ${target} < current_date)
     ORDER BY t.due_on NULLS LAST, lower(e.last_name), e.id, t.position LIMIT 200`, [filters.query, filters.kind, filters.overdue],
  );
  return rows;
}

export async function readChecklist(id: string) {
  await requireAdmin();
  const { rows: [checklist] } = await pool().query<{ id: string; kind: WorkflowKind; employeeId: string; employeeName: string; targetDate: string }>(
    `SELECT w.id, w.kind, e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", to_char(${target}, 'YYYY-MM-DD') AS "targetDate"
     FROM employee_workflows w JOIN employees e ON e.id = w.employee_id WHERE w.id = $1 AND ${open}`, [id],
  );
  if (!checklist) return null;
  const { rows: tasks } = await pool().query<ChecklistTask>(`SELECT ${taskColumns} ${taskFrom} WHERE w.id = $1 ORDER BY t.position`, [id]);
  return { checklist, tasks };
}

export async function listAccounts() {
  await requireAdmin();
  const { rows } = await pool().query<AccountOption>(`SELECT u.id, u.name FROM workspace_members m JOIN "user" u ON u.id = m.user_id WHERE m.role <> 'disabled' ORDER BY lower(u.name), u.id LIMIT 1000`);
  return rows;
}

export async function ownTasks(member: Member) {
  const { rows } = await pool().query<ChecklistTask>(
    `SELECT ${taskColumns} ${taskFrom} WHERE t.assignee_id = $1 AND ${open} ORDER BY t.completed_at IS NOT NULL, t.due_on NULLS LAST, t.position LIMIT 100`, [member.id],
  );
  return rows;
}

async function requireAccount(client: PoolClient, id: string | null) {
  if (!id) return;
  const { rowCount } = await client.query("SELECT 1 FROM workspace_members WHERE user_id = $1 AND role <> 'disabled'", [id]);
  if (!rowCount) throw new PeopleError("Choose an account that can still sign in.");
}

async function notifyAccount(client: PoolClient, actor: Member, userId: string, title: string, body: string) {
  if (userId === actor.id) return;
  await client.query("INSERT INTO notifications (user_id, title, body, href) VALUES ($1, $2, $3, '/workspace/lifecycle/tasks')", [userId, title.slice(0, 160), body.slice(0, 500)]);
}

async function openTask(client: PoolClient, taskId: string) {
  const { rows: [task] } = await client.query<{ title: string; employeeId: string; employeeName: string; assigneeId: string | null; completed: boolean }>(
    `SELECT t.title, e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", t.assignee_id AS "assigneeId", t.completed_at IS NOT NULL AS completed
     FROM workflow_tasks t JOIN employee_workflows w ON w.id = t.workflow_id JOIN employees e ON e.id = w.employee_id WHERE t.id = $1 AND ${open}`, [taskId],
  );
  if (!task) throw new PeopleError("This task’s checklist is no longer open. Reload the page.");
  return task;
}

async function planTask(client: PoolClient, member: Member, taskId: string, plan: { dueOn?: string | null; assigneeId?: string | null }) {
  const task = await openTask(client, taskId);
  if (plan.dueOn !== undefined) await client.query("UPDATE workflow_tasks SET due_on = $2 WHERE id = $1", [taskId, plan.dueOn]);
  if (plan.assigneeId !== undefined && plan.assigneeId !== task.assigneeId) {
    await requireAccount(client, plan.assigneeId);
    await client.query("UPDATE workflow_tasks SET assignee_id = $2 WHERE id = $1", [taskId, plan.assigneeId]);
    if (plan.assigneeId) await notifyAccount(client, member, plan.assigneeId, `You have a task: ${task.title}`, `For ${task.employeeName}${plan.dueOn ? `, due ${formatDate(plan.dueOn)}` : ""}`);
  }
  await audit(client, member, "task.planned", { employeeId: task.employeeId, detail: task.title });
}

async function completeTask(client: PoolClient, member: Member, taskId: string, completed: boolean) {
  const task = await openTask(client, taskId);
  if (task.completed === completed) return;
  await client.query("UPDATE workflow_tasks SET completed_by = $2::text, completed_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END WHERE id = $1", [taskId, completed ? member.id : null]);
  await audit(client, member, completed ? "task.completed" : "task.reopened", { employeeId: task.employeeId, detail: task.title });
}

export function addTask(member: Member, input: z.infer<typeof addTaskFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows: [workflow] } = await client.query<{ employeeId: string; employeeName: string }>(
      `SELECT e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName" FROM employee_workflows w JOIN employees e ON e.id = w.employee_id WHERE w.id = $1 AND ${open}`, [input.workflowId],
    );
    if (!workflow) throw new PeopleError("This checklist is no longer open.");
    await requireAccount(client, input.assigneeId);
    await client.query(
      "INSERT INTO workflow_tasks (workflow_id, title, position, due_on, assignee_id) SELECT $1, $2, coalesce(max(position), 0) + 1, $3, $4 FROM workflow_tasks WHERE workflow_id = $1",
      [input.workflowId, input.title, input.dueOn, input.assigneeId],
    );
    await audit(client, member, "task.added", { employeeId: workflow.employeeId, detail: input.title });
    if (input.assigneeId) await notifyAccount(client, member, input.assigneeId, `You have a task: ${input.title}`, `For ${workflow.employeeName}`);
  });
}

export function planChecklistTask(member: Member, input: z.infer<typeof planTaskFields>) {
  return runAsAdmin(member, (client) => planTask(client, member, input.taskId, input));
}

export function bulkTasks(member: Member, input: z.infer<typeof bulkTaskFields>) {
  return runAsAdmin(member, async (client) => {
    if (!input.taskIds.length) throw new PeopleError("Choose at least one task.");
    for (const taskId of input.taskIds) {
      if (input.operation === "complete") await completeTask(client, member, taskId, true);
      else await planTask(client, member, taskId, input.operation === "due" ? { dueOn: input.dueOn } : { assigneeId: input.assigneeId });
    }
    return input.taskIds.length;
  });
}

// An assignee completes only the task that was given to them.
export function setOwnTask(member: Member, input: z.infer<typeof ownTaskFields>) {
  return runAsMember(member, async (client) => {
    const task = await openTask(client, input.taskId);
    if (task.assigneeId !== member.id) throw new PeopleError("This task is assigned to someone else.");
    await completeTask(client, member, input.taskId, input.completed);
    if (input.completed) await notify(client, member, { role: "admin" }, { title: `${member.name} completed a task`, body: `${task.title}, for ${task.employeeName}`, href: `/workspace/people/${task.employeeId}#checklist` });
  });
}

type Link = { area: "device" | "app"; grantId?: string; deviceId?: string };

export async function addLinkedTask(client: PoolClient, employeeId: string, title: string, link: Link, dueOn: string | null = null) {
  await client.query(
    `INSERT INTO workflow_tasks (workflow_id, title, position, due_on, area, grant_id, device_id)
     SELECT w.id, $2, (SELECT coalesce(max(position), 0) + 1 FROM workflow_tasks WHERE workflow_id = w.id), $3, $4, $5, $6 FROM employee_workflows w WHERE w.employee_id = $1 AND w.state = 'open'`,
    [employeeId, title.slice(0, 180), dueOn, link.area, link.grantId ?? null, link.deviceId ?? null],
  );
}

// Recording the work also ticks off the checklist task that asked for it.
export async function finishLinkedTasks(client: PoolClient, member: Member, employeeId: string, link: Link) {
  const { rows } = await client.query<{ title: string }>(
    `UPDATE workflow_tasks t SET completed_at = now(), completed_by = $2 FROM employee_workflows w WHERE w.id = t.workflow_id AND w.employee_id = $1 AND w.state = 'open' AND t.completed_at IS NULL
     AND t.area = $3 AND t.grant_id IS NOT DISTINCT FROM $4::uuid AND t.device_id IS NOT DISTINCT FROM $5::uuid RETURNING t.title`,
    [employeeId, member.id, link.area, link.grantId ?? null, link.deviceId ?? null],
  );
  for (const { title } of rows) await audit(client, member, "task.completed", { employeeId, detail: title });
}
