import "server-only";
import { Pool, type PoolClient } from "pg";

const database = globalThis as typeof globalThis & { openwarpPool?: Pool };

export function pool(): Pool {
  if (!database.openwarpPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to open the workspace.");
    const pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 8_000,
      idle_in_transaction_session_timeout: 10_000,
      application_name: "openwarp",
    });
    pool.on("error", (error) => console.error("OpenWarp idle database connection failed", error.name));
    database.openwarpPool = pool;
  }
  return database.openwarpPool;
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
