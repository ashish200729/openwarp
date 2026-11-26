import "server-only";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, isIPv4 } from "node:net";
import type { PoolClient } from "pg";
import type { z } from "zod";
import { activityLabels, type ActivityEvent } from "@/lib/activity";
import { eventScope, type WebhookFormat, type webhookFields } from "@/lib/domains/platform";
import { seal, unseal } from "./crypto";
import { pool, transaction } from "./db";
import type { Member } from "./member";
import { notify } from "./notify";
import { lockActivity, systemAudit, workspaceName, workspaceOrigin } from "./platform-settings";
import { audit, PeopleError, runAsAdmin } from "./write";

export type Webhook = { id: string; name: string; host: string; format: WebhookFormat; events: string[]; state: "active" | "paused" | "disabled"; failures: number; version: number; createdAt: Date };
export type Delivery = { id: string; event: string; state: "pending" | "delivered" | "failed"; attempts: number; responseStatus: number | null; error: string; createdAt: Date; nextAttemptAt: Date };
export type WebhookPayload = { id: string; event: string; time: string; employee_id: string | null; detail: string };

const columns = `id, name, host, format, events, state, failures, version, created_at AS "createdAt"`;
const maxAttempts = 8;
const maxEndpoints = 20;

const refused = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) refused.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) refused.addSubnet(network, prefix, "ipv6");
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

// Everything outside globally routable unicast space is refused, including addresses that embed an IPv4 one.
export function isPublicAddress(address: string) {
  if (isIPv4(address)) return !refused.check(address, "ipv4");
  return isIP(address) === 6 && !address.includes("%") && globalIpv6.check(address, "ipv6") && !refused.check(address, "ipv6");
}

const localDevelopment = (host: string) => process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(host);

export function parseTarget(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PeopleError("Enter a full URL such as https://example.com/hook.");
  }
  if (url.username || url.password) throw new PeopleError("Leave the user name and password out of the URL.");
  if (localDevelopment(url.hostname) && ["http:", "https:"].includes(url.protocol)) return url;
  if (url.protocol !== "https:") throw new PeopleError("Use an https:// URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? !isPublicAddress(host) : !host.includes(".") || /\.(local|localhost|internal|home\.arpa)\.?$/.test(host)) throw new PeopleError("Use a public address. Private and local addresses are refused.");
  return url;
}

async function resolveTarget(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new PeopleError("The host name couldn’t be resolved.");
  }
  if (!addresses.length) throw new PeopleError("The host name couldn’t be resolved.");
  // One private answer is enough to refuse, so a mixed reply can't be used to reach inside.
  if (!localDevelopment(url.hostname) && addresses.some(({ address }) => !isPublicAddress(address))) throw new PeopleError("The host resolves to a private or local address.");
  return addresses[0];
}

