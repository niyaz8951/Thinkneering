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
import { classRequirements, comparable, propertyOf, judge, fmt, familyOfUnit, classIn, compareClass } from "./compare";
import { ClauseSearch, GramIndex, lexicalScore, type Similar } from "./search";
import { aiMapFor, type AiSettings, type Section } from "./map";
import { pickRules, directRule, splitComments, parentOf, unitValues, notesMatching, prepareKnowledge, knowledgeMatching, type KnowledgeIndexed, type AiRule, type RuleHit } from "./rules";
import type { AiUsage } from "./models";

export interface RunInfo { id: string; product_id: string; factory_id: string; project_id: string | null; product: string; factory: string }
export interface RunRowFull {
  seq: number; type: string; sr: string; spec_text: string; line_id: string | null; compliance: string; remarks: string; ai_draft: number;
  answered_by: string | null; l_status: string | null; l_compliance: string | null; l_remarks: string | null; l_comments: string | null;
}
export interface SheetHit { key: string; section: string; component: string; label: string; cells: string[]; value: string; entries: string[][] }
export interface OptionInfo { values: string[]; specials: string[]; notes: string[]; ai: string[] }
export interface PastAnswer { spec: string; compliance: string; remarks: string; by: string; score: number; where: string; pending: boolean }
export interface Comparison { compliance: string; remarks: string; reason: string; rows: SheetHit[]; values: Measure[]; confidence: "high" | "medium" | "low" }

export interface Context {
  run: RunInfo; rows: RunRowFull[]; place: Map<number, { part: number; section: string }>;
  columns: string[]; sheet: Map<number, SheetHit[]>; options: Map<number, OptionInfo>; aiNotes: { section: string; key: string; body: string }[];
  rules: AiRule[]; settings: AiSettings; instructions: Section[] | null; knowledge: KnowledgeIndexed[]; search: ClauseSearch; project: PastAnswer[]; names: Map<string, string>;
  projectIndex?: GramIndex<PastAnswer>; recordIndex?: GramIndex<RunRowFull>;
  kinds: Map<string, SectionInfo>;          // what kind of question each section asks (sections.ts)
  absent: Map<number, string[]>;            // unit sections a clause is about that this project's datasheet does not have
}

const OPS_MIN = /(minimum|min\.?|not less than|no less than|at least|not lower than|shall exceed|greater than|more than|≥|>=)\s*$/i;
const OPS_MAX = /(maximum|max\.?|not exceed(?:ing)?|not more than|no more than|not greater than|up to|less than|below|≤|<=|limited to)\s*$/i;
const AFTER_MIN = /^\s*(or more|or greater|or higher|or above|minimum|min\b|or better)/i;
const AFTER_MAX = /^\s*(or less|or lower|maximum|max\b|or below)/i;

/* ---------- loading (once per request) ---------- */

