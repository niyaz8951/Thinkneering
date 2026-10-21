/* The vocabulary of a product (owner, 20 Oct 2026): one map per product (AHU, FCU, Chiller), kind "vocabulary",
   linked in Compliance review > AI rules (ai_vocab_links). It holds what specifications ASK, in the words they use;
   what a factory OFFERS stays in Product Options, how the AI answers stays in the factory's rule book.

   Like Shazam, a clause is recognised by its landmarks, not by its sentence:
     clause ── landmarks ──> requirement type + level ──> compared with the datasheet / Product Options by code
   landmarks = component words (casing, filter), property words (air leakage, face velocity), anchors (L2, IE3,
   ePM1), standards (EN 1886), and a figure in the right unit. A type is recognised when its landmarks pair up
   (component + property, property + anchor, property + unit); rare words weigh more than common ones.

     Vocabulary: AHU
     |-- How this map works          for people; not read by code
     |-- Standards                   one branch per standard   ! Terms: EN 1886, BS EN 1886
     |-- <Component> (Casing)        ! Terms: casing, cabinet, panel        ! Not: control panel
         |-- <Requirement type> (Casing air leakage class)
                 ! Kind: class | value | standard | choice | presence
                 ! Terms: air leakage, casing leakage, air tightness        (how specifications name it)
                 ! Anchors: L1, L2, L3                                       (tokens that point at it alone)
                 ! Unit: mm      ! Direction: higher | lower | exact       ! Scale: L3 < L2 < L1 (worst to best)
                 ! Standard: EN 1886   ! Options: aluminium, stainless (choice)   ! Not: door, damper
                 ! Row: mechanical characteristic (en1886)||casing leakage    (the datasheet row that answers it)
                 ! Equivalent: MERV 13 = F7     ! Example: Casing air leakage shall be class L2 or better ...

   A branch "to verify" is not read. Everything here is engineering language, the same for every factory. */
import type { Env } from "../env";
import { all, now, uuid } from "../lib/sql";
import { familyOfUnit, classTokens } from "./compare";
import { requirements, type Requirement } from "./evidence";
import { addSeed, type MapNode, type Seed } from "./map";

export type Kind = "value" | "class" | "standard" | "choice" | "presence";
export type Dir = "higher" | "lower" | "exact";
export interface VType {
  id: string; title: string; component: string; kind: Kind; terms: string[]; anchors: string[]; unit: string; dir: Dir | "";
  scale: string[]; standards: string[]; options: string[]; not: string[]; rows: string[]; equivalents: string[]; example: string; path: string;
}
export interface VComponent { title: string; terms: string[]; not: string[] }
export interface VStandard { name: string; terms: string[] }
export interface Vocab { types: VType[]; components: VComponent[]; standards: VStandard[]; problems: string[]; map?: { id: string; name: string; updated_at: string } }

const KINDS: Kind[] = ["value", "class", "standard", "choice", "presence"];
const FIELDS = /^\s*(kind|terms|anchors|unit|direction|scale|standard|standards|options|not|row|rows|equivalent|example|tolerance|id|note)\s*:/i;

function specials(n: MapNode): string[] { try { const a = JSON.parse(n.special || "[]"); return Array.isArray(a) ? a.map((x) => String(x)) : []; } catch { return []; } }
function fields(lines: string[], name: string): string[] {
  const re = new RegExp("^\\s*" + name + "\\s*:\\s*(.*)$", "i");
  return lines.map((l) => re.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => m[1].trim()).filter(Boolean);
}
const list = (s: string[]) => s.flatMap((x) => x.split(/[,;]/)).map((x) => x.trim()).filter(Boolean);
export function slug(s: string): string { return s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }

/* ---------- reading a vocabulary map ---------- */
export function parseVocab(nodes: MapNode[], label = "vocabulary"): Vocab {
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) { const l = kids.get(n.parent_id) || []; l.push(n); kids.set(n.parent_id, l); }
  for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  const root = (kids.get(null) || [])[0];
  const out: Vocab = { types: [], components: [], standards: [], problems: [] };
  if (!root) return out;
  const ids = new Set<string>();
  for (const top of kids.get(root.id) || []) {
    const t = top.title.trim();
    if (!top.verified || /^how\b/i.test(t)) continue;
    if (/^standards?\b/i.test(t)) {
      for (const s of kids.get(top.id) || []) if (s.verified) out.standards.push({ name: s.title.trim(), terms: [s.title.trim(), ...list(fields(specials(s), "terms"))] });
      continue;
    }
    const sp = specials(top);
    const comp: VComponent = { title: t, terms: list(fields(sp, "terms")), not: list(fields(sp, "not")) };
    if (!comp.terms.length) comp.terms = [t.toLowerCase()];
    out.components.push(comp);
    (function walk(parent: MapNode, path: string[]) {
      for (const n of kids.get(parent.id) || []) {
        if (!n.verified) continue;
        const s = specials(n), here = [...path, n.title.trim()], where = `${label}: "${here.join(" › ")}"`;
        for (const l of s) if (/^\s*[A-Za-z ]{2,14}:/.test(l) && !FIELDS.test(l)) out.problems.push(`${where}: "${l.trim().slice(0, 40)}" is not a field the code reads (Kind, Terms, Anchors, Unit, Direction, Scale, Standard, Options, Not, Row, Equivalent, Example).`);
        const kindRaw = (fields(s, "kind")[0] || "").toLowerCase();
        if (!kindRaw) { if ((kids.get(n.id) || []).length) walk(n, here); else out.problems.push(`${where} has no Kind: it is not a requirement type yet.`); continue; }
        const kind = KINDS.find((k) => kindRaw.startsWith(k));
        if (!kind) { out.problems.push(`${where}: Kind "${kindRaw}" is not value, class, standard, choice or presence.`); continue; }
        const dirRaw = (fields(s, "direction")[0] || "").toLowerCase();
        const dir: Dir | "" = /higher|more|bigger|larger/.test(dirRaw) ? "higher" : /lower|less|smaller/.test(dirRaw) ? "lower" : /exact|equal|match/.test(dirRaw) ? "exact" : "";
        const scaleRaw = fields(s, "scale")[0] || "";
        const scale = scaleRaw.split(/\s*(?:<|,|;)\s*/).map((x) => x.trim()).filter(Boolean);
        const unit = (fields(s, "unit")[0] || "").toLowerCase().replace(/\s+/g, "");
        const ty: VType = {
          id: fields(s, "id")[0] || slug(t) + "." + slug(n.title), title: n.title.trim(), component: t, kind, terms: list(fields(s, "terms")), anchors: list(fields(s, "anchors")),
          unit, dir, scale, standards: list([...fields(s, "standard"), ...fields(s, "standards")]), options: list(fields(s, "options")), not: list(fields(s, "not")),
          rows: list([...fields(s, "row"), ...fields(s, "rows")]), equivalents: fields(s, "equivalent"), example: fields(s, "example")[0] || "", path: here.join(" › ")
        };
        if (!ty.terms.length && !ty.anchors.length) out.problems.push(`${where} has no Terms and no Anchors: no clause can find it.`);
        if (kind === "class" && scale.length < 2) out.problems.push(`${where} is a class with no Scale (worst < ... < best).`);
        if (kind === "value" && unit && !familyOfUnit(unit) && !["%", "db", "dba", "rpm", "hz", "v", "a", "kg/m3", "w/m2k", "h", "years"].includes(unit)) out.problems.push(`${where}: Unit "${unit}" is not one the code reads; figures cannot be compared.`);
        if (kind === "value" && !dir) out.problems.push(`${where}: Direction is missing (higher, lower or exact): a figure cannot be judged.`);
        if (kind === "choice" && !ty.options.length) out.problems.push(`${where} is a choice with no Options.`);
        if (ids.has(ty.id)) out.problems.push(`${where}: another type has the same name under ${t}.`);
        ids.add(ty.id); out.types.push(ty);
        if ((kids.get(n.id) || []).length) walk(n, here);
      }
    })(top, [t]);
  }
  return out;
}

/* The linked vocabulary of a product (cached a minute per Worker instance). */
const cache = new Map<string, { at: number; stamp: string; v: Vocab }>();
export async function vocabFor(env: Env, productId: string): Promise<Vocab> {
  const link = await env.DB.prepare("SELECT m.id, m.name, m.updated_at FROM ai_vocab_links l JOIN mp_maps m ON m.id = l.map_id WHERE l.product_id = ?")
    .bind(productId).first<{ id: string; name: string; updated_at: string }>();
  if (!link) return { types: [], components: [], standards: [], problems: [] };
  const hit = cache.get(productId);
  if (hit && hit.stamp === link.id + link.updated_at && Date.now() - hit.at < 60000) return hit.v;
  const nodes = await all<MapNode>(env.DB.prepare("SELECT id, parent_id, title, notes, special, sort, verified FROM mp_nodes WHERE map_id = ?").bind(link.id));
  const v = { ...parseVocab(nodes, `"${link.name}"`), map: link };
  cache.set(productId, { at: Date.now(), stamp: link.id + link.updated_at, v });
  return v;
}

