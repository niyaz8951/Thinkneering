/* The AI maps: maps in Maps, chosen by name in Compliance review > AI rules (ai_map_links). A map is of one of two
   kinds (mp_maps.kind, chosen when it is made): an AI rule book (below) or knowledge (process or product
   understanding: its verified branches are facts for the model, knowledgeOf). One of each for every factory of a
   product, and one of each per factory. A record of AHU / Riyadh reads the Riyadh map first, then the
   map for all AHU factories. The server reads them itself: people who run the review or use focus mode never
   need access to Maps; only the people who write the rules do.

     <any name, e.g. "AHU-Riyadh-AI notes">
     |-- Instructions           the AI's brief: every section (branch) is read by the model, in order, before it
     |                          answers; {product} and {factory} are filled in. A factory map's section with the same
     |                          title replaces the product map's; its other sections are added after.
     |-- Decision steps         the steps the AI goes through, in their fixed order; a step marked "to verify" is
     |                          skipped. Its special notes are settings ("Copy from library at: 0.90").
     |-- Settings               special notes "Name: value" (SETTINGS below); a factory map overrides the product map
     |-- Learned                rules the AI wrote from what people changed (ai/learn.ts), "to verify" until a person
     |                          verifies them; then they work like any rule
     |-- Part 1 General | Part 2 Products | Part 3 Execution | Any Part
     |   |-- <rule>             title = name; notes = what the AI should do; special notes:
     |       |-- <rule>           When: words or phrases (the clause mentions one)
     |                            Unless: words or phrases (the rule stays off a clause that mentions one)
     |                            Section: words or phrases (the section title mentions one)
     |                            Part: 1, 2 or 3 (for a rule outside a Part branch)
     |                            Answer: one of the six    Remark: the exact remark
     |-- any other branch       counts as "Any Part"

   A branch marked "to verify" is ignored with everything under it (the on / off switch). A branch passes its When
   and Section on to the branches under it unless they set their own. A branch with no notes and no answer only
   groups others. Answer + Remark = the rule answers matching clauses by itself, without the model. */
import type { Env } from "../env";
import { all, now, uuid } from "../lib/sql";
import { CHOICES, choiceOf } from "../lib/cm";
import type { AiRule } from "./rules";
import { isAhu, AHU_PART1, AHU_PART2, AHU_PART3, AHU_FACTS, FACTS_NOTES, factoryFacts } from "./template-ahu";

export interface AiSettings {
  copyAt: number; useModel: boolean; budget: number; suggest: boolean; datasheetWins: boolean; projectAnswers: boolean;
  unsourced: boolean;      // false (strict, the default): an answer that needs a source and cites none is not drafted
  model: string;           // "AI model:" small (default, 8B) | large (70B) | a Workers AI id; models.ts draftModel
  // the decision steps (Decision steps branch; a step "to verify" = off)
  useDatasheet: boolean; useOptions: boolean; useKnowledge: boolean; useLibrary: boolean; useRecord: boolean; useRules: boolean;
}
export const DEFAULT_SETTINGS: AiSettings = { copyAt: 0.9, useModel: true, budget: 9000, suggest: true, datasheetWins: true, projectAnswers: true, unsourced: false, model: "",
  useDatasheet: true, useOptions: true, useKnowledge: true, useLibrary: true, useRecord: true, useRules: true };

/* The decision steps, by what their title names (the order is fixed in draft.ts). */
const STEPS: { re: RegExp; key: keyof AiSettings; name: string }[] = [
  { re: /other projects?/i, key: "projectAnswers", name: "Other projects" },
  { re: /knowledge/i, key: "useKnowledge", name: "Knowledge maps" },
  { re: /datasheet/i, key: "useDatasheet", name: "Project datasheet" },
  { re: /product options|ai notes/i, key: "useOptions", name: "Product Options and AI notes" },
  { re: /library|compliance review/i, key: "useLibrary", name: "Library" },
  { re: /earlier|same clause|this record/i, key: "useRecord", name: "Earlier answers in the record" },
  { re: /\brules?\b|maps?\b/i, key: "useRules", name: "Map rules that answer by themselves" },
  { re: /\bmodel\b/i, key: "useModel", name: "AI model" }
];
export function stepOf(title: string): (typeof STEPS)[number] | null {
  if (/^how to|check/i.test(title.replace(/^\s*\d+[.)]\s*/, ""))) return null;
  return STEPS.find((x) => x.re.test(title)) || null;
}

const SETTINGS: { re: RegExp; set: (s: AiSettings, v: string) => boolean; line: (s: AiSettings) => string }[] = [
  { re: /^copy from (the )?library/i, set: (s, v) => { const n = parseFloat(v); if (!(n >= 0.5 && n <= 1)) return false; s.copyAt = n; return true; }, line: (s) => `Copy from library at: ${s.copyAt.toFixed(2)}` },
  { re: /^use the (ai )?model/i, set: (s, v) => { s.useModel = yes(v); return true; }, line: (s) => `Use the AI model: ${s.useModel ? "yes" : "no"}` },
  { re: /^daily (ai )?budget/i, set: (s, v) => { const n = parseInt(v.replace(/[^\d]/g, ""), 10); if (!(n >= 0)) return false; s.budget = n; return true; }, line: (s) => `Daily AI budget: ${s.budget} neurons` },
  { re: /^suggest in focus/i, set: (s, v) => { s.suggest = yes(v); return true; }, line: (s) => `Suggest in focus mode: ${s.suggest ? "yes" : "no"}` },
  { re: /^datasheet wins/i, set: (s, v) => { s.datasheetWins = yes(v); return true; }, line: (s) => `Datasheet wins over the library: ${s.datasheetWins ? "yes" : "no"}` },
  { re: /^use answers from other projects/i, set: (s, v) => { s.projectAnswers = yes(v); return true; }, line: (s) => `Use answers from other projects: ${s.projectAnswers ? "yes" : "no"}` },
  { re: /^answer without a source/i, set: (s, v) => { s.unsourced = yes(v); return true; }, line: (s) => `Answer without a source: ${s.unsourced ? "yes" : "no"}` },
  { re: /^ai model$/i, set: (s, v) => { const t = v.trim(); if (!/^(small|large|@(cf|hf)\/[\w.\-\/]{3,80})$/i.test(t)) return false; s.model = /^small$/i.test(t) ? "" : t; return true; }, line: (s) => `AI model: ${s.model || "small"}` }
];
function yes(v: string): boolean { return /^(y|yes|on|true|1)\b/i.test(v.trim()); }

