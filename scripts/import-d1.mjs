#!/usr/bin/env node
/* Loads the JSON export of the DAME site (scripts/export-supabase.mjs) into D1 and R2 (standards A.11 step 3).
     node scripts/import-d1.mjs <export-dir> --local   (or --remote = the live D1 at the top level of wrangler.toml)
   Repeatable: it empties the data tables first (never the reference rows seeded by the migration: tiles,
   tools, products, factories, lists - those are kept as they are on the new site; users' rows that reference
   them must match by id). Type mapping: uuid -> TEXT as is; booleans -> 0/1; timestamptz -> ISO UTC;
   jsonb -> JSON text; bcrypt hashes -> "bcrypt$<hash>" (re-hashed with PBKDF2 at the next login);
   pr_notes.rows -> R2 notes/<project>/<note>.json; mp_images data/thumb -> R2 maps/<map>/<image>.jpg.
   Sessions are not migrated. Vectorize is rebuilt afterwards by the cron (npm run reindex queues every clause). */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const dir = process.argv[2];
if (!dir || !existsSync(dir)) { console.error("Usage: node scripts/import-d1.mjs <export-dir> --local | --remote"); process.exit(1); }
const envIdx = process.argv.indexOf("--env");
const target = process.argv.includes("--local") ? ["--local"] : envIdx > 0 ? ["--remote", "--env", process.argv[envIdx + 1]] : process.argv.includes("--remote") ? ["--remote"] : null;
if (!target) { console.error("Say where: --local or --remote (the live site)"); process.exit(1); }
const envArgs = target.length === 3 ? ["--env", target[2]] : [];
const where = target[0];

const read = (t) => existsSync(join(dir, t + ".json")) ? JSON.parse(readFileSync(join(dir, t + ".json"), "utf8")) : [];
const q = (v) => v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const b = (v) => v ? 1 : 0;
const ts = (v) => v == null ? null : new Date(v).toISOString();
const js = (v) => v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
const hashNorm = (norm) => createHash("sha256").update(norm).digest("hex").slice(0, 32);   // normHash() in worker/src/lib/sql.ts

const work = join(dir, "_sql");
rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
let fileNo = 0;
const files = [];
function sqlFile(lines) {
  if (!lines.length) return;
  for (let i = 0; i < lines.length; i += 400) {
    const f = join(work, String(++fileNo).padStart(4, "0") + ".sql");
    writeFileSync(f, "PRAGMA defer_foreign_keys = true;\n" + lines.slice(i, i + 400).join("\n") + "\n");
    files.push(f);
  }
}
function insert(table, cols, rows, map) {
  const lines = rows.map((r) => { const v = map(r); return `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => q(v[c])).join(",")});`; });
  sqlFile(lines);
  console.log(`${table}: ${rows.length}`);
}
function wrangler(args) { return execFileSync("npx", ["wrangler", ...args], { stdio: "pipe", encoding: "utf8" }); }

// 1. empty the data tables (reference tables stay)
sqlFile(["ai_chat_messages", "ai_chats", "ai_jobs", "ai_drafts", "cm_answer_log", "cm_run_lines", "cm_runs", "cm_lines", "pr_log", "pr_members", "pr_notes", "pr_projects",
  "dn_map", "dn_map_settings", "po_values", "po_extras", "mp_images", "mp_nodes", "mp_maps", "app_audit", "app_sessions", "app_tool_editors", "app_category_admins", "app_user_categories", "app_users"]
  .map((t) => `DELETE FROM ${t};`));

// 2. users and access
insert("app_users", ["id", "username", "full_name", "team_note", "pass_hash", "role", "status", "failed_attempts", "locked_until", "created_at", "approved_by", "approved_at", "last_login_at", "avatar"], read("app_users"),
  (r) => ({ ...r, pass_hash: r.pass_hash.startsWith("$2") ? "bcrypt$" + r.pass_hash : r.pass_hash, locked_until: ts(r.locked_until), created_at: ts(r.created_at), approved_at: ts(r.approved_at), last_login_at: ts(r.last_login_at) }));
