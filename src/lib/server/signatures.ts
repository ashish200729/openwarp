import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import type { PoolClient } from "pg";
import type { z } from "zod";
import {
  consentText, mergeBody, sameName, usedMergeFields, type draftFields, type fileSignatureFields, type MergeField, type SignatureEventKind, type SignatureState, type SignerOrder, type signFields, type templateSignatureFields,
} from "@/lib/domains/records";
import { addDays, basisLabels, formatMoney, today, type PayBasis } from "@/lib/operations";
import { employmentLabels, formatDate, type EmploymentType } from "@/lib/people";
import { keyedHash } from "./crypto";
import { pool } from "./db";
import type { Upload } from "./documents";
import { workspaceName, type Member } from "./member";
import { notify } from "./notify";
import { clientAddress } from "./platform-settings";
import { confirmMember, requireConfirmed, type Confirmation } from "./reauth";
import { requireSignatory } from "./templates";
import { audit, PeopleError, requireOwnEmployee, runAsAdmin, runAsMember } from "./write";

export type SignatureRow = { id: string; title: string; employeeId: string; employeeName: string; state: SignatureState; createdAt: Date; sentAt: Date | null; closedAt: Date | null; waitingFor: string | null };
export type Signer = { id: string; kind: "employee" | "company"; name: string; employeeId: string | null; userId: string | null; hasAccount: boolean; signedAt: Date | null };
export type SignatureEvent = {
  id: string; event: SignatureEventKind; signerId: string | null; userId: string; userName: string; typedName: string | null; consentText: string | null; contentSha256: string | null; ipHash: string | null; confirmedBy: Confirmation["method"] | null; userAgent: string; reason: string; happenedAt: Date; seal: string;
};
export type SignatureDetail = {
  id: string; title: string; employeeId: string; employeeName: string; state: SignatureState; version: number; sentAt: Date | null; draftBody: string | null; starter: boolean; body: string | null; hasFile: boolean;
  sha256: string | null; intact: boolean; missing: MergeField[]; signers: Signer[]; events: SignatureEvent[]; mySigner: Signer | null; myTurn: boolean; openedFile: boolean; signAs: string;
};

const digest = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");

async function mergeValues(client: Pick<PoolClient, "query">, employeeId: string): Promise<Record<MergeField, string>> {
  const { rows } = await client.query<{ firstName: string; lastName: string; email: string; title: string; team: string; manager: string; employmentType: EmploymentType; hireDate: string; location: string; amountCents: number | null; basis: PayBasis | null; currency: string | null }>(
    `SELECT e.first_name AS "firstName", e.last_name AS "lastName", e.email, e.title, coalesce(t.name, '') AS team, concat_ws(' ', m.first_name, m.last_name) AS manager, e.employment_type AS "employmentType",
     to_char(e.hire_date, 'YYYY-MM-DD') AS "hireDate", e.location, c.amount_cents::float8 AS "amountCents", c.basis, c.currency
     FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN employees m ON m.id = e.manager_id
     LEFT JOIN LATERAL (SELECT amount_cents, basis, currency FROM compensation WHERE employee_id = e.id AND effective_on <= greatest($2::date, e.hire_date) ORDER BY effective_on DESC LIMIT 1) c ON true WHERE e.id = $1`, [employeeId, today()],
  );
  const person = rows[0];
  if (!person) throw new PeopleError("This person could not be found.");
  return {
    first_name: person.firstName, last_name: person.lastName, full_name: `${person.firstName} ${person.lastName}`, email: person.email, title: person.title, team: person.team, manager: person.manager,
    employment_type: employmentLabels[person.employmentType], start_date: formatDate(person.hireDate), location: person.location, company_name: workspaceName(), today: formatDate(today()),
    salary: person.amountCents !== null && person.basis && person.currency ? `${formatMoney(person.amountCents, person.currency)} ${basisLabels[person.basis]}` : "",
  };
}

async function render(client: Pick<PoolClient, "query">, employeeId: string, body: string) {
  const values = await mergeValues(client, employeeId);
  return { body: mergeBody(body, values), missing: (usedMergeFields(body) as MergeField[]).filter((field) => !values[field]) };
}

