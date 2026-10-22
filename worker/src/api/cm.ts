/* cm_* : Compliance Maker conversions and the master compliance library (standards B.2d, B.2d-2).
   Same names, parameters and results as the DAME database functions. */
import type { Env, Params } from "../env";
import type { Routes } from "../router";
import { fail, failWith } from "../errors";
import { productMismatch, productKey } from "../lib/product-detect";
import { sessionUser, audit, namesOf, type Session } from "../auth";
import { cmFactory, type Factory } from "../lib/factory";
import { cmNorm, cmTopic, cmLibraryOrder, libraryKey, placeRows, isBody, BODY_TYPES, choiceOf } from "../lib/cm";
import { noteOnly } from "../ai/rules";
import { prProject, prLogStmt } from "../lib/project";
import { all, now, uuid, normHash, str, trimmed, int, bool, isArray, isObject, chunks, marks, like, batched } from "../lib/sql";

export interface LineRow {
  id: string; product_id: string; factory_id: string; norm_hash: string; norm_text: string; spec_text: string;
  compliance: string; remarks: string; comments: string; status: "open" | "answered"; times_seen: number;
  first_run_id: string | null; first_seen_at: string; last_seen_at: string; answered_by: string | null; answered_at: string | null;
  answer_source: string; part: number; section: string; home_run: string | null; home_seq: number | null;
  sr: string; row_type: string; section_sr: string;
}

export interface RunRow {
  id: string; kind: string; user_id: string | null; product_id: string; factory_id: string; source: string; file_name: string;
  line_count: number; unique_count: number; matched_count: number; project_id: string | null; created_at: string;
}

/* Library lines of a factory by their match key, loaded in chunks (hash -> row). */
export async function linesByHash(env: Env, factoryId: string, hashes: string[]): Promise<Map<string, LineRow>> {
  const out = new Map<string, LineRow>();
  for (const part of chunks([...new Set(hashes)])) {
    const rows = await all<LineRow>(env.DB.prepare(`SELECT * FROM cm_lines WHERE factory_id = ? AND norm_hash IN (${marks(part.length)})`).bind(factoryId, ...part));
    rows.forEach((r) => out.set(r.norm_hash, r));
  }
  return out;
}

export async function linesById(env: Env, ids: (string | null)[]): Promise<Map<string, LineRow>> {
  const out = new Map<string, LineRow>();
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  for (const part of chunks(list)) {
    const rows = await all<LineRow>(env.DB.prepare(`SELECT * FROM cm_lines WHERE id IN (${marks(part.length)})`).bind(...part));
    rows.forEach((r) => out.set(r.id, r));
  }
  return out;
}

/* Find or create the library line of a clause of a run (pr__run_line). Returns the id, or null when the
   clause is too short for the library. Used by split / join. */
export async function runLine(env: Env, run: RunRow, type: string, spec: string): Promise<string | null> {
  const norm = libraryKey(type, spec);
  if (norm == null) return null;
  const h = await normHash(norm);
  const have = await env.DB.prepare("SELECT id FROM cm_lines WHERE factory_id = ? AND norm_hash = ?").bind(run.factory_id, h).first<{ id: string }>();
  if (have) return have.id;
  const id = uuid();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO cm_lines (id, product_id, factory_id, norm_hash, norm_text, spec_text, first_run_id, times_seen, home_run)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).bind(id, run.product_id, run.factory_id, h, norm, spec, run.id, run.id),
    env.DB.prepare("INSERT INTO ai_jobs (kind, ref_id) VALUES ('clause', ?)").bind(id)
  ]);
  return id;
}

/* pr__drop_unused_line: a library line made only by a wrong row and never answered is removed. */
export async function dropUnusedLine(env: Env, lineId: string | null): Promise<void> {
  if (!lineId) return;
  const used = await env.DB.prepare("SELECT 1 AS x FROM cm_run_lines WHERE line_id = ? LIMIT 1").bind(lineId).first();
  if (used) return;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cm_lines WHERE id = ? AND status = 'open' AND comments = '' AND times_seen <= 1").bind(lineId),
    env.DB.prepare("INSERT INTO ai_jobs (kind, ref_id, action) VALUES ('clause', ?, 'delete')").bind(lineId)
  ]);
}

