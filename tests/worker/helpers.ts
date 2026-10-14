/* Shared by every route test: the demo users, a direct call into the router, and a login. */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { handleRpc } from "../../worker/src/index";
import { hashPassword } from "../../worker/src/lib/password";

export type Json = Record<string, any>;

/* Calls POST /api/rpc/<name> the way api.js does; returns the JSON body (ok:false bodies included). */
export async function rpc(name: string, params: Json = {}): Promise<Json> {
  const ctx = createExecutionContext();
  const req = new Request("http://hub.test/api/rpc/" + name, { method: "POST", body: JSON.stringify(params), headers: { "Content-Type": "application/json" } });
  const res = await handleRpc(name, req, env as any, ctx);
  await waitOnExecutionContext(ctx);
  const body = (await res.json()) as Json;
  return { ...body, _status: res.status };
}

/* A call that must succeed. */
export async function ok(name: string, params: Json = {}): Promise<Json> {
  const r = await rpc(name, params);
  if (r.ok === false || r._status >= 400) throw new Error(`${name} failed: ${r.error} (${r._status})`);
  return r;
}

/* A call that must be refused; returns the error text. */
export async function refused(name: string, params: Json = {}): Promise<string> {
  const r = await rpc(name, params);
  if (!(r.ok === false || r._status >= 400)) throw new Error(`${name} was allowed but should have been refused`);
  return String(r.error || "");
}

export const USERS = {
  admin:      { id: "u1", username: "admin",      full_name: "Demo Super User", password: "admin12345",  role: "superuser", status: "approved" },
  teamAdmin:  { id: "u4", username: "team.admin", full_name: "Team Admin",      password: "admin12345",  role: "admin",     status: "approved", admin_categories: ["general", "sales", "sbu"] },
  sales:      { id: "u2", username: "sales.user", full_name: "Sales User",      password: "sales12345",  role: "user",      status: "approved", categories: ["sales"], edit_tools: ["compliance-maker"] },
  sbu:        { id: "u5", username: "sbu.user",   full_name: "SBU User",        password: "sbu12345",    role: "user",      status: "approved", categories: ["sbu"] },
  joiner:     { id: "u3", username: "new.joiner", full_name: "New Joiner",      password: "joiner12345", role: "user",      status: "pending" }
} as const;
export type Who = keyof typeof USERS;

let seeded = false;
/* The same demo users as the DAME site. Hashes use few iterations so tests stay fast; app_login re-hashes. */
export async function seedUsers(): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const u of Object.values(USERS)) {
    const hash = await hashPassword(u.password, 1000);
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO app_users (id, username, full_name, pass_hash, role, status, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(u.id, u.username, u.full_name, hash, u.role, u.status, u.status === "approved" ? "2026-10-01T00:00:00.000Z" : null));
    for (const c of (u as any).admin_categories || []) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO app_category_admins (user_id, category_id) VALUES (?, ?)").bind(u.id, c));
    for (const c of (u as any).categories || []) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO app_user_categories (user_id, category_id) VALUES (?, ?)").bind(u.id, c));
    for (const t of (u as any).edit_tools || []) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO app_tool_editors (user_id, tool_id) VALUES (?, ?)").bind(u.id, t));
  }
  await env.DB.batch(stmts);
  seeded = true;
}

const tokens = new Map<Who, string>();
/* Logs the demo user in once per test file and returns the token. */
export async function login(who: Who): Promise<string> {
  if (!seeded) await seedUsers();
  const u = USERS[who];
  const r = await rpc("app_login", { p_username: u.username, p_password: u.password });
  if (!r.ok) throw new Error("login failed for " + who + ": " + r.error);
  tokens.set(who, r.token);
  return r.token;
}

/* Storage is isolated per test FILE (vitest-plugin), so every test starts by wiping the data tables
   (the reference tables - tiles, tools, products, factories, lists - stay) and re-seeding the users. */
const DATA_TABLES = ["ai_chat_messages", "ai_chats", "ai_jobs", "ai_drafts", "cm_answer_log", "cm_run_lines", "cm_runs", "cm_lines",
  "pr_log", "pr_members", "pr_notes", "pr_projects", "dn_map", "dn_map_settings", "po_values", "po_extras",
  "mp_images", "mp_nodes", "mp_maps", "app_audit", "app_sessions", "app_tool_editors", "app_category_admins", "app_user_categories", "app_users"];
export async function resetLogins(): Promise<void> {
  await env.DB.batch(DATA_TABLES.map((t) => env.DB.prepare("DELETE FROM " + t)));
  seeded = false; tokens.clear();
}

/* A small specification in the shape cm-engine.js produces (type, sr, spec). */
export const SPEC_LINES = [
  { type: "part", sr: "", spec: "PART 1 - GENERAL" },
  { type: "section", sr: "1.01", spec: "SUMMARY" },
  { type: "letter", sr: "A.", spec: "This section includes factory assembled air handling units with fans, coils, filters and controls." },
  { type: "part", sr: "", spec: "PART 2 - PRODUCTS" },
  { type: "section", sr: "2.01", spec: "CASING" },
  { type: "letter", sr: "A.", spec: "Casing shall be double skin construction with 50 mm thick panels and thermal break profiles." },
  { type: "letter", sr: "B.", spec: "Panels shall be insulated with 50 mm injected polyurethane foam of density not less than 40 kg/m3." },
  { type: "number", sr: "1.", spec: "Short." },
  { type: "section", sr: "2.02", spec: "FANS" },
  { type: "letter", sr: "A.", spec: "Fans shall be plug type with backward curved blades, directly driven by EC motors." }
];
