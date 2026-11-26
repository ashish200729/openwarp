import { hasWorkspaceConfig } from "@/lib/server/auth";
import { ssoConfigured, workspaceOrigin } from "@/lib/server/platform-settings";
import { clearedCookie, finishSso, SsoError } from "@/lib/server/sso";

export async function GET(request: Request) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (!hasWorkspaceConfig() || !ssoConfigured()) return new Response(null, { status: 404, headers });
  headers.append("Set-Cookie", clearedCookie());
  try {
    for (const cookie of await finishSso(request)) headers.append("Set-Cookie", cookie);
    headers.set("Location", `${workspaceOrigin()}/workspace`);
  } catch (error) {
    const reason = error instanceof SsoError ? error.reason : "unavailable";
    console.error("OpenWarp refused a single sign-on", error instanceof SsoError ? error.message : error instanceof Error ? error.name : "unknown");
    headers.set("Location", `${workspaceOrigin()}/login?sso=${reason}`);
  }
  return new Response(null, { status: 303, headers });
}
