"use server";

import { z } from "zod";
import type { ActionState } from "@/components/workspace/action-state";
import { earningFields, lineSaveFields, offCycleFields, payFileFields, ptoFields, removeEarningFields, runIdFields, runPersonFields } from "@/lib/domains/pay";
import { requireAdmin } from "@/lib/server/member";
import { addLineEarning, addPtoPayout, addRunPerson, createOffCycleRun, recalculateRun, removeLineEarning, removeRunPerson, reversePayRun, updatePayLine } from "@/lib/server/pay";
import { createPayFile } from "@/lib/server/pay-files";
import { perform } from "@/lib/server/perform";

export async function saveLineAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, lineSaveFields, data, async (member, input) => { await updatePayLine(member, input); return "Line saved."; });
}

export async function createOffCycleAction(_state: ActionState, data: FormData) {
  const people = [...data.keys()].filter((key) => key.startsWith("person-")).map((key) => key.slice(7));
  if (!people.length) { await requireAdmin(); return { error: "Choose at least one person." }; }
  data.set("people", people.join(","));
  return perform(requireAdmin, offCycleFields, data, async (member, input) => ({ redirect: `/workspace/pay-runs/${await createOffCycleRun(member, input)}` }));
}

export async function recalculateAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, runIdFields.extend({ operation: z.enum(["recalculate", "hours"]) }), data, (member, { id, operation }) => recalculateRun(member, id, operation === "hours"));
}

export async function addEarningAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, earningFields, data, async (member, input) => { await addLineEarning(member, input); return "Earning added."; });
}

export async function addPtoAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, ptoFields, data, (member, input) => addPtoPayout(member, input));
}

export async function removeEarningAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, removeEarningFields, data, (member, input) => removeLineEarning(member, input));
}

export async function addPersonAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, runPersonFields, data, async (member, input) => { await addRunPerson(member, input); return "Added to this run."; });
}

export async function removePersonAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, runPersonFields, data, (member, input) => removeRunPerson(member, input));
}

export async function reverseAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, runIdFields, data, async (member, { id }) => ({ redirect: `/workspace/pay-runs/${await reversePayRun(member, id)}` }));
}

export async function createFileAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, payFileFields, data, (member, input) => createPayFile(member, input));
}
