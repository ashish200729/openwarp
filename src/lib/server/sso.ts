import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { auth } from "./auth";
import { seal, unseal } from "./crypto";
import { pool, transaction } from "./db";
import { clientAddress, lockActivity, systemAudit, workspaceOrigin } from "./platform-settings";

export class SsoError extends Error {
  readonly reason: "unavailable" | "expired" | "refused" | "account";
  constructor(reason: SsoError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

const discoveryFields = z.object({
  issuer: z.string(), authorization_endpoint: z.url(), token_endpoint: z.url(), jwks_uri: z.url(),
  token_endpoint_auth_methods_supported: z.array(z.string()).default(["client_secret_basic"]),
  authorization_response_iss_parameter_supported: z.boolean().default(false),
});
type Discovery = z.infer<typeof discoveryFields>;
const pendingFields = z.object({ state: z.string(), nonce: z.string(), verifier: z.string(), expires: z.number() });

// Only asymmetric signatures. "none" and shared-secret algorithms are never accepted.
const algorithms = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA", "Ed25519"];
const cookieLifetime = 600;
let cached: { issuer: string; at: number; discovery: Discovery; keys: JWTVerifyGetKey } | undefined;

function settings() {
  const { OPENWARP_OIDC_ISSUER: issuer, OPENWARP_OIDC_CLIENT_ID: clientId, OPENWARP_OIDC_CLIENT_SECRET: clientSecret } = process.env;
  if (!issuer || !clientId || !clientSecret) throw new SsoError("unavailable", "Single sign-on isn’t configured.");
  return { issuer: issuer.trim(), clientId, clientSecret };
}

export const redirectUri = () => `${workspaceOrigin()}/api/sso/callback`;

// The provider must use HTTPS. Plain HTTP is accepted only for a provider on this machine while developing.
function secureUrl(value: string) {
  const url = new URL(value);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new SsoError("unavailable", "The identity provider must use HTTPS.");
  return url;
}

async function fetchJson(url: URL, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json", ...init.headers } });
  const text = await response.text();
  if (!response.ok || text.length > 200_000) throw new SsoError("unavailable", `The identity provider answered ${response.status}.`);
  return JSON.parse(text) as unknown;
}

async function provider() {
  const { issuer } = settings();
  if (cached?.issuer === issuer && Date.now() - cached.at < 600_000) return cached;
  const discovery = discoveryFields.parse(await fetchJson(secureUrl(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`)));
  if (discovery.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) throw new SsoError("unavailable", "The identity provider reports a different issuer.");
  for (const url of [discovery.authorization_endpoint, discovery.token_endpoint, discovery.jwks_uri]) secureUrl(url);
  cached = { issuer, at: Date.now(), discovery, keys: createRemoteJWKSet(new URL(discovery.jwks_uri), { timeoutDuration: 8_000 }) };
  return cached;
}

function cookieName() {
  return workspaceOrigin().startsWith("https:") ? "__Secure-openwarp.sso" : "openwarp.sso";
}

function cookie(value: string, maxAge: number) {
  return `${cookieName()}=${value}; Path=/api/sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${workspaceOrigin().startsWith("https:") ? "; Secure" : ""}`;
}

export const clearedCookie = () => cookie("", 0);

export async function beginSso() {
  const { clientId } = settings();
  const { discovery } = await provider();
  const pending = { state: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"), verifier: randomBytes(48).toString("base64url"), expires: Date.now() + cookieLifetime * 1000 };
  const url = new URL(discovery.authorization_endpoint);
  const parameters = {
    response_type: "code", client_id: clientId, redirect_uri: redirectUri(), scope: "openid email profile", state: pending.state, nonce: pending.nonce,
    code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"), code_challenge_method: "S256",
  };
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  return { location: url.href, cookie: cookie(seal(JSON.stringify(pending), "sso-state").toString("base64url"), cookieLifetime) };
}

function readPending(header: string | null) {
  const value = header?.split(/;\s*/).find((part) => part.startsWith(`${cookieName()}=`))?.slice(cookieName().length + 1);
  try {
    const pending = pendingFields.parse(JSON.parse(unseal(Buffer.from(value ?? "", "base64url"), "sso-state")));
    if (pending.expires > Date.now()) return pending;
  } catch {
    // A missing, altered or foreign cookie is the same as an expired one.
  }
  throw new SsoError("expired", "The sign-in took too long or started in another browser.");
}

function equal(a: string, b: string) {
  const [left, right] = [a, b].map((value) => createHash("sha256").update(value).digest());
  return timingSafeEqual(left, right);
}

const claimFields = z.object({ sub: z.string().min(1).max(500), email: z.string().trim().toLowerCase().max(254).pipe(z.email()), email_verified: z.literal(true), nonce: z.string(), azp: z.string().optional(), aud: z.union([z.string(), z.array(z.string())]) });

export async function verifyIdToken(token: string, keys: JWTVerifyGetKey, expected: { issuer: string; clientId: string; nonce: string }) {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: expected.issuer, audience: expected.clientId, algorithms, clockTolerance: 60, maxTokenAge: "10 minutes", requiredClaims: ["sub", "exp", "iat", "nonce"] });
    const claims = claimFields.parse(payload);
    if (!equal(claims.nonce, expected.nonce)) throw new SsoError("refused", "The sign-in response doesn’t belong to this request.");
    const audiences = [claims.aud].flat();
    if (claims.azp !== undefined ? claims.azp !== expected.clientId : audiences.length > 1) throw new SsoError("refused", "The token was issued to another application.");
    return { subject: claims.sub, email: claims.email };
  } catch (error) {
    if (error instanceof SsoError) throw error;
    if (error instanceof z.ZodError) throw new SsoError("refused", "The identity provider didn’t confirm a verified email.");
    throw new SsoError("refused", error instanceof errors.JOSEError ? `The token was refused (${error.code}).` : "The token couldn’t be verified.");
  }
}

async function exchange(code: string, verifier: string, discovery: Discovery) {
  const { clientId, clientSecret } = settings();
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const methods = discovery.token_endpoint_auth_methods_supported;
  if (!methods.includes("client_secret_basic") && methods.includes("client_secret_post")) {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  } else headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
  return z.object({ id_token: z.string().max(50_000) }).parse(await fetchJson(secureUrl(discovery.token_endpoint), { method: "POST", headers, body })).id_token;
}

// The account must already exist, be enabled and share the verified email. The provider's subject is remembered the first time and must match after that.
export async function matchAccount(issuer: string, identity: { subject: string; email: string }) {
  return transaction(async (client) => {
    await lockActivity(client);
    const { rows } = await client.query<{ userId: string; issuer: string | null; subject: string | null }>(
      `SELECT u.id AS "userId", i.issuer, i.subject FROM "user" u JOIN workspace_members m ON m.user_id = u.id LEFT JOIN sso_identities i ON i.user_id = u.id WHERE lower(u.email) = $1 AND m.role <> 'disabled'`, [identity.email],
    );
    if (rows.length !== 1) throw new SsoError("account", "No enabled account has this email.");
    const account = rows[0];
    if (account.issuer !== null) {
      if (account.issuer !== issuer || account.subject !== identity.subject) throw new SsoError("account", "This account is linked to a different identity.");
      return account.userId;
    }
    const { rowCount } = await client.query("INSERT INTO sso_identities (user_id, issuer, subject) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [account.userId, issuer, identity.subject]);
    if (!rowCount) throw new SsoError("account", "This identity is already linked to another account.");
    await systemAudit(client, account.userId, "account.sso_linked", { subjectUserId: account.userId });
    return account.userId;
  });
}

export async function openSsoSession(userId: string, requestHeaders: Headers) {
  // Only the two headers Better Auth records. Cookies stay out, so an older session can't influence the new one.
  const headers = new Headers({ "x-openwarp-client-ip": clientAddress(requestHeaders), "user-agent": requestHeaders.get("user-agent")?.slice(0, 500) ?? "" });
  const { response, headers: outgoing } = await auth().api.openSession({ body: { userId }, headers, returnHeaders: true });
  if (!response.sessionId) throw new SsoError("account", "This account can’t sign in.");
  await pool().query("INSERT INTO session_security (session_id, method) VALUES ($1, 'sso') ON CONFLICT (session_id) DO UPDATE SET method = 'sso'", [response.sessionId]);
  return outgoing.getSetCookie();
}

export async function finishSso(request: Request) {
  const query = new URL(request.url).searchParams;
  const pending = readPending(request.headers.get("cookie"));
  if (!equal(query.get("state") ?? "", pending.state)) throw new SsoError("expired", "The sign-in response doesn’t match this browser.");
  if (query.has("error")) throw new SsoError("refused", "The identity provider refused the sign-in.");
  const { discovery, keys } = await provider();
  const iss = query.get("iss");
  if (iss !== null ? iss !== discovery.issuer : discovery.authorization_response_iss_parameter_supported) throw new SsoError("refused", "The response came from a different issuer.");
  const code = query.get("code");
  if (!code || code.length > 4_000) throw new SsoError("refused", "The identity provider sent no code.");
  const token = await exchange(code, pending.verifier, discovery);
  const identity = await verifyIdToken(token, keys, { issuer: discovery.issuer, clientId: settings().clientId, nonce: pending.nonce });
  return openSsoSession(await matchAccount(discovery.issuer, identity), request.headers);
}
