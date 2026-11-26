import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { textLink } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { LoginFrame } from "@/components/workspace/platform-login-frame";
import { passwordTokenPurpose } from "@/lib/server/accounts";
import { hasWorkspaceConfig } from "@/lib/server/auth";
import { emailConfigured, readPolicy } from "@/lib/server/platform-settings";
import { resetPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Choose a password", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (!hasWorkspaceConfig()) notFound();
  const { token } = await searchParams;
  const purpose = typeof token === "string" && /^[\w-]{43}$/.test(token) ? await passwordTokenPurpose(token) : null;
  if (!purpose) return <LoginFrame title="This link doesn’t work">
    <p className="mt-2 text-sm leading-relaxed text-muted">It has expired or was already used. {emailConfigured() ? <Link href="/login/forgot" className={`${textLink} underline`}>Ask for a new link</Link> : "Ask your workspace administrator for a new one."}</p>
  </LoginFrame>;
  const { minPasswordLength } = await readPolicy();
  return <LoginFrame title="Choose your password">
    <p className="mt-1 mb-6 text-sm leading-relaxed text-muted">{purpose === "invitation" ? "You’ll use it to sign in from now on." : "You’ll be signed out everywhere else."}</p>
    <ActionForm action={resetPasswordAction} submit="Save password" hidden={{ token: token! }}>
      <Field name="password" label="New password" type="password" required minLength={minPasswordLength} maxLength={128} autoComplete="new-password" hint={`Use at least ${minPasswordLength} characters.`} />
      <Field name="confirmation" label="Confirm new password" type="password" required minLength={minPasswordLength} maxLength={128} autoComplete="new-password" />
    </ActionForm>
  </LoginFrame>;
}
