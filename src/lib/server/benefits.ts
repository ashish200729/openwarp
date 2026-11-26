import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { chosenTypes, planKindLabels, tierLabels, type dependentFields, type electionFields, type ElectionState, type eventFields, type PlanKind, type planFields, planKinds, type rateFields, type Tier, type windowFields } from "@/lib/domains/pay";
import { addDays, today } from "@/lib/operations";
import type { EmploymentType } from "@/lib/people";
import { seal, unseal } from "./crypto";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { notify } from "./notify";
import { readPaySettings } from "./payroll-rules";
import { audit, PeopleError, requireOwnEmployee, runAsAdmin, runAsMember } from "./write";

type Client = Pick<PoolClient, "query">;
export type Rate = { tier: Tier; effectiveOn: string; employeeCents: number; employerCents: number; employeeBp: number; employerBp: number };
export type Plan = {
  id: string; name: string; kind: PlanKind; description: string; percent: boolean; preTax: boolean; employeeChooses: boolean; annualLimitCents: number | null; employmentTypes: EmploymentType[]; waitingDays: number;
  documentId: string | null; documentName: string | null; active: boolean; version: number; rates: Rate[];
};
export type EnrollmentWindow = { id: string; employeeId: string | null; employeeName: string | null; name: string; state: "requested" | "open" | "declined"; eventOn: string | null; opensOn: string; closesOn: string; coverageOn: string };
export type Election = {
  id: string; employeeId: string; employeeName: string; planKind: PlanKind; planId: string | null; planName: string | null; tier: Tier | null; chosenCents: number | null; chosenBp: number | null; state: ElectionState;
  coverageStart: string; coverageEnd: string | null; decidedBy: string | null; dependents: string[];
};
export type Dependent = { id: string; name: string; relationship: "spouse" | "child"; born: string; covered: boolean };
export type Notice = { id: string; employeeId: string; employeeName: string; status: string; lastDay: string | null; mismatch: boolean };
export type OpenWindow = { name: string; closesOn: string; coverageOn: string; since: string; event: boolean };

const planSelect = `SELECT p.id, p.name, p.kind, p.description, p.percent, p.pre_tax AS "preTax", p.employee_chooses AS "employeeChooses", p.annual_limit_cents::float8 AS "annualLimitCents", p.employment_types AS "employmentTypes", p.waiting_days AS "waitingDays",
  p.document_id AS "documentId", d.name AS "documentName", p.active, p.version,
  (SELECT coalesce(json_agg(json_build_object('tier', r.tier, 'effectiveOn', to_char(r.effective_on, 'YYYY-MM-DD'), 'employeeCents', r.employee_cents, 'employerCents', r.employer_cents, 'employeeBp', r.employee_bp, 'employerBp', r.employer_bp)
    ORDER BY array_position(ARRAY['employee', 'spouse', 'children', 'family'], r.tier), r.effective_on DESC), '[]') FROM benefit_rates r WHERE r.plan_id = p.id) AS rates
  FROM benefit_plans p LEFT JOIN documents d ON d.id = p.document_id AND d.archived_at IS NULL`;
const planOrder = `ORDER BY NOT p.active, array_position($1::text[], p.kind), lower(p.name), p.id`;
const electionSelect = `SELECT x.id, x.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", x.plan_kind AS "planKind", x.plan_id AS "planId", p.name AS "planName", x.tier, x.chosen_cents::float8 AS "chosenCents", x.chosen_bp AS "chosenBp",
  x.state, to_char(x.coverage_start, 'YYYY-MM-DD') AS "coverageStart", to_char(x.coverage_end, 'YYYY-MM-DD') AS "coverageEnd", u.name AS "decidedBy",
  (SELECT coalesce(json_agg(d.name ORDER BY d.name), '[]') FROM benefit_election_dependents c JOIN dependents d ON d.id = c.dependent_id WHERE c.election_id = x.id) AS dependents
  FROM benefit_elections x JOIN employees e ON e.id = x.employee_id LEFT JOIN benefit_plans p ON p.id = x.plan_id LEFT JOIN "user" u ON u.id = x.decided_by`;
const windowSelect = `SELECT w.id, w.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", w.name, w.state, to_char(w.event_on, 'YYYY-MM-DD') AS "eventOn", to_char(w.opens_on, 'YYYY-MM-DD') AS "opensOn",
  to_char(w.closes_on, 'YYYY-MM-DD') AS "closesOn", to_char(w.coverage_on, 'YYYY-MM-DD') AS "coverageOn" FROM enrollment_windows w LEFT JOIN employees e ON e.id = w.employee_id`;

