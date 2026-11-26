"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import { routineCommandFields, routineFields, routineRunFields } from "@/lib/domains/platform";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { commandRoutine, runRoutineNow, saveRoutine } from "@/lib/server/routines";
import { failed } from "@/lib/server/write";

export async function saveRoutineAction(_state: ActionState, data: FormData): Promise<ActionState> {
  const member = await requireAdmin();
  const text = (name: string) => data.get(name) ?? undefined;
  const optional = (name: string) => data.get(name) || null;
  const input = routineFields.safeParse({
    id: text("id"), version: text("version"), name: text("name"),
    trigger: { kind: text("triggerKind"), frequency: text("frequency"), time: text("time"), weekday: text("weekday"), monthDay: text("monthDay"), event: text("event"), date: text("date"), offset: text("offset") },
    conditions: { teamId: optional("teamId"), employmentType: optional("employmentType"), status: optional("status") },
    action: { kind: text("actionKind"), audience: text("audience"), title: text("title"), body: text("body"), endpointId: text("endpointId") },
  });
  if (!input.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of input.error.issues) (fields[String(issue.path.at(-1))] ??= []).push(issue.message);
    return { error: "Check the highlighted fields and try again.", fields };
  }
  let id: string;
  try {
    id = await saveRoutine(member, input.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/routines/${id}?saved=1`);
}

export async function commandRoutineAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, routineCommandFields, data, async (member, input) => {
    await commandRoutine(member, input);
    if (input.operation === "delete") return { redirect: "/workspace/routines?saved=deleted" };
    return input.operation === "activate" ? "Active." : "Back to draft.";
  });
}

export async function runRoutineAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, routineRunFields, data, async (member, input) => {
    const { done, skipped, failed: broken } = await runRoutineNow(member, input);
    return done + skipped + broken ? `${done} done, ${skipped} skipped${broken ? `, ${broken} failed` : ""}.` : "No one matches the conditions.";
  });
}
