import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { customValue, type customFieldFields, type CustomFieldKind, type FieldVisibility } from "@/lib/domains/records";
import { formatDate } from "@/lib/people";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { audit, PeopleError, runAsAdmin, runAsMember } from "./write";
import { recordChanges, requireRecordOwner } from "./personal";

export type CustomField = { id: string; label: string; kind: CustomFieldKind; options: string[]; visibility: FieldVisibility; employeeEditable: boolean; requiredForOnboarding: boolean; archived: boolean; version: number; used: number };
export type CustomValue = Omit<CustomField, "archived" | "version" | "used"> & { value: string };

const columns = `f.id, f.label, f.kind, f.options, f.visibility, f.employee_editable AS "employeeEditable", f.required_for_onboarding AS "requiredForOnboarding"`;

export async function listCustomFields() {
  await requireAdmin();
  const { rows } = await pool().query<CustomField>(
    `SELECT ${columns}, f.archived_at IS NOT NULL AS archived, f.version, (SELECT count(*)::int FROM custom_field_values v WHERE v.field_id = f.id) AS used
     FROM custom_fields f ORDER BY f.archived_at IS NOT NULL, f.position, f.id`,
  );
  return rows;
}

async function readValues(client: Pick<PoolClient, "query">, employeeId: string, visibilities: FieldVisibility[]) {
  const { rows } = await client.query<CustomValue>(
    `SELECT ${columns}, coalesce(v.value, '') AS value FROM custom_fields f LEFT JOIN custom_field_values v ON v.field_id = f.id AND v.employee_id = $1
     WHERE f.archived_at IS NULL AND f.visibility = ANY($2::text[]) ORDER BY f.position, f.id`, [employeeId, visibilities],
  );
  // A choice that was taken off the list stays valid for the people who already have it.
  return rows.map((row) => row.kind === "choice" && row.value && !row.options.includes(row.value) ? { ...row, options: [...row.options, row.value] } : row);
}

export async function customValues(member: Member, employeeId: string) {
  if (member.role === "admin") return readValues(pool(), employeeId, ["everyone", "private", "admin"]);
  return member.employeeId === employeeId ? readValues(pool(), employeeId, ["everyone", "private"]) : [];
}

// Fields anyone in the workspace may see on a current colleague's profile. Callers have already checked the profile itself.
export async function publicValues(employeeId: string) {
  return (await readValues(pool(), employeeId, ["everyone"])).filter((field) => field.value);
}

export function formatCustomValue(field: Pick<CustomValue, "kind" | "value">) {
  if (!field.value) return "";
  return field.kind === "boolean" ? (field.value === "yes" ? "Yes" : "No") : field.kind === "date" ? formatDate(field.value) : field.value;
}

export function editableFields(member: Member, fields: CustomValue[]) {
  return member.role === "admin" ? fields : fields.filter((field) => field.employeeEditable);
}

export function saveCustomValues(member: Member, employeeId: string, input: Record<string, unknown>) {
  return runAsMember(member, async (client, actor) => {
    const source = await requireRecordOwner(client, actor, employeeId);
    const fields = await readValues(client, employeeId, ["everyone", "private", "admin"]);
    const changed: string[] = [];
    for (const field of fields) {
      const entered = input[`field_${field.id}`];
      if (entered === undefined || source === "self" && (!field.employeeEditable || field.visibility === "admin")) continue;
      const parsed = customValue(field.kind, field.options).safeParse(entered);
      if (!parsed.success) throw new PeopleError(`Check ${field.label} and try again.`);
      const next = parsed.data as string;
      if (next === field.value) continue;
      if (next) await client.query("INSERT INTO custom_field_values (field_id, employee_id, value) VALUES ($1, $2, $3) ON CONFLICT (field_id, employee_id) DO UPDATE SET value = excluded.value, updated_at = now()", [field.id, employeeId, next]);
      else await client.query("DELETE FROM custom_field_values WHERE field_id = $1 AND employee_id = $2", [field.id, employeeId]);
      changed.push(field.label);
    }
    await recordChanges(client, member, employeeId, source, changed);
  });
}

