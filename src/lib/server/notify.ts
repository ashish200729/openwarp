import "server-only";
import type { PoolClient } from "pg";
import { pool } from "./db";
import type { Member } from "./member";

export type NoticeSource = { kind: string; id: string; revision?: number };
export type Notice = { title: string; body?: string; href: string; kind?: "request"; source?: NoticeSource };
export type Notification = { id: string; title: string; body: string; href: string; unread: boolean; at: Date };
type Audience = { employeeId: string } | { managerOf: string } | { role: "admin" } | { everyone: true };

// Notifications commit with the change they describe. The person who made the change is never notified of it.
export async function notify(client: PoolClient, actor: Member | null, audience: Audience, notice: Notice) {
  const [where, value] = "employeeId" in audience ? ["m.employee_id = $5::uuid", audience.employeeId]
    : "managerOf" in audience ? ["m.employee_id = (SELECT manager_id FROM employees WHERE id = $5::uuid)", audience.managerOf]
    : "role" in audience ? ["m.role = $5", audience.role] : ["$5::text IS NULL", null];
  await client.query(
    `INSERT INTO notifications (user_id, title, body, href, kind, source_kind, source_id, source_revision)
     SELECT m.user_id, $1, $2, $3, $6, $7, $8, $9 FROM workspace_members m
     WHERE m.role <> 'disabled' AND m.user_id <> $4 AND ${where}
     ON CONFLICT DO NOTHING`,
    [notice.title.slice(0, 160), (notice.body ?? "").slice(0, 500), notice.href, actor?.id ?? "", value, notice.kind ?? "update",
      notice.source?.kind ?? null, notice.source?.id ?? null, notice.source?.revision ?? null],
  );
}

// Retraction is deliberately a marker rather than a delete. Sent email and in-app history remain auditable,
// while notifications and queued email that refer to the old source stop reaching the user.
export async function retractSource(client: PoolClient, source: Pick<NoticeSource, "kind" | "id">, reason = "source changed") {
  const { rows } = await client.query<{ id: string }>(
    `UPDATE notifications SET retracted_at = coalesce(retracted_at, now()), emailed_at = coalesce(emailed_at, now())
     WHERE source_kind = $1 AND source_id = $2 AND retracted_at IS NULL RETURNING id::text AS id`, [source.kind, source.id],
  );
  if (!rows.length) return;
  await client.query(
    `UPDATE email_messages SET cancelled_at = coalesce(cancelled_at, now()), cancel_reason = $2, body = NULL
     WHERE notification_id = ANY($1::bigint[]) AND state = 'queued' AND cancelled_at IS NULL`, [rows.map((row) => row.id), reason.slice(0, 120)],
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
    `SELECT id::text, title, body, href, read_at IS NULL AS unread, created_at AS at FROM notifications
     WHERE user_id = $1 AND retracted_at IS NULL ORDER BY id DESC LIMIT $2`, [member.id, limit],
  );
  return rows;
}

export async function unreadNotifications(member: Member) {
  const { rows } = await pool().query<{ count: number }>("SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL AND retracted_at IS NULL", [member.id]);
  return rows[0].count;
}

export async function markNotificationsRead(member: Member) {
  await pool().query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [member.id]);
}
