#!/usr/bin/env node
/* Screenshots of the main screens for a delivery note (design brief: 390px and 1440px, day and night).
     npm run dev:offline            (in another window; or let this script reuse a running server)
     node scripts/screens.mjs <out-dir>        e.g. docs/screens/after
   Seeds one demo project (once) on the local site: a 40-clause AHU specification with library answers,
   people's answers, AI drafts (stand-in model) and open clauses, then photographs every screen.
   PW_CHROMIUM=/path/to/chrome picks a pre-installed Chromium. Local site only. */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8787";
const OUT = process.argv[2] || "docs/screens/now";
mkdirSync(OUT, { recursive: true });

const SECTIONS = {
  "PART 1 - GENERAL": {
    "1.01 SUMMARY": ["This section includes factory assembled air handling units with fans, coils, filters and controls.",
      "Related sections include duct work, building management system and electrical power supply."],
    "1.02 SUBMITTALS": ["Submit product data for each unit including rated capacities, pressure drops and fan performance curves.",
      "Submit shop drawings showing plans, elevations, sections, details and attachments to other work.",
      "Submit sound power level data for the supply fan inlet and outlet at rated capacity.",
      "Submit operation and maintenance manuals for inclusion in the project close out documents."],
    "1.03 QUALITY ASSURANCE": ["Units shall be certified by Eurovent for mechanical performance of the casing.",
      "Coils shall be rated in accordance with AHRI Standard 410.",
      "Manufacturer shall hold ISO 9001 certification for design and manufacture of air handling units."]
  },
  "PART 2 - PRODUCTS": {
    "2.01 CASING": ["Casing shall be double skin construction with 50 mm thick panels and thermal break profiles.",
      "Panels shall be insulated with 50 mm injected polyurethane foam of density not less than 40 kg/m3.",
      "Casing air leakage shall be class L1 at minus 400 Pa in accordance with EN 1886.",
      "Thermal transmittance shall be class T2 and thermal bridging factor class TB2 in accordance with EN 1886.",
      "Access doors shall be hinged with quick release handles on both sides and a viewing window."],
    "2.02 FANS": ["Fans shall be plug type with backward curved blades, directly driven by EC motors.",
      "Fan and motor assembly shall be mounted on a common base with anti-vibration mounts.",
      "Fan motors shall be premium efficiency class IE4 or better.",
      "Each fan shall be statically and dynamically balanced to grade G2.5 to ISO 1940.",
      "Provide a fan array with at least two fans where airflow exceeds 10,000 m3/h."],
    "2.03 COILS": ["Cooling coils shall be copper tubes with aluminium fins, maximum face velocity 2.5 m/s.",
      "Coil fin spacing shall not be less than 2.1 mm.",
      "Drain pans shall be stainless steel grade 304, double sloped to the drain connection.",
      "Coils shall be pressure tested at 21 bar and suitable for a working pressure of 16 bar."],
    "2.04 FILTERS": ["Pre filters shall be ePM10 50% to ISO 16890, panel type, 50 mm deep.",
      "Final filters shall be ePM1 70% to ISO 16890, bag type.",
      "Provide a differential pressure gauge across every filter bank.",
      "Filter frames shall be galvanised steel with gaskets to prevent bypass."],
    "2.05 HEAT RECOVERY": ["Provide a thermal wheel with sensible efficiency not less than 75% at balanced airflow.",
      "Thermal wheel shall have a purge sector and a variable speed drive."],
    "2.06 CONTROLS": ["Units shall be supplied with factory fitted controls and a BACnet IP interface.",
      "Provide a remote display for set point adjustment and alarm indication.",
      "Controls shall include fire alarm interlock to stop the unit on a fire signal."]
  },
  "PART 3 - EXECUTION": {
    "3.01 INSTALLATION": ["Install units level and plumb in accordance with the manufacturer's written instructions.",
      "Connect duct work to units with flexible connections.",
      "Install condensate drain with trap of depth suited to the fan static pressure."],
    "3.02 TESTING AND COMMISSIONING": ["Engage a factory authorised service representative to test and commission the units.",
      "Perform tests and inspections with the manufacturer's representative present.",
      "Train the owner's maintenance personnel to adjust, operate and maintain the units."]
  }
};
function specText() {
  const out = [];
  for (const [part, secs] of Object.entries(SECTIONS)) {
    out.push(part);
    for (const [sec, lines] of Object.entries(secs)) {
      out.push(sec);
      lines.forEach((l, i) => out.push(String.fromCharCode(65 + i) + ". " + l));
    }
  }
  return out.join("\n");
}

