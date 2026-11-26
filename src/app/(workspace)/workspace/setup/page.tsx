import Link from "next/link";
import { CaretRightIcon, CheckCircleIcon, CircleIcon } from "@/components/icons";
import { Meter, secondaryButton } from "@/components/ui";
import { BackLink, PageHeader } from "@/components/workspace/presentation";
import { pool } from "@/lib/server/db";
import { requireAdmin, workspaceName } from "@/lib/server/member";

export const metadata = { title: "Company setup" };

export default async function CompanySetup() {
  await requireAdmin();
  const { rows: [state] } = await pool().query<{ settings: boolean; people: boolean; access: boolean }>(`SELECT version > 1 AS settings,
    EXISTS (SELECT 1 FROM employees WHERE status <> 'archived') AS people,
    EXISTS (SELECT 1 FROM workspace_members m JOIN employees e ON e.id = m.employee_id WHERE m.role <> 'disabled' AND e.status <> 'archived'
      AND (m.temporary_password_at IS NULL
        OR EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = m.user_id AND a."providerId" = 'credential' AND a."updatedAt" > m.temporary_password_at)
        OR EXISTS (SELECT 1 FROM password_tokens t WHERE t.user_id = m.user_id AND t.purpose = 'invitation' AND t.used_at IS NULL AND t.expires_at > now())
        OR EXISTS (SELECT 1 FROM sso_identities i WHERE i.user_id = m.user_id))) AS access FROM company_settings`);
  const steps = [
    { title: "Confirm your pay settings", detail: "Choose the company currency and how often people are paid.", href: "/workspace/settings#pay-defaults", done: state.settings },
    { title: "Add your first employee or contractor", detail: "Set their team, manager, and start date. Choose onboarding to give them a checklist.", href: "/workspace/people/new", done: state.people },
    { title: "Give your team access", detail: "Create an account linked to a person, then share their invitation.", href: "/workspace/settings/access", done: state.access },
  ];
  const done = steps.filter(step => step.done).length;
  return <div className="max-w-2xl"><BackLink href="/workspace">Home</BackLink>
    <PageHeader title="Company setup" description={`Get ${workspaceName()} ready for your team.`} />
    <p className="mb-2 text-sm font-medium">{done} of {steps.length} steps complete</p><Meter label="Company setup progress" value={done / steps.length * 100} />
    <ol className="mt-6 divide-y divide-line border-y border-line">{steps.map(step => <li key={step.href}><Link href={step.href} className="flex min-h-20 items-center gap-4 rounded py-4">
      {step.done ? <CheckCircleIcon size={23} weight="fill" className="shrink-0 text-positive" aria-label="Complete" /> : <CircleIcon size={23} className="shrink-0 text-hint" aria-label="To do" />}
      <span className="min-w-0 flex-1"><span className="block font-semibold">{step.title}</span><span className="mt-1 block text-sm text-muted">{step.detail}</span></span><CaretRightIcon aria-hidden="true" size={16} />
    </Link></li>)}</ol><Link href="/workspace" className={`${secondaryButton} mt-6`}>Go to workspace</Link>
  </div>;
}