export function signPayload(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

// Connects to the address that was checked, sends the original host name, and reads only the status. Redirects are not followed.
export async function post(url: URL, body: string, headers: Record<string, string>) {
  const { address, family } = await resolveTarget(url);
  const secure = url.protocol === "https:";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise<number>((resolve, reject) => {
    const outgoing = (secure ? httpsRequest : httpRequest)({
      host: address, family, port: url.port || (secure ? 443 : 80), path: `${url.pathname}${url.search}`, method: "POST", agent: false, signal: AbortSignal.timeout(10_000),
      ...(secure ? { servername: isIP(host) ? undefined : host } : {}),
      headers: { ...headers, Host: url.host, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "User-Agent": "OpenWarp-Webhooks/1" },
    }, (response) => {
      resolve(response.statusCode ?? 0);
      response.destroy();
    });
    outgoing.on("error", (error: NodeJS.ErrnoException) => reject(new PeopleError(error.name === "AbortError" || error.name === "TimeoutError" ? "The endpoint didn’t answer within 10 seconds." : `The connection failed (${error.code ?? error.name}).`)));
    outgoing.end(body);
  });
}

function requireAdminMember(member: Member) {
  if (member.role !== "admin") throw new PeopleError("Administrator access is required.");
}

export async function listWebhooks(member: Member) {
  requireAdminMember(member);
  const { rows } = await pool().query<Webhook>(`SELECT ${columns} FROM webhook_endpoints ORDER BY lower(name), id`);
  return rows;
}

export async function readWebhook(member: Member, id: string) {
  requireAdminMember(member);
  const { rows } = await pool().query<Webhook>(`SELECT ${columns} FROM webhook_endpoints WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  const { rows: deliveries } = await pool().query<Delivery>(
    `SELECT id, event, state, attempts, response_status AS "responseStatus", error, created_at AS "createdAt", next_attempt_at AS "nextAttemptAt" FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at DESC, id LIMIT 50`, [id],
  );
  return { webhook: rows[0], deliveries };
}

function checkedEvents(events: string[]) {
  const unknown = events.find((event) => !(event in activityLabels));
  if (unknown) throw new PeopleError(`${unknown} isn’t an event.`);
  return [...new Set(events)];
}

const newSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

// Returns the signing secret once, for a new endpoint only.
export function saveWebhook(member: Member, input: z.infer<typeof webhookFields>) {
  const url = input.url || !input.id ? parseTarget(input.url) : null;
  const events = checkedEvents(input.events);
  return runAsAdmin(member, async (client) => {
    if (input.id) {
      const { rowCount } = await client.query(
        `UPDATE webhook_endpoints SET name = $2, host = coalesce($3, host), url = coalesce($4, url), format = $5, events = $6, version = version + 1 WHERE id = $1 AND version = $7`,
        [input.id, input.name, url?.host ?? null, url ? seal(url.href, `webhook-url:${input.id}`) : null, input.format, events, input.version],
      );
      if (!rowCount) throw new PeopleError("This webhook changed while you were editing. Reload and try again.");
      await audit(client, member, "webhook.updated", { detail: input.name });
      return null;
    }
    const { rows } = await client.query<{ total: number }>("SELECT count(*)::int AS total FROM webhook_endpoints");
    if (rows[0].total >= maxEndpoints) throw new PeopleError(`A workspace can have ${maxEndpoints} webhooks. Delete one first.`);
    const id = randomUUID();
    const secret = newSecret();
    await client.query("INSERT INTO webhook_endpoints (id, name, host, url, secret, format, events, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, input.name, url!.host, seal(url!.href, `webhook-url:${id}`), seal(secret, `webhook-secret:${id}`), input.format, events, member.id]);
    await audit(client, member, "webhook.created", { detail: input.name });
    return { id, secret };
  });
}

export function replaceSecret(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const secret = newSecret();
    const { rows } = await client.query<{ name: string }>("UPDATE webhook_endpoints SET secret = $2, version = version + 1 WHERE id = $1 RETURNING name", [id, seal(secret, `webhook-secret:${id}`)]);
    if (!rows[0]) throw new PeopleError("This webhook could not be found.");
    await audit(client, member, "webhook.updated", { detail: `${rows[0].name}: new signing secret` });
    return secret;
  });
}

export function commandWebhook(member: Member, input: { id: string; operation: "pause" | "activate" | "delete" | "test" }) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ name: string; state: string }>("SELECT name, state FROM webhook_endpoints WHERE id = $1 FOR UPDATE", [input.id]);
    if (!rows[0]) throw new PeopleError("This webhook could not be found.");
    const { name, state } = rows[0];
    if (input.operation === "delete") {
      await client.query("DELETE FROM webhook_endpoints WHERE id = $1", [input.id]);
      await audit(client, member, "webhook.deleted", { detail: name });
    } else if (input.operation === "test") {
      if (state !== "active") throw new PeopleError("Turn the webhook on before sending a test.");
      await queueDelivery(client, input.id, { id: randomUUID(), event: "webhook.tested", time: new Date().toISOString(), employee_id: null, detail: `Test from ${workspaceName()}` });
    } else {
      await client.query("UPDATE webhook_endpoints SET state = $2, failures = 0, version = version + 1 WHERE id = $1", [input.id, input.operation === "pause" ? "paused" : "active"]);
      await audit(client, member, "webhook.updated", { detail: `${name}: ${input.operation === "pause" ? "paused" : "turned on"}` });
    }
  });
}

export function resendDelivery(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE webhook_deliveries d SET state = 'pending', attempts = 0, next_attempt_at = now(), error = '', response_status = NULL, delivered_at = NULL FROM webhook_endpoints e WHERE d.id = $1 AND e.id = d.endpoint_id AND e.state = 'active' AND d.state <> 'pending'`, [id],
    );
    if (!rowCount) throw new PeopleError("This delivery is already waiting, or its webhook is off.");
  });
}