/* "Name: value" lines into settings; lines that name nothing known, or a bad value, are reported. */
export function applySettings(base: AiSettings, lines: string[], problems: string[] = [], where = "Settings"): AiSettings {
  const s = { ...base };
  for (const l of lines) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(l);
    if (!m) continue;
    const def = SETTINGS.find((d) => d.re.test(m[1].trim()));
    if (!def) { problems.push(`${where}: "${m[1].trim()}" is not a setting the AI knows.`); continue; }
    if (!def.set(s, m[2])) problems.push(`${where}: "${l.trim()}" has a value the AI cannot use.`);
  }
  return s;
}
export function parseSettings(lines: string[]): AiSettings { return applySettings(DEFAULT_SETTINGS, lines); }

/* ---------- the Instructions: the AI's brief ---------- */

export interface Section { title: string; text: string }

/* The default brief (also what a new map gets). Owner's prompt of 16 Oct 2026, written for this tool: one clause at
   a time, the six answers of the site, the sources the site has. What may not change (the reply format, the six
   answers, the number check) stays in code (draft.ts, guard.ts). */
export const DEFAULT_INSTRUCTIONS: Section[] = [
  { title: "Role", text: "You are the compliance engine of the Application Team of Daikin Applied Products, {factory} factory, product line {product}. You answer a consultant's specification clause by clause; the answers go to MEP consultants under Daikin's name. Accuracy outranks speed and completeness. A wrong \"Comply\" is the worst possible failure. An answer left low confidence, or a [value] left open, is acceptable; an invented value is not." },
  { title: "Where values come from", text: "Use only these, strongest first:\n1. Project datasheet rows: the units selected for this project. They govern: never answer from a range value or a catalogue figure when the project's datasheet gives the value.\n2. Product Options and AI notes of this factory (what it offers, its standard build, special options, notes), and the knowledge maps (process and product understanding).\n3. AI rules of this map and of the clause (Internal Comments after #).\n4. Library answers of similar clauses, and the answers given earlier in this specification.\n5. Answers of other projects of this factory (not yet approved).\nNothing else. Your general knowledge of Daikin, HVAC products or standards is never a source for a value. Never estimate, interpolate or recall a value. When no source gives a value, write [value] where it belongs and set confidence \"low\": the reviewer sees it as to verify." },
  { title: "Library answers are a style reference", text: "Reuse the structure and the wording of a library answer (how a remark is phrased, how a deviation or a scope line is written), but take every value from this project's sources. Never copy values, model numbers or verdicts from another project or from a library answer that does not cover the same requirement." },
  { title: "Which answer", text: "- Comply: only when a source shows the offer meets or exceeds the requirement as written.\n- Comply with Remarks: the offer meets the intent but differs from the wording, a condition applies, or there is a genuine technical difference (what other sheets call a Deviation or \"Comply as noted\"). The remark states what is offered, in one sentence.\n- Not Comply: a stated requirement is genuinely not met, and a source shows it. Never soften a Not Comply into Comply with Remarks without an engineering basis; never write Not Comply from a guess.\n- Noted: a statement with nothing to comply with. Never a bare Noted on a clause that asks for something.\n- Not Applicable: the clause does not apply to this product or selection; say why in a few words.\n- In Contractor's Scope: site works (see Scope of supply)." },
  { title: "Equivalent standards", text: "When the clause asks for a standard the units are not certified to directly, but an AI note, a rule or a library answer names an equivalent standard with the same test scope and acceptance criteria (for example AMCA 500-D and EN 1751 for dampers), answer Comply, remark: \"Comply as equivalent per [our standard], which covers the same test scope and acceptance criteria as [specified standard].\" Only when a source names the equivalence." },
  { title: "Scope of supply", text: "Daikin's scope is supply of equipment (delivery as per contract). Every clause about site works is In Contractor's Scope, remark: \"By Contractor / others. Daikin scope is supply of equipment.\" Site works include installation, erection, rigging, lifting, offloading, site handling and storage, positioning, alignment, anchoring, site assembly of shipping sections, duct, pipe and electrical connections, site painting and touch-up, site testing, commissioning labour and attendance. They are mostly in Part 3, but apply this wherever they appear. Never Not Comply or a bare Noted for them. A clause that mixes supply and site work: answer the supply part in the remark and add that the site work is by the contractor." },
  { title: "Remark style: close, don't open", text: "Every remark closes the point: one definitive sentence, then stop.\n- State the offered value as a fact. Never name internal sources in the remark (datasheet, selection report, catalogue, library, notes, rules, file names); they belong in the reason. Name a document only when it is a certificate or test report attached to the submittal (for example a Eurovent or EN 1886 certificate).\n- No uncertain words: should, typically, we believe, approximately, likely, expected.\n- Nothing beyond what the clause asks. No promises of future submissions, tests or documents. No apologies, no alternatives.\n- The remark continues the answer; never start it with the answer's words." },
  { title: "When something is not clear", text: "Do not resolve ambiguous wording, an unreadable value, or a conflict between the clause and the schedule yourself. Answer what is certain, set confidence \"low\" and say in the reason what needs an engineer's judgement." },
  { title: "Parts and list items", text: "Part 1 (General) clauses are mostly Noted or In Contractor's Scope; Part 3 (Execution) mostly In Contractor's Scope or Noted; Part 2 (Products) describes the unit and needs a real answer. A clause with a parent clause is a list item continuing it: read them together." },
  { title: "Confidence", text: "\"high\" only when a rule, a datasheet row or a library answer covers the requirement directly; \"medium\" when the sources support it but not word for word; \"low\" when a value is open, the clause is unclear, or only general knowledge gives the kind of answer." }
];

