/* The vocabulary (ai/vocab.ts, owner 20 Oct 2026): the AHU template recognises what typical specification clauses ask,
   by landmarks, with the level asked. */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins } from "./helpers";
import { vocabSeed, parseVocab, identify } from "../../worker/src/ai/vocab";
import type { MapNode, Seed } from "../../worker/src/ai/map";

function nodesOf(seeds: Seed[]): MapNode[] {
  const out: MapNode[] = [{ id: "root", parent_id: null, title: "Vocabulary: AHU", notes: "", special: "[]", sort: 0, verified: 1 }];
  let n = 0;
  const add = (s: Seed, parent: string, sort: number) => {
    const id = "n" + n++;
    out.push({ id, parent_id: parent, title: s.title, notes: s.notes || "", special: JSON.stringify(s.special || []), sort, verified: s.off ? 0 : 1 });
    (s.kids || []).forEach((k, i) => add(k, id, i));
  };
  seeds.forEach((s, i) => add(s, "root", i));
  return out;
}
const AHU = parseVocab(nodesOf(vocabSeed("AHU")));
const top = (clause: string, section = "") => identify(AHU, clause, section)[0];

// clause, section, expected type (first; "~" = among the types recognised: the clause asks several things), what is
// asked, another type the clause also asks
const CASES: [string, string, string, string, string?][] = [
  ["Casing shall be double skin construction with 50 mm thick panels and thermal break profiles.", "2.01 CASING", "Panel thickness", "50 mm"],
  ["Casing air leakage shall be class L1 at minus 400 Pa in accordance with EN 1886.", "2.01 CASING", "Casing air leakage class (EN 1886)", "L1 or better"],
  ["Thermal bridging factor class TB2 in accordance with EN 1886.", "CASING", "Thermal bridging class (EN 1886)", "TB2 or better"],
  ["Casing deflection shall be class D2 or better to EN 1886.", "CASING", "Casing strength class (EN 1886)", "D2 or better"],
  ["Inner skin: galvanized steel sheet, 0.9 mm thick.", "UNIT CASINGS", "Skin thickness", "0.9 mm", "Inner skin"],
  ["Panels shall be insulated with 50 mm injected polyurethane foam of density not less than 40 kg/m3.", "2.01 CASING", "~Insulation density", "at least 40 kg/m3", "Insulation thickness"],
  ["Insulation shall have a flame spread index not exceeding 25 and smoke developed index not exceeding 50 when tested to ASTM E84.", "INSULATION", "Insulation fire rating", ""],
  ["Panels shall withstand 1000 hours salt spray test to ASTM B117.", "CASING", "Corrosion resistance", "1000 hours"],
  ["Access doors shall be hinged with quick release handles operable from both sides and a viewing window.", "ACCESS DOORS", "Door handles and latches", ""],
  ["Pre filters shall be ISO Coarse 60% (G4), panel type, 50 mm deep.", "2.04 FILTERS", "Pre-filter class", "G4 or better"],
  ["Final filters shall be ePM1 70% to ISO 16890, bag type.", "2.04 FILTERS", "Filter efficiency (ISO 16890)", "70%"],
  ["Final filters shall be MERV 14 bag filters.", "FILTERS", "Final filter class", "F8 or better (MERV 14)"],
  ["Provide a differential pressure gauge across every filter bank.", "2.04 FILTERS", "Filter pressure gauge", "provided"],
  ["Filter face velocity shall not exceed 2.5 m/s.", "FILTERS", "Filter face velocity", "at most 2.5 m/s"],
  ["Fans shall be plug type with backward curved blades, directly driven by EC motors.", "2.02 FANS", "Fan type", ""],
  ["Fan motors shall be premium efficiency class IE4 or better.", "2.02 FANS", "Motor efficiency class", "IE4 or better"],
  ["Each fan shall be statically and dynamically balanced to grade G2.5 to ISO 1940.", "2.02 FANS", "Balancing grade", "G2.5 or better"],
  ["Fan bearings shall have an L10 life of not less than 100,000 hours.", "FANS", "Bearing life", "at least 100,000 hours"],
  ["Fan and motor assembly shall be mounted on spring isolators.", "2.02 FANS", "Vibration isolation", "provided"],
  ["Cooling coils shall be copper tubes with aluminium fins, maximum face velocity 2.5 m/s.", "2.03 COILS", "Coil face velocity", "at most 2.5 m/s"],
  ["Coil fin spacing shall not be less than 2.1 mm.", "2.03 COILS", "Fin spacing", "at least 2.1 mm"],
  ["Coils shall be pressure tested at 21 bar and suitable for a working pressure of 16 bar.", "2.03 COILS", "Coil working and test pressure", ""],
  ["Coils shall be rated in accordance with AHRI Standard 410.", "1.03 QUALITY ASSURANCE", "Coil rating", ""],
  ["Drain pans shall be stainless steel grade 304, double sloped to the drain connection.", "2.03 COILS", "Drain pan material", ""],
  ["Provide a thermal wheel with sensible efficiency not less than 75% at balanced airflow.", "2.05 HEAT RECOVERY", "Heat recovery efficiency", "at least 75%"],
  ["Thermal wheel shall have a purge sector and a variable speed drive.", "2.05 HEAT RECOVERY", "~Purge sector", "provided", "Wheel drive"],
  ["Units shall be supplied with factory fitted controls and a BACnet IP interface.", "2.06 CONTROLS", "~Factory-fitted controls", "provided", "BMS protocol"],
  ["Dampers shall have leakage to EN 1751 class 2 with aluminium blades.", "DAMPERS", "Damper leakage class", "class 2 or better", "Damper blades"],
  ["Units shall be certified by Eurovent for mechanical performance of the casing.", "1.03 QUALITY ASSURANCE", "Certification", ""],
  ["Electrical power supply shall be 380 V, 3 phase, 60 Hz.", "ELECTRICAL", "Power supply", ""],
  ["External static pressure shall be 500 Pa.", "PERFORMANCE", "External static pressure", "500 Pa"],
  ["Variable Frequency Controllers: NEMA ICS 2, IGBT, PWM, VFC.", "FAN SECTION", "Drive provided", "provided"]
];

