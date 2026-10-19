/* The clause-to-datasheet-row match on the server: the same rule as the blue chips on the record page, so the
   AI looks at exactly what people see. A line-for-line port of CMRows.clauses / CMRows.match
   (public/tools/compliance-maker/cm-rows.js) and of the value lookup in PRMatch (public/tools/projects/pr-match.js).
   A change to one is a change to both; tests/worker/rows.test.ts holds the examples.

   Matching rule (unchanged): keywords are entries separated by ";"; an entry matches a clause when every word of
   the entry starts a word of the clause or of the heading above it, the words stand near each other; Part 2 is
   searched first, Part 1 only for rows Part 2 has nothing for, Part 3 never; up to 3 clauses per row.
   Topic gate (19 Oct 2026): a clause about one part of the unit (its nearest heading or label says filters, fans,
   coils, a VFD ...) only links rows of that part of the datasheet; a clause or a row with no topic is not gated. */

export interface SpecRowIn { type: string; sr: string; spec: string }
export interface MapRule { key: string; section: string; sub: string; component: string; show: boolean | number; label: string; keywords: string; strip?: string; response?: string }
interface Clause { row: number; part: number; ref: string; text: string; ctx: string[]; toks: string[]; topic: string }

/* Parts of a unit, most specific first: a text's topic is the first one it names ("Electrical Heating Coils" is a
   heater, "Disposable Panel Filters" a filter). The same list is in cm-rows.js. */
const TOPICS: [string, RegExp][] = [
  ["vfd", /\b(variable (frequency|speed)|frequency controllers?|vfds?|vfcs?|inverters?)\b/],
  ["filter", /\b(filters?|filtration|hepa|merv)\b/],
  ["humid", /\b(humidif\w*|washers?|evaporative)\b/],
  ["recovery", /\b(energy recovery|heat recovery|(heat|energy|enthalpy) wheels?|recuperators?|heat exchangers?|run around)\b/],
  ["heater", /\b(heaters?|electric(al)? heat\w*|heating coils?)\b/],
  ["coil", /\bcoils?\b/],
  ["damper", /\b(dampers?|mixing (box|boxes|section|sections))\b/],
  ["sound", /\b(sound|acoustic\w*|noise)\b/],
  ["fan", /\b(fans?|motors?|drives?|impellers?)\b/],
  ["casing", /\b(casings?|cabinets?|panels?|insulation|drain pans?|doors?|roofs?|bases?|frames?|structural)\b/],
  ["electrical", /\b(electrical|power supply|wiring|voltage)\b/],
  ["performance", /\b(capacit(y|ies)|characteristics|performance)\b/]
];
const GENERAL = ["casing", "performance"];
export function topicOf(text: unknown): string { const t = norm(text); for (const [k, re] of TOPICS) if (re.test(t)) return k; return ""; }
function topicsIn(text: unknown): string[] { const t = norm(text); return TOPICS.filter(([, re]) => re.test(t)).map(([k]) => k); }
function lead(text: string): string { const c = text.indexOf(":"); return c > 0 && c <= 80 ? text.slice(0, c) : ""; }
/* The parts of the unit a datasheet row is about: its section's, plus any its sub-heading and name add. */
export function rowTopics(r: { section: string; sub?: string; component: string }): string[] {
  const sec = norm(r.section);
  const base = sec === "unit data" ? ["casing", "performance"] : /^mechanical characteristic/.test(sec) ? ["casing"]
    : /^en 13053/.test(sec) ? ["performance", "fan"] : (topicOf(sec) ? [topicOf(sec)] : []);
  const out = [...base, ...topicsIn((r.sub || "") + " " + r.component)];
  return [...new Set(out)];
}

