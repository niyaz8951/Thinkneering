/* The AI in a browser: Compliance review > AI rules (maps chosen by name, created from the template, a clause
   tried step by step), and focus mode proposals (a rule of the map proposes the answer, Keep & next saves it).
   Runs on the offline local site. */
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
async function api(page: Page, name: string, body: Record<string, unknown>) { return (await page.request.post("/api/rpc/" + name, { data: body })).json(); }

test.describe("AI", () => {
  test.describe.configure({ mode: "serial" });

  test("an admin links a map made from the template and tries a clause; a Can-edit user has no AI rules tab", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop flow");
    await signIn(page, "team.admin", "admin12345");
    await openReview(page, "ahu-riyadh");
    await page.click('.tab[data-tab="rules"]');
    const links = page.locator("#mapLinks");
    await expect(links).toContainText("All AHU factories");
    await expect(links).toContainText("Riyadh only");
    await expect(links).toContainText("Knowledge map");
    // make the product's map from the template if this run has none yet
    if (await links.locator(".map-link").first().locator(".sum").filter({ hasText: "built-in instructions" }).count()) {
      await links.locator(".map-link").first().getByRole("button", { name: "Create from template" }).click();
      await page.getByRole("alertdialog").locator("input").fill("E2E AI rules AHU");
      await page.getByRole("alertdialog").getByRole("button", { name: "Create" }).click();
    }
    await expect(links.locator(".map-link").first()).toContainText(/\d+ rules, \d+ of them answer by themselves/);
    await expect(page.locator("#mapSettings")).toContainText("copies from the library at 90% similar");
    await page.fill("#tryText", "Units shall be set level and plumb on the concrete base.");
    await page.selectOption("#tryPart", "3");
    await page.click("#btnTry");
    await expect(page.locator("#tryOut")).toContainText("answers it by itself");
    await expect(page.locator("#tryOut .step-list li")).toHaveCount(6);
    await page.locator("#tryOut .try-prompt summary").click();
    await expect(page.locator("#tryOut .try-prompt")).toContainText("SCOPE OF SUPPLY");

    // another person, in a browser of his own
    const other = await (await page.context().browser()!.newContext()).newPage();
    await signIn(other, "sales.user", "sales12345");
    await openReview(other, "ahu-dubai");
    await expect(other.locator('.tab[data-tab="lines"]')).toBeVisible();
    await expect(other.locator('.tab[data-tab="rules"]')).toBeHidden();
    await other.context().close();
  });

  test("focus mode proposes an answer from the map; Keep & next saves it and moves on", async ({ page }, info) => {
    await signIn(page, "admin", "admin12345");
    // the page's own session (a second login would sign the page out: one session per user)
    const token = await page.evaluate(() => localStorage.getItem("dame_hub_token") || "");
    // the map for all AHU factories (from the template) holds "Site connections" (level and plumb -> In Contractor's Scope)
    const m = await api(page, "ai_map_get", { p_token: token, p_product_id: "ahu" });
    if (!m.all) await api(page, "ai_map_create", { p_token: token, p_product_id: "ahu", p_name: "E2E AI rules AHU" });
    const pj = await api(page, "pr_save", { p_token: token, p_name: "E2E Focus " + info.project.name + " " + Date.now(), p_client_type: "Consultant", p_client_name: "ACME", p_region: "UAE" });
    const run = await api(page, "cm_save_run", { p_token: token, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "focus.txt", p_project_id: pj.id, p_lines: [
      { type: "part", sr: "", spec: "PART 3 - EXECUTION" }, { type: "section", sr: "3.01", spec: "INSTALLATION" },
      { type: "letter", sr: "A.", spec: "Units shall be set level and plumb on the concrete base " + Date.now() + "." },
      { type: "letter", sr: "B.", spec: "Concrete bases shall be provided by the contractor for every unit " + Date.now() + "." }] });
    await page.goto("/tools/projects/record.html?run=" + run.run_id);
    if (info.project.name !== "phone") { await page.click('#rc-seg [data-mode="edit"]'); await page.click("#rc-focus"); }
    const pane = page.locator(".cf");
    await expect(pane).toBeVisible();
    if (await pane.locator(".cf-mode .tab", { hasText: "Edit" }).getAttribute("aria-selected") !== "true") await pane.locator(".cf-mode .tab", { hasText: "Edit" }).click();
    const card = pane.locator(".cf-sug");
    await expect(card).toContainText("Proposed: In Contractor's Scope", { timeout: 15000 });
    await expect(card).toContainText("From an AI rule");
    await card.getByRole("button", { name: "Keep & next" }).click();
    await expect(pane.locator(".cf-spec")).toContainText("Concrete bases shall be provided");
    await expect(pane.locator(".cf-sug")).toContainText("Proposed: In Contractor's Scope");
    await pane.getByRole("button", { name: "Done" }).click();
    const rec = await api(page, "pr_run_get", { p_token: token, p_run_id: run.run_id });
    const a = rec.lines.find((l: any) => /level and plumb/.test(l.spec));
    expect(a).toMatchObject({ own: true, ai_draft: false, compliance: "In Contractor's Scope" });
  });
});