describe("vocabulary: the AHU template", () => {
  it("reads without problems: components, types, standards", () => {
    expect(AHU.problems).toEqual([]);
    expect(AHU.types.length).toBeGreaterThan(90);
    expect(AHU.components.map((c) => c.title)).toEqual(expect.arrayContaining(["Casing", "Filters", "Fans", "Coils", "Heat recovery"]));
    expect(AHU.standards.map((s) => s.name)).toEqual(expect.arrayContaining(["EN 1886", "ISO 16890", "AHRI 410"]));
    expect(parseVocab(nodesOf(vocabSeed("FCU"))).problems).toEqual([]);
    expect(parseVocab(nodesOf(vocabSeed("Chiller"))).problems).toEqual([]);
  });

  it("recognises what typical clauses ask, with the level asked", () => {
    const wrong: string[] = [];
    for (const [clause, section, want, asked, also] of CASES) {
      const all = identify(AHU, clause, section, 5), type = want.replace(/^~/, "");
      const x = want.startsWith("~") ? all.find((y) => y.type.title === type) : all[0];
      if (!x || x.type.title !== type) { wrong.push(`${clause} -> ${all.map((y) => y.type.title).join(" / ") || "nothing"} (expected ${want})`); continue; }
      if (also && !all.some((y) => y.type.title === also)) wrong.push(`${clause} -> ${all.map((y) => y.type.title).join(" / ")} (expected also ${also})`);
      if (asked && x.asked.toLowerCase().replace(/\s+/g, " ") !== asked.toLowerCase()) wrong.push(`${clause} -> asked "${x.asked}" (expected "${asked}")`);
    }
    expect(wrong).toEqual([]);
  });

  it("several asks in one clause; a short class alone is weak; Not words push a type away; a clause with no landmark is not recognised", () => {
    const both = identify(AHU, "Casing air leakage class L2 and casing strength class D2 to EN 1886.", "CASING").map((x) => x.type.title);
    expect(both.slice(0, 2).sort()).toEqual(["Casing air leakage class (EN 1886)", "Casing strength class (EN 1886)"]);
    expect(identify(AHU, "Install the unit level and plumb.", "INSTALLATION")).toEqual([]);
    expect(top("Control panel shall be IP55.", "CONTROLS").type.title).toBe("Control panel protection");
    expect(identify(AHU, "Submit the warranty certificate.", "SUBMITTALS")[0]?.type.title).toBe("Warranty period");
  });
});

