/* What the AI review knows besides the library, chosen per clause. Pure functions, unit-tested in
   tests/worker/ai-rules.test.ts. No model, no database here.

   1. Clause rules: in a library clause's Internal Comments, text before the first "#" is the note for users,
      every "#" starts an AI rule for that clause (splitComments).
   2. Site rules and facts: rows of ai_rules, written in Compliance review > AI rules per product, for every
      factory or one. A rule or fact applies to a clause that mentions one of its keywords (pickRules).
      A rule with a fixed answer AND a fixed remark is applied by code without the model (directRule).
   3. Datasheet rows: the project's datasheet table (Datasheet Notes, saved in the project), the rows that
      concern the clause, gated by section so a casing clause never gets the coil's tube thickness
      (pickDatasheetRows; the idea and the gate come from the first AI tool, ai-suggest.js). */
import { cmNorm } from "../lib/cm";

/* ---------- words ---------- */

/* Words for the same subject in specification English (not product knowledge: any factory, any product).
   Used to widen a one-word keyword and a clause's words when choosing datasheet rows. Kept narrow on purpose:
   "panel" is not "control panel". */
export const TERM_GROUPS: string[][] = [
  ["casing", "panel", "panels", "skin", "enclosure", "cabinet", "housing"],
  ["thickness", "thick"],
  ["insulation", "insulated", "insulating"],
  ["filter", "filters", "filtration"],
  ["fan", "fans", "blower", "impeller"],
  ["motor", "motors"],
  ["coil", "coils"],
  ["damper", "dampers"],
  ["leakage", "leak", "tightness", "airtight"],
  ["sound", "noise", "acoustic", "acoustics"],
  ["drain", "tray", "pan"],
  ["frame", "framework", "profile", "base"],
  ["humidifier", "humidification"],
  ["recovery", "wheel", "recuperator"],
  ["vfd", "inverter", "drive"],
  ["commissioning", "commission", "start", "startup"]
];

export function wordsOf(text: unknown): string[] {
  return cmNorm(text).replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").split(" ").filter(Boolean);
}

function groupOf(w: string): string[] | null {
  for (const g of TERM_GROUPS) if (g.includes(w)) return g;
  return null;
}

/* one keyword word against one clause word: same word, a longer form ("install" -> "installation"),
   or the same subject in TERM_GROUPS */
function wordHits(key: string, word: string): boolean {
  if (key === word) return true;
  if (key.length >= 4 && word.startsWith(key)) return true;
  const g = groupOf(key);
  return !!g && g.includes(word);
}

/* ---------- 1. clause rules in Internal Comments ---------- */

export function splitComments(comments: string | null | undefined): { note: string; rules: string[] } {
  const parts = String(comments ?? "").split("#");
  return { note: parts[0].trim(), rules: parts.slice(1).map((r) => r.trim()).filter((r) => r.length > 0) };
}

/* What a person without "Can edit" on the library sees of Internal Comments: the note only. */
export function noteOnly(comments: string | null | undefined): string {
  return splitComments(comments).note;
}

/* ---------- 2. site rules and facts ---------- */

export interface AiRule {
  id: string; product_id: string; factory_id: string | null; kind: "rule" | "fact"; title: string;
  keywords: string; part: number; instruction: string; answer: string; remark: string; active: number; sort: number;
  sections?: string;                 // "references, codes and standards": the clause's section title must mention one
  source?: string;                   // where the rule was written (the AI map branch path), for the reason line
}
export interface RuleHit { rule: AiRule; score: number; matched: string[] }

/* "install, rigging , start-up" -> [["install"], ["rigging"], ["start", "up"]] */
export function keywordList(keywords: string): string[][] {
  return String(keywords || "").split(/[,;\n]+/).map((k) => wordsOf(k)).filter((k) => k.length > 0);
}

/* Does the phrase occur in the clause, word after word? */
function phraseIn(phrase: string[], words: string[]): boolean {
  for (let i = 0; i + phrase.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length && ok; j++) ok = phrase.length === 1 ? wordHits(phrase[j], words[i + j]) : (phrase[j] === words[i + j] || (phrase[j].length >= 4 && words[i + j].startsWith(phrase[j])));
    if (ok) return true;
  }
  return false;
}

/* The rule's verdict on one clause: null when it does not apply. A rule without keywords applies to every
   clause of its Part (score 0, so a rule with keywords that hit always comes first). */