/* ---------- recognising a clause ---------- */
// lower case; hyphens are spaces ("double-skin" = "double skin"); a full stop ends a word, a decimal point does not
function norm(s: string): string {
  return " " + String(s || "").toLowerCase().replace(/[‐-―-]/g, " ").replace(/\.(?!\d)/g, " ").replace(/[^a-z0-9.%/+²³µ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}
const reCache = new Map<string, RegExp>();
function termRe(term: string): RegExp {
  let re = reCache.get(term);
  if (!re) {
    const t = norm(term).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s?");
    re = new RegExp("(?:^| )" + t + "(?:s|es|ed|ing)?(?= |$)");
    reCache.set(term, re);
  }
  return re;
}
function find(h: string, terms: string[]): { term: string; at: number }[] {
  const out: { term: string; at: number }[] = [];
  for (const term of terms) { if (!term) continue; const m = termRe(term).exec(h); if (m) out.push({ term, at: m.index, end: m.index + m[0].length } as { term: string; at: number }); }
  // one stretch of the clause counts once: the longest term that covers it ("casing leakage" over "leakage",
  // "panels" over "panel", "copper tubes" over "tube")
  const span = (x: { at: number }) => x as { term: string; at: number; end: number };
  return out.filter((x) => !out.some((y) => y !== x && span(y).at <= span(x).at + 1 && span(y).end >= span(x).end - 1 &&
    (span(y).end - span(y).at > span(x).end - span(x).at || (span(y).end - span(y).at === span(x).end - span(x).at && out.indexOf(y) < out.indexOf(x)))));
}

export interface Level { op?: string; value?: string; cls?: string; via?: string; standard?: string[]; options?: string[]; measure?: Requirement }
export interface Identified {
  type: VType; score: number; confidence: "high" | "medium" | "low"; landmarks: string[]; level: Level; asked: string;
}
const OPS: Record<string, string> = { ">=": "at least ", "<=": "at most ", "=": "", range: "" };
function idf(v: Vocab): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of v.types) for (const w of new Set([...t.terms, ...t.anchors].map((x) => x.toLowerCase()))) df.set(w, (df.get(w) || 0) + 1);
  const n = Math.max(v.types.length, 1), out = new Map<string, number>();
  for (const [w, d] of df) out.set(w, 1 + Math.log(n / d));
  return out;
}
const idfCache = new WeakMap<Vocab, Map<string, number>>();

/* What a clause asks, by the vocabulary: the types whose landmarks it holds, best first, with the level asked. */
export function identify(v: Vocab, clause: string, section = "", max = 3): Identified[] {
  if (!v.types.length || !clause) return [];
  let w = idfCache.get(v); if (!w) { w = idf(v); idfCache.set(v, w); }
  const h = norm(clause), hs = norm(section);
  const reqs = requirements(clause);
  const classes = classTokens(clause);
  const stdHits = v.standards.filter((s) => find(h, s.terms).length).map((s) => s.name.toLowerCase());
  const compHit = new Map<string, { inClause: boolean; inSection: boolean; neg: boolean }>();
  for (const c of v.components) {
    const neg = find(h, c.not).length > 0;
    compHit.set(c.title, { inClause: !neg && find(h, c.terms).length > 0, inSection: find(hs, c.terms).length > 0, neg });
  }
  // the components the clause itself names (not "unit": every clause is about the unit)
  const named = v.components.filter((c) => compHit.get(c.title)!.inClause && !/^unit$/i.test(c.title)).map((c) => c.title);
  const low = clause.toLowerCase();
  const out: Identified[] = [];
  for (const t of v.types) {
    const marks: string[] = [];
    let score = 0, prop = 0;
    const pt = find(h, t.terms);
    // property words: the rarest weigh most, but one rare word alone never outweighs the structure of the clause
    pt.slice().sort((a, b) => (w!.get(b.term.toLowerCase()) || 1) - (w!.get(a.term.toLowerCase()) || 1)).slice(0, 2)
      .forEach((x, i) => { const s = Math.min(w!.get(x.term.toLowerCase()) || 1, 4) * (i ? 0.6 : 2); score += s; prop += s; marks.push(x.term); });
    // anchors: an anchor of the type, or a class of its scale, written in the clause
    const scaleHits = t.kind === "class" ? t.scale.filter((s) => s.length >= 2 && termRe(s).test(h)) : [];
    const an = [...find(h, t.anchors).map((x) => x.term), ...scaleHits.filter((s) => !t.anchors.some((a) => a.toLowerCase() === s.toLowerCase()))];
    const c = compHit.get(t.component) || { inClause: false, inSection: false, neg: false };
    if (c.inClause) { score += 2; marks.push(t.component.toLowerCase()); } else if (c.inSection) { score += 1.2; marks.push("section: " + t.component.toLowerCase()); }
    if (an.length) {
      // a short anchor (L2, T2, G4) counts in full only beside another landmark of its type: alone it may be anything
      const strong = an.some((a) => a.length >= 3) || prop > 0 || c.inClause || c.inSection;
      score += strong ? 3 : 0.8; marks.push(...an.slice(0, 2));
    }
    if (!prop && !an.length) continue;                         // a component alone is not a requirement
    if ((prop || an.length) && (c.inClause || c.inSection)) score += 1.5;   // the pair: component + property (the fingerprint)
    // the clause names other components and not this one: its words belong to them ("fan ... blades" is not a damper)
    if (named.length && !c.inClause && !named.includes(t.component) && !/^unit$/i.test(t.component)) score -= c.inSection ? 1.5 : 3;
    const std = t.standards.filter((s) => stdHits.includes(s.toLowerCase()) || termRe(s).test(h));
    if (std.length) { score += 1.5; marks.push(std[0]); }
    // a figure in the type's unit
    let measure: Requirement | undefined;
    if (t.kind === "value" && t.unit) {
      const fam = familyOfUnit(t.unit);
      const db = (u: string) => u === "db" || u === "dba";
      const fit = reqs.filter((r) => r.m.unit === t.unit || (fam && familyOfUnit(r.m.unit) === fam) || (db(t.unit) && db(r.m.unit)));
      if (fit.length) {
        // the figure nearest to the type's words; near (a few words) it is the figure of this type
        const at = pt.length ? Math.max(0, low.indexOf(pt[0].term.toLowerCase().split(" ")[0])) : -1;
        measure = fit.slice().sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
        const near = at >= 0 && Math.abs(measure.at - at) <= 40;
        score += near ? 4 : 1.5; marks.push(measure.m.raw);
      } else if (reqs.length) score -= 1;                          // figures in other units: likely another type
    }
    if (find(h, t.not).length || c.neg) score -= 5;
    const options = t.kind === "choice" ? find(h, t.options).map((x) => x.term) : [];
    if (options.length) { score += 1; marks.push(...options.slice(0, 2)); }
    // a class asked with its class written beats one whose level the clause does not give
    let clsFound = t.kind === "class" ? (scaleHits.length ? scaleHits : classes.filter((k) => t.scale.some((x) => x.toUpperCase() === k))) : [];
    // an equivalent names the class in another scale: "MERV 14" asked = F8 (Equivalent: MERV 14 = F8)
    let via = "";
    if (t.kind === "class" && !clsFound.length) for (const e of t.equivalents) {
      const m = /^\s*(.+?)\s*=\s*([A-Za-z]+\d+(?:\.\d+)?)\b/.exec(e);
      if (!m || /\d\s*-\s*\d/.test(m[1])) continue;                        // ranges ("MERV 7-8") are for people
      const right = t.scale.find((x) => x.toUpperCase() === m[2].toUpperCase());
      if (right && termRe(m[1]).test(h)) { clsFound = [right]; via = m[1].trim(); break; }
    }
    if (t.kind === "class") score += clsFound.length ? 1.5 : (reqs.length ? -1.5 : 0);
    if (score < 3.5) continue;
    const level: Level = {};
    if (measure) { level.measure = measure; level.op = measure.op; level.value = (measure.op === "range" ? measure.lo + " to " : "") + measure.m.raw; }
    if (t.kind === "class") {
      if (clsFound.length) { level.cls = clsFound[0]; level.op = ">="; if (via) level.via = via; }   // a class asked is a minimum
    }
    if (std.length) level.standard = std;
    if (options.length) level.options = options;
    const asked = level.value ? (OPS[level.op || "="] || "") + level.value : level.cls ? level.cls + " or better" + (level.via ? ` (${level.via})` : "") : options.length ? options.join(" / ") : std.length ? std.join(", ") : t.kind === "presence" ? "provided" : "";
    out.push({ type: t, score: Math.round(score * 10) / 10, confidence: "low", landmarks: [...new Set(marks)], level, asked });
  }
  out.sort((a, b) => b.score - a.score);
  out.forEach((x, i) => {
    const gap = x.score - (out[i + 1] ? out[i + 1].score : 0);
    x.confidence = x.score >= 8 && (i > 0 || gap >= 1.5) ? "high" : x.score >= 5.5 ? "medium" : "low";
  });
  // one clause may ask several things ("leakage L2 and strength D2"): keep the types whose landmarks differ
  const kept: Identified[] = [];
  for (const x of out) {
    if (kept.length >= max) break;
    if (kept.some((k) => k.type.component === x.type.component && k.landmarks.join() === x.landmarks.join())) continue;
    if (kept.length && x.score < kept[0].score * 0.6) break;
    kept.push(x);
  }
  return kept;
}

