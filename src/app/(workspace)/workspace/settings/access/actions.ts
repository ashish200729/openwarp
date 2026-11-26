"use server";

import type { ActionState } from "@/components/workspace/action-state";
import { accountSecurityFields } from "@/lib/domains/platform";
import { inviteAccount, unlinkSso } from "@/lib/server/accounts";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { signOutEverywhere } from "@/lib/server/sessions";
import { resetTwoFactor } from "@/lib/server/two-factor";
import { PeopleError } from "@/lib/server/write";

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
