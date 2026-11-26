"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { preferenceFields, sessionCommandFields } from "@/lib/domains/platform";
import { savePreference } from "@/lib/server/email";
import { requireMember } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { revokeSessions } from "@/lib/server/sessions";

export async function sessionAction(_state: ActionState, data: FormData) {
  return perform(requireMember, sessionCommandFields, data, async (member, input) => {
    const count = await revokeSessions(member, input);
    return count === 1 ? "One session was signed out." : `${count} sessions were signed out.`;
  });
}

export async function preferenceAction(_state: ActionState, data: FormData) {
  return perform(requireMember, preferenceFields, data, (member, input) => savePreference(member, input.email));
}
