import { exportCalendar } from "@/lib/server/compliance";
import { apiMember } from "@/lib/server/member";

const headers = { "Cache-Control": "private, no-store" };

// The file needs an administrator session. There is no public calendar address to leak.
export async function GET() {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  try {
    return new Response(await exportCalendar(member), { headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="openwarp-compliance.ics"` } });
  } catch (error) {
    console.error("OpenWarp calendar export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The calendar is unavailable right now.", { status: 503, headers });
  }
}
