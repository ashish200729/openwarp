import "server-only";
import { parseCsv } from "@/lib/operations";
import { createEmployeeFields, employmentTypes } from "@/lib/people";
import type { PoolClient } from "pg";
import { pool } from "./db";
import type { Member } from "./member";
import { insertEmployee } from "./people-mutations";
import { audit, PeopleError, runAsAdmin } from "./write";

export const importColumns = ["first_name", "last_name", "email", "title", "team", "manager_email", "employment_type", "start_date", "location", "status"] as const;
const required = ["first_name", "last_name", "email", "title", "start_date"] as const;
const maxRows = 500;
export type ImportProblem = { row: number; message: string };
type Row = Record<(typeof importColumns)[number], string>;
type Plan = { rows: Row[]; newTeams: string[]; problems: ImportProblem[] };

function readRows(text: string) {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new PeopleError("The file is empty.");
  const names = header.map((value) => value.trim().toLowerCase().replaceAll(/[\s-]+/g, "_"));
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new PeopleError(`Add these columns: ${missing.join(", ")}.`);
  if (!body.length) throw new PeopleError("The file has no rows under the header.");
  if (body.length > maxRows) throw new PeopleError(`Import at most ${maxRows} rows at a time.`);
  return body.map((cells) => Object.fromEntries(importColumns.map((name) => [name, names.includes(name) ? (cells[names.indexOf(name)] ?? "").trim() : ""])) as Row);
}

function fields(row: Row) {
  return createEmployeeFields.safeParse({
    firstName: row.first_name, lastName: row.last_name, email: row.email, title: row.title, teamId: "", managerId: "", location: row.location, hireDate: row.start_date,
    employmentType: row.employment_type ? row.employment_type.toLowerCase().replaceAll(/[\s-]+/g, "_") : "full_time",
    initialStatus: row.status ? row.status.toLowerCase() : "active",
  });
}

export async function planImport(text: string, client: Pick<PoolClient, "query"> = pool()): Promise<Plan> {
  const rows = readRows(text);
  const teamNames = rows.map((row) => row.team.toLowerCase());
  const addresses = rows.flatMap((row) => [row.email.toLowerCase(), row.manager_email.toLowerCase()]);
  const { rows: teams } = await client.query<{ name: string }>("SELECT lower(name) AS name FROM teams WHERE archived_at IS NULL AND lower(name) = ANY($1::text[])", [teamNames]);
  const currentTeams = new Set(teams.map((team) => team.name));
  const { rows: people } = await client.query<{ email: string; status: string }>("SELECT email, status FROM employees WHERE email = ANY($1::text[])", [addresses]);
  const problems: ImportProblem[] = [];
  const existing = new Map(people.map((person) => [person.email, person.status]));
  const emails = new Map<string, number>();
  rows.forEach((row, index) => emails.set(row.email.toLowerCase(), index));
  rows.forEach((row, index) => {
    const line = index + 2;
    const result = fields(row);
    if (!result.success) problems.push({ row: line, message: result.error.issues.map((issue) => issue.path[0] === "employmentType" ? `Use one of these employment types: ${employmentTypes.join(", ")}.` : issue.path[0] === "initialStatus" ? "Use active or onboarding as the status." : issue.path[0] === "hireDate" ? "Write the start date as YYYY-MM-DD." : issue.message).join(" ") });
    const email = row.email.toLowerCase();
    if (existing.has(email)) problems.push({ row: line, message: `${email} is already in the directory.` });
    else if (emails.get(email) !== index) problems.push({ row: line, message: `${email} appears more than once.` });
    const manager = row.manager_email.toLowerCase();
    if (!manager) return;
    if (manager === email) problems.push({ row: line, message: "Someone can’t manage themselves." });
    else if (emails.has(manager)) {
      const managerRow = rows[emails.get(manager)!];
      if (managerRow.status.toLowerCase() === "onboarding") problems.push({ row: line, message: `${manager} is onboarding and can’t manage people yet.` });
    } else if (existing.get(manager) !== "active") problems.push({ row: line, message: `${manager} isn’t an active employee.` });
    const seen = new Set([email]);
    for (let next = manager; next && emails.has(next); next = rows[emails.get(next)!].manager_email.toLowerCase()) {
      if (seen.has(next)) { problems.push({ row: line, message: "The managers in this file form a loop." }); break; }
      seen.add(next);
    }
  });
  const newTeams = [...new Map(rows.filter((row) => row.team && !currentTeams.has(row.team.toLowerCase())).map((row) => [row.team.toLowerCase(), row.team])).values()];
  newTeams.filter((name) => name.length > 80).forEach((name) => problems.push({ row: 0, message: `The team name “${name.slice(0, 30)}…” is longer than 80 characters.` }));
  return { rows, newTeams, problems };
}

export async function runImport(member: Member, text: string) {
  return runAsAdmin(member, async (client) => {
    const plan = await planImport(text, client);
    if (plan.problems.length) throw new PeopleError("The file has problems. Check it again before importing.");
    if (plan.newTeams.length) await client.query("INSERT INTO teams (name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING", [plan.newTeams]);
    const { rows: teams } = await client.query<{ id: string; key: string }>("SELECT id, lower(name) AS key FROM teams WHERE archived_at IS NULL AND lower(name) = ANY($1::text[])", [plan.rows.map((row) => row.team.toLowerCase())]);
    const teamIds = new Map(teams.map((team) => [team.key, team.id]));
    // Managers go in before the people who report to them.
    const pending = new Map(plan.rows.map((row) => [row.email.toLowerCase(), row]));
    while (pending.size) {
      const ready = [...pending].filter(([, row]) => !pending.has(row.manager_email.toLowerCase()));
      if (!ready.length) throw new PeopleError("The managers in this file form a loop.");
      for (const [email, row] of ready) {
        const { rows: managers } = row.manager_email ? await client.query<{ id: string }>("SELECT id FROM employees WHERE email = $1", [row.manager_email.toLowerCase()]) : { rows: [] };
        const result = fields(row);
        if (!result.success) throw new PeopleError("The file has problems. Check it again before importing.");
        await insertEmployee(client, member, { ...result.data, teamId: teamIds.get(row.team.toLowerCase()) ?? null, managerId: managers[0]?.id ?? null });
        pending.delete(email);
      }
    }
    await audit(client, member, "employee.imported", { detail: `${plan.rows.length} records` });
    return plan.rows.length;
  });
}
