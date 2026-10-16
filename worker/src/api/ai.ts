/* ai_* : the AI on compliance records. Principles (AI-Roadmap.md): AI never writes into the library; what it
   proposes is blue until a person keeps it; every proposal says where it came from; nothing runs on page load.
   The decision for a clause is in ai/evidence.ts + ai/draft.ts (order written out in the AI map).

   ai_check(token)                                one tiny model call: is the AI reachable, is the budget left
   ai_review_status(token, run_id)                counts for the AI review button
   ai_review_run(token, run_id, limit, replace, since, skip)
                                                  drafts open clauses (and library answers this project's datasheet
                                                  contradicts) in batches; up to 4 model calls side by side
   ai_review_clear(token, run_id)                 takes every AI draft off the record
   ai_suggest(token, run_id, seqs)                focus mode: a proposal for up to 3 clauses, for everyone who can
                                                  open the record; free sources first, the model within the budget
   ai_try(token, product_id, factory_id, clause, part)
                                                  what the AI would go through for a pasted clause (no model)
   ai_map_get / ai_map_link(…, role) / ai_map_create(token, product_id, factory_id)
                                                  the maps (Maps) linked for a product and for a factory: one AI
                                                  rule book and one knowledge map for each
   ai_map_upgrade(token, product_id, factory_id)  adds the template's Instructions / Decision steps / Learned to a linked map
   ai_quality(token, product_id)                  what people did with proposals, last 30 days; often-changed patterns
   ai_learn(token, product_id)                    writes those patterns into the maps, as "to verify" branches under Learned
   ai_eval(token, product_id, factory_id, check, n, seen)
                                                  Check the AI: n answered library clauses replayed with their answer
                                                  hidden; the AI's answer compared with the person's (ai/eval.ts)
   ai_eval_history(token, product_id, factory_id) the earlier checks: model, prompt version, agreement
   AI map and quality: admins of the Compliance Maker tile and the super user. */
import type { Env, Params } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { sessionUser, audit, type Session } from "../auth";
import { prProject, prLogHourly } from "../lib/project";
import { CHOICES } from "../lib/cm";
import { all, now, uuid, int, bool, batched, str, trimmed, sha256 } from "../lib/sql";
import type { RunRow } from "./cm";
import { aiAvailable, aiErrorText, complete, MODELS, NOT_AVAILABLE, type AiUsage } from "../ai/models";
import { ClauseSearch } from "../ai/search";
import { loadContext, compareDatasheet, libraryConflict, type Context, type RunRowFull } from "../ai/evidence";
import { decideClause, modelAllowed, neuronsOf, neuronsToday, pool } from "../ai/decide";
import { aiMapFor, createAiMap, upgradeAiMap, instructionsText } from "../ai/map";
import { learnToMaps } from "../ai/learn";
import { mpRights, type MapRow } from "./mp";
import { pickRules, directRule, splitComments, notesMatching, prepareKnowledge, knowledgeMatching } from "../ai/rules";
import { standardChoice, systemPrompt, userPrompt, promptVersionOf } from "../ai/draft";
import { pickLines, runEval, tally } from "../ai/eval";

type Row = RunRowFull & { draft_at: string | null };
type Run = RunRow & { product: string; factory: string; project: string };

async function runFor(env: Env, s: Session, runId: unknown, admin: boolean): Promise<Run> {
  if (admin) s.requirePrAdmin();
  const r = typeof runId === "string" && runId ? await env.DB.prepare(
    "SELECT r.*, p.name AS product, f.name AS factory FROM cm_runs r JOIN cm_products p ON p.id = r.product_id JOIN cm_factories f ON f.id = r.factory_id WHERE r.id = ?")
    .bind(runId).first<RunRow & { product: string; factory: string }>() : null;
  if (!r || !r.project_id) fail("That compliance record is not in a project.");
  const pj = await prProject(env, s, r.project_id);
  return { ...r, project: pj.name };
}

