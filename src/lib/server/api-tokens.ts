import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import { scopes, type Scope, type tokenFields } from "@/lib/domains/platform";
import { keyedHash } from "./crypto";
import { pool } from "./db";
import type { Member } from "./member";
import { countAttempt } from "./platform-settings";
import { audit, PeopleError, runAsAdmin } from "./write";

export type ApiToken = { id: string; name: string; hint: string; scopes: Scope[]; createdBy: string; createdAt: Date; expiresAt: Date | null; lastUsedAt: Date | null; revokedAt: Date | null; state: "active" | "expired" | "revoked" | "suspended" };
export type Caller = { tokenId: string; tokenName: string; scopes: ReadonlySet<Scope>; member: Member; progress: "none" | "unknown" };

const perMinute = 120;
const tokenPattern = /^owt_[A-Za-z0-9_-]{43}$/;
const hash = (token: string) => keyedHash(token, "api-token");

export async function listTokens(member: Member) {
  if (member.role !== "admin") throw new PeopleError("Administrator access is required.");
  const { rows } = await pool().query<ApiToken>(
    `SELECT t.id, t.name, t.hint, t.scopes, u.name AS "createdBy", t.created_at AS "createdAt", t.expires_at AS "expiresAt", t.last_used_at AS "lastUsedAt", t.revoked_at AS "revokedAt",
     CASE WHEN t.revoked_at IS NOT NULL THEN 'revoked' WHEN t.expires_at <= now() THEN 'expired' WHEN m.role IS DISTINCT FROM 'admin' THEN 'suspended' ELSE 'active' END AS state
     FROM api_tokens t JOIN "user" u ON u.id = t.created_by LEFT JOIN workspace_members m ON m.user_id = t.created_by
     ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC, t.id LIMIT 100`,
  );
  return rows;
}

export function createToken(member: Member, input: z.infer<typeof tokenFields>) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ total: number }>("SELECT count(*)::int AS total FROM api_tokens WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())");
    if (rows[0].total >= 50) throw new PeopleError("A workspace can have 50 active tokens. Revoke one first.");
    const token = `owt_${randomBytes(32).toString("base64url")}`;
    await client.query("INSERT INTO api_tokens (name, token_hash, hint, scopes, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))",
      [input.name, hash(token), token.slice(0, 8), scopes.filter((scope) => input.scopes.includes(scope)), member.id, input.expiresIn === "never" ? null : Number(input.expiresIn)]);
    await audit(client, member, "api_token.created", { detail: input.name });
    return token;
  });
}

export function revokeToken(member: Member, id: string) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ name: string }>("UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name", [id]);
    if (!rows[0]) throw new PeopleError("This token was already revoked.");
    await audit(client, member, "api_token.revoked", { detail: rows[0].name });
  });
}

export type Authentication = { caller: Caller } | { refused: "unauthorized" } | { refused: "rate_limited"; wait: number };

// A token acts as the administrator who created it and stops working when that person is no longer an administrator.
export async function authenticate(request: Request): Promise<Authentication> {
  const token = /^Bearer +(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!tokenPattern.test(token)) return { refused: "unauthorized" };
  const { rows } = await pool().query<{ id: string; name: string; scopes: Scope[]; userId: string; userName: string; email: string; employeeId: string | null; stale: boolean }>(
    `SELECT t.id, t.name, t.scopes, u.id AS "userId", u.name AS "userName", u.email, m.employee_id AS "employeeId", coalesce(t.last_used_at < now() - interval '1 minute', true) AS stale
     FROM api_tokens t JOIN workspace_members m ON m.user_id = t.created_by AND m.role = 'admin' JOIN "user" u ON u.id = t.created_by
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())`, [hash(token)],
  );
  const row = rows[0];
  if (!row) return { refused: "unauthorized" };
  const wait = await countAttempt(`api:${row.id}`, perMinute, 60);
  if (wait) return { refused: "rate_limited", wait };
  if (row.stale) await pool().query("UPDATE api_tokens SET last_used_at = now() WHERE id = $1", [row.id]);
  return { caller: {
    tokenId: row.id, tokenName: row.name, scopes: new Set(row.scopes), progress: "none",
    member: { id: row.userId, name: row.userName, email: row.email, role: "admin", employeeId: row.employeeId, managesPeople: false, mustChangePassword: false, twoFactor: "ok", sessionId: "" },
  } };
}

// A repeated key returns the first answer. A key that is still running, or that was used for something else, is refused.
export async function claimIdempotencyKey(caller: Caller, key: string, request: string) {
  const requestHash = createHash("sha256").update(request).digest("hex");
  const { rowCount } = await pool().query("INSERT INTO api_requests (token_id, idempotency_key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [caller.tokenId, key, requestHash]);
  if (rowCount) return { state: "new" as const };
  const { rows } = await pool().query<{ requestHash: string; status: number | null; response: string | null }>(`SELECT request_hash AS "requestHash", status, response FROM api_requests WHERE token_id = $1 AND idempotency_key = $2`, [caller.tokenId, key]);
  if (!rows[0] || rows[0].requestHash !== requestHash) return { state: "mismatch" as const };
  return rows[0].status === null ? { state: "running" as const } : { state: "done" as const, status: rows[0].status, response: rows[0].response ?? "" };
}

export function storeIdempotentResponse(caller: Caller, key: string, status: number, response: string) {
  return pool().query("UPDATE api_requests SET status = $3, response = $4 WHERE token_id = $1 AND idempotency_key = $2", [caller.tokenId, key, status, response]);
}

export function releaseIdempotencyKey(caller: Caller, key: string) {
  return pool().query("DELETE FROM api_requests WHERE token_id = $1 AND idempotency_key = $2 AND status IS NULL", [caller.tokenId, key]);
}
