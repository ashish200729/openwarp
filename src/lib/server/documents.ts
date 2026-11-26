import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { documentCategories, today, addDays, type DocumentCategory, type documentFields } from "@/lib/operations";
import type { DocumentFilters, documentDetailFields, documentRequestFields, DocumentRequestState, documentReviewFields, documentUploadFields, documentVersionFields } from "@/lib/domains/records";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { notify } from "./notify";
import { audit, PeopleError, requireOwnEmployee, runAsAdmin, runAsMember } from "./write";

export const maxFileBytes = 5 * 1024 * 1024;
export const expiryNoticeDays = 30;
export type DocumentRow = {
  id: string; name: string; category: DocumentCategory; sizeBytes: number; createdAt: Date; employeeId: string | null; employeeName: string | null; folder: string; expiresOn: string | null; version: number;
  needsAcknowledgement: boolean; acknowledged: boolean; acknowledgedCount: number; expectedCount: number;
};
export type DocumentVersion = { id: string; version: number; sizeBytes: number; createdAt: Date; uploadedBy: string; expiresOn: string | null };
export type DocumentRequest = {
  id: string; employeeId: string; employeeName: string; title: string; instructions: string; category: DocumentCategory; dueOn: string | null; state: DocumentRequestState; returnNote: string; documentId: string | null; createdAt: Date;
};

// The declared type is ignored. The stored type comes from the file's own signature.
export async function readUpload(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > maxFileBytes) throw new PeopleError("Choose a file of 5 MB or less.");
  const content = Buffer.from(await file.arrayBuffer());
  const mediaType = content.subarray(0, 5).toString("latin1") === "%PDF-" ? "application/pdf"
    : content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
    : content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "image/jpeg" : null;
  if (!mediaType) throw new PeopleError("Choose a PDF, PNG or JPEG file.");
  return { content, mediaType };
}
export type Upload = NonNullable<Awaited<ReturnType<typeof readUpload>>>;

type NewDocument = { name: string; category: DocumentCategory; employeeId: string | null; needsAcknowledgement?: boolean; folder?: string; expiresOn?: string | null; seriesId?: string; version?: number };

export async function insertDocument(client: PoolClient, member: Member, input: NewDocument, upload: Upload) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO documents (employee_id, name, category, media_type, size_bytes, content, needs_acknowledgement, uploaded_by, folder, expires_on, series_id, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [input.employeeId, input.name, input.category, upload.mediaType, upload.content.byteLength, upload.content, input.needsAcknowledgement ?? false, member.id, input.folder ?? "", input.expiresOn ?? null, input.seriesId ?? null, input.version ?? 1],
  );
  return rows[0].id;
}

export function addDocument(member: Member, input: z.infer<typeof documentFields> & { folder?: string; expiresOn?: string | null }, upload: Upload) {
  return runAsAdmin(member, async (client) => {
    await insertDocument(client, member, input, upload);
    await audit(client, member, "document.added", { employeeId: input.employeeId ?? undefined, detail: input.name });
    await announceDocument(client, member, input);
  });
}

async function announceDocument(client: PoolClient, member: Member, document: { name: string; employeeId: string | null; needsAcknowledgement: boolean }) {
  if (!document.needsAcknowledgement && !document.employeeId) return;
  await notify(client, member, document.employeeId ? { employeeId: document.employeeId } : { everyone: true }, {
    title: document.needsAcknowledgement ? `Please read ${document.name}` : `New document: ${document.name}`, body: document.needsAcknowledgement ? "Open it, then confirm you’ve read it." : "",
    href: document.employeeId ? `/workspace/people/${document.employeeId}/documents` : "/workspace/documents",
  });
}

const superseded = "EXISTS (SELECT 1 FROM documents n WHERE n.series_id = coalesce(d.series_id, d.id) AND n.version > d.version)";
const current = `d.archived_at IS NULL AND NOT ${superseded}`;

type Current = { name: string; category: DocumentCategory; employeeId: string | null; needsAcknowledgement: boolean; folder: string; seriesId: string; version: number };

