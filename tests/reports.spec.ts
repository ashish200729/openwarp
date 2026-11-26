import { test, expect } from "@playwright/test";
import { signIn } from "./support";

const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD!;

test("report date filters apply only to period reports and clamp future dates", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@openwarp.example", adminPassword);

  await page.goto("/workspace/reports?view=plan&from=2024-01-01&to=2024-12-31");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.locator('input[name="from"]')).toHaveCount(0);
  await expect(page.locator('input[name="to"]')).toHaveCount(0);

  const name = `Current plan ${Date.now()}`;
  await page.getByLabel("View name").fill(name);
  await page.getByRole("button", { name: "Save this view" }).click();
  const saved = page.getByRole("link", { name });
  await expect(saved).toBeVisible();
  const href = await saved.getAttribute("href");
  expect(href).not.toContain("from=");
  expect(href).not.toContain("to=");

  const today = new Date().toISOString().slice(0, 10);
  await page.goto("/workspace/reports?view=headcount&from=2024-01-01&to=2099-12-31");
  await expect(page.locator('input[name="from"]')).toBeVisible();
  await expect(page.locator('input[name="to"]')).toHaveValue(today);
  await page.goto("/workspace/reports?view=turnover&from=2024-01-01&to=2099-12-31");
  await expect(page.locator('input[name="to"]')).toHaveValue(today);
});
