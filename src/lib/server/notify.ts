import "server-only";
import type { PoolClient } from "pg";
import { pool } from "./db";
import type { Member } from "./member";

export type Notice = { title: string; body?: string; href: string; kind?: "request" };
export type Notification = { id: string; title: string; body: string; href: string; unread: boolean; at: Date };
type Audience = { employeeId: string } | { managerOf: string } | { role: "admin" } | { everyone: true };

// Notifications commit with the change they describe. The person who made the change is never notified of it.
export async function notify(client: PoolClient, actor: Member | null, audience: Audience, notice: Notice) {
  const [where, value] = "employeeId" in audience ? ["m.employee_id = $5::uuid", audience.employeeId]
    : "managerOf" in audience ? ["m.employee_id = (SELECT manager_id FROM employees WHERE id = $5::uuid)", audience.managerOf]
    : "role" in audience ? ["m.role = $5", audience.role] : ["$5::text IS NULL", null];
  await client.query(
    `INSERT INTO notifications (user_id, title, body, href, kind) SELECT m.user_id, $1, $2, $3, $6 FROM workspace_members m WHERE m.role <> 'disabled' AND m.user_id <> $4 AND ${where}`,
    [notice.title.slice(0, 160), (notice.body ?? "").slice(0, 500), notice.href, actor?.id ?? "", value, notice.kind ?? "update"],
  );
}

// A request goes to the person's manager, or to administrators when no manager has an account.
export async function notifyDeciders(client: PoolClient, actor: Member, employeeId: string, notice: Notice) {
  const { rowCount } = await client.query(
    "SELECT 1 FROM workspace_members m JOIN employees e ON e.manager_id = m.employee_id JOIN employees manager ON manager.id = m.employee_id WHERE e.id = $1 AND manager.status = 'active' AND m.role <> 'disabled'", [employeeId],
  );
  await notify(client, actor, rowCount ? { managerOf: employeeId } : { role: "admin" }, { ...notice, kind: "request" });
}

export async function listNotifications(member: Member, limit = 40) {
  const { rows } = await pool().query<Notification>(
    `SELECT id::text, title, body, href, read_at IS NULL AS unread, created_at AS at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2`, [member.id, limit],
  );
  return rows;
}

export async function unreadNotifications(member: Member) {
  const { rows } = await pool().query<{ count: number }>("SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL", [member.id]);
  return rows[0].count;
}

export async function markNotificationsRead(member: Member) {
  await pool().query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [member.id]);
}
