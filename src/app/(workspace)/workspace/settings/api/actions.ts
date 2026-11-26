"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/workspace/action-state";
import { tokenFields } from "@/lib/domains/platform";
import { createToken, revokeToken } from "@/lib/server/api-tokens";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { failed, invalid } from "@/lib/server/write";

export type TokenState = ActionState & { token?: string };

export async function createTokenAction(_state: ActionState, data: FormData): Promise<TokenState> {
  const member = await requireAdmin();
  const input = tokenFields.safeParse({ name: data.get("name"), expiresIn: data.get("expiresIn"), scopes: data.getAll("scopes") });
  if (!input.success) return invalid(input.error);
  try {
    const token = await createToken(member, input.data);
    revalidatePath("/workspace/settings/api");
    return { token, done: Date.now() };
  } catch (error) {
    return failed(error);
  }
}

export async function revokeTokenAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, z.object({ id: z.uuid() }), data, (member, { id }) => revokeToken(member, id));
}
