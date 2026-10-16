/* Drafting one answer. The order (owner's decision, 16 Oct 2026; written out in the AI map, "How the AI decides"):
     1. the project's datasheet, compared by code (evidence.ts)  -> no model                    (source datasheet)
     2. a library clause at or above the copy threshold          -> copied, no model           (source library-similar)
     3. the same clause answered by a person in this record      -> proposed again, no model   (source record)
     4. an AI rule with a fixed answer and remark                -> applied, no model          (source rule)
     5. the same clause answered in another project              -> proposed, no model         (source project)
     6. the model, given everything                              -> checked by code            (source model)
   A clause with its own AI rules ("#" in Internal Comments) goes to the model with the rules in front (when the
   model may be used). The prompt is worker/src/ai/prompts/draft.md (PROMPT_VERSION below; stored on every draft).
   After the model: guard.ts (numbers, echo, hedging), standard wording, Not Comply needs a source, one retry. */
import type { Env } from "../env";
import { CHOICES } from "../lib/cm";
import { complete, firstJson, MODELS, type AiUsage } from "./models";
import type { Similar } from "./search";
import { splitComments, directRule, type RuleHit, type DatasheetField } from "./rules";
import { groundRemarks, trimAnswerEcho, hedges } from "./guard";
import { instructionsText, type Section } from "./map";

export const PROMPT_VERSION = "draft-2026-10-16b";
export const RULE_VERSION = "rule-2026-10-16";

export interface PastAnswerIn { spec: string; compliance: string; remarks: string; by: string; score: number; where: string; pending: boolean }
export interface DraftInput {
  clause: string; sr: string; part: number; section: string; parent?: string; product: string; factory: string;
  similar: Similar[]; comments: string;
  rules?: RuleHit[]; facts?: RuleHit[]; datasheet?: DatasheetField[]; units?: string[];
  // from evidence.ts
  datasheetDecision?: { compliance: string; remarks: string; reason: string; keys: string[] } | null;
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
}
export type DraftSource = "datasheet" | "library-similar" | "record" | "rule" | "project" | "model";
export interface Draft {
  compliance: string; remarks: string; reason: string; confidence: "high" | "medium" | "low";
  source: DraftSource; sources: { kind: string; id: string; text: string; score: number }[]; model: string; promptVersion: string;
}

/* Thrown when only the model could answer and it may not be used: the clause is left as it is. */
export class NoFreeAnswer extends Error { constructor(why: string) { super(why); this.name = "NoFreeAnswer"; } }

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

/* The fixed frame (reply format, the six answers, the number rule: what code relies on) around the brief, which is
   the Instructions branch of the AI map (map.ts DEFAULT_INSTRUCTIONS when the map has none). */
export function systemPrompt(product: string, factory: string, instructions?: Section[] | null): string {
  return `${instructionsText(instructions || null, product, factory)}

REPLY (fixed by the site)
Answer with ONE JSON object and nothing else:
{"compliance": "<one of the six answers>", "remarks": "<one or two short sentences for the consultant, or empty>", "reason": "<one sentence a reviewer can check: which rule, datasheet row, library answer or fact you used, and what needs checking>", "confidence": "high" | "medium" | "low"}
The six answers, written exactly: ${CHOICES.map((c) => '"' + c + '"').join(", ")}.
Never write a number with a unit (mm, kW, Pa, m/s, %, hours ...) that is not in the sources you are given: the clause says what is REQUIRED, not what the product IS. Write "[value]" where an unknown value belongs and set confidence "low".`;
}

