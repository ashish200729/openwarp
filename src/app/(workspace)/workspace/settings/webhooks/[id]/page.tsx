import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { panelStyle, secondaryButton } from "@/components/ui";
import { ActionButtons } from "@/components/workspace/action-form";
import { SecretReplacement, WebhookForm } from "@/components/workspace/platform-secrets";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { activityLabels } from "@/lib/activity";
import { webhookFormats } from "@/lib/domains/platform";
import { formatTime } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";
import { readWebhook } from "@/lib/server/webhooks";
import { commandWebhookAction, resendDeliveryAction } from "../actions";
import { webhookStates } from "../states";

export const metadata: Metadata = { title: "Webhook" };

const deliveryStates = { pending: ["Waiting", "text-amber"], delivered: ["Delivered", "text-positive"], failed: ["Failed", "text-danger"] } as const;

export default async function WebhookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string }> }) {
  const member = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const found = z.uuid().safeParse(id).success ? await readWebhook(member, id) : null;
  if (!found) notFound();
  const { webhook, deliveries } = found;
  const state = webhookStates[webhook.state];
  const label = (event: string) => event in activityLabels ? activityLabels[event as keyof typeof activityLabels] : event === "routine.message" ? "Routine message" : "Test";
  return <>
    <BackLink href="/workspace/settings/webhooks">Webhooks</BackLink>
    <PageHeader title={webhook.name} description={`${webhook.host} · ${webhookFormats[webhook.format]}`} actions={query.edit !== "1" && <Link href={`/workspace/settings/webhooks/${id}?edit=1`} className={secondaryButton}>Edit</Link>} />
    {query.saved === "1" && <Notice>Webhook saved.</Notice>}
    <div className="grid max-w-3xl gap-10">
      {query.edit === "1" && <section className={`${panelStyle} p-5`}><h2 className="mb-4 text-[15px] font-semibold">Edit webhook</h2><WebhookForm key={webhook.version} labels={activityLabels} webhook={webhook} /></section>}
      <Section title="Status"><div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm">
        <p><span className={`font-medium ${state.color}`}>{state.label}.</span> <span className="text-muted">{webhook.state !== "active" ? "Matching events wait for up to 30 days. Turn on delivery to resume." : webhook.failures ? `${webhook.failures} failed ${webhook.failures === 1 ? "attempt" : "attempts"} in a row.` : webhook.events.length ? "Sends the events you chose." : "Sends every general event."}</span></p>
        <ActionButtons action={commandWebhookAction} hidden={{ id }} name="operation" buttons={[
          ...(webhook.state === "active" ? [{ value: "test", label: "Send a test", describe: "Send a test" }, { value: "pause", label: "Pause", describe: "Pause", variant: "text" as const }] : [{ value: "activate", label: "Turn on", describe: "Turn on" }]),
          { value: "delete", label: "Delete", describe: `Delete ${webhook.name}`, variant: "text" as const, confirm: { title: `Delete ${webhook.name}?`, body: "Its delivery log is deleted too.", action: "Delete webhook", danger: true } },
        ]} />
      </div></Section>
      <Section title="Signing secret"><div className="grid gap-3 pt-3 text-sm leading-relaxed">
        <p className="max-w-[65ch] text-muted">Each request has an OpenWarp-Signature header, <code className="font-mono text-foreground">t=time,v1=signature</code>. The signature is the hexadecimal HMAC-SHA256 of <code className="font-mono text-foreground">time.body</code> with this secret. Refuse requests with an old time.</p>
        <SecretReplacement id={id} />
      </div></Section>
      <Section title="Deliveries">{deliveries.length ? <ul className="divide-y divide-line">{deliveries.map((delivery) => {
        const [name, color] = deliveryStates[delivery.state];
        return <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
          <div className="min-w-0"><p className="font-medium wrap-anywhere">{label(delivery.event)} <span className="font-normal text-muted">{delivery.event}</span></p>
            <p className="wrap-anywhere text-muted">{formatTime(delivery.createdAt)} UTC{delivery.attempts > 0 && `, ${delivery.attempts} ${delivery.attempts === 1 ? "attempt" : "attempts"}`}{delivery.responseStatus !== null && `, answered ${delivery.responseStatus}`}{delivery.error && `. ${delivery.error}`}{delivery.state === "pending" && delivery.attempts > 0 && ` Next try ${formatTime(delivery.nextAttemptAt)} UTC.`}</p></div>
          <div className="flex items-center gap-3"><span className={`text-[13px] font-medium ${color}`}>{name}</span>{delivery.state !== "pending" && webhook.state === "active" && <ActionButtons action={resendDeliveryAction} hidden={{ id: delivery.id }} name="operation" buttons={[{ value: "resend", label: "Resend", describe: `Resend ${label(delivery.event)}, ${formatTime(delivery.createdAt)}`, variant: "text" }]} />}</div>
        </li>;
      })}</ul> : <Empty>Nothing has been sent yet. Deliveries are kept for 30 days.</Empty>}</Section>
    </div>
  </>;
}
