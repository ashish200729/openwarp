"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import { accountCommandFields, accountFields, accountLinkFields, compensationFields, decisionFields, expenseFields, payRunCommandFields, payRunFields, timeOffFields, timeOffTypeFields } from "@/lib/operations";
import { createAccount, linkAccount, resetAccount, setAccountRole } from "@/lib/server/accounts";
import { readUpload } from "@/lib/server/documents";
import { decideExpense, submitExpense } from "@/lib/server/expenses";
import { requireAdmin, requireMember } from "@/lib/server/member";
import { addCompensation, commandPayRun, createPayRun } from "@/lib/server/pay";
import { saveTimeOffType } from "@/lib/server/settings";
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

export async function createPayRunAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, payRunFields, data, async (member, input) => ({ redirect: `/workspace/pay-runs/${await createPayRun(member, input)}` }));
}

export async function payRunCommandAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, payRunCommandFields, data, async (member, input) => {
    await commandPayRun(member, input);
    return { redirect: input.operation === "delete" ? "/workspace/pay-runs?saved=deleted" : `/workspace/pay-runs/${input.id}?saved=approved` };
  });
}

export async function saveTimeOffTypeAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, timeOffTypeFields, data, (member, input) => saveTimeOffType(member, input));
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
