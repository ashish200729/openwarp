import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import {
  calculatePay, chosenTypes, monthlyToPeriod, periodOfYear, type assignmentFields, type CalculationBenefit, type CalculationGarnishment, type CalculationRule, type GarnishmentMethod, type garnishmentFields,
  type Item, type JournalAccount, type journalFields, type nachaFields, type paySettingsFields, type recurringFields, type RuleMethod, type ruleFields, type RunKind, type sepaFields, type Tier,
} from "@/lib/domains/pay";
import { periodsPerYear, type PaySchedule } from "@/lib/operations";
import type { EmploymentType } from "@/lib/people";
import { seal } from "./crypto";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { audit, PeopleError, runAsAdmin } from "./write";

type Client = Pick<PoolClient, "query">;
export type PaySettings = {
  newHireDays: number; journalDates: "iso" | "us" | "eu"; journalAccounts: Partial<Record<JournalAccount, string>>; nachaRouting: string; nachaBankName: string; nachaOriginId: string;
  nachaCompanyId: string; nachaCompanyName: string; sepaName: string; sepaIbanLast4: string; sepaBic: string; version: number;
};
export type PayRule = CalculationRule & {
  employmentTypes: EmploymentType[]; location: string; enrollment: "everyone" | "chosen"; effectiveFrom: string; effectiveTo: string | null; account: string; active: boolean; version: number;
};
export type Assignment = { ruleId: string; mode: "enrolled" | "override" | "exempt"; rateBp: number | null; amountCents: number | null };
export type RecurringEarning = { id: string; label: string; amountCents: number; taxable: boolean; startsOn: string; endsOn: string | null };
export type Garnishment = { id: string; label: string; method: GarnishmentMethod; rateBp: number; amountCents: number; totalOwedCents: number | null; paidCents: number; startsOn: string; endsOn: string | null };
export type CalculationRun = { id: string; kind: RunKind; schedule: PaySchedule; periodStart: string; periodEnd: string; payOn: string };
export type CalculationLine = {
  id: string; employeeId: string; employmentType: EmploymentType; location: string; baseCents: number; overtimeCents: number; hours: number | null; overtimeHours: number | null; proration: string;
  adjustmentCents: number; adjustmentNote: string; reimbursementCents: number;
};

const ruleColumns = `id, name, kind, method, rate_bp AS "rateBp", amount_cents::float8 AS "amountCents", brackets, wage_cap_cents::float8 AS "wageCapCents", amount_cap_cents::float8 AS "amountCapCents",
  employment_types AS "employmentTypes", location, enrollment, to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom", to_char(effective_to, 'YYYY-MM-DD') AS "effectiveTo", account, active, version`;

export async function readPaySettings(client: Client = pool()) {
  const { rows } = await client.query<PaySettings>(
    `SELECT new_hire_days AS "newHireDays", journal_dates AS "journalDates", journal_accounts AS "journalAccounts", nacha_routing AS "nachaRouting", nacha_bank_name AS "nachaBankName",
     nacha_origin_id AS "nachaOriginId", nacha_company_id AS "nachaCompanyId", nacha_company_name AS "nachaCompanyName", sepa_name AS "sepaName", sepa_iban_last4 AS "sepaIbanLast4", sepa_bic AS "sepaBic", version FROM pay_settings`,
  );
  return rows[0];
}

async function updateSettings(client: PoolClient, member: Member, version: number, detail: string, assignments: Record<string, unknown>) {
  const names = Object.keys(assignments);
  const { rowCount } = await client.query(`UPDATE pay_settings SET ${names.map((name, index) => `${name} = $${index + 2}`).join(", ")}, version = version + 1 WHERE version = $1`, [version, ...Object.values(assignments)]);
  if (!rowCount) throw new PeopleError("These settings changed while you were editing. Reload and try again.");
  await audit(client, member, "pay_settings.updated", { detail });
}

