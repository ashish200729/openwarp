import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { PaySetup } from "@/components/workspace/pay-setup";
import { Empty, Section } from "@/components/workspace/presentation";
import { ProfileHeader } from "@/components/workspace/profile-header";
import { tableBody, tableHead, textLink } from "@/components/ui";
import { today } from "@/lib/operations";
import { employmentLabels, formatDate } from "@/lib/people";
import { bankHistory } from "@/lib/server/bank";
import { listCompensation, listJobChanges, payLabel } from "@/lib/server/pay";
import { employeePaySetup } from "@/lib/server/payroll-rules";
import { readCompany } from "@/lib/server/settings";
import { addCompensationAction } from "../../../operations";
import { privateProfile } from "../profile";

export const metadata: Metadata = { title: "Job and pay" };

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ add?: string }> }) {
  const { member, employee, canManage } = await privateProfile(params);
  const { add } = await searchParams;
  const [pay, changes, company, bank, setup] = await Promise.all([listCompensation(member, employee.id), listJobChanges(member, employee.id), readCompany(), bankHistory(member, employee.id), canManage ? employeePaySetup(employee.id) : null]);
  const now = today();
  const current = pay?.find((entry) => entry.effectiveOn <= now);
  return <>
    <ProfileHeader employee={employee} current="job" canSeePrivate />
    <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-9">
        <Section title="Pay">
          {pay?.length ? <table className="w-full"><caption className="sr-only">Pay history</caption><thead className={tableHead}><tr><th scope="col">Effective</th><th scope="col">Pay</th><th scope="col">Reason</th></tr></thead>
            <tbody className={tableBody}>{pay.map((entry) => <tr key={entry.id}><th scope="row" className="align-top whitespace-nowrap">{formatDate(entry.effectiveOn)}</th><td className="align-top tabular-nums"><span className={entry === current ? "font-semibold" : ""}>{payLabel(entry)}</span>{entry === current && <span className="block text-[13px] text-positive">Current</span>}{entry.effectiveOn > now && <span className="block text-[13px] text-amber">Upcoming</span>}</td><td className="align-top wrap-anywhere text-muted">{entry.reason || "None given"}</td></tr>)}</tbody></table> : <Empty>No pay recorded.</Empty>}
        </Section>
        <Section title="Job history">{changes?.length ? <ol className="divide-y divide-line">{changes.map((change) => <li key={change.id} className="grid gap-x-4 py-3 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)]"><span className="text-muted tabular-nums">{formatDate(change.changedOn)}</span><div className="min-w-0"><p className="font-medium wrap-anywhere">{change.title}</p><p className="text-[13px] wrap-anywhere text-muted">{[change.teamName || "No team", employmentLabels[change.employmentType], change.managerName ? `reports to ${change.managerName}` : "no manager"].join(", ")}</p></div></li>)}</ol> : <Empty>No job history yet.</Empty>}</Section>
      </div>
      <div className="grid content-start gap-9">
        {canManage && employee.status !== "archived" && <Section title="Record a pay change"><div className="pt-3"><ActionForm action={addCompensationAction} submit="Record pay" hidden={{ employeeId: employee.id }}>
          <div className="grid grid-cols-2 gap-4"><Field name="amount" label={`Amount in ${company.currency}`} required inputMode="decimal" placeholder="0.00" /><Field name="basis" label="Basis" required options={[{ value: "annual", label: "Per year" }, { value: "hourly", label: "Per hour" }]} /></div>
          <Field name="effectiveOn" label="Effective date" type="date" required defaultValue={current ? now : employee.hireDate} />
          <Field name="reason" label="Reason" maxLength={200} />
          <p className="text-[13px] text-muted">Pay records can’t be edited. Record a new one to correct a mistake.</p>
        </ActionForm></div></Section>}
        <Section title="Getting paid">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-3 text-sm"><span>Bank account</span><span className="flex flex-wrap gap-x-3"><span className={bank[0] ? "tabular-nums" : "text-amber"}>{bank[0] ? `Ending ${bank[0].last4}` : "Not recorded"}</span><Link href={`/workspace/people/${employee.id}/bank`} className={textLink}>Bank details</Link></span></div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm"><span>Payslips</span><Link href={`/workspace/payslips${member.employeeId === employee.id ? "" : `?employee=${employee.id}`}`} className={textLink}>Open payslips</Link></div>
        </Section>
      </div>
    </div>
    {setup && <PaySetup employeeId={employee.id} employmentType={employee.employmentType} location={employee.location} setup={setup} currency={company.currency} add={add} editable={employee.status !== "archived"} />}
  </>;
}
