import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins, USERS } from "./helpers";
import { poSkip, poModel, poSeries, poValue } from "../../worker/src/api/po";

/* A plain user given "Can edit" for Product Options (the grant is read on every request). */
async function poEditor(): Promise<string> {
  const t = await login("sbu");
  await env.DB.prepare("INSERT OR IGNORE INTO app_user_categories (user_id, category_id) VALUES (?, 'general')").bind(USERS.sbu.id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO app_tool_editors (user_id, tool_id) VALUES (?, 'product-options')").bind(USERS.sbu.id).run();
  return t;
}

const AHU_ROWS = [
  { key: "general||project", section: "General", sub: "", component: "Project" },
  { key: "general||power supply", section: "General", sub: "", component: "Power supply" },
  { key: "unit data||panel", section: "Unit data", sub: "", component: "Panel" },
  { key: "unit data||insulation", section: "Unit data", sub: "", component: "Insulation" },
  { key: "unit data||supply air flow", section: "Unit data", sub: "", component: "Supply air flow" },
  { key: "casing|options|option", section: "Casing", sub: "Options", component: "Option" }
];

describe("po helpers (po__skip, po__model, po__series, po__value)", () => {
  it("poModel drops the trailing N of a motor variant", () => {
    expect(poModel("FWW1600TAN")).toBe("FWW1600TA");
    expect(poModel("FWW600VAN")).toBe("FWW600VA");
    expect(poModel("  FWW600VA ")).toBe("FWW600VA");
    expect(poModel("fww600van")).toBe("fww600va");
    expect(poModel(null)).toBe("");
  });
  it("poSeries is the model without its size figure", () => {
    expect(poSeries("FWW600VA")).toBe("FWWVA");
    expect(poSeries("FWW700VA-D")).toBe("FWWVA-D");
    expect(poSeries("FWW1600TAN")).toBe("FWWTA");
    expect(poSeries("")).toBe("");
  });
  it("poValue tidies spacing and takes the quantity off an option line only", () => {
    expect(poValue("casing|options|option", "2 x Inspection window")).toBe("Inspection window");
    expect(poValue("casing|options|option", "1 X  Inspection   window ")).toBe("Inspection window");
    expect(poValue("unit data||panel", "2 x 25 mm")).toBe("2 x 25 mm");
    expect(poValue("unit data||panel", "  62   mm ")).toBe("62 mm");
    expect(poValue("unit data||panel", "x".repeat(400)).length).toBe(300);
  });
  it("poSkip: the project rows of the General section, nothing else", () => {
    expect(poSkip("general||project")).toBe(true);
    expect(poSkip("general||unit")).toBe(true);
    expect(poSkip("general||power supply")).toBe(false);
    expect(poSkip("unit data||project")).toBe(false);
  });
});

describe("dn_* routes", () => {
  beforeEach(async () => { await resetLogins(); });

  it("dn_get_rules: empty mapping for any approved user; refused without a session or a product", async () => {
    const t = await login("sbu");
    expect(await ok("dn_get_rules", { p_token: t, p_product_id: "ahu" })).toMatchObject({ show_unmapped: true, rules: [] });
    expect(await refused("dn_get_rules", { p_token: "nope", p_product_id: "ahu" })).toBe("SESSION_EXPIRED");
    expect(await refused("dn_get_rules", { p_token: t, p_product_id: "nope" })).toMatch(/Choose a product first/);
  });

  it("dn_add_rows: any user adds unknown keys as New, never touches existing rows; starter keywords seeded once", async () => {
    const t = await login("sbu");
    const r = await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: [...AHU_ROWS.slice(0, 3), AHU_ROWS[1], { key: "", section: "x" }] });
    expect(r).toMatchObject({ ok: true, added: 3 });
    const rules = (await ok("dn_get_rules", { p_token: t, p_product_id: "ahu" })).rules;
    expect(rules.map((x: any) => x.key)).toEqual(["general||project", "general||power supply", "unit data||panel"]);
    expect(rules[1]).toEqual({ key: "general||power supply", section: "General", sub: "", component: "Power supply", show: true, label: "", strip: "", response: "",
      keywords: "power supply; electrical characteristic; volt phase", new: true, in_tree: true });
    expect(rules[2].keywords).toMatch(/double skin/);
    // the starter keywords are a one-time gift: once an AHU row has keywords, later rows get none
    const r2 = await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: AHU_ROWS });
    expect(r2.added).toBe(3);
    const again = (await ok("dn_get_rules", { p_token: t, p_product_id: "ahu" })).rules;
    expect(again.length).toBe(6);
    expect(again.find((x: any) => x.key === "unit data||insulation").keywords).toBe("");
    expect(again.map((x: any) => x.key)).toEqual(AHU_ROWS.map((x) => x.key));          // sort order = order of arrival
    // another product never gets AHU starter keywords
    await ok("dn_add_rows", { p_token: t, p_product_id: "fcu", p_rows: [AHU_ROWS[1]] });
    expect((await ok("dn_get_rules", { p_token: t, p_product_id: "fcu" })).rules[0].keywords).toBe("");
    expect(await refused("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: "x" })).toMatch(/could not be read/);
    expect(await refused("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: new Array(3001).fill({ key: "k" }) })).toMatch(/more than 3000/);
    expect(await refused("dn_add_rows", { p_token: "nope", p_product_id: "ahu", p_rows: [] })).toBe("SESSION_EXPIRED");
  });

  it("dn_add_rows follows the show_unmapped setting for new rows", async () => {
    const e = await poEditor();
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: false, p_rules: [], p_remove: [] });
    await ok("dn_add_rows", { p_token: e, p_product_id: "ahu", p_rows: [AHU_ROWS[2]] });
    const g = await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" });
    expect(g.show_unmapped).toBe(false);
    expect(g.rules[0].show).toBe(false);
    expect(g.rules[0].new).toBe(true);
  });

  it("dn_admin_save_rules: editors only; validates, removes, upserts as reviewed, keeps in_tree", async () => {
    const user = await login("sbu");
    await ok("dn_add_rows", { p_token: user, p_product_id: "ahu", p_rows: AHU_ROWS });
    expect(await refused("dn_admin_save_rules", { p_token: user, p_product_id: "ahu", p_show_unmapped: true, p_rules: [], p_remove: [] })).toMatch(/Edit access/);
    const sales = await login("sales");                 // "Can edit" for compliance-maker only
    expect(await refused("dn_admin_save_rules", { p_token: sales, p_product_id: "ahu", p_show_unmapped: true, p_rules: [], p_remove: [] })).toMatch(/Edit access/);
    const e = await poEditor();
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: " " }] })).toMatch(/no name/);
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "a", label: "x".repeat(121) }] })).toMatch(/longer than 120/);
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "a", strip: "x".repeat(301) }] })).toMatch(/longer than/);
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "a", keywords: "x".repeat(601) }] })).toMatch(/longer than/);
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "a", response: "x".repeat(1001) }] })).toMatch(/longer than/);
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: new Array(3001).fill({ key: "k" }) })).toMatch(/more than 3000/);
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: "x" })).toMatch(/could not be read/);

    // leave the air flow row out of the tree (po_admin_set_hidden with no value key), then save the mapping
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "unit data||supply air flow", p_value_key: "", p_hidden: true });
    const r = await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: false, p_remove: ["general||project", "no-such-key"], p_rules: [
      { key: "unit data||panel", section: "Unit data", sub: "", component: "Panel", show: true, label: "Panel thickness", strip: "+ PE", response: "Panel thickness is $", keywords: "panel thick" },
      { key: "unit data||supply air flow", section: "Unit data", sub: "", component: "Supply air flow", show: false },
      { key: "unit data||supply air flow", section: "dup", component: "ignored" },
      { key: "new||row", section: "New", sub: "", component: "Row", show: true, label: "", strip: "", response: "", keywords: "" }
    ] });
    expect(r).toMatchObject({ ok: true, saved: 3, removed: 1 });
    const g = await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" });
    expect(g.show_unmapped).toBe(false);
    expect(g.rules.length).toBe(6);
    expect(g.rules.map((x: any) => x.key)).toEqual(["unit data||panel", "general||power supply", "unit data||supply air flow", "new||row", "unit data||insulation", "casing|options|option"]);   // sort then key, as before
    expect(g.rules[0]).toEqual({ key: "unit data||panel", section: "Unit data", sub: "", component: "Panel", show: true, label: "Panel thickness", strip: "+ PE",
      response: "Panel thickness is $", keywords: "panel thick", new: false, in_tree: true });
    expect(g.rules[2]).toMatchObject({ show: false, new: false, in_tree: false, component: "Supply air flow" });   // in_tree kept
    expect(g.rules[3]).toMatchObject({ new: false, section: "New" });
    expect(g.rules[1]).toMatchObject({ new: true });                                  // rows not in the list are kept as they are
    const row = await env.DB.prepare("SELECT updated_by, reviewed FROM dn_map WHERE product_id = 'ahu' AND row_key = 'unit data||panel'").first<any>();
    expect(row).toEqual({ updated_by: USERS.sbu.id, reviewed: 1 });
    // a save with no change leaves updated_by / updated_at alone; a change stamps the editor
    const before = await env.DB.prepare("SELECT updated_at FROM dn_map WHERE row_key = 'unit data||insulation'").first<any>();
    const a = await login("admin");
    await ok("dn_admin_save_rules", { p_token: a, p_product_id: "ahu", p_show_unmapped: true, p_rules: [
      { key: "unit data||insulation", section: "Unit data", component: "Insulation", show: true, keywords: "" },
      { key: "unit data||panel", section: "Unit data", component: "Panel", show: true, label: "Panel thickness", strip: "+ PE", response: "Panel thickness is $", keywords: "panel thick" }
    ] });
    const ins = await env.DB.prepare("SELECT updated_by, updated_at, reviewed FROM dn_map WHERE row_key = 'unit data||insulation'").first<any>();
    expect(ins.reviewed).toBe(1); expect(ins.updated_by).toBe(USERS.admin.id); expect(ins.updated_at).not.toBe(before.updated_at);
    const pan = await env.DB.prepare("SELECT updated_by FROM dn_map WHERE row_key = 'unit data||panel'").first<any>();
    expect(pan.updated_by).toBe(USERS.sbu.id);
  });

  it("dn_admin_save_rules seeds the AHU starter keywords for a row it creates, once", async () => {
    const e = await poEditor();
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [
      { key: "unit data||door", section: "Unit data", component: "Door", show: true }, { key: "x||y", section: "X", component: "Y", show: true }
    ] });
    const g = await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" });
    expect(g.rules[0].keywords).toBe("access door; inspection door; hinge");
    expect(g.rules[1].keywords).toBe("");
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "unit data||roof", section: "Unit data", component: "Roof", show: true }] });
    expect((await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" })).rules.find((x: any) => x.key === "unit data||roof").keywords).toBe("");
    // an editor's own keywords always win
    const t = await login("admin");
    await env.DB.prepare("DELETE FROM dn_map").run();
    await ok("dn_admin_save_rules", { p_token: t, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "unit data||door", section: "Unit data", component: "Door", show: true, keywords: "my words" }] });
    expect((await ok("dn_get_rules", { p_token: t, p_product_id: "ahu" })).rules[0].keywords).toBe("my words");
  });
});

