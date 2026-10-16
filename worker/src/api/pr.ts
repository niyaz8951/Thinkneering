/* pr_* : Projects (standards B.2i). Same names, parameters and results as the DAME database functions.
   A project holds compliance records (cm_runs with project_id) and datasheet tables (pr_notes; the rows
   live in R2). Who may open a project: its creator, its members, admins of the Projects tile. */
import type { Env, Params } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { sessionUser, namesOf, type Session } from "../auth";
import { dnProduct } from "../lib/factory";
import { cmNorm, isBody, rowKey, placeRows } from "../lib/cm";
import { prProject, prCanShare, prLogStmt, prLog, prLogHourly, type ProjectRow } from "../lib/project";
import { all, now, uuid, str, trimmed, tidy, int, bool, isArray, isObject, chunks, marks, batched } from "../lib/sql";
import { runLine, dropUnusedLine, linesById, type LineRow, type RunRow } from "./cm";
import { aiAvailable } from "../ai/models";
import { noteOnly } from "../ai/rules";

/* One row of a record (cm_run_lines). */
interface RL {
  run_id: string; seq: number; type: string; sr: string; spec_text: string; line_id: string | null;
  compliance: string; remarks: string; answered_by: string | null; answered_at: string | null;
  review: string; reviewed_by: string | null; reviewed_at: string | null; tl_review: string; ai_draft: number;
}
/* The row with its library line beside it. */
type RLL = RL & { l_status: string | null; l_compliance: string | null; l_remarks: string | null; l_comments: string | null };
interface DraftRow { id: string; seq: number; compliance: string; remarks: string }

const ROW_WITH_LINE = `SELECT rl.*, l.status AS l_status, l.compliance AS l_compliance, l.remarks AS l_remarks, l.comments AS l_comments
                         FROM cm_run_lines rl LEFT JOIN cm_lines l ON l.id = rl.line_id`;

/* The record, if it is in a project the user may open. */
async function runInProject(env: Env, s: Session, id: unknown): Promise<{ r: RunRow; p: ProjectRow }> {
  const r = typeof id === "string" && id ? await env.DB.prepare("SELECT * FROM cm_runs WHERE id = ?").bind(id).first<RunRow>() : null;
  if (!r || !r.project_id) fail("That compliance record is not in a project.");
  const p = await prProject(env, s, r.project_id);
  return { r, p };
}

/* pr__check_row: the row a page means must still be the row with that number. p_check null = no check. */
function checkRow(spec: string | null | undefined, check: unknown): void {
  if (check == null) return;
  if (rowKey(spec) !== String(check)) fail("The rows of this record were changed since you opened it. Reload the page; nothing was saved on this row.");
}

async function rowOf(env: Env, runId: string, seq: unknown): Promise<RLL | null> {
  return env.DB.prepare(ROW_WITH_LINE + " WHERE rl.run_id = ? AND rl.seq = ?").bind(runId, int(seq, -1)).first<RLL>();
}

function fileLabel(r: RunRow): string { return r.file_name || "pasted text"; }
function noteKey(projectId: string, noteId: string): string { return `notes/${projectId}/${noteId}.json`; }

/* The latest AI draft per row of a record (one seq, or all). */
async function latestDrafts(env: Env, runId: string, seq?: number): Promise<Map<number, DraftRow>> {
  const rows = seq == null
    ? await all<DraftRow>(env.DB.prepare("SELECT id, seq, compliance, remarks FROM ai_drafts WHERE run_id = ? ORDER BY created_at, id").bind(runId))
    : await all<DraftRow>(env.DB.prepare("SELECT id, seq, compliance, remarks FROM ai_drafts WHERE run_id = ? AND seq = ? ORDER BY created_at, id").bind(runId, seq));
  const out = new Map<number, DraftRow>();
  rows.forEach((d) => out.set(d.seq, d));      // the last one wins
  return out;
}

/* The statements that write a person's answer on one row (pr_run_save_line's rule): equal to the library
   answer = nothing more to do (review ''); anything else waits for review; both boxes empty takes the
   project's own answer away. An AI draft on the row is decided by the same write: accepted when the
   saved answer is the draft's, edited when it differs, rejected when the boxes were emptied. */
function answerStmts(env: Env, s: Session, rl: RLL, c: string, m: string, draft: DraftRow | undefined, at: string): { stmts: D1PreparedStatement[]; review: string } {
  const stmts: D1PreparedStatement[] = [];
  let review = "";
  if (c === "" && m === "") {
    stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET compliance = '', remarks = '', answered_by = NULL, answered_at = NULL, review = '',
                                 reviewed_by = NULL, reviewed_at = NULL, ai_draft = 0 WHERE run_id = ? AND seq = ?`).bind(rl.run_id, rl.seq));
  } else {
    review = rl.l_status === "answered" && rl.l_compliance === c && rl.l_remarks === m ? "" : "pending";
    stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET compliance = ?, remarks = ?, answered_by = ?, answered_at = ?, review = ?,
                                 reviewed_by = NULL, reviewed_at = NULL, ai_draft = 0 WHERE run_id = ? AND seq = ?`).bind(c, m, s.id, at, review, rl.run_id, rl.seq));
  }
  if (rl.ai_draft && draft) {
    const status = c === "" && m === "" ? "rejected" : draft.compliance === c && draft.remarks === m ? "accepted" : "edited";
    stmts.push(env.DB.prepare("UPDATE ai_drafts SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?").bind(status, s.id, at, draft.id));
    // every accept / edit / reject of an AI draft is in the audit log (standards A.3, roadmap principle 1)
    stmts.push(env.DB.prepare("INSERT INTO app_audit (user_id, action, target, before, after) VALUES (?, ?, ?, ?, ?)")
      .bind(s.id, "ai_draft_" + status, rl.run_id + "#" + rl.seq, JSON.stringify({ compliance: draft.compliance, remarks: draft.remarks }), JSON.stringify({ compliance: c, remarks: m })));
  }
  return { stmts, review };
}

/* pr__run_reshaped: after rows were split or joined, the counts of the run, the Part / section / place of
   its lines (cm__fill_structure for this run), the library's reading order, and one history line an hour. */
