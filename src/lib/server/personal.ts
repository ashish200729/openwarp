import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import {
  addressKeys, changeLabels, changePhrases, maskId, proposals, type changeDecisionFields, type changeFields, type ChangeKind, type ChangeState, type contactFields, type identityFields, type personalFields, type WorkAuthorization,
} from "@/lib/domains/records";
import { seal, unseal } from "./crypto";
import { pool } from "./db";
import type { Member } from "./member";
import { notify } from "./notify";
import { audit, PeopleError, requireOwnEmployee, runAsAdmin, runAsMember, type Actor } from "./write";

export type Address = Partial<Record<(typeof addressKeys)[number], string>>;
export type EmergencyContact = { id: string; name: string; relationship: string; phone: string; email: string };
export type ChangeRequest = { id: string; kind: ChangeKind; state: ChangeState; createdAt: Date; decidedAt: Date | null; requestedBy: string; decidedBy: string | null; proposed: string | null; proposedExpiry: string | null };
export type FieldChange = { id: string; field: string; source: "self" | "admin" | "request"; by: string; at: Date };
type SealedField = "date_of_birth" | "address" | "national_id" | "change_request";
type Row = {
  preferredName: string; pronouns: string; personalEmail: string; phone: string; birth: Buffer | null; address: Buffer | null; nationalId: Buffer | null;
  workAuthorization: WorkAuthorization | null; workAuthorizationExpiresOn: string | null; version: number;
};

const none: Row = { preferredName: "", pronouns: "", personalEmail: "", phone: "", birth: null, address: null, nationalId: null, workAuthorization: null, workAuthorizationExpiresOn: null, version: 0 };
const context = (employeeId: string, field: SealedField) => `${employeeId}:${field}`;
const sealField = (value: string, employeeId: string, field: SealedField) => value ? seal(value, context(employeeId, field)) : null;
const openField = (sealed: Buffer | null, employeeId: string, field: SealedField) => sealed ? unseal(sealed, context(employeeId, field)) : "";
const openAddress = (sealed: Buffer | null, employeeId: string): Address => sealed ? JSON.parse(openField(sealed, employeeId, "address")) : {};

async function readRow(client: Pick<PoolClient, "query">, employeeId: string) {
  const { rows } = await client.query<Row>(
    `SELECT preferred_name AS "preferredName", pronouns, personal_email AS "personalEmail", phone, date_of_birth_sealed AS birth, address_sealed AS address, national_id_sealed AS "nationalId",
     work_authorization AS "workAuthorization", to_char(work_authorization_expires_on, 'YYYY-MM-DD') AS "workAuthorizationExpiresOn", version FROM employee_personal WHERE employee_id = $1`, [employeeId],
  );
  return rows[0] ?? none;
}

// The person themself or an administrator, on a record that isn't archived.
export async function requireRecordOwner(client: PoolClient, actor: Actor, employeeId: string): Promise<"self" | "admin"> {
  if (actor.role !== "admin") {
    if (await requireOwnEmployee(client, actor) !== employeeId) throw new PeopleError("You can only change your own details.");
    return "self";
  }
  const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [employeeId]);
  if (!rowCount) throw new PeopleError("Archived profiles are read-only.");
  return actor.employeeId === employeeId ? "self" : "admin";
}

export async function recordChanges(client: PoolClient, member: Member, employeeId: string, source: FieldChange["source"], fields: string[]) {
  if (!fields.length) return;
  await client.query("INSERT INTO employee_field_changes (employee_id, field, source, changed_by) SELECT $1, field, $2, $3 FROM unnest($4::text[]) AS field", [employeeId, source, member.id, fields]);
  await audit(client, member, "personal.updated", { employeeId, detail: fields.join(", ") });
}