/* The statements of one conversion or upload go in batches of 500; the run row is in the first. If a later
   batch fails the half-written run is removed, so no record with wrong counts is left behind. */
async function writeRun(env: Env, runId: string, stmts: D1PreparedStatement[]): Promise<void> {
  try {
    await batched(env.DB, stmts);
  } catch (e) {
    await env.DB.prepare("DELETE FROM cm_runs WHERE id = ?").bind(runId).run().catch(() => undefined);
    throw e;
  }
}

/* Two people converting specifications that share a brand-new clause at the same moment: the second batch
   meets the UNIQUE key of cm_lines. The whole route is simply run again, which then finds the line. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) return fn();
    throw e;
  }
}

interface SrcLine { seq: number; type: string; sr: string; spec: string; norm: string | null }

function readLines(p: Params): SrcLine[] {
  const lines = p.p_lines;
  if (!isArray(lines) || lines.length === 0) fail("There are no lines to save.");
  if (lines.length > 8000) fail("This specification is too long to save in one go (more than 8000 lines).");
  return lines.map((ln, i) => {
    const o = isObject(ln) ? ln : {};
    const type = str(o.type, 12), spec = str(o.spec, 6000);
    return { seq: i, type, sr: str(o.sr, 40), spec, norm: libraryKey(type, spec) };
  });
}

/* The specification is clearly about another product than the one chosen (lib/product-detect.ts): refuse with the product
   it looks like, so the page can offer to change it; a person who confirms the choice (p_product_confirmed) goes on, and
   that is audited. Nothing is written before this check. */
async function checkProduct(env: Env, s: Session, f: Factory, lines: { type?: string; spec?: string }[], p: Params, what: string): Promise<void> {
  const mm = productMismatch(f.product, lines);
  if (!mm) return;
  if (bool(p.p_product_confirmed)) {
    await audit(env, s.id, "cm_product_kept", f.id, "", { product: f.product, looks_like: mm.detected, what, reason: mm.reason });
    return;
  }
  const prods = await all<{ id: string; name: string }>(env.DB.prepare("SELECT id, name FROM cm_products WHERE active = 1 ORDER BY sort"));
  const other = prods.find((x) => productKey(x.name) === mm.detected) || null;
  failWith("PRODUCT_MISMATCH", `This looks like ${other ? (/^[aeiou]/i.test(other.name) || /^[FHLMNRSX][A-Z0-9]/.test(other.name) ? "an " : "a ") + other.name : "another product's"} specification, not ${f.product}. ${mm.reason} Saved under ${f.product}, its clauses would go into the ${f.product} library and get ${f.product} answers.`,
    { chosen: { id: f.product_id, name: f.product }, detected: other, reason: mm.reason });
}