/* What the brief is, for the drafts: the code's version, or the map's (a change to the map makes a new one). */
export function promptVersionOf(instructions?: Section[] | null): string {
  if (!instructions || !instructions.length) return PROMPT_VERSION;
  let h = 0;
  for (const ch of JSON.stringify(instructions)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return "map-" + (h >>> 0).toString(16).padStart(8, "0");
}

function block(title: string, lines: string[]): string {
  return `${title}:\n${lines.length ? lines.join("\n") : "(none)"}`;
}

export function userPrompt(d: DraftInput): string {
  const sim = d.similar.filter((x) => x.score >= SHOW_AT).slice(0, 3);
  const own = splitComments(d.comments);
  const parts: string[] = [];
  parts.push(`Clause (${PART_NAMES[d.part] || PART_NAMES[0]} / ${d.section || "no section"}, label ${d.sr || "-"}):\n${d.clause.slice(0, 3000)}`);
  if (d.parent) parts.push(`Parent clause (this clause continues it):\n${d.parent.slice(0, 600)}`);
  parts.push(block("AI rules for this clause (library team, follow them)", own.rules.map((r, i) => `${i + 1}. ${r.slice(0, 400)}`)));
  parts.push(`Internal note for this clause (library team): ${own.note || "(none)"}`);
  parts.push(block("Site rules that apply to this clause", (d.rules || []).map((h, i) =>
    `${i + 1}. ${h.rule.title ? h.rule.title + ": " : ""}${h.rule.instruction.slice(0, 500)}` +
    (h.rule.answer ? ` [answer: ${h.rule.answer}]` : "") + (h.rule.remark ? ` [remark: ${h.rule.remark.slice(0, 300)}]` : ""))));
  const units = (d.units || []).filter(Boolean);
  parts.push(block(`Project datasheet rows${units.length ? " (units: " + units.join(", ") + ")" : ""}`, (d.datasheet || []).map((f) => `- ${f.label}: ${f.value}`)));
  parts.push(block("Library answers of this factory for similar clauses (best match first, similarity 0..1)", sim.map((x, i) => {
    const c = splitComments(x.comments);
    return `${i + 1}. (similarity ${x.score.toFixed(2)}) Clause: ${x.spec_text.slice(0, 600)}\n   Compliance: ${x.compliance || "(no answer yet)"}\n   Remarks: ${x.remarks || "(none)"}` +
      (c.note ? `\n   Internal note: ${c.note.slice(0, 300)}` : "") + (c.rules.length ? `\n   AI rules: ${c.rules.join(" | ").slice(0, 400)}` : "");
  })));
  if ((d.facts || []).length) parts.push(block(`Factory facts (${d.product}, standard offering)`, (d.facts || []).map((h) => `- ${h.rule.title ? h.rule.title + ": " : ""}${h.rule.instruction.slice(0, 400)}`)));
  parts.push(block(`Product Options of the ${d.factory} factory for this clause (values seen on its datasheets, special options, notes)`, (d.options || []).map((t) => "- " + t.slice(0, 400))));
  parts.push(block("AI notes (library team, facts about the product)", (d.notes || []).map((t) => "- " + t.slice(0, 500))));
  if ((d.knowledge || []).length) parts.push(block("Knowledge maps (process and product understanding, verified)", (d.knowledge || []).map((t) => "- " + t.slice(0, 700))));
  if (d.conflict) parts.push("Conflict: " + d.conflict + " The project's datasheet wins.");
  parts.push(block("Answers given earlier in this section of this specification (keep to them)", (d.inSection || []).map((t) => "- " + t)));
  parts.push(block("Answers to similar clauses in other projects of this factory", (d.project || []).map((x, i) =>
    `${i + 1}. (similarity ${x.score.toFixed(2)}) Clause: ${x.spec.slice(0, 400)}\n   Compliance: ${x.compliance}\n   Remarks: ${x.remarks || "(none)"}`)));
  return parts.join("\n\n");
}

/* Text the model was given as true: a number in a remark must come from here (guard.groundRemarks). */
function trustedText(d: DraftInput): string {
  const own = splitComments(d.comments);
  return [
    own.note, own.rules.join(" "),
    ...(d.rules || []).map((h) => `${h.rule.instruction} ${h.rule.remark}`),
    ...(d.facts || []).map((h) => `${h.rule.title} ${h.rule.instruction}`),
    ...(d.datasheet || []).map((f) => `${f.label} ${f.value}`),
    ...d.similar.filter((x) => x.score >= SHOW_AT).slice(0, 3).map((x) => `${x.compliance} ${x.remarks} ${x.comments}`),
    ...(d.options || []), ...(d.notes || []), ...(d.knowledge || []), ...(d.inSection || []), ...(d.project || []).map((x) => `${x.compliance} ${x.remarks}`),
    d.parent || ""
  ].join(" \n ");
}

function sourcesOf(d: DraftInput): Draft["sources"] {
  return [
    ...(d.rules || []).map((h) => ({ kind: "rule", id: h.rule.id, text: (h.rule.title || h.rule.instruction).slice(0, 200), score: 1 })),
    ...(d.datasheet || []).map((f) => ({ kind: "datasheet", id: f.key, text: `${f.label}: ${f.value}`.slice(0, 200), score: 1 })),
    ...d.similar.filter((x) => x.score >= SHOW_AT).slice(0, 3).map((x) => ({ kind: "clause", id: x.id, text: x.spec_text.slice(0, 200), score: x.score })),
    ...(d.facts || []).map((h) => ({ kind: "fact", id: h.rule.id, text: (h.rule.title || h.rule.instruction).slice(0, 200), score: 1 }))
  ];
}

interface Reply { compliance?: unknown; remarks?: unknown; reason?: unknown; confidence?: unknown }

/* The reply, or why it cannot be used. */
function readReply(text: string): { ok: true; j: Reply; compliance: string } | { ok: false; why: string } {
  const j = firstJson<Reply>(text);
  if (!j) return { ok: false, why: "the reply was not one JSON object" };
  const compliance = standardChoice(j.compliance);
  if (!compliance) return { ok: false, why: `"${String(j.compliance ?? "").slice(0, 40)}" is not one of the six answers` };
  return { ok: true, j, compliance };
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
    return { compliance: dd.compliance, remarks: dd.remarks, confidence: dd.compliance === "Comply with Remarks" ? "medium" : "high", source: "datasheet", model: "", promptVersion: RULE_VERSION,
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
    return { compliance: standardChoice(r.answer) || r.answer, remarks: r.remark, confidence: "high", source: "rule", model: "", promptVersion: RULE_VERSION,
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

  // 6. the model, once more if its first reply cannot be used
  const sys = systemPrompt(d.product, d.factory, d.instructions), user = userPrompt(d);
  let text = await complete(env, MODELS.draft, sys, user, usage, 500);
  let got = readReply(text);
  if (!got.ok) {
    text = await complete(env, MODELS.draft, sys, user + `\n\nYour previous reply could not be used: ${got.why}. Reply again with ONE JSON object only, "compliance" being one of: ${CHOICES.join(", ")}.`, usage, 500);
    got = readReply(text);
    if (!got.ok) throw new Error("The model did not give a usable answer (" + got.why + ").");
  }
  const { j, compliance } = got;

  // code checks
  const notes: string[] = [];
  let remarks = trimAnswerEcho(compliance, String(j.remarks ?? "").trim()).slice(0, 4000);
  const g = groundRemarks(remarks, trustedText(d));
  remarks = g.remarks;
  if (g.unsupported.length) notes.push(`no source gives ${g.unsupported.join(", ")}, check the value`);
  const hedged = hedges(remarks);
  if (hedged) notes.push("the remark is not definite");

  const ds = (d.datasheet || []).length > 0;
  const ruleSays = (re: RegExp) => (d.rules || []).some((h) => re.test(h.rule.answer + " " + h.rule.instruction)) || own.rules.some((r) => re.test(r));
  if (compliance === "Not Comply") {
    const backed = ruleSays(/not comply|deviat|cannot|can not|not available|not offered/i) ||
      d.similar.some((x) => x.score >= SHOW_AT && standardChoice(x.compliance) === "Not Comply") || ds || (d.options || []).length > 0 ||
      [...(d.notes || []), ...(d.knowledge || [])].some((t) => /not (offered|available|possible)|cannot|can not/i.test(t));
    if (!backed) throw new Error("The model said Not Comply with no rule, datasheet row or library answer behind it; answer this clause yourself.");
  }

  const conf = String(j.confidence || "").toLowerCase();
  const libraryBacked = d.similar.some((x) => x.score >= 0.6 && x.status === "answered" && standardChoice(x.compliance) === compliance) ||
    !!(dd && dd.compliance === compliance);
  const ruleBacked = own.rules.length > 0 || (d.rules || []).some((h) => standardChoice(h.rule.answer) === compliance);
  let confidence: Draft["confidence"] = conf === "high" && (libraryBacked || ruleBacked) ? "high" : conf === "high" || conf === "medium" ? "medium" : "low";
  if (g.unsupported.length || hedged || remarks.includes("[value]")) confidence = "low";

  const lead = own.rules.length ? "Followed the clause's AI rule. " : "";
  const base = String(j.reason ?? "").trim().slice(0, 400) || "Drafted by the model from the sources shown to it.";
  return {
    compliance, remarks, confidence, source: "model", model: MODELS.draft, promptVersion: promptVersionOf(d.instructions),
    reason: (lead + base + (notes.length ? " Check: " + notes.join("; ") + "." : "")).slice(0, 600),
    sources: sourcesOf(d)
  };
}
