"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { createTokenAction } from "@/app/(workspace)/workspace/settings/api/actions";
import { replaceSecretAction, saveWebhookAction } from "@/app/(workspace)/workspace/settings/webhooks/actions";
import { CopyButton } from "@/components/marketing/copy-button";
import { textButton } from "@/components/ui";
import { eventScope, scopeLabels, scopes, sensitiveScopes, webhookFormats, type WebhookFormat } from "@/lib/domains/platform";
import { ActionForm, Field, type FormAction } from "./action-form";

function OneTimeSecret({ title, value, note }: { title: string; value: string; note: string }) {
  return <div role="status" className="rounded-[10px] border border-line-strong bg-background p-4 text-sm">
    <p className="font-medium">{title}</p>
    <div className="mt-1 flex flex-wrap items-center gap-2"><code className="font-mono wrap-anywhere select-all">{value}</code><CopyButton text={value} label={`Copy ${title.toLowerCase()}`} /></div>
    <p className="mt-1 text-muted">{note}</p>
  </div>;
}

function Choices({ name, legend, hint, choices, error, selected = [] }: { name: string; legend: string; hint?: string; choices: { value: string; label: string; detail?: string }[]; error?: string; selected?: string[] }) {
  const id = useId();
  return <fieldset aria-describedby={hint ? `${id}-hint` : undefined} className="min-w-0">
    <legend className="text-sm font-medium">{legend}</legend>
    {hint && <p id={`${id}-hint`} className="text-[13px] text-muted">{hint}</p>}
    {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">{choices.map((choice) => <label key={choice.value} className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" name={name} value={choice.value} defaultChecked={selected.includes(choice.value)} className="mt-0.5 size-[18px] shrink-0 accent-(--primary)" />
      <span className="min-w-0 wrap-anywhere">{choice.label}{choice.detail && <span className="block text-[13px] text-muted">{choice.detail}</span>}</span>
    </label>)}</div>
  </fieldset>;
}

export function TokenForm() {
  const [token, setToken] = useState<string>();
  const [scopeError, setScopeError] = useState<string>();
  const action: FormAction = async (state, data) => {
    const result = await createTokenAction(state, data);
    setToken(result.token);
    setScopeError(result.fields?.scopes?.[0]);
    return result;
  };
  return <div className="grid gap-5">
    {token && <OneTimeSecret title="API token" value={token} note="It’s shown once. Store it where the script or agent can read it." />}
    <ActionForm action={action} submit="Create token" pending="Creating…" secondary={<Link href="/workspace/settings/api" className={textButton}>Close</Link>}>
      <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Name" required maxLength={80} hint="What will use it, such as Payroll sync." autoComplete="off" /><Field name="expiresIn" label="Expires" required defaultValue="90" options={[{ value: "30", label: "In 30 days" }, { value: "90", label: "In 90 days" }, { value: "365", label: "In a year" }, { value: "never", label: "Never" }]} /></div>
      <Choices name="scopes" legend="Scopes" hint="Give it only what it needs." error={scopeError} choices={scopes.map((scope) => ({ value: scope, label: scopeLabels[scope], detail: sensitiveScopes.has(scope) ? `${scope}, sensitive` : scope }))} />
    </ActionForm>
  </div>;
}

type Editable = { id: string; version: number; name: string; host: string; format: WebhookFormat; events: string[] };

export function WebhookForm({ labels, webhook }: { labels: Record<string, string>; webhook?: Editable }) {
  const [created, setCreated] = useState<{ id: string; secret: string }>();
  const action: FormAction = async (state, data) => {
    const result = await saveWebhookAction(state, data);
    if (result.secret && result.id) setCreated({ id: result.id, secret: result.secret });
    return result;
  };
  if (created) return <div className="grid gap-4">
    <OneTimeSecret title="Signing secret" value={created.secret} note="It’s shown once. Use it to check that a request came from this workspace." />
    <Link href={`/workspace/settings/webhooks/${created.id}`} className="text-sm text-accent underline underline-offset-3">Open the webhook</Link>
  </div>;
  return <ActionForm action={action} submit={webhook ? "Save webhook" : "Add webhook"} hidden={webhook ? { id: webhook.id, version: webhook.version } : undefined} secondary={<Link href={webhook ? `/workspace/settings/webhooks/${webhook.id}` : "/workspace/settings/webhooks"} className={textButton}>Close</Link>}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Name" required maxLength={80} defaultValue={webhook?.name} autoComplete="off" />
      <Field name="format" label="Format" required defaultValue={webhook?.format ?? "openwarp"} options={Object.entries(webhookFormats).map(([value, label]) => ({ value, label }))} />
    </div>
    <Field name="url" label={webhook ? "New URL" : "URL"} type="url" required={!webhook} maxLength={1000} autoComplete="off" hint={webhook ? `Leave empty to keep the one at ${webhook.host}.` : "An https:// address that can be reached from the internet."} />
    <Choices name="events" legend="Events" hint="Choose none to send every general event. Sensitive events are about pay, benefits, personal details, documents, time or expenses, and are sent only when chosen." choices={Object.entries(labels).map(([value, label]) => ({ value, label, detail: eventScope(value) ? `${value}, sensitive` : value }))} selected={webhook?.events} />
  </ActionForm>;
}

export function SecretReplacement({ id }: { id: string }) {
  const [secret, setSecret] = useState<string>();
  const action: FormAction = async (state, data) => {
    const result = await replaceSecretAction(state, data);
    if (result.secret) setSecret(result.secret);
    return result;
  };
  return <div className="grid gap-3">
    {secret && <OneTimeSecret title="Signing secret" value={secret} note="It’s shown once. The previous secret no longer signs anything." />}
    <ActionForm action={action} submit="Create new secret" variant="secondary" hidden={{ id }} confirm={{ title: "Replace the signing secret?", body: "Requests are signed with the new secret at once. Update your system right away.", action: "Replace secret", danger: true }}>{null}</ActionForm>
  </div>;
}
