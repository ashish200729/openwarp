import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { PoolClient } from "pg";
import type { z } from "zod";
import type { accountFields, accountLinkFields } from "@/lib/operations";
import type { resetFields } from "@/lib/domains/platform";
import { pool, transaction } from "./db";
import { hashPasswordToken, issuePasswordLink, queueEmail, queueInvitation, queuePasswordLink } from "./email";
import { requireAdmin, type Member } from "./member";
import { countAttempt, emailConfigured, lockActivity, passwordAllowed, readPolicy, systemAudit, type Policy } from "./platform-settings";
import { audit, PeopleError, runAsAdmin } from "./write";

export type Account = { userId: string; name: string; email: string; role: "admin" | "viewer" | "disabled"; employeeId: string | null; employeeName: string | null; pendingPassword: boolean; invitationVersion: string | null; twoFactor: boolean; sso: boolean };

// A short fingerprint identifies the displayed link without exposing its credential.
const currentInvitation = `SELECT left(pt.token_hash, 24) FROM password_tokens pt WHERE pt.user_id = m.user_id
  AND pt.purpose = 'invitation' AND pt.used_at IS NULL AND pt.expires_at > statement_timestamp() ORDER BY pt.created_at DESC LIMIT 1`;

export async function listAccounts() {
  await requireAdmin();
  const { rows } = await pool().query<Account>(
    `SELECT u.id AS "userId", u.name, u.email, m.role, m.employee_id AS "employeeId", concat_ws(' ', e.first_name, e.last_name) AS "employeeName",
     m.temporary_password_at IS NOT NULL AND EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u.id AND a."updatedAt" <= m.temporary_password_at) AS "pendingPassword",
     (${currentInvitation}) AS "invitationVersion",
     EXISTS (SELECT 1 FROM two_factor t WHERE t.user_id = u.id AND t.confirmed_at IS NOT NULL) AS "twoFactor", EXISTS (SELECT 1 FROM sso_identities i WHERE i.user_id = u.id) AS sso
     FROM workspace_members m JOIN "user" u ON u.id = m.user_id LEFT JOIN employees e ON e.id = m.employee_id ORDER BY m.role = 'disabled', lower(u.name), u.id`,
  );
  return rows;
}

export async function listUnlinkedEmployees() {
  await requireAdmin();
  const { rows } = await pool().query<{ id: string; name: string; email: string }>(
    `SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name, e.email FROM employees e
     WHERE e.status <> 'archived' AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.employee_id = e.id) ORDER BY lower(e.last_name), lower(e.first_name), e.id`,
  );
  return rows;
}

// 16 characters from an alphabet without look-alikes, about 92 bits.
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";
  while (password.length < 16) {
    for (const byte of randomBytes(24)) if (byte < 224 && password.length < 16) password += alphabet[byte % 56];
  }
  return password;
}

async function protectLastAdmin(client: PoolClient, userId: string) {
  const { rowCount } = await client.query("SELECT 1 FROM workspace_members WHERE role = 'admin' AND user_id <> $1 LIMIT 1", [userId]);
  if (!rowCount) throw new PeopleError("Keep at least one administrator account.");
}

async function requireCurrentEmployee(client: PoolClient, employeeId: string | null) {
  if (!employeeId) return;
  const { rowCount } = await client.query("SELECT 1 FROM employees WHERE id = $1 AND status <> 'archived'", [employeeId]);
  if (!rowCount) throw new PeopleError("This employee record is no longer available. Choose a current employee.");
}

export async function createAccount(member: Member, input: z.infer<typeof accountFields>) {
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  await runAsAdmin(member, async (client) => {
    await requireCurrentEmployee(client, input.employeeId);
    const { allowedDomains } = await readPolicy(client);
    if (allowedDomains.length && !allowedDomains.includes(input.email.split("@").at(-1)!)) throw new PeopleError(`New accounts need an email at ${allowedDomains.join(" or ")}.`);
    const id = randomUUID();
    await client.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, input.name, input.email]);
    await client.query(`INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "updatedAt") VALUES ($1, $2, 'credential', $2, $3, now())`, [randomUUID(), id, hash]);
    await client.query("INSERT INTO workspace_members (user_id, role, employee_id, temporary_password_at) VALUES ($1, $2, $3, now())", [id, input.role, input.employeeId]);
    await audit(client, member, "account.created", { subjectUserId: id, detail: input.role });
    await queueInvitation(client, id, input.role);
  });
  return password;
}

export async function resetAccount(member: Member, userId: string) {
  if (userId === member.id) throw new PeopleError("Change your own password from My account.");
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  await runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query(`UPDATE "account" SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = 'credential'`, [userId, hash]);
    if (rowCount !== 1) throw new PeopleError("This account doesn’t have a password to reset.");
    await client.query("UPDATE workspace_members SET temporary_password_at = now() WHERE user_id = $1", [userId]);
    await client.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    await audit(client, member, "account.password_reset", { subjectUserId: userId });
  });
  return password;
}

