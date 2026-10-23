#!/usr/bin/env node
/* The Flow view's layout (mp-flow.js runs in the browser) on the Chilled water and Electricity templates: every flow
   line goes forward, each loop closes at its own source's mirror (chilled water back into the chillers, condenser water
   back to the towers; the condenser water into a chiller is not a loop end), the stops in journey order, the expansion
   tank and the generator one step before what they join, the BMS in the Controls lane, nothing overlapping.
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
runInContext(readFileSync(path.join(root, "public/tools/maps/mp-flow.js"), "utf8"), createContext({ window: win }));
const F = win.MPFlow;
const { pipingSeed } = await tsModule("worker/src/api/mp-piping.ts");
const { wiringSeed } = await tsModule("worker/src/api/mp-wiring.ts");
function flat(seed) { const all = {}; const walk = (n) => { all[n.key] = n; (n.kids || []).forEach(walk); }; seed.nodes.forEach(walk); return all; }
function check(L, nodes) {
  const P = (id) => L.pos[id] || L.mirrors.find((m) => m.id === id);
  for (const e of L.edges) if (!e.minor) assert.ok(P(e.to || e.b).layer > P(e.a).layer, `${e.a} -> ${e.to || e.b} goes forward`);
  const boxes = Object.values(L.pos).concat(L.mirrors);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id} overlap`);
  }
}
// ---------- water ----------
{
  const seed = pipingSeed("chilled-water"), all = flat(seed), circ = (rel) => (/^p-cw-/.test(rel) ? "cw" : "chw");
  const on = {}; for (const w of seed.wires) for (const k of [w.from, w.to]) (on[k] ||= new Set()).add(circ(w.rel));
  const src = (n) => { const s = (n.special || []).find((x) => /^source:/i.test(x)) || ""; return s ? (/tower/i.test(s) ? { cw: true } : { chw: true }) : null; };
  const nodes = Object.keys(on).map((id) => { const s = src(all[id]); return { id, source: s, lane: s ? Object.keys(s)[0] : on[id].has("chw") ? "chw" : "cw", w: 150, h: 40 }; });
  const edges = seed.wires.map((w) => ({ a: w.from, b: w.to, circuit: circ(w.rel) }));
  const L = F.layout(nodes, edges, ["cw", "chw"], [70, 28]);
  check(L);
  const lay = (id) => L.pos[id].layer, mir = (id) => L.mirrors.find((m) => m.of === id);
  assert.deepEqual([...L.mirrors.map((m) => m.of)].sort(), ["ch1", "ch2", "ch3", "ct1", "ct2", "ct3"], "a loop end for each chiller and tower");
  assert.ok(L.edges.find((e) => e.a === "p1" && e.b === "ch1").to === "ch1~loop", "back into CH-1 closes the loop");
  assert.ok(L.edges.find((e) => e.a === "cwp1" && e.b === "ch1").to == null, "condenser water into the chiller goes on");
  assert.ok(L.edges.find((e) => e.a === "cwrh" && e.b === "ct1").to === "ct1~loop", "back to the tower closes the condenser loop");
  // the journey of a drop of chilled water, in order
  const chw = ["ch1", "hs", "rs", "ahu1", "rr", "hr", "as", "sh", "p1"];
  for (let i = 1; i < chw.length; i++) assert.ok(lay(chw[i]) > lay(chw[i - 1]), `${chw[i - 1]} before ${chw[i]}`);
  assert.ok(mir("ch1").layer > lay("p1"));
  assert.equal(lay("ahu1"), lay("f1a1"), "AHUs and FCU groups at the same step");
  assert.equal(lay("et"), lay("sh") - 1, "the expansion tank one step before the suction header");
  const cw = ["ct1", "cwsh", "cwp1", "ch1", "cwrh"];
  for (let i = 1; i < cw.length; i++) assert.ok(lay(cw[i]) > lay(cw[i - 1]), `${cw[i - 1]} before ${cw[i]} (condenser water)`);
  const lane = (l) => L.lanes.find((x) => x.id === l);
  assert.ok(lane("cw").y + lane("cw").h < lane("chw").y, "condenser water lane above chilled water");
  assert.equal(L.pos.ch1.lane, "chw"); assert.equal(L.pos.cwp1.lane, "cw");
}
// ---------- electricity ----------
{
  const seed = wiringSeed("electricity"), all = flat(seed);
  const wired = new Set(seed.wires.flatMap((w) => [w.from, w.to]));
  const power = new Set(seed.wires.filter((w) => w.rel === "w-power").flatMap((w) => [w.from, w.to]));
  const nodes = [...wired].map((id) => ({ id, source: (all[id].special || []).some((x) => /^source:/i.test(x)) ? { power: true } : null, lane: power.has(id) ? "power" : "controls", w: 160, h: 40 }));
  const edges = seed.wires.map((w) => ({ a: w.from, b: w.to, circuit: "power", minor: w.rel !== "w-power" }));
  const L = F.layout(nodes, edges, ["power", "controls"], [70, 28]);
  check(L);
  const lay = (id) => L.pos[id].layer;
  assert.equal(L.mirrors.length, 0, "power is radial: no loop");
  const way = ["mv", "tr1", "q1", "msb", "mcc", "ahu1"];
  for (let i = 1; i < way.length; i++) assert.equal(lay(way[i]), lay(way[i - 1]) + 1, `${way[i]} the step after ${way[i - 1]}`);
  assert.equal(lay("g1"), lay("tr1"), "the generator beside the transformer"); assert.equal(lay("q2"), lay("q1"), "its incomer beside the main incomer");
  assert.equal(lay("ch1"), lay("ahu1")); assert.equal(lay("p1"), lay("ch1"), "pump starters with the chillers");
  assert.equal(L.pos.bms.lane, "controls"); assert.equal(L.pos.fap.lane, "controls");
  assert.equal(lay("bms"), lay("ch1") - 1, "the BMS one step before the first unit it commands");
  assert.ok(lay("f1a1") > lay("db1a"));
}
console.log("mp-flow check: both templates lay out as forward journeys (loops closed at 3 chillers and 3 towers; power radial, BMS in Controls).");
