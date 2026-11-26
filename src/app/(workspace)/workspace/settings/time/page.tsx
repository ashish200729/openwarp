import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { BackLink, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { accrualLabels, decimalHours } from "@/lib/domains/time";
import { formatDays } from "@/lib/operations";
import { requireAdmin } from "@/lib/server/member";
import { listLeavePolicies, type LeaveType } from "@/lib/server/time-off";
import { readTimeSettings } from "@/lib/server/timesheets";
import { savePolicyAction, saveTrackingAction } from "./actions";

export const metadata: Metadata = { title: "Time settings" };

function summary(type: LeaveType) {
  if (type.annualDays === null) return "No limit";
  return `${formatDays(type.annualDays)} a year, ${type.accrual === "monthly" ? "earned monthly" : "granted up front"}`;
}

export default async function TimeSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const { saved } = await searchParams;
  const [settings, policies] = await Promise.all([readTimeSettings(), listLeavePolicies()]);
  const zones = [...new Set(["UTC", settings.timeZone, ...Intl.supportedValuesOf("timeZone")])];
  return <>
    <BackLink href="/workspace/settings">Settings</BackLink>
    <PageHeader title="Time" />
    {(saved === "tracking" || saved === "policy") && <Notice>{saved === "tracking" ? "Time tracking saved." : "Policy saved."}</Notice>}
    <div className="grid max-w-3xl gap-10">
      <Section title="Time tracking"><ActionForm key={settings.version} action={saveTrackingAction} submit="Save time tracking" hidden={{ version: settings.version }} className="pt-4">
        <Checkbox name="tracking" label="Track time" hint="Anyone linked to an employee record can clock in. People paid by the hour must submit a timesheet each week." defaultChecked={settings.tracking} />
        <Checkbox name="trackSalaried" label="Salaried people must submit timesheets too" defaultChecked={settings.trackSalaried} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="timeZone" label="Company time zone" required defaultValue={settings.timeZone} options={zones.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))} hint="Decides which day time belongs to. Time already recorded keeps its day." />
          <Field name="lateAfter" label="Minutes before a shift counts as late" type="number" min={0} max={120} required defaultValue={settings.lateAfterMinutes} />
          <Field name="weeklyHours" label="Weekly overtime after, in hours" required inputMode="decimal" defaultValue={decimalHours(settings.weeklyOvertimeMinutes)} hint="Weeks run Monday to Sunday." />
          <Field name="dailyHours" label="Daily overtime after, in hours" inputMode="decimal" defaultValue={settings.dailyOvertimeMinutes === null ? "" : decimalHours(settings.dailyOvertimeMinutes)} hint="Leave empty to use the weekly limit only." />
          <Field name="multiplier" label="Overtime multiplier" required inputMode="decimal" defaultValue={settings.overtimeMultiplierBp / 10_000} hint="1.5 pays time and a half." />
          <Field name="paidBreak" label="Paid break minutes a day" type="number" min={0} max={480} required defaultValue={settings.paidBreakMinutes} hint="Break time past this isn’t counted as work." />
          <Field name="autoBreak" label="Automatic break minutes" type="number" min={0} max={120} required defaultValue={settings.autoBreakMinutes} hint="Deducted when a long day has a shorter break. Use 0 for none." />
          <Field name="autoBreakAfter" label="Automatic break from, in hours" required inputMode="decimal" defaultValue={decimalHours(settings.autoBreakAfterMinutes)} />
        </div>
        <p className="text-[13px] text-muted">Changes apply to timesheets that haven’t been approved. OpenWarp doesn’t check these rules against local labor law.</p>
      </ActionForm></Section>
      <Section title="Time off policies">
        {policies.length ? <ul className="divide-y divide-line">{policies.map((type) => <li key={type.id}><details className="group">
          <summary className="flex min-h-12 flex-wrap items-center gap-x-4 rounded text-sm focus-visible:outline-offset-[-2px]"><span className="flex-1 font-medium">{type.name}{!type.active && <span className="font-normal text-muted"> · Not offered</span>}</span><span className="text-muted">{summary(type)}</span><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></summary>
          <ActionForm key={type.version} action={savePolicyAction} submit="Save policy" hidden={{ id: type.id, version: type.version }} variant="secondary" className="pt-1 pb-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {type.annualDays !== null && <>
                <Field name="accrual" label="Days are granted" required defaultValue={type.accrual} options={Object.entries(accrualLabels).map(([value, label]) => ({ value, label }))} />
                <Field name="trackedFrom" label="Count balances from" type="date" defaultValue={type.trackedFrom ?? ""} hint="Earlier service doesn’t build a balance. Empty counts from each start date." />
                <Field name="carryoverDays" label="Days carried into a new year" inputMode="decimal" defaultValue={type.carryoverDays ?? ""} hint="0 starts each year fresh. Empty carries everything." />
                <Field name="maxBalanceDays" label="Highest balance in days" inputMode="decimal" defaultValue={type.maxBalanceDays ?? ""} hint="No more days are granted above this." />
                <Field name="negativeDays" label="Days a balance can go below zero" required inputMode="decimal" defaultValue={type.negativeDays} />
              </>}
              <Field name="waitingDays" label="Waiting period in days" type="number" min={0} max={730} required defaultValue={type.waitingDays} hint="Counted from the start date." />
              <Field name="noticeDays" label="Notice in days" type="number" min={0} max={365} required defaultValue={type.noticeDays} hint="How far ahead a request must be sent." />
            </div>
          </ActionForm>
        </details></li>)}</ul> : <Empty>No time off types yet.</Empty>}
        <p className="border-t border-line pt-3 text-[13px] text-muted">Names and days a year are in <Link href="/workspace/settings" className="text-accent underline underline-offset-3">Settings</Link>. Balances are worked out from the current policy, so a change here recalculates them. Monthly days are earned on each monthly anniversary of the start date. Adjust one person’s balance on their Time off tab.</p>
      </Section>
    </div>
  </>;
}
