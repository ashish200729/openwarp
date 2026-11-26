// Refreshes the landing page captures from a running workspace that holds sample data.
// OPENWARP_CAPTURE_ORIGIN, OPENWARP_CAPTURE_EMAIL and OPENWARP_CAPTURE_PASSWORD select the workspace and account.
import { chromium } from "@playwright/test";
import sharp from "sharp";

const { OPENWARP_CAPTURE_ORIGIN: origin, OPENWARP_CAPTURE_EMAIL: email, OPENWARP_CAPTURE_PASSWORD: password } = process.env;
if (!origin || !email || !password) throw new Error("Set OPENWARP_CAPTURE_ORIGIN, OPENWARP_CAPTURE_EMAIL and OPENWARP_CAPTURE_PASSWORD.");

const screens = [["home", "/workspace"], ["people", "/workspace/people"], ["time-off", "/workspace/time-off"], ["pay", process.env.OPENWARP_CAPTURE_PAY_PATH ?? "/workspace/pay-runs"], ["timesheets", process.env.OPENWARP_CAPTURE_TIMESHEETS_PATH ?? "/workspace/timesheets/team"], ["devices", "/workspace/devices"], ["reports", "/workspace/reports"]];
const browser = await chromium.launch({ channel: process.env.OPENWARP_E2E_CHROME === "1" ? "chrome" : undefined });
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce", deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/workspace");
  for (const [size, viewport] of [["wide", { width: 1280, height: 800 }], ["narrow", { width: 390, height: 700 }]]) {
    await page.setViewportSize(viewport);
    for (const [name, path] of screens) {
      await page.goto(origin + path);
      await page.waitForTimeout(500);
      const image = await page.screenshot();
      await sharp(image).webp({ quality: 82 }).toFile(new URL(`../public/screens/${name}-${size}-${theme}.webp`, import.meta.url).pathname);
    }
  }
  await context.close();
}
await browser.close();
