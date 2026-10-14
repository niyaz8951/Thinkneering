/* ai_* : AI review of a project record (admins of the Projects tile and the super user).
   Principles (AI-Roadmap.md): AI never writes into the library; it writes drafts on the project record
   (cm_run_lines with ai_draft = 1, the reason in ai_drafts) that a person accepts by editing or keeping
   them; every draft carries a reason and its sources; nothing runs on page load; usage is audited.

   ai_review_run(token, run_id, limit, replace)  drafts up to `limit` clauses that show no answer yet
                                                 (or every clause when replace); the page calls it again
                                                 while `remaining` > 0, so a 500-clause record is done in
                                                 batches inside the request limits
   ai_review_status(token, run_id)               counts, for the button and the progress line
   ai_review_clear(token, run_id)                takes every AI draft off the record */
import type { Env } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { sessionUser, audit, type Session } from "../auth";
import { prProject, prLogHourly } from "../lib/project";
import { placeRows } from "../lib/cm";
import { all, now, uuid, int, bool, batched } from "../lib/sql";
import type { RunRow } from "./cm";
import { aiAvailable, NOT_AVAILABLE, type AiUsage } from "../ai/models";
import { ClauseSearch } from "../ai/search";
import { draftAnswer } from "../ai/draft";

interface Row {
  seq: number; type: string; sr: string; spec_text: string; line_id: string | null; compliance: string; remarks: string; ai_draft: number;
  l_status: string | null; l_compliance: string | null; l_remarks: string | null; l_comments: string | null;
  draft_at: string | null;                 // when the row's current AI draft was made (null = no draft)
}

async function runForAdmin(env: Env, s: Session, runId: unknown): Promise<RunRow & { product: string; factory: string; project: string }> {
  s.requirePrAdmin();
  const r = typeof runId === "string" && runId ? await env.DB.prepare(
    "SELECT r.*, p.name AS product, f.name AS factory FROM cm_runs r JOIN cm_products p ON p.id = r.product_id JOIN cm_factories f ON f.id = r.factory_id WHERE r.id = ?")
    .bind(runId).first<RunRow & { product: string; factory: string }>() : null;
  if (!r || !r.project_id) fail("That compliance record is not in a project.");
  const pj = await prProject(env, s, r.project_id);
  return { ...r, project: pj.name };
}

async function rowsOf(env: Env, runId: string): Promise<Row[]> {
  return all<Row>(env.DB.prepare(
    `SELECT rl.seq, rl.type, rl.sr, rl.spec_text, rl.line_id, rl.compliance, rl.remarks, rl.ai_draft,
            l.status AS l_status, l.compliance AS l_compliance, l.remarks AS l_remarks, l.comments AS l_comments,
            (SELECT max(d.created_at) FROM ai_drafts d WHERE d.run_id = rl.run_id AND d.seq = rl.seq AND d.status = 'draft') AS draft_at
       FROM cm_run_lines rl LEFT JOIN cm_lines l ON l.id = rl.line_id WHERE rl.run_id = ? ORDER BY rl.seq`).bind(runId));
}

/* A clause the review may draft: it can be answered, no person answered it, the library has nothing for it.
   With replace, a draft made before `since` is drafted again (one made after it belongs to this review). */
function open(x: Row, replace: boolean, since = ""): boolean {
  if (!x.line_id) return false;
  const human = (x.compliance !== "" || x.remarks !== "") && !x.ai_draft;
  if (human) return false;
  if (x.ai_draft) return replace && (!x.draft_at || x.draft_at < since);
  return x.l_status !== "answered";
}

function counts(rows: Row[]) {
  const can = rows.filter((x) => x.line_id);
  return {
    total: can.length,
    drafts: can.filter((x) => x.ai_draft).length,
    human: can.filter((x) => (x.compliance !== "" || x.remarks !== "") && !x.ai_draft).length,
    library: can.filter((x) => !(x.compliance !== "" || x.remarks !== "") && x.l_status === "answered").length,
    open: can.filter((x) => open(x, false)).length
  };
}

