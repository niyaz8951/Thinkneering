/* Drafting one answer. The order (owner's decision, 16 Oct 2026; written out in the AI map, "How the AI decides"):
     1. the project's datasheet, compared by code (evidence.ts)  -> no model                    (source datasheet)
     2. a library clause at or above the copy threshold          -> copied, no model           (source library-similar)
     3. the same clause answered by a person in this record      -> proposed again, no model   (source record)
     4. an AI rule with a fixed answer and remark                -> applied, no model          (source rule)
     5. the same clause answered in another project              -> proposed, no model         (source project)
     6. the model, given everything                              -> checked by code            (source model)
   A clause with its own AI rules ("#" in Internal Comments) goes to the model with the rules in front (when the
   model may be used). The prompt is worker/src/ai/prompts/draft.md (PROMPT_VERSION below; stored on every draft).
   After the model: guard.ts (numbers, echo, hedging), standard wording, Not Comply needs a source, one retry.

   The contract with the model (16 Oct 2026, owner: "the AI must follow a strict set of directions"):
     - every source in the prompt carries an id: [D1] datasheet row, [L1] library answer, [O1] Product Options,
       [N1] AI note, [K1] knowledge branch, [R1] rule, [C1] clause rule, [F1] fact, [M1] a correction people made to an
       AI answer, [E1] an earlier answer in this specification, [P1] an answer in another project;
     - the model replies with the ids it used ("cites"); Comply, Comply with Remarks, Not Comply and Not Applicable
       must cite at least one id that was in the prompt, or code asks once more and then leaves the clause for a
       person (unless the AI map says "Answer without a source: yes", then it is drafted at low confidence);
     - a figure with a unit in the remark must be in a source it cites (else [value], low);
     - a Part 2 clause with no source at all is not sent to the model (strict mode): it waits for a person.
   This is enforced here, in code, whatever the instructions in the map say. */
import type { Env } from "../env";
import { CHOICES } from "../lib/cm";
import { complete, firstJson, draftModel, type AiUsage } from "./models";
import type { Similar } from "./search";
import { splitComments, directRule, type RuleHit, type DatasheetField } from "./rules";
import { groundRemarks, trimAnswerEcho, hedges } from "./guard";
import { instructionsText, type Section } from "./map";
import { SECTION_GUIDANCE, type SectionKind } from "./sections";

export const PROMPT_VERSION = "draft-2026-10-16e";
export const RULE_VERSION = "rule-2026-10-16";

export interface PastAnswerIn { spec: string; compliance: string; remarks: string; by: string; score: number; where: string; pending: boolean }
export interface DraftInput {
  clause: string; sr: string; part: number; section: string; parent?: string; product: string; factory: string;
  similar: Similar[]; comments: string;
  rules?: RuleHit[]; facts?: RuleHit[]; datasheet?: DatasheetField[]; units?: string[];
  // from evidence.ts
  datasheetDecision?: { compliance: string; remarks: string; reason: string; keys: string[]; confidence?: "high" | "medium" | "low" } | null;
  conflict?: string;                     // the library's value differs from this project's datasheet
  options?: string[];                    // Product Options lines for the rows of this clause
  notes?: string[];                      // AI notes of the Options tree
  knowledge?: string[];                  // verified branches of the knowledge maps that match the clause
  record?: PastAnswerIn | null;          // the same clause answered by a person in this record
  inSection?: string[];                  // answers given earlier in this section of the record
  project?: PastAnswerIn[];              // the same / similar clause answered in other projects of the factory
  copyAt?: number;                       // AI map > Decision steps > Library
  instructions?: Section[] | null;       // AI map > Instructions (null = the default brief)
  useRules?: boolean;                    // AI map > Decision steps > Map rules that answer by themselves
  allowModel?: boolean;                  // false: answer from the free sources only (setting or budget)
  sectionKind?: SectionKind | "";        // what the clause's section asks, learned from the library (sections.ts)
  sectionAnswers?: number;               // how many confirmed answers that is learned from
  absent?: string[];                     // unit sections the clause is about that this project's datasheet lacks
  corrections?: CorrectionIn[];          // what people answered instead of the AI on similar clauses (learning)
  unsourced?: boolean;                   // AI map > Settings > Answer without a source (default no: strict)
  model?: string;                        // AI map > Decision steps > 8. AI model > "AI model:" (default small, 8B)
}
export interface CorrectionIn { spec: string; suggested: string; suggested_remarks: string; final: string; final_remarks: string; score: number }
export type DraftSource = "datasheet" | "library-similar" | "record" | "rule" | "project" | "model";
export interface Draft {
  compliance: string; remarks: string; reason: string; confidence: "high" | "medium" | "low";
  source: DraftSource; sources: { kind: string; id: string; text: string; score: number }[]; model: string; promptVersion: string;
}

