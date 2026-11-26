import { test, expect, type Page } from "@playwright/test";
import { checkPage, signIn } from "./support";

const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD!;
const year = new Date().getUTCFullYear() + 1;
const firstMonday = 1 + (8 - new Date(Date.UTC(year, 2, 1)).getUTCDay()) % 7;
const leaveDate = (offset: number) => new Date(Date.UTC(year, 2, firstMonday + offset)).toISOString().slice(0, 10);
const pdf = { name: "file.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sample") };

async function createAccount(page: Page, employee: string) {
  await page.goto("/workspace/settings/access");
  await page.getByLabel("Employee record").last().selectOption({ label: employee });
  await page.getByRole("button", { name: "Create account" }).click();
  const password = await page.getByRole("status").locator("code").textContent();
  expect(password).toMatch(/^[A-Za-z2-9]{16}$/);
  return password!;
}

// A temporary password opens nothing except the page that replaces it.
async function firstSignIn(page: Page, email: string, temporary: string) {
  await signIn(page, email, temporary);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await page.goto("/workspace/people");
  await expect(page).toHaveURL(/\/welcome$/);
  expect((await page.request.get("/workspace/search?q=dana")).status()).toBe(401);
  await page.getByLabel("Temporary password").fill(temporary);
  await page.getByLabel("New password", { exact: true }).fill(`${temporary}-new`);
  await page.getByLabel("Confirm new password").fill(`${temporary}-new`);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();
}

