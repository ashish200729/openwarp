import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { addMonths, recurrenceMonths, type jurisdictionFields, type noticeEventFields, type noticeFields, type NoticeState, type ObligationCategory, type obligationFields, type occurrenceFields, type Recurrence } from "@/lib/domains/workplace";
import { today } from "@/lib/operations";
import { seal, unseal } from "./crypto";
import { pool } from "./db";
import { insertDocument, type Upload } from "./documents";
import { requireAdmin, type Member } from "./member";
import { audit, PeopleError, runAsAdmin } from "./write";

export type Obligation = {
  id: string; name: string; authority: string; jurisdiction: string; category: ObligationCategory; hasReference: boolean; ownerId: string | null; owner: string | null; recurrence: Recurrence; notes: string; version: number;
  occurrenceId: string | null; dueOn: string | null; overdue: boolean;
};
export type Occurrence = { id: string; dueOn: string; state: "open" | "completed" | "skipped"; note: string; documentId: string | null; documentName: string | null; fileId: string | null; closedOn: string | null; closedBy: string | null };
export type DueItem = { id: string; obligationId: string; name: string; authority: string; jurisdiction: string; category: ObligationCategory; owner: string | null; recurrence: Recurrence; dueOn: string; overdue: boolean };
export type NoticeRow = { id: string; title: string; authority: string; receivedOn: string; deadlineOn: string | null; assigneeId: string | null; assignee: string | null; obligationId: string | null; obligation: string | null; state: NoticeState; overdue: boolean; files: number; version: number };
export type NoticeEvent = { id: string; state: NoticeState; note: string; actor: string; at: Date };
export type ComplianceFile = { id: string; name: string; sizeBytes: number; createdAt: Date };
export type Jurisdiction = { location: string; people: number; jurisdiction: string; mapped: boolean; obligations: number };
export type EmployeeDate = { id: string; name: string; label: string; on: string; href: string };

// Exports read on the connection that already holds the write lock.
type Queryable = Pick<PoolClient, "query">;

const obligationColumns = `o.id, o.name, o.authority, o.jurisdiction, o.category, o.reference_sealed IS NOT NULL AS "hasReference", o.owner_id AS "ownerId", u.name AS owner, o.recurrence, o.notes, o.version,
  c.id AS "occurrenceId", to_char(c.due_on, 'YYYY-MM-DD') AS "dueOn", coalesce(c.due_on < current_date, false) AS overdue
  FROM obligations o LEFT JOIN "user" u ON u.id = o.owner_id LEFT JOIN obligation_occurrences c ON c.obligation_id = o.id AND c.state = 'open'`;

export async function listObligations() {
  await requireAdmin();
  const { rows } = await pool().query<Obligation>(`SELECT ${obligationColumns} WHERE o.archived_at IS NULL ORDER BY c.due_on NULLS LAST, lower(o.name), o.id LIMIT 500`);
  return rows;
}

async function selectDueItems(db: Queryable) {
  const { rows } = await db.query<DueItem>(
    `SELECT c.id, o.id AS "obligationId", o.name, o.authority, o.jurisdiction, o.category, u.name AS owner, o.recurrence, to_char(c.due_on, 'YYYY-MM-DD') AS "dueOn", c.due_on < current_date AS overdue
     FROM obligation_occurrences c JOIN obligations o ON o.id = c.obligation_id LEFT JOIN "user" u ON u.id = o.owner_id WHERE c.state = 'open' AND o.archived_at IS NULL ORDER BY c.due_on, lower(o.name), o.id LIMIT 500`,
  );
  return rows;
}

export async function dueItems() {
  await requireAdmin();
  return selectDueItems(pool());
}

export async function readObligation(id: string) {
  await requireAdmin();
  const { rows: [obligation] } = await pool().query<Obligation>(`SELECT ${obligationColumns} WHERE o.id = $1 AND o.archived_at IS NULL`, [id]);
  if (!obligation) return null;
  const { rows: occurrences } = await pool().query<Occurrence>(
    `SELECT c.id, to_char(c.due_on, 'YYYY-MM-DD') AS "dueOn", c.state, c.note, c.document_id AS "documentId", d.name AS "documentName", c.file_id AS "fileId", to_char(c.closed_on, 'YYYY-MM-DD') AS "closedOn", u.name AS "closedBy"
     FROM obligation_occurrences c LEFT JOIN documents d ON d.id = c.document_id LEFT JOIN "user" u ON u.id = c.closed_by WHERE c.obligation_id = $1 AND c.state <> 'open' ORDER BY c.due_on DESC, c.created_at DESC LIMIT 60`, [id],
  );
  return { obligation, occurrences };
}