function fill(t: string, product: string, factory: string): string { return t.replace(/\{product\}/gi, product).replace(/\{factory\}/gi, factory); }

/* The brief to give the model: the map's sections (factory map over product map), or the default. */
export function instructionsText(sections: Section[] | null, product: string, factory: string): string {
  const list = sections && sections.length ? sections : DEFAULT_INSTRUCTIONS;
  return list.map((x) => (x.title ? x.title.toUpperCase() + "\n" : "") + fill(x.text, product, factory)).join("\n\n");
}

export interface MapNode { id: string; parent_id: string | null; title: string; notes: string; special: string; sort: number; verified: number }
function specials(n: MapNode): string[] { try { const a = JSON.parse(n.special || "[]"); return Array.isArray(a) ? a.map((x) => String(x)) : []; } catch { return []; } }
function field(lines: string[], name: string): string | null {
  const re = new RegExp("^\\s*" + name + "\\s*:\\s*(.*)$", "i");
  for (const l of lines) { const m = re.exec(l); if (m) return m[1].trim(); }
  return null;
}
export function partOf(title: string): number | null {
  const t = title.trim().toLowerCase();
  if (/^(any part|all parts|every part)/.test(t)) return 0;
  const m = /^part\s*(1|2|3|iii|ii|i)\b/.exec(t);
  if (!m) return null;
  return ({ "1": 1, "2": 2, "3": 3, i: 1, ii: 2, iii: 3 } as Record<string, number>)[m[1]];
}
/* one of the six answers, or one of the usual ways of writing them ("By contractor"); nothing looser */
function standard(a: string): string {
  const c = choiceOf(a);
  return c.known && CHOICES.includes(c.choice) ? c.choice : "";
}

/* One map's branches -> its rules (all for `scope`: a factory id, or null = every factory), its settings lines
   and what in it cannot be used. */
export interface ParsedMap { rules: AiRule[]; settingsLines: string[]; problems: string[]; instructions: Section[] | null; steps: Partial<AiSettings> }
export function parseMap(nodes: MapNode[], scope: string | null, label = "map"): ParsedMap {
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) { const l = kids.get(n.parent_id) || []; l.push(n); kids.set(n.parent_id, l); }
  for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  const root = (kids.get(null) || [])[0];
  const rules: AiRule[] = [], problems: string[] = [], settingsLines: string[] = [];
  let instructions: Section[] | null = null;
  const steps: Partial<AiSettings> = {};
  if (!root) return { rules, settingsLines, problems, instructions, steps };
  // a section's text: its notes, then the branches under it (each its title and notes), for as deep as they go
  const textOf = (n: MapNode, depth: number): string => [n.notes.trim(), ...(kids.get(n.id) || []).filter((c) => c.verified)
    .map((c) => (depth ? "- " : "") + c.title.trim() + (c.notes.trim() || (kids.get(c.id) || []).length ? ": " + textOf(c, depth + 1) : ""))].filter(Boolean).join("\n");
  let order = 0;
  function walk(n: MapNode, part: number, when: string, section: string, path: string[], unless = "", kind: "rule" | "fact" = "rule") {
    if (!n.verified) return;
    const sp = specials(n);
    const w = field(sp, "when") ?? when, sec = field(sp, "section") ?? section;
    const un = [unless, field(sp, "unless") ?? field(sp, "not when") ?? ""].filter(Boolean).join(", ");
    const pf = field(sp, "part");
    if (pf !== null) { const pn = partOf("part " + pf); if (pn === null) problems.push(`${label}: "${[...path, n.title].join(" › ")}": Part "${pf}" is not 1, 2 or 3.`); else part = pn; }
    const ansRaw = field(sp, "answer") || "", remark = field(sp, "remark") || "";
    const answer = ansRaw ? standard(ansRaw) : "";
    const here = [...path, n.title];
    const name = here.join(" › ");
    if (ansRaw && !answer) problems.push(`${label}: "${name}": Answer "${ansRaw}" is not one of the six answers (${CHOICES.join(", ")}).`);
    if (remark && !answer) problems.push(`${label}: "${name}" has a Remark but no Answer: the remark is only a hint for the AI.`);
    if (answer && remark && !w && !sec && part === 0) problems.push(`${label}: "${name}" would answer every clause of every Part by itself: add When or Section, or move it under a Part.`);
    for (const l of sp) if (/^\s*[A-Za-z ]{3,20}:/.test(l) && !/^\s*(when|unless|not when|section|part|answer|remark|learned)\s*:/i.test(l)) problems.push(`${label}: "${name}": "${l.trim().slice(0, 40)}" is not When, Unless, Section, Part, Answer or Remark, so the AI does not read it.`);
    if (kind === "fact" && n.notes.trim() && !w && !sec) problems.push(`${label}: fact "${name}" has no When or Section, so it is shown on every clause.`);
    if (kind === "fact" && ansRaw) problems.push(`${label}: fact "${name}" has an Answer: facts never answer by themselves (write the rule under a Part).`);
    if (n.notes.trim() || (answer && kind === "rule")) {
      rules.push({ id: n.id, product_id: "", factory_id: scope, kind, title: n.title, keywords: w, sections: sec, unless: un, part,
                   instruction: n.notes.trim(), answer: kind === "rule" ? answer : "", remark: kind === "rule" ? remark : "", active: 1, sort: order++, source: `${label} › ${name}` });
    }
    for (const c of kids.get(n.id) || []) walk(c, part, w, sec, here, un, kind);
  }
  for (const top of kids.get(root.id) || []) {
    const t = top.title.trim();
    if (/^(instructions|prompt|rule ?book|brief)\b/i.test(t)) {
      // the branch's own notes explain it to people; its sections are what the AI reads
      if (top.verified) instructions = (kids.get(top.id) || []).filter((c) => c.verified).map((c) => ({ title: c.title.trim(), text: textOf(c, 0) })).filter((x) => x.text);
      continue;
    }
    if (/^(decision steps|how the ai decides|steps)\b/i.test(t)) {
      if (!top.verified) continue;
      for (const c of kids.get(top.id) || []) {
        const st = stepOf(c.title);
        if (!st) continue;
        (steps as Record<string, boolean>)[st.key] = !!c.verified;
        if (c.verified) settingsLines.push(...specials(c));
      }
      continue;
    }
    if (/^how\b/i.test(t)) continue;
    if (/^settings?\b/i.test(t)) { if (top.verified) settingsLines.push(...specials(top), ...top.notes.split("\n")); continue; }
    // Facts: what is true about the units; the branches under it are facts the model may cite ([F1])
    if (/^(facts|product facts|factory facts)\b/i.test(t)) { if (top.verified) for (const c of kids.get(top.id) || []) walk(c, 0, "", "", [top.title], "", "fact"); continue; }
    // Learned: its own notes explain it to people; the branches under it are rules
    if (/^learned\b/i.test(t)) { if (top.verified) for (const c of kids.get(top.id) || []) walk(c, 0, "", "", [top.title]); continue; }
    const pn = partOf(t);
    walk(top, pn === null ? 0 : pn, "", "", []);
  }
  return { rules, settingsLines, problems, instructions, steps };
}