async function api(ctx, name, body) {
  const r = await ctx.request.post(BASE + "/api/rpc/" + name, { data: body });
  const j = await r.json();
  if (j && j.error) throw new Error(name + ": " + j.error);
  return j;
}

async function signIn(page, user, pass) {
  await page.goto(BASE + "/index.html");
  await page.fill('#loginForm [name="username"]', user);
  await page.fill('#loginForm [name="password"]', pass);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForURL(/dashboard\.html/);
}

/* One demo project with a record in every state. Made once; later runs reuse it. */
async function seed(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const login = await api(ctx, "app_login", { p_username: "admin", p_password: "admin12345" });
  const t = login.token;
  let list = await api(ctx, "pr_list", { p_token: t });
  let pj = list.projects.find((p) => p.name === "Al Wasl Tower");
  if (!pj) {
    const made = await api(ctx, "pr_save", { p_token: t, p_id: null, p_name: "Al Wasl Tower", p_client_type: "Consultant", p_client_name: "ACME Consult", p_region: "UAE" });
    await api(ctx, "pr_save", { p_token: t, p_id: null, p_name: "Marina Mall Extension", p_client_type: "Contractor", p_client_name: "Gulf MEP", p_region: "UAE" });
    pj = { id: made.id || made.project?.id };
    if (!pj.id) { list = await api(ctx, "pr_list", { p_token: t }); pj = list.projects.find((p) => p.name === "Al Wasl Tower"); }
  }
  let got = await api(ctx, "pr_get", { p_token: t, p_id: pj.id });
  if (!got.runs.length) {
    await page.addInitScript((tok) => localStorage.setItem("dame_hub_token", tok), t);
    await page.goto(BASE + "/tools/projects/add-spec.html?project=" + pj.id);
    await page.waitForSelector("#as-form:not([hidden])");
    await page.waitForFunction(() => document.querySelector("#as-product").options.length > 1);
    await page.selectOption("#as-product", "ahu");
    await page.selectOption("#as-factory", "ahu-dubai");
    await page.click('[data-src="text"]');
    await page.fill("#as-paste", specText());
    await page.fill("#as-title", "AHU Specs Rev 2");
    await page.click("#as-go");
    await page.waitForURL(/record\.html\?run=/);
    const runId = new URL(page.url()).searchParams.get("run");
    // the library knows a few answers (green on the record)
    const lib = await api(ctx, "cm_admin_lines", { p_token: t, p_factory_id: "ahu-dubai", p_status: "all", p_search: "", p_limit: 100, p_offset: 0 });
    const lines = lib.lines || lib.rows || [];
    const libAns = { "Eurovent": ["Comply", "Eurovent certified range."], "ISO 9001": ["Comply", ""], "EC motors": ["Comply", "EC plug fans as standard."],
      "AHRI Standard 410": ["Comply", ""], "thermal break": ["Comply with Remarks", "50 mm panel with thermal break as standard."] };
    for (const l of lines) for (const [k, [c, r]] of Object.entries(libAns)) if ((l.spec_text || l.text || "").includes(k)) await api(ctx, "cm_admin_save_answer", { p_token: t, p_line_id: l.id, p_compliance: c, p_remarks: r, p_comments: k === "Eurovent" ? "Check the certificate number on the Eurovent site before sending." : null });
    // people's answers on a few clauses
    const rec = await api(ctx, "pr_run_get", { p_token: t, p_run_id: runId });
    const rows = (rec.lines || []).filter((l) => /^[A-Z]$/.test(l.sr || "") && !l.compliance && !l.lib_compliance);
    const mine = [["Noted", ""], ["Comply", "Submitted with the technical offer."], ["Comply", ""], ["Not Comply", "Fin spacing 1.8 mm offered for capacity; 2.1 mm on request."], ["In Contractor's Scope", "Installation by others."]];
    for (let i = 0; i < mine.length && i < rows.length; i++) {
      await api(ctx, "pr_run_save_line", { p_token: t, p_run_id: runId, p_seq: rows[i * 3].seq, p_compliance: mine[i][0], p_remarks: mine[i][1], p_check: null });
    }
    // one batch of AI drafts (stand-in model); the rest stays open
    await api(ctx, "ai_review_run", { p_token: t, p_run_id: runId, p_limit: 12, p_replace: false, p_since: null });
    got = await api(ctx, "pr_get", { p_token: t, p_id: pj.id });
  }
  await api(ctx, "app_logout", { p_token: t });
  await ctx.close();
  return { projectId: pj.id, runId: got.runs[0].id };
}

