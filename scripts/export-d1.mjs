#!/usr/bin/env node
/* Exports everything (standards A.12): D1 as SQL and as JSON per table, and the list of R2 keys.
     node scripts/export-d1.mjs --env production [out-dir]
   The nightly cron keeps the same JSON files in R2 under backups/<date>/; this is the on-demand copy. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const i = process.argv.indexOf("--env");
const envArgs = i > 0 ? ["--env", process.argv[i + 1]] : [];
const where = process.argv.includes("--local") ? "--local" : "--remote";
const out = process.argv.filter((a, k) => k > 1 && !a.startsWith("--") && process.argv[k - 1] !== "--env")[0] || "export-" + new Date().toISOString().slice(0, 10);
mkdirSync(out, { recursive: true });
const w = (args, opts = {}) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: "pipe", maxBuffer: 1 << 30, ...opts });

w(["d1", "export", "DB", where, ...envArgs, "--output", join(out, "hub-db.sql")]);
const tables = JSON.parse(w(["d1", "execute", "DB", where, ...envArgs, "--json", "--command", "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%'"]))[0].results.map((r) => r.name);
for (const t of tables) {
  const rows = JSON.parse(w(["d1", "execute", "DB", where, ...envArgs, "--json", "--command", `SELECT * FROM ${t}`]))[0].results;
  writeFileSync(join(out, t + ".json"), JSON.stringify(rows));
  console.log(`${t}: ${rows.length}`);
}
const keys = w(["r2", "object", "list", "hub-files", ...(where === "--local" ? ["--local"] : ["--remote"]), ...envArgs]);
writeFileSync(join(out, "r2-keys.txt"), keys);
console.log("Done: " + out + " (hub-db.sql, one JSON per table, r2-keys.txt). R2 objects: wrangler r2 object get hub-files/<key>.");
