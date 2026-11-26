import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { SignOutButton } from "@/components/workspace/auth-controls";
import { TwoFactorPanel } from "@/components/workspace/platform-two-factor";
import { currentMember, pendingStep } from "@/lib/server/member";
import { readTwoFactor } from "@/lib/server/two-factor";
import { verifyAction } from "./actions";

export const metadata: Metadata = { title: "Two-factor sign-in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TwoFactorPage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  if (pendingStep(member) !== "/two-factor") redirect(pendingStep(member) ?? "/workspace");
  const verifying = member.twoFactor === "verify";
  const { method } = await readTwoFactor(member);
  return <main id="main" tabIndex={-1} className="mx-auto grid min-h-dvh max-w-sm content-center bg-surface px-5 py-12">
    <Brand />
    <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.015em]">{verifying ? "Enter your code" : "Set up two-factor sign-in"}</h1>
    <p className="mt-1 mb-4 text-sm leading-relaxed text-muted">{verifying ? "Open your authenticator app and enter the current code. A backup code works too." : "Your workspace requires a second step when you sign in. You need an authenticator app."}</p>
    {verifying ? <ActionForm action={verifyAction} submit="Continue" pending="Checking…"><Field name="code" label="Code" required autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} autoFocus maxLength={30} className="font-mono" /></ActionForm>
      : <TwoFactorPanel enabled={false} required codesLeft={0} singleSignOn={method === "sso"} finish="/workspace" />}
    <div className="mt-3"><SignOutButton /></div>
  </main>;
}
