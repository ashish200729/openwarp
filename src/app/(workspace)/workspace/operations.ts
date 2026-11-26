"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import {
  accountCommandFields, accountFields, accountLinkFields, companyFields, compensationFields, decisionFields, expenseFields, holidayFields, payRunCommandFields,
  payRunFields, templateFields, timeOffFields, timeOffTypeFields, workDate,
} from "@/lib/operations";
import { createAccount, linkAccount, resetAccount, setAccountRole } from "@/lib/server/accounts";
import { acknowledgeDocument, archiveDocument, readUpload } from "@/lib/server/documents";
import { decideExpense, submitExpense } from "@/lib/server/expenses";
import { planImport, runImport, type ImportProblem } from "@/lib/server/import";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { addCompensation, commandPayRun, createPayRun } from "@/lib/server/pay";
import { addHoliday, addTemplate, removeHoliday, removeTemplate, saveCompany, saveTimeOffType } from "@/lib/server/settings";
import { decideTimeOff, requestTimeOff } from "@/lib/server/time-off";
import { perform } from "@/lib/server/perform";
import { failed, invalid } from "@/lib/server/write";

export async function requestTimeOffAction(_state: ActionState, data: FormData) {
  return perform(requireMember, timeOffFields, data, async (member, input) => { await requestTimeOff(member, input); return { redirect: "/workspace/time-off?saved=requested" }; });
}

export async function decideTimeOffAction(_state: ActionState, data: FormData) {
  return perform(requireMember, decisionFields, data, (member, input) => decideTimeOff(member, input));
}

export async function submitExpenseAction(_state: ActionState, data: FormData) {
  const receipt = data.get("receipt");
  data.delete("receipt");
  return perform(requireMember, expenseFields, data, async (member, input) => {
    await submitExpense(member, input, await readUpload(receipt));
    return { redirect: "/workspace/expenses?saved=submitted" };
  });
}

export async function decideExpenseAction(_state: ActionState, data: FormData) {
  return perform(requireMember, decisionFields, data, (member, input) => decideExpense(member, input));
}

export async function addCompensationAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, compensationFields, data, async (member, input) => { await addCompensation(member, input); return "Pay recorded."; });
}

export async function archiveDocumentAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, decisionFields.pick({ id: true }), data, (member, { id }) => archiveDocument(member, id));
}

export async function acknowledgeDocumentAction(_state: ActionState, data: FormData) {
  return perform(requireMember, decisionFields.pick({ id: true }), data, (member, { id }) => acknowledgeDocument(member, id));
}

export async function createPayRunAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, payRunFields, data, async (member, input) => ({ redirect: `/workspace/pay-runs/${await createPayRun(member, input)}` }));
}

export async function payRunCommandAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, payRunCommandFields, data, async (member, input) => {
    await commandPayRun(member, input);
    return { redirect: input.operation === "delete" ? "/workspace/pay-runs?saved=deleted" : `/workspace/pay-runs/${input.id}?saved=approved` };
  });
}

export async function saveCompanyAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, companyFields, data, (member, input) => saveCompany(member, input));
}

export async function saveTimeOffTypeAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, timeOffTypeFields, data, (member, input) => saveTimeOffType(member, input));
}

export async function addHolidayAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, holidayFields, data, async (member, input) => { await addHoliday(member, input); return "Holiday added."; });
}

export async function removeHolidayAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, holidayFields.pick({ day: true }).extend({ day: workDate }), data, (member, { day }) => removeHoliday(member, day));
}

export async function addTemplateAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, templateFields, data, async (member, input) => { await addTemplate(member, input); return "Task added."; });
}

export async function removeTemplateAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, decisionFields.pick({ id: true }), data, (member, { id }) => removeTemplate(member, id));
}

export type AccountState = ActionState & { password?: string; email?: string };

export async function createAccountAction(_state: AccountState, data: FormData): Promise<AccountState> {
  const member = await requireAdmin();
  const input = accountFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    const password = await createAccount(member, input.data);
    revalidatePath("/workspace", "layout");
    return { password, email: input.data.email, done: Date.now() };
  } catch (error) {
    return failed(error);
  }
}

export async function accountCommandAction(_state: AccountState, data: FormData): Promise<AccountState> {
  const member = await requireAdmin();
  const input = accountCommandFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  const { userId, operation } = input.data;
  try {
    const password = operation === "reset" ? await resetAccount(member, userId) : undefined;
    if (operation !== "reset") await setAccountRole(member, userId, operation);
    revalidatePath("/workspace", "layout");
    return { password, message: password ? undefined : "Access changed.", done: Date.now() };
  } catch (error) {
    return failed(error);
  }
}

export async function linkAccountAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, accountLinkFields, data, async (member, input) => { await linkAccount(member, input); return "Link saved."; });
}

export type ImportState = ActionState & { plan?: { people: number; newTeams: string[]; problems: ImportProblem[] } };

export async function importAction(_state: ImportState, data: FormData): Promise<ImportState> {
  const member = await requireAdmin();
  const text = data.get("csv");
  if (typeof text !== "string" || !text.trim()) return { error: "Choose a CSV file." };
  if (Buffer.byteLength(text, "utf8") > 1_000_000) return { error: "Choose a file of 1 MB or less." };
  let imported = 0;
  try {
    if (data.get("operation") !== "import") {
      const { rows, newTeams, problems } = await planImport(text);
      return { plan: { people: rows.length, newTeams, problems: problems.slice(0, 100) } };
    }
    imported = await runImport(member, text);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/people?imported=${imported}`);
}
