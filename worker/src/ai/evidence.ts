/* What the AI knows about the clauses of one compliance record, gathered once per request, and the decision
   for one clause. The order is the owner's (16 Oct 2026) and is written out in the AI map's "How the AI
   decides" branch:

     1. the project's datasheet  - what THIS unit is; the same rows as the blue chips (lib/rows.ts); a number in
                                   the clause is compared by code ("62 mm >= 50 mm required"); the saved cell is
                                   already the row's Response template filled in, so it is the remark
     2. Product Options          - what the factory can offer: values seen, special options, notes, AI notes
     3. the library              - how the clause was answered, in what words (>= copy threshold: copied)
     4. earlier answers          - the same clause answered by a person in this record; then in other projects of
                                   the same factory (ranked below the library)
     5. AI rules (the AI map)    - a rule with a fixed answer and remark answers by itself
     6. the model                - only when none of the above settles it, within the daily budget; it is given
                                   everything above and writes the sentence; code checks it (draft.ts, guard.ts)

   A clause the library answers (green) is reopened when this project's datasheet gives a different value: the
   datasheet wins as a blue draft that names both values. */
import type { Env } from "../env";
import { placeRows, cmNorm } from "../lib/cm";
import { all, sha256 } from "../lib/sql";
import { match, unitLookup, hasValue, sectionName, type MapRule, type NoteTable } from "../lib/rows";
import { sectionKinds, sectionKey, type SectionInfo } from "./sections";
import { measurements, type Measure } from "./guard";
import { classRequirements, comparable, propertyOf, judge, fmt, familyOfUnit, classIn, compareClass, sameMetric } from "./compare";
import { ClauseSearch, GramIndex, lexicalScore, type Similar } from "./search";
import { aiMapFor, type AiSettings, type Section } from "./map";
import { pickRules, directRule, splitComments, parentOf, unitValues, notesMatching, prepareKnowledge, knowledgeMatching, type KnowledgeIndexed, type AiRule, type RuleHit } from "./rules";
import type { AiUsage } from "./models";

export interface RunInfo { id: string; product_id: string; factory_id: string; project_id: string | null; product: string; factory: string }
export interface RunRowFull {
  seq: number; type: string; sr: string; spec_text: string; line_id: string | null; compliance: string; remarks: string; ai_draft: number;
  answered_by: string | null; l_status: string | null; l_compliance: string | null; l_remarks: string | null; l_comments: string | null;
}
/* group: the mapping key when that key stands for several table rows (Filter 1 / Filter 2), else "" */
export interface SheetHit { key: string; section: string; component: string; label: string; cells: string[]; value: string; entries: string[][]; group?: string }
export interface OptionInfo { values: string[]; specials: string[]; notes: string[]; ai: string[] }
export interface PastAnswer { spec: string; compliance: string; remarks: string; by: string; score: number; where: string; pending: boolean }
/* A correction: what people answered instead of the AI on a clause (ai_feedback, edited or replaced). On a similar
   clause the model is shown it as a source it may cite ([M1]): this is how the AI learns from its mistakes between
   two reviews. The model itself never changes; what it is told does. */
export interface Correction { spec: string; section: string; suggested: string; suggested_remarks: string; final: string; final_remarks: string; outcome: string; score: number }

export interface Comparison { compliance: string; remarks: string; reason: string; rows: SheetHit[]; values: Measure[]; confidence: "high" | "medium" | "low" }

export interface Context {
  run: RunInfo; rows: RunRowFull[]; place: Map<number, { part: number; section: string }>;
  columns: string[]; sheet: Map<number, SheetHit[]>; options: Map<number, OptionInfo>; aiNotes: { section: string; key: string; body: string }[];
  rules: AiRule[]; settings: AiSettings; instructions: Section[] | null; knowledge: KnowledgeIndexed[]; search: ClauseSearch; project: PastAnswer[]; names: Map<string, string>;
  projectIndex?: GramIndex<PastAnswer>; recordIndex?: GramIndex<RunRowFull>;
  kinds: Map<string, SectionInfo>;          // what kind of question each section asks (sections.ts)
  corrections: Correction[];                 // what people changed in the AI's answers for this factory (newest 400)
  correctionIndex?: GramIndex<Correction>;
  absent: Map<number, string[]>;            // unit sections a clause is about that this project's datasheet does not have
  sheetWarning: string;                      // why the project's datasheet was not used (another factory), or ""
}