const mayUse = (member: Pick<Member, "role" | "employeeId">, employeeId: string) => member.role === "admin" || member.employeeId === employeeId;

async function plans(client: Client, activeOnly: boolean) {
  const { rows } = await client.query<Plan>(`${planSelect} WHERE p.active OR NOT $2 ${planOrder}`, [planKinds, activeOnly]);
  return rows;
}

export async function listPlans() {
  await requireAdmin();
  return plans(pool(), false);
}

// The cost in force on a date, for each tier that has one.
export function ratesOn(plan: Pick<Plan, "rates">, date: string) {
  const seen = new Set<Tier>();
  return plan.rates.filter((rate) => rate.effectiveOn <= date && !seen.has(rate.tier) && seen.add(rate.tier));
}

export function savePlan(member: Member, input: z.infer<typeof planFields>) {
  return runAsAdmin(member, async (client) => {
    if (input.documentId) {
      const { rowCount } = await client.query("SELECT 1 FROM documents WHERE id = $1 AND employee_id IS NULL AND archived_at IS NULL AND category <> 'receipt'", [input.documentId]);
      if (!rowCount) throw new PeopleError("Choose a company document.");
    }
    const { rowCount: taken } = await client.query("SELECT 1 FROM benefit_plans WHERE active AND $1 AND lower(name) = lower($2) AND id::text <> $3", [input.active, input.name, input.id]);
    if (taken) throw new PeopleError("An active plan already has that name.");
    const values = [input.name, input.description, input.preTax, input.employeeChooses, input.annualLimit, chosenTypes(input), input.waitingDays, input.documentId, input.active];
    if (input.id) {
      // The kind and the way a plan is priced stay fixed, because elections and past deductions depend on them.
      const { rowCount } = await client.query(
        `UPDATE benefit_plans SET name = $1, description = $2, pre_tax = $3, employee_chooses = $4, annual_limit_cents = $5, employment_types = $6, waiting_days = $7, document_id = $8, active = $9, version = version + 1
         WHERE id = $10 AND version = $11 AND kind = $12 AND percent = $13`, [...values, input.id, input.version, input.kind, input.percent]);
      if (!rowCount) throw new PeopleError("This plan changed while you were editing. Reload and try again.");
    } else await client.query(
      "INSERT INTO benefit_plans (name, description, pre_tax, employee_chooses, annual_limit_cents, employment_types, waiting_days, document_id, active, kind, percent, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [...values, input.kind, input.percent, member.id]);
    await audit(client, member, "benefit_plan.saved", { detail: input.name });
  });
}

export function addRate(member: Member, input: z.infer<typeof rateFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows: [plan] } = await client.query<{ name: string; percent: boolean }>("SELECT name, percent FROM benefit_plans WHERE id = $1", [input.planId]);
    if (!plan) throw new PeopleError("This plan could not be found.");
    if (plan.percent && (input.employee > 10_000 || input.employer > 10_000)) throw new PeopleError("Enter at most 100 percent.");
    const { rowCount: taken } = await client.query("SELECT 1 FROM benefit_rates WHERE plan_id = $1 AND tier = $2 AND effective_on = $3", [input.planId, input.tier, input.effectiveOn]);
    if (taken) throw new PeopleError("A cost is already set for that tier and date. Choose a later date.");
    await client.query("INSERT INTO benefit_rates (plan_id, tier, effective_on, employee_cents, employer_cents, employee_bp, employer_bp, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [input.planId, input.tier, input.effectiveOn, plan.percent ? 0 : input.employee, plan.percent ? 0 : input.employer, plan.percent ? input.employee : 0, plan.percent ? input.employer : 0, member.id]);
    await audit(client, member, "benefit_plan.priced", { detail: `${plan.name}, ${tierLabels[input.tier]}` });
  });
}

export async function listWindows() {
  await requireAdmin();
  const { rows } = await pool().query<EnrollmentWindow>(`${windowSelect} WHERE w.employee_id IS NULL ORDER BY w.opens_on DESC, w.id LIMIT 20`);
  return rows;
}

