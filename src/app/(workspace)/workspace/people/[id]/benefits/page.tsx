import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon } from "@/components/icons";
import { panelStyle, textButton, textLink } from "@/components/ui";
import { ActionButtons, ActionForm, Checkbox, Field } from "@/components/workspace/action-form";
import { electionText, rateText } from "@/components/workspace/benefit-text";
import { Callout, Empty, Notice, Section } from "@/components/workspace/presentation";
import { ProfileHeader } from "@/components/workspace/profile-header";
import { electionLabels, lifeEvents, planKindLabels, relationshipLabels, tierLabels, type ElectionState } from "@/lib/domains/pay";
import { today } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { employeeBenefits } from "@/lib/server/benefits";
import { readCompany } from "@/lib/server/settings";
import { addDependentAction, decideElectionAction, endElectionAction, removeDependentAction, reportEventAction, submitElectionAction } from "../../../benefits/actions";
import { privateProfile } from "../profile";

export const metadata: Metadata = { title: "Benefits" };

const colors: Record<ElectionState, string> = { pending: "text-amber", approved: "text-positive", declined: "text-danger", cancelled: "text-muted", replaced: "text-muted" };

export default async function EmployeeBenefitsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ add?: string; saved?: string }> }) {
  const { member, employee, canManage } = await privateProfile(params);
  const query = await searchParams;
  const [benefits, company] = await Promise.all([employeeBenefits(member, employee.id), readCompany()]);
  const { person, elections, dependents, requested, window, choices } = benefits!;
  const base = `/workspace/people/${employee.id}/benefits`;
  const day = today();
  const own = member.employeeId === employee.id;
  const past = (end: string | null) => end !== null && end < day;
  const canEnroll = person && person.status !== "offboarding" && person.hireDate <= today();
  return <>
    <ProfileHeader employee={employee} current="benefits" canSeePrivate />
    {query.saved === "event" && <Notice>{canManage ? "Enrollment opened for 30 days." : "Sent to an administrator for review."}</Notice>}
    {query.saved === "dependent" && <Notice>Dependent added.</Notice>}
    {window && choices.length > 0 && <Callout><span className="font-medium">Enrollment is open until {formatDate(window.closesOn)}: {window.name}.</span> Choose or waive each type below. An administrator approves each choice. Deductions start with the next regular run in the coverage, and earlier periods aren’t charged.</Callout>}
    {query.add === "event" && canEnroll && !requested && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}><h2 className="mb-4 text-[15px] font-semibold">Report a life event</h2>
      <ActionForm action={reportEventAction} submit={canManage ? "Open enrollment" : "Send for review"} hidden={{ employeeId: employee.id }} secondary={<Link href={base} className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Event" required options={lifeEvents.map((value) => ({ value, label: value }))} /><Field name="eventOn" label="Event date" type="date" required defaultValue={day} /></div>
        <p className="text-[13px] text-muted">Report it within 60 days. Enrollment opens for 30 days, with coverage from the event date.</p>
      </ActionForm></section>}
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-9">
        {choices.length > 0 && <Section title="Choose benefits"><ul className="divide-y divide-line">{choices.map(({ kind, options }) => {
          const chosen = elections.find((election) => election.planKind === kind && (election.state === "pending" || election.state === "approved" && !past(election.coverageEnd)));
          const contribution = options.find((option) => option.plan.employeeChooses);
          return <li key={kind}><details className="group">
            <summary className="flex min-h-12 items-center gap-4 rounded py-2 text-sm focus-visible:outline-offset-[-2px]"><span className="min-w-0 flex-1 font-medium">{planKindLabels[kind]}</span><span className={`text-[13px] wrap-anywhere ${chosen ? colors[chosen.state] : "text-muted"}`}>{chosen ? `${chosen.planName ?? "Waived"}, ${electionLabels[chosen.state].toLowerCase()}` : "Not chosen"}</span><CaretDownIcon aria-hidden="true" size={13} className="shrink-0 text-hint group-open:rotate-180" /></summary>
            <ActionForm key={chosen?.id ?? "new"} action={submitElectionAction} submit="Send for approval" pending="Sending…" hidden={{ employeeId: employee.id, planKind: kind }} variant="secondary" className="pb-5">
              <Field name="choice" label={`${planKindLabels[kind]} plan`} required defaultValue={chosen ? chosen.planId ? `${chosen.planId}:${chosen.tier}` : "waive" : "waive"} options={[{ value: "waive", label: "Waive" }, ...options.map((option) => ({ value: option.value, label: `${option.plan.name}, ${tierLabels[option.rate.tier].toLowerCase()}: ${rateText(option.plan, option.rate, company.currency)}` }))]} />
              {contribution && <Field name="contribution" label={contribution.plan.percent ? "Your percent of pay" : `Your monthly amount in ${company.currency}`} inputMode="decimal" defaultValue={chosen?.chosenBp !== null && chosen?.chosenBp !== undefined ? String(chosen.chosenBp / 100) : chosen?.chosenCents !== null && chosen?.chosenCents !== undefined ? (chosen.chosenCents / 100).toFixed(2) : ""} />}
              {dependents.length > 0 && options.some((option) => option.rate.tier !== "employee") && <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">Dependents to cover</legend><div className="grid gap-2.5 sm:grid-cols-2">{dependents.map((dependent) => <Checkbox key={dependent.id} name={`dependent-${dependent.id}`} defaultChecked={chosen?.dependentIds.includes(dependent.id)} label={dependent.name} hint={relationshipLabels[dependent.relationship]} />)}</div></fieldset>}
              <div className="grid gap-1 text-[13px] leading-relaxed text-muted">{[...new Map(options.map((option) => [option.plan.id, option])).values()].map(({ plan, coverageStart }) => <p key={plan.id} className="wrap-anywhere"><span className="font-medium text-foreground">{plan.name}.</span> Coverage from {formatDate(coverageStart)}, {plan.preTax ? "before tax" : "after tax"}. {plan.description} {plan.documentId && plan.documentName && <a href={`/workspace/documents/${plan.documentId}`} className="text-accent underline underline-offset-3">{plan.documentName}</a>}</p>)}</div>
            </ActionForm>
          </details></li>;
        })}</ul></Section>}
        <Section title="Choices and coverage" action={canEnroll && !requested && query.add !== "event" && <Link href={`${base}?add=event`} className={`${textLink} text-[13px]`}>{canManage && !own ? "Open enrollment for a life event" : "Report a life event"}</Link>}>
          {requested && <p className="py-3 text-sm text-amber">A life event is waiting for an administrator’s review.</p>}
          {elections.length ? <ul className="divide-y divide-line">{elections.map((election) => <li key={election.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2"><div className="min-w-0"><p className="font-medium wrap-anywhere">{electionText(election, company.currency)}</p><p className="text-muted">From {formatDate(election.coverageStart)}{election.coverageEnd && ` to ${formatDate(election.coverageEnd)}`}</p>{election.dependents.length > 0 && <p className="wrap-anywhere text-muted">Covers {election.dependents.join(", ")}</p>}</div>
              <div className="flex items-center gap-3"><span className={`text-[13px] font-medium ${past(election.coverageEnd) ? "text-muted" : colors[election.state]}`}>{election.state === "approved" && past(election.coverageEnd) ? "Ended" : electionLabels[election.state]}</span>
                {own && election.state === "pending" && <ActionButtons action={decideElectionAction} hidden={{ id: election.id }} name="decision" buttons={[{ value: "cancelled", label: "Cancel", describe: `Cancel your ${planKindLabels[election.planKind]} choice`, variant: "text", confirm: { title: "Cancel this choice?", body: "Your current coverage stays as it is.", action: "Cancel choice", danger: true } }]} />}</div></div>
            {canManage && election.state === "approved" && election.planId && !past(election.coverageEnd) && <details className="group mt-1"><summary className="inline-flex min-h-8 items-center gap-1.5 rounded text-[13px] text-muted hover:text-foreground">End coverage<span className="sr-only"> for {planKindLabels[election.planKind]}</span><CaretDownIcon aria-hidden="true" size={12} className="group-open:rotate-180" /></summary>
              <ActionForm action={endElectionAction} submit="Save end date" hidden={{ id: election.id }} variant="secondary" inline className="pt-2"><Field name="endsOn" label="Last day of coverage" type="date" required defaultValue={election.coverageStart > day ? election.coverageStart : day} wrapperClass="w-48" /></ActionForm></details>}
          </li>)}</ul> : <Empty>No benefit choices yet.</Empty>}
        </Section>
      </div>
      <Section title="Dependents" action={person && query.add !== "dependent" && <Link href={`${base}?add=dependent`} className={`${textLink} text-[13px]`}>Add a dependent</Link>}>
        {query.add === "dependent" && person && <div className="pt-3 pb-5"><ActionForm action={addDependentAction} submit="Add dependent" hidden={{ employeeId: employee.id }} secondary={<Link href={base} className={textButton}>Close</Link>}>
          <Field name="name" label="Full name" required maxLength={160} autoComplete="off" /><Field name="relationship" label="Relationship" required options={Object.entries(relationshipLabels).map(([value, label]) => ({ value, label }))} /><Field name="born" label="Date of birth" type="date" required hint="Encrypted. Shared only in the broker export." />
        </ActionForm></div>}
        {dependents.length ? <ul className="divide-y divide-line">{dependents.map((dependent) => <li key={dependent.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm"><div className="min-w-0"><p className="font-medium wrap-anywhere">{dependent.name}</p><p className="text-muted">{relationshipLabels[dependent.relationship]}, born {formatDate(dependent.born)}{dependent.covered && ", covered"}</p></div>
          {!dependent.covered && <ActionButtons action={removeDependentAction} hidden={{ id: dependent.id }} name="operation" buttons={[{ value: "remove", label: "Remove", describe: `Remove ${dependent.name}`, variant: "text", confirm: { title: `Remove ${dependent.name}?`, body: "Past coverage keeps their name.", action: "Remove dependent", danger: true } }]} />}</li>)}</ul> : <Empty>No dependents added.</Empty>}
      </Section>
    </div>
  </>;
}
