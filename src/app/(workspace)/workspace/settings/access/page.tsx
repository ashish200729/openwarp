import type { Metadata } from "next";
import { CaretDownIcon } from "@/components/icons";
import { panelStyle } from "@/components/ui";
import { AccountControls, CreateAccountForm } from "@/components/workspace/access";
import { ActionButtons } from "@/components/workspace/action-form";
import { Avatar, BackLink, PageHeader, Section } from "@/components/workspace/presentation";
import { listAccounts, listUnlinkedEmployees, type Account } from "@/lib/server/accounts";
import { requireAdmin } from "@/lib/server/member";
import { emailConfigured } from "@/lib/server/platform-settings";
import { accountSecurityAction } from "./actions";

export const metadata: Metadata = { title: "Access" };

const roles = { admin: "Administrator", viewer: "Member", disabled: "Disabled" };

function securityButtons(account: Account) {
  const { name } = account;
  return [
    { value: "invite", label: "Email an invitation", describe: `Email an invitation: ${name}`, variant: "text" as const, shown: emailConfigured() && account.pendingPassword },
    { value: "sign_out", label: "Sign out everywhere", describe: `Sign out everywhere: ${name}`, variant: "text" as const, shown: true, confirm: { title: `Sign ${name} out everywhere?`, body: "Their password still works, so they can sign in again.", action: "Sign them out", danger: true } },
    { value: "reset_two_factor", label: "Reset two-factor", describe: `Reset two-factor: ${name}`, variant: "text" as const, shown: account.twoFactor, confirm: { title: `Reset two-factor sign-in for ${name}?`, body: "Their authenticator app and backup codes stop working and they’re signed out everywhere. Check that the request is really from them.", action: "Reset two-factor", danger: true } },
    { value: "unlink_sso", label: "Unlink single sign-on", describe: `Unlink single sign-on: ${name}`, variant: "text" as const, shown: account.sso, confirm: { title: `Unlink single sign-on for ${name}?`, body: "The next identity with their verified email is linked when they sign in.", action: "Unlink", danger: true } },
  ].filter((button) => button.shown).map(({ value, label, describe, variant, confirm }) => ({ value, label, describe, variant, confirm }));
}

export default async function AccessPage() {
  const member = await requireAdmin();
  const [accounts, employees] = await Promise.all([listAccounts(), listUnlinkedEmployees()]);
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Access" description="Members see the directory and manage their own time off, expenses and documents. Managers also decide requests from their direct reports. Administrators can do everything." />
    <div className="grid max-w-3xl gap-10">
      <Section title="Accounts"><ul className="divide-y divide-line">{accounts.map((account) => <li key={account.userId}><details className="group">
        <summary className="flex min-h-14 items-center gap-3 rounded text-sm focus-visible:outline-offset-[-2px]"><Avatar name={account.name} /><span className="min-w-0 flex-1"><span className="block font-medium wrap-anywhere">{account.name}{account.userId === member.id && <span className="font-normal text-muted"> (you)</span>}</span><span className="block text-[13px] wrap-anywhere text-muted">{account.email}{account.employeeId ? "" : " · Not linked"}{account.pendingPassword && " · Temporary password"}{account.twoFactor && " · Two-factor on"}{account.sso && " · Single sign-on"}</span></span><span className={account.role === "disabled" ? "text-muted" : ""}>{roles[account.role]}</span><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></summary>
        <AccountControls account={account} employees={employees} self={account.userId === member.id} />
        {account.userId !== member.id && account.role !== "disabled" && <div className="-mt-3 -ml-3 pb-5 sm:pl-11"><ActionButtons action={accountSecurityAction} hidden={{ userId: account.userId }} name="operation" buttons={securityButtons(account)} /></div>}
      </details></li>)}</ul></Section>
      <section className={`${panelStyle} p-5`}><h2 className="mb-4 text-[15px] font-semibold">Create an account</h2><CreateAccountForm employees={employees} />{emailConfigured() && <p className="mt-4 text-[13px] text-muted">They also get an email with a link to choose their own password.</p>}</section>
    </div>
  </>;
}