type Event = { requestId: string; signerId?: string | null; event: SignatureEventKind; userId: string; typedName?: string; consentText?: string; contentSha256?: string; confirmedBy?: Confirmation["method"]; reason?: string };

// Each seal covers the event and the seal before it, so a changed, reordered or removed event shows up when the chain is read again.
function sealEvent(previous: string, event: { requestId: string; signerId: string | null; event: string; userId: string; typedName: string | null; consentText: string | null; contentSha256: string | null; ipHash: string | null; confirmedBy: string | null; userAgent: string; reason: string; happenedAt: Date }) {
  return keyedHash(JSON.stringify([previous, event.requestId, event.signerId, event.event, event.userId, event.typedName, event.consentText, event.contentSha256, event.ipHash, event.confirmedBy, event.userAgent, event.reason, event.happenedAt.toISOString()]), "signature-event");
}

async function appendEvent(client: PoolClient, input: Event) {
  const request = await headers();
  const address = clientAddress(request);
  const event = {
    requestId: input.requestId, signerId: input.signerId ?? null, event: input.event, userId: input.userId, typedName: input.typedName ?? null, consentText: input.consentText ?? null, contentSha256: input.contentSha256 ?? null,
    // Loopback means no trusted proxy named the client, so there is no address worth recording.
    ipHash: address === "127.0.0.1" ? null : keyedHash(address, "signature-ip"), confirmedBy: input.confirmedBy ?? null, userAgent: (request.get("user-agent") ?? "").replaceAll(/[^\x20-\x7e]/g, "").slice(0, 300), reason: input.reason ?? "", happenedAt: new Date(),
  };
  const { rows } = await client.query<{ seal: string }>("SELECT seal FROM signature_events WHERE request_id = $1 ORDER BY id DESC LIMIT 1", [event.requestId]);
  await client.query(
    `INSERT INTO signature_events (request_id, signer_id, event, user_id, typed_name, consent_text, content_sha256, ip_hash, confirmed_by, user_agent, reason, happened_at, seal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [event.requestId, event.signerId, event.event, event.userId, event.typedName, event.consentText, event.contentSha256, event.ipHash, event.confirmedBy, event.userAgent, event.reason, event.happenedAt, sealEvent(rows[0]?.seal ?? "", event)],
  );
}

type Draft = { employeeId: string; title: string; templateId?: string; body?: string; file?: Buffer; signatoryId: string | null; signerOrder: SignerOrder };

async function insertRequest(client: PoolClient, member: Member, draft: Draft) {
  const { rowCount: person } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [draft.employeeId]);
  if (!person) throw new PeopleError("Choose a current employee.");
  await requireSignatory(client, draft.signatoryId);
  if (draft.signatoryId) {
    const { rowCount: same } = await client.query("SELECT 1 FROM workspace_members WHERE user_id = $1 AND employee_id = $2", [draft.signatoryId, draft.employeeId]);
    if (same) throw new PeopleError("The company signatory has to be someone other than the employee.");
  }
  const { rows: [{ id }] } = await client.query<{ id: string }>("INSERT INTO signature_requests (employee_id, template_id, title, draft_body, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id", [draft.employeeId, draft.templateId ?? null, draft.title, draft.body ?? null, member.id]);
  if (draft.file) await client.query("INSERT INTO signature_contents (request_id, file, sha256) VALUES ($1, $2, $3)", [id, draft.file, digest(draft.file)]);
  const signers: [string, string | null, string | null][] = [["employee", draft.employeeId, null]];
  if (draft.signatoryId) signers.push(["company", null, draft.signatoryId]);
  if (draft.signerOrder === "company_first") signers.reverse();
  for (const [index, [kind, employeeId, userId]] of signers.entries()) {
    await client.query("INSERT INTO signature_signers (request_id, position, kind, employee_id, user_id) VALUES ($1, $2, $3, $4, $5)", [id, index + 1, kind, employeeId, userId]);
  }
  await audit(client, member, "signature.created", { employeeId: draft.employeeId, detail: draft.title });
  return id;
}

async function templateDraft(client: PoolClient, templateId: string, version: number) {
  const { rows } = await client.query<{ name: string; body: string }>("SELECT name, body FROM signature_templates WHERE id = $1 AND version = $2 AND archived_at IS NULL", [templateId, version]);
  if (!rows[0]) throw new PeopleError("This template changed or was archived. Reload the templates before preparing a draft.");
  return rows[0];
}

export function createFromTemplate(member: Member, input: z.infer<typeof templateSignatureFields>) {
  return runAsAdmin(member, async (client) => {
    const { name, body } = await templateDraft(client, input.templateId, input.templateVersion);
    return insertRequest(client, member, { ...input, title: name, body });
  });
}

export function createFromFile(member: Member, input: z.infer<typeof fileSignatureFields>, upload: Upload) {
  if (upload.mediaType !== "application/pdf") throw new PeopleError("Choose a PDF file.");
  return runAsAdmin(member, (client) => insertRequest(client, member, { ...input, file: upload.content }));
}

// New hires get every template marked for their employment type. One with a missing value waits as a draft.
export async function createNewHireSignatures(client: PoolClient, member: Member, employeeId: string) {
  const { rows } = await client.query<{ id: string; name: string; body: string; signatoryId: string | null; signerOrder: SignerOrder }>(
    `SELECT t.id, t.name, t.body, s.user_id AS "signatoryId", t.signer_order AS "signerOrder" FROM signature_templates t JOIN employees e ON e.id = $1
     LEFT JOIN workspace_members s ON s.user_id = t.signatory_id AND s.role <> 'disabled' AND s.employee_id IS DISTINCT FROM e.id
     WHERE t.include_new_hires AND t.archived_at IS NULL AND e.employment_type = ANY(t.employment_types) ORDER BY lower(t.name), t.id`, [employeeId],
  );
  for (const template of rows) {
    const id = await insertRequest(client, member, { employeeId, title: template.name, templateId: template.id, body: template.body, signatoryId: template.signatoryId, signerOrder: template.signerOrder });
    const { missing } = await render(client, employeeId, template.body);
    if (!missing.length) await send(client, member, { id, employeeId, title: template.name, draftBody: template.body });
  }
}

type Open = { id: string; employeeId: string; title: string; state: SignatureState; version: number; draftBody: string | null };

async function readOpen(client: PoolClient, id: string, states: SignatureState[]) {
  const { rows } = await client.query<Open>(`SELECT id, employee_id AS "employeeId", title, state, version, draft_body AS "draftBody" FROM signature_requests WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) throw new PeopleError("This document could not be found.");
  if (!states.includes(rows[0].state)) throw new PeopleError("This document has already moved on. Reload the page.");
  return rows[0];
}