/* ---------- reading the linked maps, with a short cache per Worker instance ---------- */

/* A branch of a knowledge map, for the AI: where it is ("Fans › EC fans"), and what it says (title, notes,
   special notes). Branches "to verify" are not facts yet and are left out, with everything under them. */
export interface KnowledgeItem { map: string; path: string; text: string }
export function knowledgeOf(nodes: MapNode[], mapName: string): KnowledgeItem[] {
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) { const l = kids.get(n.parent_id) || []; l.push(n); kids.set(n.parent_id, l); }
  for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  const root = (kids.get(null) || [])[0];
  const out: KnowledgeItem[] = [];
  if (!root) return out;
  (function walk(n: MapNode, path: string[]) {
    for (const c of kids.get(n.id) || []) {
      if (!c.verified) continue;
      const here = [...path, c.title.trim()];
      const body = [c.notes.trim(), ...specials(c)].filter(Boolean).join(" · ");
      if (body) out.push({ map: mapName, path: here.join(" › "), text: body.slice(0, 1200) });
      if (out.length < 3000) walk(c, here);
    }
  })(root, []);
  return out;
}

export interface AiMaps {
  rules: AiRule[]; settings: AiSettings; problems: string[]; instructions: Section[] | null; knowledge: KnowledgeItem[];
  maps: { scope: string | null; role: "rulebook" | "knowledge"; id: string; name: string; updated_at: string }[];
}
const cache = new Map<string, { at: number; stamp: string; v: AiMaps }>();

export async function aiMapFor(env: Env, productId: string, factoryId: string | null): Promise<AiMaps> {
  const links = await all<{ factory_id: string | null; role: "rulebook" | "knowledge"; id: string; name: string; updated_at: string }>(env.DB.prepare(
    `SELECT l.factory_id, l.role, m.id, m.name, m.updated_at FROM ai_map_links l JOIN mp_maps m ON m.id = l.map_id
      WHERE l.product_id = ? AND (l.factory_id IS NULL OR l.factory_id = ?)`).bind(productId, factoryId || ""));
  if (!links.length) return { rules: [], settings: { ...DEFAULT_SETTINGS }, problems: [], instructions: null, knowledge: [], maps: [] };
  const key = productId + "|" + (factoryId || "");
  const stamp = links.map((l) => l.role + l.id + l.updated_at).sort().join(",");
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp && Date.now() - hit.at < 60000) return hit.v;
  // the product's map first for the settings, then the factory's, which overrides them; the factory's rules come first
  links.sort((a, b) => (a.factory_id ? 1 : 0) - (b.factory_id ? 1 : 0));
  let settings = { ...DEFAULT_SETTINGS };
  const rules: AiRule[] = [], problems: string[] = [];
  let instructions: Section[] | null = null;
  const knowledge: KnowledgeItem[] = [];
  for (const l of links) {
    const nodes = await all<MapNode>(env.DB.prepare("SELECT id, parent_id, title, notes, special, sort, verified FROM mp_nodes WHERE map_id = ?").bind(l.id));
    if (l.role === "knowledge") { (l.factory_id ? knowledge.unshift(...knowledgeOf(nodes, l.name)) : knowledge.push(...knowledgeOf(nodes, l.name))); continue; }
    const p = parseMap(nodes, l.factory_id, `"${l.name}"`);
    settings = applySettings({ ...settings, ...p.steps }, p.settingsLines, problems, `"${l.name}" > Settings`);
    if (p.instructions) {
      // the factory's sections replace the product's of the same title, the others come after
      const base: Section[] = instructions || [];
      instructions = base.length ? [...base.map((x) => p.instructions!.find((y) => y.title.toLowerCase() === x.title.toLowerCase()) || x),
        ...p.instructions.filter((y) => !base.some((x) => x.title.toLowerCase() === y.title.toLowerCase()))] : p.instructions;
    }
    problems.push(...p.problems);
    rules.unshift(...p.rules.map((r) => ({ ...r, product_id: productId })));
  }
  const v = { rules, settings, problems, instructions, knowledge, maps: links.map((l) => ({ scope: l.factory_id, role: l.role, id: l.id, name: l.name, updated_at: l.updated_at })) };
  cache.set(key, { at: Date.now(), stamp, v });
  return v;
}

