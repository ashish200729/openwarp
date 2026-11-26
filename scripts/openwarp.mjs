#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const usage = `Usage: openwarp <resource> <action> [id] [options]

  people list [--status <status>] [--team_id <id>] [--query <text>]
  people get <id>
  people create --data <json> | --data @file.json
  people update <id> --data <json>
  teams list | teams create --data <json>
  time-off list [--state <state>] [--employee_id <id>] [--from <date>] [--to <date>]
  time-off decide <id> --decision <approved|declined>
  expenses list [--state <state>] [--employee_id <id>]
  expenses decide <id> --decision <approved|declined>
  pay-runs list | pay-runs get <id>
  documents list [--employee_id <id>]
  activity list [--event <event>] [--employee_id <id>]

Lists also take --limit <1-100>, --cursor <cursor> and --all. Creates and decisions take --idempotency-key <key>.
Set OPENWARP_URL to the workspace address and OPENWARP_TOKEN to an API token.`;

const actions = { people: ["list", "get", "create", "update"], teams: ["list", "create"], "time-off": ["list", "decide"], expenses: ["list", "decide"], "pay-runs": ["list", "get"], documents: ["list"], activity: ["list"] };

function stop(message) {
  console.error(message);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      ...Object.fromEntries(["status", "team_id", "query", "state", "employee_id", "from", "to", "event", "limit", "cursor", "data", "decision", "idempotency-key"].map((name) => [name, { type: "string" }])),
      all: { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  stop(`${error.message}\n\n${usage}`);
}
const { values, positionals: [resource, action, id, ...extra] } = parsed;
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const needsId = ["get", "update", "decide"].includes(action);
if (!Object.hasOwn(actions, resource ?? "") || !actions[resource].includes(action) || extra.length || Boolean(id) !== needsId) stop(usage);
const { OPENWARP_URL: address, OPENWARP_TOKEN: token } = process.env;
if (!address || !token) stop("Set OPENWARP_URL and OPENWARP_TOKEN.");
const base = new URL("/api/v1/", address);
if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) stop("OPENWARP_URL must use https, because the token is sent with every request.");

async function call(method, path, { query = {}, body } = {}) {
  const url = new URL(path, base);
  for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, value);
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (values["idempotency-key"]) headers["Idempotency-Key"] = values["idempotency-key"];
  let response;
  try {
    response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    stop(`The workspace couldn’t be reached: ${error.cause?.code ?? error.name}`);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) stop(result?.error ? `${result.error.code}: ${result.error.message}` : `The workspace answered ${response.status}.`);
  return result;
}

async function data() {
  if (!values.data) stop("Pass --data with a JSON object, or @file.json.");
  try {
    return JSON.parse(values.data.startsWith("@") ? await readFile(values.data.slice(1), "utf8") : values.data);
  } catch (error) {
    stop(`The data couldn’t be read: ${error.message}`);
  }
}

const item = id && `${resource}/${encodeURIComponent(id)}`;
let result;
if (action === "list") {
  const query = Object.fromEntries(["status", "team_id", "query", "state", "employee_id", "from", "to", "event", "limit", "cursor"].map((name) => [name, values[name]]));
  result = await call("GET", resource, { query });
  while (values.all && result.next_cursor) {
    const next = await call("GET", resource, { query: { ...query, cursor: result.next_cursor } });
    result = { data: [...result.data, ...next.data], next_cursor: next.next_cursor };
  }
} else if (action === "get") result = await call("GET", item);
else if (action === "create") result = await call("POST", resource, { body: await data() });
else if (action === "update") result = await call("PATCH", item, { body: await data() });
else result = await call("POST", `${item}/decision`, { body: { decision: values.decision ?? stop("Pass --decision approved or --decision declined.") } });
console.log(JSON.stringify(result, null, 2));
