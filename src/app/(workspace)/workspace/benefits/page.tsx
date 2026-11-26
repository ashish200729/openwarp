import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DownloadSimpleIcon } from "@/components/icons";
import { secondaryButton, tableBody, tableHead, textButton, textLink } from "@/components/ui";
import { ActionButtons } from "@/components/workspace/action-form";
import { electionText } from "@/components/workspace/benefit-text";
import { Avatar, Callout, Empty, PageHeader, Section } from "@/components/workspace/presentation";
import { planKindLabels, tierLabels } from "@/lib/domains/pay";
import { formatDate } from "@/lib/people";
import { benefitsOverview } from "@/lib/server/benefits";
import { requireMember } from "@/lib/server/member";
import { readCompany } from "@/lib/server/settings";
import { closeNoticeAction, decideElectionAction, decideEventAction, restoreCoverageAction } from "./actions";

export const metadata: Metadata = { title: "Benefits" };

export default async function BenefitsPage() {
  const member = await requireMember();
  if (member.role !== "admin") {
    if (member.employeeId) redirect(`/workspace/people/${member.employeeId}/benefits`);
    return <><PageHeader title="Benefits" /><Callout>Your account isn’t linked to an employee record. Ask an administrator to link it.</Callout></>;
  }
  const [{ pending, events, notices, current }, company] = await Promise.all([benefitsOverview(), readCompany()]);
  return <>
    <PageHeader title="Benefits" description="Approved choices become deductions and contributions in regular pay runs." actions={<>
      {member.employeeId && <Link href={`/workspace/people/${member.employeeId}/benefits`} className={textButton}>Your benefits</Link>}
      <Link href="/workspace/settings/benefits" className={secondaryButton}>Plans and enrollment</Link>
      <a href="/workspace/benefits/export" className={secondaryButton}><DownloadSimpleIcon aria-hidden="true" size={15} /> Export CSV</a>
    </>} />
    <Callout>OpenWarp doesn’t send anything to insurance carriers or benefit providers. Export the choices and send them to your broker.</Callout>
    {notices.length > 0 && <Section title="Tell the carrier" className="mb-9"><ul className="divide-y divide-line">{notices.map((notice) => <li key={notice.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium wrap-anywhere">{notice.employeeName}</p><p className="max-w-[60ch] text-muted">{notice.lastDay ? `Coverage ends on ${formatDate(notice.lastDay)}. Tell the carrier, and send any COBRA notice that applies.` : notice.mismatch ? "Their offboarding was cancelled, so their coverage should continue." : "They left and were rehired. Tell the carrier about the earlier end if you haven’t."}{notice.mismatch && notice.lastDay && " Their last day changed after coverage was ended."}</p></div>
      <div className="flex flex-wrap gap-2">
        {notice.mismatch && <ActionButtons action={restoreCoverageAction} hidden={{ id: notice.id }} name="operation" buttons={[{ value: "restore", label: notice.lastDay ? "Use new last day" : "Restore coverage", describe: `${notice.lastDay ? "Use new last day" : "Restore coverage"} for ${notice.employeeName}`, variant: "primary" }]} />}
        <ActionButtons action={closeNoticeAction} hidden={{ id: notice.id }} name="operation" buttons={[{ value: "done", label: "Mark done", describe: `Mark done for ${notice.employeeName}`, confirm: { title: "Has the carrier been told?", body: "This closes the task and is recorded in the activity history.", action: "Close task" } }]} />
      </div></li>)}</ul></Section>}
    <Section title="Choices waiting for approval" className="mb-9">{pending.length ? <ul className="divide-y divide-line">{pending.map((election) => <li key={election.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
      <div className="flex min-w-0 items-start gap-3"><Avatar name={election.employeeName} /><div className="min-w-0 text-sm"><p><Link href={`/workspace/people/${election.employeeId}/benefits`} className="font-medium hover:underline">{election.employeeName}</Link></p><p className="wrap-anywhere text-muted">{electionText(election, company.currency)}, from {formatDate(election.coverageStart)}</p>{election.dependents.length > 0 && <p className="wrap-anywhere text-muted">Covers {election.dependents.join(", ")}</p>}</div></div>
      <ActionButtons action={decideElectionAction} hidden={{ id: election.id }} name="decision" buttons={[{ value: "approved", label: "Approve", describe: `Approve ${election.employeeName}’s ${planKindLabels[election.planKind]} choice`, variant: "primary" }, { value: "declined", label: "Decline", describe: `Decline ${election.employeeName}’s ${planKindLabels[election.planKind]} choice` }]} />
    </li>)}</ul> : <Empty>No choices are waiting.</Empty>}</Section>
    <Section title="Life events waiting for review" className="mb-9">{events.length ? <ul className="divide-y divide-line">{events.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium wrap-anywhere">{event.employeeName}</p><p className="text-muted">{event.name}, {event.eventOn && formatDate(event.eventOn)}. Opens for 30 days with coverage from the event date.</p></div>
      <ActionButtons action={decideEventAction} hidden={{ id: event.id }} name="decision" buttons={[{ value: "approved", label: "Open enrollment", describe: `Open enrollment for ${event.employeeName}`, variant: "primary" }, { value: "declined", label: "Decline", describe: `Decline ${event.employeeName}’s life event` }]} />
    </li>)}</ul> : <Empty>No life events are waiting.</Empty>}</Section>
    <Section title="Current coverage">{current.length ? <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Current coverage"><table className="w-full min-w-[40rem]"><caption className="sr-only">Current coverage</caption><thead className={tableHead}><tr><th scope="col">Employee</th><th scope="col">Type</th><th scope="col">Plan</th><th scope="col">Coverage</th><th scope="col">Starts</th><th scope="col">Ends</th></tr></thead>
      <tbody className={tableBody}>{current.map((election) => <tr key={election.id}><th scope="row"><Link href={`/workspace/people/${election.employeeId}/benefits`} className={textLink}>{election.employeeName}</Link></th><td>{planKindLabels[election.planKind]}</td><td className="wrap-anywhere">{election.planName}</td><td>{tierLabels[election.tier!]}</td><td className="whitespace-nowrap">{formatDate(election.coverageStart)}</td><td className="whitespace-nowrap">{election.coverageEnd ? formatDate(election.coverageEnd) : "None set"}</td></tr>)}</tbody></table></div> : <Empty>No one has approved coverage.</Empty>}</Section>
  </>;
}
