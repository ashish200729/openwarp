"use client";

import { useActionState } from "react";
import { invitationLinkAction } from "@/app/(workspace)/workspace/settings/access/actions";
import { CopyButton } from "@/components/marketing/copy-button";
import { FormError } from "./action-state";
import { SubmitButton } from "./buttons";

export function InviteLink({ userId, version, canCreate }: { userId: string; version: string | null; canCreate: boolean }) {
  const [state, action] = useActionState(invitationLinkAction, {});
  if (!canCreate && !version) return null;
  return <form action={action} className="mb-4 grid min-w-0 gap-2 sm:ml-11">
    <input type="hidden" name="userId" value={userId} />
    <input type="hidden" name="version" value={version ?? ""} />
    <div className="flex flex-wrap gap-2">{canCreate && <SubmitButton name="operation" value="create" variant="secondary" pending="Creating…">{version ? "Replace invitation link" : "Create invitation link"}</SubmitButton>}
      {version && <SubmitButton name="operation" value="revoke" variant="text" confirm={{ title: "Revoke this invitation link?", body: "The person will need a new link or their existing sign-in details.", action: "Revoke link", danger: true }}>Revoke link</SubmitButton>}</div>
    <FormError error={state.error} />
    {canCreate && state.link && state.version === version && <div role="status" className="min-w-0 rounded-lg border border-line bg-background p-3 text-sm">
      <p>Share privately with the invited person. This link works once and expires in seven days.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 font-mono text-xs wrap-anywhere select-all">{state.link}</code><CopyButton text={state.link} label="Copy invitation link" /></div>
    </div>}
    {state.message && <p role="status" className="text-sm text-muted">{state.message}</p>}
  </form>;
}