export function ruleHit(rule: AiRule, clause: string, section: string, part: number): RuleHit | null {
  if (!rule.active) return null;
  if (rule.part && part && rule.part !== part) return null;
  if (rule.part && !part) return null;                    // a Part rule needs a clause whose Part is known
  const secs = keywordList(rule.sections || "");
  let secHit: string[] = [];
  if (secs.length) {
    const sw = wordsOf(section);
    secHit = secs.filter((k) => phraseIn(k, sw)).map((k) => k.join(" "));
    if (!secHit.length) return null;
  }
  const keys = keywordList(rule.keywords);
  if (!keys.length) return { rule, score: secHit.length ? 1 : 0, matched: secHit.map((k) => "section " + k) };
  const words = wordsOf(clause + " " + section);
  const matched = keys.filter((k) => phraseIn(k, words)).map((k) => k.join(" "));
  if (!matched.length) return null;
  return { rule, score: matched.reduce((s, k) => s + k.split(" ").length, 0) + (secHit.length ? 1 : 0), matched: [...secHit.map((k) => "section " + k), ...matched] };
}

/* The rules and facts for one clause, best first: more keywords hit, then this factory's own before the
   product's, then the editor's order. At most `max` of each kind, so the prompt stays short. */
export function pickRules(rules: AiRule[], clause: string, section: string, part: number, max = 5): { rules: RuleHit[]; facts: RuleHit[] } {
  const hits = rules.map((r) => ruleHit(r, clause, section, part)).filter((h): h is RuleHit => !!h);
  hits.sort((a, b) => (b.score - a.score) || ((b.rule.factory_id ? 1 : 0) - (a.rule.factory_id ? 1 : 0)) || (a.rule.sort - b.rule.sort) || a.rule.title.localeCompare(b.rule.title));
  return { rules: hits.filter((h) => h.rule.kind === "rule").slice(0, max), facts: hits.filter((h) => h.rule.kind === "fact").slice(0, max) };
}

/* A rule that answers by itself: kind rule, a fixed answer and a fixed remark. When the best two of them
   disagree on the answer at the same score, none is applied (the model sees both). */
export function directRule(hits: RuleHit[]): RuleHit | null {
  const fixed = hits.filter((h) => h.rule.kind === "rule" && h.rule.answer && h.rule.remark);
  if (!fixed.length) return null;
  const [a, b] = fixed;
  if (b && b.score === a.score && b.rule.answer !== a.rule.answer && !!b.rule.factory_id === !!a.rule.factory_id) return null;
  return a;
}

/* ---------- 3. datasheet rows ---------- */

export interface DatasheetRow { section?: string; component?: string; cells?: unknown[]; kind?: string; key?: string }
export interface DatasheetField { label: string; value: string; key: string }

/* The note's rows as "Section • Component" = "value per unit". Section names are carried down to the
   rows under them (the table shows them once); sub-heading rows are left out. */
export function datasheetFields(rows: DatasheetRow[], units: string[]): DatasheetField[] {
  const out: DatasheetField[] = [];
  let section = "";
  for (const r of rows) {
    if (r && r.section) section = String(r.section).trim();
    if (!r || (r.kind && r.kind !== "row")) continue;
    const cells = (Array.isArray(r.cells) ? r.cells : []).map((c) => String(c ?? "").trim());
    const label = [section, String(r.component || "").trim()].filter(Boolean).join(" • ");
    const value = unitValues(cells, units);
    if (label && value) out.push({ label: label.slice(0, 120), value: value.slice(0, 300), key: String(r.key || "") });
  }
  return out;
}

/* one value when every unit agrees; otherwise "62 mm (FAHU-01, FAHU-02), 50 mm (FAHU-03)" */
export function unitValues(cells: string[], units: string[]): string {
  const by = new Map<string, string[]>();
  cells.forEach((c, i) => { if (c && c !== "-") { const k = c; if (!by.has(k)) by.set(k, []); by.get(k)!.push(units[i] || "unit " + (i + 1)); } });
  if (!by.size) return "";
  if (by.size === 1) return [...by.keys()][0];
  return [...by.entries()].map(([v, u]) => `${v} (${u.join(", ")})`).join(", ");
}

/* A field belongs to a clause only if the clause is about the field's section: a casing-thickness clause must
   not be answered with the cooling coil's tube thickness. Fields of the whole unit always qualify. */
function sectionApplies(clauseWords: Set<string>, label: string): boolean {
  const sec = label.split("•").length > 1 ? label.split("•")[0] : "";
  const sw = wordsOf(sec).filter((w) => !["supply", "return", "section", "data", "the", "and"].includes(w) && w.length > 2);
  if (!sw.length || /^(unit|general|ahu|summary)/.test(sec.trim().toLowerCase())) return true;
  return sw.some((w) => clauseWords.has(w) || (groupOf(w) || []).some((x) => clauseWords.has(x)));
}

