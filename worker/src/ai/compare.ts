/* Is the unit's value better or worse than the one asked? Pure functions, carried over from the Thinkneering v3
   Compliance Maker (functions/_compliance.js, 16 Oct 2026), where each was a fix for a real wrong answer:
     - "62 mm where 50 mm was asked" is a thicker panel, not a shortfall: the direction of a property decides
       (higher is better for thickness and efficiency, lower for pressure drop, leakage, sound, velocity;
       voltage and connection size must match exactly; an unknown direction never fails a unit on the number alone)
     - classes run on their published scale, not their digits: TB1 is the best thermal bridging class (EN 1886),
       F9 is a better filter than F7, D1 the strongest casing, L1 the tightest
     - a figure is compared in the consultant's unit after conversion (l/s and cfm, Pa and in. wg, kW and TR ...)
   The defaults are engineering meaning and published scales, not facts about a factory. */
import { measurements, type Measure } from "./guard";

/* ---------- unit conversion: each family has a base unit; factor = how many base units one unit is ---------- */
const FAMILIES: Record<string, Record<string, number>> = {
  length: { mm: 1, cm: 10, m: 1000, km: 1e6, in: 25.4, ft: 304.8 },
  mass: { g: 0.001, kg: 1, t: 1000, lb: 0.45359237 },
  areal_mass: { "kg/m2": 1 },
  density: { "kg/m3": 1 },
  u_value: { "w/m2k": 1 },
  pressure: { pa: 1, kpa: 1000, bar: 1e5, psi: 6894.757, "in.wg": 249.0889, inwg: 249.0889 },
  flow: { "m3/h": 1, "l/s": 3.6, cfm: 1.699011 },
  power: { w: 0.001, kw: 1, kwr: 1, mw: 1000, tr: 3.516853, "btu/h": 0.00029307107, "kcal/h": 0.001163 },
  velocity: { "m/s": 1, fpm: 0.00508 },
  time: { h: 1, years: 8760 }
};
function familyOf(unit: string): string | null {
  for (const [f, units] of Object.entries(FAMILIES)) if (unit in units) return f;
  return unit === "c" || unit === "f" ? "temperature" : null;
}

/* The measurement in another unit of the same family, or null (different family, or not a unit we convert). */
export function convert(m: Measure, to: string): number | null {
  if (m.unit === to) return m.n;
  const f = familyOf(m.unit);
  if (!f || f !== familyOf(to)) return null;
  if (f === "temperature") return to === "c" ? (m.n - 32) * 5 / 9 : m.n * 9 / 5 + 32;
  const units = FAMILIES[f];
  return m.n * units[m.unit] / units[to];
}

/* A readable number: 2543.4 -> "2,543", 0.4 -> "0.4". */
export function fmt(n: number): string {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  return r.toLocaleString("en-US");
}

/* ---------- what is being measured, and which way is better ---------- */
export type Direction = "higher" | "lower" | "exact";
export interface Property { name: string; terms: string[]; direction: Direction; unit?: string; scale?: string[] }

/* Longest matching term wins ("thermal bridging" beats "thermal"). Classed scales are worst -> best. */
export const PROPERTIES: Property[] = [
  { name: "panel thickness", terms: ["panel thickness", "casing thickness", "panel", "casing", "skin", "wall thickness"], direction: "higher", unit: "length" },
  { name: "insulation thickness", terms: ["insulation", "insulated", "foam", "polyurethane", "mineral wool", "rock wool"], direction: "higher", unit: "length" },
  { name: "sheet or tube thickness", terms: ["gauge", "sheet thickness", "tube thickness", "fin thickness", "wall of tube"], direction: "higher", unit: "length" },
  { name: "density", terms: ["density"], direction: "higher" },
  { name: "thermal transmittance (U value)", terms: ["u value", "u-value", "thermal transmittance", "thermal conductance", "conductance", "w/m2k", "w/m²k"], direction: "lower", unit: "u_value" },
  { name: "pressure drop", terms: ["pressure drop", "pressure loss", "air side resistance", "resistance"], direction: "lower", unit: "pressure" },
  { name: "air leakage", terms: ["leakage", "leak", "air tightness"], direction: "lower" },
  { name: "sound level", terms: ["sound power", "sound pressure", "sound level", "noise", "acoustic level"], direction: "lower" },
  { name: "air velocity", terms: ["face velocity", "velocity", "air speed"], direction: "lower", unit: "velocity" },
  { name: "specific fan power", terms: ["specific fan power", "sfp"], direction: "lower" },
  { name: "efficiency", terms: ["efficiency", "efficient", "cop", "eer", "iplv", "nplv", "seer"], direction: "higher" },
  { name: "capacity", terms: ["capacity", "cooling capacity", "heating capacity", "duty"], direction: "higher", unit: "power" },
  { name: "air flow", terms: ["air flow", "airflow", "air volume", "flow rate"], direction: "higher", unit: "flow" },
  { name: "motor power", terms: ["absorbed power", "power input", "power consumption", "motor power"], direction: "lower", unit: "power" },
  { name: "warranty", terms: ["warranty", "guarantee"], direction: "higher", unit: "time" },
  { name: "electrical supply", terms: ["voltage", "power supply", "electrical supply", "phase", "volt"], direction: "exact" },
  { name: "connection size", terms: ["connection size", "connection", "nozzle", "flange size"], direction: "exact", unit: "length" },
  { name: "thermal bridging class (EN 1886)", terms: ["thermal bridging", "thermal bridge", "tb class", "tb"], direction: "higher", scale: ["TB5", "TB4", "TB3", "TB2", "TB1"] },
  { name: "thermal transmittance class (EN 1886)", terms: ["thermal transmittance class", "transmittance class", "thermal transmittance", "thermal transmit", "t class"], direction: "higher", scale: ["T5", "T4", "T3", "T2", "T1"] },
  { name: "casing strength class (EN 1886)", terms: ["mechanical strength", "casing strength", "deflection", "d class"], direction: "higher", scale: ["D3", "D2", "D1"] },
  { name: "casing leakage class (EN 1886)", terms: ["casing leakage", "casing air leakage", "air leakage class", "leakage class", "l class"], direction: "higher", scale: ["L3", "L2", "L1"] },
  { name: "filter class (EN 779)", terms: ["filter class", "filtration", "filter", "filters"], direction: "higher",
    scale: ["G1", "G2", "G3", "G4", "M5", "M6", "F7", "F8", "F9", "E10", "E11", "E12", "H10", "H11", "H12", "H13", "H14", "U15", "U16", "U17"] }
];