export function saveDraft(member: Member, input: z.infer<typeof draftFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("UPDATE signature_requests SET title = $3, draft_body = $4, version = version + 1 WHERE id = $1 AND version = $2 AND state = 'draft' AND draft_body IS NOT NULL", [input.id, input.version, input.title, input.body]);
    if (!rowCount) throw new PeopleError("This draft changed while you were editing. Reload it and try again.");
  });
}

async function send(client: PoolClient, member: Member, request: Pick<Open, "id" | "employeeId" | "title" | "draftBody">) {
  if (request.draftBody !== null) {
    const { body, missing } = await render(client, request.employeeId, request.draftBody);
    if (missing.length) throw new PeopleError("Some merge fields have no value yet. Fill them in on the person’s record or take them out of the text.");
    await client.query("INSERT INTO signature_contents (request_id, body, sha256) VALUES ($1, $2, $3)", [request.id, body, digest(body)]);
  }
  await client.query(
    `INSERT INTO signature_signer_names (signer_id, name)
     SELECT s.id, coalesce(u.name, concat_ws(' ', e.first_name, e.last_name)) FROM signature_signers s
     LEFT JOIN "user" u ON u.id = s.user_id LEFT JOIN employees e ON e.id = s.employee_id WHERE s.request_id = $1`, [request.id],
  );
  const { rows: [content] } = await client.query<{ sha256: string }>("SELECT sha256 FROM signature_contents WHERE request_id = $1", [request.id]);
  await client.query("UPDATE signature_requests SET state = 'pending', sent_at = now(), version = version + 1 WHERE id = $1", [request.id]);
  await appendEvent(client, { requestId: request.id, event: "sent", userId: member.id, contentSha256: content.sha256 });
  await audit(client, member, "signature.sent", { employeeId: request.employeeId, detail: request.title });
  await notifyNext(client, member, request);
}

