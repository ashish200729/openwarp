import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { NextConfig } from "next";

const readoutPath = "./src/components/breeze/readout.tsx";
const useReadout = process.env.OPENWARP_ENABLE_BREEZE_READOUT === "1";

if (useReadout && !existsSync(readoutPath)) {
  throw new Error("Install the licensed Breeze UI Readout before enabling OPENWARP_ENABLE_BREEZE_READOUT.");
}

const migration = readdirSync("db/migrations").filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().at(-1);
if (!migration) throw new Error("The database migrations are missing from the build.");
const checksum = createHash("sha256").update(readFileSync(`db/migrations/${migration}`)).digest("hex");

const config: NextConfig = {
  env: { OPENWARP_SCHEMA_REVISION: migration, OPENWARP_SCHEMA_CHECKSUM: checksum },
  output: "standalone",
  poweredByHeader: false,
  // Uploads are limited to 5 MB by the workspace. The extra megabyte covers the form encoding.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  turbopack: {
    resolveAlias: {
      "#openwarp-readout": useReadout ? readoutPath : "./src/components/marketing/digit-field.tsx",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};

export default config;