export const routes: Routes = {
  async ai_review_status(env, p) {
    const s = await sessionUser(env, p.p_token);
    const r = await runForAdmin(env, s, p.p_run_id);
    return { ok: true, available: aiAvailable(env), ...counts(await rowsOf(env, r.id)) };
  },

  async ai_review_run(env, p) {
    const s = await sessionUser(env, p.p_token);
    const r = await runForAdmin(env, s, p.p_run_id);
    if (!aiAvailable(env)) fail(NOT_AVAILABLE, 503);
    const limit = Math.min(Math.max(int(p.p_limit, 10), 1), 25), replace = bool(p.p_replace);
    // the page passes `since` back on every call of one review, so re-drafted rows are not drafted again
    const since = /^\d{4}-\d{2}-\d{2}T/.test(String(p.p_since || "")) ? String(p.p_since) : now();
    const rows = await rowsOf(env, r.id);
    const todo = rows.filter((x) => open(x, replace, since));
    const batch = todo.slice(0, limit);
    const place = placeRows(rows.map((x) => ({ seq: x.seq, type: x.type, sr: x.sr, spec: x.spec_text })));
    const usage: AiUsage = { prompt: 0, completion: 0 };
    const search = new ClauseSearch(env, usage);
    const at = now();
    let drafted = 0, copied = 0, failed = 0;
    const errors: string[] = [];
    const stmts: D1PreparedStatement[] = [];
    for (const x of batch) {
      try {
        const similar = await search.similar(r.factory_id, x.spec_text, 5, x.line_id);
        const pl = place.get(x.seq) || { part: 0, section: "", section_sr: "" };
        const d = await draftAnswer(env, { clause: x.spec_text, sr: x.sr, part: pl.part, section: pl.section, product: r.product, factory: r.factory, similar, comments: x.l_comments || "" }, usage);
        if (d.source === "library-similar") copied++; else drafted++;
        // written only if the row is still the same clause and still shows no person's answer (the model took
        // a while; somebody may have filled, split or joined rows meanwhile)
        const guard = "run_id = ? AND seq = ? AND line_id = ? AND (ai_draft = 1 OR (compliance = '' AND remarks = ''))";
        stmts.push(env.DB.prepare(`UPDATE ai_drafts SET status = 'replaced' WHERE run_id = ? AND seq = ? AND status = 'draft'
                                   AND EXISTS (SELECT 1 FROM cm_run_lines WHERE ${guard})`).bind(r.id, x.seq, r.id, x.seq, x.line_id));
        stmts.push(env.DB.prepare(`INSERT INTO ai_drafts (id, run_id, seq, line_id, compliance, remarks, reason, source, sources, confidence, model, status, created_by, created_at)
                                   SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ? WHERE EXISTS (SELECT 1 FROM cm_run_lines WHERE ${guard})`)
          .bind(uuid(), r.id, x.seq, x.line_id, d.compliance, d.remarks, d.reason, d.source, JSON.stringify(d.sources), d.confidence, d.model, s.id, at, r.id, x.seq, x.line_id));
        stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET compliance = ?, remarks = ?, answered_by = NULL, answered_at = ?, review = '', reviewed_by = NULL, reviewed_at = NULL, ai_draft = 1
                                   WHERE ${guard}`).bind(d.compliance.slice(0, 200), d.remarks.slice(0, 4000), at, r.id, x.seq, x.line_id));
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(`${x.sr || "row " + x.seq}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
    if (stmts.length) await batched(env.DB, stmts);
    if (drafted + copied) await prLogHourly(env, r.project_id!, s.id, "AI drafts added", r.file_name || "pasted text");
    await audit(env, s.id, "ai_review_run", r.id, "", { drafted, copied, failed, prompt_tokens: usage.prompt, completion_tokens: usage.completion, errors });
    // clauses the model could not draft are reported, not retried in this loop (a later click tries them again)
    const remaining = todo.length - batch.length;
    return { ok: true, done: batch.length - failed, drafted, copied, failed, remaining, errors, since,
             ...counts(await rowsOf(env, r.id)) };
  },

  async ai_review_clear(env, p) {
    const s = await sessionUser(env, p.p_token);
    const r = await runForAdmin(env, s, p.p_run_id);
    const n = (await env.DB.prepare("SELECT count(*) AS n FROM cm_run_lines WHERE run_id = ? AND ai_draft = 1").bind(r.id).first<{ n: number }>())?.n ?? 0;
    await env.DB.batch([
      env.DB.prepare("UPDATE ai_drafts SET status = 'rejected', decided_by = ?, decided_at = ? WHERE run_id = ? AND status = 'draft'").bind(s.id, now(), r.id),
      env.DB.prepare("UPDATE cm_run_lines SET compliance = '', remarks = '', answered_by = NULL, answered_at = NULL, review = '', ai_draft = 0 WHERE run_id = ? AND ai_draft = 1").bind(r.id)
    ]);
    await audit(env, s.id, "ai_review_clear", r.id, "", { removed: n });
    return { ok: true, removed: n, ...counts(await rowsOf(env, r.id)) };
  }
};

