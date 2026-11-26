import type { Metadata } from "next";
import Link from "next/link";
import { panelStyle, primaryButton, textButton } from "@/components/ui";
import { ActionForm, Field } from "@/components/workspace/action-form";
import { Callout, Empty, Notice, PageHeader, Section } from "@/components/workspace/presentation";
import { ExpenseList } from "@/components/workspace/requests";
import { expenseCategories, expenseLabels, today } from "@/lib/operations";
import { approvedExpenses, ownExpenses, pendingExpenses } from "@/lib/server/expenses";
import { requireMember } from "@/lib/server/member";
import { readCompany } from "@/lib/server/settings";
import { decideExpenseAction, submitExpenseAction } from "../operations";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ new?: string; saved?: string }> }) {
  const member = await requireMember();
  const query = await searchParams;
  const decides = member.role === "admin" || member.managesPeople;
  const adding = query.new === "1" && Boolean(member.employeeId);
  const [pending, own, approved, company] = await Promise.all([decides ? pendingExpenses(member) : [], ownExpenses(member), approvedExpenses(member), readCompany()]);
  return <>
    <PageHeader title="Expenses" description="Approved expenses are reimbursed in the next pay run." actions={member.employeeId && !adding && <Link href="/workspace/expenses?new=1" className={primaryButton}>Submit an expense</Link>} />
    {query.saved === "submitted" && <Notice>Expense sent for approval.</Notice>}
    {!member.employeeId && <Callout>Your account isn’t linked to an employee record, so you can’t submit expenses. {member.role === "admin" ? <Link href="/workspace/settings/access" className="text-accent underline underline-offset-3">Link it in Access</Link> : "Ask an administrator to link it."}</Callout>}
    {adding && <section className={`${panelStyle} mb-8 max-w-2xl p-5`}>
      <h2 className="mb-4 text-[15px] font-semibold">Submit an expense</h2>
      <ActionForm action={submitExpenseAction} submit="Send for approval" pending="Sending…" secondary={<Link href="/workspace/expenses" className={textButton}>Close</Link>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="merchant" label="Merchant" required maxLength={120} /><Field name="amount" label={`Amount in ${company.currency}`} required inputMode="decimal" placeholder="0.00" />
          <Field name="spentOn" label="Date spent" type="date" required defaultValue={today()} /><Field name="category" label="Category" required options={expenseCategories.map((value) => ({ value, label: expenseLabels[value] }))} />
        </div>
        <Field name="receipt" label="Receipt" type="file" accept="application/pdf,image/png,image/jpeg" hint="PDF, PNG or JPEG, up to 5 MB." />
        <Field name="note" label="Note" multiline maxLength={500} />
      </ActionForm>
    </section>}
    {decides && <Section title="Waiting for approval" className="mb-9">{pending.length ? <ExpenseList expenses={pending} action={decideExpenseAction} mode="decide" /> : <Empty>No expenses are waiting.</Empty>}</Section>}
    {member.employeeId && <Section title="Your expenses" className="mb-9">{own.length ? <ExpenseList expenses={own} action={decideExpenseAction} mode="own" /> : <Empty>You haven’t submitted an expense.</Empty>}</Section>}
    {member.role === "admin" && <Section title="Approved">{approved.length ? <ExpenseList expenses={approved} mode="read" /> : <Empty>No approved expenses yet.</Empty>}</Section>}
  </>;
}
