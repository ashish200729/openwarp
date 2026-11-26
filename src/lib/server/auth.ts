import "server-only";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { pool } from "./db";
import { passwordAllowed, readPolicy } from "./platform-settings";

export function hasWorkspaceConfig() {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_URL && process.env.BETTER_AUTH_SECRET);
}

// Single sign-on opens a session through the same code as a password does. The endpoint has no path, so no request can reach it.
const singleSignOn = {
  id: "openwarp-single-sign-on",
  endpoints: {
    openSession: createAuthEndpoint.serverOnly({ method: "POST", body: z.object({ userId: z.string() }), requireHeaders: true }, async (ctx) => {
      const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
      const session = user && await ctx.context.internalAdapter.createSession(user.id, true);
      if (!user || !session) return ctx.json({ sessionId: null });
      await setSessionCookie(ctx, { session, user }, true);
      return ctx.json({ sessionId: session.id });
    }),
  },
} satisfies BetterAuthPlugin;

function createAuth() {
  const { BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: url } = process.env;
  if (!secret || secret.length < 32 || !url) {
    throw new Error("Configure BETTER_AUTH_URL and BETTER_AUTH_SECRET before opening the workspace.");
  }
  const origin = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (url !== origin.origin && url !== `${origin.origin}/`) throw new Error("BETTER_AUTH_URL must be an origin.");
  if (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) {
    throw new Error("BETTER_AUTH_URL requires HTTPS except on local loopback.");
  }

  const options = {
    appName: "OpenWarp",
    baseURL: origin.origin,
    secret,
    database: pool(),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60 },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: { "/sign-in/email": { window: 60, max: 8 }, "/change-password": { window: 60, max: 4 } },
    },
    advanced: {
      cookiePrefix: "openwarp",
      useSecureCookies: origin.protocol === "https:",
      ipAddress: { ipAddressHeaders: ["x-openwarp-client-ip"] },
    },
    plugins: [singleSignOn],
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            const { rows } = await pool().query<{ role: "admin" | "viewer" }>("SELECT role FROM workspace_members WHERE user_id = $1 AND role IN ('admin', 'viewer')", [session.userId]);
            const policy = await readPolicy();
            if (!rows[0] || context?.path === "/sign-in/email" && !passwordAllowed(policy, rows[0].role)) return false;
            return { data: { ...session, expiresAt: new Date(Date.now() + policy.sessionHours * 3_600_000) } };
          },
          // Changing a password replaces the session. The route only lets a verified session get that far, so its replacement is verified too.
          after: async (session, context) => {
            await pool().query(
              "INSERT INTO session_security (session_id, verified_at) SELECT $1, CASE WHEN $3 AND EXISTS (SELECT 1 FROM two_factor WHERE user_id = $2 AND confirmed_at IS NOT NULL) THEN now() END ON CONFLICT DO NOTHING",
              [session.id, session.userId, context?.path === "/change-password"],
            );
          },
        },
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(options);
}

let instance: ReturnType<typeof createAuth> | undefined;

export function auth() {
  return instance ??= createAuth();
}
