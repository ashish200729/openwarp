"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { journalFields, nachaFields, paySettingsFields, ruleFields, sepaFields } from "@/lib/domains/pay";
import { requireAdmin } from "@/lib/server/member";
import { saveJournal, saveNacha, savePaySettings, saveRule, saveSepa } from "@/lib/server/payroll-rules";
import { perform } from "@/lib/server/perform";

export async function saveRuleAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, ruleFields, data, async (member, input) => { await saveRule(member, input); return input.id ? undefined : { redirect: "/workspace/settings/pay?saved=rule" }; });
}

export async function savePaySettingsAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, paySettingsFields, data, (member, input) => savePaySettings(member, input));
}

export async function saveNachaAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, nachaFields, data, (member, input) => saveNacha(member, input));
}

export async function saveSepaAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, sepaFields, data, (member, input) => saveSepa(member, input));
}

export async function saveJournalAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, journalFields, data, (member, input) => saveJournal(member, input));
}
