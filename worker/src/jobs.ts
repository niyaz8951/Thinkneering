/* Cron Triggers (wrangler.toml):
     every 5 minutes  embed the rows waiting in ai_jobs into Vectorize (100 a run)
     02:30 UTC daily  export every table to R2 as JSON (backups/YYYY-MM-DD/<table>.json), keep 90 days;
                      then write what the AI learned into its maps (ai/learn.ts)
   Both are safe to run again; both do nothing when their binding is missing (local, tests). */
import type { Env } from "./env";
import { all, now } from "./lib/sql";
import { embed } from "./ai/models";
import { learnToMaps } from "./ai/learn";

const TABLES = ["app_users", "app_sessions", "app_categories", "app_user_categories", "app_tools", "app_tool_editors", "app_category_admins", "app_audit",
  "cm_products", "cm_factories", "cm_runs", "cm_lines", "cm_run_lines", "cm_answer_log", "dn_map", "dn_map_settings", "po_values", "po_extras",
  "pr_lists", "pr_projects", "pr_notes", "pr_members", "pr_log", "mp_maps", "mp_nodes", "mp_images", "ai_drafts", "ai_jobs", "ai_chats", "ai_chat_messages"];

export async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  if (event.cron === "30 2 * * *") {
    await backup(env);
    // what people changed the same way 3 times or more becomes a "to verify" branch under Learned in the AI map
    try { await learnToMaps(env, null, null); } catch (e) { console.log("learn", e); }
  }
  else await indexPending(env);
}

/* Embeds pending clauses and upserts them into hub-vectors with the metadata the searches filter on. */
export async function indexPending(env: Env, limit = 90): Promise<{ done: number; failed: number }> {
  if (!env.VECTORS || !env.AI) return { done: 0, failed: 0 };
  type Job = { id: number; kind: string; ref_id: string; action: string };
  const jobs = await all<Job>(env.DB.prepare("SELECT id, kind, ref_id, action FROM ai_jobs WHERE done_at IS NULL ORDER BY id LIMIT ?").bind(limit));
  if (!jobs.length) return { done: 0, failed: 0 };
  const at = now();
  let done = 0, failed = 0;
  try {
    const dels = jobs.filter((j) => j.action === "delete").map((j) => j.ref_id);
    if (dels.length) await env.VECTORS.deleteByIds(dels);
    const ups = jobs.filter((j) => j.action !== "delete" && j.kind === "clause");
    const ids = ups.map((j) => j.ref_id);
    const lines = ids.length ? await all<{ id: string; product_id: string; factory_id: string; spec_text: string }>(
      env.DB.prepare(`SELECT id, product_id, factory_id, spec_text FROM cm_lines WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids)) : [];
    if (lines.length) {
      const vectors = await embed(env, lines.map((l) => l.spec_text.slice(0, 2000)));
      await env.VECTORS.upsert(lines.map((l, i) => ({ id: l.id, values: vectors[i], metadata: { kind: "clause", product_id: l.product_id, factory_id: l.factory_id, ref_id: l.id } })));
    }
    // a clause deleted between the job and now is simply skipped
    await env.DB.batch(jobs.map((j) => env.DB.prepare("UPDATE ai_jobs SET done_at = ? WHERE id = ?").bind(at, j.id)));
    done = jobs.length;
  } catch (e) {
    // a failing batch is closed with its error, so it never blocks the queue; `npm run reindex` queues it again
    failed = jobs.length;
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await env.DB.batch(jobs.map((j) => env.DB.prepare("UPDATE ai_jobs SET error = ?, done_at = ? WHERE id = ?").bind(msg, at, j.id)));
    console.error("indexPending", msg);
  }
  return { done, failed };
}

/* JSON files per table under backups/<date>/ (<table>.json, or <table>-2.json, -3.json ... in parts of 2000
   rows for big tables, so memory stays small), and the folders older than 90 days removed. */
export async function backup(env: Env): Promise<string> {
  const day = now().slice(0, 10), size = 2000;
  for (const t of TABLES) {
    for (let part = 1, offset = 0; ; part++, offset += size) {
      const rows = await all(env.DB.prepare(`SELECT * FROM ${t} LIMIT ? OFFSET ?`).bind(size, offset));
      if (part > 1 && !rows.length) break;
      await env.FILES.put(`backups/${day}/${t}${part > 1 ? "-" + part : ""}.json`, JSON.stringify(rows), { httpMetadata: { contentType: "application/json" } });
      if (rows.length < size) break;
    }
  }
  const keep = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  let cursor: string | undefined;
  do {
    const list = await env.FILES.list({ prefix: "backups/", cursor });
    const old = list.objects.filter((o) => o.key.slice(8, 18) < keep).map((o) => o.key);
    if (old.length) await env.FILES.delete(old);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return day;
}
