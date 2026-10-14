#!/usr/bin/env node
/* One-time export of the DAME site's database (Supabase) to JSON files, one per table.
     SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=... node scripts/export-supabase.mjs [out-dir]
   The service_role key bypasses row level security; it is used here only, on the owner's laptop, never in
   the site. Output: <out-dir>/<table>.json (default ./export). Big tables are read in pages.
   Then: node scripts/import-d1.mjs <out-dir> --env staging */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY."); process.exit(1); }
const out = process.argv[2] || "export";
mkdirSync(out, { recursive: true });

/* Every DAME table and the page size to read it with (images and notes carry big values). */
const TABLES = [
  ["app_users", 1000], ["app_categories", 1000], ["app_user_categories", 1000], ["app_tools", 1000], ["app_tool_editors", 1000], ["app_category_admins", 1000],
  ["cm_products", 1000], ["cm_factories", 1000], ["cm_runs", 1000], ["cm_lines", 1000], ["cm_run_lines", 1000], ["cm_answer_log", 1000],
  ["dn_map", 1000], ["dn_map_settings", 1000], ["po_values", 1000], ["po_extras", 1000],
  ["pr_lists", 1000], ["pr_projects", 1000], ["pr_members", 1000], ["pr_log", 1000], ["pr_notes", 20],
  ["mp_maps", 1000], ["mp_nodes", 500], ["mp_images", 10]
];

async function page(table, offset, limit) {
  const res = await fetch(`${URL_.replace(/\/+$/, "")}/rest/v1/${table}?select=*&offset=${offset}&limit=${limit}`, {
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, Prefer: "count=exact" }
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

const counts = {};
for (const [table, size] of TABLES) {
  const rows = [];
  for (let offset = 0; ; offset += size) {
    const part = await page(table, offset, size);
    rows.push(...part);
    process.stdout.write(`\r${table}: ${rows.length}   `);
    if (part.length < size) break;
  }
  writeFileSync(join(out, table + ".json"), JSON.stringify(rows));
  counts[table] = rows.length;
  console.log();
}
writeFileSync(join(out, "_counts.json"), JSON.stringify({ exported_at: new Date().toISOString(), counts }, null, 2));
console.log("Done. Counts in " + join(out, "_counts.json") + " - compare them with the import.");
