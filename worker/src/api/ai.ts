/* ai_* : AI review of a project record (admins of the Projects tile and the super user).
   Principles (AI-Roadmap.md): AI never writes into the library; it writes drafts on the project record
   (cm_run_lines with ai_draft = 1, the reason in ai_drafts) that a person accepts by editing or keeping
   them; every draft carries a reason and its sources; nothing runs on page load; usage is audited.

   ai_review_run(token, run_id, limit, replace)  drafts up to `limit` clauses that show no answer yet
                                                 (or every clause when replace); the page calls it again
                                                 while `remaining` > 0, so a 500-clause record is done in
                                                 batches inside the request limits
   ai_review_status(token, run_id)               counts, for the button and the progress line
   ai_review_clear(token, run_id)                takes every AI draft off the record
   ai_rules_list / ai_rules_save / ai_rules_delete / ai_rules_test
                                                 the AI rules and facts per product and factory (Compliance
                                                 review > AI rules); admins of the Compliance Maker tile and the
                                                 super user only */
import type { Env } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { sessionUser, audit, type Session } from "../auth";
import { prProject, prLogHourly } from "../lib/project";
import { placeRows, CHOICES } from "../lib/cm";
import { all, now, uuid, int, bool, batched, str, trimmed, isObject } from "../lib/sql";
import type { RunRow } from "./cm";
import { aiAvailable, NOT_AVAILABLE, type AiUsage } from "../ai/models";
import { ClauseSearch } from "../ai/search";
import { draftAnswer, standardChoice } from "../ai/draft";
import { pickRules, pickDatasheetRows, datasheetFields, parentOf, directRule, splitComments, type AiRule, type DatasheetField } from "../ai/rules";

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

/* ---------- AI rules (Compliance review > AI rules) ---------- */

/* Who writes the rules: the super user and the admins of the tile the Compliance Maker sits on (the owner's
   decision, 16 Oct 2026: admins and super user only; plain "Can edit" users answer the library but do not
   steer the AI for everyone). */
function requireRulesEditor(s: Session): Session {
  const t = s.tool("compliance-maker");
  if (!(s.isSuper || (t && s.isTileAdmin(t.category_id)))) fail("Only an admin or the super user can change the AI rules.");
  return s;
}

const RULE_COLS = "id, product_id, factory_id, kind, title, keywords, part, instruction, answer, remark, active, sort";

async function rulesFor(env: Env, productId: string, factoryId: string): Promise<AiRule[]> {
  return all<AiRule>(env.DB.prepare(`SELECT ${RULE_COLS} FROM ai_rules WHERE tool = 'compliance' AND product_id = ? AND (factory_id IS NULL OR factory_id = ?) AND active = 1`).bind(productId, factoryId));
}

/* The project's newest datasheet table of this product (Datasheet Notes, saved in R2) as labelled fields. */
async function datasheetOf(env: Env, projectId: string, productId: string): Promise<{ fields: DatasheetField[]; units: string[] }> {
  const n = await env.DB.prepare("SELECT columns, file_key FROM pr_notes WHERE project_id = ? AND product_id = ? ORDER BY created_at DESC LIMIT 1").bind(projectId, productId).first<{ columns: string; file_key: string }>();
  if (!n || !n.file_key || !env.FILES) return { fields: [], units: [] };
  try {
    const obj = await env.FILES.get(n.file_key);
    if (!obj) return { fields: [], units: [] };
    const data = (await obj.json()) as { rows?: unknown[] };
    const units = (JSON.parse(n.columns || "[]") as unknown[]).map((u) => String(u ?? ""));
    const rows = Array.isArray(data?.rows) ? data.rows.filter(isObject) : [];
    return { fields: datasheetFields(rows, units).slice(0, 600), units };
  } catch (e) {
    console.warn("datasheet for AI review could not be read", e);
    return { fields: [], units: [] };
  }
}

async function productOf(env: Env, productId: unknown, factoryId: unknown): Promise<{ product: string; factory: string | null }> {
  const pid = str(productId, 40);
  const pr = pid ? await env.DB.prepare("SELECT id FROM cm_products WHERE id = ?").bind(pid).first<{ id: string }>() : null;
  if (!pr) fail("Choose a product.");
  const fid = str(factoryId, 60);
  if (!fid) return { product: pr.id, factory: null };
  const f = await env.DB.prepare("SELECT id FROM cm_factories WHERE id = ? AND product_id = ?").bind(fid, pr.id).first<{ id: string }>();
  if (!f) fail("That factory does not make this product.");
  return { product: pr.id, factory: f.id };
}

function ruleOut(r: AiRule & { factory?: string | null; updated_at?: string; updated_by_name?: string }) {
  return { id: r.id, product_id: r.product_id, factory_id: r.factory_id, factory: r.factory || "", kind: r.kind, title: r.title, keywords: r.keywords,
           part: r.part, instruction: r.instruction, answer: r.answer, remark: r.remark, active: !!r.active, sort: r.sort,
           updated_at: r.updated_at || "", updated_by: r.updated_by_name || "", direct: r.kind === "rule" && !!r.answer && !!r.remark };
}

