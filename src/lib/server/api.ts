import "server-only";
import { z } from "zod";
import { activityLabels } from "@/lib/activity";
import { eventScope, type Scope } from "@/lib/domains/platform";
import { expenseCategories, workDate } from "@/lib/operations";
import { employmentTypes, statuses } from "@/lib/people";
import { authenticate, claimIdempotencyKey, releaseIdempotencyKey, storeIdempotentResponse, type Authentication, type Caller } from "./api-tokens";
import { pool } from "./db";
import { decideExpense } from "./expenses";
import type { Member } from "./member";
import { createEmployee, saveTeam, updateEmployee } from "./people-mutations";
import { workspaceOrigin } from "./platform-settings";
import { readBody } from "./request";
import { decideTimeOff } from "./time-off";
import { failed, PeopleError } from "./write";

type ErrorCode = "invalid_request" | "unauthorized" | "insufficient_scope" | "not_found" | "method_not_allowed" | "conflict" | "unprocessable" | "payload_too_large" | "unsupported_media_type" | "rate_limited" | "unavailable";
const statusOf: Record<ErrorCode, number> = { invalid_request: 400, unauthorized: 401, insufficient_scope: 403, not_found: 404, method_not_allowed: 405, conflict: 409, unprocessable: 422, payload_too_large: 413, unsupported_media_type: 415, rate_limited: 429, unavailable: 503 };

export class ApiError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
  get status() { return statusOf[this.code]; }
}

export type Operation = {
  name: string; method: "GET" | "POST" | "PATCH"; path: string; scope: Scope; summary: string; input: z.ZodObject; output: z.ZodType; status?: number;
  run: (caller: Caller, input: never) => Promise<unknown>;
};

function operation<Input extends z.ZodObject, Output extends z.ZodType>(definition: Omit<Operation, "input" | "output" | "run"> & { input: Input; output: Output; run: (caller: Caller, input: z.infer<Input>) => Promise<z.infer<Output>> }): Operation {
  return definition as unknown as Operation;
}

const id = z.uuid();
const page = { limit: z.coerce.number().int().min(1).max(100).default(50).describe("How many to return, up to 100."), cursor: z.string().max(200).optional().describe("The next_cursor from the previous page.") };
const reference = z.object({ id, name: z.string() }).nullable();
const isoTime = z.iso.datetime();
const list = <Item extends z.ZodType>(item: Item) => z.object({ data: z.array(item), next_cursor: z.string().nullable() });
const requestStates = z.enum(["pending", "approved", "declined", "cancelled", "reimbursed"]);

const person = z.object({
  id, first_name: z.string(), last_name: z.string(), email: z.string(), title: z.string(), team: reference, manager: reference,
  employment_type: z.enum(employmentTypes), status: z.enum(statuses), start_date: z.iso.date(), last_day: z.iso.date().nullable(), location: z.string(), version: z.int(),
});
const team = z.object({ id, name: z.string(), people: z.int(), version: z.int() });
const timeOff = z.object({
  id, employee_id: id, starts_on: z.iso.date(), ends_on: z.iso.date(), days: z.number(), half_day: z.boolean(), state: requestStates,
  type: z.string().nullable().describe("null without personal:read"), note: z.string().nullable().describe("null without personal:read"), created_at: isoTime,
});
const expense = z.object({
  id, employee_id: id, spent_on: z.iso.date(), merchant: z.string(), category: z.enum(expenseCategories), amount_cents: z.int(), currency: z.string(), state: requestStates,
  note: z.string().nullable().describe("null without personal:read"), created_at: isoTime,
});
const payAmounts = {
  gross_cents: z.int(), pre_tax_cents: z.int(), tax_cents: z.int(), post_tax_cents: z.int(), nontaxed_cents: z.int().describe("Reimbursements and other payments that aren’t taxed."), employer_cents: z.int(),
  net_cents: z.int().describe("What people are paid, including nontaxed_cents."), total_cents: z.int().describe("The same as net_cents."),
};
const payRun = z.object({
  id, kind: z.string(), reverses_id: id.nullable().describe("The run this one reverses. A reversal’s amounts are negative."), period_start: z.iso.date(), period_end: z.iso.date(), pay_on: z.iso.date(),
  schedule: z.string(), currency: z.string(), state: z.string(), people: z.int(), ...payAmounts,
});
const payLine = z.object({
  employee_id: id, basis: z.string(), rate_cents: z.int(), hours: z.number().nullable(), overtime_hours: z.number().nullable(), base_cents: z.int(), overtime_cents: z.int(), earnings_cents: z.int(), adjustment_cents: z.int(), reimbursement_cents: z.int(), ...payAmounts,
});
const document = z.object({ id, name: z.string(), category: z.string(), media_type: z.string(), size_bytes: z.int(), employee_id: id.nullable(), needs_acknowledgement: z.boolean(), created_at: isoTime });
const activity = z.object({ id: z.string(), event: z.string(), employee_id: id.nullable(), detail: z.string(), actor: z.string().nullable(), created_at: isoTime });

