"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { customFieldCommandFields, customFieldFields } from "@/lib/domains/records";
import { saveCustomField, setCustomFieldArchived } from "@/lib/server/custom-fields";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";

export async function saveCustomFieldAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, customFieldFields, data, async (member, input) => { await saveCustomField(member, input); return { redirect: "/workspace/settings/fields?saved=field" }; });
}

export async function customFieldCommandAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, customFieldCommandFields, data, (member, input) => setCustomFieldArchived(member, input.id, input.operation === "archive"));
}
