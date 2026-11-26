import { test, expect, type Page } from "@playwright/test";
import { checkPage, signIn } from "./support";

const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD!;
const viewerPassword = process.env.OPENWARP_E2E_VIEWER_PASSWORD!;
const place = "Payspec yard";

async function addEmployee(page: Page, person: { first: string; last: string; type: string; status?: string }) {
  await page.goto("/workspace/people/new");
  await page.getByLabel("First name").fill(person.first);
  await page.getByLabel("Last name").fill(person.last);
  await page.getByLabel("Work email").fill(`${person.first.toLowerCase()}.pay@openwarp.example`);
  await page.getByLabel("Job title").fill("Pay specialist");
  await page.getByLabel("Employment type").selectOption(person.type);
  await page.getByLabel("Start date").fill("2025-01-01");
  await page.getByLabel("Location").fill(place);
  await page.getByLabel("Starting status").selectOption(person.status ?? "active");
  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByRole("heading", { name: `${person.first} ${person.last}`, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function unavailable(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
}

test("payroll rules, benefits, invoices, bank details, payslips and payment files follow each role and never pay twice", async ({ page, browser, baseURL }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, "admin@openwarp.example", adminPassword);
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();

  const paz = await addEmployee(page, { first: "Paz", last: "Quill", type: "full_time" });
  const cleo = await addEmployee(page, { first: "Cleo", last: "Park", type: "contractor" });
  await page.goto(`${paz}/job`);
  await page.getByLabel("Amount in USD").fill("60000");
  await page.getByRole("button", { name: "Record pay" }).click();
  await expect(page.getByText("$60,000.00 per year")).toBeVisible();

  await page.goto("/workspace/settings/pay?new=rule");
  await page.getByLabel("Rule name").fill("Yard tax");
  await page.getByLabel("Kind").selectOption("tax");
  await page.getByLabel("Method").selectOption("brackets");
  await page.getByLabel("Annual brackets").fill("100 10");
  await page.getByLabel("Location contains").fill(place);
  await page.getByLabel("Effective from").fill("2025-01-01");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Start the first bracket at 0.")).toBeVisible();
  await page.getByLabel("Method").selectOption("percent_gross");
  await page.getByLabel("Annual brackets").fill("");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Enter a percent above zero.")).toBeVisible();
  await page.getByLabel("Percent", { exact: false }).first().fill("10");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByRole("status")).toContainText("Rule added.");
  await expect(page.getByText("Tax withholding, 10% of gross pay.", { exact: false })).toBeVisible();
  await page.getByLabel("Bank routing number").fill("021000022");
  await page.getByLabel("Bank name").fill("First Bank");
  await page.getByLabel("Immediate origin").fill("1123456789");
  await page.getByLabel("Company ID").fill("1123456789");
  await page.getByLabel("Company name in NACHA files").fill("Payspec");
  await page.getByRole("button", { name: "Save NACHA details" }).click();
  await expect(page.getByText("Enter a valid nine-digit routing number.")).toBeVisible();
  await page.getByLabel("Bank routing number").fill("021000021");
  await page.getByRole("button", { name: "Save NACHA details" }).click();
  await expect(page.getByText("Enter a valid nine-digit routing number.")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Bank routing number")).toHaveValue("021000021");
  await checkPage(page);

  await page.goto(`${paz}/job?add=recurring`);
  await page.getByLabel("Payment name").fill("Phone allowance");
  await page.getByLabel("Each regular run").fill("40");
  await page.getByLabel("Starts").fill("2025-01-01");
  await page.getByLabel("Taxable").uncheck();
  await page.getByRole("button", { name: "Add recurring payment" }).click();
  await expect(page.getByText("$40.00 each run")).toBeVisible();
  await checkPage(page);

  await page.goto("/workspace/settings/benefits?new=plan");
  await page.getByLabel("Plan name").fill("Yard medical");
  await page.getByRole("button", { name: "Add plan" }).click();
  await expect(page.getByRole("status")).toContainText("Plan added.");
  const plan = page.getByRole("listitem").filter({ hasText: "Yard medical" });
  await plan.locator("summary").click();
  await plan.getByLabel("Coverage level").selectOption("spouse");
  await plan.getByLabel("Cost from").fill("2025-01-01");
  await plan.getByLabel("Employee a month").fill("50");
  await plan.getByLabel("Employer a month").fill("150.01");
  await plan.getByRole("button", { name: "Add cost" }).click();
  await expect(plan.getByRole("cell", { name: "$150.01" })).toBeVisible();
  await page.getByLabel("Window name").fill("Yard enrollment");
  await page.getByLabel("Coverage starts").fill("2025-03-01");
  await page.getByRole("button", { name: "Open enrollment" }).click();
  await expect(page.getByText("Yard enrollment", { exact: true })).toBeVisible();
  await checkPage(page);

  await page.goto("/workspace/settings/access");
  await page.getByLabel("Employee record").last().selectOption({ label: "Cleo Park" });
  await page.getByRole("button", { name: "Create account" }).click();
  const temporary = (await page.getByRole("status").locator("code").textContent())!;
  const password = `${temporary}-new`;
  const self = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const unlinked = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const cleoPage = await self.newPage();
    const viewerPage = await unlinked.newPage();
    await signIn(cleoPage, "cleo.pay@openwarp.example", temporary);
    await cleoPage.getByLabel("Temporary password").fill(temporary);
    await cleoPage.getByLabel("New password", { exact: true }).fill(password);
    await cleoPage.getByLabel("Confirm new password").fill(password);
    await cleoPage.getByRole("button", { name: "Update password" }).click();
    await expect(cleoPage.getByRole("heading", { name: "People overview" })).toBeVisible();
    await signIn(viewerPage, "viewer@openwarp.example", viewerPassword);
    await expect(viewerPage.getByRole("heading", { name: "People overview" })).toBeVisible();

    for (const path of ["/workspace/pay-runs", "/workspace/settings/pay", "/workspace/settings/benefits", `${paz}/job`, `${paz}/bank`, `${paz}/benefits`]) await unavailable(cleoPage, path);
    await viewerPage.goto("/workspace/payslips");
    await expect(viewerPage.getByText("Your account isn’t linked to an employee record.", { exact: false })).toBeVisible();
    await viewerPage.goto("/workspace/benefits");
    await expect(viewerPage.getByText("Your account isn’t linked to an employee record.", { exact: false })).toBeVisible();
    expect((await viewerPage.request.get("/workspace/benefits/export")).status()).toBe(403);
    await unavailable(viewerPage, `${cleo}/bank`);

    await cleoPage.goto(`${cleo}/bank`);
    await cleoPage.getByLabel("Account holder").fill("Cleo Park");
    await cleoPage.getByLabel("Routing number").fill("021000021");
    await cleoPage.getByLabel("Account number", { exact: true }).fill("000987654321");
    await cleoPage.getByLabel("Repeat the account number").fill("000987654322");
    await cleoPage.getByLabel("Your current password").fill("wrong password");
    await cleoPage.getByRole("button", { name: "Save bank details" }).click();
    await expect(cleoPage.getByText("The account numbers don’t match.")).toBeVisible();
    await cleoPage.getByLabel("Repeat the account number").fill("000987654321");
    await cleoPage.getByRole("button", { name: "Save bank details" }).click();
    await expect(cleoPage.getByRole("main").getByRole("alert")).toContainText("That isn’t your current password.");
    await cleoPage.getByLabel("Your current password").fill(password);
    await cleoPage.getByRole("button", { name: "Save bank details" }).click();
    await expect(cleoPage.getByRole("status")).toContainText("Bank details saved.");
    await expect(cleoPage.getByText("US account ending 4321")).toBeVisible();
    expect(await cleoPage.content()).not.toContain("000987654321");
    await checkPage(cleoPage);

    await cleoPage.goto("/workspace/invoices?new=1");
    await cleoPage.getByLabel("Invoice number").fill("YARD-1");
    await cleoPage.getByLabel("Line 1 description").fill("Design work");
    await cleoPage.getByLabel("Line 1 quantity").fill("7.5");
    await cleoPage.getByLabel("Line 1 price").fill("0");
    await cleoPage.getByRole("button", { name: "Send for approval" }).click();
    await expect(cleoPage.getByText("Enter a price above zero, such as 95.00.")).toBeVisible();
    await cleoPage.getByLabel("Line 1 price").fill("95");
    await cleoPage.getByRole("button", { name: "Send for approval" }).click();
    await expect(cleoPage.getByRole("status")).toContainText("Invoice sent for approval.");
    await expect(cleoPage.getByText("$712.50", { exact: true })).toBeVisible();
    await checkPage(cleoPage);

    await cleoPage.goto(`${cleo}/benefits?add=dependent`);
    await cleoPage.getByLabel("Full name").fill("Robin Park");
    await cleoPage.getByLabel("Date of birth").fill("1990-04-05");
    await cleoPage.getByRole("button", { name: "Add dependent" }).click();
    await expect(cleoPage.getByRole("status")).toContainText("Dependent added.");
    const medical = cleoPage.getByRole("listitem").filter({ hasText: "Medical" }).first();
    await medical.locator("summary").click();
    await medical.getByLabel("Medical plan").selectOption({ index: 1 });
    await medical.getByRole("button", { name: "Send for approval" }).click();
    await expect(medical.getByRole("alert")).toContainText("Choose one spouse or partner");
    await medical.getByLabel("Robin Park").check();
    await medical.getByRole("button", { name: "Send for approval" }).click();
    await expect(cleoPage.getByText("Covers Robin Park")).toBeVisible();
    await checkPage(cleoPage);

    await page.goto("/workspace/benefits");
    await page.getByRole("button", { name: "Approve Cleo Park’s Medical choice" }).click();
    await expect(page.getByText("No choices are waiting.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Yard medical" })).toBeVisible();
    expect(await (await page.request.get("/workspace/benefits/export")).text()).toContain("Robin Park (spouse, 1990-04-05)");
    await checkPage(page);
    await page.goto("/workspace/invoices");
    await page.getByRole("button", { name: "Approve Cleo Park’s invoice YARD-1" }).click();
    await expect(page.getByText("No invoices are waiting.")).toBeVisible();
    await checkPage(page);

    await page.goto("/workspace/pay-runs?new=1");
    await page.getByLabel("Period starts").fill("2025-03-01");
    await page.getByLabel("Period ends").fill("2025-03-31");
    await page.getByLabel("Pay date").fill("2025-03-31");
    await page.getByRole("button", { name: "Create draft" }).click();
    const line = (name: string) => page.getByRole("main").getByRole("listitem").filter({ hasText: name });
    // 5,000.00 less 10% tax, plus a 40.00 untaxed allowance.
    await expect(line("Paz Quill").locator("summary")).toContainText("$4,540.00");
    // A 712.50 invoice less 50.00 for medical.
    await expect(line("Cleo Park").locator("summary")).toContainText("$662.50");
    await expect(page.getByRole("definition").filter({ has: page.getByRole("link", { name: "Paz Quill" }) }).first()).toBeVisible();
    await expect(page.getByRole("term").filter({ hasText: "No bank details." })).toBeVisible();
    await line("Paz Quill").locator("summary").click();
    await line("Paz Quill").getByLabel("Earning type").selectOption("correction");
    await line("Paz Quill").getByLabel("Earning amount").fill("-9000");
    await line("Paz Quill").getByRole("button", { name: "Add earning" }).click();
    await expect(page.getByText("Must fix.")).toBeVisible();
    await page.getByRole("button", { name: "Approve run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve pay run" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "negative" })).toBeVisible();
    await page.getByRole("button", { name: "Remove Correction from Paz Quill" }).click();
    await expect(page.getByText("Must fix.")).toHaveCount(0);
    await line("Paz Quill").getByLabel("Unused PTO days").fill("2");
    await line("Paz Quill").getByRole("button", { name: "Add PTO payout" }).click();
    await expect(line("Paz Quill").getByRole("cell", { name: "$461.54" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Remove PTO payout, 2 days from Paz Quill" }).click();
    await expect(line("Paz Quill").locator("summary")).toContainText("$4,540.00");
    await checkPage(page);

    const run = new URL(page.url()).pathname;
    await page.goto(run);
    await page.getByRole("button", { name: "Approve run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve pay run" }).click();
    await expect(page.getByRole("status")).toContainText("Pay run approved.");
    const csv = await (await page.request.get(`${run}/export`)).text();
    expect(csv).toContain('"Paz Quill","Full-time","per year","60000.00","","5000.00","0.00","","0.00","5040.00","USD","Approved"');
    expect(csv).toContain('"500.00","0.00","40.00","4540.00","0.00"');

    await page.getByRole("button", { name: "Create file" }).click();
    await expect(page.getByText("File created with 1 payment.", { exact: false })).toBeVisible();
    const file = (await page.getByRole("link", { name: /^Download NACHA/ }).getAttribute("href"))!;
    const download = await page.request.get(file);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    const records = (await download.text()).trimEnd().split("\r\n");
    expect(records.length % 10).toBe(0);
    expect(records.every((record) => record.length === 94)).toBe(true);
    expect(records.find((record) => record.startsWith("6"))).toContain("0000066250");
    for (const path of [file, `${run}/journal?format=xero`, `${run}/export`]) expect((await cleoPage.request.get(path)).status()).toBe(403);
    // A second file holds no one who is already in the first.
    await page.reload();
    await page.getByRole("button", { name: "Create file" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create another file" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "already in a file" })).toBeVisible();
    await page.getByLabel("Payments", { exact: true }).selectOption("all");
    await page.getByRole("button", { name: "Create file" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create another file" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "never accepted by the bank" })).toBeVisible();
    await checkPage(page);

    const journal = (await (await page.request.get(`${run}/journal?format=quickbooks`)).text()).trimEnd().split("\r\n").slice(1).map((row) => row.split(",").map((cell) => Number(cell.replaceAll('"', "")) || 0));
    const total = (column: number) => journal.reduce((sum, row) => sum + Math.round(row[column] * 100), 0);
    expect(total(3)).toBeGreaterThan(0);
    expect(total(3)).toBe(total(4));

    await cleoPage.goto("/workspace/payslips");
    await cleoPage.getByRole("link", { name: "Mar 31, 2025" }).click();
    await expect(cleoPage.getByRole("heading", { name: "Payslip", exact: true })).toBeVisible();
    await expect(cleoPage.getByText("Invoice YARD-1")).toBeVisible();
    await expect(cleoPage.getByRole("row", { name: /^Net pay/ })).toContainText("$662.50");
    await checkPage(cleoPage);
    await page.goto(`/workspace/payslips?employee=${paz.split("/").pop()}`);
    const other = (await page.getByRole("link", { name: "Mar 31, 2025" }).getAttribute("href"))!;
    await unavailable(cleoPage, other);
    await unavailable(cleoPage, `/workspace/payslips?employee=${paz.split("/").pop()}`);
    await cleoPage.goto("/workspace/invoices");
    await expect(cleoPage.getByText("Paid", { exact: true })).toBeVisible();

    // The same month can't be paid again, whatever dates are used.
    await page.goto("/workspace/pay-runs?new=1");
    await page.getByLabel("Period starts").fill("2025-03-01");
    await page.getByLabel("Period ends").fill("2025-03-31");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("already covers part of this period");
    await page.goto(run);
    await page.getByRole("button", { name: "Create reversal of this run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create reversal draft" }).click();
    await expect(page.getByText("This reverses", { exact: false })).toBeVisible();
    await expect(page.getByText("The run being reversed has a payment file.")).toBeVisible();
    expect((await page.request.get(file)).status()).toBe(409);
    await expect(line("Paz Quill").locator("summary")).toContainText("-$4,540.00");
    await expect(page.getByRole("button", { name: "Save line" })).toHaveCount(0);
    await checkPage(page);
    await page.goto(run);
    await expect(page.getByRole("button", { name: "Create file" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Download NACHA/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Open the reversal" }).click();
    await page.getByRole("button", { name: "Delete draft" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await expect(page.getByRole("status")).toContainText("Draft deleted.");

    expect((await page.request.get(file)).status()).toBe(200);

    await page.goto("/workspace/pay-runs?new=off-cycle");
    await page.getByRole("button", { name: "Create off-cycle draft" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Choose at least one person.");
    await page.getByLabel("Paz Quill").check();
    await page.getByLabel("Amount for each person").fill("1000");
    await page.getByLabel("Work from").fill("2025-03-10");
    await page.getByLabel("Work to").fill("2025-03-10");
    await page.getByLabel("Pay date").fill("2025-04-10");
    await checkPage(page);
    await page.getByRole("button", { name: "Create off-cycle draft" }).click();
    await expect(line("Paz Quill").locator("summary")).toContainText("$900.00");
    await line("Paz Quill").locator("summary").click();
    await line("Paz Quill").getByLabel("Earning type").selectOption("wages");
    await line("Paz Quill").getByLabel("Earning amount").fill("100");
    await line("Paz Quill").getByRole("button", { name: "Add earning" }).click();
    await expect(line("Paz Quill").getByRole("alert")).toContainText("already paid wages");
    await page.getByRole("button", { name: "Delete draft" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await expect(page.getByRole("status")).toContainText("Draft deleted.");

    // Wages paid off-cycle for one day leave only that day out of the regular run, and the run says so.
    const nox = await addEmployee(page, { first: "Nox", last: "Vale", type: "full_time", status: "onboarding" });
    const recordPay = async (path: string, amount: string, from: string, label: string) => {
      await page.goto(`${path}/job`);
      await page.getByLabel("Amount in USD").fill(amount);
      await page.getByLabel("Effective date").fill(from);
      await page.getByRole("button", { name: "Record pay" }).click();
      await expect(page.getByText(label)).toBeVisible();
    };
    await recordPay(nox, "36000", "2025-01-01", "$36,000.00 per year");
    await page.goto("/workspace/pay-runs?new=off-cycle");
    await page.getByLabel("Purpose").selectOption("other");
    await page.getByLabel("Earning type").selectOption("wages");
    await page.getByLabel("Amount for each person").fill("100");
    for (const label of ["Work from", "Work to", "Pay date"]) await page.getByLabel(label).fill("2025-04-01");
    await page.getByLabel("Paz Quill").check();
    await page.getByRole("button", { name: "Create off-cycle draft" }).click();
    await expect(line("Paz Quill").locator("summary")).toContainText("$90.00");
    await page.getByRole("button", { name: "Approve run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve pay run" }).click();
    await expect(page.getByRole("status")).toContainText("Pay run approved.");
    await page.goto("/workspace/pay-runs?new=1");
    await page.getByLabel("Period starts").fill("2025-04-01");
    await page.getByLabel("Period ends").fill("2025-04-30");
    await page.getByLabel("Pay date").fill("2025-04-30");
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(line("Paz Quill").locator("summary")).toContainText("$4,335.46");
    await expect(page.getByText("so this covers 21 of 22 weekdays.", { exact: false })).toBeVisible();
    await expect(line("Nox Vale")).toBeVisible();
    const april = new URL(page.url()).pathname;

    // A draft can't be approved with base pay from before a change, and no one in it can be archived.
    await recordPay(paz, "66000", "2025-04-16", "$66,000.00 per year");
    await page.goto(april);
    await expect(page.getByText("Must fix.")).toBeVisible();
    await page.getByRole("button", { name: "Approve run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve pay run" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Recalculate" })).toBeVisible();
    await page.getByRole("button", { name: "Recalculate this draft" }).click();
    await expect(line("Paz Quill").locator("summary")).toContainText("$4,560.46");
    await expect(page.getByText("Must fix.")).toHaveCount(0);
    await checkPage(page);
    await page.goto(nox);
    const cancelOnboarding = async () => {
      await page.getByRole("button", { name: "Cancel onboarding and archive" }).click();
      await page.getByRole("button", { name: "Cancel and archive" }).click();
    };
    await cancelOnboarding();
    await expect(page.getByRole("alert").filter({ hasText: "draft pay run" })).toBeVisible();
    await page.goto(april);
    await page.getByRole("button", { name: "Delete draft" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await expect(page.getByRole("status")).toContainText("Draft deleted.");
    await page.goto(nox);
    await cancelOnboarding();
    await expect(page.getByRole("button", { name: "Cancel onboarding and archive" })).toHaveCount(0);

    // Approving a run locks the timesheets it pays. Approving its reversal unlocks them.
    const hap = await addEmployee(page, { first: "Hap", last: "Reed", type: "part_time" });
    await page.goto(`${hap}/job`);
    await page.getByLabel("Amount in USD").fill("20");
    await page.getByLabel("Basis").selectOption("hourly");
    await page.getByRole("button", { name: "Record pay" }).click();
    await expect(page.getByText("$20.00 per hour")).toBeVisible();
    const sheet = `/workspace/timesheets/${hap.split("/").pop()}?week=2025-05-05`;
    const reopen = page.getByRole("button", { name: "Reopen Hap Reed’s timesheet" });
    await page.goto(`${sheet}&new=1`);
    await page.getByLabel("Day", { exact: true }).selectOption("2025-05-06");
    await page.getByLabel("Reason for adding time").fill("Forgot to record it");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Entry saved." })).toBeVisible();
    await page.getByRole("button", { name: "Submit week for Hap Reed" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Submit timesheet" }).click();
    await page.getByRole("button", { name: "Approve Hap Reed’s timesheet" }).click();
    await expect(reopen).toBeVisible();
    await page.goto("/workspace/pay-runs?new=1");
    await page.getByLabel("Period starts").fill("2025-05-01");
    await page.getByLabel("Period ends").fill("2025-05-31");
    await page.getByLabel("Pay date").fill("2025-05-30");
    await page.getByRole("button", { name: "Create draft" }).click();
    // Eight hours at 20.00 less 10% tax.
    await expect(line("Hap Reed").locator("summary")).toContainText("from timesheets");
    await expect(line("Hap Reed").locator("summary")).toContainText("$144.00");
    const may = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Approve run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve pay run" }).click();
    await expect(page.getByRole("status")).toContainText("Pay run approved.");
    await page.goto(sheet);
    await expect(page.getByRole("heading", { name: "Hap Reed" })).toBeVisible();
    await expect(reopen).toHaveCount(0);
    await page.goto(may);
    await page.getByRole("button", { name: "Create reversal of this run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create reversal draft" }).click();
    await expect(page.getByText("This reverses", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Approve run" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve pay run" }).click();
    await expect(page.getByRole("status")).toContainText("Reversal approved.");
    await page.goto(sheet);
    await reopen.click();
    await page.getByRole("dialog").getByRole("button", { name: "Reopen timesheet" }).click();
    await expect(page.getByRole("button", { name: "Submit week for Hap Reed" })).toBeVisible();

    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of [run, "/workspace/pay-runs", "/workspace/settings/pay", "/workspace/settings/benefits", "/workspace/benefits", `${paz}/job`]) {
      await page.goto(path);
      await checkPage(page);
    }
  } finally {
    await self.close();
    await unlinked.close();
  }
});