const SIZES = [{ name: "390", width: 390, height: 844, mobile: true }, { name: "1440", width: 1440, height: 900, mobile: false }];
const THEMES = ["light", "dark"];

async function shoot(browser, ids) {
  const screens = [
    { key: "1-dashboard", path: "/dashboard.html" },
    { key: "2-projects", path: "/tools/projects/index.html", wait: "#pr-loading", hidden: true },
    { key: "3-project", path: "/tools/projects/project.html?id=" + ids.projectId },
    { key: "4-record", path: "/tools/projects/record.html?run=" + ids.runId, desktopOnly: false, prep: async (page, s) => {
      if (s.mobile) { await page.waitForSelector(".cf-spec", { timeout: 20000 }).catch(() => {}); const done = page.locator(".cf-top button:has-text('Done')").first(); if (await done.isVisible().catch(() => false)) await done.click(); }
      await page.waitForSelector("#rc-table tr.line", { timeout: 20000 }).catch(() => {});
    } },
    { key: "5-focus", path: "/tools/projects/record.html?run=" + ids.runId, prep: async (page, s) => {
      if (!s.mobile) { await page.waitForSelector("#rc-table tr.line", { timeout: 20000 }); await page.click("#rc-focus"); }
      await page.waitForSelector(".cf-spec", { timeout: 20000 });
      // show an AI draft: back to the first clause, then forward to the first blue one
      for (let i = 0; i < 45; i++) await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(200);
      for (let i = 0; i < 45; i++) {
        if (/AI draft/.test(await page.locator(".cf-in").innerText().catch(() => ""))) break;
        await page.keyboard.press("ArrowRight"); await page.waitForTimeout(120);
      }
    } },
    { key: "6-review", path: "/tools/compliance-maker/library.html?from=projects", prep: async (page) => {
      await page.waitForFunction(() => document.querySelector("#product") && document.querySelector("#product").options.length > 1);
      await page.selectOption("#product", "ahu");
      await page.selectOption("#factory", "ahu-dubai").catch(() => {});
      await page.waitForTimeout(1500);
    } }
  ];
  for (const s of SIZES) for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: s.mobile ? 2 : 1 });
    const login = await api(ctx, "app_login", { p_username: "admin", p_password: "admin12345" });
    await ctx.addInitScript(([tok, th]) => { localStorage.setItem("dame_hub_token", tok); localStorage.setItem("dame_hub_theme", th); }, [login.token, theme]);
    const page = await ctx.newPage();
    for (const sc of screens) {
      await page.goto(BASE + sc.path);
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-loading"), null, { timeout: 20000 }).catch(() => {});
      if (sc.wait) await page.waitForSelector(sc.wait, { state: sc.hidden ? "hidden" : "visible", timeout: 20000 }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      if (sc.prep) await sc.prep(page, s);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${sc.key}-${s.name}-${theme === "light" ? "day" : "night"}.png` });
    }
    await ctx.close();
  }
}

/* Empty states: a user with no projects. */
async function shootEmpty(browser) {
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: s.mobile ? 2 : 1 });
    const login = await api(ctx, "app_login", { p_username: "team.admin", p_password: "admin12345" });
    await ctx.addInitScript((tok) => { localStorage.setItem("dame_hub_token", tok); localStorage.setItem("dame_hub_theme", "light"); }, login.token);
    const page = await ctx.newPage();
    await page.goto(BASE + "/tools/projects/project.html?id=00000000-0000-4000-8000-000000000000");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/7-project-missing-${s.name}-day.png` });
    await ctx.close();
  }
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
  const ids = await seed(browser);
  console.log("demo project", ids);
  await shoot(browser, ids);
  await shootEmpty(browser);
  console.log("screens written to", OUT);
} finally { await browser.close(); }
