import "server-only";
import type { z } from "zod";
import { formatMoney, today, type ExpenseCategory, type expenseFields, type RequestState } from "@/lib/operations";
import { pool } from "./db";
import { insertDocument, type Upload } from "./documents";
import type { Member } from "./member";
import { notify, notifyDeciders } from "./notify";
import { readCompany } from "./settings";
import { audit, PeopleError, requireDecider, requireOwnEmployee, runAsMember } from "./write";

export type Expense = {
  id: string; employeeId: string; employeeName: string; spentOn: string; merchant: string; category: ExpenseCategory;
  amountCents: number; currency: string; note: string; receiptId: string | null; state: RequestState; decidedBy: string | null;
};

const columns = `x.id, x.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", to_char(x.spent_on, 'YYYY-MM-DD') AS "spentOn",
  x.merchant, x.category, x.amount_cents::float8 AS "amountCents", x.currency, x.note, x.receipt_id AS "receiptId", x.state, u.name AS "decidedBy"`;
const from = `FROM expenses x JOIN employees e ON e.id = x.employee_id LEFT JOIN "user" u ON u.id = x.decided_by`;

export function submitExpense(member: Member, input: z.infer<typeof expenseFields>, upload: Upload | null) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    if (input.spentOn > today()) throw new PeopleError("The expense date can’t be in the future.");
    const { currency } = await readCompany(client);
    const receiptId = upload ? await insertDocument(client, member, { name: `Receipt: ${input.merchant}`.slice(0, 120), category: "receipt", employeeId }, upload) : null;
    await client.query("INSERT INTO expenses (employee_id, spent_on, merchant, category, amount_cents, currency, note, receipt_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [employeeId, input.spentOn, input.merchant, input.category, input.amount, currency, input.note, receiptId]);
    await audit(client, member, "expense.submitted", { employeeId, detail: formatMoney(input.amount, currency) });
    await notifyDeciders(client, member, employeeId, { title: `${member.name} submitted an expense`, body: `${input.merchant}, ${formatMoney(input.amount, currency)}`, href: "/workspace/expenses" });
  });
}

export function decideExpense(member: Member, input: { id: string; decision: "approved" | "declined" | "cancelled" }) {
  return runAsMember(member, async (client, actor) => {
    const { rows } = await client.query<{ employeeId: string; state: RequestState; amountCents: number; currency: string }>(
      `SELECT employee_id AS "employeeId", state, amount_cents::float8 AS "amountCents", currency FROM expenses WHERE id = $1`, [input.id],
    );
    const expense = rows[0];
    if (!expense) throw new PeopleError("This expense could not be found.");
    if (expense.state !== "pending") throw new PeopleError("This expense was already decided.");
    if (input.decision === "cancelled") {
      if (actor.employeeId !== expense.employeeId) throw new PeopleError("You can only cancel your own expenses.");
    } else await requireDecider(client, actor, expense.employeeId);
    await client.query("UPDATE expenses SET state = $2, decided_by = $3, decided_at = now() WHERE id = $1", [input.id, input.decision, member.id]);
    await audit(client, member, `expense.${input.decision}`, { employeeId: expense.employeeId, detail: formatMoney(expense.amountCents, expense.currency) });
    await notify(client, member, { employeeId: expense.employeeId }, { title: `Your expense was ${input.decision}`, body: formatMoney(expense.amountCents, expense.currency), href: "/workspace/expenses" });
  });
}

export async function ownExpenses(member: Member) {
  if (!member.employeeId) return [];
  const { rows } = await pool().query<Expense>(`SELECT ${columns} ${from} WHERE x.employee_id = $1 ORDER BY x.created_at DESC, x.id LIMIT 60`, [member.employeeId]);
  return rows;
}

export async function pendingExpenses(member: Member) {
  const { rows } = await pool().query<Expense>(
    `SELECT ${columns} ${from} WHERE x.state = 'pending' AND e.status <> 'archived' AND ($1 = 'admin' OR e.manager_id = $2) ORDER BY x.created_at, x.id LIMIT 60`, [member.role, member.employeeId],
  );
  return rows;
}

export async function approvedExpenses(member: Member) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<Expense>(`SELECT ${columns} ${from} WHERE x.state IN ('approved', 'reimbursed') ORDER BY x.state, x.decided_at DESC, x.id LIMIT 60`);
  return rows;
}