export const routes: Routes = {
  /* The rules of a product: those for every factory and those of the chosen factory (all factories when none). */
  async ai_rules_list(env, p) {
    requireRulesEditor(await sessionUser(env, p.p_token));
    const sc = await productOf(env, p.p_product_id, p.p_factory_id);
    const rows = await all<AiRule & { factory: string | null; updated_at: string; updated_by_name: string }>(env.DB.prepare(
      `SELECT r.${RULE_COLS.split(", ").join(", r.")}, f.name AS factory, r.updated_at, u.full_name AS updated_by_name
         FROM ai_rules r LEFT JOIN cm_factories f ON f.id = r.factory_id LEFT JOIN app_users u ON u.id = r.updated_by
        WHERE r.tool = 'compliance' AND r.product_id = ? AND (? IS NULL OR r.factory_id IS NULL OR r.factory_id = ?)
        ORDER BY r.kind DESC, r.sort, r.title COLLATE NOCASE`).bind(sc.product, sc.factory, sc.factory));
    return { ok: true, rules: rows.map(ruleOut), choices: CHOICES };
  },

  async ai_rules_save(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const sc = await productOf(env, p.p_product_id, p.p_factory_id);
    const kind = p.p_kind === "fact" ? "fact" : "rule";
    const title = trimmed(p.p_title, 120), keywords = trimmed(p.p_keywords, 600), instruction = trimmed(p.p_instruction, 1500);
    const part = [0, 1, 2, 3].includes(Number(p.p_part)) ? Number(p.p_part) : 0;
    let answer = trimmed(p.p_answer, 60), remark = trimmed(p.p_remark, 1000);
    if (kind === "fact") { answer = ""; remark = ""; }
    if (answer) { const c = standardChoice(answer); if (!c) fail("The answer must be one of: " + CHOICES.join(", ") + "."); answer = c; }
    if (kind === "fact" && instruction.length < 3) fail("Write the fact, for example: Fans are direct-driven EC plug fans.");
    if (kind === "rule" && instruction.length < 3 && !(answer && remark)) fail("Write what the AI should do, or give both an answer and a remark.");
    if (!keywords && !part && answer && remark) fail("A rule that answers by itself needs keywords or a Part, otherwise it would answer every clause.");
    const active = p.p_active === false || p.p_active === 0 ? 0 : 1, sort = int(p.p_sort, 0);
    const id = str(p.p_id, 60);
    const at = now();
    if (id) {
      const before = await env.DB.prepare(`SELECT ${RULE_COLS} FROM ai_rules WHERE id = ? AND product_id = ?`).bind(id, sc.product).first<AiRule>();
      if (!before) fail("That rule no longer exists. Reload the page.");
      await env.DB.prepare(`UPDATE ai_rules SET factory_id = ?, kind = ?, title = ?, keywords = ?, part = ?, instruction = ?, answer = ?, remark = ?, active = ?, sort = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(sc.factory, kind, title, keywords, part, instruction, answer, remark, active, sort, s.id, at, id).run();
      await audit(env, s.id, "ai_rules_save", id, before, { factory_id: sc.factory, kind, title, keywords, part, instruction, answer, remark, active });
      return { ok: true, id };
    }
    const n = (await env.DB.prepare("SELECT count(*) AS n FROM ai_rules WHERE product_id = ?").bind(sc.product).first<{ n: number }>())?.n ?? 0;
    if (n >= 500) fail("This product has 500 AI rules. Remove some before adding more.");
    const nid = uuid();
    await env.DB.prepare(`INSERT INTO ai_rules (id, tool, product_id, factory_id, kind, title, keywords, part, instruction, answer, remark, active, sort, created_by, created_at, updated_by, updated_at)
                          VALUES (?, 'compliance', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(nid, sc.product, sc.factory, kind, title, keywords, part, instruction, answer, remark, active, sort, s.id, at, s.id, at).run();
    await audit(env, s.id, "ai_rules_save", nid, "", { product_id: sc.product, factory_id: sc.factory, kind, title, keywords, part, instruction, answer, remark, active });
    return { ok: true, id: nid };
  },

  async ai_rules_delete(env, p) {
    const s = requireRulesEditor(await sessionUser(env, p.p_token));
    const id = str(p.p_id, 60);
    const before = id ? await env.DB.prepare(`SELECT ${RULE_COLS} FROM ai_rules WHERE id = ?`).bind(id).first<AiRule>() : null;
    if (!before) fail("That rule no longer exists. Reload the page.");
    await env.DB.prepare("DELETE FROM ai_rules WHERE id = ?").bind(id).run();
    await audit(env, s.id, "ai_rules_delete", id, before, "");
    return { ok: true, rule: ruleOut(before) };
  },

  /* What the review would do with a clause, without the model: which rules and facts apply, and whether a
     rule answers it by itself. For trying keywords before relying on them. */
  async ai_rules_test(env, p) {
    requireRulesEditor(await sessionUser(env, p.p_token));
    const sc = await productOf(env, p.p_product_id, p.p_factory_id);
    const clause = trimmed(p.p_clause, 3000);
    if (clause.length < 3) fail("Paste a clause to try.");
    const part = [0, 1, 2, 3].includes(Number(p.p_part)) ? Number(p.p_part) : 0;
    const rules = await all<AiRule>(env.DB.prepare(`SELECT ${RULE_COLS} FROM ai_rules WHERE tool = 'compliance' AND product_id = ? AND (factory_id IS NULL OR ? IS NULL OR factory_id = ?) AND active = 1`).bind(sc.product, sc.factory, sc.factory));
    // with no Part chosen, a Part rule is tried as if the clause were in its Part
    const tried = part ? rules : rules.map((r) => ({ ...r, part: 0 }));
    const picked = pickRules(tried, clause, "", part);
    const direct = splitComments(clause).rules.length ? null : directRule(picked.rules);
    const byId = new Map(rules.map((r) => [r.id, r]));
    const show = (h: { rule: AiRule; matched: string[] }) => ({ ...ruleOut(byId.get(h.rule.id)!), matched: h.matched });
    return { ok: true, rules: picked.rules.map(show), facts: picked.facts.map(show), direct: direct ? show(direct) : null };
  },


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
    // what the review knows besides the library, loaded once per batch: the site rules and facts of this
    // product and factory, and the project's newest datasheet table of the same product
    const siteRules = batch.length ? await rulesFor(env, r.product_id, r.factory_id) : [];
    const sheet = batch.length ? await datasheetOf(env, r.project_id!, r.product_id) : { fields: [], units: [] };
    const specRows = rows.map((x) => ({ seq: x.seq, type: x.type, sr: x.sr, spec: x.spec_text }));
    let drafted = 0, copied = 0, ruled = 0, failed = 0;
    const errors: string[] = [];
    const stmts: D1PreparedStatement[] = [];
    for (const x of batch) {
      try {
        const similar = await search.similar(r.factory_id, x.spec_text, 5, x.line_id);
        const pl = place.get(x.seq) || { part: 0, section: "", section_sr: "" };
        const picked = pickRules(siteRules, x.spec_text, pl.section, pl.part);
        const parent = parentOf(specRows, x.seq);
        const d = await draftAnswer(env, { clause: x.spec_text, sr: x.sr, part: pl.part, section: pl.section, parent, product: r.product, factory: r.factory, similar,
          comments: x.l_comments || "", rules: picked.rules, facts: picked.facts,
          datasheet: pickDatasheetRows(sheet.fields, x.spec_text + " " + parent, pl.section), units: sheet.units }, usage);
        if (d.source === "library-similar") copied++; else if (d.source === "rule") ruled++; else drafted++;
        // written only if the row is still the same clause and still shows no person's answer (the model took
        // a while; somebody may have filled, split or joined rows meanwhile)
        const guard = "run_id = ? AND seq = ? AND line_id = ? AND (ai_draft = 1 OR (compliance = '' AND remarks = ''))";
        stmts.push(env.DB.prepare(`UPDATE ai_drafts SET status = 'replaced' WHERE run_id = ? AND seq = ? AND status = 'draft'
                                   AND EXISTS (SELECT 1 FROM cm_run_lines WHERE ${guard})`).bind(r.id, x.seq, r.id, x.seq, x.line_id));
        stmts.push(env.DB.prepare(`INSERT INTO ai_drafts (id, run_id, seq, line_id, compliance, remarks, reason, source, sources, confidence, model, prompt_version, status, created_by, created_at)
                                   SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ? WHERE EXISTS (SELECT 1 FROM cm_run_lines WHERE ${guard})`)
          .bind(uuid(), r.id, x.seq, x.line_id, d.compliance, d.remarks, d.reason, d.source, JSON.stringify(d.sources), d.confidence, d.model, d.promptVersion, s.id, at, r.id, x.seq, x.line_id));
        stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET compliance = ?, remarks = ?, answered_by = NULL, answered_at = ?, review = '', reviewed_by = NULL, reviewed_at = NULL, ai_draft = 1
                                   WHERE ${guard}`).bind(d.compliance.slice(0, 200), d.remarks.slice(0, 4000), at, r.id, x.seq, x.line_id));
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(`${x.sr || "row " + x.seq}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
    if (stmts.length) await batched(env.DB, stmts);
    if (drafted + copied + ruled) await prLogHourly(env, r.project_id!, s.id, "AI drafts added", r.file_name || "pasted text");
    await audit(env, s.id, "ai_review_run", r.id, "", { drafted, copied, ruled, failed, rules: siteRules.length, datasheet_rows: sheet.fields.length, prompt_tokens: usage.prompt, completion_tokens: usage.completion, errors });
    // clauses the model could not draft are reported, not retried in this loop (a later click tries them again)
    const remaining = todo.length - batch.length;
    return { ok: true, done: batch.length - failed, drafted, copied, ruled, failed, remaining, errors, since,
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

