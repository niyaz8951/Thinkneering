/* The AI maps: ordinary maps in Maps, chosen by name in Compliance review > AI rules (ai_map_links) - one for
   every factory of a product, one per factory. A record of AHU / Riyadh reads the Riyadh map first, then the
   map for all AHU factories. The server reads them itself: people who run the review or use focus mode never
   need access to Maps; only the people who write the rules do.

     <any name, e.g. "AHU-Riyadh-AI notes">
     |-- How the AI decides     documentation (the AI does not read it)
     |-- Settings               special notes "Name: value" (SETTINGS below); a factory map overrides the product map
     |-- Part 1 General | Part 2 Products | Part 3 Execution | Any Part
     |   |-- <rule>             title = name; notes = what the AI should do; special notes:
     |       |-- <rule>           When: words or phrases (the clause mentions one)
     |                            Section: words or phrases (the section title mentions one)
     |                            Answer: one of the six    Remark: the exact remark
     |-- any other branch       counts as "Any Part"

   A branch marked "to verify" is ignored with everything under it (the on / off switch). A branch passes its When
   and Section on to the branches under it unless they set their own. A branch with no notes and no answer only
   groups others. Answer + Remark = the rule answers matching clauses by itself, without the model. */
import type { Env } from "../env";
import { all, now, uuid } from "../lib/sql";
import { CHOICES, choiceOf } from "../lib/cm";
import type { AiRule } from "./rules";

export interface AiSettings { copyAt: number; useModel: boolean; budget: number; suggest: boolean; datasheetWins: boolean; projectAnswers: boolean }
export const DEFAULT_SETTINGS: AiSettings = { copyAt: 0.9, useModel: true, budget: 9000, suggest: true, datasheetWins: true, projectAnswers: true };

