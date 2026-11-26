import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The suites share one address, so together they reach the sign-in limit. Waiting it out keeps the limit itself under test.
export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  for (let attempt = 0; ; attempt += 1) {
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const response = page.waitForResponse((entry) => entry.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if ((await response).status() !== 429 || attempt === 1) return;
    await page.waitForTimeout(61_000);
  }
}

export async function checkPage(page: Page) {
  // Next.js streams the title after a client navigation.
  await expect(page).toHaveTitle(/OpenWarp/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}
