"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { commandFields, decideFields, dependentFields, electionFields, endFields, eventFields, newHireFields, planFields, rateFields, windowFields } from "@/lib/domains/pay";
import { addDependent, addRate, closeNotice, decideElection, decideEvent, endElection, openEnrollment, removeDependent, reportEvent, restoreCoverage, savePlan, submitElection } from "@/lib/server/benefits";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { saveNewHireDays } from "@/lib/server/payroll-rules";
import { perform } from "@/lib/server/perform";

export async function savePlanAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, planFields, data, async (member, input) => { await savePlan(member, input); return input.id ? undefined : { redirect: "/workspace/settings/benefits?saved=plan" }; });
}

export async function addRateAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, rateFields, data, async (member, input) => { await addRate(member, input); return "Cost saved."; });
}

export async function openEnrollmentAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, windowFields, data, async (member, input) => { await openEnrollment(member, input); return "Enrollment window saved."; });
}

export async function saveNewHireAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, newHireFields, data, (member, input) => saveNewHireDays(member, input));
}

export async function reportEventAction(_state: ActionState, data: FormData) {
  return perform(requireMember, eventFields, data, async (member, input) => { await reportEvent(member, input); return { redirect: `/workspace/people/${input.employeeId}/benefits?saved=event` }; });
}

export async function decideEventAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, decideFields, data, (member, input) => decideEvent(member, input));
}

export async function addDependentAction(_state: ActionState, data: FormData) {
  return perform(requireMember, dependentFields, data, async (member, input) => { await addDependent(member, input); return { redirect: `/workspace/people/${input.employeeId}/benefits?saved=dependent` }; });
}

export async function removeDependentAction(_state: ActionState, data: FormData) {
  return perform(requireMember, commandFields, data, (member, { id }) => removeDependent(member, id));
}

export async function submitElectionAction(_state: ActionState, data: FormData) {
  data.set("dependents", [...data.keys()].filter((key) => key.startsWith("dependent-")).map((key) => key.slice(10)).join(","));
  return perform(requireMember, electionFields, data, async (member, input) => { await submitElection(member, input); return "Sent for approval."; });
}

export async function decideElectionAction(_state: ActionState, data: FormData) {
  return perform(requireMember, decideFields, data, (member, input) => decideElection(member, input));
}

export async function endElectionAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, endFields, data, (member, input) => endElection(member, input));
}

export async function restoreCoverageAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, commandFields, data, (member, { id }) => restoreCoverage(member, id));
}

export async function closeNoticeAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, commandFields, data, (member, { id }) => closeNotice(member, id));
}
