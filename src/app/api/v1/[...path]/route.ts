import { handleApi } from "@/lib/server/api";
import { hasWorkspaceConfig } from "@/lib/server/auth";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  if (!hasWorkspaceConfig()) return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  return handleApi(request, (await context.params).path);
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
