import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins, USERS } from "./helpers";

/* A tiny "JPEG" data URL: nothing decodes the bytes, so any bytes do. */
function jpeg(bytes: number[]): string {
  return "data:image/jpeg;base64," + btoa(String.fromCharCode(...bytes));
}
const PIC = jpeg([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff, 0xd9]);
const THUMB = jpeg([0xff, 0xd8, 0xff, 0xd9]);

async function newMap(t: string, name: string, share = "private"): Promise<{ id: string; root: string }> {
  const r = await ok("mp_create", { p_token: t, p_name: name, p_share: share });
  const g = await ok("mp_get", { p_token: t, p_map_id: r.id });
  return { id: r.id, root: g.nodes.find((n: any) => n.parent == null).id };
}

describe("mp_* routes", () => {
  beforeEach(async () => { await resetLogins(); });

  it("every route needs the tile the Maps tool sits on; the session is checked first", async () => {
    expect(await refused("mp_list", { p_token: "nope" })).toBe("SESSION_EXPIRED");
    const sales = await login("sales");              // Sales tile only; Maps is on SBU
    for (const name of ["mp_list", "mp_create", "mp_get", "mp_map_save", "mp_delete", "mp_node_add", "mp_node_save", "mp_node_verify", "mp_node_move",
                        "mp_node_delete", "mp_import", "mp_node_images", "mp_image_get", "mp_image_add", "mp_image_save", "mp_image_delete", "mp_search"]) {
      expect(await refused(name, { p_token: sales, p_name: "X", p_q: "xx" })).toBe("Maps is not available for your account.");
    }
    const sbu = await login("sbu");
    const l = await ok("mp_list", { p_token: sbu });
    expect(l).toMatchObject({ me: USERS.sbu.id, can_manage: false, maps: [] });
    const a = await ok("mp_list", { p_token: await login("teamAdmin") });
    expect(a.can_manage).toBe(true);
  });

  it("mp_create: a root branch with the map name; limits and duplicate names", async () => {
    const t = await login("sbu");
    const r = await ok("mp_create", { p_token: t, p_name: "  Chiller   EWAD ", p_share: "private" });
    const g = await ok("mp_get", { p_token: t, p_map_id: r.id });
    expect(g.map).toMatchObject({ id: r.id, name: "Chiller EWAD", share: "private", rights: "own", mine: true, owner: "SBU User" });
    expect(g.nodes.length).toBe(1);
    expect(g.nodes[0]).toMatchObject({ parent: null, title: "Chiller EWAD", notes: "", special: [], links: [], sort: 0, verified: true, verified_by: "SBU User", updated_by: "SBU User", images: 0 });
    expect(await refused("mp_create", { p_token: t, p_name: "chiller ewad" })).toBe("You already have a map with that name.");
    expect(await refused("mp_create", { p_token: t, p_name: "   " })).toBe("Give the map a name, usually the product.");
    expect(await refused("mp_create", { p_token: t, p_name: "x".repeat(81) })).toBe("A map name is at most 80 characters.");
    expect(await refused("mp_create", { p_token: t, p_name: "AHU", p_share: "everyone" })).toBe("Choose who the map is shared with.");
    const l = await ok("mp_list", { p_token: t });
    expect(l.maps.map((m: any) => [m.name, m.branches, m.special, m.to_verify, m.images, m.rights, m.mine])).toEqual([["Chiller EWAD", 0, 0, 0, 0, "own", true]]);
  });

  it("rights: private is the owner's alone (also for the super user); team_read reads; team_edit edits; managers own shared maps", async () => {
    const sbu = await login("sbu"), admin = await login("admin"), mgr = await login("teamAdmin");
    const priv = await newMap(sbu, "Private one");
    const read = await newMap(sbu, "Read one", "team_read");
    const edit = await newMap(sbu, "Edit one", "team_edit");

    // the super user cannot even see a private map
    expect(await refused("mp_get", { p_token: admin, p_map_id: priv.id })).toMatch(/not available/);
    expect(await refused("mp_node_add", { p_token: admin, p_parent_id: priv.root, p_title: "X" })).toMatch(/not available/);
    expect((await ok("mp_list", { p_token: admin })).maps.map((m: any) => m.name).sort()).toEqual(["Edit one", "Read one"]);

    // a manager owns every shared map
    expect((await ok("mp_get", { p_token: mgr, p_map_id: read.id })).map.rights).toBe("own");
    // team_read: a plain user reads but cannot change. Make one with the SBU tile but no "Can edit": sales.user is on the wrong tile, so grant SBU to a copy of the joiner
    await env.DB.batch([
      env.DB.prepare("UPDATE app_users SET status = 'approved', approved_at = ? WHERE id = ?").bind("2026-10-01T00:00:00.000Z", USERS.joiner.id),
      env.DB.prepare("INSERT INTO app_user_categories (user_id, category_id) VALUES (?, 'sbu')").bind(USERS.joiner.id)
    ]);
    const other = await login("joiner");
    expect((await ok("mp_get", { p_token: other, p_map_id: read.id })).map.rights).toBe("read");
    expect(await refused("mp_node_add", { p_token: other, p_parent_id: read.root, p_title: "X" })).toBe("You can read this map but not change it.");
    expect(await refused("mp_node_save", { p_token: other, p_node_id: read.root, p_patch: { notes: "x" } })).toBe("You can read this map but not change it.");
    expect(await refused("mp_import", { p_token: other, p_parent_id: read.root, p_items: [{ title: "a" }] })).toBe("You can read this map but not change it.");
    expect(await refused("mp_image_add", { p_token: other, p_node_id: read.root, p_data: PIC, p_thumb: THUMB })).toBe("You can read this map but not change it.");
    expect(await refused("mp_get", { p_token: other, p_map_id: priv.id })).toMatch(/not available/);

    // team_edit: changes branches, but cannot rename, re-share or delete the map
    expect((await ok("mp_get", { p_token: other, p_map_id: edit.id })).map.rights).toBe("edit");
    const added = await ok("mp_node_add", { p_token: other, p_parent_id: edit.root, p_title: "Compressor" });
    // (a plain user's new branch waits for an admin: 19 Oct 2026)
    expect(added.node).toMatchObject({ title: "Compressor", parent: edit.root, verified: false, verified_by: null, sort: 0 });
    expect(await refused("mp_map_save", { p_token: other, p_map_id: edit.id, p_name: "Renamed", p_share: null })).toBe("Only the owner of this map can do this.");
    expect(await refused("mp_map_save", { p_token: other, p_map_id: edit.id, p_name: null, p_share: "private" })).toBe("Only the owner of this map can do this.");
    expect(await refused("mp_delete", { p_token: other, p_map_id: edit.id })).toBe("Only the owner of this map can do this.");
    expect(await refused("mp_node_save", { p_token: other, p_node_id: edit.root, p_patch: { title: "Renamed root" } })).toBe("Only the owner of this map can do this.");
    // the same root title again is not a rename
    await ok("mp_node_save", { p_token: other, p_node_id: edit.root, p_patch: { title: "Edit one", notes: "root notes" } });

    // a manager owns the shared maps: rename, re-share, delete
    await ok("mp_map_save", { p_token: mgr, p_map_id: edit.id, p_name: "Edit two", p_share: "team_read" });
    const g = await ok("mp_get", { p_token: sbu, p_map_id: edit.id });
    expect(g.map).toMatchObject({ name: "Edit two", share: "team_read", rights: "own", mine: true });
    expect(g.nodes.find((n: any) => n.parent == null).title).toBe("Edit two");
    expect(await refused("mp_node_add", { p_token: other, p_parent_id: edit.root, p_title: "X" })).toBe("You can read this map but not change it.");
    await ok("mp_delete", { p_token: mgr, p_map_id: edit.id });
    expect(await refused("mp_get", { p_token: sbu, p_map_id: edit.id })).toMatch(/not available/);

    // a map whose owner was deleted belongs to the managers, private or not
    await env.DB.prepare("UPDATE mp_maps SET created_by = NULL WHERE id = ?").bind(priv.id).run();
    const orphan = await ok("mp_get", { p_token: mgr, p_map_id: priv.id });
    expect(orphan.map).toMatchObject({ rights: "own", mine: false, owner: "(deleted user)" });
    expect(await refused("mp_get", { p_token: other, p_map_id: priv.id })).toMatch(/not available/);
  });

  it("branches: add, patch (only the given fields), verify deep, move among siblings, delete with the subtree", async () => {
    const t = await login("sbu");
    const m = await newMap(t, "AHU");
    const a = (await ok("mp_node_add", { p_token: t, p_parent_id: m.root, p_title: "Casing" })).node;
    const b = (await ok("mp_node_add", { p_token: t, p_parent_id: m.root, p_title: "Fans" })).node;
    const c = (await ok("mp_node_add", { p_token: t, p_parent_id: m.root, p_title: "Coils" })).node;
    const a1 = (await ok("mp_node_add", { p_token: t, p_parent_id: a.id, p_title: "Panels" })).node;
    expect([a.sort, b.sort, c.sort, a1.sort]).toEqual([0, 1, 2, 0]);
    expect(await refused("mp_node_add", { p_token: t, p_parent_id: m.root, p_title: " " })).toBe("Give the branch a name.");
    expect(await refused("mp_node_add", { p_token: t, p_parent_id: m.root, p_title: "x".repeat(121) })).toBe("A branch name is at most 120 characters.");
    expect(await refused("mp_node_add", { p_token: t, p_parent_id: "no-such", p_title: "x" })).toBe("That branch no longer exists. Reload the map.");

    // a patch changes only what it carries
    const s1 = (await ok("mp_node_save", { p_token: t, p_node_id: a.id, p_patch: { notes: "  Double skin\r\n50 mm  ", special: [" 50Hz for Egypt ", "", "Thermal break"] } })).node;
    expect(s1).toMatchObject({ title: "Casing", notes: "Double skin\n50 mm", special: ["50Hz for Egypt", "Thermal break"], links: [] });
    const s2 = (await ok("mp_node_save", { p_token: t, p_node_id: a.id, p_patch: { title: "Casing and base" } })).node;
    expect(s2).toMatchObject({ title: "Casing and base", notes: "Double skin\n50 mm", special: ["50Hz for Egypt", "Thermal break"] });
    expect(await refused("mp_node_save", { p_token: t, p_node_id: a.id, p_patch: null })).toBe("Nothing to save.");
    expect(await refused("mp_node_save", { p_token: t, p_node_id: a.id, p_patch: { notes: "x".repeat(8001) } })).toMatch(/at most 8000/);
    expect(await refused("mp_node_save", { p_token: t, p_node_id: a.id, p_patch: { special: new Array(21).fill("x") } })).toBe("A branch holds up to 20 special notes.");
    expect(await refused("mp_node_save", { p_token: t, p_node_id: a.id, p_patch: { special: ["x".repeat(201)] } })).toMatch(/at most 200/);
    // renaming the root renames the map (owner only) and keeps the map-name rules
    await ok("mp_create", { p_token: t, p_name: "FCU" });
    expect(await refused("mp_node_save", { p_token: t, p_node_id: m.root, p_patch: { title: "fcu" } })).toBe("There is already a map with that name.");
    expect(await refused("mp_node_save", { p_token: t, p_node_id: m.root, p_patch: { title: "x".repeat(81) } })).toBe("A map name is at most 80 characters.");
    await ok("mp_node_save", { p_token: t, p_node_id: m.root, p_patch: { title: "AHU Dubai" } });
    expect((await ok("mp_get", { p_token: t, p_map_id: m.id })).map.name).toBe("AHU Dubai");

    // verify (19 Oct 2026): a plain user's branches wait "to verify"; he may not verify them; an admin of the Maps
    // tile verifies (on a shared map, which he manages); anyone who edits may mark a branch "to verify" again
    let g = await ok("mp_get", { p_token: t, p_map_id: m.id });
    expect(g.map.can_verify).toBe(false);
    expect(g.nodes.filter((n: any) => n.parent != null).every((n: any) => !n.verified)).toBe(true);
    expect(await refused("mp_node_verify", { p_token: t, p_node_id: a.id, p_verified: true })).toMatch(/Only the super user or an admin of the Maps tile/);
    await ok("mp_map_save", { p_token: t, p_map_id: m.id, p_share: "team_edit" });
    const adm = await login("teamAdmin");
    expect((await ok("mp_get", { p_token: adm, p_map_id: m.id })).map.can_verify).toBe(true);
    expect((await ok("mp_node_verify", { p_token: adm, p_node_id: a.id, p_verified: true })).changed).toBe(1);
    expect((await ok("mp_node_verify", { p_token: adm, p_node_id: a.id, p_verified: true, p_deep: true })).changed).toBe(1);   // a1
    g = await ok("mp_get", { p_token: t, p_map_id: m.id });
    expect(g.nodes.find((n: any) => n.id === a1.id)).toMatchObject({ verified: true, verified_by: "Team Admin" });
    expect((await ok("mp_node_verify", { p_token: t, p_node_id: a.id, p_verified: false })).changed).toBe(1);
    g = await ok("mp_get", { p_token: t, p_map_id: m.id });
    expect(g.nodes.find((n: any) => n.id === a.id)).toMatchObject({ verified: false, verified_by: null, verified_at: null });
    // a verified branch the plain user changes goes back to "to verify"; the admin's own edit keeps it verified
    await ok("mp_node_save", { p_token: t, p_node_id: a1.id, p_patch: { notes: "62 mm" } });
    expect((await ok("mp_get", { p_token: t, p_map_id: m.id })).nodes.find((n: any) => n.id === a1.id).verified).toBe(false);
    await ok("mp_node_verify", { p_token: adm, p_node_id: a1.id, p_verified: true });
    await ok("mp_node_save", { p_token: adm, p_node_id: a1.id, p_patch: { notes: "62 mm foam" } });
    expect((await ok("mp_get", { p_token: t, p_map_id: m.id })).nodes.find((n: any) => n.id === a1.id).verified).toBe(true);
    await ok("mp_node_verify", { p_token: adm, p_node_id: m.root, p_verified: true, p_deep: true });
    g = await ok("mp_get", { p_token: t, p_map_id: m.id });
    expect(g.nodes.filter((n: any) => !n.verified).length).toBe(0);

    // move: reorders the siblings, the root cannot move, the edges stay put
    expect((await ok("mp_node_move", { p_token: t, p_node_id: c.id, p_dir: -1 })).order).toEqual([a.id, c.id, b.id]);
    expect((await ok("mp_node_move", { p_token: t, p_node_id: a.id, p_dir: -1 })).order).toEqual([a.id, c.id, b.id]);
    expect((await ok("mp_node_move", { p_token: t, p_node_id: a.id, p_dir: 1 })).order).toEqual([c.id, a.id, b.id]);
    g = await ok("mp_get", { p_token: t, p_map_id: m.id });
    expect(g.nodes.filter((n: any) => n.parent === m.root).map((n: any) => [n.title, n.sort])).toEqual([["Coils", 0], ["Casing and base", 1], ["Fans", 2]]);
    expect(await refused("mp_node_move", { p_token: t, p_node_id: m.root, p_dir: 1 })).toBe("The first branch of a map cannot be moved.");

    // delete takes the subtree with it; the root goes only with the map
    expect(await refused("mp_node_delete", { p_token: t, p_node_id: m.root })).toBe("This is the map itself. Delete the map instead.");
    await ok("mp_node_delete", { p_token: t, p_node_id: a.id });
    g = await ok("mp_get", { p_token: t, p_map_id: m.id });
    expect(g.nodes.map((n: any) => n.title).sort()).toEqual(["AHU Dubai", "Coils", "Fans"]);
    expect(await refused("mp_node_save", { p_token: t, p_node_id: a1.id, p_patch: { notes: "x" } })).toBe("That branch no longer exists. Reload the map.");
    const l = await ok("mp_list", { p_token: t });
    expect(l.maps.find((x: any) => x.id === m.id)).toMatchObject({ branches: 2, special: 0, to_verify: 0 });
  });

  it("links: node (readable maps only), standard, tool, web; gone branches dropped; at most 12", async () => {
    const sbu = await login("sbu"), mgr = await login("teamAdmin");
    const mine = await newMap(sbu, "Mine");
    const theirs = await newMap(mgr, "Theirs private");
    const shared = await newMap(mgr, "Theirs shared", "team_read");
    const target = (await ok("mp_node_add", { p_token: mgr, p_parent_id: shared.root, p_title: "Shared branch" })).node;
    const hidden = (await ok("mp_node_add", { p_token: mgr, p_parent_id: theirs.root, p_title: "Hidden branch" })).node;
    const gone = (await ok("mp_node_add", { p_token: sbu, p_parent_id: mine.root, p_title: "Soon gone" })).node;
    await ok("mp_node_delete", { p_token: sbu, p_node_id: gone.id });
    const n = (await ok("mp_node_save", { p_token: sbu, p_node_id: mine.root, p_patch: { links: [
      { kind: "node", node: target.id },
      { kind: "node", node: gone.id, label: "dropped" },
      { kind: "standard", id: "ashrae-90-1", label: " ASHRAE  90.1 " },
      { kind: "tool", id: "compliance-maker" },
      { kind: "web", url: " https://www.daikin.com/x " }
    ] } })).node;
    expect(n.links).toEqual([
      { kind: "node", node: target.id, map: shared.id, label: "Shared branch" },
      { kind: "standard", id: "ashrae-90-1", label: "ASHRAE 90.1" },
      { kind: "tool", id: "compliance-maker", label: "Compliance Maker" },
      { kind: "web", url: "https://www.daikin.com/x", label: "https://www.daikin.com/x" }
    ]);
    const bad = async (links: unknown) => refused("mp_node_save", { p_token: sbu, p_node_id: mine.root, p_patch: { links } });
    expect(await bad([{ kind: "node", node: hidden.id }])).toBe("You cannot link to a branch of a map you cannot open.");
    expect(await bad([{ kind: "node", node: "short" }])).toBe("Choose the branch to link to.");
    expect(await bad([{ kind: "standard", id: "Bad Id" }])).toBe("Choose the standard to link to.");
    expect(await bad([{ kind: "tool", id: "no-such-tool" }])).toBe("Choose the tool to link to.");
    expect(await bad([{ kind: "web", url: "ftp://x.com/a" }])).toBe("A web link starts with https:// and has no spaces.");
    expect(await bad([{ kind: "web", url: "https://x.com/a b" }])).toBe("A web link starts with https:// and has no spaces.");
    expect(await bad([{ kind: "mail", label: "x" }])).toBe("Choose what the link leads to.");
    // what the link means (23 Oct 2026): one of the fixed kinds, kept with the link; none = See also
    const typed = (await ok("mp_node_save", { p_token: sbu, p_node_id: mine.root, p_patch: { links: [
      { kind: "node", node: target.id, rel: "requires" }, { kind: "node", node: target.id, rel: "equivalent", label: "Same class" }] } })).node;
    expect(typed.links).toEqual([
      { kind: "node", node: target.id, map: shared.id, label: "Shared branch", rel: "requires" },
      { kind: "node", node: target.id, map: shared.id, label: "Same class", rel: "equivalent" }]);
    expect(await bad([{ kind: "node", node: target.id, rel: "loves" }])).toBe("Choose what the link between the two branches means.");
    expect(await bad(new Array(13).fill({ kind: "standard", id: "a" }))).toBe("A branch holds up to 12 links.");
  });

  it("import: an outline becomes unverified branches; depth is clamped; export (mp_get) gives it back", async () => {
    const t = await login("sbu");
    const m = await newMap(t, "Chiller");
    const items = [
      { depth: 0, title: "Components", notes: "All parts", special: ["Check voltage"] },
      { depth: 1, title: "Compressor" },
      { depth: 2, title: "Screw" },
      { depth: 5, title: "Oil (clamped to depth 3)" },
      { depth: 1, title: "Evaporator", notes: "  shell and tube \r\n" },
      { depth: 0, title: "Options", special: ["", " 50Hz "] }
    ];
    const r = await ok("mp_import", { p_token: t, p_parent_id: m.root, p_items: items });
    expect(r.added).toBe(6);
    const g = await ok("mp_get", { p_token: t, p_map_id: m.id });
    expect(r.first).toBe(g.nodes.find((n: any) => n.title === "Components").id);
    const byTitle = (x: string) => g.nodes.find((n: any) => n.title === x);
    expect(byTitle("Components")).toMatchObject({ parent: m.root, sort: 0, verified: false, verified_by: null, notes: "All parts", special: ["Check voltage"] });
    expect(byTitle("Options")).toMatchObject({ parent: m.root, sort: 1, special: ["50Hz"] });
    expect(byTitle("Compressor")).toMatchObject({ parent: byTitle("Components").id, sort: 0 });
    expect(byTitle("Evaporator")).toMatchObject({ parent: byTitle("Components").id, sort: 1, notes: "shell and tube" });
    expect(byTitle("Screw")).toMatchObject({ parent: byTitle("Compressor").id });
    expect(byTitle("Oil (clamped to depth 3)")).toMatchObject({ parent: byTitle("Screw").id });
    expect(g.nodes.filter((n: any) => !n.verified).length).toBe(6);
    expect((await ok("mp_list", { p_token: t })).maps[0]).toMatchObject({ branches: 6, special: 2, to_verify: 6 });

    // round trip: export the tree as an outline and import it under another map
    const outline: any[] = [];
    const walk = (parent: string, depth: number) => g.nodes.filter((n: any) => n.parent === parent).sort((a: any, b: any) => a.sort - b.sort)
      .forEach((n: any) => { outline.push({ depth, title: n.title, notes: n.notes, special: n.special }); walk(n.id, depth + 1); });
    walk(m.root, 0);
    const m2 = await newMap(t, "Chiller copy");
    await ok("mp_import", { p_token: t, p_parent_id: m2.root, p_items: outline });
    const g2 = await ok("mp_get", { p_token: t, p_map_id: m2.id });
    const shape = (gg: any, root: string): unknown => gg.nodes.filter((n: any) => n.parent === root).sort((a: any, b: any) => a.sort - b.sort)
      .map((n: any) => [n.title, n.notes, n.special, shape(gg, n.id)]);
    expect(shape(g2, m2.root)).toEqual(shape(g, m.root));

    // a verified import on top: the import stays unverified until an admin confirms it
    const adm = await login("teamAdmin");
    await ok("mp_map_save", { p_token: t, p_map_id: m2.id, p_share: "team_read" });
    expect((await ok("mp_node_verify", { p_token: adm, p_node_id: m2.root, p_verified: true, p_deep: true })).changed).toBe(6);
    expect(await refused("mp_import", { p_token: t, p_parent_id: m.root, p_items: [] })).toMatch(/Nothing to add/);
    expect(await refused("mp_import", { p_token: t, p_parent_id: m.root, p_items: new Array(501).fill({ title: "x" }) })).toMatch(/up to 500/);
    expect(await refused("mp_import", { p_token: t, p_parent_id: m.root, p_items: [{ title: "ok" }, { title: "" }] })).toBe("Give the branch a name.");
    expect((await ok("mp_get", { p_token: t, p_map_id: m.id })).nodes.length).toBe(7);   // nothing of the refused import was written
  });

  it("images round-trip through R2 and are removed with the image, the branch and the map", async () => {
    const t = await login("sbu");
    const m = await newMap(t, "Pictures");
    const n = (await ok("mp_node_add", { p_token: t, p_parent_id: m.root, p_title: "Nameplate" })).node;
    const i1 = await ok("mp_image_add", { p_token: t, p_node_id: n.id, p_data: PIC, p_thumb: THUMB, p_caption: "  Front   view " });
    const i2 = await ok("mp_image_add", { p_token: t, p_node_id: n.id, p_data: PIC, p_thumb: THUMB });
    const row = await env.DB.prepare("SELECT * FROM mp_images WHERE id = ?").bind(i1.id).first<any>();
    expect(row.file_key).toBe(`maps/${m.id}/${i1.id}.jpg`);
    expect(row.thumb_key).toBe(`maps/${m.id}/${i1.id}-thumb.jpg`);
    expect(row.bytes).toBe(15);
    expect(row.caption).toBe("Front view");
    const obj = await env.FILES.get(row.file_key);
    expect(obj?.httpMetadata?.contentType).toBe("image/jpeg");
    expect([...new Uint8Array(await obj!.arrayBuffer())].slice(0, 4)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(await env.FILES.get(row.thumb_key)).not.toBeNull();

    const list = await ok("mp_node_images", { p_token: t, p_node_id: n.id });
    expect(list.images.map((x: any) => [x.id, x.caption, x.thumb, x.by])).toEqual([[i1.id, "Front view", THUMB, "SBU User"], [i2.id, "", THUMB, "SBU User"]]);
    const full = await ok("mp_image_get", { p_token: t, p_image_id: i1.id });
    expect(full).toMatchObject({ id: i1.id, caption: "Front view", data: PIC });
    expect((await ok("mp_get", { p_token: t, p_map_id: m.id })).nodes.find((x: any) => x.id === n.id).images).toBe(2);
    expect((await ok("mp_list", { p_token: t })).maps[0].images).toBe(2);

    await ok("mp_image_save", { p_token: t, p_image_id: i2.id, p_caption: "Side" });
    expect((await ok("mp_image_get", { p_token: t, p_image_id: i2.id })).caption).toBe("Side");

    // refused inputs
    expect(await refused("mp_image_add", { p_token: t, p_node_id: n.id, p_data: "data:image/png;base64,AAAA", p_thumb: THUMB })).toMatch(/could not be read/);
    expect(await refused("mp_image_add", { p_token: t, p_node_id: n.id, p_data: "data:image/jpeg;base64,not base64!", p_thumb: THUMB })).toMatch(/could not be read/);
    expect(await refused("mp_image_add", { p_token: t, p_node_id: n.id, p_data: "data:image/jpeg;base64," + "A".repeat(700000), p_thumb: THUMB })).toMatch(/too large/);
    expect(await refused("mp_image_add", { p_token: t, p_node_id: n.id, p_data: PIC, p_thumb: "data:image/jpeg;base64," + "A".repeat(60000) })).toMatch(/too large/);
    for (let k = 0; k < 6; k++) await ok("mp_image_add", { p_token: t, p_node_id: n.id, p_data: PIC, p_thumb: THUMB });
    expect(await refused("mp_image_add", { p_token: t, p_node_id: n.id, p_data: PIC, p_thumb: THUMB })).toBe("A branch holds up to 8 images. Remove one first.");
    expect(await refused("mp_image_get", { p_token: t, p_image_id: "nope" })).toBe("That image no longer exists. Reload the map.");

    // delete one image: row and R2 objects gone; a second delete is a quiet ok
    await ok("mp_image_delete", { p_token: t, p_image_id: i1.id });
    expect(await env.FILES.get(row.file_key)).toBeNull();
    expect(await env.FILES.get(row.thumb_key)).toBeNull();
    expect((await ok("mp_image_delete", { p_token: t, p_image_id: i1.id })).ok).toBe(true);
    expect((await ok("mp_node_images", { p_token: t, p_node_id: n.id })).images.length).toBe(7);

    // delete the branch: its images leave R2 too
    const keys = (await env.FILES.list({ prefix: `maps/${m.id}/` })).objects.length;
    expect(keys).toBe(14);
    const child = (await ok("mp_node_add", { p_token: t, p_parent_id: n.id, p_title: "Under" })).node;
    await ok("mp_image_add", { p_token: t, p_node_id: child.id, p_data: PIC, p_thumb: THUMB });
    await ok("mp_node_delete", { p_token: t, p_node_id: n.id });
    expect((await env.FILES.list({ prefix: `maps/${m.id}/` })).objects.length).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM mp_images WHERE map_id = ?").bind(m.id).first<any>()).n).toBe(0);

    // delete the map: the same
    const n2 = (await ok("mp_node_add", { p_token: t, p_parent_id: m.root, p_title: "Again" })).node;
    await ok("mp_image_add", { p_token: t, p_node_id: n2.id, p_data: PIC, p_thumb: THUMB });
    await ok("mp_image_add", { p_token: t, p_node_id: m.root, p_data: PIC, p_thumb: THUMB });
    expect((await env.FILES.list({ prefix: `maps/${m.id}/` })).objects.length).toBe(4);
    await ok("mp_delete", { p_token: t, p_map_id: m.id });
    expect((await env.FILES.list({ prefix: `maps/${m.id}/` })).objects.length).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM mp_nodes WHERE map_id = ?").bind(m.id).first<any>()).n).toBe(0);
  });

  it("image rights follow the map: readers see, editors change, a private map stays closed", async () => {
    const sbu = await login("sbu"), admin = await login("admin");
    const priv = await newMap(sbu, "P");
    const shared = await newMap(sbu, "S", "team_read");
    const ip = await ok("mp_image_add", { p_token: sbu, p_node_id: priv.root, p_data: PIC, p_thumb: THUMB });
    const is = await ok("mp_image_add", { p_token: sbu, p_node_id: shared.root, p_data: PIC, p_thumb: THUMB });
    expect(await refused("mp_image_get", { p_token: admin, p_image_id: ip.id })).toMatch(/not available/);
    expect(await refused("mp_node_images", { p_token: admin, p_node_id: priv.root })).toMatch(/not available/);
    expect((await ok("mp_image_get", { p_token: admin, p_image_id: is.id })).data).toBe(PIC);
    await env.DB.batch([
      env.DB.prepare("UPDATE app_users SET status = 'approved', approved_at = ? WHERE id = ?").bind("2026-10-01T00:00:00.000Z", USERS.joiner.id),
      env.DB.prepare("INSERT INTO app_user_categories (user_id, category_id) VALUES (?, 'sbu')").bind(USERS.joiner.id)
    ]);
    const reader = await login("joiner");
    expect((await ok("mp_node_images", { p_token: reader, p_node_id: shared.root })).images.length).toBe(1);
    expect(await refused("mp_image_save", { p_token: reader, p_image_id: is.id, p_caption: "x" })).toBe("You can read this map but not change it.");
    expect(await refused("mp_image_delete", { p_token: reader, p_image_id: is.id })).toBe("You can read this map but not change it.");
    expect(await refused("mp_image_add", { p_token: reader, p_node_id: shared.root, p_data: PIC, p_thumb: THUMB })).toBe("You can read this map but not change it.");
  });

  it("mp_search: only readable maps; name > special note > notes > image caption; a short query gives nothing", async () => {
    const sbu = await login("sbu"), admin = await login("admin");
    const m = await newMap(sbu, "Chiller", "team_read");
    const hid = await newMap(sbu, "Hidden");
    const byName = (await ok("mp_node_add", { p_token: sbu, p_parent_id: m.root, p_title: "Screw compressor" })).node;
    const bySpecial = (await ok("mp_node_add", { p_token: sbu, p_parent_id: m.root, p_title: "Aaa" })).node;
    await ok("mp_node_save", { p_token: sbu, p_node_id: bySpecial.id, p_patch: { special: ["Other", "Compressor oil for 50Hz"] } });
    const byNotes = (await ok("mp_node_add", { p_token: sbu, p_parent_id: m.root, p_title: "Bbb" })).node;
    await ok("mp_node_save", { p_token: sbu, p_node_id: byNotes.id, p_patch: { notes: "x".repeat(100) + "\n\nThe   COMPRESSOR is semi-hermetic.\n" + "y".repeat(100) } });
    const byCaption = (await ok("mp_node_add", { p_token: sbu, p_parent_id: m.root, p_title: "Ccc" })).node;
    await ok("mp_image_add", { p_token: sbu, p_node_id: byCaption.id, p_data: PIC, p_thumb: THUMB, p_caption: "Compressor nameplate" });
    const hidden = (await ok("mp_node_add", { p_token: sbu, p_parent_id: hid.root, p_title: "Compressor (private)" })).node;
    const none = (await ok("mp_node_add", { p_token: sbu, p_parent_id: m.root, p_title: "Nothing here" })).node;
    await ok("mp_node_save", { p_token: sbu, p_node_id: none.id, p_patch: { notes: "50% load" } });   // a LIKE wildcard in the data

    const r = await ok("mp_search", { p_token: sbu, p_q: "  compressor " });
    expect(r.hits.map((h: any) => [h.node_id, h.in, h.map])).toEqual([
      [byName.id, "name", "Chiller"], [hidden.id, "name", "Hidden"], [bySpecial.id, "special note", "Chiller"], [byNotes.id, "notes", "Chiller"], [byCaption.id, "image caption", "Chiller"]
    ]);
    expect(r.hits[0]).toEqual({ map_id: m.id, map: "Chiller", node_id: byName.id, title: "Screw compressor", in: "name", text: "" });
    expect(r.hits[2].text).toBe("Compressor oil for 50Hz");
    expect(r.hits[3].text).toContain("The COMPRESSOR is semi-hermetic.");
    expect(r.hits[3].text.length).toBeLessThanOrEqual(140);
    expect(r.hits[4].text).toBe("Compressor nameplate");

    const a = await ok("mp_search", { p_token: admin, p_q: "compressor" });
    expect(a.hits.map((h: any) => h.node_id)).toEqual([byName.id, bySpecial.id, byNotes.id, byCaption.id]);
    expect((await ok("mp_search", { p_token: sbu, p_q: "50%" })).hits.map((h: any) => h.node_id)).toEqual([none.id]);
    expect((await ok("mp_search", { p_token: sbu, p_q: "c" })).hits).toEqual([]);
    expect((await ok("mp_search", { p_token: sbu, p_q: "zzzz" })).hits).toEqual([]);
  });

  it("wiring maps: start from the AHU / FCU / Chiller template, every diagram branch to verify, wires with their details", async () => {
    const sbu = await login("sbu");
    const made = await ok("mp_create", { p_token: sbu, p_name: "Wiring : AHU", p_kind: "wiring", p_template: "ahu" });
    const g = await ok("mp_get", { p_token: sbu, p_map_id: made.id });
    expect(g.map.kind).toBe("wiring");
    const by = (t: string) => g.nodes.filter((n: any) => n.title === t);
    const tops = g.nodes.filter((n: any) => n.parent === g.nodes.find((x: any) => !x.parent).id).map((n: any) => n.title);
    expect(tops).toEqual(["How this map works", "AHU with EC fans", "AHU with DC motors and drives"]);
    expect(by("AHU with EC fans")[0]).toMatchObject({ special: ["Layout: columns"], verified: false });
    // the DC variant has drives; the EC one has none
    expect(by("Supply fan drive (U1)")).toHaveLength(1);
    const wires = g.nodes.flatMap((n: any) => n.links.map((l: any) => ({ from: n.title, ...l })));
    expect(wires.every((w: any) => w.kind === "node" && /^w-/.test(w.rel) && w.map === made.id)).toBe(true);
    expect(wires.find((w: any) => w.from === "BMS" && w.rel === "w-bus")).toMatchObject({ signal: "BACnet MS/TP or Modbus RTU (RS-485)", cable: "Screened twisted pair", by: "others" });
    // every wire ends at a branch of the map
    const ids = new Set(g.nodes.map((n: any) => n.id));
    expect(wires.every((w: any) => ids.has(w.node))).toBe(true);
    for (const tpl of ["fcu", "chiller"]) {
      const m = await ok("mp_create", { p_token: sbu, p_name: "Wiring " + tpl, p_kind: "wiring", p_template: tpl });
      const gg = await ok("mp_get", { p_token: sbu, p_map_id: m.id });
      expect(gg.nodes.length).toBeGreaterThan(15);
      expect(gg.nodes.some((n: any) => n.links.some((l: any) => l.rel === "w-power"))).toBe(true);
    }
    // a template only for a wiring map, only the three products
    expect(await refused("mp_create", { p_token: sbu, p_name: "X", p_kind: "knowledge", p_template: "ahu" })).toBe("Choose AHU, FCU or Chiller to start from.");
    expect(await refused("mp_create", { p_token: sbu, p_name: "Y", p_kind: "wiring", p_template: "vrv" })).toBe("Choose AHU, FCU or Chiller to start from.");
    // a blank wiring map; the type can change like any other
    const blank = await ok("mp_create", { p_token: sbu, p_name: "Wiring blank", p_kind: "wiring" });
    expect((await ok("mp_get", { p_token: sbu, p_map_id: blank.id })).nodes).toHaveLength(1);
    await ok("mp_map_save", { p_token: sbu, p_map_id: blank.id, p_kind: "knowledge" });
    expect((await ok("mp_get", { p_token: sbu, p_map_id: blank.id })).map.kind).toBe("knowledge");
    // wire details are checked
    const root = g.nodes.find((n: any) => !n.parent).id, target = by("Main isolator (Q0)")[0].id;
    const bad = async (l: unknown) => refused("mp_node_save", { p_token: sbu, p_node_id: root, p_patch: { links: [l] } });
    expect(await bad({ kind: "node", node: target, rel: "w-power", by: "nobody" })).toBe("Choose who wires it: Daikin (factory) or others (site).");
    expect(await bad({ kind: "node", node: target, rel: "w-power", cable: "x".repeat(81) })).toBe("A terminal, cable or signal is at most 80 characters.");
    const saved = (await ok("mp_node_save", { p_token: sbu, p_node_id: root, p_patch: { links: [{ kind: "node", node: target, rel: "w-power", from_t: " X1:1 ", to_t: "L1", cable: "4C x 6 mm²", by: "others" }] } })).node;
    expect(saved.links[0]).toMatchObject({ rel: "w-power", from_t: "X1:1", to_t: "L1", cable: "4C x 6 mm²", by: "others" });
  });
});
