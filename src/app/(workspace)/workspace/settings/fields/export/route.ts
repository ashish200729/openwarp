import { toCsv, today } from "@/lib/operations";
import { exportCustomFields } from "@/lib/server/custom-fields";
import { apiMember } from "@/lib/server/member";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  try {
    return new Response(toCsv(await exportCustomFields(member)), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-fields-${today()}.csv"` } });
  } catch (error) {
    console.error("OpenWarp field export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