export const routes: Routes = {
  /* Products and their factories, for the two dropdowns. */
  async cm_options(env, p) {
    await sessionUser(env, p.p_token);
    const products = await all<{ id: string; name: string }>(env.DB.prepare("SELECT id, name FROM cm_products WHERE active = 1 ORDER BY sort, name"));
    const facs = await all<{ id: string; name: string; product_id: string }>(env.DB.prepare("SELECT id, name, product_id FROM cm_factories WHERE active = 1 ORDER BY sort, name"));
    return { products: products.map((pr) => ({ id: pr.id, name: pr.name, factories: facs.filter((f) => f.product_id === pr.id).map((f) => ({ id: f.id, name: f.name })) })) };
  },

  /* Save one conversion and get back the answers the library already holds.
       p_lines: [{ type, sr, spec }, ...] in document order; p_project_id: the project it is saved under.
     Every row is stored (cm_run_lines). Body rows enter the library once each (cm_lines); headings stay
     with the run. A line keeps the Part / section / place it was first seen under (first seen wins). */
  async cm_save_run(env, p) {
    return withRetry(() => saveRun(env, p));
  },

  /* ---------- editor API (admins, and users with "Can edit" for compliance-maker) ---------- */

  /* One page of the library, in reading order, with filters and the users' project answers per line. */
  async cm_admin_lines(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const f = await cmFactory(env, p.p_factory_id);
    const status = ["open", "answered", "all", "review"].includes(str(p.p_status)) ? str(p.p_status) : "open";
    const q = trimmed(p.p_search).toLowerCase();
    const limit = Math.min(Math.max(int(p.p_limit, 100), 1), 300), offset = Math.max(int(p.p_offset, 0), 0);
    const wantPart = p.p_part === "" || p.p_part == null ? null : int(p.p_part, 0);
    const topic = trimmed(p.p_topic), ct = trimmed(p.p_client_type), cn = trimmed(p.p_client_name), code = trimmed(p.p_project_code).toUpperCase();

    const allLines = await all<LineRow & { run_at: string | null; file_name: string }>(env.DB.prepare(
      "SELECT l.*, r.created_at AS run_at, coalesce(r.file_name, '') AS file_name FROM cm_lines l LEFT JOIN cm_runs r ON r.id = l.home_run WHERE l.factory_id = ?").bind(f.id));
    // every project answer and every project sighting of this factory's lines
    type PA = { line_id: string; run_id: string; seq: number; compliance: string; remarks: string; review: string; answered_by: string | null; answered_at: string | null; ai_draft: number;
                project: string; client: string; client_type: string; region: string; code: string | null; run_at: string };
    const pas = await all<PA>(env.DB.prepare(
      `SELECT rl.line_id, rl.run_id, rl.seq, rl.compliance, rl.remarks, rl.review, rl.answered_by, rl.answered_at, rl.ai_draft,
              pj.name AS project, pj.client_name AS client, pj.client_type, pj.region, pj.code, r.created_at AS run_at
         FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id JOIN pr_projects pj ON pj.id = r.project_id
        WHERE r.factory_id = ? AND rl.line_id IS NOT NULL`).bind(f.id));
    const nameOf = await namesOf(env, [...allLines.map((l) => l.answered_by), ...pas.map((x) => x.answered_by)]);
    const byLine = new Map<string, { list: PA[]; clients: PA[] }>();
    const types = new Set<string>(), names = new Set<string>(), codes = new Map<string, string>();
    // with a project code: where each line first appears in that project's specifications (run date, then Sr order),
    // so the lines read section by section, sub-section by sub-section, as in the project's own specs
    const place = new Map<string, string>();
    for (const x of pas) {
      if (x.code) codes.set(x.code, x.project);
      if (code && x.code === code) { const k = x.run_at + "|" + String(x.seq).padStart(6, "0"); if (!place.has(x.line_id) || k < place.get(x.line_id)!) place.set(x.line_id, k); }
      const e = byLine.get(x.line_id) || { list: [], clients: [] };
      e.clients.push(x);
      if ((x.compliance || x.remarks) && !x.ai_draft) e.list.push(x);
      byLine.set(x.line_id, e);
      types.add(x.client_type);
      if (!ct || x.client_type === ct) names.add(x.client);
    }
    const waiting = (id: string) => (byLine.get(id)?.list || []).some((y) => y.review === "pending");
    const groups = new Map<string, { part: number; topic: string; all: number; open: number }>();
    for (const l of allLines) {
      const t = cmTopic(l.section), k = l.part + "|" + t;
      const g = groups.get(k) || { part: l.part, topic: t, all: 0, open: 0 };
      g.all++; if (l.status === "open") g.open++;
      groups.set(k, g);
    }
    const passes = allLines.filter((l) =>
      (status === "all" || l.status === status || (status === "review" && waiting(l.id)))
      && (wantPart === null || l.part === wantPart)
      && (!topic || cmTopic(l.section) === topic)
      && (!q || l.spec_text.toLowerCase().includes(q))
      && ((!ct && !cn) || (byLine.get(l.id)?.clients || []).some((x) => (!ct || x.client_type === ct) && (!cn || x.client === cn)))
      && (!code || place.has(l.id)));
    const ordered = code ? passes.slice().sort((a, b) => place.get(a.id)!.localeCompare(place.get(b.id)!)) : cmLibraryOrder(passes);
    const codesOf = (id: string) => [...new Set((byLine.get(id)?.clients || []).map((x) => x.code).filter((c): c is string => !!c))].sort();
    const page = ordered.slice(offset, offset + limit).map((l) => ({
      id: l.id, spec_text: l.spec_text, compliance: l.compliance, remarks: l.remarks, comments: l.comments, status: l.status, times_seen: l.times_seen,
      last_seen_at: l.last_seen_at, answered_at: l.answered_at, answer_source: l.answer_source,
      part: l.part, section: l.section, topic: cmTopic(l.section), sr: l.sr, row_type: l.row_type, section_sr: l.section_sr,
      home_run: l.home_run, file_name: l.file_name, answered_by: l.answered_by ? nameOf(l.answered_by) : null,
      project_codes: codesOf(l.id),
      project_answers: (byLine.get(l.id)?.list || []).slice()
        .sort((a, b) => ((a.review !== "pending" ? 1 : 0) - (b.review !== "pending" ? 1 : 0)) || String(b.answered_at).localeCompare(String(a.answered_at))).slice(0, 6)
        .map((x) => ({ run: x.run_id, seq: x.seq, compliance: x.compliance, remarks: x.remarks, review: x.review, by: nameOf(x.answered_by), at: x.answered_at,
                       project: x.project, code: x.code || "", client: x.client, client_type: x.client_type, region: x.region }))
    }));
    return {
      counts: { all: allLines.length, open: allLines.filter((l) => l.status === "open").length, answered: allLines.filter((l) => l.status === "answered").length,
                review: allLines.filter((l) => waiting(l.id)).length },
      groups: [...groups.values()].sort((a, b) => ((a.part === 0 ? 1 : 0) - (b.part === 0 ? 1 : 0)) || a.part - b.part || a.topic.localeCompare(b.topic)),
      client_types: [...types].sort(), client_names: [...names].sort(),
      project_codes: [...codes].sort((a, b) => b[0].localeCompare(a[0])).map(([c, n]) => ({ code: c, project: n })),
      total: passes.length, lines: page, can_edit: s.canEdit("compliance-maker")
    };
  },

  /* Fill in (or clear) the answer of one library line; p_comments null leaves the Internal Comments as they are. */
  async cm_admin_save_answer(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const id = str(p.p_line_id);
    const o = await env.DB.prepare("SELECT * FROM cm_lines WHERE id = ?").bind(id).first<LineRow>();
    if (!o) fail("That line no longer exists.");
    const c = trimmed(p.p_compliance, 200), r = trimmed(p.p_remarks, 4000);
    const stmts: D1PreparedStatement[] = [];
    if (p.p_comments != null) stmts.push(env.DB.prepare("UPDATE cm_lines SET comments = ? WHERE id = ?").bind(trimmed(p.p_comments, 4000), id));
    if (o.compliance === c && o.remarks === r) {
      if (stmts.length) await env.DB.batch(stmts);
      return { ok: true, status: o.status };
    }
    const status = c || r ? "answered" : "open";
    stmts.push(env.DB.prepare("UPDATE cm_lines SET compliance = ?, remarks = ?, status = ?, answered_by = ?, answered_at = ?, answer_source = 'admin' WHERE id = ?").bind(c, r, status, s.id, now(), id));
    stmts.push(env.DB.prepare("INSERT INTO cm_answer_log (line_id, compliance, remarks, source, user_id) VALUES (?, ?, ?, 'admin', ?)").bind(id, c, r, s.id));
    await env.DB.batch(stmts);
    return { ok: true, status };
  },

  async cm_admin_delete_line(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const id = str(p.p_line_id);
    const r = await env.DB.prepare("DELETE FROM cm_lines WHERE id = ?").bind(id).run();
    if (!r.meta.changes) fail("That line no longer exists.");
    await env.DB.prepare("INSERT INTO ai_jobs (kind, ref_id, action) VALUES ('clause', ?, 'delete')").bind(id).run();
    await audit(env, s.id, "cm_admin_delete_line", id);
    return { ok: true };
  },

  /* Load a filled compliance sheet into the library (Sr | Specifications | Compliance | Remarks | Internal Comments).
     Rows with an answer or an internal comment are taken; the last of a repeated clause wins. A new clause becomes
     a library line in its Part and section; an open line is filled; an answered line gets the file's answer
     (owner's rule: an editor's upload REPLACES existing answers, counted as "replaced"). */
  async cm_admin_import(env, p) {
    return withRetry(() => adminImport(env, p));
  },

  /* Recent conversions and uploads, newest first. */
  async cm_admin_runs(env, p) {
    (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const limit = Math.min(Math.max(int(p.p_limit, 50), 1), 200), offset = Math.max(int(p.p_offset, 0), 0);
    const total = await env.DB.prepare("SELECT count(*) AS n FROM cm_runs").first<{ n: number }>();
    const runs = await all(env.DB.prepare(
      `SELECT r.id, r.kind, r.created_at, coalesce(au.full_name, '(deleted user)') AS user, coalesce(au.username, '') AS username,
              pd.name AS product, fa.name AS factory, r.source, r.file_name, r.line_count, r.unique_count, r.matched_count, r.project_id
         FROM cm_runs r JOIN cm_products pd ON pd.id = r.product_id JOIN cm_factories fa ON fa.id = r.factory_id LEFT JOIN app_users au ON au.id = r.user_id
        ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).bind(limit, offset));
    return { total: total?.n ?? 0, runs };
  },

  /* Everything of a factory in reading order, for the "Download library" button. */
  /* With p_project_code: only the lines of that project's specifications, in their order there. Every line carries
     the codes of the projects whose specifications hold it. */
  async cm_admin_export(env, p) {
    (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const f = await cmFactory(env, p.p_factory_id);
    const code = trimmed(p.p_project_code).toUpperCase();
    const [lines, seen] = await Promise.all([
      all<LineRow & { run_at: string | null; file_name: string }>(env.DB.prepare(
        "SELECT l.*, r.created_at AS run_at, coalesce(r.file_name, '') AS file_name FROM cm_lines l LEFT JOIN cm_runs r ON r.id = l.home_run WHERE l.factory_id = ?").bind(f.id)),
      all<{ line_id: string; code: string; at: string }>(env.DB.prepare(
        `SELECT rl.line_id, pj.code, min(r.created_at || '|' || printf('%06d', rl.seq)) AS at FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id JOIN pr_projects pj ON pj.id = r.project_id
          WHERE r.factory_id = ? AND rl.line_id IS NOT NULL AND pj.code IS NOT NULL GROUP BY rl.line_id, pj.code`).bind(f.id))
    ]);
    const codes = new Map<string, string[]>(), place = new Map<string, string>();
    for (const x of seen) { (codes.get(x.line_id) || codes.set(x.line_id, []).get(x.line_id)!).push(x.code); if (x.code === code) place.set(x.line_id, x.at); }
    const list = code ? lines.filter((l) => place.has(l.id)).sort((a, b) => place.get(a.id)!.localeCompare(place.get(b.id)!)) : cmLibraryOrder(lines);
    return { code, lines: list.map((l) => ({ spec_text: l.spec_text, compliance: l.compliance, remarks: l.remarks, comments: l.comments, times_seen: l.times_seen,
      part: l.part, section: l.section, topic: cmTopic(l.section), sr: l.sr, row_type: l.row_type, section_sr: l.section_sr, home_run: l.home_run, file_name: l.file_name,
      project_codes: (codes.get(l.id) || []).sort() })) };
  },

  /* Reset a compliance library (super user). Without p_with_projects: answers, comments, answer history and the
     conversion / upload history outside projects are cleared; clauses no project uses are deleted; clauses used by
     project records stay empty so those records still open, and answers users typed there go back to review.
     With it, nothing of the product is left. Other products, Product Options and datasheet tables are never touched. */
  async cm_reset_library(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireSuper();
    const productId = str(p.p_product_id);
    const prod = await env.DB.prepare("SELECT id, name FROM cm_products WHERE id = ?").bind(productId).first<{ id: string; name: string }>();
    if (!prod) fail("Choose a product.");
    const factoryId = str(p.p_factory_id) || null;
    const facs = await all<{ id: string }>(env.DB.prepare("SELECT id FROM cm_factories WHERE product_id = ?" + (factoryId ? " AND id = ?" : "")).bind(...(factoryId ? [productId, factoryId] : [productId])));
    if (factoryId && !facs.length) fail("That factory does not belong to the product.");
    const ids = facs.map((x) => x.id), inF = marks(ids.length);
    const withProjects = bool(p.p_with_projects);
    const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n ?? 0;
    let records = 0;
    if (withProjects) {
      records = await count(`SELECT count(*) AS n FROM cm_runs WHERE factory_id IN (${inF}) AND project_id IS NOT NULL`, ...ids);
      await env.DB.prepare(`DELETE FROM cm_runs WHERE factory_id IN (${inF}) AND project_id IS NOT NULL`).bind(...ids).run();
    }
    const history = await count(`SELECT count(*) AS n FROM cm_runs WHERE factory_id IN (${inF}) AND project_id IS NULL`, ...ids);
    await env.DB.prepare(`DELETE FROM cm_runs WHERE factory_id IN (${inF}) AND project_id IS NULL`).bind(...ids).run();
    const gone = await count(`SELECT count(*) AS n FROM cm_lines l WHERE l.factory_id IN (${inF}) AND NOT EXISTS (SELECT 1 FROM cm_run_lines rl WHERE rl.line_id = l.id)`, ...ids);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ai_jobs (kind, ref_id, action) SELECT 'clause', l.id, 'delete' FROM cm_lines l WHERE l.factory_id IN (${inF}) AND NOT EXISTS (SELECT 1 FROM cm_run_lines rl WHERE rl.line_id = l.id)`).bind(...ids),
      env.DB.prepare(`DELETE FROM cm_lines WHERE factory_id IN (${inF}) AND NOT EXISTS (SELECT 1 FROM cm_run_lines rl WHERE rl.line_id = cm_lines.id)`).bind(...ids),
      env.DB.prepare(`DELETE FROM cm_answer_log WHERE line_id IN (SELECT id FROM cm_lines WHERE factory_id IN (${inF}))`).bind(...ids),
      env.DB.prepare(`UPDATE cm_lines SET compliance = '', remarks = '', comments = '', status = 'open', answered_by = NULL, answered_at = NULL, answer_source = '', times_seen = 1 WHERE factory_id IN (${inF})`).bind(...ids),
      env.DB.prepare(`UPDATE cm_run_lines SET review = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE line_id IS NOT NULL AND (compliance <> '' OR remarks <> '') AND ai_draft = 0 AND (review = '' OR review = 'approved')
                        AND run_id IN (SELECT id FROM cm_runs WHERE factory_id IN (${inF}))`).bind(...ids)
    ]);
    const kept = await count(`SELECT count(*) AS n FROM cm_lines WHERE factory_id IN (${inF})`, ...ids);
    await audit(env, s.id, "cm_reset_library", productId + (factoryId ? "/" + factoryId : ""), "", { with_projects: withProjects, lines_removed: gone, lines_kept: kept, history_removed: history, records_removed: records });
    return { ok: true, lines_removed: gone, lines_kept: kept, history_removed: history, records_removed: records };
  }
};