export function readReference(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [row] } = await client.query<{ name: string; sealed: Buffer | null }>("SELECT name, reference_sealed AS sealed FROM obligations WHERE id = $1 AND archived_at IS NULL", [id]);
    if (!row?.sealed) throw new PeopleError("No reference number is recorded.");
    await audit(client, member, "obligation.reference_viewed", { detail: row.name });
    return unseal(row.sealed, `obligation:${id}`);
  });
}

export async function listAdmins() {
  await requireAdmin();
  const { rows } = await pool().query<{ id: string; name: string }>(`SELECT u.id, u.name FROM workspace_members m JOIN "user" u ON u.id = m.user_id WHERE m.role = 'admin' ORDER BY lower(u.name), u.id LIMIT 200`);
  return rows;
}

async function requireAdminAccount(client: PoolClient, id: string | null, message: string) {
  if (!id) return;
  const { rowCount } = await client.query("SELECT 1 FROM workspace_members WHERE user_id = $1 AND role = 'admin'", [id]);
  if (!rowCount) throw new PeopleError(message);
}

const anchorDay = (date: string) => Number(date.slice(8, 10));

// An empty reference keeps the one already stored, because the form never shows it.
export function saveObligation(member: Member, input: z.infer<typeof obligationFields>) {
  return runAsAdmin(member, async (client) => {
    await requireAdminAccount(client, input.ownerId, "Choose an administrator as the owner.");
    const id = input.id || randomUUID();
    const sealed = input.reference ? seal(input.reference, `obligation:${id}`) : null;
    if (!input.id) {
      await client.query("INSERT INTO obligations (id, name, authority, jurisdiction, category, reference_sealed, owner_id, recurrence, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [id, input.name, input.authority, input.jurisdiction, input.category, sealed, input.ownerId, input.recurrence, input.notes]);
      await client.query("INSERT INTO obligation_occurrences (obligation_id, due_on, anchor_day) VALUES ($1, $2, $3)", [id, input.dueOn, anchorDay(input.dueOn)]);
    } else {
      const { rowCount } = await client.query(
        `UPDATE obligations SET name = $2, authority = $3, jurisdiction = $4, category = $5, reference_sealed = coalesce($6, reference_sealed), owner_id = $7, recurrence = $8, notes = $9, version = version + 1 WHERE id = $1 AND version = $10 AND archived_at IS NULL`,
        [id, input.name, input.authority, input.jurisdiction, input.category, sealed, input.ownerId, input.recurrence, input.notes, input.version],
      );
      if (!rowCount) throw new PeopleError("This obligation changed while you were editing. Reload it and try again.");
      const { rowCount: moved } = await client.query(
        "UPDATE obligation_occurrences SET anchor_day = CASE WHEN due_on = $2::date THEN anchor_day ELSE $3::smallint END, due_on = $2::date WHERE obligation_id = $1 AND state = 'open'", [id, input.dueOn, anchorDay(input.dueOn)],
      );
      if (!moved) await client.query("INSERT INTO obligation_occurrences (obligation_id, due_on, anchor_day) VALUES ($1, $2, $3)", [id, input.dueOn, anchorDay(input.dueOn)]);
    }
    await audit(client, member, input.id ? "obligation.updated" : "obligation.added", { detail: input.name });
    return id;
  });
}

export function archiveObligation(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [row] } = await client.query<{ name: string }>("UPDATE obligations SET archived_at = now(), version = version + 1 WHERE id = $1 AND archived_at IS NULL RETURNING name", [id]);
    if (!row) throw new PeopleError("This obligation is already archived.");
    await audit(client, member, "obligation.archived", { detail: row.name });
  });
}

