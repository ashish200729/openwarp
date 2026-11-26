import { existsSync } from "node:fs";
import type { NextConfig } from "next";

const readoutPath = "./src/components/breeze/readout.tsx";
const useReadout = process.env.OPENWARP_ENABLE_BREEZE_READOUT === "1";

if (useReadout && !existsSync(readoutPath)) {
  throw new Error("Install the licensed Breeze UI Readout before enabling OPENWARP_ENABLE_BREEZE_READOUT.");
}

const config: NextConfig = {
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