const MAX = 3, FAR = 6;
function norm(s: unknown): string { return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function words(s: unknown): string[] { const n = norm(s); return n ? n.split(" ") : []; }
function shortHeading(text: string): boolean { return words(text).length <= 8 && !/\b(shall|must|will|should)\b/i.test(text); }

export function clauses(rows: SpecRowIn[]): Clause[] {
  const out: Clause[] = [];
  let part = 0;
  let sec: { sr: string; text: string } | null = null;
  let lvl1: { sr: string; text: string; heading: boolean } | null = null, lvl2: { sr: string; text: string; heading: boolean } | null = null;
  rows.forEach((r, i) => {
    const text = String(r.spec || "").trim();
    if (r.type === "part") {
      const m = /PART\s+([0-9IVX]+)/i.exec(text);
      if (m) part = ({ I: 1, II: 2, III: 3 } as Record<string, number>)[m[1].toUpperCase()] || parseInt(m[1], 10) || part;
      sec = lvl1 = lvl2 = null;
      return;
    }
    if (/\.{5,}/.test(text)) return;
    if (r.type === "section") { sec = { sr: r.sr, text }; lvl1 = lvl2 = null; return; }
    if (!text) return;
    const sr = String(r.sr || "").replace(/[.)]\s*$/, "");
    let level = 0;
    if (r.type === "letter") level = /^[A-Z]$/.test(sr) ? 1 : 3;
    else if (r.type === "number") level = 2;
    const next = rows[i + 1];
    const hasChildren = !!next && ((level === 1 && (next.type === "number" || (next.type === "letter" && /^[a-z]/.test(String(next.sr))))) ||
                                   (level === 2 && next.type === "letter" && /^[a-z]/.test(String(next.sr))));
    if (level === 1) { lvl1 = { sr, text, heading: shortHeading(text) }; lvl2 = null; }
    if (level === 2) lvl2 = { sr, text, heading: shortHeading(text) };
    const s1 = sec as { sr: string } | null, l1 = lvl1 as { sr: string; text: string; heading: boolean } | null, l2 = lvl2 as { sr: string; text: string; heading: boolean } | null;
    let ref = s1 ? s1.sr : "", ctx = "";
    if (level === 1) ref += " " + sr;
    else {
      if (l1) { ref += " " + l1.sr; if (l1.heading) ctx += " " + l1.text; }
      if (level === 2) ref += (l1 ? "." : " ") + sr;
      if (level === 3) { if (l2) { ref += (l1 ? "." : " ") + l2.sr; if (l2.heading) ctx += " " + l2.text; } ref += "." + sr; }
    }
    if (hasChildren && ((level === 1 && l1!.heading) || (level === 2 && l2!.heading))) return;
    // the clause's topic: its own label, then the headings above it, nearest first, then the section title
    const own = lead(text) || words(text).slice(0, 6).join(" ");      // its label, or its first words when it has none
    const above = [level === 3 && l2 ? (l2.heading ? l2.text : lead(l2.text)) : "", level >= 2 && l1 ? (l1.heading ? l1.text : lead(l1.text)) : "", s1 ? (sec as { text: string } | null)?.text || "" : ""];
    // a heading above that names a specific part (filters, a VFD, heat wheels ...) holds for every item under it
    // ("Mounting Frames" under "Panel Filters", "Motor output voltage" under "Variable Frequency Controllers");
    // otherwise the clause's own label or first words; then a general heading (casing); then the section title
    const heads = [above[0], above[1]].map(topicOf);
    const topic = heads.find((t) => t && !GENERAL.includes(t)) || topicOf(own) || heads.find(Boolean) || topicOf(above[2]);
    out.push({ row: i, part, ref: ref.trim(), text, ctx: words(ctx), toks: words(text).filter((w) => !/^\d+$/.test(w)), topic });
  });
  return out;
}

