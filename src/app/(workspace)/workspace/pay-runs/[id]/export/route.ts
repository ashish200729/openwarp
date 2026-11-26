import { z } from "zod";
import { toCsv } from "@/lib/operations";
import { apiMember } from "@/lib/server/member";
import { exportPayRun } from "@/lib/server/pay";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found.", { status: 404, headers });
  try {
    const file = await exportPayRun(member, id);
    if (!file) return new Response("Not found.", { status: 404, headers });
    return new Response(toCsv(file.rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.name}.csv"` } });
  } catch (error) {
    console.error("OpenWarp pay export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
