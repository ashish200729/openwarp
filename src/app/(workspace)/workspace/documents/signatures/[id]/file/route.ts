import { z } from "zod";
import { apiMember } from "@/lib/server/member";
import { readSignatureFile } from "@/lib/server/signatures";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found.", { status: 404, headers });
  try {
    const document = await readSignatureFile(member, id);
    if (!document) return new Response("Not found.", { status: 404, headers });
    const name = `${document.title.replaceAll(/[^\w .-]+/g, " ").trim() || "document"}.pdf`;
    return new Response(new Uint8Array(document.file), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (error) {
    console.error("OpenWarp signature download failed", error instanceof Error ? error.name : "unknown");
    return new Response("The document is unavailable right now.", { status: 503, headers });
  }
}
