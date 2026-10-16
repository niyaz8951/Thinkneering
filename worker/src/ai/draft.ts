/* Drafting one answer. The order (Design brief: deterministic first, the model last):
     1. a near-identical (>= 0.90) answered library clause      -> copied, no model      (source library-similar)
     2. a site rule with a fixed answer and remark that applies  -> applied, no model     (source rule)
     3. the model, given everything below                        -> checked by code      (source model)
   A clause with its own AI rules ("#" in Internal Comments) always goes to the model, with the rules in front.
   What the model sees, strongest first: the clause's own rules, the site rules, the project's datasheet rows,
   the library answers of similar clauses, the factory's facts. The prompt is worker/src/ai/prompts/draft.md
   (PROMPT_VERSION below; stored on every draft). After the model: guard.ts (numbers, echo, hedging),
   standard wording, Not Comply needs a source, one retry when the reply is unusable. */
import type { Env } from "../env";
import { CHOICES } from "../lib/cm";
import { complete, firstJson, MODELS, type AiUsage } from "./models";
import type { Similar } from "./search";
import { splitComments, directRule, type RuleHit, type DatasheetField } from "./rules";
import { groundRemarks, trimAnswerEcho, hedges } from "./guard";

export const PROMPT_VERSION = "draft-2026-10-16";
export const RULE_VERSION = "rule-2026-10-16";

export interface DraftInput {
  clause: string; sr: string; part: number; section: string; parent?: string; product: string; factory: string;
  similar: Similar[]; comments: string;
  rules?: RuleHit[]; facts?: RuleHit[]; datasheet?: DatasheetField[]; units?: string[];
}
export type DraftSource = "library-similar" | "rule" | "model";
export interface Draft {
  compliance: string; remarks: string; reason: string; confidence: "high" | "medium" | "low";
  source: DraftSource; sources: { kind: string; id: string; text: string; score: number }[]; model: string; promptVersion: string;
}

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

