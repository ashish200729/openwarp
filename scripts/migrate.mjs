import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "pg";

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("Set MIGRATION_DATABASE_URL to the database owner's connection string.");
const db = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
const directory = new URL("../db/migrations/", import.meta.url);
const filenames = (await readdir(directory)).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
const migrations = await Promise.all(filenames.map(async (name) => {
  const sql = await readFile(new URL(name, directory), "utf8");
  return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}));

await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(142050, 1)");
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query("SELECT name, checksum FROM schema_migrations ORDER BY name");
  for (const [index, row] of rows.entries()) {
    const migration = migrations[index];
    if (migration?.name !== row.name || migration.checksum !== row.checksum) {
      throw new Error(`Migration history differs at ${row.name}. Restore the original migration before upgrading.`);
    }
  }
  for (const { name, sql, checksum } of migrations.slice(rows.length)) {
    await db.query(sql);
    await db.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
    console.log(`Applied ${name}`);
  }
  await db.query("COMMIT");
  console.log("Database schema is current.");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