/* ---------- a new map from the template ---------- */

export interface Seed { title: string; notes?: string; special?: string[]; kids?: Seed[]; off?: boolean }   // off: comes in "to verify"

const STEP_SEEDS: Seed = { title: "Decision steps", notes: "What the AI goes through for every clause, in this order; it stops at the first step that settles the clause. Mark a step \"to verify\" to skip it (the order itself is fixed). The special notes of a step are its settings.", kids: [
  { title: "1. Project datasheet (compared by code)", notes: "The rows of the Datasheet Notes table saved in the project: the same rows as the blue chips under the clause (Product Options > Row mapping finds them). IF the clause states a number (\"minimum 50 mm\", \"not exceeding 2.5 m/s\") AND a chip near that number has a value in the same unit, code compares them:\n- requirement met -> Comply\n- a value asked without minimum or maximum, and the offer differs -> Comply with Remarks, stating the offer\n- a minimum or maximum not met -> Not Comply\nThe remark is the datasheet value (the row's Response template filled in). No model call. IF the library answers the clause with a different value, the datasheet wins and the draft names both values." },
  { title: "2. Library (Compliance review)", notes: "IF a library clause of this factory is at least as similar as the threshold below AND it is answered AND it has no # rules -> its answer and wording are copied, no model call. Below the threshold, the 3 most similar answered clauses go to the model as a style reference.", special: ["Copy from library at: 0.90", "Datasheet wins over the library: yes"] },
  { title: "3. Earlier answers in this record", notes: "IF a person answered the same clause earlier in this specification -> proposed again (\"same as your answer to 1.04 H\"). The answers given earlier in the same section also go to the model, so it stays consistent." },
  { title: "4. Map rules that answer by themselves", notes: "IF a rule of this map (Part branches, Learned) has an Answer and a Remark AND its When / Section match the clause -> applied as written, no model call. Rules without an Answer are instructions for the model. The factory's map is read before the map for all factories." },
  { title: "5. Other projects", notes: "IF the same clause was answered in another project of this factory -> proposed, marked \"not yet approved\" (below the library)." },
  { title: "6. Product Options and AI notes", notes: "Values seen on this factory's datasheets, special options, notes and AI notes (Product Options > + AI note) for the rows of the clause, and AI notes that share telling words with it. They go to the model as facts it may quote." },
  { title: "7. Knowledge maps", notes: "The verified branches of the knowledge maps linked in Compliance review > AI rules (process or product understanding) that share telling words with the clause. They go to the model as facts it may quote. A branch \"to verify\" is not a fact yet and is left out." },
  { title: "8. AI model", notes: "ONLY IF nothing above settled the clause, and while today's budget lasts. It reads the Instructions branch, then everything above, each source with an id ([D1] datasheet row, [L1] library answer, [O1] Product Options, [N1] AI note, [K1] knowledge branch, [R1] rule, [M1] a correction people made, [E1] earlier answer, [P1] other project), and writes the answer, the remark, the reason and the ids it used. IF the clause is in Part 2 and no source at all is on file, the model is not asked (Answer without a source: no): the clause waits for a person. The small model (AI model: small, 8B) is the default: fast, and about 8 times cheaper than the large one (AI model: large, 70B). Compare them with Check the AI.", special: ["Use the AI model: yes", "AI model: small", "Daily AI budget: 9000 neurons", "Answer without a source: no"] },
  { title: "9. Checks (always on)", notes: "Code checks every model answer: one of the six answers (else one retry); Comply, Comply with Remarks, Not Comply and Not Applicable must cite at least one source id that was in the prompt (else one retry, then the clause waits for a person, unless Answer without a source is yes); a number with a unit must appear in a cited source, otherwise it becomes [value] with low confidence; the remark does not repeat the answer; no uncertain words; Not Comply only with a rule, a datasheet row, a library answer or Product Options behind it. Every proposal stays blue until a person keeps it." },
  { title: "How to write a rule", notes: "Add a branch under a Part. Title = a name. Notes = what the AI should do, in a plain sentence. Special notes, one per line:\n  When: words or phrases, commas between (the clause mentions one; \"install\" also finds installation)\n  Unless: words or phrases (the rule stays off a clause that mentions one; passes to the branches under it)\n  Section: words or phrases (the section title mentions one)\n  Answer: one of the six answers\n  Remark: the exact remark\nWith Answer and Remark the rule answers by itself. When and Section pass to the branches under it. Mark a branch \"to verify\" to switch it off. Compliance review > AI rules > Try a clause shows what applies and the exact text the AI reads." }
] };

const INSTRUCTION_SEEDS = (): Seed => ({ title: "Instructions", notes: "The AI's brief. The model reads every section below, in this order, before it answers a clause ({product} and {factory} are filled in). Edit a section to change how it answers; mark one \"to verify\" to leave it out. In a factory's map, a section with the same title replaces this one. The reply format and the six answers are fixed in the site.",
  kids: DEFAULT_INSTRUCTIONS.map((x) => ({ title: x.title, notes: x.text })) });

const LEARNED_SEED: Seed = { title: "Learned", notes: "Rules the AI writes here when people change its answer the same way 3 times or more (every night, or AI rules > How the AI did > Write to the map). They are \"to verify\": check one, edit it if needed and mark it verified to switch it on; delete the ones that are wrong (they are not written again)." };

