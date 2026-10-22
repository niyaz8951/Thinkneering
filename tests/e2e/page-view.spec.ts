/* Focus mode, Page view (owner, 22 Oct 2026): a page of a book with Sr, specification, compliance and remarks,
   read only; every section starts a new page; a page holds what fits; a click on a clause opens it. */
import { test, expect, type Page } from "@playwright/test";

type Line = { type: string; sr: string; spec: string };
const L = (type: string, sr: string, spec: string): Line => ({ type, sr, spec });
const LONG = "The casing panels shall be of double skin construction, with the outer skin of pre-painted galvanised steel and the inner skin of galvanised steel, insulated with injected polyurethane foam, and the whole panel shall be thermally broken at every joint.";
function spec(): Line[] {
  const out: Line[] = [L("part", "", "PART 1 - GENERAL"), L("section", "1.1", "RELATED DOCUMENTS"),
    L("letter", "A", "Drawings and general provisions of the Contract apply to this Section of air handling units."),
    L("letter", "B", "Works specified in the following divisions."), L("text", "•", "Division 21 – Fire Fighting"), L("text", "•", "Division 23 – HVAC"),
    L("section", "1.2", "SUMMARY"), L("letter", "A", "This Section includes requirements for materials and installation of air handling units."),
    L("part", "", "PART 2 - PRODUCTS"), L("section", "2.1", "CASING")];
  for (let n = 0; n < 26; n++) out.push(L("letter", String.fromCharCode(65 + n), (n % 3 === 0 ? LONG + " " : "") + `Casing requirement number ${n + 1} for the AHU shall be met in full.`));
  out.push(L("section", "2.2", "FANS"));
  for (let n = 0; n < 5; n++) out.push(L("letter", String.fromCharCode(65 + n), `Fan requirement ${n + 1}: plug fans with EC motors.`));
  out.push(L("part", "", "PART 3 - EXECUTION"), L("section", "3.1", "INSTALLATION"), L("letter", "A", "Install units level and plumb."));
  return out;
}