export function setAccountRole(member: Member, userId: string, role: Account["role"]) {
  return runAsAdmin(member, async (client) => {
    const { rows } = await client.query<{ role: Account["role"] }>("SELECT role FROM workspace_members WHERE user_id = $1", [userId]);
    if (!rows[0]) throw new PeopleError("This account could not be found.");
    if (rows[0].role === role) return;
    if (userId === member.id) throw new PeopleError("Ask another administrator to change your own access.");
    if (rows[0].role === "admin") await protectLastAdmin(client, userId);
    await client.query("UPDATE workspace_members SET role = $2 WHERE user_id = $1", [userId, role]);
    await client.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    await audit(client, member, "account.role_changed", { subjectUserId: userId, detail: `${rows[0].role} to ${role}` });
  });
}

export function linkAccount(member: Member, input: z.infer<typeof accountLinkFields>) {
  return runAsAdmin(member, async (client) => {
    await requireCurrentEmployee(client, input.employeeId);
    await client.query(`UPDATE password_tokens t SET used_at = now() FROM workspace_members m WHERE t.user_id = m.user_id AND m.user_id = $1 AND m.employee_id IS DISTINCT FROM $2::uuid
      AND t.purpose = 'invitation' AND t.used_at IS NULL`, [input.userId, input.employeeId]);
    const { rowCount } = await client.query("UPDATE workspace_members SET employee_id = $2 WHERE user_id = $1", [input.userId, input.employeeId]);
    if (!rowCount) throw new PeopleError("This account could not be found.");
    await audit(client, member, "account.linked", { subjectUserId: input.userId, employeeId: input.employeeId ?? undefined, detail: input.employeeId ? "Linked" : "Unlinked" });
  });
}

async function pendingInviteRole(client: PoolClient, userId: string) {
  const { rows } = await client.query<{ role: "admin" | "viewer" }>(
    `SELECT m.role FROM workspace_members m WHERE m.user_id = $1 AND m.role <> 'disabled'
     AND EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = m.user_id AND a."providerId" = 'credential' AND a."updatedAt" <= m.temporary_password_at)`, [userId],
  );
  if (!rows[0]) throw new PeopleError("This account is no longer waiting for an invitation.");
  return rows[0].role;
}

export function inviteAccount(member: Member, userId: string) {
  if (!emailConfigured()) throw new PeopleError("Set up email before sending invitations.");
  return runAsAdmin(member, async (client) => {
    await queueInvitation(client, userId, await pendingInviteRole(client, userId));
    await audit(client, member, "account.invited", { subjectUserId: userId });
  });
}

async function checkInvitationVersion(client: PoolClient, userId: string, expected: string | null) {
  const { rows } = await client.query<{ version: string | null }>(`SELECT (${currentInvitation}) AS version FROM workspace_members m WHERE m.user_id = $1`, [userId]);
  if (!rows[0] || rows[0].version !== expected) throw new PeopleError("This invitation changed. Review its current status and try again.");
}

export function shareInvitation(member: Member, userId: string, expected: string | null) {
  return runAsAdmin(member, async (client) => {
    await checkInvitationVersion(client, userId, expected);
    const role = await pendingInviteRole(client, userId);
    if (!passwordAllowed(await readPolicy(client), role)) throw new PeopleError("This person uses single sign-on. Share the workspace sign-in address with them.");
    const link = await issuePasswordLink(client, userId, "invitation");
    await audit(client, member, "account.invited", { subjectUserId: userId, detail: "Created a single-use invitation link" });
    return link;
  });
}

export function revokeInvitation(member: Member, userId: string, expected: string | null) {
  return runAsAdmin(member, async (client) => {
    await checkInvitationVersion(client, userId, expected);
    const { rowCount } = await client.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'invitation' AND used_at IS NULL AND expires_at > now()", [userId]);
    if (!rowCount) throw new PeopleError("There is no active invitation link for this account.");
    await audit(client, member, "account.invitation_revoked", { subjectUserId: userId });
  });
}

export function unlinkSso(member: Member, userId: string) {
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("DELETE FROM sso_identities WHERE user_id = $1", [userId]);
    if (!rowCount) throw new PeopleError("This account isn’t linked to single sign-on.");
    await client.query(`DELETE FROM "session" s USING session_security ss WHERE ss.session_id = s.id AND ss.method = 'sso' AND s."userId" = $1`, [userId]);
    await audit(client, member, "account.sso_unlinked", { subjectUserId: userId });
  });
}

export function checkNewPassword(policy: Pick<Policy, "minPasswordLength">, password: string) {
  if (password.length < policy.minPasswordLength) throw new PeopleError(`Use at least ${policy.minPasswordLength} characters.`);
}

