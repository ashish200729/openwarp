import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { PasswordForm, SignOutButton } from "@/components/workspace/auth-controls";
import { currentMember, pendingStep } from "@/lib/server/member";
import { readPolicy } from "@/lib/server/platform-settings";

export const metadata: Metadata = { title: "Choose a password", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  if (pendingStep(member) !== "/welcome") redirect(pendingStep(member) ?? "/workspace");
  const { minPasswordLength } = await readPolicy();
  return <main id="main" tabIndex={-1} className="mx-auto grid min-h-dvh max-w-sm content-center bg-surface px-5 py-12">
    <Brand />
    <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.015em]">Choose your password</h1>
    <p className="mt-1 text-sm leading-relaxed text-muted">You signed in with a temporary password. Replace it to open the workspace.</p>
    <PasswordForm welcome minLength={minPasswordLength} />
    <div className="mt-3"><SignOutButton /></div>
  </main>;
}