const personColumns = `e.id, e.first_name, e.last_name, e.email, e.title, CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object('id', t.id, 'name', t.name) END AS team,
  CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object('id', m.id, 'name', concat_ws(' ', m.first_name, m.last_name)) END AS manager,
  e.employment_type, e.status, to_char(e.hire_date, 'YYYY-MM-DD') AS start_date, to_char(e.last_day, 'YYYY-MM-DD') AS last_day, e.location, e.version`;
const personFrom = "FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN employees m ON m.id = e.manager_id";
const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const encodeCursor = (value: string) => Buffer.from(value).toString("base64url");
function decodeCursor(cursor: string | undefined, pattern: RegExp) {
  if (cursor === undefined) return null;
  const value = Buffer.from(cursor, "base64url").toString();
  if (!pattern.test(value)) throw new ApiError("invalid_request", "The cursor isn’t valid.");
  return value;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Pages follow the id, which never changes, so nothing is skipped or repeated while records change.
async function pageOf<Row extends { id: string }>(input: { limit: number; cursor?: string }, pattern: RegExp, query: (after: string | null, limit: number) => Promise<Row[]>) {
  const rows = await query(decodeCursor(input.cursor, pattern), input.limit + 1);
  const data = rows.slice(0, input.limit);
  return { data, next_cursor: rows.length > input.limit ? encodeCursor(data.at(-1)!.id) : null };
}

async function readPerson(personId: string) {
  const { rows } = await pool().query<z.infer<typeof person>>(`SELECT ${personColumns} ${personFrom} WHERE e.id = $1`, [personId]);
  if (!rows[0]) throw new ApiError("not_found", "No person has this id.");
  return rows[0];
}

// The token is recorded in the transaction that makes the change. Once that may have been saved, the call can’t be repeated safely.
async function change<Result>(caller: Caller, name: string, run: (member: Member) => Promise<Result>) {
  caller.progress = "unknown";
  try {
    return await run({ ...caller.member, via: `${caller.tokenName}: ${name}` });
  } catch (error) {
    if (nothingSaved(error)) caller.progress = "none";
    throw error;
  }
}

// PostgreSQL rolled the change back, or it was never reached. A connection lost part-way is neither, because the commit may have gone through.
function nothingSaved(error: unknown) {
  if (error instanceof PeopleError || error instanceof ApiError) return true;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  return /^[0-9A-Z]{5}$/.test(code) && !/^(08|57P|40003)/.test(code) || code === "ECONNREFUSED" || code === "ENOTFOUND";
}

function visibleEvents(caller: Caller) {
  return Object.keys(activityLabels).filter((event) => {
    const scope = eventScope(event);
    return !scope || caller.scopes.has(scope);
  });
}

const personalFields = (caller: Caller) => caller.scopes.has("personal:read");
const timeOffColumns = `r.id, r.employee_id, to_char(r.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(r.ends_on, 'YYYY-MM-DD') AS ends_on, r.days::float8 AS days, r.half_day, r.state,
  CASE WHEN $1 THEN t.name END AS type, CASE WHEN $1 THEN r.note END AS note, ${utc("r.created_at")} AS created_at`;
const timeOffFrom = "FROM time_off_requests r JOIN time_off_types t ON t.id = r.type_id";
const expenseColumns = `x.id, x.employee_id, to_char(x.spent_on, 'YYYY-MM-DD') AS spent_on, x.merchant, x.category, x.amount_cents::float8 AS amount_cents, x.currency, x.state, CASE WHEN $1 THEN x.note END AS note, ${utc("x.created_at")} AS created_at`;
const payColumns = `r.id, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end, to_char(r.pay_on, 'YYYY-MM-DD') AS pay_on, r.schedule, r.currency, r.state, r.kind, r.reverses_id, l.*`;
const payColumnNames = ["gross", "pre_tax", "tax", "post_tax", "nontaxed", "employer", "net"];
const payFrom = `FROM pay_runs r CROSS JOIN LATERAL (SELECT count(*)::int AS people, ${payColumnNames.map((name) => `coalesce(sum(${name}_cents), 0)::float8 AS ${name}_cents`).join(", ")}, coalesce(sum(net_cents), 0)::float8 AS total_cents FROM pay_run_lines WHERE pay_run_id = r.id) l`;

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const decision = { id, decision: z.enum(["approved", "declined"]) };
const personInput = {
  first_name: text(80), last_name: text(80), email, title: text(120), team_id: id.nullable(), manager_id: id.nullable(), employment_type: z.enum(employmentTypes), start_date: workDate, location: z.string().trim().max(100),
};

export const operations: Operation[] = [
  operation({
    name: "people_list", method: "GET", path: "/people", scope: "people:read", summary: "List people",
    input: z.strictObject({ ...page, status: z.enum(statuses).optional().describe("Leave out for everyone who isn’t archived."), team_id: id.optional(), query: z.string().trim().max(120).optional().describe("Text in a name, email or title.") }),
    output: list(person),
    run: (_caller, input) => pageOf(input, uuidPattern, async (after, limit) => (await pool().query<z.infer<typeof person>>(
      `SELECT ${personColumns} ${personFrom} WHERE ($1::uuid IS NULL OR e.id > $1) AND ($2::text IS NULL AND e.status <> 'archived' OR e.status = $2) AND ($3::uuid IS NULL OR e.team_id = $3)
       AND ($4 = '' OR strpos(lower(concat_ws(' ', e.first_name, e.last_name, e.email, e.title)), lower($4)) > 0) ORDER BY e.id LIMIT $5`, [after, input.status ?? null, input.team_id ?? null, input.query ?? "", limit],
    )).rows),
  }),
  operation({ name: "people_get", method: "GET", path: "/people/{id}", scope: "people:read", summary: "Get a person", input: z.strictObject({ id }), output: person, run: (_caller, input) => readPerson(input.id) }),
  operation({
    name: "people_create", method: "POST", path: "/people", scope: "people:write", summary: "Add a person", status: 201,
    input: z.strictObject({ ...personInput, team_id: personInput.team_id.default(null), manager_id: personInput.manager_id.default(null), location: personInput.location.default(""), status: z.enum(["onboarding", "active"]).default("onboarding") }),
    output: person,
    run: async (caller, input) => {
      const created = await change(caller, "people_create", (member) => createEmployee(member, {
        firstName: input.first_name, lastName: input.last_name, email: input.email, title: input.title, teamId: input.team_id, managerId: input.manager_id, employmentType: input.employment_type, hireDate: input.start_date, location: input.location, initialStatus: input.status,
      }));
      return readPerson(created);
    },
  }),
  operation({
    name: "people_update", method: "PATCH", path: "/people/{id}", scope: "people:write", summary: "Change a person",
    input: z.strictObject({ id, version: z.number().int().min(1).describe("The version you last read. A change in between is refused."), ...z.object(personInput).partial().shape, last_day: workDate.optional().describe("Only while offboarding.") }),
    output: person,
    run: async (caller, input) => {
      const current = await readPerson(input.id);
      const { id: personId, version, team_id: teamId = current.team?.id ?? null, manager_id: managerId = current.manager?.id ?? null } = input;
      await change(caller, "people_update", (member) => updateEmployee(member, {
        id: personId, version, teamId, managerId, firstName: input.first_name ?? current.first_name, lastName: input.last_name ?? current.last_name, email: input.email ?? current.email, title: input.title ?? current.title,
        employmentType: input.employment_type ?? current.employment_type, hireDate: input.start_date ?? current.start_date, location: input.location ?? current.location, lastDay: input.last_day ?? current.last_day,
      }));
      return readPerson(personId);
    },
  }),
  operation({
    name: "teams_list", method: "GET", path: "/teams", scope: "teams:read", summary: "List teams", input: z.strictObject(page), output: list(team),
    run: (_caller, input) => pageOf(input, uuidPattern, async (after, limit) => (await pool().query<z.infer<typeof team>>(
      `SELECT t.id, t.name, count(e.id)::int AS people, t.version FROM teams t LEFT JOIN employees e ON e.team_id = t.id AND e.status <> 'archived' WHERE t.archived_at IS NULL AND ($1::uuid IS NULL OR t.id > $1) GROUP BY t.id ORDER BY t.id LIMIT $2`, [after, limit],
    )).rows),
  }),
  operation({
    name: "teams_create", method: "POST", path: "/teams", scope: "teams:write", summary: "Add a team", status: 201, input: z.strictObject({ name: text(80) }), output: team,
    run: async (caller, input) => {
      const created = await change(caller, "teams_create", (member) => saveTeam(member, input.name));
      return { id: created, name: input.name, people: 0, version: 1 };
    },
  }),
  operation({
    name: "time_off_list", method: "GET", path: "/time-off", scope: "time_off:read", summary: "List time off requests",
    input: z.strictObject({ ...page, state: z.enum(["pending", "approved", "declined", "cancelled"]).optional(), employee_id: id.optional(), from: workDate.optional().describe("Requests that end on or after this date."), to: workDate.optional().describe("Requests that start on or before this date.") }),
    output: list(timeOff),
    run: (caller, input) => pageOf(input, uuidPattern, async (after, limit) => (await pool().query<z.infer<typeof timeOff>>(
      `SELECT ${timeOffColumns} ${timeOffFrom} WHERE ($2::uuid IS NULL OR r.id > $2) AND ($3::text IS NULL OR r.state = $3) AND ($4::uuid IS NULL OR r.employee_id = $4) AND ($5::date IS NULL OR r.ends_on >= $5) AND ($6::date IS NULL OR r.starts_on <= $6) ORDER BY r.id LIMIT $7`,
      [personalFields(caller), after, input.state ?? null, input.employee_id ?? null, input.from ?? null, input.to ?? null, limit],
    )).rows),
  }),
  operation({
    name: "time_off_decide", method: "POST", path: "/time-off/{id}/decision", scope: "time_off:write", summary: "Approve or decline time off", input: z.strictObject(decision), output: timeOff,
    run: async (caller, input) => {
      const read = async () => (await pool().query<z.infer<typeof timeOff>>(`SELECT ${timeOffColumns} ${timeOffFrom} WHERE r.id = $2`, [personalFields(caller), input.id])).rows[0];
      const before = await read();
      if (!before) throw new ApiError("not_found", "No request has this id.");
      await change(caller, "time_off_decide", (member) => decideTimeOff(member, input));
      return read();
    },
  }),
  operation({
    name: "expenses_list", method: "GET", path: "/expenses", scope: "expenses:read", summary: "List expenses", input: z.strictObject({ ...page, state: requestStates.optional(), employee_id: id.optional() }), output: list(expense),
    run: (caller, input) => pageOf(input, uuidPattern, async (after, limit) => (await pool().query<z.infer<typeof expense>>(
      `SELECT ${expenseColumns} FROM expenses x WHERE ($2::uuid IS NULL OR x.id > $2) AND ($3::text IS NULL OR x.state = $3) AND ($4::uuid IS NULL OR x.employee_id = $4) ORDER BY x.id LIMIT $5`,
      [personalFields(caller), after, input.state ?? null, input.employee_id ?? null, limit],
    )).rows),
  }),
  operation({
    name: "expenses_decide", method: "POST", path: "/expenses/{id}/decision", scope: "expenses:write", summary: "Approve or decline an expense", input: z.strictObject(decision), output: expense,
    run: async (caller, input) => {
      const read = async () => (await pool().query<z.infer<typeof expense>>(`SELECT ${expenseColumns} FROM expenses x WHERE x.id = $2`, [personalFields(caller), input.id])).rows[0];
      const before = await read();
      if (!before) throw new ApiError("not_found", "No expense has this id.");
      await change(caller, "expenses_decide", (member) => decideExpense(member, input));
      return read();
    },
  }),
  operation({
    name: "pay_runs_list", method: "GET", path: "/pay-runs", scope: "pay:read", summary: "List pay runs", input: z.strictObject(page), output: list(payRun),
    run: (_caller, input) => pageOf(input, uuidPattern, async (after, limit) => (await pool().query<z.infer<typeof payRun>>(`SELECT ${payColumns} ${payFrom} WHERE ($1::uuid IS NULL OR r.id > $1) ORDER BY r.id LIMIT $2`, [after, limit])).rows),
  }),
  operation({
    name: "pay_runs_get", method: "GET", path: "/pay-runs/{id}", scope: "pay:read", summary: "Get a pay run with its lines", input: z.strictObject({ id }), output: payRun.extend({ lines: z.array(payLine) }),
    run: async (_caller, input) => {
      const { rows } = await pool().query<z.infer<typeof payRun>>(`SELECT ${payColumns} ${payFrom} WHERE r.id = $1`, [input.id]);
      if (!rows[0]) throw new ApiError("not_found", "No pay run has this id.");
      const { rows: lines } = await pool().query<z.infer<typeof payLine>>(
        `SELECT employee_id, basis, rate_cents::float8 AS rate_cents, hours::float8 AS hours, overtime_hours::float8 AS overtime_hours, ${["base", "overtime", "earnings", "adjustment", "reimbursement", ...payColumnNames].map((name) => `${name}_cents::float8 AS ${name}_cents`).join(", ")},
         net_cents::float8 AS total_cents FROM pay_run_lines WHERE pay_run_id = $1 ORDER BY employee_id`, [input.id],
      );
      return { ...rows[0], lines };
    },
  }),
  operation({
    name: "documents_list", method: "GET", path: "/documents", scope: "documents:read", summary: "List document details. Without personal:read, only company documents are returned.",
    input: z.strictObject({ ...page, employee_id: id.optional() }), output: list(document),
    run: (caller, input) => pageOf(input, uuidPattern, async (after, limit) => (await pool().query<z.infer<typeof document>>(
      `SELECT d.id, d.name, d.category, d.media_type, d.size_bytes, d.employee_id, d.needs_acknowledgement, ${utc("d.created_at")} AS created_at FROM documents d
       WHERE d.archived_at IS NULL AND d.category <> 'receipt' AND ($1 OR d.employee_id IS NULL) AND ($2::uuid IS NULL OR d.id > $2) AND ($3::uuid IS NULL OR d.employee_id = $3) ORDER BY d.id LIMIT $4`, [personalFields(caller), after, input.employee_id ?? null, limit],
    )).rows),
  }),
  operation({
    name: "activity_list", method: "GET", path: "/activity", scope: "activity:read", summary: "List activity, newest first. Events about pay, benefits, personal details, documents, time and expenses also need the scope for that data.", input: z.strictObject({ ...page, event: z.string().max(81).optional(), employee_id: id.optional() }), output: list(activity),
    run: (caller, input) => pageOf(input, /^[1-9]\d{0,17}$/, async (after, limit) => (await pool().query<z.infer<typeof activity>>(
      `SELECT a.id::text, a.event, a.employee_id, a.detail, u.name AS actor, ${utc("a.created_at")} AS created_at FROM activity_log a LEFT JOIN "user" u ON u.id = a.actor_id
       WHERE ($1::bigint IS NULL OR a.id < $1) AND ($2::text IS NULL OR a.event = $2) AND ($3::uuid IS NULL OR a.employee_id = $3) AND a.event = ANY($5::text[]) ORDER BY a.id DESC LIMIT $4`, [after, input.event ?? null, input.employee_id ?? null, limit, visibleEvents(caller)],
    )).rows),
  }),
];

// Every caller of an operation comes through here, so scopes and input are checked in one place.
export async function execute(caller: Caller, entry: Operation, input: unknown) {
  if (!caller.scopes.has(entry.scope)) throw new ApiError("insufficient_scope", `This token needs the ${entry.scope} scope.`);
  const parsed = entry.input.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError("invalid_request", `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`);
  }
  try {
    return await entry.run(caller, parsed.data as never);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof PeopleError) throw new ApiError(/changed while/.test(error.message) ? "conflict" : "unprocessable", error.message);
    const code = typeof error === "object" && error && "code" in error ? error.code : "";
    const message = failed(error).error ?? "";
    throw code === "23505" || code === "23503" ? new ApiError("conflict", message) : new ApiError("unavailable", "The workspace couldn’t complete this. Try again shortly.");
  }
}