insert("app_user_categories", ["user_id", "category_id"], read("app_user_categories"), (r) => r);
insert("app_category_admins", ["user_id", "category_id", "granted_by", "granted_at"], read("app_category_admins"), (r) => ({ ...r, granted_at: ts(r.granted_at) }));
insert("app_tool_editors", ["user_id", "tool_id", "granted_by", "granted_at"], read("app_tool_editors"), (r) => ({ ...r, granted_at: ts(r.granted_at) }));
// tiles and tools added by the super user on the old site that the migration did not seed
insert("app_categories", ["id", "name", "description", "sort", "is_default"], read("app_categories"), (r) => ({ ...r, is_default: b(r.is_default) }));
insert("app_tools", ["id", "category_id", "name", "description", "path", "status", "sort", "editable", "project_tool"], read("app_tools"), (r) => ({ ...r, editable: b(r.editable), project_tool: b(r.project_tool) }));
insert("cm_products", ["id", "name", "sort", "active"], read("cm_products"), (r) => ({ ...r, active: b(r.active) }));
insert("cm_factories", ["id", "product_id", "name", "sort", "active"], read("cm_factories"), (r) => ({ ...r, active: b(r.active) }));

// 3. projects first (cm_runs point at them), then the library
insert("pr_lists", ["kind", "value", "sort"], read("pr_lists"), (r) => r);
insert("pr_projects", ["id", "name", "client_type", "client_name", "region", "created_by", "created_at", "updated_by", "updated_at"], read("pr_projects"), (r) => ({ ...r, created_at: ts(r.created_at), updated_at: ts(r.updated_at) }));
insert("pr_members", ["project_id", "user_id", "added_by", "added_at"], read("pr_members"), (r) => ({ ...r, added_at: ts(r.added_at) }));
insert("pr_log", ["project_id", "user_id", "action", "detail", "created_at"], read("pr_log"), (r) => ({ ...r, created_at: ts(r.created_at) }));
insert("cm_runs", ["id", "kind", "user_id", "product_id", "factory_id", "source", "file_name", "line_count", "unique_count", "matched_count", "project_id", "created_at"], read("cm_runs"), (r) => ({ ...r, created_at: ts(r.created_at) }));
insert("cm_lines", ["id", "product_id", "factory_id", "norm_hash", "norm_text", "spec_text", "compliance", "remarks", "comments", "status", "times_seen", "first_run_id", "first_seen_at", "last_seen_at", "answered_by", "answered_at", "answer_source", "part", "section", "home_run", "home_seq", "sr", "row_type", "section_sr"],
  read("cm_lines"), (r) => ({ ...r, norm_hash: hashNorm(r.norm_text), comments: r.comments || "", first_seen_at: ts(r.first_seen_at), last_seen_at: ts(r.last_seen_at), answered_at: ts(r.answered_at), part: r.part || 0, section: r.section || "", sr: r.sr || "", row_type: r.row_type || "", section_sr: r.section_sr || "" }));
insert("cm_run_lines", ["run_id", "seq", "type", "sr", "spec_text", "line_id", "compliance", "remarks", "answered_by", "answered_at", "review", "reviewed_by", "reviewed_at", "tl_review", "ai_draft"], read("cm_run_lines"),
  (r) => ({ ...r, compliance: r.compliance || "", remarks: r.remarks || "", answered_at: ts(r.answered_at), review: r.review || "", reviewed_at: ts(r.reviewed_at), tl_review: r.tl_review || "", ai_draft: 0 }));
insert("cm_answer_log", ["line_id", "compliance", "remarks", "source", "run_id", "user_id", "created_at"], read("cm_answer_log"), (r) => ({ ...r, created_at: ts(r.created_at) }));

// 4. row mapping and product options
insert("dn_map", ["product_id", "row_key", "section", "sub", "component", "show", "label", "strip", "response", "keywords", "sort", "reviewed", "in_tree", "updated_by", "updated_at"], read("dn_map"),
  (r) => ({ ...r, show: b(r.show), reviewed: b(r.reviewed), in_tree: b(r.in_tree ?? true), keywords: r.keywords || "", updated_at: ts(r.updated_at) }));