/* ---------- the templates (AHU, FCU, Chiller) ---------- */
interface TT { t: string; k: Kind; terms: string; anchors?: string; unit?: string; dir?: Dir; scale?: string; std?: string; opts?: string; not?: string; row?: string; eq?: string[]; ex?: string; n?: string }
type Comp = { c: string; terms: string; not?: string; n?: string; types: TT[] };
const D = { higher: "higher is better", lower: "lower is better", exact: "must match" };

const STANDARDS: [string, string, string][] = [
  ["EN 1886", "BS EN 1886, EN1886", "Air handling units, mechanical performance: casing strength (D), casing air leakage (L), filter bypass leakage (F), thermal transmittance (T), thermal bridging (TB)."],
  ["EN 13053", "BS EN 13053, EN13053", "Air handling units, rating and performance of units and components: velocity class (V), power class (P), heat recovery class (H), hygiene."],
  ["ISO 16890", "ISO16890, ePM1, ePM2.5, ePM10, ISO coarse", "Air filters for general ventilation (replaces EN 779): ePM1 / ePM2.5 / ePM10 efficiency groups and ISO Coarse."],
  ["EN 779", "BS EN 779, EN779", "Former filter classes G1-G4, M5-M6, F7-F9 (withdrawn 2018, still written in specifications)."],
  ["ASHRAE 52.2", "ASHRAE 52.2, MERV", "Filter test with MERV ratings 1-16."],
  ["EN 1822", "EN1822, ISO 29463", "HEPA / ULPA filters: E10-E12, H13-H14, U15-U17."],
  ["Eurovent", "Eurovent certified, Eurovent certification, Eurovent Certita", "Third-party certification of AHU ranges (AHU, rotary heat exchangers, coils, filters)."],
  ["AHRI 410", "ARI 410, AHRI Standard 410", "Rating of forced-circulation air-cooling and air-heating coils."],
  ["AHRI 430", "ARI 430", "Rating of central-station air-handling units."],
  ["AMCA 210", "AMCA Standard 210, ANSI/AMCA 210", "Laboratory method of testing fans for aerodynamic performance."],
  ["AMCA 300", "AMCA 301", "Reverberant room method for sound testing of fans."],
  ["AMCA 500-D", "AMCA 500", "Laboratory methods of testing dampers (leakage, pressure drop)."],
  ["ISO 5801", "ISO5801", "Fans, performance testing using standardized airways."],
  ["EN 1751", "EN1751", "Damper and valve aerodynamic testing; leakage classes 0-4 (casing A-C)."],
  ["EN 308", "EN308", "Heat exchangers, test procedures for air-to-air heat recovery."],
  ["ISO 9227", "ASTM B117, salt spray", "Corrosion tests in artificial atmospheres: salt spray hours."],
  ["ASTM E84", "UL 723, NFPA 255", "Surface burning characteristics: flame spread index, smoke developed index."],
  ["BS 476", "BS 476 part 6, BS 476 part 7", "Fire tests on building materials: part 6 fire propagation, part 7 surface spread of flame."],
  ["EN 13501-1", "EN13501, Euroclass", "Reaction to fire classes: A1, A2, B, C, D, E, F with smoke (s1-s3) and droplets (d0-d2)."],
  ["UL 900", "UL900", "Air filter units, flammability."],
  ["NFPA 90A", "NFPA90A", "Installation of air-conditioning and ventilating systems (building code)."],
  ["ISO 1940", "ISO 21940, ISO 1940-1", "Balance quality grades of rotors: G6.3, G2.5, G1."],
  ["IEC 60034-30", "IEC 60034, IEC 60034-30-1, IEC 60034-30-2", "Motor efficiency classes IE1-IE5."],
  ["IEC 60529", "IP rating, ingress protection", "Degrees of protection by enclosures: IP54, IP55, IP65 ..."],
  ["ErP", "ErP 2018, ErP Lot 6, Ecodesign, EU 1253/2014, EU 1253 2014", "European Ecodesign requirements for ventilation units (SFPint, heat recovery)."],
  ["VDI 6022", "VDI6022, DIN 1946-4, hygienic design", "Hygiene requirements for ventilation and air-conditioning systems."],
  ["ISO 9001", "ISO9001", "Quality management system of the manufacturer."],
  ["ASHRAE 62.1", "ASHRAE 62.1", "Ventilation for acceptable indoor air quality."],
  ["ASHRAE 90.1", "ASHRAE 90.1", "Energy standard for buildings."],
  ["SMACNA", "SMACNA", "Sheet metal and air conditioning contractors' standards (ductwork, belt guards)."]
];

