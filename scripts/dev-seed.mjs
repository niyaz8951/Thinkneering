#!/usr/bin/env node
/* Local development seed. Run by `npm run dev` before wrangler dev:
     1. applies db/migrations to the local D1 (Miniflare, .wrangler/state)
     2. if the demo users are missing, creates them: the same users as the DAME demo back end
        admin / admin12345 (super user), team.admin / admin12345 (admin of every tile),
        sales.user / sales12345 (Sales tile, "Can edit" for the Compliance Maker),
        sbu.user / sbu12345 (SBU tile), new.joiner / joiner12345 (pending)
   --fresh wipes the local database first. Never run against production (RUNBOOK). */
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

const fresh = process.argv.includes("--fresh");
const ITER = 600000;

function hash(password) {
  const salt = randomBytes(16);
  return `pbkdf2$${ITER}$${salt.toString("hex")}$${pbkdf2Sync(password, salt, ITER, 32, "sha256").toString("hex")}`;
}
function wrangler(args, opts = {}) {
  return execFileSync("npx", ["wrangler", ...args], { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
}
function sql(command) {
  const out = wrangler(["d1", "execute", "hub-db", "--local", "--json", "--command", command], { quiet: true });
  return JSON.parse(out);
}

if (fresh) {
  rmSync(".wrangler/state/v3/d1", { recursive: true, force: true });
  console.log("Local database wiped.");
}
wrangler(["d1", "migrations", "apply", "hub-db", "--local"]);

const n = sql("SELECT count(*) AS n FROM app_users")[0].results[0].n;
if (n > 0) {
  console.log(`Local database has ${n} users; demo users not added.`);
} else {
  const users = [
    { username: "admin", full_name: "Demo Super User", password: "admin12345", role: "superuser", status: "approved" },
    { username: "team.admin", full_name: "Team Admin", password: "admin12345", role: "admin", status: "approved", team_note: "Sales", admin: ["general", "sales", "sbu"] },
    { username: "sales.user", full_name: "Sales User", password: "sales12345", role: "user", status: "approved", team_note: "Sales", cats: ["sales"], edit: ["compliance-maker"] },
    { username: "sbu.user", full_name: "SBU User", password: "sbu12345", role: "user", status: "approved", team_note: "SBU", cats: ["sbu"] },
    { username: "new.joiner", full_name: "New Joiner", password: "joiner12345", role: "user", status: "pending", team_note: "SBU" }
  ];
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = [];
  for (const u of users) {
    const id = randomUUID();
    lines.push(`INSERT INTO app_users (id, username, full_name, team_note, pass_hash, role, status, approved_at) VALUES (${q(id)}, ${q(u.username)}, ${q(u.full_name)}, ${q(u.team_note || "")}, ${q(hash(u.password))}, ${q(u.role)}, ${q(u.status)}, ${u.status === "approved" ? "datetime('now')" : "NULL"});`);
    for (const c of u.admin || []) lines.push(`INSERT INTO app_category_admins (user_id, category_id) VALUES (${q(id)}, ${q(c)});`);
    for (const c of u.cats || []) lines.push(`INSERT INTO app_user_categories (user_id, category_id) VALUES (${q(id)}, ${q(c)});`);
    for (const t of u.edit || []) lines.push(`INSERT INTO app_tool_editors (user_id, tool_id) VALUES (${q(id)}, ${q(t)});`);
  }
  sql(lines.join("\n"));
  console.log("Demo users created: admin / admin12345, team.admin / admin12345, sales.user / sales12345, sbu.user / sbu12345, new.joiner (pending).");
}
