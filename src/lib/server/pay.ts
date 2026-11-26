import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import {
  earningLabels, hourlyPay, itemsKey, periodOfYear, ptoPayout, purposeLabels, salaryForSegments, subtractRanges, workSegments, type DateRange, type earningFields, type EarningType, type Item, type ItemKind, type ItemSource, type offCycleFields, type PayTotals, type Rate, type RunKind, type RunPurpose, type WorkSegment,
} from "@/lib/domains/pay";
import { basisLabels, formatMoney, weekdaysBetween, type compensationFields, type PayBasis, type payLineFields, type payRunFields, type PaySchedule } from "@/lib/operations";
import { employmentLabels, formatDate, type EmploymentType } from "@/lib/people";
import { currentBankChecks, sharedBankAccounts } from "./bank";
import { pool } from "./db";
import { requireAdmin, type Member } from "./member";
import { notify } from "./notify";
import { calculateLines } from "./payroll-rules";
import { readCompany } from "./settings";
import { approvedHours, lockTimesheets } from "./time-module";
import { readTimeSettings } from "./timesheets";
import { audit, PeopleError, runAsAdmin } from "./write";

type Client = Pick<PoolClient, "query">;
export type Compensation = { id: string; amountCents: number; basis: PayBasis; currency: string; effectiveOn: string; reason: string };
export type JobChange = { id: string; title: string; teamName: string; managerName: string; employmentType: EmploymentType; changedOn: string };
export type PayRun = {
  id: string; kind: RunKind; purpose: RunPurpose | ""; label: string; periodStart: string; periodEnd: string; payOn: string; schedule: PaySchedule; currency: string; state: "draft" | "approved"; version: number; includesClaims: boolean;
  people: number; totalCents: number; grossCents: number; preTaxCents: number; taxCents: number; postTaxCents: number; nontaxedCents: number; employerCents: number;
  approvedBy: string | null; reversesId: string | null; reversalId: string | null; reversed: boolean;
};
export type PayLine = PayTotals & {
  id: string; employeeId: string; name: string; employmentType: EmploymentType; location: string; basis: PayBasis; rateCents: number; hours: number | null; overtimeHours: number | null; hoursSource: "manual" | "timesheet";
  overtimeMultiplierBp: number; baseCents: number; overtimeCents: number; earningsCents: number; adjustmentCents: number; adjustmentNote: string; reimbursementCents: number; proration: string; totalCents: number; acceptedNotes: string; revision: number;
};
export type PayItem = Item & { lineId: string };
export type LineEarning = { id: string; lineId: string; type: EarningType; label: string; amountCents: number };
export type PayCheck = { employeeId: string; name: string; problem: string; blocking: boolean; href?: string };
export type Payslip = { id: string; kind: RunKind; purpose: RunPurpose | ""; periodStart: string; periodEnd: string; payOn: string; currency: string; netCents: number; employeeId: string; name: string };

const runColumns = `r.id, r.kind, r.purpose, r.label, to_char(r.period_start, 'YYYY-MM-DD') AS "periodStart", to_char(r.period_end, 'YYYY-MM-DD') AS "periodEnd", to_char(r.pay_on, 'YYYY-MM-DD') AS "payOn",
  r.schedule, r.currency, r.state, r.version, r.includes_claims AS "includesClaims", u.name AS "approvedBy", r.reverses_id AS "reversesId", v.id AS "reversalId", coalesce(v.state = 'approved', false) AS reversed, count(l.id)::int AS people,
  coalesce(sum(l.net_cents), 0)::float8 AS "totalCents", coalesce(sum(l.gross_cents), 0)::float8 AS "grossCents", coalesce(sum(l.pre_tax_cents), 0)::float8 AS "preTaxCents", coalesce(sum(l.tax_cents), 0)::float8 AS "taxCents",
  coalesce(sum(l.post_tax_cents), 0)::float8 AS "postTaxCents", coalesce(sum(l.nontaxed_cents), 0)::float8 AS "nontaxedCents", coalesce(sum(l.employer_cents), 0)::float8 AS "employerCents"`;
const runFrom = `FROM pay_runs r LEFT JOIN pay_run_lines l ON l.pay_run_id = r.id LEFT JOIN "user" u ON u.id = r.approved_by LEFT JOIN pay_runs v ON v.reverses_id = r.id`;
const notReversed = (run: string) => `NOT EXISTS (SELECT 1 FROM pay_runs rv WHERE rv.reverses_id = ${run}.id AND rv.state = 'approved')`;
// Off-cycle runs that pay wages for some of the days between $1 and $2. Their days are left out of the regular run once they are approved.
const offCycleWages = (state: "approved" | "draft") => `FROM pay_runs xr JOIN pay_run_lines xl ON xl.pay_run_id = xr.id WHERE xl.employee_id = e.id AND xr.kind = 'off_cycle' AND xr.state = '${state}' AND xr.period_start <= $2 AND xr.period_end >= $1
  AND EXISTS (SELECT 1 FROM pay_line_earnings x WHERE x.line_id = xl.id AND x.type = 'wages') AND ${notReversed("xr")}`;
const employed = `e.hire_date <= $2 AND (e.status <> 'archived' OR e.last_day IS NOT NULL) AND (e.last_day IS NULL OR e.last_day >= $1)`;

export async function listCompensation(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return null;
  const { rows } = await pool().query<Compensation>(
    `SELECT id, amount_cents::float8 AS "amountCents", basis, currency, to_char(effective_on, 'YYYY-MM-DD') AS "effectiveOn", reason FROM compensation WHERE employee_id = $1 ORDER BY effective_on DESC`, [employeeId],
  );
  return rows;
}

export async function listJobChanges(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return null;
  const { rows } = await pool().query<JobChange>(
    `SELECT id::text, title, team_name AS "teamName", manager_name AS "managerName", employment_type AS "employmentType", to_char(changed_on, 'YYYY-MM-DD') AS "changedOn"
     FROM job_changes WHERE employee_id = $1 ORDER BY id DESC LIMIT 40`, [employeeId],
  );
  return rows;
}

export function addCompensation(member: Member, input: z.infer<typeof compensationFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [input.employeeId]);
    if (!rowCount) throw new PeopleError("Archived profiles are read-only.");
    const { currency } = await readCompany(client);
    await client.query("INSERT INTO compensation (employee_id, amount_cents, basis, currency, effective_on, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [input.employeeId, input.amount, input.basis, currency, input.effectiveOn, input.reason, member.id]);
    // The amount stays out of the activity history, which has a wider audience than pay.
    await audit(client, member, "compensation.added", { employeeId: input.employeeId, detail: `From ${input.effectiveOn}, ${basisLabels[input.basis]}` });
  });
}

export async function listPayRuns() {
  await requireAdmin();
  const { rows } = await pool().query<PayRun>(`SELECT ${runColumns} ${runFrom} GROUP BY r.id, u.name, v.id, v.state ORDER BY r.period_end DESC, r.created_at DESC, r.id LIMIT 60`);
  return rows;
}

// The period after the latest regular run that still counts.
export async function lastRegularEnd() {
  await requireAdmin();
  const { rows } = await pool().query<{ end: string | null }>(`SELECT to_char(max(r.period_end), 'YYYY-MM-DD') AS end FROM pay_runs r WHERE r.kind = 'regular' AND ${notReversed("r")}`);
  return rows[0].end;
}

