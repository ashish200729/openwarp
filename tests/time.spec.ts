import { test, expect, type Page } from "@playwright/test";
import { checkPage, signIn } from "./support";

const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD!;
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
const now = new Date();
const today = now.toISOString().slice(0, 10);
const thisWeek = addDays(today, -((now.getUTCDay() + 6) % 7));
const lastWeek = addDays(thisWeek, -7);
const nextWeek = addDays(thisWeek, 7);
const nextYear = now.getUTCFullYear() + 1;
// The first Tuesday of next March.
const leaveDay = Array.from({ length: 7 }, (_, index) => `${nextYear}-03-0${index + 1}`).find((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 2)!;

async function checkNarrow(page: Page) {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 800 });
  await checkPage(page);
  await page.setViewportSize(size);
}

async function createAccount(page: Page, employee: string) {
  await page.goto("/workspace/settings/access");
  await page.getByLabel("Employee record").last().selectOption({ label: employee });
  await page.getByRole("button", { name: "Create account" }).click();
  return (await page.getByRole("status").locator("code").textContent())!;
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

async function profilePath(page: Page, name: string) {
  await page.goto(`/workspace/people?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await page.waitForURL(/people\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

const mainAlert = (page: Page) => page.getByRole("main").getByRole("alert");
const saved = (page: Page, text: string) => expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();

test("time tracking, scheduling and time off policies follow each role", async ({ page, browser, baseURL, request }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await request.get(`/workspace/timesheets/export?week=${lastWeek}`)).status()).toBe(401);
  await signIn(page, "admin@openwarp.example", adminPassword);
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();

  await page.goto("/workspace/people/import");
  await page.getByLabel("CSV file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from("first_name,last_name,email,title,team,manager_email,employment_type,start_date,status\nLea,Moss,lea@openwarp.example,Crew lead,Time Crew,,full_time,2024-01-08,active\nIna,Vale,ina@openwarp.example,Technician,Time Crew,lea@openwarp.example,full_time,2024-02-05,active\nRob,Finch,rob@openwarp.example,Technician,Time Crew,lea@openwarp.example,full_time,2024-03-04,active\n") });
  await page.getByRole("button", { name: "Check file" }).click();
  await page.getByRole("button", { name: "Import 3 people" }).click();
  await saved(page, "3 people imported.");
  const ina = await profilePath(page, "Ina Vale");
  const inaId = ina.split("/").at(-1)!;
  await page.goto(`${ina}/job`);
  await page.getByLabel("Amount in USD").fill("40");
  await page.getByLabel("Basis").selectOption("hourly");
  await page.getByRole("button", { name: "Record pay" }).click();
  await expect(page.getByText("$40.00 per hour")).toBeVisible();

  await page.goto("/workspace/settings/time");
  await page.getByLabel("Weekly overtime after, in hours").fill("0");
  await page.getByRole("button", { name: "Save time tracking" }).click();
  await expect(page.getByText("Enter between 1 and 168 hours.")).toBeVisible();
  await page.getByLabel("Weekly overtime after, in hours").fill("40");
  await page.getByLabel("Overtime multiplier").fill("1.5");
  await page.getByRole("button", { name: "Save time tracking" }).click();
  await saved(page, "Time tracking saved.");
  const policy = page.getByRole("listitem").filter({ hasText: "Sick leave" });
  const setNotice = async (days: string) => {
    await page.goto("/workspace/settings/time");
    await policy.locator("summary").click();
    await policy.getByLabel("Notice in days").fill(days);
    await policy.getByRole("button", { name: "Save policy" }).click();
    await saved(page, "Policy saved.");
  };
  await setNotice("30");
  await policy.locator("summary").click();
  await checkPage(page);
  await checkNarrow(page);

  const leaPassword = await createAccount(page, "Lea Moss");
  const inaPassword = await createAccount(page, "Ina Vale");
  const member = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const manager = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const inaPage = await member.newPage();
    const leaPage = await manager.newPage();
    await firstSignIn(inaPage, "ina@openwarp.example", inaPassword);
    await firstSignIn(leaPage, "lea@openwarp.example", leaPassword);

    // The clock.
    await inaPage.goto("/workspace/timesheets");
    await inaPage.getByRole("button", { name: "Clock in" }).click();
    await expect(inaPage.getByRole("timer")).toBeVisible();
    await expect(inaPage.getByText("Clock out before submitting this week.")).toBeVisible();
    await inaPage.getByRole("button", { name: "Start break" }).click();
    await expect(inaPage.getByText("On a break since", { exact: false })).toBeVisible();
    await checkPage(inaPage);
    await inaPage.reload();
    await inaPage.getByRole("button", { name: "End break" }).click();
    await expect(inaPage.getByRole("button", { name: "Start break" })).toBeVisible();
    await inaPage.getByRole("button", { name: "Clock out" }).click();
    await expect(inaPage.getByText("You aren’t clocked in.")).toBeVisible();

    // Last week by hand, with refusals along the way.
    await inaPage.goto("/workspace");
    await expect(inaPage.getByRole("link", { name: /Submit last week’s timesheet/ })).toBeVisible();
    const add = async (day: string, start: string, end: string, rest = "0") => {
      await inaPage.goto(`/workspace/timesheets?week=${lastWeek}&new=1`);
      await inaPage.getByLabel("Day", { exact: true }).selectOption(day);
      await inaPage.getByLabel("Start", { exact: true }).fill(start);
      await inaPage.getByLabel("End", { exact: true }).fill(end);
      await inaPage.getByLabel("Break in minutes").fill(rest);
      await inaPage.getByRole("button", { name: "Add entry" }).click();
    };
    await add(lastWeek, "09:00", "10:00", "90");
    await expect(mainAlert(inaPage)).toContainText("The break is longer than the entry.");
    for (let day = 0; day < 5; day += 1) {
      await add(addDays(lastWeek, day), "09:00", "18:00", "60");
      await saved(inaPage, "Entry saved.");
    }
    await add(addDays(lastWeek, 4), "17:00", "19:00");
    await expect(mainAlert(inaPage)).toContainText("This overlaps another entry.");
    await add(addDays(lastWeek, 5), "23:00", "01:00");
    await saved(inaPage, "Entry saved.");
    await expect(inaPage.getByText("23:00 to 01:00 the next day")).toBeVisible();
    await expect(inaPage.getByText("2h overtime")).toBeVisible();
    await checkPage(inaPage);
    await checkNarrow(inaPage);
    await inaPage.getByRole("button", { name: "Submit week" }).click();
    await inaPage.getByRole("dialog").getByRole("button", { name: "Submit timesheet" }).click();
    await expect(inaPage.getByRole("button", { name: "Withdraw timesheet" })).toBeVisible();
    await expect(inaPage.getByRole("link", { name: "Add time" })).toHaveCount(0);

    // The manager returns it, then approves it.
    await leaPage.goto("/workspace/timesheets");
    await leaPage.getByRole("link", { name: /Ina Vale/ }).click();
    await expect(leaPage.getByRole("heading", { name: "Ina Vale" })).toBeVisible();
    await expect(leaPage.getByRole("link", { name: "Add time" })).toHaveCount(0);
    await leaPage.getByLabel("What needs to change").fill("Saturday ended at 00:30.");
    await leaPage.getByRole("button", { name: "Return" }).click();
    await expect(leaPage.getByRole("button", { name: "Approve Ina Vale’s timesheet" })).toHaveCount(0);
    await inaPage.goto(`/workspace/timesheets?week=${lastWeek}`);
    await expect(inaPage.getByText("Saturday ended at 00:30.")).toBeVisible();
    await inaPage.getByRole("link", { name: /^Edit .*23:00 to 01:00/ }).click();
    await inaPage.getByLabel("End", { exact: true }).fill("00:30");
    await inaPage.getByRole("button", { name: "Save entry" }).click();
    await saved(inaPage, "Entry saved.");
    await inaPage.getByRole("button", { name: "Submit week" }).click();
    await inaPage.getByRole("dialog").getByRole("button", { name: "Submit timesheet" }).click();
    await expect(inaPage.getByRole("button", { name: "Withdraw timesheet" })).toBeVisible();
    await leaPage.reload();
    await leaPage.getByRole("button", { name: "Approve Ina Vale’s timesheet" }).click();
    await expect(leaPage.getByText("Approved", { exact: true })).toBeVisible();
    await expect(leaPage.getByRole("button", { name: /^Reopen/ })).toHaveCount(0);
    await leaPage.getByText("History", { exact: true }).click();
    await expect(leaPage.getByText("23:00 to 01:00, 0m break, now 23:00 to 00:30, 0m break", { exact: false })).toBeVisible();
    await checkPage(leaPage);
    await leaPage.goto(`/workspace/timesheets/team?week=${lastWeek}&state=approved`);
    await expect(leaPage.getByRole("row", { name: /Ina Vale/ })).toContainText("41h 30m");
    await checkPage(leaPage);
    await checkNarrow(leaPage);
    expect((await leaPage.request.get(`/workspace/timesheets/export?week=${lastWeek}`)).status()).toBe(403);
    const csv = await page.request.get(`/workspace/timesheets/export?week=${lastWeek}`);
    expect(csv.headers()["content-disposition"]).toContain("attachment");
    expect(await csv.text()).toContain('"Ina Vale","ina@openwarp.example","Time Crew"');

    for (const path of ["/workspace/timesheets/team", "/workspace/settings/time", `/workspace/timesheets/${(await profilePath(page, "Rob Finch")).split("/").at(-1)}`]) {
      await inaPage.goto(path);
      await expect(inaPage.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
    }

    // Administrators reopen and change time with a reason.
    await page.goto(`/workspace/timesheets/${inaId}?week=${lastWeek}`);
    await page.getByRole("button", { name: "Reopen Ina Vale’s timesheet" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reopen timesheet" }).click();
    await page.getByRole("link", { name: /^Edit .*23:00 to 00:30/ }).click();
    await page.getByLabel("Reason for removing it").fill("Recorded twice");
    await page.getByRole("button", { name: "Remove entry" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove entry" }).click();
    await saved(page, "Entry removed.");
    await page.getByRole("button", { name: "Submit week for Ina Vale" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Submit timesheet" }).click();
    await page.getByRole("button", { name: "Approve Ina Vale’s timesheet" }).click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();

    // Shifts stay hidden until they are published.
    const shift = async (start: string, end: string) => {
      await leaPage.goto(`/workspace/schedule?week=${nextWeek}&new=1`);
      await leaPage.getByLabel("Person", { exact: true }).selectOption({ label: "Ina Vale" });
      await leaPage.getByLabel("Date", { exact: true }).fill(addDays(nextWeek, 1));
      await leaPage.getByLabel("Start", { exact: true }).fill(start);
      await leaPage.getByLabel("End", { exact: true }).fill(end);
      await leaPage.getByLabel("Role").fill("Night desk");
      await leaPage.getByRole("button", { name: "Add draft" }).click();
    };
    await shift("22:00", "06:00");
    await saved(leaPage, "Shift saved.");
    await shift("20:00", "23:00");
    await expect(mainAlert(leaPage)).toContainText("This overlaps another shift for this person.");
    await inaPage.goto(`/workspace/schedule?week=${nextWeek}`);
    await expect(inaPage.getByText("You have no published shifts this week.")).toBeVisible();
    await expect(inaPage.getByRole("link", { name: "Add shift" })).toHaveCount(0);
    await leaPage.goto(`/workspace/schedule?week=${nextWeek}`);
    await checkPage(leaPage);
    await leaPage.getByRole("button", { name: "Publish 1 shift" }).click();
    await leaPage.getByRole("dialog").getByRole("button", { name: "Publish shifts" }).click();
    await saved(leaPage, "1 shift published.");
    await leaPage.getByRole("button", { name: "Copy to next week" }).click();
    await leaPage.getByRole("dialog").getByRole("button", { name: "Copy shifts" }).click();
    await saved(leaPage, "1 shift copied as drafts.");
    await expect(leaPage.getByText("Draft", { exact: true }).first()).toBeVisible();
    await inaPage.reload();
    await expect(inaPage.getByText("Night desk").filter({ visible: true })).toBeVisible();
    await checkPage(inaPage);
    await checkNarrow(inaPage);
    await inaPage.goto("/workspace/notifications");
    await expect(inaPage.getByText("Your shifts were published")).toBeVisible();

    // Notice, coverage, entering time off for someone and balance adjustments.
    await inaPage.goto("/workspace/time-off?new=1");
    await inaPage.getByLabel("Type").selectOption({ label: "Sick leave" });
    await inaPage.getByRole("button", { name: "Send request" }).click();
    await expect(mainAlert(inaPage)).toContainText(/of notice|weekends or company holidays/);
    await setNotice("0");
    await page.goto("/workspace/time-off?record=1");
    await page.getByLabel("Person", { exact: true }).selectOption({ label: "Rob Finch" });
    await page.getByLabel("Type").selectOption({ label: "Vacation" });
    await page.getByLabel("First day").fill("2024-03-01");
    await page.getByLabel("Last day off").fill("2024-03-04");
    await page.getByRole("button", { name: "Enter time off" }).click();
    await expect(mainAlert(page)).toContainText("outside this person’s employment dates");
    await page.getByLabel("First day").fill(leaveDay);
    await page.getByLabel("Last day off").fill(leaveDay);
    await checkPage(page);
    await page.getByRole("button", { name: "Enter time off" }).click();
    await saved(page, "Time off entered and approved.");
    await inaPage.goto("/workspace/time-off?new=1");
    await inaPage.getByLabel("Type").selectOption({ label: "Vacation" });
    await inaPage.getByLabel("First day").fill(leaveDay);
    await inaPage.getByLabel("Last day off").fill(leaveDay);
    await inaPage.getByRole("button", { name: "Send request" }).click();
    await saved(inaPage, "Request sent for approval.");
    await leaPage.goto("/workspace/time-off");
    await expect(leaPage.getByText("1 of 2 others on Time Crew away: Rob Finch")).toBeVisible();
    await leaPage.getByRole("button", { name: "Approve Ina Vale’s Vacation" }).click();
    await expect(leaPage.getByText("No requests are waiting.")).toBeVisible();
    await page.goto(`${ina}/time-off?adjust=1`);
    await page.getByLabel("Type").selectOption({ label: "Vacation" });
    await page.getByLabel("Days", { exact: true }).fill("1.3");
    await page.getByLabel("Reason").fill("Carried over by agreement");
    await page.getByRole("button", { name: "Record adjustment" }).click();
    await expect(page.getByText("Enter days such as 2, 0.5 or -1.")).toBeVisible();
    await page.getByLabel("Days", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Record adjustment" }).click();
    await saved(page, "Balance adjusted.");
    await expect(page.getByText("left of 22")).toBeVisible();
    await checkPage(page);
    await inaPage.goto(`${ina}/time-off?adjust=1`);
    await expect(inaPage.getByText("Carried over by agreement")).toBeVisible();
    await expect(inaPage.getByRole("button", { name: "Record adjustment" })).toHaveCount(0);
    await checkPage(inaPage);
  } finally {
    await member.close();
    await manager.close();
  }
});

test("approved time off stays on the shared calendar while its owner is offboarding", async ({ page }) => {
  const name = "Wren Leaver";
  await signIn(page, "admin@openwarp.example", adminPassword);
  await page.goto("/workspace/people/new");
  await page.getByLabel("First name").fill("Wren");
  await page.getByLabel("Last name").fill("Leaver");
  await page.getByLabel("Work email").fill("wren.leaver@openwarp.example");
  await page.getByLabel("Job title").fill("Support specialist");
  await page.getByLabel("Start date").fill("2025-01-06");
  await page.getByLabel("Starting status").selectOption("active");
  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const profile = new URL(page.url()).pathname;

  await page.goto("/workspace/time-off?record=1");
  await page.getByLabel("Person", { exact: true }).selectOption({ label: name });
  await page.getByLabel("Type").selectOption({ label: "Vacation" });
  await page.getByLabel("First day").fill(leaveDay);
  await page.getByLabel("Last day off").fill(leaveDay);
  await page.getByRole("button", { name: "Enter time off" }).click();
  await saved(page, "Time off entered and approved.");

  // Someone working out their notice is still employed, so their approved leave stays visible.
  await page.goto(profile);
  await page.getByRole("link", { name: "Start offboarding" }).click();
  await page.getByLabel("Last day").fill(`${nextYear}-03-31`);
  await page.getByRole("button", { name: "Start offboarding" }).click();
  await expect(page.getByRole("heading", { name: "Offboarding checklist" })).toBeVisible();
  await page.goto(`/workspace/time-off?month=${leaveDay.slice(0, 7)}`);
  const dayCell = page.getByRole("table", { name: /^Approved time off in/ }).getByRole("cell").filter({ hasText: name });
  const link = dayCell.getByRole("link", { name });
  if (!await link.isVisible()) await dayCell.locator("summary").click();
  await expect(link).toBeVisible();
});