export async function queueDelivery(client: PoolClient, endpointId: string, payload: WebhookPayload, activityId: string | null = null) {
  const { rowCount } = await client.query("INSERT INTO webhook_deliveries (endpoint_id, activity_id, event, payload) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [endpointId, activityId, payload.event, payload]);
  return Boolean(rowCount);
}

type ActivityRow = { id: string; event: string; employeeId: string | null; detail: string; at: Date };

// Reads what happened since the last pass and moves the position, all while nothing else can write activity.
export async function readActivity(client: PoolClient, consumer: "webhooks" | "routines") {
  await lockActivity(client);
  const { rows } = await client.query<ActivityRow>(
    `SELECT id::text, event, employee_id AS "employeeId", detail, created_at AS at FROM activity_log WHERE id > (SELECT position FROM activity_cursors WHERE consumer = $1) ORDER BY activity_log.id LIMIT 200`, [consumer],
  );
  if (rows.length) await client.query("UPDATE activity_cursors SET position = $2 WHERE consumer = $1", [consumer, rows.at(-1)!.id]);
  return rows;
}

async function queueEvents() {
  for (let batch = 0; batch < 10; batch += 1) {
    const count = await transaction(async (client) => {
      const activity = await readActivity(client, "webhooks");
      if (!activity.length) return 0;
      const { rows: endpoints } = await client.query<{ id: string; events: string[]; createdAt: Date }>(`SELECT id, events, created_at AS "createdAt" FROM webhook_endpoints`);
      for (const endpoint of endpoints) for (const row of activity) {
        // Anything sensitive is sent only where an administrator chose that event by name.
        if (row.at >= endpoint.createdAt && (endpoint.events.length ? endpoint.events.includes(row.event) : !eventScope(row.event))) {
          await queueDelivery(client, endpoint.id, { id: row.id, event: row.event, time: row.at.toISOString(), employee_id: row.employeeId, detail: row.detail }, row.id);
        }
      }
      return activity.length;
    });
    if (count < 200) return;
  }
}

export function slackText(payload: WebhookPayload) {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const label = payload.event in activityLabels ? activityLabels[payload.event as ActivityEvent] : "";
  const text = [label, payload.detail].filter(Boolean).map(escape).join(": ") || payload.event;
  return JSON.stringify({ text: `${text}${payload.employee_id ? `\n<${workspaceOrigin()}/workspace/people/${payload.employee_id}|Open profile>` : ""}` });
}

type Claimed = { id: string; endpointId: string; payload: WebhookPayload; attempts: number; url: Buffer; secret: Buffer; format: WebhookFormat; name: string };

async function attempt(delivery: Claimed) {
  let status: number | null = null;
  let error = "";
  try {
    const url = parseTarget(unseal(delivery.url, `webhook-url:${delivery.endpointId}`));
    const body = delivery.format === "slack" ? slackText(delivery.payload) : JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(unseal(delivery.secret, `webhook-secret:${delivery.endpointId}`), timestamp, body);
    status = await post(url, body, { "OpenWarp-Signature": `t=${timestamp},v1=${signature}`, "OpenWarp-Event": delivery.payload.event, "OpenWarp-Delivery": delivery.id });
    if (status < 200 || status > 299) error = status >= 300 && status < 400 ? "The endpoint answered with a redirect." : `The endpoint answered ${status}.`;
  } catch (cause) {
    error = cause instanceof PeopleError ? cause.message : "The delivery failed.";
  }
  await transaction(async (client) => {
    await lockActivity(client);
    const exhausted = Boolean(error) && delivery.attempts >= maxAttempts;
    await client.query(
      `UPDATE webhook_deliveries SET state = $2, response_status = $3, error = $4, delivered_at = CASE WHEN $2 = 'delivered' THEN now() END, next_attempt_at = now() + make_interval(secs => $5) WHERE id = $1`,
      [delivery.id, !error ? "delivered" : exhausted ? "failed" : "pending", status && status >= 100 && status <= 599 ? status : null, error.slice(0, 300), Math.min(60 * 3 ** (delivery.attempts - 1), 43_200)],
    );
    const { rows } = await client.query<{ failures: number; state: string }>("UPDATE webhook_endpoints SET failures = CASE WHEN $2 THEN failures + 1 ELSE 0 END WHERE id = $1 RETURNING failures, state", [delivery.endpointId, Boolean(error)]);
    if (!exhausted || rows[0]?.state !== "active" || rows[0].failures < maxAttempts) return;
    await client.query("UPDATE webhook_endpoints SET state = 'disabled', version = version + 1 WHERE id = $1", [delivery.endpointId]);
    await systemAudit(client, null, "webhook.disabled", { detail: delivery.name });
    await notify(client, null, { role: "admin" }, { title: `The webhook ${delivery.name} was turned off`, body: "It kept failing. Check the delivery log, then turn it on again.", href: `/workspace/settings/webhooks/${delivery.endpointId}` });
  });
}

export async function deliverWebhooks(stopped: () => boolean) {
  await queueEvents();
  // A claimed delivery is retried after two minutes if this process dies before it records the result.
  const { rows } = await pool().query<Claimed>(
    `WITH due AS (
       SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE d.state = 'pending' AND d.next_attempt_at <= now() AND e.state = 'active' ORDER BY d.next_attempt_at LIMIT 40 FOR UPDATE OF d SKIP LOCKED
     ) UPDATE webhook_deliveries d SET attempts = d.attempts + 1, next_attempt_at = now() + interval '2 minutes' FROM due, webhook_endpoints e WHERE d.id = due.id AND e.id = d.endpoint_id
     RETURNING d.id, d.endpoint_id AS "endpointId", d.payload, d.attempts, e.url, e.secret, e.format, e.name`,
  );
  for (let index = 0; index < rows.length && !stopped(); index += 5) await Promise.all(rows.slice(index, index + 5).map(attempt));
}