const AHU: Comp[] = [
  { c: "Unit", terms: "air handling unit, air-handling unit, AHU, unit, units, equipment", n: "What a clause asks of the whole unit.", types: [
    { t: "Supply air flow", k: "value", terms: "air flow, airflow, air volume, air quantity, supply air, design air flow, flow rate", unit: "m3/h", dir: "exact", row: "unit data||supply air flow", n: "Selected to the project's schedule; compare with the datasheet." },
    { t: "External static pressure", k: "value", terms: "external static pressure, external pressure, ESP, external pressure drop, available static pressure", anchors: "ESP", unit: "pa", dir: "higher", row: "unit data||external pressure drop" },
    { t: "Velocity class (EN 13053)", k: "class", terms: "velocity class, air velocity class, velocity through the unit", anchors: "V1, V2, V3, V4, V5, V6, V7, V8, V9", scale: "V9 < V8 < V7 < V6 < V5 < V4 < V3 < V2 < V1", std: "EN 13053", row: "en 13053||supply velocity class" },
    { t: "Power class (EN 13053)", k: "class", terms: "power class, fan power class, power consumption class", anchors: "P1, P2, P3, P4, P5, P6, P7", scale: "P7 < P6 < P5 < P4 < P3 < P2 < P1", std: "EN 13053", row: "en 13053||supply power class" },
    { t: "Specific fan power", k: "value", terms: "specific fan power, SFP, SFPv, SFP int, SFPint", anchors: "SFP, SFPv", unit: "w", dir: "lower", row: "unit data||sfpv (clean filters)", n: "Often written in W/(m³/s): check the unit before comparing." },
    { t: "Ecodesign compliance", k: "standard", terms: "ErP, ecodesign, EU 1253/2014, energy related products", std: "ErP", row: "unit data||erp compliant" },
    { t: "Certification", k: "standard", terms: "certified, certification, certificate, rated and certified, performance certified", std: "Eurovent, AHRI 430", not: "ISO 9001, quality, warranty, guarantee", ex: "Air handling units shall be Eurovent certified." },
    { t: "Construction", k: "choice", terms: "construction, modular, sectional, single piece, one piece, knock down, split sections, shipping sections", opts: "modular, sectional, mono-block, single piece, knock down, split" },
    { t: "Outdoor execution", k: "presence", terms: "outdoor, weatherproof, weather proof, rain hood, roof canopy, outdoor installation, outdoor unit, weatherproof roof", row: "unit data||roof" },
    { t: "Hygienic design", k: "standard", terms: "hygienic, hygiene, VDI 6022, DIN 1946-4, cleanable, smooth inner surfaces, hospital", std: "VDI 6022, EN 13053" },
    { t: "Power supply", k: "choice", terms: "power supply, electrical supply, voltage, phase, hertz, electrical characteristics", opts: "400 V, 380 V, 415 V, 230 V, 3 phase, single phase, 50 Hz, 60 Hz", row: "general||power supply", n: "Must match the project exactly (voltage, phase, frequency)." },
    { t: "Sound power level", k: "value", terms: "sound power, sound power level, noise level, sound level, acoustic, Lw, radiated sound, casing radiated", unit: "db", dir: "lower" },
    { t: "Unit dimensions", k: "value", terms: "dimensions, overall dimensions, unit length, unit height, unit width, footprint, maximum height, space available", unit: "mm", dir: "lower", not: "filter, door, coil" },
    { t: "Unit weight", k: "value", terms: "weight, operating weight, shipping weight, mass", unit: "kg", dir: "lower" },
    { t: "Warranty period", k: "value", terms: "warranty, guarantee, defects liability", unit: "years", dir: "higher", n: "Often in months (not read as a unit yet): read the figure by eye." }
  ] },
  { c: "Casing", terms: "casing, casings, cabinet, panel, panels, enclosure, housing, double skin, double wall, wall panels", not: "control panel, electrical panel, access panel, solar panel", n: "The box: panels, profiles, base frame and their EN 1886 classes.", types: [
    { t: "Panel thickness", k: "value", terms: "panel thickness, casing thickness, panel, panels, wall thickness, thick", unit: "mm", dir: "higher", not: "skin, sheet, insulation density, door", row: "unit data||panel", ex: "Casing panels shall be double skin, 50 mm thick." },
    { t: "Panel construction", k: "choice", terms: "double skin, double wall, double-skin, single skin, sandwich panel, panel construction", opts: "double skin, double wall, single skin, sandwich" },
    { t: "Outer skin", k: "choice", terms: "outer skin, outer casing, outer panel, outer sheet, external skin, exterior skin", opts: "galvanized, galvanised, precoated, pre-painted, prepainted, stainless steel, aluminium, aluminum, powder coated, aluzinc, magnelis", row: "unit data||panel outer skin", n: "A thickness written with it (0.9 mm) is compared as the skin thickness." },
    { t: "Inner skin", k: "choice", terms: "inner skin, inner casing, inner panel, inner sheet, internal skin, interior skin, inner lining", opts: "galvanized, galvanised, precoated, stainless steel, aluminium, aluminum, perforated", row: "unit data||panel inner skin" },
    { t: "Skin thickness", k: "value", terms: "skin thickness, sheet thickness, sheet metal thickness, gauge, steel sheet", unit: "mm", dir: "higher", n: "0.9 mm asked, 1.0 mm offered: complies (closest higher)." },
    { t: "Casing strength class (EN 1886)", k: "class", terms: "casing strength, mechanical strength, casing deflection, deflection, structural performance", anchors: "D1, D2, D3, D1(M), D2(M), D3(M)", scale: "D3 < D2 < D1", std: "EN 1886", row: "mechanical characteristic (en1886)||casing strength", ex: "Casing deflection shall be class D2 or better to EN 1886." },
    { t: "Casing air leakage class (EN 1886)", k: "class", terms: "casing leakage, casing air leakage, air leakage, air tightness, airtightness, leakage class", anchors: "L1, L2, L3, L1(M), L2(M), L3(M)", scale: "L3 < L2 < L1", std: "EN 1886", not: "damper, filter bypass, wheel", row: "mechanical characteristic (en1886)||casing leakage", ex: "Casing air leakage shall be class L2 at -400 Pa and +700 Pa." },
    { t: "Filter bypass leakage class (EN 1886)", k: "class", terms: "filter bypass, bypass leakage, filter bypass leakage, filter by-pass", anchors: "F9(M), F8(M), F7(M)", scale: "G1 < G2 < G3 < G4 < M5 < M6 < F7 < F8 < F9", std: "EN 1886" },
    { t: "Thermal transmittance class (EN 1886)", k: "class", terms: "thermal transmittance, thermal transmittance class, U value, U-value, thermal conductance, thermal transmit", anchors: "T1, T2, T3, T4, T5", scale: "T5 < T4 < T3 < T2 < T1", std: "EN 1886", row: "mechanical characteristic (en1886)||thermal transmit", n: "A U value in W/m²K is a figure, lower is better; T1 is the best class." },
    { t: "Thermal bridging class (EN 1886)", k: "class", terms: "thermal bridging, thermal bridge, thermal bridging factor, kb factor, thermal break, thermally broken", anchors: "TB1, TB2, TB3, TB4, TB5", scale: "TB5 < TB4 < TB3 < TB2 < TB1", std: "EN 1886", row: "mechanical characteristic (en1886)||thermal bridging" },
    { t: "Profile", k: "choice", terms: "profile, profiles, framework, frame, corner profile, structural frame", opts: "aluminium, aluminum, thermal break, galvanized steel, extruded", not: "base frame, filter frame, damper frame", row: "unit data||profile", n: "The profile decides the EN 1886 classes (Product Options groups them per profile)." },
    { t: "Base frame", k: "choice", terms: "base frame, base rail, skid, channel base, structural base, mounting frame, plinth frame", opts: "galvanized steel, galvanised, painted steel, aluminium, channel", row: "unit data||ahu base", not: "concrete base, housekeeping" },
    { t: "Corrosion resistance", k: "value", terms: "salt spray, salt-spray, corrosion resistance, corrosion test", unit: "h", dir: "higher", std: "ISO 9227", ex: "Panels shall withstand 1000 hours salt spray to ASTM B117." },
    { t: "Coating", k: "choice", terms: "paint, painted, powder coated, coating, RAL, colour, color, finish", opts: "powder coated, precoated, RAL, epoxy, polyester", not: "fin, coil, salt spray" },
    { t: "Floor", k: "choice", terms: "floor, floor plate, walk-on floor, walkable floor, chequer plate, checker plate", opts: "galvanized, stainless steel, chequer plate, reinforced" }
  ] },
  { c: "Insulation", terms: "insulation, insulated, insulating, foam, polyurethane, mineral wool, rock wool, glass wool, glass fibre, fiberglass", types: [
    { t: "Insulation material", k: "choice", terms: "insulation material, insulated with, insulation shall be, infill", opts: "polyurethane, PU foam, injected foam, mineral wool, rock wool, glass wool, glass fibre, fiberglass, polyisocyanurate, PIR", row: "unit data||insulation" },
    { t: "Insulation thickness", k: "value", terms: "insulation thickness, insulated thickness, thick insulation, insulation, insulated with, insulated", unit: "mm", dir: "higher", not: "density, panel thickness" },
    { t: "Insulation density", k: "value", terms: "density, insulation density", unit: "kg/m3", dir: "higher" },
    { t: "Thermal conductivity", k: "value", terms: "thermal conductivity, conductivity, lambda, k value, k-value", unit: "", dir: "lower", n: "W/mK: not read as a unit yet; read by eye." },
    { t: "Insulation fire rating", k: "standard", terms: "flame spread, smoke developed, fire rating, fire resistance, non-combustible, non combustible, reaction to fire, fire class", anchors: "ASTM E84, UL 723, BS 476, A1, A2-s1,d0", std: "ASTM E84, BS 476, EN 13501-1, NFPA 90A", ex: "Insulation shall have a flame spread index not exceeding 25 and smoke developed index not exceeding 50 to ASTM E84." }
  ] },
  { c: "Access doors", terms: "access door, access doors, door, doors, access panel, access panels, inspection door, inspection doors", n: "Doors and inspection openings.", types: [
    { t: "Door type", k: "choice", terms: "hinged, hinges, removable, door type, lift-off", opts: "hinged, removable, lift-off, sliding", row: "unit data||door" },
    { t: "Door width", k: "value", terms: "door width, wide, width, door size, clear opening", unit: "mm", dir: "higher" },
    { t: "Door handles and latches", k: "choice", terms: "handle, handles, latch, latches, lock, locks, operable from both sides, quick release", opts: "both sides, quick release, lockable, safety latch, cam lock" },
    { t: "Viewing window", k: "presence", terms: "viewing window, view window, inspection window, sight glass, porthole" },
    { t: "Inspection lights", k: "presence", terms: "inspection light, inspection lights, marine light, marine lights, internal light, lighting, lamp" }
  ] },
  { c: "Filters", terms: "filter, filters, filtration, prefilter, pre-filter, pre filter, final filter, bag filter, panel filter, filter section, filter bank", not: "water filter, strainer", types: [
    { t: "Pre-filter class", k: "class", terms: "prefilter, pre-filter, pre filter, primary filter, panel filter, first stage, ISO coarse", anchors: "G3, G4, ISO Coarse, MERV 8, MERV 7", scale: "G1 < G2 < G3 < G4 < M5 < M6 < F7", std: "ISO 16890, EN 779, ASHRAE 52.2", row: "filter supply||filter class", eq: ["MERV 7-8 = G4", "ISO Coarse 60-65% = G4", "ePM10 50% = M5"], ex: "Pre-filters shall be ISO Coarse 60% (G4), 48 mm deep." },
    { t: "Final filter class", k: "class", terms: "final filter, secondary filter, bag filter, second stage, high efficiency filter, rigid filter", anchors: "F7, F8, F9, ePM1, MERV 13, MERV 14", scale: "M5 < M6 < F7 < F8 < F9", std: "ISO 16890, EN 779, ASHRAE 52.2", row: "filter supply||filter class", eq: ["MERV 13 = F7", "MERV 14 = F8", "MERV 15 = F9", "ePM1 50-65% = F7", "ePM1 70-80% = F8", "ePM1 80-90% = F9"] },
    { t: "HEPA filter class", k: "class", terms: "HEPA, ULPA, absolute filter, EPA filter", anchors: "H13, H14, E11, E12, U15", scale: "E10 < E11 < E12 < H13 < H14 < U15 < U16 < U17", std: "EN 1822" },
    { t: "Filter efficiency (ISO 16890)", k: "value", terms: "ePM1, ePM2.5, ePM10, efficiency, filter efficiency", unit: "%", dir: "higher", std: "ISO 16890", row: "unit data||total supply filters eff. epm1", n: "Compare the same metric only: ePM1 with ePM1, never ePM1 with ISO Coarse." },
    { t: "Filter type", k: "choice", terms: "filter type, pleated, bag, pocket, rigid, cartridge, mini-pleat, panel type, compact, washable", opts: "pleated, bag, pocket, rigid, cartridge, mini-pleat, panel, washable, synthetic, glass fibre" },
    { t: "Filter depth", k: "value", terms: "filter depth, filter thickness, deep, depth", unit: "mm", dir: "exact", row: "filter supply||dimensions", n: "Standard depths: 48, 96, 292, 534, 635 mm; a nominal 50 mm is a 48 mm filter." },
    { t: "Filter face velocity", k: "value", terms: "face velocity, filter velocity, filter face velocity, velocity across the filter", unit: "m/s", dir: "lower", row: "filter supply||air velocity" },
    { t: "Filter pressure drop", k: "value", terms: "pressure drop, final pressure drop, dirty pressure drop, clean pressure drop, initial resistance, final resistance", unit: "pa", dir: "lower", row: "filter supply||dirty pressure drop", n: "Clean, mid-life and dirty differ: compare the one the clause names." },
    { t: "Filter frame and rails", k: "choice", terms: "filter frame, filter rails, slide-in, slide in, holding frame, front withdrawal, side withdrawal, rails", opts: "galvanized, aluminium, stainless steel, slide-in, front withdrawal, side withdrawal" },
    { t: "Filter pressure gauge", k: "presence", terms: "differential pressure gauge, pressure gauge, manometer, magnehelic, inclined manometer, dirty filter switch, pressure switch", ex: "Provide a differential pressure gauge across each filter bank." },
    { t: "Filter fire class", k: "standard", terms: "UL 900, flammability, fire class, F1, DIN 53438", std: "UL 900" },
    { t: "Spare filters", k: "presence", terms: "spare filters, spare set, extra set of filters, replacement filters, one set of spare" }
  ] },
  { c: "Fans", terms: "fan, fans, plug fan, fan wheel, impeller, blower, fan section, fan array, fanwall", not: "fan coil, condenser fan", types: [
    { t: "Fan type", k: "choice", terms: "fan type, plug fan, plenum fan, centrifugal, backward curved, backward inclined, forward curved, airfoil, aerofoil, EC fan, mixed flow", opts: "plug, plenum, EC, centrifugal, backward curved, forward curved, airfoil, mixed flow", row: "fan return||type" },
    { t: "Fan drive", k: "choice", terms: "direct drive, direct driven, belt drive, belt driven, belts, sheaves, pulleys, V-belt", opts: "direct drive, belt drive", n: "Direct-driven EC fans make belt, sheave and belt-guard clauses Not Applicable." },
    { t: "Number of fans", k: "value", terms: "fan array, number of fans, multiple fans, two fans, redundancy, N+1", unit: "", dir: "higher", row: "fan supply||quantity" },
    { t: "Fan efficiency", k: "value", terms: "fan efficiency, static efficiency, total efficiency, FMEG, efficiency grade", unit: "%", dir: "higher", row: "fan return||efficiency" },
    { t: "Bearing life", k: "value", terms: "bearing life, L10, L50, rated life, bearing", anchors: "L10, L50, ABMA 9", unit: "h", dir: "higher" },
    { t: "Balancing grade", k: "class", terms: "balanced, balancing, balance quality, statically and dynamically balanced", anchors: "G2.5, G6.3, G 2.5, G 6.3", scale: "G16 < G6.3 < G2.5 < G1", std: "ISO 1940" },
    { t: "Vibration isolation", k: "presence", terms: "vibration isolation, anti-vibration, anti vibration, spring isolators, rubber mounts, vibration isolators, isolation mounts, flexible mounting" },
    { t: "Flexible connection", k: "presence", terms: "flexible connection, flexible connector, flexible joint, canvas connection" },
    { t: "Fan performance test", k: "standard", terms: "tested, rated, performance, test code", std: "AMCA 210, ISO 5801", anchors: "AMCA 210, ISO 5801" },
    { t: "Fan guards", k: "presence", terms: "fan guard, inlet guard, outlet guard, belt guard, safety guard, guards", not: "filter" }
  ] },
  { c: "Motors", terms: "motor, motors, electric motor, EC motor, induction motor", types: [
    { t: "Motor efficiency class", k: "class", terms: "motor efficiency, efficiency class, premium efficiency, NEMA premium, high efficiency motor", anchors: "IE1, IE2, IE3, IE4, IE5, NEMA Premium", scale: "IE1 < IE2 < IE3 < IE4 < IE5", std: "IEC 60034-30", row: "fan return|motor data|efficiency class", eq: ["NEMA Premium = IE3", "NEMA EPAct = IE2"] },
    { t: "Motor type", k: "choice", terms: "EC motor, electronically commutated, permanent magnet, induction motor, asynchronous, AC motor", opts: "EC, permanent magnet, induction, asynchronous, external rotor" },
    { t: "Motor enclosure", k: "class", terms: "enclosure, ingress protection, protection class, TEFC, totally enclosed", anchors: "IP44, IP54, IP55, IP56, IP65, IP66, TEFC", scale: "IP44 < IP54 < IP55 < IP56 < IP65 < IP66", std: "IEC 60529" },
    { t: "Motor insulation class", k: "class", terms: "insulation class, winding insulation, class F insulation", anchors: "class F, class H, class B", scale: "B < F < H" },
    { t: "Motor thermal protection", k: "presence", terms: "thermal protection, thermistor, PTC, thermal overload, overload protection, thermal contacts" }
  ] },
  { c: "Variable speed drives", terms: "variable frequency drive, variable frequency drives, VFD, VFC, VSD, frequency converter, inverter, variable speed drive", not: "EC motor", types: [
    { t: "Drive provided", k: "presence", terms: "variable frequency drive, variable frequency controller, variable speed drive, VFD, VFC, VSD, frequency converter, inverter, speed controller", n: "With EC fans the speed control is in the motor electronics: no separate VFD." },
    { t: "Harmonic filter", k: "presence", terms: "harmonic filter, harmonics, THD, line reactor, DC choke, IEEE 519", anchors: "IEEE 519" },
    { t: "EMC class", k: "class", terms: "EMC, RFI filter, electromagnetic compatibility", anchors: "C1, C2, C3", scale: "C3 < C2 < C1" },
    { t: "Drive bypass", k: "presence", terms: "bypass, manual bypass, contactor bypass" }
  ] },
  { c: "Coils", terms: "coil, coils, cooling coil, heating coil, chilled water coil, hot water coil, DX coil, heat exchanger coil", not: "fan coil", types: [
    { t: "Coil rating", k: "standard", terms: "rated, certified, rating, ratings, coil performance", std: "AHRI 410, Eurovent", anchors: "AHRI 410, ARI 410" },
    { t: "Tube material", k: "choice", terms: "tube, tubes, tube material, copper tubes, seamless copper", opts: "copper, seamless copper, cupronickel, stainless steel", row: "coil cooling water supply|geometry|tube material" },
    { t: "Tube thickness", k: "value", terms: "tube thickness, tube wall, wall thickness of tube", unit: "mm", dir: "higher", row: "coil cooling water supply|geometry|tube thickness" },
    { t: "Fin material", k: "choice", terms: "fins, fin material, aluminium fins, copper fins, coated fins, blue fin, epoxy coated, pre-coated fins, hydrophilic", opts: "aluminium, aluminum, copper, coated, epoxy, hydrophilic, blue fin, electrofin", row: "coil cooling water supply|geometry|fin material" },
    { t: "Fin spacing", k: "value", terms: "fin spacing, fin space, fins per inch, FPI, fin pitch, fins per foot", anchors: "FPI", unit: "mm", dir: "higher", row: "coil cooling water supply|geometry|fin space", n: "Fins per inch run the other way: 12 FPI = 2.1 mm spacing; more FPI = closer fins." },
    { t: "Rows", k: "value", terms: "rows, row coil, row deep, number of rows", unit: "", dir: "exact", row: "coil cooling water supply|geometry|rows" },
    { t: "Coil face velocity", k: "value", terms: "face velocity, coil face velocity, velocity across the coil, air velocity", unit: "m/s", dir: "lower", row: "coil cooling water supply|geometry|air velocity", ex: "Coil face velocity shall not exceed 2.5 m/s." },
    { t: "Coil air pressure drop", k: "value", terms: "air pressure drop, air side pressure drop, airside resistance", unit: "pa", dir: "lower" },
    { t: "Coil water pressure drop", k: "value", terms: "water pressure drop, water side pressure drop, fluid pressure drop, waterside", unit: "kpa", dir: "lower", row: "coil cooling water supply|cooling fluid side|pressure drop" },
    { t: "Coil working and test pressure", k: "value", terms: "working pressure, test pressure, design pressure, tested at, pressure tested, operating pressure", unit: "bar", dir: "higher" },
    { t: "Coil capacity", k: "value", terms: "cooling capacity, total capacity, heating capacity, sensible capacity, coil capacity, duty", unit: "kw", dir: "higher", row: "coil cooling water supply|cooling air side|total capacity" },
    { t: "Coil casing", k: "choice", terms: "coil casing, coil frame, end plates, tube sheets, coil support", opts: "galvanized, stainless steel, aluminium", row: "coil cooling water supply|geometry|frame" },
    { t: "Moisture eliminator", k: "presence", terms: "moisture eliminator, droplet eliminator, drift eliminator, mist eliminator, eliminator", row: "coil cooling water supply|geometry|moisture eliminator" },
    { t: "Coil connections", k: "choice", terms: "connections, headers, threaded, flanged, connection size, vents and drains", opts: "threaded, flanged, BSP, NPT, same side", row: "coil cooling water supply|geometry|connection diam" }
  ] },
  { c: "Drain pan", terms: "drain pan, drain pans, condensate pan, condensate tray, drip tray, drain tray", types: [
    { t: "Drain pan material", k: "choice", terms: "drain pan material, stainless steel, SS304, SS316, AISI 304, AISI 316", opts: "stainless steel, SS304, SS316, AISI 304, AISI 316, galvanized, aluminium", row: "coil cooling water supply|geometry|drain pan" },
    { t: "Drain pan slope", k: "presence", terms: "double slope, double sloped, sloped, slope, pitched, self-draining, no standing water", ex: "Drain pans shall be double sloped to the drain connection." },
    { t: "Drain pan insulation", k: "presence", terms: "insulated drain pan, insulated underside, insulation under the pan, double wall drain pan" }
  ] },
  { c: "Dampers", terms: "damper, dampers, mixing box, louvre, louver, shut-off damper, volume control damper", not: "fire damper, smoke damper", types: [
    { t: "Damper leakage class", k: "class", terms: "damper leakage, leakage rate, low leakage, tight closing, leakage class, leakage", anchors: "class 2, class 3, class 4, class 1A", scale: "class 0 < class 1 < class 2 < class 3 < class 4", std: "EN 1751, AMCA 500-D", eq: ["AMCA 500-D class 1A ~ EN 1751 class 3-4 (check per case)"] },
    { t: "Damper blades", k: "choice", terms: "blades, blade, aerofoil blades, airfoil blades, opposed blade, parallel blade", opts: "aerofoil, airfoil, opposed, parallel, aluminium, galvanized", row: "mixing box supply|damper one supply|material" },
    { t: "Damper actuator", k: "presence", terms: "actuator, actuators, motorized, motorised, spring return, modulating actuator" },
    { t: "Damper seals", k: "presence", terms: "blade seals, edge seals, side seals, jamb seals, gaskets" }
  ] },
  { c: "Heat recovery", terms: "heat recovery, energy recovery, heat wheel, thermal wheel, rotary heat exchanger, enthalpy wheel, plate heat exchanger, run around coil, heat pipe, recuperator", types: [
    { t: "Heat recovery type", k: "choice", terms: "heat recovery type, rotary, wheel, plate, cross flow, counter flow, run around, heat pipe", opts: "rotary wheel, enthalpy wheel, sensible wheel, plate, cross flow, counter flow, run around coil, heat pipe", row: "recuperator heat wheel supply||type" },
    { t: "Heat recovery efficiency", k: "value", terms: "efficiency, effectiveness, sensible efficiency, total efficiency, thermal efficiency, temperature efficiency, latent efficiency", unit: "%", dir: "higher", std: "EN 308", row: "recuperator heat wheel supply||dry efficiency (en308)", ex: "Thermal wheel sensible efficiency shall not be less than 75% at balanced air flow." },
    { t: "Heat recovery class (EN 13053)", k: "class", terms: "heat recovery class, energy class", anchors: "H1, H2, H3, H4, H5, H6", scale: "H6 < H5 < H4 < H3 < H2 < H1", std: "EN 13053", row: "recuperator heat wheel supply||energy class (en13053)" },
    { t: "Purge sector", k: "presence", terms: "purge sector, purge section, purge" },
    { t: "Wheel coating", k: "choice", terms: "hygroscopic, sorption, molecular sieve, silica gel, desiccant, coating", opts: "molecular sieve, silica gel, hygroscopic, sorption, epoxy" },
    { t: "Wheel drive", k: "choice", terms: "wheel drive, rotor drive, variable speed, constant speed, stepper motor", opts: "variable speed, constant speed, VFD, stepper" },
    { t: "Wheel size", k: "value", terms: "wheel diameter, rotor diameter, diameter", unit: "mm", dir: "exact", row: "recuperator heat wheel supply||diameter" },
    { t: "Cross leakage", k: "value", terms: "cross leakage, carry over, carryover, EATR, exhaust air transfer ratio, OACF", anchors: "EATR, OACF", unit: "%", dir: "lower" }
  ] },
  { c: "Humidifier", terms: "humidifier, humidifiers, humidification, steam humidifier, evaporative humidifier", types: [
    { t: "Humidifier type", k: "choice", terms: "steam, isothermal, evaporative, adiabatic, spray, atomizing, electrode", opts: "steam, isothermal, evaporative, adiabatic, spray, electrode, resistive", row: "isothermal steam humidifier supply||type" },
    { t: "Humidifier capacity", k: "value", terms: "humidifier capacity, steam output, capacity, kg/h", unit: "kg", dir: "higher", row: "isothermal steam humidifier supply||steam", n: "kg/h: read as kg for now." }
  ] },
  { c: "Electric heater", terms: "electric heater, electric heating, heater battery, electric coil, duct heater", types: [
    { t: "Heater capacity", k: "value", terms: "heater capacity, heating capacity, rated capacity, heater rating", unit: "kw", dir: "higher", row: "electric heater supply||nominal capacity" },
    { t: "Heater steps", k: "value", terms: "steps, stages, step control, SCR, thyristor", unit: "", dir: "higher", row: "electric heater supply||steps number" },
    { t: "Heater safety", k: "presence", terms: "safety thermostat, high limit, manual reset, automatic reset, airflow switch, cut-out", row: "electric heater supply||electrical protection" }
  ] },
  { c: "Sound attenuators", terms: "attenuator, attenuators, silencer, silencers, sound attenuator, splitter", types: [
    { t: "Insertion loss", k: "value", terms: "insertion loss, attenuation, dynamic insertion loss", unit: "db", dir: "higher" },
    { t: "Attenuator length", k: "value", terms: "attenuator length, silencer length, splitter length, length", unit: "mm", dir: "exact" },
    { t: "Splitter infill", k: "choice", terms: "infill, acoustic infill, splitter material, glass cloth, perforated facing", opts: "mineral wool, glass cloth, perforated, hygienic" }
  ] },
  { c: "Controls", terms: "controls, control system, controller, control panel, DDC, BMS, BAS, building management", not: "quality control", types: [
    { t: "Factory-fitted controls", k: "presence", terms: "factory fitted controls, factory mounted controls, factory wired, integrated controls, packaged controls, plug and play" },
    { t: "BMS protocol", k: "choice", terms: "BACnet, Modbus, LonWorks, KNX, protocol, communication, BMS interface, gateway", opts: "BACnet IP, BACnet MS/TP, Modbus RTU, Modbus TCP, LonWorks, KNX" },
    { t: "Sensors", k: "presence", terms: "sensor, sensors, temperature sensor, humidity sensor, CO2 sensor, pressure transmitter, air flow measuring" },
    { t: "Control panel protection", k: "class", terms: "control panel, panel enclosure, IP rating", anchors: "IP54, IP55, IP65", scale: "IP44 < IP54 < IP55 < IP65 < IP66", std: "IEC 60529" },
    { t: "Fire alarm interlock", k: "presence", terms: "fire alarm, fire signal, fire interlock, smoke detector, duct smoke detector, shutdown on fire" }
  ] },
  { c: "Testing and documents", terms: "test, tests, testing, inspection, factory test, documents, documentation, submittals, manuals", types: [
    { t: "Factory acceptance test", k: "presence", terms: "factory acceptance test, FAT, witness test, witnessed, factory test, tested before shipment, run test", anchors: "FAT" },
    { t: "Performance test standard", k: "standard", terms: "performance test, performance tested, tested in accordance", std: "AMCA 210, ISO 5801, EN 13053" },
    { t: "Manufacturer quality system", k: "standard", terms: "ISO 9001, quality management, quality assurance, quality system", std: "ISO 9001", anchors: "ISO 9001" },
    { t: "Operation and maintenance manuals", k: "presence", terms: "operation and maintenance, O&M, maintenance manual, IOM, installation manual, maintenance data" },
    { t: "Packing and delivery", k: "choice", terms: "packing, packaging, crating, crated, shrink wrapped, protective covering, lifting lugs, lifting points", opts: "wooden crate, shrink wrap, nylon wrap, lifting lugs, skid" }
  ] }
];