async function rowsOf(env: Env, runId: string): Promise<Row[]> {
  return all<Row>(env.DB.prepare(
    `SELECT rl.seq, rl.type, rl.sr, rl.spec_text, rl.line_id, rl.compliance, rl.remarks, rl.ai_draft, rl.answered_by,
            l.status AS l_status, l.compliance AS l_compliance, l.remarks AS l_remarks, l.comments AS l_comments,
            (SELECT max(d.created_at) FROM ai_drafts d WHERE d.run_id = rl.run_id AND d.seq = rl.seq AND d.status = 'draft') AS draft_at
       FROM cm_run_lines rl LEFT JOIN cm_lines l ON l.id = rl.line_id WHERE rl.run_id = ? ORDER BY rl.seq`).bind(runId));
}

function human(x: Row): boolean { return (x.compliance !== "" || x.remarks !== "") && !x.ai_draft; }

/* A clause the review may draft: it can be answered, no person answered it, and the library has nothing for it -
   or the library's answer is contradicted by this project's datasheet (reopen). With replace, a draft made before
   `since` is drafted again (one made after it belongs to this review). */
function open(x: Row, replace: boolean, since = "", reopen?: Set<number>): boolean {
  if (!x.line_id || human(x)) return false;
  if (x.ai_draft) return replace && (!x.draft_at || x.draft_at < since);
  return x.l_status !== "answered" || !!reopen?.has(x.seq);
}

function counts(rows: Row[], reopen?: Set<number>) {
  const can = rows.filter((x) => x.line_id);
  return {
    total: can.length,
    drafts: can.filter((x) => x.ai_draft).length,
    human: can.filter(human).length,
    library: can.filter((x) => !(x.compliance !== "" || x.remarks !== "") && x.l_status === "answered").length,
    open: can.filter((x) => open(x, false, "", reopen)).length
  };
}

/* Library answers this project's datasheet contradicts (only when the AI map says the datasheet wins). */
function contradicted(ctx: Context, rows: Row[]): Set<number> {
  const out = new Set<number>();
  if (!ctx.settings.datasheetWins || !ctx.settings.useDatasheet) return out;
  for (const x of rows) {
    if (!x.line_id || human(x) || x.ai_draft || x.l_status !== "answered") continue;
    const hits = ctx.sheet.get(x.seq);
    if (!hits) continue;
    if (libraryConflict(x.l_remarks || "", compareDatasheet(x.spec_text, hits, ctx.columns))) out.add(x.seq);
  }
  return out;
}

function info(r: Run) { return { id: r.id, product_id: r.product_id, factory_id: r.factory_id, project_id: r.project_id, product: r.product, factory: r.factory }; }

/* Who manages the AI map and sees the quality figures: the super user and the admins of the Compliance Maker tile. */
function requireRulesEditor(s: Session): Session {
  const t = s.tool("compliance-maker");
  if (!(s.isSuper || (t && s.isTileAdmin(t.category_id)))) fail("Only an admin or the super user can do this.");
  return s;
}

async function factoryRow(env: Env, productId: string, id: unknown): Promise<{ id: string; name: string } | null> {
  const fid = str(id, 60);
  if (!fid) return null;
  const f = await env.DB.prepare("SELECT id, name FROM cm_factories WHERE id = ? AND product_id = ?").bind(fid, productId).first<{ id: string; name: string }>();
  if (!f) fail("That factory does not make this product.");
  return f;
}

async function productRow(env: Env, id: unknown): Promise<{ id: string; name: string }> {
  const pid = str(id, 40);
  const p = pid ? await env.DB.prepare("SELECT id, name FROM cm_products WHERE id = ?").bind(pid).first<{ id: string; name: string }>() : null;
  if (!p) fail("Choose a product.");
  return p;
}

const GUARD = "run_id = ? AND seq = ? AND line_id = ? AND (ai_draft = 1 OR (compliance = '' AND remarks = ''))";