async function findCurrent(client: PoolClient, id: string): Promise<Current | undefined> {
  const { rows } = await client.query<Current>(
    `SELECT d.name, d.category, d.employee_id AS "employeeId", d.needs_acknowledgement AS "needsAcknowledgement", d.folder, coalesce(d.series_id, d.id) AS "seriesId", d.version
     FROM documents d WHERE d.id = $1 AND d.category <> 'receipt' AND ${current}`, [id],
  );
  return rows[0];
}

async function currentDocument(client: PoolClient, id: string) {
  const document = await findCurrent(client, id);
  if (!document) throw new PeopleError("This document was archived or replaced. Reload the page.");
  return document;
}

async function insertVersion(client: PoolClient, member: Member, document: Current, expiresOn: string | null, upload: Upload) {
  return insertDocument(client, member, { ...document, expiresOn, version: document.version + 1 }, upload);
}

export function addDocumentVersion(member: Member, input: z.infer<typeof documentVersionFields>, upload: Upload) {
  return runAsAdmin(member, async (client) => {
    const document = await currentDocument(client, input.id);
    const id = await insertVersion(client, member, document, input.expiresOn, upload);
    // An open review follows the newest file.
    await client.query("UPDATE document_requests SET document_id = $2 WHERE document_id = $1 AND state IN ('submitted', 'returned')", [input.id, id]);
    await audit(client, member, "document.replaced", { employeeId: document.employeeId ?? undefined, detail: `${document.name}, version ${document.version + 1}` });
    if (document.needsAcknowledgement) await announceDocument(client, member, document);
    return id;
  });
}

export function saveDocumentDetails(member: Member, input: z.infer<typeof documentDetailFields>) {
  return runAsAdmin(member, async (client) => {
    const document = await currentDocument(client, input.id);
    await client.query(
      "UPDATE documents SET folder = $2, expiry_notified_at = CASE WHEN expires_on IS NOT DISTINCT FROM $3::date THEN expiry_notified_at END, expires_on = $3 WHERE id = $1", [input.id, input.folder, input.expiresOn],
    );
    await audit(client, member, "document.updated", { employeeId: document.employeeId ?? undefined, detail: document.name });
  });
}

export function archiveDocument(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ name: string; employeeId: string | null }>(
      `UPDATE documents d SET archived_at = now() WHERE d.id = $1 AND d.category <> 'receipt' AND ${current} RETURNING name, employee_id AS "employeeId"`, [id],
    );
    if (!rows[0]) throw new PeopleError("This document is already archived.");
    await audit(client, member, "document.archived", { employeeId: rows[0].employeeId ?? undefined, detail: rows[0].name });
  });
}

export function acknowledgeDocument(member: Member, id: string) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const { rows } = await client.query<{ name: string }>(
      `SELECT d.name FROM documents d WHERE d.id = $1 AND d.needs_acknowledgement AND ${current} AND (d.employee_id IS NULL OR d.employee_id = $2)`, [id, employeeId],
    );
    if (!rows[0]) throw new PeopleError("This document no longer needs your acknowledgement. Reload the page to see the latest version.");
    const { rowCount } = await client.query("INSERT INTO document_acknowledgements (document_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, employeeId]);
    if (rowCount) await audit(client, member, "document.acknowledged", { employeeId, detail: rows[0].name });
  });
}

const columns = `d.id, d.name, d.category, d.size_bytes AS "sizeBytes", d.created_at AS "createdAt", d.employee_id AS "employeeId", d.folder, to_char(d.expires_on, 'YYYY-MM-DD') AS "expiresOn", d.version,
  concat_ws(' ', e.first_name, e.last_name) AS "employeeName", d.needs_acknowledgement AS "needsAcknowledgement",
  EXISTS (SELECT 1 FROM document_acknowledgements a WHERE a.document_id = d.id AND a.employee_id = $2::uuid) AS acknowledged,
  (SELECT count(*)::int FROM document_acknowledgements a JOIN employees p ON p.id = a.employee_id AND p.status <> 'archived' WHERE a.document_id = d.id) AS "acknowledgedCount",
  CASE WHEN d.employee_id IS NULL THEN (SELECT count(*)::int FROM employees WHERE status <> 'archived') ELSE 1 END AS "expectedCount"`;
const visible = `FROM documents d LEFT JOIN employees e ON e.id = d.employee_id WHERE ${current} AND d.category <> 'receipt' AND ($1 = 'admin' OR d.employee_id IS NULL OR d.employee_id = $2::uuid)`;

