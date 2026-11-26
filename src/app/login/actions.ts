"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { ActionState } from "@/components/workspace/action-state";
import { forgotFields, resetFields } from "@/lib/domains/platform";
import { requestPasswordReset, setPasswordFromLink } from "@/lib/server/accounts";
import { hasWorkspaceConfig } from "@/lib/server/auth";
import { clientAddress, emailConfigured } from "@/lib/server/platform-settings";
import { failed, invalid } from "@/lib/server/write";

export async function forgotPasswordAction(_state: ActionState, data: FormData): Promise<ActionState> {
  if (!hasWorkspaceConfig() || !emailConfigured()) return { error: "Email isn’t set up. Contact your workspace administrator." };
  const input = forgotFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  const address = clientAddress(await headers());
  after(() => requestPasswordReset(input.data.email, address).catch((error) => console.error("OpenWarp could not queue a password reset", error instanceof Error ? error.name : "unknown")));
  return { message: "If that account exists, a link is on its way. It works for 30 minutes.", done: Date.now() };
}

export async function resetPasswordAction(_state: ActionState, data: FormData): Promise<ActionState> {
  if (!hasWorkspaceConfig()) return { error: "The workspace isn’t set up." };
  const input = resetFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    await setPasswordFromLink(input.data, clientAddress(await headers()));
  } catch (error) {
    return failed(error);
  }
  redirect("/login?saved=password");
}