export function sendSignature(member: Member, input: { id: string; version: number }) {
  return runAsAdmin(member, async (client) => {
    const request = await readOpen(client, input.id, ["draft"]);
    if (request.version !== input.version) throw new PeopleError("This draft changed while you were reading it. Reload the page and check it again.");
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [request.employeeId]);
    if (!rowCount) throw new PeopleError("Archived profiles can’t be sent documents to sign.");
    await send(client, member, request);
  });
}

const nextSigner = `LEFT JOIN LATERAL (SELECT s.* FROM signature_signers s WHERE s.request_id = r.id AND NOT EXISTS (SELECT 1 FROM signature_events v WHERE v.signer_id = s.id AND v.event = 'signed') ORDER BY s.position LIMIT 1) next ON r.state = 'pending'`;

async function currentSigner(client: PoolClient, id: string) {
  const { rows } = await client.query<{ id: string; kind: "employee" | "company"; employeeId: string | null; userId: string | null }>(
    `SELECT next.id, next.kind, next.employee_id AS "employeeId", next.user_id AS "userId" FROM signature_requests r ${nextSigner} WHERE r.id = $1 AND next.id IS NOT NULL`, [id],
  );
  return rows[0] as typeof rows[0] | undefined;
}

// notify() reaches accounts through their employee record, so a company signatory without one is written to directly.
async function notifyUser(client: PoolClient, actor: Member, userId: string, notice: { title: string; href: string }) {
  if (userId === actor.id) return;
  await client.query("INSERT INTO notifications (user_id, title, href) SELECT user_id, $2, $3 FROM workspace_members WHERE user_id = $1 AND role <> 'disabled'", [userId, notice.title.slice(0, 160), notice.href]);
}

async function notifyNext(client: PoolClient, member: Member, request: Pick<Open, "id" | "title">) {
  const signer = await currentSigner(client, request.id);
  if (!signer) return;
  const notice = { title: `Please sign: ${request.title}`, href: `/workspace/documents/signatures/${request.id}` };
  if (signer.employeeId) await notify(client, member, { employeeId: signer.employeeId }, notice);
  else await notifyUser(client, member, signer.userId!, notice);
}

async function requireMyTurn(client: PoolClient, member: Member, actor: { employeeId: string | null }, id: string) {
  const signer = await currentSigner(client, id);
  if (!signer) throw new PeopleError("This document is no longer waiting for a signature.");
  if (signer.kind === "company" ? signer.userId !== member.id : !actor.employeeId || signer.employeeId !== actor.employeeId) throw new PeopleError("It isn’t your turn to sign this document.");
  return signer;
}

async function readContent(client: PoolClient, id: string) {
  const { rows } = await client.query<{ body: string | null; file: Buffer | null; sha256: string }>("SELECT body, file, sha256 FROM signature_contents WHERE request_id = $1", [id]);
  if (!rows[0] || digest(rows[0].body ?? rows[0].file!) !== rows[0].sha256) throw new PeopleError("This document doesn’t match the one that was sent. Ask an administrator to void it and send a new one.");
  return rows[0];
}