function hay(text: string): string { return " " + String(text || "").toLowerCase().replace(/[^a-z0-9²/.-]+/g, " ").replace(/\s+/g, " ") + " "; }

/* The property a text is about. `family` (length, pressure ...) keeps a thickness term from deciding a flow. */
export function propertyOf(text: string, opts: { family?: string | null; classed?: boolean } = {}): Property | null {
  const h = hay(text);
  let best: Property | null = null, len = 0;
  for (const p of PROPERTIES) {
    if (opts.classed !== undefined && !!p.scale !== opts.classed) continue;
    if (opts.family && p.unit && p.unit !== opts.family) continue;
    for (const t of p.terms) if (t.length > len && h.includes(" " + t + " ")) { best = p; len = t.length; }
  }
  return best;
}

export type Judgement = "better" | "worse" | "equal" | "differs" | "unknown";

/* For a value asked "as is" (no minimum or maximum): which way the unit's value lies. */
export function judge(required: number, actual: number, p: Property | null): Judgement {
  if (Math.abs(actual - required) < 1e-9 * Math.max(1, Math.abs(required))) return "equal";
  if (!p) return "unknown";
  if (p.direction === "exact") return "differs";
  const up = actual > required;
  return (p.direction === "higher") === up ? "better" : "worse";
}

/* ---------- classed values ---------- */
const CLASS_RE = /\b(TB[1-5]|T[1-5]|D[1-3]|L[1-3]|[GMFEHU]\d{1,2})\b/g;
export function classTokens(text: string): string[] {
  return [...new Set(String(text || "").toUpperCase().match(CLASS_RE) || [])];
}

/* A required class against the unit's: the scale of the property decides, and a class asked is a minimum. */
export function compareClass(required: string, actual: string, p: Property | null): Judgement | null {
  if (!p || !p.scale) return null;
  const ri = p.scale.indexOf(required.toUpperCase()), ai = p.scale.indexOf(actual.toUpperCase());
  if (ri < 0 || ai < 0) return null;
  return ai === ri ? "equal" : ai > ri ? "better" : "worse";
}

/* The classes a clause asks for, each with the property whose scale holds it. A class needs its subject in the
   clause: "M5" alone is a screw, "M5 filter" a filter class; "D1" alone is a label, "deflection class D1" a class. */
export function classRequirements(clause: string): { cls: string; prop: Property }[] {
  const h = hay(clause), out: { cls: string; prop: Property }[] = [];
  for (const cls of classTokens(clause)) {
    const prop = PROPERTIES.find((x) => x.scale && x.scale.includes(cls) && x.terms.some((t) => t.length > 2 && h.includes(" " + t + " ")));
    if (prop) out.push({ cls, prop });
  }
  return out;
}

/* The unit's class on the same scale, from a datasheet cell. */
export function classIn(cell: string, p: Property): string | null {
  return classTokens(cell).find((c) => p.scale!.includes(c)) || null;
}

/* The measurement in a cell that can be compared with `req` (same unit, or convertible), in req's unit. */
export function comparable(cell: string, req: Measure): { m: Measure; value: number; converted: boolean } | null {
  for (const m of measurements(cell)) {
    const v = convert(m, req.unit);
    if (v !== null) return { m, value: v, converted: m.unit !== req.unit };
  }
  return null;
}

export function familyOfUnit(unit: string): string | null { return familyOf(unit); }

/* What a percentage measures. "ISO Coarse 60%" and "arrestance 60 to 80 percent" are not the same quantity: a % is
   compared only when the clause and the datasheet row name the same metric, or the row names none. */
const METRICS: [string, RegExp][] = [
  ["arrestance", /\barrestance\b/], ["coarse", /\bcoarse\b/], ["epm1", /\bepm\s?1\b/], ["epm2.5", /\bepm\s?2\.?5\b/], ["epm10", /\bepm\s?10\b/],
  ["merv", /\bmerv\b/], ["dust spot", /\bdust[- ]spot\b/], ["efficiency", /\b(efficien\w*|effectiveness)\b/], ["humidity", /\b(humidity|rh)\b/],
  ["recirculation", /\brecircul\w*\b/], ["leakage", /\bleak\w*\b/], ["slope", /\bslope\b/], ["speed", /\bspeed\b/], ["torque", /\btorque\b/]
];
export function metricsIn(text: string): string[] {
  const t = String(text || "").toLowerCase();
  const out = METRICS.filter(([, re]) => re.test(t)).map(([k]) => k);
  // ePM1 / ePM2.5 / ePM10 / coarse are filter efficiencies by name
  return out.length > 1 ? out.filter((k) => k !== "efficiency") : out;
}
export function sameMetric(clauseNear: string, rowText: string): boolean {
  const a = metricsIn(clauseNear), b = metricsIn(rowText);
  return !a.length || !b.length || a.some((x) => b.includes(x));
}
