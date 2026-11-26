import "server-only";
import { pool } from "./db";
import type { Member } from "./member";
import { audit, PeopleError, runAsAdmin, runAsMember } from "./write";

export type SessionRow = { id: string; device: string; address: string; method: "password" | "sso"; createdAt: Date; lastSeenAt: Date; current: boolean };

export function describeDevice(agent: string) {
  const browser = /Edg(e|A|iOS)?\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /Firefox\/|FxiOS\//.test(agent) ? "Firefox" : /Chrome\/|CriOS\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "";
  const system = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Mac OS X|Macintosh/.test(agent) ? "macOS" : /CrOS/.test(agent) ? "ChromeOS" : /Linux/.test(agent) ? "Linux" : "";
  return [browser || "Unknown browser", system].filter(Boolean).join(" on ");
}

export async function listSessions(member: Member) {
  const { rows } = await pool().query<Omit<SessionRow, "device" | "current"> & { agent: string }>(
    `SELECT s.id, coalesce(s."userAgent", '') AS agent, coalesce(s."ipAddress", '') AS address, coalesce(ss.method, 'password') AS method, s."createdAt", coalesce(ss.last_seen_at, s."createdAt") AS "lastSeenAt"
     FROM "session" s LEFT JOIN session_security ss ON ss.session_id = s.id WHERE s."userId" = $1 AND s."expiresAt" > now() ORDER BY s.id = $2 DESC, 6 DESC LIMIT 50`, [member.id, member.sessionId],
  );
  return rows.map(({ agent, ...session }): SessionRow => ({ ...session, device: describeDevice(agent), current: session.id === member.sessionId }));
}

export function revokeSessions(member: Member, input: { operation: "revoke" | "others"; sessionId: string }) {
  return runAsMember(member, async (client) => {
    if (input.operation === "revoke" && input.sessionId === member.sessionId) throw new PeopleError("Use Sign out to end this session.");
    const { rowCount } = await client.query(`DELETE FROM "session" WHERE "userId" = $1 AND id <> $2 AND ($3::text IS NULL OR id = $3)`, [member.id, member.sessionId, input.operation === "revoke" ? input.sessionId : null]);
    return rowCount ?? 0;
  });
}

export function signOutEverywhere(member: Member, userId: string) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("SELECT 1 FROM workspace_members WHERE user_id = $1", [userId]);
    if (!rowCount) throw new PeopleError("This account could not be found.");
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    await audit(client, member, "account.signed_out", { subjectUserId: userId });
  });
}
