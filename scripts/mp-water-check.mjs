#!/usr/bin/env node
/* Water of a piping map (mp-water.js runs in the browser, so Vitest in workerd cannot load it). The worked example is
   the Chilled water template itself (worker/src/api/mp-piping.ts): two duty chillers of 30 l/s design flow at 6.7 °C,
   P-3 on standby, four AHUs and five FCU groups. Hand figures (4.19 kW per l/s per K):
     total flow   12 + 12 + 9.5 + 9.5 + 2 + 2 + 1.6 + 2 + 1.8 = 52.4 l/s, 26.2 l/s per duty chiller (87.3 % of 30 l/s)
     return       (24 × 13.0 + 19 × 12.5 + 9.4 × 12.0) / 52.4 = 662.3 / 52.4 = 12.639 °C
     AHU-01       4.19 × 12 × (13.0 − 6.7) = 316.76 kW
     plant        4.19 × 52.4 × (12.639 − 6.7) = 1304.0 kW = sum of the units' loads (energy balance)
   Part of `npm test`. */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
// the template's TypeScript, made JavaScript here (any Node version, no type stripping needed)
const tsSrc = readFileSync(path.join(root, "worker/src/api/mp-piping.ts"), "utf8");
const js = ts.transpileModule(tsSrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { pipingSeed } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const win = {};
runInContext(readFileSync(path.join(root, "public/tools/maps/mp-water.js"), "utf8"), createContext({ window: win }));
const W = win.MPWater;
const near = (a, b, tol = 0.01, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b}`);

// the template as the map holds it: ids are the template keys, each pipe kept on the branch it was drawn from
function mapOf(seed) {
  const nodes = {};
  const walk = (n) => { nodes[n.key] = { id: n.key, title: n.title, special: [...(n.special || [])], links: [] }; (n.kids || []).forEach(walk); };
  walk(seed.guide); seed.nodes.forEach(walk);
  for (const w of seed.wires) nodes[w.from].links.push({ kind: "node", node: w.to, rel: w.rel });
  return nodes;
}
const nodes = mapOf(pipingSeed("chilled-water"));
let r = W.compute(nodes);

// as the template says: CH-1 and CH-2 run, CH-3 waits behind its standby pump
assert.deepEqual(Object.keys(r.active).sort(), ["ch1", "ch2"]);
near(r.total.q, 52.4, 1e-9, "plant flow");
near(r.source.ch1.q, 26.2, 1e-9, "CH-1 flow"); near(r.source.ch2.q, 26.2, 1e-9, "CH-2 flow");
assert.equal(r.source.ch3.q, 0);
near(r.source.ch1.pct, 87.33, 0.01, "CH-1 share of design");
assert.equal(r.source.ch1.over, false);
// pipes and headers carry the sum of what is behind them
near(r.flow.hs, 52.4, 1e-9, "CHWS header"); near(r.flow.rs, 43, 1e-9, "AHU riser"); near(r.flow.sl1, 5.6, 1e-9, "Level 1 branch");
near(r.flow.hr, 52.4, 1e-9, "CHWR header"); near(r.flow.p1, 26.2, 1e-9, "P-1"); assert.equal(r.flow.p3, 0);
near(r.dir["ch1>hs"], 26.2, 1e-9, "CH-1 to header"); near(r.dir["ahu1>rr"], 12, 1e-9, "AHU-01 return"); near(r.dir["hr>p2"], 26.2, 1e-9, "header to P-2");
assert.equal(r.dir["hs>ch1"], undefined);
// temperatures and loads
near(r.tSupply.ahu4, 6.7, 1e-9, "supply at AHU-04");
near(r.tReturn.hr, 662.3 / 52.4, 1e-6, "mixed return");
near(r.source.ch2.back, 662.3 / 52.4, 1e-6, "CH-2 entering");
near(r.kw.ahu1, 316.764, 1e-6, "AHU-01 load");
near(r.total.kw, 1304.01, 0.05, "plant load");
const unitsKw = ["ahu1", "ahu2", "ahu3", "ahu4", "f1a1", "f1a2", "f1b1", "f2a1", "f2a2"].reduce((t, k) => t + r.kw[k], 0);
near(r.total.kw, unitsKw, 1e-6, "energy balance");
near(r.tEdge["ahu1>rr"], 13, 1e-9, "AHU-01 return water"); near(r.tEdge["ch1>hs"], 6.7, 1e-9, "CHWS");
assert.equal(W.fmtKw(r.kw.ahu1), "317 kW (90.1 TR)");
assert.equal(W.fmtFlow(r.total.q, r.unit.flow), "52.4 l/s");
assert.equal(W.fmtTemp(r.total.back, r.unit.temp), "12.6 °C");

// stop P-1: CH-1 has no return path, CH-2 carries everything and is over its design flow; start P-3: CH-3 shares it
r = W.compute(nodes, { p1: true });
assert.deepEqual(Object.keys(r.active).sort(), ["ch2"]);
near(r.source.ch2.q, 52.4, 1e-9, "CH-2 alone"); assert.equal(r.source.ch2.over, true);
r = W.compute(nodes, { p1: true, p3: false });
assert.deepEqual(Object.keys(r.active).sort(), ["ch2", "ch3"]);
near(r.source.ch3.q, 26.2, 1e-9, "CH-3 after start");
// close the valve of AHU-01: 12 l/s less everywhere, the return gets cooler
r = W.compute(nodes, { ahu1: true });
near(r.total.q, 40.4, 1e-9, "without AHU-01"); assert.equal(r.flowing.ahu1, undefined); assert.equal(r.flow.ahu1, 0);
near(r.tReturn.hr, (12 * 13 + 19 * 12.5 + 9.4 * 12) / 40.4, 1e-6, "return without AHU-01");
// stop both duty chillers: nothing runs (the standby pump keeps CH-3 off)
r = W.compute(nodes, { ch1: true, ch2: true });
assert.equal(r.total.q, 0); assert.equal(r.flow.hs, 0); assert.equal(Object.keys(r.active).length, 0);

// unequal design flows share in proportion; a source without one makes it equal
const n2 = mapOf(pipingSeed("chilled-water"));
n2.ch1.special = ["Source: chiller", "Leaving: 6.7 °C", "Design flow: 40 l/s"];
n2.ch2.special = ["Source: chiller", "Leaving: 6.7 °C", "Design flow: 20 l/s"];
r = W.compute(n2);
near(r.source.ch1.q, 52.4 * 2 / 3, 1e-9, "40 / 20 share"); near(r.source.ch2.q, 52.4 / 3, 1e-9, "40 / 20 share");
n2.ch2.special = ["Source: chiller", "Leaving: 5.5 °C"];
r = W.compute(n2);
near(r.source.ch1.q, 26.2, 1e-9, "equal share"); assert.equal(r.byDesign, false);
near(r.tSupply.hs, 6.1, 1e-9, "two set points mixed");

// the inputs in other units, and a load instead of a leaving temperature
const n3 = mapOf(pipingSeed("chilled-water"));
n3.ahu1.special = ["Flow: 45 m³/h", "Leaving: 55.4 °F"];
n3.ahu2.special = ["Flow: 10 l/s", "Load: 209.5 kW"];
n3.ahu3.special = ["Flow: 150.6 gpm", "Load: 50 TR"];
r = W.compute(n3);
near(r.input.flow.ahu1, 12.5, 1e-9, "m³/h"); near(r.tOut.ahu1, 13, 1e-9, "°F");
near(r.tOut.ahu2, 6.7 + 209.5 / (4.19 * 10), 1e-9, "leaving from the load"); near(r.tOut.ahu2, 11.7, 1e-9, "leaving from the load");
near(r.input.flow.ahu3, 150.6 * 0.0630902, 1e-9, "gpm"); near(r.kw.ahu3, 50 * 3.517, 1e-9, "TR");
assert.equal(W.num("1,207 kW"), 1207); assert.equal(W.num("12,5 l/s"), 12.5);
assert.equal(W.tempOf("13 °C").v, 13); assert.equal(W.flowOf("2 L/s").v, 2);
// a unit without a leaving temperature: counted in the flow, left out of the mixed return and listed
n3.ahu4.special = ["Flow: 9.5 l/s"];
r = W.compute(n3);
assert.deepEqual([...r.missing], ["ahu4"]); near(r.flow.rs, 12.5 + 10 + 150.6 * 0.0630902 + 9.5, 1e-9, "riser with AHU-04");

// most inputs in m³/h: the map speaks m³/h
const n4 = mapOf(pipingSeed("chilled-water"));
for (const k of ["ahu1", "ahu2", "ahu3", "ahu4", "f1a1", "f1a2", "f1b1", "f2a1", "f2a2"]) n4[k].special = n4[k].special.map((s) => s.startsWith("Flow:") ? "Flow: " + (W.flowOf(s.slice(5)).v * 3.6) + " m³/h" : s);
r = W.compute(n4);
assert.equal(r.unit.flow, "m3h"); assert.equal(W.fmtFlow(r.total.q, r.unit.flow), "188.6 m³/h");

// no pipes: nothing to compute
assert.equal(W.compute({ a: { id: "a", special: [], links: [] } }), null);
console.log("mp-water check: the Chilled water example works out (52.4 l/s, 12.6 °C return, 1,304 kW).");