export function openEnrollment(member: Member, input: z.infer<typeof windowFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM enrollment_windows WHERE employee_id IS NULL AND opens_on <= $2 AND closes_on >= $1 LIMIT 1", [input.opensOn, input.closesOn]);
    if (rowCount) throw new PeopleError("Another open enrollment already covers part of those dates.");
    await client.query("INSERT INTO enrollment_windows (name, opens_on, closes_on, coverage_on, created_by) VALUES ($1, $2, $3, $4, $5)", [input.name, input.opensOn, input.closesOn, input.coverageOn, member.id]);
    await audit(client, member, "enrollment.opened", { detail: input.name });
    await notify(client, member, { everyone: true }, { title: `Benefit enrollment: ${input.name}`, body: `Open from ${input.opensOn} to ${input.closesOn}.`, href: "/workspace/benefits" });
  });
}

// An employee reports a life event. An administrator opens the window, because the company decides what qualifies.
export function reportEvent(member: Member, input: z.infer<typeof eventFields>) {
  return runAsMember(member, async (client, actor) => {
    if (!mayUse(actor, input.employeeId)) throw new PeopleError("You can only report your own events.");
    await requireOwnEmployee(client, { ...actor, employeeId: input.employeeId });
    if (input.eventOn > addDays(today(), 60) || input.eventOn < addDays(today(), -60)) throw new PeopleError("Report an event within 60 days of when it happens.");
    const open = actor.role === "admin";
    const { rowCount } = await client.query("SELECT 1 FROM enrollment_windows WHERE employee_id = $1 AND state = 'requested'", [input.employeeId]);
    if (rowCount) throw new PeopleError("An event is already waiting for review.");
    const opensOn = input.eventOn > today() ? input.eventOn : today();
    await client.query("INSERT INTO enrollment_windows (employee_id, name, state, event_on, opens_on, closes_on, coverage_on, created_by) VALUES ($1, $2, $3, $4, $5, $6, $4, $7)",
      [input.employeeId, input.name, open ? "open" : "requested", input.eventOn, opensOn, addDays(opensOn, 30), member.id]);
    await audit(client, member, open ? "enrollment.opened" : "enrollment.requested", { employeeId: input.employeeId });
    await notify(client, member, open ? { employeeId: input.employeeId } : { role: "admin" }, open
      ? { title: "You can change your benefits", body: `Open until ${addDays(opensOn, 30)}.`, href: `/workspace/people/${input.employeeId}/benefits` }
      : { title: "A benefit change request is waiting", href: "/workspace/benefits", kind: "request" });
  });
}

export function decideEvent(member: Member, input: { id: string; decision: "approved" | "declined" | "cancelled" }) {
  return runAsAdmin(member, async (client) => {
    const { rows: [event] } = await client.query<{ employeeId: string; eventOn: string }>(`SELECT employee_id AS "employeeId", to_char(event_on, 'YYYY-MM-DD') AS "eventOn" FROM enrollment_windows WHERE id = $1 AND state = 'requested'`, [input.id]);
    if (!event) throw new PeopleError("This request was already decided.");
    const open = input.decision === "approved";
    const opensOn = event.eventOn > today() ? event.eventOn : today();
    await client.query("UPDATE enrollment_windows SET state = $2, opens_on = $3, closes_on = $4 WHERE id = $1", [input.id, open ? "open" : "declined", opensOn, addDays(opensOn, 30)]);
    await audit(client, member, open ? "enrollment.opened" : "enrollment.declined", { employeeId: event.employeeId });
    await notify(client, member, { employeeId: event.employeeId }, { title: open ? "You can change your benefits" : "Your benefit change request was declined", body: open ? `Open until ${addDays(opensOn, 30)}.` : "", href: `/workspace/people/${event.employeeId}/benefits` });
  });
}

type Person = { id: string; employmentType: EmploymentType; hireDate: string; status: string };

async function readPerson(client: Client, employeeId: string) {
  const { rows } = await client.query<Person>(`SELECT id, employment_type AS "employmentType", to_char(hire_date, 'YYYY-MM-DD') AS "hireDate", status FROM employees WHERE id = $1 AND status <> 'archived'`, [employeeId]);
  return rows[0] ?? null;
}

// A person's own life event comes first, then open enrollment, then the new hire period.
async function openWindow(client: Client, person: Person): Promise<OpenWindow | null> {
  const day = today();
  const { rows: [window] } = await client.query<OpenWindow>(
    `SELECT name, to_char(closes_on, 'YYYY-MM-DD') AS "closesOn", to_char(coverage_on, 'YYYY-MM-DD') AS "coverageOn", created_at::text AS since, employee_id IS NOT NULL AS event FROM enrollment_windows
     WHERE state = 'open' AND (employee_id IS NULL OR employee_id = $1) AND opens_on <= $2 AND closes_on >= $2 ORDER BY employee_id IS NULL, closes_on DESC, id LIMIT 1`, [person.id, day]);
  if (window) return window;
  const { newHireDays } = await readPaySettings(client);
  const closesOn = addDays(person.hireDate, newHireDays);
  if (!newHireDays || closesOn < day || person.status === "offboarding") return null;
  return { name: "New hire enrollment", closesOn, coverageOn: person.hireDate, since: addDays(person.hireDate, -366), event: false };
}

