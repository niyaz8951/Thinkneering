/* A specification saved under the wrong product (owner, 22 Oct 2026): code reads which product the text is about and
   the server refuses to save an AHU spec as FCU (or any other wrong pair) until the person changes the product or
   confirms it. Pure check first, then the routes. */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, rpc, login, resetLogins, SPEC_LINES } from "./helpers";
import { detectProduct, productMismatch, productKey } from "../../worker/src/lib/product-detect";

const L = (rows: [string, string][]) => rows.map(([type, spec]) => ({ type, sr: "", spec }));
const AHU = L([["part", "SECTION 23 73 13 - MODULAR INDOOR CENTRAL-STATION AIR-HANDLING UNITS"], ["part", "PART 1 - GENERAL"],
  ["letter", "This section includes air-handling units with coils for indoor installation."],
  ["letter", "Casing air leakage shall be class L1 to EN 1886."], ["letter", "AHUs shall have plug fans with EC motors."],
  ["letter", "Chilled water coils shall be copper tubes with aluminium fins."], ["letter", "Each AHU shall be factory tested."]]);
const FCU = L([["part", "SECTION 23 82 19 - FAN COIL UNITS"], ["part", "PART 2 - PRODUCTS"],
  ["letter", "Fan coil units shall be horizontal concealed ducted type."], ["letter", "FCUs shall have EC motors and 3 speeds."],
  ["letter", "Provide a valve package with 2-way PICV and isolation valves."], ["letter", "Each fan coil shall have a washable filter."],
  ["letter", "Chilled water shall be supplied from the central plant."]]);
const CHILLER = L([["part", "SECTION 23 64 23 - SCROLL WATER CHILLERS"], ["part", "PART 2 - PRODUCTS"],
  ["letter", "Chillers shall be air cooled with scroll compressors."], ["letter", "Each chiller shall have two refrigerant circuits."],
  ["letter", "Evaporator shall be brazed plate type."], ["letter", "IPLV shall be not less than 4.5."]]);
const MIXED = L([["part", "SECTION 23 81 00 - HVAC EQUIPMENT"], ["letter", "Air handling units shall be double skin."], ["letter", "AHUs shall have EC fans."],
  ["letter", "Fan coil units shall be ducted."], ["letter", "FCUs shall have EC motors."], ["letter", "Each AHU and each fan coil unit shall be tested."]]);

describe("which product a specification is about", () => {
  it("names the product a spec is about, and stays quiet when several are covered or the text is short", () => {
    expect(detectProduct(AHU).key).toBe("AHU");
    expect(detectProduct(FCU).key).toBe("FCU");
    expect(detectProduct(CHILLER).key).toBe("CHILLER");
    expect(detectProduct(MIXED).key).toBe("");
    expect(detectProduct(L([["letter", "Units shall be painted."]])).key).toBe("");
    expect(detectProduct(SPEC_LINES as any).key).not.toBe("FCU");
  });

  it("a mismatch only when another product clearly dominates the chosen one", () => {
    expect(productMismatch("AHU", AHU)).toBeNull();
    expect(productMismatch("FCU", AHU)).toMatchObject({ detected: "AHU", chosen: "FCU" });
    expect(productMismatch("FCU", AHU)!.reason).toMatch(/^It reads as an air handling unit specification: it names "air handling unit" 2x, "AHU" 2x, "section 23 73 \/ 23 74" 1x; fan coil unit is never named\.$/);
    expect(productMismatch("Chiller", FCU)).toMatchObject({ detected: "FCU", chosen: "CHILLER" });
    expect(productMismatch("AHU", CHILLER)).toMatchObject({ detected: "CHILLER", chosen: "AHU" });
    // an FCU spec naming "chilled water" is not a chiller spec; a mixed spec is never refused
    expect(productMismatch("FCU", FCU)).toBeNull();
    expect(productMismatch("FCU", MIXED)).toBeNull();
    expect(productMismatch("AHU", MIXED)).toBeNull();
    // a product the owner adds later (no family) is not checked
    expect(productKey("VRF")).toBe("");
    expect(productMismatch("VRF", AHU)).toBeNull();
  });
});