const FCU: Comp[] = [
  { c: "Unit", terms: "fan coil unit, fan coil, fan coils, FCU, unit, units", types: [
    { t: "Cooling capacity", k: "value", terms: "cooling capacity, total capacity, total cooling, sensible capacity, sensible cooling", unit: "kw", dir: "higher" },
    { t: "Heating capacity", k: "value", terms: "heating capacity, heating output", unit: "kw", dir: "higher" },
    { t: "Air flow", k: "value", terms: "air flow, airflow, air volume", unit: "m3/h", dir: "higher" },
    { t: "Unit type", k: "choice", terms: "ducted, concealed, exposed, cassette, floor standing, ceiling mounted, high static, horizontal, vertical, wall mounted", opts: "ducted, concealed, exposed, cassette, floor standing, ceiling, high static, horizontal, vertical" },
    { t: "External static pressure", k: "value", terms: "external static pressure, ESP, external pressure", anchors: "ESP", unit: "pa", dir: "higher" },
    { t: "Sound level", k: "value", terms: "sound pressure, sound power, noise, noise level, sound level, NC", unit: "db", dir: "lower" },
    { t: "Certification", k: "standard", terms: "certified, certification, rated", std: "Eurovent, AHRI 440", anchors: "AHRI 440, Eurovent" },
    { t: "Power supply", k: "choice", terms: "power supply, electrical supply, voltage, phase", opts: "230 V, 220 V, single phase, 50 Hz, 60 Hz" },
    { t: "Unit dimensions", k: "value", terms: "height, depth, dimensions, ceiling void, maximum height", unit: "mm", dir: "lower" }
  ] },
  { c: "Fan and motor", terms: "fan, fans, blower, motor, motors, impeller", types: [
    { t: "Motor type", k: "choice", terms: "EC motor, AC motor, PSC, brushless, DC motor, BLDC, permanent split capacitor", opts: "EC, DC, brushless, AC, PSC" },
    { t: "Fan speeds", k: "value", terms: "speeds, 3-speed, three speed, multi speed, variable speed, 0-10 V", unit: "", dir: "higher" },
    { t: "Fan type", k: "choice", terms: "centrifugal, forward curved, tangential, cross flow, double inlet", opts: "centrifugal, forward curved, tangential, cross flow" }
  ] },
  { c: "Coil", terms: "coil, coils, water coil, cooling coil, heating coil", types: [
    { t: "Pipe system", k: "choice", terms: "2-pipe, 4-pipe, two pipe, four pipe", opts: "2-pipe, 4-pipe" },
    { t: "Rows", k: "value", terms: "rows, row coil, number of rows", unit: "", dir: "exact" },
    { t: "Water pressure drop", k: "value", terms: "water pressure drop, water side pressure drop, waterside", unit: "kpa", dir: "lower" },
    { t: "Working pressure", k: "value", terms: "working pressure, test pressure, design pressure, tested at", unit: "bar", dir: "higher" },
    { t: "Tube and fin material", k: "choice", terms: "copper tubes, aluminium fins, fins, tubes, coated fins", opts: "copper, aluminium, coated, hydrophilic" }
  ] },
  { c: "Drain pan", terms: "drain pan, condensate pan, drip tray", types: [
    { t: "Drain pan material", k: "choice", terms: "drain pan material, stainless steel, plastic, ABS, polystyrene, insulated", opts: "stainless steel, ABS, plastic, galvanized, insulated" },
    { t: "Auxiliary drain pan", k: "presence", terms: "auxiliary drain pan, secondary drain pan, valve drain tray, valve tray" }
  ] },
  { c: "Filter", terms: "filter, filters", types: [
    { t: "Filter class", k: "class", terms: "filter class, filter efficiency, washable filter, MERV", anchors: "G2, G3, G4, MERV 8, ISO Coarse", scale: "G1 < G2 < G3 < G4 < M5 < M6 < F7", std: "ISO 16890, EN 779, ASHRAE 52.2", eq: ["MERV 7-8 = G4"] },
    { t: "Filter type", k: "choice", terms: "washable, cleanable, disposable, synthetic, nylon mesh", opts: "washable, disposable, synthetic, nylon" }
  ] },
  { c: "Casing", terms: "casing, cabinet, chassis, housing", types: [
    { t: "Casing material", k: "choice", terms: "galvanised, galvanized, steel, insulated casing, painted", opts: "galvanized, painted, stainless steel, insulated" },
    { t: "Casing insulation", k: "choice", terms: "insulation, insulated, acoustic lining, foam", opts: "polyethylene, polyurethane, mineral wool, acoustic" }
  ] },
  { c: "Valves and controls", terms: "valve, valves, thermostat, controller, controls, room controller", types: [
    { t: "Valve type", k: "choice", terms: "2-way, two way, 3-way, three way, PICV, pressure independent, on/off, modulating, balancing valve", opts: "2-way, 3-way, PICV, on/off, modulating" },
    { t: "Thermostat", k: "choice", terms: "thermostat, room controller, wall controller, wired controller, remote control", opts: "wired, wireless, digital, touch" },
    { t: "BMS protocol", k: "choice", terms: "BMS, BACnet, Modbus, KNX, LonWorks", opts: "BACnet, Modbus, KNX, LonWorks" }
  ] }
];