insert("dn_map_settings", ["product_id", "show_unmapped", "updated_by", "updated_at"], read("dn_map_settings"), (r) => ({ ...r, show_unmapped: b(r.show_unmapped), updated_at: ts(r.updated_at) }));
insert("po_values", ["factory_id", "row_key", "model", "value_key", "value", "times", "hidden", "first_at", "last_at"], read("po_values"), (r) => ({ ...r, model: r.model || "", hidden: b(r.hidden), first_at: ts(r.first_at), last_at: ts(r.last_at) }));
insert("po_extras", ["id", "factory_id", "section", "row_key", "kind", "body", "created_by", "created_at", "updated_by", "updated_at"], read("po_extras"), (r) => ({ ...r, created_at: ts(r.created_at), updated_at: ts(r.updated_at) }));

// 5. datasheet tables: metadata in D1, rows in R2
const r2 = [];
const notes = read("pr_notes");
insert("pr_notes", ["id", "project_id", "user_id", "product_id", "file_names", "units", "row_count", "columns", "file_key", "bytes", "created_at"], notes, (r) => {
  const key = `notes/${r.project_id}/${r.id}.json`, body = JSON.stringify({ rows: r.rows || [] });
  const f = join(work, `note-${r.id}.json`); writeFileSync(f, body); r2.push([key, f, "application/json"]);
  return { ...r, columns: js(r.columns || []), file_key: key, bytes: Buffer.byteLength(body), created_at: ts(r.created_at) };
});

// 6. maps: images to R2
insert("mp_maps", ["id", "name", "share", "created_by", "created_at", "updated_by", "updated_at"], read("mp_maps"), (r) => ({ ...r, created_at: ts(r.created_at), updated_at: ts(r.updated_at) }));
insert("mp_nodes", ["id", "map_id", "parent_id", "title", "notes", "special", "links", "sort", "verified", "verified_by", "verified_at", "created_by", "created_at", "updated_by", "updated_at"], read("mp_nodes"),
  (r) => ({ ...r, special: js(r.special || []), links: js(r.links || []), verified: b(r.verified), verified_at: ts(r.verified_at), created_at: ts(r.created_at), updated_at: ts(r.updated_at) }));
insert("mp_images", ["id", "map_id", "node_id", "caption", "file_key", "thumb_key", "bytes", "created_by", "created_at"], read("mp_images"), (r) => {
  const key = `maps/${r.map_id}/${r.id}.jpg`, tkey = `maps/${r.map_id}/${r.id}-thumb.jpg`;
  const dec = (d) => Buffer.from(String(d).replace(/^data:image\/jpeg;base64,/, ""), "base64");
  const f = join(work, `img-${r.id}.jpg`), t = join(work, `img-${r.id}-thumb.jpg`);
  const data = dec(r.data); writeFileSync(f, data); writeFileSync(t, dec(r.thumb));
  r2.push([key, f, "image/jpeg"]); r2.push([tkey, t, "image/jpeg"]);
  return { ...r, file_key: key, thumb_key: tkey, bytes: data.length, created_at: ts(r.created_at) };
});

// 7. queue every clause for Vectorize
sqlFile(["INSERT INTO ai_jobs (kind, ref_id) SELECT 'clause', id FROM cm_lines;"]);

// 8. run it
console.log(`\nWriting ${files.length} SQL files to D1 (${where}${envArgs.length ? " " + envArgs[1] : ""}) ...`);
for (const f of files) { wrangler(["d1", "execute", "DB", where, ...envArgs, "--file", f]); process.stdout.write("."); }
console.log(`\nUploading ${r2.length} files to R2 ...`);
for (const [key, f, ct] of r2) { wrangler(["r2", "object", "put", `hub-files/${key}`, "--file", f, "--content-type", ct, ...(where === "--local" ? ["--local"] : ["--remote"]), ...envArgs]); process.stdout.write("."); }
console.log("\nDone. Compare the counts with " + join(dir, "_counts.json") + ":");
for (const t of ["app_users", "cm_lines", "cm_run_lines", "cm_runs", "pr_projects", "pr_notes", "mp_maps", "mp_nodes", "mp_images", "po_values", "dn_map"]) {
  const out = wrangler(["d1", "execute", "DB", where, ...envArgs, "--json", "--command", `SELECT count(*) AS n FROM ${t}`]);
  console.log(`  ${t}: ${JSON.parse(out)[0].results[0].n}`);
}