export function savePaySettings(member: Member, input: z.infer<typeof paySettingsFields>) {
  return runAsAdmin(member, (client) => updateSettings(client, member, input.version, "Journal dates", { journal_dates: input.journalDates }));
}

export function saveNacha(member: Member, input: z.infer<typeof nachaFields>) {
  return runAsAdmin(member, (client) => updateSettings(client, member, input.version, "NACHA file details", { nacha_routing: input.routing, nacha_bank_name: input.bankName, nacha_origin_id: input.originId, nacha_company_id: input.companyId, nacha_company_name: input.companyName }));
}

export function saveSepa(member: Member, input: z.infer<typeof sepaFields>) {
  return runAsAdmin(member, async (client) => {
    const { sepaIbanLast4 } = await readPaySettings(client);
    if (!input.iban && !sepaIbanLast4) throw new PeopleError("Enter the company IBAN.");
    await updateSettings(client, member, input.version, "SEPA file details", { sepa_name: input.name, sepa_bic: input.bic, ...(input.iban ? { sepa_iban_sealed: seal(input.iban, "company"), sepa_iban_last4: input.iban.slice(-4) } : {}) });
  });
}

export function saveJournal(member: Member, { version, ...accounts }: z.infer<typeof journalFields>) {
  return runAsAdmin(member, (client) => updateSettings(client, member, version, "Journal accounts", { journal_accounts: JSON.stringify(accounts) }));
}

export function saveNewHireDays(member: Member, input: { version: number; days: number }) {
  return runAsAdmin(member, (client) => updateSettings(client, member, input.version, "New hire enrollment", { new_hire_days: input.days }));
}

export async function listRules() {
  await requireAdmin();
  const { rows } = await pool().query<PayRule>(`SELECT ${ruleColumns} FROM pay_rules ORDER BY NOT active, array_position(ARRAY['pre_tax', 'tax', 'post_tax', 'employer'], kind), created_at, id`);
  return rows;
}

export function saveRule(member: Member, input: z.infer<typeof ruleFields>) {
  return runAsAdmin(member, async (client) => {
    const values = [input.name, input.method, input.method.startsWith("percent") ? input.rate ?? 0 : 0, input.method === "flat" ? input.amount ?? 0 : 0, JSON.stringify(input.method === "brackets" ? input.brackets : []), input.wageCap, input.amountCap,
      chosenTypes(input), input.location, input.enrollment, input.effectiveFrom, input.effectiveTo, input.account, input.active, input.kind];
    const { rowCount: taken } = await client.query("SELECT 1 FROM pay_rules WHERE active AND $1 AND lower(name) = lower($2) AND id::text <> $3", [input.active, input.name, input.id]);
    if (taken) throw new PeopleError("An active rule already has that name.");
    if (input.id) {
      const { rowCount } = await client.query(
        `UPDATE pay_rules SET name = $1, method = $2, rate_bp = $3, amount_cents = $4, brackets = $5, wage_cap_cents = $6, amount_cap_cents = $7, employment_types = $8, location = $9, enrollment = $10,
         effective_from = $11, effective_to = $12, account = $13, active = $14, version = version + 1 WHERE id = $16 AND version = $17 AND kind = $15`, [...values, input.id, input.version],
      );
      if (!rowCount) throw new PeopleError("This rule changed while you were editing. Reload and try again.");
    } else await client.query(
      `INSERT INTO pay_rules (name, method, rate_bp, amount_cents, brackets, wage_cap_cents, amount_cap_cents, employment_types, location, enrollment, effective_from, effective_to, account, active, kind, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`, [...values, member.id],
    );
    await audit(client, member, "pay_rule.saved", { detail: input.name });
  });
}

async function requireCurrentEmployee(client: PoolClient, employeeId: string) {
  const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [employeeId]);
  if (!rowCount) throw new PeopleError("Archived profiles are read-only.");
}