const CHILLER: Comp[] = [
  { c: "Unit", terms: "chiller, chillers, chiller unit, water chiller, unit, units", types: [
    { t: "Cooling capacity", k: "value", terms: "cooling capacity, capacity, net capacity, tonnage, refrigeration capacity", anchors: "TR, tons", unit: "kw", dir: "higher" },
    { t: "Full-load efficiency", k: "value", terms: "EER, COP, full load efficiency, kW/TR, kW/ton, energy efficiency ratio", anchors: "EER, COP", unit: "", dir: "higher", n: "kW/TR runs the other way: lower is better." },
    { t: "Part-load efficiency", k: "value", terms: "IPLV, NPLV, ESEER, SEER, part load, part-load efficiency", anchors: "IPLV, NPLV, ESEER, SEER", unit: "", dir: "higher" },
    { t: "Condenser type", k: "choice", terms: "air cooled, air-cooled, water cooled, water-cooled, evaporative", opts: "air cooled, water cooled, evaporative" },
    { t: "Design ambient", k: "value", terms: "ambient, design ambient, ambient temperature, operating ambient, maximum ambient", unit: "c", dir: "higher" },
    { t: "Chilled water temperatures", k: "value", terms: "chilled water, leaving water, entering water, supply water temperature, return water temperature", unit: "c", dir: "exact" },
    { t: "Sound level", k: "value", terms: "sound pressure, sound power, noise, sound level, low noise", unit: "db", dir: "lower" },
    { t: "Certification", k: "standard", terms: "certified, certification, rated", std: "AHRI 550/590, AHRI 551/591, Eurovent", anchors: "AHRI 550/590, AHRI 551/591" },
    { t: "Power supply", k: "choice", terms: "power supply, voltage, phase, electrical supply", opts: "400 V, 380 V, 415 V, 3 phase, 50 Hz, 60 Hz" },
    { t: "Warranty period", k: "value", terms: "warranty, guarantee", unit: "years", dir: "higher" }
  ] },
  { c: "Compressor", terms: "compressor, compressors", types: [
    { t: "Compressor type", k: "choice", terms: "screw, scroll, centrifugal, magnetic bearing, oil free, oil-free, reciprocating, inverter", opts: "screw, scroll, centrifugal, magnetic bearing, oil free, inverter" },
    { t: "Number of circuits", k: "value", terms: "circuits, refrigerant circuits, independent circuits", unit: "", dir: "higher" },
    { t: "Starter type", k: "choice", terms: "starter, star delta, star-delta, soft starter, soft start, direct on line, DOL, VFD", opts: "star delta, soft starter, VFD, direct on line" },
    { t: "Capacity control", k: "value", terms: "capacity control, unloading, minimum load, turndown, steps of capacity", unit: "%", dir: "lower" }
  ] },
  { c: "Refrigerant", terms: "refrigerant, refrigerants", types: [
    { t: "Refrigerant", k: "choice", terms: "refrigerant, low GWP, GWP, ozone", anchors: "R-134a, R134a, R-513A, R513A, R-1234ze, R1234ze, R-32, R32, R-410A, R410A", opts: "R-134a, R-513A, R-1234ze, R-32, R-410A, R-454B" }
  ] },
  { c: "Evaporator", terms: "evaporator, cooler, chilled water heat exchanger", types: [
    { t: "Evaporator type", k: "choice", terms: "shell and tube, flooded, DX, direct expansion, brazed plate, falling film", opts: "shell and tube, flooded, DX, brazed plate, falling film" },
    { t: "Water pressure drop", k: "value", terms: "water pressure drop, evaporator pressure drop, pressure drop", unit: "kpa", dir: "lower" },
    { t: "Water side working pressure", k: "value", terms: "working pressure, design pressure, water side pressure", unit: "bar", dir: "higher" },
    { t: "Fouling factor", k: "value", terms: "fouling factor, fouling", unit: "", dir: "exact" }
  ] },
  { c: "Condenser", terms: "condenser, condensers, condenser coil, microchannel", types: [
    { t: "Condenser coil", k: "choice", terms: "microchannel, copper fin, coated fins, aluminium fins, copper tube", opts: "microchannel, copper, aluminium, coated" },
    { t: "Coil coating", k: "choice", terms: "coating, coated, epoxy, e-coat, blue fin, corrosion protection", opts: "epoxy, e-coat, blue fin, heresite, polyurethane" },
    { t: "Condenser fans", k: "choice", terms: "condenser fans, EC fans, axial fans, fan speed control", opts: "EC, axial, variable speed" }
  ] },
  { c: "Controls", terms: "controller, controls, control panel, microprocessor, BMS", types: [
    { t: "BMS protocol", k: "choice", terms: "BACnet, Modbus, LonWorks, BMS interface, gateway", opts: "BACnet, Modbus, LonWorks" },
    { t: "Control panel protection", k: "class", terms: "control panel, enclosure, IP rating", anchors: "IP54, IP55, IP65", scale: "IP44 < IP54 < IP55 < IP65", std: "IEC 60529" }
  ] }
];

