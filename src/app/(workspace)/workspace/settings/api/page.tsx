import type { Metadata } from "next";
import Link from "next/link";
import { panelStyle, primaryButton, tableBody, tableHead } from "@/components/ui";
import { ActionButtons } from "@/components/workspace/action-form";
import { TokenForm } from "@/components/workspace/platform-secrets";
import { BackLink, Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { formatDate, formatTime } from "@/lib/people";
import { operations } from "@/lib/server/api";
import { listTokens } from "@/lib/server/api-tokens";
import { requireAdmin } from "@/lib/server/member";
import { workspaceOrigin } from "@/lib/server/platform-settings";
import { revokeTokenAction } from "./actions";

export const metadata: Metadata = { title: "API" };

const states = { active: ["Active", "text-positive"], expired: ["Expired", "text-muted"], revoked: ["Revoked", "text-muted"], suspended: ["Suspended", "text-amber"] } as const;

function Code({ children, label }: { children: string; label: string }) {
  return <pre tabIndex={0} role="region" aria-label={label} className="overflow-x-auto rounded-[10px] border border-line bg-background p-4 font-mono text-[13px] leading-relaxed">{children}</pre>;
}

export default async function ApiPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const member = await requireAdmin();
  const adding = (await searchParams).new === "1";
  const tokens = await listTokens(member);
  const origin = workspaceOrigin();
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="API" description="Scripts, agents and other systems use a token to work with this workspace." actions={!adding && <Link href="/workspace/settings/api?new=1" className={primaryButton}>Create a token</Link>} />
    <div className="grid max-w-3xl gap-10">
      {adding && <section className={`${panelStyle} p-5`}><h2 className="mb-4 text-[15px] font-semibold">Create a token</h2><TokenForm /></section>}
      <Section title="Tokens">{tokens.length ? <ul className="divide-y divide-line">{tokens.map((token) => {
        const [label, color] = states[token.state];
        return <li key={token.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3 text-sm">
          <div className="min-w-0 flex-1 basis-72"><p className="font-medium wrap-anywhere">{token.name} <code className="font-mono text-[13px] font-normal text-muted">{token.hint}…</code></p>
            <p className="wrap-anywhere text-muted">{token.scopes.join(", ")}</p>
            <p className="text-muted">Created by {token.createdBy} on {formatDate(token.createdAt)}. {token.expiresAt ? `Expires ${formatDate(token.expiresAt)}.` : "Doesn’t expire."} {token.lastUsedAt ? `Last used ${formatTime(token.lastUsedAt)} UTC.` : "Never used."}</p>
            {token.state === "suspended" && <p className="text-amber">The person who created it is no longer an administrator.</p>}</div>
          <div className="flex items-center gap-3"><span className={`text-[13px] font-medium ${color}`}>{label}</span>
            {token.revokedAt === null && <ActionButtons action={revokeTokenAction} hidden={{ id: token.id }} name="operation" buttons={[{ value: "revoke", label: "Revoke", describe: `Revoke ${token.name}`, variant: "text", confirm: { title: `Revoke ${token.name}?`, body: "Anything using it stops working at once. This can’t be undone.", action: "Revoke token", danger: true } }]} />}</div>
        </li>;
      })}</ul> : <Empty>No tokens yet.</Empty>}</Section>
      <Section title="Using the API"><div className="grid gap-4 pt-3 text-sm leading-relaxed">
        <p className="max-w-[65ch]">Send the token as a bearer token. A token acts as the administrator who created it, within its scopes, and every change it makes appears in Activity. Each token can make 120 requests a minute.</p>
        <Code label="Example request">{`curl ${origin}/api/v1/people?limit=20 \\\n  -H "Authorization: Bearer $OPENWARP_TOKEN"`}</Code>
        <p className="max-w-[65ch]">Lists return <code className="font-mono">data</code> and <code className="font-mono">next_cursor</code>. Errors return <code className="font-mono">{"{ error: { code, message } }"}</code>. Send an <code className="font-mono">Idempotency-Key</code> header with a POST to repeat it safely for 24 hours. Money is in cents. The <a href="/api/v1/openapi.json" className="text-accent underline underline-offset-3">OpenAPI document</a> has every field.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="API endpoints"><table className="w-full min-w-xl">
          <caption className="sr-only">Endpoints and the scope each one needs</caption>
          <thead className={tableHead}><tr><th scope="col">Request</th><th scope="col">What it does</th><th scope="col">Scope</th></tr></thead>
          <tbody className={tableBody}>{operations.map((entry) => <tr key={entry.name}><th scope="row" className="font-mono text-[13px] whitespace-nowrap">{entry.method} {entry.path}</th><td>{entry.summary}</td><td className="font-mono text-[13px] whitespace-nowrap">{entry.scope}</td></tr>)}</tbody>
        </table></div>
      </div></Section>
      <Section title="Agents"><div className="grid gap-3 pt-3 text-sm leading-relaxed">
        <p className="max-w-[65ch]">The same token connects an agent that speaks the Model Context Protocol. It sees only the tools its scopes allow.</p>
        <Code label="Model Context Protocol address">{`${origin}/api/mcp`}</Code>
      </div></Section>
      <Section title="Command line"><div className="grid gap-3 pt-3 text-sm leading-relaxed">
        <p className="max-w-[65ch]">The repository includes a client that needs only Node.</p>
        <Code label="Command line example">{`export OPENWARP_URL=${origin}\nexport OPENWARP_TOKEN=owt_…\nnode scripts/openwarp.mjs people list --status active`}</Code>
      </div></Section>
    </div>
  </>;
}
