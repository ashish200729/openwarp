import { toCsv, today } from "@/lib/operations";
import { apiMember } from "@/lib/server/member";
import { exportReport, reportFilters, reportView } from "@/lib/server/reports";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  try {
    const table = await exportReport(member, reportView(params.view), reportFilters(params), params.table ?? "");
    if (!table) return new Response("Not found.", { status: 404, headers });
    return new Response(toCsv([table.columns, ...table.rows]), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-${table.id}-${today()}.csv"` } });
  } catch (error) {
    console.error("OpenWarp report export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