async function setUp(page: Page): Promise<string> {
  const api = async (name: string, body: Record<string, unknown>) => (await page.request.post("/api/rpc/" + name, { data: body })).json();
  const t = (await api("app_login", { p_username: "admin", p_password: "admin12345" })).token;
  const pj = await api("pr_save", { p_token: t, p_id: null, p_name: "E2E Page view " + Date.now(), p_client_type: "Consultant", p_client_name: "ACME", p_region: "UAE" });
  const lines = spec();
  // answers the client will get: a few from the library, two of them deviations
  const answers: Record<string, [string, string]> = { "Casing requirement number 2 for the AHU shall be met in full.": ["Not Comply", "SS304 offered."],
    "Casing requirement number 3 for the AHU shall be met in full.": ["Comply with Remarks", "62 mm panels."], "Install units level and plumb.": ["In Contractor's Scope", "By Contractor / others."] };
  await api("cm_admin_import", { p_token: t, p_factory_id: "ahu-dubai", p_file_name: "lib.xlsx", p_rows: Object.entries(answers).map(([s, [c, r]]) => ({ spec: s, compliance: c, remarks: r, type: "letter" })) });
  const run = await api("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "Page view spec", p_lines: lines, p_project_id: pj.id });
  await api("app_logout", { p_token: t });
  return run.run_id;
}

async function signIn(page: Page) {
  await page.goto("/index.html");
  await page.fill('#loginForm [name="username"]', "admin");
  await page.fill('#loginForm [name="password"]', "admin12345");
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL(/dashboard\.html/);
}
/* what the page shows: section, continued, rows, page numbers, whether it overflows */
const read = (page: Page) => page.evaluate(() => {
  const sel = document.querySelector(".cf-ph .cf-where .s select") as HTMLSelectElement | null;
  const s = sel ? sel.selectedOptions[0].textContent : (document.querySelector(".cf-ph .cf-where .s")?.textContent || "");
  const body = document.querySelector(".cf-body") as HTMLElement;
  return { section: s, cont: !!document.querySelector(".cf-cont"), rows: document.querySelectorAll(".cf-page .cf-row").length,
           srs: [...document.querySelectorAll(".cf-page .cf-row .sr")].map((x) => x.textContent),
           info: document.querySelector(".cf-pinfo")?.textContent || "", count: document.querySelector(".cf-count")?.textContent || "",
           overflow: body.scrollHeight - body.clientHeight, next: !(document.querySelector(".cf-nav .btn:last-child") as HTMLButtonElement).disabled };
});

test("Page view: sections start new pages, pages fit, a click opens the clause, Deviations filters", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "desktop flow");
  const runId = await setUp(page);
  await signIn(page);
  await page.goto("/tools/projects/record.html?run=" + runId);
  await page.click("#rc-focus");
  await page.locator(".cf-views .tab", { hasText: "Page" }).click();
  await expect(page.locator(".cf-page .cf-row").first()).toBeVisible();
  await expect(page.locator(".cf-mode:not(.cf-views)")).toBeHidden();          // read only: no Read | Edit in Page view
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath("page-view-desktop-day.png") });

  // go to the start and read every page
  await page.keyboard.press("Home");
  const seen: any[] = [];
  for (let n = 0; n < 40; n++) {
    const p = await read(page); seen.push(p);
    if (!p.next) break;
    await page.keyboard.press("ArrowRight");
  }
  const total = seen.length;
  expect(seen.every((p) => p.count === `Page ${seen.indexOf(p) + 1} of ${total}`)).toBe(true);
  expect(seen.every((p) => p.overflow <= 1)).toBe(true);                       // nothing runs below the page
  const secs = seen.map((p) => p.section);
  // every section starts a new page and its pages follow each other
  expect([...new Set(secs)]).toEqual(["1.1 RELATED DOCUMENTS", "1.2 SUMMARY", "2.1 CASING", "2.2 FANS", "3.1 INSTALLATION"]);
  const casing = seen.filter((p) => p.section === "2.1 CASING");
  expect(casing.length).toBeGreaterThan(1);
  expect(casing[0].cont).toBe(false); expect(casing[1].cont).toBe(true);
  expect(casing[1].info).toBe(`2.1 CASING · page 2 of ${casing.length}`);
  expect(casing.reduce((a, p) => a + p.rows, 0)).toBe(26);
  expect(seen.find((p) => p.section === "1.2 SUMMARY")!.rows).toBe(1);        // a short section keeps its page
  expect(casing[0].rows).toBeGreaterThanOrEqual(6);
  info.annotations.push({ type: "pages", description: `${total} pages; CASING rows per page: ${casing.map((p) => p.rows).join(", ")}` });

  // what the client gets: compliance and remarks; deviations stand out
  await page.keyboard.press("Home");
  for (let n = 0; n < 40 && !(await page.locator(".cf-row .ans.dev").count()); n++) await page.keyboard.press("ArrowRight");
  await expect(page.locator(".cf-row .ans.dev").first()).toContainText("Not ComplySS304 offered.");
  await expect(page.locator(".cf-row .ans.cwr").first()).toContainText("Comply with Remarks62 mm panels.");
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath("page-view-desktop-answers.png") });

  // a click on a clause opens it in Clause view
  const target = page.locator(".cf-row", { hasText: "Casing requirement number 2 " });
  await target.click();
  await expect(page.locator(".cf-spec")).toContainText("Casing requirement number 2 for the AHU");
  await expect(page.locator(".cf-views .tab", { hasText: "Clause" })).toHaveAttribute("aria-selected", "true");

  // Deviations only, on pages of their own sections
  await page.locator(".cf-views .tab", { hasText: "Page" }).click();
  await page.selectOption(".cf-ph .cf-show", "dev");
  await page.keyboard.press("Home");
  const dev = await read(page);
  expect(dev.rows).toBe(2); expect(dev.section).toBe("2.1 CASING"); expect(dev.count).toBe("Page 1 of 1");

  // A+ fits fewer clauses on a page, and nothing overflows
  await page.selectOption(".cf-ph .cf-show", "all");
  await page.locator(".cf-size .btn", { hasText: "A+" }).click(); await page.locator(".cf-size .btn", { hasText: "A+" }).click();
  await page.keyboard.press("Home");
  const big = await read(page);
  expect(big.overflow).toBeLessThanOrEqual(1);
  await page.locator(".cf-size .btn", { hasText: "A−" }).click(); await page.locator(".cf-size .btn", { hasText: "A−" }).click();

  // night
  await page.evaluate(() => (window as any).Hub.toggleTheme ? (window as any).Hub.toggleTheme() : document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath("page-view-desktop-night.png") });
});

test("phone: Page view stacks the answer under the clause and fits 390 px", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone flow");
  const runId = await setUp(page);
  await signIn(page);
  await page.goto("/tools/projects/record.html?run=" + runId);
  await expect(page.locator(".cf-spec").first()).toBeVisible({ timeout: 20000 });     // a phone opens in focus mode, Edit
  await page.locator(".cf-views .tab", { hasText: "Page" }).click();
  await expect(page.locator(".cf-page .cf-row").first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const top = await page.locator(".cf-top").boundingBox(), count = await page.locator(".cf-count").boundingBox();
  expect(count!.x + count!.width).toBeLessThanOrEqual(top!.x + top!.width + 1);
  const p = await read(page);
  expect(p.overflow).toBeLessThanOrEqual(1);
  expect(p.rows).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: info.outputPath("page-view-phone.png") });
});