const coverageStart = (window: OpenWindow, person: Person, plan: Pick<Plan, "waitingDays"> | null) => {
  const eligible = addDays(person.hireDate, plan?.waitingDays ?? 0);
  return eligible > window.coverageOn ? eligible : window.coverageOn;
};
const eligiblePlan = (plan: Plan, person: Person) => plan.active && (!plan.employmentTypes.length || plan.employmentTypes.includes(person.employmentType));

export type Choice = { value: string; plan: Plan; rate: Rate; coverageStart: string };

export async function employeeBenefits(member: Member, employeeId: string) {
  if (!mayUse(member, employeeId)) return null;
  const person = await readPerson(pool(), employeeId);
  const [elections, dependents, events, available] = await Promise.all([
    pool().query<Election>(`${electionSelect} WHERE x.employee_id = $1 AND x.state IN ('pending', 'approved', 'declined') ORDER BY x.state = 'pending' DESC, x.coverage_start DESC, x.created_at DESC LIMIT 60`, [employeeId]),
    readDependents(pool(), employeeId),
    pool().query<EnrollmentWindow>(`${windowSelect} WHERE w.employee_id = $1 AND w.state = 'requested'`, [employeeId]),
    person ? plans(pool(), true) : [],
  ]);
  const window = person ? await openWindow(pool(), person) : null;
  const eligible = person ? available.filter((plan) => eligiblePlan(plan, person) && plan.rates.length) : [];
  const choices = window && person ? planKinds.flatMap((kind) => {
    const options: Choice[] = eligible.filter((plan) => plan.kind === kind).flatMap((plan) => {
      const start = coverageStart(window, person, plan);
      return ratesOn(plan, start).map((rate) => ({ value: `${plan.id}:${rate.tier}`, plan, rate, coverageStart: start }));
    });
    return options.length ? [{ kind, options }] : [];
  }) : [];
  return { person, elections: elections.rows, dependents, requested: events.rows[0] ?? null, window, choices, plans: eligible };
}

async function readDependents(client: Client, employeeId: string) {
  const { rows } = await client.query<Omit<Dependent, "born"> & { sealed: Buffer }>(
    `SELECT d.id, d.name, d.relationship, d.born_sealed AS sealed, EXISTS (SELECT 1 FROM benefit_election_dependents c JOIN benefit_elections x ON x.id = c.election_id WHERE c.dependent_id = d.id
       AND (x.state = 'pending' OR x.state = 'approved' AND (x.coverage_end IS NULL OR x.coverage_end >= current_date))) AS covered
     FROM dependents d WHERE d.employee_id = $1 AND d.removed_at IS NULL ORDER BY d.relationship DESC, d.name, d.id`, [employeeId]);
  return rows.map(({ sealed, ...row }): Dependent => ({ ...row, born: unseal(sealed, employeeId) }));
}

export function addDependent(member: Member, input: z.infer<typeof dependentFields>) {
  return runAsMember(member, async (client, actor) => {
    if (!mayUse(actor, input.employeeId)) throw new PeopleError("You can only add your own dependents.");
    await requireOwnEmployee(client, { ...actor, employeeId: input.employeeId });
    if (input.born > today()) throw new PeopleError("The date of birth can’t be in the future.");
    await client.query("INSERT INTO dependents (employee_id, name, relationship, born_sealed, created_by) VALUES ($1, $2, $3, $4, $5)", [input.employeeId, input.name, input.relationship, seal(input.born, input.employeeId), member.id]);
    await audit(client, member, "dependent.added", { employeeId: input.employeeId });
  });
}

export function removeDependent(member: Member, id: string) {
  return runAsMember(member, async (client, actor) => {
    const { rows: [dependent] } = await client.query<{ employeeId: string }>(`SELECT employee_id AS "employeeId" FROM dependents WHERE id = $1 AND removed_at IS NULL`, [id]);
    if (!dependent || !mayUse(actor, dependent.employeeId)) throw new PeopleError("This dependent could not be found.");
    const { rowCount } = await client.query(
      `SELECT 1 FROM benefit_election_dependents c JOIN benefit_elections x ON x.id = c.election_id WHERE c.dependent_id = $1 AND (x.state = 'pending' OR x.state = 'approved' AND (x.coverage_end IS NULL OR x.coverage_end >= current_date)) LIMIT 1`, [id]);
    if (rowCount) throw new PeopleError("They are covered by a current choice. Change that coverage first.");
    await client.query("UPDATE dependents SET removed_at = now() WHERE id = $1", [id]);
    await audit(client, member, "dependent.removed", { employeeId: dependent.employeeId });
  });
}