export function seedTree(product: string, factory: string | null): Seed[] {
  if (factory) return [
    { title: "Instructions", notes: `Only what should differ for ${factory}: add a section with the same title as one in the map for all ${product} factories to replace it, or a new title to add to it.` },
    { title: "Settings", notes: `Only what should differ for ${factory} from the map for all ${product} factories. Copy a line from that map's Decision steps and change the value.` },
    { title: "Part 1 General" }, { title: "Part 2 Products" }, { title: "Part 3 Execution" }, { title: "Any Part" },
    { title: "Facts", notes: `Facts that hold for ${factory} only. ` + FACTS_NOTES, kids: factoryFacts(product, factory) },
    LEARNED_SEED
  ];
  const ahu = isAhu(product);
  return [
    INSTRUCTION_SEEDS(),
    STEP_SEEDS,
    { title: "Settings", notes: "Change a value after the colon. The AI reads it within a minute.", special: ["Suggest in focus mode: yes", "Use answers from other projects: yes"] },
    { title: "Facts", notes: FACTS_NOTES, kids: ahu ? AHU_FACTS : [] },
    { title: "Part 1 General", kids: [
      { title: "Reference standards", notes: "A line that only names a standard or a code is Noted. A standard the units are certified or tested to (a fact, an AI note or the library says so: Eurovent / EN 1886 / EN 13053, AHRI 410 coils) is Comply, with that fact as the remark. Codes for the building and its installation (SASO installation codes, NFPA 90A, IBC, IMC, local codes) are Noted. A standard the units are not certified to, with an equivalent a fact names: Comply with Remarks, 'Comply as equivalent: <the offered standard>'. Never claim an equivalence no fact names.", special: ["Section: references, reference standards, codes and standards, applicable standards"] },
      { title: "Scope statements", notes: "Statements of what the section covers or how it relates to other sections. A clause in these sections that asks for something (shall, provide, select, a standard, a limit) is not a scope statement: the Unless line keeps the rule off it.", special: ["Section: section includes, related sections, related documents, summary, description of work", "Unless: shall, provide, select, must, submit, comply, standard, standards, equivalent, minimum, maximum, limit, limits, deviation", "Answer: Noted", "Remark: Noted."] },
      { title: "Coordination by the contractor", notes: "Coordinating sizes, locations and layouts with other trades and with the building is the contractor's work.", special: ["When: coordinate size, coordinate layout, coordinate installation, coordinate location", "Answer: In Contractor's Scope", "Remark: By Contractor / others. Daikin scope is supply of equipment."] },
      ...(ahu ? AHU_PART1 : [])
    ] },
    { title: "Part 2 Products", kids: [
      { title: "Belt drives and VFDs", notes: "IF the unit has direct-driven EC plug fans (datasheet or Product Options): clauses about belts, sheaves, pulleys, belt guards, adjustable motor bases or a separate VFD are Not Applicable; say that direct-driven EC fans are provided. IF the selection has belt-driven fans, answer them normally.", special: ["When: belt, belts, sheave, pulley, belt guard, variable frequency, vfd, adjustable motor base"] },
      { title: "Project schedule values", notes: "Capacities, sizes, filter grades, heaters and power supply are selected to the project's equipment schedule: answer from the project datasheet; never copy another project's values.", special: ["When: as scheduled, equipment schedule, as indicated on, as shown on, scheduled capacity"] },
      ...(ahu ? AHU_PART2 : [])
    ] },
    { title: "Part 3 Execution", kids: [
      { title: "Site works", notes: "Installation, site checks, start-up, cleaning and site connections are site works (Instructions > Scope of supply). A clause that asks for the manufacturer's representative or for factory-fitted items is not plain site work: the Unless line sends it to the model.", special: ["When: install, installation, examine, examination, level and plumb, anchor bolt, field connection, field wiring, field piping, piping connection, connect piping, connect ductwork, connect fan motors, rigging, hoisting, erection, start-up, startup, final checks, verify that, clean, cleaning, touch-up, adjust, adjusting, lubricate, balancing", "Unless: factory installed, factory-installed, factory mounted, factory fitted, lifting lug, manufacturer's representative, factory-authorized, factory authorized, factory-authorised, service representative, train, training", "Answer: In Contractor's Scope", "Remark: By Contractor / others. Daikin scope is supply of equipment."] },
      { title: "Supplied items in installation clauses", notes: "Items the factory fits on the unit (filter gauges, lifting lugs, factory-installed parts) are answered on what is supplied, not on the verb \"install\": Comply when a source shows them; the site work in the same clause is by the contractor.", special: ["When: factory installed, factory-installed, factory mounted, factory fitted, lifting lug, filter gauge, touch-up paint"] },
      { title: "Concrete bases", notes: "Concrete bases, housekeeping pads and plinths are by the contractor. A product clause that only mentions the pad (the unit is self-supporting on it) is not about the base.", special: ["When: concrete base, housekeeping base, housekeeping pad, plinth", "Unless: self-supporting, self supporting, designed, factory", "Answer: In Contractor's Scope", "Remark: By Contractor / others. Daikin scope is supply of equipment."] },
      ...(ahu ? AHU_PART3 : [])
    ] },
    { title: "Any Part", kids: [
      { title: "Unloading at site", notes: "Unloading and setting in place are site works.", special: ["When: unloading, offloading, unload the units, setting in place, set in place", "Answer: In Contractor's Scope", "Remark: By Contractor / others. Daikin scope is supply of equipment."] }
    ] },
    LEARNED_SEED
  ];
}