async function runReshaped(env: Env, s: Session, r: RunRow): Promise<void> {
  const rows = await all<RL>(env.DB.prepare("SELECT seq, type, sr, spec_text, line_id FROM cm_run_lines WHERE run_id = ? ORDER BY seq").bind(r.id));
  const place = placeRows(rows.map((x) => ({ seq: x.seq, type: x.type, sr: x.sr, spec: x.spec_text })));
  const first = new Map<string, RL>();                        // line id -> its first row in this record
  for (const x of rows) if (x.line_id && !first.has(x.line_id)) first.set(x.line_id, x);
  const lines = await linesById(env, [...first.keys()]);
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE cm_runs SET line_count = ?, unique_count = ? WHERE id = ?").bind(rows.length, first.size, r.id)
  ];
  for (const [lineId, x] of first) {
    const l = lines.get(lineId);
    if (!l) continue;
    const pl = place.get(x.seq) || { part: 0, section: "", section_sr: "" };
    const sr = x.sr.replace(/[.)]\s*$/, "");
    // a line made by split / join has no place yet: it takes this record as its home
    if (l.home_run == null || (l.home_run === r.id && l.home_seq == null)) {
      stmts.push(env.DB.prepare(`UPDATE cm_lines SET part = CASE WHEN part = 0 THEN ? ELSE part END, section = CASE WHEN section = '' THEN ? ELSE section END,
                                   home_run = ?, home_seq = ?, sr = ?, row_type = ?, section_sr = ? WHERE id = ?`)
        .bind(pl.part, pl.section, r.id, x.seq, sr, x.type, pl.section_sr, lineId));
      continue;
    }
    if ((l.part === 0 && pl.part > 0) || (l.section === "" && pl.section !== "")) {
      stmts.push(env.DB.prepare("UPDATE cm_lines SET part = CASE WHEN part = 0 THEN ? ELSE part END, section = CASE WHEN section = '' THEN ? ELSE section END WHERE id = ?")
        .bind(pl.part, pl.section, lineId));
    }
    // the library keeps the reading order of the record a clause came from: follow the new row numbers
    if (l.home_run === r.id && l.home_seq !== x.seq) stmts.push(env.DB.prepare("UPDATE cm_lines SET home_seq = ? WHERE id = ?").bind(x.seq, lineId));
  }
  await batched(env.DB, stmts);
  await prLogHourly(env, r.project_id!, s.id, "Rows split or joined", fileLabel(r));
}

/* Rows after `seq` move by `by` places (two steps, so no two rows share a number on the way). */
function shiftStmts(env: Env, runId: string, seq: number, by: number): D1PreparedStatement[] {
  return [
    env.DB.prepare("UPDATE cm_run_lines SET seq = -(seq + ?) - 1 WHERE run_id = ? AND seq > ?").bind(by, runId, seq),
    env.DB.prepare("UPDATE cm_run_lines SET seq = -seq - 1 WHERE run_id = ? AND seq < 0").bind(runId),
    // the AI drafts of those rows move with them
    env.DB.prepare("UPDATE ai_drafts SET seq = -(seq + ?) - 1 WHERE run_id = ? AND seq > ?").bind(by, runId, seq),
    env.DB.prepare("UPDATE ai_drafts SET seq = -seq - 1 WHERE run_id = ? AND seq < 0").bind(runId)
  ];
}

/* The notes table of a project from R2. */
async function noteRows(env: Env, key: string): Promise<unknown[]> {
  if (!key) return [];
  const obj = await env.FILES.get(key);
  if (!obj) return [];
  const data = (await obj.json()) as { rows?: unknown[] };
  return isArray(data?.rows) ? data.rows : [];
}

/* pr_get's body, shared with pr_export. */
async function projectDetail(env: Env, s: Session, p: ProjectRow): Promise<Record<string, unknown>> {
  type RunCard = { id: string; created_at: string; user_id: string | null; product_id: string; product: string; factory: string; source: string; file_name: string; line_count: number; matched_count: number };
  type Counts = { run_id: string; clauses: number; filled: number; answered: number; drafts: number; pending: number; approved: number; rejected: number };
  type Note = { id: string; created_at: string; user_id: string | null; product_id: string; product: string; file_names: string; units: number; row_count: number };
  type Log = { created_at: string; user_id: string | null; action: string; detail: string };
  const [mem, runs, counts, notes, log] = await env.DB.batch([
    env.DB.prepare("SELECT au.full_name FROM pr_members m JOIN app_users au ON au.id = m.user_id WHERE m.project_id = ? ORDER BY au.full_name").bind(p.id),
    env.DB.prepare(`SELECT r.id, r.created_at, r.user_id, r.product_id, pd.name AS product, fa.name AS factory, r.source, r.file_name, r.line_count, r.matched_count
                      FROM cm_runs r JOIN cm_products pd ON pd.id = r.product_id JOIN cm_factories fa ON fa.id = r.factory_id
                     WHERE r.project_id = ? ORDER BY r.created_at DESC`).bind(p.id),
    // progress per record: clauses that can be answered, and those that show an answer now (the project's own, an AI draft, or the library's)
    env.DB.prepare(`SELECT rl.run_id,
                           sum(CASE WHEN rl.line_id IS NOT NULL THEN 1 ELSE 0 END) AS clauses,
                           sum(CASE WHEN rl.line_id IS NOT NULL AND (rl.compliance <> '' OR rl.remarks <> '' OR l.status = 'answered') THEN 1 ELSE 0 END) AS filled,
                           sum(CASE WHEN (rl.compliance <> '' OR rl.remarks <> '') AND rl.ai_draft = 0 THEN 1 ELSE 0 END) AS answered,
                           sum(CASE WHEN (rl.compliance <> '' OR rl.remarks <> '') AND rl.ai_draft = 1 THEN 1 ELSE 0 END) AS drafts,
                           sum(CASE WHEN rl.review = 'pending' THEN 1 ELSE 0 END) AS pending,
                           sum(CASE WHEN rl.review = 'approved' THEN 1 ELSE 0 END) AS approved,
                           sum(CASE WHEN rl.review = 'rejected' THEN 1 ELSE 0 END) AS rejected
                      FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id LEFT JOIN cm_lines l ON l.id = rl.line_id
                     WHERE r.project_id = ? GROUP BY rl.run_id`).bind(p.id),
    env.DB.prepare(`SELECT n.id, n.created_at, n.user_id, n.product_id, pd.name AS product, n.file_names, n.units, n.row_count
                      FROM pr_notes n JOIN cm_products pd ON pd.id = n.product_id WHERE n.project_id = ? ORDER BY n.created_at DESC`).bind(p.id),
    env.DB.prepare("SELECT created_at, user_id, action, detail FROM pr_log WHERE project_id = ? ORDER BY id DESC LIMIT 200").bind(p.id)
  ]);
  const runList = runs.results as unknown as RunCard[], noteList = notes.results as unknown as Note[], logList = log.results as unknown as Log[];
  const nameOf = await namesOf(env, [p.created_by, p.updated_by, ...runList.map((r) => r.user_id), ...noteList.map((n) => n.user_id), ...logList.map((g) => g.user_id)]);
  const countOf = new Map((counts.results as unknown as Counts[]).map((c) => [c.run_id, c]));
  return {
    project: { id: p.id, name: p.name, client_type: p.client_type, client_name: p.client_name, region: p.region, created_at: p.created_at,
               created_by: nameOf(p.created_by), updated_at: p.updated_at, updated_by: nameOf(p.updated_by) },
    access: { owner: p.created_by === s.id, can_share: prCanShare(s, p), can_delete: p.created_by === s.id || s.prAdmin,
              members: (mem.results as { full_name: string }[]).map((x) => x.full_name) },
    runs: runList.map((r) => {
      const c = countOf.get(r.id);
      return { id: r.id, created_at: r.created_at, user: nameOf(r.user_id), product_id: r.product_id, product: r.product, factory: r.factory,
               source: r.source, file_name: r.file_name, lines: r.line_count, from_library: r.matched_count,
               clauses: c?.clauses ?? 0, filled: c?.filled ?? 0, answered: c?.answered ?? 0, drafts: c?.drafts ?? 0, pending: c?.pending ?? 0, approved: c?.approved ?? 0, rejected: c?.rejected ?? 0 };
    }),
    notes: noteList.map((n) => ({ id: n.id, created_at: n.created_at, user: nameOf(n.user_id), product_id: n.product_id, product: n.product, file_names: n.file_names, units: n.units, rows: n.row_count })),
    log: logList.map((g) => ({ at: g.created_at, user: nameOf(g.user_id), action: g.action, detail: g.detail }))
  };
}