async function insertFile(client: PoolClient, member: Member, name: string, noticeId: string | null, upload: Upload) {
  const { rows } = await client.query<{ id: string }>("INSERT INTO compliance_files (notice_id, name, media_type, size_bytes, content, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [noticeId, name, upload.mediaType, upload.content.byteLength, upload.content, member.id]);
  return rows[0].id;
}

// Company documents are readable by everyone, so evidence stays with administrators unless the administrator chooses otherwise.
export function closeOccurrence(member: Member, input: z.infer<typeof occurrenceFields>, upload: Upload | null) {
  return runAsAdmin(member, async (client) => {
    const { rows: [row] } = await client.query<{ obligationId: string; name: string; category: ObligationCategory; recurrence: Recurrence; dueOn: string; anchor: number }>(
      `SELECT o.id AS "obligationId", o.name, o.category, o.recurrence, to_char(c.due_on, 'YYYY-MM-DD') AS "dueOn", c.anchor_day AS anchor
       FROM obligation_occurrences c JOIN obligations o ON o.id = c.obligation_id WHERE c.id = $1 AND c.state = 'open' AND o.archived_at IS NULL`, [input.id],
    );
    if (!row) throw new PeopleError("This date is already closed. Reload the page.");
    if (input.closedOn > today()) throw new PeopleError("The date can’t be in the future.");
    if (upload && input.documentId) throw new PeopleError("Link a company document or upload a file, not both.");
    if (input.documentId) {
      const { rowCount } = await client.query("SELECT 1 FROM documents WHERE id = $1 AND employee_id IS NULL AND archived_at IS NULL AND category <> 'receipt'", [input.documentId]);
      if (!rowCount) throw new PeopleError("Choose a company document.");
    }
    const name = `${row.name.slice(0, 100)}, ${row.dueOn}`;
    const everyone = upload && input.visibility === "everyone";
    const documentId = everyone ? await insertDocument(client, member, { name, category: row.category === "policy_review" || row.category === "posting" ? "policy" : "tax", employeeId: null }, upload) : input.documentId;
    if (everyone) await audit(client, member, "document.added", { detail: name });
    const fileId = upload && !everyone ? await insertFile(client, member, name, null, upload) : null;
    await client.query("UPDATE obligation_occurrences SET state = $2, note = $3, document_id = $4, file_id = $5, closed_on = $6, closed_by = $7 WHERE id = $1", [input.id, input.operation, input.note, documentId, fileId, input.closedOn, member.id]);
    const months = recurrenceMonths[row.recurrence];
    if (months) await client.query("INSERT INTO obligation_occurrences (obligation_id, due_on, anchor_day) VALUES ($1, $2, $3)", [row.obligationId, addMonths(row.dueOn, months, row.anchor), row.anchor]);
    await audit(client, member, `obligation.${input.operation}`, { detail: `${row.name}, due ${row.dueOn}` });
  });
}

const noticeColumns = `n.id, n.title, n.authority, to_char(n.received_on, 'YYYY-MM-DD') AS "receivedOn", to_char(n.deadline_on, 'YYYY-MM-DD') AS "deadlineOn", n.assignee_id AS "assigneeId", u.name AS assignee, n.obligation_id AS "obligationId", o.name AS obligation,
  n.state, n.state IN ('received', 'in_progress') AND coalesce(n.deadline_on < current_date, false) AS overdue, (SELECT count(*)::int FROM compliance_files f WHERE f.notice_id = n.id) AS files, n.version
  FROM compliance_notices n LEFT JOIN "user" u ON u.id = n.assignee_id LEFT JOIN obligations o ON o.id = n.obligation_id`;

async function selectNotices(db: Queryable, closed: boolean) {
  const { rows } = await db.query<NoticeRow>(`SELECT ${noticeColumns} WHERE (n.state = 'closed') = $1 ORDER BY n.deadline_on NULLS LAST, n.received_on DESC, n.id LIMIT 300`, [closed]);
  return rows;
}

export async function listNotices(closed: boolean) {
  await requireAdmin();
  return selectNotices(pool(), closed);
}

export async function readNotice(id: string) {
  await requireAdmin();
  const { rows: [notice] } = await pool().query<NoticeRow>(`SELECT ${noticeColumns} WHERE n.id = $1`, [id]);
  if (!notice) return null;
  const [events, files] = await Promise.all([
    pool().query<NoticeEvent>(`SELECT v.id::text, v.state, v.note, u.name AS actor, v.created_at AS at FROM notice_events v JOIN "user" u ON u.id = v.actor_id WHERE v.notice_id = $1 ORDER BY v.id DESC LIMIT 100`, [id]),
    pool().query<ComplianceFile>(`SELECT id, name, size_bytes AS "sizeBytes", created_at AS "createdAt" FROM compliance_files WHERE notice_id = $1 ORDER BY created_at, id`, [id]),
  ]);
  return { notice, events: events.rows, files: files.rows };
}

async function notifyAssignee(client: PoolClient, member: Member, userId: string | null, title: string, id: string) {
  if (!userId || userId === member.id) return;
  await client.query("INSERT INTO notifications (user_id, title, href) VALUES ($1, $2, $3)", [userId, `Compliance notice: ${title}`.slice(0, 160), `/workspace/compliance/notices/${id}`]);
}

export function saveNotice(member: Member, input: z.infer<typeof noticeFields>, upload: Upload | null) {
  return runAsAdmin(member, async (client) => {
    await requireAdminAccount(client, input.assigneeId, "Assign the notice to an administrator.");
    if (input.receivedOn > today()) throw new PeopleError("The date received can’t be in the future.");
    const values = [input.title, input.authority, input.receivedOn, input.deadlineOn, input.assigneeId, input.obligationId];
    let id = input.id;
    let before: string | null = null;
    if (id) {
      const { rows: [current] } = await client.query<{ assigneeId: string | null; version: number }>(`SELECT assignee_id AS "assigneeId", version FROM compliance_notices WHERE id = $1`, [id]);
      if (!current || current.version !== input.version) throw new PeopleError("This notice changed while you were editing. Reload it and try again.");
      before = current.assigneeId;
      await client.query("UPDATE compliance_notices SET title = $1, authority = $2, received_on = $3, deadline_on = $4, assignee_id = $5, obligation_id = $6, version = version + 1 WHERE id = $7", [...values, id]);
    } else {
      const { rows } = await client.query<{ id: string }>("INSERT INTO compliance_notices (title, authority, received_on, deadline_on, assignee_id, obligation_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", values);
      id = rows[0].id;
      await client.query("INSERT INTO notice_events (notice_id, state, actor_id) VALUES ($1, 'received', $2)", [id, member.id]);
      if (upload) await insertFile(client, member, input.title.slice(0, 120), id, upload);
    }
    if (input.assigneeId !== before) await notifyAssignee(client, member, input.assigneeId, input.title, id);
    await audit(client, member, input.id ? "notice.updated" : "notice.recorded", { detail: input.title });
    return id;
  });
}

export function moveNotice(member: Member, input: z.infer<typeof noticeEventFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows: [notice] } = await client.query<{ title: string; state: NoticeState; assigneeId: string | null }>(
      `SELECT title, state, assignee_id AS "assigneeId" FROM compliance_notices WHERE id = $1 AND version = $2`, [input.id, input.version],
    );
    if (!notice) throw new PeopleError("This notice changed while you were editing. Reload it and try again.");
    if (notice.state === input.state && !input.note) throw new PeopleError("Choose a new status or write a note.");
    await client.query("UPDATE compliance_notices SET state = $2, version = version + 1 WHERE id = $1", [input.id, input.state]);
    await client.query("INSERT INTO notice_events (notice_id, state, note, actor_id) VALUES ($1, $2, $3, $4)", [input.id, input.state, input.note, member.id]);
    await audit(client, member, "notice.updated", { detail: notice.title });
    if (notice.state !== input.state) await notifyAssignee(client, member, notice.assigneeId, notice.title, input.id);
  });
}

