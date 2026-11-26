"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { policyFields } from "@/lib/domains/platform";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { savePolicy } from "@/lib/server/platform-settings";

export async function savePolicyAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, policyFields, data, async (member, input) => { await savePolicy(member, input); return { redirect: "/workspace/settings/security?saved=1" }; });
}
