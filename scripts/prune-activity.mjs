import { parseArgs } from "node:util";
import { Client } from "pg";

// Deletes old activity. The application role can't, so this needs the database owner's connection.
const { values } = parseArgs({ options: { days: { type: "string" }, confirm: { type: "boolean", default: false } } });
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("Set MIGRATION_DATABASE_URL to the database owner's connection string.");
if (values.days !== undefined && !/^\d{3,5}$/.test(values.days)) throw new Error("Use --days with a whole number of at least 365.");

const db = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(142050, 2)");
  const { rows: [settings] } = await db.query("SELECT retention_days FROM platform_settings");
  const days = values.days === undefined ? settings.retention_days : Number(values.days);
  if (days === null) throw new Error("The workspace keeps all activity. Set a retention period in Security, or pass --days.");
  if (days < 365) throw new Error("Keep at least 365 days of activity.");
  // Webhooks and routines read activity in order. Nothing they haven't reached is deleted.
  const where = "created_at < now() - make_interval(days => $1) AND id <= (SELECT min(position) FROM activity_cursors)";
  if (values.confirm) {
    const { rowCount } = await db.query(`DELETE FROM activity_log WHERE ${where}`, [days]);
    console.log(`Deleted ${rowCount} entries older than ${days} days.`);
  } else {
    const { rows: [{ count }] } = await db.query(`SELECT count(*)::int AS count FROM activity_log WHERE ${where}`, [days]);
    console.log(`${count} entries are older than ${days} days. Run again with --confirm to delete them.`);
  }
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  console.error(error instanceof Error ? error.message : "Pruning failed.");
  process.exitCode = 1;
} finally {
  await db.end();
}
