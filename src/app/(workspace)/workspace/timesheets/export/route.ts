import { workDate, toCsv } from "@/lib/operations";
import { weekStart } from "@/lib/domains/time";
import { apiMember } from "@/lib/server/member";
import { exportWeek } from "@/lib/server/timesheets";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const week = workDate.safeParse(new URL(request.url).searchParams.get("week"));
  if (!week.success) return new Response("Not found.", { status: 404, headers });
  try {
    const file = await exportWeek(member, weekStart(week.data));
    return new Response(toCsv(file.rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.name}.csv"` } });
  } catch (error) {
    console.error("OpenWarp timesheet export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
