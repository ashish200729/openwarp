import { randomUUID } from "node:crypto";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";
import { z } from "zod";

const { values, positionals } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string" } },
  allowPositionals: true,
});
const [operation] = positionals;
const usage = `Usage:
  account create --email <email> --name <name> --role <admin|viewer>  (password on stdin)
  account set-role --email <email> --role <admin|viewer|disabled>
  account reset-password --email <email>  (new password on stdin)
  account disable-two-factor --email <email>`;
const email = z.string().trim().toLowerCase().max(254).pipe(z.email()).safeParse(values.email);
const name = z.string().trim().min(1).max(160).safeParse(values.name);
const role = z.enum(["admin", "viewer", "disabled"]).safeParse(values.role);
if (positionals.length !== 1 || !email.success || !["create", "set-role", "reset-password", "disable-two-factor"].includes(operation)
    || (operation === "create" && (!name.success || !role.success || role.data === "disabled"))
    || (operation === "set-role" && !role.success)) {
  console.error(usage);
  process.exit(1);
}
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("Set MIGRATION_DATABASE_URL before running account commands.");

let passwordHash;
if (operation === "create" || operation === "reset-password") {
  if (process.stdin.isTTY) throw new Error("Pass the password via stdin to keep it out of the command line and shell history.");
  const password = (await text(process.stdin)).replace(/\r?\n$/, "");
  if (password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) throw new Error("Use a password of 12 to 128 characters on one line.");
  passwordHash = await hashPassword(password);
}

const db = new Client({ connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(142050, 2)");
  const { rows: [user] } = await db.query(
    `SELECT u.id, m.role FROM "user" u LEFT JOIN workspace_members m ON m.user_id = u.id WHERE u.email = $1`, [email.data],
  );

  if (operation === "create") {
    if (user) throw new Error("An account already exists for this email.");
    const id = randomUUID();
    await db.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, name.data, email.data]);
    await db.query(
      'INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "updatedAt") VALUES ($1, $2, \'credential\', $2, $3, now())',
      [randomUUID(), id, passwordHash],
    );
    await db.query("INSERT INTO workspace_members (user_id, role) VALUES ($1, $2)", [id, role.data]);
    await db.query("INSERT INTO activity_log (event, subject_user_id, detail) VALUES ('account.created', $1, $2)", [id, role.data]);
  } else {
    if (!user?.role) throw new Error("No workspace account exists for this email.");
    if (operation === "set-role" && user.role !== role.data) {
      if (user.role === "admin") {
        const { rowCount } = await db.query("SELECT 1 FROM workspace_members WHERE role = 'admin' AND user_id <> $1 LIMIT 1", [user.id]);
        if (!rowCount) throw new Error("Keep at least one administrator account.");
      }
      await db.query("UPDATE workspace_members SET role = $2 WHERE user_id = $1", [user.id, role.data]);
      await db.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
      await db.query('DELETE FROM "session" WHERE "userId" = $1', [user.id]);
      await db.query("INSERT INTO activity_log (event, subject_user_id, detail) VALUES ('account.role_changed', $1, $2)", [user.id, `${user.role} to ${role.data}`]);
    }
    if (operation === "reset-password") {
      const { rowCount } = await db.query(
        'UPDATE "account" SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = \'credential\'', [user.id, passwordHash],
      );
      if (rowCount !== 1) throw new Error("This account does not have a single password credential.");
      await db.query('DELETE FROM "session" WHERE "userId" = $1', [user.id]);
      await db.query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
      await db.query("INSERT INTO activity_log (event, subject_user_id) VALUES ('account.password_reset', $1)", [user.id]);
    }
    if (operation === "disable-two-factor") {
      const { rowCount } = await db.query("DELETE FROM two_factor WHERE user_id = $1", [user.id]);
      if (!rowCount) throw new Error("Two-factor sign-in is not on for this account.");
      await db.query('DELETE FROM "session" WHERE "userId" = $1', [user.id]);
      await db.query("INSERT INTO activity_log (event, subject_user_id, detail) VALUES ('two_factor.reset', $1, 'From the command line')", [user.id]);
    }
  }
  await db.query("COMMIT");
  console.log("Account command completed.");
} catch (error) {
  await db.query("ROLLBACK");
  console.error(error instanceof Error ? error.message : "The account command failed.");
  process.exitCode = 1;
} finally {
  await db.end();
}
