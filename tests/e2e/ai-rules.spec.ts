/* Compliance review > AI rules, in a browser: the tab is there for admins only, a rule is added in the sheet,
   "Try a clause" shows it answering by itself. Runs on the offline local site (demo seed has two rules). */
import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page, user: string, password: string) {
  await page.goto("/index.html");
  await page.fill('#loginForm [name="username"]', user);
  await page.fill('#loginForm [name="password"]', password);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL(/dashboard\.html/);
}
async function openReview(page: Page, factory: string) {
  await page.goto("/tools/compliance-maker/library.html");
  await page.waitForFunction(() => (document.querySelector("#product") as HTMLSelectElement).options.length > 1);
  await page.selectOption("#product", "ahu");
  await page.selectOption("#factory", factory);
}

test.describe("AI rules", () => {
  test("an admin adds a rule and tries a clause; a Can-edit user never sees the tab", async ({ page }, info) => {
    const title = "E2E rigging " + info.project.name + " " + Date.now();
    await signIn(page, "team.admin", "admin12345");
    await openReview(page, "ahu-riyadh");
    await page.click('.tab[data-tab="rules"]');
    await expect(page.locator("#ruleList")).toContainText("Site work");                  // demo rule, every AHU factory
    await expect(page.locator("#ruleList")).not.toContainText("Fans (demo)");            // Dubai's own fact
    // add a rule (the button sits in the dock on a phone)
    await page.locator(info.project.name === "phone" ? ".dock .btn" : "#btnRuleAdd").click();
    const sheet = page.locator(".rule-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Title").fill(title);
    await sheet.getByLabel("Applies to").selectOption({ label: "Riyadh only" });
    await sheet.getByLabel("Part").selectOption("3");
    await sheet.getByLabel("When the clause mentions").fill("hoisting");
    await sheet.getByLabel("Answer").selectOption("In Contractor's Scope");
    await sheet.getByLabel("Remark").fill("Hoisting is by the contractor.");
    await expect(sheet).toContainText("matching clauses get exactly this answer, without the AI");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#ruleList")).toContainText(title);
    await expect(page.locator("#ruleList li", { hasText: title })).toContainText("Answers by itself");
    // try a clause
    await page.fill("#tryText", "Hoisting of the sections to the roof shall be planned.");
    await page.selectOption("#tryPart", "3");
    await page.click("#btnTry");
    await expect(page.locator("#tryOut")).toContainText("Answered by the rule");
    await expect(page.locator("#tryOut")).toContainText(title);
    // tidy up: delete it again
    await page.locator("#ruleList button", { hasText: title }).click();
    await page.locator(".rule-sheet").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("#ruleList")).not.toContainText(title);
  });

  test("a user who may edit the library does not get the AI rules tab", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop is enough");
    await signIn(page, "sales.user", "sales12345");
    await openReview(page, "ahu-dubai");
    await expect(page.locator('.tab[data-tab="lines"]')).toBeVisible();
    await expect(page.locator('.tab[data-tab="rules"]')).toBeHidden();
  });
});
