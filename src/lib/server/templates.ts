import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { chosenTypes, type newHireDocumentFields, type SignerOrder, type signatureTemplateFields } from "@/lib/domains/records";
import type { DocumentCategory } from "@/lib/operations";
import type { EmploymentType } from "@/lib/people";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { audit, PeopleError, runAsAdmin } from "./write";

export type SignatureTemplate = {
  id: string; name: string; body: string; signatoryId: string | null; signatoryName: string | null; signerOrder: SignerOrder; includeNewHires: boolean; employmentTypes: EmploymentType[]; starter: boolean; archived: boolean; version: number;
};
export type NewHireDocument = { id: string; title: string; instructions: string; category: DocumentCategory; employmentTypes: EmploymentType[] };
export type Signatory = { id: string; name: string; role: "admin" | "viewer" };

const columns = `t.id, t.name, t.body, t.signatory_id AS "signatoryId", u.name AS "signatoryName", t.signer_order AS "signerOrder", t.include_new_hires AS "includeNewHires", t.employment_types AS "employmentTypes", t.starter, t.archived_at IS NOT NULL AS archived, t.version`;

export async function listSignatureTemplates(includeArchived = false) {
  await requireAdmin();
  const { rows } = await pool().query<SignatureTemplate>(
    `SELECT ${columns} FROM signature_templates t LEFT JOIN "user" u ON u.id = t.signatory_id WHERE t.archived_at IS NULL OR $1 ORDER BY t.archived_at IS NOT NULL, lower(t.name), t.id`, [includeArchived],
  );
  return rows;
}

export async function readSignatureTemplate(id: string) {
  await requireAdmin();
  const { rows } = await pool().query<SignatureTemplate>(`SELECT ${columns} FROM signature_templates t LEFT JOIN "user" u ON u.id = t.signatory_id WHERE t.id = $1 AND t.archived_at IS NULL`, [id]);
  return rows[0] ?? null;
}

// Accounts that can sign for the company.
export async function listSignatories() {
  await requireAdmin();
  const { rows } = await pool().query<Signatory>(`SELECT u.id, u.name, m.role FROM workspace_members m JOIN "user" u ON u.id = m.user_id WHERE m.role <> 'disabled' ORDER BY m.role, lower(u.name), u.id LIMIT 1000`);
  return rows;
}

export async function requireSignatory(client: PoolClient, signatoryId: string | null) {
  if (!signatoryId) return;
  const { rowCount } = await client.query("SELECT 1 FROM workspace_members WHERE user_id = $1 AND role <> 'disabled'", [signatoryId]);
  if (!rowCount) throw new PeopleError("Choose a company signatory with an active account.");
}

export function saveSignatureTemplate(member: Member, input: z.infer<typeof signatureTemplateFields>) {
  return runAsAdmin(member, async (client) => {
    await requireSignatory(client, input.signatoryId);
    const { rowCount: taken } = await client.query("SELECT 1 FROM signature_templates WHERE lower(name) = lower($1) AND archived_at IS NULL AND id IS DISTINCT FROM $2::uuid", [input.name, input.id || null]);
    if (taken) throw new PeopleError("A template with that name already exists.");
    const types = input.includeNewHires ? chosenTypes(input) : [];
    const values = [input.name, input.body, input.signatoryId, input.signerOrder, input.includeNewHires, types];
    if (input.id) {
      const { rows } = await client.query<{ starter: boolean }>("SELECT starter FROM signature_templates WHERE id = $1 AND version = $2 AND archived_at IS NULL", [input.id, input.version]);
      if (!rows[0]) throw new PeopleError("This template changed while you were editing. Reload it and try again.");
      const starter = rows[0].starter && !input.reviewed;
      if (starter && input.includeNewHires) throw new PeopleError("Have counsel review this starting point and tick the box to say so before sending it to every new hire.");
      await client.query(
        `UPDATE signature_templates SET name = $2, body = $3, signatory_id = $4, signer_order = $5, include_new_hires = $6, employment_types = $7, starter = $8, version = version + 1, updated_at = now() WHERE id = $1`, [input.id, ...values, starter],
      );
    } else await client.query("INSERT INTO signature_templates (name, body, signatory_id, signer_order, include_new_hires, employment_types) VALUES ($1, $2, $3, $4, $5, $6)", values);
    await audit(client, member, "template.saved", { detail: input.name });
  });
}

export function archiveSignatureTemplate(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ name: string }>("UPDATE signature_templates SET archived_at = now(), include_new_hires = false, version = version + 1 WHERE id = $1 AND archived_at IS NULL RETURNING name", [id]);
    if (!rows[0]) throw new PeopleError("This template is already archived.");
    await audit(client, member, "template.archived", { detail: rows[0].name });
  });
}

export async function listNewHireDocuments() {
  await requireAdmin();
  const { rows } = await pool().query<NewHireDocument>(`SELECT id, title, instructions, category, employment_types AS "employmentTypes" FROM new_hire_documents ORDER BY created_at, id`);
  return rows;
}

export function addNewHireDocument(member: Member, input: z.infer<typeof newHireDocumentFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("INSERT INTO new_hire_documents (title, instructions, category, employment_types) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [input.title, input.instructions, input.category, chosenTypes(input)]);
    if (!rowCount) throw new PeopleError("New hires are already asked for that document.");
    await audit(client, member, "settings.updated", { detail: `New hire document added: ${input.title}` });
  });
}

export function removeNewHireDocument(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ title: string }>("DELETE FROM new_hire_documents WHERE id = $1 RETURNING title", [id]);
    if (rows[0]) await audit(client, member, "settings.updated", { detail: `New hire document removed: ${rows[0].title}` });
  });
}
