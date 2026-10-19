#!/usr/bin/env node
/* The clause-to-row match and the saved-table lookup exist twice: in the browser (cm-rows.js, pr-match.js: the blue
   chips, the compare page, the Excel) and in the Worker (worker/src/lib/rows.ts: what the AI sees). This check runs
   both on the same examples and fails when they disagree, so a change made to one copy only cannot ship.
   Part of `npm test`. Runs in Node: the TypeScript file is transpiled in memory, the browser files run in a sandbox. */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

// the server copy
const js = ts.transpileModule(read("worker/src/lib/rows.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const server = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

// the browser copies (cm-rows.js looks for its panel; there is none here)
const win = {};
const sandbox = createContext({ window: win, document: { getElementById: () => null }, console });
runInContext("var window = this.window;", sandbox);
runInContext(read("public/tools/compliance-maker/cm-rows.js"), sandbox);
runInContext(read("public/tools/projects/pr-match.js").replace("var Api = window.Api;", "var Api = window.Api || {};"), sandbox);
const browser = win.CMRows;

const SPEC = [
  ["part", "", "PART 1 - GENERAL"], ["section", "1.3", "PERFORMANCE REQUIREMENTS"],
  ["letter", "A.", "Structural Performance: Casing panels shall be self-supporting, deflection of L/200."],
  ["part", "", "PART 2 - PRODUCTS"], ["section", "2.1", "UNIT CASINGS"],
  ["letter", "A.", "General Fabrication Requirements for Casings:"],
  ["number", "1.", "Forming: Form walls, roofs, and floors with at least two breaks at each joint."],
  ["number", "2.", "Casing: Galvanized steel double skin insulated panels, 50 mm thick, thermal break profiles."],
  ["letter", "B.", "Casing Insulation and Adhesive:"], ["number", "1.", "Materials: ASTM C 1071, Type II."],
  ["letter", "C.", "Access Panels and Doors:"], ["number", "3.", "Fan Section: Doors and inspection and access panels."],
  ["letter", "a.", "Hinges: A minimum of two ball-bearing hinges per door."],
  ["letter", "E.", "Air-Handling-Unit Mounting Frame: Formed galvanized-steel channel or structural channel supports."],
  ["section", "2.2", "FAN, DRIVE, AND MOTOR SECTION"], ["letter", "B.", "Fans shall be plug type, backward curved, EC motors IE5."],
  ["letter", "J.", "Variable Frequency Controllers:"], ["number", "1.", "Description: NEMA ICS 2, IGBT, PWM, VFC, output voltage and frequency."],
  ["number", "2.", "Output Rating: 3-phase; 6 to 60 Hz."], ["letter", "K.", "Electrical power supply shall be 380 V, 3 phase, 60 Hz."],
  ["section", "2.3", "COIL SECTION"], ["letter", "D.", "Water Coils: copper tubes 0.4 mm, aluminium fins, not more than 12 fins per inch, face velocity 2.5 m/s."],
  ["section", "2.4", "AIR FILTRATION SECTION"], ["letter", "B.", "Extended-Surface, Disposable Panel Filters:"],
  ["number", "1.", "Thickness: 50 mm."], ["number", "2.", "Merv (ASHRAE 52.2): 7."], ["number", "3.", "Media: Fibrous material, rated-airflow conditions."],
  ["section", "2.5", "DAMPERS"], ["letter", "A.", "General Requirements for Dampers: Leakage rate shall not exceed 2 percent of air quantity."],
  ["section", "2.6", "HUMIDIFIERS"], ["letter", "A.", "Steam Grid Humidifier: steam distributor with dispersion tubes."],
  ["letter", "B.", "Wet Glass Cell Washer Section:"], ["number", "1.", "75-mm deep cells with glass-fiber media; insulation."],
  ["section", "2.7", "AIR-TO-AIR ENERGY RECOVERY"], ["letter", "A.", "Heat Wheels: sensible effectiveness not less than 70 percent."],
  ["part", "", "PART 3 - EXECUTION"], ["section", "3.1", "INSTALLATION"], ["letter", "A.", "Install units on concrete bases."]
].map(([type, sr, spec]) => ({ type, sr, spec }));

const kw = JSON.parse(JSON.stringify(read("db/migrations/0005_base_fixes.sql")
  .split("INSERT INTO dn_starter_new (row_key, keywords, strip) VALUES")[1].split(";\n")[0]));
const RULES = [...kw.matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'\)/g)].map((m) => {
  const [group, sub, component] = m[1].split("|");
  const title = (w) => w.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return { key: m[1], section: title(group), sub: title(sub), component: title(component), show: true, label: "", keywords: m[2].replace(/''/g, "'") };
});

let bad = 0;
const a = server.match(SPEC, RULES).map((r) => [r.key, r.found, r.lines.join(",")]);
const b = browser.match(SPEC, RULES).map((r) => [r.key || "", r.found, (r.lines || []).join(",")]).filter((r) => r[0]);
const keyed = (list) => new Map(list.map((r) => [r[0], r]));
const A = keyed(a), B = keyed(b);
for (const [k, r] of A) {
  const o = B.get(k);
  if (!o || o[1] !== r[1] || o[2] !== r[2]) { bad++; console.error(`match differs for ${k}: server ${r[1]} [${r[2]}], browser ${o ? o[1] + " [" + o[2] + "]" : "missing"}`); }
}
for (const c of SPEC) if (server.topicOf(c.spec) !== browser.topicOf(c.spec)) { bad++; console.error("topic differs: " + c.spec); }
for (const r of RULES) if (JSON.stringify(server.rowTopics(r)) !== JSON.stringify(browser.rowTopics(r))) { bad++; console.error("row topics differ: " + r.key); }

// the saved-table lookup: every row kept, newest table wins per unit tag
const tbl = (columns, f2) => ({ columns, rows: [
  { section: "Filter Supply", component: "Mounting", cells: columns.map(() => "Slide"), key: "filter supply||mounting" },
  { kind: "sub", component: "Filter 1", cells: [] }, { component: "Filter Class", cells: columns.map(() => "G4"), key: "filter supply||filter class" },
  { kind: "sub", component: "Filter 2", cells: [] }, { component: "Filter Class", cells: f2, key: "filter supply||filter class" },
  { section: "Empty Section Supply", component: "Length", cells: columns.map(() => "430 mm"), key: "empty section supply||length" },
  { section: "Empty Section Supply (2)", component: "Length", cells: columns.map(() => "400 mm") }] });
const notes = [tbl(["A1", "A2"], ["F7", "F7"]), tbl(["A2", "A3"], ["F8", "F9"])];
const sv = server.unitLookup(notes), bcols = [], bl = win.PRMatch.unitLookup(notes, bcols);
if (JSON.stringify(sv.columns) !== JSON.stringify(bcols)) { bad++; console.error("lookup columns differ", sv.columns, bcols); }
for (const row of [{ key: "filter supply||filter class", section: "Filter Supply", component: "Filter Class" }, { key: "", section: "Empty Section Supply", component: "Length" },
                   { key: "empty section supply||length", section: "Empty Section Supply", component: "Length" }, { key: "nope", section: "Filter Supply", component: "Mounting" }]) {
  if (JSON.stringify(sv.entries(row)) !== JSON.stringify(bl(row))) { bad++; console.error("lookup differs for " + JSON.stringify(row), JSON.stringify(sv.entries(row)), JSON.stringify(bl(row))); }
}

const linked = a.filter((r) => r[1]).length;
if (bad) { console.error(`rows-parity: ${bad} difference(s) between lib/rows.ts and cm-rows.js`); process.exit(1); }
console.log(`rows-parity: browser and server agree (${RULES.length} rows, ${linked} linked, ${SPEC.length} spec lines)`);