export const routes: Routes = {
  /* One tiny model call (a few neurons) before a review starts. */
  async ai_check(env, p) {
    const s = await sessionUser(env, p.p_token);
    s.requirePrAdmin();
    if (!aiAvailable(env)) return { ok: true, working: false, message: NOT_AVAILABLE };
    const t0 = Date.now();
    try {
      const usage: AiUsage = { prompt: 0, completion: 0 };
      const out = await complete(env, MODELS.draft, "Reply with the single word OK.", "Are you there?", usage, 5);
      await audit(env, s.id, "ai_check", "", "", { ms: Date.now() - t0 }, neuronsOf(usage));
      return { ok: true, working: true, model: MODELS.draft, ms: Date.now() - t0, reply: out.slice(0, 20), used_today: await neuronsToday(env) };
    } catch (e) {
      console.error("ai_check", e);
      return { ok: true, working: false, model: MODELS.draft, message: aiErrorText(e).text };
    }
  },

  async ai_review_status(env, p) {
    const s = await sessionUser(env, p.p_token);
    const r = await runFor(env, s, p.p_run_id, true);
    return { ok: true, available: aiAvailable(env), ...counts(await rowsOf(env, r.id)) };
  },

  async ai_review_run(env, p) {
    const s = await sessionUser(env, p.p_token);
    const r = await runFor(env, s, p.p_run_id, true);
    if (!aiAvailable(env)) fail(NOT_AVAILABLE, 503);
    const limit = Math.min(Math.max(int(p.p_limit, 12), 1), 25), replace = bool(p.p_replace);
    const since = /^\d{4}-\d{2}-\d{2}T/.test(String(p.p_since || "")) ? String(p.p_since) : now();
    const rows = await rowsOf(env, r.id);
    const usage: AiUsage = { prompt: 0, completion: 0 };
    const ctx = await loadContext(env, info(r), rows, usage);
    const reopen = contradicted(ctx, rows);
    const skip = new Set((Array.isArray(p.p_skip) ? p.p_skip : []).slice(0, 2000).map((v) => Number(v)));
    const todo = rows.filter((x) => open(x, replace, since, reopen) && !skip.has(x.seq));
    const batch = todo.slice(0, limit);
    // the page's AI check failed: answer from the free sources only
    const allowed = bool(p.p_no_model) ? { ok: false, why: "The AI model could not be reached, so only the datasheet, the library, earlier answers and the AI rules were used.", used: 0 } : await modelAllowed(env, ctx);
    const at = now();
    const tally: Record<string, number> = {};
    let failed = 0, waiting = 0, stopped = "";
    const errors: string[] = [], failedSeqs: number[] = [];
    const stmts: D1PreparedStatement[] = [];
    // up to 4 clauses side by side: the model's wait is the slow part, not the work here
    await pool(batch, 4, async (x) => {
      if (stopped) { failedSeqs.push(x.seq); return; }
      try {
        const { draft: d, why } = await decideClause(env, ctx, x, allowed.ok, usage);
        if (!d) { waiting++; failedSeqs.push(x.seq); if (!errors.length) errors.push(why); return; }
        tally[d.source] = (tally[d.source] || 0) + 1;
        stmts.push(env.DB.prepare(`UPDATE ai_drafts SET status = 'replaced' WHERE run_id = ? AND seq = ? AND status = 'draft'
                                   AND EXISTS (SELECT 1 FROM cm_run_lines WHERE ${GUARD})`).bind(r.id, x.seq, r.id, x.seq, x.line_id));
        stmts.push(env.DB.prepare(`INSERT INTO ai_drafts (id, run_id, seq, line_id, compliance, remarks, reason, source, sources, confidence, model, prompt_version, status, created_by, created_at)
                                   SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ? WHERE EXISTS (SELECT 1 FROM cm_run_lines WHERE ${GUARD})`)
          .bind(uuid(), r.id, x.seq, x.line_id, d.compliance, d.remarks, d.reason, d.source, JSON.stringify(d.sources), d.confidence, d.model, d.promptVersion, s.id, at, r.id, x.seq, x.line_id));
        stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET compliance = ?, remarks = ?, answered_by = NULL, answered_at = ?, review = '', reviewed_by = NULL, reviewed_at = NULL, ai_draft = 1
                                   WHERE ${GUARD}`).bind(d.compliance.slice(0, 200), d.remarks.slice(0, 4000), at, r.id, x.seq, x.line_id));
      } catch (e) {
        failed++; failedSeqs.push(x.seq);
        const why = aiErrorText(e);
        console.error("ai_review_run clause " + x.seq, e);
        if (why.stop) { stopped = why.text; return; }
        if (errors.length < 3) errors.push(`${x.sr || "row " + x.seq}: ${why.text}`.slice(0, 240));
      }
    });
    if (stmts.length) await batched(env.DB, stmts);
    const made = Object.values(tally).reduce((a, b) => a + b, 0);
    if (made) await prLogHourly(env, r.project_id!, s.id, "AI drafts added", r.file_name || "pasted text");
    await audit(env, s.id, "ai_review_run", r.id, "", { ...tally, failed, waiting, stopped, reopened: reopen.size, rules: ctx.rules.length,
      datasheet_rows: ctx.columns.length, prompt_tokens: usage.prompt, completion_tokens: usage.completion, errors }, neuronsOf(usage));
    // with the model off (setting or budget), what nothing free could answer waits: the loop ends and says why
    if (!stopped && waiting && !allowed.ok) stopped = allowed.why;
    // still open after this call: on a stop, everything not drafted; otherwise what was not in this batch
    const remaining = stopped ? todo.length - made : todo.length - batch.length;
    return { ok: true, done: made, drafted: tally.model || 0, copied: (tally["library-similar"] || 0) + (tally.record || 0) + (tally.project || 0),
             ruled: tally.rule || 0, from_datasheet: tally.datasheet || 0, by_source: tally, failed, waiting,
             remaining: Math.max(0, remaining), errors, failed_seqs: failedSeqs, since, stopped, ...counts(await rowsOf(env, r.id), reopen) };
  },

  async ai_review_clear(env, p) {
    const s = await sessionUser(env, p.p_token);
    const r = await runFor(env, s, p.p_run_id, true);
    const n = (await env.DB.prepare("SELECT count(*) AS n FROM cm_run_lines WHERE run_id = ? AND ai_draft = 1").bind(r.id).first<{ n: number }>())?.n ?? 0;
    await env.DB.batch([
      env.DB.prepare("UPDATE ai_drafts SET status = 'rejected', decided_by = ?, decided_at = ? WHERE run_id = ? AND status = 'draft'").bind(s.id, now(), r.id),
      env.DB.prepare("UPDATE cm_run_lines SET compliance = '', remarks = '', answered_by = NULL, answered_at = NULL, review = '', ai_draft = 0 WHERE run_id = ? AND ai_draft = 1").bind(r.id)
    ]);
    await audit(env, s.id, "ai_review_clear", r.id, "", { removed: n });
    return { ok: true, removed: n, ...counts(await rowsOf(env, r.id)) };
  },

  /* Focus mode: a proposal for each of up to 3 clauses (the one on screen and the next ones), for everyone who can
     open the record. Free sources answer at once; the model only when nothing else does, within the budget, and
     its answer is kept (ai_suggestions) so opening the clause again costs nothing. Nothing is written on the record:
     the person keeps the proposal by saving it, and that save is what the AI learns from (pr.ts, ai_feedback). */
  async ai_suggest(env, p) {
    const s = await sessionUser(env, p.p_token);
    const r = await runFor(env, s, p.p_run_id, false);
    const seqs = (Array.isArray(p.p_seqs) ? p.p_seqs : [p.p_seq]).map((v) => Number(v)).filter((v) => Number.isInteger(v)).slice(0, 3);
    if (!seqs.length) fail("No clause given.");
    const rows = await rowsOf(env, r.id);
    const usage: AiUsage = { prompt: 0, completion: 0 };
    const ctx = await loadContext(env, info(r), rows, usage);
    if (!ctx.settings.suggest) return { ok: true, off: true, suggestions: [] };
    const reopen = contradicted(ctx, rows);
    const allowed = aiAvailable(env) ? await modelAllowed(env, ctx) : { ok: false, why: NOT_AVAILABLE, used: 0 };
    const cached = await all<{ seq: number; spec_hash: string; payload: string; created_at: string }>(env.DB.prepare(
      `SELECT seq, spec_hash, payload, created_at FROM ai_suggestions WHERE run_id = ? AND seq IN (${seqs.map(() => "?").join(",")})`).bind(r.id, ...seqs));
    const fresh = Date.now() - 12 * 3600 * 1000;
    const out: Record<string, unknown>[] = [];
    const save: D1PreparedStatement[] = [];
    await pool(seqs, 3, async (seq) => {
      const x = rows.find((y) => y.seq === seq);
      if (!x || !x.line_id || human(x) || x.ai_draft || (x.l_status === "answered" && !reopen.has(seq))) { out.push({ seq, none: true }); return; }
      const hash = (await sha256(x.spec_text)).slice(0, 16);
      const c = cached.find((y) => y.seq === seq);
      // a model answer stays good for 12 hours; free answers are made again (they follow every new answer)
      if (c && c.spec_hash === hash && Date.parse(c.created_at) > fresh) {
        const v = JSON.parse(c.payload) as { source: string };
        if (v.source === "model") { out.push({ seq, ...v, cached: true }); return; }
      }
      try {
        const { draft, why } = await decideClause(env, ctx, x, allowed.ok, usage);
        if (!draft) { out.push({ seq, none: true, why }); return; }
        const v = { compliance: draft.compliance, remarks: draft.remarks, reason: draft.reason, confidence: draft.confidence, source: draft.source, sources: draft.sources.slice(0, 6) };
        out.push({ seq, ...v });
        save.push(env.DB.prepare("INSERT INTO ai_suggestions (run_id, seq, spec_hash, basis, payload, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, seq) DO UPDATE SET spec_hash = excluded.spec_hash, payload = excluded.payload, created_at = excluded.created_at")
          .bind(r.id, seq, hash, draft.promptVersion, JSON.stringify(v), now()));
      } catch (e) {
        console.error("ai_suggest " + seq, e);
        out.push({ seq, none: true, why: aiErrorText(e).text });
      }
    });
    if (save.length) await env.DB.batch(save);
    if (usage.prompt + usage.completion) await audit(env, s.id, "ai_suggest", r.id, "", { seqs, prompt_tokens: usage.prompt, completion_tokens: usage.completion }, neuronsOf(usage));
    return { ok: true, model: allowed.ok, model_note: allowed.ok ? "" : allowed.why, suggestions: out.sort((a, b) => Number(a.seq) - Number(b.seq)) };
  },

  /* A pasted clause: what the AI would go through (no record, so no datasheet; no model). */
  async ai_try(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const fid = str(p.p_factory_id, 60);
    const f = fid ? await env.DB.prepare("SELECT id, name FROM cm_factories WHERE id = ? AND product_id = ?").bind(fid, prod.id).first<{ id: string; name: string }>() : null;
    if (!f) fail("Choose a factory.");
    const clause = trimmed(p.p_clause, 3000);
    if (clause.length < 3) fail("Paste a clause to try.");
    const section = trimmed(p.p_section, 120);
    const part = [0, 1, 2, 3].includes(Number(p.p_part)) ? Number(p.p_part) : 0;
    void s;
    const map = await aiMapFor(env, prod.id, f.id);
    const tried = part ? map.rules : map.rules.map((r) => ({ ...r, part: 0 }));
    const picked = pickRules(tried, clause, section, part, 8);
    const direct = splitComments(clause).rules.length || !map.settings.useRules ? null : directRule(picked.rules);
    const similar = await new ClauseSearch(env).similar(f.id, clause, 3, null);
    const notes = await all<{ section: string; row_key: string; body: string }>(env.DB.prepare("SELECT section, row_key, body FROM po_extras WHERE factory_id = ? AND kind = 'ai'").bind(f.id));
    const aiNotes = notesMatching(notes, clause, section, 4);
    const best = similar[0];
    const st = map.settings;
    const libCopy = st.useLibrary && best && best.score >= st.copyAt && best.status === "answered" && standardChoice(best.compliance);
    const know = st.useKnowledge ? knowledgeMatching(prepareKnowledge(map.knowledge), clause, section, 4) : [];
    const steps = [
      { step: "Project datasheet", result: !st.useDatasheet ? "Switched off in Decision steps." : "Not part of a pasted clause: in a record, the blue chips under the clause are compared first." },
      { step: "Product Options and AI notes", result: !st.useOptions ? "Switched off in Decision steps." : aiNotes.length ? aiNotes.length + " AI notes match" : "No AI note of " + f.name + " matches this clause." },
      { step: "Knowledge maps", result: !st.useKnowledge ? "Switched off in Decision steps." : !map.knowledge.length ? "No knowledge map is linked (or it has no verified branches)." : know.length ? know.length + " branches of the knowledge maps match" : "No branch of the knowledge maps matches this clause." },
      { step: "Library", result: !st.useLibrary ? "Copying is switched off in Decision steps; similar answers still go to the model." : best ? `Most similar answered clause: ${(best.score * 100).toFixed(0)}% similar${libCopy ? `, at or above ${(map.settings.copyAt * 100).toFixed(0)}%: its answer "${best.compliance}" is copied` : ", below the copy threshold: shown to the model"}.` : "No similar clause in the library." },
      { step: "AI rules (map)", result: !st.useRules && picked.rules.length ? picked.rules.length + " rules apply; answering by themselves is switched off in Decision steps, so they go to the model as instructions." : direct ? `"${direct.rule.title}" answers it by itself: ${direct.rule.answer}, "${direct.rule.remark}".` : picked.rules.length ? picked.rules.length + " rules apply; they are instructions for the model." : "No rule of the AI map applies." },
      { step: "AI model", result: libCopy || direct ? "Not needed." : map.settings.useModel ? "Writes the answer from the sources above (within the daily budget)." : "Switched off in Settings: the clause would be left for a person." }
    ];
    // the exact text the model would read for this clause (system brief + the clause with its sources)
    const din = { clause, sr: "", part, section, product: prod.name, factory: f.name, similar, comments: "", rules: picked.rules, notes: st.useOptions ? aiNotes : [], knowledge: know, instructions: map.instructions };
    const prompt = { system: systemPrompt(prod.name, f.name, map.instructions), user: userPrompt(din), version: promptVersionOf(map.instructions), from_map: !!map.instructions };
    return { ok: true, map: map.maps.length > 0, problems: map.problems, steps, prompt,
             rules: picked.rules.map((h) => ({ title: h.rule.title, where: h.rule.source || "", matched: h.matched, answer: h.rule.answer, remark: h.rule.remark, instruction: h.rule.instruction })),
             direct: direct ? { title: direct.rule.title, answer: direct.rule.answer, remark: direct.rule.remark, where: direct.rule.source || "" } : null,
             similar: similar.map((x) => ({ text: x.spec_text.slice(0, 200), compliance: x.compliance, remarks: x.remarks, score: x.score })), notes: aiNotes, knowledge: know };
  },

  /* The maps linked for a product (every factory) and for one factory, what in them the AI cannot use, and the
     maps this person may choose from (those he can see in Maps). */
  async ai_map_get(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const fac = await factoryRow(env, prod.id, p.p_factory_id);
    const maps = await aiMapFor(env, prod.id, fac ? fac.id : null);
    const link = (scope: string | null, role: string) => maps.maps.find((m) => (m.scope || null) === scope && m.role === role) || null;
    const counts = (scope: string | null) => { const r = maps.rules.filter((x) => (x.factory_id || null) === scope); return { rules: r.length, direct: r.filter((x) => x.answer && x.remark).length }; };
    const branches = async (id: string) => (await env.DB.prepare("SELECT count(*) AS n FROM mp_nodes WHERE map_id = ? AND parent_id IS NOT NULL AND verified = 1").bind(id).first<{ n: number }>())?.n || 0;
    const canMaps = (() => { const t = s.tool("maps"); return !!t && t.status !== "hidden" && s.canOpen(t.category_id); })();
    const all_ = canMaps ? (await all<MapRow & { kind: string }>(env.DB.prepare("SELECT * FROM mp_maps ORDER BY lower(name)")))
      .filter((m) => mpRights(s, m) !== "none").map((m) => ({ id: m.id, name: m.name, updated_at: m.updated_at, share: m.share, kind: m.kind || "knowledge" })) : [];
    const rb = (scope: string | null) => { const l = link(scope, "rulebook"); return l ? { ...l, ...counts(scope) } : null; };
    const kn = async (scope: string | null) => { const l = link(scope, "knowledge"); return l ? { ...l, branches: await branches(l.id) } : null; };
    return { ok: true, product: prod, factory: fac, can_maps: canMaps, maps: all_,
             all: rb(null), own: fac ? rb(fac.id) : null, k_all: await kn(null), k_own: fac ? await kn(fac.id) : null,
             settings: maps.settings, problems: maps.problems, used_today: await neuronsToday(env),
             instructions: maps.instructions ? maps.instructions.map((x) => x.title).filter(Boolean) : null,
             brief_length: instructionsText(maps.instructions, prod.name, fac ? fac.name : "").length };
  },

  /* Choose (p_map_id) or take off (null) a map for a product (p_factory_id null = every factory) or one factory.
     p_role: rulebook (default) | knowledge; the map must be of that kind (Maps > the map's settings). */
  async ai_map_link(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const fac = await factoryRow(env, prod.id, p.p_factory_id);
    const role = p.p_role === "knowledge" ? "knowledge" : "rulebook";
    const mapId = str(p.p_map_id, 60);
    const scope = fac ? fac.id : "";
    const del = env.DB.prepare("DELETE FROM ai_map_links WHERE product_id = ? AND ifnull(factory_id, '') = ? AND role = ?").bind(prod.id, scope, role);
    if (!mapId) {
      await del.run();
      await audit(env, s.id, "ai_map_link", prod.id + "|" + scope + "|" + role, "", { map: null });
      return { ok: true };
    }
    const m = await env.DB.prepare("SELECT * FROM mp_maps WHERE id = ?").bind(mapId).first<MapRow & { kind: string }>();
    if (!m || mpRights(s, m) === "none") fail("That map is not available to you in Maps.");
    if ((m.kind || "knowledge") !== role) fail(role === "rulebook" ? "That map is a knowledge map. Choose an AI rule book, or change the map's type in Maps (the map's settings)." : "That map is an AI rule book. Choose a knowledge map, or change the map's type in Maps (the map's settings).");
    await env.DB.batch([del,
      env.DB.prepare("INSERT INTO ai_map_links (product_id, factory_id, map_id, role, created_by) VALUES (?, ?, ?, ?, ?)").bind(prod.id, fac ? fac.id : null, m.id, role, s.id)
    ]);
    await audit(env, s.id, "ai_map_link", prod.id + "|" + scope + "|" + role, "", { map: m.id, name: m.name });
    return { ok: true, map: { id: m.id, name: m.name } };
  },

  /* A new AI rule book from the template (instructions, decision steps, starter rules), private to its maker, linked at once. */
  async ai_map_create(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const fac = await factoryRow(env, prod.id, p.p_factory_id);
    const made = await createAiMap(env, s.id, prod, fac, trimmed(p.p_name, 120) || undefined);
    await audit(env, s.id, "ai_map_create", made.id, "", { product: prod.id, factory: fac ? fac.id : null, name: made.name });
    return { ok: true, ...made };
  },

  /* Adds the parts of the template a linked map does not have yet (Instructions, Decision steps, Learned). The person
     must be able to edit that map in Maps. */
  async ai_map_upgrade(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const fac = await factoryRow(env, prod.id, p.p_factory_id);
    const link = await env.DB.prepare("SELECT m.* FROM ai_map_links l JOIN mp_maps m ON m.id = l.map_id WHERE l.role = 'rulebook' AND l.product_id = ? AND ifnull(l.factory_id, '') = ?")
      .bind(prod.id, fac ? fac.id : "").first<MapRow>();
    if (!link) fail("Link a map first.");
    const r = mpRights(s, link);
    if (r !== "own" && r !== "edit") fail("You cannot edit that map in Maps: ask its owner to share it with editing.");
    const added = await upgradeAiMap(env, s.id, link.id, prod.name, fac ? fac.name : null);
    await audit(env, s.id, "ai_map_upgrade", link.id, "", { added });
    return { ok: true, added };
  },

  /* Check the AI: up to 8 answered library clauses of the factory per call, each answered by the AI as if new (its own
     answer hidden), compared with the person's. The page calls again with the ids already checked until the check
     has its number. Every call is logged with its model, prompt version and neurons. */
  async ai_eval(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    if (!aiAvailable(env)) fail(NOT_AVAILABLE, 503);
    const prod = await productRow(env, p.p_product_id);
    const fac = await factoryRow(env, prod.id, p.p_factory_id);
    if (!fac) fail("Choose a factory.");
    const check = /^[a-z0-9-]{8,40}$/.test(String(p.p_check || "")) ? String(p.p_check) : uuid();
    const n = Math.min(Math.max(int(p.p_n, 5), 1), 8);
    const seen = (Array.isArray(p.p_seen) ? p.p_seen : []).map((v) => String(v)).filter((v) => /^[\w-]{1,60}$/.test(v)).slice(0, 400);
    const { lines, total } = await pickLines(env, fac.id, n, seen);
    if (!lines.length) return { ok: true, check, results: [], total, remaining: 0, model: "", prompt_version: "", model_note: total ? "" : "The library of " + fac.name + " has no answered clauses to check against yet.", stopped: "" };
    const usage: AiUsage = { prompt: 0, completion: 0 };
    const run = { id: "eval-" + check, product_id: prod.id, factory_id: fac.id, project_id: null, product: prod.name, factory: fac.name };
    const r = await runEval(env, run, lines, usage);
    const t = tally(r.results);
    await audit(env, s.id, "ai_eval", check, "", { product: prod.id, factory: fac.id, model: r.model, prompt: r.prompt, ...t, stopped: r.stopped }, neuronsOf(usage));
    return { ok: true, check, results: r.results, total, remaining: Math.max(0, total - seen.length - r.results.length),
             model: r.model, prompt_version: r.prompt, model_note: r.modelNote, stopped: r.stopped, neurons: neuronsOf(usage) };
  },

  /* The checks made for a product and factory (newest first, last 180 days), summed per check. */
  async ai_eval_history(env, p) {
    requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const fac = await factoryRow(env, prod.id, p.p_factory_id);
    if (!fac) fail("Choose a factory.");
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const rows = await all<{ target: string; after: string; neurons: number; created_at: string }>(env.DB.prepare(
      "SELECT target, after, neurons, created_at FROM app_audit WHERE created_at >= ? AND action = 'ai_eval' ORDER BY created_at").bind(since));
    type Sum = { check: string; at: string; model: string; prompt: string; tested: number; agree: number; differ: number; left: number; neurons: number };
    const by = new Map<string, Sum>();
    for (const r of rows) {
      let a: Record<string, unknown> = {};
      try { a = JSON.parse(r.after || "{}"); } catch { continue; }
      if (a.product !== prod.id || a.factory !== fac.id) continue;
      const c = by.get(r.target) || { check: r.target, at: r.created_at, model: "", prompt: "", tested: 0, agree: 0, differ: 0, left: 0, neurons: 0 };
      c.model = String(a.model || c.model); c.prompt = String(a.prompt || c.prompt);
      c.tested += Number(a.tested) || 0; c.agree += Number(a.agree) || 0; c.differ += Number(a.differ) || 0; c.left += Number(a.left) || 0;
      c.neurons += Number(r.neurons) || 0;
      by.set(r.target, c);
    }
    return { ok: true, checks: [...by.values()].filter((c) => c.tested > 0).reverse().slice(0, 12).map((c) => ({ ...c, neurons: Math.round(c.neurons) })) };
  },

  /* Writes what people changed the same way 3 times or more into the linked maps (under Learned, "to verify"). */
  async ai_learn(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const written = await learnToMaps(env, prod.id, s.id);
    return { ok: true, written };
  },
  /* What people did with the AI's proposals in the last 30 days, per source, and the answers people keep changing
     the same way (a rule waiting to be written). */
  async ai_quality(env, p) {
    requireRulesEditor(await sessionUser(env, p.p_token));
    const prod = await productRow(env, p.p_product_id);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const bySource = await all<{ source: string; n: number; kept: number; edited: number }>(env.DB.prepare(
      `SELECT source, count(*) AS n, sum(outcome = 'kept') AS kept, sum(outcome = 'edited') AS edited FROM ai_feedback
        WHERE product_id = ? AND created_at >= ? GROUP BY source ORDER BY n DESC`).bind(prod.id, since));
    const patterns = await all<{ part: number; section: string; suggested: string; final: string; n: number }>(env.DB.prepare(
      `SELECT part, section, suggested, final, count(*) AS n FROM ai_feedback
        WHERE product_id = ? AND created_at >= ? AND outcome = 'replaced' AND final <> '' AND section <> ''
        GROUP BY part, section, suggested, final HAVING count(*) >= 3 ORDER BY n DESC LIMIT 10`).bind(prod.id, since));
    return { ok: true, sources: bySource.map((b) => ({ source: b.source, n: b.n, kept: b.kept || 0, edited: b.edited || 0, replaced: b.n - (b.kept || 0) - (b.edited || 0) })), patterns,
             used_today: await neuronsToday(env), choices: CHOICES };
  }
};

export type { Params };
