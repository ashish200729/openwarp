import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { NextConfig } from "next";

const migration = readdirSync("db/migrations").filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().at(-1);
if (!migration) throw new Error("The database migrations are missing from the build.");
const checksum = createHash("sha256").update(readFileSync(`db/migrations/${migration}`)).digest("hex");

const config: NextConfig = {
  env: { OPENWARP_SCHEMA_REVISION: migration, OPENWARP_SCHEMA_CHECKSUM: checksum },
  output: "standalone",
  poweredByHeader: false,
  // Uploads are limited to 5 MB by the workspace. The extra megabyte covers the form encoding.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
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
