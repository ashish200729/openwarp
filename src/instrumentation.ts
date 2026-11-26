export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build" || !process.env.DATABASE_URL) return;
    const { startWorker } = await import("./lib/server/worker");
    startWorker();
  }
}