export function saveCustomField(member: Member, input: z.infer<typeof customFieldFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount: taken } = await client.query("SELECT 1 FROM custom_fields WHERE lower(label) = lower($1) AND archived_at IS NULL AND id IS DISTINCT FROM $2::uuid", [input.label, input.id || null]);
    if (taken) throw new PeopleError("A field with that label already exists.");
    if (input.id) {
      const { rowCount } = await client.query(
        `UPDATE custom_fields SET label = $3, options = CASE WHEN kind = 'choice' THEN $4::text[] ELSE options END, visibility = $5, employee_editable = $6, required_for_onboarding = $7, version = version + 1
         WHERE id = $1 AND version = $2 AND kind = $8`, [input.id, input.version, input.label, input.options, input.visibility, input.employeeEditable, input.requiredForOnboarding, input.kind],
      );
      if (!rowCount) throw new PeopleError("This field changed while you were editing. Reload it and try again.");
    } else await client.query(
      `INSERT INTO custom_fields (label, kind, options, visibility, employee_editable, required_for_onboarding, position)
       SELECT $1, $2, $3::text[], $4, $5, $6, coalesce(max(position), 0) + 1 FROM custom_fields`, [input.label, input.kind, input.kind === "choice" ? input.options : [], input.visibility, input.employeeEditable, input.requiredForOnboarding],
    );
    await audit(client, member, "custom_field.saved", { detail: input.label });
  });
}

export function setCustomFieldArchived(member: Member, id: string, archive: boolean) {
  return runAsAdmin(member, async (client) => {
    if (!archive) {
      const { rowCount } = await client.query("SELECT 1 FROM custom_fields f JOIN custom_fields other ON lower(other.label) = lower(f.label) AND other.id <> f.id AND other.archived_at IS NULL WHERE f.id = $1", [id]);
      if (rowCount) throw new PeopleError("Another field uses this label now. Rename that one first.");
    }
    const { rows } = await client.query<{ label: string }>(
      "UPDATE custom_fields SET archived_at = CASE WHEN $2 THEN now() END, version = version + 1 WHERE id = $1 AND (archived_at IS NULL) = $2 RETURNING label", [id, archive],
    );
    if (!rows[0]) throw new PeopleError(archive ? "This field is already archived." : "This field is already in use.");
    await audit(client, member, archive ? "custom_field.archived" : "custom_field.restored", { detail: rows[0].label });
  });
}

export function exportCustomFields(member: Member) {
  return runAsAdmin(member, async (client) => {
    const { rows: fields } = await client.query<{ id: string; label: string; kind: CustomFieldKind }>("SELECT id, label, kind FROM custom_fields WHERE archived_at IS NULL ORDER BY position, id");
    const { rows: people } = await client.query<{ name: string; email: string; values: Record<string, string> }>(
      `SELECT concat_ws(' ', e.first_name, e.last_name) AS name, e.email, coalesce(jsonb_object_agg(v.field_id, v.value) FILTER (WHERE v.field_id IS NOT NULL), '{}') AS values
       FROM employees e LEFT JOIN custom_field_values v ON v.employee_id = e.id WHERE e.status <> 'archived' GROUP BY e.id ORDER BY lower(e.last_name), lower(e.first_name), e.id LIMIT 10000`,
    );
    await audit(client, member, "custom_field.exported", { detail: `${people.length} records` });
    return [["Name", "Work email", ...fields.map((field) => field.label)], ...people.map((person) => [person.name, person.email, ...fields.map((field) => {
      const value = person.values[field.id] ?? "";
      return field.kind === "boolean" && value ? (value === "yes" ? "Yes" : "No") : value;
    })])];
  });
}
