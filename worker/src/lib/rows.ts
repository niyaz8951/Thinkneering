/* The clause-to-datasheet-row match on the server: the same rule as the blue chips on the record page, so the
   AI looks at exactly what people see. A line-for-line port of CMRows.clauses / CMRows.match
   (public/tools/compliance-maker/cm-rows.js) and of the value lookup in PRMatch (public/tools/projects/pr-match.js).
   A change to one is a change to both; tests/worker/rows.test.ts holds the examples.

   Matching rule (unchanged): keywords are entries separated by ";"; an entry matches a clause when every word of
   the entry starts a word of the clause or of the heading above it, the words stand near each other; Part 2 is
   searched first, Part 1 only for rows Part 2 has nothing for, Part 3 never; up to 3 clauses per row. */

export interface SpecRowIn { type: string; sr: string; spec: string }
export interface MapRule { key: string; section: string; sub: string; component: string; show: boolean | number; label: string; keywords: string; strip?: string; response?: string }
interface Clause { row: number; part: number; ref: string; text: string; ctx: string[]; toks: string[] }

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
    out.push({ row: i, part, ref: ref.trim(), text, ctx: words(ctx), toks: words(text).filter((w) => !/^\d+$/.test(w)) });
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
      let hits: { c: Clause; s: number; i: number }[] = [];
      if (entries.length) {
        const cand = [...candidates(entries)].sort((a, b) => a - b);
        for (const p of [2, 1]) {
          for (const i of cand) {
            const c = cl[i];
            if (hasPart2 ? c.part !== p : p !== 2) continue;
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

/* Every unit of every table is a column; returns the column names and a lookup row -> one value per column. */
export function unitLookup(notes: NoteTable[]): { columns: string[]; values: (row: { key: string; section: string; component: string }) => string[] } {
  const columns: string[] = [];
  const byKey: Record<string, { at: number; cells: unknown[] }[]> = {}, byName: Record<string, { at: number; cells: unknown[] }[]> = {};
  let n = 0;
  for (const note of notes) {
    let s = "";
    const used: Record<string, number> = {};
    for (const tag of note.columns) { let t = tag, k = 2; while (columns.includes(t)) t = tag + " (" + (k++) + ")"; columns.push(t); }
    for (const r of note.rows) {
      if (r.section) s = r.section;
      if (r.kind === "sub") continue;
      for (const k of [r.key ? "k:" + r.key : null, "n:" + sectionName(s) + "|" + low(r.component)]) {
        if (!k || used[k]) continue; used[k] = 1;
        const m = k.charAt(0) === "k" ? byKey : byName;
        (m[k] = m[k] || []).push({ at: n, cells: r.cells || [] });
      }
    }
    n += note.columns.length;
  }
  return { columns, values: (row) => {
    const hit = (row.key && byKey["k:" + row.key]) || byName["n:" + sectionName(row.section) + "|" + low(row.component)] || [];
    const out = columns.map(() => "");
    for (const h of hit) h.cells.forEach((v, i) => { out[h.at + i] = v == null ? "" : String(v); });
    return out;
  } };
}

export function hasValue(cells: string[]): boolean { return cells.some((v) => v && v !== "-"); }
