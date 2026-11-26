"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/workspace/action-state";
import { accountSecurityFields } from "@/lib/domains/platform";
import { inviteAccount, revokeInvitation, shareInvitation, unlinkSso } from "@/lib/server/accounts";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { signOutEverywhere } from "@/lib/server/sessions";
import { resetTwoFactor } from "@/lib/server/two-factor";
import { failed, PeopleError } from "@/lib/server/write";

export async function accountSecurityAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, accountSecurityFields, data, async (member, { userId, operation }) => {
    if (userId === member.id) throw new PeopleError("Manage your own sign-in from My account.");
    if (operation === "sign_out") await signOutEverywhere(member, userId);
    if (operation === "reset_two_factor") await resetTwoFactor(member, userId);
    if (operation === "invite") await inviteAccount(member, userId);
    if (operation === "unlink_sso") await unlinkSso(member, userId);
    return { sign_out: "Signed out everywhere.", reset_two_factor: "Two-factor sign-in was reset.", invite: "Invitation queued.", unlink_sso: "Single sign-on was unlinked." }[operation];
  });
}

type LinkState = ActionState & { link?: string; version?: string };

export async function invitationLinkAction(_state: LinkState, data: FormData): Promise<LinkState> {
  const member = await requireAdmin();
  const id = data.get("userId");
  const operation = data.get("operation");
  const version = data.get("version");
  if (typeof version !== "string" || (version && !/^[a-f0-9]{24}$/.test(version))) return { error: "Reload the account before changing its invitation." };
  if (typeof id !== "string" || !id || id.length > 100 || member.id === id) return { error: "Choose another workspace account." };
  try {
    if (operation === "revoke") {
      await revokeInvitation(member, id, version || null);
      revalidatePath("/workspace/settings/access");
      return { message: "Invitation link revoked." };
    }
    if (operation !== "create") return { error: "Choose an invitation action." };
    const invitation = await shareInvitation(member, id, version || null);
    revalidatePath("/workspace/settings/access");
    return invitation;
  } catch (error) {
    revalidatePath("/workspace/settings/access");
    return failed(error);
  }
}