const SETTINGS: { re: RegExp; set: (s: AiSettings, v: string) => boolean; line: (s: AiSettings) => string }[] = [
  { re: /^copy from (the )?library/i, set: (s, v) => { const n = parseFloat(v); if (!(n >= 0.5 && n <= 1)) return false; s.copyAt = n; return true; }, line: (s) => `Copy from library at: ${s.copyAt.toFixed(2)}` },
  { re: /^use the (ai )?model/i, set: (s, v) => { s.useModel = yes(v); return true; }, line: (s) => `Use the AI model: ${s.useModel ? "yes" : "no"}` },
  { re: /^daily (ai )?budget/i, set: (s, v) => { const n = parseInt(v.replace(/[^\d]/g, ""), 10); if (!(n >= 0)) return false; s.budget = n; return true; }, line: (s) => `Daily AI budget: ${s.budget} neurons` },
  { re: /^suggest in focus/i, set: (s, v) => { s.suggest = yes(v); return true; }, line: (s) => `Suggest in focus mode: ${s.suggest ? "yes" : "no"}` },
  { re: /^datasheet wins/i, set: (s, v) => { s.datasheetWins = yes(v); return true; }, line: (s) => `Datasheet wins over the library: ${s.datasheetWins ? "yes" : "no"}` },
  { re: /^use answers from other projects/i, set: (s, v) => { s.projectAnswers = yes(v); return true; }, line: (s) => `Use answers from other projects: ${s.projectAnswers ? "yes" : "no"}` }
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
export function parseMap(nodes: MapNode[], scope: string | null, label = "map"): { rules: AiRule[]; settingsLines: string[]; problems: string[] } {
  const kids = new Map<string | null, MapNode[]>();
  for (const n of nodes) { const l = kids.get(n.parent_id) || []; l.push(n); kids.set(n.parent_id, l); }
  for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  const root = (kids.get(null) || [])[0];
  const rules: AiRule[] = [], problems: string[] = [], settingsLines: string[] = [];
  if (!root) return { rules, settingsLines, problems };
  let order = 0;
  function walk(n: MapNode, part: number, when: string, section: string, path: string[]) {
    if (!n.verified) return;
    const sp = specials(n);
    const w = field(sp, "when") ?? when, sec = field(sp, "section") ?? section;
    const ansRaw = field(sp, "answer") || "", remark = field(sp, "remark") || "";
    const answer = ansRaw ? standard(ansRaw) : "";
    const here = [...path, n.title];
    const name = here.join(" › ");
    if (ansRaw && !answer) problems.push(`${label}: "${name}": Answer "${ansRaw}" is not one of the six answers (${CHOICES.join(", ")}).`);
    if (remark && !answer) problems.push(`${label}: "${name}" has a Remark but no Answer: the remark is only a hint for the AI.`);
    if (answer && remark && !w && !sec && part === 0) problems.push(`${label}: "${name}" would answer every clause of every Part by itself: add When or Section, or move it under a Part.`);
    for (const l of sp) if (/^\s*[A-Za-z ]{3,20}:/.test(l) && !/^\s*(when|section|answer|remark)\s*:/i.test(l)) problems.push(`${label}: "${name}": "${l.trim().slice(0, 40)}" is not When, Section, Answer or Remark, so the AI does not read it.`);
    if (n.notes.trim() || answer) {
      rules.push({ id: n.id, product_id: "", factory_id: scope, kind: "rule", title: n.title, keywords: w, sections: sec, part,
                   instruction: n.notes.trim(), answer, remark, active: 1, sort: order++, source: `${label} › ${name}` });
    }
    for (const c of kids.get(n.id) || []) walk(c, part, w, sec, here);
  }
  for (const top of kids.get(root.id) || []) {
    const t = top.title.trim();
    if (/^how\b/i.test(t)) continue;
    if (/^settings?\b/i.test(t)) { if (top.verified) settingsLines.push(...specials(top), ...top.notes.split("\n")); continue; }
    const pn = partOf(t);
    walk(top, pn === null ? 0 : pn, "", "", []);
  }
  return { rules, settingsLines, problems };
}

/* ---------- reading the linked maps, with a short cache per Worker instance ---------- */

export interface AiMaps { rules: AiRule[]; settings: AiSettings; problems: string[]; maps: { scope: string | null; id: string; name: string; updated_at: string }[] }
const cache = new Map<string, { at: number; stamp: string; v: AiMaps }>();

export async function aiMapFor(env: Env, productId: string, factoryId: string | null): Promise<AiMaps> {
  const links = await all<{ factory_id: string | null; id: string; name: string; updated_at: string }>(env.DB.prepare(
    `SELECT l.factory_id, m.id, m.name, m.updated_at FROM ai_map_links l JOIN mp_maps m ON m.id = l.map_id
      WHERE l.product_id = ? AND (l.factory_id IS NULL OR l.factory_id = ?)`).bind(productId, factoryId || ""));
  if (!links.length) return { rules: [], settings: { ...DEFAULT_SETTINGS }, problems: [], maps: [] };
  const key = productId + "|" + (factoryId || "");
  const stamp = links.map((l) => l.id + l.updated_at).sort().join(",");
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp && Date.now() - hit.at < 60000) return hit.v;
  // the product's map first for the settings, then the factory's, which overrides them; the factory's rules come first
  links.sort((a, b) => (a.factory_id ? 1 : 0) - (b.factory_id ? 1 : 0));
  let settings = { ...DEFAULT_SETTINGS };
  const rules: AiRule[] = [], problems: string[] = [];
  for (const l of links) {
    const nodes = await all<MapNode>(env.DB.prepare("SELECT id, parent_id, title, notes, special, sort, verified FROM mp_nodes WHERE map_id = ?").bind(l.id));
    const p = parseMap(nodes, l.factory_id, `"${l.name}"`);
    settings = applySettings(settings, p.settingsLines, problems, `"${l.name}" > Settings`);
    problems.push(...p.problems);
    rules.unshift(...p.rules.map((r) => ({ ...r, product_id: productId })));
  }
  const v = { rules, settings, problems, maps: links.map((l) => ({ scope: l.factory_id, id: l.id, name: l.name, updated_at: l.updated_at })) };
  cache.set(key, { at: Date.now(), stamp, v });
  return v;
}

/* ---------- a new map from the template ---------- */

interface Seed { title: string; notes?: string; special?: string[]; kids?: Seed[] }