// Viewers see company documents and their own. Receipts stay with their expense.
export async function listDocuments(member: Member, employeeId?: string) {
  const { rows } = await pool().query<DocumentRow>(
    `SELECT ${columns} ${visible} AND ($3::uuid IS NULL OR d.employee_id = $3) ORDER BY d.employee_id IS NOT NULL, d.created_at DESC, d.id LIMIT 200`, [member.role, member.employeeId, employeeId ?? null],
  );
  return rows;
}

const matching = `AND (d.employee_id IS NULL) = $3 AND ($4 = '' OR strpos(lower(concat_ws(' ', d.name, e.first_name, e.last_name)), lower($4)) > 0) AND ($5 = '' OR d.category = $5) AND ($6 = '' OR d.folder = $6)`;

export async function searchDocuments(member: Member, scope: "company" | "personal", filters: DocumentFilters, size = 40) {
  const values = [member.role, member.employeeId, scope === "company", filters.query, filters.category, filters.folder];
  const { rows: [{ total }] } = await pool().query<{ total: number }>(`SELECT count(*)::int AS total ${visible} ${matching}`, values);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(filters.page, pages);
  const { rows } = await pool().query<DocumentRow>(`SELECT ${columns} ${visible} ${matching} ORDER BY lower(d.folder), d.created_at DESC, d.id LIMIT $7 OFFSET $8`, [...values, size, (page - 1) * size]);
  return { documents: rows, total, page, pages };
}

export async function listFolders(member: Member) {
  const { rows } = await pool().query<{ folder: string }>(`SELECT DISTINCT d.folder ${visible} AND d.folder <> '' ORDER BY d.folder LIMIT 200`, [member.role, member.employeeId]);
  return rows.map((row) => row.folder);
}

export function documentFilters(params: Record<string, string | undefined>): DocumentFilters {
  return {
    query: (params.q ?? "").trim().slice(0, 120), category: documentCategories.find((category) => category === params.category) ?? "", folder: (params.folder ?? "").slice(0, 60),
    page: /^\d{1,6}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1,
  };
}

export async function documentDetail(id: string) {
  const member = await requireAdmin();
  const { rows } = await pool().query<DocumentRow & { seriesId: string; archived: boolean }>(
    `SELECT ${columns}, coalesce(d.series_id, d.id) AS "seriesId", d.archived_at IS NOT NULL AS archived FROM documents d LEFT JOIN employees e ON e.id = d.employee_id
     WHERE d.category <> 'receipt' AND coalesce(d.series_id, d.id) = (SELECT coalesce(series_id, id) FROM documents WHERE id = $1) ORDER BY d.version DESC LIMIT 1`, [id, member.employeeId],
  );
  if (!rows[0]) return null;
  const [versions, missing] = await Promise.all([
    pool().query<DocumentVersion>(
      `SELECT d.id, d.version, d.size_bytes AS "sizeBytes", d.created_at AS "createdAt", u.name AS "uploadedBy", to_char(d.expires_on, 'YYYY-MM-DD') AS "expiresOn"
       FROM documents d JOIN "user" u ON u.id = d.uploaded_by WHERE d.id = $1 OR d.series_id = $1 ORDER BY d.version DESC`, [rows[0].seriesId],
    ),
    rows[0].needsAcknowledgement ? pool().query<{ id: string; name: string }>(
      `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name FROM employees e WHERE e.status <> 'archived' AND ($2::uuid IS NULL OR e.id = $2)
       AND NOT EXISTS (SELECT 1 FROM document_acknowledgements a WHERE a.document_id = $1 AND a.employee_id = e.id) ORDER BY lower(e.last_name), lower(e.first_name), e.id LIMIT 200`, [rows[0].id, rows[0].employeeId],
    ) : { rows: [] },
  ]);
  return { document: rows[0], versions: versions.rows, missing: missing.rows };
}

export async function readDocument(member: Member, id: string) {
  const { rows } = await pool().query<{ name: string; mediaType: string; content: Buffer }>(
    `SELECT d.name, d.media_type AS "mediaType", d.content FROM documents d LEFT JOIN employees e ON e.id = d.employee_id
     WHERE d.id = $1 AND ($2 = 'admin' OR ${current} AND (
       d.employee_id IS NOT DISTINCT FROM NULL AND d.category <> 'receipt' OR d.employee_id = $3 OR (d.category = 'receipt' AND e.manager_id = $3)
     ))`, [id, member.role, member.employeeId],
  );
  return rows[0] ?? null;
}

