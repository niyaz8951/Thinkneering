/* app_* : request access, login, profile, admin. Same names and parameters as db/schema.sql. */
import type { Env, Params } from "../env";
import type { Routes } from "../router";
import { fail } from "../errors";
import { Session, sessionUser, sessionFor, openSession, closeSession, audit, tokenHash, bySort, type UserRow } from "../auth";
import { checkPassword, hashPassword, verifyPassword, needsRehash } from "../lib/password";
import { all, now, plus, uuid, trimmed, str, int, bool } from "../lib/sql";

const LOCK_MINUTES = 15;

async function userByName(env: Env, username: unknown): Promise<UserRow | null> {
  const u = trimmed(username).toLowerCase();
  if (!u) return null;
  return env.DB.prepare("SELECT * FROM app_users WHERE lower(username) = ?").bind(u).first<UserRow>();
}

async function userById(env: Env, id: unknown): Promise<UserRow> {
  const u = typeof id === "string" ? await env.DB.prepare("SELECT * FROM app_users WHERE id = ?").bind(id).first<UserRow>() : null;
  if (!u) fail("User not found.");
  return u;
}

export const routes: Routes = {
  /* Request access: a PENDING user an admin must approve. */
  async app_register(env, p) {
    const username = trimmed(p.p_username);
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) fail("Username must be 3-30 characters: letters, numbers, dot, dash or underscore.");
    const fullName = trimmed(p.p_full_name);
    if (fullName.length < 2) fail("Please enter your full name.");
    const password = checkPassword(p.p_password);
    if (await userByName(env, username)) fail("That username is already taken.");
    const pending = await env.DB.prepare("SELECT count(*) AS n FROM app_users WHERE status = 'pending'").first<{ n: number }>();
    if ((pending?.n ?? 0) >= 200) fail("Too many requests are waiting for approval. Please contact the admin.");
    await env.DB.prepare("INSERT INTO app_users (id, username, full_name, team_note, pass_hash) VALUES (?, ?, ?, ?, ?)")
      .bind(uuid(), username, fullName, trimmed(p.p_team_note, 80), await hashPassword(password)).run();
    return { ok: true };
  },

  /* Log in: a token plus the profile. Wrong attempts lock the account for 15 minutes after 5. */
  async app_login(env, p) {
    const u = await userByName(env, p.p_username);
    const password = typeof p.p_password === "string" ? p.p_password : "";
    if (!u) {
      await hashPassword(password, 1000);                       // keep timing similar
      return { ok: false, error: "Wrong username or password." };
    }
    if (u.locked_until && u.locked_until > now()) return { ok: false, error: "Too many wrong attempts. Try again in 15 minutes." };
    if (!(await verifyPassword(password, u.pass_hash))) {
      const n = u.failed_attempts + 1;
      await env.DB.prepare("UPDATE app_users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
        .bind(n >= 5 ? 0 : n, n >= 5 ? plus(LOCK_MINUTES * 60000) : null, u.id).run();
      return { ok: false, error: "Wrong username or password." };
    }
    if (u.status === "pending") return { ok: false, error: "Your account is waiting for admin approval." };
    if (u.status !== "approved") return { ok: false, error: "This account is not active. Please contact the admin." };
    const token = await openSession(env, u.id);
    const rehash = needsRehash(u.pass_hash) ? await hashPassword(password) : null;
    await env.DB.prepare("UPDATE app_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, pass_hash = coalesce(?, pass_hash) WHERE id = ?")
      .bind(now(), rehash, u.id).run();
    u.last_login_at = now();
    const s = await sessionFor(env, u);
    return { ok: true, token, ...s.profile() };
  },

  async app_me(env, p) {
    return (await sessionUser(env, p.p_token)).profile();
  },

  async app_logout(env, p) {
    await closeSession(env, p.p_token);
    return { ok: true };
  },

  async app_change_password(env, p) {
    const s = await sessionUser(env, p.p_token);
    if (!(await verifyPassword(str(p.p_old), s.user.pass_hash))) fail("Current password is wrong.");
    const pw = checkPassword(p.p_new);
    await env.DB.batch([
      env.DB.prepare("UPDATE app_users SET pass_hash = ? WHERE id = ?").bind(await hashPassword(pw), s.id),
      env.DB.prepare("DELETE FROM app_sessions WHERE user_id = ? AND token_hash <> ?").bind(s.id, await tokenHash(str(p.p_token), env))
    ]);
    return { ok: true };
  },

  async app_update_profile(env, p) {
    const s = await sessionUser(env, p.p_token);
    const name = trimmed(p.p_full_name);
    if (name.length < 2 || name.length > 60) fail("Please enter your name (2 to 60 characters).");
    const avatar = str(p.p_avatar);
    if (avatar) {
      if (avatar.length > 60000) fail("That picture is too large.");
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) fail("That picture format is not supported.");
    }
    await env.DB.prepare("UPDATE app_users SET full_name = ?, avatar = ? WHERE id = ?").bind(name, avatar || null, s.id).run();
    s.user.full_name = name; s.user.avatar = avatar || null;
    return { ok: true, ...s.profile() };
  },

  /* ---------- admin ---------- */

  async app_admin_overview(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireAdmin();
    const [users, uc, ca, te] = await env.DB.batch([
      env.DB.prepare("SELECT id, username, full_name, team_note, role, status, created_at, last_login_at FROM app_users"),
      env.DB.prepare("SELECT user_id, category_id FROM app_user_categories ORDER BY category_id"),
      env.DB.prepare("SELECT user_id, category_id FROM app_category_admins ORDER BY category_id"),
      env.DB.prepare("SELECT user_id, tool_id FROM app_tool_editors ORDER BY tool_id")
    ]);
    const group = (rows: Record<string, string>[], k: string) => {
      const m = new Map<string, string[]>();
      rows.forEach((r) => { const l = m.get(r.user_id) || []; l.push(r[k]); m.set(r.user_id, l); });
      return (id: string) => m.get(id) || [];
    };
    const cats = group(uc.results as Record<string, string>[], "category_id");
    const adm = group(ca.results as Record<string, string>[], "category_id");
    const ed = group(te.results as Record<string, string>[], "tool_id");
    type Row = { id: string; status: string; created_at: string; [k: string]: unknown };
    const list = (users.results as Row[]).map((u) => ({ ...u, categories: cats(u.id), admin_categories: adm(u.id), edit_tools: ed(u.id) }))
      .sort((a, b) => (b.status === "pending" ? 1 : 0) - (a.status === "pending" ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at)));
    return {
      scope: s.scope,
      users: list,
      categories: s.categories.slice().sort(bySort).map((c) => ({ id: c.id, name: c.name, description: c.description, sort: c.sort, is_default: !!c.is_default })),
      tools: s.tools.slice().sort((a, b) => a.category_id.localeCompare(b.category_id) || bySort(a, b))
        .map((t) => ({ id: t.id, name: t.name, category_id: t.category_id, description: t.description, path: t.path, status: t.status, sort: t.sort, editable: !!t.editable, project_tool: !!t.project_tool }))
    };
  },

  /* Approve / reject / disable, tile access, tile admin (super user only), "Can edit". */
  async app_admin_set_user(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireAdmin();
    const sup = s.isSuper;
    const t = await userById(env, p.p_user_id);
    const status = str(p.p_status);
    if (!["pending", "approved", "rejected", "disabled"].includes(status)) fail("Invalid status.");
    if (t.role === "superuser") {
      if (status !== "approved") fail("The super user account cannot be demoted or disabled.");
      return { ok: true };
    }
    if (!sup && t.role !== "user") fail("Only the super user can change an admin account.");
    const adminCats = Array.isArray(p.p_admin_categories) ? (p.p_admin_categories as unknown[]).map(String) : null;
    const cats = Array.isArray(p.p_categories) ? (p.p_categories as unknown[]).map(String) : [];
    const tools = Array.isArray(p.p_edit_tools) ? (p.p_edit_tools as unknown[]).map(String) : [];
    const have = new Set((await all<{ category_id: string }>(env.DB.prepare("SELECT category_id FROM app_category_admins WHERE user_id = ?").bind(t.id))).map((r) => r.category_id));
    if (!sup && adminCats && adminCats.some((c) => !have.has(c))) fail("Only the super user can make someone an admin.");
    const scope = new Set(s.scope);
    const before = { status: t.status, role: t.role };
    const stmts: D1PreparedStatement[] = [];
    const approvedNow = status === "approved" && t.status !== "approved";
    stmts.push(env.DB.prepare("UPDATE app_users SET status = ?, approved_by = CASE WHEN ? THEN ? ELSE approved_by END, approved_at = CASE WHEN ? THEN ? ELSE approved_at END, failed_attempts = 0, locked_until = NULL WHERE id = ?")
      .bind(status, approvedNow ? 1 : 0, s.id, approvedNow ? 1 : 0, now(), t.id));
    if (sup && adminCats) {
      const keep = adminCats.filter((c) => s.category(c));
      stmts.push(env.DB.prepare("DELETE FROM app_category_admins WHERE user_id = ?").bind(t.id));
      keep.forEach((c) => stmts.push(env.DB.prepare("INSERT OR IGNORE INTO app_category_admins (user_id, category_id, granted_by) VALUES (?, ?, ?)").bind(t.id, c, s.id)));
      stmts.push(env.DB.prepare("UPDATE app_users SET role = ? WHERE id = ?").bind(keep.length ? "admin" : "user", t.id));
    }
    // tile access inside the caller's tiles only
    for (const c of scope) stmts.push(env.DB.prepare("DELETE FROM app_user_categories WHERE user_id = ? AND category_id = ?").bind(t.id, c));
    cats.filter((c) => scope.has(c) && s.category(c) && !s.category(c)!.is_default)
      .forEach((c) => stmts.push(env.DB.prepare("INSERT OR IGNORE INTO app_user_categories (user_id, category_id) VALUES (?, ?)").bind(t.id, c)));
    // per-tool edit rights, for tools on the caller's tiles only
    const scopedTools = s.tools.filter((x) => scope.has(x.category_id));
    for (const x of scopedTools) stmts.push(env.DB.prepare("DELETE FROM app_tool_editors WHERE user_id = ? AND tool_id = ?").bind(t.id, x.id));
    scopedTools.filter((x) => x.editable && tools.includes(x.id))
      .forEach((x) => stmts.push(env.DB.prepare("INSERT OR IGNORE INTO app_tool_editors (user_id, tool_id, granted_by) VALUES (?, ?, ?)").bind(t.id, x.id, s.id)));
    if (status !== "approved") stmts.push(env.DB.prepare("DELETE FROM app_sessions WHERE user_id = ?").bind(t.id));
    await env.DB.batch(stmts);
    await audit(env, s.id, "app_admin_set_user", t.username, before, { status, categories: cats, edit_tools: tools, admin_categories: adminCats });
    return { ok: true };
  },

  async app_admin_reset_password(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireAdmin();
    const pw = checkPassword(p.p_new_password);
    const t = await userById(env, p.p_user_id);
    if (!s.isSuper && t.role !== "user") fail("Only the super user can reset an admin password.");
    await env.DB.batch([
      env.DB.prepare("UPDATE app_users SET pass_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").bind(await hashPassword(pw), t.id),
      env.DB.prepare("DELETE FROM app_sessions WHERE user_id = ?").bind(t.id)
    ]);
    await audit(env, s.id, "app_admin_reset_password", t.username);
    return { ok: true };
  },

  async app_admin_delete_user(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireSuper();
    const t = await userById(env, p.p_user_id);
    if (t.id === s.id) fail("You cannot delete your own account.");
    if (t.status === "approved") fail("Disable the user first, then delete.");
    await env.DB.batch([
      env.DB.prepare("UPDATE app_users SET approved_by = NULL WHERE approved_by = ?").bind(t.id),
      env.DB.prepare("DELETE FROM app_users WHERE id = ?").bind(t.id)
    ]);
    await audit(env, s.id, "app_admin_delete_user", t.username);
    return { ok: true };
  },

  async app_admin_save_tool(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireSuper();
    const id = str(p.p_id);
    if (!/^[a-z0-9-]{2,40}$/.test(id)) fail("Tool id must be lowercase letters, numbers and dashes.");
    const cat = str(p.p_category_id);
    if (!s.category(cat)) fail("Unknown category.");
    const status = str(p.p_status);
    if (!["live", "soon", "hidden"].includes(status)) fail("Invalid status.");
    const name = trimmed(p.p_name);
    if (name.length < 2) fail("Tool name is required.");
    const path = str(p.p_path);
    if (path && !/^tools\/[a-z0-9-]+\/$/.test(path)) fail("Path must look like tools/my-tool/");
    await env.DB.prepare(`INSERT INTO app_tools (id, category_id, name, description, path, status, sort, editable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name, description = excluded.description,
         path = excluded.path, status = excluded.status, sort = excluded.sort, editable = excluded.editable`)
      .bind(id, cat, name, trimmed(p.p_description), path, status, int(p.p_sort, 100), bool(p.p_editable) ? 1 : 0).run();
    await audit(env, s.id, "app_admin_save_tool", id, "", { cat, name, status });
    return { ok: true };
  },

  async app_admin_save_category(env, p) {
    const s = (await sessionUser(env, p.p_token)).requireSuper();
    const id = str(p.p_id);
    if (!/^[a-z0-9-]{2,30}$/.test(id)) fail("Category id must be lowercase letters, numbers and dashes.");
    const name = trimmed(p.p_name);
    if (name.length < 2) fail("Category name is required.");
    await env.DB.prepare(`INSERT INTO app_categories (id, name, description, sort, is_default) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, sort = excluded.sort, is_default = excluded.is_default`)
      .bind(id, name, trimmed(p.p_description), int(p.p_sort, 100), bool(p.p_is_default) ? 1 : 0).run();
    await audit(env, s.id, "app_admin_save_category", id, "", { name });
    return { ok: true };
  }
};

/* Command-line helpers (RUNBOOK): create the first super user, move the role. Not routes. */
export async function bootstrapAdmin(env: Env, username: string, fullName: string, password: string): Promise<string> {
  const has = await env.DB.prepare("SELECT 1 AS x FROM app_users WHERE role = 'superuser'").first();
  if (has) return "A super user already exists.";
  checkPassword(password);
  await env.DB.prepare("INSERT INTO app_users (id, username, full_name, pass_hash, role, status, approved_at) VALUES (?, ?, ?, ?, 'superuser', 'approved', ?)")
    .bind(uuid(), username.trim(), fullName.trim(), await hashPassword(password), now()).run();
  return "Super user created.";
}

export type { Session, Params };
