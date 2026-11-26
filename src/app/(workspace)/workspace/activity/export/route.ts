import { toCsv, today } from "@/lib/operations";
import { exportActivity } from "@/lib/server/insights";
import { apiMember } from "@/lib/server/member";
import { PeopleError } from "@/lib/server/write";
import { activityFilters } from "../filters";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  try {
    const rows = await exportActivity(member, activityFilters(Object.fromEntries(new URL(request.url).searchParams)));
    return new Response(toCsv(rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-activity-${today()}.csv"` } });
  } catch (error) {
    if (error instanceof PeopleError) return new Response(error.message, { status: 422, headers });
    console.error("OpenWarp activity export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
