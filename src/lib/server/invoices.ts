import "server-only";
import type { z } from "zod";
import type { invoiceFields, InvoiceState } from "@/lib/domains/pay";
import { today } from "@/lib/operations";
import { pool } from "./db";
import { insertDocument, type Upload } from "./documents";
import type { Member } from "./member";
import { notify, notifyDeciders } from "./notify";
import { readCompany } from "./settings";
import { audit, PeopleError, requireDecider, requireOwnEmployee, runAsMember } from "./write";

export type InvoiceLine = { description: string; quantity: number; unitCents: number; amountCents: number };
export type Invoice = {
  id: string; employeeId: string; employeeName: string; number: string; issuedOn: string; currency: string; amountCents: number; note: string; documentId: string | null; state: InvoiceState; decidedBy: string | null; lines: InvoiceLine[];
};

const select = `SELECT x.id, x.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", x.number, to_char(x.issued_on, 'YYYY-MM-DD') AS "issuedOn", x.currency, x.amount_cents::float8 AS "amountCents", x.note,
  x.document_id AS "documentId", x.state, u.name AS "decidedBy",
  (SELECT coalesce(json_agg(json_build_object('description', n.description, 'quantity', n.quantity::float8, 'unitCents', n.unit_cents, 'amountCents', n.amount_cents) ORDER BY n.position), '[]') FROM contractor_invoice_lines n WHERE n.invoice_id = x.id) AS lines
  FROM contractor_invoices x JOIN employees e ON e.id = x.employee_id LEFT JOIN "user" u ON u.id = x.decided_by`;

export async function canInvoice(member: Member) {
  if (!member.employeeId) return false;
  const { rowCount } = await pool().query("SELECT 1 FROM employees WHERE id = $1 AND employment_type = 'contractor' AND status <> 'archived'", [member.employeeId]);
  return Boolean(rowCount);
}

export function submitInvoice(member: Member, input: z.infer<typeof invoiceFields>, upload: Upload | null) {
  return runAsMember(member, async (client, actor) => {
    const employeeId = await requireOwnEmployee(client, actor);
    const { rowCount: contractor } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND employment_type = 'contractor'", [employeeId]);
    if (!contractor) throw new PeopleError("Only contractors submit invoices.");
    if (input.issuedOn > today()) throw new PeopleError("The invoice date can’t be in the future.");
    const { rowCount: used } = await client.query("SELECT 1 FROM contractor_invoices WHERE employee_id = $1 AND lower(number) = lower($2) AND state NOT IN ('declined', 'cancelled')", [employeeId, input.number]);
    if (used) throw new PeopleError("You already submitted an invoice with that number.");
    const total = input.lines.reduce((sum, line) => sum + line.amountCents, 0);
    if (total <= 0 || total > 1_000_000_000) throw new PeopleError("The invoice total must be above zero and at most 10,000,000.00.");
    const { currency } = await readCompany(client);
    const documentId = upload ? await insertDocument(client, member, { name: `Invoice: ${input.number}`, category: "receipt", employeeId }, upload) : null;
    const { rows: [invoice] } = await client.query<{ id: string }>(
      "INSERT INTO contractor_invoices (employee_id, number, issued_on, currency, amount_cents, note, document_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id", [employeeId, input.number, input.issuedOn, currency, total, input.note, documentId]);
    await client.query(
      `INSERT INTO contractor_invoice_lines (invoice_id, position, description, quantity, unit_cents, amount_cents)
       SELECT $1, x.position, x.description, x.quantity, x.unit, x.amount FROM jsonb_to_recordset($2::jsonb) AS x(position integer, description text, quantity numeric, unit bigint, amount bigint)`,
      [invoice.id, JSON.stringify(input.lines.map((line, index) => ({ position: index + 1, description: line.description, quantity: line.quantity, unit: line.unitCents, amount: line.amountCents })))]);
    await audit(client, member, "invoice.submitted", { employeeId, detail: input.number });
    await notifyDeciders(client, member, employeeId, { title: `${member.name} submitted an invoice`, body: `Invoice ${input.number}`, href: "/workspace/invoices" });
  });
}

export function decideInvoice(member: Member, input: { id: string; decision: "approved" | "declined" | "cancelled" }) {
  return runAsMember(member, async (client, actor) => {
    const { rows: [invoice] } = await client.query<{ employeeId: string; state: InvoiceState; number: string }>(`SELECT employee_id AS "employeeId", state, number FROM contractor_invoices WHERE id = $1`, [input.id]);
    if (!invoice) throw new PeopleError("This invoice could not be found.");
    if (invoice.state !== "pending") throw new PeopleError("This invoice was already decided.");
    if (input.decision === "cancelled") {
      if (actor.employeeId !== invoice.employeeId) throw new PeopleError("You can only cancel your own invoices.");
    } else {
      await requireDecider(client, actor, invoice.employeeId);
      if (actor.employeeId === invoice.employeeId && actor.role !== "admin") throw new PeopleError("You can’t decide your own invoice.");
    }
    await client.query("UPDATE contractor_invoices SET state = $2, decided_by = $3, decided_at = now() WHERE id = $1", [input.id, input.decision, member.id]);
    await audit(client, member, `invoice.${input.decision}`, { employeeId: invoice.employeeId, detail: invoice.number });
    await notify(client, member, { employeeId: invoice.employeeId }, { title: `Your invoice was ${input.decision}`, body: `Invoice ${invoice.number}`, href: "/workspace/invoices" });
  });
}

export async function ownInvoices(member: Member) {
  if (!member.employeeId) return [];
  const { rows } = await pool().query<Invoice>(`${select} WHERE x.employee_id = $1 ORDER BY x.created_at DESC, x.id LIMIT 60`, [member.employeeId]);
  return rows;
}

export async function pendingInvoices(member: Member) {
  const { rows } = await pool().query<Invoice>(`${select} WHERE x.state = 'pending' AND e.status <> 'archived' AND ($1 = 'admin' OR e.manager_id = $2) ORDER BY x.created_at, x.id LIMIT 60`, [member.role, member.employeeId]);
  return rows;
}

export async function approvedInvoices(member: Member) {
  if (member.role !== "admin") return [];
  const { rows } = await pool().query<Invoice>(`${select} WHERE x.state IN ('approved', 'paid') ORDER BY x.state, x.decided_at DESC, x.id LIMIT 60`);
  return rows;
}
