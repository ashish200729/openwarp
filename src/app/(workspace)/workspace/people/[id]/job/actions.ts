"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { assignmentFields, endFields, garnishmentFields, recurringFields } from "@/lib/domains/pay";
import { requireAdmin } from "@/lib/server/member";
import { addGarnishment, addRecurring, assignRule, endPayItem } from "@/lib/server/payroll-rules";
import { perform } from "@/lib/server/perform";

export async function assignRuleAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, assignmentFields, data, (member, input) => assignRule(member, input));
}

export async function addRecurringAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, recurringFields, data, async (member, input) => { await addRecurring(member, input); return { redirect: `/workspace/people/${input.employeeId}/job#payroll` }; });
}

export async function endRecurringAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, endFields, data, (member, input) => endPayItem(member, "recurring_earnings", input));
}

export async function addGarnishmentAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, garnishmentFields, data, async (member, input) => { await addGarnishment(member, input); return { redirect: `/workspace/people/${input.employeeId}/job#payroll` }; });
}

export async function endGarnishmentAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, endFields, data, (member, input) => endPayItem(member, "garnishments", input));
}
