import { afterPasswordChange } from "@/lib/server/accounts";
import { auth, hasWorkspaceConfig } from "@/lib/server/auth";
import { currentMember } from "@/lib/server/member";
import { clientAddress, readPolicy } from "@/lib/server/platform-settings";
import { readBody } from "@/lib/server/request";

const noStore = { "Cache-Control": "private, no-store" };

const allowed = new Map([
  ["sign-in/email", "POST"],
  ["sign-out", "POST"],
  ["change-password", "POST"],
]);

type Context = { params: Promise<{ all: string[] }> };

// Sessions always follow the workspace's session length, and a password can't be changed before the second factor.
async function prepare(endpoint: string, body: string) {
  let fields: unknown;
  try {
    fields = JSON.parse(body);
  } catch {
    return { body };
  }
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return { body };
  if (endpoint === "sign-in/email") return { body: JSON.stringify({ ...fields, rememberMe: false }) };
  if (endpoint === "change-password") {
    const member = await currentMember();
    if (!member || member.twoFactor === "verify") return { status: 401 };
    const password = "newPassword" in fields ? fields.newPassword : undefined;
    if (typeof password !== "string" || password.length < (await readPolicy()).minPasswordLength) return { status: 422 };
    // Keeping the same password would also clear the mark on a temporary one that an administrator still knows.
    if ("currentPassword" in fields && fields.currentPassword === password) return { status: 422 };
    return { body: JSON.stringify({ ...fields, revokeOtherSessions: true }), changedBy: member.id };
  }
  return { body };
}

async function handle(request: Request, context: Context) {
  const endpoint = (await context.params).all.join("/");
  if (allowed.get(endpoint) !== request.method) return new Response(null, { status: 404, headers: noStore });

  if (!hasWorkspaceConfig()) return new Response(null, { status: 503, headers: noStore });
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return new Response(null, { status: 415, headers: noStore });

  const headers = new Headers(request.headers);
  headers.set("x-openwarp-client-ip", clientAddress(request.headers));
  headers.delete("content-length");
  const raw = await readBody(request, 8_192);
  if (raw === null) return new Response(null, { status: 413, headers: noStore });
  const { body, status, changedBy } = await prepare(endpoint, raw);
  if (status) return new Response(null, { status, headers: noStore });
  const response = await auth().handler(new Request(request.url, { method: request.method, headers, body }));
  if (response.ok && changedBy) await afterPasswordChange(changedBy);
  const outgoing = new Headers(noStore);
  for (const cookie of response.headers.getSetCookie()) outgoing.append("Set-Cookie", cookie);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) outgoing.set("Retry-After", retryAfter);
  return new Response(null, { status: response.ok ? 204 : response.status, headers: outgoing });
}

export { handle as GET, handle as POST };
