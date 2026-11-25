import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const adminEmail = "admin@openwarp.example";
const viewerEmail = "viewer@openwarp.example";
const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD;
const viewerPassword = process.env.OPENWARP_E2E_VIEWER_PASSWORD;
if (!adminPassword || !viewerPassword) throw new Error("Run npm run verify:e2e to provision the disposable test workspace.");

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();
}

async function openEmployeeForm(page: Page, details: { first: string; last: string; email: string; status?: "active" | "onboarding"; title?: string; manager?: string; team?: string }) {
  await page.goto("/workspace/people/new");
  await page.getByLabel("First name").fill(details.first);
  await page.getByLabel("Last name").fill(details.last);
  await page.getByLabel("Work email").fill(details.email);
  await page.getByLabel("Job title").fill(details.title ?? "Product engineer");
  await page.getByLabel("Start date").fill("2026-03-16");
  if (details.status) await page.getByLabel("Starting status").selectOption(details.status);
  if (details.manager) await page.getByLabel("Manager").selectOption({ label: details.manager });
  if (details.team) await page.getByLabel("Team").selectOption({ label: details.team });
}

async function addEmployee(page: Page, details: Parameters<typeof openEmployeeForm>[1]) {
  await openEmployeeForm(page, details);
  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByRole("heading", { name: `${details.first} ${details.last}`, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function completeTasks(page: Page) {
  const checklist = page.locator("#checklist");
  const buttons = checklist.getByRole("button", { name: /^Complete / });
  await expect(buttons.first()).toBeVisible();
  const count = await buttons.count();
  for (let task = 0; task < count; task += 1) {
    await buttons.first().click();
    await expect(buttons).toHaveCount(count - task - 1);
  }
  await expect(checklist.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
}

async function checkA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target) }))).toEqual([]);
}

async function checkReflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test("public landing is accessible and reflows on phones and desktops", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "The people system you own." })).toBeVisible();
    await checkReflow(page);
  }
  await checkA11y(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to OpenWarp" })).toBeVisible();
  await checkA11y(page);
});

