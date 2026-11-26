import type { Metadata } from "next";
import Link from "next/link";
import { panelStyle, primaryButton, secondaryButton, tableBody, tableHead, textButton, textLink } from "@/components/ui";
import { ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { Callout, EmptyState, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { earningLabels, earningTypes, purposeLabels, runPurposes, runTitle } from "@/lib/domains/pay";
import { addDays, formatMoney, isoDate, scheduleLabels, today, type PaySchedule } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { requireAdmin } from "@/lib/server/member";
import { lastRegularEnd, listPayRuns, offCycleCandidates, payrollCosts } from "@/lib/server/pay";
import { readCompany } from "@/lib/server/settings";
import { createPayRunAction } from "../operations";
import { createOffCycleAction } from "./actions";

export const metadata: Metadata = { title: "Pay runs" };

const monthName = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

function nextPeriod(schedule: PaySchedule, lastEnd: string | null) {
  const start = lastEnd ? addDays(lastEnd, 1) : `${today().slice(0, 7)}-01`;
  const monthEnd = isoDate(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0));
  const end = schedule === "weekly" ? addDays(start, 6) : schedule === "biweekly" ? addDays(start, 13)
    : schedule === "semi_monthly" && Number(start.slice(8)) <= 15 ? `${start.slice(0, 7)}-15` : monthEnd;
  return { start, end };
}

export default async function PayRunsPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  await requireAdmin();
  const query = await searchParams;
  const adding = query.new === "1";
  const offCycle = query.new === "off-cycle";
  const [runs, company, lastEnd, costs, people] = await Promise.all([listPayRuns(), readCompany(), lastRegularEnd(), payrollCosts(12), offCycle ? offCycleCandidates() : []]);
  const period = nextPeriod(company.schedule, lastEnd);
  const months = costs.filter((cost) => cost.runs).reverse();
  const amount = (cents: number) => formatMoney(cents, company.currency);
  return <>
    <PageHeader title="Pay runs" description={`${scheduleLabels[company.schedule]}, in ${company.currency}.`} actions={<>
      <Link href="/workspace/settings/pay" className={textButton}>Payroll settings</Link>
      {!offCycle && <Link href="/workspace/pay-runs?new=off-cycle" className={secondaryButton}>Off-cycle run</Link>}
      {!adding && <Link href="/workspace/pay-runs?new=1" className={primaryButton}>New pay run</Link>}
    </>} />
    {query.saved === "deleted" && <Notice>Draft deleted. Its expenses and invoices are ready for another run.</Notice>}
    <Callout>Pay runs apply the rules your company sets up, and your company is responsible for them. OpenWarp doesn’t file returns, remit taxes or move money.</Callout>
    {adding && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">New pay run</h2>
      <ActionForm action={createPayRunAction} submit="Create draft" pending="Calculating…" secondary={<Link href="/workspace/pay-runs" className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-3"><Field name="periodStart" label="Period starts" type="date" required defaultValue={period.start} /><Field name="periodEnd" label="Period ends" type="date" required defaultValue={period.end} /><Field name="payOn" label="Pay date" type="date" required defaultValue={period.end} /></div>
        <p className="text-[13px] leading-relaxed text-muted">Salaries are split by your pay schedule and prorated by weekday for anyone who joins or leaves during the period. Each person’s latest pay rate on the period’s end date is used. Hourly people start with their approved timesheet hours. Each component is rounded to the cent, half away from zero.</p>
      </ActionForm>
    </section>}
    {offCycle && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">Off-cycle run</h2>
      <ActionForm action={createOffCycleAction} submit="Create off-cycle draft" pending="Calculating…" secondary={<Link href="/workspace/pay-runs" className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="purpose" label="Purpose" required options={runPurposes.map((value) => ({ value, label: purposeLabels[value] }))} /><Field name="label" label="Name" maxLength={80} />
          <Field name="type" label="Earning type" required options={earningTypes.map((value) => ({ value, label: earningLabels[value] }))} /><Field name="amount" label="Amount for each person" inputMode="decimal" placeholder="0.00" />
          <Field name="periodStart" label="Work from" type="date" required defaultValue={today()} /><Field name="periodEnd" label="Work to" type="date" required defaultValue={today()} /><Field name="payOn" label="Pay date" type="date" required defaultValue={today()} />
        </div>
        <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">People</legend>
          <div className="grid max-h-72 gap-2.5 overflow-y-auto rounded-[7px] border border-line p-3 sm:grid-cols-2" tabIndex={0} role="group" aria-label="People to pay">{people.map((person) => <Checkbox key={person.id} name={`person-${person.id}`} label={person.name} hint={person.status === "archived" ? "Archived" : undefined} />)}</div>
        </fieldset>
        <Checkbox name="includesClaims" label="Include approved expenses and invoices" />
        <p className="text-[13px] leading-relaxed text-muted">Percent rules and brackets apply, with brackets taxing the payment on top of the person’s latest regular pay. Flat amounts, monthly benefits and recurring payments stay with regular runs. Unpaid wages here keep the person out of the regular run for the same dates.</p>
      </ActionForm>
    </section>}
    {runs.length ? <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pay runs"><table className="w-full min-w-[38rem]">
      <caption className="sr-only">Pay runs</caption>
      <thead className={tableHead}><tr><th scope="col">Period</th><th scope="col">Type</th><th scope="col">Pay date</th><th scope="col">Status</th><th scope="col" className="text-right">People</th><th scope="col" className="text-right">Total</th></tr></thead>
      <tbody className={tableBody}>{runs.map((run) => <tr key={run.id}>
        <th scope="row"><Link href={`/workspace/pay-runs/${run.id}`} className={`${textLink} font-medium`}>{dateRange(run.periodStart, run.periodEnd)}</Link></th>
        <td className="wrap-anywhere">{runTitle(run)}</td><td>{formatDate(run.payOn)}</td><td className={run.state === "draft" ? "font-medium text-amber" : run.reversed ? "font-medium text-muted" : "font-medium text-positive"}>{run.state === "draft" ? "Draft" : run.reversed ? "Reversed" : "Approved"}</td>
        <td className="text-right tabular-nums">{run.people}</td><td className="text-right font-medium tabular-nums">{formatMoney(run.totalCents, run.currency)}</td>
      </tr>)}</tbody>
    </table></div> : !adding && !offCycle && <EmptyState title="No pay runs yet" description="Record pay on people’s profiles, then create a run for a period." action={<Link href="/workspace/pay-runs?new=1" className={primaryButton}>New pay run</Link>} />}
    {months.length > 0 && <Section title="Payroll cost, last 12 months" className="mt-10">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Payroll cost by month"><table className="w-full min-w-[38rem]">
        <caption className="sr-only">Approved payroll cost by month of the pay date</caption>
        <thead className={tableHead}><tr><th scope="col">Month</th><th scope="col" className="text-right">People</th><th scope="col" className="text-right">Gross pay</th><th scope="col" className="text-right">Employer contributions</th><th scope="col" className="text-right">Untaxed payments</th><th scope="col" className="text-right">Total cost</th></tr></thead>
        <tbody className={tableBody}>{months.map((cost) => <tr key={cost.month}><th scope="row">{monthName.format(new Date(`${cost.month}T00:00:00Z`))}</th><td className="text-right tabular-nums">{cost.people}</td><td className="text-right tabular-nums">{amount(cost.grossCents)}</td><td className="text-right tabular-nums">{amount(cost.employerCents)}</td><td className="text-right tabular-nums">{amount(cost.nontaxedCents)}</td><td className="text-right font-medium tabular-nums">{amount(cost.costCents)}</td></tr>)}</tbody>
      </table></div>
    </Section>}
  </>;
}