export function submitElection(member: Member, input: z.infer<typeof electionFields>) {
  return runAsMember(member, async (client, actor) => {
    if (!mayUse(actor, input.employeeId)) throw new PeopleError("You can only choose your own benefits.");
    const person = await readPerson(client, input.employeeId);
    if (!person) throw new PeopleError("Archived profiles are read-only.");
    const window = await openWindow(client, person);
    if (!window) throw new PeopleError("Enrollment isn’t open. Report a life event if something changed.");
    let plan: Plan | null = null;
    let tier: Tier | null = null;
    let chosen: { cents: number | null; bp: number | null } = { cents: null, bp: null };
    let covered: string[] = [];
    if (input.choice !== "waive") {
      const [planId, wanted] = input.choice.split(":") as [string, Tier];
      plan = (await plans(client, true)).find((entry) => entry.id === planId) ?? null;
      if (!plan || plan.kind !== input.planKind || !eligiblePlan(plan, person)) throw new PeopleError("Choose a plan you’re eligible for.");
      const rate = ratesOn(plan, coverageStart(window, person, plan)).find((entry) => entry.tier === wanted);
      if (!rate) throw new PeopleError("That coverage level isn’t offered.");
      tier = wanted;
      chosen = chooseContribution(plan, input.contribution);
      covered = await chooseDependents(client, input.employeeId, tier, input.dependents);
    } else {
      const { rowCount } = await client.query("SELECT 1 FROM benefit_plans WHERE active AND kind = $1", [input.planKind]);
      if (!rowCount) throw new PeopleError("There is nothing to waive.");
    }
    await client.query("UPDATE benefit_elections SET state = 'cancelled', decided_by = $3, decided_at = now() WHERE employee_id = $1 AND plan_kind = $2 AND state = 'pending'", [input.employeeId, input.planKind, member.id]);
    const { rows: [election] } = await client.query<{ id: string }>(
      "INSERT INTO benefit_elections (employee_id, plan_kind, plan_id, tier, chosen_cents, chosen_bp, coverage_start, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [input.employeeId, input.planKind, plan?.id ?? null, tier, chosen.cents, chosen.bp, coverageStart(window, person, plan), member.id]);
    if (covered.length) await client.query("INSERT INTO benefit_election_dependents (election_id, dependent_id) SELECT $1, unnest($2::uuid[])", [election.id, covered]);
    await audit(client, member, "election.submitted", { employeeId: input.employeeId });
    await notify(client, member, { role: "admin" }, { title: "A benefit choice is waiting for approval", href: "/workspace/benefits", kind: "request" });
  });
}

function chooseContribution(plan: Plan, value: number | null) {
  if (!plan.employeeChooses) return { cents: null, bp: null };
  if (value === null) throw new PeopleError(plan.percent ? "Enter the percent of pay you want to contribute." : "Enter the amount you want to contribute each month.");
  if (plan.percent && value > 10_000) throw new PeopleError("Enter at most 100 percent.");
  if (!plan.percent && plan.annualLimitCents !== null && value * 12 > plan.annualLimitCents) throw new PeopleError("That is more than the plan’s annual limit. Enter a lower monthly amount.");
  return plan.percent ? { cents: null, bp: value } : { cents: value, bp: null };
}

async function chooseDependents(client: Client, employeeId: string, tier: Tier, ids: string[]) {
  const { rows } = await client.query<{ id: string; relationship: "spouse" | "child" }>("SELECT id, relationship FROM dependents WHERE employee_id = $1 AND removed_at IS NULL AND id = ANY($2::uuid[])", [employeeId, ids]);
  if (rows.length !== new Set(ids).size) throw new PeopleError("Choose dependents from your list.");
  const spouses = rows.filter((row) => row.relationship === "spouse").length;
  const children = rows.length - spouses;
  if (tier === "employee" && rows.length) throw new PeopleError("Employee-only coverage has no dependents. Choose another level or clear them.");
  if (tier === "spouse" && (spouses !== 1 || children)) throw new PeopleError("Choose one spouse or partner for this level.");
  if (tier === "children" && (!children || spouses)) throw new PeopleError("Choose at least one child, and no spouse, for this level.");
  if (tier === "family" && (spouses !== 1 || !children)) throw new PeopleError("Choose a spouse or partner and at least one child for this level.");
  return rows.map((row) => row.id);
}

export function decideElection(member: Member, input: { id: string; decision: "approved" | "declined" | "cancelled" }) {
  return runAsMember(member, async (client, actor) => {
    const { rows: [election] } = await client.query<{ employeeId: string; planKind: PlanKind; start: string; status: string; eligible: boolean }>(
      `SELECT x.employee_id AS "employeeId", x.plan_kind AS "planKind", to_char(x.coverage_start, 'YYYY-MM-DD') AS start, e.status,
       x.plan_id IS NULL OR p.active AND (p.employment_types = '{}' OR e.employment_type = ANY(p.employment_types)) AS eligible
       FROM benefit_elections x JOIN employees e ON e.id = x.employee_id LEFT JOIN benefit_plans p ON p.id = x.plan_id WHERE x.id = $1 AND x.state = 'pending'`, [input.id]);
    if (!election) throw new PeopleError("This choice was already decided.");
    if (input.decision === "cancelled") {
      if (actor.employeeId !== election.employeeId) throw new PeopleError("You can only cancel your own choices.");
    } else if (actor.role !== "admin") throw new PeopleError("Administrator access is required.");
    if (input.decision === "approved") {
      if (election.status === "archived") throw new PeopleError("Archived profiles are read-only.");
      if (!election.eligible) throw new PeopleError("They are no longer eligible for this plan. Decline the choice.");
      // New coverage replaces the old one from its first day, so one plan type never has two in force.
      await client.query(
        `UPDATE benefit_elections SET state = CASE WHEN coverage_start >= $3 THEN 'replaced' ELSE state END, coverage_end = $3::date - 1, ended_with_employment = false, end_before_leaving = NULL
         WHERE employee_id = $1 AND plan_kind = $2 AND state = 'approved' AND (coverage_end IS NULL OR coverage_end >= $3)`, [election.employeeId, election.planKind, election.start]);
    }
    await client.query("UPDATE benefit_elections SET state = $2, decided_by = $3, decided_at = now() WHERE id = $1", [input.id, input.decision, member.id]);
    await audit(client, member, `election.${input.decision}`, { employeeId: election.employeeId });
    if (input.decision !== "cancelled") await notify(client, member, { employeeId: election.employeeId }, { title: `Your ${planKindLabels[election.planKind]} choice was ${input.decision}`, href: `/workspace/people/${election.employeeId}/benefits` });
  });
}

export function endElection(member: Member, input: { id: string; endsOn: string }) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ employeeId: string }>(
      `UPDATE benefit_elections SET coverage_end = $2, ended_with_employment = false, end_before_leaving = NULL WHERE id = $1 AND state = 'approved' AND coverage_start <= $2 AND (coverage_end IS NULL OR coverage_end > $2) RETURNING employee_id AS "employeeId"`, [input.id, input.endsOn]);
    if (!rows[0]) throw new PeopleError("Choose a date between the start of coverage and its current end.");
    await audit(client, member, "election.ended", { employeeId: rows[0].employeeId });
    await notify(client, member, { employeeId: rows[0].employeeId }, { title: "A benefit coverage end date was set", body: `Coverage ends on ${input.endsOn}.`, href: `/workspace/people/${rows[0].employeeId}/benefits` });
  });
}