export async function loadContext(env: Env, run: RunInfo, rows: RunRowFull[], usage?: AiUsage): Promise<Context> {
  const specRows = rows.map((x) => ({ seq: x.seq, type: x.type, sr: x.sr, spec: x.spec_text }));
  const place = placeRows(specRows);
  type MapRow = MapRule & { row_key: string };
  const [mapRes, notesRes, valRes, extraRes, projRes] = await env.DB.batch([
    env.DB.prepare("SELECT row_key, section, sub, component, show, label, keywords, strip, response FROM dn_map WHERE product_id = ? ORDER BY sort, row_key").bind(run.product_id),
    env.DB.prepare("SELECT columns, file_key FROM pr_notes WHERE project_id = ? AND product_id = ? ORDER BY created_at").bind(run.project_id || "", run.product_id),
    env.DB.prepare("SELECT row_key, value, times FROM po_values WHERE factory_id = ? AND hidden = 0 ORDER BY times DESC").bind(run.factory_id),
    env.DB.prepare("SELECT section, row_key, kind, body FROM po_extras WHERE factory_id = ? ORDER BY created_at").bind(run.factory_id),
    // other projects' answers of this factory, by people (newest first; the cap keeps the work small)
    env.DB.prepare(`SELECT rl.spec_text, rl.compliance, rl.remarks, rl.answered_by, rl.review, p.name AS project
                      FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id LEFT JOIN pr_projects p ON p.id = r.project_id
                     WHERE r.factory_id = ? AND rl.run_id <> ? AND rl.ai_draft = 0 AND rl.line_id IS NOT NULL AND (rl.compliance <> '' OR rl.remarks <> '')
                     ORDER BY rl.answered_at DESC LIMIT 400`).bind(run.factory_id, run.id)
  ]);
  const rules = (mapRes.results as unknown as MapRow[]).map((r) => ({ ...r, key: r.row_key }));
  // the project's saved datasheet tables of this product (R2)
  const tables: NoteTable[] = [];
  for (const n of notesRes.results as unknown as { columns: string; file_key: string }[]) {
    try {
      const obj = n.file_key && env.FILES ? await env.FILES.get(n.file_key) : null;
      if (!obj) continue;
      const data = (await obj.json()) as { rows?: NoteTable["rows"] };
      tables.push({ columns: (JSON.parse(n.columns || "[]") as unknown[]).map((c) => String(c ?? "")), rows: Array.isArray(data?.rows) ? data.rows : [] });
    } catch (e) { console.warn("datasheet table could not be read", e); }
  }
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
  const matched = await matchFor(env, run.id, specRows, rules);
  for (const m of matched) {
    if (!m.found) continue;
    const cells = look.values({ key: m.key, section: m.section, component: m.rule.component });
    const hit: SheetHit = { key: m.key, section: m.section, component: m.component, label: `${m.section} • ${m.component}`, cells, value: unitValues(cells, look.columns), entries: m.entries };
    const ex = extras.filter((x) => (x.row_key === m.key) || (x.row_key === "" && x.section.toLowerCase() === m.section.toLowerCase()));
    const missing = tables.length > 0 && present.size > 0 && !present.has(sectionName(m.section));
    for (const seq of m.seqs) {
      if (hasValue(cells)) { const l = sheet.get(seq) || []; l.push(hit); sheet.set(seq, l); }
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
  return { run, rows, place: pl, columns: look.columns, sheet, options, aiNotes, rules: ai.rules, settings: ai.settings, instructions: ai.instructions, knowledge: prepareKnowledge(ai.knowledge),
           search: new ClauseSearch(env, usage), project, names, kinds, absent };
}

/* ---------- the match, worked out once per record ---------- */

interface Matched { key: string; section: string; component: string; found: boolean; seqs: number[]; entries: string[][]; rule: MapRule }
const matchMemo = new Map<string, { stamp: string; byKey: Record<string, number[]> }>();

async function matchFor(env: Env, runId: string, specRows: { seq: number; type: string; sr: string; spec: string }[], rules: MapRule[]): Promise<Matched[]> {
  const stamp = (await sha256(JSON.stringify([specRows.map((r) => [r.seq, r.type, r.sr, r.spec]), rules.map((r) => [r.key, r.section, r.component, r.label, r.show, r.keywords])]))).slice(0, 24);
  let byKey: Record<string, number[]> | null = null;
  const mem = matchMemo.get(runId);
  if (mem && mem.stamp === stamp) byKey = mem.byKey;
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
  if (matchMemo.size > 200) matchMemo.clear();
  matchMemo.set(runId, { stamp, byKey });
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

/* The requirement a number in the clause states: its operator from the words just before or after it. */
export function requirements(clause: string): { m: Measure; op: ">=" | "<=" | "="; at: number }[] {
  const out: { m: Measure; op: ">=" | "<=" | "="; at: number }[] = [];
  let from = 0;
  for (const m of measurements(clause)) {
    const at = clause.indexOf(m.raw, from); if (at < 0) continue; from = at + m.raw.length;
    const before = clause.slice(Math.max(0, at - 40), at), after = clause.slice(at + m.raw.length, at + m.raw.length + 25);
    const op = OPS_MIN.test(before) || AFTER_MIN.test(after) ? ">=" : OPS_MAX.test(before) || AFTER_MAX.test(after) ? "<=" : "=";
    out.push({ m, op, at });
  }
  return out;
}

/* The datasheet rows tell this clause's number only when a word of the row's keywords stands near the number:
   "screw spacing not greater than 225 mm" is not answered by the panel skin thickness found in the same clause. */
function near(clause: string, at: number, entries: string[][]): boolean {
  const toks = tokensWithPos(clause);
  const k = toks.findIndex((t) => t.at >= at);
  if (k < 0) return false;
  const lo = Math.max(0, k - 8), hi = Math.min(toks.length, k + 8);
  const keys = entries.flat().filter((w) => w.length >= 3 && !/^\d/.test(w));
  for (let j = lo; j < hi; j++) if (keys.some((w) => toks[j].w.startsWith(w))) return true;
  return false;
}

/* The clause's figures and classes against the datasheet rows next to it (Thinkneering v3 comparison, compare.ts):
   - a figure with "minimum" / "maximum" wording is a limit: met = Comply, broken = Not Comply
   - a figure asked "as is" that the unit does not have exactly = Comply with Remarks stating the offer (owner's
     rule, 16 Oct 2026); the property's direction says whether the offer is better or worse, and a worse one is
     low confidence, so a person looks at it before it goes out
   - a class (TB2, L1, D1, F7) is a minimum on its published scale: a better or equal class = Comply, a worse = Not Comply
   - figures in another unit are converted to the clause's (l/s and cfm, Pa and in. wg, kW and TR, °C and °F ...) */
export function compareDatasheet(clause: string, hits: SheetHit[], columns: string[]): Comparison | null {
  const reqs = requirements(clause), classes = classRequirements(clause);
  if ((!reqs.length && !classes.length) || !hits.length) return null;
  const used: SheetHit[] = []; const vals: Measure[] = [];
  const verdicts: { ok: boolean; equal: boolean; op: string; worse: boolean; text: string }[] = [];
  const where = (h: SheetHit, unit: string, many: boolean) => many || columns.length > 1 ? unit : h.component;
  for (const r of reqs) {
    for (const h of hits) {
      if (!near(clause, r.at, h.entries)) continue;
      const perUnit = h.cells.map((c, i) => ({ unit: columns[i] || "unit " + (i + 1), got: comparable(c, r.m) })).filter((x) => x.got);
      if (!perUnit.length) continue;
      if (!used.includes(h)) used.push(h);
      const prop = propertyOf(h.label + " " + clause.slice(Math.max(0, r.at - 80), r.at + 40), { family: familyOfUnit(r.m.unit), classed: false });
      for (const u of perUnit) {
        const { m, value: v, converted } = u.got!; vals.push(m);
        const ok = r.op === ">=" ? v >= r.m.n - 1e-9 : r.op === "<=" ? v <= r.m.n + 1e-9 : true;
        const j = r.op === "=" ? judge(r.m.n, v, prop) : "equal";
        const equal = j === "equal";
        const sign = r.op === "=" ? (equal ? "=" : "≠") : ok ? (r.op === ">=" ? "≥" : "≤") : (r.op === ">=" ? "<" : ">");
        const shown = converted ? `${m.raw} (${fmt(v)} ${r.m.unit})` : m.raw;
        const how = r.op === "=" && !equal && prop
          ? (j === "better" ? `, better for ${prop.name}` : j === "worse" ? `, worse for ${prop.name}` : `, ${prop.name} must match`) : "";
        verdicts.push({ ok, equal, op: r.op, worse: j === "worse" || j === "differs",
          text: `${shown} ${sign} ${r.m.raw}${r.op === "=" ? " asked" : " required"}${how} (${where(h, u.unit, perUnit.length > 1)})` });
      }
    }
  }
  for (const c of classes) {
    for (const h of hits) {
      const perUnit = h.cells.map((cell, i) => ({ unit: columns[i] || "unit " + (i + 1), cls: classIn(cell, c.prop) })).filter((x) => x.cls);
      if (!perUnit.length) continue;
      if (!used.includes(h)) used.push(h);
      for (const u of perUnit) {
        const j = compareClass(c.cls, u.cls!, c.prop);
        if (!j) continue;
        const ok = j !== "worse";
        verdicts.push({ ok, equal: j === "equal", op: ">=", worse: !ok,
          text: `${u.cls} ${j === "equal" ? "=" : ok ? "better than" : "worse than"} ${c.cls} required on the ${c.prop.name} scale (${where(h, u.unit, perUnit.length > 1)})` });
      }
    }
  }
  if (!verdicts.length) return null;
  const broken = verdicts.filter((v) => !v.ok);
  // a number asked "as is" (no minimum or maximum) that the unit does not have exactly: met, with a remark
  const differs = verdicts.filter((v) => v.op === "=" && !v.equal);
  const compliance = broken.length ? "Not Comply" : differs.length ? "Comply with Remarks" : "Comply";
  const remarks = used.map((h) => h.value).filter(Boolean).join("; ");
  const shown = (broken.length ? broken : differs.length ? differs : verdicts).slice(0, 4).map((v) => v.text);
  const confidence: Comparison["confidence"] = !broken.length && differs.some((v) => v.worse) ? "low" : compliance === "Comply with Remarks" ? "medium" : "high";
  return { compliance, remarks, rows: used, values: vals, confidence,
           reason: `From the datasheet: ${shown.join("; ")}${verdicts.length > 4 ? " …" : ""}.` +
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
  similar: Similar[]; rules: RuleHit[]; direct: RuleHit | null; clauseRules: string[];
  sectionKind: SectionInfo | null; absent: string[];
}
export async function evidenceFor(ctx: Context, x: RunRowFull): Promise<ClauseEvidence> {
  const pl = ctx.place.get(x.seq) || { part: 0, section: "" };
  const parent = parentOf(ctx.rows.map((r) => ({ seq: r.seq, type: r.type, sr: r.sr, spec: r.spec_text })), x.seq);
  const kind = ctx.kinds.get(sectionKey(pl.section)) || null;
  // a site-works or standards section is not answered from a figure on the unit
  const sheet = kind && kind.kind !== "product" ? [] : ctx.sheet.get(x.seq) || [];
  const cmp = compareDatasheet(x.spec_text, sheet, ctx.columns);
  const conflict = x.l_status === "answered" ? libraryConflict(x.l_remarks || "", cmp) : "";
  const picked = pickRules(ctx.rules, x.spec_text + " " + parent, pl.section, pl.part);
  const clauseRules = splitComments(x.l_comments).rules;
  return {
    part: pl.part, section: pl.section, parent, sheet, cmp, conflict,
    options: ctx.options.get(x.seq) || { values: [], specials: [], notes: [], ai: [] }, notes: notesFor(ctx, x),
    knowledge: knowledgeMatching(ctx.knowledge, x.spec_text, ctx.place.get(x.seq)?.section || ""),
    record: recordAnswer(ctx, x), inSection: sectionAnswers(ctx, x), project: projectAnswers(ctx, x),
    similar: await ctx.search.similar(ctx.run.factory_id, x.spec_text, 5, x.line_id),
    rules: picked.rules, direct: clauseRules.length ? null : directRule(picked.rules), clauseRules,
    sectionKind: kind, absent: ctx.absent.get(x.seq) || []
  };
}