export async function signDocument(member: Member, input: z.infer<typeof signFields>) {
  const confirmation = await confirmMember(member, input.password);
  return runAsMember(member, async (client, actor) => {
    await requireConfirmed(client, member, confirmation);
    const request = await readOpen(client, input.id, ["pending"]);
    const signer = await requireMyTurn(client, member, actor, input.id);
    if (signer.kind === "employee") await requireOwnEmployee(client, actor);
    const { rows: [{ name }] } = await client.query<{ name: string }>(
      `SELECT coalesce(snapshot.name, u.name, concat_ws(' ', e.first_name, e.last_name)) AS name FROM signature_signers s
       LEFT JOIN signature_signer_names snapshot ON snapshot.signer_id=s.id LEFT JOIN "user" u ON u.id=s.user_id
       LEFT JOIN employees e ON e.id=s.employee_id WHERE s.id=$1`, [signer.id],
    );
    if (!sameName(name, input.typedName)) throw new PeopleError(`Type your full name as it appears on this document: ${name}.`);
    const content = await readContent(client, input.id);
    const shown = Buffer.from(input.sha256, "hex");
    if (!timingSafeEqual(shown, Buffer.from(content.sha256, "hex"))) throw new PeopleError("This document changed after you opened it. Reload the page and read it again.");
    if (content.file) {
      const { rowCount } = await client.query("SELECT 1 FROM signature_events WHERE signer_id = $1 AND event = 'opened'", [signer.id]);
      if (!rowCount) throw new PeopleError("Open the PDF and read it before you sign.");
    }
    await appendEvent(client, { requestId: input.id, signerId: signer.id, event: "signed", userId: member.id, typedName: input.typedName, consentText, contentSha256: content.sha256, confirmedBy: confirmation.method });
    await audit(client, member, "signature.signed", { employeeId: request.employeeId, detail: request.title });
    if (await currentSigner(client, input.id)) return notifyNext(client, member, request);
    await client.query("UPDATE signature_requests SET state = 'completed', closed_at = now(), version = version + 1 WHERE id = $1", [input.id]);
    await audit(client, member, "signature.completed", { employeeId: request.employeeId, detail: request.title });
    const notice = { title: `${request.title} is signed by everyone`, href: `/workspace/documents/signatures/${input.id}` };
    await notify(client, member, { employeeId: request.employeeId }, notice);
    await notify(client, member, { role: "admin" }, notice);
    // A company signatory who isn't an administrator would otherwise miss it.
    const { rows } = await client.query<{ userId: string }>(`SELECT s.user_id AS "userId" FROM signature_signers s JOIN workspace_members m ON m.user_id = s.user_id AND m.role = 'viewer' WHERE s.request_id = $1`, [input.id]);
    for (const { userId } of rows) await notifyUser(client, member, userId, notice);
  });
}

export function declineSignature(member: Member, input: { id: string; reason: string }) {
  return runAsMember(member, async (client, actor) => {
    const request = await readOpen(client, input.id, ["pending"]);
    const signer = await requireMyTurn(client, member, actor, input.id);
    await appendEvent(client, { requestId: input.id, signerId: signer.id, event: "declined", userId: member.id, reason: input.reason });
    await client.query("UPDATE signature_requests SET state = 'declined', closed_at = now(), version = version + 1 WHERE id = $1", [input.id]);
    await audit(client, member, "signature.declined", { employeeId: request.employeeId, detail: request.title });
    await notify(client, member, { role: "admin" }, { title: `${member.name} declined to sign ${request.title}`, href: `/workspace/documents/signatures/${input.id}` });
  });
}

async function voidOpenSignature(client: PoolClient, member: Member, request: Pick<Open, "id" | "employeeId" | "title" | "state">, reason: string) {
  await appendEvent(client, { requestId: request.id, event: "voided", userId: member.id, reason });
  await client.query("UPDATE signature_requests SET state = 'voided', closed_at = now(), version = version + 1 WHERE id = $1", [request.id]);
  await audit(client, member, "signature.voided", { employeeId: request.employeeId, detail: request.title });
  if (request.state === "pending") await notify(client, member, { employeeId: request.employeeId }, { title: `${request.title} no longer needs your signature`, href: `/workspace/documents/signatures/${request.id}` });
}

export function voidSignature(member: Member, input: { id: string; reason: string }) {
  return runAsAdmin(member, async client => {
    const request = await readOpen(client, input.id, ["draft", "pending", "declined"]);
    await voidOpenSignature(client, member, request, input.reason);
  });
}