// Leaving ends every coverage on the last day and leaves a task for the administrator to tell the carrier.
export async function endCoverageForLeaver(client: PoolClient, member: Member, employeeId: string) {
  await client.query("UPDATE benefit_elections SET state = 'cancelled', decided_by = $2, decided_at = now() WHERE employee_id = $1 AND state = 'pending'", [employeeId, member.id]);
  const ended = await alignCoverage(client, employeeId);
  if (!ended) return;
  await client.query("INSERT INTO benefit_notices (employee_id) VALUES ($1) ON CONFLICT (employee_id) WHERE done_at IS NULL DO NOTHING", [employeeId]);
  await audit(client, member, "election.ended", { employeeId });
}

export async function forgetLeaving(client: PoolClient, employeeId: string) {
  await client.query("UPDATE benefit_elections SET ended_with_employment = false, end_before_leaving = NULL WHERE employee_id = $1 AND ended_with_employment", [employeeId]);
}

async function alignCoverage(client: PoolClient, employeeId: string) {
  const { rowCount } = await client.query(
    `UPDATE benefit_elections x SET state = CASE WHEN x.coverage_start > e.last_day THEN 'replaced' ELSE x.state END, end_before_leaving = CASE WHEN x.ended_with_employment THEN x.end_before_leaving ELSE x.coverage_end END,
     coverage_end = e.last_day, ended_with_employment = true
     FROM employees e WHERE e.id = x.employee_id AND x.employee_id = $1 AND e.last_day IS NOT NULL AND x.state = 'approved' AND x.plan_id IS NOT NULL AND (x.coverage_end IS NULL OR x.coverage_end > e.last_day)`, [employeeId]);
  return rowCount ?? 0;
}

