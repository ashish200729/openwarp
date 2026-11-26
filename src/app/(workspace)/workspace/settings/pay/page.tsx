import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { RuleForm } from "@/components/workspace/pay-rule-form";
import { typeSummary } from "@/components/workspace/pay-types";
import { BackLink, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { journalAccounts, ruleKindLabels, ruleSummary, type JournalAccount } from "@/lib/domains/pay";
import { formatDate } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";
import { listRules, readPaySettings } from "@/lib/server/payroll-rules";
import { readCompany } from "@/lib/server/settings";
import { saveJournalAction, saveNachaAction, savePaySettingsAction, saveRuleAction, saveSepaAction } from "./actions";

export const metadata: Metadata = { title: "Payroll settings" };

export default async function PaySettingsPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  await requireAdmin();
  const query = await searchParams;
  const [rules, settings, company] = await Promise.all([listRules(), readPaySettings(), readCompany()]);
  const adding = query.new === "rule";
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Payroll settings" actions={!adding && <Link href="/workspace/settings/pay?new=rule" className={primaryButton}>New rule</Link>} />
    {query.saved === "rule" && <Notice>Rule added. Drafts need recalculating to use it.</Notice>}
    <Callout>Your company is responsible for these rates, for what they cover and for keeping them current. OpenWarp calculates with them and doesn’t file returns, remit taxes or check them against the law.</Callout>
    <div className="grid max-w-3xl gap-10">
      {adding && <section className={`${panelStyle} p-5 pb-0`}><h2 className="mb-4 text-[15px] font-semibold">New rule</h2><RuleForm action={saveRuleAction} currency={company.currency} secondary={<Link href="/workspace/settings/pay" className={textButton}>Close</Link>} /></section>}
      <Section title="Deductions, taxes and contributions">
        {rules.length ? <ul className="divide-y divide-line">{rules.map((rule) => <li key={rule.id}><details className="group">
          <summary className="flex min-h-12 items-center gap-4 rounded py-2 text-sm focus-visible:outline-offset-[-2px]"><span className="min-w-0 flex-1 font-medium wrap-anywhere">{rule.name}<span className="block text-[13px] font-normal text-muted">{ruleKindLabels[rule.kind]}, {ruleSummary(rule, company.currency)}. {rule.enrollment === "chosen" ? "Enrolled people" : typeSummary(rule.employmentTypes)}{rule.location && `, ${rule.location}`}. From {formatDate(rule.effectiveFrom)}{rule.effectiveTo && ` to ${formatDate(rule.effectiveTo)}`}</span></span><span className={rule.active ? "text-positive" : "text-muted"}>{rule.active ? "Active" : "Off"}</span><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></summary>
          <RuleForm action={saveRuleAction} rule={rule} currency={company.currency} />
        </details></li>)}</ul> : <Empty>No rules. Net pay equals gross pay plus untaxed payments.</Empty>}
        <p className="pt-3 text-[13px] leading-relaxed text-muted">Pre-tax deductions come first, then taxes on what remains, then post-tax deductions. Brackets annualize taxable pay and divide the tax by the pay schedule. Each component is rounded to the cent, half away from zero. Approved runs keep the amounts they were approved with.</p>
      </Section>
      <Section title="Overtime and journal dates"><p className="py-3 text-sm text-muted">The overtime multiplier is in <Link href="/workspace/settings/time" className="text-accent underline underline-offset-3">Time settings</Link>. Each pay line keeps the multiplier it used.</p><div><ActionForm key={settings.version} action={savePaySettingsAction} submit="Save" hidden={{ version: settings.version }} inline>
        <Field name="journalDates" label="Dates in journals" required defaultValue={settings.journalDates} options={[{ value: "us", label: "MM/DD/YYYY" }, { value: "eu", label: "DD/MM/YYYY" }, { value: "iso", label: "YYYY-MM-DD" }]} wrapperClass="w-full sm:w-44" />
      </ActionForm></div></Section>
      <Section title="NACHA files"><p className="py-3 text-sm text-muted">Your bank gives you these values. They are used for pay in USD.</p><ActionForm key={settings.version} action={saveNachaAction} submit="Save NACHA details" hidden={{ version: settings.version }} variant="secondary">
        <div className="grid gap-4 sm:grid-cols-2"><Field name="routing" label="Bank routing number" required inputMode="numeric" maxLength={9} defaultValue={settings.nachaRouting} /><Field name="bankName" label="Bank name" required maxLength={23} defaultValue={settings.nachaBankName} /><Field name="originId" label="Immediate origin" required maxLength={10} defaultValue={settings.nachaOriginId} /><Field name="companyId" label="Company ID" required maxLength={10} defaultValue={settings.nachaCompanyId} /><Field name="companyName" label="Company name in NACHA files" required maxLength={16} defaultValue={settings.nachaCompanyName} /></div>
      </ActionForm></Section>
      <Section title="SEPA files"><p className="py-3 text-sm text-muted">Used for pay in EUR. The IBAN is encrypted and never shown again.</p><ActionForm key={settings.version} action={saveSepaAction} submit="Save SEPA details" hidden={{ version: settings.version }} variant="secondary">
        <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Company name in SEPA files" required maxLength={70} defaultValue={settings.sepaName} /><Field name="iban" label="Company IBAN" required={!settings.sepaIbanLast4} maxLength={42} autoComplete="off" hint={settings.sepaIbanLast4 ? `Ends in ${settings.sepaIbanLast4}. Leave empty to keep it.` : undefined} /><Field name="bic" label="Company BIC" maxLength={11} defaultValue={settings.sepaBic} /></div>
      </ActionForm></Section>
      <Section title="Journal accounts" id="journal"><p className="py-3 text-sm text-muted">Account names or codes as your accounting system knows them. Xero needs codes and QuickBooks needs names.</p><ActionForm key={settings.version} action={saveJournalAction} submit="Save journal accounts" hidden={{ version: settings.version }} variant="secondary">
        <div className="grid gap-4 sm:grid-cols-2">{(Object.keys(journalAccounts) as JournalAccount[]).map((key) => <Field key={key} name={key} label={journalAccounts[key]} maxLength={60} defaultValue={settings.journalAccounts[key] ?? ""} />)}</div>
      </ActionForm></Section>
    </div>
  </>;
}
