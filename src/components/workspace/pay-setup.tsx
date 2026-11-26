import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { panelStyle, textButton, textLink } from "@/components/ui";
import { ActionForm, Checkbox, Field, type FormAction } from "@/components/workspace/action-form";
import { Empty, Section } from "@/components/workspace/presentation";
import { addGarnishmentAction, addRecurringAction, assignRuleAction, endGarnishmentAction, endRecurringAction } from "@/app/(workspace)/workspace/people/[id]/job/actions";
import { formatPercent, garnishmentLabels, garnishmentMethods, plainAmount, ruleKindLabels, ruleSummary } from "@/lib/domains/pay";
import { formatMoney, today } from "@/lib/operations";
import { formatDate, type EmploymentType } from "@/lib/people";
import type { employeePaySetup } from "@/lib/server/payroll-rules";

type Setup = Awaited<ReturnType<typeof employeePaySetup>>;

function EndForm({ action, id, label, endsOn }: { action: FormAction; id: string; label: string; endsOn: string | null }) {
  return <details className="group mt-1"><summary className="inline-flex min-h-8 items-center gap-1.5 rounded text-[13px] text-muted hover:text-foreground">{endsOn ? "Change end date" : "Set end date"}<span className="sr-only"> for {label}</span><CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary>
    <ActionForm action={action} submit="Save end date" hidden={{ id }} variant="secondary" inline className="pt-2 pb-1"><Field name="endsOn" label="Ends" type="date" required defaultValue={endsOn ?? today()} wrapperClass="w-44" /></ActionForm></details>;
}

const dates = (startsOn: string, endsOn: string | null) => `From ${formatDate(startsOn)}${endsOn ? ` to ${formatDate(endsOn)}` : ""}`;