// Runs after the response is sent, so neither the answer nor its timing shows whether the account exists.
export async function requestPasswordReset(email: string, address: string) {
  if (!emailConfigured()) return;
  if (await countAttempt(`reset-address:${address}`, 10, 3600) || await countAttempt(`reset:${email}`, 3, 3600) || await countAttempt("reset-all", 100, 3600)) return;
  await transaction(async (client) => {
    await lockActivity(client);
    const { rows } = await client.query<{ id: string; role: "admin" | "viewer" }>(
      `SELECT u.id, m.role FROM "user" u JOIN workspace_members m ON m.user_id = u.id JOIN "account" a ON a."userId" = u.id AND a."providerId" = 'credential' WHERE lower(u.email) = $1 AND m.role <> 'disabled'`, [email],
    );
    if (rows[0] && passwordAllowed(await readPolicy(client), rows[0].role)) await queuePasswordLink(client, rows[0].id, "reset");
  });
}

// A link only replaces the password it was made for. Any password chosen since then ends it, and an invitation also needs a temporary password that is still waiting.
const usableToken = `t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > statement_timestamp() AND m.user_id = t.user_id AND m.role <> 'disabled'
  AND a."userId" = t.user_id AND a."providerId" = 'credential' AND a."updatedAt" <= t.created_at AND (t.purpose = 'reset' OR a."updatedAt" <= m.temporary_password_at)`;

export async function passwordTokenPurpose(token: string) {
  const { rows } = await pool().query<{ purpose: "reset" | "invitation" }>(`SELECT t.purpose FROM password_tokens t, workspace_members m, "account" a WHERE ${usableToken}`, [hashPasswordToken(token)]);
  return rows[0]?.purpose ?? null;
}

export async function invitationDetails(token: string) {
  const { rows } = await pool().query<{ userId: string; email: string; role: "admin" | "viewer"; team: string | null }>(
    `SELECT m.user_id AS "userId", u.email, m.role, team.name AS team
     FROM password_tokens t, "account" a, workspace_members m JOIN "user" u ON u.id = m.user_id
     LEFT JOIN employees e ON e.id = m.employee_id LEFT JOIN teams team ON team.id = e.team_id AND team.archived_at IS NULL
     WHERE ${usableToken} AND t.purpose = 'invitation'`, [hashPasswordToken(token)],
  );
  return rows[0] ?? null;
}

// Better Auth has already replaced the password. The check in usableToken holds even if this fails.
export async function afterPasswordChange(userId: string) {
  try {
    await transaction(async (client) => {
      await client.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
      await queueEmail(client, { userId, kind: "changed", subject: "Your password was changed", text: "Your password was changed from My account, and your other sessions were signed out. If this wasn’t you, contact an administrator now." });
    });
  } catch (error) {
    console.error("OpenWarp could not finish a password change", error instanceof Error ? error.name : "unknown");
  }
}

// The link chooses a password and nothing else. Signing in afterwards still needs the second factor.
export async function setPasswordFromLink(input: z.infer<typeof resetFields>, address: string, signedInUserId: string | null) {
  if (await countAttempt(`reset-use:${address}`, 20, 3600)) throw new PeopleError("Too many attempts. Wait an hour and try again.");
  checkNewPassword(await readPolicy(), input.password);
  const expired = "This link has expired or was already used. Ask for a new one.";
  if (!await passwordTokenPurpose(input.token)) throw new PeopleError(expired);
  const hash = await hashPassword(input.password);
  return transaction(async (client) => {
    await lockActivity(client);
    const { rows } = await client.query<{ userId: string; purpose: string; role: "admin" | "viewer"; current: string | null }>(
      `UPDATE password_tokens t SET used_at = now() FROM workspace_members m, "account" a WHERE ${usableToken} RETURNING t.user_id AS "userId", t.purpose, m.role, a.password AS current`, [hashPasswordToken(input.token)],
    );
    if (!rows[0]) throw new PeopleError(expired);
    const { userId, purpose, role, current } = rows[0];
    if (purpose === "invitation" && signedInUserId && signedInUserId !== userId) throw new PeopleError("You’re signed in to a different account. Reload this invitation to switch accounts.");
    const policy = await readPolicy(client);
    checkNewPassword(policy, input.password);
    if (!passwordAllowed(policy, role)) throw new PeopleError("Your workspace requires single sign-on. Use the sign-in page to continue.");
    if (purpose === "invitation" && current && await verifyPassword({ hash: current, password: input.password })) throw new PeopleError("Choose a password that isn’t the temporary one.");
    const { rowCount } = await client.query(`UPDATE "account" SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = 'credential'`, [userId, hash]);
    if (rowCount !== 1) throw new PeopleError("This account doesn’t use a password.");
    await client.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
    await client.query("UPDATE workspace_members SET temporary_password_at = NULL WHERE user_id = $1", [userId]);
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    await systemAudit(client, userId, "account.password_reset", { subjectUserId: userId, detail: purpose === "reset" ? "By email link" : "By invitation" });
    if (purpose === "reset") await queueEmail(client, { userId, kind: "changed", subject: "Your password was changed", text: "Your password was changed with a link sent to this address, and you were signed out everywhere. If this wasn’t you, contact an administrator." });
    return purpose === "invitation" ? (role === "admin" ? "employer" : "worker") : null;
  });
}
