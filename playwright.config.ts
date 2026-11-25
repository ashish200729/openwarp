import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 80_000,
  use: {
    baseURL: process.env.OPENWARP_E2E_ORIGIN ?? "http://127.0.0.1:3086",
    channel: process.env.OPENWARP_E2E_CHROME === "1" ? "chrome" : undefined,
    trace: "retain-on-failure",
  },
});
