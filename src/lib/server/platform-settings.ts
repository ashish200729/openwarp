import "server-only";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type { ActivityEvent } from "@/lib/activity";
import type { policyFields } from "@/lib/domains/platform";
import { pool } from "./db";
import type { Member, Role } from "./member";
import { audit, PeopleError, runAsAdmin } from "./write";

// The background worker loads this file outside a request, so nothing here may import ./member or ./auth at run time.
export type Policy = {
  requireTwoFactor: "none" | "admins" | "everyone"; sessionHours: number; idleMinutes: number | null; minPasswordLength: number;
  allowedDomains: string[]; passwordSignIn: "everyone" | "admins"; retentionDays: number | null; version: number;
};

export async function readPolicy(client: Pick<PoolClient, "query"> = pool()) {
  const { rows } = await client.query<Policy>(
    `SELECT require_two_factor AS "requireTwoFactor", session_hours AS "sessionHours", idle_minutes AS "idleMinutes", min_password_length AS "minPasswordLength",
     allowed_domains AS "allowedDomains", password_sign_in AS "passwordSignIn", retention_days AS "retentionDays", version FROM platform_settings`,
  );
  return rows[0];
}

export function savePolicy(member: Member, input: z.infer<typeof policyFields>) {
  return runAsAdmin(member, async (client) => {
    if (input.passwordSignIn === "admins" && !ssoConfigured()) throw new PeopleError("Set up single sign-on before limiting password sign-in.");
    const { rowCount } = await client.query(
      `UPDATE platform_settings SET require_two_factor = $1, session_hours = $2, idle_minutes = $3, min_password_length = $4, allowed_domains = $5, password_sign_in = $6, retention_days = $7, version = version + 1 WHERE version = $8`,
      [input.requireTwoFactor, input.sessionHours, input.idleMinutes, input.minPasswordLength, input.allowedDomains, input.passwordSignIn, input.retentionDays, input.version],
    );
    if (!rowCount) throw new PeopleError("This policy changed while you were editing. Reload and try again.");
    await audit(client, member, "security.updated");
  });
}

export function twoFactorRequired(policy: Pick<Policy, "requireTwoFactor">, role: Role) {
  return policy.requireTwoFactor === "everyone" || policy.requireTwoFactor === "admins" && role === "admin";
}

// Password sign-in stays open to everyone when single sign-on isn't configured, so removing it can't lock people out.
export function passwordAllowed(policy: Pick<Policy, "passwordSignIn">, role: Role) {
  return policy.passwordSignIn === "everyone" || role === "admin" || !ssoConfigured();
}

export function workspaceName() {
  return process.env.OPENWARP_WORKSPACE_NAME?.trim().slice(0, 80) || "People workspace";
}

export function workspaceOrigin() {
  return new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000").origin;
}

export function ssoConfigured() {
  return Boolean(process.env.OPENWARP_OIDC_ISSUER && process.env.OPENWARP_OIDC_CLIENT_ID && process.env.OPENWARP_OIDC_CLIENT_SECRET);
}

export function ssoLabel() {
  return process.env.OPENWARP_OIDC_LABEL?.trim().slice(0, 40) || "single sign-on";
}

export function emailConfigured() {
  return Boolean(process.env.OPENWARP_SMTP_URL && process.env.OPENWARP_EMAIL_FROM);
}

// The bundled proxy replaces this header with the connection's source address. Without it every client shares one address.
export function clientAddress(headers: Headers) {
  const address = headers.get("x-openwarp-client-ip");
  return process.env.BETTER_AUTH_URL?.startsWith("https:") && address ? address.slice(0, 64) : "127.0.0.1";
}

// Counts one attempt in a fixed window and returns the seconds to wait, or zero when the attempt is allowed.
export async function countAttempt(key: string, max: number, seconds: number) {
  const { rows } = await pool().query<{ count: number; wait: number }>(
    `INSERT INTO platform_limits AS l (key, count, resets_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET count = CASE WHEN l.resets_at <= now() THEN 1 ELSE least(l.count + 1, 1000000) END,
       resets_at = CASE WHEN l.resets_at <= now() THEN excluded.resets_at ELSE l.resets_at END
     RETURNING count, ceil(extract(epoch FROM resets_at - now()))::int AS wait`, [key.slice(0, 200), seconds],
  );
  return rows[0].count > max ? Math.max(1, rows[0].wait) : 0;
}

export function clearAttempts(key: string) {
  return pool().query("DELETE FROM platform_limits WHERE key = $1", [key.slice(0, 200)]);
}

export async function systemAudit(client: PoolClient, actorId: string | null, event: ActivityEvent, options: { employeeId?: string; subjectUserId?: string; detail?: string } = {}) {
  await client.query("INSERT INTO activity_log (actor_id, event, employee_id, subject_user_id, detail) VALUES ($1, $2, $3, $4, $5)",
    [actorId, event, options.employeeId ?? null, options.subjectUserId ?? null, (options.detail ?? "").slice(0, 300)]);
}

// Everything that writes activity holds this lock until it commits. Readers that keep a position take it too, so an id can't appear behind them.
export function lockActivity(client: PoolClient) {
  return client.query("SELECT pg_advisory_xact_lock(142050, 2)");
}
