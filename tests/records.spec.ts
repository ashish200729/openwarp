import { test, expect, type Page } from "@playwright/test";
import { checkPage, signIn } from "./support";

const adminPassword = process.env.OPENWARP_E2E_ADMIN_PASSWORD!;
const viewerPassword = process.env.OPENWARP_E2E_VIEWER_PASSWORD!;
const pdf = { name: "file.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 records") };
const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

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
  await page.getByLabel("Temporary password").fill(temporary);
  await page.getByLabel("New password", { exact: true }).fill(`${temporary}-new`);
  await page.getByLabel("Confirm new password").fill(`${temporary}-new`);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();
  return `${temporary}-new`;
}

async function unavailable(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
}

test("records, signatures and onboarding follow each role", async ({ page, browser, baseURL }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, "admin@openwarp.example", adminPassword);
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();

  // What new hires get, set up before anyone joins.
  await page.goto("/workspace/settings/fields?new=1");
  await page.getByLabel("Label", { exact: true }).fill("Shirt size");
  await page.getByLabel("Type", { exact: true }).selectOption("choice");
  await page.getByLabel("Choices").fill("Small");
  await page.getByLabel("Ask for it during onboarding").check();
  await page.getByRole("button", { name: "Save field" }).click();
  await expect(page.getByText("Enter at least two choices, one on each line.")).toBeVisible();
  await page.getByLabel("Choices").fill("Small\nLarge");
  await page.getByLabel("People can fill it in themselves").check();
  await page.getByRole("button", { name: "Save field" }).click();
  await expect(page.getByRole("status")).toContainText("Field saved.");
  await checkPage(page);
  await checkNarrow(page);

  await page.goto("/workspace/settings/templates");
  await expect(page.getByText("Starting point. Have it reviewed by counsel before use.")).toHaveCount(3);
  await page.getByRole("link", { name: "Edit Confidentiality agreement" }).click();
  await page.getByLabel("Text", { exact: true }).fill("# Confidentiality agreement\n\nBetween {{company_name}} and **{{full_name}}**, {{nickname}}.\n\n- Keep it private");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Unknown merge fields: {{nickname}}.", { exact: false })).toBeVisible();
  await page.getByLabel("Text", { exact: true }).fill("# Confidentiality agreement\n\nBetween {{company_name}} and **{{full_name}}**, <b>starting</b> {{start_date}}.\n\n- Keep it private");
  await page.getByLabel("Include for new hires").check();
  await page.getByRole("group", { name: "New hires it applies to" }).getByLabel("Full-time").check();
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Have counsel review");
  await page.getByLabel("Counsel has reviewed this text").check();
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("status")).toContainText("Template saved.");
  await page.getByLabel("Document to ask for").fill("Passport copy");
  await page.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByText("Passport copy", { exact: true })).toBeVisible();
  await checkPage(page);
  await checkNarrow(page);

  await page.goto("/workspace/people/import");
  await page.getByLabel("CSV file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from("first_name,last_name,email,title,team,manager_email,employment_type,start_date,status\nNora,Quill,nora.quill@openwarp.example,Archivist,Records crew,,full_time,2026-01-05,onboarding\n") });
  await page.getByRole("button", { name: "Check file" }).click();
  await page.getByRole("button", { name: "Import 1 p" }).click();
  await expect(page).toHaveURL(/imported=1/);
  await page.goto("/workspace/people?q=nora.quill");
  await page.getByRole("link", { name: /Nora Quill/ }).click();
  await page.waitForURL(/people\/[0-9a-f-]{36}$/);
  const nora = new URL(page.url()).pathname;
  const id = nora.split("/").at(-1)!;
  const temporary = await createAccount(page, "Nora Quill");

  const member = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const outsider = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  try {
    const own = await member.newPage();
    const password = await firstSignIn(own, "nora.quill@openwarp.example", temporary);

    await own.goto("/workspace/onboarding");
    await expect(own.getByRole("heading", { name: "Get set up" })).toBeVisible();
    for (const step of ["Add your personal details", "Add an emergency contact", "Fill in the remaining details", "Sign your documents", "Upload the documents we asked for", "Add your bank details"]) await expect(own.getByRole("link", { name: new RegExp(`${step}.*To do`) })).toBeVisible();
    await checkPage(own);

    await own.getByRole("link", { name: /Add your personal details/ }).click();
    await own.getByLabel(/^Phone/).fill("call me");
    await own.getByLabel("Preferred name").fill("Nor");
    await own.getByLabel("Date of birth").fill("1991-04-12");
    await own.getByLabel("Address line 1").fill("4 Hidden Lane");
    await own.getByRole("button", { name: "Save details" }).click();
    await expect(own.getByText("Enter a phone number such as +1 555 010 2030.")).toBeVisible();
    await own.getByLabel(/^Phone/).fill("+1 555 010 2030");
    await own.getByRole("button", { name: "Save details" }).click();
    await expect(own.getByRole("status")).toContainText("Personal details saved.");
    await expect(own.getByText("4 Hidden Lane")).toBeVisible();
    await own.getByRole("link", { name: "Add contact" }).click();
    await own.getByLabel("Full name").fill("Iris Quill");
    await own.getByLabel("Relationship").fill("Sister");
    await own.getByLabel("Phone", { exact: true }).fill("+1 555 010 2040");
    await own.getByRole("button", { name: "Save contact" }).click();
    await expect(own.getByText("Iris Quill", { exact: false }).first()).toBeVisible();
    await own.getByRole("link", { name: "Edit other details" }).click();
    await own.getByLabel("Shirt size").selectOption("Large");
    await own.getByRole("button", { name: "Save details" }).click();
    await expect(own.getByRole("status")).toContainText("Details saved.");
    await own.getByRole("link", { name: "Request a change to national id" }).click();
    await own.getByLabel("National or tax ID").fill("QX99887766");
    await own.getByRole("button", { name: "Send request" }).click();
    await expect(own.getByText("••••7766", { exact: false })).toBeVisible();
    await own.getByRole("link", { name: "Request a change to legal name" }).click();
    await own.getByLabel("Last name").fill("Quillon");
    await own.getByRole("button", { name: "Send request" }).click();
    await expect(own.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
    await expect(own.getByRole("button", { name: /^Show/ })).toHaveCount(0);
    await checkPage(own);

    await own.goto("/workspace/documents/requests");
    const request = own.getByRole("listitem").filter({ hasText: "Passport copy" });
    await request.getByLabel("Your file for Passport copy").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
    await request.getByRole("button", { name: "Upload" }).click();
    await expect(own.getByRole("main").getByRole("alert")).toContainText("PDF, PNG or JPEG");
    await request.getByLabel("Your file for Passport copy").setInputFiles(pdf);
    await request.getByLabel("Expires on").fill(soon);
    await request.getByRole("button", { name: "Upload" }).click();
    await expect(own.getByRole("status")).toContainText("File uploaded.");
    await checkPage(own);

    // The exact text, the typed name, consent and the password are all needed.
    await own.goto("/workspace/documents/signatures");
    await own.getByRole("link", { name: "Confidentiality agreement" }).click();
    await own.waitForURL(/signatures\/[0-9a-f-]{36}$/);
    const document = new URL(own.url()).pathname;
    await expect(own.getByText("<b>starting</b> Jan 5, 2026", { exact: false })).toBeVisible();
    await expect(own.getByText("{{", { exact: false })).toHaveCount(0);
    const consent = own.getByLabel("I have read this document in full.", { exact: false });
    await own.getByLabel("Your full name").fill("Nora");
    await own.getByLabel("Your password").fill(password);
    await own.getByRole("button", { name: "Sign document" }).click();
    await expect(own.getByRole("main").getByRole("alert")).toContainText("Tick the box");
    await consent.check();
    await own.getByRole("button", { name: "Sign document" }).click();
    await expect(own.getByRole("main").getByRole("alert")).toContainText("Type your full name as it appears");
    await own.getByLabel("Your full name").fill("Nora Quill");
    await own.getByLabel("Your password").fill("not the password");
    await own.getByRole("button", { name: "Sign document" }).click();
    await expect(own.getByRole("main").getByRole("alert")).toContainText("That isn’t your current password.");
    await checkPage(own);
    await own.getByLabel("Your password").fill(password);
    await own.getByRole("button", { name: "Sign document" }).click();
    await expect(own.getByText("Signed. Your signature is recorded.")).toBeVisible();
    await expect(own.getByText("The content and the signing record match what was recorded.")).toBeVisible();
    await expect(own.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible();
    await expect(own.getByText("Typed name: Nora Quill")).toBeVisible();
    await checkPage(own);

    for (const path of ["/workspace/settings/fields", "/workspace/settings/templates"]) await unavailable(own, path);
    await own.goto("/workspace/documents/requests?new=1");
    await expect(own.getByRole("heading", { name: "Ask for a document" })).toHaveCount(0);
    await own.goto("/workspace/onboarding");
    for (const step of ["Add your personal details", "Add an emergency contact", "Fill in the remaining details", "Sign your documents", "Upload the documents we asked for"]) await expect(own.getByRole("link", { name: new RegExp(`${step}.*Done`) })).toBeVisible();

    // An account without a link to this person sees none of it.
    const viewer = await outsider.newPage();
    await signIn(viewer, "viewer@openwarp.example", viewerPassword);
    await expect(viewer.getByRole("heading", { name: "People overview" })).toBeVisible();
    for (const path of [`${nora}/personal`, `${nora}/documents`, document, `/workspace/onboarding?employee=${id}`]) await unavailable(viewer, path);
    expect((await viewer.request.get("/workspace/settings/fields/export")).status()).toBe(403);
    expect((await viewer.request.get(`${document}/file`)).status()).toBe(404);

    await page.goto(`${nora}/personal`);
    await expect(page.getByText("••••7766")).toBeVisible();
    await expect(page.getByText("QX99887766")).toHaveCount(0);
    await page.getByRole("button", { name: "Show the requested national ID" }).click();
    await expect(page.getByText("QX99887766")).toBeVisible();
    await page.getByRole("button", { name: "Approve the national id change" }).click();
    await expect(page.getByRole("button", { name: "Show the national ID" })).toBeVisible();
    await page.getByRole("button", { name: "Approve the legal name change" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Nora Quillon" })).toBeVisible();
    await expect(page.getByText("through an approved request", { exact: false }).first()).toBeVisible();
    await checkPage(page);
    await checkNarrow(page);
    await page.goto("/workspace/activity");
    await expect(page.getByText("Viewed a national ID").first()).toBeVisible();
    await expect(page.getByText("QX99887766")).toHaveCount(0);
    await page.goto(`/workspace/onboarding?employee=${id}`);
    await expect(page.getByRole("heading", { name: "Onboarding for Nora Quillon" })).toBeVisible();
    await checkPage(page);
    expect(await (await page.request.get("/workspace/settings/fields/export")).text()).toContain('"Large"');

    await page.goto("/workspace/documents/requests");
    const review = page.getByRole("listitem").filter({ hasText: "Nora Quillon" });
    await review.locator("summary").click();
    await review.getByLabel("What needs to change").fill("The photo is cut off.");
    await review.getByRole("button", { name: "Return", exact: true }).click();
    await expect(page.getByText("The photo is cut off.")).toBeVisible();
    await checkPage(page);
    await own.goto("/workspace/documents/requests");
    await request.getByLabel("Your file for Passport copy").setInputFiles(pdf);
    await request.getByLabel("Expires on").fill(soon);
    await request.getByRole("button", { name: "Upload" }).click();
    await expect(own.getByRole("status")).toContainText("File uploaded.");
    await page.goto("/workspace/documents/requests");
    await page.getByRole("button", { name: "Accept Passport copy from Nora Quillon" }).click();
    await expect(page.getByText("No uploads are waiting for review.")).toBeVisible();
    await page.goto("/workspace/documents?q=passport&category=other");
    await expect(page.getByText("No documents match.").first()).toBeVisible();
    await page.goto("/workspace/documents?q=passport");
    await expect(page.getByText(/version 2/)).toBeVisible();
    await checkPage(page);
    await checkNarrow(page);
    await page.getByRole("link", { name: "Details" }).click();
    const first = await page.getByRole("link", { name: "Version 1" }).getAttribute("href");
    expect((await page.request.get(first!)).status()).toBe(200);
    expect((await own.request.get(first!)).status()).toBe(404);
    await page.getByLabel("Folder").fill("Identity papers");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status")).toContainText("Details saved.");
    await checkPage(page);
    await checkNarrow(page);

    // A PDF has to be opened before it can be signed, and an administrator can void what is still waiting.
    await page.goto(`/workspace/documents/signatures?new=pdf&employee=${id}`);
    await page.getByLabel("PDF").setInputFiles(pdf);
    await page.getByLabel("Document name").fill("Equipment terms");
    await page.getByRole("button", { name: "Prepare draft" }).click();
    await expect(page.getByRole("heading", { name: "Equipment terms" })).toBeVisible();
    const terms = new URL(page.url()).pathname;
    await unavailable(own, terms);
    await page.getByRole("button", { name: "Send for signature" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send document" }).click();
    await expect(page.getByText("Sent for signature.", { exact: true })).toBeVisible();
    await checkPage(page);
    await own.goto(terms);
    await expect(own.getByRole("button", { name: "Sign document" })).toHaveCount(0);
    // A later profile edit must not change the signer identity captured with the sent file.
    await page.goto(`${nora}/edit`);
    await page.getByLabel("Last name").fill("Quillon-New");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Nora Quillon-New", exact: true })).toBeVisible();
    const file = await own.request.get(`${terms}/file`);
    expect(file.headers()["content-disposition"]).toContain("attachment");
    await own.reload();
    await expect(own.getByRole("button", { name: "Sign document" })).toBeVisible();
    await expect(own.getByText("Type it as Nora Quillon.", { exact: true })).toBeVisible();
    await page.goto(`${nora}/edit`);
    await page.getByLabel("Last name").fill("Quillon");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Nora Quillon", exact: true })).toBeVisible();
    await page.goto(terms);
    await page.locator("summary").filter({ hasText: "Void this document" }).click();
    await page.getByLabel("Reason for voiding").fill("Wrong file");
    await page.getByRole("button", { name: "Void", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Void document" }).click();
    await expect(page.getByText("Document voided.")).toBeVisible();
    await own.reload();
    await expect(own.getByRole("button", { name: "Sign document" })).toHaveCount(0);

    await page.goto(`/workspace/documents/signatures?new=template&employee=${id}`);
    await page.getByLabel("Template").selectOption({ label: "Offer letter (starting point)" });
    await page.getByRole("button", { name: "Prepare draft" }).click();
    await expect(page.getByText("No value yet for", { exact: false })).toContainText("current pay");
    await expect(page.getByRole("button", { name: "Send for signature" })).toHaveCount(0);
    await checkPage(page);
    await checkNarrow(page);
    await page.locator("summary").filter({ hasText: "Void this document" }).click();
    await page.getByLabel("Reason for voiding").fill("Not needed");
    await page.getByRole("button", { name: "Void", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Void document" }).click();
    await expect(page.getByText("Document voided.")).toBeVisible();

    await page.goto("/workspace/announcements?new=1");
    await page.getByLabel("Title", { exact: true }).fill("Records room moves");
    await page.getByLabel("Message").fill("Please read **all of this**.\n\n- Boxes by Friday");
    await page.getByLabel("Last day shown").fill("2020-01-01");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("The last day must be on or after the first day.")).toBeVisible();
    await page.getByLabel("Last day shown").fill("");
    await page.getByLabel("For", { exact: true }).selectOption({ label: "Records crew team" });
    await page.getByLabel("Ask people to acknowledge it").check();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("0 of 1 acknowledged", { exact: false })).toBeVisible();
    await checkPage(page);
    await checkNarrow(page);
    await viewer.goto("/workspace/announcements");
    await expect(viewer.getByText("Records room moves")).toHaveCount(0);
    await own.goto("/workspace/announcements");
    await own.getByRole("button", { name: "I’ve read this: Records room moves" }).click();
    await expect(own.getByText("Acknowledged", { exact: true })).toBeVisible();
    await checkPage(own);

    // Later specs add new hires, so the defaults go back to nothing.
    await page.goto("/workspace/settings/templates");
    await page.getByRole("button", { name: "Remove Passport copy" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove document" }).click();
    await expect(page.getByText("New hires aren’t asked to upload anything.")).toBeVisible();
    await page.getByRole("button", { name: "Archive Confidentiality agreement" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive template" }).click();
    await expect(page.getByRole("button", { name: "Archive Confidentiality agreement" })).toHaveCount(0);
    await page.goto("/workspace/settings/fields");
    await page.getByRole("button", { name: "Archive Shirt size" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive field" }).click();
    await expect(page.getByRole("button", { name: "Restore Shirt size" })).toBeVisible();
  } finally {
    await member.close();
    await outsider.close();
  }
});