export function systemPrompt(product: string, factory: string): string {
  return `You are a senior application engineer at the ${factory} ${product} factory of Daikin, answering a consultant's specification clause by clause for a compliance statement that is submitted under the company's name.

Accuracy first. A false "Comply" is the worst mistake; a draft marked low confidence is better than a confident wrong one.

Answer with ONE JSON object and nothing else:
{"compliance": "<one of the six answers>", "remarks": "<one or two short sentences for the consultant, or empty>", "reason": "<one sentence a reviewer can check: which rule, datasheet row, library answer or fact you used>", "confidence": "high" | "medium" | "low"}

The six answers:
- "Comply": the product meets the clause as written.
- "Comply with Remarks": it meets the intent but what is offered differs from the wording, or a condition applies. The remark states WHAT IS OFFERED ("Offered units are with 62 mm double-wall panels."). This is the most common answer in a real compliance sheet.
- "Noted": an instruction, a description or a general statement with nothing to comply with.
- "Not Comply": it cannot be met. Only when a rule, a datasheet row or a library answer says so; never from a guess.
- "Not Applicable": the clause does not apply to this product or selection (a belt-drive clause on a direct-drive EC fan unit). Say why in a few words.
- "In Contractor's Scope": installation, rigging, site work, site testing, connections, commissioning labour, work by others.

Sources, strongest first; use the first that settles the clause:
1. AI rules for this clause, from the library team: follow them.
2. Site rules: instructions for clauses like this one, written by the library team: follow them when they fit the clause.
3. Project datasheet rows: the actual values of the units selected for this project. They win over everything below.
4. Library answers of similar clauses (this factory, already checked): copy their answer and wording when they cover the same requirement.
5. Factory facts: what this factory offers as standard. Quote them when the clause asks about that subject.
6. General knowledge of this kind of equipment, only for the kind of answer, never for a value; then confidence is "low".

Hard rules:
- Never write a number with a unit (mm, kW, Pa, m/s, %, hours ...) that is not in a source above. The clause says what is REQUIRED; it does not say what the product IS. If the clause asks for 50 mm and no source gives a thickness, you do not know the thickness: write "[value]" where the value belongs and set confidence "low".
- A clause with a "Parent clause" is a list item continuing it: read them together.
- The remark continues the answer; never start it with the answer's words. "In Contractor's Scope" + "Installation by the contractor." is right; "In Contractor's Scope. In contractor's scope ..." is wrong.
- Remarks are for the consultant: plain, definitive, short. Never use should, approximately, typically, likely, expected. Never mention datasheets, selection reports, libraries, rules, internal notes or file names: state the value or the fact itself.
- Internal notes explain past answers; use them, never quote them.
- Part 1 (General) clauses are mostly "Noted" or "In Contractor's Scope"; Part 3 (Execution) mostly "In Contractor's Scope" or "Noted"; Part 2 (Products) describes the unit and needs a real answer.
- "high" confidence only when a rule, a datasheet row or a library answer covers the requirement directly.`;
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
  parts.push(block(`Factory facts (${d.product}, standard offering)`, (d.facts || []).map((h) => `- ${h.rule.title ? h.rule.title + ": " : ""}${h.rule.instruction.slice(0, 400)}`)));
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

  // 1. near-identical library answer (its words in the standard form)
  // (an answer written in other words, "EC plug fan" in the Compliance column, goes to the model instead)
  const bestChoice = best ? standardChoice(best.compliance) : "";
  // (nor is a library line copied that carries its own "#" rules, e.g. "# project-specific, do not reuse")
  if (best && best.score >= COPY_AT && best.status === "answered" && !own.rules.length && !splitComments(best.comments).rules.length && bestChoice) {
    return { compliance: bestChoice, remarks: best.remarks, confidence: "high", source: "library-similar", model: "", promptVersion: "",
      reason: `Same requirement as a library clause answered "${bestChoice}" (similarity ${best.score.toFixed(2)}).`,
      sources: [{ kind: "clause", id: best.id, text: best.spec_text.slice(0, 200), score: best.score }] };
  }

  // 2. a site rule that answers by itself
  const direct = own.rules.length ? null : directRule(d.rules || []);
  if (direct) {
    const r = direct.rule;
    return { compliance: standardChoice(r.answer) || r.answer, remarks: r.remark, confidence: "high", source: "rule", model: "", promptVersion: RULE_VERSION,
      reason: `Site rule "${r.title || r.instruction.slice(0, 60)}"` + (direct.matched.length ? ` (clause mentions ${direct.matched.slice(0, 3).join(", ")}).` : ` (every ${r.part ? "Part " + r.part + " " : ""}clause).`),
      sources: [{ kind: "rule", id: r.id, text: (r.title || r.instruction).slice(0, 200), score: 1 }] };
  }

  // 3. the model, once more if its first reply cannot be used
  const sys = systemPrompt(d.product, d.factory), user = userPrompt(d);
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
      d.similar.some((x) => x.score >= SHOW_AT && standardChoice(x.compliance) === "Not Comply") || ds;
    if (!backed) throw new Error("The model said Not Comply with no rule, datasheet row or library answer behind it; answer this clause yourself.");
  }

  const conf = String(j.confidence || "").toLowerCase();
  const libraryBacked = d.similar.some((x) => x.score >= 0.6 && x.status === "answered" && standardChoice(x.compliance) === compliance);
  const ruleBacked = own.rules.length > 0 || (d.rules || []).some((h) => standardChoice(h.rule.answer) === compliance);
  let confidence: Draft["confidence"] = conf === "high" && (libraryBacked || ruleBacked) ? "high" : conf === "high" || conf === "medium" ? "medium" : "low";
  if (g.unsupported.length || hedged || remarks.includes("[value]")) confidence = "low";

  const lead = own.rules.length ? "Followed the clause's AI rule. " : "";
  const base = String(j.reason ?? "").trim().slice(0, 400) || "Drafted by the model from the sources shown to it.";
  return {
    compliance, remarks, confidence, source: "model", model: MODELS.draft, promptVersion: PROMPT_VERSION,
    reason: (lead + base + (notes.length ? " Check: " + notes.join("; ") + "." : "")).slice(0, 600),
    sources: sourcesOf(d)
  };
}