// Coverage that leaving cut short and that the employee record no longer cuts at the same date. A later approved choice keeps its place.
const misaligned = `x.employee_id = e.id AND x.ended_with_employment AND x.state IN ('approved', 'replaced') AND (e.last_day IS NULL OR e.last_day >= x.coverage_start)
  AND (x.state = 'replaced' OR x.coverage_end IS DISTINCT FROM least(x.end_before_leaving, e.last_day))
  AND NOT EXISTS (SELECT 1 FROM benefit_elections o WHERE o.employee_id = x.employee_id AND o.plan_kind = x.plan_kind AND o.state = 'approved' AND o.id <> x.id AND o.created_at > x.created_at)`;
const uncut = `x.employee_id = e.id AND x.state = 'approved' AND x.plan_id IS NOT NULL AND e.last_day IS NOT NULL AND (x.coverage_end IS NULL OR x.coverage_end > e.last_day)`;
const openNotice = `SELECT n.id, n.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName", e.status, to_char(e.last_day, 'YYYY-MM-DD') AS "lastDay",
  EXISTS (SELECT 1 FROM benefit_elections x WHERE (${misaligned}) OR (${uncut})) AS mismatch
  FROM benefit_notices n JOIN employees e ON e.id = n.employee_id WHERE n.done_at IS NULL`;

// When a last day moves or offboarding is cancelled, coverage follows the employee record again, up to any end it already had.
export function restoreCoverage(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows: [notice] } = await client.query<Notice>(`${openNotice} AND n.id = $1`, [id]);
    if (!notice) throw new PeopleError("This task is already closed.");
    await client.query(`UPDATE benefit_elections x SET state = 'approved', coverage_end = least(x.end_before_leaving, e.last_day) FROM employees e WHERE e.id = $1 AND ${misaligned}`, [notice.employeeId]);
    await alignCoverage(client, notice.employeeId);
    if (!notice.lastDay) {
      await forgetLeaving(client, notice.employeeId);
      await client.query("UPDATE benefit_notices SET done_by = $2, done_at = now() WHERE id = $1", [id, member.id]);
    }
    await audit(client, member, "election.restored", { employeeId: notice.employeeId });
  });
}

export function closeNotice(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ employeeId: string }>(`UPDATE benefit_notices SET done_by = $2, done_at = now() WHERE id = $1 AND done_at IS NULL RETURNING employee_id AS "employeeId"`, [id, member.id]);
    if (!rows[0]) throw new PeopleError("This task is already closed.");
    await audit(client, member, "benefits.carrier_notified", { employeeId: rows[0].employeeId });
  });
}

export async function benefitsOverview() {
  await requireAdmin();
  const [pending, events, notices, current] = await Promise.all([
    pool().query<Election>(`${electionSelect} WHERE x.state = 'pending' AND e.status <> 'archived' ORDER BY x.created_at, x.id LIMIT 100`),
    pool().query<EnrollmentWindow>(`${windowSelect} WHERE w.state = 'requested' ORDER BY w.created_at, w.id LIMIT 60`),
    pool().query<Notice>(`${openNotice} ORDER BY e.last_day, n.id LIMIT 60`),
    pool().query<Election>(`${electionSelect} WHERE x.state = 'approved' AND x.plan_id IS NOT NULL AND (x.coverage_end IS NULL OR x.coverage_end >= current_date) ORDER BY lower(e.last_name), lower(e.first_name), e.id, x.plan_kind LIMIT 1000`),
  ]);
  return { pending: pending.rows, events: events.rows, notices: notices.rows, current: current.rows };
}

