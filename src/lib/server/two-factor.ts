import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import type { PoolClient } from "pg";
import { qrPath } from "@/lib/qr";
import { keyedHash, seal, unseal } from "./crypto";
import { pool } from "./db";
import { queueEmail } from "./email";
import type { Member } from "./member";
import { clearAttempts, countAttempt, readPolicy, twoFactorRequired, workspaceName } from "./platform-settings";
import { audit, PeopleError, runAsAdmin, runAsMember } from "./write";

const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
const maxFailures = 5;
export type Enrollment = { secret: string; uri: string; qr: { path: string; size: number } };
type Outcome = "ok" | "wrong" | "locked" | "missing";

function base32(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let text = "";
  for (const byte of bytes) {
    value = (value << 8 | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { bits -= 5; text += alphabet[value >>> bits & 31]; }
  }
  return bits ? text + alphabet[value << (5 - bits) & 31] : text;
}

// RFC 6238 with the settings every authenticator app assumes: SHA-1, six digits and thirty seconds.
export function totp(secret: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// One step of drift either way. A step that was already accepted is never accepted again.
export function matchingStep(secret: Buffer, code: string, lastStep: number, now = Date.now()) {
  const current = Math.floor(now / 30_000);
  let match: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code)) && step > lastStep) match = step;
  }
  return match;
}

function sealedSecret(userId: string, secret: Buffer) {
  return seal(secret.toString("base64"), `two-factor:${userId}`);
}

function backupHash(userId: string, code: string) {
  return keyedHash(`${userId}:${code}`, "two-factor-backup");
}

async function replaceCodes(client: PoolClient, userId: string) {
  const codes = Array.from({ length: 10 }, () => base32(randomBytes(10)));
  await client.query("DELETE FROM two_factor_codes WHERE user_id = $1", [userId]);
  await client.query("INSERT INTO two_factor_codes (user_id, code_hash) SELECT $1, unnest($2::text[])", [userId, codes.map((code) => backupHash(userId, code))]);
  return codes.map((code) => code.match(/.{4}/g)!.join("-"));
}

function markVerified(client: PoolClient, sessionId: string) {
  return client.query("INSERT INTO session_security (session_id, verified_at) VALUES ($1, now()) ON CONFLICT (session_id) DO UPDATE SET verified_at = now()", [sessionId]);
}

function requireVerified(member: Member) {
  if (member.twoFactor === "verify" || member.mustChangePassword) throw new PeopleError("Finish signing in first.");
}

// The password protects the settings that protect the account. People who only use single sign-on prove it with a sign-in from the last ten minutes.
export async function confirmIdentity(member: Member, password: string) {
  requireVerified(member);
  if (!password) {
    const { rowCount } = await pool().query(
      `SELECT 1 FROM session_security ss JOIN "session" s ON s.id = ss.session_id WHERE s.id = $1 AND ss.method = 'sso' AND s."createdAt" > now() - interval '10 minutes'`, [member.sessionId],
    );
    if (!rowCount) throw new PeopleError("Enter your password. If you use single sign-on, sign in again and do this within 10 minutes.");
    return;
  }
  const limit = `password:${member.id}`;
  if (await countAttempt(limit, 5, 900)) throw new PeopleError("Too many attempts. Wait 15 minutes and try again.");
  const { rows } = await pool().query<{ password: string | null }>(`SELECT password FROM "account" WHERE "userId" = $1 AND "providerId" = 'credential'`, [member.id]);
  if (!rows[0]?.password || !await verifyPassword({ hash: rows[0].password, password })) throw new PeopleError("That isn’t your current password.");
  await clearAttempts(limit);
}

export async function readTwoFactor(member: Member) {
  const { rows } = await pool().query<{ enabled: boolean; codesLeft: number; method: string }>(
    `SELECT EXISTS (SELECT 1 FROM two_factor WHERE user_id = $1 AND confirmed_at IS NOT NULL) AS enabled,
     (SELECT count(*)::int FROM two_factor_codes WHERE user_id = $1 AND used_at IS NULL) AS "codesLeft",
     coalesce((SELECT method FROM session_security WHERE session_id = $2), 'password') AS method`, [member.id, member.sessionId],
  );
  return { ...rows[0], required: twoFactorRequired(await readPolicy(), member.role) };
}