export async function closeEmployeeSignatures(client: PoolClient, member: Member, employeeId: string) {
  const { rows } = await client.query<Pick<Open, "id" | "title" | "state" | "employeeId">>(
    `SELECT id,title,state,employee_id AS "employeeId" FROM signature_requests WHERE employee_id=$1 AND state IN ('draft','pending') FOR UPDATE`, [employeeId],
  );
  for (const row of rows) await voidOpenSignature(client, member, row, "Employee profile archived");
}

// Administrators see every document. A signer sees the ones they were sent.
const canRead = `($2 = 'admin' OR r.sent_at IS NOT NULL AND EXISTS (SELECT 1 FROM signature_signers s WHERE s.request_id = r.id AND (s.user_id = $3 OR s.employee_id = $4)))`;
const access = (member: Member) => [member.role, member.id, member.employeeId];

export async function readSignature(member: Member, id: string): Promise<SignatureDetail | null> {
  const { rows } = await pool().query<Pick<SignatureDetail, "id" | "title" | "employeeId" | "employeeName" | "state" | "version" | "sentAt" | "draftBody" | "starter"> & { body: string | null; file: Buffer | null; sha256: string | null }>(
    `SELECT r.id, r.title, r.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", r.state, r.version, r.sent_at AS "sentAt", r.draft_body AS "draftBody", coalesce(t.starter, false) AS starter, c.body, c.file, c.sha256
     FROM signature_requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN signature_templates t ON t.id = r.template_id LEFT JOIN signature_contents c ON c.request_id = r.id WHERE r.id = $1 AND ${canRead}`, [id, ...access(member)],
  );
  const row = rows[0];
  if (!row) return null;
  const [signers, events] = await Promise.all([
    pool().query<Signer>(
      `SELECT s.id, s.kind, coalesce(snapshot.name, v.typed_name, u.name, concat_ws(' ', e.first_name, e.last_name)) AS name, s.employee_id AS "employeeId", s.user_id AS "userId", v.happened_at AS "signedAt",
       EXISTS (SELECT 1 FROM workspace_members m WHERE m.role <> 'disabled' AND (m.user_id = s.user_id OR m.employee_id = s.employee_id)) AS "hasAccount"
       FROM signature_signers s LEFT JOIN signature_signer_names snapshot ON snapshot.signer_id=s.id LEFT JOIN "user" u ON u.id = s.user_id LEFT JOIN employees e ON e.id = s.employee_id LEFT JOIN signature_events v ON v.signer_id = s.id AND v.event = 'signed' WHERE s.request_id = $1 ORDER BY s.position`, [id],
    ),
    pool().query<SignatureEvent>(
      `SELECT v.id::text, v.event, v.signer_id AS "signerId", v.user_id AS "userId", u.name AS "userName", v.typed_name AS "typedName", v.consent_text AS "consentText", v.content_sha256 AS "contentSha256", v.ip_hash AS "ipHash", v.confirmed_by AS "confirmedBy", v.user_agent AS "userAgent", v.reason, v.happened_at AS "happenedAt", v.seal
       FROM signature_events v JOIN "user" u ON u.id = v.user_id WHERE v.request_id = $1 ORDER BY v.id`, [id],
    ),
  ]);
  let previous = "";
  let chained = true;
  for (const event of events.rows) {
    chained &&= sealEvent(previous, { ...event, requestId: id }) === event.seal && (event.contentSha256 === null || event.contentSha256 === row.sha256);
    previous = event.seal;
  }
  const signed = (signer: Signer) => Boolean(signer.signedAt);
  const contentMatches = row.sha256 === null ? row.sentAt === null : digest(row.body ?? row.file!) === row.sha256;
  const next = row.state === "pending" ? signers.rows.find((signer) => !signed(signer)) : undefined;
  const mySigner = signers.rows.find((signer) => signer.kind === "company" ? signer.userId === member.id : signer.employeeId === member.employeeId) ?? null;
  const preview = row.state === "draft" && row.draftBody !== null ? await render(pool(), row.employeeId, row.draftBody) : null;
  return {
    id: row.id, title: row.title, employeeId: row.employeeId, employeeName: row.employeeName, state: row.state, version: row.version, sentAt: row.sentAt, draftBody: row.draftBody, starter: row.starter,
    body: preview?.body ?? row.body, hasFile: Boolean(row.file), sha256: row.sha256, missing: preview?.missing ?? [], signers: signers.rows, events: events.rows, mySigner, myTurn: Boolean(mySigner && next?.id === mySigner.id),
    intact: contentMatches && chained && (row.state !== "completed" || signers.rows.every(signed)) && (row.sentAt === null || events.rows.some((event) => event.event === "sent")),
    openedFile: Boolean(mySigner && events.rows.some((event) => event.event === "opened" && event.signerId === mySigner.id)), signAs: mySigner?.name ?? "",
  };
}