const HOW: Seed = { title: "How the AI decides", notes: "What the AI goes through for every clause, in this order. It stops at the first step that settles the clause. This branch is documentation; changing it changes nothing.", kids: [
  { title: "1. The project's datasheet", notes: "The rows of the Datasheet Notes table saved in the project, the same rows as the blue chips under the clause (found by the row keywords in Product Options > Row mapping). When the clause states a number (\"minimum 50 mm\", \"not exceeding 2.5 m/s\") and a chip near that number has a value in the same unit, code compares them: met -> Comply; a number asked without minimum or maximum that differs -> Comply with Remarks, stating the offer; a minimum or maximum not met -> Not Comply. The remark is the datasheet value (the row's Response template filled in). No model call. When the library answers the clause with a different value, the datasheet wins and the draft names both values." },
  { title: "2. Product Options", notes: "For the same rows: the values seen on this factory's datasheets, the special options, the notes and the AI notes of the Options tree (+ AI note on any section or row). They tell what the factory can offer when the project's datasheet does not have it. They go to the model as facts it may quote." },
  { title: "3. Compliance review (the library)", notes: "The same clause answered in the library fills the record when it is converted (green). A clause at or above the copy threshold (Settings) is copied with its answer and wording. Below it, the 3 most similar answered clauses go to the model for the wording." },
  { title: "4. Earlier answers", notes: "The same clause answered by a person earlier in this record is proposed again (\"same as your answer to 1.04 H\"). The answers given earlier in the same section go to the model so it stays consistent. Answers of other projects of the same factory are a source too, ranked below the library, marked \"not yet approved\" until reviewed." },
  { title: "5. AI rules (the linked maps)", notes: "The rules of the factory's map, then of the product's map, for the clause's Part. A rule with an Answer and a Remark answers the clause by itself. The others are instructions the model must follow; a clause's own rules (text after # in its Internal Comments) come first." },
  { title: "6. The AI model", notes: "Only when nothing above settles the clause, and only while today's budget lasts (Settings). It gets everything above and writes the answer and remark. It is not a source of facts." },
  { title: "7. Checks on every answer", notes: "Code checks the model's answer: one of the six answers; every number with a unit in the remark must come from a source (else [value], low confidence); no repeating the answer in the remark; no hedging words; Not Comply only with a rule, datasheet row or library answer behind it. Every proposal is blue until a person keeps it." },
  { title: "How to write a rule", notes: "Add a branch under a Part. Title = a name. Notes = what the AI should do, in a plain sentence. Special notes, one per line:\n  When: words or phrases, commas between (the clause mentions one; \"install\" also finds installation)\n  Section: words or phrases (the section title mentions one, e.g. references)\n  Answer: one of the six answers\n  Remark: the exact remark\nWith Answer and Remark the rule answers by itself. When and Section pass to the branches under it. Mark a branch \"to verify\" to switch it off. Compliance review > AI rules > Try a clause shows what applies, and lists anything in the map the AI cannot use." }
] };

export function seedTree(product: string, factory: string | null): Seed[] {
  if (factory) return [
    HOW,
    { title: "Settings", notes: `Only what should differ for ${factory} from the map for all ${product} factories. Copy a line from that map's Settings and change the value.` },
    { title: "Part 1 General" }, { title: "Part 2 Products" }, { title: "Part 3 Execution" }, { title: "Any Part" }
  ];
  return [
    HOW,
    { title: "Settings", notes: "Change a value after the colon. The AI reads them within a minute.", special: SETTINGS.map((d) => d.line(DEFAULT_SETTINGS)) },
    { title: "Part 1 General", kids: [
      { title: "Reference standards", notes: "A line that only names a standard or a code is Noted. If it is a standard the units are certified or tested to (Eurovent, AHRI, AMCA, ISO 9001), answer Comply.", special: ["Section: references, reference standards, codes and standards, applicable standards"] },
      { title: "Scope statements", notes: "Statements of what the section covers or how it relates to other sections.", special: ["Section: section includes, related sections, related documents, summary, description of work", "Answer: Noted", "Remark: Noted."] },
      { title: "Submittals", notes: "Submittal clauses: the selection report / AHU datasheet, the IOM manual and wiring diagrams are provided. Submittals the contractor prepares (coordination drawings, site records) are In Contractor's Scope.", special: ["Section: submittals, informational submittals, closeout submittals, action submittals"] },
      { title: "Warranty", notes: "Answer from the warranty note in Product Options when there is one; never state a warranty period no source gives.", special: ["Section: warranty"] }
    ] },
    { title: "Part 2 Products", kids: [
      { title: "Belt drives and VFDs", notes: "When the unit has direct-driven EC plug fans (datasheet or Product Options): clauses about belts, sheaves, pulleys, belt guards, adjustable motor bases or a separate VFD are Not Applicable; say that direct-driven EC plug fans are provided.", special: ["When: belt, belts, sheave, pulley, belt guard, variable frequency, vfd, adjustable motor base"] },
      { title: "Project schedule values", notes: "Capacities, sizes, filter grades, heaters and power supply are selected to the project's equipment schedule: say so and refer to the selection report. Never copy another project's values.", special: ["When: as scheduled, equipment schedule, as indicated on, as shown on, scheduled capacity"] }
    ] },
    { title: "Part 3 Execution", kids: [
      { title: "Site connections", notes: "Installation and site connections are by the contractor.", special: ["When: level and plumb, anchor bolt, field connection, field wiring, field piping, piping connection, connect piping, connect ductwork", "Answer: In Contractor's Scope", "Remark: Installation and site connections are by the contractor; Daikin scope is equipment supply."] },
      { title: "Installation (guidance)", notes: "Work done on site (installing, erecting, rigging, hoisting, touch-up painting) is In Contractor's Scope, remark: Daikin scope is equipment supply. Items the factory fits on the unit (filter gauges, lifting lugs, factory-installed parts) are Comply: answer on what is supplied, not on the verb.", special: ["When: install, erect, rigging, hoisting, crane, touch-up, field paint"] },
      { title: "Start-up and commissioning", notes: "Start-up, commissioning and site testing are by the contractor; Daikin assists with the start-up of one AHU of each type. In Contractor's Scope, or Comply with Remarks when the clause asks for the manufacturer's start-up service, remark: Daikin shall assist the contractor in the start-up of one AHU of each type.", special: ["When: start-up, startup, commissioning, field test, functional test"] },
      { title: "Training", notes: "Training is given as assistance in the field.", special: ["When: training, demonstrat, instruct the owner", "Answer: Comply with Remarks", "Remark: Daikin shall assist in field training to the client."] }
    ] },
    { title: "Any Part", kids: [
      { title: "Unloading at site", notes: "Unloading and setting in place are by the contractor.", special: ["When: unloading, offloading, unload the units, setting in place, set in place", "Answer: In Contractor's Scope", "Remark: Daikin's responsibility is limited to manufacturing and delivering the AHUs to site (without unloading)."] },
      { title: "Concrete bases", notes: "Concrete bases and plinths are by the contractor.", special: ["When: concrete base, housekeeping pad, plinth", "Answer: In Contractor's Scope", "Remark: Concrete bases and plinths are by the contractor."] },
      { title: "Spare parts and extra materials", notes: "Units ship with one set of filters fitted; no spare filters, belts or extra materials unless the order says so. Comply with Remarks and say so, or Not Applicable for belts.", special: ["When: spare, extra material, maintenance material, attic stock, extra filter, spare filter"] }
    ] }
  ];
}

