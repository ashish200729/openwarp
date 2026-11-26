import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type { bankFields } from "@/lib/domains/pay";
import { keyedHash, seal, unseal } from "./crypto";
import { pool } from "./db";
import { queueEmail } from "./email";
import type { Member } from "./member";
import { confirmMember, requireConfirmed } from "./reauth";
import { audit, PeopleError, requireOwnEmployee, runAsMember } from "./write";

type Client = Pick<PoolClient, "query">;
export type BankSummary = { kind: "us" | "iban"; last4: string; createdAt: Date; createdBy: string };
export type BankCheck = { kind: "us" | "iban"; fingerprint: string };
export type BankDetails = { holder: string } & ({ kind: "us"; routing: string; account: string; type: "checking" | "savings" } | { kind: "iban"; iban: string; bic: string });

// Only the last four digits and who recorded them are ever listed.
export async function bankHistory(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return [];
  const { rows } = await pool().query<BankSummary>(
    `SELECT b.kind, b.last4, b.created_at AS "createdAt", u.name AS "createdBy" FROM bank_accounts b JOIN "user" u ON u.id = b.created_by WHERE b.employee_id = $1 ORDER BY b.id DESC LIMIT 20`, [employeeId],
  );
  return rows;
}

export async function hasBankDetails(employeeId: string) {
  const { rowCount } = await pool().query("SELECT 1 FROM bank_accounts WHERE employee_id = $1 LIMIT 1", [employeeId]);
  return Boolean(rowCount);
}

export async function currentBankChecks(client: Client, employeeIds: string[]) {
  const { rows } = await client.query<BankCheck & { employeeId: string }>(
    `SELECT DISTINCT ON (employee_id) employee_id AS "employeeId", kind, fingerprint FROM bank_accounts WHERE employee_id = ANY($1::uuid[]) ORDER BY employee_id, id DESC`, [employeeIds],
  );
  return new Map(rows.map((row) => [row.employeeId, row]));
}

// People whose current bank account is also someone else's.
export async function sharedBankAccounts(client: Client, employeeIds: string[]) {
  const { rows } = await client.query<{ employeeId: string; others: string }>(
    `WITH current AS (SELECT DISTINCT ON (b.employee_id) b.employee_id, b.fingerprint FROM bank_accounts b JOIN employees e ON e.id = b.employee_id WHERE e.status <> 'archived' OR e.id = ANY($1::uuid[]) ORDER BY b.employee_id, b.id DESC)
     SELECT c.employee_id AS "employeeId", string_agg(concat_ws(' ', e.first_name, e.last_name), ', ' ORDER BY e.last_name, e.id) AS others
     FROM current c JOIN current o ON o.fingerprint = c.fingerprint AND o.employee_id <> c.employee_id JOIN employees e ON e.id = o.employee_id WHERE c.employee_id = ANY($1::uuid[]) GROUP BY 1`, [employeeIds],
  );
  return new Map(rows.map((row) => [row.employeeId, row.others]));
}

// Payment files are the only place full account details leave sealed storage.
export async function unsealBankDetails(client: Client, employeeIds: string[]) {
  const { rows } = await client.query<{ employeeId: string; sealed: Buffer }>(
    `SELECT DISTINCT ON (employee_id) employee_id AS "employeeId", sealed FROM bank_accounts WHERE employee_id = ANY($1::uuid[]) ORDER BY employee_id, id DESC`, [employeeIds],
  );
  return new Map(rows.map((row) => [row.employeeId, JSON.parse(unseal(row.sealed, row.employeeId)) as BankDetails]));
}

export async function saveBankDetails(member: Member, input: z.infer<typeof bankFields>) {
  const own = member.employeeId === input.employeeId;
  if (!own && member.role !== "admin") throw new PeopleError("You can only change your own bank details.");
  const confirmation = own ? await confirmMember(member, input.password) : null;
  return runAsMember(member, async (client, actor) => {
    if (own ? actor.employeeId !== input.employeeId : actor.role !== "admin") throw new PeopleError("You can only change your own bank details.");
    if (confirmation) await requireConfirmed(client, member, confirmation);
    await requireOwnEmployee(client, { ...actor, employeeId: input.employeeId });
    const details: BankDetails = input.kind === "us" ? { kind: "us", holder: input.holder, routing: input.routing, account: input.account, type: input.type } : { kind: "iban", holder: input.holder, iban: input.iban, bic: input.bic };
    const number = details.kind === "us" ? details.account : details.iban;
    await client.query("INSERT INTO bank_accounts (employee_id, kind, sealed, last4, fingerprint, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
      [input.employeeId, details.kind, seal(JSON.stringify(details), input.employeeId), number.slice(-4), keyedHash(details.kind === "us" ? `${details.routing}:${number}` : number, "bank"), member.id]);
    await audit(client, member, "bank_details.updated", { employeeId: input.employeeId });
    await announceChange(client, member, input.employeeId);
  });
}

// The employee hears about every change, including one made from their own account, and so do the administrators. The email is sent
// directly because a notification can be read, or its email turned off, by whoever holds the session that made the change.
async function announceChange(client: PoolClient, member: Member, employeeId: string) {
  const { rows } = await client.query<{ userId: string; own: boolean; name: string }>(
    `SELECT m.user_id AS "userId", m.employee_id IS NOT DISTINCT FROM e.id AS own, concat_ws(' ', e.first_name, e.last_name) AS name FROM workspace_members m CROSS JOIN employees e
     WHERE e.id = $1 AND m.role <> 'disabled' AND (m.employee_id = e.id OR m.role = 'admin' AND m.user_id <> $2)`, [employeeId, member.id]);
  for (const { userId, own, name } of rows) {
    const title = own ? "Your bank details changed" : `${name}’s bank details changed`;
    const body = own ? "If you didn’t expect this, tell an administrator now." : "Confirm the change with them before the next payment file.";
    await client.query("INSERT INTO notifications (user_id, title, body, href, emailed_at) VALUES ($1, $2, $3, $4, now())", [userId, title.slice(0, 160), body, `/workspace/people/${employeeId}/bank`]);
    await queueEmail(client, { userId, kind: "changed", subject: title, text: `${title}. ${body}` });
  }
}