// Anyone employed during the period whose record has no pay rate, so a run never skips a person silently.
export async function missingPay(periodStart: string, periodEnd: string, runId: string | null = null) {
  const { rows } = await pool().query<{ id: string; name: string }>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name FROM employees e WHERE ${employed}
     AND NOT EXISTS (SELECT 1 FROM compensation c WHERE c.employee_id = e.id AND c.effective_on <= $2) AND NOT EXISTS (SELECT 1 FROM pay_run_lines l WHERE l.pay_run_id = $3 AND l.employee_id = e.id)
     ORDER BY lower(e.last_name), e.id`, [periodStart, periodEnd, runId],
  );
  return rows;
}

async function readRun(client: Client, id: string) {
  const { rows } = await client.query<PayRun>(`SELECT ${runColumns} ${runFrom} WHERE r.id = $1 GROUP BY r.id, u.name, v.id, v.state`, [id]);
  return rows[0] ?? null;
}

async function readLines(client: Client, id: string, lineId: string | null = null) {
  const { rows } = await client.query<PayLine>(
    `SELECT l.id, l.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS name, e.employment_type AS "employmentType", e.location, l.basis, l.rate_cents::float8 AS "rateCents",
     l.hours::float8 AS hours, l.overtime_hours::float8 AS "overtimeHours", l.hours_source AS "hoursSource", l.overtime_multiplier_bp AS "overtimeMultiplierBp", l.base_cents::float8 AS "baseCents", l.overtime_cents::float8 AS "overtimeCents",
     l.earnings_cents::float8 AS "earningsCents", l.adjustment_cents::float8 AS "adjustmentCents", l.adjustment_note AS "adjustmentNote", l.reimbursement_cents::float8 AS "reimbursementCents", l.proration, l.accepted_notes AS "acceptedNotes", l.revision,
     l.gross_cents::float8 AS "grossCents", l.taxable_cents::float8 AS "taxableCents", l.pre_tax_cents::float8 AS "preTaxCents", l.tax_cents::float8 AS "taxCents", l.post_tax_cents::float8 AS "postTaxCents",
     l.nontaxed_cents::float8 AS "nontaxedCents", l.net_cents::float8 AS "netCents", l.employer_cents::float8 AS "employerCents", (l.gross_cents + l.nontaxed_cents)::float8 AS "totalCents"
     FROM pay_run_lines l JOIN employees e ON e.id = l.employee_id WHERE l.pay_run_id = $1 AND ($2::uuid IS NULL OR l.id = $2) ORDER BY lower(e.last_name), lower(e.first_name), e.id`, [id, lineId],
  );
  return rows;
}

async function readItems(client: Client, runId: string) {
  const { rows } = await client.query<PayItem>(
    `SELECT i.line_id AS "lineId", i.kind, i.source, i.source_id AS "sourceId", i.label, i.detail, i.base_cents::float8 AS "baseCents", i.amount_cents::float8 AS "amountCents"
     FROM pay_run_items i JOIN pay_run_lines l ON l.id = i.line_id AND l.revision = i.revision WHERE l.pay_run_id = $1 ORDER BY i.line_id, i.position`, [runId],
  );
  const groups = new Map<string, PayItem[]>();
  for (const row of rows) groups.set(row.lineId, [...groups.get(row.lineId) ?? [], row]);
  return groups;
}

export async function readPayRun(id: string) {
  await requireAdmin();
  const run = await readRun(pool(), id);
  if (!run) return null;
  const draft = run.state === "draft" && run.kind !== "reversal";
  const [lines, items] = [await readLines(pool(), id), await readItems(pool(), id)];
  const [missing, earnings, review, candidates, paidElsewhere] = draft ? await Promise.all([
    run.kind === "regular" ? missingPay(run.periodStart, run.periodEnd, id) : [], readEarnings(pool(), id), draftChecks(run, lines, items), personCandidates(run), run.kind === "regular" ? paidOffCycle(run) : [],
  ]) : [[], [], { checks: [], stale: false, notes: new Map<string, string[]>() }, [], []];
  return { run, lines, items, missing, earnings, candidates, paidElsewhere, ...review };
}

async function readEarnings(client: Client, runId: string) {
  const { rows } = await client.query<LineEarning>(`SELECT x.id, x.line_id AS "lineId", x.type, x.label, x.amount_cents::float8 AS "amountCents" FROM pay_line_earnings x JOIN pay_run_lines l ON l.id = x.line_id WHERE l.pay_run_id = $1 ORDER BY x.created_at, x.id`, [runId]);
  return rows;
}

async function personCandidates(run: PayRun) {
  const { rows } = run.kind === "regular" ? await pool().query<{ id: string; name: string }>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name FROM employees e WHERE ${employed}
     AND EXISTS (SELECT 1 FROM compensation c WHERE c.employee_id = e.id AND c.effective_on <= $2) AND NOT EXISTS (SELECT 1 FROM pay_run_lines l WHERE l.pay_run_id = $3 AND l.employee_id = e.id) ORDER BY lower(e.last_name), e.id`, [run.periodStart, run.periodEnd, run.id],
  ) : await pool().query<{ id: string; name: string }>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name FROM employees e WHERE ${offCyclePeople} AND NOT EXISTS (SELECT 1 FROM pay_run_lines l WHERE l.pay_run_id = $1 AND l.employee_id = e.id) ORDER BY lower(e.last_name), e.id`, [run.id],
  );
  return rows;
}

// People whose whole period was paid off-cycle, who are left out but never silently.
async function paidOffCycle(run: PayRun) {
  const { rows } = await pool().query<{ id: string; name: string }>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name FROM employees e WHERE ${employed} AND EXISTS (SELECT 1 ${offCycleWages("approved")})
     AND NOT EXISTS (SELECT 1 FROM pay_run_lines l WHERE l.pay_run_id = $3 AND l.employee_id = e.id) ORDER BY lower(e.last_name), e.id`, [run.periodStart, run.periodEnd, run.id]);
  return rows;
}

const offCyclePeople = `(e.status <> 'archived' OR e.last_day >= current_date - 120)`;

export async function offCycleCandidates() {
  await requireAdmin();
  const { rows } = await pool().query<{ id: string; name: string; status: string }>(`SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name, e.status FROM employees e WHERE ${offCyclePeople} ORDER BY lower(e.last_name), lower(e.first_name), e.id LIMIT 2000`);
  return rows;
}

