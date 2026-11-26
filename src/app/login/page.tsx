import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { repositoryUrl } from "@/components/brand";
import { secondaryButton, textLink } from "@/components/ui";
import { SignInForm } from "@/components/workspace/auth-controls";
import { FormError } from "@/components/workspace/action-state";
import { LoginFrame } from "@/components/workspace/platform-login-frame";
import { Notice } from "@/components/workspace/presentation";
import { hasWorkspaceConfig } from "@/lib/server/auth";
import { currentMember, workspaceName } from "@/lib/server/member";
import { emailConfigured, ssoConfigured, ssoLabel } from "@/lib/server/platform-settings";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ssoProblems: Record<string, string> = {
  unavailable: "Single sign-on is unavailable right now. Try again shortly.",
  expired: "That sign-in took too long or started in another browser. Try again.",
  refused: "Your identity provider didn’t confirm the sign-in.",
  account: "No workspace account matches that identity. Ask your workspace administrator for access.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ sso?: string; saved?: string }> }) {
  const configured = hasWorkspaceConfig();
  if (configured && await currentMember()) redirect("/workspace");
  const query = await searchParams;
  return <LoginFrame title="Sign in to OpenWarp">
    {configured ? <>
      <p className="mt-1 wrap-anywhere text-sm text-muted">{workspaceName()}</p>
      {query.saved === "password" && <div className="mt-5 -mb-5"><Notice>Password saved. Sign in with it.</Notice></div>}
      {query.sso && Object.hasOwn(ssoProblems, query.sso) && <div className="mt-5"><FormError error={ssoProblems[query.sso]} /></div>}
      <SignInForm />
      {ssoConfigured() && <div className="mt-4 grid gap-4">
        <p className="flex items-center gap-3 text-[13px] text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">or</p>
        {/* A plain link, so nothing prefetches it and starts a sign-in. */}
        <a href="/api/sso/start" className={`${secondaryButton} min-h-11!`}>Continue with {ssoLabel()}</a>
      </div>}
      <p className="mt-6 border-t border-line pt-5 text-[13px] leading-relaxed text-muted">{emailConfigured()
        ? <><Link href="/login/forgot" className="text-accent underline underline-offset-3">Forgot your password?</Link> For access, contact your workspace administrator.</>
        : "Need access or a password reset? Contact your workspace administrator."}</p>
    </> : <>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">Set up the database and create an administrator account to open your workspace.</p>
      <a className={`${textLink} mt-4 inline-flex min-h-11 items-center text-[15px] underline`} href={`${repositoryUrl}#self-host`}>Read the self-hosting guide</a>
    </>}
  </LoginFrame>;
}