export function addNoticeFile(member: Member, input: { id: string; name: string }, upload: Upload) {
  return runAsAdmin(member, async (client) => {
    const { rows: [notice] } = await client.query<{ title: string }>("SELECT title FROM compliance_notices WHERE id = $1", [input.id]);
    if (!notice) throw new PeopleError("This notice could not be found.");
    await insertFile(client, member, input.name, input.id, upload);
    await audit(client, member, "notice.updated", { detail: notice.title });
  });
}

export function readComplianceFile(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [file] } = await client.query<{ name: string; mediaType: string; content: Buffer }>(`SELECT name, media_type AS "mediaType", content FROM compliance_files WHERE id = $1`, [id]);
    if (file) await audit(client, member, "notice.file_opened", { detail: file.name });
    return file ?? null;
  });
}

// Each location stands for itself until an administrator says which jurisdiction it belongs to.
export async function listJurisdictions() {
  await requireAdmin();
  const { rows } = await pool().query<Jurisdiction>(
    `SELECT l.location, l.people, coalesce(j.jurisdiction, l.location) AS jurisdiction, j.jurisdiction IS NOT NULL AS mapped,
     (SELECT count(*)::int FROM obligations o WHERE o.archived_at IS NULL AND lower(trim(o.jurisdiction)) = lower(trim(coalesce(j.jurisdiction, l.location)))) AS obligations
     FROM (SELECT min(trim(location)) AS location, count(*)::int AS people FROM employees WHERE status <> 'archived' AND trim(location) <> '' GROUP BY lower(trim(location))) l
     LEFT JOIN location_jurisdictions j ON j.location = lower(l.location) ORDER BY l.people DESC, lower(l.location) LIMIT 300`,
  );
  return rows;
}

