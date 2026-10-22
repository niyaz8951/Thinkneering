/* A specification run under the wrong product (owner, 22 Oct 2026): Add a specification asks before saving, and
   "Change to AHU" sets the product; nothing is saved until the person converts again. */
import { test, expect } from "@playwright/test";

const AHU_SPEC = `SECTION 23 73 13 - MODULAR INDOOR CENTRAL-STATION AIR-HANDLING UNITS
PART 1 - GENERAL
1.01 SUMMARY
A. This section includes factory assembled air handling units with fans, coils, filters and controls.
PART 2 - PRODUCTS
2.01 CASING
A. AHU casing shall be double skin construction with 50 mm thick panels and thermal break profiles.
B. Casing air leakage of each AHU shall be class L1 to EN 1886.`;

test("an AHU spec under FCU: the page asks, Change to AHU sets the product, then it converts", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "desktop flow");
  await page.goto("/index.html");
  await page.fill('#loginForm [name="username"]', "admin");
  await page.fill('#loginForm [name="password"]', "admin12345");
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL(/dashboard\.html/);
  await page.goto("/tools/projects/index.html");
  await page.waitForSelector("#pr-loading", { state: "hidden" });
  if (await page.locator("#pr-new").isHidden()) await page.click("#pr-add");
  await page.fill('#pr-new [name="name"]', "E2E Product check " + Date.now());
  await page.selectOption('#pr-new [name="clientType"]', "Consultant");
  await page.fill('#pr-new [name="clientName"]', "ACME");
  await page.selectOption('#pr-new [name="region"]', "UAE");
  await page.click("#pr-create");
  await page.waitForURL(/project\.html\?id=/);
  const projectId = new URL(page.url()).searchParams.get("id")!;

  await page.goto("/tools/projects/add-spec.html?project=" + projectId);
  await page.waitForSelector("#as-form:not([hidden])");
  await page.waitForFunction(() => (document.querySelector("#as-product") as HTMLSelectElement).options.length > 1);
  await page.selectOption("#as-product", "fcu");
  await page.selectOption("#as-factory", "fcu-shenzhen");
  await page.click('[data-src="text"]');
  await page.fill("#as-paste", AHU_SPEC);
  await page.fill("#as-title", "Wrong product");
  await page.click("#as-go");
  const sheet = page.locator('.hub-sheet[role="alertdialog"]');
  await expect(sheet.locator("h2")).toHaveText("This looks like an AHU specification");
  await expect(sheet).toContainText("Saved under FCU, its clauses would go into the FCU library");
  await page.waitForTimeout(400);                                   // the sheet eases in
  await page.screenshot({ path: info.outputPath("product-check-sheet.png") });
  await sheet.getByRole("button", { name: "Change to AHU" }).click();
  await expect(page.locator("#as-product")).toHaveValue("ahu");
  await expect(page.locator("body")).toContainText("Product changed to AHU");
  await page.selectOption("#as-factory", "ahu-dubai");
  await page.click("#as-go");
  await page.waitForURL(/record\.html\?run=/);
  await expect(page.locator("#rc-name")).toHaveText("Wrong product");
});