/* The datasheet fields that concern this clause, best first (word overlap, synonyms included). */
export function pickDatasheetRows(fields: DatasheetField[], clause: string, section: string, limit = 4): DatasheetField[] {
  const base = wordsOf(clause + " " + section).filter((w) => w.length > 2);
  const want = new Set<string>(base);
  base.forEach((w) => (groupOf(w) || []).forEach((x) => want.add(x)));
  return fields
    .filter((f) => sectionApplies(want, f.label))
    .map((f) => {
      const fw = wordsOf(f.label + " " + f.value).filter((w) => w.length > 2 && !/^\d/.test(w));
      let hits = 0;
      for (const w of fw) if (want.has(w)) hits++;
      return { f, score: fw.length ? hits / Math.sqrt(fw.length) : 0 };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}

/* ---------- 4. the clause a list item belongs to ---------- */

/* "1. Cooling coil section." under "B. The unit shall include the following:" is read with its parent. A
   numbered item takes the nearest lettered clause before it; a lettered sub-item ("a.") the nearest numbered
   one; within the same section only. */
export interface ParentRow { seq: number; type: string; sr: string; spec: string }
export function parentOf(rows: ParentRow[], seq: number): string {
  const i = rows.findIndex((r) => r.seq === seq);
  if (i < 0) return "";
  const me = rows[i];
  const lvl = level(me.sr);
  if (lvl < 2) return "";
  for (let j = i - 1; j >= 0 && j >= i - 40; j--) {
    const r = rows[j];
    if (r.type === "section" || r.type === "part") return "";
    const l = level(r.sr);
    if (l > 0 && l < lvl) return r.spec.trim().slice(0, 600);
  }
  return "";
}
/* A. = 1, 1. = 2, a. = 3, (1) / i. = 4, anything else 0 */
function level(sr: string): number {
  const s = String(sr || "").trim();
  if (/^[A-Z][.)]$/.test(s)) return 1;
  if (/^\d{1,2}[.)]$/.test(s)) return 2;
  if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)[.)]$/.test(s)) return 4;
  if (/^[a-z][.)]$/.test(s)) return 3;
  if (/^\(\w{1,3}\)$/.test(s)) return 4;
  return 0;
}

/* ---------- 5. AI notes that share telling words with a clause ---------- */

/* Words every specification uses everywhere: they never tie a note to a clause. */
const NOTE_COMMON = new Set(["shall", "section", "sections", "general", "provide", "provided", "providing", "unit", "units", "with", "this", "that",
  "from", "each", "such", "other", "where", "which", "include", "including", "includes", "requirements", "required", "manufacturer", "standard",
  "accordance", "specified", "equipment", "contract", "work", "item", "items", "following", "type", "minimum", "maximum"]);
export function tellingWords(text: string): Set<string> {
  return new Set(wordsOf(text).filter((w) => w.length > 3 && !NOTE_COMMON.has(w) && !/^\d/.test(w)));
}
/* AI notes (Options tree) for a clause: those sharing at least two telling words, most shared first. */
export function notesMatching(notes: { section: string; body: string }[], clause: string, section: string, k = 3): string[] {
  const words = tellingWords(clause + " " + section);
  return notes.map((n) => { let c = 0; for (const w of tellingWords(n.body + " " + n.section)) if (words.has(w)) c++; return { t: `${n.section}: ${n.body}`, c }; })
    .filter((z) => z.c >= 2).sort((a, b) => b.c - a.c).slice(0, k).map((z) => z.t);
}


/* Branches of the knowledge maps for a clause: the k sharing the most telling words (2 at least). The words of
   every branch are worked out once per record (prepareKnowledge). */
export interface KnowledgeIndexed { t: string; words: Set<string> }
export function prepareKnowledge(items: { map: string; path: string; text: string }[]): KnowledgeIndexed[] {
  return items.map((k) => ({ t: `${k.path}: ${k.text}`, words: tellingWords(k.path + " " + k.text) }));
}
export function knowledgeMatching(items: KnowledgeIndexed[], clause: string, section: string, k = 4): string[] {
  if (!items.length) return [];
  const words = tellingWords(clause + " " + section);
  const scored: { t: string; c: number }[] = [];
  for (const it of items) { let c = 0; for (const w of it.words) if (words.has(w)) c++; if (c >= 2) scored.push({ t: it.t, c }); }
  return scored.sort((a, b) => b.c - a.c).slice(0, k).map((z) => z.t.slice(0, 700));
}