/* Thrown when only the model could answer and it may not be used: the clause is left as it is. */
export class NoFreeAnswer extends Error { constructor(why: string) { super(why); this.name = "NoFreeAnswer"; } }
/* Thrown when no source supports an answer (strict mode): the clause is left for a person, with the reason. */
export class NeedsSource extends NoFreeAnswer { constructor(why: string) { super(why); this.name = "NeedsSource"; } }

/* The answers that state something about the product: they need a source the model cites. */
export const NEEDS_SOURCE = ["Comply", "Comply with Remarks", "Not Comply", "Not Applicable"];

/* Similarity from which an answered library clause is copied without asking the model. */
export const COPY_AT = 0.9;
/* Similarity below which a library clause is not even shown to the model. */
export const SHOW_AT = 0.3;

const PART_NAMES: Record<number, string> = { 0: "Part not known", 1: "Part 1 General", 2: "Part 2 Products", 3: "Part 3 Execution" };

export { splitComments };

/* The standard wording for whatever the model or a library line says ("comply w/ remarks" -> "Comply with Remarks"). */
export function standardChoice(v: unknown): string {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!s) return "";
  if (/^not ?comp|^non ?compl|^does not comply/.test(s) || /deviat/.test(s)) return "Not Comply";
  if (/not applicable|^n a$|^na$/.test(s)) return "Not Applicable";
  if (/contractor|^by others|site work/.test(s)) return "In Contractor's Scope";
  if (/^comply with|^comply w|^complied with|remark|^partial/.test(s)) return "Comply with Remarks";
  if (/^compl(y|ied|iant|ies)\b|^yes$/.test(s)) return "Comply";
  if (/^noted|^note$|^as noted|^acknowledg/.test(s)) return "Noted";
  const hit = CHOICES.find((c) => c.toLowerCase() === s);
  return hit || "";
}

/* The fixed frame (reply format, the six answers, the source contract, the number rule: what code relies on) around
   the brief, which is the Instructions branch of the AI map (map.ts DEFAULT_INSTRUCTIONS when the map has none). */
export function systemPrompt(product: string, factory: string, instructions?: Section[] | null): string {
  return `${instructionsText(instructions || null, product, factory)}

REPLY (fixed by the site)
Answer with ONE JSON object and nothing else:
{"cites": ["<the ids of the sources you used, first>"], "reason": "<one sentence a reviewer can check: what those sources say and what needs checking>", "compliance": "<one of the six answers, or empty>", "remarks": "<one or two short sentences for the consultant, or empty>", "confidence": "high" | "medium" | "low"}
Work in that order: find the sources that apply, say what they show, then choose the answer they support.
The six answers, written exactly: ${CHOICES.map((c) => '"' + c + '"').join(", ")}.
SOURCES: every source in the message has an id in square brackets: [D] project datasheet row, [L] library answer, [O] Product Options of the factory, [N] AI note, [K] knowledge map, [R] rule, [C] rule of this clause, [F] factory fact, [M] a correction people made to an AI answer on a similar clause, [E] an answer given earlier in this specification, [P] an answer in another project. Nothing else is a source: not your general knowledge, not the clause itself.
- "Comply", "Comply with Remarks", "Not Comply" and "Not Applicable" must cite at least one id that supports them.
- "Noted" and "In Contractor's Scope" may cite "I" (these instructions) when no source applies.
- If no source supports any answer, reply {"compliance": "", "remarks": "", "reason": "<what is missing>", "confidence": "low", "cites": []}: the clause goes to a person. That is a correct answer, not a failure.
- A correction [M] shows what a person answered instead of the AI on a similar clause: follow the person, not the AI.
Never write a number with a unit (mm, kW, Pa, m/s, %, hours ...) that is not in a source you cite: the clause says what is REQUIRED, not what the product IS. Write "[value]" where an unknown value belongs and set confidence "low".`;
}

