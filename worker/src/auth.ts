/* Sessions, roles and the guards every route calls first (standards A.3).
   The rules are those of the DAME site (super user, per-tile admins, users, "Can edit",
   project sharing, map sharing). Pages only mirror them to show or hide.

   One Session object is built per request: the user row plus his tile admin rows, tile access,
   edit grants and the (small) tools and tiles tables, loaded in one D1 batch. Every check after
   that is a pure function, which keeps the routes readable and the checks identical everywhere. */
import type { Env } from "./env";
import { fail, SESSION_EXPIRED } from "./errors";
import { all, now, plus, sha256, uuid } from "./lib/sql";

export const SESSION_HOURS = 12;

export interface UserRow {
  id: string; username: string; full_name: string; team_note: string; pass_hash: string;
  role: "user" | "admin" | "superuser"; status: "pending" | "approved" | "rejected" | "disabled";
  failed_attempts: number; locked_until: string | null; created_at: string;
  approved_by: string | null; approved_at: string | null; last_login_at: string | null; avatar: string | null;
}
export interface Category { id: string; name: string; description: string; sort: number; is_default: number }
export interface Tool {
  id: string; category_id: string; name: string; description: string; path: string;
  status: "live" | "soon" | "hidden"; sort: number; editable: number; project_tool: number;
}

export class Session {
  constructor(
    public env: Env,
    public user: UserRow,
    public adminCats: Set<string>,
    public userCats: Set<string>,
    public editGrants: Set<string>,
    public categories: Category[],
    public tools: Tool[]
  ) {}

  get id(): string { return this.user.id; }
  get isSuper(): boolean { return this.user.role === "superuser"; }
  /* the super user, or the admin of at least one tile (app__require_admin) */
  get isAdmin(): boolean { return this.user.role === "admin" || this.user.role === "superuser"; }

  tool(id: string): Tool | undefined { return this.tools.find((t) => t.id === id); }
  category(id: string): Category | undefined { return this.categories.find((c) => c.id === id); }

  /* app__is_tile_admin: the super user is admin of every tile */
  isTileAdmin(categoryId: string): boolean { return this.isSuper || this.adminCats.has(categoryId); }

  /* may open the tile: admin of it, a default tile, or granted */
  canOpen(categoryId: string): boolean {
    const c = this.category(categoryId);
    return !!c && (this.isTileAdmin(c.id) || !!c.is_default || this.userCats.has(c.id));
  }

  /* app__can_edit */
  canEdit(toolId: string): boolean {
    const t = this.tool(toolId);
    if (!t || !t.editable) return false;
    if (this.isTileAdmin(t.category_id)) return true;
    return this.editGrants.has(toolId) && this.canOpen(t.category_id);
  }

  /* pr__is_admin: the super user, or the admin of the tile the Projects tool sits on */
  get prAdmin(): boolean {
    const t = this.tool("projects");
    return this.isSuper || (!!t && this.isTileAdmin(t.category_id));
  }

  /* the tiles the caller may manage (app_admin_overview.scope) */
  get scope(): string[] {
    return this.categories.slice().sort(bySort).filter((c) => this.isTileAdmin(c.id)).map((c) => c.id);
  }

  requireAdmin(): this { if (!this.isAdmin) fail("Admin access required."); return this; }
  requireSuper(): this { if (!this.isSuper) fail("Only the super user can do this."); return this; }
  requireEditor(toolId: string): this { if (!this.canEdit(toolId)) fail("Edit access for this tool is required."); return this; }
  requirePrAdmin(): this { if (!this.prAdmin) fail("Only an admin or the super user can do this."); return this; }

  /* app__profile: the user, and ONLY the tiles and tools he may open */
  profile(): Record<string, unknown> {
    const u = this.user;
    return {
      user: {
        id: u.id, username: u.username, full_name: u.full_name, role: u.role, avatar: u.avatar,
        created_at: u.created_at, last_login_at: u.last_login_at,
        admin_categories: this.scope,
        edit_tools: this.tools.filter((t) => this.canEdit(t.id)).map((t) => t.id).sort()
      },
      categories: this.categories.slice().sort(bySort).filter((c) => this.canOpen(c.id)).map((c) => ({
        id: c.id, name: c.name, description: c.description, allowed: true, admin: this.isTileAdmin(c.id),
        tools: this.tools.filter((t) => t.category_id === c.id && t.status !== "hidden").sort(bySort).map((t) => ({
          id: t.id, name: t.name, description: t.description, path: t.path, status: t.status,
          project_tool: !!t.project_tool, editable: !!t.editable, sort: t.sort, category_id: t.category_id,
          can_edit: this.canEdit(t.id)
        }))
      }))
    };
  }
}

