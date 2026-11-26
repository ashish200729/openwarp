import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth, hasWorkspaceConfig } from "./auth";
import { pool } from "./db";
import { twoFactorRequired, type Policy } from "./platform-settings";

export { workspaceName } from "./platform-settings";

export type Role = "admin" | "viewer";
// "verify" means the account has a second factor this session hasn't passed. "enroll" means policy asks for one and the account has none.
export type TwoFactorState = "ok" | "verify" | "enroll";
// An API call sets "via" to its token and operation, and the write records it in the same transaction.
export type Member = { id: string; name: string; email: string; role: Role; employeeId: string | null; managesPeople: boolean; mustChangePassword: boolean; twoFactor: TwoFactorState; sessionId: string; via?: string };

type Standing = Pick<Member, "role" | "employeeId" | "managesPeople" | "mustChangePassword"> & Pick<Policy, "requireTwoFactor"> & { enrolled: boolean; verified: boolean; expired: boolean; stale: boolean };

export const currentMember = cache(async (): Promise<Member | null> => {
  if (!hasWorkspaceConfig()) return null;
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const sessionId = session.session.id;
  const { rows } = await pool().query<Standing>(
    `SELECT m.role, m.employee_id AS "employeeId",
     EXISTS (SELECT 1 FROM employees e JOIN employees self ON self.id = e.manager_id WHERE self.id = m.employee_id AND self.status = 'active' AND e.status <> 'archived') AS "managesPeople",
     coalesce(ss.method, 'password') = 'password' AND m.temporary_password_at IS NOT NULL AND EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = m.user_id AND a."providerId" = 'credential' AND a."updatedAt" <= m.temporary_password_at) AS "mustChangePassword",
     p.require_two_factor AS "requireTwoFactor", EXISTS (SELECT 1 FROM two_factor t WHERE t.user_id = m.user_id AND t.confirmed_at IS NOT NULL) AS enrolled, ss.verified_at IS NOT NULL AS verified,
     s."createdAt" + make_interval(hours => p.session_hours) < now() OR coalesce(coalesce(ss.last_seen_at, s."createdAt") + make_interval(mins => p.idle_minutes) < now(), false) AS expired,
     coalesce(ss.last_seen_at < now() - interval '1 minute', true) AS stale
     FROM workspace_members m JOIN "session" s ON s.id = $2 AND s."userId" = m.user_id CROSS JOIN platform_settings p LEFT JOIN session_security ss ON ss.session_id = s.id
     WHERE m.user_id = $1 AND m.role IN ('admin', 'viewer')`, [session.user.id, sessionId],
  );
  if (!rows[0]) return null;
  const { requireTwoFactor, enrolled, verified, expired, stale, ...standing } = rows[0];
  if (expired) {
    await pool().query('DELETE FROM "session" WHERE id = $1', [sessionId]);
    return null;
  }
  // The session can be revoked between these two statements, in which case there is nothing left to mark.
  if (stale) await pool().query(`INSERT INTO session_security (session_id) SELECT id FROM "session" WHERE id = $1 ON CONFLICT (session_id) DO UPDATE SET last_seen_at = now()`, [sessionId]);
  const twoFactor = enrolled ? verified ? "ok" : "verify" : twoFactorRequired({ requireTwoFactor }, standing.role) ? "enroll" : "ok";
  return { id: session.user.id, name: session.user.name, email: session.user.email, ...standing, twoFactor, sessionId };
});

// Route handlers answer with a status instead of redirecting.
export async function apiMember() {
  const member = await currentMember();
  return !member || member.mustChangePassword || member.twoFactor !== "ok" ? null : member;
}

// Where a signed-in person must go before the workspace opens. A second factor always comes before a new password.
export function pendingStep(member: Member) {
  return member.twoFactor === "verify" ? "/two-factor" : member.mustChangePassword ? "/welcome" : member.twoFactor === "enroll" ? "/two-factor" : null;
}

export async function requireMember(): Promise<Member> {
  const member = await currentMember();
  if (!member) redirect("/login");
  const step = pendingStep(member);
  if (step) redirect(step);
  return member;
}

export async function requireAdmin(): Promise<Member> {
  const member = await requireMember();
  if (member.role !== "admin") notFound();
  return member;
}
