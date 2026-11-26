import "server-only";
import type { PoolClient } from "pg";
import { formatDate } from "@/lib/people";
import { hasBankDetails } from "./bank";
import { benefitCounts, endCoverageForLeaver, enrollmentStatus, forgetLeaving } from "./benefits";
import { pendingInvoices } from "./invoices";
import type { Member } from "./member";
import type { Todo } from "./modules";

export async function todos(member: Member): Promise<Todo[]> {
  const admin = member.role === "admin";
  const [setup, invoices, benefits] = await Promise.all([member.employeeId ? paySetup(member.employeeId) : null, admin || member.managesPeople ? pendingInvoices(member) : [], admin ? benefitCounts() : null]);
  const list: Todo[] = [];
  if (setup && !setup.hasBankDetails) list.push({ key: "pay-bank", href: `/workspace/people/${member.employeeId}/bank`, title: "Add your bank details", detail: "Needed to pay you by bank transfer", meta: "" });
  if (setup?.enrollmentOpen && !setup.enrollmentDone) list.push({ key: "pay-enrollment", href: `/workspace/people/${member.employeeId}/benefits`, title: "Choose your benefits", detail: "Choose or waive each type", meta: setup.closesOn ? `By ${formatDate(setup.closesOn)}` : "" });
  for (const invoice of invoices) list.push({ key: `invoice-${invoice.id}`, href: "/workspace/invoices", title: `${invoice.employeeName} submitted invoice ${invoice.number}`, detail: formatDate(invoice.issuedOn), meta: "" });
  const waiting = (key: string, count: number, one: string, many: string, detail: string) => { if (count) list.push({ key, href: "/workspace/benefits", title: count === 1 ? one : `${count} ${many}`, detail, meta: "" }); };
  if (benefits) {
    waiting("benefit-elections", benefits.elections, "A benefit choice is waiting", "benefit choices are waiting", "Approve or decline");
    waiting("benefit-events", benefits.events, "A life event is waiting", "life events are waiting", "Open or decline a benefit change");
    waiting("benefit-notices", benefits.notices, "Tell the carrier about a leaver", "leavers to report to the carrier", "Coverage ends and any COBRA notice");
  }
  return list;
}

// New hire enrollment opens from the start date on its own. Coverage from an earlier employment stays ended.
export async function onOnboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {
  await forgetLeaving(client, employeeId);
}

export async function onOffboarding(client: PoolClient, member: Member, employeeId: string): Promise<void> {
  await endCoverageForLeaver(client, member, employeeId);
}

// Someone archived while a draft holds them could still be paid by it.
export async function draftRunBlockers(client: PoolClient, employeeId: string): Promise<string[]> {
  const { rowCount } = await client.query("SELECT 1 FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id WHERE l.employee_id = $1 AND r.state = 'draft' LIMIT 1", [employeeId]);
  return rowCount ? ["They are in a draft pay run. Approve it or remove them."] : [];
}

export async function archiveBlockers(client: PoolClient, employeeId: string): Promise<string[]> {
  const { rows: [open] } = await client.query<{ expenses: boolean; invoices: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM expenses WHERE employee_id = $1 AND state = 'approved') AS expenses, EXISTS (SELECT 1 FROM contractor_invoices WHERE employee_id = $1 AND state = 'approved') AS invoices`, [employeeId]);
  return [
    ...await draftRunBlockers(client, employeeId),
    ...(open.expenses ? ["They have an approved expense that hasn’t been reimbursed."] : []),
    ...(open.invoices ? ["They have an approved invoice that hasn’t been paid."] : []),
  ];
}

// What the onboarding portal needs to know before someone can be paid.
export async function paySetup(employeeId: string): Promise<{ hasBankDetails: boolean; enrollmentOpen: boolean; enrollmentDone: boolean; closesOn: string | null }> {
  const [bank, enrollment] = await Promise.all([hasBankDetails(employeeId), enrollmentStatus(employeeId)]);
  return { hasBankDetails: bank, enrollmentOpen: enrollment.open, enrollmentDone: enrollment.done, closesOn: enrollment.window?.closesOn ?? null };
}