test("administrators manage a complete employee lifecycle and viewers see only active work records", async ({ page, browser, request, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/workspace/people");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/workspace/people/export")).status()).toBe(401);
  expect((await request.post("/api/auth/sign-up/email", { data: {} })).status()).toBe(404);

  await signIn(page, adminEmail, adminPassword);
  await page.getByRole("link", { name: "Teams", exact: true }).click();
  await page.getByRole("link", { name: "Create team" }).click();
  await page.getByLabel("Team name").fill("Studio Systems");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name: "Studio Systems" })).toBeVisible();
  await page.getByRole("link", { name: "Rename Studio Systems" }).click();
  await page.getByLabel("Team name").fill("Systems Engineering");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: "Systems Engineering" })).toBeVisible();

  const lead = await addEmployee(page, { first: "Morgan", last: "Reed", email: "morgan@openwarp.example", title: "Team lead", status: "active", team: "Systems Engineering" });
  const joiner = await addEmployee(page, { first: "Taylor", last: "Park", email: "taylor@openwarp.example", title: "=1+1", manager: "Morgan Reed · Team lead", team: "Systems Engineering" });
  await expect(page.getByRole("heading", { name: "Onboarding checklist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate employee" })).toBeDisabled();

  const viewer = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const viewerPage = await viewer.newPage();
    await signIn(viewerPage, viewerEmail, viewerPassword);
    await viewerPage.goto("/workspace/people");
    await expect(viewerPage.getByRole("link", { name: /Morgan Reed/ })).toBeVisible();
    await expect(viewerPage.getByText("Taylor Park", { exact: true })).toHaveCount(0);
    await expect(viewerPage.getByRole("link", { name: "Add employee" })).toHaveCount(0);
    await checkReflow(viewerPage);
    await viewerPage.goto(joiner);
    await expect(viewerPage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
    expect((await viewerPage.request.get("/workspace/people/export")).status()).toBe(403);
    await viewerPage.goto("/workspace/activity");
    await expect(viewerPage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();

    const staleAdmin = await browser.newContext({ baseURL, storageState: await page.context().storageState() });
    try {
      const stalePage = await staleAdmin.newPage();
      await openEmployeeForm(stalePage, { first: "Stale", last: "Session", email: "stale@openwarp.example" });
      await staleAdmin.clearCookies();
      await staleAdmin.addCookies(await viewer.cookies());
      await stalePage.getByRole("button", { name: "Add employee" }).click();
      await expect(stalePage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
      const blocked = await page.request.get("/workspace/people/export?q=stale@openwarp.example");
      expect(await blocked.text()).not.toContain("stale@openwarp.example");
    } finally {
      await staleAdmin.close();
    }

    await page.goto("/workspace/lifecycle");
    await page.getByRole("link", { name: "Taylor Park" }).click();
    await completeTasks(page);
    await page.getByRole("button", { name: "Activate employee" }).click();
    await expect(page.getByRole("heading", { name: "Checklist history" })).toBeVisible();
    await viewerPage.goto(joiner);
    await expect(viewerPage.getByRole("heading", { name: "Taylor Park" })).toBeVisible();
  } finally {
    await viewer.close();
  }

  await page.goto(`${lead}/edit`);
  await page.getByLabel("Manager").selectOption({ label: "Taylor Park · =1+1" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("would create a loop");
  await expect(page.getByLabel("Manager")).not.toHaveValue("");

  const stale = await page.context().newPage();
  await stale.goto(`${joiner}/edit`);
  await page.goto(`${joiner}/edit`);
  await page.getByLabel("Work location").fill("Bengaluru");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Bengaluru", { exact: true })).toBeVisible();
  await stale.getByLabel("Work location").fill("Chennai");
  await stale.getByRole("button", { name: "Save changes" }).click();
  await expect(stale.getByRole("main").getByRole("alert")).toContainText("changed while you were editing");
  await stale.close();

  await openEmployeeForm(page, { first: "Other", last: "User", email: "TAYLOR@openwarp.example" });
  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("already in the directory");
  await expect(page.getByLabel("First name")).toHaveValue("Other");

  await page.goto("/workspace/people");
  await page.getByLabel("Search people").fill("Taylor");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: /Taylor Park/ })).toBeVisible();
  await expect(page.getByText("Morgan Reed", { exact: true })).toHaveCount(0);
  const csv = await page.request.get("/workspace/people/export?q=Taylor");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["cache-control"]).toContain("no-store");
  expect(await csv.text()).toContain(`"'=1+1"`);
  expect(await csv.text()).not.toContain("morgan@openwarp.example");
  await checkA11y(page);

  await page.goto(lead);
  await page.getByRole("link", { name: "Start offboarding" }).click();
  await page.getByLabel("Last day").fill("2026-11-27");
  await page.getByRole("button", { name: "Start offboarding" }).click();
  await expect(page.getByRole("heading", { name: "Offboarding checklist" })).toBeVisible();
  await completeTasks(page);
  await page.getByRole("button", { name: "Archive profile" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Reassign this employee’s direct reports");
  await page.goto(`${joiner}/edit`);
  await page.getByLabel("Manager").selectOption("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("No manager listed.")).toBeVisible();
  await page.goto(lead);
  await page.getByRole("button", { name: "Archive profile" }).click();
  await expect(page.getByRole("link", { name: "Restart onboarding" })).toBeVisible();
  await page.getByRole("link", { name: "Restart onboarding" }).click();
  await page.getByLabel("New start date").fill("2026-12-08");
  await page.getByRole("button", { name: "Restart onboarding" }).click();
  await expect(page.locator("#checklist").getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Cancel onboarding and archive" }).click();
  await expect(page.getByRole("link", { name: "Restart onboarding" })).toBeVisible();

  await page.goto("/workspace/people?status=archived");
  await expect(page.getByRole("link", { name: /Morgan Reed/ })).toBeVisible();
  await expect(page.getByText("Taylor Park", { exact: true })).toHaveCount(0);
  await page.goto("/workspace/activity");
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByText("Exported the directory", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Older activity" }).click();
  await expect(page.getByRole("link", { name: "Latest activity" })).toBeVisible();

  await page.goto("/workspace/account");
  const newPassword = `${adminPassword}-updated`;
  await page.getByLabel("Current password").fill(adminPassword);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, adminEmail, newPassword);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/workspace/people");
  await checkReflow(page);
  await checkA11y(page);
  await page.getByText("Account", { exact: true }).click();
  await expect(page.getByRole("link", { name: "My account" })).toBeVisible();
});

test("private pages use fresh script nonces and auth limits request size and repeated sign-ins", async ({ page, request, baseURL }) => {
  const first = await page.goto("/login");
  const policy = first?.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("unsafe-eval");
  expect(first?.headers()["cache-control"]).toContain("no-store");
  expect(await page.locator("script[nonce]").first().evaluate((script: HTMLScriptElement) => script.nonce)).toBe(nonce);
  const second = await page.reload();
  expect(second?.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);

  const oversized = await request.post("/api/auth/sign-in/email", { data: { email: "x".repeat(10_000), password: "invalid-password" } });
  expect(oversized.status()).toBe(413);
  const statusCodes: number[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request.post("/api/auth/sign-in/email", {
      headers: { Origin: baseURL! },
      data: { email: "unknown@openwarp.example", password: "invalid-password" },
    });
    statusCodes.push(response.status());
  }
  expect(statusCodes).toContain(401);
  expect(statusCodes).toContain(429);
});