export async function employeePaySetup(employeeId: string) {
  await requireAdmin();
  const [rules, assignments, recurring, garnishments] = await Promise.all([
    pool().query<PayRule>(`SELECT ${ruleColumns} FROM pay_rules WHERE active ORDER BY array_position(ARRAY['pre_tax', 'tax', 'post_tax', 'employer'], kind), created_at, id`),
    pool().query<Assignment>(`SELECT rule_id AS "ruleId", mode, rate_bp AS "rateBp", amount_cents::float8 AS "amountCents" FROM pay_rule_assignments WHERE employee_id = $1`, [employeeId]),
    pool().query<RecurringEarning>(`SELECT id, label, amount_cents::float8 AS "amountCents", taxable, to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(ends_on, 'YYYY-MM-DD') AS "endsOn" FROM recurring_earnings WHERE employee_id = $1 ORDER BY starts_on DESC, id`, [employeeId]),
    readGarnishments(pool(), [employeeId]),
  ]);
  return { rules: rules.rows, assignments: assignments.rows, recurring: recurring.rows, garnishments: garnishments.get(employeeId) ?? [] };
}

export function assignRule(member: Member, input: z.infer<typeof assignmentFields>) {
  return runAsAdmin(member, async (client) => {
    await requireCurrentEmployee(client, input.employeeId);
    const { rows: [rule] } = await client.query<{ name: string; method: RuleMethod }>("SELECT name, method FROM pay_rules WHERE id = $1 AND active", [input.ruleId]);
    if (!rule) throw new PeopleError("This rule is no longer active.");
    if (input.mode === "override" && rule.method === "brackets") throw new PeopleError("Brackets can’t be overridden for one person. Exempt them and enroll them in another rule.");
    if (input.mode === "override" && rule.method !== "flat" && input.value! > 10_000) throw new PeopleError("Enter at most 100 percent.");
    if (input.mode === "default") await client.query("DELETE FROM pay_rule_assignments WHERE employee_id = $1 AND rule_id = $2", [input.employeeId, input.ruleId]);
    else await client.query(
      `INSERT INTO pay_rule_assignments (employee_id, rule_id, mode, rate_bp, amount_cents, created_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (employee_id, rule_id) DO UPDATE SET mode = excluded.mode, rate_bp = excluded.rate_bp, amount_cents = excluded.amount_cents, created_by = excluded.created_by, created_at = now()`,
      [input.employeeId, input.ruleId, input.mode, input.mode === "override" && rule.method !== "flat" ? input.value : null, input.mode === "override" && rule.method === "flat" ? input.value : null, member.id],
    );
    await audit(client, member, "pay_rule.assigned", { employeeId: input.employeeId, detail: rule.name });
  });
}

export function addRecurring(member: Member, input: z.infer<typeof recurringFields>) {
  return runAsAdmin(member, async (client) => {
    await requireCurrentEmployee(client, input.employeeId);
    await client.query("INSERT INTO recurring_earnings (employee_id, label, amount_cents, taxable, starts_on, ends_on, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", [input.employeeId, input.label, input.amount, input.taxable, input.startsOn, input.endsOn, member.id]);
    await audit(client, member, "recurring_pay.added", { employeeId: input.employeeId, detail: input.label });
  });
}

export function addGarnishment(member: Member, input: z.infer<typeof garnishmentFields>) {
  return runAsAdmin(member, async (client) => {
    await requireCurrentEmployee(client, input.employeeId);
    const flat = input.method === "flat";
    await client.query("INSERT INTO garnishments (employee_id, label, method, rate_bp, amount_cents, total_owed_cents, starts_on, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [input.employeeId, input.label, input.method, flat ? 0 : input.value, flat ? input.value : 0, input.totalOwed, input.startsOn, member.id]);
    await audit(client, member, "garnishment.added", { employeeId: input.employeeId });
  });
}

export function endPayItem(member: Member, table: "recurring_earnings" | "garnishments", input: { id: string; endsOn: string }) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ employeeId: string }>(`UPDATE ${table} SET ends_on = $2 WHERE id = $1 AND starts_on <= $2 RETURNING employee_id AS "employeeId"`, [input.id, input.endsOn]);
    if (!rows[0]) throw new PeopleError("Choose an end date on or after the start.");
    await audit(client, member, table === "garnishments" ? "garnishment.ended" : "recurring_pay.ended", { employeeId: rows[0].employeeId });
  });
}