describe("po_* routes", () => {
  beforeEach(async () => { await resetLogins(); });

  async function mapping(t: string, productId = "ahu") {
    await ok("dn_add_rows", { p_token: t, p_product_id: productId, p_rows: AHU_ROWS });
  }

  it("po_collect: any user; factory by name, mapped shown rows only, skip keys, cleaned values, times", async () => {
    const t = await login("sbu");
    await mapping(t);
    const items = [
      { factory: "dubai", key: "unit data||panel", value: " 62   mm", model: "" },
      { factory: "DUBAI", key: "unit data||panel", value: "62 MM", model: "" },
      { factory: "Dubai", key: "unit data||panel", value: "50 mm", model: "" },
      { factory: "Riyadh", key: "unit data||panel", value: "50 mm", model: "" },
      { factory: "Dubai", key: "general||project", value: "Secret tower", model: "" },        // po__skip
      { factory: "Dubai", key: "general||power supply", value: "400V/3/50", model: "" },
      { factory: "Dubai", key: "casing|options|option", value: "2 x Inspection window", model: "" },
      { factory: "Dubai", key: "casing|options|option", value: "1 x Inspection window", model: "" },
      { factory: "Dubai", key: "unit data||panel", value: "-", model: "" },
      { factory: "Dubai", key: "unit data||panel", value: "  ", model: "" },
      { factory: "Dubai", key: "unknown||row", value: "x", model: "" },
      { factory: "Shenzhen", key: "unit data||panel", value: "x", model: "" },                 // not an AHU factory
      { factory: "", key: "unit data||panel", value: "x", model: "" }
    ];
    const r = await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: items });
    expect(r).toMatchObject({ ok: true, saved: 5 });
    const rows = await env.DB.prepare("SELECT factory_id, row_key, model, value_key, value, times FROM po_values ORDER BY factory_id, row_key, value_key").all<any>();
    expect(rows.results).toEqual([
      { factory_id: "ahu-dubai", row_key: "casing|options|option", model: "", value_key: "inspection window", value: "Inspection window", times: 2 },
      { factory_id: "ahu-dubai", row_key: "general||power supply", model: "", value_key: "400v/3/50", value: "400V/3/50", times: 1 },
      { factory_id: "ahu-dubai", row_key: "unit data||panel", model: "", value_key: "50 mm", value: "50 mm", times: 1 },
      { factory_id: "ahu-dubai", row_key: "unit data||panel", model: "", value_key: "62 mm", value: "62 MM", times: 2 },
      { factory_id: "ahu-riyadh", row_key: "unit data||panel", model: "", value_key: "50 mm", value: "50 mm", times: 1 }
    ]);
    // seen again: times grows, nothing duplicated
    const r2 = await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: [items[0]] });
    expect(r2.saved).toBe(1);
    const v = await env.DB.prepare("SELECT times FROM po_values WHERE factory_id = 'ahu-dubai' AND value_key = '62 mm'").first<any>();
    expect(v.times).toBe(3);
    expect(await refused("po_collect", { p_token: "nope", p_product_id: "ahu", p_items: [] })).toBe("SESSION_EXPIRED");
    expect(await refused("po_collect", { p_token: t, p_product_id: "ahu", p_items: {} })).toMatch(/could not be read/);
    expect(await refused("po_collect", { p_token: t, p_product_id: "nope", p_items: [] })).toMatch(/Choose a product first/);
    expect(await refused("po_collect", { p_token: t, p_product_id: "ahu", p_items: new Array(20001).fill({}) })).toMatch(/more than 20000/);
  });

  it("po_collect ignores rows the mapping hides or leaves out of the tree, and keeps at most 300 values per row, factory and model", async () => {
    const e = await poEditor();
    await mapping(e);
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "unit data||insulation", section: "Unit data", component: "Insulation", show: false }] });
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "unit data||supply air flow", p_value_key: "", p_hidden: true });
    const r = await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [
      { factory: "Dubai", key: "unit data||insulation", value: "50 mm", model: "" },
      { factory: "Dubai", key: "unit data||supply air flow", value: "1000 m3/h", model: "" }
    ] });
    expect(r.saved).toBe(0);
    const many = []; for (let i = 0; i < 320; i++) many.push({ factory: "Dubai", key: "unit data||panel", value: "v" + i, model: "" });
    const c = await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: many });
    expect(c.saved).toBe(300);
    // a known value still counts past the cap; a new one does not; another model has its own 300
    const c2 = await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [
      { factory: "Dubai", key: "unit data||panel", value: "v1", model: "" }, { factory: "Dubai", key: "unit data||panel", value: "v999", model: "" },
      { factory: "Dubai", key: "unit data||panel", value: "v999", model: "M1" }
    ] });
    expect(c2.saved).toBe(2);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM po_values WHERE factory_id = 'ahu-dubai' AND row_key = 'unit data||panel'").first<any>();
    expect(n.n).toBe(301);
  });

  it("po_get_tree: rows with values or extras, hidden rows and values only for editors, models per series, sections for editors", async () => {
    const t = await login("sbu");
    await mapping(t, "fcu");
    await ok("po_collect", { p_token: t, p_product_id: "fcu", p_items: [
      { factory: "Shenzhen", key: "unit data||panel", value: "A", model: "FWW600VA" },
      { factory: "Shenzhen", key: "unit data||panel", value: "A", model: "FWW600VAN" },
      { factory: "Shenzhen", key: "unit data||panel", value: "B", model: "FWW400VA" },
      { factory: "Shenzhen", key: "unit data||insulation", value: "I", model: "FWW400VA" },
      { factory: "Shenzhen", key: "unit data||panel", value: "C", model: "FWW700VA-D" },
      { factory: "Shenzhen", key: "general||power supply", value: "230V", model: "FWW600VA" }
    ] });
    const e = await poEditor();
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "fcu-shenzhen", p_row_key: "unit data||panel", p_value_key: "b", p_model: "FWW400VA", p_hidden: true });
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "fcu-shenzhen", p_row_key: "unit data||insulation", p_value_key: "", p_hidden: true });
    const x = await ok("po_admin_save_extra", { p_token: e, p_factory_id: "fcu-shenzhen", p_id: null, p_section: "  Casing  ", p_row_key: "casing|options|option", p_kind: "note", p_body: " Painted on request " });

    const user = await login("joiner").catch(() => null);          // pending: cannot log in at all
    expect(user).toBeNull();
    const plain = await login("sales");
    const u = await ok("po_get_tree", { p_token: plain, p_factory_id: "fcu-shenzhen" });
    expect(u.factory).toEqual({ id: "fcu-shenzhen", name: "Shenzhen", product_id: "fcu", product: "FCU" });
    expect(u.can_edit).toBe(false);
    expect(typeof u.updated).toBe("string");
    expect(u.sections).toEqual([]);
    expect(u.rows.map((r: any) => r.key)).toEqual(["general||power supply", "unit data||panel", "casing|options|option"]);   // insulation left out; options row only for its note
    expect(u.rows[1]).toEqual({ key: "unit data||panel", section: "Unit data", sub: "", component: "Panel", hidden: false, values: [
      { k: "a", v: "A", n: 2, hidden: false, model: "FWW600VA" }, { k: "c", v: "C", n: 1, hidden: false, model: "FWW700VA-D" }
    ] });
    expect(u.rows[2].values).toEqual([]);
    expect(u.models).toEqual([
      { model: "FWW600VA", series: "FWWVA", units: 2 }, { model: "FWW400VA", series: "FWWVA", units: 1 }, { model: "FWW700VA-D", series: "FWWVA-D", units: 1 }
    ]);
    expect(u.extras).toEqual([{ id: x.id, section: "Casing", key: "casing|options|option", kind: "note", body: "Painted on request", at: expect.any(String), by: "SBU User" }]);

    const ed = await ok("po_get_tree", { p_token: e, p_factory_id: "fcu-shenzhen" });
    expect(ed.can_edit).toBe(true);
    expect(ed.rows.map((r: any) => [r.key, r.hidden])).toEqual([["general||power supply", false], ["unit data||panel", false], ["unit data||insulation", true], ["casing|options|option", false]]);
    expect(ed.rows[1].values.map((v: any) => [v.k, v.hidden, v.model])).toEqual([["b", true, "FWW400VA"], ["a", false, "FWW600VA"], ["c", false, "FWW700VA-D"]]);
    expect(ed.sections).toEqual(["Unit data", "Casing"]);
    expect(await refused("po_get_tree", { p_token: "nope", p_factory_id: "fcu-shenzhen" })).toBe("SESSION_EXPIRED");
    expect(await refused("po_get_tree", { p_token: plain, p_factory_id: "nope" })).toMatch(/Choose a product and factory/);
  });

  it("po_get_tree: an AHU tree has no models; a label replaces the component name; nothing for an empty factory", async () => {
    const e = await poEditor();
    await mapping(e);
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_show_unmapped: true, p_rules: [{ key: "unit data||panel", section: "Unit data", component: "Panel", show: true, label: "Panel thickness" }] });
    await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }] });
    const d = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" });
    expect(d.rows).toEqual([{ key: "unit data||panel", section: "Unit data", sub: "", component: "Panel thickness", hidden: false, values: [{ k: "62 mm", v: "62 mm", n: 1, hidden: false, model: "" }] }]);
    expect(d.models).toEqual([]);
    const r = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-riyadh" });
    expect(r).toMatchObject({ rows: [], models: [], extras: [], updated: null });
  });

  it("po_admin_save_extra / delete: editors only, validated, changed in place, refused for another factory", async () => {
    const plain = await login("sbu");
    expect(await refused("po_admin_save_extra", { p_token: plain, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "option", p_body: "x" })).toMatch(/Edit access/);
    const ta = await login("teamAdmin");                       // admin of the General tile = editor of Product Options
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "thing", p_body: "x" })).toMatch(/special option, note or AI note/);
    // an AI note: saved like a note, seen by editors in the tree, not by readers
    const ai = await ok("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "ai", p_body: "Panels are 62 mm double wall." });
    expect((await ok("po_get_tree", { p_token: ta, p_factory_id: "ahu-dubai" })).extras.some((x: any) => x.id === ai.id && x.kind === "ai")).toBe(true);
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" })).extras.some((x: any) => x.kind === "ai")).toBe(false);
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: null, p_section: " ", p_row_key: "", p_kind: "option", p_body: "x" })).toMatch(/section a name/);
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "option", p_body: "  " })).toMatch(/Type the text/);
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "option", p_body: "x".repeat(1001) })).toMatch(/longer than 1000/);
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "nope", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "option", p_body: "x" })).toMatch(/Choose a product and factory/);
    const a = await ok("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "option", p_body: "Marine coating" });
    expect(typeof a.id).toBe("string");
    const b = await ok("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: a.id, p_section: "Casing", p_row_key: "", p_kind: "note", p_body: "Marine coating on request" });
    expect(b.id).toBe(a.id);
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-riyadh", p_id: a.id, p_section: "Casing", p_row_key: "", p_kind: "note", p_body: "x" })).toMatch(/no longer exists/);
    const tree = await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" });
    expect(tree.extras).toEqual([{ id: a.id, section: "Casing", key: "", kind: "note", body: "Marine coating on request", at: expect.any(String), by: "Team Admin" }]);
    expect(tree.rows).toEqual([]);                             // an extra on the whole section makes no row
    expect(await refused("po_admin_delete_extra", { p_token: plain, p_id: a.id })).toMatch(/Edit access/);
    expect(await ok("po_admin_delete_extra", { p_token: ta, p_id: a.id })).toMatchObject({ ok: true });
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" })).extras).toEqual([]);
  });

  it("po_admin_set_hidden: editors only; a row for every factory of the product, a value for one factory and model", async () => {
    const e = await poEditor();
    await mapping(e);
    await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }, { factory: "Riyadh", key: "unit data||panel", value: "62 mm", model: "" }] });
    const plain = await login("sales");
    expect(await refused("po_admin_set_hidden", { p_token: plain, p_factory_id: "ahu-dubai", p_row_key: "unit data||panel", p_value_key: "62 mm", p_hidden: true })).toMatch(/Edit access/);
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "unit data||panel", p_value_key: "62 mm", p_model: "", p_hidden: true });
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" })).rows).toEqual([]);
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-riyadh" })).rows[0].values[0].k).toBe("62 mm");
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "unit data||panel", p_value_key: "62 mm", p_model: "", p_hidden: false });
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" })).rows[0].values[0].hidden).toBe(false);
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "unit data||panel", p_value_key: "", p_hidden: true });
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-riyadh" })).rows).toEqual([]);        // the row is out for every factory
    expect((await ok("dn_get_rules", { p_token: plain, p_product_id: "ahu" })).rules.find((r: any) => r.key === "unit data||panel").in_tree).toBe(false);
    expect(await refused("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "no||row", p_value_key: "", p_hidden: true })).toMatch(/no longer exists/);
    expect(await refused("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "unit data||panel", p_value_key: "99 mm", p_hidden: true })).toMatch(/no longer exists/);
    expect(await refused("po_admin_set_hidden", { p_token: "nope", p_factory_id: "ahu-dubai", p_row_key: "unit data||panel", p_value_key: "", p_hidden: true })).toBe("SESSION_EXPIRED");
  });
});
