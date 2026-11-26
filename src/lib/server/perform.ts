import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import type { ActionState } from "@/components/workspace/action-state";
import type { Member } from "./member";
import { failed, invalid } from "./write";

export type Result = string | void | { redirect: string };

// The one path for form actions: check access, validate, run, map errors, refresh, then message or redirect.
export async function perform<Schema extends z.ZodType>(access: () => Promise<Member>, schema: Schema, data: FormData, run: (member: Member, input: z.infer<Schema>) => Promise<Result>): Promise<ActionState> {
  const member = await access();
  const input = schema.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  let result: Result;
  try {
    result = await run(member, input.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  if (typeof result === "object") redirect(result.redirect);
  return { message: result ?? "Saved.", done: Date.now() };
}
