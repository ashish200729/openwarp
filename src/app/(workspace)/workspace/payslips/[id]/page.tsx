import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { tableBody, tableHead } from "@/components/ui";
import { itemGroup, itemKinds } from "@/components/workspace/pay-items";
import { PrintButton } from "@/components/workspace/pay-print";
import { BackLink } from "@/components/workspace/presentation";
import { dateRange } from "@/components/workspace/requests";
import { runTitle } from "@/lib/domains/pay";
import { formatMoney } from "@/lib/operations";
import { employmentLabels, formatDate } from "@/lib/people";
import { requireMember, workspaceName } from "@/lib/server/member";
import { readPayslip } from "@/lib/server/pay";

export const metadata: Metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const { id } = await params;
  const result = z.uuid().safeParse(id).success ? await readPayslip(member, id) : null;
  if (!result) notFound();
  const { slip, items, ytd } = result;
  const amount = (cents: number) => formatMoney(cents, slip.currency);
  const facts = [["Employee", slip.name], ["Job title", slip.title], ["Employment type", employmentLabels[slip.employmentType]], ["Period", dateRange(slip.periodStart, slip.periodEnd)], ["Pay date", formatDate(slip.payOn)], ["Run", runTitle({ ...slip, label: "" })],
    ...(slip.hours !== null ? [["Hours", `${slip.hours} regular${slip.overtimeHours ? `, ${slip.overtimeHours} overtime` : ""}`]] : [])];
  return <>
    <div className="print:hidden"><BackLink href={slip.employeeId === member.employeeId ? "/workspace/payslips" : `/workspace/payslips?employee=${slip.employeeId}`}>Payslips</BackLink></div>
    {/* Printing covers the workspace around it and always uses light colors. */}
    <article className="max-w-3xl print:absolute print:inset-0 print:z-50 print:min-h-full print:max-w-none print:bg-surface print:p-8 print:text-foreground print:scheme-light">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0"><h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em]">Payslip</h1><p className="mt-1 text-sm wrap-anywhere text-muted">{workspaceName()}</p></div><PrintButton />
      </header>
      <dl className="mb-7 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3 print:grid-cols-3">{facts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[13px] text-muted">{label}</dt><dd className="font-medium wrap-anywhere">{value}</dd></div>)}</dl>
      <table className="w-full"><caption className="sr-only">Pay and year to date</caption>
        <thead className={tableHead}><tr><th scope="col">Description</th><th scope="col" className="text-right">This run</th><th scope="col" className="text-right">Year to date</th></tr></thead>
        {itemKinds.filter((kind) => kind !== "employer" && items.some((item) => item.kind === kind)).map((kind) => <tbody key={kind} className={`${tableBody} [&_td]:py-1.5 [&_th]:py-1.5`}>
          <tr><th scope="rowgroup" colSpan={3} className="pt-4! text-[13px] text-muted">{itemGroup(kind)}</th></tr>
          {items.filter((item) => item.kind === kind).map((item) => <tr key={item.label}><th scope="row" className="wrap-anywhere">{item.label}{item.detail && <span className="block text-[13px] text-muted">{item.detail}</span>}</th><td className="text-right align-top tabular-nums">{amount(item.amountCents)}</td><td className="text-right align-top tabular-nums">{amount(item.ytdCents)}</td></tr>)}
        </tbody>)}
        <tfoot className={tableBody}>
          <tr className="border-t border-line-strong"><th scope="row">Gross pay</th><td className="text-right tabular-nums">{amount(slip.grossCents)}</td><td className="text-right tabular-nums">{amount(ytd.gross)}</td></tr>
          <tr><th scope="row" className="text-base font-semibold!">Net pay</th><td className="text-right text-base font-semibold tabular-nums">{amount(slip.netCents)}</td><td className="text-right text-base font-semibold tabular-nums">{amount(ytd.net)}</td></tr>
        </tfoot>
      </table>
      {items.some((item) => item.kind === "employer") && <table className="mt-7 w-full"><caption className="sr-only">Employer contributions, paid on top of your pay</caption>
        <thead className={tableHead}><tr><th scope="col">Employer contributions, not part of net pay</th><th scope="col" className="text-right">This run</th><th scope="col" className="text-right">Year to date</th></tr></thead>
        <tbody className={`${tableBody} [&_td]:py-1.5 [&_th]:py-1.5`}>{items.filter((item) => item.kind === "employer").map((item) => <tr key={item.label}><th scope="row" className="wrap-anywhere">{item.label}</th><td className="text-right tabular-nums">{amount(item.amountCents)}</td><td className="text-right tabular-nums">{amount(item.ytdCents)}</td></tr>)}</tbody></table>}
      <p className="mt-6 text-[13px] leading-relaxed text-muted">Year to date covers pay runs recorded in OpenWarp with a pay date in {slip.payOn.slice(0, 4)}, up to this one. Your employer set the deductions and tax rates.</p>
    </article>
  </>;
}
