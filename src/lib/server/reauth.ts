import "server-only";
import type { PoolClient } from "pg";
import { pool } from "./db";
import type { Member } from "./member";
import { passwordAllowed, readPolicy } from "./platform-settings";
import { confirmIdentity } from "./two-factor";
import { PeopleError } from "./write";

export type Confirmation = { method: "password" | "sso"; hash: string | null };
export type ConfirmationOptions = { password: boolean; sso: boolean; fresh: boolean };

async function readStanding(member: Member) {
  const [{ rows }, policy] = await Promise.all([
    pool().query<{ sso: boolean; fresh: boolean; hash: string | null; temporary: boolean }>(
      `SELECT coalesce(ss.method = 'sso', false) AS sso, coalesce(ss.method = 'sso' AND s."createdAt" > now() - interval '10 minutes', false) AS fresh, a.password AS hash,
       coalesce(m.temporary_password_at IS NOT NULL AND a."updatedAt" <= m.temporary_password_at, false) AS temporary
       FROM workspace_members m JOIN "session" s ON s.id = $2 AND s."userId" = m.user_id LEFT JOIN session_security ss ON ss.session_id = s.id
       LEFT JOIN "account" a ON a."userId" = m.user_id AND a."providerId" = 'credential' WHERE m.user_id = $1`, [member.id, member.sessionId],
    ),
    readPolicy(),
  ]);
  if (!rows[0]) throw new PeopleError("Your session ended. Sign in again.");
  // Whoever created the account knows a temporary password, so it proves nothing about the person. Neither does one they can't sign in with.
  return { ...rows[0], password: Boolean(rows[0].hash) && !rows[0].temporary && passwordAllowed(policy, member.role) };
}

// What the form should ask for.
export async function confirmationOptions(member: Member): Promise<ConfirmationOptions> {
  const { password, sso, fresh } = await readStanding(member);
  return { password, sso, fresh };
}

// Proves that the person at the keyboard owns the account: their own password, or a single sign-on from the last ten minutes.
export async function confirmMember(member: Member, password: string): Promise<Confirmation> {
  const standing = await readStanding(member);
  if (password && !standing.password) throw new PeopleError("This account uses single sign-on. Sign in again, then do this within 10 minutes and leave the password empty.");
  await confirmIdentity(member, password);
  return { method: password ? "password" : "sso", hash: password ? standing.hash : null };
}

// Called inside the transaction that uses the confirmation, in case the session or the password was replaced meanwhile.
export async function requireConfirmed(client: PoolClient, member: Member, confirmation: Confirmation) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM "session" s WHERE s.id = $1 AND s."userId" = $2 AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = $2 AND a."providerId" = 'credential' AND a.password = $3))`, [member.sessionId, member.id, confirmation.hash],
  );
  if (!rowCount) throw new PeopleError("Your sign-in just changed. Sign in again and repeat this.");
}