test("people import, self-service, approvals, pay and documents follow each role", async ({ page, browser, baseURL }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, "admin@openwarp.example", adminPassword);
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();

  await page.goto("/workspace/people/import");
  const upload = async (csv: string) => {
    await page.getByLabel("CSV file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check file" }).click();
  };
  const header = "first_name,last_name,email,title,team,manager_email,employment_type,start_date,status\n";
  await upload(`${header}Dana,Cole,dana@openwarp.example,Lead,Field Ops,nobody@openwarp.example,full_time,2024-01-08,active\nEli,Frost,dana@openwarp.example,Analyst,Field Ops,,wrong,01/02/2024,active\n`);
  await expect(page.getByText("nobody@openwarp.example isn’t an active employee.")).toBeVisible();
  await expect(page.getByText("dana@openwarp.example appears more than once.")).toBeVisible();
  await expect(page.getByText("Write the start date as YYYY-MM-DD.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import / })).toHaveCount(0);
  await upload(`${header}Eli,Frost,eli@openwarp.example,"Analyst, field",Field Ops,dana@openwarp.example,full_time,2024-02-05,active\nDana,Cole,dana@openwarp.example,Lead,Field Ops,,,2024-01-08,\nGus,Hart,gus@openwarp.example,Contract analyst,Field Ops,dana@openwarp.example,contractor,2024-03-04,active\n`);
  await expect(page.getByText("3 people are ready to import.")).toBeVisible();
  await checkPage(page);
  await page.getByRole("button", { name: "Import 3 people" }).click();
  await expect(page.getByRole("status")).toContainText("3 people imported.");
  await page.goto("/workspace/org");
  await expect(page.getByRole("link", { name: /Eli Frost/ })).toBeVisible();
  await checkPage(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("eli fr");
  await expect(page.getByRole("option", { name: /Eli Frost/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Eli Frost" })).toBeVisible();
  const eli = new URL(page.url()).pathname;

  await page.goto(`${eli}/job`);
  await page.getByLabel("Amount in USD").fill("12.345");
  await page.getByRole("button", { name: "Record pay" }).click();
  await expect(page.getByText("Enter an amount such as 1250.00.")).toBeVisible();
  await page.getByLabel("Amount in USD").fill("60000");
  await page.getByRole("button", { name: "Record pay" }).click();
  await expect(page.getByText("$60,000.00 per year")).toBeVisible();
  await checkPage(page);
  await page.goto("/workspace/people?q=gus");
  await page.getByRole("link", { name: /Gus Hart/ }).click();
  await page.waitForURL(/people\/[0-9a-f-]{36}$/);
  await page.goto(`${new URL(page.url()).pathname}/job`);
  await page.getByLabel("Amount in USD").fill("50");
  await page.getByLabel("Basis").selectOption("hourly");
  await page.getByRole("button", { name: "Record pay" }).click();
  await expect(page.getByText("$50.00 per hour")).toBeVisible();

  await page.goto("/workspace/settings");
  await page.getByLabel("Date", { exact: true }).fill(leaveDate(2));
  await page.getByLabel("Holiday", { exact: true }).fill("Founders day");
  await page.getByRole("button", { name: "Add holiday" }).click();
  await expect(page.getByText("Founders day", { exact: true })).toBeVisible();
  await page.getByLabel("New onboarding task").fill("Order a laptop");
  await page.getByRole("button", { name: "Add task" }).first().click();
  await expect(page.getByText("Order a laptop", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Order a laptop" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove task" }).click();
  await expect(page.getByText("Order a laptop", { exact: true })).toHaveCount(0);
  await checkPage(page);

  await page.goto("/workspace/documents?new=1");
  await page.getByLabel("Name", { exact: true }).fill("Handbook");
  await page.getByLabel("File").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<script>alert(1)</script>") });
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("PDF, PNG or JPEG");
  await page.getByLabel("File").setInputFiles(pdf);
  await page.getByLabel("Ask people to confirm").check();
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByRole("link", { name: "Handbook" })).toBeVisible();
  const handbook = await page.getByRole("link", { name: "Handbook" }).getAttribute("href");

  const danaPassword = await createAccount(page, "Dana Cole");
  const eliPassword = await createAccount(page, "Eli Frost");
  const member = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const manager = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const eliPage = await member.newPage();
    const danaPage = await manager.newPage();
    await firstSignIn(eliPage, "eli@openwarp.example", eliPassword);
    await firstSignIn(danaPage, "dana@openwarp.example", danaPassword);

    await eliPage.goto("/workspace/time-off?new=1");
    const request = async (first: string, last: string) => {
      await eliPage.getByLabel("Type").selectOption({ label: "Vacation" });
      await eliPage.getByLabel("First day").fill(first);
      await eliPage.getByLabel("Last day off").fill(last);
      await eliPage.getByRole("button", { name: "Send request" }).click();
    };
    // Monday to Friday with one company holiday.
    await request(`${year}-01-01`, `${year}-03-31`);
    await expect(eliPage.getByRole("main").getByRole("alert")).toContainText("left for the year");
    await request(leaveDate(0), leaveDate(4));
    await expect(eliPage.getByRole("status")).toContainText("Request sent for approval.");
    const days = await eliPage.getByText(/^Vacation, \d days?$/).textContent();
    await eliPage.goto("/workspace/time-off?new=1");
    await request(leaveDate(3), leaveDate(3));
    await expect(eliPage.getByRole("main").getByRole("alert")).toContainText("already have a request");
    await checkPage(eliPage);

    await eliPage.goto("/workspace/expenses?new=1");
    await eliPage.getByLabel("Merchant").fill("Rail Co");
    await eliPage.getByLabel("Amount in USD").fill("80.50");
    await eliPage.getByLabel("Receipt").setInputFiles(pdf);
    await eliPage.getByRole("button", { name: "Send for approval" }).click();
    await expect(eliPage.getByRole("status")).toContainText("Expense sent for approval.");
    const receipt = await eliPage.getByRole("link", { name: "Receipt" }).getAttribute("href");
    await checkPage(eliPage);

    await eliPage.goto("/workspace/documents");
    await eliPage.getByRole("button", { name: "I’ve read this: Handbook" }).click();
    await expect(eliPage.getByText("Acknowledged", { exact: true })).toBeVisible();
    const download = await eliPage.request.get(handbook!);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    await eliPage.goto(`${eli}/job`);
    await expect(eliPage.getByText("$60,000.00 per year")).toBeVisible();
    for (const path of ["/workspace/pay-runs", "/workspace/reports", "/workspace/settings", "/workspace/settings/access", "/workspace/people/import"]) {
      await eliPage.goto(path);
      await expect(eliPage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
    }

    // A manager decides for direct reports and still can't open their pay.
    await danaPage.goto(`${eli}/job`);
    await expect(danaPage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
    expect((await danaPage.request.get(receipt!)).status()).toBe(200);
    await danaPage.goto("/workspace/time-off");
    await expect(danaPage.getByText(days!.replace("Vacation, ", ""), { exact: false }).first()).toBeVisible();
    await danaPage.getByRole("button", { name: "Approve Eli Frost’s Vacation" }).click();
    await expect(danaPage.getByText("No requests are waiting.")).toBeVisible();
    await danaPage.goto("/workspace/expenses");
    await danaPage.getByRole("button", { name: "Approve Eli Frost’s Rail Co expense" }).click();
    await expect(danaPage.getByText("No expenses are waiting.")).toBeVisible();
    await danaPage.goto(`/workspace/time-off?month=${year}-03`);
    await expect(danaPage.getByRole("cell").getByRole("link", { name: "Eli Frost" }).first()).toBeVisible();
    await checkPage(danaPage);

    await page.goto("/workspace/pay-runs?new=1");
    await page.getByLabel("Period starts").fill("2026-01-01");
    await page.getByLabel("Period ends").fill("2026-01-31");
    await page.getByLabel("Pay date").fill("2026-01-30");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByText("One person has no pay recorded and isn’t in this run.")).toBeVisible();
    const lines = page.getByRole("main").getByRole("listitem");
    const line = (name: string) => lines.filter({ hasText: name });
    await expect(line("Eli Frost")).toContainText("$5,080.50");
    await line("Eli Frost").locator("summary").click();
    await line("Eli Frost").getByLabel("Adjustment").fill("-100.25");
    await line("Eli Frost").getByRole("button", { name: "Save line" }).click();
    await expect(line("Eli Frost")).toContainText("$4,980.25");
    await line("Gus Hart").locator("summary").click();
    await line("Gus Hart").getByLabel("Hours worked").fill("10");
    await line("Gus Hart").getByRole("button", { name: "Save line" }).click();
    await expect(line("Gus Hart")).toContainText("$500.00");
    await checkPage(page);
    const run = new URL(page.url()).pathname;
    expect((await danaPage.request.get(`${run}/export`)).status()).toBe(403);
    await page.getByRole("button", { name: "Approve run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve pay run" }).click();
    await expect(page.getByRole("status")).toContainText("Pay run approved.");
    await expect(page.getByRole("button", { name: "Save line" })).toHaveCount(0);
    const csv = await (await page.request.get(`${run}/export`)).text();
    expect(csv).toContain('"Eli Frost","Full-time","per year","60000.00","","5000.00","\'-100.25","","80.50","4980.25","USD","Approved"');
    expect(csv).toContain('"Gus Hart","Contractor","per hour","50.00","10","500.00"');
    await page.goto("/workspace/pay-runs?new=1");
    await page.getByLabel("Period starts").fill("2026-01-15");
    await page.getByLabel("Period ends").fill("2026-02-14");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("already covers part of this period");
    await eliPage.goto("/workspace/expenses");
    await expect(eliPage.getByText("Reimbursed", { exact: true })).toBeVisible();

    await page.goto("/workspace/reports");
    await checkPage(page);
    await page.goto("/workspace/settings/access");
    const account = page.getByRole("listitem").filter({ hasText: "eli@openwarp.example" });
    await account.locator("summary").click();
    await page.getByRole("button", { name: "Disable: Eli Frost" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disable account" }).click();
    await expect(account.getByText("Disabled", { exact: true })).toBeVisible();
    await eliPage.goto("/workspace");
    await expect(eliPage).toHaveURL(/\/login$/);
    await checkPage(page);
  } finally {
    await member.close();
    await manager.close();
  }
});
