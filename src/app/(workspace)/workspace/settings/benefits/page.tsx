import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { panelStyle, primaryButton, tableBody, tableHead, textButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { PlanForm } from "@/components/workspace/benefit-plan-form";
import { typeSummary } from "@/components/workspace/pay-types";
import { BackLink, Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { formatPercent, planKindLabels, tierLabels, tiers } from "@/lib/domains/pay";
import { addDays, formatMoney, today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { listPlans, listWindows } from "@/lib/server/benefits";
import { listDocuments } from "@/lib/server/documents";
import { requireAdmin } from "@/lib/server/member";
import { readPaySettings } from "@/lib/server/payroll-rules";
import { readCompany } from "@/lib/server/settings";
import { addRateAction, openEnrollmentAction, saveNewHireAction, savePlanAction } from "../../benefits/actions";

export const metadata: Metadata = { title: "Benefit settings" };

export default async function BenefitSettingsPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  const member = await requireAdmin();
  const query = await searchParams;
  const [plans, windows, settings, company, documents] = await Promise.all([listPlans(), listWindows(), readPaySettings(), readCompany(), listDocuments(member)]);
  const shared = documents.filter((document) => document.employeeId === null);
  const adding = query.new === "plan";
  const day = today();
  return <>
    <BackLink href="/workspace/benefits">Benefits</BackLink>
    <PageHeader title="Plans and enrollment" actions={!adding && <Link href="/workspace/settings/benefits?new=plan" className={primaryButton}>New plan</Link>} />
    {query.saved === "plan" && <Notice>Plan added. Add a cost for each coverage level you offer.</Notice>}
    <Callout>Your company sets the costs, eligibility and tax treatment, and arranges coverage with the provider. OpenWarp doesn’t enroll anyone with a carrier.</Callout>
    <div className="grid max-w-3xl gap-10">
      {adding && <section className={`${panelStyle} p-5 pb-0`}><h2 className="mb-4 text-[15px] font-semibold">New plan</h2><PlanForm action={savePlanAction} documents={shared} secondary={<Link href="/workspace/settings/benefits" className={textButton}>Close</Link>} /></section>}
      <Section title="Plans">
        {plans.length ? <ul className="divide-y divide-line">{plans.map((plan) => <li key={plan.id}><details className="group">
          <summary className="flex min-h-12 items-center gap-4 rounded py-2 text-sm focus-visible:outline-offset-[-2px]"><span className="min-w-0 flex-1 font-medium wrap-anywhere">{plan.name}<span className="block text-[13px] font-normal text-muted">{planKindLabels[plan.kind]}, {plan.preTax ? "before tax" : "after tax"}. {typeSummary(plan.employmentTypes)}</span></span><span className={!plan.active ? "text-muted" : plan.rates.length ? "text-positive" : "text-amber"}>{!plan.active ? "Not offered" : plan.rates.length ? "Offered" : "Needs a cost"}</span><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></summary>
          {plan.rates.length > 0 && <div className="overflow-x-auto pb-4" tabIndex={0} role="region" aria-label={`Costs of ${plan.name}`}><table className="w-full"><caption className="sr-only">Costs of {plan.name}</caption><thead className={tableHead}><tr><th scope="col">Coverage</th><th scope="col">From</th><th scope="col" className="text-right">Employee</th><th scope="col" className="text-right">Employer</th></tr></thead>
            <tbody className={tableBody}>{plan.rates.map((rate) => <tr key={`${rate.tier}-${rate.effectiveOn}`}><th scope="row">{tierLabels[rate.tier]}</th><td className="whitespace-nowrap">{formatDate(rate.effectiveOn)}</td><td className="text-right tabular-nums">{plan.percent ? formatPercent(rate.employeeBp) : formatMoney(rate.employeeCents, company.currency)}</td><td className="text-right tabular-nums">{plan.percent ? formatPercent(rate.employerBp) : formatMoney(rate.employerCents, company.currency)}</td></tr>)}</tbody></table></div>}
          <ActionForm action={addRateAction} submit="Add cost" hidden={{ planId: plan.id }} variant="secondary" inline className="pb-6">
            <Field name="tier" label="Coverage level" required options={tiers.map((value) => ({ value, label: tierLabels[value] }))} wrapperClass="w-full sm:w-52" /><Field name="effectiveOn" label="Cost from" type="date" required defaultValue={`${day.slice(0, 4)}-01-01`} wrapperClass="w-full sm:w-44" />
            <Field name="employee" label={plan.percent ? "Employee percent" : "Employee a month"} required inputMode="decimal" placeholder="0.00" wrapperClass="w-full sm:w-40" /><Field name="employer" label={plan.percent ? "Employer percent" : "Employer a month"} required inputMode="decimal" placeholder="0.00" wrapperClass="w-full sm:w-40" />
          </ActionForm>
          <PlanForm action={savePlanAction} plan={plan} documents={shared} />
        </details></li>)}</ul> : <Empty>No plans yet.</Empty>}
        <p className="pt-3 text-[13px] leading-relaxed text-muted">Monthly costs are split across the regular runs that end in each calendar year, so a full year of runs adds up to exactly twelve months. A period is charged in full when coverage is in force on any of its days. Costs can’t be edited: add a new one from a later date.</p>
      </Section>
      <Section title="Open enrollment">
        {windows.length ? <ul className="divide-y divide-line">{windows.map((window) => <li key={window.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm"><span className="min-w-0"><span className="block font-medium wrap-anywhere">{window.name}</span><span className="text-muted">{dateRange(window.opensOn, window.closesOn)}, coverage from {formatDate(window.coverageOn)}</span></span><span className={window.closesOn < day ? "text-muted" : window.opensOn > day ? "text-accent" : "text-positive"}>{window.closesOn < day ? "Closed" : window.opensOn > day ? "Upcoming" : "Open"}</span></li>)}</ul> : <Empty>No enrollment windows yet.</Empty>}
        <div className="border-t border-line pt-4"><ActionForm action={openEnrollmentAction} submit="Open enrollment" variant="secondary"><div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Window name" required maxLength={80} /><Field name="coverageOn" label="Coverage starts" type="date" required /><Field name="opensOn" label="Opens" type="date" required defaultValue={day} /><Field name="closesOn" label="Closes" type="date" required defaultValue={addDays(day, 14)} /></div></ActionForm></div>
      </Section>
      <Section title="New hires"><div className="pt-3"><ActionForm key={settings.version} action={saveNewHireAction} submit="Save" hidden={{ version: settings.version }} inline><Field name="days" label="Days to enroll after the start date" type="number" min={0} max={365} required defaultValue={settings.newHireDays} wrapperClass="w-full sm:w-64" /></ActionForm></div></Section>
    </div>
  </>;
}
