import type { Metadata } from "next";
import { panelStyle } from "@/components/ui";
import { PasswordForm } from "@/components/workspace/auth-controls";
import { PageHeader } from "@/components/workspace/presentation";
import { requireMember } from "@/lib/server/member";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const member = await requireMember();
  return <>
    <PageHeader title="My account" description="Manage your OpenWarp sign-in." />
    <section className={`${panelStyle} max-w-xl p-5 sm:p-6`}>
      <h2 className="text-lg font-medium tracking-tight">Change password</h2>
      <p className="mt-1 text-sm wrap-anywhere text-muted">Signed in as {member.email}.</p>
      <PasswordForm />
    </section>
  </>;
}
