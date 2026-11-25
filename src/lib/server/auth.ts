import "server-only";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { pool } from "./db";

export function hasWorkspaceConfig() {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_URL && process.env.BETTER_AUTH_SECRET);
}

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
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const { rowCount } = await pool().query("SELECT 1 FROM workspace_members WHERE user_id = $1 AND role IN ('admin', 'viewer')", [session.userId]);
            return rowCount ? { data: session } : false;
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
