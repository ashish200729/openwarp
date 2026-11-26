"use server";

import { z } from "zod";
import type { ActionState } from "@/components/workspace/action-state";
import { sendTestEmail } from "@/lib/server/email";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";

export async function testEmailAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, z.object({ operation: z.literal("test") }), data, async (member) => { await sendTestEmail(member); return `Sent to ${member.email}.`; });
}
