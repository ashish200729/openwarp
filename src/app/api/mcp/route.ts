import { handleMcp } from "@/lib/server/api";
import { hasWorkspaceConfig } from "@/lib/server/auth";

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  return hasWorkspaceConfig() ? handleMcp(request) : new Response(null, { status: 503, headers: noStore });
}

// There is no server stream to open and no session to close.
function refuse() {
  return new Response(null, { status: 405, headers: { ...noStore, Allow: "POST" } });
}

export { refuse as GET, refuse as DELETE };