/* The factory a saved table names: its General > Factory row, first unit that has one. */
function factoryRow(rows: NoteTable["rows"]): string {
  let s = "";
  for (const r of rows) {
    if (r.section) s = String(r.section);
    if (sectionName(s) === "general" && String(r.component || "").toLowerCase() === "factory") {
      const v = (r.cells || []).map((c) => String(c ?? "")).find((c) => c && c !== "-");
      if (v) return v;
    }
  }
  return "";
}
/* "ahu-riyadh" -> "Riyadh"; a factory name stays as it is */
function factoryName(v: string): string { const m = /^[a-z]+-(.+)$/.exec(v); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : v; }

/* The operator a figure carries, from the words just before it (or just after: "50 mm or more").
   Checked in this order, because the negative forms end with the positive words: "not more than 250 Pa" ends with
   "more than", "not less than 50 mm" ends with "less than". Found on the Riyadh Metro AHU spec, 16 Oct 2026:
   "not be greater than 229 mm" and "not to exceed 2.5 meters per second" were read wrongly before. */
const NOT_LESS = /(?:not|never|no)\s+(?:be\s+)?(?:less|lower|fewer|smaller|thinner)\s+than\s*$/i;
const OPS_MAX = /(?:maximum(?:\s+of)?|max\.?|at\s+most|up\s+to|limited\s+to|not\s+(?:to\s+|be\s+)?exceed(?:ing)?|(?:not|never|no)\s+(?:be\s+)?(?:more|greater|higher|larger|bigger|over)(?:\s+than)?|less\s+than|lower\s+than|below|under|≤|<=|=<)\s*$/i;
const OPS_MIN = /(?:minimum(?:\s+of)?|min\.?|at\s+least|no\s+less\s+than|shall\s+exceed|exceeding|greater\s+than|more\s+than|higher\s+than|above|over|≥|>=|=>)\s*$/i;
const AFTER_MIN = /^\s*(or more|or greater|or higher|or above|or better|minimum|min\b)/i;
const AFTER_MAX = /^\s*(or less|or lower|or below|or smaller|maximum|max\b)/i;

export function operatorOf(before: string, after: string): ">=" | "<=" | "=" {
  const b = before.replace(/\s+/g, " ");
  if (NOT_LESS.test(b)) return ">=";
  if (OPS_MAX.test(b)) return "<=";
  if (OPS_MIN.test(b)) return ">=";
  if (AFTER_MIN.test(after)) return ">=";
  if (AFTER_MAX.test(after)) return "<=";
  return "=";
}

/* ---------- loading (once per request) ---------- */