function typeSeed(x: TT): Seed {
  const special = [`Kind: ${x.k}`, `Terms: ${x.terms}`];
  if (x.anchors) special.push(`Anchors: ${x.anchors}`);
  if (x.unit) special.push(`Unit: ${x.unit}`);
  if (x.dir) special.push(`Direction: ${D[x.dir]}`);
  if (x.scale) special.push(`Scale: ${x.scale}`);
  if (x.std) special.push(`Standard: ${x.std}`);
  if (x.opts) special.push(`Options: ${x.opts}`);
  if (x.not) special.push(`Not: ${x.not}`);
  if (x.row) special.push(`Row: ${x.row}`);
  (x.eq || []).forEach((e) => special.push(`Equivalent: ${e}`));
  if (x.ex) special.push(`Example: ${x.ex}`);
  return { title: x.t, notes: x.n || "", special };
}
const GUIDE = "How specifications ask for things, in their own words, so the AI can recognise every clause like Shazam recognises a song: by its landmarks, not by its sentence. One branch per component; under it one branch per requirement type.\n\nThe special notes of a type are read by code:\n- Kind: value (a figure), class (a grade on a scale), standard (a test or code), choice (one of some options), presence (provided or not)\n- Terms: how specifications name it; Anchors: tokens that point at it alone (L2, IE3, ePM1)\n- Unit, Direction (higher / lower is better, must match), Scale (worst < ... < best)\n- Standard, Options, Not (words that mean it is something else), Row (the datasheet row that answers it), Equivalent, Example\n\nA branch \"to verify\" is not read. What a factory OFFERS is not here: it is in Product Options (per factory). How the AI answers is in the factory's AI rule book.\n\nAdd a term when a specification words a requirement in a new way; add a type when it asks something new. Compliance review > AI rules > Try a clause shows what the code recognises.";

