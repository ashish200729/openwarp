import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type { companyFields, holidayFields, PaySchedule, templateFields, timeOffTypeFields } from "@/lib/operations";
import type { WorkflowKind } from "@/lib/people";
import { pool } from "./db";
import type { Member } from "./member";
import { audit, PeopleError, runAsAdmin } from "./write";

export type Company = { currency: string; schedule: PaySchedule; version: number };
export type TimeOffType = { id: string; name: string; annualDays: number | null; active: boolean };
export type Holiday = { day: string; name: string };
export type TemplateTask = { id: string; kind: WorkflowKind; title: string };

export async function readCompany(client: Pick<PoolClient, "query"> = pool()) {
  const { rows } = await client.query<Company>(`SELECT currency, pay_schedule AS schedule, version FROM company_settings`);
  return rows[0];
}

export async function listTimeOffTypes(includeInactive = false) {
  const { rows } = await pool().query<TimeOffType>(
    `SELECT id, name, annual_days AS "annualDays", active FROM time_off_types WHERE active OR $1 ORDER BY active DESC, lower(name)`, [includeInactive],
  );
  return rows;
}

export async function listHolidays(from = "1900-01-01") {
  const { rows } = await pool().query<Holiday>(`SELECT to_char(day, 'YYYY-MM-DD') AS day, name FROM holidays WHERE day >= $1 ORDER BY day`, [from]);
  return rows;
}

export async function listTemplates() {
  const { rows } = await pool().query<TemplateTask>("SELECT id, kind, title FROM checklist_templates ORDER BY kind DESC, position, id");
  return rows;
}

export function saveCompany(member: Member, input: z.infer<typeof companyFields>) {
  return runAsAdmin(member, async (client) => {
    const company = await readCompany(client);
    if (company.version !== input.version) throw new PeopleError("These settings changed while you were editing. Reload and try again.");
    if (company.currency !== input.currency) {
      const { rows } = await client.query<{ used: boolean }>("SELECT EXISTS (SELECT 1 FROM compensation) OR EXISTS (SELECT 1 FROM expenses) OR EXISTS (SELECT 1 FROM pay_runs) OR EXISTS (SELECT 1 FROM contractor_invoices) OR EXISTS (SELECT 1 FROM benefit_rates) OR EXISTS (SELECT 1 FROM recurring_earnings) OR EXISTS (SELECT 1 FROM garnishments) OR EXISTS (SELECT 1 FROM pay_rules) AS used");
      if (rows[0].used) throw new PeopleError("The currency can’t change after pay, expenses or pay runs are recorded.");
    }
    await client.query("UPDATE company_settings SET currency = $1, pay_schedule = $2, version = version + 1", [input.currency, input.schedule]);
    await audit(client, member, "settings.updated", { detail: "Company" });
  });
}

export function saveTimeOffType(member: Member, input: z.infer<typeof timeOffTypeFields>) {
  return runAsAdmin(member, async (client) => {
    if (input.id) {
      const { rowCount } = await client.query("UPDATE time_off_types SET name = $2, annual_days = $3, active = $4 WHERE id = $1", [input.id, input.name, input.annualDays, input.active]);
      if (!rowCount) throw new PeopleError("This time off type could not be found.");
    } else await client.query("INSERT INTO time_off_types (name, annual_days) VALUES ($1, $2)", [input.name, input.annualDays]);
    await audit(client, member, "settings.updated", { detail: `Time off type: ${input.name}` });
  });
}

export function addHoliday(member: Member, input: z.infer<typeof holidayFields>) {
  return runAsAdmin(member, async (client) => {
    await client.query("INSERT INTO holidays (day, name) VALUES ($1, $2)", [input.day, input.name]);
    await audit(client, member, "settings.updated", { detail: `Holiday added: ${input.name}` });
  });
}

export function removeHoliday(member: Member, day: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ name: string }>("DELETE FROM holidays WHERE day = $1 RETURNING name", [day]);
    if (rows[0]) await audit(client, member, "settings.updated", { detail: `Holiday removed: ${rows[0].name}` });
  });
}

export function addTemplate(member: Member, input: z.infer<typeof templateFields>) {
  return runAsAdmin(member, async (client) => {
    await client.query(
      "INSERT INTO checklist_templates (kind, title, position) SELECT $1, $2, coalesce(max(position), 0) + 1 FROM checklist_templates WHERE kind = $1", [input.kind, input.title],
    );
    await audit(client, member, "settings.updated", { detail: `Checklist task added: ${input.title}` });
  });
}

export function removeTemplate(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ title: string; remaining: number }>(
      `WITH target AS (SELECT kind FROM checklist_templates WHERE id = $1)
       SELECT (SELECT title FROM checklist_templates WHERE id = $1) AS title, count(*)::int AS remaining FROM checklist_templates WHERE kind = (SELECT kind FROM target)`, [id],
    );
    if (!rows[0]?.title) return;
    if (rows[0].remaining < 2) throw new PeopleError("Keep at least one task in each checklist.");
    await client.query("DELETE FROM checklist_templates WHERE id = $1", [id]);
    await audit(client, member, "settings.updated", { detail: `Checklist task removed: ${rows[0].title}` });
  });
}