const baseHeaders = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

export function errorResponse(error: ApiError, headers: Record<string, string> = {}) {
  return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { ...baseHeaders, ...headers } });
}

export function refusalResponse(refusal: Exclude<Authentication, { caller: Caller }>) {
  return refusal.refused === "rate_limited" ? errorResponse(new ApiError("rate_limited", "Too many requests. Slow down and try again."), { "Retry-After": String(refusal.wait) })
    : errorResponse(new ApiError("unauthorized", "Send a valid API token as a bearer token."), { "WWW-Authenticate": 'Bearer realm="OpenWarp"' });
}

export async function readJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApiError("unsupported_media_type", "Send the body as application/json.");
  const body = await readBody(request, 65_536);
  if (body === null) throw new ApiError("payload_too_large", "Send a body of 64 KB or less.");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError("invalid_request", "The body isn’t valid JSON.");
  }
}

function match(path: string, segments: string[]) {
  const pattern = path.slice(1).split("/");
  if (pattern.length !== segments.length) return null;
  const values: Record<string, string> = {};
  for (const [index, part] of pattern.entries()) {
    if (part.startsWith("{")) values[part.slice(1, -1)] = segments[index];
    else if (part !== segments[index]) return null;
  }
  return values;
}

export async function handleApi(request: Request, segments: string[]) {
  let pending: { caller: Caller; key: string } | null = null;
  try {
    const authentication = await authenticate(request);
    if ("refused" in authentication) return refusalResponse(authentication);
    const { caller } = authentication;
    const matches = operations.flatMap((entry) => {
      const values = match(entry.path, segments);
      return values ? [{ entry, values }] : [];
    });
    if (!matches.length) throw new ApiError("not_found", "There is no such resource.");
    const found = matches.find(({ entry }) => entry.method === request.method);
    if (!found) return errorResponse(new ApiError("method_not_allowed", "This resource doesn’t support that method."), { Allow: matches.map(({ entry }) => entry.method).join(", ") });
    const { entry, values } = found;

    let input: Record<string, unknown> = {};
    if (entry.method === "GET") {
      const query = new URL(request.url).searchParams;
      if (new Set(query.keys()).size !== [...query.keys()].length) throw new ApiError("invalid_request", "Send each query parameter once.");
      input = Object.fromEntries(query);
    } else {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("invalid_request", "Send a JSON object.");
      input = { ...body };
    }
    if (Object.keys(values).some((name) => name in input)) throw new ApiError("invalid_request", "Send the id in the path only.");

    const key = entry.method === "POST" ? request.headers.get("idempotency-key") : null;
    if (key !== null) {
      if (!/^[\x21-\x7e]{1,200}$/.test(key)) throw new ApiError("invalid_request", "Idempotency-Key must be 1 to 200 visible characters.");
      if (!caller.scopes.has(entry.scope)) throw new ApiError("insufficient_scope", `This token needs the ${entry.scope} scope.`);
      const claim = await claimIdempotencyKey(caller, key, JSON.stringify([entry.name, values, input]));
      if (claim.state === "mismatch") throw new ApiError("unprocessable", "This Idempotency-Key was used for a different request.");
      if (claim.state === "running") throw new ApiError("conflict", "A request with this Idempotency-Key is still running, or ended without a known result. Check the record before you send it with a new key.");
      if (claim.state === "done") return new Response(claim.response, { status: claim.status, headers: { ...baseHeaders, "Idempotency-Replayed": "true" } });
      pending = { caller, key };
    }
    const body = JSON.stringify(await execute(caller, entry, { ...input, ...values }));
    const status = entry.status ?? 200;
    if (pending) await storeIdempotentResponse(caller, pending.key, status, body);
    return new Response(body, { status, headers: baseHeaders });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError("unavailable", "The API is unavailable right now.");
    if (!(error instanceof ApiError)) console.error("OpenWarp API request failed", error instanceof Error ? error.name : "unknown");
    const response = errorResponse(apiError);
    // A refusal is remembered. A failure is forgotten when nothing was saved, and otherwise keeps the key, so a retry can’t repeat a change.
    if (pending && apiError.status < 500) await storeIdempotentResponse(pending.caller, pending.key, apiError.status, await response.clone().text()).catch(() => undefined);
    else if (pending?.caller.progress === "none") await releaseIdempotencyKey(pending.caller, pending.key).catch(() => undefined);
    return response;
  }
}