export function exportElections(member: Member) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{
      employeeId: string; firstName: string; lastName: string; email: string; hireDate: string; planKind: PlanKind; planName: string | null; tier: Tier | null; coverageStart: string; coverageEnd: string | null;
      percent: boolean | null; chosenCents: number | null; chosenBp: number | null; employeeCents: number | null; employerCents: number | null; employeeBp: number | null; employerBp: number | null; dependents: { name: string; relationship: string; sealed: string }[];
    }>(
      `SELECT e.id AS "employeeId", e.first_name AS "firstName", e.last_name AS "lastName", e.email, to_char(e.hire_date, 'YYYY-MM-DD') AS "hireDate", x.plan_kind AS "planKind", p.name AS "planName", x.tier, to_char(x.coverage_start, 'YYYY-MM-DD') AS "coverageStart",
       to_char(x.coverage_end, 'YYYY-MM-DD') AS "coverageEnd", p.percent, x.chosen_cents::float8 AS "chosenCents", x.chosen_bp AS "chosenBp", t.employee_cents::float8 AS "employeeCents", t.employer_cents::float8 AS "employerCents", t.employee_bp AS "employeeBp", t.employer_bp AS "employerBp",
       (SELECT coalesce(json_agg(json_build_object('name', d.name, 'relationship', d.relationship, 'sealed', encode(d.born_sealed, 'base64')) ORDER BY d.name), '[]') FROM benefit_election_dependents c JOIN dependents d ON d.id = c.dependent_id WHERE c.election_id = x.id) AS dependents
       FROM benefit_elections x JOIN employees e ON e.id = x.employee_id LEFT JOIN benefit_plans p ON p.id = x.plan_id
       LEFT JOIN LATERAL (SELECT * FROM benefit_rates WHERE plan_id = x.plan_id AND tier = x.tier AND effective_on <= greatest(current_date, x.coverage_start) ORDER BY effective_on DESC LIMIT 1) t ON true
       WHERE x.state = 'approved' AND (x.coverage_end IS NULL OR x.coverage_end >= current_date) ORDER BY lower(e.last_name), lower(e.first_name), e.id, x.plan_kind LIMIT 10000`);
    await audit(client, member, "benefits.exported", { detail: `${rows.length} choices` });
    const money = (cents: number | null) => cents === null ? "" : (cents / 100).toFixed(2);
    return [["First name", "Last name", "Work email", "Hire date", "Plan type", "Plan", "Coverage", "Coverage starts", "Coverage ends", "Employee monthly cost", "Employer monthly cost", "Employee percent of pay", "Employer percent of pay", "Dependents"],
      ...rows.map((row) => [row.firstName, row.lastName, row.email, row.hireDate, planKindLabels[row.planKind], row.planName ?? "Waived", row.tier ? tierLabels[row.tier] : "", row.coverageStart, row.coverageEnd ?? "",
        row.percent ? "" : money(row.chosenCents ?? row.employeeCents), row.percent ? "" : money(row.employerCents), row.percent ? money(row.chosenBp ?? row.employeeBp) : "", row.percent ? money(row.employerBp) : "",
        row.dependents.map((dependent) => `${dependent.name} (${dependent.relationship}, ${unseal(Buffer.from(dependent.sealed, "base64"), row.employeeId)})`).join("; ")])];
  });
}

// What the person still has to decide in the window that is open to them.
export async function enrollmentStatus(employeeId: string) {
  const person = await readPerson(pool(), employeeId);
  const window = person ? await openWindow(pool(), person) : null;
  if (!person || !window) return { open: false, done: false, window: null };
  const kinds = new Set((await plans(pool(), true)).filter((plan) => eligiblePlan(plan, person) && ratesOn(plan, coverageStart(window, person, plan)).length).map((plan) => plan.kind));
  if (!kinds.size) return { open: false, done: false, window: null };
  const { rows } = await pool().query<{ planKind: PlanKind }>(`SELECT DISTINCT plan_kind AS "planKind" FROM benefit_elections WHERE employee_id = $1 AND state IN ('pending', 'approved') AND created_at >= $2::timestamptz`, [employeeId, window.since]);
  return { open: true, done: window.event ? rows.length > 0 : [...kinds].every((kind) => rows.some((row) => row.planKind === kind)), window };
}

export async function benefitCounts() {
  const { rows } = await pool().query<{ elections: number; events: number; notices: number }>(
    `SELECT (SELECT count(*)::int FROM benefit_elections x JOIN employees e ON e.id = x.employee_id WHERE x.state = 'pending' AND e.status <> 'archived') AS elections, (SELECT count(*)::int FROM enrollment_windows WHERE state = 'requested') AS events,
     (SELECT count(*)::int FROM benefit_notices WHERE done_at IS NULL) AS notices`);
  return rows[0];
}
