/* The main flow of this delivery, in a browser: sign in, make a project, convert a pasted
   specification into it, read and fill the record, run the AI review (stand-in model), check the
   compliance review screen sees the conversion. Runs on the offline local site. */
import { test, expect, type Page } from "@playwright/test";

const SPEC = `PART 1 - GENERAL
1.01 SUMMARY
A. This section includes factory assembled air handling units with fans, coils, filters and controls.
PART 2 - PRODUCTS
2.01 CASING
A. Casing shall be double skin construction with 50 mm thick panels and thermal break profiles.
B. Panels shall be insulated with 50 mm injected polyurethane foam of density not less than 40 kg/m3.
2.02 FANS
A. Fans shall be plug type with backward curved blades, directly driven by EC motors.
B. Fan and motor assembly shall be mounted on a common base with anti-vibration mounts.
PART 3 - EXECUTION
3.01 INSTALLATION
A. Install units level and plumb in accordance with the manufacturer's written instructions.`;

/* The record made by the first test, found through the API (each Playwright project runs in its own worker). */
async function findRun(page: Page): Promise<string> {
  const api = async (name: string, body: Record<string, unknown>) => (await page.request.post("/api/rpc/" + name, { data: body })).json();
  const login = await api("app_login", { p_username: "admin", p_password: "admin12345" });
  const list = await api("pr_list", { p_token: login.token });
  const pj = list.projects.find((x: any) => x.name.startsWith("E2E Tower"));
  if (!pj) throw new Error("the first test did not leave a project");
  const got = await api("pr_get", { p_token: login.token, p_id: pj.id });
  await api("app_logout", { p_token: login.token });
  return got.runs[0].id;
}

async function signIn(page: Page, user: string, password: string) {
  await page.goto("/index.html");
  await page.fill('#loginForm [name="username"]', user);
  await page.fill('#loginForm [name="password"]', password);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL(/dashboard\.html/);
}