// Findings to read before approving. The blocking ones also stop the approval itself.
async function draftChecks(run: PayRun, lines: PayLine[], items: Map<string, PayItem[]>): Promise<{ checks: PayCheck[]; stale: boolean; notes: Map<string, string[]> }> {
  const people = lines.map((line) => line.employeeId);
  const [calculated, bank, shared, previous, derived] = await Promise.all([
    calculateLines(pool(), run, lines), currentBankChecks(pool(), people), sharedBankAccounts(pool(), people),
    pool().query<{ employeeId: string; gross: number }>(
      `SELECT DISTINCT ON (l.employee_id) l.employee_id AS "employeeId", l.gross_cents::float8 AS gross FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id
       WHERE l.employee_id = ANY($1::uuid[]) AND r.state = 'approved' AND r.kind = 'regular' AND r.period_end < $2 AND ${notReversed("r")} ORDER BY l.employee_id, r.period_end DESC`, [people, run.periodStart]),
    derive(pool(), run, lines),
  ]);
  const late = run.kind === "regular" ? await lateHours(run.periodStart) : new Map<string, number>();
  const before = new Map(previous.rows.map((row) => [row.employeeId, row.gross]));
  const checks: PayCheck[] = [];
  let stale = false;
  for (const line of lines) {
    const add = (problem: string, href?: string, blocking = false) => checks.push({ employeeId: line.employeeId, name: line.name, problem, blocking, href });
    const profile = `/workspace/people/${line.employeeId}`;
    const account = bank.get(line.employeeId);
    const last = before.get(line.employeeId);
    const found = derived.get(line.id)!;
    if (itemsKey(calculated.get(line.id)!.items) !== itemsKey(items.get(line.id) ?? [])) stale = true;
    for (const problem of blockingProblems(line, found)) add(problem, undefined, true);
    for (const problem of found.review) add(problem);
    if (line.netCents === 0) add("Nothing to pay.");
    if (run.kind === "regular" && line.hours === 0 && line.basis === "hourly" && line.rateCents) add(found.sheet ? "No hours entered. Approved timesheet hours are available." : "No hours entered and no approved timesheet.");
    else if (run.kind === "regular" && line.hoursSource === "manual" && found.sheet && (found.sheet.regular !== line.hours || found.sheet.overtime !== (line.overtimeHours ?? 0))) add("Hours differ from the approved timesheets.");
    if (late.has(line.employeeId)) add(`${late.get(line.employeeId)} hours approved for the previous period weren’t in its run. Add them as a correction if they are still owed.`);
    if (line.netCents > 0 && !account) add("No bank details.", `${profile}/bank`);
    else if (line.netCents > 0 && account && (run.currency === "USD" && account.kind !== "us" || run.currency === "EUR" && account.kind !== "iban")) add("Their bank details don’t fit this run’s payment file.", `${profile}/bank`);
    if (shared.has(line.employeeId)) add(`Same bank account as ${shared.get(line.employeeId)}.`, `${profile}/bank`);
    if (run.kind === "regular" && last !== undefined && last > 0 && Math.abs(line.grossCents - last) * 4 > last) add(`Gross pay ${line.grossCents > last ? "rose" : "fell"} more than 25% since their last regular run.`);
    if (line.baseCents + line.overtimeCents > 0 && (items.get(line.id) ?? []).some((item) => item.source === "invoice")) add("Paid by rate and by invoice in the same run.", "/workspace/invoices");
  }
  checks.sort((left, right) => Number(right.blocking) - Number(left.blocking));
  return { checks, stale, notes: new Map([...derived].map(([id, found]) => [id, found.notes])) };
}

// Timesheet hours approved after the previous period's run was closed, which no later run picks up by itself.
async function lateHours(before: string) {
  const { rows: [last] } = await pool().query<{ id: string; start: string; end: string }>(
    `SELECT r.id, to_char(r.period_start, 'YYYY-MM-DD') AS start, to_char(r.period_end, 'YYYY-MM-DD') AS end FROM pay_runs r WHERE r.kind = 'regular' AND r.state = 'approved' AND r.period_end < $1 AND ${notReversed("r")} ORDER BY r.period_end DESC LIMIT 1`, [before]);
  if (!last) return new Map<string, number>();
  const [sheets, paid] = await Promise.all([approvedHours(pool(), last.start, last.end), pool().query<{ employeeId: string; hours: number }>(`SELECT employee_id AS "employeeId", (hours + coalesce(overtime_hours, 0))::float8 AS hours FROM pay_run_lines WHERE pay_run_id = $1 AND hours IS NOT NULL`, [last.id])]);
  return new Map(paid.rows.flatMap(({ employeeId, hours }) => {
    const sheet = sheets.get(employeeId);
    const owed = sheet ? Math.round((sheet.regular + sheet.overtime - hours) * 100) / 100 : 0;
    return owed > 0 ? [[employeeId, owed] as const] : [];
  }));
}

type Terms = { employeeId: string; hireDate: string; lastDay: string | null; employed: boolean; started: boolean; rates: Rate[]; paidOff: DateRange[]; draftWages: boolean };
type Hours = { regular: number; overtime: number };
type Base = Pick<PayLine, "basis" | "rateCents" | "hours" | "overtimeHours" | "hoursSource" | "overtimeMultiplierBp" | "baseCents" | "overtimeCents" | "proration">;
// What a line should be from today's records. "problem" needs a person to act, "notes" need confirming, "review" is for reading.
type Derived = { expected: Base | null; problem: string | null; notes: string[]; review: string[]; sheet: Hours | null };

async function readTerms(client: Client, start: string, end: string, people: string[] | null) {
  const { rows } = await client.query<Terms>(
    `SELECT e.id AS "employeeId", to_char(e.hire_date, 'YYYY-MM-DD') AS "hireDate", to_char(e.last_day, 'YYYY-MM-DD') AS "lastDay", coalesce(${employed}, false) AS employed, e.status <> 'archived' OR e.last_day IS NOT NULL AS started,
     (SELECT coalesce(json_agg(json_build_object('from', to_char(c.effective_on, 'YYYY-MM-DD'), 'amountCents', c.amount_cents, 'basis', c.basis) ORDER BY c.effective_on), '[]') FROM compensation c WHERE c.employee_id = e.id AND c.effective_on <= $2) AS rates,
     (SELECT coalesce(json_agg(json_build_object('start', to_char(xr.period_start, 'YYYY-MM-DD'), 'end', to_char(xr.period_end, 'YYYY-MM-DD')) ORDER BY xr.period_start), '[]') ${offCycleWages("approved")}) AS "paidOff",
     EXISTS (SELECT 1 ${offCycleWages("draft")}) AS "draftWages" FROM employees e WHERE $3::uuid[] IS NULL OR e.id = ANY($3)`, [start, end, people]);
  return rows;
}

// Employed days in the period, without the days an approved off-cycle run already paid, split at each change of pay.
function workOf(run: Pick<PayRun, "periodStart" | "periodEnd">, terms: Terms) {
  const employedRange = { start: terms.hireDate > run.periodStart ? terms.hireDate : run.periodStart, end: terms.lastDay && terms.lastDay < run.periodEnd ? terms.lastDay : run.periodEnd };
  const segments = workSegments(subtractRanges(employedRange, terms.paidOff), terms.rates);
  const current = terms.rates.at(-1) ?? null;
  return { segments: segments.filter((segment) => segment.rate.basis === current?.basis), other: segments.filter((segment) => segment.rate.basis !== current?.basis), current };
}

async function segmentHours(client: Client, work: Map<string, WorkSegment[]>) {
  const ranges = new Map<string, DateRange>();
  for (const segments of work.values()) for (const { start, end } of segments) ranges.set(`${start}/${end}`, { start, end });
  const sheets = new Map<string, Map<string, Hours>>();
  for (const [key, range] of ranges) sheets.set(key, await approvedHours(client, range.start, range.end));
  return (employeeId: string) => (work.get(employeeId) ?? []).flatMap((segment) => {
    const hours = sheets.get(`${segment.start}/${segment.end}`)?.get(employeeId);
    return hours ? [{ ...segment, ...hours }] : [];
  });
}

const addHours = (parts: number[]) => Math.round(parts.reduce((sum, part) => sum + part, 0) * 100) / 100;