export async function readPersonal(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return null;
  const [row, contacts, requests, history] = await Promise.all([
    readRow(pool(), employeeId),
    pool().query<EmergencyContact>("SELECT id, name, relationship, phone, email FROM emergency_contacts WHERE employee_id = $1 ORDER BY created_at, id", [employeeId]),
    pool().query<Omit<ChangeRequest, "proposed" | "proposedExpiry"> & { sealed: Buffer | null }>(
      `SELECT c.id, c.kind, c.state, c.created_at AS "createdAt", c.decided_at AS "decidedAt", u.name AS "requestedBy", d.name AS "decidedBy", c.proposal_sealed AS sealed
       FROM employee_change_requests c JOIN "user" u ON u.id = c.requested_by LEFT JOIN "user" d ON d.id = c.decided_by WHERE c.employee_id = $1 ORDER BY c.state <> 'pending', c.created_at DESC, c.id LIMIT 20`, [employeeId],
    ),
    pool().query<FieldChange>(
      `SELECT c.id::text, c.field, c.source, u.name AS by, c.created_at AS at FROM employee_field_changes c JOIN "user" u ON u.id = c.changed_by WHERE c.employee_id = $1 ORDER BY c.id DESC LIMIT 30`, [employeeId],
    ),
  ]);
  const nationalId = openField(row.nationalId, employeeId, "national_id");
  return {
    version: row.version, preferredName: row.preferredName, pronouns: row.pronouns, personalEmail: row.personalEmail, phone: row.phone,
    dateOfBirth: openField(row.birth, employeeId, "date_of_birth"), address: openAddress(row.address, employeeId), maskedId: nationalId && maskId(nationalId),
    workAuthorization: row.workAuthorization, workAuthorizationExpiresOn: row.workAuthorizationExpiresOn, contacts: contacts.rows, history: history.rows,
    requests: requests.rows.map(({ sealed, ...request }): ChangeRequest => ({ ...request, ...describeProposal(request.kind, sealed, employeeId) })),
  };
}

function describeProposal(kind: ChangeKind, sealed: Buffer | null, employeeId: string): Pick<ChangeRequest, "proposed" | "proposedExpiry"> {
  if (!sealed) return { proposed: null, proposedExpiry: null };
  const value = JSON.parse(openField(sealed, employeeId, "change_request"));
  if (kind === "legal_name") return { proposed: `${value.firstName} ${value.lastName}`, proposedExpiry: null };
  if (kind === "national_id") return { proposed: maskId(value.nationalId), proposedExpiry: null };
  return { proposed: value.workAuthorization, proposedExpiry: value.expiresOn };
}

export function savePersonal(member: Member, input: z.infer<typeof personalFields>) {
  return runAsMember(member, async (client, actor) => {
    const source = await requireRecordOwner(client, actor, input.employeeId);
    const row = await readRow(client, input.employeeId);
    if (row.version !== input.version) throw new PeopleError("These details changed while you were editing. Reload the page and try again.");
    const address = Object.fromEntries(addressKeys.flatMap((key) => input[key] ? [[key, input[key]]] : []));
    const before = openAddress(row.address, input.employeeId);
    const changed = [
      row.preferredName !== input.preferredName && "Preferred name", row.pronouns !== input.pronouns && "Pronouns", row.personalEmail !== input.personalEmail && "Personal email", row.phone !== input.phone && "Phone",
      openField(row.birth, input.employeeId, "date_of_birth") !== (input.dateOfBirth ?? "") && "Date of birth", addressKeys.some((key) => (before[key] ?? "") !== input[key]) && "Home address",
    ].filter((field) => field !== false);
    if (!changed.length) return;
    await client.query(
      `INSERT INTO employee_personal (employee_id, preferred_name, pronouns, personal_email, phone, date_of_birth_sealed, address_sealed) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (employee_id) DO UPDATE SET preferred_name = excluded.preferred_name, pronouns = excluded.pronouns, personal_email = excluded.personal_email, phone = excluded.phone,
       date_of_birth_sealed = excluded.date_of_birth_sealed, address_sealed = excluded.address_sealed, version = employee_personal.version + 1, updated_at = now()`,
      [input.employeeId, input.preferredName, input.pronouns, input.personalEmail, input.phone, sealField(input.dateOfBirth ?? "", input.employeeId, "date_of_birth"), sealField(Object.keys(address).length ? JSON.stringify(address) : "", input.employeeId, "address")],
    );
    await recordChanges(client, member, input.employeeId, source, changed);
  });
}

export function saveContact(member: Member, input: z.infer<typeof contactFields>) {
  return runAsMember(member, async (client, actor) => {
    await requireRecordOwner(client, actor, input.employeeId);
    if (input.id) {
      const { rowCount } = await client.query("UPDATE emergency_contacts SET name = $3, relationship = $4, phone = $5, email = $6 WHERE id = $1 AND employee_id = $2", [input.id, input.employeeId, input.name, input.relationship, input.phone, input.email]);
      if (!rowCount) throw new PeopleError("This contact was removed. Reload the page and try again.");
    } else {
      const { rows } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM emergency_contacts WHERE employee_id = $1", [input.employeeId]);
      if (rows[0].count >= 5) throw new PeopleError("Keep at most five emergency contacts. Remove one first.");
      await client.query("INSERT INTO emergency_contacts (employee_id, name, relationship, phone, email) VALUES ($1, $2, $3, $4, $5)", [input.employeeId, input.name, input.relationship, input.phone, input.email]);
    }
    await audit(client, member, "emergency_contact.saved", { employeeId: input.employeeId });
  });
}