function starts(list: string[], w: string): boolean { for (const x of list) if (x.indexOf(w) === 0) return true; return false; }
function span(toks: string[], ws: string[]): number {
  let best = Infinity;
  for (let p = 0; p < toks.length; p++) {
    let end = p, ok = true;
    for (let k = 0; k < ws.length && ok; k++) {
      let q = p;
      while (q < toks.length && toks[q].indexOf(ws[k]) !== 0) q++;
      if (q === toks.length) ok = false; else if (q > end) end = q;
    }
    if (!ok) break;
    if (end - p + 1 < best) best = end - p + 1;
  }
  return best;
}
function score(entries: string[][], c: Clause): number {
  let n = 0;
  for (const e of entries) {
    let pts = 0; const inText: string[] = []; let bad = false;
    for (const w of e) {
      if (starts(c.toks, w)) { pts += 2; inText.push(w); }
      else if (starts(c.ctx, w)) pts += 1;
      else { bad = true; break; }
    }
    if (bad) continue;
    if (inText.length > 1) {
      const sp = span(c.toks, inText);
      if (sp > inText.length + FAR) continue;
      if (sp <= inText.length + 1) pts += 1;
    }
    n += pts;
  }
  return n;
}

export interface MatchRow { section: string; component: string; key: string; found: boolean; lines: number[]; entries: string[][]; rule: MapRule }

/* rules in mapping order -> one entry per shown row with the positions (in specRows) of its clauses */
export function match(specRows: SpecRowIn[], rules: MapRule[]): MatchRow[] {
  const cl = clauses(specRows);
  const hasPart2 = cl.some((c) => c.part === 2);
  // speed only (the Workers Free plan allows about 10 ms of work a request): an index from every word beginning to
  // the clauses that have a word starting with it, in their text or their heading. An entry can only score in a
  // clause that has all its words, so only those clauses are scored; the result is the same as scoring them all.
  const byWord = new Map<string, number[]>();
  cl.forEach((c, i) => { for (const w of c.toks) push(w, i); for (const w of c.ctx) push(w, i); });
  function push(w: string, i: number) { const l = byWord.get(w); if (!l) byWord.set(w, [i]); else if (l[l.length - 1] !== i) l.push(i); }
  const sorted = [...byWord.keys()].sort();
  const memo = new Map<string, Set<number> | null>();
  // the clauses with a word that starts with w: the words from w up to the first that no longer starts with it
  const index = { get(w: string): Set<number> | null {
    if (memo.has(w)) return memo.get(w)!;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < w) lo = mid + 1; else hi = mid; }
    let out: Set<number> | null = null;
    for (let k = lo; k < sorted.length && sorted[k].startsWith(w); k++) { if (!out) out = new Set(); for (const i of byWord.get(sorted[k])!) out.add(i); }
    memo.set(w, out); return out;
  } };
  const candidates = (entries: string[][]): Set<number> => {
    const out = new Set<number>();
    for (const e of entries) {
      let cur: Set<number> | null = null;
      for (const w of e) {
        const set = index.get(w);
        if (!set) { cur = new Set(); break; }
        if (!cur) cur = new Set(set);
        else for (const x of cur) if (!set.has(x)) cur.delete(x);
        if (!cur.size) break;
      }
      if (cur) for (const x of cur) out.add(x);
    }
    return out;
  };
  const order: string[] = [];
  rules.forEach((r) => { if (r.show !== false && r.show !== 0 && !order.includes(r.section)) order.push(r.section); });
  const out: MatchRow[] = [];
  for (const sec of order) {
    for (const r of rules) {
      if (r.show === false || r.show === 0 || r.section !== sec) continue;
      const entries = String(r.keywords || "").split(";").map(words).filter((e) => e.length);
      const topics = rowTopics(r);
      let hits: { c: Clause; s: number; i: number }[] = [];
      if (entries.length) {
        const cand = [...candidates(entries)].sort((a, b) => a - b);
        for (const p of [2, 1]) {
          for (const i of cand) {
            const c = cl[i];
            if (hasPart2 ? c.part !== p : p !== 2) continue;
            if (topics.length && c.topic && !topics.includes(c.topic)) continue;      // the topic gate
            const s = score(entries, c);
            if (s) hits.push({ c, s, i });
          }
          if (hits.length) break;
        }
        hits.sort((a, b) => b.s - a.s || a.i - b.i);
        const top = hits.length ? hits[0].s : 0;
        hits = hits.filter((h) => h.s * 2 >= top);
      }
      const shown = hits.slice(0, MAX).sort((a, b) => a.i - b.i);
      out.push({ section: sec, component: String(r.label || "").trim() || r.component, key: r.key, found: hits.length > 0,
                 lines: shown.map((h) => h.c.row), entries, rule: r });
    }
  }
  return out;
}