function jsonSchema(schema: z.ZodType, io: "input" | "output") {
  return Object.fromEntries(Object.entries(z.toJSONSchema(schema, { io, unrepresentable: "any" })).filter(([name]) => name !== "$schema"));
}

export const inputSchema = (entry: Operation) => jsonSchema(entry.input, "input");

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const entry of operations) {
    const schema = inputSchema(entry) as { properties?: Record<string, object>; required?: string[] };
    const names = [...entry.path.matchAll(/\{(\w+)\}/g)].map((found) => found[1]);
    const properties = Object.entries(schema.properties ?? {});
    const parameters = properties.filter(([name]) => names.includes(name) || entry.method === "GET").map(([name, value]) => ({ name, in: names.includes(name) ? "path" : "query", required: names.includes(name), schema: value }));
    const body = properties.filter(([name]) => !names.includes(name));
    (paths[entry.path] ??= {})[entry.method.toLowerCase()] = {
      operationId: entry.name, summary: entry.summary, description: `Scope: ${entry.scope}`,
      parameters: [...parameters, ...(entry.method === "POST" ? [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 } }] : [])],
      ...(entry.method === "GET" ? {} : { requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(body), required: (schema.required ?? []).filter((name) => !names.includes(name)), additionalProperties: false } } } } }),
      responses: { [entry.status ?? 200]: { description: "Success", content: { "application/json": { schema: jsonSchema(entry.output, "output") } } }, default: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
    };
  }
  return {
    openapi: "3.1.0", info: { title: "OpenWarp API", version: "1", description: "Money is in integer cents. Times are in UTC." }, servers: [{ url: `${workspaceOrigin()}/api/v1` }], security: [{ token: [] }], paths,
    components: { securitySchemes: { token: { type: "http", scheme: "bearer" } }, schemas: { Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string", enum: Object.keys(statusOf) }, message: { type: "string" } } } } } } },
  };
}

// Model Context Protocol over HTTP. Each call stands alone, so there is no session to resume and nothing to stream.
export const protocolVersions = ["2025-06-18", "2025-03-26"];
type RpcId = string | number | null;
const rpcFields = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string().max(200), z.number()]).optional(), method: z.string().max(100), params: z.record(z.string(), z.unknown()).optional() });
const callFields = z.object({ name: z.string().max(100), arguments: z.record(z.string(), z.unknown()).default({}) });