async function readGarnishments(client: Client, employeeIds: string[]) {
  const { rows } = await client.query<Garnishment & { employeeId: string }>(
    `SELECT g.id, g.employee_id AS "employeeId", g.label, g.method, g.rate_bp AS "rateBp", g.amount_cents::float8 AS "amountCents", g.total_owed_cents::float8 AS "totalOwedCents",
     to_char(g.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(g.ends_on, 'YYYY-MM-DD') AS "endsOn",
     coalesce((SELECT sum(i.amount_cents) FROM pay_run_items i JOIN pay_run_lines l ON l.id = i.line_id AND l.revision = i.revision JOIN pay_runs r ON r.id = l.pay_run_id AND r.state = 'approved' WHERE i.source_id = g.id AND i.source = 'garnishment'), 0)::float8 AS "paidCents"
     FROM garnishments g WHERE g.employee_id = ANY($1::uuid[]) ORDER BY g.created_at, g.id`, [employeeIds],
  );
  return groupBy(rows);
}

function groupBy<T extends { employeeId: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.employeeId, [...groups.get(row.employeeId) ?? [], row]);
  return groups;
}

// Everything a line is made of, from the records as they stand now. Nothing here writes, so approval can compare the result with the stored items.
export async function calculateLines(client: Client, run: CalculationRun, lines: CalculationLine[]) {
  const people = lines.map((line) => line.employeeId);
  const regular = run.kind === "regular";
  const year = run.payOn.slice(0, 4);
  const inYear = [people, `${year}-01-01`, `${year}-12-31`];
  const approved = `FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id AND r.state = 'approved' WHERE l.employee_id = ANY($1::uuid[]) AND r.pay_on BETWEEN $2 AND $3`;
  const period = periodOfYear(run.schedule, run.periodEnd);
  const [rules, assignments, garnishments, earnings, recurring, invoices, ytd, ytdSources, benefits, recent] = [
    (await client.query<PayRule>(`SELECT ${ruleColumns} FROM pay_rules WHERE active AND effective_from <= $1 AND (effective_to IS NULL OR effective_to >= $1) ORDER BY created_at, id`, [run.payOn])).rows,
    groupBy((await client.query<Assignment & { employeeId: string }>(`SELECT employee_id AS "employeeId", rule_id AS "ruleId", mode, rate_bp AS "rateBp", amount_cents::float8 AS "amountCents" FROM pay_rule_assignments WHERE employee_id = ANY($1::uuid[])`, [people])).rows),
    await readGarnishments(client, people),
    groupBy((await client.query<{ employeeId: string; id: string; label: string; amountCents: number }>(`SELECT l.employee_id AS "employeeId", x.id, x.label, x.amount_cents::float8 AS "amountCents" FROM pay_line_earnings x JOIN pay_run_lines l ON l.id = x.line_id WHERE l.pay_run_id = $1 ORDER BY x.created_at, x.id`, [run.id])).rows),
    groupBy(regular ? (await client.query<RecurringEarning & { employeeId: string }>(`SELECT employee_id AS "employeeId", id, label, amount_cents::float8 AS "amountCents", taxable FROM recurring_earnings WHERE employee_id = ANY($1::uuid[]) AND starts_on <= $3 AND (ends_on IS NULL OR ends_on >= $2) ORDER BY created_at, id`, [people, run.periodStart, run.periodEnd])).rows : []),
    groupBy((await client.query<{ employeeId: string; id: string; number: string; amountCents: number }>(`SELECT employee_id AS "employeeId", id, number, amount_cents::float8 AS "amountCents" FROM contractor_invoices WHERE pay_run_id = $1 ORDER BY created_at, id`, [run.id])).rows),
    groupBy((await client.query<{ employeeId: string; gross: number; taxable: number }>(`SELECT l.employee_id AS "employeeId", sum(l.gross_cents)::float8 AS gross, sum(l.taxable_cents)::float8 AS taxable ${approved} GROUP BY 1`, inYear)).rows),
    groupBy((await client.query<{ employeeId: string; key: string; amount: number }>(
      `SELECT l.employee_id AS "employeeId", coalesce(b.plan_id, i.source_id)::text AS key, sum(i.amount_cents)::float8 AS amount
       FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id AND r.state = 'approved' JOIN pay_run_items i ON i.line_id = l.id AND i.revision = l.revision AND (i.source = 'rule' OR i.source = 'benefit' AND i.kind <> 'employer')
       LEFT JOIN benefit_elections b ON b.id = i.source_id WHERE l.employee_id = ANY($1::uuid[]) AND r.pay_on BETWEEN $2 AND $3 GROUP BY 1, 2`, inYear)).rows),
    groupBy((await client.query<{
      employeeId: string; id: string; planId: string; name: string; tier: Tier; percent: boolean; preTax: boolean; chooses: boolean; annualLimitCents: number | null; chosenCents: number | null; chosenBp: number | null;
      employeeCents: number; employerCents: number; employeeBp: number; employerBp: number; charged: boolean;
    }>(
      `SELECT DISTINCT ON (x.employee_id, x.plan_kind) x.employee_id AS "employeeId", x.id, p.id AS "planId", p.name, x.tier, p.percent, p.pre_tax AS "preTax", p.employee_chooses AS chooses, p.annual_limit_cents::float8 AS "annualLimitCents",
       x.chosen_cents::float8 AS "chosenCents", x.chosen_bp AS "chosenBp", t.employee_cents::float8 AS "employeeCents", t.employer_cents::float8 AS "employerCents", t.employee_bp AS "employeeBp", t.employer_bp AS "employerBp",
       coalesce((SELECT sum(i.amount_cents) FROM pay_run_items i JOIN pay_run_lines l ON l.id = i.line_id AND l.revision = i.revision JOIN pay_runs r ON r.id = l.pay_run_id
         WHERE i.source = 'benefit' AND i.source_id = x.id AND r.state = 'approved' AND r.period_key = $4 AND r.id <> $5), 0) <> 0 AS charged
       FROM benefit_elections x JOIN employees e ON e.id = x.employee_id JOIN benefit_plans p ON p.id = x.plan_id
       JOIN LATERAL (SELECT * FROM benefit_rates WHERE plan_id = x.plan_id AND tier = x.tier AND effective_on <= $3 ORDER BY effective_on DESC LIMIT 1) t ON true
       WHERE x.employee_id = ANY($1::uuid[]) AND x.state = 'approved' AND x.coverage_start <= $3 AND (x.coverage_end IS NULL OR x.coverage_end >= $2) AND (e.last_day IS NULL OR e.last_day >= $2)
       ORDER BY x.employee_id, x.plan_kind, x.coverage_start DESC, x.id`, [people, run.periodStart, run.periodEnd, regular ? period.key : "", run.id])).rows),
    groupBy(regular ? [] : (await client.query<{ employeeId: string; taxable: number; schedule: PaySchedule }>(
      `SELECT DISTINCT ON (l.employee_id) l.employee_id AS "employeeId", l.taxable_cents::float8 AS taxable, r.schedule FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id
       WHERE l.employee_id = ANY($1::uuid[]) AND r.state = 'approved' AND r.kind = 'regular' AND r.pay_on <= $2 AND NOT EXISTS (SELECT 1 FROM pay_runs v WHERE v.reverses_id = r.id AND v.state = 'approved') ORDER BY l.employee_id, r.period_end DESC, r.id`, [people, run.payOn])).rows),
  ];

  return new Map(lines.map((line) => {
    const own = assignments.get(line.employeeId) ?? [];
    const applicable: CalculationRule[] = rules.flatMap((rule) => {
      const assigned = own.find((entry) => entry.ruleId === rule.id);
      if (assigned?.mode === "exempt") return [];
      if (!assigned && (rule.enrollment === "chosen" || rule.employmentTypes.length && !rule.employmentTypes.includes(line.employmentType) || rule.location && !line.location.toLowerCase().includes(rule.location.toLowerCase()))) return [];
      return [assigned?.mode === "override" ? { ...rule, rateBp: assigned.rateBp ?? rule.rateBp, amountCents: assigned.amountCents ?? rule.amountCents } : rule];
    });
    const used = new Map((ytdSources.get(line.employeeId) ?? []).map((row) => [row.key, row.amount]));
    const covered: CalculationBenefit[] = (benefits.get(line.employeeId) ?? []).flatMap((entry) => {
      const label = entry.name;
      if (entry.percent) return [{ id: entry.id, label, preTax: entry.preTax, employeeCents: 0, employerCents: 0, employeeBp: entry.chooses ? entry.chosenBp ?? 0 : entry.employeeBp, employerBp: entry.employerBp, annualLimitCents: entry.annualLimitCents, employeeYtd: used.get(entry.planId) ?? 0 }];
      if (!regular || entry.charged) return [];
      return [{ id: entry.id, label, preTax: entry.preTax, employeeCents: monthlyToPeriod(entry.chooses ? entry.chosenCents ?? 0 : entry.employeeCents, period), employerCents: monthlyToPeriod(entry.employerCents, period), employeeBp: 0, employerBp: 0, annualLimitCents: entry.annualLimitCents, employeeYtd: used.get(entry.planId) ?? 0 }];
    });
    const ordered: CalculationGarnishment[] = (garnishments.get(line.employeeId) ?? []).filter((entry) => entry.startsOn <= run.payOn && (!entry.endsOn || entry.endsOn >= run.payOn))
      .map((entry) => ({ id: entry.id, label: entry.label, method: entry.method, rateBp: entry.rateBp, amountCents: entry.amountCents, remainingCents: entry.totalOwedCents === null ? null : Math.max(0, entry.totalOwedCents - entry.paidCents) }));
    const repeating = recurring.get(line.employeeId) ?? [];
    const last = recent.get(line.employeeId)?.[0];
    const item = (source: Item["source"], label: string, amountCents: number, sourceId: string | null = null, detail = "") => ({ source, sourceId, label, detail, amountCents });
    return [line.id, calculatePay({
      regular, periods: periodsPerYear[run.schedule],
      earnings: [
        item("regular", "Regular pay", line.baseCents, null, (line.hours === null ? line.proration : [`${line.hours} hours`, line.proration].filter(Boolean).join(": ")).slice(0, 300)),
        item("overtime", "Overtime", line.overtimeCents, null, `${line.overtimeHours ?? 0} hours`),
        ...repeating.filter((entry) => entry.taxable).map((entry) => item("recurring", entry.label, entry.amountCents, entry.id)),
        ...(earnings.get(line.employeeId) ?? []).map((entry) => item("earning", entry.label, entry.amountCents, entry.id)),
        item("adjustment", line.adjustmentNote || "Adjustment", line.adjustmentCents),
      ],
      nonTaxed: [
        item("expense", "Expense reimbursements", line.reimbursementCents),
        ...(invoices.get(line.employeeId) ?? []).map((entry) => item("invoice", `Invoice ${entry.number}`, entry.amountCents, entry.id)),
        ...repeating.filter((entry) => !entry.taxable).map((entry) => item("recurring", entry.label, entry.amountCents, entry.id)),
      ],
      rules: applicable, benefits: covered, garnishments: ordered,
      ytdGross: ytd.get(line.employeeId)?.[0].gross ?? 0, ytdTaxable: ytd.get(line.employeeId)?.[0].taxable ?? 0, ytdByRule: used, annualTaxable: last ? last.taxable * periodsPerYear[last.schedule] : 0,
    })] as const;
  }));
}
