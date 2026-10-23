#!/usr/bin/env node
/* Water of a piping map (mp-water.js runs in the browser, so Vitest in workerd cannot load it). The worked example is the
   Chilled water template itself (worker/src/api/mp-piping.ts). Every figure below is worked out again here by hand
   (independently of mp-water.js) and compared. Part of `npm test`.
     chilled water   12 + 12 + 9.5 + 9.5 + 2 + 2 + 1.6 + 2 + 1.8 = 52.4 l/s, 26.2 l/s per duty chiller (87.3 % of 30 l/s)
                     return (24 × 13.0 + 19 × 12.5 + 9.4 × 12.0) / 52.4 = 12.639 °C; plant 4.19 × 52.4 × 5.939 = 1,304 kW
     condenser       each chiller rejects 652.0 × (1 + 1/5.5) = 770.6 kW; 2 × 38 l/s; back 32 + 1,541.1 / (4.19 × 76) = 36.84 °C
     pumps           H(Q) = Hd (1.2 − 0.2 (Q/Qd)²): P-1 at 26.2 of 30 l/s, 18 m: 176.5 × 1.0475 = 184.9 kPa
     pipes           Darcy-Weisbach with Colebrook (solved here by iteration; the map uses Swamee-Jain), + 30 % fittings */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tsSrc = readFileSync(path.join(root, "worker/src/api/mp-piping.ts"), "utf8");