test.describe("Compliance Maker on the new site", () => {
  test.describe.configure({ mode: "serial" });
  const name = "E2E Tower " + Date.now();
  let runId = "";

  test("sign in, create a project, convert a pasted specification, read and fill the record", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop flow");
    await signIn(page, "admin", "admin12345");
    await expect(page.locator("#topbar")).toContainText("Demo Super User");
    await page.goto("/tools/projects/index.html");
    await page.waitForSelector("#pr-loading", { state: "hidden" });
    if (await page.locator("#pr-new").isHidden()) await page.click("#pr-add");     // with no projects yet the form is already open
    await page.fill('#pr-new [name="name"]', name);
    await page.selectOption('#pr-new [name="clientType"]', "Consultant");
    await page.fill('#pr-new [name="clientName"]', "ACME Consult");
    await page.selectOption('#pr-new [name="region"]', "UAE");
    await page.click("#pr-create");
    await page.waitForURL(/project\.html\?id=/);
    const projectId = new URL(page.url()).searchParams.get("id")!;
    expect(projectId).toBeTruthy();

    // add a specification by pasting text
    await page.goto("/tools/projects/add-spec.html?project=" + projectId);
    await page.waitForSelector("#as-form:not([hidden])");
    await page.waitForFunction(() => (document.querySelector("#as-product") as HTMLSelectElement).options.length > 1);
    await page.selectOption("#as-product", "ahu");
    await page.selectOption("#as-factory", "ahu-dubai");
    await page.click('[data-src="text"]');
    await page.fill("#as-paste", SPEC);
    await page.fill("#as-title", "AHU Specs");
    await page.click("#as-go");
    await page.waitForURL(/record\.html\?run=/);
    runId = new URL(page.url()).searchParams.get("run")!;

    // the record reads like the document
    await expect(page.locator("#rc-name")).toHaveText("AHU Specs");
    await expect(page.locator("#rc-table tr.part")).toHaveCount(3);
    await expect(page.locator("#rc-table tr.sect")).toHaveCount(4);
    await expect(page.locator("#rc-count")).toContainText("0 of 6 clauses answered");
    await expect(page.locator("#rc-ai")).toBeVisible();                     // the super user may run the AI review

    // fill one clause in Edit: it is saved and goes to review
    await page.click('#rc-seg [data-mode="edit"]');
    const first = page.locator("#rc-table tr.line.edit").first();
    await first.locator('input[aria-label="Compliance"]').fill("Noted");
    await first.locator('textarea[aria-label="Remarks"]').fill("General clause.");
    await first.locator('textarea[aria-label="Remarks"]').blur();
    await expect(first.locator(".state")).toHaveText("Saved, in review");
    await expect(page.locator("#rc-count")).toContainText("1 of 6 clauses answered, 1 waiting for review");
  });

  test("AI review drafts the open clauses and marks them; editing a draft makes it a person's answer", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop flow");
    runId = runId || await findRun(page);
    await signIn(page, "admin", "admin12345");
    await page.goto("/tools/projects/record.html?run=" + runId);
    await expect(page.locator("#rc-count")).toContainText("1 of 6 clauses answered");
    await page.click("#rc-ai");
    await page.click(".hub-sheet button:has-text('Start')");
    await expect(page.locator("#rc-count")).toContainText("1 of 6 clauses answered, 5 AI drafts to check", { timeout: 30000 });
    await expect(page.locator("#rc-table tr.line.ai")).toHaveCount(5);
    await expect(page.locator("#rc-table tr.line.ai .state").first()).toContainText("AI draft, check it");
    // the reason is a visible line under the clause, not a hover
    await expect(page.locator("#rc-table tr.line.ai .why").first()).toBeVisible();
    await expect(page.locator("#rc-table tr.line.ai .why").first()).toContainText("low confidence");
    await expect(page.locator("#rc-ai-clear")).toBeVisible();
    // the AI drafts are not in the review queue: only the person's answer waits
    await expect(page.locator("#rc-count")).toContainText("1 waiting for review");
    await page.selectOption("#rc-show", "ai");
    await expect(page.locator("#rc-table tr.line")).toHaveCount(5);
    // a person corrects a draft: it becomes a project answer in review
    await page.selectOption("#rc-show", "all");
    await page.click('#rc-seg [data-mode="edit"]');
    const text = (await page.locator("#rc-table tr.line.edit.ai .spec").first().textContent())!.trim();
    const draft = page.locator("#rc-table tr.line.edit", { hasText: text });     // a stable handle: the class changes once saved
    await draft.locator('input[aria-label="Compliance"]').fill("Comply");
    await draft.locator('input[aria-label="Compliance"]').blur();
    await expect(draft.locator(".state")).toHaveText("Saved, in review");
    await expect(page.locator("#rc-table tr.line.ai")).toHaveCount(4);
    // remove the rest of the drafts
    await page.click("#rc-ai-clear");
    await page.click(".hub-sheet button:has-text('Remove drafts')");
    await expect(page.locator("#rc-table tr.line.ai")).toHaveCount(0);
    await expect(page.locator("#rc-count")).toContainText("2 of 6 clauses answered");
  });

  test("a plain user cannot see the AI review button or open another user's record", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop flow");
    runId = runId || await findRun(page);
    await signIn(page, "sbu.user", "sbu12345");
    await page.goto("/tools/projects/record.html?run=" + runId);
    await expect(page.locator("#rc-error")).toBeVisible();
    await expect(page.locator("#rc-error")).toContainText("not available");
    await expect(page.locator("#rc-ai")).toBeHidden();
  });

  test("compliance review sees the conversion and the clauses", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop flow");
    await signIn(page, "sales.user", "sales12345");                        // "Can edit" for the Compliance Maker
    await page.goto("/tools/compliance-maker/library.html?from=projects");
    await page.waitForFunction(() => (document.querySelector("#product") as HTMLSelectElement).options.length > 1);
    await page.selectOption("#product", "ahu");
    await page.selectOption("#factory", "ahu-dubai");
    await expect(page.locator("body")).toContainText("Casing shall be double skin construction", { timeout: 15000 });
    await expect(page.locator("body")).toContainText("CASING");
  });

  test("phone: the record opens in focus mode", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone flow");
    runId = runId || await findRun(page);
    await signIn(page, "admin", "admin12345");
    await page.goto("/tools/projects/record.html?run=" + runId);
    await expect(page.locator(".cf-spec").first()).toBeVisible({ timeout: 20000 });
    // nothing runs off a 390px screen: the pane's top bar fits
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const top = await page.locator(".cf-top").boundingBox(), count = await page.locator(".cf-count").boundingBox();
    expect(count!.x + count!.width).toBeLessThanOrEqual(top!.x + top!.width + 1);
  });

  test("phone: the primary action is docked at the bottom, secondary ones behind More, lists show skeletons then content", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone flow");
    await signIn(page, "admin", "admin12345");
    await page.goto("/tools/projects/index.html");
    const dock = page.locator(".dock .btn");
    await expect(dock).toHaveText("New project");
    const box = await dock.boundingBox();
    expect(box!.y).toBeGreaterThan(844 / 2);                                 // bottom half, under the thumb
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator("#pr-review")).toBeHidden();                   // in More on a phone
    await page.click("#pr-more");
    await expect(page.locator(".hub-sheet.actions")).toContainText("Compliance review");
    await page.keyboard.press("Escape");
    await expect(page.locator("#pr-body tr").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // a project that cannot be opened says so, with one way out
    await page.goto("/tools/projects/project.html?id=nope");
    await expect(page.locator("#pj-error .empty-title")).toHaveText("This project cannot be opened");
    await expect(page.locator("#pj-error a.btn")).toHaveText("Back to Projects");
  });
});
