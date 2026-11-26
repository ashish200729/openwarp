import type { Metadata } from "next";
import Link from "next/link";
import { panelStyle, primaryButton } from "@/components/ui";
import { WebhookForm } from "@/components/workspace/platform-secrets";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { activityLabels } from "@/lib/activity";
import { webhookFormats } from "@/lib/domains/platform";
import { requireAdmin } from "@/lib/server/member";
import { listWebhooks } from "@/lib/server/webhooks";
import { webhookStates } from "./states";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  const member = await requireAdmin();
  const query = await searchParams;
  const webhooks = await listWebhooks(member);
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Webhooks" description="OpenWarp posts to your own systems when something happens here." actions={query.new !== "1" && <Link href="/workspace/settings/webhooks?new=1" className={primaryButton}>Add a webhook</Link>} />
    {query.saved === "deleted" && <Notice>Webhook deleted.</Notice>}
    <div className="grid max-w-3xl gap-10">
      {query.new === "1" && <section className={`${panelStyle} p-5`}><h2 className="mb-4 text-[15px] font-semibold">Add a webhook</h2><WebhookForm labels={activityLabels} /></section>}
      <Section title="Endpoints">{webhooks.length ? <ul className="divide-y divide-line">{webhooks.map((webhook) => <li key={webhook.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3 text-sm">
        <div className="min-w-0"><Link href={`/workspace/settings/webhooks/${webhook.id}`} className="font-medium wrap-anywhere hover:underline">{webhook.name}</Link><p className="wrap-anywhere text-muted">{webhook.host} · {webhookFormats[webhook.format]} · {webhook.events.length ? `${webhook.events.length} ${webhook.events.length === 1 ? "event" : "events"}` : "General events"}</p></div>
        <span className={`text-[13px] font-medium ${webhookStates[webhook.state].color}`}>{webhookStates[webhook.state].label}</span>
      </li>)}</ul> : <Empty>No webhooks yet.</Empty>}</Section>
    </div>
  </>;
}
