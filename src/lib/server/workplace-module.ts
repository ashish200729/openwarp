import "server-only";
import type { PoolClient } from "pg";
import { deviceKindLabels } from "@/lib/domains/workplace";
import { formatDate } from "@/lib/people";
import { ownTasks } from "./checklists";
import { complianceTodos } from "./compliance";
import { pool, transaction } from "./db";
import { closeWorkplace, openDeviceRequests, ownDevices, pendingGrants, setUpWorkplace, upcomingRenewals, workplaceBlockers } from "./devices";
import type { Member } from "./member";
import type { Todo } from "./modules";
import { assignForNewHire, ownTraining } from "./training";

const due = (date: string | null, overdue: boolean) => date ? `${overdue ? "Overdue since" : "Due"} ${formatDate(date)}` : "No due date";

export async function todos(member: Member): Promise<Todo[]> {
  if (member.role === "admin") await sendReminders();
  const [devices, training, tasks, grants, requests, renewals, compliance] = await Promise.all([
    ownDevices(member), ownTraining(member), ownTasks(member), pendingGrants(member), openDeviceRequests(member), upcomingRenewals(member), complianceTodos(member),
  ]);
  return [
    ...devices.flatMap((device) => {
      const name = `${deviceKindLabels[device.kind].toLowerCase()} ${device.assetTag}`;
      const base = { href: "/workspace/devices", meta: "" };
      if (device.returnDueOn && !device.sentBackAt) return [{ ...base, key: `return-${device.assignmentId}`, title: `Return ${name}`, detail: `Due ${formatDate(device.returnDueOn)}` }];
      if (!device.receivedAt) return [{ ...base, key: `receive-${device.assignmentId}`, title: `Confirm you have ${name}`, detail: "Assigned to you" }];
      return device.attestDue ? [{ ...base, key: `attest-${device.assignmentId}`, title: `Check the security of ${name}`, detail: "Four questions" }] : [];
    }),
    ...training.filter((entry) => entry.state === "open" && !entry.upcoming).map((entry) => ({ key: `training-${entry.id}`, href: `/workspace/training/${entry.courseId}`, title: `Finish ${entry.title}`, detail: due(entry.dueOn, entry.overdue), meta: "Training" })),
    ...tasks.filter((task) => !task.completedAt).map((task) => ({ key: `task-${task.id}`, href: "/workspace/lifecycle/tasks", title: task.title, detail: `For ${task.employeeName}`, meta: task.dueOn ? formatDate(task.dueOn) : "" })),
    ...grants.map((grant) => ({ key: `grant-${grant.id}`, href: "/workspace/devices/apps", title: grant.state === "approved" ? `Set up ${grant.appName} for ${grant.employeeName}` : `${grant.employeeName} requested ${grant.appName}`, detail: grant.role, meta: "App access" })),
    ...requests.map((request) => ({ key: `device-${request.id}`, href: "/workspace/devices", title: `${request.employeeName} needs a ${deviceKindLabels[request.kind].toLowerCase()}`, detail: request.note || "Device request", meta: formatDate(request.createdAt) })),
    ...compliance.due.map((item) => ({ key: `obligation-${item.id}`, href: `/workspace/compliance/obligations/${item.id}`, title: item.name, detail: due(item.dueOn, item.overdue), meta: "Compliance" })),
    ...compliance.notices.map((notice) => ({ key: `notice-${notice.id}`, href: `/workspace/compliance/notices/${notice.id}`, title: notice.title, detail: notice.deadlineOn ? due(notice.deadlineOn, notice.overdue) : "No deadline", meta: "Notice" })),
    ...renewals.map((app) => ({ key: `renewal-${app.id}`, href: `/workspace/devices/apps/${app.id}`, title: `${app.name} renews`, detail: formatDate(app.renewsOn), meta: "Renewal" })),
  ];
}

export async function onOnboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {
  await setUpWorkplace(client, member, employeeId);
  await assignForNewHire(client, member, employeeId);
}

export async function onOffboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {
  await closeWorkplace(client, member, employeeId);
}

export async function archiveBlockers(client: PoolClient, employeeId: string): Promise<string[]> {
  return workplaceBlockers(client, employeeId);
}