const requestColumns = `r.id, r.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", r.title, r.instructions, r.category, to_char(r.due_on, 'YYYY-MM-DD') AS "dueOn", r.state,
  r.return_note AS "returnNote", r.document_id AS "documentId", r.created_at AS "createdAt"`;

// People who already have the same request open are skipped, so asking a team again only reaches the rest.
export async function insertDocumentRequests(client: PoolClient, member: Member, employeeIds: string[], request: { title: string; instructions: string; category: string; dueOn: string | null }) {
  const { rows } = await client.query<{ employeeId: string }>(
    `INSERT INTO document_requests (employee_id, title, instructions, category, due_on, requested_by)
     SELECT e.id, $2, $3, $4, $5, $6 FROM employees e WHERE e.id = ANY($1::uuid[]) AND e.status <> 'archived'
     AND NOT EXISTS (SELECT 1 FROM document_requests r WHERE r.employee_id = e.id AND lower(r.title) = lower($2) AND r.state IN ('open', 'submitted', 'returned')) RETURNING employee_id AS "employeeId"`,
    [employeeIds, request.title, request.instructions, request.category, request.dueOn, member.id],
  );
  for (const { employeeId } of rows) await notify(client, member, { employeeId }, { title: `Please upload: ${request.title}`, body: request.instructions, href: "/workspace/documents/requests" });
  return rows.map((row) => row.employeeId);
}

