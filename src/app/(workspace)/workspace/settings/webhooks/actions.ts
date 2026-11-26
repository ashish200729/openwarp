"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/workspace/action-state";
import { deliveryCommandFields, webhookCommandFields, webhookFields, webhookSecretFields } from "@/lib/domains/platform";
import { requireAdmin } from "@/lib/server/member";
import { perform } from "@/lib/server/perform";
import { commandWebhook, replaceSecret, resendDelivery, saveWebhook } from "@/lib/server/webhooks";
import { failed, invalid } from "@/lib/server/write";

export type SecretState = ActionState & { secret?: string; id?: string };

export async function saveWebhookAction(_state: ActionState, data: FormData): Promise<SecretState> {
  const member = await requireAdmin();
  const text = (name: string) => data.get(name) ?? undefined;
  const input = webhookFields.safeParse({ id: text("id"), version: text("version"), name: text("name"), url: text("url"), format: text("format"), events: data.getAll("events") });
  if (!input.success) return invalid(input.error);
  let created: { id: string; secret: string } | null;
  try {
    created = await saveWebhook(member, input.data);
  } catch (error) {
    return failed(error);
  }
  revalidatePath("/workspace/settings/webhooks", "layout");
  if (created) return { ...created, done: Date.now() };
  redirect(`/workspace/settings/webhooks/${input.data.id}?saved=1`);
}

export async function replaceSecretAction(_state: ActionState, data: FormData): Promise<SecretState> {
  const member = await requireAdmin();
  const input = webhookSecretFields.safeParse(Object.fromEntries(data));
  if (!input.success) return invalid(input.error);
  try {
    return { secret: await replaceSecret(member, input.data.id), done: Date.now() };
  } catch (error) {
    return failed(error);
  }
}

export async function commandWebhookAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, webhookCommandFields, data, async (member, input) => {
    await commandWebhook(member, input);
    if (input.operation === "delete") return { redirect: "/workspace/settings/webhooks?saved=deleted" };
    return { pause: "Paused.", activate: "Turned on.", test: "Test queued. It appears below within a minute." }[input.operation];
  });
}

export async function resendDeliveryAction(_state: ActionState, data: FormData) {
  return perform(requireAdmin, deliveryCommandFields, data, async (member, { id }) => { await resendDelivery(member, id); return "Queued again."; });
}
