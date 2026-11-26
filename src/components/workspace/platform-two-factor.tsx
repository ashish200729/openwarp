"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { commandTwoFactorAction, confirmEnrollmentAction, startEnrollmentAction } from "@/app/two-factor/actions";
import { CopyButton } from "@/components/marketing/copy-button";
import { primaryButton } from "@/components/ui";
import type { Enrollment } from "@/lib/server/two-factor";
import { ActionForm, Field, type FormAction } from "./action-form";

type PanelProps = { enabled: boolean; required: boolean; codesLeft: number; singleSignOn: boolean; finish?: string };

// The secret and the backup codes live here only, so they are gone after a reload.
export function TwoFactorPanel({ enabled, required, codesLeft, singleSignOn, finish }: PanelProps) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [codes, setCodes] = useState<string[]>();
  const password = <Field name="password" label="Your password" type="password" required={!singleSignOn} maxLength={128} autoComplete="current-password" wrapperClass="max-w-sm" hint={singleSignOn ? "Leave it empty if you signed in with single sign-on in the last 10 minutes." : undefined} />;

  const start: FormAction = async (state, data) => {
    const result = await startEnrollmentAction(state, data);
    if (result.enrollment) setEnrollment(result.enrollment);
    return result;
  };
  const confirm: FormAction = async (state, data) => {
    const result = await confirmEnrollmentAction(state, data);
    if (result.codes) setCodes(result.codes);
    return result;
  };
  const command = (operation: "disable" | "codes"): FormAction => async (state, data) => {
    data.set("operation", operation);
    const result = await commandTwoFactorAction(state, data);
    if (result.codes) setCodes(result.codes);
    return result;
  };

  function leave() {
    setEnrollment(undefined);
    setCodes(undefined);
    if (finish) window.location.replace(finish);
    else router.refresh();
  }

  if (codes) return <div className="grid gap-3 text-sm">
    <p className="font-medium">Save your backup codes</p>
    <p className="max-w-[60ch] text-muted">Each code signs you in once if you lose your device. They aren’t shown again.</p>
    <ul className="grid max-w-md grid-cols-1 gap-x-6 gap-y-1 rounded-[10px] border border-line bg-background p-4 font-mono sm:grid-cols-2">{codes.map((code) => <li key={code}>{code}</li>)}</ul>
    <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={leave} className={primaryButton}>I saved the codes</button><CopyButton text={codes.join("\n")} label="Copy backup codes" /></div>
  </div>;

  if (enrollment) return <div className="grid gap-4 text-sm">
    <p className="max-w-[60ch] text-muted">Scan this code with your authenticator app, or enter the key by hand. Then type the code the app shows.</p>
    <svg role="img" aria-label="QR code for your authenticator app" viewBox={`0 0 ${enrollment.qr.size} ${enrollment.qr.size}`} shapeRendering="crispEdges" className="size-52 rounded-[7px] border border-line"><rect width="100%" height="100%" fill="#fff" /><path d={enrollment.qr.path} fill="#000" /></svg>
    <div><p className="font-medium">Key</p><div className="flex flex-wrap items-center gap-2"><code className="font-mono wrap-anywhere select-all">{enrollment.secret}</code><CopyButton text={enrollment.secret.replaceAll(" ", "")} label="Copy key" /></div></div>
    <details><summary className="text-muted hover:text-foreground">Show the setup address</summary><code className="mt-2 block font-mono text-[13px] wrap-anywhere select-all">{enrollment.uri}</code></details>
    <ActionForm action={confirm} submit="Turn on" pending="Checking…"><Field name="code" label="Code from the app" required inputMode="numeric" autoComplete="one-time-code" maxLength={10} wrapperClass="max-w-40" className="font-mono" /></ActionForm>
  </div>;

  if (!enabled) return <ActionForm action={start} submit="Set up two-factor" pending="Starting…">{password}</ActionForm>;

  return <div className="grid gap-5 text-sm">
    <p><span className="font-medium text-positive">On.</span> <span className={codesLeft < 4 ? "text-amber" : "text-muted"}>{codesLeft} of 10 backup codes left.</span></p>
    <details><summary className="font-medium">Replace backup codes</summary><ActionForm action={command("codes")} submit="Create new codes" variant="secondary" className="pt-3">{password}<p className="text-muted">The codes you have now stop working.</p></ActionForm></details>
    {required ? <p className="text-muted">Your workspace requires two-factor sign-in, so it can’t be turned off.</p>
      : <details><summary className="font-medium">Turn off</summary><ActionForm action={command("disable")} submit="Turn off two-factor" variant="danger" className="pt-3">{password}<p className="text-muted">Your password alone will open your account.</p></ActionForm></details>}
  </div>;
}