export function removeContact(member: Member, input: { employeeId: string; id: string }) {
  return runAsMember(member, async (client, actor) => {
    await requireRecordOwner(client, actor, input.employeeId);
    const { rowCount } = await client.query("DELETE FROM emergency_contacts WHERE id = $1 AND employee_id = $2", [input.id, input.employeeId]);
    if (rowCount) await audit(client, member, "emergency_contact.removed", { employeeId: input.employeeId });
  });
}

async function storeIdentity(client: PoolClient, employeeId: string, identity: { nationalId: Buffer | null; workAuthorization: WorkAuthorization | null; expiresOn: string | null }) {
  await client.query(
    `INSERT INTO employee_personal (employee_id, national_id_sealed, work_authorization, work_authorization_expires_on) VALUES ($1, $2, $3, $4)
     ON CONFLICT (employee_id) DO UPDATE SET national_id_sealed = excluded.national_id_sealed, work_authorization = excluded.work_authorization,
     work_authorization_notified_at = CASE WHEN employee_personal.work_authorization_expires_on IS NOT DISTINCT FROM excluded.work_authorization_expires_on THEN employee_personal.work_authorization_notified_at END,
     work_authorization_expires_on = excluded.work_authorization_expires_on, version = employee_personal.version + 1, updated_at = now()`,
    [employeeId, identity.nationalId, identity.workAuthorization, identity.expiresOn],
  );
}

export function saveIdentity(member: Member, input: z.infer<typeof identityFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [input.employeeId]);
    if (!rowCount) throw new PeopleError("Archived profiles are read-only.");
    const row = await readRow(client, input.employeeId);
    if (row.version !== input.version) throw new PeopleError("These details changed while you were editing. Reload the page and try again.");
    const current = openField(row.nationalId, input.employeeId, "national_id");
    const next = input.nationalId || (input.removeNationalId ? "" : current);
    const changed = [next !== current && "National ID", (row.workAuthorization !== input.workAuthorization || row.workAuthorizationExpiresOn !== input.expiresOn) && "Work authorization"].filter((field) => field !== false);
    if (!changed.length) return;
    await storeIdentity(client, input.employeeId, { nationalId: sealField(next, input.employeeId, "national_id"), workAuthorization: input.workAuthorization, expiresOn: input.expiresOn });
    await client.query("INSERT INTO employee_field_changes (employee_id, field, source, changed_by) SELECT $1, field, 'admin', $2 FROM unnest($3::text[]) AS field", [input.employeeId, member.id, changed]);
    await audit(client, member, "identity.updated", { employeeId: input.employeeId, detail: changed.join(", ") });
  });
}

// Every look at a full national ID is recorded, so this is a write even though it only reads the record.
export function revealNationalId(member: Member, input: { employeeId: string; requestId: string }) {
  return runAsAdmin(member, async (client) => {
    let value = "";
    if (input.requestId) {
      const { rows } = await client.query<{ sealed: Buffer }>("SELECT proposal_sealed AS sealed FROM employee_change_requests WHERE id = $1 AND employee_id = $2 AND kind = 'national_id' AND state = 'pending'", [input.requestId, input.employeeId]);
      if (rows[0]) value = JSON.parse(openField(rows[0].sealed, input.employeeId, "change_request")).nationalId;
    } else value = openField((await readRow(client, input.employeeId)).nationalId, input.employeeId, "national_id");
    if (!value) throw new PeopleError("There is no national ID to show. Reload the page.");
    await audit(client, member, "identity.viewed", { employeeId: input.employeeId, detail: input.requestId ? "Requested change" : "" });
    return value;
  });
}

export function submitChange(member: Member, input: z.infer<typeof changeFields>) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    if (employeeId !== input.employeeId) throw new PeopleError("You can only ask to change your own record.");
    const { rowCount: waiting } = await client.query("SELECT 1 FROM employee_change_requests WHERE employee_id = $1 AND kind = $2 AND state = 'pending'", [employeeId, input.kind]);
    if (waiting) throw new PeopleError("You already have a request waiting for this. Cancel it to send a new one.");
    if (input.kind === "legal_name") {
      const { rowCount: same } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND first_name = $2 AND last_name = $3", [employeeId, input.firstName, input.lastName]);
      if (same) throw new PeopleError("That is already the name on your record.");
    }
    const proposal = proposals[input.kind].parse(input);
    await client.query("INSERT INTO employee_change_requests (employee_id, kind, proposal_sealed, requested_by) VALUES ($1, $2, $3, $4)", [employeeId, input.kind, sealField(JSON.stringify(proposal), employeeId, "change_request"), member.id]);
    await audit(client, member, "change_request.submitted", { employeeId, detail: changeLabels[input.kind] });
    await notify(client, member, { role: "admin" }, { kind: "request", title: `${member.name} asked to change their ${changePhrases[input.kind]}`, href: `/workspace/people/${employeeId}/personal` });
  });
}