/* The reply's shape, held by Workers AI where the model supports JSON mode: a small model cannot then answer
   outside the six answers or leave a field out. Sources come first so the answer follows from them. */
export const REPLY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    cites: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    compliance: { type: "string", enum: [...CHOICES, ""] },
    remarks: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  },
  required: ["cites", "reason", "compliance", "remarks", "confidence"]
};

/* What the brief is, for the drafts: the code's version, or the map's (a change to the map makes a new one). */
export function promptVersionOf(instructions?: Section[] | null): string {
  if (!instructions || !instructions.length) return PROMPT_VERSION;
  let h = 0;
  for (const ch of JSON.stringify(instructions)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return "map-" + (h >>> 0).toString(16).padStart(8, "0");
}

/* A block of sources; an empty one is left out of the prompt (a small model reads every "(none)" as something). */
function block(title: string, lines: string[]): string {
  return lines.length ? `${title}:\n${lines.join("\n")}` : "";
}

/* One source the model may cite. id = what the prompt shows ([D1]); kind = the letter; ref = what it points at
   (row key, library line, rule id ...) for the stored sources; text = what is shown; trust = what a figure in the
   remark may come from; answer = the answer it gives, when it gives one. */
export interface EvItem { id: string; kind: string; ref: string; label: string; text: string; trust: string; score: number; answer: string }

/* Every source of a clause, numbered as the prompt shows them. The same list checks the reply. */
export function evidenceOf(d: DraftInput): EvItem[] {
  const out: EvItem[] = [];
  const n: Record<string, number> = {};
  const add = (kind: string, ref: string, label: string, text: string, trust: string, score = 1, answer = "") => {
    n[kind] = (n[kind] || 0) + 1;
    out.push({ id: kind + n[kind], kind, ref, label, text, trust, score, answer });
  };
  const own = splitComments(d.comments);
  own.rules.forEach((r, i) => add("C", "clause-rule-" + (i + 1), "the clause's AI rule", r.slice(0, 400), r));
  (d.rules || []).forEach((h) => add("R", h.rule.id, `rule "${h.rule.title || h.rule.instruction.slice(0, 50)}"`,
    `${h.rule.title ? h.rule.title + ": " : ""}${h.rule.instruction.slice(0, 500)}` + (h.rule.answer ? ` [answer: ${h.rule.answer}]` : "") + (h.rule.remark ? ` [remark: ${h.rule.remark.slice(0, 300)}]` : ""),
    `${h.rule.instruction} ${h.rule.remark}`, 1, standardChoice(h.rule.answer)));
  (d.datasheet || []).forEach((f) => add("D", f.key, `datasheet ${f.label}`, `${f.label}: ${f.value}`, `${f.label} ${f.value}`));
  d.similar.filter((x) => x.score >= SHOW_AT).slice(0, 3).forEach((x) => {
    const c = splitComments(x.comments);
    add("L", x.id, `library answer (${x.score.toFixed(2)})`,
      `(similarity ${x.score.toFixed(2)}) Clause: ${x.spec_text.slice(0, 600)}\n   Compliance: ${x.compliance || "(no answer yet)"}\n   Remarks: ${x.remarks || "(none)"}` +
      (c.note ? `\n   Internal note: ${c.note.slice(0, 300)}` : "") + (c.rules.length ? `\n   AI rules: ${c.rules.join(" | ").slice(0, 400)}` : ""),
      `${x.compliance} ${x.remarks} ${x.comments}`, x.score, x.status === "answered" ? standardChoice(x.compliance) : "");
  });
  (d.facts || []).forEach((h) => add("F", h.rule.id, `fact "${h.rule.title || h.rule.instruction.slice(0, 50)}"`, `${h.rule.title ? h.rule.title + ": " : ""}${h.rule.instruction.slice(0, 400)}`, `${h.rule.title} ${h.rule.instruction}`));
  (d.options || []).forEach((t, i) => add("O", "options-" + (i + 1), "Product Options", t.slice(0, 400), t));
  (d.notes || []).forEach((t, i) => add("N", "note-" + (i + 1), "AI note", t.slice(0, 500), t));
  (d.knowledge || []).forEach((t, i) => add("K", "knowledge-" + (i + 1), "knowledge map", t.slice(0, 700), t));
  (d.corrections || []).forEach((c, i) => add("M", "correction-" + (i + 1), `a correction people made (${c.score.toFixed(2)})`,
    `(similarity ${c.score.toFixed(2)}) Clause: ${c.spec.slice(0, 500)}\n   The AI answered: ${c.suggested}${c.suggested_remarks ? " | " + c.suggested_remarks.slice(0, 200) : ""}\n   A person answered instead: ${c.final}${c.final_remarks ? " | " + c.final_remarks.slice(0, 300) : ""}`,
    `${c.final} ${c.final_remarks}`, c.score, standardChoice(c.final)));
  (d.inSection || []).forEach((t, i) => add("E", "earlier-" + (i + 1), "an earlier answer in this specification", t, t));
  (d.project || []).forEach((x) => add("P", x.where, `an answer in ${x.where}`,
    `(similarity ${x.score.toFixed(2)}) Clause: ${x.spec.slice(0, 400)}\n   Compliance: ${x.compliance}\n   Remarks: ${x.remarks || "(none)"}`, `${x.compliance} ${x.remarks}`, x.score, standardChoice(x.compliance)));
  return out;
}

export function userPrompt(d: DraftInput): string {
  const own = splitComments(d.comments);
  const ev = evidenceOf(d);
  const of = (k: string) => ev.filter((e) => e.kind === k).map((e) => `[${e.id}] ${e.text}`);
  const parts: string[] = [];
  parts.push(`Clause (${PART_NAMES[d.part] || PART_NAMES[0]} / ${d.section || "no section"}, label ${d.sr || "-"}):\n${d.clause.slice(0, 3000)}`);
  if (d.parent) parts.push(`Parent clause (this clause continues it):\n${d.parent.slice(0, 600)}`);
  if (d.sectionKind) parts.push(`Kind of section (learned from ${d.sectionAnswers || 0} answers people gave in this section): ${d.sectionKind}. ${SECTION_GUIDANCE[d.sectionKind]}`);
  if ((d.absent || []).length) parts.push(`Not in this unit: the project's datasheet has no ${d.absent!.join(", ")} section. The selected unit may not include it. Do not answer Comply on configuration grounds: unless a library answer shows how such a clause is answered, set confidence "low" and say in the reason which section is missing (whether to offer it is a commercial question).`);
  if (!ev.length) parts.push(`Sources on file for this clause: none. Only "Noted" or "In Contractor's Scope" (citing "I") can be answered without a source; otherwise reply with an empty compliance.`);
  parts.push(block("AI rules for this clause (library team, follow them)", of("C")));
  if (own.note) parts.push(`Internal note for this clause (library team, guidance, never quote it): ${own.note}`);
  parts.push(block("Site rules that apply to this clause", of("R")));
  const units = (d.units || []).filter(Boolean);
  parts.push(block(`Project datasheet rows${units.length ? " (units: " + units.join(", ") + ")" : ""}`, of("D")));
  parts.push(block("Library answers of this factory for similar clauses (best match first, similarity 0..1)", of("L")));
  if (of("F").length) parts.push(block(`Factory facts (${d.product}, standard offering)`, of("F")));
  parts.push(block(`Product Options of the ${d.factory} factory for this clause (values seen on its datasheets, special options, notes)`, of("O")));
  parts.push(block("AI notes (library team, facts about the product)", of("N")));
  if (of("K").length) parts.push(block("Knowledge maps (process and product understanding, verified)", of("K")));
  if (of("M").length) parts.push(block("Corrections people made to the AI's answers on similar clauses (the person is right; follow the person)", of("M")));
  if (d.conflict) parts.push("Conflict: " + d.conflict + " The project's datasheet wins.");
  parts.push(block("Answers given earlier in this section of this specification (keep to them)", of("E")));
  parts.push(block("Answers to similar clauses in other projects of this factory", of("P")));
  return parts.filter(Boolean).join("\n\n");
}

interface Reply { compliance?: unknown; remarks?: unknown; reason?: unknown; confidence?: unknown; cites?: unknown }
type Checked = { ok: true; j: Reply; compliance: string; cited: EvItem[]; declined: boolean } | { ok: false; why: string; noSource?: boolean };

/* The reply checked against the contract: JSON, one of the six (or empty = declined), and the ids it cites. */
function checkReply(text: string, ev: EvItem[], strict: boolean): Checked {
  const j = firstJson<Reply>(text);
  if (!j) return { ok: false, why: "the reply was not one JSON object" };
  const raw = String(j.compliance ?? "").trim();
  const ids = new Map(ev.map((e) => [e.id.toUpperCase(), e]));
  const list = Array.isArray(j.cites) ? j.cites : String(j.cites ?? "").split(/[,;\s]+/);
  const cited = [...new Set(list.map((c) => String(c).replace(/[^A-Za-z0-9]/g, "").toUpperCase()).filter(Boolean))]
    .map((c) => ids.get(c)).filter((e): e is EvItem => !!e);
  if (!raw) return { ok: true, j, compliance: "", cited, declined: true };
  const compliance = standardChoice(raw);
  if (!compliance) return { ok: false, why: `"${raw.slice(0, 40)}" is not one of the six answers` };
  if (strict && NEEDS_SOURCE.includes(compliance) && !cited.length)
    return { ok: false, noSource: true, why: `"${compliance}" cites no source id from the message (${ev.length ? ev.map((e) => e.id).join(", ") : "there is none"})` };
  return { ok: true, j, compliance, cited, declined: false };
}

/* The draft for one clause. Throws (with a message for the person) when no usable draft can be made. */
export async function draftAnswer(env: Env, d: DraftInput, usage?: AiUsage): Promise<Draft> {
  const own = splitComments(d.comments);
  const best = d.similar[0];
  const copyAt = d.copyAt || COPY_AT;
  const modelOk = d.allowModel !== false;

  // 1. the datasheet settled it by code (a clause rule sends it to the model first, when the model may be used)
  const dd = d.datasheetDecision;
  if (dd && (!own.rules.length || !modelOk)) {
    return { compliance: dd.compliance, remarks: dd.remarks, confidence: dd.confidence || (dd.compliance === "Comply with Remarks" ? "medium" : "high"), source: "datasheet", model: "", promptVersion: RULE_VERSION,
      reason: (d.conflict ? d.conflict + " " : "") + dd.reason,
      sources: (d.datasheet || []).filter((f) => dd.keys.includes(f.key)).map((f) => ({ kind: "datasheet", id: f.key, text: `${f.label}: ${f.value}`.slice(0, 200), score: 1 })) };
  }

  // 1. near-identical library answer (its words in the standard form)
  // (an answer written in other words, "EC plug fan" in the Compliance column, goes to the model instead)
  const bestChoice = best ? standardChoice(best.compliance) : "";
  // (nor is a library line copied that carries its own "#" rules, e.g. "# project-specific, do not reuse")
  if (best && best.score >= copyAt && best.status === "answered" && !own.rules.length && !splitComments(best.comments).rules.length && bestChoice && !d.conflict) {
    return { compliance: bestChoice, remarks: best.remarks, confidence: "high", source: "library-similar", model: "", promptVersion: "",
      reason: `Same requirement as a library clause answered "${bestChoice}" (similarity ${best.score.toFixed(2)}).`,
      sources: [{ kind: "clause", id: best.id, text: best.spec_text.slice(0, 200), score: best.score }] };
  }

  // 3. the same clause, answered by a person earlier in this record
  const rc = d.record && !own.rules.length ? d.record : null;
  const rcChoice = rc ? standardChoice(rc.compliance) : "";
  if (rc && rcChoice) {
    return { compliance: rcChoice, remarks: rc.remarks, confidence: "high", source: "record", model: "", promptVersion: RULE_VERSION,
      reason: `Same clause as your answer to ${rc.where}${rc.by ? " (" + rc.by + ")" : ""} in this specification.`,
      sources: [{ kind: "record", id: rc.where, text: rc.spec.slice(0, 200), score: rc.score }] };
  }

  // 4. an AI rule that answers by itself
  const direct = own.rules.length || d.useRules === false ? null : directRule(d.rules || []);
  if (direct) {
    const r = direct.rule;
    const ans = standardChoice(r.answer) || r.answer;
    return { compliance: ans, remarks: trimAnswerEcho(ans, r.remark), confidence: "high", source: "rule", model: "", promptVersion: RULE_VERSION,
      reason: `Site rule "${r.title || r.instruction.slice(0, 60)}"` + (direct.matched.length ? ` (clause mentions ${direct.matched.slice(0, 3).join(", ")}).` : ` (every ${r.part ? "Part " + r.part + " " : ""}clause).`),
      sources: [{ kind: "rule", id: r.id, text: (r.title || r.instruction).slice(0, 200), score: 1 }] };
  }

  // 5. the same clause answered in another project of this factory (below the library: not yet approved)
  const pjAt = copyAt <= 1 ? copyAt : COPY_AT;   // (the library step switched off does not switch this one off)
  const pj = !own.rules.length ? (d.project || []).find((x) => x.score >= pjAt && standardChoice(x.compliance)) : undefined;
  if (pj) {
    return { compliance: standardChoice(pj.compliance), remarks: pj.remarks, confidence: "medium", source: "project", model: "", promptVersion: RULE_VERSION,
      reason: `Same requirement as a project answer${pj.by ? " by " + pj.by : ""} (${pj.where})${pj.pending ? ", not yet approved for the library" : ""}.`,
      sources: [{ kind: "project", id: pj.where, text: pj.spec.slice(0, 200), score: pj.score }] };
  }

  // the free sources did not settle it: a datasheet decision still beats nothing
  if (!modelOk) {
    if (dd) return draftAnswer(env, { ...d, comments: own.note, allowModel: false }, usage);
    throw new NoFreeAnswer("The model is off or today's AI budget is used up, and nothing free answers this clause.");
  }

  // strict: a Part 2 clause with nothing on file is not sent to the model (it could only guess)
  const ev = evidenceOf(d);
  const strict = !d.unsourced;
  if (strict && d.part === 2 && !ev.length && !d.datasheetDecision)
    throw new NeedsSource("No source on file for this clause (no datasheet row, library answer, Product Options entry, AI note, map branch, rule or earlier answer). Left for a person.");

  // 6. the model, once more if its first reply cannot be used (not JSON, not one of the six, or no source cited)
  const sys = systemPrompt(d.product, d.factory, d.instructions), user = userPrompt(d);
  const model = draftModel(d.model);
  let text = await complete(env, model, sys, user, usage, 500, REPLY_SCHEMA);
  let got = checkReply(text, ev, strict);
  if (!got.ok) {
    const again = got.noSource
      ? `\n\nYour previous reply could not be used: ${got.why}. Cite the ids of the sources that support your answer, or, if none does, reply with an empty "compliance" and say in "reason" what is missing.`
      : `\n\nYour previous reply could not be used: ${got.why}. Reply again with ONE JSON object only, "compliance" being one of: ${CHOICES.join(", ")}, and "cites" the ids you used.`;
    text = await complete(env, model, sys, user + again, usage, 500, REPLY_SCHEMA);
    got = checkReply(text, ev, strict);
    if (!got.ok) {
      if (got.noSource) throw new NeedsSource("No source supports an answer (the model cited none). Left for a person.");
      throw new Error("The model did not give a usable answer (" + got.why + ").");
    }
  }
  const { j, compliance, cited } = got;
  if (got.declined) throw new NeedsSource("No source supports an answer: " + (String(j.reason ?? "").trim().slice(0, 300) || "the model found none") + " Left for a person.");

  // code checks
  const notes: string[] = [];
  let remarks = trimAnswerEcho(compliance, String(j.remarks ?? "").trim()).slice(0, 4000);
  // a figure must come from a source it cites (from any source shown when it cites none: Noted / In Contractor's Scope)
  const trust = (cited.length ? cited : ev).map((e) => e.trust).join(" \n ");
  const g = groundRemarks(remarks, trust);
  remarks = g.remarks;
  if (g.unsupported.length) notes.push(`no cited source gives ${g.unsupported.join(", ")}, check the value`);
  const hedged = hedges(remarks);
  if (hedged) notes.push("the remark is not definite");
  if (NEEDS_SOURCE.includes(compliance) && !cited.length) notes.push("no source cited");

  if (compliance === "Not Comply") {
    const backed = cited.some((e) => ["D", "O"].includes(e.kind) || e.answer === "Not Comply" ||
      (["R", "C", "N", "K", "F"].includes(e.kind) && /not comply|deviat|cannot|can not|not available|not offered|not possible/i.test(e.text)));
    if (!backed) throw new Error("The model said Not Comply with no rule, datasheet row, library answer or Product Options entry behind it; answer this clause yourself.");
  }

  const conf = String(j.confidence || "").toLowerCase();
  const libraryBacked = cited.some((e) => e.kind === "L" && e.score >= 0.6 && e.answer === compliance) || !!(dd && dd.compliance === compliance);
  const ruleBacked = cited.some((e) => e.kind === "C" || (e.kind === "R" && e.answer === compliance));
  const correctionBacked = cited.some((e) => e.kind === "M" && e.score >= 0.6 && e.answer === compliance);
  const sheetBacked = cited.some((e) => e.kind === "D");
  let confidence: Draft["confidence"] = conf === "high" && (libraryBacked || ruleBacked || correctionBacked || sheetBacked) ? "high" : conf === "high" || conf === "medium" ? "medium" : "low";
  if (g.unsupported.length || hedged || remarks.includes("[value]") || (NEEDS_SOURCE.includes(compliance) && !cited.length)) confidence = "low";
  if ((d.absent || []).length && /^Comply/.test(compliance) && !libraryBacked && !ruleBacked) {
    confidence = "low"; notes.push(`the datasheet has no ${d.absent!.join(", ")} section`);
  }

  const lead = own.rules.length ? "Followed the clause's AI rule. " : "";
  const base = String(j.reason ?? "").trim().slice(0, 400) || "Drafted by the model from the sources shown to it.";
  const used = cited.length ? " Used: " + cited.map((e) => e.label).join("; ") + "." : "";
  return {
    compliance, remarks, confidence, source: "model", model, promptVersion: promptVersionOf(d.instructions),
    reason: (lead + base + used + (notes.length ? " Check: " + notes.join("; ") + "." : "")).slice(0, 700),
    sources: cited.map((e) => ({ kind: KIND_NAMES[e.kind] || e.kind, id: e.ref, text: e.text.slice(0, 200), score: e.score }))
  };
}

const KIND_NAMES: Record<string, string> = { D: "datasheet", L: "clause", O: "options", N: "note", K: "knowledge", R: "rule", C: "clause-rule", F: "fact", M: "correction", E: "record", P: "project" };