const js = ts.transpileModule(tsSrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { pipingSeed } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const win = {};
runInContext(readFileSync(path.join(root, "public/tools/maps/mp-water.js"), "utf8"), createContext({ window: win }));
const W = win.MPWater;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} (± ${tol})`);

// the template as the map holds it: ids are the template keys, each pipe kept on the branch it was drawn from
function mapOf() {
  const seed = pipingSeed("chilled-water"), nodes = {};
  const walk = (n) => { nodes[n.key] = { id: n.key, title: n.title, special: [...(n.special || [])], links: [] }; (n.kids || []).forEach(walk); };
  walk(seed.guide); seed.nodes.forEach(walk);
  for (const w of seed.wires) { const l = { kind: "node", node: w.to, rel: w.rel }; for (const k of ["cable", "len", "signal"]) if (w[k]) l[k] = w[k]; nodes[w.from].links.push(l); }
  return { nodes, wires: seed.wires };
}
const setNote = (n, name, value) => { n.special = n.special.filter((s) => !new RegExp("^\\s*" + name + "\\s*:", "i").test(s)); if (value) n.special.push(name + ": " + value); };

// ---------- independent hand figures ----------
const ID = { 25: 26.6, 50: 52.5, 65: 62.7, 80: 77.9, 100: 102.3, 150: 154.1, 200: 202.7 };
function colebrook(lps, dn, len) {                         // kPa, Colebrook-White solved by iteration
  const d = ID[dn] / 1000, v = lps / 1000 / (Math.PI * d * d / 4), re = v * d / 1.307e-6;
  let f = 0.02; for (let i = 0; i < 50; i++) f = Math.pow(-2 * Math.log10(0.045e-3 / (3.7 * d) + 2.51 / (re * Math.sqrt(f))), -2);
  return f / d * 1000 * v * v / 2 * len * 1.3 / 1000;
}
const { nodes, wires } = mapOf();
const pipe = (a, b) => { const w = wires.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a)); return { dn: W.num(w.cable), len: W.num(w.len) }; };
const hand = (a, b, q) => { const p = pipe(a, b); return colebrook(q, p.dn, p.len); };

let r = W.compute(nodes), chw = r.circuits.chw, cw = r.circuits.cw;

// flows and temperatures (the template's pumps give every unit its design flow)
assert.deepEqual(Object.keys(chw.active).sort(), ["ch1", "ch2"]);
near(chw.total.q, 52.4, 1e-9, "plant flow");
near(chw.source.ch1.q, 26.2, 1e-9, "CH-1 flow"); assert.equal(chw.source.ch3.q, 0);
near(chw.source.ch1.pct, 87.33, 0.01, "CH-1 share of design");
near(chw.flow.hs, 52.4, 1e-9, "CHWS header"); near(chw.flow.rs, 43, 1e-9, "AHU riser"); near(chw.flow.sl1, 5.6, 1e-9, "Level 1 branch");
near(chw.flow.hr, 52.4, 1e-9, "CHWR header"); near(chw.flow.as, 52.4, 1e-9, "air separator"); near(chw.flow.p1, 26.2, 1e-9, "P-1"); assert.equal(chw.flow.p3, 0);
assert.equal(chw.flow.et, 0, "the expansion tank has no flow");
near(chw.tReturn.hr, 662.3 / 52.4, 1e-6, "mixed return");
near(chw.kw.ahu1, 4.19 * 12 * 6.3, 1e-6, "AHU-01 load");
near(chw.total.kw, 4.19 * 52.4 * (662.3 / 52.4 - 6.7), 1e-6, "plant load");
assert.equal(Object.keys(chw.starved).length, 0, "nobody short of pressure with the template's pumps");
// condenser water: the chillers' heat rejected, through the towers
near(r.reject.ch1, 4.19 * 26.2 * (662.3 / 52.4 - 6.7) * (1 + 1 / 5.5), 1e-6, "CH-1 heat rejected");
assert.deepEqual(Object.keys(cw.active).sort(), ["ct1", "ct2", "ct3"]);
near(cw.total.q, 76, 1e-9, "condenser water flow"); near(cw.flow.ch1, 38, 1e-9, "CH-1 condenser"); assert.equal(cw.flow.ch3, 0);
near(cw.tReturn.cwrh, 32 + 2 * r.reject.ch1 / (4.19 * 76), 1e-6, "condenser water back");
near(cw.source.ct1.kw, 2 * r.reject.ch1 / 3, 1e-6, "each tower's share");
assert.equal(r.noCondenser.length, 0); assert.equal(r.copAssumed.length, 0);

// pipes against Colebrook
near(chw.hyd.pipe["ch1>hs"].dp, hand("ch1", "hs", 26.2), hand("ch1", "hs", 26.2) * 0.02, "DN 150 pipe drop");
near(chw.hyd.pipe["sl2>f2a2"].dp, hand("sl2", "f2a2", 1.8), hand("sl2", "f2a2", 1.8) * 0.02, "DN 50 pipe drop");
near(chw.hyd.pipe["ch1>hs"].v, 0.0262 / (Math.PI * 0.1541 * 0.1541 / 4), 1e-9, "velocity");
assert.equal(Object.values(chw.hyd.pipe).filter((p) => p.missing).length, 0, "every template pipe has a size and a length");
assert.equal(Object.values(chw.hyd.pipe).concat(Object.values(cw.hyd.pipe)).filter((p) => p.fast).length, 0, "no template pipe over 400 Pa/m or 3 m/s");

// pump on its curve
const hd = 18 * 9.807;
near(chw.hyd.pump.p1.h, hd * (1.2 - 0.2 * (26.2 / 30) ** 2), 1e-9, "P-1 head at 26.2 l/s");
near(chw.hyd.pump.p1.own, 15 * (26.2 / 30) ** 2, 1e-9, "P-1 strainer and valves");

// available at the last FCU group: the loop through P-2 and CH-2, worked out by hand
const loop = [["p2", "ch2", 26.2], ["ch2", "hs", 26.2], ["hs", "sl2", 3.8], ["sl2", "f2a2", 1.8], ["f2a2", "rl2", 1.8], ["rl2", "hr", 3.8], ["hr", "as", 52.4], ["as", "sh", 52.4], ["sh", "p2", 26.2]];
const pipes = loop.reduce((t, [a, b, q]) => t + hand(a, b, q), 0);
const avail = chw.hyd.pump.p2.h - chw.hyd.pump.p2.own - 55 * (26.2 / 30) ** 2 - 10 * (52.4 / 60) ** 2 - pipes;
near(chw.hyd.avail.f2a2, avail, 1.0, "available at FCU group L2-A2");
assert.equal(chw.hyd.index.id, "f2a2", "the last FCU group is the index unit");
near(chw.hyd.index.margin, avail - 40, 1.0, "its margin");
// absolute pressure: 1.7 bar at the suction header, 10 m higher at Level 2
const back = [["f2a2", "rl2", 1.8], ["rl2", "hr", 3.8], ["hr", "as", 52.4], ["as", "sh", 52.4]].reduce((t, [a, b, q]) => t + hand(a, b, q), 0) + 10 * (52.4 / 60) ** 2;
near(chw.hyd.absOut.f2a2, 170 + back - 9.807 * 10, 1.0, "FCU group L2-A2 outlet, gauge");
assert.equal(chw.hyd.tank.id, "et");
// the condenser water is open: 0 bar at the towers' basins on the roof (18 m)
assert.equal(cw.hyd.tank.open, true);
const q3 = 76 / 3;
near(cw.hyd.avail.ch1, cw.hyd.pump.cwp1.h - 15 - hand("ch1", "cwrh", 38) - hand("cwrh", "ct1", q3) - 4 * 9.807 - 20 * (q3 / 38) ** 2
  - hand("ct1", "cwsh", q3) - hand("cwsh", "cwp1", 38) - hand("cwp1", "ch1", 38), 1.0, "available at CH-1's condenser");

// short of pressure: a 12 m pump cannot feed everyone; a unit short of it settles where its drop equals what it has
const n2 = mapOf().nodes;
["p1", "p2"].forEach((p) => setNote(n2[p], "Pump head", "12 m"));
r = W.compute(n2); chw = r.circuits.chw;
assert.ok(Object.keys(chw.starved).length > 0, "a 12 m pump leaves units short");
for (const [u, s] of Object.entries(chw.starved)) near(chw.hyd.avail[u], chw.input.dp[u] * s * s, 0.5, `${u} settles on its own drop`);
assert.ok(chw.total.q < 52.4);

// stop P-1: CH-2 carries all, above its design flow; P-2 runs far out on its curve and the far units go short
r = W.compute(nodes, { p1: true }); chw = r.circuits.chw;
assert.deepEqual(Object.keys(chw.active), ["ch2"]); assert.equal(chw.source.ch2.over, true);
assert.ok(Object.keys(chw.starved).length > 0, "one pump for the whole plant is not enough");
// start P-3 with P-1 stopped: CH-3 takes its share; its condenser pump is still on standby: flagged
r = W.compute(nodes, { p1: true, p3: false });
assert.deepEqual(Object.keys(r.circuits.chw.active).sort(), ["ch2", "ch3"]);
assert.deepEqual([...r.noCondenser], ["ch3"], "CH-3 runs without condenser water");
r = W.compute(nodes, { p1: true, p3: false, cwp3: false });
assert.equal(r.noCondenser.length, 0);
// close AHU-01's valve: 12 l/s less
r = W.compute(nodes, { ahu1: true });
near(r.circuits.chw.total.q, 40.4, 1e-9, "without AHU-01"); assert.equal(r.circuits.chw.flow.ahu1, 0);
// too low a fill pressure: the Level 2 units drop under 0.3 bar
const n3 = mapOf().nodes; setNote(n3.et, "Fill pressure", "0.6 bar");
r = W.compute(n3);
assert.ok(r.circuits.chw.hyd.low.includes("f2a2") && !r.circuits.chw.hyd.low.includes("f1a1"), "Level 2 low, Level 1 fine");
// a pump without its head: no pressures, said so
const n4 = mapOf().nodes; setNote(n4.p1, "Pump head", "");
r = W.compute(n4);
assert.equal(r.circuits.chw.hyd.ok, false); assert.deepEqual([...r.circuits.chw.hyd.pumps], ["p1"]);
// a chiller without its COP: 5.0, and said so
const n5 = mapOf().nodes; setNote(n5.ch1, "COP", "");
r = W.compute(n5);
assert.deepEqual([...r.copAssumed], ["ch1"]); near(r.reject.ch1, r.circuits.chw.source.ch1.kw * 1.2, 1e-6, "COP 5");

// inputs in other units, and a load instead of a leaving temperature
const n6 = mapOf().nodes;
n6.ahu1.special = ["Flow: 45 m³/h", "Leaving: 55.4 °F", "Pressure drop: 6 m"];
n6.ahu2.special = ["Flow: 10 l/s", "Load: 209.5 kW", "Pressure drop: 0.6 bar"];
r = W.compute(n6); chw = r.circuits.chw;
near(chw.input.flow.ahu1, 12.5, 1e-9, "m³/h"); near(chw.tOut.ahu1, 13, 1e-9, "°F"); near(chw.input.dp.ahu1, 58.842, 1e-9, "m head"); near(chw.input.dp.ahu2, 60, 1e-9, "bar");
near(chw.tOut.ahu2, 6.7 + 209.5 / (4.19 * 10), 1e-9, "leaving from the load");
assert.equal(W.dnOf("6 in").dn, 150); assert.equal(W.dnOf('4"').dn, 100); assert.equal(W.dnOf("DN 65").d, 0.0627);
assert.equal(W.num("1,207 kW"), 1207); assert.equal(W.num("12,5 l/s"), 12.5);
assert.equal(W.pressOf("2 bar"), 200); near(W.pressOf("10 psi"), 68.9476, 1e-6, "psi");

// summed loads: every header, riser and pipe run carries its units' loads (owner, 23 Oct 2026)
r = W.compute(nodes); chw = r.circuits.chw;
const ahuKw = ["ahu1", "ahu2", "ahu3", "ahu4"].reduce((t, u) => t + chw.kw[u], 0), unitsKw = Object.keys(chw.isUnit).reduce((t, u) => t + (chw.kw[u] || 0), 0);
near(chw.carried.rs, ahuKw, 0.01, "the AHU riser carries the 4 AHUs"); near(chw.carried.hs, unitsKw, 0.01, "the CHWS header carries every unit");
near(chw.carried.rr, ahuKw, 0.01, "the return riser collects the 4 AHUs"); near(chw.carried.hs, chw.total.kw, 0.5, "= the plant's load");
near(chw.carried.sl2, chw.kw.f2a1 + chw.kw.f2a2, 0.01, "the Level 2 branch carries its 2 FCU groups");
assert.equal(chw.source.ch1.capacity, 750); assert.ok(!chw.source.ch1.atCap, "650 kW of 750: not at capacity");
// a chiller over its capacity: stop CH-1 (and its pump): CH-2 takes everything, runs at 750 kW, its leaving water rises
r = W.compute(nodes, { ch1: true, p1: true }); chw = r.circuits.chw;
const c2 = chw.source.ch2;
assert.equal(c2.atCap, true); near(c2.kw, 750, 0.5, "CH-2 at its capacity");
near(c2.out, c2.back - 750 / (4.19 * c2.q), 1e-6, "leaving = return − capacity / (4.19 × flow)");
assert.ok(c2.out > 6.7 + 0.5 && c2.set === 6.7, `the supply rises above the 6.7 °C set point (${c2.out.toFixed(2)} °C)`);
near(chw.tIn.ahu1, c2.out, 1e-6, "the units get the warmer water");
near(r.reject.ch2, 750 * (1 + 1 / 5.5), 0.5, "it rejects only what it makes");
// units given by Load cannot be cooled less: the shortfall is said
const n7 = mapOf().nodes;
for (const u of ["ahu1", "ahu2", "ahu3", "ahu4"]) { setNote(n7[u], "Leaving", ""); setNote(n7[u], "Load", "300 kW"); }
r = W.compute(n7, { ch1: true, p1: true }); chw = r.circuits.chw;
assert.ok(chw.source.ch2.short > 0, "units by Load over the capacity: short"); near(chw.source.ch2.kw, 750, 0.5, "it gives its capacity");
// a riser's Max flow: lowered to 35 l/s, the AHUs share it in proportion to their design flows
const n8 = mapOf().nodes; setNote(n8.rs, "Max flow", "35 l/s");
r = W.compute(n8); chw = r.circuits.chw;
assert.ok(chw.flow.rs <= 35.0001 && chw.flow.rs > 34.9, `riser at its max flow (${chw.flow.rs})`);
for (const u of ["ahu1", "ahu2", "ahu3", "ahu4"]) { assert.equal(chw.limited[u].by, "rs"); near(chw.flow[u], chw.input.flow[u] * 35 / 43, 0.01, `${u} gets its share`); }
assert.equal(chw.limitAt.rs.max, 35); assert.ok(r.limEdge["rs>ahu1"], "the riser's pipes to the AHUs are marked");
assert.ok(!chw.limited.f1a1, "the FCUs are not on the riser");
// a return riser's max flow limits the units it collects from
const n9 = mapOf().nodes; setNote(n9.rr, "Max flow", "35 l/s");
r = W.compute(n9); chw = r.circuits.chw;
assert.equal(chw.limited.ahu3.by, "rr"); assert.ok(chw.flow.rr <= 35.0001);
assert.equal(W.compute({ a: { id: "a", special: [], links: [] } }), null);
console.log("mp-water check: the Chilled water example works out (52.4 l/s, 12.6 °C, 1,304 kW; condenser 36.8 °C; " +
  `last FCU group has ${avail.toFixed(1)} kPa for 40 kPa); summed loads, a chiller at capacity, a riser at its max flow.`);
