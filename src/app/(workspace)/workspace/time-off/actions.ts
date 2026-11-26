"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { adjustmentFields, recordTimeOffFields } from "@/lib/domains/time";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { adjustBalance, recordTimeOff } from "@/lib/server/time-off";

export async function recordTimeOffAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, recordTimeOffFields, data, async (member, input) => { await recordTimeOff(member, input); return { redirect: "/workspace/time-off?saved=recorded" }; });
}

export async function adjustBalanceAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, adjustmentFields, data, async (member, input) => { await adjustBalance(member, input); return { redirect: `/workspace/people/${input.employeeId}/time-off?saved=adjusted` }; });
}
