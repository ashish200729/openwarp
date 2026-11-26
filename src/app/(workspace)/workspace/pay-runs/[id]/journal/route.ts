import { z } from "zod";
import { journalFormats } from "@/lib/domains/pay";
import { apiMember } from "@/lib/server/member";
import { exportJournal } from "@/lib/server/pay-files";
import { PeopleError } from "@/lib/server/write";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const { id } = await params;
  const format = z.enum(journalFormats).safeParse(new URL(request.url).searchParams.get("format"));
  if (!z.uuid().safeParse(id).success || !format.success) return new Response("Not found.", { status: 404, headers });
  try {
    const file = await exportJournal(member, id, format.data);
    if (!file) return new Response("Not found.", { status: 404, headers });
    return new Response(file.text, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.name}.csv"` } });
  } catch (error) {
    if (error instanceof PeopleError) return new Response(error.message, { status: 404, headers });
    console.error("OpenWarp journal export failed", error instanceof Error ? error.name : "unknown");
    return new Response("The export is unavailable right now.", { status: 503, headers });
  }
}
