#!/usr/bin/env node
/* Datasheet reader check (ds-parse.js runs in the browser, so Vitest in workerd cannot load it). Lines as pdf.js gives
   them after DSParse.lines(), shaped on the ASTRAWEB HILTOP report (22 Oct 2026): the NRVU block and the Electrical
   Power Inputs table must come out as rows with the right keys. Part of `npm test`. */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const win = {};
runInContext(readFileSync(path.join(root, "public/tools/datasheet-notes/ds-parse.js"), "utf8"), createContext({ window: win, console }));
const P = win.DSParse;

let y = 800;
const line = (h, ...cells) => { y -= 14; return { text: cells.join(" "), h, y, page: 1, cells: cells.map((s, i) => ({ s, x: 40 + i * 200 })), items: cells.map((s, i) => ({ s, x: 40 + i * 200, w: 50 })) }; };
const body = (...c) => line(10, ...c);

const page = [
  line(12, "Unit Data"),
  body("Panel • Insulation", "42 mm • Foam"),
  body("Air Density • Altitude", "1.2 kg/m³ • 10 m a.s.l."),
  line(12, "1) Fan Supply"),
  body("Type", "Plug Fan"),
  body("Efficiency", "60 %"),
  line(12, "NRVU - Regulation (EU) No 1253/2014"),
  body("Manufacturer's Name", "Any Maker S.p.a."),
  body("Serial Number", "2977259"),
  body("Typology (NRVU, UVU or BVU)*", "NRVU BVU"),
  body("Drive Type", "Inverter (not included. Supplied by the installer)"),
  body("Nominal NRVU Flow Rate"),
  body("Supply", "1.39 m³/s"),
  body("Return", "1.25 m³/s"),
  body("SFP Internal", "1297 W/(m³/s)"),
  body("Return", "9 m/s"),                                   // no group above it any more: kept as printed
  body("External Leakage (RU) +400Pa • -400Pa L2(R) • L2(R)"),
  body("Leakage EATR • OACF", "2.69 % • 1.29 %"),
  body("Pre-/Dis-assembly Instructions", "https://example.invalid/instructions-for-pre-"),
  body("disassembly/"),
  body("* In accordance with Commission Regulation (EU) No 1253/2014 of July 2014"),
  line(13, "Electrical Power Inputs Data"),
  line(11, "Absorbed Power - Absorbed"),
  line(11, "Component", "Electrical Connection"),
  line(11, "Current (rated data)"),
  body("Fan Supply", "415V/3Ph/50Hz + PE", "3.0kW - 6.1A"),
  body("Heat Wheel", "415V/3ph/50Hz + PE", "0.0kW - 0.2A"),
  body("For supplied loose components or items provided by Others, please refer to their specific datasheets.")
];
page.unshift(...Array.from({ length: 12 }, (_, i) => body("Filler " + i, String(i))));   // header lines: keep 10 pt the body height

const data = P.parse([page]);
const rows = P.rows(data);
const got = Object.fromEntries(rows.filter((r) => /^(nrvu|electrical power inputs)\|/.test(r.key)).map((r) => [r.key, r.value]));
assert.deepEqual(got, {
  "nrvu||typology (nrvu, uvu or bvu)": "NRVU BVU",
  "nrvu||drive type": "Inverter (not included. Supplied by the installer)",
  "nrvu||nominal nrvu flow rate supply": "1.39 m³/s",
  "nrvu||nominal nrvu flow rate return": "1.25 m³/s",
  "nrvu||sfp internal": "1297 W/(m³/s)",
  "nrvu||return": "9 m/s",
  "nrvu||external leakage (ru) +400pa": "L2(R)",
  "nrvu||external leakage (ru) -400pa": "L2(R)",
  "nrvu||leakage eatr": "2.69 %",
  "nrvu||leakage oacf": "1.29 %",
  "electrical power inputs|fan supply|electrical connection": "415V/3Ph/50Hz + PE",
  "electrical power inputs|fan supply|absorbed power": "3.0 kW",
  "electrical power inputs|fan supply|absorbed current": "6.1 A",
  "electrical power inputs|heat wheel|electrical connection": "415V/3ph/50Hz + PE",
  "electrical power inputs|heat wheel|absorbed power": "0.0 kW",
  "electrical power inputs|heat wheel|absorbed current": "0.2 A"
});
// the maker's name never becomes a row (makes must not reach compliance answers)
assert.ok(!rows.some((r) => /maker|manufacturer|serial/i.test(r.component + " " + r.value)), "manufacturer or serial number read as a row");
// the fan section and the power supply are read as before
assert.equal(data.hdr.power, "415V/3Ph/50Hz + PE");
assert.ok(rows.some((r) => r.key === "fan supply||type" && r.value === "Plug Fan"));
console.log(`ds-parse check: OK (${Object.keys(got).length} NRVU / electrical rows)`);