export const routes: Routes = {
  /* The two dropdown lists of the project form. */
  async pr_options(env, p) {
    await sessionUser(env, p.p_token);
    const rows = await all<{ kind: string; value: string }>(env.DB.prepare("SELECT kind, value FROM pr_lists ORDER BY sort, value"));
    return { client_types: rows.filter((x) => x.kind === "client_type").map((x) => x.value), regions: rows.filter((x) => x.kind === "region").map((x) => x.value) };
  },

  /* The projects this user may open (admins: all), newest activity first, with what each holds. */
  async pr_list(env, p) {
    const s = await sessionUser(env, p.p_token);
    type Agg = { project_id: string; n: number; at: string | null; mine?: number };
    const [projects, runs, notes, members, pending] = await env.DB.batch([
      s.prAdmin ? env.DB.prepare("SELECT * FROM pr_projects")
                : env.DB.prepare("SELECT * FROM pr_projects WHERE created_by = ? OR id IN (SELECT project_id FROM pr_members WHERE user_id = ?)").bind(s.id, s.id),
      env.DB.prepare("SELECT project_id, count(*) AS n, max(created_at) AS at FROM cm_runs WHERE project_id IS NOT NULL GROUP BY project_id"),
      env.DB.prepare("SELECT project_id, count(*) AS n, max(created_at) AS at FROM pr_notes GROUP BY project_id"),
      env.DB.prepare("SELECT project_id, count(*) AS n, sum(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM pr_members GROUP BY project_id").bind(s.id),
      env.DB.prepare("SELECT r.project_id, count(*) AS n FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id WHERE r.project_id IS NOT NULL AND rl.review = 'pending' GROUP BY r.project_id")
    ]);
    const by = (r: D1Result) => new Map((r.results as unknown as Agg[]).map((x) => [x.project_id, x]));
    const runOf = by(runs), noteOf = by(notes), memOf = by(members), pendOf = by(pending);
    const list = projects.results as unknown as ProjectRow[];
    const nameOf = await namesOf(env, list.map((x) => x.created_by));
    const cards = list.map((x) => {
      const r = runOf.get(x.id), n = noteOf.get(x.id), m = memOf.get(x.id);
      const last = [x.updated_at, r?.at || x.created_at, n?.at || x.created_at].sort().pop()!;
      return { id: x.id, name: x.name, client_type: x.client_type, client_name: x.client_name, region: x.region, created_at: x.created_at,
               created_by: nameOf(x.created_by), mine: x.created_by === s.id, shared_with_me: !!(m && m.mine), members: m?.n ?? 0,
               compliance: r?.n ?? 0, notes: n?.n ?? 0, pending: pendOf.get(x.id)?.n ?? 0, last_at: last };
    });
    cards.sort((a, b) => b.last_at.localeCompare(a.last_at));
    return { all: s.prAdmin, projects: cards };
  },

  /* Create (p_id null) or change a project. All four fields are required. */
  async pr_save(env, p) {
    const s = await sessionUser(env, p.p_token);
    const name = tidy(p.p_name, 120), client = tidy(p.p_client_name, 120), type = trimmed(p.p_client_type), region = trimmed(p.p_region);
    if (name.length < 2) fail("Project name is required.");
    const lists = await all<{ kind: string; value: string }>(env.DB.prepare("SELECT kind, value FROM pr_lists"));
    if (!lists.some((x) => x.kind === "client_type" && x.value === type)) fail("Choose the client type.");
    if (client.length < 2) fail("Client name is required.");
    if (!lists.some((x) => x.kind === "region" && x.value === region)) fail("Choose the region.");
    const at = now();
    if (p.p_id == null || p.p_id === "") {
      const dup = await env.DB.prepare("SELECT 1 AS x FROM pr_projects WHERE created_by = ? AND lower(name) = lower(?)").bind(s.id, name).first();
      if (dup) fail("You already have a project with this name. Open it from the list, or use another name.");
      const id = uuid();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO pr_projects (id, name, client_type, client_name, region, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, name, type, client, region, s.id, at, s.id, at),
        prLogStmt(env, id, s.id, "Project created", name)
      ]);
      return { ok: true, id };
    }
    const old = await prProject(env, s, p.p_id);
    await env.DB.batch([
      env.DB.prepare("UPDATE pr_projects SET name = ?, client_type = ?, client_name = ?, region = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind(name, type, client, region, s.id, at, old.id),
      prLogStmt(env, old.id, s.id, "Project details changed", old.name !== name ? `Name: ${old.name} -> ${name}` : "")
    ]);
    return { ok: true, id: old.id };
  },

  /* One project: its details, what is saved in it, and its history. */
  async pr_get(env, p) {
    const s = await sessionUser(env, p.p_token);
    const pj = await prProject(env, s, p.p_id);
    return projectDetail(env, s, pj);
  },

  /* Everything in one project, for the Excel download: details, compliance lines with the answer that
     applies (the project's own, else the library's), datasheet tables, history. */
  async pr_export(env, p) {
    const s = await sessionUser(env, p.p_token);
    const pj = await prProject(env, s, p.p_id);
    const detail = await projectDetail(env, s, pj);
    type Row = RLL & { created_at: string };
    const rows = await all<Row>(env.DB.prepare(ROW_WITH_LINE + ` JOIN cm_runs r ON r.id = rl.run_id WHERE r.project_id = ? ORDER BY r.created_at, rl.run_id, rl.seq`).bind(pj.id));
    const nameOf = await namesOf(env, rows.map((x) => x.answered_by));
    const SOURCE: Record<string, string> = { pending: "Project answer, waiting for review", approved: "Project answer, approved for the library", rejected: "Project answer, not taken into the library" };
    const compliance = rows.map((x) => {
      const own = x.compliance !== "" || x.remarks !== "";
      return { run: x.run_id, seq: x.seq, type: x.type, sr: x.sr, spec: x.spec_text,
               compliance: own ? x.compliance : x.l_compliance || "", remarks: own ? x.remarks : x.l_remarks || "",
               source: own ? (x.ai_draft ? "AI draft, not checked" : SOURCE[x.review] || "Same as the library") : x.l_status === "answered" ? "From the library" : "",
               comments: s.canEdit("compliance-maker") ? x.l_comments || "" : noteOnly(x.l_comments), by: x.answered_by ? nameOf(x.answered_by) : "" };
    });
    type Note = { id: string; product: string; file_names: string; created_at: string; columns: string; file_key: string };
    const notes = await all<Note>(env.DB.prepare("SELECT n.id, pd.name AS product, n.file_names, n.created_at, n.columns, n.file_key FROM pr_notes n JOIN cm_products pd ON pd.id = n.product_id WHERE n.project_id = ? ORDER BY n.created_at").bind(pj.id));
    const tables = [];
    for (const n of notes) tables.push({ id: n.id, product: n.product, file_names: n.file_names, created_at: n.created_at, columns: JSON.parse(n.columns || "[]"), rows: await noteRows(env, n.file_key) });
    await prLog(env, pj.id, s.id, "Project downloaded", "");
    return { ...detail, compliance, tables };
  },

  /* Save one Datasheet Notes table in a project (called by the tool after every read). The unit tags stay
     in D1; the rows go to R2 at notes/<project>/<note>.json. */
  async pr_note_save(env, p) {
    const s = await sessionUser(env, p.p_token);
    const pj = await prProject(env, s, p.p_project_id);
    const prod = await dnProduct(env, p.p_product_id);
    const columns = p.p_columns, rows = p.p_rows;
    if (!isArray(columns) || !isArray(rows) || rows.length === 0) fail("There is no table to save.");
    const body = JSON.stringify({ rows });
    if (body.length > 12000000) fail("This table is too large to keep in the project. Download the Excel instead.");
    const units = columns.length;
    const count = rows.filter((r) => !isObject(r) || (r.kind ?? "row") === "row").length;
    const id = uuid(), key = noteKey(pj.id, id), files = str(p.p_file_names, 400);
    await env.FILES.put(key, body, { httpMetadata: { contentType: "application/json" } });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO pr_notes (id, project_id, user_id, product_id, file_names, units, row_count, columns, file_key, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, pj.id, s.id, prod.id, files, units, count, JSON.stringify(columns), key, body.length, now()),
      prLogStmt(env, pj.id, s.id, "Datasheet notes saved", `${units} ${units === 1 ? "unit" : "units"}, ${files.slice(0, 200)}`)
    ]);
    return { ok: true, id };
  },

  /* One saved Datasheet Notes table, to show or download it again. */
  async pr_note_get(env, p) {
    const s = await sessionUser(env, p.p_token);
    type Note = { id: string; project_id: string; user_id: string | null; file_names: string; columns: string; file_key: string; created_at: string; project: string; product: string };
    const n = typeof p.p_note_id === "string" && p.p_note_id ? await env.DB.prepare(
      "SELECT n.id, n.project_id, n.user_id, n.file_names, n.columns, n.file_key, n.created_at, pj.name AS project, pd.name AS product FROM pr_notes n JOIN pr_projects pj ON pj.id = n.project_id JOIN cm_products pd ON pd.id = n.product_id WHERE n.id = ?")
      .bind(p.p_note_id).first<Note>() : null;
    if (!n) fail("That table no longer exists.");
    await prProject(env, s, n.project_id);
    const nameOf = await namesOf(env, [n.user_id]);
    return { id: n.id, file_names: n.file_names, columns: JSON.parse(n.columns || "[]"), rows: await noteRows(env, n.file_key), created_at: n.created_at,
             user: nameOf(n.user_id), project_id: n.project_id, project: n.project, product: n.product };
  },

  /* One compliance record of a project, to read and fill on the website: every row of the converted
     specification in order, the project's own answer and the library's answer. */
  async pr_run_get(env, p) {
    const s = await sessionUser(env, p.p_token);
    const { r, p: pj } = await runInProject(env, s, p.p_run_id);
    const [names, rows] = await env.DB.batch([
      env.DB.prepare("SELECT (SELECT name FROM cm_products WHERE id = ?) AS product, (SELECT name FROM cm_factories WHERE id = ?) AS factory").bind(r.product_id, r.factory_id),
      env.DB.prepare(ROW_WITH_LINE + " WHERE rl.run_id = ? ORDER BY rl.seq").bind(r.id)
    ]);
    const nm = names.results[0] as { product: string; factory: string }, lines = rows.results as unknown as RLL[];
    const nameOf = await namesOf(env, [r.user_id, ...lines.map((x) => x.answered_by)]);
    // the reason behind every AI draft still on the record (the newest draft of a row wins)
    const canComment = s.canEdit("compliance-maker");
    const reasons = new Map<number, { reason: string; confidence: string; source: string }>();
    if (lines.some((x) => x.ai_draft)) {
      const ds = await all<{ seq: number; reason: string; confidence: string; source: string }>(
        env.DB.prepare("SELECT seq, reason, confidence, source FROM ai_drafts WHERE run_id = ? AND status = 'draft' ORDER BY created_at, id").bind(r.id));
      ds.forEach((d) => reasons.set(d.seq, { reason: d.reason, confidence: d.confidence, source: d.source }));
    }
    return {
      run: { id: r.id, file_name: r.file_name, created_at: r.created_at, user: nameOf(r.user_id), product: nm.product, product_id: r.product_id, factory: nm.factory,
             project_id: pj.id, project: pj.name, client: pj.client_name,
             can_comment: canComment,           // may write Internal Comments (pr_run_save_comment)
             can_review: s.prAdmin,                                 // may write TL Review (pr_run_save_review)
             can_ai: s.prAdmin, ai_available: aiAvailable(env) },           // may run the AI review (ai_review_run); whether this environment has a model
      lines: lines.map((x) => ({
        seq: x.seq, type: x.type, sr: x.sr, spec: x.spec_text, can: x.line_id != null, own: x.compliance !== "" || x.remarks !== "",
        compliance: x.compliance, remarks: x.remarks, review: x.review, by: x.answered_by ? nameOf(x.answered_by) : "",
        lib_compliance: x.l_status === "answered" ? x.l_compliance || "" : "", lib_remarks: x.l_status === "answered" ? x.l_remarks || "" : "",
        lib_comments: canComment ? x.l_comments || "" : noteOnly(x.l_comments), tl_review: x.tl_review, ai_draft: !!x.ai_draft, ai: x.ai_draft ? reasons.get(x.seq) || null : null
      }))
    };
  },

  /* Save the answer typed on the website for one row of a record. */
  async pr_run_save_line(env, p) {
    const s = await sessionUser(env, p.p_token);
    const { r } = await runInProject(env, s, p.p_run_id);
    const rl = await rowOf(env, r.id, p.p_seq);
    if (!rl || !rl.line_id) fail("That row cannot be answered.");
    checkRow(rl.spec_text, p.p_check);
    const c = trimmed(p.p_compliance, 200), m = trimmed(p.p_remarks, 4000);
    const draft = rl.ai_draft ? (await latestDrafts(env, r.id, rl.seq)).get(rl.seq) : undefined;
    const { stmts, review } = answerStmts(env, s, rl, c, m, draft, now());
    await env.DB.batch(stmts);
    // one history line per person, record and hour, not one per row
    await prLogHourly(env, r.project_id!, s.id, "Compliance filled online", fileLabel(r));
    return { ok: true, review };
  },

  /* One Compliance answer for every clause of a section: the rows after the heading p_seq down to the next
     section or PART row. Remarks are left as they are. p_replace false = only the clauses that show no answer
     yet. p_compliance '' takes the answers typed in this project off the section again. */
  async pr_run_fill_section(env, p) {
    const s = await sessionUser(env, p.p_token);
    const { r } = await runInProject(env, s, p.p_run_id);
    const h = await rowOf(env, r.id, p.p_seq);
    if (!h || h.type !== "section") fail("That row is not a section heading. Reload the page.");
    checkRow(h.spec_text, p.p_check);
    const c = trimmed(p.p_compliance, 200), replace = bool(p.p_replace);
    const end = await env.DB.prepare("SELECT coalesce(min(seq), 2147483647) AS n FROM cm_run_lines WHERE run_id = ? AND seq > ? AND type IN ('section', 'part')").bind(r.id, h.seq).first<{ n: number }>();
    const rows = await all<RLL>(env.DB.prepare(ROW_WITH_LINE + " WHERE rl.run_id = ? AND rl.seq > ? AND rl.seq < ? AND rl.line_id IS NOT NULL ORDER BY rl.seq").bind(r.id, h.seq, end!.n));
    const drafts = rows.some((x) => x.ai_draft) ? await latestDrafts(env, r.id) : new Map<number, DraftRow>();
    const at = now(), stmts: D1PreparedStatement[] = [];
    let n = 0, kept = 0;
    for (const x of rows) {
      const own = x.compliance !== "" || x.remarks !== "", lib = x.l_status === "answered";
      if (c === "") {
        if (own) { stmts.push(...answerStmts(env, s, x, "", "", drafts.get(x.seq), at).stmts); n++; }
        continue;
      }
      if ((own || lib) && !replace) { kept++; continue; }
      // the remarks the row shows now stay with it
      stmts.push(...answerStmts(env, s, x, c, own ? x.remarks : lib ? x.l_remarks || "" : "", drafts.get(x.seq), at).stmts);
      n++;
    }
    await batched(env.DB, stmts);
    if (n) await prLogHourly(env, r.project_id!, s.id, "Compliance filled online", fileLabel(r));
    return { ok: true, filled: n, kept };
  },

  /* TL Review on one clause of a project record. Only admins of the Projects tile and the super user write
     it; everyone who can open the record reads it. It never leaves the project. */
  async pr_run_save_review(env, p) {
    const s = await sessionUser(env, p.p_token);
    if (!s.prAdmin) fail("Only an admin or the super user can write the TL Review.");
    const { r } = await runInProject(env, s, p.p_run_id);
    const rl = await rowOf(env, r.id, p.p_seq);
    if (!rl || !isBody(rl.type)) fail("That row cannot carry a review. Reload the page.");
    checkRow(rl.spec_text, p.p_check);
    await env.DB.prepare("UPDATE cm_run_lines SET tl_review = ? WHERE run_id = ? AND seq = ?").bind(trimmed(p.p_text, 4000), r.id, rl.seq).run();
    return { ok: true };
  },

  /* Internal Comments written while reading a project record: the library's comments for the clause
     (cm_lines.comments). Only people who may edit the library and can open the project. */
  async pr_run_save_comment(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const { r } = await runInProject(env, s, p.p_run_id);
    const rl = await rowOf(env, r.id, p.p_seq);
    if (!rl || !rl.line_id) fail("That row cannot carry a comment.");
    checkRow(rl.spec_text, p.p_check);
    await env.DB.prepare("UPDATE cm_lines SET comments = ? WHERE id = ?").bind(trimmed(p.p_comments, 4000), rl.line_id).run();
    return { ok: true };
  },

  /* Split one row into several. p_rows: [{ type, sr, spec }, ...] in order, at least two. The first keeps
     the label, the type and the answer of the row; the others are new rows after it. The words never change. */
  async pr_run_split(env, p) {
    const s = await sessionUser(env, p.p_token);
    const { r } = await runInProject(env, s, p.p_run_id);
    const rl = await rowOf(env, r.id, p.p_seq);
    if (!rl) fail("That row no longer exists. Reload the page.");
    checkRow(rl.spec_text, p.p_check);
    const rows = p.p_rows;
    if (!isArray(rows) || rows.length < 2) fail("Press Enter where a new row should start, at least once.");
    const n = rows.length;
    if (n > 60) fail("That is too many rows in one go (more than 60).");
    const total = await env.DB.prepare("SELECT count(*) AS n FROM cm_run_lines WHERE run_id = ?").bind(r.id).first<{ n: number }>();
    if ((total?.n ?? 0) + n > 8000) fail("This specification has too many rows.");
    const parts = rows.map((x) => { const o = isObject(x) ? x : {}; return { type: str(o.type), sr: trimmed(o.sr, 40), spec: tidy(o.spec, 6000) }; });
    if (parts.some((x) => x.spec === "" && x.sr === "")) fail("A row cannot be empty.");
    // the same words, in the same order (the label of the first row stays as it is and is not part of the text)
    const bare = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (bare(parts.map((x, k) => (k ? x.sr : "") + x.spec).join("")) !== bare(rl.spec_text)) {
      fail("The words were changed. A split only puts rows on new lines; it does not edit the specification.");
    }
    const stmts = shiftStmts(env, r.id, rl.seq, n - 1);
    let firstLine: string | null = null;
    for (let k = 0; k < n; k++) {
      const x = parts[k];
      if (k === 0) {
        firstLine = isBody(rl.type) ? await runLine(env, r, rl.type, x.spec) : null;
        stmts.push(env.DB.prepare("UPDATE cm_run_lines SET spec_text = ?, line_id = ? WHERE run_id = ? AND seq = ?").bind(x.spec, firstLine, r.id, rl.seq));
      } else {
        const type = ["part", "section", "letter", "number", "text"].includes(x.type) ? x.type : "text";
        const line = isBody(type) ? await runLine(env, r, type, x.spec) : null;
        stmts.push(env.DB.prepare("INSERT INTO cm_run_lines (run_id, seq, type, sr, spec_text, line_id) VALUES (?, ?, ?, ?, ?, ?)").bind(r.id, rl.seq + k, type, x.sr, x.spec, line));
      }
    }
    if (firstLine == null) {
      // the first row lost its library line (text too short now): its own answer cannot stay
      stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET compliance = '', remarks = '', answered_by = NULL, answered_at = NULL, review = '', reviewed_by = NULL, reviewed_at = NULL, ai_draft = 0
                                   WHERE run_id = ? AND seq = ?`).bind(r.id, rl.seq));
    } else {
      // its text changed, so an answer on it goes (back) to review (an AI draft is not an answer yet)
      stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET review = 'pending', reviewed_by = NULL, reviewed_at = NULL
                                   WHERE run_id = ? AND seq = ? AND ai_draft = 0 AND (compliance <> '' OR remarks <> '')`).bind(r.id, rl.seq));
    }
    await env.DB.batch(stmts);
    if (rl.line_id && rl.line_id !== firstLine) await dropUnusedLine(env, rl.line_id);
    await runReshaped(env, s, r);
    return { ok: true, rows: n };
  },

  /* Join a row to the row above it. The row above keeps its label and type; its own answer wins, otherwise
     the answer of the joined row is kept. Headings (PART rows) are not joined. */
  async pr_run_join(env, p) {
    const s = await sessionUser(env, p.p_token);
    const { r } = await runInProject(env, s, p.p_run_id);
    const seq = int(p.p_seq, -1);
    const b = await rowOf(env, r.id, seq), a = await rowOf(env, r.id, seq - 1);
    if (!a || !b) fail("There is no row above to join to. Reload the page.");
    if (a.type === "part" || b.type === "part") fail("A PART row cannot be joined.");
    checkRow(b.spec_text, p.p_check);
    // a heading cannot hold an answer: the answer on the row would be lost without a word
    if (a.type === "section" && (b.compliance !== "" || b.remarks !== "" || b.tl_review !== "")) {
      fail("The row above is a heading and cannot keep this row's answer or review. Take them off this row first, or join the other way.");
    }
    const spec = (a.spec_text + " " + (b.sr !== "" && b.sr !== "•" ? b.sr + " " : "") + b.spec_text).trim();
    if (spec.length > 6000) fail("Together these two rows are too long for one row.");
    const line = isBody(a.type) ? await runLine(env, r, a.type, spec) : null;
    const keepB = line != null && a.compliance === "" && a.remarks === "" && (b.compliance !== "" || b.remarks !== "");
    const tl = [a.tl_review, b.tl_review].filter(Boolean).join(" / ").slice(0, 4000);
    // the answer the joined row keeps, and its review state (the text changed, so a kept answer is reviewed again)
    const src = line == null ? null : keepB ? b : a;
    const c = src ? src.compliance : "", m = src ? src.remarks : "", draft = src ? src.ai_draft : 0;
    const review = src && (c !== "" || m !== "") && !draft ? "pending" : "";
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(`UPDATE cm_run_lines SET spec_text = ?, line_id = ?, tl_review = ?, compliance = ?, remarks = ?, answered_by = ?, answered_at = ?,
                        review = ?, reviewed_by = NULL, reviewed_at = NULL, ai_draft = ? WHERE run_id = ? AND seq = ?`)
        .bind(spec, line, tl, c, m, src ? src.answered_by : null, src ? src.answered_at : null, review, draft, r.id, a.seq),
      env.DB.prepare("DELETE FROM cm_run_lines WHERE run_id = ? AND seq = ?").bind(r.id, b.seq),
      // the draft that stays with the joined row keeps its number; the other row's drafts are closed
      ...(keepB ? [env.DB.prepare("UPDATE ai_drafts SET status = 'replaced' WHERE run_id = ? AND seq = ? AND status = 'draft'").bind(r.id, a.seq),
                   env.DB.prepare("UPDATE ai_drafts SET seq = ? WHERE run_id = ? AND seq = ?").bind(a.seq, r.id, b.seq)]
                : [env.DB.prepare("UPDATE ai_drafts SET status = 'replaced' WHERE run_id = ? AND seq = ? AND status = 'draft'").bind(r.id, b.seq)]),
      ...shiftStmts(env, r.id, b.seq, -1)
    ];
    await env.DB.batch(stmts);
    if (a.line_id && a.line_id !== line) await dropUnusedLine(env, a.line_id);
    if (b.line_id && b.line_id !== line) await dropUnusedLine(env, b.line_id);
    await runReshaped(env, s, r);
    return { ok: true };
  },

  /* Remove one saved record from a project: p_kind 'run' (a conversion and the answers on it) or 'note'.
     Clauses and approved answers already in the master library stay there. */
  async pr_delete_record(env, p) {
    const s = await sessionUser(env, p.p_token);
    const id = str(p.p_id), kind = str(p.p_kind);
    if (kind === "note") {
      const n = id ? await env.DB.prepare("SELECT project_id, file_names, file_key FROM pr_notes WHERE id = ?").bind(id).first<{ project_id: string; file_names: string; file_key: string }>() : null;
      if (!n) fail("That record no longer exists.");
      await prProject(env, s, n.project_id);
      await env.DB.batch([env.DB.prepare("DELETE FROM pr_notes WHERE id = ?").bind(id), prLogStmt(env, n.project_id, s.id, "Datasheet notes deleted", n.file_names)]);
      if (n.file_key) await env.FILES.delete(n.file_key);
    } else if (kind === "run") {
      const r = id ? await env.DB.prepare("SELECT project_id, file_name FROM cm_runs WHERE id = ?").bind(id).first<{ project_id: string | null; file_name: string }>() : null;
      if (!r || !r.project_id) fail("That record no longer exists.");
      await prProject(env, s, r.project_id);
      // the conversion leaves the project; it stays in the library's conversion history
      await env.DB.batch([
        env.DB.prepare("UPDATE cm_run_lines SET review = '' WHERE run_id = ? AND review = 'pending'").bind(id),
        env.DB.prepare("UPDATE cm_runs SET project_id = NULL WHERE id = ?").bind(id),
        prLogStmt(env, r.project_id, s.id, "Compliance record removed", r.file_name)
      ]);
    } else fail("Unknown record type.");
    return { ok: true };
  },

  /* Delete a whole project (its creator, or an admin). Its datasheet tables (D1 and R2) and history go with
     it. Its conversions leave the project but stay in the library; answers waiting for review are withdrawn. */
  async pr_delete(env, p) {
    const s = await sessionUser(env, p.p_token);
    const pj = await prProject(env, s, p.p_id);
    if (!(pj.created_by === s.id || s.prAdmin)) fail("Only the person who created this project, or an admin, can delete it.");
    const keys = (await all<{ file_key: string }>(env.DB.prepare("SELECT file_key FROM pr_notes WHERE project_id = ?").bind(pj.id))).map((x) => x.file_key).filter(Boolean);
    await env.DB.batch([
      env.DB.prepare("UPDATE cm_run_lines SET review = '' WHERE review = 'pending' AND run_id IN (SELECT id FROM cm_runs WHERE project_id = ?)").bind(pj.id),
      env.DB.prepare("UPDATE cm_runs SET project_id = NULL WHERE project_id = ?").bind(pj.id),
      env.DB.prepare("DELETE FROM pr_notes WHERE project_id = ?").bind(pj.id),
      env.DB.prepare("DELETE FROM pr_members WHERE project_id = ?").bind(pj.id),
      env.DB.prepare("DELETE FROM pr_log WHERE project_id = ?").bind(pj.id),
      env.DB.prepare("DELETE FROM pr_projects WHERE id = ?").bind(pj.id)
    ]);
    if (keys.length) await env.FILES.delete(keys);
    return { ok: true };
  },

  /* Sharing: who the project is shared with, and the people it can be shared with. */
  async pr_share_get(env, p) {
    const s = await sessionUser(env, p.p_token);
    const pj = await prProject(env, s, p.p_id);
    const can = prCanShare(s, pj);
    type M = { id: string; name: string; username: string; added_by: string | null; at: string };
    const members = await all<M>(env.DB.prepare("SELECT au.id, au.full_name AS name, au.username, m.added_by, m.added_at AS at FROM pr_members m JOIN app_users au ON au.id = m.user_id WHERE m.project_id = ? ORDER BY au.full_name").bind(pj.id));
    const nameOf = await namesOf(env, [pj.created_by, ...members.map((m) => m.added_by)]);
    // approved people other than the creator; only sent to someone who may share
    const users = can ? await all(env.DB.prepare("SELECT id, full_name AS name, username, team_note AS team FROM app_users WHERE status = 'approved' AND id <> ? ORDER BY full_name").bind(pj.created_by || "")) : [];
    return { can_share: can, owner: nameOf(pj.created_by), members: members.map((m) => ({ id: m.id, name: m.name, username: m.username, added_by: nameOf(m.added_by), at: m.at })), users };
  },

  /* Set who the project is shared with (the whole list). Admins, or the creator when he is a key user. */
  async pr_share_set(env, p) {
    const s = await sessionUser(env, p.p_token);
    const pj = await prProject(env, s, p.p_id);
    if (!prCanShare(s, pj)) fail("Sharing a project needs an admin, or the project's creator with edit rights.");
    const wanted = (isArray(p.p_user_ids) ? p.p_user_ids : []).filter((x): x is string => typeof x === "string" && x !== "");
    if (wanted.length > 200) fail("A project can be shared with at most 200 people.");
    const ids: string[] = [];
    for (const part of chunks([...new Set(wanted)])) {
      const rows = await all<{ id: string }>(env.DB.prepare(`SELECT id FROM app_users WHERE id IN (${marks(part.length)}) AND status = 'approved' AND id <> ?`).bind(...part, pj.created_by || ""));
      rows.forEach((x) => ids.push(x.id));
    }
    const have = (await all<{ user_id: string }>(env.DB.prepare("SELECT user_id FROM pr_members WHERE project_id = ?").bind(pj.id))).map((x) => x.user_id);
    const added = ids.filter((x) => !have.includes(x)), removed = have.filter((x) => !ids.includes(x));
    const nameOf = await namesOf(env, [...added, ...removed]);
    const names = (list: string[]) => list.map(nameOf).sort((x, y) => x.localeCompare(y)).join(", ");
    const at = now(), stmts: D1PreparedStatement[] = [];
    for (const part of chunks(removed)) stmts.push(env.DB.prepare(`DELETE FROM pr_members WHERE project_id = ? AND user_id IN (${marks(part.length)})`).bind(pj.id, ...part));
    for (const id of added) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO pr_members (project_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(pj.id, id, s.id, at));
    if (added.length) stmts.push(prLogStmt(env, pj.id, s.id, "Shared with", names(added)));
    if (removed.length) stmts.push(prLogStmt(env, pj.id, s.id, "Sharing ended for", names(removed)));
    if (stmts.length) await batched(env.DB, stmts);
    return { ok: true, members: ids.length };
  },

  /* A user's filled compliance for one conversion of his project. p_rows: [{ spec, compliance, remarks }, ...]
     read from the filled Excel. Each answer is stored on the matching row (same text rule as the library;
     the last of a repeated clause wins). Equal to the library's answer = no review; anything else waits. */
  async pr_submit_answers(env, p) {
    const s = await sessionUser(env, p.p_token);
    const { r } = await runInProject(env, s, p.p_run_id);
    const rows = p.p_rows;
    if (!isArray(rows) || rows.length === 0) fail("No rows were found in that file.");
    if (rows.length > 20000) fail("That file has more than 20000 rows.");
    const src = new Map<string, { c: string; m: string }>();
    for (const raw of rows) {
      const o = isObject(raw) ? raw : {};
      const c = trimmed(o.compliance, 200), m = trimmed(o.remarks, 4000);
      if (c === "" && m === "") continue;
      src.set(cmNorm(o.spec), { c, m });
    }
    const lines = await all<RLL>(env.DB.prepare(ROW_WITH_LINE + " WHERE rl.run_id = ? AND rl.line_id IS NOT NULL ORDER BY rl.seq").bind(r.id));
    const drafts = lines.some((x) => x.ai_draft) ? await latestDrafts(env, r.id) : new Map<number, DraftRow>();
    const at = now(), stmts: D1PreparedStatement[] = [];
    let stored = 0, pending = 0;
    for (const x of lines) {
      const a = src.get(cmNorm(x.spec_text));
      if (!a || (x.compliance === a.c && x.remarks === a.m)) continue;
      const w = answerStmts(env, s, x, a.c, a.m, drafts.get(x.seq), at);
      stmts.push(...w.stmts);
      stored++;
      if (w.review === "pending") pending++;
    }
    stmts.push(prLogStmt(env, r.project_id!, s.id, "Filled compliance uploaded", `${stored} answers saved, ${pending} sent for review (${fileLabel(r)})`));
    await batched(env.DB, stmts);
    return { ok: true, rows: rows.length, stored, pending };
  },

  /* ---------- review (editors of the Compliance Maker: admins, the super user, key users) ---------- */

  /* Answers users filled in their projects, for review. p_status: pending | approved | rejected | all. */
  async pr_review_list(env, p) {
    (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const status = ["pending", "approved", "rejected", "all"].includes(str(p.p_status)) ? str(p.p_status) : "pending";
    const limit = Math.min(Math.max(int(p.p_limit, 100), 1), 300), offset = Math.max(int(p.p_offset, 0), 0);
    // 'all' = every answer a person filled in a project (AI drafts nobody accepted are not answers)
    const where = status === "all" ? "r.project_id IS NOT NULL AND (rl.compliance <> '' OR rl.remarks <> '') AND rl.ai_draft = 0" : "rl.review = ?";
    const bind = status === "all" ? [] : [status];
    type Item = { run_id: string; seq: number; sr: string; spec_text: string; compliance: string; remarks: string; review: string; answered_by: string | null; answered_at: string | null;
                  project: string | null; client: string | null; region: string | null; product: string; factory: string; file_name: string;
                  lib_compliance: string | null; lib_remarks: string | null; lib_status: string | null; reviewed_by: string | null; reviewed_at: string | null };
    const [counts, total, items] = await env.DB.batch([
      env.DB.prepare(`SELECT sum(CASE WHEN rl.review = 'pending' THEN 1 ELSE 0 END) AS pending, sum(CASE WHEN rl.review = 'approved' THEN 1 ELSE 0 END) AS approved,
                             sum(CASE WHEN rl.review = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                             sum(CASE WHEN r.project_id IS NOT NULL AND (rl.compliance <> '' OR rl.remarks <> '') AND rl.ai_draft = 0 THEN 1 ELSE 0 END) AS "all"
                        FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id`),
      env.DB.prepare(`SELECT count(*) AS n FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id WHERE ${where}`).bind(...bind),
      env.DB.prepare(`SELECT rl.run_id, rl.seq, rl.sr, rl.spec_text, rl.compliance, rl.remarks, rl.review, rl.answered_by, rl.answered_at,
                             pj.name AS project, pj.client_name AS client, pj.region, pd.name AS product, fa.name AS factory, r.file_name,
                             l.compliance AS lib_compliance, l.remarks AS lib_remarks, l.status AS lib_status, rl.reviewed_by, rl.reviewed_at
                        FROM cm_run_lines rl JOIN cm_runs r ON r.id = rl.run_id JOIN cm_products pd ON pd.id = r.product_id JOIN cm_factories fa ON fa.id = r.factory_id
                        LEFT JOIN pr_projects pj ON pj.id = r.project_id LEFT JOIN cm_lines l ON l.id = rl.line_id
                       WHERE ${where} ORDER BY pj.name IS NULL, pj.name, r.created_at, rl.seq LIMIT ? OFFSET ?`).bind(...bind, limit, offset)
    ]);
    const list = items.results as unknown as Item[];
    const nameOf = await namesOf(env, [...list.map((x) => x.answered_by), ...list.map((x) => x.reviewed_by)]);
    const c = counts.results[0] as Record<string, number | null>;
    return {
      counts: { pending: c.pending ?? 0, approved: c.approved ?? 0, rejected: c.rejected ?? 0, all: c.all ?? 0 },
      total: (total.results[0] as { n: number }).n,
      items: list.map((x) => ({
        run: x.run_id, seq: x.seq, sr: x.sr, spec: x.spec_text, compliance: x.compliance, remarks: x.remarks, review: x.review,
        by: nameOf(x.answered_by), at: x.answered_at, project: x.project ?? "(removed from its project)", client: x.client ?? "", region: x.region ?? "",
        product: x.product, factory: x.factory, file_name: x.file_name, lib_compliance: x.lib_compliance ?? "", lib_remarks: x.lib_remarks ?? "",
        lib_answered: x.lib_status === "answered", reviewed_by: x.reviewed_by ? nameOf(x.reviewed_by) : "", reviewed_at: x.reviewed_at
      }))
    };
  },

  /* Approve (the answer, as given or as corrected here, becomes the library's answer for that clause and
     factory) or reject (it stays in the user's project only). p_line_id: the library line the reviewer was
     looking at; another line means the rows moved. */
  async pr_review_decide(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireEditor("compliance-maker");
    const runId = str(p.p_run_id);
    const rl = runId ? await rowOf(env, runId, p.p_seq) : null;
    if (!rl || !rl.line_id || rl.review === "") fail("That answer is no longer waiting for review.");
    if (p.p_line_id != null && p.p_line_id !== "" && rl.line_id !== p.p_line_id) {
      fail("The rows of that specification were changed since this page was opened. Reload the page and decide again.");
    }
    const r = await env.DB.prepare("SELECT * FROM cm_runs WHERE id = ?").bind(rl.run_id).first<RunRow>();
    const at = now(), decision = str(p.p_decision), stmts: D1PreparedStatement[] = [];
    if (decision === "approve") {
      const c = trimmed(p.p_compliance == null ? rl.compliance : p.p_compliance, 200), m = trimmed(p.p_remarks == null ? rl.remarks : p.p_remarks, 4000);
      if (c === "" && m === "") fail("An approved answer cannot be empty.");
      // a library line that already has an answer is never overwritten from a project
      const l = await env.DB.prepare("SELECT status, compliance, remarks FROM cm_lines WHERE id = ?").bind(rl.line_id).first<LineRow>();
      if (l && l.status === "answered" && (l.compliance !== c || l.remarks !== m)) {
        fail("The library already has an answer for this clause, so it was kept. Change it in the Compliance and Remarks boxes if it needs correcting.");
      }
      stmts.push(env.DB.prepare("UPDATE cm_lines SET compliance = ?, remarks = ?, status = 'answered', answered_by = ?, answered_at = ?, answer_source = 'approved' WHERE id = ?").bind(c, m, s.id, at, rl.line_id));
      stmts.push(env.DB.prepare("INSERT INTO cm_answer_log (line_id, compliance, remarks, source, run_id, user_id) VALUES (?, ?, ?, 'approved', ?, ?)").bind(rl.line_id, c, m, rl.run_id, s.id));
      // the same answer waiting on other conversions of the same clause is settled with it
      stmts.push(env.DB.prepare(`UPDATE cm_run_lines SET review = 'approved', reviewed_by = ?, reviewed_at = ? WHERE line_id = ? AND review = 'pending'
                                   AND ((run_id = ? AND seq = ?) OR (compliance = ? AND remarks = ?))`).bind(s.id, at, rl.line_id, rl.run_id, rl.seq, c, m));
      if (r?.project_id) stmts.push(prLogStmt(env, r.project_id, s.id, "Answer approved for the library", rl.spec_text.slice(0, 200)));
    } else if (decision === "reject") {
      stmts.push(env.DB.prepare("UPDATE cm_run_lines SET review = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE run_id = ? AND seq = ?").bind(s.id, at, rl.run_id, rl.seq));
      if (r?.project_id) stmts.push(prLogStmt(env, r.project_id, s.id, "Answer not taken into the library", rl.spec_text.slice(0, 200)));
    } else fail("Unknown decision.");
    await env.DB.batch(stmts);
    return { ok: true };
  },

  /* What is waiting for a decision, for the Admin page: new users, compliance answers, new mapping rows.
     The project and library numbers are for the admins of the tile those tools sit on. */
  async pr_admin_summary(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireAdmin();
    const pendingUsers = (await env.DB.prepare("SELECT count(*) AS n FROM app_users WHERE status = 'pending'").first<{ n: number }>())!.n;
    if (!s.prAdmin) return { pending_users: pendingUsers, pending_answers: 0, new_rows: 0, projects: 0, limited: true, by_region: [], by_client_type: [], by_product: [] };
    type Tally = { name: string; n: number };
    const [answers, rows, projects, region, type, product] = await env.DB.batch([
      env.DB.prepare("SELECT count(*) AS n FROM cm_run_lines WHERE review = 'pending'"),
      env.DB.prepare("SELECT count(*) AS n FROM dn_map WHERE reviewed = 0"),
      env.DB.prepare("SELECT count(*) AS n FROM pr_projects"),
      env.DB.prepare("SELECT region AS name, count(*) AS n FROM pr_projects GROUP BY region ORDER BY n DESC, region"),
      env.DB.prepare("SELECT client_type AS name, count(*) AS n FROM pr_projects GROUP BY client_type ORDER BY n DESC, client_type"),
      env.DB.prepare(`SELECT pd.name, count(DISTINCT k.project_id) AS n
                        FROM (SELECT project_id, product_id FROM cm_runs WHERE project_id IS NOT NULL UNION ALL SELECT project_id, product_id FROM pr_notes) k
                        JOIN cm_products pd ON pd.id = k.product_id GROUP BY pd.name ORDER BY n DESC, pd.name`)
    ]);
    const n = (r: D1Result) => (r.results[0] as { n: number }).n;
    return { pending_users: pendingUsers, pending_answers: n(answers), new_rows: n(rows), projects: n(projects),
             by_region: region.results as unknown as Tally[], by_client_type: type.results as unknown as Tally[], by_product: product.results as unknown as Tally[] };
  }
};
