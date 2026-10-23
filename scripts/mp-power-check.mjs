#!/usr/bin/env node
/* What a wiring map's current does (mp-power.js runs in the browser), on the Electricity template: the load summed up
   the tree (5 AHUs of 30 kW = 150 kW), each Max power kept by shedding (a sixth AHU; the 900 kW generator on standby
   sheds chiller CH-3 and its interlocked pump), diversity, the BMS night schedule, the fire alarm, units in kW / kVA / A.
   Part of `npm test`. */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
async function tsModule(rel) {
  let src = readFileSync(path.join(root, rel), "utf8").replace(/^import .*$/gm, "");
  src += "\nfunction uuid() { return Math.random().toString(16).slice(2); }";
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}
const win = {};
runInContext(readFileSync(path.join(root, "public/tools/maps/mp-power.js"), "utf8"), createContext({ window: win }));
const P = win.MPPower;
const { wiringSeed } = await tsModule("worker/src/api/mp-wiring.ts");
// the template as the page holds it: id = key, parent, special, links to ids
function mapOf() {
  const seed = wiringSeed("electricity"), nodes = { root: { id: "root", parent: null, title: "Electrical", special: [], links: [] } };
  const walk = (n, parent) => { nodes[n.key] = { id: n.key, parent, title: n.title, special: [...(n.special || [])], links: [] }; (n.kids || []).forEach((k) => walk(k, n.key)); };
  seed.nodes.forEach((n) => walk(n, "root"));
  for (const w of seed.wires) nodes[w.from].links.push({ kind: "node", node: w.to, rel: w.rel });
  return nodes;
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} expected ${b}`);
let m = mapOf(), r = P.compute(m, {});
near(r.dem.mcc, 120, "MCC-AHU carries 4 AHUs of 30 kW");
near(r.dem.smdbch, 3 * 320 + 3 * 22, "SMDB-CH: 3 chillers and 3 pumps");
near(r.dem.db1a, 2.4, "DB-L1-A: two FCU circuits");
near(r.dem.msb, 1152, "MSB: everything");
near(r.dem.mv, 1152, "the utility supply");
assert.equal(Object.keys(r.shed).length, 0); assert.equal(r.over.length, 0);
near(r.max.tr1, 1440, "1600 kVA at PF 0.9");
// a fifth AHU of 30 kW: 150 kW on a 150 kW MCC, no warning; a sixth: shed (no Priority: goes first), the MCC stays at 150 kW
const addAhu = (k) => { m[k] = { id: k, parent: "mcc", title: k, special: ["Power: 30 kW"], links: [] }; m.mcc.links.push({ kind: "node", node: k, rel: "w-power" }); };
addAhu("ahu5"); r = P.compute(m, {});
near(r.dem.mcc, 150, "5 AHUs of 30 kW = 150 kW"); assert.equal(Object.keys(r.shed).length, 0);
addAhu("ahu6"); r = P.compute(m, {});
assert.deepEqual(Object.keys(r.shed), ["ahu6"]); assert.equal(r.shed.ahu6, "mcc"); assert.equal(r.sheds.mcc, 1);
near(r.dem.mcc, 150, "MCC kept at its max"); assert.equal(r.state.ahu6, "shed"); assert.ok(!r.on.ahu6);
// with Priorities: the sixth AHU essential (1): an AHU with Priority 2 is shed instead (the last of them in the map)
m.ahu6.special.push("Priority: 1"); m.ahu5.special.push("Priority: 1"); r = P.compute(m, {});
assert.deepEqual(Object.keys(r.shed), ["ahu4"]);
// standby: utility isolated, generator incomer closed: 1,152 kW on a 900 kW generator sheds CH-3 and its pump stops (interlock)
m = mapOf(); r = P.compute(m, { iso: { mv: true, q2: false } });
assert.deepEqual(Object.keys(r.shed), ["ch3"]); assert.equal(r.shed.ch3, "g1");
assert.equal(r.state.p3, "interlock");
near(r.dem.g1, 1152 - 320 - 22, "the generator after shedding"); assert.ok(r.dem.g1 <= r.max.g1);
assert.equal(r.state.ch1, "running"); assert.equal(r.state.ahu1, "running");
// a load the BMS stops draws nothing; night: the AHUs and FCU circuits stop
r = P.compute(m, { night: true });
near(r.dem.mcc, 0, "night: AHUs off"); near(r.dem.msb, 3 * 342, "night: the chiller plant only");
r = P.compute(m, { cmd: { ch1: false } }); near(r.dem.smdbch, 2 * 342, "CH-1 stopped by the BMS, its pump with it"); assert.equal(r.state.p1, "interlock");
// fire alarm: the AHUs stop
r = P.compute(m, { fire: true }); near(r.dem.mcc, 0, "fire alarm: AHUs stopped"); assert.equal(r.state.ahu2, "fire");
// diversity on a board
m.msb.special.push("Diversity: 80 %"); r = P.compute(m, {}); near(r.dem.msb, 1152 * 0.8, "MSB with 0.8 diversity");
near(r.cdem.msb, 1152 * 0.8, "connected (design) = demand when all run");
// units
near(P.kwOf("630 kVA"), 567, "kVA"); near(P.kwOf("630 kVA", 0.8), 504, "kVA at PF 0.8"); near(P.kwOf("1.5 MW"), 1500, "MW");
near(P.kwOf("400 A"), Math.sqrt(3) * 400 * 400 * 0.9 / 1000, "A three-phase 400 V"); near(P.kwOf("16 A 1Ph"), 230 * 16 * 0.9 / 1000, "A single-phase 230 V");
near(P.kwOf("750 W"), 0.75, "W"); near(P.kwOf("10 hp"), 7.457, "hp"); near(P.kwOf("30"), 30, "a bare number is kW");
console.log("mp-power check: the Electricity template sums (MCC 120 kW, MSB 1,152 kW), keeps every Max power by shedding (6th AHU; CH-3 on the generator), night, BMS, fire alarm, units.");