export async function readSignatureFile(member: Member, id: string) {
  const { rows } = await pool().query<{ title: string; file: Buffer; state: SignatureState; opened: boolean; signerId: string | null }>(
    `SELECT r.title, c.file, r.state, s.id AS "signerId", EXISTS (SELECT 1 FROM signature_events v WHERE v.signer_id = s.id AND v.event = 'opened') AS opened
     FROM signature_requests r JOIN signature_contents c ON c.request_id = r.id AND c.file IS NOT NULL
     LEFT JOIN signature_signers s ON s.request_id = r.id AND (s.user_id = $3 OR s.employee_id = $4) WHERE r.id = $1 AND ${canRead} LIMIT 1`, [id, ...access(member)],
  );
  const document = rows[0];
  if (!document) return null;
  if (document.signerId && document.state === "pending" && !document.opened) await runAsMember(member, async (client) => {
    await readOpen(client, id, ["pending"]);
    await appendEvent(client, { requestId: id, signerId: document.signerId, event: "opened", userId: member.id });
  });
  return document;
}

const rowColumns = `r.id, r.title, r.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", r.state, r.created_at AS "createdAt", r.sent_at AS "sentAt", r.closed_at AS "closedAt",
  CASE WHEN next.kind = 'employee' THEN concat_ws(' ', e.first_name, e.last_name) ELSE nu.name END AS "waitingFor"`;
const rowFrom = `FROM signature_requests r JOIN employees e ON e.id = r.employee_id ${nextSigner} LEFT JOIN "user" nu ON nu.id = next.user_id`;

export async function listSignatures(member: Member, filter: "open" | "closed", limit = 100) {
  const { rows } = await pool().query<SignatureRow>(
    `SELECT ${rowColumns} ${rowFrom} WHERE (r.state IN ('draft', 'pending')) = $1 AND ${canRead} ORDER BY coalesce(r.closed_at, r.created_at) DESC, r.id LIMIT $5`, [filter === "open", ...access(member), limit],
  );
  return rows;
}

export async function employeeSignatures(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return [];
  const { rows } = await pool().query<SignatureRow>(
    `SELECT ${rowColumns} ${rowFrom} WHERE r.employee_id = $1 AND r.state <> 'voided' AND ${canRead} ORDER BY r.created_at DESC, r.id LIMIT 60`, [employeeId, ...access(member)],
  );
  return rows;
}

export async function signaturesToSign(member: Member) {
  const { rows } = await pool().query<SignatureRow>(
    `SELECT ${rowColumns} ${rowFrom} WHERE r.state = 'pending' AND e.status <> 'archived' AND (next.user_id = $1 OR next.employee_id = $2) ORDER BY r.sent_at, r.id LIMIT 20`, [member.id, member.employeeId],
  );
  return rows;
}

// Drafts nobody has sent, and documents that have waited more than a week.
export async function stuckSignatures(member: Member) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<SignatureRow>(
    `SELECT ${rowColumns} ${rowFrom} WHERE e.status <> 'archived' AND (r.state = 'draft' OR r.state = 'pending'
     AND (SELECT max(v.happened_at) FROM signature_events v WHERE v.request_id = r.id AND v.event IN ('sent', 'signed')) < $1::date) ORDER BY r.created_at, r.id LIMIT 20`, [addDays(today(), -7)],
  );
  return rows;
}
