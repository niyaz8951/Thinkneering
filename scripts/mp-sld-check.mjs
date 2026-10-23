#!/usr/bin/env node
/* The 2D view of a wiring map (mp-schematic.js layout(), runs in the browser): the Electricity template comes out as a
   single-line diagram: every branch fed from above, the sources at the top, the standby generator beside the utility's
   transformer and its incomer beside the main incomer, each board a busbar over what it feeds, the BMS and the fire alarm
   panel on the bottom row. The tree of the map (stages, loads under their boards) plays no part: the 2D view is the wires.
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
const ctx = createContext({ window: win });
runInContext(readFileSync(path.join(root, "public/tools/maps/mp-signs.js"), "utf8"), ctx);
runInContext(readFileSync(path.join(root, "public/tools/maps/mp-schematic.js"), "utf8"), ctx);
const { wiringSeed } = await tsModule("worker/src/api/mp-wiring.ts");
const seed = wiringSeed("electricity"), nodes = {};
const walk = (n) => { nodes[n.key] = n; (n.kids || []).forEach(walk); };
seed.nodes.forEach(walk);
const wired = new Set(seed.wires.flatMap((w) => [w.from, w.to]));
const items = Object.values(nodes).filter((n) => wired.has(n.key)).map((n) => ({ id: n.key, kind: win.MPSigns.of({ title: n.title, special: n.special || [] }), place: null }));
const edges = seed.wires.map((w) => ({ a: w.from, b: w.to, power: w.rel === "w-power" }));
// how far from a source (as maps.js works it out)
const adj = {}, far = {}, q = [];
for (const e of edges) if (e.power) { (adj[e.a] ||= []).push(e.b); (adj[e.b] ||= []).push(e.a); }
for (const n of Object.values(nodes)) { const s = (n.special || []).find((x) => /^source:/i.test(x)); if (s) { far[n.key] = /standby/i.test(s) ? 0.5 : 0; q.push(n.key); } }
q.sort((a, b) => far[a] - far[b]);
while (q.length) { const x = q.shift(); for (const y of adj[x] || []) if (far[y] == null) { far[y] = Math.floor(far[x]) + 1; q.push(y); } }
win.MPSchematic.layout(items, edges, (id) => far[id] ?? 1e6);
const P = Object.fromEntries(items.map((it) => { const s = win.MPSchematic.sizeOf(it.kind, it.place); return [it.id, { ...it.place, w: s[0], h: s[1], cx: it.place.x + s[0] / 2 }]; }));
const below = (a, b) => P[b].y > P[a].y + P[a].h;
// fed from above, all the way down
for (const e of edges) if (e.power && !(e.a === "q2" && e.b === "msb")) assert.ok(below(e.a, e.b), `${e.b} is under ${e.a}`);
assert.ok(below("q2", "msb"), "the generator incomer is above the switchboard");
// the utility at the top, its chain straight down; the generator and its incomer beside the transformer and the main incomer
assert.ok(Object.values(P).every((p) => p.y >= P.mv.y));
assert.equal(P.tr1.cx, P.mv.cx); assert.equal(P.q1.cx, P.mv.cx);
assert.equal(Math.round(P.g1.y + P.g1.h / 2), Math.round(P.tr1.y + P.tr1.h / 2), "generator on the transformer's row");
assert.equal(Math.round(P.q2.y + P.q2.h / 2), Math.round(P.q1.y + P.q1.h / 2), "generator incomer on the main incomer's row");
assert.ok(P.g1.cx > P.tr1.cx && P.q2.cx === P.g1.cx);
// boards are busbars over what they feed
for (const [board, fed] of [["msb", ["smdbch", "mcc", "smdb1", "smdb2"]], ["smdbch", ["ch1", "ch2", "ch3", "p1", "p2", "p3"]], ["mcc", ["ahu1", "ahu2", "ahu3", "ahu4"]], ["db1a", ["f1a1", "f1a2"]]]) {
  assert.equal(P[board].h, 12, `${board} is a bar`);
  for (const f of fed) assert.ok(P[f].cx > P[board].x && P[f].cx < P[board].x + P[board].w, `${f} is under the bar of ${board}`);
}
// nothing overlaps; the BMS alone on the bottom row, wide enough for its 12 wires
const ids = Object.keys(P);
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  const a = P[ids[i]], b = P[ids[j]];
  assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${ids[i]} and ${ids[j]} overlap`);
}
const bottom = ["bms", "fap"];
assert.ok(ids.every((id) => bottom.includes(id) || P[id].y + P[id].h < Math.min(P.bms.y, P.fap.y)), "the BMS and the fire alarm panel on the bottom row");
assert.equal(P.bms.y, P.fap.y);
assert.ok(P.bms.w >= 12 * 18);
// the fire alarm panel stands nearer the AHUs it stops than the BMS's middle does (ordered by what it is wired to)
const ahuX = ["ahu1", "ahu2", "ahu3", "ahu4"].reduce((t, k) => t + P[k].cx, 0) / 4;
assert.ok(Math.abs(P.fap.cx - ahuX) < Math.abs(P.fap.cx - P.ch1.cx) || P.fap.cx > P.bms.cx);
// a branch given a place keeps it
const kept = items.map((it) => ({ ...it, place: it.id === "ahu1" ? { x: 5, y: 7 } : null }));
win.MPSchematic.layout(kept, edges, (id) => far[id] ?? 1e6);
assert.deepEqual({ ...kept.find((x) => x.id === "ahu1").place }, { x: 5, y: 7 });
console.log(`mp-sld check: the Electricity template as a single-line diagram (${items.length} symbols, ${edges.filter((e) => e.power).length} power wires).`);
