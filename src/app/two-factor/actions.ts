"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import { enrollFields, twoFactorCommandFields, verifyFields } from "@/lib/domains/platform";
import { currentMember, requireMember } from "@/lib/server/member";
import { commandTwoFactor, confirmEnrollment, startEnrollment, verifySession, type Enrollment } from "@/lib/server/two-factor";
import { failed, invalid } from "@/lib/server/write";

export type EnrollmentState = ActionState & { enrollment?: Enrollment };
export type CodesState = ActionState & { codes?: string[] };

// Someone who still has to enroll can reach these before the rest of the workspace opens.
async function signedIn() {
  const member = await currentMember();
  if (!member) redirect("/login");
  return member;
}

export async function verifyAction(_state: ActionState, data: FormData): Promise<ActionState> {
  const member = await signedIn();
  if (member.twoFactor !== "verify") redirect("/workspace");
  const input = verifyFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    await verifySession(member, input.data.code);
  } catch (error) {
    return failed(error);
  }
  redirect("/workspace");
}

export async function startEnrollmentAction(_state: ActionState, data: FormData): Promise<EnrollmentState> {
  const member = await signedIn();
  const input = enrollFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    return { enrollment: await startEnrollment(member, input.data.password), done: Date.now() };
  } catch (error) {
    return failed(error);
  }
}

// Nothing is refreshed here, so the page that shows the backup codes stays until they are saved.
export async function confirmEnrollmentAction(_state: ActionState, data: FormData): Promise<CodesState> {
  const member = await signedIn();
  const input = verifyFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    return { codes: await confirmEnrollment(member, input.data.code) };
  } catch (error) {
    return failed(error);
  }
}

export async function commandTwoFactorAction(_state: ActionState, data: FormData): Promise<CodesState> {
  const member = await requireMember();
  const input = twoFactorCommandFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    const codes = await commandTwoFactor(member, input.data);
    if (codes) return { codes };
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace/account");
  return { message: "Two-factor sign-in is off.", done: Date.now() };
}