// The payroll set-up of one person, for administrators only.
export function PaySetup({ employeeId, employmentType, location, setup, currency, add, editable }: { employeeId: string; employmentType: EmploymentType; location: string; setup: Setup; currency: string; add?: string; editable: boolean }) {
  const base = `/workspace/people/${employeeId}/job`;
  const addLink = (kind: string, text: string) => editable && add !== kind && <Link href={`${base}?add=${kind}#payroll`} className={`${textLink} text-[13px]`}>{text}</Link>;
  return <div id="payroll" className="mt-10 grid scroll-mt-20 gap-9">
    <Section title="Recurring payments" action={addLink("recurring", "Add a recurring payment")}>
      {add === "recurring" && editable && <div className={`${panelStyle} my-4 max-w-2xl p-5`}><ActionForm action={addRecurringAction} submit="Add recurring payment" hidden={{ employeeId }} secondary={<Link href={base} className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field name="label" label="Payment name" required maxLength={80} placeholder="Phone allowance" /><Field name="amount" label="Each regular run" required inputMode="decimal" placeholder="0.00" /><Field name="startsOn" label="Starts" type="date" required defaultValue={today()} /><Field name="endsOn" label="Ends" type="date" /></div>
        <Checkbox name="taxable" label="Taxable" defaultChecked hint="Clear this for an untaxed allowance." />
      </ActionForm></div>}
      {setup.recurring.length ? <ul className="divide-y divide-line">{setup.recurring.map((entry) => <li key={entry.id} className="py-3 text-sm"><p className="flex flex-wrap justify-between gap-x-4"><span className="font-medium wrap-anywhere">{entry.label}</span><span className="tabular-nums">{formatMoney(entry.amountCents, currency)} each run</span></p><p className="text-[13px] text-muted">{entry.taxable ? "Taxable" : "Untaxed"}. {dates(entry.startsOn, entry.endsOn)}</p>{editable && <EndForm action={endRecurringAction} id={entry.id} label={entry.label} endsOn={entry.endsOn} />}</li>)}</ul> : <Empty>No recurring payments.</Empty>}
    </Section>
    <Section title="Deductions and taxes" action={<Link href="/workspace/settings/pay" className={`${textLink} text-[13px]`}>Payroll rules</Link>}>
      {setup.rules.length ? <ul className="divide-y divide-line">{setup.rules.map((rule) => {
        const assigned = setup.assignments.find((entry) => entry.ruleId === rule.id);
        const matches = (!rule.employmentTypes.length || rule.employmentTypes.includes(employmentType)) && (!rule.location || location.toLowerCase().includes(rule.location.toLowerCase()));
        const state = assigned?.mode === "exempt" ? "Exempt" : assigned?.mode === "override" ? `Set to ${rule.method === "flat" ? formatMoney(assigned.amountCents ?? 0, currency) : formatPercent(assigned.rateBp ?? 0)}` : assigned?.mode === "enrolled" ? "Enrolled" : rule.enrollment === "everyone" && matches ? "Applies" : "Doesn’t apply";
        return <li key={rule.id}><details className="group">
          <summary className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-0.5 rounded py-2 text-sm focus-visible:outline-offset-[-2px]"><span className="min-w-0 flex-1 font-medium wrap-anywhere">{rule.name}<span className="block text-[13px] font-normal text-muted">{ruleKindLabels[rule.kind]}, {ruleSummary(rule, currency)}</span></span><span className={state === "Doesn’t apply" || state === "Exempt" ? "text-muted" : "text-positive"}>{state}</span><CaretDownIcon aria-hidden="true" size={13} className="text-hint group-open:rotate-180" /></summary>
          {editable && <ActionForm key={state} action={assignRuleAction} submit="Save for this person" hidden={{ employeeId, ruleId: rule.id }} variant="secondary" inline className="pb-5">
            <Field name="mode" label="For this person" required defaultValue={assigned?.mode ?? "default"} options={[{ value: "default", label: rule.enrollment === "everyone" ? "Follow the rule" : "Not enrolled" }, { value: "enrolled", label: "Enrolled" }, ...(rule.method === "brackets" ? [] : [{ value: "override", label: rule.method === "flat" ? "Own amount" : "Own percent" }]), { value: "exempt", label: "Exempt" }]} wrapperClass="w-full sm:w-48" />
            {rule.method !== "brackets" && <Field name="value" label={rule.method === "flat" ? "Own flat sum" : "Own percent"} inputMode="decimal" defaultValue={plainAmount(assigned?.amountCents ?? assigned?.rateBp ?? null)} wrapperClass="w-full sm:w-44" />}
          </ActionForm>}
        </details></li>;
      })}</ul> : <Empty>No payroll rules are active.</Empty>}
    </Section>
    <Section title="Ordered deductions" action={addLink("garnishment", "Add an ordered deduction")}>
      {add === "garnishment" && editable && <div className={`${panelStyle} my-4 max-w-2xl p-5`}><ActionForm action={addGarnishmentAction} submit="Add ordered deduction" hidden={{ employeeId }} secondary={<Link href={base} className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field name="label" label="Order name" required maxLength={80} /><Field name="method" label="How it’s taken" required options={garnishmentMethods.map((value) => ({ value, label: garnishmentLabels[value] }))} /><Field name="value" label="Percent or flat sum" required inputMode="decimal" placeholder="0.00" /><Field name="totalOwed" label="Total owed" inputMode="decimal" placeholder="0.00" hint="It stops when this is paid." /><Field name="startsOn" label="Starts" type="date" required defaultValue={today()} /></div>
        <p className="text-[13px] leading-relaxed text-muted">Taken after taxes and never below a net of zero. Check the legal limits that apply to the order.</p>
      </ActionForm></div>}
      {setup.garnishments.length ? <ul className="divide-y divide-line">{setup.garnishments.map((entry) => <li key={entry.id} className="py-3 text-sm"><p className="flex flex-wrap justify-between gap-x-4"><span className="font-medium wrap-anywhere">{entry.label}</span><span className="tabular-nums">{formatMoney(entry.paidCents, currency)}{entry.totalOwedCents !== null && ` of ${formatMoney(entry.totalOwedCents, currency)}`} taken</span></p><p className="text-[13px] text-muted">{entry.method === "flat" ? formatMoney(entry.amountCents, currency) : formatPercent(entry.rateBp)}, {garnishmentLabels[entry.method].toLowerCase()}. {dates(entry.startsOn, entry.endsOn)}</p>{editable && <EndForm action={endGarnishmentAction} id={entry.id} label={entry.label} endsOn={entry.endsOn} />}</li>)}</ul> : <Empty>No ordered deductions.</Empty>}
    </Section>
  </div>;
}
