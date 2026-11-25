import { auth, hasWorkspaceConfig } from "@/lib/server/auth";

const noStore = { "Cache-Control": "private, no-store" };

const allowed = new Map([
  ["sign-in/email", "POST"],
  ["sign-out", "POST"],
  ["change-password", "POST"],
]);

type Context = { params: Promise<{ all: string[] }> };

async function readAuthBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return Buffer.concat(chunks, length).toString("utf8");
    length += value.byteLength;
    if (length > 8_192) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

async function handle(request: Request, context: Context) {
  const endpoint = (await context.params).all.join("/");
  if (allowed.get(endpoint) !== request.method) return new Response(null, { status: 404, headers: noStore });

  if (!hasWorkspaceConfig()) return new Response(null, { status: 503, headers: noStore });
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return new Response(null, { status: 415, headers: noStore });

  const headers = new Headers(request.headers);
  // The bundled proxy replaces this header with the connection's source address.
  if (!process.env.BETTER_AUTH_URL?.startsWith("https:") || !headers.has("x-openwarp-client-ip")) {
    headers.set("x-openwarp-client-ip", "127.0.0.1");
  }
  headers.delete("content-length");
  const body = await readAuthBody(request);
  if (body === null) return new Response(null, { status: 413, headers: noStore });
  const response = await auth().handler(new Request(request.url, { method: request.method, headers, body }));
  const outgoing = new Headers(noStore);
  for (const cookie of response.headers.getSetCookie()) outgoing.append("Set-Cookie", cookie);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) outgoing.set("Retry-After", retryAfter);
  return new Response(null, { status: response.ok ? 204 : response.status, headers: outgoing });
}

export { handle as GET, handle as POST };