// Runs at most once a day, when an administrator first opens the home page. A reminder that was sent is never repeated.
const reminders = `
  WITH due AS (
    SELECT 'training:' || a.id || CASE WHEN a.due_on < current_date THEN ':overdue' ELSE ':soon' END AS key, m.user_id, 'Finish your training: ' || c.title AS title,
      CASE WHEN a.due_on < current_date THEN 'Overdue since ' ELSE 'Due ' END || to_char(a.due_on, 'FMMon FMDD, YYYY') AS body, '/workspace/training/' || c.id AS href
      FROM training_assignments a JOIN courses c ON c.id = a.course_id AND c.published AND c.archived_at IS NULL JOIN employees e ON e.id = a.employee_id AND e.status <> 'archived'
      JOIN workspace_members m ON m.employee_id = a.employee_id AND m.role <> 'disabled' WHERE a.state = 'open' AND a.due_on <= current_date + 7
    UNION ALL
    SELECT 'obligation:' || c.id || CASE WHEN c.due_on < current_date THEN ':overdue' ELSE ':soon' END, m.user_id, CASE WHEN c.due_on < current_date THEN 'Overdue: ' ELSE 'Coming up: ' END || o.name, 'Due ' || to_char(c.due_on, 'FMMon FMDD, YYYY'), '/workspace/compliance/obligations/' || o.id
      FROM obligation_occurrences c JOIN obligations o ON o.id = c.obligation_id AND o.archived_at IS NULL JOIN workspace_members m ON m.role = 'admin' AND (o.owner_id IS NULL OR o.owner_id = m.user_id) WHERE c.state = 'open' AND c.due_on <= current_date + 14
    UNION ALL
    SELECT 'notice:' || n.id || CASE WHEN n.deadline_on < current_date THEN ':overdue' ELSE ':soon' END, m.user_id, 'Notice deadline: ' || n.title, to_char(n.deadline_on, 'FMMon FMDD, YYYY'), '/workspace/compliance/notices/' || n.id
      FROM compliance_notices n JOIN workspace_members m ON m.role = 'admin' AND (n.assignee_id IS NULL OR n.assignee_id = m.user_id) WHERE n.state IN ('received', 'in_progress') AND n.deadline_on <= current_date + 14
    UNION ALL
    SELECT 'renewal:' || p.id || ':' || p.renews_on, m.user_id, p.name || ' renews', to_char(p.renews_on, 'FMMon FMDD, YYYY'), '/workspace/devices/apps/' || p.id
      FROM apps p JOIN workspace_members m ON m.role = 'admin' WHERE p.archived_at IS NULL AND p.renews_on BETWEEN current_date AND current_date + 30
    UNION ALL
    SELECT 'task:' || t.id || ':overdue', t.assignee_id, 'Overdue task: ' || t.title, 'Due ' || to_char(t.due_on, 'FMMon FMDD, YYYY'), '/workspace/lifecycle/tasks'
      FROM workflow_tasks t JOIN employee_workflows w ON w.id = t.workflow_id AND w.state = 'open' WHERE t.assignee_id IS NOT NULL AND t.completed_at IS NULL AND t.due_on < current_date
  ), fresh AS (
    INSERT INTO workplace_reminders (key) SELECT DISTINCT key FROM due ON CONFLICT DO NOTHING RETURNING key
  ) INSERT INTO notifications (user_id, title, body, href) SELECT d.user_id, left(d.title, 160), d.body, d.href FROM due d JOIN fresh f ON f.key = d.key`;

export async function sendReminders() {
  try {
    const { rowCount: done } = await pool().query("SELECT 1 FROM workplace_reminders WHERE key = 'day:' || current_date");
    if (done) return;
    await transaction(async (client) => {
      const { rowCount } = await client.query("INSERT INTO workplace_reminders (key) VALUES ('day:' || current_date) ON CONFLICT DO NOTHING");
      if (rowCount) await client.query(reminders);
    });
  } catch (error) {
    console.error("OpenWarp could not send reminders", error instanceof Error ? error.name : "unknown");
  }
}