/* Template rules as earlier versions of the template wrote them. A branch that still holds exactly these special notes
   was never edited by a person, so "Update from template" brings it to the current template (and moves it when the
   template moved it); a branch someone changed is left as it is. Corrections of 16 Oct 2026 (Riyadh Metro AHU trace):
   Scope statements answered requirements in SUMMARY; Concrete bases (Any Part) answered a Part 2 product clause;
   Site works missed install / start-up / cleaning; Supplied items was shown on plain site work. */
const SITE = "Remark: By Contractor / others. Daikin scope is supply of equipment.";
const OLD_TEMPLATE: { title: string; special: string[]; notes?: string }[] = [
  { title: "Scope statements", special: ["Section: section includes, related sections, related documents, summary, description of work", "Answer: Noted", "Remark: Noted."] },
  { title: "Site works", special: ["When: level and plumb, anchor bolt, field connection, field wiring, field piping, piping connection, connect piping, connect ductwork, rigging, hoisting, erection", "Answer: In Contractor's Scope", SITE] },
  { title: "Supplied items in installation clauses", special: ["When: install, factory installed, factory mounted, touch-up, field paint"] },
  { title: "Concrete bases", special: ["When: concrete base, housekeeping pad, plinth", "Answer: In Contractor's Scope", SITE] },
  { title: "Reference standards", special: ["Section: references, reference standards, codes and standards, applicable standards"],
    notes: "A line that only names a standard or a code is Noted. If it is a standard the units are certified or tested to (a rule, an AI note or the library says so), answer Comply." },
  { title: "8. AI model", special: ["Use the AI model: yes", "Daily AI budget: 9000 neurons"],
    notes: "ONLY IF nothing above settled the clause, and while today's budget lasts. It reads the Instructions branch, then everything above, and writes the answer, the remark and the reason." },
  { title: "8. AI model", special: ["Use the AI model: yes", "Daily AI budget: 9000 neurons", "Answer without a source: no"],
    notes: "ONLY IF nothing above settled the clause, and while today's budget lasts. It reads the Instructions branch, then everything above, each source with an id ([D1] datasheet row, [L1] library answer, [O1] Product Options, [N1] AI note, [K1] knowledge branch, [R1] rule, [M1] a correction people made, [E1] earlier answer, [P1] other project), and writes the answer, the remark, the reason and the ids it used. IF the clause is in Part 2 and no source at all is on file, the model is not asked (Answer without a source: no): the clause waits for a person." },
  { title: "9. Checks (always on)", special: [],
    notes: "Code checks every model answer: one of the six answers (else one retry); a number with a unit no source gives becomes [value] with low confidence; the remark does not repeat the answer; no uncertain words; Not Comply only with a rule, a datasheet row, a library answer or Product Options behind it. Every proposal stays blue until a person keeps it." }
];

/* What the current template holds, branch by branch, with the top branch each sits under. */
function templateIndex(product: string): Map<string, { seed: Seed; top: string }> {
  const out = new Map<string, { seed: Seed; top: string }>();
  for (const top of seedTree(product, null)) for (const k of top.kids || []) out.set(k.title, { seed: k, top: top.title });
  return out;
}

/* The branches of the template a linked map does not have yet (Instructions, Decision steps, Learned), added at the
   top level without touching anything else; then the template rules no one edited are brought up to date and the
   template's new rules are added under their Part. An older map gets the new parts with one press. */
export async function upgradeAiMap(env: Env, userId: string, mapId: string, product: string, factory: string | null): Promise<string[]> {
  const tops = await all<{ title: string; sort: number }>(env.DB.prepare(
    "SELECT n.title, n.sort FROM mp_nodes n JOIN mp_nodes r ON r.id = n.parent_id AND r.parent_id IS NULL WHERE n.map_id = ?").bind(mapId));
  const root = await env.DB.prepare("SELECT id FROM mp_nodes WHERE map_id = ? AND parent_id IS NULL ORDER BY sort LIMIT 1").bind(mapId).first<{ id: string }>();
  if (!root) return [];
  const has = (re: RegExp) => tops.some((t) => re.test(t.title.trim()));
  const want = seedTree(product, factory).filter((x) =>
    (/^instructions/i.test(x.title) && !has(/^(instructions|prompt|rule ?book|brief)\b/i)) ||
    (/^decision steps/i.test(x.title) && !has(/^(decision steps|steps)\b/i)) ||
    (/^facts/i.test(x.title) && !has(/^(facts|product facts|factory facts)\b/i)) ||
    (/^learned/i.test(x.title) && !has(/^learned\b/i)));
  const at = now(), stmts: D1PreparedStatement[] = [], done: string[] = [];
  let sort = Math.min(0, ...tops.map((t) => t.sort)) - want.length;
  for (const w of want) { addSeed(env, stmts, mapId, root.id, w, /^learned/i.test(w.title) ? 1000 : sort++, userId, at); done.push(w.title); }
  // the old documentation branch is replaced by Decision steps
  if (want.some((w) => /^decision steps/i.test(w.title)))
    stmts.push(env.DB.prepare("UPDATE mp_nodes SET verified = 0, notes = 'Replaced by Decision steps (you can delete this branch).' WHERE map_id = ? AND parent_id = ? AND title = 'How the AI decides'").bind(mapId, root.id));

  const nodes = await all<MapNode>(env.DB.prepare("SELECT id, parent_id, title, notes, special, sort, verified FROM mp_nodes WHERE map_id = ?").bind(mapId));
  const topId = new Map<string, string>();
  for (const n of nodes) if (n.parent_id === root.id) topId.set(n.title.trim().toLowerCase(), n.id);
  // facts of the template the map's Facts branch does not have yet (by title, anywhere in the map); "to verify" ones stay off
  const factsTop = [...topId.entries()].find(([t]) => /^(facts|product facts|factory facts)\b/.test(t));
  if (factsTop) {
    const seedFacts = seedTree(product, factory).find((x) => /^facts/i.test(x.title))?.kids || [];
    for (const f of seedFacts) {
      if (nodes.some((x) => x.title.trim() === f.title)) continue;
      addSeed(env, stmts, mapId, factsTop[1], f, 100 + done.length, userId, at);
      done.push(`${f.title} (fact added${f.off ? ", to verify" : ""})`);
    }
  }

  // template rules: only in a map for every factory of the product (a factory's map starts with empty Parts)
  if (!factory) {
    const index = templateIndex(product);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, k) => x.trim() === b[k].trim());
    for (const old of OLD_TEMPLATE) {
      const n = nodes.find((x) => x.title.trim() === old.title && same(specials(x), old.special) && (old.notes === undefined || x.notes.trim() === old.notes));
      const cur = index.get(old.title);
      if (!n || !cur || (same(specials(n), cur.seed.special || []) && n.notes.trim() === (cur.seed.notes || "").trim())) continue;
      const parent = topId.get(cur.top.toLowerCase()) || n.parent_id;
      stmts.push(env.DB.prepare("UPDATE mp_nodes SET notes = ?, special = ?, parent_id = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind((cur.seed.notes || "").slice(0, 8000), JSON.stringify(cur.seed.special || []), parent, userId, at, n.id));
      done.push(`${old.title} (updated${parent !== n.parent_id ? ", moved to " + cur.top : ""})`);
    }
    // the template's rules the map has never had (by title, anywhere in the map), under their Part
    for (const [title, cur] of index) {
      if (!/^part|^any part/i.test(cur.top) || nodes.some((x) => x.title.trim() === title)) continue;
      const parent = topId.get(cur.top.toLowerCase());
      if (!parent) continue;
      addSeed(env, stmts, mapId, parent, cur.seed, 50 + done.length, userId, at);
      done.push(`${title} (added under ${cur.top})`);
    }
  }
  if (!stmts.length) return [];
  stmts.push(env.DB.prepare("UPDATE mp_maps SET updated_by = ?, updated_at = ? WHERE id = ?").bind(userId, at, mapId));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  return done;
}

