"use server";

import { z } from "zod";
import type { ActionState } from "@/components/workspace/action-state";
import { requireMember } from "@/lib/server/member";
import { markNotificationsRead } from "@/lib/server/notify";
import { perform } from "@/lib/server/perform";

export async function markReadAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return perform(requireMember, z.object({}), data, async (member) => { await markNotificationsRead(member); return "All read."; });
}