export function vocabSeed(product: string): Seed[] {
  const p = product.toUpperCase();
  const comps = /AHU|AIR HANDL/.test(p) ? AHU : /FCU|FAN COIL/.test(p) ? FCU : /CHILL/.test(p) ? CHILLER : [];
  // the AHU-only standards (casing classes, unit ratings, hygiene, Ecodesign of ventilation units) stay with the AHU
  const stds = STANDARDS.filter(([n]) => comps === AHU || !/^(EN 1886|EN 13053|VDI 6022|ErP|EN 308|ISO 1940|AHRI 410|AHRI 430|AMCA 500-D|EN 1751|SMACNA)$/.test(n));
  return [
    { title: "How this map works", notes: GUIDE },
    { title: "Standards", notes: "The standards specifications cite. A standard found in a clause is a landmark: it points at the types that name it (Standard:).",
      kids: stds.map(([n, terms, notes]) => ({ title: n, notes, special: [`Terms: ${terms}`] })) },
    ...comps.map((c) => ({ title: c.c, notes: c.n || "", special: [`Terms: ${c.terms}`, ...(c.not ? [`Not: ${c.not}`] : [])], kids: c.types.map(typeSeed) }))
  ];
}

/* A new vocabulary map of a product from the template, private to its maker, linked at once. */
export async function createVocabMap(env: Env, userId: string, product: { id: string; name: string }, verified: boolean, name?: string): Promise<{ id: string; name: string; types: number }> {
  const mapId = uuid(), at = now(), rootId = uuid();
  let title = (name || `Vocabulary: ${product.name}`).slice(0, 80);
  const clash = await env.DB.prepare("SELECT 1 FROM mp_maps WHERE created_by = ? AND lower(name) = lower(?)").bind(userId, title).first();
  if (clash) title = (title + " " + at.slice(0, 10)).slice(0, 80);
  const seeds = vocabSeed(product.name);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO mp_maps (id, name, share, kind, purpose, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'private', 'knowledge', 'vocabulary', ?, ?, ?, ?)").bind(mapId, title, userId, at, userId, at),
    env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                    VALUES (?, ?, NULL, ?, ?, '[]', 0, 1, ?, ?, ?, ?, ?, ?)`)
      .bind(rootId, mapId, title, `What ${product.name} specifications ask, in their own words: one vocabulary for every factory. Linked in Compliance review > AI rules.`, userId, at, userId, at, userId, at)
  ];
  seeds.forEach((s, i) => addSeed(env, stmts, mapId, rootId, s, i, userId, at, verified ? 1 : 0));
  stmts.push(env.DB.prepare("DELETE FROM ai_vocab_links WHERE product_id = ?").bind(product.id));
  stmts.push(env.DB.prepare("INSERT INTO ai_vocab_links (product_id, map_id, created_by) VALUES (?, ?, ?)").bind(product.id, mapId, userId));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  const types = seeds.reduce((n, s) => n + (/^(how|standards)/i.test(s.title) ? 0 : (s.kids || []).length), 0);
  return { id: mapId, name: title, types };
}

/* For a page: one identified type as plain data. */
export function identifiedJson(x: Identified): Record<string, unknown> {
  return { id: x.type.id, title: x.type.title, component: x.type.component, kind: x.type.kind, path: x.type.path, score: x.score, confidence: x.confidence,
           landmarks: x.landmarks, asked: x.asked, rows: x.type.rows, unit: x.type.unit, direction: x.type.dir, scale: x.type.scale, standards: x.level.standard || [] };
}
