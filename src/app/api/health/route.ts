import { auth } from "@/lib/server/auth";
import { hasRequiredSchema } from "@/lib/server/db";

export async function GET() {
  try {
    auth();
    const key = process.env.OPENWARP_DATA_KEY || process.env.BETTER_AUTH_SECRET;
    if (!key || key.length < 32) throw new Error("Invalid data key");
    if (!await hasRequiredSchema()) throw new Error("Database migration required");
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