async function pendingChange(client: PoolClient, id: string) {
  const { rows } = await client.query<{ employeeId: string; kind: ChangeKind; sealed: Buffer }>(
    `SELECT employee_id AS "employeeId", kind, proposal_sealed AS sealed FROM employee_change_requests WHERE id = $1 AND state = 'pending'`, [id],
  );
  if (!rows[0]) throw new PeopleError("This request was already decided.");
  return rows[0];
}

const closeChange = (client: PoolClient, member: Member, id: string, state: ChangeState) =>
  client.query("UPDATE employee_change_requests SET state = $2, proposal_sealed = NULL, decided_by = $3, decided_at = now() WHERE id = $1", [id, state, member.id]);

export function cancelChange(member: Member, id: string) {
  return runAsMember(member, async (client, actor) => {
    const change = await pendingChange(client, id);
    if (actor.employeeId !== change.employeeId) throw new PeopleError("You can only cancel your own requests.");
    await closeChange(client, member, id, "cancelled");
    await audit(client, member, "change_request.cancelled", { employeeId: change.employeeId, detail: changeLabels[change.kind] });
  });
}

// The version is the one the administrator was looking at: the employee record for a name, the personal record for the rest.
export function decideChange(member: Member, input: z.infer<typeof changeDecisionFields>) {
  return runAsAdmin(member, async (client) => {
    const { employeeId, kind, sealed } = await pendingChange(client, input.id);
    if (input.decision === "approved") {
      const { rows } = await client.query<{ version: number; status: string }>("SELECT version, status FROM employees WHERE id = $1", [employeeId]);
      if (rows[0].status === "archived") throw new PeopleError("Archived profiles are read-only.");
      const personal = await readRow(client, employeeId);
      if ((kind === "legal_name" ? rows[0].version : personal.version) !== input.version) throw new PeopleError("This record changed while you were looking at it. Reload the page and decide again.");
      const raw = JSON.parse(openField(sealed, employeeId, "change_request"));
      if (kind === "legal_name") {
        const { firstName, lastName } = proposals.legal_name.parse(raw);
        await client.query("UPDATE employees SET first_name = $2, last_name = $3, version = version + 1, updated_at = now() WHERE id = $1", [employeeId, firstName, lastName]);
      } else if (kind === "national_id") {
        const { nationalId } = proposals.national_id.parse(raw);
        await storeIdentity(client, employeeId, { nationalId: sealField(nationalId, employeeId, "national_id"), workAuthorization: personal.workAuthorization, expiresOn: personal.workAuthorizationExpiresOn });
      } else {
        // The stored proposal already went through the form's date rule, where an empty date is null.
        const proposal = proposals.work_authorization.parse({ ...raw, expiresOn: raw.expiresOn ?? "" });
        await storeIdentity(client, employeeId, { nationalId: personal.nationalId, workAuthorization: proposal.workAuthorization, expiresOn: proposal.expiresOn });
      }
      await client.query("INSERT INTO employee_field_changes (employee_id, field, source, changed_by) VALUES ($1, $2, 'request', $3)", [employeeId, changeLabels[kind], member.id]);
    }
    await closeChange(client, member, input.id, input.decision);
    await audit(client, member, `change_request.${input.decision}`, { employeeId, detail: changeLabels[kind] });
    await notify(client, member, { employeeId }, { title: `Your change was ${input.decision}`, body: changeLabels[kind], href: `/workspace/people/${employeeId}/personal` });
  });
}

export async function pendingChanges(member: Member) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<{ id: string; employeeId: string; employeeName: string; kind: ChangeKind }>(
    `SELECT c.id, c.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", c.kind FROM employee_change_requests c JOIN employees e ON e.id = c.employee_id
     WHERE c.state = 'pending' AND e.status <> 'archived' ORDER BY c.created_at, c.id LIMIT 20`,
  );
  return rows;
}

export async function expiringAuthorizations(member: Member, day: string, until: string) {
  const { rows } = await pool().query<{ employeeId: string; employeeName: string; expiresOn: string }>(
    `SELECT e.id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", to_char(p.work_authorization_expires_on, 'YYYY-MM-DD') AS "expiresOn"
     FROM employee_personal p JOIN employees e ON e.id = p.employee_id WHERE e.status <> 'archived' AND p.work_authorization_expires_on BETWEEN $1::date - 365 AND $2::date AND ($3 = 'admin' OR e.id = $4)
     ORDER BY p.work_authorization_expires_on, e.id LIMIT 20`, [day, until, member.role, member.employeeId],
  );
  return rows;
}