export function bySort(a: { sort: number; name: string }, b: { sort: number; name: string }): number {
  return (a.sort - b.sort) || a.name.localeCompare(b.name);
}

/* What D1 stores for a token: a hash salted with SESSION_SECRET, so a copy of the database alone cannot be
   turned into sessions, and rotating the secret signs every user out. */
export async function tokenHash(token: string, env?: Env): Promise<string> {
  return sha256((env?.SESSION_SECRET || "") + ":" + token);
}

/* Load the access data of one user row into a Session (one batch). */
export async function sessionFor(env: Env, user: UserRow): Promise<Session> {
  const [ac, uc, eg, cats, tools] = await env.DB.batch([
    env.DB.prepare("SELECT category_id FROM app_category_admins WHERE user_id = ?").bind(user.id),
    env.DB.prepare("SELECT category_id FROM app_user_categories WHERE user_id = ?").bind(user.id),
    env.DB.prepare("SELECT tool_id FROM app_tool_editors WHERE user_id = ?").bind(user.id),
    env.DB.prepare("SELECT * FROM app_categories"),
    env.DB.prepare("SELECT * FROM app_tools")
  ]);
  const ids = (r: D1Result, k: string) => new Set((r.results as Record<string, string>[]).map((x) => x[k]));
  return new Session(env, user, ids(ac, "category_id"), ids(uc, "category_id"), ids(eg, "tool_id"),
    cats.results as unknown as Category[], tools.results as unknown as Tool[]);
}

/* app__session_user: the approved user behind a live token, or SESSION_EXPIRED. */
export async function sessionUser(env: Env, token: unknown): Promise<Session> {
  const t = typeof token === "string" ? token : "";
  if (!t) fail(SESSION_EXPIRED);
  const h = await tokenHash(t, env);
  const row = await env.DB.prepare(
    `SELECT u.*, s.expires_at AS s_expires, s.last_seen_at AS s_seen FROM app_sessions s JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).bind(h, now()).first<UserRow & { s_expires: string; s_seen: string }>();
  if (!row || row.status !== "approved") fail(SESSION_EXPIRED);
  // touch last_seen at most once a minute
  if (Date.now() - Date.parse(row.s_seen) > 60000) {
    await env.DB.prepare("UPDATE app_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now(), h).run();
  }
  const { s_expires: _e, s_seen: _s, ...user } = row;
  return sessionFor(env, user as UserRow);
}

/* A new session for the user; the old one is deleted (one session per user). Returns the token. */
export async function openSession(env: Env, userId: string): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const h = await tokenHash(token, env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM app_sessions WHERE expires_at < ? OR user_id = ?").bind(now(), userId),
    env.DB.prepare("INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(h, userId, plus(SESSION_HOURS * 3600000))
  ]);
  return token;
}

export async function closeSession(env: Env, token: unknown): Promise<void> {
  const t = typeof token === "string" ? token : "";
  if (!t) return;
  await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(await tokenHash(t, env)).run();
}

/* app_audit: who did what, before and after. Never deleted. */
export async function audit(env: Env, userId: string | null, action: string, target = "", before: unknown = "", after: unknown = "", neurons = 0): Promise<void> {
  const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? "")).slice(0, 8000);
  await env.DB.prepare("INSERT INTO app_audit (id, user_id, action, target, before, after, neurons) VALUES (NULL, ?, ?, ?, ?, ?, ?)")
    .bind(userId, action, target.slice(0, 200), s(before), s(after), neurons).run();
}

export { uuid };

/* Full name of a user id, as pr__name / mp__name gave it. */
export async function nameOf(env: Env, userId: string | null): Promise<string> {
  if (!userId) return "(deleted user)";
  const r = await env.DB.prepare("SELECT full_name FROM app_users WHERE id = ?").bind(userId).first<{ full_name: string }>();
  return r ? r.full_name : "(deleted user)";
}

/* A map of id -> full name for many ids at once (one query). */
export async function namesOf(env: Env, ids: Iterable<string | null | undefined>): Promise<(id: string | null | undefined) => string> {
  const list = [...new Set([...ids].filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  for (let i = 0; i < list.length; i += 90) {
    const part = list.slice(i, i + 90);
    const rows = await all<{ id: string; full_name: string }>(env.DB.prepare(`SELECT id, full_name FROM app_users WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part));
    rows.forEach((r) => map.set(r.id, r.full_name));
  }
  return (id) => (id && map.get(id)) || "(deleted user)";
}