export function mapJurisdiction(member: Member, input: z.infer<typeof jurisdictionFields>) {
  return runAsAdmin(member, async (client) => {
    if (input.jurisdiction) await client.query("INSERT INTO location_jurisdictions (location, jurisdiction) VALUES (lower($1), $2) ON CONFLICT (location) DO UPDATE SET jurisdiction = excluded.jurisdiction", [input.location, input.jurisdiction]);
    else await client.query("DELETE FROM location_jurisdictions WHERE location = lower($1)", [input.location]);
    await audit(client, member, "jurisdiction.mapped", { detail: input.jurisdiction ? `${input.location}: ${input.jurisdiction}` : input.location });
  });
}

export async function employeeDates(days = 60) {
  await requireAdmin();
  const { rows } = await pool().query<EmployeeDate>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name, 'Last day' AS label, to_char(e.last_day, 'YYYY-MM-DD') AS "on", '/workspace/people/' || e.id AS href FROM employees e
     WHERE e.status = 'offboarding' AND e.last_day BETWEEN current_date AND current_date + $1::int
     UNION ALL SELECT x.id, concat_ws(' ', e.first_name, e.last_name), 'Training expires: ' || x.course_title, to_char(x.expires_on, 'YYYY-MM-DD'), '/workspace/people/' || e.id || '/training' FROM training_completions x JOIN employees e ON e.id = x.employee_id AND e.status <> 'archived'
     WHERE x.expires_on BETWEEN current_date AND current_date + $1::int AND NOT EXISTS (SELECT 1 FROM training_completions n WHERE n.course_id = x.course_id AND n.employee_id = x.employee_id AND n.expires_on > x.expires_on)
     ORDER BY 4, 2 LIMIT 100`, [days],
  );
  return rows;
}

export async function complianceTodos(member: Member, days = 14) {
  if (member.role !== "admin") return { due: [], notices: [] };
  const [due, notices] = await Promise.all([
    pool().query<{ id: string; name: string; dueOn: string; overdue: boolean }>(
      `SELECT o.id, o.name, to_char(c.due_on, 'YYYY-MM-DD') AS "dueOn", c.due_on < current_date AS overdue FROM obligation_occurrences c JOIN obligations o ON o.id = c.obligation_id
       WHERE c.state = 'open' AND o.archived_at IS NULL AND c.due_on <= current_date + $1::int AND (o.owner_id IS NULL OR o.owner_id = $2 OR c.due_on < current_date) ORDER BY c.due_on, lower(o.name) LIMIT 20`, [days, member.id],
    ),
    pool().query<{ id: string; title: string; deadlineOn: string | null; overdue: boolean }>(
      `SELECT id, title, to_char(deadline_on, 'YYYY-MM-DD') AS "deadlineOn", coalesce(deadline_on < current_date, false) AS overdue FROM compliance_notices
       WHERE state IN ('received', 'in_progress') AND (assignee_id = $2 OR assignee_id IS NULL OR deadline_on <= current_date + $1::int) ORDER BY deadline_on NULLS LAST, id LIMIT 20`, [days, member.id],
    ),
  ]);
  return { due: due.rows, notices: notices.rows };
}

// Calendar lines are escaped and folded at 75 octets.
function icsLine(name: string, value: string) {
  const line = `${name}:${value.replaceAll("\\", "\\\\").replaceAll(/\r?\n/g, "\\n").replaceAll(/[,;]/g, (mark) => `\\${mark}`)}`;
  const parts: string[] = [];
  let part = "";
  for (const character of line) {
    if (Buffer.byteLength(part + character) > (parts.length ? 74 : 75)) { parts.push(part); part = ""; }
    part += character;
  }
  return [...parts, part].join("\r\n ");
}

export function exportCalendar(member: Member) {
  return runAsAdmin(member, async (client) => {
    const items = await selectDueItems(client);
    const notices = await selectNotices(client, false);
    await audit(client, member, "compliance.exported", { detail: `${items.length + notices.length} dates` });
    const stamp = `${new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15)}Z`;
    const events = [
      ...items.map((item) => ({ uid: item.id, on: item.dueOn, title: item.name, detail: [item.authority, item.jurisdiction].filter(Boolean).join(", ") })),
      ...notices.flatMap((notice) => notice.deadlineOn && notice.state !== "responded" ? [{ uid: notice.id, on: notice.deadlineOn, title: `Notice deadline: ${notice.title}`, detail: notice.authority }] : []),
    ];
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenWarp//Compliance//EN", "CALSCALE:GREGORIAN"];
    for (const event of events) {
      lines.push("BEGIN:VEVENT", `UID:${event.uid}@openwarp`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${event.on.replaceAll("-", "")}`, icsLine("SUMMARY", event.title));
      if (event.detail) lines.push(icsLine("DESCRIPTION", event.detail));
      lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
    }
    return `${[...lines, "END:VCALENDAR"].join("\r\n")}\r\n`;
  });
}