async function saveRun(env: Env, p: Params): Promise<unknown> {
  const s = await sessionUser(env, p.p_token);
  const f = await cmFactory(env, p.p_factory_id);
  const lines = readLines(p);
  const projectId = typeof p.p_project_id === "string" && p.p_project_id ? p.p_project_id : null;
  if (projectId) await prProject(env, s, projectId);
  await checkProduct(env, s, f, lines, p, "conversion");
  const runId = uuid();
  const fileName = str(p.p_file_name, 200);
  const source = ["pdf", "text"].includes(str(p.p_source)) ? str(p.p_source) : "";

  // unique clauses of this run, first sighting wins
  const uniq = new Map<string, SrcLine>();
  for (const ln of lines) if (ln.norm != null && !uniq.has(ln.norm)) uniq.set(ln.norm, ln);
  const hashOf = new Map<string, string>();
  for (const n of uniq.keys()) hashOf.set(n, await normHash(n));
  const have = await linesByHash(env, f.id, [...hashOf.values()]);
  const place = placeRows(lines);
  const at = now();

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO cm_runs (id, kind, user_id, product_id, factory_id, source, file_name, project_id, created_at) VALUES (?, 'conversion', ?, ?, ?, ?, ?, ?, ?)")
      .bind(runId, s.id, f.product_id, f.id, source, fileName, projectId, at)
  ];
  if (projectId) stmts.push(prLogStmt(env, projectId, s.id, "Specification converted", fileName));
  const idOf = new Map<string, string>();                     // norm -> line id
  for (const [norm, ln] of uniq) {
    const h = hashOf.get(norm)!, pl = place.get(ln.seq) || { part: 0, section: "", section_sr: "" };
    const sr = ln.sr.replace(/[.)]\s*$/, "");
    const old = have.get(h);
    if (old) {
      idOf.set(norm, old.id);
      old.times_seen += 1;
      stmts.push(env.DB.prepare(`UPDATE cm_lines SET times_seen = times_seen + 1, last_seen_at = ?,
          part = CASE WHEN part = 0 THEN ? ELSE part END, section = CASE WHEN section = '' THEN ? ELSE section END,
          home_seq = CASE WHEN home_run IS NULL THEN ? ELSE home_seq END, sr = CASE WHEN home_run IS NULL THEN ? ELSE sr END,
          row_type = CASE WHEN home_run IS NULL THEN ? ELSE row_type END, section_sr = CASE WHEN home_run IS NULL THEN ? ELSE section_sr END,
          home_run = coalesce(home_run, ?) WHERE id = ?`)
        .bind(at, pl.part, pl.section, ln.seq, sr, ln.type, pl.section_sr, runId, old.id));
    } else {
      const id = uuid();
      idOf.set(norm, id);
      have.set(h, { id, product_id: f.product_id, factory_id: f.id, norm_hash: h, norm_text: norm, spec_text: ln.spec, compliance: "", remarks: "", comments: "", status: "open",
        times_seen: 1, first_run_id: runId, first_seen_at: at, last_seen_at: at, answered_by: null, answered_at: null, answer_source: "", part: pl.part, section: pl.section,
        home_run: runId, home_seq: ln.seq, sr, row_type: ln.type, section_sr: pl.section_sr });
      stmts.push(env.DB.prepare(`INSERT INTO cm_lines (id, product_id, factory_id, norm_hash, norm_text, spec_text, first_run_id, first_seen_at, last_seen_at, times_seen,
          part, section, home_run, home_seq, sr, row_type, section_sr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, f.product_id, f.id, h, norm, ln.spec, runId, at, at, pl.part, pl.section, runId, ln.seq, sr, ln.type, pl.section_sr));
      stmts.push(env.DB.prepare("INSERT INTO ai_jobs (kind, ref_id) VALUES ('clause', ?)").bind(id));
    }
  }
  for (const ln of lines) {
    stmts.push(env.DB.prepare("INSERT INTO cm_run_lines (run_id, seq, type, sr, spec_text, line_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(runId, ln.seq, ln.type, ln.sr, ln.spec, ln.norm != null ? idOf.get(ln.norm)! : null));
  }
  // counts and the answers the library already holds, per row
  let matched = 0;
  const answers: Record<string, unknown>[] = [];
  const canRules = s.canEdit("compliance-maker");
  for (const ln of lines) {
    if (ln.norm == null) continue;
    const l = have.get(hashOf.get(ln.norm)!)!;
    const answered = l.status === "answered";
    if (answered) matched++;
    // the "#" AI rules in Internal Comments are for the library's editors; everyone else gets the note
    const comments = canRules ? l.comments || "" : noteOnly(l.comments);
    if (answered || comments) answers.push({ i: ln.seq, answered, compliance: answered ? l.compliance : "", remarks: answered ? l.remarks : "", comments });
  }
  stmts.push(env.DB.prepare("UPDATE cm_runs SET line_count = ?, unique_count = ?, matched_count = ? WHERE id = ?").bind(lines.length, uniq.size, matched, runId));
  await writeRun(env, runId, stmts);
  return { ok: true, run_id: runId, lines: lines.length, unique_lines: uniq.size, matched, answers };
}



async function adminImport(env: Env, p: Params): Promise<unknown> {
  const s = (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
  const f = await cmFactory(env, p.p_factory_id);
  const rows = p.p_rows;
  if (!isArray(rows) || rows.length === 0) fail("No rows were found in that file.");
  if (rows.length > 20000) fail("That file has more than 20000 rows. Split it and upload in parts.");
  await checkProduct(env, s, f, rows.map((r) => { const o = isObject(r) ? r : {}; return { type: str(o.type, 12), spec: str(o.spec, 6000) }; }), p, "library upload");
  const runId = uuid(), at = now(), fileName = str(p.p_file_name, 200);
  type Imp = { norm: string; spec: string; c: string; r: string; cm: string; sr: string; row_type: string; part: number; section: string; section_sr: string; ord: number };
  const uniq = new Map<string, Imp>();
  let standardised = 0;
  rows.forEach((raw, ord) => {
    const o = isObject(raw) ? raw : {};
    const spec = str(o.spec, 6000), norm = cmNorm(spec);
    const r = trimmed(o.remarks, 4000), cm = trimmed(o.comments, 4000), typed = trimmed(o.compliance, 200);
    // the six answers in their standard words ("By contractor" -> "In Contractor's Scope"); other text stays as written
    const ch = choiceOf(typed, r), c = ch.choice;
    if (ch.known && c !== typed) standardised++;
    if (!(c || r || cm) || norm.length < 8) return;
    uniq.set(norm, { norm, spec: spec.trim(), c, r, cm, sr: trimmed(o.sr, 20), row_type: BODY_TYPES.includes(str(o.type)) ? str(o.type) : "text",
      part: /^[0-9]$/.test(str(o.part)) ? int(o.part) : 0, section: trimmed(o.section, 120), section_sr: trimmed(o.section_sr, 20), ord });
  });
  const hashOf = new Map<string, string>();
  for (const n of uniq.keys()) hashOf.set(n, await normHash(n));
  const have = await linesByHash(env, f.id, [...hashOf.values()]);
  let unique = 0, added = 0, updated = 0, replaced = 0;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO cm_runs (id, kind, user_id, product_id, factory_id, source, file_name, line_count, created_at) VALUES (?, 'library-upload', ?, ?, ?, 'xlsx', ?, ?, ?)")
      .bind(runId, s.id, f.product_id, f.id, fileName, rows.length, at)
  ];
  for (const t of uniq.values()) {
    const h = hashOf.get(t.norm)!, has = !!(t.c || t.r), l = have.get(h);
    if (has) unique++;
    if (!l) {
      const id = uuid();
      stmts.push(env.DB.prepare(`INSERT INTO cm_lines (id, product_id, factory_id, norm_hash, norm_text, spec_text, compliance, remarks, comments, status, first_run_id,
          answered_by, answered_at, answer_source, times_seen, part, section, sr, row_type, section_sr, home_run, home_seq, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, f.product_id, f.id, h, t.norm, t.spec, t.c, t.r, t.cm, has ? "answered" : "open", runId, has ? s.id : null, has ? at : null, has ? "upload" : "",
              t.part, t.section, t.sr, t.row_type, t.section_sr, runId, t.ord, at, at));
      stmts.push(env.DB.prepare("INSERT INTO ai_jobs (kind, ref_id) VALUES ('clause', ?)").bind(id));
      if (has) { added++; stmts.push(env.DB.prepare("INSERT INTO cm_answer_log (line_id, compliance, remarks, source, run_id, user_id) VALUES (?, ?, ?, 'upload', ?, ?)").bind(id, t.c, t.r, runId, s.id)); }
      continue;
    }
    if (t.cm && l.comments !== t.cm) stmts.push(env.DB.prepare("UPDATE cm_lines SET comments = ? WHERE id = ?").bind(t.cm, l.id));
    if (!has) continue;
    if (l.status === "answered") {
      if (l.compliance === t.c && l.remarks === t.r) continue;
      replaced++;
    } else updated++;
    stmts.push(env.DB.prepare("UPDATE cm_lines SET compliance = ?, remarks = ?, status = 'answered', answered_by = ?, answered_at = ?, answer_source = 'upload' WHERE id = ?").bind(t.c, t.r, s.id, at, l.id));
    stmts.push(env.DB.prepare("INSERT INTO cm_answer_log (line_id, compliance, remarks, source, run_id, user_id) VALUES (?, ?, ?, 'upload', ?, ?)").bind(l.id, t.c, t.r, runId, s.id));
  }
  stmts.push(env.DB.prepare("UPDATE cm_runs SET unique_count = ?, matched_count = ? WHERE id = ?").bind(unique, added + updated, runId));
  await writeRun(env, runId, stmts);
  await audit(env, s.id, "cm_admin_import", f.id, "", { file: fileName, rows: rows.length, added, updated, replaced, standardised });
  return { ok: true, rows: rows.length, unique_lines: unique, added, updated, replaced, unchanged: unique - added - updated - replaced, skipped: rows.length - unique, standardised };
}

export { isBody, cmFactory };
export type { Factory, Session };