async function derive(client: Client, run: PayRun, lines: PayLine[], useSheets = false): Promise<Map<string, Derived>> {
  const terms = new Map((await readTerms(client, run.periodStart, run.periodEnd, lines.map((line) => line.employeeId))).map((row) => [row.employeeId, row]));
  const nothing: Derived = { expected: null, problem: null, notes: [], review: [], sheet: null };
  if (run.kind !== "regular") {
    return new Map(lines.map((line) => [line.id, { ...nothing, problem: terms.get(line.employeeId)!.started ? null : "They never started, so there is nothing to pay. Remove them from this run." }]));
  }
  const { overtimeMultiplierBp } = await readTimeSettings(client);
  const periodDays = weekdaysBetween(run.periodStart, run.periodEnd);
  const work = new Map([...terms].map(([id, row]) => [id, workOf(run, row)]));
  const sheetsOf = await segmentHours(client, new Map([...work].filter(([, entry]) => entry.current?.basis === "hourly").map(([id, entry]) => [id, entry.segments])));
  return new Map(lines.map((line): [string, Derived] => {
    const person = terms.get(line.employeeId)!;
    if (!person.employed) return [line.id, { ...nothing, problem: "Not employed in this period. Remove them from this run, and pay anything they are owed off-cycle." }];
    const { segments, other, current } = work.get(line.employeeId)!;
    const notes: string[] = [];
    const review: string[] = [];
    const common = { basis: current?.basis ?? "annual" as PayBasis, rateCents: current?.amountCents ?? 0, overtimeMultiplierBp };
    const paidOff = person.paidOff.map((range) => `${formatDate(range.start)}${range.end === range.start ? "" : ` to ${formatDate(range.end)}`}`).join(", ");
    if (other.length) notes.push(`Their pay changed from ${other[0].rate.basis === "hourly" ? "hourly to a salary" : "a salary to hourly"} on ${formatDate(segments[0]?.start ?? current!.from)}. This line pays only the ${current!.basis === "hourly" ? "hourly" : "salaried"} part. Add the rest as a correction.`);
    if (person.draftWages) review.push("An off-cycle draft holds wages for some of these dates. Approve it first to leave those days out here.");
    if (person.hireDate > run.periodStart) review.push(`New starter on ${formatDate(person.hireDate)}.`);
    if (person.lastDay && person.lastDay < run.periodEnd) review.push(`Leaver, last day ${formatDate(person.lastDay)}.`);
    if (current && person.rates[0].from > (person.hireDate > run.periodStart ? person.hireDate : run.periodStart)) review.push(`Their first recorded rate starts on ${formatDate(person.rates[0].from)}. Earlier days use it too.`);
    const changed = new Set(segments.map((segment) => segment.rate.from)).size > 1;
    if (current?.basis !== "hourly") {
      const worked = segments.reduce((sum, segment) => sum + weekdaysBetween(segment.start, segment.end), 0);
      const parts = changed ? segments.map((segment) => `${weekdaysBetween(segment.start, segment.end)} at ${formatMoney(segment.rate.amountCents, run.currency)}`).join(", ") : "";
      const proration = current && (worked < periodDays || changed) ? `${worked} of ${periodDays} weekdays${parts && `: ${parts}`}` : "";
      if (paidOff) review.push(`Wages for ${paidOff} were paid off-cycle, so this covers ${worked} of ${periodDays} weekdays.`);
      if (changed) review.push(`Their salary changed on ${formatDate(current!.from)}. Each day is paid at the salary in force.`);
      return [line.id, { ...nothing, notes, review, expected: { ...common, hours: null, overtimeHours: null, hoursSource: "manual", baseCents: salaryForSegments(segments, run.schedule, periodDays), overtimeCents: 0, proration } }];
    }
    const parts = sheetsOf(line.employeeId);
    const sheet = parts.length ? { regular: addHours(parts.map((part) => part.regular)), overtime: addHours(parts.map((part) => part.overtime)) } : null;
    const fromSheet = line.hoursSource === "timesheet" || useSheets && sheet !== null;
    if (fromSheet) {
      if (!sheet) return [line.id, { ...nothing, notes, review, problem: "The timesheets behind these hours are no longer approved. Refresh hours once they are, or enter the hours." }];
      if (paidOff) review.push(`Wages for ${paidOff} were paid off-cycle, so timesheet hours on those days are left out.`);
      if (changed) review.push(`Their hourly rate changed on ${formatDate(current.from)}. Each day’s hours are paid at the rate in force.`);
      return [line.id, { ...nothing, notes, review, sheet, expected: {
        ...common, hours: sheet.regular, overtimeHours: sheet.overtime, hoursSource: "timesheet", baseCents: parts.reduce((sum, part) => sum + hourlyPay(part.rate.amountCents, part.regular), 0),
        overtimeCents: parts.reduce((sum, part) => sum + hourlyPay(part.rate.amountCents, part.overtime, overtimeMultiplierBp), 0),
        proration: changed ? parts.map((part) => `${addHours([part.regular, part.overtime])} at ${formatMoney(part.rate.amountCents, run.currency)}`).join(", ") : "",
      } }];
    }
    const hours = line.hours ?? 0;
    const overtimeHours = line.overtimeHours ?? 0;
    if (changed && hours + overtimeHours > 0) notes.push(`Their hourly rate changed on ${formatDate(current.from)}. Every hour typed here is paid at ${formatMoney(current.amountCents, run.currency)}.`);
    if (paidOff && hours + overtimeHours > 0) notes.push(`Wages for ${paidOff} were paid off-cycle. Leave those hours out.`);
    return [line.id, { ...nothing, notes, review, sheet, expected: { ...common, hours, overtimeHours, hoursSource: "manual", baseCents: hourlyPay(current.amountCents, hours), overtimeCents: hourlyPay(current.amountCents, overtimeHours, overtimeMultiplierBp), proration: "" } }];
  }));
}

const notesKey = (notes: string[]) => notes.join("\n");

// Reasons this line can't be approved as it stands.
function blockingProblems(line: PayLine, { expected, problem, notes }: Derived) {
  const problems = problem ? [problem] : [];
  if (expected && (expected.basis !== line.basis || expected.rateCents !== line.rateCents || expected.baseCents !== line.baseCents || expected.overtimeCents !== line.overtimeCents || (expected.hours ?? null) !== line.hours
    || (expected.overtimeHours ?? 0) !== (line.overtimeHours ?? 0) || expected.proration !== line.proration)) problems.push("Their dates, pay, hours or off-cycle wages changed after this draft was calculated. Recalculate.");
  if (notes.length && notesKey(notes) !== line.acceptedNotes) problems.push(...notes.map((note) => `${note} Confirm it on their line.`));
  if (line.netCents < 0) problems.push("Net pay is negative. Lower the deductions, add earnings or remove them from this run.");
  return problems;
}

// Brings lines up to date with the records. Typed hours, adjustments and earnings stay as entered.
async function refreshLines(client: Client, run: PayRun, lines: PayLine[], useSheets = false) {
  const derived = await derive(client, run, lines, useSheets);
  if (run.kind !== "regular") {
    const terms = new Map((await readTerms(client, run.periodStart, run.periodEnd, lines.map((line) => line.employeeId))).map((row) => [row.employeeId, row]));
    for (const line of lines) {
      const rate = terms.get(line.employeeId)!.rates.at(-1);
      Object.assign(line, { basis: rate?.basis ?? "annual", rateCents: rate?.amountCents ?? 0 });
    }
  }
  for (const line of lines) Object.assign(line, derived.get(line.id)!.expected ?? {});
  return derived;
}

async function insertLines(client: PoolClient, run: PayRun, people: string[]) {
  await client.query("INSERT INTO pay_run_lines (pay_run_id, employee_id, basis, rate_cents, base_cents) SELECT $1, unnest($2::uuid[]), 'annual', 0, 0", [run.id, people]);
  const added = new Set(people);
  const lines = (await readLines(client, run.id)).filter((line) => added.has(line.employeeId));
  await refreshLines(client, run, lines, true);
  await holdClaims(client, run, lines);
  return lines;
}

