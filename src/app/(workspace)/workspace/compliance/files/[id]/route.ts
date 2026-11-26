import { z } from "zod";
import { readComplianceFile } from "@/lib/server/compliance";
import { apiMember } from "@/lib/server/member";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const extensions: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  if (member.role !== "admin") return new Response("Administrator access is required.", { status: 403, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found.", { status: 404, headers });
  try {
    const file = await readComplianceFile(member, id);
    if (!file) return new Response("Not found.", { status: 404, headers });
    const name = `${file.name.replaceAll(/[^\w .-]+/g, " ").trim() || "file"}.${extensions[file.mediaType]}`;
    return new Response(new Uint8Array(file.content), { headers: { ...headers, "Content-Type": file.mediaType, "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (error) {
    console.error("OpenWarp compliance file download failed", error instanceof Error ? error.name : "unknown");
    return new Response("The file is unavailable right now.", { status: 503, headers });
  }
}
