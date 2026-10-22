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

/* ---- FCU technical report (McQuay Smart Tools), shaped on the Kifaf Phase-5 Plot-2 report FCU/GF/16 (FWW1400VA,
   17/7/2026): pdf.js items through DSParse.lines(), then the FCU reader, its rows, the row kinds and the cards. ---- */
runInContext(readFileSync(path.join(root, "public/tools/datasheet-notes/ds-fcu.js"), "utf8"), createContext({ window: win, console }));
const items = [];
let fy = 900;
const W = (s) => s.length * 5.2;
const it = (s, x, f = "R", h = 10) => items.push({ str: s, transform: [h, 0, 0, h, x, fy], width: W(s), height: h, fontName: f });
const fl = (...pairs) => { fy -= 20; for (let i = 0; i < pairs.length; i += 2) if (pairs[i] !== null) it(pairs[i], pairs[i + 1]); };
const head = (s) => { fy -= 20; it(s, 6, "B"); };
fy -= 20; it("FAN COIL UNIT TECHNICAL REPORT", 232, "B", 14);
fl("Project:Kifaf Phase-5 Plot-2", 232, "Unit No.:FCU/GF/16", 477);
fl("Software Name: McQuay Smart Tools", 232, "Selection date:17/7/2026", 477);
fl("Software version:V1.0.19", 232);
head("General");
fl("Unit Model", 6, "FWW1400VA", 245, "Power Source", 404, "220-240V~/50Hz", 646);
fl("Application/Design Air Flow(m³/h)", 6, "1869/2030", 245, "Fan Control type", 404, "3 Speed", 646);
fl("Application/Design ESP (Pa)", 6, "50/50", 245, "Fan Speed", 404, "Medium", 646);
fl("Fan Power Input (W)", 6, "283", 245, "Running current", 404, "(A)", 520, "1.26", 646);
fl("Net Dimension W*D*H (mm)", 6, "1825*536*235", 245, "Shipping Dimension W*H*D (mm)", 404, "1841*558*250", 646);
fl("Unit Net Weight (kg)", 6, "43.6", 245, "Altitude(m)", 404, "0", 646);
head("Configuration information");
fl("Drain Pan Type", 6, "Standard", 245, "Return Plenum Type", 404, "Back", 646);
fl("Drain Pan Material", 6, "Cold-rolled Steel", 245, "Return Plenum Insulation", 404, "5mmXPE", 646);
fl("Drain Pan Insulation", 6, "Standard", 245, "Filter Type", 404, "25mm AL Filter", 646);
fl("Coil area (m²)", 6, "0.34", 245, "Face Velocity(m/s)", 404, "1.54", 646);
fl("FPI", 6, "15", 245, "Fins Material", 404, "Hydrophilic Aluminum", 646);
fl("Pipe Connection", 6, "Left", 245, "Water Connection Size", 404, "Rc3/4", 646);
fl("Motor type", 6, "AC", 245, "Fan Qty", 404, "4", 646);
fl("Rated Motor Speed (RPM)", 6, "1316", 245, "Motor Qty", 404, "2", 646);
head("Cooling coil (Cooling Mode)");
fl("Total Cooling Capacity(kW)", 6, "6.87", 245, "Sensible Cooling Capacity(kW)", 404, "5.89", 646);
fl("On Coil (DB/WB) (°C)", 6, "22.4/16.0", 245, "EWT(°C)", 404, "5.50", 646);
fl("Off Coil (DB/WB) (°C)", 6, "11.8/11.2", 245, "LWT(°C)", 404, "15.50", 646);
fl("Coil Rows", 6, "4", 245, "WPD (kPa)", 404, "15.0", 646);
fl("Water Volume (L)", 6, "2.38", 245, "Water Flow Rate (l/s)", 404, "0.164", 646);
head("Cooling coil (Heating Mode)");
fl("Heating Capacity(kW)", 6);
fl("On Coil (DB) (°C)", 6, "EWT(°C)", 404);
fl("Off Coil (DB) (°C)", 6, "LWT(°C)", 404);
fl("Water Flow Rate (l/s)", 6, "WPD (kPa)", 404);
head("Electric Heater");
fl("Heating Capacity(kW)", 6, "E-Heater Maximum Current (A)", 404);
fl("On Coil (DB) (°C)", 6, "Off Coil (DB) (°C)", 404);
head("Acoustical performance");
const bands = ["63Hz", "125Hz", "250Hz", "500Hz", "1000Hz", "2000Hz", "4000Hz", "8000Hz", "Overall"], bx = [245, 322, 395, 462, 533, 604, 675, 746, 816];
fl("Octave Band", 6, ...bands.flatMap((b, i) => [b, bx[i]]));
fl("Lw Inlet + Rad(dB(A))", 6, ...["33.1", "50.4", "58.4", "63.5", "62.2", "60.8", "55.5", "48.2", "68"].flatMap((v, i) => [v, bx[i]]));
fl("Lw Outlet Duct(dB(A))", 6, ...["30.2", "44.3", "50.2", "56", "58.7", "56.1", "53.9", "49.1", "63"].flatMap((v, i) => [v, bx[i]]));
fl("Note:", 6);
fl("(1)The acoustical performance is certificated by Eurovent at rated condition.", 6);
// the right column must be the most common start between 40 % and 60 % of the width: more right labels than bands
const fpages = [P.lines(items, 1)];
assert.equal(P.detect(fpages), "fcu");
const [fcu] = P.parseAll(fpages);
assert.deepEqual([...fcu.warnings], []);
assert.equal(fcu.hdr.unit, "FCU/GF/16");
assert.equal(fcu.hdr.project, "Kifaf Phase-5 Plot-2");
assert.equal(fcu.hdr.factory, "Shenzhen");
assert.equal(fcu.hdr.power, "220-240V~/50Hz");
const frows = P.rows(fcu, { product: "FCU" });
const fv = Object.fromEntries(frows.map((r) => [r.key, r.value]));
assert.equal(fv["unit data||unit model"], "FWW1400VA");
assert.equal(fv["unit data||application air flow(m³/h)"], "1869");
assert.equal(fv["unit data||design air flow(m³/h)"], "2030");
assert.equal(fv["unit data||application esp (pa)"], "50");
assert.equal(fv["unit data||running current (a)"], "1.26");
assert.equal(fv["configuration information||water connection size"], "Rc3/4");            // not a pair of figures
assert.equal(fv["cooling coil (cooling mode)||on coil db (°c)"], "22.4");
assert.equal(fv["cooling coil (cooling mode)||on coil wb (°c)"], "16.0");
assert.equal(fv["cooling coil (cooling mode)||off coil wb (°c)"], "11.2");
assert.equal(fv["acoustical performance|lw inlet + rad(db(a))|overall"], "68");
assert.equal(fv["general||power supply"], "220-240V~/50Hz");
// a cooling-only unit: the empty heating and electric heater blocks are not sections of the unit
assert.deepEqual([...fcu.sections.map((s) => s.name)], ["Configuration information", "Cooling coil (Cooling Mode)", "Acoustical performance"]);
assert.ok(!frows.some((r) => r.value === ""), "a row with no value was kept");
assert.ok(!frows.some((r) => /eurovent|note/i.test(r.component + r.value)), "a footnote was read as a row");
// every row lands in an FCU Product Options card
const FC = win.DSParse.readers.fcu;
const cardOf = Object.fromEntries(frows.filter((r) => r.group !== "General").map((r) => [r.key, (FC.poCardOf(r.key, r.group) || {}).id]));
assert.ok(Object.values(cardOf).every(Boolean), "an FCU row has no card: " + JSON.stringify(cardOf));
assert.equal(cardOf["unit data||fan power input (w)"], "fcu-fan");
assert.equal(cardOf["configuration information||fins material"], "fcu-coil");
assert.equal(cardOf["configuration information||return plenum type"], "fcu-unit");
assert.equal(cardOf["configuration information||drain pan material"], "fcu-drain");
assert.equal(cardOf["acoustical performance|lw outlet duct(db(a))|63hz"], "fcu-sound");
console.log(`ds-parse check: FCU OK (${frows.length} rows, ${fcu.sections.length} sections)`);