// A draft holds the approved expenses and invoices it will pay, so two runs can't pay the same one.
async function holdClaims(client: PoolClient, run: PayRun, lines: PayLine[]) {
  if (run.includesClaims) {
    const people = lines.map((line) => line.employeeId);
    for (const table of ["expenses", "contractor_invoices"]) {
      await client.query(`UPDATE ${table} SET pay_run_id = $1 WHERE state = 'approved' AND pay_run_id IS NULL AND currency = $2 AND employee_id = ANY($3::uuid[])`, [run.id, run.currency, people]);
    }
  }
  const { rows } = await client.query<{ employeeId: string; amount: number }>(`SELECT employee_id AS "employeeId", sum(amount_cents)::float8 AS amount FROM expenses WHERE pay_run_id = $1 GROUP BY 1`, [run.id]);
  const sums = new Map(rows.map((row) => [row.employeeId, row.amount]));
  for (const line of lines) line.reimbursementCents = sums.get(line.employeeId) ?? 0;
}

// Calculates lines and writes them with a new revision of their items. Earlier revisions stay for reference.
async function settle(client: PoolClient, run: PayRun, lines: PayLine[]) {
  const calculated = await calculateLines(client, run, lines);
  const rows = lines.map((line) => {
    const { totals } = calculated.get(line.id)!;
    return {
      id: line.id, accepted: line.acceptedNotes, rate: line.rateCents, basis: line.basis, hours: line.hours, overtime_hours: line.overtimeHours, source: line.hoursSource, multiplier: line.overtimeMultiplierBp, base: line.baseCents, overtime: line.overtimeCents, adjustment: line.adjustmentCents, note: line.adjustmentNote,
      reimbursement: line.reimbursementCents, proration: line.proration, earnings: totals.grossCents - line.baseCents - line.overtimeCents - line.adjustmentCents, gross: totals.grossCents, taxable: totals.taxableCents,
      pre_tax: totals.preTaxCents, tax: totals.taxCents, post_tax: totals.postTaxCents, nontaxed: totals.nontaxedCents, net: totals.netCents, employer: totals.employerCents,
    };
  });
  await client.query(
    `UPDATE pay_run_lines l SET rate_cents = x.rate, basis = x.basis, hours = x.hours, overtime_hours = x.overtime_hours, hours_source = x.source, overtime_multiplier_bp = x.multiplier, base_cents = x.base, overtime_cents = x.overtime, adjustment_cents = x.adjustment, adjustment_note = x.note,
     reimbursement_cents = x.reimbursement, proration = x.proration, earnings_cents = x.earnings, gross_cents = x.gross, taxable_cents = x.taxable, pre_tax_cents = x.pre_tax, tax_cents = x.tax, post_tax_cents = x.post_tax,
     nontaxed_cents = x.nontaxed, net_cents = x.net, employer_cents = x.employer, accepted_notes = x.accepted, revision = l.revision + 1
     FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, accepted text, rate bigint, basis text, hours numeric, overtime_hours numeric, source text, multiplier integer, base bigint, overtime bigint, adjustment bigint, note text, reimbursement bigint, proration text, earnings bigint,
       gross bigint, taxable bigint, pre_tax bigint, tax bigint, post_tax bigint, nontaxed bigint, net bigint, employer bigint) WHERE l.id = x.id AND l.pay_run_id = $1`, [run.id, JSON.stringify(rows)],
  );
  const items = lines.flatMap((line) => calculated.get(line.id)!.items.map((item, index) => ({ line_id: line.id, position: index + 1, kind: item.kind, source: item.source, source_id: item.sourceId, label: item.label, detail: item.detail, base: item.baseCents, amount: item.amountCents })));
  await client.query(
    `INSERT INTO pay_run_items (line_id, revision, position, kind, source, source_id, label, detail, base_cents, amount_cents)
     SELECT x.line_id, l.revision, x.position, x.kind, x.source, x.source_id, x.label, x.detail, x.base, x.amount
     FROM jsonb_to_recordset($1::jsonb) AS x(line_id uuid, position integer, kind text, source text, source_id uuid, label text, detail text, base bigint, amount bigint) JOIN pay_run_lines l ON l.id = x.line_id`, [JSON.stringify(items)],
  );
}

async function touch(client: PoolClient, runId: string) {
  await client.query("UPDATE pay_runs SET version = version + 1 WHERE id = $1", [runId]);
}

