import { createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { checkPage, signIn } from "./support";

const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD!;
const run = Date.now().toString(36);
const memberEmail = `pia.${run}@openwarp.example`;

const alert = (page: Page) => page.getByRole("main").getByRole("alert");

function totp(key: string, drift = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...key.replace(/\s/g, "")].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, "0")).join("");
  const secret = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + drift));
  const digest = createHmac("sha1", secret).update(counter).digest();
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("two-factor sign-in, security policy, API, webhooks and routines hold their boundaries", async ({ page, browser, request, baseURL }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, "admin@openwarp.example", adminPassword);
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();

  await page.goto("/workspace/people/import");
  await page.getByLabel("CSV file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(`first_name,last_name,email,title,team,manager_email,employment_type,start_date,status\nPia,Voss ${run},${memberEmail},Analyst,Platform ${run},,full_time,2024-02-05,active\n`) });
  await page.getByRole("button", { name: "Check file" }).click();
  await page.getByRole("button", { name: /^Import / }).click();
  await expect(page.getByRole("status")).toContainText("imported");

  // Policy
  await page.goto("/workspace/settings/security");
  await page.getByLabel("Email domains for new accounts").fill("not a domain");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Enter up to 20 domains such as example.com, separated by spaces.")).toBeVisible();
  await page.getByLabel("Email domains for new accounts").fill("openwarp.example");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByRole("status")).toContainText("Security policy saved.");
  await checkPage(page);
  await page.goto("/workspace/settings/access");
  await page.getByLabel("Name", { exact: true }).fill("Outside");
  await page.getByLabel("Sign-in email").fill(`outside.${run}@other.example`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(alert(page)).toContainText("New accounts need an email at openwarp.example.");
  await page.goto("/workspace/settings/security");
  await page.getByLabel("Email domains for new accounts").fill("");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByRole("status")).toContainText("Security policy saved.");

  await page.goto("/workspace/settings/access");
  await page.getByLabel("Employee record").last().selectOption({ label: `Pia Voss ${run}` });
  await page.getByRole("button", { name: "Create account" }).click();
  const temporary = (await page.getByRole("status").locator("code").textContent())!;
  const password = `${temporary}-new`;

  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const member = await context.newPage();
    await signIn(member, memberEmail, temporary);
    await expect(member.getByRole("heading", { name: "Choose your password" })).toBeVisible();
    await member.goto("/two-factor");
    await expect(member).toHaveURL(/\/welcome$/);
    const change = (data: object) => member.request.post("/api/auth/change-password", { headers: { Origin: baseURL! }, data });
    expect((await change({ currentPassword: temporary, newPassword: temporary })).status()).toBe(422);
    await member.goto("/workspace");
    await expect(member).toHaveURL(/\/welcome$/);
    await member.getByLabel("Temporary password").fill(temporary);
    await member.getByLabel("New password", { exact: true }).fill(password);
    await member.getByLabel("Confirm new password").fill(password);
    await member.getByRole("button", { name: "Update password" }).click();
    await expect(member.getByRole("heading", { name: "People overview" })).toBeVisible();
    for (const path of ["/workspace/settings/security", "/workspace/settings/api", "/workspace/settings/webhooks", "/workspace/settings/email", "/workspace/routines"]) {
      await member.goto(path);
      await expect(member.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
    }

    await member.goto("/workspace/account");
    await expect(member.getByText("This session")).toBeVisible();
    await member.getByLabel("Your password").fill("not-the-password");
    await member.getByRole("button", { name: "Set up two-factor" }).click();
    await expect(alert(member)).toContainText("isn’t your current password");
    await member.getByLabel("Your password").fill(password);
    await member.getByRole("button", { name: "Set up two-factor" }).click();
    await expect(member.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
    const key = (await member.getByRole("main").locator("code").first().textContent())!;
    expect(key).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/);
    await checkPage(member);
    await member.getByLabel("Code from the app").fill("000000");
    await member.getByRole("button", { name: "Turn on" }).click();
    await expect(alert(member)).toContainText("didn’t work");
    await member.getByLabel("Code from the app").fill(totp(key));
    await member.getByRole("button", { name: "Turn on" }).click();
    await expect(member.getByText("Save your backup codes")).toBeVisible();
    expect(await member.getByText(/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/).count()).toBe(10);
    await member.getByRole("button", { name: "I saved the codes" }).click();
    await expect(member.getByText("10 of 10 backup codes left.")).toBeVisible();
    await checkPage(member);
    await member.getByText("Account", { exact: true }).click();
    await member.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(member).toHaveURL(/\/login$/);

    // A password alone opens nothing, including the page that changes it.
    await signIn(member, memberEmail, password);
    await expect(member.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await member.goto("/workspace/people");
    await expect(member).toHaveURL(/\/two-factor$/);
    expect((await member.request.get("/workspace/search?q=pia")).status()).toBe(401);
    expect((await member.request.post("/api/auth/change-password", { headers: { Origin: baseURL! }, data: { currentPassword: password, newPassword: "a-different-password" } })).status()).toBe(401);
    await member.getByLabel("Code", { exact: true }).fill("123");
    await member.getByRole("button", { name: "Continue" }).click();
    await expect(member.getByText("Enter the 6-digit code from your app, or a backup code.")).toBeVisible();
    await checkPage(member);
    await member.getByLabel("Code", { exact: true }).fill(totp(key, 1));
    await member.getByRole("button", { name: "Continue" }).click();
    await expect(member.getByRole("heading", { name: "People overview" })).toBeVisible();

    await page.goto("/workspace/settings/access");
    const account = page.getByRole("listitem").filter({ hasText: memberEmail });
    await expect(account).toContainText("Two-factor on");
    await account.locator("summary").click();
    await page.getByRole("button", { name: /^Reset two-factor: Pia/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset two-factor" }).click();
    await expect(account).not.toContainText("Two-factor on");
    await checkPage(page);
    await member.goto("/workspace");
    await expect(member).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }

  // API
  await page.goto("/workspace/settings/api?new=1");
  await page.getByLabel("Name", { exact: true }).fill(`Sync ${run}`);
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText("Choose at least one scope.")).toBeVisible();
  for (const scope of [/^Read people/, /^Add and change people/, /^Read time off/]) await page.getByRole("checkbox", { name: scope }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const token = (await page.getByRole("status").locator("code").textContent())!;
  expect(token).toMatch(/^owt_[\w-]{43}$/);
  await checkPage(page);
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.get("/api/v1/people")).status()).toBe(401);
  expect((await request.get("/api/v1/people", { headers: { Authorization: "Bearer owt_wrong" } })).status()).toBe(401);
  const people = await (await request.get(`/api/v1/people?query=${memberEmail}`, { headers })).json();
  expect(people.data).toHaveLength(1);
  expect(people.data[0]).toMatchObject({ email: memberEmail, status: "active" });
  expect((await request.get("/api/v1/pay-runs", { headers })).status()).toBe(403);
  expect((await request.get("/api/v1/people?limit=1000", { headers })).status()).toBe(400);
  expect((await request.post("/api/v1/people", { headers: { ...headers, "Content-Type": "text/plain" }, data: "x" })).status()).toBe(415);

  await page.goto("/workspace/routines?new=1");
  await page.getByLabel("Name", { exact: true }).fill(`Welcome ${run}`);
  await page.getByLabel("Trigger").selectOption({ label: "After something happens" });
  await page.getByLabel("Event").selectOption({ label: "Added an employee" });
  await page.getByLabel("Who gets it").selectOption({ label: "Administrators" });
  await page.getByLabel("Message").fill("{{full_name}} was added");
  await checkPage(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toContainText("Routine saved.");
  await page.getByRole("button", { name: `Activate Welcome ${run}` }).click();
  await expect(page.getByText(/^Active since/)).toBeVisible();
  const routine = new URL(page.url()).pathname;

  const create = { headers: { ...headers, "Idempotency-Key": `create-${run}` }, data: { first_name: "Quin", last_name: `Api ${run}`, email: `quin.${run}@openwarp.example`, title: "Analyst", employment_type: "full_time", start_date: "2026-01-05", status: "active" } };
  const first = await request.post("/api/v1/people", create);
  expect(first.status()).toBe(201);
  const repeated = await request.post("/api/v1/people", create);
  expect(repeated.headers()["idempotency-replayed"]).toBe("true");
  expect((await repeated.json()).id).toBe((await first.json()).id);
  const mcp = (body: object) => request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id: 1, ...body } });
  expect((await (await mcp({ method: "initialize", params: { protocolVersion: "2025-06-18" } })).json()).result.protocolVersion).toBe("2025-06-18");
  const tools = (await (await mcp({ method: "tools/list" })).json()).result.tools.map((tool: { name: string }) => tool.name);
  expect(tools).toContain("people_list");
  expect(tools).not.toContain("pay_runs_list");
  expect((await request.post("/api/mcp", { headers: { ...headers, Origin: "https://evil.example" }, data: { jsonrpc: "2.0", id: 1, method: "ping" } })).status()).toBe(403);
  expect((await (await request.get("/api/v1/openapi.json")).json()).openapi).toBe("3.1.0");

  await expect.poll(async () => {
    await page.goto("/workspace/notifications");
    return page.getByText(`Quin Api ${run} was added`).count();
  }, { timeout: 45_000, intervals: [3_000] }).toBeGreaterThan(0);
  await page.goto(routine);
  await page.getByLabel("Person").selectOption({ label: `Pia Voss ${run}` });
  await page.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run it" }).click();
  await expect(page.getByText("1 done, 0 skipped.")).toBeVisible();
  await checkPage(page);

  // Pay, personal and expense events stay hidden from a token that can only read activity.
  await page.goto("/workspace/settings/api?new=1");
  const createToken = async (name: string, scopes: RegExp[]) => {
    await page.getByLabel("Name", { exact: true }).fill(name);
    for (const scope of scopes) await page.getByRole("checkbox", { name: scope }).check();
    await page.getByRole("button", { name: "Create token" }).click();
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    return { Authorization: `Bearer ${(await page.getByRole("status").locator("code").textContent())!}` };
  };
  const auditor = await createToken(`Audit ${run}`, [/^Read activity/]);
  await page.goto("/workspace/settings/api?new=1");
  const payroll = await createToken(`Payroll ${run}`, [/^Read activity/, /^Read pay runs/]);
  const employeeId = people.data[0].id as string;
  await page.goto(`/workspace/people/${employeeId}/job`);
  await page.getByLabel(/^Amount in /).fill("52000");
  await page.getByRole("button", { name: "Record pay" }).click();
  await expect(page.getByText("52,000.00 per year", { exact: false }).first()).toBeVisible();
  const events = async (token: Record<string, string>) => (await (await request.get(`/api/v1/activity?limit=100&employee_id=${employeeId}`, { headers: token })).json()).data.map((entry: { event: string }) => entry.event);
  expect(await events(payroll)).toContain("compensation.added");
  expect(await events(auditor)).not.toContain("compensation.added");
  expect((await (await request.get("/api/v1/activity?event=compensation.added", { headers: auditor })).json()).data).toEqual([]);

  // Pay totals come from the stored amounts, whatever a run is made of.
  const runs = (await (await request.get("/api/v1/pay-runs?limit=100", { headers: payroll })).json()).data;
  for (const entry of runs) {
    expect(entry).toMatchObject({ kind: expect.stringMatching(/^(regular|off_cycle|reversal)$/), total_cents: entry.net_cents, employer_cents: expect.any(Number) });
    expect(entry.net_cents).toBe(entry.gross_cents - entry.pre_tax_cents - entry.tax_cents - entry.post_tax_cents + entry.nontaxed_cents);
    const detail = await (await request.get(`/api/v1/pay-runs/${entry.id}`, { headers: payroll })).json();
    expect(detail.lines.reduce((sum: number, line: { net_cents: number }) => sum + line.net_cents, 0)).toBe(entry.total_cents);
  }
  const schema = (await (await request.get("/api/v1/openapi.json")).json()).paths["/pay-runs"].get.responses["200"].content["application/json"].schema;
  expect(Object.keys(schema.properties.data.items.properties)).toEqual(expect.arrayContaining(["kind", "reverses_id", "gross_cents", "net_cents", "employer_cents", "nontaxed_cents"]));

  // Webhooks refuse addresses inside the network and record what happened to the rest.
  await page.goto("/workspace/settings/webhooks?new=1");
  await page.getByLabel("Name", { exact: true }).fill(`Hook ${run}`);
  await page.getByLabel("URL").fill("http://example.com/hook");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(alert(page)).toContainText("Use an https:// URL.");
  await page.getByLabel("URL").fill("https://169.254.169.254/latest");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(alert(page)).toContainText("Private and local addresses are refused.");
  await page.getByLabel("URL").fill("https://hooks.openwarp.invalid/in");
  await page.getByRole("checkbox", { name: /^Created a team/ }).check();
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByRole("status").locator("code")).toHaveText(/^whsec_[\w-]{43}$/);
  await page.getByRole("link", { name: "Open the webhook" }).click();
  await page.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test queued.", { exact: false })).toBeVisible();
  await expect.poll(async () => {
    await page.reload();
    return page.getByText("couldn’t be resolved", { exact: false }).count();
  }, { timeout: 45_000, intervals: [3_000] }).toBeGreaterThan(0);
  await checkPage(page);
  await page.getByRole("button", { name: `Delete Hook ${run}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete webhook" }).click();
  await expect(page.getByRole("status")).toContainText("Webhook deleted.");

  await page.goto("/workspace/settings/api");
  for (const name of ["Sync", "Audit", "Payroll"]) {
    await page.getByRole("button", { name: `Revoke ${name} ${run}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke token" }).click();
    await expect(page.getByRole("button", { name: `Revoke ${name} ${run}` })).toHaveCount(0);
  }
  expect((await request.get("/api/v1/people", { headers })).status()).toBe(401);

  await page.goto(routine);
  await page.getByRole("button", { name: `Delete Welcome ${run}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete routine" }).click();
  await expect(page.getByRole("status")).toContainText("Routine deleted.");

  await page.setViewportSize({ width: 320, height: 760 });
  for (const path of ["/workspace/account", "/workspace/settings/access", "/workspace/settings/security", "/workspace/settings/api?new=1", "/workspace/settings/webhooks?new=1", "/workspace/settings/email", "/workspace/routines?new=1"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await checkPage(page);
  }
});

test("single sign-on and password reset are absent until they are configured", async ({ page, request }) => {
  expect((await request.get("/api/sso/start", { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get("/api/sso/callback?code=x&state=y", { maxRedirects: 0 })).status()).toBe(404);
  await page.goto("/login");
  await expect(page.getByText("Contact your workspace administrator.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot your password?" })).toHaveCount(0);
  await page.goto(`/login/reset?token=${"a".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link doesn’t work" })).toBeVisible();
  await checkPage(page);
});