describe("vocabulary: links and template routes", () => {
  beforeEach(async () => { await resetLogins(); });

  it("one vocabulary per product: created from the template, linked, read by Try a clause; admins only; the map's kind is checked", async () => {
    const t = await login("teamAdmin");
    expect(await refused("ai_vocab_create", { p_token: await login("sales"), p_product_id: "ahu" })).toMatch(/Only an admin/);
    const v = await ok("ai_vocab_create", { p_token: t, p_product_id: "ahu" });
    expect(v.name).toBe("Vocabulary: AHU");
    expect(v.types).toBeGreaterThan(90);
    expect((await ok("mp_list", { p_token: t })).maps.find((m: any) => m.id === v.id).kind).toBe("vocabulary");
    const got = await ok("ai_map_get", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" });
    expect(got.vocab).toMatchObject({ id: v.id, name: "Vocabulary: AHU", problems: [] });
    expect(got.vocab.types).toBeGreaterThan(90);
    // the same vocabulary for every factory of the product
    expect((await ok("ai_map_get", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai" })).vocab.id).toBe(v.id);
    const tried = await ok("ai_try", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai", p_clause: "Casing air leakage shall be class L2 at -400 Pa to EN 1886.", p_section: "CASING", p_part: 2 });
    expect(tried.asks[0]).toMatchObject({ title: "Casing air leakage class (EN 1886)", component: "Casing", asked: "L2 or better", rows: ["mechanical characteristic (en1886)||casing leakage"] });
    expect(tried.steps[0].step).toBe("What the clause asks (vocabulary)");
    // a rule book cannot be the vocabulary, a vocabulary cannot be a rule book; one product's vocabulary is not another's
    const rb = await ok("ai_map_create", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" });
    expect(await refused("ai_vocab_link", { p_token: t, p_product_id: "ahu", p_map_id: rb.id })).toMatch(/not a vocabulary/);
    expect(await refused("ai_map_link", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_map_id: v.id })).toMatch(/is a vocabulary/);
    expect(await refused("ai_vocab_link", { p_token: t, p_product_id: "fcu", p_map_id: v.id })).toMatch(/already the vocabulary of AHU/);
    // made in Maps as a vocabulary: it starts with the guide and the standards
    const mine = await ok("mp_create", { p_token: t, p_name: "FCU words", p_kind: "vocabulary" });
    await ok("ai_vocab_link", { p_token: t, p_product_id: "fcu", p_map_id: mine.id });
    expect((await ok("ai_map_get", { p_token: t, p_product_id: "fcu", p_factory_id: "fcu-shenzhen" })).vocab).toMatchObject({ id: mine.id, types: 0 });
    // changing its type in Maps takes it off
    await ok("mp_map_save", { p_token: t, p_map_id: mine.id, p_kind: "knowledge" });
    expect((await ok("ai_map_get", { p_token: t, p_product_id: "fcu", p_factory_id: "fcu-shenzhen" })).vocab).toBeNull();
    await ok("ai_vocab_link", { p_token: t, p_product_id: "ahu", p_map_id: null });
    expect((await ok("ai_map_get", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" })).vocab).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM app_audit WHERE action IN ('ai_vocab_create', 'ai_vocab_link')").first<any>()).toMatchObject({ n: 3 });
  });
});
