import { auth } from "@/lib/server/auth";
import { pool } from "@/lib/server/db";

export async function GET() {
  try {
    auth();
    await pool().query("SELECT id FROM employees LIMIT 1");
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
