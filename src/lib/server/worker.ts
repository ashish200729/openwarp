import "server-only";
import { hasRequiredSchema, pool } from "./db";
import { deliverEmail } from "./email";
import { runRoutines } from "./routines";
import { deliverWebhooks } from "./webhooks";

const interval = 10_000;
const state = globalThis as typeof globalThis & { openwarpWorker?: { stop: () => void } };

const cleanup = [
  'DELETE FROM "session" WHERE "expiresAt" < now()',
  `DELETE FROM "rateLimit" WHERE "lastRequest" < extract(epoch FROM now() - interval '1 day') * 1000`,
  "DELETE FROM platform_limits WHERE resets_at < now() - interval '1 hour'",
  "DELETE FROM password_tokens WHERE expires_at < now() - interval '1 day'",
  "DELETE FROM two_factor WHERE confirmed_at IS NULL AND created_at < now() - interval '1 day'",
  "DELETE FROM api_requests WHERE created_at < now() - interval '1 day'",
  "DELETE FROM email_messages WHERE (state <> 'queued' OR cancelled_at IS NOT NULL) AND created_at < now() - interval '30 days'",
  "DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days'",
  // Date occurrences are kept, because they are what stops the same reminder from going out twice.
  "DELETE FROM routine_runs WHERE created_at < now() - interval '180 days' AND occurrence ~ '^(schedule|activity|manual):'",
];

function describe(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : error instanceof Error ? error.name : "unknown";
}

// One replica works at a time. The lock belongs to the connection, so it is released even when the process dies.
async function tick(stopped: () => boolean, clean: boolean) {
  const client = await pool().connect();
  let broken = false;
  const lost = () => { broken = true; };
  client.on("error", lost);
  try {
    const { rows } = await client.query<{ locked: boolean; ready: boolean }>("SELECT pg_try_advisory_lock(142050, 3) AS locked, to_regclass('public.routine_runs') IS NOT NULL AS ready");
    if (!rows[0].locked) return false;
    try {
      if (!rows[0].ready || !await hasRequiredSchema(client)) return false;
      const halt = () => broken || stopped();
      const jobs: [string, () => Promise<unknown>][] = [["email", () => deliverEmail(halt)], ["routines", () => runRoutines(halt)], ["webhooks", () => deliverWebhooks(halt)]];
      if (clean) jobs.push(["cleanup", async () => { for (const statement of cleanup) if (!halt()) await pool().query(statement); }]);
      // Reminders also run when someone opens the home page. Each is sent once, so running both is safe.
      if (clean) jobs.push(["reminders", async () => {
        const [records, workplace] = await Promise.all([import("./records-module"), import("./workplace-module")]);
        await records.sendDueNotices();
        if (!halt()) await workplace.sendReminders();
      }]);
      // One job failing must not keep the others from running.
      let maintained = clean;
      for (const [name, run] of jobs) {
        if (halt()) return false;
        try { await run(); } catch (error) {
          if (name === "cleanup" || name === "reminders") maintained = false;
          console.error(`OpenWarp background ${name} failed`, describe(error));
        }
      }
      return maintained && !halt();
    } finally {
      if (!broken) await client.query("SELECT pg_advisory_unlock(142050, 3)");
    }
  } catch (error) {
    broken = true;
    throw error;
  } finally {
    client.off("error", lost);
    client.release(broken);
  }
}

export function startWorker() {
  if (state.openwarpWorker) return;
  let stopping = false;
  let running = false;
  let failures = 0;
  let wait = 0;
  let cleaned = 0;
  const timer = setInterval(async () => {
    if (running || stopping || wait-- > 0) return;
    running = true;
    const clean = Date.now() - cleaned > 3_600_000;
    try {
      if (await tick(() => stopping, clean)) cleaned = Date.now();
      failures = 0;
      wait = 0;
    } catch (error) {
      // A database that is away is retried less often, up to every five minutes.
      failures += 1;
      wait = Math.min(2 ** failures, 30);
      console.error("OpenWarp background work paused", describe(error));
    } finally {
      running = false;
    }
  }, interval);
  timer.unref();
  const stop = () => {
    stopping = true;
    clearInterval(timer);
  };
  state.openwarpWorker = { stop };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