describe("saving under the wrong product: routes", () => {
  beforeEach(async () => { await resetLogins(); });
  const runs = async () => (await env.DB.prepare("SELECT count(*) AS n FROM cm_runs").first<any>()).n;

  it("cm_save_run refuses an AHU spec under FCU with the product it looks like; saved once the person confirms (audited)", async () => {
    const t = await login("sales");
    const before = await runs();
    const r = await rpc("cm_save_run", { p_token: t, p_factory_id: "fcu-shenzhen", p_source: "text", p_file_name: "AHU spec", p_lines: AHU });
    expect(r).toMatchObject({ ok: false, code: "PRODUCT_MISMATCH", _status: 409 });
    expect(r.error).toMatch(/^This looks like an AHU specification, not FCU\..*Saved under FCU, its clauses would go into the FCU library/);
    expect(r.data).toMatchObject({ chosen: { id: "fcu", name: "FCU" }, detected: { id: "ahu", name: "AHU" } });
    expect(await runs()).toBe(before);                                          // nothing written
    // the right product saves without a question; the wrong one confirmed saves too, and the choice is audited
    await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-dubai", p_source: "text", p_file_name: "AHU spec", p_lines: AHU });
    const kept = await ok("cm_save_run", { p_token: t, p_factory_id: "fcu-shenzhen", p_source: "text", p_file_name: "AHU spec", p_lines: AHU, p_product_confirmed: true });
    expect(kept.run_id).toBeTruthy();
    expect(await runs()).toBe(before + 2);
    const a = await env.DB.prepare("SELECT action, after FROM app_audit WHERE action = 'cm_product_kept'").first<any>();
    expect(JSON.parse(a.after)).toMatchObject({ product: "FCU", looks_like: "AHU", what: "conversion" });
    // a chiller spec under AHU, an FCU spec under chiller
    expect((await rpc("cm_save_run", { p_token: t, p_factory_id: "ahu-riyadh", p_source: "text", p_lines: CHILLER })).code).toBe("PRODUCT_MISMATCH");
    const fc = await rpc("cm_save_run", { p_token: t, p_factory_id: "chiller-italy", p_source: "text", p_lines: FCU });
    expect(fc.data.detected).toMatchObject({ id: "fcu" });
    expect(fc.error).toMatch(/^This looks like an FCU specification, not Chiller\./);
    // the check never opens the route to someone signed out
    expect(await refused("cm_save_run", { p_token: "nope", p_factory_id: "fcu-shenzhen", p_lines: AHU, p_product_confirmed: true })).toBe("SESSION_EXPIRED");
  });

  it("cm_admin_import refuses a library file of another product until the editor confirms; non-editors stay refused", async () => {
    const t = await login("teamAdmin");
    const rows = FCU.map((l, i) => ({ ...l, compliance: l.type === "letter" ? "Comply" : "", remarks: "", ord: i }));
    const r = await rpc("cm_admin_import", { p_token: t, p_factory_id: "ahu-dubai", p_file_name: "fcu-library.xlsx", p_rows: rows });
    expect(r).toMatchObject({ code: "PRODUCT_MISMATCH", data: { detected: { id: "fcu" } } });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM cm_lines WHERE factory_id = 'ahu-dubai'").first<any>()).n).toBe(0);
    const done = await ok("cm_admin_import", { p_token: t, p_factory_id: "ahu-dubai", p_file_name: "fcu-library.xlsx", p_rows: rows, p_product_confirmed: true });
    expect(done.added).toBeGreaterThan(0);
    expect(await refused("cm_admin_import", { p_token: await login("sbu"), p_factory_id: "fcu-shenzhen", p_rows: rows, p_product_confirmed: true })).toMatch(/edit/i);
  });
});
