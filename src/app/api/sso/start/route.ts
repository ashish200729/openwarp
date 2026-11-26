import { hasWorkspaceConfig } from "@/lib/server/auth";
import { clientAddress, countAttempt, ssoConfigured, workspaceOrigin } from "@/lib/server/platform-settings";
import { beginSso } from "@/lib/server/sso";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!hasWorkspaceConfig() || !ssoConfigured()) return new Response(null, { status: 404, headers: noStore });
  try {
    if (await countAttempt(`sso:${clientAddress(request.headers)}`, 60, 60)) return new Response(null, { status: 303, headers: { ...noStore, Location: `${workspaceOrigin()}/login?sso=unavailable` } });
    const { location, cookie } = await beginSso();
    return new Response(null, { status: 303, headers: { ...noStore, Location: location, "Set-Cookie": cookie } });
  } catch (error) {
    console.error("OpenWarp could not start single sign-on", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 303, headers: { ...noStore, Location: `${workspaceOrigin()}/login?sso=unavailable` } });
  }
}
