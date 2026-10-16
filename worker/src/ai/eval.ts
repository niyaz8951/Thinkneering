/* Check the AI (owner, 16 Oct 2026: "make the 8B model learn patterns"). The model itself does not change; what it is
   told does (rule book, Product Options AI notes, knowledge maps, the library, people's corrections). This measures
   whether that is working: answers people gave in the library of a factory are replayed as if each clause came in a
   new specification, with everything that would give the answer away hidden:
     - the clause's own library line (its answer, remarks, Internal Comments),
     - corrections made on the same clause, and the same clause answered in other projects.
   The AI then answers from everything else, and its answer is compared with the person's.
   Agreement over time, per model and prompt version, is the learning curve (app_audit "ai_eval"). */
import type { Env } from "../env";
import { all } from "../lib/sql";
import { CHOICES, cmNorm } from "../lib/cm";
import { loadContext, evidenceFor, type RunInfo, type RunRowFull } from "./evidence";
import { inputFor, modelAllowed } from "./decide";
import { draftAnswer, NoFreeAnswer, standardChoice, promptVersionOf, type Draft } from "./draft";
import { aiErrorText, draftModel, type AiUsage } from "./models";

export interface EvalLine { id: string; spec_text: string; compliance: string; remarks: string; part: number; section: string; section_sr: string; sr: string; row_type: string }
export interface EvalResult {
  id: string; sr: string; part: number; section: string; spec: string;
  person: { compliance: string; remarks: string };
  ai: { compliance: string; remarks: string; confidence: string; source: string; reason: string } | null;
  why: string; verdict: "agree" | "differ" | "left";
}

const PART_TITLES = ["", "PART 1 - GENERAL", "PART 2 - PRODUCTS", "PART 3 - EXECUTION"];
const WHERE = `factory_id = ? AND status = 'answered' AND compliance IN (${CHOICES.map(() => "?").join(",")}) AND length(spec_text) BETWEEN 40 AND 3000`;

/* n answered library clauses of the factory, at random, none of those already checked in this run. */
export async function pickLines(env: Env, factoryId: string, n: number, seen: string[]): Promise<{ lines: EvalLine[]; total: number }> {
  const [lines, total] = await Promise.all([
    all<EvalLine>(env.DB.prepare(`SELECT id, spec_text, compliance, remarks, part, section, section_sr, sr, row_type FROM cm_lines
                                   WHERE ${WHERE} AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY random() LIMIT ?`)
      .bind(factoryId, ...CHOICES, JSON.stringify(seen), n)),
    env.DB.prepare(`SELECT count(*) AS n FROM cm_lines WHERE ${WHERE}`).bind(factoryId, ...CHOICES).first<{ n: number }>()
  ]);
  return { lines, total: total?.n || 0 };
}

/* The clauses as rows of a specification nobody has answered yet: each under its Part and section heading. */
export function rowsFor(lines: EvalLine[]): { rows: RunRowFull[]; tested: { x: RunRowFull; line: EvalLine }[] } {
  const blank = { line_id: null, compliance: "", remarks: "", ai_draft: 0, answered_by: null, l_status: null, l_compliance: null, l_remarks: null, l_comments: null };
  const rows: RunRowFull[] = [], tested: { x: RunRowFull; line: EvalLine }[] = [];
  // a clause with no Part comes first (a Part heading is never "taken back" by the rows that follow it)
  const sorted = lines.slice().sort((a, b) => (a.part || 0) - (b.part || 0));
  sorted.forEach((l, i) => {
    const base = i * 3 + 1;
    const part = l.part >= 1 && l.part <= 3 ? l.part : 0;
    if (part) rows.push({ seq: base, type: "part", sr: "", spec_text: PART_TITLES[part], ...blank });
    rows.push({ seq: base + 1, type: "section", sr: l.section_sr || "", spec_text: l.section || "", ...blank });
    // the clause keeps its library id only so the library search leaves that line out
    const x: RunRowFull = { seq: base + 2, type: l.row_type || "text", sr: l.sr || "", spec_text: l.spec_text, ...blank, line_id: l.id };
    rows.push(x);
    tested.push({ x, line: l });
  });
  return { rows, tested };
}

export interface EvalRun { results: EvalResult[]; model: string; prompt: string; modelNote: string; stopped: string }

export async function runEval(env: Env, run: RunInfo, lines: EvalLine[], usage: AiUsage, workers = 4): Promise<EvalRun> {
  const { rows, tested } = rowsFor(lines);
  const ctx = await loadContext(env, run, rows, usage, { cache: false });
  const allowed = await modelAllowed(env, ctx);
  const results: EvalResult[] = [];
  let stopped = "";
  const queue = tested.slice();
  async function one(): Promise<void> {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (stopped) return;
      const { x, line } = t;
      const norm = cmNorm(line.spec_text);
      const person = standardChoice(line.compliance) || line.compliance;
      let ai: Draft | null = null, why = "";
      try {
        const ev = await evidenceFor(ctx, x);
        ev.corrections = ev.corrections.filter((c) => cmNorm(c.spec) !== norm);
        ev.project = ev.project.filter((q) => cmNorm(q.spec) !== norm);
        ai = await draftAnswer(env, inputFor(ctx, x, ev, allowed.ok), usage);
      } catch (e) {
        if (e instanceof NoFreeAnswer) why = e.message;
        else {
          const w = aiErrorText(e);
          if (w.stop) { stopped = w.text; return; }      // quota or model gone: this clause is not counted
          why = w.text;
        }
      }
      results.push({
        id: line.id, sr: line.sr || "", part: line.part || 0, section: line.section || "", spec: line.spec_text.slice(0, 400),
        person: { compliance: person, remarks: (line.remarks || "").slice(0, 400) },
        ai: ai ? { compliance: ai.compliance, remarks: ai.remarks.slice(0, 400), confidence: ai.confidence, source: ai.source, reason: ai.reason.slice(0, 500) } : null,
        why: why.slice(0, 300), verdict: !ai ? "left" : ai.compliance === person ? "agree" : "differ"
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, tested.length) }, one));
  return { results, model: allowed.ok ? draftModel(ctx.settings.model) : "", prompt: promptVersionOf(ctx.instructions), modelNote: allowed.ok ? "" : allowed.why, stopped };
}

export function tally(results: EvalResult[]): { tested: number; agree: number; differ: number; left: number; by_source: Record<string, { n: number; agree: number }> } {
  const by: Record<string, { n: number; agree: number }> = {};
  for (const r of results) {
    if (!r.ai) continue;
    const b = by[r.ai.source] || (by[r.ai.source] = { n: 0, agree: 0 });
    b.n++; if (r.verdict === "agree") b.agree++;
  }
  return { tested: results.length, agree: results.filter((r) => r.verdict === "agree").length, differ: results.filter((r) => r.verdict === "differ").length,
           left: results.filter((r) => r.verdict === "left").length, by_source: by };
}
