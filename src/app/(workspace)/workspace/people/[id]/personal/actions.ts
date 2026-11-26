"use server";

import { z } from "zod";
import type { ActionState } from "@/components/workspace/action-state";
import type { RevealState } from "@/components/workspace/record-reveal";
import { changeDecisionFields, changeFields, contactCommandFields, contactFields, customValue, employeeField, idField, identityFields, personalFields, revealFields } from "@/lib/domains/records";
import { customValues, editableFields, saveCustomValues } from "@/lib/server/custom-fields";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { cancelChange, decideChange, removeContact, revealNationalId, saveContact, saveIdentity, savePersonal, submitChange } from "@/lib/server/personal";
import { failed, invalid } from "@/lib/server/write";

const back = (employeeId: string, saved: string) => ({ redirect: `/workspace/people/${employeeId}/personal?saved=${saved}` });

export async function savePersonalAction(_state: ActionState, data: FormData) {
  return perform(requireMember, personalFields, data, async (member, input) => { await savePersonal(member, input); return back(input.employeeId, "details"); });
}

export async function saveContactAction(_state: ActionState, data: FormData) {
  return perform(requireMember, contactFields, data, async (member, input) => { await saveContact(member, input); return back(input.employeeId, "contact"); });
}

export async function removeContactAction(_state: ActionState, data: FormData) {
  return perform(requireMember, contactCommandFields, data, (member, input) => removeContact(member, input));
}

export async function saveIdentityAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, identityFields, data, async (member, input) => { await saveIdentity(member, input); return back(input.employeeId, "identity"); });
}

export async function submitChangeAction(_state: ActionState, data: FormData) {
  return perform(requireMember, changeFields, data, async (member, input) => { await submitChange(member, input); return back(input.employeeId, "requested"); });
}

export async function cancelChangeAction(_state: ActionState, data: FormData) {
  return perform(requireMember, idField, data, (member, { id }) => cancelChange(member, id));
}

export async function decideChangeAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, changeDecisionFields, data, (member, input) => decideChange(member, input));
}

// The form follows the fields as they are defined now, so each answer is checked against its own type.
export async function saveCustomValuesAction(_state: ActionState, data: FormData) {
  const member = await requireMember();
  const target = employeeField.safeParse(Object.fromEntries(data));
  if (!target.success) return invalid(target.error);
  const fields = editableFields(member, await customValues(member, target.data.employeeId));
  const schema = employeeField.extend(Object.fromEntries(fields.map((field): [string, z.ZodType] => [`field_${field.id}`, customValue(field.kind, field.options)])));
  return perform(requireMember, schema, data, async (_member, input) => { await saveCustomValues(member, target.data.employeeId, input); return back(target.data.employeeId, "fields"); });
}

export async function revealAction(_state: RevealState, data: FormData): Promise<RevealState> {
  const member = await requireAdmin();
  const input = revealFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    return { value: await revealNationalId(member, input.data) };
  } catch (error) {
    return failed(error);
  }
}
