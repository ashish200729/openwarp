import { z } from "zod";
import { readDocument } from "@/lib/server/documents";
import { apiMember } from "@/lib/server/member";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const extensions: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

// Files always download. Nothing uploaded is ever rendered on the workspace origin.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await apiMember();
  if (!member) return new Response("Sign in to continue.", { status: 401, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found.", { status: 404, headers });
  try {
    const document = await readDocument(member, id);
    if (!document) return new Response("Not found.", { status: 404, headers });
    const name = `${document.name.replaceAll(/[^\w .-]+/g, " ").trim() || "document"}.${extensions[document.mediaType]}`;
    return new Response(new Uint8Array(document.content), { headers: { ...headers, "Content-Type": document.mediaType, "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (error) {
    console.error("OpenWarp document download failed", error instanceof Error ? error.name : "unknown");
    return new Response("The document is unavailable right now.", { status: 503, headers });
  }
}
