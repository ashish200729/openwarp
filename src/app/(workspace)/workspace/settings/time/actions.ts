"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { policyFields, trackingFields } from "@/lib/domains/time";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { savePolicy } from "@/lib/server/time-off";
import { saveTimeSettings } from "@/lib/server/timesheets";

export async function saveTrackingAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, trackingFields, data, async (member, input) => { await saveTimeSettings(member, input); return { redirect: "/workspace/settings/time?saved=tracking" }; });
}

export async function savePolicyAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, policyFields, data, async (member, input) => { await savePolicy(member, input); return { redirect: "/workspace/settings/time?saved=policy" }; });
}
