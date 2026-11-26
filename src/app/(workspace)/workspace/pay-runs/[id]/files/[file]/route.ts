import { z } from "zod";
import { apiMember } from "@/lib/server/member";
import { downloadPayFile } from "@/lib/server/pay-files";
import { PeopleError } from "@/lib/server/write";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const { id, file: fileId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(fileId).success) return new Response("Not found.", { status: 404, headers });
  try {
    const file = await downloadPayFile(member, id, fileId);
    if (!file) return new Response("Not found.", { status: 404, headers });
    return new Response(file.content, { headers: { ...headers, "Content-Type": `${file.type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${file.name}"` } });
  } catch (error) {
    if (error instanceof PeopleError) return new Response(error.message, { status: 409, headers });
    console.error("OpenWarp payment file download failed", error instanceof Error ? error.name : "unknown");
    return new Response("The file is unavailable right now.", { status: 503, headers });
  }
}
