#!/usr/bin/env node
/* Signs of a map (mp-signs.js runs in the browser): every branch of the Electricity and Chilled water templates and of
   the product wiring diagrams gets the sign its name calls for, and a special note "Icon: ..." wins. Part of `npm test`. */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
async function tsModule(rel) {
  let src = readFileSync(path.join(root, rel), "utf8").replace(/^import .*$/gm, "");
  src += "\nfunction uuid() { return Math.random().toString(16).slice(2); }";       // mp-wiring imports it; not used here
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}
const win = {};
runInContext(readFileSync(path.join(root, "public/tools/maps/mp-signs.js"), "utf8"), createContext({ window: win }));
const G = win.MPSigns;
const { wiringSeed, productSeed } = await tsModule("worker/src/api/mp-wiring.ts");
const { pipingSeed } = await tsModule("worker/src/api/mp-piping.ts");
const titles = [];
const walk = (n) => { titles.push(n.title); (n.kids || []).forEach(walk); };
for (const s of [wiringSeed("electricity"), pipingSeed("chilled-water")]) s.nodes.forEach(walk);
for (const t of ["ahu-ec", "ahu-dc", "fcu-ec", "fcu-dc", "chiller"]) productSeed(t).kids.forEach(walk);
const got = Object.fromEntries(titles.map((t) => [t, G.guess(t)]));

const want = {
  "Utility supply (MV)": "utility", "Transformer TR-1 (MV/LV)": "transformer", "Standby generator G-1": "generator",
  "Main incomer Q1 (utility)": "breaker", "Generator incomer Q2": "breaker", "Main switchboard (MSB)": "panel",
  "SMDB-CH, chiller plant room": "panel", "MCC-AHU, AHU plant rooms": "panel", "DB-L1-A, Level 1 zone A": "panel",
  "Chillers": "chiller", "Chiller CH-1": "chiller", "AHUs": "ahu", "AHU-01, Level 1": "ahu", "FCUs": "fcu",
  "FCU circuit L1-A1 (FCU-L1-01 to 08)": "fcu", "BMS": "controller",
  "Unit control panel": "panel", "Main isolator (Q0)": "breaker", "Earth bar (PE)": "earth", "Fan circuit breakers (Q1, Q2)": "breaker",
  "Supply fan drive (U1)": "drive", "Control transformer (T1)": "transformer", "Unit controller (A1)": "controller",
  "Field terminal strip (X2)": "terminal", "Supply EC fan (M1)": "fan", "Supply fan DC motor (M1)": "motor",
  "Filter differential pressure switch (B1)": "sensor", "Supply air temperature sensor (B2)": "sensor", "Fresh air damper actuator (Y1)": "damper",
  "Fire alarm panel (shutdown contact)": "alarm", "Chilled water valve actuator": "valve", "FCU electrical box": "panel",
  "Terminal block (X1)": "terminal", "Motor driver board (A2)": "drive", "EC fan motor (M1)": "motor", "Condensate float switch (optional)": "sensor",
  "Room controller / thermostat": "controller", "Chiller control panel": "panel", "Compressors": "compressor", "Condenser fans": "fan",
  "Chilled water flow switch": "sensor", "Chilled water pump starter": "breaker", "Remote alarm indication": "alarm",
  "Chiller plant": "chiller", "Chilled water pumps": "pump", "Chilled water pump P-1": "pump", "Chilled water pump P-3 (standby)": "pump", "CHWS header, plant room": "header",
  "Cooling towers": "tower", "Cooling tower CT-1": "tower", "Condenser water pump CWP-1": "pump", "CWS header, plant room": "header", "CWR header, plant room": "header",
  "Pump suction header": "header", "Expansion tank ET-1": "tank", "Air separator AS-1": "separator", "Condenser water": "",
  "CHWS riser to AHU plant rooms": "pipe", "CHWS branch, Level 1": "pipe", "FCU group L1-A1 (FCU-L1-01 to 08)": "fcu",
  "CHWR riser from AHU plant rooms": "pipe", "CHWR header, plant room": "header",
  // column heads and groups that are not a component: no sign
  "Supply": "", "Main distribution": "", "HVAC equipment": "", "Controls": "", "On the unit": "", "Site (by others)": "", "Units": ""
};
for (const [t, id] of Object.entries(want)) {
  assert.ok(t in got, `not in the templates any more: ${t}`);
  assert.equal(got[t], id, `${t}: ${got[t] || "no sign"}, expected ${id || "no sign"}`);
}
// names that only look like components
assert.equal(G.guess("Sound pressure level (dB(A))"), "");
assert.equal(G.guess("Instructions"), "");
// the special note wins: an id, a name, or none
assert.equal(G.of({ title: "Thing", special: ["Icon: pump"] }), "pump");
assert.equal(G.of({ title: "Thing", special: ["Icon: Heat exchanger"] }), "hx");
assert.equal(G.of({ title: "Pump P-9", special: ["Icon: none"] }), "");
assert.equal(G.of({ title: "Pump P-9", special: [] }), "pump");
for (const id of G.ids) assert.match(G.svg(id), /^<svg[^>]*currentColor/, id);          // theme colours only
assert.ok(!/#[0-9a-f]{3,6}\b/i.test(readFileSync(path.join(root, "public/tools/maps/mp-signs.js"), "utf8")), "no fixed colour in the signs");
console.log(`mp-signs check: ${Object.keys(want).length} template branches get the right sign (${G.ids.length} signs).`);