export function createPayRun(member: Member, input: z.infer<typeof payRunFields>) {
  return runAsAdmin(member, async (client) => {
    const { rowCount: overlapping } = await client.query(`SELECT 1 FROM pay_runs r WHERE r.kind = 'regular' AND r.period_start <= $2 AND r.period_end >= $1 AND ${notReversed("r")} LIMIT 1`, [input.periodStart, input.periodEnd]);
    if (overlapping) throw new PeopleError("Another pay run already covers part of this period.");
    const company = await readCompany(client);
    // Every regular run pays one full share of a salary, so a schedule period gets one run however short its dates are.
    const period = periodOfYear(company.schedule, input.periodEnd);
    const { rows: others } = await client.query<{ schedule: PaySchedule; end: string }>(
      `SELECT r.schedule, to_char(r.period_end, 'YYYY-MM-DD') AS end FROM pay_runs r WHERE r.kind = 'regular' AND extract(year FROM r.period_end) = $1 AND ${notReversed("r")}`, [Number(input.periodEnd.slice(0, 4))]);
    if (others.some((other) => periodOfYear(other.schedule, other.end).key === period.key)) throw new PeopleError("Another pay run already pays this period of your pay schedule. Use the dates of the next period, or an off-cycle run.");
    const { rows: payable } = await client.query<{ id: string }>(
      `SELECT e.id FROM employees e WHERE ${employed} AND (EXISTS (SELECT 1 FROM compensation c WHERE c.employee_id = e.id AND c.effective_on <= $2)
       OR EXISTS (SELECT 1 FROM contractor_invoices v WHERE v.employee_id = e.id AND v.state = 'approved' AND v.pay_run_id IS NULL AND v.currency = $3))`, [input.periodStart, input.periodEnd, company.currency],
    );
    const terms = await readTerms(client, input.periodStart, input.periodEnd, payable.map((person) => person.id));
    const people = terms.filter((person) => { const { segments, other } = workOf(input, person); return !person.paidOff.length || segments.length + other.length > 0; }).map((person) => person.employeeId);
    const { rows: [created] } = await client.query<{ id: string }>("INSERT INTO pay_runs (period_start, period_end, pay_on, schedule, currency, period_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [input.periodStart, input.periodEnd, input.payOn, company.schedule, company.currency, period.key, member.id]);
    const run = (await readRun(client, created.id))!;
    const lines = await insertLines(client, run, people);
    await settle(client, run, lines);
    await audit(client, member, "pay_run.created", { detail: `${input.periodStart} to ${input.periodEnd}` });
    return run.id;
  });
}

export function createOffCycleRun(member: Member, input: z.infer<typeof offCycleFields>) {
  return runAsAdmin(member, async (client) => {
    const company = await readCompany(client);
    await requireOffCyclePeople(client, input.people);
    const { rows: [created] } = await client.query<{ id: string }>(
      "INSERT INTO pay_runs (kind, purpose, label, period_start, period_end, pay_on, schedule, currency, includes_claims, created_by) VALUES ('off_cycle', $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
      [input.purpose, input.label, input.periodStart, input.periodEnd, input.payOn, company.schedule, company.currency, input.includesClaims, member.id]);
    const run = (await readRun(client, created.id))!;
    const lines = await insertLines(client, run, [...new Set(input.people)]);
    if (input.amount !== null) for (const line of lines) await insertEarning(client, member, run, line, input.type, "", input.amount);
    await settle(client, run, lines);
    await audit(client, member, "pay_run.created", { detail: `${purposeLabels[input.purpose]}, pays on ${input.payOn}` });
    return run.id;
  });
}

async function requireOffCyclePeople(client: PoolClient, people: string[]) {
  const { rowCount } = await client.query(`SELECT 1 FROM employees e WHERE e.id = ANY($1::uuid[]) AND ${offCyclePeople}`, [people]);
  if (rowCount !== new Set(people).size) throw new PeopleError("Someone you chose can no longer be paid. Reload and choose again.");
}

// A person's wages for a day are paid once, by one regular run or one off-cycle run.
async function paidWages(client: PoolClient, run: PayRun, employeeId: string, approvedOnly: boolean) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id WHERE l.employee_id = $1 AND r.id <> $2 AND r.period_start <= $4 AND r.period_end >= $3 AND (r.state = 'approved' OR NOT $5) AND ${notReversed("r")}
     AND (r.kind = 'regular' OR r.kind = 'off_cycle' AND EXISTS (SELECT 1 FROM pay_line_earnings x WHERE x.line_id = l.id AND x.type = 'wages')) LIMIT 1`, [employeeId, run.id, run.periodStart, run.periodEnd, approvedOnly]);
  return Boolean(rowCount);
}

async function insertEarning(client: PoolClient, member: Member, run: PayRun, line: PayLine, type: EarningType, label: string, amountCents: number) {
  if (type === "wages") {
    if (run.kind === "regular") throw new PeopleError("Base pay already covers this period. Add a correction instead.");
    if (await paidWages(client, run, line.employeeId, false)) throw new PeopleError(`${line.name} is already paid wages for part of this period in another run. Add a correction if something is still owed.`);
  }
  await client.query("INSERT INTO pay_line_earnings (line_id, type, label, amount_cents, created_by) VALUES ($1, $2, $3, $4, $5)", [line.id, type, label || earningLabels[type], amountCents, member.id]);
}

async function requireDraft(client: PoolClient, id: string, editing = true) {
  const run = await readRun(client, id);
  if (!run) throw new PeopleError("This pay run could not be found.");
  if (run.state !== "draft") throw new PeopleError("Approved pay runs are read-only.");
  if (editing && run.kind === "reversal") throw new PeopleError("A reversal always matches the run it reverses.");
  return run;
}

async function requireLine(client: PoolClient, runId: string, lineId: string) {
  const run = await requireDraft(client, runId);
  const [line] = await readLines(client, runId, lineId);
  if (!line) throw new PeopleError("This line is no longer in the pay run.");
  return { run, line };
}

async function saveLine(client: PoolClient, member: Member, run: PayRun, line: PayLine) {
  await settle(client, run, [line]);
  await touch(client, run.id);
  await audit(client, member, "pay_run.updated", { employeeId: line.employeeId });
}

export function updatePayLine(member: Member, input: z.infer<typeof payLineFields> & { overtimeHours?: number; acceptNotes?: boolean }) {
  return runAsAdmin(member, async (client) => {
    const { run, line } = await requireLine(client, input.runId, input.lineId);
    if (line.hours !== null) {
      const hours = input.hours ?? 0;
      const overtimeHours = input.overtimeHours ?? line.overtimeHours ?? 0;
      const unbacked = line.hoursSource === "timesheet" && Boolean((await derive(client, run, [line])).get(line.id)!.problem);
      if (unbacked || hours !== line.hours || overtimeHours !== (line.overtimeHours ?? 0)) Object.assign(line, { hours, overtimeHours, hoursSource: "manual" });
    }
    const found = (await refreshLines(client, run, [line])).get(line.id)!;
    if (line.baseCents + line.overtimeCents + line.earningsCents + input.adjustment + line.nontaxedCents < 0) throw new PeopleError("The adjustment would make this person’s total negative.");
    Object.assign(line, { adjustmentCents: input.adjustment, adjustmentNote: input.adjustmentNote, acceptedNotes: input.acceptNotes ? notesKey(found.notes) : "" });
    await saveLine(client, member, run, line);
  });
}

export function addLineEarning(member: Member, input: z.infer<typeof earningFields>) {
  return runAsAdmin(member, async (client) => {
    const { run, line } = await requireLine(client, input.runId, input.lineId);
    await insertEarning(client, member, run, line, input.type, input.label, input.amount);
    await saveLine(client, member, run, line);
  });
}

// Unused days are entered by an administrator. Their value comes from the person's rate on this run.
export function addPtoPayout(member: Member, input: { runId: string; lineId: string; days: number }) {
  return runAsAdmin(member, async (client) => {
    const { run, line } = await requireLine(client, input.runId, input.lineId);
    const amount = ptoPayout(line.basis, line.rateCents, input.days);
    if (!amount) throw new PeopleError("Record this person’s pay before adding a PTO payout.");
    await insertEarning(client, member, run, line, "pto_payout", `PTO payout, ${input.days} ${input.days === 1 ? "day" : "days"}`, amount);
    await saveLine(client, member, run, line);
    return `${input.days} ${input.days === 1 ? "day" : "days"} added at ${formatMoney(amount, run.currency)}.`;
  });
}

export function removeLineEarning(member: Member, input: { runId: string; id: string }) {
  return runAsAdmin(member, async (client) => {
    await requireDraft(client, input.runId);
    const { rows } = await client.query<{ lineId: string }>(`DELETE FROM pay_line_earnings x USING pay_run_lines l WHERE x.id = $1 AND l.id = x.line_id AND l.pay_run_id = $2 RETURNING x.line_id AS "lineId"`, [input.id, input.runId]);
    if (!rows[0]) throw new PeopleError("This earning is no longer in the pay run.");
    const { run, line } = await requireLine(client, input.runId, rows[0].lineId);
    await saveLine(client, member, run, line);
  });
}

export function addRunPerson(member: Member, input: { runId: string; employeeId: string }) {
  return runAsAdmin(member, async (client) => {
    const run = await requireDraft(client, input.runId);
    const { rowCount: present } = await client.query("SELECT 1 FROM pay_run_lines WHERE pay_run_id = $1 AND employee_id = $2", [run.id, input.employeeId]);
    if (present) throw new PeopleError("They are already in this run.");
    if (run.kind === "regular") {
      const [person] = await readTerms(client, run.periodStart, run.periodEnd, [input.employeeId]);
      if (!person?.employed || !person.rates.length) throw new PeopleError("They aren’t employed with pay recorded in this period.");
    } else await requireOffCyclePeople(client, [input.employeeId]);
    await settle(client, run, await insertLines(client, run, [input.employeeId]));
    await touch(client, run.id);
    await audit(client, member, "pay_run.person_added", { employeeId: input.employeeId });
  });
}

export function removeRunPerson(member: Member, input: { runId: string; employeeId: string }) {
  return runAsAdmin(member, async (client) => {
    const run = await requireDraft(client, input.runId);
    if (run.people < 2) throw new PeopleError("This is the last person in the run. Delete the draft instead.");
    const { rowCount } = await client.query("DELETE FROM pay_run_lines WHERE pay_run_id = $1 AND employee_id = $2", [run.id, input.employeeId]);
    if (!rowCount) throw new PeopleError("They are no longer in this run.");
    for (const table of ["expenses", "contractor_invoices"]) await client.query(`UPDATE ${table} SET pay_run_id = NULL WHERE pay_run_id = $1 AND employee_id = $2 AND state = 'approved'`, [run.id, input.employeeId]);
    await touch(client, run.id);
    await audit(client, member, "pay_run.person_removed", { employeeId: input.employeeId });
  });
}

// Takes current pay rates, dates, timesheets, claims, rules and benefits. Typed hours, adjustments and earnings stay as entered.
export function recalculateRun(member: Member, id: string, refreshHours = false) {
  return runAsAdmin(member, async (client) => {
    const run = await requireDraft(client, id);
    const lines = await readLines(client, id);
    const derived = await refreshLines(client, run, lines, refreshHours);
    const filled = [...derived.values()].filter((found) => found.expected?.hoursSource === "timesheet").length;
    if (refreshHours && !filled) throw new PeopleError("No one in this run has approved timesheets for the period.");
    if (!refreshHours) await holdClaims(client, run, lines);
    await settle(client, run, lines);
    await touch(client, id);
    await audit(client, member, refreshHours ? "pay_run.hours_refreshed" : "pay_run.recalculated", { detail: `${run.periodStart} to ${run.periodEnd}` });
    return refreshHours ? `Hours filled for ${filled} ${filled === 1 ? "person" : "people"}.` : "Amounts recalculated.";
  });
}

// An approved run is undone only by a run with every amount reversed, which needs its own approval.
export function reversePayRun(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const run = await readRun(client, id);
    if (!run || run.state !== "approved") throw new PeopleError("Only an approved run can be reversed.");
    if (run.kind === "reversal") throw new PeopleError("A reversal can’t be reversed. Create a new run instead.");
    if (run.reversalId) throw new PeopleError("This run already has a reversal.");
    const { rows: [created] } = await client.query<{ id: string }>(
      `INSERT INTO pay_runs (kind, period_start, period_end, pay_on, schedule, currency, period_key, includes_claims, reverses_id, created_by)
       SELECT 'reversal', period_start, period_end, pay_on, schedule, currency, period_key, includes_claims, id, $2 FROM pay_runs WHERE id = $1 RETURNING id`, [id, member.id],
    );
    await client.query(
      `INSERT INTO pay_run_lines (pay_run_id, employee_id, basis, rate_cents, hours, overtime_hours, overtime_multiplier_bp, hours_source, base_cents, overtime_cents, earnings_cents, adjustment_cents, adjustment_note, reimbursement_cents, proration,
         gross_cents, taxable_cents, pre_tax_cents, tax_cents, post_tax_cents, nontaxed_cents, net_cents, employer_cents)
       SELECT $2, employee_id, basis, rate_cents, -hours, -overtime_hours, overtime_multiplier_bp, hours_source, -base_cents, -overtime_cents, -earnings_cents, -adjustment_cents, adjustment_note, -reimbursement_cents, proration,
         -gross_cents, -taxable_cents, -pre_tax_cents, -tax_cents, -post_tax_cents, -nontaxed_cents, -net_cents, -employer_cents FROM pay_run_lines WHERE pay_run_id = $1`, [id, created.id],
    );
    await client.query(
      `INSERT INTO pay_run_items (line_id, revision, position, kind, source, source_id, label, detail, base_cents, amount_cents)
       SELECT n.id, n.revision, i.position, i.kind, i.source, i.source_id, i.label, i.detail, -i.base_cents, -i.amount_cents
       FROM pay_run_lines o JOIN pay_run_items i ON i.line_id = o.id AND i.revision = o.revision JOIN pay_run_lines n ON n.pay_run_id = $2 AND n.employee_id = o.employee_id WHERE o.pay_run_id = $1`, [id, created.id],
    );
    await audit(client, member, "pay_run.reversed", { detail: `${run.periodStart} to ${run.periodEnd}` });
    return created.id;
  });
}

export function commandPayRun(member: Member, input: { id: string; version: number; operation: "approve" | "delete" }) {
  return runAsAdmin(member, async (client) => {
    const run = await requireDraft(client, input.id, false);
    const detail = `${run.periodStart} to ${run.periodEnd}`;
    if (input.operation === "delete") {
      await client.query("DELETE FROM pay_runs WHERE id = $1", [input.id]);
      await audit(client, member, "pay_run.deleted", { detail });
      return;
    }
    if (run.version !== input.version) throw new PeopleError("This pay run changed while you were reviewing it. Check the totals and approve again.");
    if (!run.people) throw new PeopleError("This run has no one in it. Delete the draft instead.");
    const lines = await readLines(client, input.id);
    if (run.kind !== "reversal") {
      const derived = await derive(client, run, lines);
      for (const line of lines) {
        const [problem] = blockingProblems(line, derived.get(line.id)!);
        if (problem) throw new PeopleError(`${line.name}: ${problem}`);
      }
      if (run.kind === "off_cycle") {
        const { rows: wages } = await client.query<{ employeeId: string }>(`SELECT DISTINCT l.employee_id AS "employeeId" FROM pay_run_lines l JOIN pay_line_earnings x ON x.line_id = l.id AND x.type = 'wages' WHERE l.pay_run_id = $1`, [input.id]);
        for (const { employeeId } of wages) if (await paidWages(client, run, employeeId, true)) throw new PeopleError(`${lines.find((line) => line.employeeId === employeeId)!.name} is already paid wages for part of this period in another run. Remove the unpaid wages from this one.`);
      }
      const [calculated, items] = [await calculateLines(client, run, lines), await readItems(client, input.id)];
      if (lines.some((line) => itemsKey(calculated.get(line.id)!.items) !== itemsKey(items.get(line.id) ?? []))) throw new PeopleError("Rules, benefits or year-to-date amounts changed after this draft was calculated. Recalculate, check the totals and approve again.");
      const { rows: claims } = await client.query<{ employeeId: string; amount: number }>(`SELECT employee_id AS "employeeId", sum(amount_cents)::float8 AS amount FROM expenses WHERE pay_run_id = $1 AND state = 'approved' GROUP BY 1`, [input.id]);
      const held = new Map(claims.map((claim) => [claim.employeeId, claim.amount]));
      if (lines.some((line) => line.reimbursementCents !== (held.get(line.employeeId) ?? 0))) throw new PeopleError("The expenses in this run changed. Recalculate, check the totals and approve again.");
    }
    await client.query("UPDATE pay_runs SET state = 'approved', approved_by = $2, approved_at = now(), period_key = $3, version = version + 1 WHERE id = $1",
      [input.id, member.id, run.kind === "off_cycle" ? "" : periodOfYear(run.schedule, run.periodEnd).key]);
    if (run.kind !== "off_cycle") await lockTimesheets(client, run.periodStart, run.periodEnd);
    if (run.kind === "reversal") {
      // What the original run paid is owed again, and another run can pay it once.
      await client.query("UPDATE expenses SET state = 'approved', pay_run_id = NULL WHERE pay_run_id = $1 AND state = 'reimbursed'", [run.reversesId]);
      await client.query("UPDATE contractor_invoices SET state = 'approved', pay_run_id = NULL WHERE pay_run_id = $1 AND state = 'paid'", [run.reversesId]);
    } else {
      await client.query("UPDATE expenses SET state = 'reimbursed' WHERE pay_run_id = $1 AND state = 'approved'", [input.id]);
      await client.query("UPDATE contractor_invoices SET state = 'paid' WHERE pay_run_id = $1 AND state = 'approved'", [input.id]);
    }
    for (const line of lines) await notify(client, member, { employeeId: line.employeeId }, { title: run.kind === "reversal" ? "A payslip was reversed" : "Your payslip is ready", body: detail, href: `/workspace/payslips/${line.id}` });
    await audit(client, member, "pay_run.approved", { detail: `${detail}, ${run.people} people` });
  });
}

export function exportPayRun(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const run = await readRun(client, id);
    if (!run) return null;
    const lines = await readLines(client, id);
    await audit(client, member, "pay_run.exported", { detail: `${run.periodStart} to ${run.periodEnd}` });
    const amount = (cents: number) => (cents / 100).toFixed(2);
    return {
      name: `openwarp-pay-${run.periodStart}-${run.periodEnd}-${run.kind === "regular" ? "" : `${run.kind.replace("_", "-")}-`}${run.state}`,
      rows: [["Employee", "Employment type", "Basis", "Rate", "Hours", "Base pay", "Adjustment", "Adjustment note", "Reimbursement", "Total", "Currency", "Status",
        "Overtime hours", "Overtime pay", "Other earnings", "Gross pay", "Pre-tax deductions", "Taxable pay", "Taxes", "Post-tax deductions", "Invoices and other untaxed pay", "Net pay", "Employer contributions"],
        ...lines.map((line) => [line.name, employmentLabels[line.employmentType], basisLabels[line.basis], amount(line.rateCents), line.hours === null ? "" : String(line.hours), amount(line.baseCents),
          amount(line.adjustmentCents), line.adjustmentNote, amount(line.reimbursementCents), amount(line.totalCents), run.currency, run.state === "approved" ? "Approved" : "Draft",
          line.overtimeHours === null ? "" : String(line.overtimeHours), amount(line.overtimeCents), amount(line.earningsCents), amount(line.grossCents), amount(line.preTaxCents), amount(line.taxableCents), amount(line.taxCents), amount(line.postTaxCents),
          amount(line.nontaxedCents - line.reimbursementCents), amount(line.netCents), amount(line.employerCents)])],
    };
  });
}

export function payLabel(entry: Compensation) {
  return `${formatMoney(entry.amountCents, entry.currency)} ${basisLabels[entry.basis]}`;
}

const slipColumns = `l.id, r.kind, r.purpose, to_char(r.period_start, 'YYYY-MM-DD') AS "periodStart", to_char(r.period_end, 'YYYY-MM-DD') AS "periodEnd", to_char(r.pay_on, 'YYYY-MM-DD') AS "payOn", r.currency,
  l.net_cents::float8 AS "netCents", l.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS name`;
const slipFrom = `FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id AND r.state = 'approved' JOIN employees e ON e.id = l.employee_id`;

export async function listPayslips(member: Member, employeeId: string) {
  if (member.role !== "admin" && member.employeeId !== employeeId) return [];
  const { rows } = await pool().query<Payslip>(`SELECT ${slipColumns} ${slipFrom} WHERE l.employee_id = $1 ORDER BY r.pay_on DESC, r.approved_at DESC LIMIT 120`, [employeeId]);
  return rows;
}

export type SlipRow = { kind: ItemKind; source: ItemSource; label: string; detail: string; amountCents: number; ytdCents: number };

export async function readPayslip(member: Member, id: string) {
  const { rows: [slip] } = await pool().query<Payslip & PayTotals & { title: string; employmentType: EmploymentType; hours: number | null; overtimeHours: number | null; runId: string }>(
    `SELECT ${slipColumns}, e.title, e.employment_type AS "employmentType", l.hours::float8 AS hours, l.overtime_hours::float8 AS "overtimeHours", l.gross_cents::float8 AS "grossCents", l.taxable_cents::float8 AS "taxableCents",
     l.pre_tax_cents::float8 AS "preTaxCents", l.tax_cents::float8 AS "taxCents", l.post_tax_cents::float8 AS "postTaxCents", l.nontaxed_cents::float8 AS "nontaxedCents", l.employer_cents::float8 AS "employerCents", r.id AS "runId"
     ${slipFrom} WHERE l.id = $1 AND ($2 = 'admin' OR l.employee_id = $3)`, [id, member.role, member.employeeId],
  );
  if (!slip) return null;
  // Year to date counts the runs paid in the same calendar year up to and including this one.
  const yearToDate = `FROM pay_run_lines l JOIN pay_runs r ON r.id = l.pay_run_id AND r.state = 'approved' JOIN pay_runs t ON t.id = $2
    WHERE l.employee_id = $1 AND extract(year FROM r.pay_on) = extract(year FROM t.pay_on) AND (r.pay_on, r.approved_at) <= (t.pay_on, t.approved_at)`;
  const [items, totals] = await Promise.all([
    pool().query<SlipRow>(
      `WITH all_items AS (SELECT i.*, l.id = $3 AS current FROM pay_run_items i JOIN (SELECT l.id, l.revision ${yearToDate}) l ON l.id = i.line_id AND l.revision = i.revision)
       SELECT kind, min(source) AS source, label, coalesce(max(detail) FILTER (WHERE current), '') AS detail, coalesce(sum(amount_cents) FILTER (WHERE current), 0)::float8 AS "amountCents", sum(amount_cents)::float8 AS "ytdCents"
       FROM all_items GROUP BY kind, label ORDER BY array_position(ARRAY['earning', 'pre_tax', 'tax', 'post_tax', 'non_taxed', 'employer'], kind), min(position), label`, [slip.employeeId, slip.runId, id]),
    pool().query<{ gross: number; net: number }>(`SELECT sum(l.gross_cents)::float8 AS gross, sum(l.net_cents)::float8 AS net ${yearToDate}`, [slip.employeeId, slip.runId]),
  ]);
  return { slip, items: items.rows.filter((row) => row.amountCents || row.ytdCents), ytd: totals.rows[0] };
}

export type PayrollCost = { month: string; runs: number; people: number; grossCents: number; employerCents: number; nontaxedCents: number; netCents: number; costCents: number };

// Cost by the month of the pay date. A reversal sits in the same month as the run it reverses, so the pair nets to zero.
export async function payrollCosts(months: number) {
  await requireAdmin();
  const { rows } = await pool().query<PayrollCost>(
    `WITH months AS (SELECT generate_series(date_trunc('month', current_date) - make_interval(months => $1 - 1), date_trunc('month', current_date), interval '1 month')::date AS first)
     SELECT to_char(m.first, 'YYYY-MM-DD') AS month, count(DISTINCT r.id)::int AS runs, count(DISTINCT l.employee_id)::int AS people, coalesce(sum(l.gross_cents), 0)::float8 AS "grossCents", coalesce(sum(l.employer_cents), 0)::float8 AS "employerCents",
     coalesce(sum(l.nontaxed_cents), 0)::float8 AS "nontaxedCents", coalesce(sum(l.net_cents), 0)::float8 AS "netCents", coalesce(sum(l.gross_cents + l.employer_cents + l.nontaxed_cents), 0)::float8 AS "costCents"
     FROM months m LEFT JOIN pay_runs r ON r.state = 'approved' AND r.pay_on >= m.first AND r.pay_on < m.first + interval '1 month' LEFT JOIN pay_run_lines l ON l.pay_run_id = r.id GROUP BY m.first ORDER BY m.first`, [months],
  );
  return rows;
}