/* ---------- values from the project's saved datasheet tables (PRMatch.unitLookup) ---------- */

export interface NoteTable { columns: string[]; rows: { section?: string; component?: string; cells?: unknown[]; kind?: string; key?: string }[] }
function low(s: unknown): string { return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim(); }
export function sectionName(s: unknown): string { return low(s).replace(/^\d+\)\s*/, "").replace(/\s*\(\d+\)$/, ""); }

/* Every unit of every table is a column; a unit tag read again in a newer table is taken from the newest one only.
   entries(row) gives every table row the mapping row stands for, in table order, each { qual, cells }: a key printed
   twice (Filter Class of Filter 1 and Filter 2, a second "Empty Section Supply") gives two entries, told apart by their
   order in the table and named by their sub-heading or section ("Filter 2", "Empty Section Supply 2"). values(row) is
   the first entry's cells. The same as PRMatch.unitLookup (pr-match.js). */
export interface Entry { qual: string; cells: string[] }
export function unitLookup(notes: NoteTable[]): { columns: string[]; entries: (row: { key: string; section: string; component: string }) => Entry[]; values: (row: { key: string; section: string; component: string }) => string[] } {
  const columns: string[] = [];
  const keep: boolean[][] = notes.map(() => []), seen = new Set<string>();
  for (let t = notes.length - 1; t >= 0; t--) notes[t].columns.forEach((tag, i) => { keep[t][i] = !seen.has(tag); seen.add(tag); });
  const at = notes.map((note, t) => note.columns.map((tag, i) => { if (!keep[t][i]) return -1; columns.push(tag); return columns.length - 1; }));
  const byId = new Map<string, Entry>(), order = new Map<string, Entry[]>();
  notes.forEach((note, t) => {
    let s = "", title = "", sub = "";
    const occ: Record<string, number> = {};
    for (const r of note.rows) {
      if (r.section) { s = r.section; title = r.section; sub = ""; }
      if (r.kind === "sub") { sub = String(r.component || ""); continue; }
      const m = /\((\d+)\)\s*$/.exec(title), qual = [m ? sectionName(title) + " " + m[1] : "", sub].filter(Boolean).join(" \u00b7 ");
      for (const k of [r.key ? "k:" + r.key : null, "n:" + sectionName(s) + "|" + low(r.component)]) {
        if (!k) continue;
        occ[k] = (occ[k] || 0) + 1;
        const id = k + "#" + occ[k];
        let e = byId.get(id);
        if (!e) { e = { qual, cells: columns.map(() => "") }; byId.set(id, e); const l = order.get(k) || []; l.push(e); order.set(k, l); }
        (r.cells || []).forEach((v, i) => { const c = at[t][i]; if (c != null && c >= 0) e!.cells[c] = v == null ? "" : String(v); });
      }
    }
  });
  const entries = (row: { key: string; section: string; component: string }): Entry[] => {
    const list = (row.key && order.get("k:" + row.key)) || order.get("n:" + sectionName(row.section) + "|" + low(row.component)) || [];
    return list.map((e) => ({ qual: list.length > 1 ? e.qual : "", cells: e.cells.slice() }));
  };
  return { columns, entries, values: (row) => { const l = entries(row); return l.length ? l[0].cells : columns.map(() => ""); } };
}

export function hasValue(cells: string[]): boolean { return cells.some((v) => v && v !== "-"); }