export async function startEnrollment(member: Member, password: string): Promise<Enrollment> {
  await confirmIdentity(member, password);
  const secret = randomBytes(20);
  const { rowCount } = await pool().query(
    `INSERT INTO two_factor AS t (user_id, secret) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret, last_step = 0, created_at = now() WHERE t.confirmed_at IS NULL`, [member.id, sealedSecret(member.id, secret)],
  );
  if (!rowCount) throw new PeopleError("Two-factor sign-in is already on.");
  const text = base32(secret).toUpperCase();
  const issuer = workspaceName().replaceAll(":", " ").slice(0, 40);
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(member.email)}?secret=${text}&issuer=${encodeURIComponent(issuer)}`;
  return { secret: text.match(/.{4}/g)!.join(" "), uri, qr: qrPath(uri) };
}

type Row = { secret: Buffer; lastStep: number; confirmed: boolean; locked: boolean; fresh: boolean };

// Failures are counted in the row, so the transaction commits them instead of throwing.
async function checkCode(client: PoolClient, userId: string, code: string, confirmed: boolean): Promise<Outcome> {
  const { rows } = await client.query<Row>(
    `SELECT secret, last_step::float8 AS "lastStep", confirmed_at IS NOT NULL AS confirmed, coalesce(locked_until > now(), false) AS locked, created_at > now() - interval '1 hour' AS fresh
     FROM two_factor WHERE user_id = $1 FOR UPDATE`, [userId],
  );
  const row = rows[0];
  if (!row || row.confirmed !== confirmed || !confirmed && !row.fresh) return "missing";
  if (row.locked) return "locked";
  if (code.length === 6) {
    const step = matchingStep(Buffer.from(unseal(row.secret, `two-factor:${userId}`), "base64"), code, row.lastStep);
    if (step !== null) {
      await client.query("UPDATE two_factor SET last_step = $2, failures = 0, locked_until = NULL WHERE user_id = $1", [userId, step]);
      return "ok";
    }
  } else if (confirmed) {
    const { rowCount } = await client.query("UPDATE two_factor_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL", [userId, backupHash(userId, code)]);
    if (rowCount) {
      await client.query("UPDATE two_factor SET failures = 0, locked_until = NULL WHERE user_id = $1", [userId]);
      return "ok";
    }
  }
  const { rows: [after] } = await client.query<{ locked: boolean }>(
    `UPDATE two_factor SET failures = CASE WHEN failures + 1 >= $2 THEN 0 ELSE failures + 1 END, locked_until = CASE WHEN failures + 1 >= $2 THEN now() + interval '15 minutes' END
     WHERE user_id = $1 RETURNING locked_until IS NOT NULL AS locked`, [userId, maxFailures],
  );
  return after.locked ? "locked" : "wrong";
}

const refusals: Record<Exclude<Outcome, "ok">, string> = {
  wrong: "That code didn’t work. Check the time on your device and try the newest code.",
  locked: "Too many wrong codes. Wait 15 minutes and try again.",
  missing: "This setup expired. Start again.",
};

export async function confirmEnrollment(member: Member, code: string) {
  requireVerified(member);
  const result = await runAsMember(member, async (client) => {
    const outcome = await checkCode(client, member.id, code, false);
    if (outcome !== "ok") return outcome;
    await client.query("UPDATE two_factor SET confirmed_at = now() WHERE user_id = $1", [member.id]);
    const codes = await replaceCodes(client, member.id);
    // Every other session has to pass the new second factor, including one that was verified before an earlier reset.
    await client.query('UPDATE session_security SET verified_at = NULL WHERE session_id IN (SELECT id FROM "session" WHERE "userId" = $1)', [member.id]);
    await markVerified(client, member.sessionId);
    await audit(client, member, "two_factor.enabled", { subjectUserId: member.id });
    await queueEmail(client, { userId: member.id, kind: "changed", subject: "Two-factor sign-in was turned on", text: "Two-factor sign-in was turned on for your account. If this wasn’t you, contact an administrator now." });
    return codes;
  });
  if (typeof result === "string") throw new PeopleError(refusals[result]);
  return result;
}

export async function verifySession(member: Member, code: string) {
  const outcome = await runAsMember(member, async (client) => {
    const checked = await checkCode(client, member.id, code, true);
    if (checked === "ok") await markVerified(client, member.sessionId);
    return checked;
  });
  if (outcome !== "ok") throw new PeopleError(outcome === "missing" ? "Two-factor sign-in was turned off. Reload the page." : refusals[outcome]);
}

export async function commandTwoFactor(member: Member, input: { password: string; operation: "disable" | "codes" }) {
  await confirmIdentity(member, input.password);
  return runAsMember(member, async (client, actor) => {
    const { rowCount } = await client.query("SELECT 1 FROM two_factor WHERE user_id = $1 AND confirmed_at IS NOT NULL FOR UPDATE", [member.id]);
    if (!rowCount) throw new PeopleError("Two-factor sign-in is off.");
    if (input.operation === "codes") {
      const codes = await replaceCodes(client, member.id);
      await audit(client, member, "two_factor.codes_replaced", { subjectUserId: member.id });
      return codes;
    }
    if (twoFactorRequired(await readPolicy(client), actor.role)) throw new PeopleError("Your workspace requires two-factor sign-in, so it can’t be turned off.");
    await client.query("DELETE FROM two_factor WHERE user_id = $1", [member.id]);
    await audit(client, member, "two_factor.disabled", { subjectUserId: member.id });
    await queueEmail(client, { userId: member.id, kind: "changed", subject: "Two-factor sign-in was turned off", text: "Two-factor sign-in was turned off for your account. If this wasn’t you, change your password and contact an administrator." });
    return null;
  });
}

export function resetTwoFactor(member: Member, userId: string) {
  if (userId === member.id) throw new PeopleError("Manage your own two-factor sign-in from My account.");
  return runAsAdmin(member, async (client) => {
    const { rowCount } = await client.query("DELETE FROM two_factor WHERE user_id = $1", [userId]);
    if (!rowCount) throw new PeopleError("Two-factor sign-in isn’t on for this account.");
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
    await audit(client, member, "two_factor.reset", { subjectUserId: userId });
    await queueEmail(client, { userId, kind: "changed", subject: "Two-factor sign-in was reset", text: "An administrator reset two-factor sign-in for your account and signed you out. If you didn’t ask for this, contact an administrator." });
  });
}
