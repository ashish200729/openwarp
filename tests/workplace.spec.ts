import { test, expect, type Page } from "@playwright/test";
import { checkPage, signIn } from "./support";

const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD!;
const viewerPassword = process.env.OPENWARP_E2E_VIEWER_PASSWORD!;
const year = new Date().getUTCFullYear() + 1;
const pdf = { name: "file.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sample") };

async function createAccount(page: Page, employee: string) {
  await page.goto("/workspace/settings/access");
  await page.getByLabel("Employee record").last().selectOption({ label: employee });
  await page.getByRole("button", { name: "Create account" }).click();
  const password = await page.getByRole("status").locator("code").textContent();
  expect(password).toMatch(/^[A-Za-z2-9]{16}$/);
  return password!;
}

async function firstSignIn(page: Page, email: string, temporary: string) {
  await signIn(page, email, temporary);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
  await page.getByLabel("Temporary password").fill(temporary);
  await page.getByLabel("New password", { exact: true }).fill(`${temporary}-new`);
  await page.getByLabel("Confirm new password").fill(`${temporary}-new`);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();
}

test("devices, app access, training, compliance, reports and checklists follow each role", async ({ page, browser, baseURL }) => {
  test.setTimeout(420_000);
  const main = page.getByRole("main");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, "admin@openwarp.example", adminPassword);
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();

  await page.goto("/workspace/people/import");
  await page.getByLabel("CSV file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from("first_name,last_name,email,title,team,manager_email,employment_type,start_date,location\nWren,Hale,wren@openwarp.example,Harbor lead,Harbor Team,,full_time,2020-05-04,Lisbon\nIvo,Lund,ivo@openwarp.example,Harbor agent,Harbor Team,wren@openwarp.example,full_time,2022-06-06,Lisbon\n") });
  await page.getByRole("button", { name: "Check file" }).click();
  await page.getByRole("button", { name: "Import 2 people" }).click();
  await expect(page.getByRole("status")).toContainText("2 people imported.");
  await page.goto("/workspace/people?q=ivo");
  await page.getByRole("link", { name: /Ivo Lund/ }).click();
  await page.waitForURL(/people\/[0-9a-f-]{36}$/);
  const ivo = new URL(page.url()).pathname;
  await page.goto("/workspace/people?q=wren");
  await page.getByRole("link", { name: /Wren Hale/ }).click();
  await page.waitForURL(/people\/[0-9a-f-]{36}$/);
  const wren = new URL(page.url()).pathname;
  const password = await createAccount(page, "Ivo Lund");

  // Devices and apps.
  await page.goto("/workspace/devices?new=1");
  await page.getByLabel("Asset tag").fill("WP-100");
  await page.getByLabel("Model").fill("Field book 14");
  await page.getByLabel("Purchase date").fill("2026-03-01");
  await page.getByLabel("Warranty ends").fill("2026-02-01");
  await page.getByLabel("Cost").fill("1250.505");
  await main.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByText("Enter an amount such as 1250.00.")).toBeVisible();
  await page.getByLabel("Cost").fill("1250.50");
  await main.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByText("The warranty must end on or after the purchase date.")).toBeVisible();
  await page.getByLabel("Warranty ends").fill("2028-03-01");
  await main.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByRole("heading", { name: "WP-100" })).toBeVisible();
  await expect(page.getByText("$1,250.50")).toBeVisible();
  const device = new URL(page.url()).pathname;
  await page.goto("/workspace/devices/import");
  const importDevices = async (csv: string) => {
    await page.getByLabel("CSV file").setInputFiles({ name: "devices.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Check file" }).click();
  };
  await importDevices("asset_tag,type,model\nwp-100,laptop,Copy\nWP-101,toaster,Other\n");
  await expect(page.getByText("The asset tag wp-100 is already used.")).toBeVisible();
  await expect(page.getByText("Use one of these types", { exact: false })).toBeVisible();
  await importDevices("asset_tag,type,model\nWP-101,phone,Pocket 3\n");
  await page.getByRole("button", { name: "Import 1 device" }).click();
  await expect(page.getByRole("status")).toContainText("1 device imported.");
  await checkPage(page);
  expect(await (await page.request.get("/workspace/devices/export?q=wp-100")).text()).toContain('"WP-100","Laptop","","Field book 14"');

  await page.goto("/workspace/devices/apps?new=1");
  await page.getByLabel("Name", { exact: true }).fill("Signal Desk");
  await page.getByLabel("Cost per seat").fill("12.50");
  await page.getByLabel("Seats bought").fill("4");
  await page.getByLabel("Criticality").selectOption("critical");
  await main.getByRole("button", { name: "Add app" }).click();
  await expect(page.getByRole("heading", { name: "Signal Desk" })).toBeVisible();
  await expect(page.getByText("$600.00 a year", { exact: false })).toBeVisible();
  await checkPage(page);
  await page.goto("/workspace/settings/workplace");
  await page.getByLabel("App", { exact: true }).selectOption({ label: "Signal Desk" });
  await page.getByLabel("Team", { exact: true }).selectOption({ label: "Harbor Team" });
  await page.getByRole("button", { name: "Add default" }).click();
  await expect(page.getByRole("button", { name: "Remove Signal Desk default for Harbor Team" })).toBeVisible();
  // A saved form starts over, so the same choice is made again.
  await page.getByLabel("App", { exact: true }).selectOption({ label: "Signal Desk" });
  await page.getByLabel("Team", { exact: true }).selectOption({ label: "Harbor Team" });
  await page.getByRole("button", { name: "Add default" }).click();
  await expect(main.getByRole("alert")).toContainText("already exists");
  await checkPage(page);

  // Training.
  await page.goto("/workspace/training?new=1");
  await page.getByLabel("Title", { exact: true }).fill("Harbor safety");
  await page.getByLabel("Quiz attempts").fill("2");
  await page.getByLabel("Repeat after, months").fill("12");
  await main.getByRole("button", { name: "Add course" }).click();
  await expect(page.getByRole("heading", { name: "Harbor safety" })).toBeVisible();
  await page.getByRole("button", { name: "Publish this course" }).click();
  await expect(main.getByRole("alert")).toContainText("Add a lesson or a quiz question");
  await page.getByLabel("Lesson title").fill("Welcome");
  await page.getByLabel("Text", { exact: false }).first().fill("# Start here\n\n- Wear **boots**\n<script>alert(1)</script>");
  await page.getByRole("button", { name: "Add lesson" }).click();
  await expect(page.getByRole("button", { name: "Remove Welcome" })).toBeVisible();
  await page.getByText("New question").click();
  await page.getByLabel("Question", { exact: true }).fill("Which flag means stop?");
  await page.getByLabel("Answers").fill("Blue\nRed");
  await page.getByLabel("Correct line").fill("5");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("There is no answer on that line.")).toBeVisible();
  await page.getByLabel("Correct line").fill("2");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Which flag means stop?")).toBeVisible();
  await page.getByRole("button", { name: "Publish this course" }).click();
  await expect(page.getByRole("button", { name: "Unpublish this course" })).toBeVisible();
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Any team, any employment type")).toBeVisible();
  await page.getByLabel("Who", { exact: true }).selectOption({ label: "Ivo Lund" });
  await page.getByLabel("Due date").fill(`${year}-02-01`);
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText("Assigned to 1 person.")).toBeVisible();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await checkPage(page);
  const course = new URL(page.url()).pathname.replace("/manage", "");

  // A new hire gets the defaults, and the lifecycle page counts them.
  await page.goto("/workspace/people/new");
  await page.getByLabel("First name").fill("Juno");
  await page.getByLabel("Last name").fill("Marsh");
  await page.getByLabel("Work email").fill("juno@openwarp.example");
  await page.getByLabel("Job title").fill("Harbor trainee");
  await page.getByLabel("Start date").fill(`${year}-03-01`);
  await page.getByLabel("Team").selectOption({ label: "Harbor Team" });
  await page.getByLabel("Starting status").selectOption("onboarding");
  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByRole("heading", { name: "Juno Marsh" })).toBeVisible();
  const juno = new URL(page.url()).pathname;
  await expect(page.getByRole("button", { name: "Complete Set up Signal Desk access (Member)" })).toBeVisible();
  await page.goto("/workspace/lifecycle?q=juno&kind=onboarding");
  await expect(page.getByText("Devices 0 of 1, Apps 0 of 1, Training 0 of 1")).toBeVisible();
  await checkPage(page);
  await page.getByRole("link", { name: "Plan tasks for Juno" }).click();
  await page.getByLabel("Task", { exact: true }).fill("Walk the pier");
  await page.getByLabel("Who does it").selectOption({ label: "Ivo Lund" });
  await page.getByLabel("Due by").fill("2026-01-05");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Overdue, Jan 5, 2026")).toBeVisible();
  await checkPage(page);
  await page.goto("/workspace/lifecycle?view=tasks&q=juno&overdue=1");
  await page.getByRole("button", { name: "Change selected" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Change tasks" }).click();
  await expect(main.getByRole("alert")).toContainText("Choose at least one task.");
  await checkPage(page);

  await page.goto(device);
  await page.getByLabel("Person").selectOption({ label: "Ivo Lund" });
  await page.getByRole("button", { name: "Assign device" }).click();
  await expect(page.getByRole("heading", { name: "With Ivo Lund" })).toBeVisible();

  const member = await browser.newContext({ baseURL, viewport: { width: 320, height: 760 }, isMobile: true, hasTouch: true });
  const viewer = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const ivoPage = await member.newPage();
    await firstSignIn(ivoPage, "ivo@openwarp.example", password);
    await expect(ivoPage.getByRole("link", { name: /Confirm you have laptop WP-100/ })).toBeVisible();
    await ivoPage.goto("/workspace/devices");
    await expect(ivoPage.getByText("WP-101")).toHaveCount(0);
    await ivoPage.getByRole("button", { name: "I have this: WP-100" }).click();
    await ivoPage.getByLabel("Disk encryption is on").check();
    await ivoPage.getByRole("button", { name: "Send security check" }).click();
    await expect(ivoPage.getByText("Security check, next due", { exact: false })).toBeVisible();
    await checkPage(ivoPage);
    await ivoPage.goto("/workspace/devices/apps?request=1");
    await ivoPage.getByLabel("App", { exact: true }).selectOption({ label: "Signal Desk" });
    await ivoPage.getByRole("button", { name: "Send request" }).click();
    await expect(ivoPage.getByText("Requested", { exact: true })).toBeVisible();
    await checkPage(ivoPage);

    await ivoPage.goto("/workspace/training");
    await ivoPage.getByRole("link", { name: "Harbor safety" }).click();
    await expect(ivoPage.getByText("Finish every lesson to take the quiz.")).toBeVisible();
    await expect(ivoPage.getByText("<script>alert(1)</script>", { exact: false })).toBeVisible();
    await ivoPage.getByRole("button", { name: "Mark as done: Welcome" }).click();
    await ivoPage.getByLabel("Blue").check();
    await checkPage(ivoPage);
    await ivoPage.getByRole("button", { name: "Send answers" }).click();
    await expect(ivoPage.getByRole("cell", { name: "Not passed" })).toBeVisible();
    await ivoPage.getByLabel("Red").check();
    await ivoPage.getByRole("button", { name: "Send answers" }).click();
    await expect(ivoPage.getByText("You passed this quiz.")).toBeVisible();
    await ivoPage.getByRole("link", { name: "Certificate", exact: true }).click();
    await expect(ivoPage.getByRole("heading", { name: "Certificate of completion" })).toBeVisible();
    const certificate = new URL(ivoPage.url()).pathname;
    await checkPage(ivoPage);
    await ivoPage.goto(`${ivo}/training`);
    await expect(ivoPage.getByText("100%", { exact: false }).first()).toBeVisible();

    await ivoPage.goto("/workspace/lifecycle/tasks");
    await expect(ivoPage.getByText("Onboarding Juno Marsh")).toBeVisible();
    await ivoPage.getByRole("button", { name: "Complete Walk the pier" }).click();
    await expect(ivoPage.getByRole("button", { name: "Reopen Walk the pier" })).toBeVisible();
    await checkPage(ivoPage);
    for (const path of [device, "/workspace/devices/import", "/workspace/settings/workplace", `${course}/manage`, `${wren}/training`, "/workspace/compliance", "/workspace/compliance/notices", "/workspace/lifecycle", "/workspace/activity"]) {
      await ivoPage.goto(path);
      await expect(ivoPage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
    }
    for (const path of ["/workspace/devices/export", "/workspace/devices/apps/export", "/workspace/training/export", "/workspace/compliance/calendar.ics", "/workspace/reports/export?table=teams", "/workspace/activity/export"]) expect((await ivoPage.request.get(path)).status()).toBe(403);

    const viewerPage = await viewer.newPage();
    await signIn(viewerPage, "viewer@openwarp.example", viewerPassword);
    await expect(viewerPage.getByRole("heading", { name: "People overview" })).toBeVisible();
    for (const path of [course, certificate]) {
      await viewerPage.goto(path);
      await expect(viewerPage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
    }
    await viewerPage.goto("/workspace/devices");
    await expect(viewerPage.getByText("isn’t linked to an employee record", { exact: false })).toBeVisible();
    await expect(viewerPage.getByText("WP-10", { exact: false })).toHaveCount(0);

    await page.goto("/workspace/devices/apps");
    await page.getByRole("button", { name: "Approve Ivo Lund’s Signal Desk access" }).click();
    await page.getByRole("button", { name: "Mark as granted: Ivo Lund’s Signal Desk access" }).click();
    await expect(page.getByRole("button", { name: "Mark as granted: Ivo Lund’s Signal Desk access" })).toHaveCount(0);
    await ivoPage.goto("/workspace/devices/apps");
    await expect(ivoPage.getByText("Has access", { exact: true })).toBeVisible();

    // Compliance.
    await page.goto("/workspace/compliance/register?new=1");
    await page.getByLabel("Name", { exact: true }).fill("Port levy return");
    await page.getByLabel("Jurisdiction").fill("Lisbon");
    await page.getByLabel("Due date").fill(`${year}-01-31`);
    await page.getByLabel("Repeats").selectOption("monthly");
    await page.getByLabel("Account or reference number").fill("PL-2204");
    await page.getByRole("button", { name: "Add obligation" }).click();
    await expect(page.getByRole("heading", { name: `Due Jan 31, ${year}` })).toBeVisible();
    await expect(page.getByText("PL-2204")).toHaveCount(0);
    await page.getByRole("button", { name: "Show number" }).click();
    await expect(page.getByText("PL-2204")).toBeVisible();
    await page.getByLabel("Evidence", { exact: false }).first().setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>") });
    await page.getByRole("button", { name: "Save result" }).click();
    await expect(main.getByRole("alert")).toContainText("PDF, PNG or JPEG");
    await page.getByLabel("Evidence", { exact: false }).first().setInputFiles(pdf);
    await page.getByRole("button", { name: "Save result" }).click();
    await expect(page.getByRole("heading", { name: `Due Feb ${new Date(Date.UTC(year, 2, 0)).getUTCDate()}, ${year}` })).toBeVisible();
    const evidence = await page.getByRole("link", { name: "Evidence for" }).getAttribute("href");
    const file = await page.request.get(evidence!);
    expect(file.headers()["content-disposition"]).toContain("attachment");
    expect((await ivoPage.request.get(evidence!)).status()).toBe(403);
    await checkPage(page);
    expect(await (await page.request.get("/workspace/compliance/calendar.ics")).text()).toContain("SUMMARY:Port levy return");
    await page.goto("/workspace/compliance/notices?new=1");
    await page.getByLabel("Title").fill("Letter from the port");
    await page.getByLabel("Date received").fill("2026-02-10");
    await page.getByLabel("Deadline").fill("2026-02-01");
    await page.getByRole("button", { name: "Record notice" }).click();
    await expect(page.getByText("The deadline must be on or after the date received.")).toBeVisible();
    await page.getByLabel("Deadline").fill("2026-03-01");
    await page.getByRole("button", { name: "Record notice" }).click();
    await expect(page.getByRole("heading", { name: "Letter from the port" })).toBeVisible();
    await page.getByLabel("Status", { exact: true }).selectOption("responded");
    await page.getByLabel("Update note").fill("Sent by post");
    await page.getByRole("button", { name: "Save update" }).click();
    await expect(page.getByText("Sent by post")).toBeVisible();
    await checkPage(page);
    await page.goto("/workspace/compliance/jurisdictions");
    await expect(page.getByRole("listitem").filter({ hasText: "Lisbon" })).toContainText("1 obligation");
    await checkPage(page);
    await page.setViewportSize({ width: 320, height: 760 });
    for (const path of ["/workspace/compliance", "/workspace/compliance/register", "/workspace/compliance/notices", "/workspace/devices", "/workspace/devices/apps", device, "/workspace/training", `${course}/manage`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await checkPage(page);
    }
    await page.emulateMedia({ colorScheme: "dark" });

    // Reports.
    for (const view of ["headcount", "turnover", "time_off", "plan", "workplace"]) {
      await page.goto(`/workspace/reports?view=${view}&from=${year - 2}-01-01&to=${year - 1}-12-31`);
      await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
      await checkPage(page);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/workspace/reports?view=plan");
    await page.getByLabel("Job title").last().fill("Harbor pilot");
    await page.getByLabel("Role team").selectOption({ label: "Harbor Team" });
    await page.getByLabel("Target start").last().fill(`${year}-05-01`);
    await page.getByRole("button", { name: "Add role" }).click();
    await expect(page.getByRole("row", { name: /^Harbor Team/ })).toContainText("4");
    await page.getByLabel("View name").fill("Plan check");
    await page.getByRole("button", { name: "Save this view" }).click();
    await expect(page.getByRole("link", { name: "Plan check" })).toBeVisible();
    expect(await (await page.request.get("/workspace/reports/export?view=headcount&table=locations&location=lisbon")).text()).toContain('"Lisbon","2","100%"');
    expect((await page.request.get("/workspace/reports/export?table=nothing")).status()).toBe(404);

    // Activity.
    await page.goto("/workspace/activity");
    await page.getByLabel("About").fill("Ivo Lund");
    await page.getByLabel("Kind").selectOption("training");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText(/^Completed training/).first()).toBeVisible();
    await expect(page.getByText(/^Assigned a device/)).toHaveCount(0);
    await checkPage(page);
    const log = await (await page.request.get("/workspace/activity/export?group=device")).text();
    expect(log).toContain('"Confirmed a device"');
    expect(log).not.toContain("PL-2204");
    await page.goto("/workspace/activity?group=activity");
    await expect(page.getByText("Exported activity", { exact: true })).toBeVisible();

    // Offboarding waits for the device and the critical app.
    await page.goto(`${ivo}/offboard`);
    await page.getByLabel("Last day").fill(`${year}-06-30`);
    await page.getByRole("button", { name: "Start offboarding" }).click();
    const buttons = page.locator("#checklist").getByRole("button", { name: /^Complete / });
    await expect(page.getByRole("button", { name: "Complete Collect laptop WP-100" })).toBeVisible();
    for (let left = await buttons.count(); left > 0; left -= 1) {
      await buttons.first().click();
      await expect(buttons).toHaveCount(left - 1);
    }
    const archive = async () => {
      await page.getByRole("button", { name: "Archive profile" }).click();
      await page.getByRole("button", { name: "Archive now" }).click();
    };
    await archive();
    await expect(main.getByRole("alert")).toContainText("Record the return of WP-100.");
    await expect(main.getByRole("alert")).toContainText("Record that access to Signal Desk was removed.");
    await ivoPage.goto("/workspace/devices");
    await ivoPage.getByRole("button", { name: "I’ve sent it back: WP-100" }).click();
    await ivoPage.getByRole("dialog").getByRole("button", { name: "Yes, I sent it" }).click();
    await expect(ivoPage.getByText("You sent this back.", { exact: false })).toBeVisible();
    await page.goto(device);
    await page.getByRole("button", { name: "Record return" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record device return" }).click();
    await expect(page.getByRole("heading", { name: "Assign", exact: true })).toBeVisible();
    await page.goto("/workspace/devices/apps");
    await page.getByRole("link", { name: "Signal Desk" }).click();
    await page.getByRole("button", { name: "Mark as removed: Ivo Lund’s Signal Desk access" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record removal" }).click();
    await expect(page.getByRole("heading", { name: "Past access and requests" })).toBeVisible();
    await page.goto(ivo);
    await archive();
    await expect(page.getByRole("link", { name: "Restart onboarding" })).toBeVisible();
    await page.goto(juno);
    await expect(page.getByRole("heading", { name: "Juno Marsh" })).toBeVisible();
  } finally {
    await member.close();
    await viewer.close();
  }
});
