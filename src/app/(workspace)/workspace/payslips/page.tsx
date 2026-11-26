import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { secondaryButton, tableBody, tableHead, textButton, textLink } from "@/components/ui";
import { BackLink, Callout, Empty, EmptyState, PageHeader } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { runTitle } from "@/lib/domains/pay";
import { formatMoney } from "@/lib/operations";
import { formatDate } from "@/lib/people";
import { employeeProfile } from "@/lib/server/directory";
import { canInvoice } from "@/lib/server/invoices";
import { requireMember } from "@/lib/server/member";
import { listPayslips } from "@/lib/server/pay";

export const metadata: Metadata = { title: "Payslips" };

export default async function PayslipsPage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const member = await requireMember();
  const { employee } = await searchParams;
  const other = employee && employee !== member.employeeId ? employee : null;
  if (other && (member.role !== "admin" || !z.uuid().safeParse(other).success)) notFound();
  const employeeId = other ?? member.employeeId;
  const [profile, slips, invoices] = await Promise.all([other ? employeeProfile(member, other) : null, employeeId ? listPayslips(member, employeeId) : [], canInvoice(member)]);
  if (other && !profile) notFound();
  return <>
    {profile && <BackLink href={`/workspace/people/${profile.employee.id}/job`}>Job and pay</BackLink>}
    <PageHeader title={profile ? `${profile.employee.firstName} ${profile.employee.lastName}’s payslips` : "Payslips"} description="One for each approved pay run." actions={<>
      {(invoices || member.role === "admin" || member.managesPeople) && <Link href="/workspace/invoices" className={textButton}>Invoices</Link>}
      {employeeId && <Link href={`/workspace/people/${employeeId}/bank`} className={secondaryButton}>Bank details</Link>}
    </>} />
    {!employeeId ? member.role === "admin" ? <Empty>Open anyone’s payslips from their Job and pay page.</Empty> : <Callout>Your account isn’t linked to an employee record. Ask an administrator to link it.</Callout>
      : slips.length ? <table className="w-full"><caption className="sr-only">Payslips</caption>
        <thead className={tableHead}><tr><th scope="col">Pay date</th><th scope="col" className="max-sm:hidden">Period</th><th scope="col" className="max-sm:hidden">Type</th><th scope="col" className="text-right">Net pay</th></tr></thead>
        <tbody className={tableBody}>{slips.map((slip) => <tr key={slip.id}><th scope="row"><Link href={`/workspace/payslips/${slip.id}`} className={`${textLink} font-medium`}>{formatDate(slip.payOn)}</Link><span className="block text-[13px] text-muted sm:hidden">{dateRange(slip.periodStart, slip.periodEnd)}</span></th><td className="max-sm:hidden">{dateRange(slip.periodStart, slip.periodEnd)}</td><td className="max-sm:hidden">{runTitle({ ...slip, label: "" })}</td><td className="text-right font-medium tabular-nums">{formatMoney(slip.netCents, slip.currency)}</td></tr>)}</tbody>
      </table> : <EmptyState title="No payslips yet" description="A payslip appears here when a pay run that includes you is approved." />}
  </>;
}
