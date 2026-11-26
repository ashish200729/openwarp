"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import { accountCommandFields, accountFields, accountLinkFields, decisionFields, timeOffFields, timeOffTypeFields } from "@/lib/operations";
import { createAccount, linkAccount, resetAccount, setAccountRole } from "@/lib/server/accounts";
import { requireAdmin, requireMember } from "@/lib/server/member";
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
