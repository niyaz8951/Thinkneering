import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, rpc, login, resetLogins, USERS } from "./helpers";
import { poSkip, poModel, poSeries, poValue, poPieces } from "../../worker/src/api/po";
import { poAutoKind, poKind } from "../../worker/src/lib/po-kind";
import KEYS from "./fixtures-po-keys.json";

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
  it("poSeries is the model without its size figure and its -D variant", () => {
    expect(poSeries("FWW600VA")).toBe("FWWVA");
    expect(poSeries("FWW700VA-D")).toBe("FWWVA");
    expect(poSeries("FWW800TA-D")).toBe("FWWTA");
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

describe("po kinds (lib/po-kind.ts), on every row of the HILTOP and Qiddiya datasheets", () => {
  const kinds = new Map((KEYS as string[]).map((k) => [k, poAutoKind(k)]));
  it("options: what the unit is made of, classes, models", () => {
    for (const k of ["unit data||panel", "unit data||model box ref.", "unit data||profile", "unit data||roof", "general||power supply",
      "mechanical characteristic (en1886)||thermal bridging", "filter supply||filter class", "filter supply||filter name", "filter supply||material",
      "filter supply||efficiency epm1", "filter supply||pressure drop design", "fan supply||model", "fan supply||type", "fan supply||material",
      "fan supply||rotation speed max", "fan supply||k factor", "fan supply|motor data|efficiency class", "recuperator heat wheel supply||part number",
      "recuperator heat wheel supply||diameter", "coil cooling water supply|geometry|tube material", "coil cooling dx supply|geometry|fluid",
      "isothermal steam humidifier supply||name", "electric heater supply||material", "damper supply||mounting"]) expect([k, kinds.get(k)]).toEqual([k, "option"]);
  });
  it("duty: figures of one selection", () => {
    for (const k of ["unit data||supply air flow", "unit data||model", "unit data||weight", "unit data||total supply filters eff. epm1", "unit data||sfpv (clean filters)",
      "en 13053||supply power class", "filter supply||air velocity", "filter supply||clean pressure drop", "filter supply||dimensions", "filter supply||area",
      "fan supply||flow design", "fan supply||rotation speed work", "fan supply||efficiency (reg327/2011)", "fan supply||quantity", "fan supply||control voltage",
      "fan supply|motor data|power", "fan supply||sfpv class", "coil cooling dx supply|geometry|rows", "coil cooling water supply|geometry|connection diam",
      "recuperator heat wheel supply||energy class (en13053)", "isothermal steam humidifier supply||steam", "damper supply||torque",
      "mixing box supply||recirculated air", "empty section supply||length"]) expect([k, kinds.get(k)]).toEqual([k, "duty"]);
    expect([...kinds].filter(([k]) => /\|(winter|summer|cooling|cooling air side|cooling fluid side)( · (supply|return))?\|/.test(k)).every(([k, v]) => v === "duty" || /note|\[/.test(k))).toBe(true);
  });
  it("accessories, project conditions, notes", () => {
    expect([...kinds].filter(([k]) => /\|options\|option$/.test(k)).every(([, v]) => v === "accessory")).toBe(true);
    expect(["unit data||location", "unit data||air density", "unit data||altitude"].map((k) => kinds.get(k))).toEqual(["project", "project", "project"]);
    expect(kinds.get("fan supply|motor data|note")).toBe("hide");
    expect(kinds.get("coil cooling dx supply|geometry|model")).toBe("hide");
    expect(poKind("unit data||supply air flow", "option")).toBe("option");     // the editor's choice wins
    expect(poKind("unit data||panel", "duty")).toBe("duty");
    expect(poKind("unit data||location", "option")).toBe("option");
    expect(poKind("fan supply|options|option", "duty")).toBe("accessory");     // except for Options List lines and notes
  });
});

/* FCU technical report, Kifaf Phase-5 Plot-2 FCU/GF/16 (FWW1400VA, 22 Oct 2026): every row the reader gives
   (scripts/ds-parse-check.mjs reads the same report). What is fixed for a model is an option; one selection is duty. */
describe("po kinds of an FCU (lib/po-kind.ts)", () => {
  const k = (key: string) => [key, poAutoKind(key)];
  it("options: fixed for a model, construction, materials", () => {
    for (const key of ["unit data||unit model", "unit data||net dimension w*d*h (mm)", "unit data||shipping dimension w*h*d (mm)", "unit data||unit net weight (kg)",
      "unit data||fan control type", "configuration information||drain pan type", "configuration information||drain pan material",
      "configuration information||drain pan insulation", "configuration information||coil area (m²)", "configuration information||fpi",
      "configuration information||pipe connection", "configuration information||motor type", "configuration information||rated motor speed (rpm)",
      "configuration information||return plenum type", "configuration information||return plenum insulation", "configuration information||filter type",
      "configuration information||fins material", "configuration information||water connection size", "configuration information||fan qty",
      "configuration information||motor qty", "cooling coil (cooling mode)||coil rows", "general||power supply"]) expect(k(key)).toEqual([key, "option"]);
  });
  it("duty: what one selection gives", () => {
    for (const key of ["unit data||application air flow(m³/h)", "unit data||design air flow(m³/h)", "unit data||application esp (pa)", "unit data||design esp (pa)",
      "unit data||fan power input (w)", "unit data||running current (a)", "unit data||fan speed", "configuration information||face velocity(m/s)",
      "cooling coil (cooling mode)||total cooling capacity(kw)", "cooling coil (cooling mode)||on coil db (°c)", "cooling coil (cooling mode)||off coil wb (°c)",
      "cooling coil (cooling mode)||ewt(°c)", "cooling coil (cooling mode)||lwt(°c)", "cooling coil (cooling mode)||wpd (kpa)",
      "cooling coil (cooling mode)||water flow rate (l/s)", "cooling coil (cooling mode)||water volume (l)", "cooling coil (heating mode)||heating capacity(kw)",
      "cooling coil (heating mode)||on coil (db) (°c)", "electric heater||heating capacity(kw)", "electric heater||e-heater maximum current (a)",
      "electric heater||off coil (db) (°c)", "acoustical performance|lw inlet + rad(db(a))|63hz", "acoustical performance|lw outlet duct(db(a))|overall"]) expect(k(key)).toEqual([key, "duty"]);
  });
  it("the site's altitude is a project condition", () => {
    expect(poAutoKind("unit data||altitude(m)")).toBe("project");
    expect(poAutoKind("unit data||altitude (m)")).toBe("project");
    expect(poAutoKind("unit data||altitude of the roof")).toBe("option");      // only the condition itself
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

  it("dn_add_rows: any user adds unknown keys as New, never touches existing rows; every new AHU row gets its starter keywords and Remove text", async () => {
    const t = await login("sbu");
    const r = await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: [...AHU_ROWS.slice(0, 3), AHU_ROWS[1], { key: "", section: "x" }] });
    expect(r).toMatchObject({ ok: true, added: 3 });
    const rules = (await ok("dn_get_rules", { p_token: t, p_product_id: "ahu" })).rules;
    expect(rules.map((x: any) => x.key)).toEqual(["general||project", "general||power supply", "unit data||panel"]);
    expect(rules[1]).toEqual({ key: "general||power supply", section: "General", sub: "", component: "Power supply", show: true, label: "", strip: "+ PE", response: "",
      keywords: "power supply; electrical characteristic; electrical supply; supply voltage; main power; electrical power", new: true, in_tree: true, kind: "", auto_kind: "option", place: "" });
    expect(rules[2].keywords).toMatch(/double skin/);
    // a row new to the mapping has had no decision yet: it gets its starter keywords even when other rows have keywords (19 Oct 2026)
    const r2 = await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: AHU_ROWS });
    expect(r2.added).toBe(3);
    const again = (await ok("dn_get_rules", { p_token: t, p_product_id: "ahu" })).rules;
    expect(again.length).toBe(6);
    expect(again.find((x: any) => x.key === "unit data||insulation").keywords).toMatch(/^insulation; insulated panel/);
    expect(again.map((x: any) => x.key)).toEqual(AHU_ROWS.map((x) => x.key));          // sort order = order of arrival
    // another product never gets AHU starter keywords; an FCU gets its own (migration 0013), without the AHU's "+ PE"
    await ok("dn_add_rows", { p_token: t, p_product_id: "fcu", p_rows: [AHU_ROWS[2], AHU_ROWS[1],
      { key: "configuration information||drain pan material", section: "Configuration information", sub: "", component: "Drain Pan Material" }] });
    const fcu = (await ok("dn_get_rules", { p_token: t, p_product_id: "fcu" })).rules;
    expect(fcu.find((x: any) => x.key === "unit data||panel").keywords).toBe("");
    expect(fcu.find((x: any) => x.key === "general||power supply")).toMatchObject({ keywords: expect.stringMatching(/^power supply;/), strip: "" });
    expect(fcu.find((x: any) => x.key === "configuration information||drain pan material").keywords).toMatch(/drain pan stainless/);
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
      response: "Panel thickness is $", keywords: "panel thick", new: false, in_tree: true, kind: "", auto_kind: "option", place: "" });
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
    expect(g.rules[0].keywords).toBe("access side; door side; handing");
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

/* Values read from datasheets wait for an admin (migration 0007): the super user approves every waiting value. */
async function approveAll(factoryId: string) {
  const a = await login("admin");
  await rpc("po_admin_approve", { p_token: a, p_factory_id: factoryId, p_all: true, p_approve: true });
}

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
    await approveAll("fcu-shenzhen");
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
    expect(u.rows[1]).toEqual({ key: "unit data||panel", section: "Unit data", sub: "", component: "Panel", hidden: false, kind: "option", kind_set: "", place: "", values: [
      { k: "a", v: "A", n: 2, hidden: false, model: "FWW600VA", g: "", wait: false, held: false }, { k: "c", v: "C", n: 1, hidden: false, model: "FWW700VA-D", g: "", wait: false, held: false }
    ] });
    expect(u.rows[2].values).toEqual([]);
    expect(u.models).toEqual([
      { model: "FWW600VA", series: "FWWVA", units: 2 }, { model: "FWW400VA", series: "FWWVA", units: 1 }, { model: "FWW700VA-D", series: "FWWVA", units: 1 }
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
    await approveAll("ahu-dubai");
    const d = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" });
    expect(d.rows).toEqual([{ key: "unit data||panel", section: "Unit data", sub: "", component: "Panel thickness", hidden: false, kind: "option", kind_set: "", place: "", values: [{ k: "62 mm", v: "62 mm", n: 1, hidden: false, model: "", g: "", wait: false, held: false }] }]);
    expect(d.models).toEqual([]);
    const r = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-riyadh" });
    expect(r).toMatchObject({ rows: [], models: [], extras: [], updated: null });
  });

  it("po_admin_save_extra / delete: editors only, validated, changed in place, refused for another factory", async () => {
    const plain = await login("sbu");
    expect(await refused("po_admin_save_extra", { p_token: plain, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "option", p_body: "x" })).toMatch(/Edit access/);
    const ta = await login("teamAdmin");                       // admin of the General tile = editor of Product Options
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_id: null, p_section: "Casing", p_row_key: "", p_kind: "thing", p_body: "x" })).toMatch(/special option, note, AI note or make/);
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

  it("AI notes (20 Oct 2026): written, changed and deleted by the super user or a General admin only; seen by them only, in read and edit", async () => {
    const e = await poEditor(), ta = await login("teamAdmin"), plain = await login("sales"), su = await login("admin");
    const note = { p_factory_id: "ahu-riyadh", p_id: null, p_section: "General", p_row_key: "", p_kind: "ai", p_body: "Panels are 62 mm double wall." };
    expect(await refused("po_admin_save_extra", { p_token: e, ...note })).toMatch(/super user or an admin/);
    expect(await refused("po_admin_save_extra", { p_token: plain, ...note })).toMatch(/Edit access/);
    const a = await ok("po_admin_save_extra", { p_token: ta, ...note });
    const o = await ok("po_admin_save_extra", { p_token: e, ...note, p_kind: "option", p_body: "Marine coating" });
    expect((await ok("po_get_tree", { p_token: ta, p_factory_id: "ahu-riyadh" })).extras.map((x: any) => x.kind)).toEqual(["ai", "option"]);
    expect((await ok("po_get_tree", { p_token: su, p_factory_id: "ahu-riyadh" })).extras.map((x: any) => x.kind)).toEqual(["ai", "option"]);
    expect((await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-riyadh" })).extras.map((x: any) => x.kind)).toEqual(["option"]);
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-riyadh" })).extras.map((x: any) => x.kind)).toEqual(["option"]);
    // an editor can neither turn his option into an AI note, nor change or delete an AI note
    expect(await refused("po_admin_save_extra", { p_token: e, ...note, p_id: o.id })).toMatch(/super user or an admin/);
    expect(await refused("po_admin_save_extra", { p_token: e, ...note, p_id: a.id, p_kind: "note", p_body: "x" })).toMatch(/no longer exists/);
    expect(await refused("po_admin_delete_extra", { p_token: e, p_id: a.id })).toMatch(/super user or an admin/);
    await ok("po_admin_save_extra", { p_token: ta, ...note, p_id: a.id, p_body: "Panels are 62 mm." });
    expect(await ok("po_admin_delete_extra", { p_token: ta, p_id: a.id })).toMatchObject({ ok: true });
    expect((await ok("po_get_tree", { p_token: ta, p_factory_id: "ahu-riyadh" })).extras.map((x: any) => x.kind)).toEqual(["option"]);
  });

  it("groups (20 Oct 2026): the rows of one filter stay together, a value can sit in two groups, a set of sizes is saved as its sizes", async () => {
    expect(poPieces("2x(592x592x48) 2x(490x592x48) 1x(287x592x48)")).toEqual(["592x592x48", "490x592x48", "287x592x48"]);
    expect(poPieces("592x592x48")).toEqual(["592x592x48"]);
    expect(poPieces("2 x 50 mm")).toEqual(["2 x 50 mm"]);
    expect(poPieces("2x(Fan Array)")).toEqual(["2x(Fan Array)"]);
    expect(poPieces("3x(592 x 592 x 48)")).toEqual(["592x592x48"]);
    const t = await login("sbu");
    await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: [
      { key: "filter supply||filter class", section: "Filter Supply", sub: "", component: "Filter Class" },
      { key: "filter supply||dimensions", section: "Filter Supply", sub: "", component: "Dimensions" },
      { key: "filter supply||clean pressure drop", section: "Filter Supply", sub: "", component: "Clean Pressure Drop" }] });
    const G4 = "Filter Class: ISO Coarse 60%(G4)", F7 = "Filter Class: ePM1 65%(F7)";
    const items = [
      { factory: "Riyadh", key: "filter supply||filter class", value: "ISO Coarse 60%(G4)", model: "", grp: G4 },
      { factory: "Riyadh", key: "filter supply||dimensions", value: "2x(592x592x48) 2x(287x592x48)", model: "", grp: G4 },
      { factory: "Riyadh", key: "filter supply||clean pressure drop", value: "44 Pa", model: "", grp: G4 },
      { factory: "Riyadh", key: "filter supply||filter class", value: "ePM1 65%(F7)", model: "", grp: F7 },
      { factory: "Riyadh", key: "filter supply||dimensions", value: "2x(592x592x48)", model: "", grp: F7 },
      { factory: "Riyadh", key: "filter supply||clean pressure drop", value: "65 Pa", model: "", grp: F7 }];
    await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: items });
    // sizes and pressure drops are duty figures (0011); as options here, to check approval within groups
    await env.DB.prepare("UPDATE dn_map SET kind = 'option' WHERE product_id = 'ahu' AND row_key IN ('filter supply||dimensions', 'filter supply||clean pressure drop')").run();
    const ta = await login("teamAdmin");
    const w = await ok("po_get_tree", { p_token: ta, p_factory_id: "ahu-riyadh" });
    const dims = w.rows.find((r: any) => r.key === "filter supply||dimensions").values.map((v: any) => [v.g, v.v]);
    expect(dims).toEqual([[G4, "287x592x48"], [G4, "592x592x48"], [F7, "592x592x48"]]);   // groups in datasheet order: Filter 1 first
    expect(w.waiting).toBe(7);
    // approving the F7 size leaves the G4 one waiting
    await ok("po_admin_approve", { p_token: ta, p_factory_id: "ahu-riyadh", p_items: [{ key: "filter supply||dimensions", model: "", grp: F7, value_key: "592x592x48" }], p_approve: true });
    const plain = await login("sales");
    const u = await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-riyadh" });
    expect(u.rows.flatMap((r: any) => r.values.map((v: any) => [v.g, v.v]))).toEqual([[F7, "592x592x48"]]);
    await ok("po_admin_set_hidden", { p_token: ta, p_factory_id: "ahu-riyadh", p_row_key: "filter supply||dimensions", p_value_key: "592x592x48", p_model: "", p_grp: F7, p_hidden: true });
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-riyadh" })).rows).toEqual([]);
    // read again: each group counts its own
    await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: items });
    const n = (await env.DB.prepare("SELECT grp, value, times FROM po_values WHERE factory_id = 'ahu-riyadh' AND row_key = 'filter supply||dimensions' ORDER BY rowid").all<any>()).results;
    expect(n).toEqual([{ grp: G4, value: "592x592x48", times: 2 }, { grp: G4, value: "287x592x48", times: 2 }, { grp: F7, value: "592x592x48", times: 2 }]);
  });

  it("profiles (20 Oct 2026): EN 1886 classes per profile; a value approved before groups keeps its approval; old values without a group are removed by an admin", async () => {
    const t = await login("sbu");
    await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: [
      { key: "unit data||profile", section: "Unit Data", sub: "", component: "Profile" },
      { key: "mechanical characteristic (en1886)||casing strength", section: "Mechanical Characteristic (EN1886)", sub: "", component: "Casing Strength" },
      { key: "mechanical characteristic (en1886)||thermal transmit", section: "Mechanical Characteristic (EN1886)", sub: "", component: "Thermal Transmit" }] });
    // before groups: D1(M), T2(M), T3(M) without a group, approved
    await env.DB.batch(["D1(M)", "T2(M)", "T3(M)"].map((v) => env.DB.prepare("INSERT INTO po_values (factory_id, row_key, model, grp, value_key, value, times, approved, approved_by) VALUES ('ahu-riyadh', ?, '', '', ?, ?, 90, 1, ?)")
      .bind(v === "D1(M)" ? "mechanical characteristic (en1886)||casing strength" : "mechanical characteristic (en1886)||thermal transmit", v.toLowerCase(), v, USERS.teamAdmin.id)));
    const N = "Profile: Aluminium Natural", TB = "Profile: Aluminium Natural Thermal Break";
    const it = (key: string, value: string, grp: string) => ({ factory: "Riyadh", key, value, model: "", grp });
    await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: [
      it("unit data||profile", "Aluminium Natural", ""), it("mechanical characteristic (en1886)||casing strength", "D1(M)", N), it("mechanical characteristic (en1886)||thermal transmit", "T3(M)", N),
      it("unit data||profile", "Aluminium Natural Thermal Break", ""), it("mechanical characteristic (en1886)||casing strength", "D1(M)", TB), it("mechanical characteristic (en1886)||thermal transmit", "T2(M)", TB)] });
    const ta = await login("teamAdmin");
    const tree = await ok("po_get_tree", { p_token: ta, p_factory_id: "ahu-riyadh" });
    const tt = tree.rows.find((r: any) => r.key === "mechanical characteristic (en1886)||thermal transmit").values.map((v: any) => [v.g, v.v, v.wait]);
    expect(tt).toEqual([["", "T2(M)", false], ["", "T3(M)", false], [N, "T3(M)", false], [TB, "T2(M)", false]]);   // approved before: approved in its group
    expect(tree.rows.find((r: any) => r.key === "unit data||profile").values.every((v: any) => v.wait)).toBe(true);   // new values wait as always
    // the old values without a group: removed by an admin, section by section, only where the row has groups
    const e = await poEditor();
    expect(await refused("po_admin_clear_ungrouped", { p_token: e, p_factory_id: "ahu-riyadh", p_section: "Mechanical Characteristic (EN1886)" })).toMatch(/super user or an admin/);
    expect((await ok("po_admin_clear_ungrouped", { p_token: ta, p_factory_id: "ahu-riyadh", p_section: "mechanical characteristic (en1886)" })).removed).toBe(3);
    expect(await refused("po_admin_clear_ungrouped", { p_token: ta, p_factory_id: "ahu-riyadh", p_section: "Unit Data" })).toMatch(/Nothing to remove/);   // profile values have no group
    const after = (await ok("po_get_tree", { p_token: ta, p_factory_id: "ahu-riyadh" })).rows.find((r: any) => r.key === "mechanical characteristic (en1886)||casing strength").values.map((v: any) => v.g);
    expect(after).toEqual([N, TB]);
  });

  it("po_reset (21 Oct 2026): super user only; values of one factory or every factory; options, notes and AI notes only when asked", async () => {
    const put = (f: string, v: string) => env.DB.prepare("INSERT INTO po_values (factory_id, row_key, model, grp, value_key, value, times, approved) VALUES (?, 'unit data||panel', '', '', ?, ?, 1, 1)").bind(f, v.toLowerCase(), v);
    const extra = (f: string, kind: string) => env.DB.prepare("INSERT INTO po_extras (id, factory_id, section, row_key, kind, body) VALUES (?, ?, 'Unit data', '', ?, 'x')").bind(crypto.randomUUID(), f, kind);
    await env.DB.batch([put("ahu-riyadh", "62 mm"), put("ahu-riyadh", "50 mm"), put("ahu-dubai", "62 mm"), put("fcu-riyadh", "x"),
      extra("ahu-riyadh", "option"), extra("ahu-riyadh", "note"), extra("ahu-riyadh", "ai"), extra("ahu-dubai", "ai")]);
    const ta = await login("teamAdmin"), a = await login("admin");
    expect(await refused("po_reset", { p_token: ta, p_product_id: "ahu" })).toMatch(/super user/);
    expect(await refused("po_reset", { p_token: a, p_product_id: "ahu", p_factory_id: "fcu-riyadh" })).toMatch(/does not belong/);
    expect(await ok("po_reset", { p_token: a, p_product_id: "ahu", p_factory_id: "ahu-riyadh" })).toMatchObject({ values_removed: 2, extras_removed: 0, ai_removed: 0 });
    expect(await ok("po_reset", { p_token: a, p_product_id: "ahu", p_with_extras: true })).toMatchObject({ values_removed: 1, extras_removed: 2, ai_removed: 0 });
    expect(await ok("po_reset", { p_token: a, p_product_id: "ahu", p_with_ai: true })).toMatchObject({ values_removed: 0, extras_removed: 0, ai_removed: 2 });
    const left = await env.DB.prepare("SELECT count(*) AS n FROM po_values WHERE factory_id = 'fcu-riyadh'").first<any>();
    expect(left.n).toBe(1);   // other products untouched
  });

  it("approval: a value new to the factory waits; only the super user or a General admin approves or rejects it; users and the AI see approved values only", async () => {
    const t = await login("sbu");
    await mapping(t);
    await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }, { factory: "Dubai", key: "unit data||insulation", value: "Foam", model: "" }] });
    const plain = await login("sales");
    const pu = await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" });
    expect(pu.rows).toEqual([]);                                   // nothing approved yet: a user sees nothing
    expect(pu.waiting).toBe(0);
    const e = await poEditor();                                    // an editor sees what waits but cannot approve
    const pe = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" });
    expect(pe).toMatchObject({ can_approve: false, waiting: 2 });
    expect(pe.rows.flatMap((r: any) => r.values.map((v: any) => [v.v, v.wait]))).toEqual([["62 mm", true], ["Foam", true]]);
    // a row left out keeps its values for reference: not waiting, not counted, marked held; back in, it waits again
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "", p_row_keys: ["unit data||insulation"], p_value_key: "", p_hidden: true });
    const off = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" });
    expect(off.waiting).toBe(1);
    expect(off.rows.flatMap((r: any) => r.values.map((v: any) => [v.v, v.wait, v.held]))).toEqual([["62 mm", true, false], ["Foam", false, true]]);
    await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_key: "", p_row_keys: ["unit data||insulation"], p_value_key: "", p_hidden: false });
    expect((await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" })).waiting).toBe(2);
    const item = { key: "unit data||panel", model: "", value_key: "62 mm" };
    expect(await refused("po_admin_approve", { p_token: e, p_factory_id: "ahu-dubai", p_items: [item], p_approve: true })).toMatch(/super user or an admin/);
    expect(await refused("po_admin_approve", { p_token: plain, p_factory_id: "ahu-dubai", p_all: true, p_approve: true })).toMatch(/super user or an admin/);
    expect(await refused("po_admin_approve", { p_token: "nope", p_factory_id: "ahu-dubai", p_all: true, p_approve: true })).toBe("SESSION_EXPIRED");
    const ta = await login("teamAdmin");                           // admin of the General tile Product Options sits on
    expect((await ok("po_get_tree", { p_token: ta, p_factory_id: "ahu-dubai" })).can_approve).toBe(true);
    expect((await ok("po_admin_approve", { p_token: ta, p_factory_id: "ahu-dubai", p_items: [item], p_approve: true })).changed).toBe(1);
    expect(await refused("po_admin_approve", { p_token: ta, p_factory_id: "ahu-dubai", p_items: [item], p_approve: true })).toMatch(/Nothing waits/);
    expect((await ok("po_admin_approve", { p_token: ta, p_factory_id: "ahu-dubai", p_items: [{ key: "unit data||insulation", model: "", value_key: "foam" }], p_approve: false })).changed).toBe(1);
    const after = await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" });
    expect(after.rows.flatMap((r: any) => r.values.map((v: any) => v.v))).toEqual(["62 mm"]);
    // seen again: the approved value stays approved and counts once more; the rejected one waits again
    await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }, { factory: "Dubai", key: "unit data||insulation", value: "Foam", model: "" }] });
    const rows = (await env.DB.prepare("SELECT value, times, approved, approved_by FROM po_values WHERE factory_id = 'ahu-dubai' ORDER BY value").all<any>()).results;
    expect(rows).toEqual([{ value: "62 mm", times: 2, approved: 1, approved_by: USERS.teamAdmin.id }, { value: "Foam", times: 1, approved: 0, approved_by: null }]);
    const aud = await env.DB.prepare("SELECT action FROM app_audit WHERE action IN ('po_approve', 'po_reject') ORDER BY rowid").all<any>();
    expect(aud.results.map((x: any) => x.action)).toEqual(["po_approve", "po_reject"]);
  });

  it("po_admin_set_hidden: editors only; a row for every factory of the product, a value for one factory and model", async () => {
    const e = await poEditor();
    await mapping(e);
    await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }, { factory: "Riyadh", key: "unit data||panel", value: "62 mm", model: "" }] });
    await approveAll("ahu-dubai"); await approveAll("ahu-riyadh");
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

  it("po kinds in the tree (0011): duty figures for everyone, never waiting; project rows out; the editor's kind wins; validated", async () => {
    const e = await poEditor();
    await ok("dn_add_rows", { p_token: e, p_product_id: "ahu", p_rows: [...AHU_ROWS, { key: "unit data||location", section: "Unit data", sub: "", component: "Location" }] });
    await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [
      { factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }, { factory: "Dubai", key: "unit data||supply air flow", value: "1000 l/s", model: "" },
      { factory: "Dubai", key: "unit data||location", value: "ROMA URBE, Italy", model: "" }] });
    const plain = await login("sales");
    const pu = await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" });
    expect(pu.rows.map((r: any) => [r.key, r.kind, r.values.map((v: any) => [v.v, v.wait])])).toEqual([["unit data||supply air flow", "duty", [["1000 l/s", false]]]]);
    const pe = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" });
    expect(pe.waiting).toBe(1);                                    // the panel only: the air flow is a duty figure
    expect(pe.rows.map((r: any) => r.key)).not.toContain("unit data||location");
    const rules = (await ok("dn_get_rules", { p_token: plain, p_product_id: "ahu" })).rules;
    expect(rules.find((r: any) => r.key === "unit data||supply air flow")).toMatchObject({ kind: "", auto_kind: "duty" });
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_rules: [{ key: "unit data||supply air flow", section: "Unit data", component: "Supply air flow", kind: "maybe" }] })).toMatch(/unknown kind/);
    expect(await refused("dn_admin_save_rules", { p_token: plain, p_product_id: "ahu", p_rules: [{ key: "unit data||supply air flow", section: "Unit data", component: "Supply air flow", kind: "option" }] })).toMatch(/Edit access/);
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_rules: [{ key: "unit data||supply air flow", section: "Unit data", component: "Supply air flow", kind: "option" }, { key: "unit data||location", section: "Unit data", component: "Location", kind: "option" }] });
    const pe2 = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" });
    expect(pe2.waiting).toBe(3);
    expect(pe2.rows.find((r: any) => r.key === "unit data||supply air flow")).toMatchObject({ kind: "option", values: [{ wait: true, held: false }] });
    // a rule saved without kind keeps the stored one
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_rules: [{ key: "unit data||supply air flow", section: "Unit data", component: "Supply air flow" }] });
    expect((await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" })).rules.find((r: any) => r.key === "unit data||supply air flow").kind).toBe("option");
  });

  it("po_admin_clear_ungrouped with p_groups (21 Oct 2026): removes the groups of an older layout in that section; approvers only", async () => {
    const t = await login("sbu");
    await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: [{ key: "unit data||panel", section: "Unit Data", sub: "", component: "Panel" }, { key: "unit data||insulation", section: "Unit Data", sub: "", component: "Insulation" }] });
    const MB = "Model Box Ref.: Energy F2", OLD = "Location: ROMA URBE, Italy";
    await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: [
      { factory: "Dubai", key: "unit data||panel", value: "42 mm", model: "", grp: MB }, { factory: "Dubai", key: "unit data||panel", value: "42 mm", model: "", grp: OLD },
      { factory: "Dubai", key: "unit data||insulation", value: "Foam", model: "", grp: "" }] });
    expect(await refused("po_admin_clear_ungrouped", { p_token: t, p_factory_id: "ahu-dubai", p_section: "Unit Data", p_groups: [OLD] })).toMatch(/super user or an admin/);
    const ta = await login("teamAdmin");
    expect((await ok("po_admin_clear_ungrouped", { p_token: ta, p_factory_id: "ahu-dubai", p_section: "Unit Data", p_groups: [OLD] })).removed).toBe(1);
    const left = (await env.DB.prepare("SELECT row_key, grp FROM po_values WHERE factory_id = 'ahu-dubai' ORDER BY row_key").all<any>()).results;
    expect(left).toEqual([{ row_key: "unit data||insulation", grp: "" }, { row_key: "unit data||panel", grp: MB }]);   // a row without any group keeps its value
  });

  it("casing rows leaving their column (21 Oct 2026): an approved value keeps its approval in another group; p_drop removes exactly the old copies", async () => {
    const t = await login("sbu");
    await ok("dn_add_rows", { p_token: t, p_product_id: "ahu", p_rows: [{ key: "unit data||panel outer skin", section: "Unit Data", sub: "", component: "Panel Outer Skin" }, { key: "unit data||panel", section: "Unit Data", sub: "", component: "Panel" }] });
    const MB = "Model Box Ref.: Energy F2";
    await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel outer skin", value: "Precoated 0.7 mm", model: "", grp: MB }, { factory: "Dubai", key: "unit data||panel", value: "42 mm", model: "", grp: MB }] });
    const ta = await login("teamAdmin");
    await ok("po_admin_approve", { p_token: ta, p_factory_id: "ahu-dubai", p_all: true, p_approve: true });
    // read again: the skin is general now (no group), the panel stays in its column
    await ok("po_collect", { p_token: t, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel outer skin", value: "Precoated 0.7 mm", model: "", grp: "" }, { factory: "Dubai", key: "unit data||panel", value: "42 mm", model: "", grp: MB }] });
    const rows = (await env.DB.prepare("SELECT row_key, grp, approved FROM po_values WHERE factory_id = 'ahu-dubai' ORDER BY row_key, grp").all<any>()).results;
    expect(rows).toEqual([{ row_key: "unit data||panel", grp: MB, approved: 1 }, { row_key: "unit data||panel outer skin", grp: "", approved: 1 }, { row_key: "unit data||panel outer skin", grp: MB, approved: 1 }]);
    const drop = [{ key: "unit data||panel outer skin", grp: MB }];
    expect(await refused("po_admin_clear_ungrouped", { p_token: t, p_factory_id: "ahu-dubai", p_section: "Unit Data", p_drop: drop })).toMatch(/super user or an admin/);
    expect(await refused("po_admin_clear_ungrouped", { p_token: ta, p_factory_id: "ahu-dubai", p_section: "Unit Data", p_drop: [] })).toMatch(/Nothing to remove/);
    expect((await ok("po_admin_clear_ungrouped", { p_token: ta, p_factory_id: "ahu-dubai", p_section: "Unit Data", p_drop: drop })).removed).toBe(1);
    expect(await refused("po_admin_clear_ungrouped", { p_token: ta, p_factory_id: "ahu-dubai", p_section: "Unit Data", p_drop: drop })).toMatch(/Nothing to remove there any more/);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM po_values WHERE factory_id = 'ahu-dubai'").first<any>()).n).toBe(2);
  });

  it("po_admin_set_place (0012): editors move rows between General and the columns, for every factory; validated, audited", async () => {
    const e = await poEditor();
    await mapping(e);
    await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }] });
    const plain = await login("sales");
    const keys = ["unit data||panel", "unit data||insulation"];
    expect(await refused("po_admin_set_place", { p_token: plain, p_factory_id: "ahu-dubai", p_row_keys: keys, p_place: "general" })).toMatch(/Edit access/);
    expect(await refused("po_admin_set_place", { p_token: "nope", p_factory_id: "ahu-dubai", p_row_keys: keys, p_place: "general" })).toBe("SESSION_EXPIRED");
    expect(await refused("po_admin_set_place", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: keys, p_place: "sideways" })).toMatch(/general or per model/);
    expect(await refused("po_admin_set_place", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: [], p_place: "general" })).toMatch(/Tick the rows/);
    expect(await refused("po_admin_set_place", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: ["no||row"], p_place: "general" })).toMatch(/no longer exist/);
    expect((await ok("po_admin_set_place", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: keys, p_place: "model" })).changed).toBe(2);
    const t = await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-riyadh" });
    expect(t.rows).toEqual([]);                                  // no values in Riyadh; the place is the product's
    expect((await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" })).rows[0]).toMatchObject({ key: "unit data||panel", place: "model" });
    expect((await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" })).rules.find((r: any) => r.key === "unit data||insulation").place).toBe("model");
    await ok("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_rules: [{ key: "unit data||insulation", section: "Unit data", component: "Insulation", place: "" }] });
    expect((await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" })).rules.find((r: any) => r.key === "unit data||insulation").place).toBe("");
    expect(await refused("dn_admin_save_rules", { p_token: e, p_product_id: "ahu", p_rules: [{ key: "unit data||insulation", section: "Unit data", component: "Insulation", place: "x" }] })).toMatch(/unknown place/);
    const a = await env.DB.prepare("SELECT count(*) AS n FROM app_audit WHERE action = 'po_set_place'").first<any>();
    expect(a.n).toBe(1);
  });

  it("po_admin_set_place with a series (0014): an FCU row moves for that series only; '' brings it back; validated, audited", async () => {
    const e = await poEditor();
    await mapping(e, "fcu");
    const plain = await login("sales");
    const keys = ["unit data||panel"];
    const args = { p_token: e, p_factory_id: "fcu-shenzhen", p_row_keys: keys, p_place: "general", p_series: "FWWVA" };
    expect(await refused("po_admin_set_place", { ...args, p_token: plain })).toMatch(/Edit access/);
    expect(await refused("po_admin_set_place", { ...args, p_token: "nope" })).toBe("SESSION_EXPIRED");
    expect(await refused("po_admin_set_place", { ...args, p_row_keys: ["no||row"] })).toMatch(/no longer exist/);
    expect((await ok("po_admin_set_place", args)).changed).toBe(1);
    expect((await ok("po_admin_set_place", { ...args, p_series: "FWWTA", p_place: "model" })).changed).toBe(1);
    expect((await ok("po_admin_set_place", { ...args, p_place: "model" })).changed).toBe(1);        // a second move replaces the first
    const t = await ok("po_get_tree", { p_token: e, p_factory_id: "fcu-riyadh" });
    expect(t.series_place).toEqual([{ series: "FWWTA", key: "unit data||panel", place: "model" }, { series: "FWWVA", key: "unit data||panel", place: "model" }]);
    // the row's own place (every series) is not touched
    expect((await ok("dn_get_rules", { p_token: e, p_product_id: "fcu" })).rules.find((r: any) => r.key === "unit data||panel").place).toBe("");
    await ok("po_admin_set_place", { ...args, p_place: "" });
    expect((await ok("po_get_tree", { p_token: e, p_factory_id: "fcu-shenzhen" })).series_place).toEqual([{ series: "FWWTA", key: "unit data||panel", place: "model" }]);
    const a = await env.DB.prepare("SELECT count(*) AS n FROM app_audit WHERE action = 'po_set_place'").first<any>();
    expect(a.n).toBe(4);
  });

  it("po_admin_set_kind: editors move rows between the options and the duty figures, for every factory; validated, audited", async () => {
    const e = await poEditor();
    await mapping(e);
    await ok("po_collect", { p_token: e, p_product_id: "ahu", p_items: [{ factory: "Dubai", key: "unit data||panel", value: "62 mm", model: "" }] });
    const plain = await login("sales");
    const keys = ["unit data||panel"];
    expect(await refused("po_admin_set_kind", { p_token: plain, p_factory_id: "ahu-dubai", p_row_keys: keys, p_kind: "duty" })).toMatch(/Edit access/);
    expect(await refused("po_admin_set_kind", { p_token: "nope", p_factory_id: "ahu-dubai", p_row_keys: keys, p_kind: "duty" })).toBe("SESSION_EXPIRED");
    expect(await refused("po_admin_set_kind", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: keys, p_kind: "hide" })).toMatch(/option or duty/);
    expect(await refused("po_admin_set_kind", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: [], p_kind: "duty" })).toMatch(/Tick the rows/);
    expect(await refused("po_admin_set_kind", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: ["no||row"], p_kind: "duty" })).toMatch(/no longer exist/);
    const before = (await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" })).rows[0];
    expect(before).toMatchObject({ key: "unit data||panel", kind: "option", kind_set: "" });
    expect(before.values[0].wait).toBe(true);
    expect((await ok("po_admin_set_kind", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: keys, p_kind: "duty" })).changed).toBe(1);
    const after = (await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" })).rows[0];
    expect(after).toMatchObject({ kind: "duty", kind_set: "duty" });
    expect(after.values[0].wait).toBe(false);                  // a duty figure never waits for approval
    expect((await ok("dn_get_rules", { p_token: e, p_product_id: "ahu" })).rules.find((r: any) => r.key === "unit data||panel").kind).toBe("duty");
    await ok("po_admin_set_kind", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: keys, p_kind: "" });
    expect((await ok("po_get_tree", { p_token: e, p_factory_id: "ahu-dubai" })).rows[0]).toMatchObject({ kind: "option", kind_set: "" });
    const a = await env.DB.prepare("SELECT count(*) AS n FROM app_audit WHERE action = 'po_set_kind'").first<any>();
    expect(a.n).toBe(2);
  });

  it("makes (0012): admins of the tile keep the manufacturers of a section; everyone sees them; a reset with notes removes them", async () => {
    const e = await poEditor(), ta = await login("teamAdmin"), plain = await login("sales");
    expect(await refused("po_admin_save_extra", { p_token: e, p_factory_id: "ahu-dubai", p_section: "Fan Supply", p_row_key: "", p_kind: "make", p_body: "ebm-papst" })).toMatch(/keeps the makes/);
    expect(await refused("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_section: "Fan Supply", p_row_key: "", p_kind: "make", p_body: "x".repeat(121) })).toMatch(/up to 120/);
    const m = await ok("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_section: "Fan Supply", p_row_key: "", p_kind: "make", p_body: "ebm-papst" });
    await ok("po_admin_save_extra", { p_token: ta, p_factory_id: "ahu-dubai", p_section: "Fan Supply", p_row_key: "", p_kind: "make", p_body: "Nicotra Gebhardt" });
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" })).extras.filter((x: any) => x.kind === "make").map((x: any) => x.body)).toEqual(["ebm-papst", "Nicotra Gebhardt"]);
    expect(await refused("po_admin_save_extra", { p_token: e, p_factory_id: "ahu-dubai", p_id: m.id, p_section: "Fan Supply", p_row_key: "", p_kind: "make", p_body: "Ziehl" })).toMatch(/keeps the makes/);
    expect(await refused("po_admin_delete_extra", { p_token: e, p_id: m.id })).toMatch(/makes/);
    await ok("po_admin_delete_extra", { p_token: ta, p_id: m.id });
    const a = await login("admin");
    await ok("po_reset", { p_token: a, p_product_id: "ahu", p_with_extras: true });
    expect((await ok("po_get_tree", { p_token: plain, p_factory_id: "ahu-dubai" })).extras).toEqual([]);
  });

  it("po_admin_set_hidden with p_row_keys (21 Oct 2026): several rows left out or brought back at once; editors only; audited", async () => {
    const e = await poEditor();
    await mapping(e);
    const keys = ["unit data||panel", "unit data||insulation", "unit data||panel"];      // a repeated key counts once
    const plain = await login("sales");
    expect(await refused("po_admin_set_hidden", { p_token: plain, p_factory_id: "ahu-dubai", p_row_keys: keys, p_hidden: true })).toMatch(/Edit access/);
    expect(await refused("po_admin_set_hidden", { p_token: "nope", p_factory_id: "ahu-dubai", p_row_keys: keys, p_hidden: true })).toBe("SESSION_EXPIRED");
    expect(await refused("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: [], p_hidden: true })).toMatch(/Tick the rows/);
    expect(await refused("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: "unit data||panel", p_hidden: true })).toMatch(/could not be read/);
    expect(await refused("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: new Array(501).fill(0).map((_, i) => "k" + i), p_hidden: true })).toMatch(/up to 500/);
    expect(await refused("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: ["no||row"], p_hidden: true })).toMatch(/no longer exist/);
    expect((await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-dubai", p_row_keys: keys, p_hidden: true })).changed).toBe(2);
    const rules = (await ok("dn_get_rules", { p_token: plain, p_product_id: "ahu" })).rules;
    const inTree = (k: string) => rules.find((r: any) => r.key === k).in_tree;
    expect([inTree("unit data||panel"), inTree("unit data||insulation"), inTree("unit data||supply air flow")]).toEqual([false, false, true]);
    expect((await ok("po_admin_set_hidden", { p_token: e, p_factory_id: "ahu-riyadh", p_row_keys: ["unit data||panel"], p_hidden: false })).changed).toBe(1);
    const a = await env.DB.prepare("SELECT count(*) AS n FROM app_audit WHERE action IN ('po_rows_left_out', 'po_rows_back')").first<any>();
    expect(a.n).toBe(2);
  });
});
