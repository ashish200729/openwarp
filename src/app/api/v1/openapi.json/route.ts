import { openApiDocument } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(openApiDocument(), { headers: { "Cache-Control": "private, no-store" } });
}