/* A new private map from the template, named after the scope, linked to it. The rules of the old AI rules tab
   (ai_rules, 16 Oct) of the same scope move into it under their Part. */
export async function createAiMap(env: Env, userId: string, product: { id: string; name: string }, factory: { id: string; name: string } | null, name?: string): Promise<{ id: string; name: string }> {
  const mapId = uuid(), at = now(), rootId = uuid();
  let title = (name || `AI rules: ${product.name}${factory ? " " + factory.name : ""}`).slice(0, 120);
  const clash = await env.DB.prepare("SELECT 1 FROM mp_maps WHERE created_by = ? AND lower(name) = lower(?)").bind(userId, title).first();
  if (clash) title = (title + " " + at.slice(0, 10)).slice(0, 120);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO mp_maps (id, name, share, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'private', ?, ?, ?, ?)").bind(mapId, title, userId, at, userId, at),
    env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                    VALUES (?, ?, NULL, ?, ?, '[]', 0, 1, ?, ?, ?, ?, ?, ?)`)
      .bind(rootId, mapId, title, `The rules and settings the AI uses for ${product.name}${factory ? " made in " + factory.name : " (every factory)"}. It is linked in Compliance review > AI rules. Read "How the AI decides" first.`, userId, at, userId, at, userId, at)
  ];
  const parts = new Map<number, string>();
  function add(parent: string, s: Seed, sort: number, top: boolean) {
    const id = uuid();
    stmts.push(env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
      .bind(id, mapId, parent, s.title.slice(0, 200), (s.notes || "").slice(0, 8000), JSON.stringify(s.special || []), sort, userId, at, userId, at, userId, at));
    if (top) { const pn = partOf(s.title); if (pn !== null) parts.set(pn, id); }
    (s.kids || []).forEach((k, i) => add(id, k, i, false));
  }
  seedTree(product.name, factory ? factory.name : null).forEach((s, i) => add(rootId, s, i, true));
  const old = await all<AiRule>(env.DB.prepare("SELECT id, factory_id, kind, title, keywords, part, instruction, answer, remark, active FROM ai_rules WHERE product_id = ? AND kind = 'rule' AND tool = 'compliance' AND ifnull(factory_id, '') = ?").bind(product.id, factory ? factory.id : ""));
  old.forEach((r, i) => {
    const parent = parts.get(r.part || 0); if (!parent) return;
    const sp = [r.keywords ? "When: " + r.keywords : "", r.answer ? "Answer: " + r.answer : "", r.remark ? "Remark: " + r.remark : ""].filter(Boolean);
    stmts.push(env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(uuid(), mapId, parent, (r.title || r.instruction.slice(0, 60) || "Rule").slice(0, 200), r.instruction, JSON.stringify(sp), 100 + i, r.active ? 1 : 0, userId, at, userId, at, userId, at));
  });
  stmts.push(env.DB.prepare("DELETE FROM ai_map_links WHERE product_id = ? AND ifnull(factory_id, '') = ?").bind(product.id, factory ? factory.id : ""));
  stmts.push(env.DB.prepare("INSERT INTO ai_map_links (product_id, factory_id, map_id, created_by) VALUES (?, ?, ?, ?)").bind(product.id, factory ? factory.id : null, mapId, userId));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  return { id: mapId, name: title };
}
