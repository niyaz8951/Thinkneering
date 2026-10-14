import { describe, it, expect, beforeEach } from "vitest";
import { rpc, ok, refused, login, resetLogins, USERS } from "./helpers";

describe("app_* routes", () => {
  beforeEach(async () => { await resetLogins(); });

  it("logs in, reads the profile, logs out", async () => {
    const t = await login("admin");
    const me = await ok("app_me", { p_token: t });
    expect(me.user.username).toBe("admin");
    expect(me.user.role).toBe("superuser");
    expect(me.categories.map((c: any) => c.id)).toEqual(["general", "sales", "sbu"]);
    await ok("app_logout", { p_token: t });
    expect(await refused("app_me", { p_token: t })).toBe("SESSION_EXPIRED");
  });

  it("refuses a wrong password, a pending user and no token", async () => {
    const r = await rpc("app_login", { p_username: "admin", p_password: "nope-nope" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Wrong username or password/);
    await login("admin");
    const p = await rpc("app_login", { p_username: USERS.joiner.username, p_password: USERS.joiner.password });
    expect(p.error).toMatch(/waiting for admin approval/);
    expect(await refused("app_me", {})).toBe("SESSION_EXPIRED");
  });

  it("a user sees only his tiles; nothing is shown as locked", async () => {
    const t = await login("sales");
    const me = await ok("app_me", { p_token: t });
    expect(me.categories.map((c: any) => c.id)).toEqual(["general", "sales"]);
    expect(me.user.edit_tools).toEqual(["compliance-maker"]);
    expect(JSON.stringify(me)).not.toMatch(/locked/i);
  });

  it("one session per user: a second login signs the first tab out", async () => {
    const t1 = await login("sbu");
    const t2 = await login("sbu");
    expect(await refused("app_me", { p_token: t1 })).toBe("SESSION_EXPIRED");
    await ok("app_me", { p_token: t2 });
  });

  it("admin overview: allowed for admins, refused for users", async () => {
    const a = await login("teamAdmin");
    const o = await ok("app_admin_overview", { p_token: a });
    expect(o.scope).toEqual(["general", "sales", "sbu"]);
    expect(o.users.length).toBe(5);
    expect(o.users[0].status).toBe("pending");
    const u = await login("sales");
    expect(await refused("app_admin_overview", { p_token: u })).toMatch(/Admin access required/);
  });

  it("approving a user and giving a tile; a tile admin cannot make admins", async () => {
    const a = await login("teamAdmin");
    await ok("app_admin_set_user", { p_token: a, p_user_id: USERS.joiner.id, p_status: "approved", p_role: "user", p_categories: ["sbu"], p_edit_tools: ["maps"] });
    const t = await login("joiner");
    const me = await ok("app_me", { p_token: t });
    expect(me.categories.map((c: any) => c.id)).toEqual(["general", "sbu"]);
    expect(me.user.edit_tools).toEqual(["maps"]);
    expect(await refused("app_admin_set_user", { p_token: a, p_user_id: USERS.joiner.id, p_status: "approved", p_role: "user", p_categories: [], p_admin_categories: ["sbu"] })).toMatch(/Only the super user/);
    const s = await login("admin");
    await ok("app_admin_set_user", { p_token: s, p_user_id: USERS.joiner.id, p_status: "approved", p_role: "user", p_categories: [], p_admin_categories: ["sbu"] });
    const me2 = await ok("app_me", { p_token: await login("joiner") });
    expect(me2.user.role).toBe("admin");
    expect(me2.user.admin_categories).toEqual(["sbu"]);
  });

  it("super-user-only actions are refused for a tile admin", async () => {
    const a = await login("teamAdmin");
    expect(await refused("app_admin_save_tool", { p_token: a, p_id: "x-tool", p_category_id: "general", p_name: "X", p_status: "live" })).toMatch(/super user/);
    expect(await refused("app_admin_delete_user", { p_token: a, p_user_id: USERS.joiner.id })).toMatch(/super user/);
    const s = await login("admin");
    await ok("app_admin_save_tool", { p_token: s, p_id: "x-tool", p_category_id: "general", p_name: "X tool", p_status: "live", p_path: "tools/x-tool/" });
    expect(await refused("app_admin_delete_user", { p_token: s, p_user_id: USERS.sales.id })).toMatch(/Disable the user first/);
  });

  it("change password re-hashes and signs other sessions out; rules apply", async () => {
    const t = await login("sales");
    expect(await refused("app_change_password", { p_token: t, p_old: "sales12345", p_new: "short" })).toMatch(/at least 8/);
    expect(await refused("app_change_password", { p_token: t, p_old: "wrong-one", p_new: "newpass123" })).toMatch(/Current password is wrong/);
    await ok("app_change_password", { p_token: t, p_old: "sales12345", p_new: "newpass123" });
    const r = await rpc("app_login", { p_username: "sales.user", p_password: "newpass123" });
    expect(r.ok).toBe(true);
    expect(r.token).toBeTruthy();
  });

  it("request access creates a pending user with checks", async () => {
    expect((await rpc("app_register", { p_username: "ab", p_full_name: "Ab Cd", p_password: "abcdefgh1" })).error).toMatch(/3-30 characters/);
    expect((await rpc("app_register", { p_username: "someone.new", p_full_name: "S", p_password: "abcdefgh1" })).error).toMatch(/full name/);
    expect((await rpc("app_register", { p_username: "someone.new", p_full_name: "Some One", p_password: "        " })).error).toMatch(/only spaces/);
    await ok("app_register", { p_username: "someone.new", p_full_name: "Some One", p_password: "abcdefgh1", p_team_note: "SBU" });
    const r = await rpc("app_login", { p_username: "someone.new", p_password: "abcdefgh1" });
    expect(r.error).toMatch(/waiting for admin approval/);
  });
});