/* opts.cache false: the clause-to-row match is worked out but not kept (Check the AI, a record that does not exist). */
export async function loadContext(env: Env, run: RunInfo, rows: RunRowFull[], usage?: AiUsage, opts: { cache?: boolean } = {}): Promise<Context> {
  const specRows = rows.map((x) => ({ seq: x.seq, type: x.type, sr: x.sr, spec: x.spec_text }));
  const place = placeRows(specRows);
  type MapRow = MapRule & { row_key: string };
  const [mapRes, notesRes, valRes, extraRes, projRes, corrRes] = await env.DB.batch([
    env.DB.prepare("SELECT row_key, section, sub, component, show, label, keywords, strip, response FROM dn_map WHERE product_id = ? ORDER BY sort, row_key").bind(run.product_id),
    env.DB.prepare("SELECT columns, file_key, factory_id FROM pr_notes WHERE project_id = ? AND product_id = ? ORDER BY created_at").bind(run.project_id || "", run.product_id),
    env.DB.prepare("SELECT row_key, value, times FROM po_values WHERE factory_id = ? AND hidden = 0 AND approved = 1 ORDER BY times DESC").bind(run.factory_id),
    env.DB.prepare("SELECT section, row_key, kind, body FROM po_extras WHERE factory_id = ? ORDER BY created_at").bind(run.factory_id),
    // other projects' answers of this factory, by people (newest first; the cap keeps the work small)
    env.DB.prepare(`SELECT rl.spec_text, rl.compliance, rl.remarks, rl.answered_by, rl.review, p.name AS project
                      FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id LEFT JOIN pr_projects p ON p.id = r.project_id
                     WHERE r.factory_id = ? AND rl.run_id <> ? AND rl.ai_draft = 0 AND rl.line_id IS NOT NULL AND (rl.compliance <> '' OR rl.remarks <> '')
                     ORDER BY rl.answered_at DESC LIMIT 400`).bind(run.factory_id, run.id),
    // the AI's answers people corrected (any record of this factory, newest first): shown on similar clauses
    env.DB.prepare(`SELECT l.spec_text AS spec, f.section, f.suggested, f.suggested_remarks, f.final, f.final_remarks, f.outcome
                      FROM ai_feedback f JOIN cm_lines l ON l.id = f.line_id
                     WHERE f.factory_id = ? AND f.outcome IN ('edited', 'replaced') AND f.final <> ''
                     ORDER BY f.created_at DESC LIMIT 400`).bind(run.factory_id)
  ]);
  const rules = (mapRes.results as unknown as MapRow[]).map((r) => ({ ...r, key: r.row_key }));
  // the project's saved datasheet tables of this product (R2)
  let tables: NoteTable[] = [];
  const otherFactory = new Set<string>();
  for (const n of notesRes.results as unknown as { columns: string; file_key: string; factory_id: string }[]) {
    try {
      const obj = n.file_key && env.FILES ? await env.FILES.get(n.file_key) : null;
      if (!obj) continue;
      const data = (await obj.json()) as { rows?: NoteTable["rows"] };
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      // a datasheet of another factory says nothing about this record's units (tables saved before 19 Oct carry
      // no factory id: their General > Factory row is read instead)
      const named = n.factory_id ? "" : factoryRow(rows);
      if ((n.factory_id && n.factory_id !== run.factory_id) || (named && named.toLowerCase() !== run.factory.toLowerCase())) { otherFactory.add(named || n.factory_id); continue; }
      tables.push({ columns: (JSON.parse(n.columns || "[]") as unknown[]).map((c) => String(c ?? "")), rows });
    } catch (e) { console.warn("datasheet table could not be read", e); }
  }
  const sheetWarning = otherFactory.size ? `The project's datasheet is for another factory (${[...otherFactory].map(factoryName).join(", ")}), not ${run.factory}: it was not used. Read the ${run.factory} datasheet, or convert the specification for the datasheet's factory.` : "";
  const look = unitLookup(tables);
  // the unit sections the project's datasheet has (any value in them): a clause about another one is about a
  // part the selected unit may not include (Thinkneering v3, "what this unit is made of")
  const present = new Set<string>();
  for (const t of tables) { let sec = ""; for (const r of t.rows) { if (r.section) sec = r.section; if (hasValue((r.cells || []).map((c) => String(c ?? "")))) present.add(sectionName(sec)); } }
  const absent = new Map<number, string[]>();
  // Product Options of the factory, per mapping row and per section
  const valuesByRow = new Map<string, string[]>();
  for (const v of valRes.results as unknown as { row_key: string; value: string }[]) {
    const l = valuesByRow.get(v.row_key) || []; if (l.length < 8) l.push(v.value); valuesByRow.set(v.row_key, l);
  }
  const extras = extraRes.results as unknown as { section: string; row_key: string; kind: string; body: string }[];
  const aiNotes = extras.filter((x) => x.kind === "ai").map((x) => ({ section: x.section, key: x.row_key, body: x.body }));
  // the clause-to-row match, the same as the chips (kept per record: see matchFor)
  const sheet = new Map<number, SheetHit[]>(), options = new Map<number, OptionInfo>();
  const matched = await matchFor(env, run.id, specRows, rules, opts.cache !== false);
  for (const m of matched) {
    if (!m.found) continue;
    // every table row the mapping row stands for (Filter 1 and Filter 2 ...): one hit each, all compared
    const list = look.entries({ key: m.key, section: m.section, component: m.rule.component });
    const hits: SheetHit[] = list.map((e) => {
      const component = m.component + (e.qual ? " \u00b7 " + e.qual : "");
      return { key: m.key, section: m.section, component, label: `${m.section} • ${component}`, cells: e.cells, value: unitValues(e.cells, look.columns), entries: m.entries, group: list.length > 1 ? m.key : "" };
    });
    const cells = hits.length ? hits.flatMap((h) => h.cells) : [];
    const ex = extras.filter((x) => (x.row_key === m.key) || (x.row_key === "" && x.section.toLowerCase() === m.section.toLowerCase()));
    const missing = tables.length > 0 && present.size > 0 && !present.has(sectionName(m.section));
    for (const seq of m.seqs) {
      if (hasValue(cells)) { const l = sheet.get(seq) || []; l.push(...hits.filter((h) => hasValue(h.cells))); sheet.set(seq, l); }
      if (missing) { const a = absent.get(seq) || []; if (!a.includes(m.section)) a.push(m.section); absent.set(seq, a); }
      const o = options.get(seq) || { values: [], specials: [], notes: [], ai: [] };
      const vals = valuesByRow.get(m.key) || [];
      if (vals.length) o.values.push(`${m.component}: ${vals.join(" | ")}`);
      for (const x of ex) {
        const where = x.row_key ? m.component : m.section;
        if (x.kind === "option") o.specials.push(`${where}: ${x.body}`);
        else if (x.kind === "note") o.notes.push(`${where}: ${x.body}`);
        else o.ai.push(`${where}: ${x.body}`);
      }
      options.set(seq, o);
    }
  }
  const ai = await aiMapFor(env, run.product_id, run.factory_id);
  const kinds = await sectionKinds(env, run.factory_id);
  const project = (projRes.results as unknown as { spec_text: string; compliance: string; remarks: string; answered_by: string | null; review: string; project: string | null }[])
    .map((r) => ({ spec: r.spec_text, compliance: r.compliance, remarks: r.remarks, by: r.answered_by || "", score: 0, where: r.project || "another project", pending: r.review !== "approved" }));
  const ids = [...new Set([...project.map((p) => p.by), ...rows.map((r) => r.answered_by || "")].filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const got = await all<{ id: string; full_name: string }>(env.DB.prepare(`SELECT id, full_name FROM app_users WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part));
    got.forEach((g) => names.set(g.id, g.full_name));
  }
  const pl = new Map<number, { part: number; section: string }>();
  for (const [k, v] of place) pl.set(k, { part: v.part, section: v.section });
  return { run, rows, place: pl, columns: look.columns, sheet, sheetWarning, options, aiNotes, rules: ai.rules, settings: ai.settings, instructions: ai.instructions, knowledge: prepareKnowledge(ai.knowledge),
           search: new ClauseSearch(env, usage), project, names, kinds, absent,
           corrections: (corrRes.results as unknown as Correction[]).map((c) => ({ ...c, score: 0 })) };
}

/* ---------- the match, worked out once per record ---------- */

interface Matched { key: string; section: string; component: string; found: boolean; seqs: number[]; entries: string[][]; rule: MapRule }
const MATCH_VERSION = "2026-10-19 topics";
const matchMemo = new Map<string, { stamp: string; byKey: Record<string, number[]> }>();

async function matchFor(env: Env, runId: string, specRows: { seq: number; type: string; sr: string; spec: string }[], rules: MapRule[], cache = true): Promise<Matched[]> {
  // MATCH_VERSION: a change to the matching rule (lib/rows.ts) makes every kept match stale
  const stamp = (await sha256(JSON.stringify([MATCH_VERSION, specRows.map((r) => [r.seq, r.type, r.sr, r.spec]), rules.map((r) => [r.key, r.section, r.sub, r.component, r.label, r.show, r.keywords])]))).slice(0, 24);
  let byKey: Record<string, number[]> | null = null;
  const mem = cache ? matchMemo.get(runId) : undefined;
  if (mem && mem.stamp === stamp) byKey = mem.byKey;
  if (!byKey && !cache) {
    byKey = {};
    for (const m of match(specRows, rules)) if (m.found) byKey[m.key] = m.lines.map((i) => specRows[i].seq);
  }
  if (!byKey) {
    const row = await env.DB.prepare("SELECT stamp, payload FROM ai_match_cache WHERE run_id = ?").bind(runId).first<{ stamp: string; payload: string }>();
    if (row && row.stamp === stamp) { try { byKey = JSON.parse(row.payload); } catch { byKey = null; } }
  }
  if (!byKey) {
    byKey = {};
    for (const m of match(specRows, rules)) if (m.found) byKey[m.key] = m.lines.map((i) => specRows[i].seq);
    await env.DB.prepare("INSERT INTO ai_match_cache (run_id, stamp, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET stamp = excluded.stamp, payload = excluded.payload, created_at = excluded.created_at")
      .bind(runId, stamp, JSON.stringify(byKey), new Date().toISOString()).run();
  }
  if (cache) {
    if (matchMemo.size > 200) matchMemo.clear();
    matchMemo.set(runId, { stamp, byKey });
  }
  const words = (s: string) => { const n = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return n ? n.split(" ") : []; };
  return rules.filter((r) => byKey![r.key]).map((r) => ({ key: r.key, section: r.section, component: String(r.label || "").trim() || r.component, found: true, seqs: byKey![r.key],
    entries: String(r.keywords || "").split(";").map(words).filter((e) => e.length), rule: r }));
}

/* ---------- 1. the datasheet: code compares ---------- */

function tokensWithPos(text: string): { w: string; at: number }[] {
  const out: { w: string; at: number }[] = []; const re = /[a-z0-9]+/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ w: m[0].toLowerCase(), at: m.index });
  return out;
}

/* The requirement a number in the clause states: its operator from the words just before or after it. A range
   ("6 to 60 Hz", "between 60 and 80 percent", "5 Hz to 25 Hz") is one requirement with both ends. */
export type Op = ">=" | "<=" | "=" | "range";
export interface Requirement { m: Measure; op: Op; at: number; lo?: number }
export function requirements(clause: string): Requirement[] {
  const out: Requirement[] = [];
  const ms: { m: Measure; at: number }[] = [];
  let from = 0;
  for (const m of measurements(clause)) { const at = clause.indexOf(m.raw, from); if (at < 0) continue; from = at + m.raw.length; ms.push({ m, at }); }
  let prevEnd = -1;
  for (let i = 0; i < ms.length; i++) {
    const { m, at } = ms[i];
    // "152 mm (6 inch)": the figure in brackets right after another is the same requirement in other units
    const dup = prevEnd >= 0 && /^\s*\(\s*$/.test(clause.slice(prevEnd, at));
    prevEnd = at + m.raw.length;
    if (dup) continue;
    const before = clause.slice(Math.max(0, at - 40), at), after = clause.slice(at + m.raw.length, at + m.raw.length + 25);
    // "6 to 60 Hz" / "between 60 and 80 percent": a bare number just before, joined by to / and / a dash
    const bare = /(?:between\s+)?(\d+(?:[.,]\d+)?)\s*(?:to|and|-|\u2013)\s*$/i.exec(before);
    if (bare && !/\d\s*$/.test(before.slice(0, bare.index))) { out.push({ m, op: "range", at, lo: parseFloat(bare[1].replace(",", ".")) }); continue; }
    // "5 Hz to 25 Hz": two figures in the same unit joined by to / and / a dash
    const next = ms[i + 1];
    if (next && next.m.unit === m.unit && /^\s*(?:to|and|-|\u2013)\s*$/i.test(clause.slice(at + m.raw.length, next.at))) {
      out.push({ m: next.m, op: "range", at, lo: m.n }); prevEnd = next.at + next.m.raw.length; i++; continue;
    }
    out.push({ m, op: operatorOf(before, after), at });
  }
  return out;
}

/* The datasheet rows tell this clause's number only when a word of the row's keywords stands near the number:
   "screw spacing not greater than 225 mm" is not answered by the panel skin thickness found in the same clause. */
function near(clause: string, at: number, entries: string[][], subject = ""): boolean {
  const toks = tokensWithPos(clause);
  const k = toks.findIndex((t) => t.at >= at);
  if (k < 0) return false;
  const lo = Math.max(0, k - 8), hi = Math.min(toks.length, k + 8);
  const keys = entries.flat().filter((w) => w.length >= 3 && !/^\d/.test(w));
  for (let j = lo; j < hi; j++) if (keys.some((w) => toks[j].w.startsWith(w))) return true;
  // a list item ("Thickness: 50 mm.") is about its parent's subject ("Insulation: ...")
  if (subject) for (const t of tokensWithPos(subject)) if (keys.some((w) => t.w.startsWith(w))) return true;
  return false;
}

/* The subject of a parent clause: its label before the colon ("Insulation"), or its first words. */
export function subjectOf(parent: string): string {
  const p = String(parent || "").trim();
  if (!p) return "";
  const colon = p.indexOf(":");
  return (colon > 0 && colon <= 60 ? p.slice(0, colon) : p.split(/\s+/).slice(0, 8).join(" ")).trim();
}

/* The clause's figures and classes against the datasheet rows next to it (Thinkneering v3 comparison, compare.ts).
   A clause is a conjunction (master prompt v4.1, 19 Oct 2026): it is Comply only when EVERY figure and class it asks
   for was compared, on every unit, and met. Otherwise code gives no verdict and the clause goes on to the library,
   the rules and the model with the datasheet rows as sources:
   - a figure with "minimum" / "maximum" wording is a limit: met, or broken = Not Comply
   - a range ("6 to 60 Hz") is met inside it, broken outside it
   - a figure asked "as is" that the unit does not have exactly = Comply with Remarks stating the offer (owner's rule,
     16 Oct 2026); the property's direction says whether it is better or worse, and a worse one is low confidence
   - a class (TB2, L1, D1, F7) is a minimum on its published scale
   - figures in another unit are converted to the clause's; a percentage only against a row of the same metric
     ("ISO Coarse 60%" is not an ASHRAE arrestance)
   - rows that stand for one mapping row twice (Filter 1 G4 and Filter 2 F7) that disagree settle nothing: a person
     decides which one the clause is about
   - a figure no row answers (a test condition, a value the datasheet does not print) leaves the clause open
   A clean Comply carries no remark (the remark lock in guard.ts); the values stay in the reason. */
export function compareDatasheet(clause: string, hits: SheetHit[], columns: string[], subject = ""): Comparison | null {
  const reqs = requirements(clause), classes = classRequirements(clause);
  if ((!reqs.length && !classes.length) || !hits.length) return null;
  const used: SheetHit[] = []; const vals: Measure[] = [];
  type V = { ok: boolean; equal: boolean; op: string; worse: boolean; text: string; group: string; hit: SheetHit };
  const where = (h: SheetHit, unit: string, many: boolean) => many || columns.length > 1 ? unit : h.component;
  let open = 0;                      // requirements no row settled
  const all: V[] = [];
  // the verdicts of one requirement; rows of one group that disagree settle nothing
  const settle = (list: V[]): boolean => {
    const groups = new Map<string, V[]>();
    for (const v of list) if (v.group) { const g = groups.get(v.group) || []; g.push(v); groups.set(v.group, g); }
    for (const g of groups.values()) {
      const rows = new Set(g.map((v) => v.hit));
      if (rows.size > 1 && g.some((v) => v.ok) && g.some((v) => !v.ok)) return false;
    }
    return list.length > 0;
  };
  for (const r of reqs) {
    const mine: V[] = [];
    for (const h of hits) {
      if (!near(clause, r.at, h.entries, subject)) continue;
      const around = clause.slice(Math.max(0, r.at - 60), r.at + r.m.raw.length + 10);
      if (r.m.unit === "%" && !sameMetric(around, h.label + " " + h.cells.join(" "))) continue;
      const perUnit = h.cells.map((c, i) => ({ unit: columns[i] || "unit " + (i + 1), got: comparable(c, r.m) })).filter((x) => x.got);
      if (!perUnit.length) continue;
      const prop = propertyOf(h.label + " " + clause.slice(Math.max(0, r.at - 80), r.at + 40), { family: familyOfUnit(r.m.unit), classed: false });
      for (const u of perUnit) {
        const { m, value: v, converted } = u.got!;
        const ok = r.op === ">=" ? v >= r.m.n - 1e-9 : r.op === "<=" ? v <= r.m.n + 1e-9 : r.op === "range" ? v >= (r.lo as number) - 1e-9 && v <= r.m.n + 1e-9 : true;
        const j = r.op === "=" ? judge(r.m.n, v, prop) : "equal";
        const equal = j === "equal";
        const sign = r.op === "=" ? (equal ? "=" : "≠") : r.op === "range" ? (ok ? "within" : "outside") : ok ? (r.op === ">=" ? "≥" : "≤") : (r.op === ">=" ? "<" : ">");
        const shown = converted ? `${m.raw} (${fmt(v)} ${r.m.unit})` : m.raw;
        const asked = r.op === "range" ? `${fmt(r.lo as number)} to ${r.m.raw}` : r.m.raw;
        const how = r.op === "=" && !equal && prop
          ? (j === "better" ? `, better for ${prop.name}` : j === "worse" ? `, worse for ${prop.name}` : `, ${prop.name} must match`) : "";
        mine.push({ ok, equal, op: r.op, worse: j === "worse" || j === "differs", group: h.group || "", hit: h, m,
          text: `${shown} ${sign} ${asked}${r.op === "=" ? " asked" : " required"}${how} (${where(h, u.unit, perUnit.length > 1)})` } as V & { m: Measure });
      }
    }
    if (!settle(mine)) { open++; continue; }
    for (const v of mine) { all.push(v); if (!used.includes(v.hit)) used.push(v.hit); vals.push((v as V & { m: Measure }).m); }
  }
  for (const c of classes) {
    const mine: V[] = [];
    for (const h of hits) {
      const perUnit = h.cells.map((cell, i) => ({ unit: columns[i] || "unit " + (i + 1), cls: classIn(cell, c.prop) })).filter((x) => x.cls);
      for (const u of perUnit) {
        const j = compareClass(c.cls, u.cls!, c.prop);
        if (!j) continue;
        const ok = j !== "worse";
        mine.push({ ok, equal: j === "equal", op: ">=", worse: !ok, group: h.group || "", hit: h,
          text: `${u.cls} ${j === "equal" ? "=" : ok ? "better than" : "worse than"} ${c.cls} required on the ${c.prop.name} scale (${where(h, u.unit, perUnit.length > 1)})` });
      }
    }
    if (!settle(mine)) { open++; continue; }
    for (const v of mine) { all.push(v); if (!used.includes(v.hit)) used.push(v.hit); }
  }
  if (!all.length) return null;
  const broken = all.filter((v) => !v.ok);
  // a figure asked "as is" (no minimum or maximum) that the unit does not have exactly: met, with a remark
  const differs = all.filter((v) => v.op === "=" && !v.equal);
  // a part of the clause no row settled: no Comply by code (a broken part still makes it Not Comply)
  if (open && !broken.length) return null;
  const compliance = broken.length ? "Not Comply" : differs.length ? "Comply with Remarks" : "Comply";
  const offered = used.map((h) => h.value).filter(Boolean).join("; ");
  const remarks = compliance === "Comply" ? "" : offered;
  const shown = (broken.length ? broken : differs.length ? differs : all).slice(0, 4).map((v) => v.text);
  const confidence: Comparison["confidence"] = !broken.length && differs.some((v) => v.worse) ? "low" : compliance === "Comply with Remarks" ? "medium" : "high";
  return { compliance, remarks, rows: used, values: vals, confidence,
           reason: `From the datasheet: ${shown.join("; ")}${all.length > 4 ? " …" : ""}.` + (compliance === "Comply" && offered ? ` Offered: ${offered}.` : "") +
             (open ? ` ${open} other part${open === 1 ? "" : "s"} of the clause not on the datasheet.` : "") +
             (confidence === "low" ? " The offer is below what is asked: check before it goes out." : "") };
}

/* The library's answer for this clause states a value this project's datasheet contradicts. */
export function libraryConflict(libRemarks: string, cmp: Comparison | null): string {
  if (!cmp) return "";
  const lib = measurements(libRemarks);
  if (!lib.length) return "";
  const mine = cmp.values;
  const clash = lib.find((l) => mine.some((m) => m.unit === l.unit) && !mine.some((m) => m.unit === l.unit && Math.abs(m.n - l.n) < 1e-9));
  if (!clash) return "";
  const ds = mine.find((m) => m.unit === clash.unit)!;
  return `The library answer says ${clash.raw}; this project's datasheet has ${ds.raw}.`;
}

/* ---------- 4. earlier answers ---------- */

export function recordAnswer(ctx: Context, x: RunRowFull): PastAnswer | null {
  if (!ctx.recordIndex) ctx.recordIndex = new GramIndex(ctx.rows.filter((r) => !r.ai_draft && (r.compliance || r.remarks)), (r) => r.spec_text);
  const hit = ctx.recordIndex.search(x.spec_text, 0.92, 1, (r) => r.seq === x.seq)[0];
  if (!hit) return null;
  const r = hit.item;
  return { spec: r.spec_text, compliance: r.compliance, remarks: r.remarks, by: ctx.names.get(r.answered_by || "") || "", score: hit.score, where: r.sr || "row " + r.seq, pending: false };
}

/* Up to 5 answers people gave earlier in the same section of this record: the model keeps to them. */
export function sectionAnswers(ctx: Context, x: RunRowFull): string[] {
  const sec = ctx.place.get(x.seq)?.section || "";
  return ctx.rows.filter((r) => r.seq < x.seq && !r.ai_draft && (r.compliance || r.remarks) && (ctx.place.get(r.seq)?.section || "") === sec)
    .slice(-5).map((r) => `${r.sr || "-"} ${r.spec_text.slice(0, 160)} -> ${r.compliance}${r.remarks ? " | " + r.remarks.slice(0, 160) : ""}`);
}

export function projectAnswers(ctx: Context, x: RunRowFull, k = 2): PastAnswer[] {
  if (cmNorm(x.spec_text).length < 12) return [];
  if (!ctx.projectIndex) ctx.projectIndex = new GramIndex(ctx.project, (p) => p.spec);
  return ctx.projectIndex.search(x.spec_text, 0.5, k).map((h) => ({ ...h.item, score: h.score, by: ctx.names.get(h.item.by) || "" }));
}

/* Up to 3 corrections people made on clauses like this one (the most similar first). */
export function correctionsFor(ctx: Context, x: RunRowFull, k = 3): Correction[] {
  if (!ctx.corrections.length || cmNorm(x.spec_text).length < 12) return [];
  if (!ctx.correctionIndex) ctx.correctionIndex = new GramIndex(ctx.corrections, (c) => c.spec);
  const seen = new Set<string>();
  return ctx.correctionIndex.search(x.spec_text, 0.55, k * 3).map((h) => ({ ...h.item, score: h.score }))
    .filter((c) => { const key = cmNorm(c.spec) + "|" + c.final; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, k);
}

/* AI notes of the Options tree: those of the rows this clause matched, plus any whose words the clause shares. */
export function notesFor(ctx: Context, x: RunRowFull): string[] {
  const own = ctx.options.get(x.seq)?.ai || [];
  const extra = notesMatching(ctx.aiNotes, x.spec_text, ctx.place.get(x.seq)?.section || "").filter((t) => !own.includes(t));
  return [...own, ...extra].slice(0, 6);
}

/* Everything the decision for one clause needs. */
export interface ClauseEvidence {
  part: number; section: string; parent: string; sheet: SheetHit[]; cmp: Comparison | null; conflict: string;
  options: OptionInfo; notes: string[]; knowledge: string[]; record: PastAnswer | null; inSection: string[]; project: PastAnswer[];
  similar: Similar[]; rules: RuleHit[]; facts: RuleHit[]; direct: RuleHit | null; clauseRules: string[];
  sectionKind: SectionInfo | null; absent: string[]; corrections: Correction[];
}
export async function evidenceFor(ctx: Context, x: RunRowFull): Promise<ClauseEvidence> {
  const pl = ctx.place.get(x.seq) || { part: 0, section: "" };
  const parent = parentOf(ctx.rows.map((r) => ({ seq: r.seq, type: r.type, sr: r.sr, spec: r.spec_text })), x.seq);
  const kind = ctx.kinds.get(sectionKey(pl.section)) || null;
  // a site-works or standards section is not answered from a figure on the unit
  const sheet = kind && kind.kind !== "product" ? [] : ctx.sheet.get(x.seq) || [];
  const cmp = compareDatasheet(x.spec_text, sheet, ctx.columns, subjectOf(parent));
  const conflict = x.l_status === "answered" ? libraryConflict(x.l_remarks || "", cmp) : "";
  const picked = pickRules(ctx.rules, x.spec_text + " " + parent, pl.section, pl.part);
  const clauseRules = splitComments(x.l_comments).rules;
  return {
    part: pl.part, section: pl.section, parent, sheet, cmp, conflict,
    options: ctx.options.get(x.seq) || { values: [], specials: [], notes: [], ai: [] }, notes: notesFor(ctx, x),
    knowledge: knowledgeMatching(ctx.knowledge, x.spec_text, ctx.place.get(x.seq)?.section || ""),
    record: recordAnswer(ctx, x), inSection: sectionAnswers(ctx, x), project: projectAnswers(ctx, x),
    similar: await ctx.search.similar(ctx.run.factory_id, x.spec_text, 5, x.line_id),
    rules: picked.rules, facts: picked.facts, direct: clauseRules.length ? null : directRule(picked.rules), clauseRules,
    sectionKind: kind, absent: ctx.absent.get(x.seq) || [], corrections: correctionsFor(ctx, x)
  };
}
