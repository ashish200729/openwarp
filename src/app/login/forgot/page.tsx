import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { textButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { LoginFrame } from "@/components/workspace/platform-login-frame";
import { hasWorkspaceConfig } from "@/lib/server/auth";
import { emailConfigured } from "@/lib/server/platform-settings";
import { forgotPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (!hasWorkspaceConfig() || !emailConfigured()) notFound();
  return <LoginFrame title="Reset your password">
    <p className="mt-1 mb-6 text-sm leading-relaxed text-muted">We’ll email you a link to choose a new one.</p>
    <ActionForm action={forgotPasswordAction} submit="Send link" pending="Sending…" secondary={<Link href="/login" className={textButton}>Back to sign in</Link>}>
      <Field name="email" label="Work email" type="email" required maxLength={254} autoComplete="username" />
    </ActionForm>
  </LoginFrame>;
}
