/* Drafting one answer (Feature B, drafting part). The prompt is worker/src/ai/prompts/draft.md; this file
   fills it, calls the 70B model and checks the JSON. Code decides the standard wording of Compliance. */
import type { Env } from "../env";
import { CHOICES } from "../lib/cm";
import { complete, firstJson, MODELS, type AiUsage } from "./models";
import type { Similar } from "./search";

export interface DraftInput {
  clause: string; sr: string; part: number; section: string; product: string; factory: string;
  similar: Similar[]; comments: string;
}
export interface Draft {
  compliance: string; remarks: string; reason: string; confidence: "high" | "medium" | "low";
  source: "library-similar" | "model"; sources: { kind: string; id: string; text: string; score: number }[]; model: string;
}

/* Similarity from which an answered library clause is copied without asking the model. */
export const COPY_AT = 0.9;
/* Similarity below which a library clause is not even shown to the model. */
export const SHOW_AT = 0.3;

const PART_NAMES: Record<number, string> = { 0: "Part not known", 1: "Part 1 General", 2: "Part 2 Products", 3: "Part 3 Execution" };

/* The standard wording for whatever the model wrote ("comply w/ remarks" -> "Comply with Remarks"). */
export function standardChoice(v: unknown): string {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!s) return "";
  if (/^not ?comp/.test(s) || /deviat/.test(s)) return "Not Comply";
  if (/^comply with|^comply w|remark/.test(s)) return "Comply with Remarks";
  if (/^comply|^compliant|^yes$/.test(s)) return "Comply";
  if (/not applicable|^n a$|^na$/.test(s)) return "Not Applicable";
  if (/contractor|^by others|site work/.test(s)) return "In Contractor's Scope";
  if (/^noted|^note$|^acknowledg/.test(s)) return "Noted";
  const hit = CHOICES.find((c) => c.toLowerCase() === s);
  return hit || "";
}

export function systemPrompt(product: string, factory: string): string {
  return `You are a senior application engineer at a ${product} factory (${factory}) of an HVAC manufacturer, answering a client's technical specification clause by clause for a compliance statement.

Answer with ONE JSON object and nothing else:
{"compliance": "<one of the standard answers>", "remarks": "<one or two short sentences for the client, or empty>", "reason": "<one sentence a reviewer can check, naming the library answer or fact you relied on>", "confidence": "high" | "medium" | "low"}

Standard answers: "Comply" (the product meets the clause as written), "Comply with Remarks" (meets it with a stated difference or condition, say it in remarks), "Noted" (an instruction, a description or a general statement with nothing to comply with), "Not Comply" (cannot be met; say why in remarks), "Not Applicable" (not about this product or this scope), "In Contractor's Scope" (installation, site work, testing on site, submittals by others).

Rules:
- Use the library answers given below whenever one covers the same requirement; copy their wording and facts. Internal comments are notes from the library team to you; follow them, never copy them to the client.
- When no library answer covers the clause, answer from general knowledge of this kind of equipment, keep remarks short and factual, and set confidence to "low". Never invent a number, a certificate or a test report.
- Part 1 (General) clauses are mostly "Noted" or "In Contractor's Scope"; Part 3 (Execution) clauses are mostly "In Contractor's Scope" or "Noted". Part 2 (Products) clauses describe the unit and need a real answer.
- Remarks are written to the client: plain, professional.
- Confidence "high" only when a library answer covers the requirement directly.`;
}

export function userPrompt(d: DraftInput): string {
  const sim = d.similar.filter((x) => x.score >= SHOW_AT).slice(0, 3);
  const list = sim.length ? sim.map((x, i) =>
    `${i + 1}. (similarity ${x.score.toFixed(2)}) Clause: ${x.spec_text.slice(0, 600)}\n   Compliance: ${x.compliance || "(no answer yet)"}\n   Remarks: ${x.remarks || "(none)"}` +
    (x.comments ? `\n   Internal comment: ${x.comments.slice(0, 300)}` : "")).join("\n") : "(none)";
  return `Clause (${PART_NAMES[d.part] || PART_NAMES[0]} / ${d.section || "no section"}, label ${d.sr || "-"}):\n${d.clause.slice(0, 3000)}\n\nLibrary answers of this factory for similar clauses (best match first, similarity 0..1):\n${list}\n\nInternal comments for this clause (library team): ${d.comments || "(none)"}`;
}

/* The draft for one clause: a copy of a near-identical library answer, or the model's draft. */
export async function draftAnswer(env: Env, d: DraftInput, usage?: AiUsage): Promise<Draft> {
  const best = d.similar[0];
  if (best && best.score >= COPY_AT && best.status === "answered") {
    return { compliance: best.compliance, remarks: best.remarks, confidence: "high", source: "library-similar", model: "",
      reason: `Same requirement as a library clause answered "${best.compliance}" (similarity ${best.score.toFixed(2)}).`,
      sources: [{ kind: "clause", id: best.id, text: best.spec_text.slice(0, 200), score: best.score }] };
  }
  const text = await complete(env, MODELS.draft, systemPrompt(d.product, d.factory), userPrompt(d), usage, 500);
  const j = firstJson<{ compliance?: unknown; remarks?: unknown; reason?: unknown; confidence?: unknown }>(text);
  if (!j) throw new Error("The model did not answer with JSON: " + text.slice(0, 120));
  const compliance = standardChoice(j.compliance);
  if (!compliance) throw new Error("The model gave no standard answer: " + String(j.compliance).slice(0, 60));
  const conf = String(j.confidence || "").toLowerCase();
  const confidence: Draft["confidence"] = conf === "high" && d.similar.some((x) => x.score >= 0.6 && x.status === "answered") ? "high" : conf === "high" || conf === "medium" ? "medium" : "low";
  return {
    compliance, remarks: String(j.remarks ?? "").trim().slice(0, 4000), reason: String(j.reason ?? "").trim().slice(0, 400) || "Drafted by the model from the library answers shown to it.",
    confidence, source: "model", model: MODELS.draft,
    sources: d.similar.filter((x) => x.score >= SHOW_AT).slice(0, 3).map((x) => ({ kind: "clause", id: x.id, text: x.spec_text.slice(0, 200), score: x.score }))
  };
}