const rpc = (rpcId: RpcId, body: { result: unknown } | { error: { code: number; message: string } }, status = 200) => Response.json({ jsonrpc: "2.0", id: rpcId, ...body }, { status, headers: baseHeaders });

export async function handleMcp(request: Request) {
  // Browsers send Origin. Refusing other origins keeps a web page from reaching the server through DNS rebinding.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== workspaceOrigin()) return new Response(null, { status: 403, headers: baseHeaders });
  try {
    const authentication = await authenticate(request);
    if ("refused" in authentication) return refusalResponse(authentication);
    const { caller } = authentication;
    const version = request.headers.get("mcp-protocol-version");
    if (version !== null && !protocolVersions.includes(version)) return rpc(null, { error: { code: -32600, message: "Unsupported protocol version." } }, 400);
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      return rpc(null, { error: { code: -32700, message: error instanceof ApiError ? error.message : "Parse error." } }, error instanceof ApiError ? error.status : 400);
    }
    const message = rpcFields.safeParse(body);
    if (!message.success) return rpc(null, { error: { code: -32600, message: "Send one JSON-RPC 2.0 message." } }, 400);
    const { id: rpcId, method, params } = message.data;
    if (rpcId === undefined) return new Response(null, { status: 202, headers: { "Cache-Control": "private, no-store" } });

    if (method === "initialize") {
      const requested = z.object({ protocolVersion: z.string() }).safeParse(params);
      return rpc(rpcId, { result: { protocolVersion: requested.success && protocolVersions.includes(requested.data.protocolVersion) ? requested.data.protocolVersion : protocolVersions[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "openwarp", title: "OpenWarp", version: "1" } } });
    }
    if (method === "ping") return rpc(rpcId, { result: {} });
    const available = operations.filter((entry) => caller.scopes.has(entry.scope));
    if (method === "tools/list") return rpc(rpcId, { result: { tools: available.map((entry) => ({ name: entry.name, title: entry.summary.split(".")[0], description: entry.summary, inputSchema: inputSchema(entry), annotations: { readOnlyHint: entry.method === "GET", destructiveHint: entry.method !== "GET", idempotentHint: entry.method === "GET", openWorldHint: false } })) } });
    if (method === "tools/call") {
      const call = callFields.safeParse(params);
      const entry = call.success ? available.find((candidate) => candidate.name === call.data.name) : undefined;
      if (!call.success || !entry) return rpc(rpcId, { error: { code: -32602, message: "Unknown tool, or this token doesn’t have its scope." } });
      try {
        const result = await execute(caller, entry, call.data.arguments);
        return rpc(rpcId, { result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false } });
      } catch (error) {
        return rpc(rpcId, { result: { content: [{ type: "text", text: error instanceof ApiError ? error.message : "The tool failed." }], isError: true } });
      }
    }
    return rpc(rpcId, { error: { code: -32601, message: "Method not found." } });
  } catch (error) {
    console.error("OpenWarp MCP request failed", error instanceof Error ? error.name : "unknown");
    return errorResponse(new ApiError("unavailable", "The API is unavailable right now."));
  }
}
