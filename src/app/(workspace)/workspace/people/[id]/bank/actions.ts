"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { bankFields } from "@/lib/domains/pay";
import { saveBankDetails } from "@/lib/server/bank";
import { requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";

export async function saveBankAction(_state: ActionState, data: FormData) {
  return perform(requireMember, bankFields, data, async (member, input) => { await saveBankDetails(member, input); return { redirect: `/workspace/people/${input.employeeId}/bank?saved=1` }; });
}
