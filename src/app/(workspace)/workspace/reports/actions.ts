"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { idField, plannedRoleFields, saveViewFields } from "@/lib/domains/workplace";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { removeView, savePlannedRole, saveView } from "@/lib/server/reports";

export async function savePlannedRoleAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, plannedRoleFields, data, async (member, input) => { await savePlannedRole(member, input); return input.id ? "Role saved." : "Role added."; });
}

export async function saveViewAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, saveViewFields, data, async (member, input) => { await saveView(member, input); return "View saved."; });
}

export async function removeViewAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, idField, data, (member, { id }) => removeView(member, id));
}
