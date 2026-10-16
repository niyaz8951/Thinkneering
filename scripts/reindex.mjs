#!/usr/bin/env node
/* Queues every library clause for Vectorize; the 5-minute cron embeds them in batches of 100.
     node scripts/reindex.mjs              (the live site; --env <name> only if an environment is added)
   This is also how the index is rebuilt on a new Cloudflare account (Vectorize is never backed up). */
import { execFileSync } from "node:child_process";
const i = process.argv.indexOf("--env");
const envArgs = i > 0 ? ["--env", process.argv[i + 1]] : [];
const where = process.argv.includes("--local") ? "--local" : "--remote";
const run = (cmd) => execFileSync("npx", ["wrangler", "d1", "execute", "DB", where, ...envArgs, "--command", cmd], { stdio: "pipe", encoding: "utf8" });
run("DELETE FROM ai_jobs WHERE done_at IS NULL;");
run("INSERT INTO ai_jobs (kind, ref_id) SELECT 'clause', id FROM cm_lines;");
const out = execFileSync("npx", ["wrangler", "d1", "execute", "DB", where, ...envArgs, "--json", "--command", "SELECT count(*) AS n FROM ai_jobs WHERE done_at IS NULL"], { encoding: "utf8" });
console.log(`${JSON.parse(out)[0].results[0].n} clauses queued; the cron embeds 100 every 5 minutes.`);