export function addSeed(env: Env, stmts: D1PreparedStatement[], mapId: string, parent: string, s: Seed, sort: number, userId: string | null, at: string, verified = 1): string {
  const id = uuid();
  if (s.off) verified = 0;
  stmts.push(env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, mapId, parent, s.title.slice(0, 200), (s.notes || "").slice(0, 8000), JSON.stringify(s.special || []), sort, verified,
          verified ? userId : null, verified ? at : null, userId, at, userId, at));
  (s.kids || []).forEach((k, i) => addSeed(env, stmts, mapId, id, k, i, userId, at, s.off ? 1 : verified));
  return id;
}

/* A new private map from the template, named after the scope, linked to it. The rules of the old AI rules tab
   (ai_rules, 16 Oct) of the same scope move into it under their Part. */
export async function createAiMap(env: Env, userId: string, product: { id: string; name: string }, factory: { id: string; name: string } | null, name?: string): Promise<{ id: string; name: string }> {
  const mapId = uuid(), at = now(), rootId = uuid();
  let title = (name || `AI rules: ${product.name}${factory ? " " + factory.name : ""}`).slice(0, 120);
  const clash = await env.DB.prepare("SELECT 1 FROM mp_maps WHERE created_by = ? AND lower(name) = lower(?)").bind(userId, title).first();
  if (clash) title = (title + " " + at.slice(0, 10)).slice(0, 120);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO mp_maps (id, name, share, kind, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'private', 'rulebook', ?, ?, ?, ?)").bind(mapId, title, userId, at, userId, at),
    env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                    VALUES (?, ?, NULL, ?, ?, '[]', 0, 1, ?, ?, ?, ?, ?, ?)`)
      .bind(rootId, mapId, title, `The rules and settings the AI uses for ${product.name}${factory ? " made in " + factory.name : " (every factory)"}. It is linked in Compliance review > AI rules. Instructions = what the AI reads before every answer; Decision steps = the order it goes through; the Parts hold the rules; Learned = what it learned, to verify.`, userId, at, userId, at, userId, at)
  ];
  const parts = new Map<number, string>();
  seedTree(product.name, factory ? factory.name : null).forEach((s, i) => {
    const id = addSeed(env, stmts, mapId, rootId, s, i, userId, at);
    const pn = partOf(s.title); if (pn !== null) parts.set(pn, id);
  });
  const old = await all<AiRule>(env.DB.prepare("SELECT id, factory_id, kind, title, keywords, part, instruction, answer, remark, active FROM ai_rules WHERE product_id = ? AND kind = 'rule' AND tool = 'compliance' AND ifnull(factory_id, '') = ?").bind(product.id, factory ? factory.id : ""));
  old.forEach((r, i) => {
    const parent = parts.get(r.part || 0); if (!parent) return;
    const sp = [r.keywords ? "When: " + r.keywords : "", r.answer ? "Answer: " + r.answer : "", r.remark ? "Remark: " + r.remark : ""].filter(Boolean);
    stmts.push(env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(uuid(), mapId, parent, (r.title || r.instruction.slice(0, 60) || "Rule").slice(0, 200), r.instruction, JSON.stringify(sp), 100 + i, r.active ? 1 : 0, userId, at, userId, at, userId, at));
  });
  stmts.push(env.DB.prepare("DELETE FROM ai_map_links WHERE product_id = ? AND ifnull(factory_id, '') = ? AND role = 'rulebook'").bind(product.id, factory ? factory.id : ""));
  stmts.push(env.DB.prepare("INSERT INTO ai_map_links (product_id, factory_id, map_id, role, created_by) VALUES (?, ?, ?, 'rulebook', ?)").bind(product.id, factory ? factory.id : null, mapId, userId));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  return { id: mapId, name: title };
}