export function requestDocuments(member: Member, input: z.infer<typeof documentRequestFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM employees WHERE status <> 'archived' AND (id = ANY($1::uuid[]) OR $2 = 'all' OR team_id = $3::uuid) LIMIT 501`,
      [input.people, input.audience, input.audience && input.audience !== "all" ? input.audience : null],
    );
    if (!rows.length) throw new PeopleError("Nobody in that selection can be asked. Choose other people.");
    if (rows.length > 500) throw new PeopleError("Ask at most 500 people at a time. Choose one team.");
    const asked = await insertDocumentRequests(client, member, rows.map((row) => row.id), input);
    if (!asked.length) throw new PeopleError("Everyone you chose already has this request open.");
    await audit(client, member, "document_request.sent", { employeeId: asked.length === 1 ? asked[0] : undefined, detail: `${input.title}, ${asked.length} ${asked.length === 1 ? "person" : "people"}` });
    return asked.length;
  });
}

export function submitRequestedDocument(member: Member, input: z.infer<typeof documentUploadFields>, upload: Upload) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const { rows } = await client.query<{ title: string; category: DocumentCategory; documentId: string | null; state: DocumentRequestState }>(
      `SELECT title, category, document_id AS "documentId", state FROM document_requests WHERE id = $1 AND employee_id = $2`, [input.id, employeeId],
    );
    const request = rows[0];
    if (!request) throw new PeopleError("This request could not be found.");
    if (request.state !== "open" && request.state !== "returned") throw new PeopleError("This request no longer needs an upload.");
    const previous = request.documentId ? await findCurrent(client, request.documentId) : undefined;
    const documentId = previous ? await insertVersion(client, member, previous, input.expiresOn, upload)
      : await insertDocument(client, member, { name: request.title, category: request.category, employeeId, expiresOn: input.expiresOn }, upload);
    await client.query("UPDATE document_requests SET state = 'submitted', document_id = $2, return_note = '' WHERE id = $1", [input.id, documentId]);
    await audit(client, member, "document_request.submitted", { employeeId, detail: request.title });
    await notify(client, member, { role: "admin" }, { title: `${member.name} uploaded ${request.title}`, href: "/workspace/documents/requests" });
  });
}

export function reviewDocumentRequest(member: Member, input: z.infer<typeof documentReviewFields>) {
  return runAsAdmin(member, async (client) => {
    const allowed = input.decision === "cancelled" ? ["open", "submitted", "returned"] : ["submitted"];
    const { rows } = await client.query<{ employeeId: string; title: string }>(
      `UPDATE document_requests SET state = $2, return_note = $3, decided_by = $4, decided_at = now() WHERE id = $1 AND state = ANY($5::text[]) RETURNING employee_id AS "employeeId", title`,
      [input.id, input.decision, input.decision === "returned" ? input.note : "", member.id, allowed],
    );
    if (!rows[0]) throw new PeopleError("This request was already decided. Reload the page.");
    const { employeeId, title } = rows[0];
    await audit(client, member, `document_request.${input.decision}`, { employeeId, detail: title });
    await notify(client, member, { employeeId }, {
      title: input.decision === "accepted" ? `${title} was accepted` : input.decision === "returned" ? `${title} needs another upload` : `${title} is no longer needed`,
      body: input.decision === "returned" ? input.note : "", href: "/workspace/documents/requests",
    });
  });
}

export async function ownDocumentRequests(member: Member) {
  if (!member.employeeId) return [];
  const { rows } = await pool().query<DocumentRequest>(
    `SELECT ${requestColumns} FROM document_requests r JOIN employees e ON e.id = r.employee_id WHERE r.employee_id = $1 AND r.state <> 'cancelled' ORDER BY array_position(ARRAY['returned', 'open', 'submitted', 'accepted'], r.state), r.due_on NULLS LAST, r.id LIMIT 60`, [member.employeeId],
  );
  return rows;
}

export async function listDocumentRequests(member: Member, states: DocumentRequestState[], limit = 200) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<DocumentRequest>(
    `SELECT ${requestColumns} FROM document_requests r JOIN employees e ON e.id = r.employee_id WHERE r.state = ANY($1::text[]) AND e.status <> 'archived' ORDER BY r.due_on NULLS LAST, r.created_at, r.id LIMIT $2`, [states, limit],
  );
  return rows;
}

export async function expiringDocuments(member: Member, day = today()) {
  const { rows } = await pool().query<{ id: string; name: string; employeeId: string | null; employeeName: string | null; expiresOn: string }>(
    `SELECT d.id, d.name, d.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", to_char(d.expires_on, 'YYYY-MM-DD') AS "expiresOn"
     FROM documents d LEFT JOIN employees e ON e.id = d.employee_id WHERE ${current} AND d.expires_on <= $3 AND coalesce(e.status, '') <> 'archived' AND ($1 = 'admin' OR d.employee_id = $2) ORDER BY d.expires_on, d.id LIMIT 20`,
    [member.role, member.employeeId, addDays(day, expiryNoticeDays)],
  );
  return rows;
}

// Claiming the row first means two people opening the workspace at once send one notice.
export async function notifyExpiring(client: PoolClient, day = today()) {
  const until = addDays(day, expiryNoticeDays);
  const { rows: documents } = await client.query<{ id: string; name: string; employeeId: string | null }>(
    `UPDATE documents d SET expiry_notified_at = now() WHERE d.expires_on BETWEEN $1 AND $2 AND d.expiry_notified_at IS NULL AND ${current}
     AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = d.employee_id AND e.status = 'archived') RETURNING d.id, d.name, d.employee_id AS "employeeId"`, [day, until],
  );
  for (const document of documents) {
    const title = `${document.name} expires within ${expiryNoticeDays} days`;
    await notify(client, null, { role: "admin" }, { title, href: `/workspace/documents/${document.id}/details` });
    if (document.employeeId) await notify(client, null, { employeeId: document.employeeId }, { title, body: "Ask an administrator how to send a new one.", href: `/workspace/people/${document.employeeId}/documents` });
  }
  const { rows: people } = await client.query<{ employeeId: string }>(
    `UPDATE employee_personal p SET work_authorization_notified_at = now() FROM employees e WHERE e.id = p.employee_id AND e.status <> 'archived'
     AND p.work_authorization_expires_on BETWEEN $1 AND $2 AND p.work_authorization_notified_at IS NULL RETURNING p.employee_id AS "employeeId"`, [day, until],
  );
  for (const { employeeId } of people) {
    const notice = { title: "A work authorization needs renewal soon", href: `/workspace/people/${employeeId}/personal` };
    await notify(client, null, { role: "admin" }, notice);
    await notify(client, null, { employeeId }, { ...notice, title: "Your work authorization needs renewal soon" });
  }
}
