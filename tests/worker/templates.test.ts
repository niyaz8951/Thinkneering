/* FCU and Chiller templates (owner, 22 Oct 2026: "from template I can only make for AHU"): the vocabulary and the AI rule
   book of every product, made from its own template, read without problems, recognise typical clauses, and are kept up
   to date by Update from template. Routes: allowed for rules editors, refused for others. */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, refused, login, resetLogins } from "./helpers";
import { vocabSeed, parseVocab, identify, productKey } from "../../worker/src/ai/vocab";
import { VOCAB_OTHER_2026_10_21 } from "../../worker/src/ai/vocab-history";
import { seedTree, parseMap, type MapNode, type Seed } from "../../worker/src/ai/map";
import { pickRules, directRule } from "../../worker/src/ai/rules";

function nodesOf(seeds: Seed[]): MapNode[] {
  const out: MapNode[] = [{ id: "root", parent_id: null, title: "map", notes: "", special: "[]", sort: 0, verified: 1 }];
  let n = 0;
  const add = (s: Seed, parent: string, sort: number) => {
    const id = "n" + n++;
    out.push({ id, parent_id: parent, title: s.title, notes: s.notes || "", special: JSON.stringify(s.special || []), sort, verified: s.off ? 0 : 1 });
    (s.kids || []).forEach((k, i) => add(k, id, i));
  };
  seeds.forEach((s, i) => add(s, "root", i));
  return out;
}
const FCU = parseVocab(nodesOf(vocabSeed("FCU")));
const CHILLER = parseVocab(nodesOf(vocabSeed("Chiller")));
const asks = (v: typeof FCU, clause: string, section: string) => identify(v, clause, section).map((x) => x.type.title);

const FCU_CASES: [string, string, string][] = [
  ["Fan coil units shall be of the horizontal concealed ducted type.", "2.01 FAN COIL UNITS", "Unit type"],
  ["Fan motors shall be EC brushless DC type with 0-10 V stepless speed control.", "FAN AND MOTOR", "Motor type"],
  ["Motors shall be permanently lubricated with thermal overload protection, automatic reset.", "MOTORS", "Motor protection"],
  ["Cooling capacity shall be selected at medium fan speed.", "PERFORMANCE", "Selection speed"],
  ["Provide manual air vent and drain plug on each coil.", "COILS", "Air vent and drain"],
  ["Drain pan shall be stainless steel, double sloped and insulated underneath with closed cell insulation.", "DRAIN PAN", "Drain pan material"],
  ["Provide auxiliary drain pan under the valve package.", "VALVES", "Auxiliary drain pan"],
  ["Filters shall be washable nylon mesh, removable without tools.", "FILTERS", "Filter type"],
  ["Valve package: 2-way modulating PICV with thermoelectric actuator, PN16, isolation ball valves and Y strainer.", "VALVES AND CONTROLS", "Valve actuator"],
  ["Room thermostat shall have auto fan speed, occupancy and night setback functions.", "CONTROLS", "Control functions"],
  ["FCU shall communicate with the BMS via BACnet MS/TP.", "CONTROLS", "BMS protocol"],
  ["Sound pressure level shall not exceed NC 30 at 1.5 m.", "ACOUSTICS", "Sound level"],
  ["Provide flexible braided hoses for coil connections.", "VALVES", "Flexible hoses"],
  ["Electric heaters shall have manual reset thermal cut-outs and airflow switch.", "ELECTRIC HEATER", "Heater safety cut-outs"]
];
const CHILLER_CASES: [string, string, string][] = [
  ["Chillers shall be air cooled with scroll compressors.", "2.01 AIR COOLED CHILLERS", "Compressor type"],
  ["Chiller shall operate at 52 C design ambient.", "PERFORMANCE", "Design ambient"],
  ["Refrigerant shall be R-134a, with full operating charge.", "REFRIGERANT", "Refrigerant"],
  ["Each circuit shall have filter drier, sight glass and electronic expansion valve.", "REFRIGERANT CIRCUIT", "Expansion device"],
  ["Evaporator shall be shell and tube, insulated with 19 mm closed cell insulation, with anti-freeze heater.", "EVAPORATOR", "Evaporator type"],
  ["Evaporator shall be designed to ASME Section VIII, water side working pressure 10 bar.", "EVAPORATOR", "Pressure vessel code"],
  ["Provide factory mounted flow switch.", "EVAPORATOR", "Flow switch"],
  ["Condenser coils shall be epoxy coated with hail guards.", "CONDENSER", "Coil guards"],
  ["Condenser fans shall be EC type with IP55 motors.", "CONDENSER", "Condenser fan motor enclosure"],
  ["Compressors shall have crankcase heaters and suction and discharge service valves.", "COMPRESSORS", "Crankcase heater"],
  ["Controller shall have a touch screen display, alarm history and BACnet IP interface.", "CONTROLS", "Controller display"],
  ["Provide lead-lag sequencing of multiple chillers.", "CONTROLS", "Sequencing"],
  ["Main power panel shall include door interlocked main isolator and phase failure relay.", "ELECTRICAL", "Main isolator"],
  ["Starting current shall not exceed 400 A.", "ELECTRICAL", "Starting current"],
  ["Chillers shall be factory performance tested to AHRI 550/590, witnessed by the engineer.", "SOURCE QUALITY CONTROL", "Factory performance test"],
  ["Provide integrated hydronic kit with twin pumps and expansion vessel.", "HYDRONIC", "Expansion vessel"]
];

describe("FCU and Chiller vocabularies", () => {
  it("each product takes its own template, with its own standards", () => {
    expect([productKey("AHU"), productKey("Air Handling Units"), productKey("FCU"), productKey("Fan Coil Units"), productKey("Chiller"), productKey("Chillers"), productKey("VRF")]).toEqual(["AHU", "AHU", "FCU", "FCU", "CHILLER", "CHILLER", ""]);
    expect(FCU.problems).toEqual([]);
    expect(CHILLER.problems).toEqual([]);
    expect(FCU.types.length).toBeGreaterThan(60);
    expect(CHILLER.types.length).toBeGreaterThan(60);
    expect(FCU.components.map((c) => c.title)).toEqual(expect.arrayContaining(["Unit", "Fan and motor", "Coil", "Drain pan", "Valves and controls", "Electric heater"]));
    expect(CHILLER.components.map((c) => c.title)).toEqual(expect.arrayContaining(["Compressor", "Refrigerant", "Evaporator", "Condenser", "Electrical", "Hydronic kit"]));
    const fs = FCU.standards.map((s) => s.name), cs = CHILLER.standards.map((s) => s.name);
    expect(fs).toEqual(expect.arrayContaining(["AHRI 440", "EN 1397", "ISO 16890"]));
    expect(cs).toEqual(expect.arrayContaining(["AHRI 550/590", "ASHRAE 15", "EN 378", "ASME VIII", "PED"]));
    expect(fs).not.toContain("AHRI 550/590");
    expect(cs).not.toContain("EN 1886");
  });

  it.each(FCU_CASES)("FCU: %s", (clause, section, type) => { expect(asks(FCU, clause, section)).toContain(type); });
  it.each(CHILLER_CASES)("Chiller: %s", (clause, section, type) => { expect(asks(CHILLER, clause, section)).toContain(type); });
});

/* the rule book of a product: the rules for every product + the product's own */
function book(product: string) {
  const parsed = parseMap(nodesOf(seedTree(product, null)), null, "rule book");
  return { parsed, titles: parsed.rules.map((r) => r.title) };
}

describe("FCU and Chiller rule books", () => {
  it("read without problems; each gets its own rules, the AHU-only ones stay with the AHU", () => {
    const ahu = book("AHU"), fcu = book("FCU"), ch = book("Chiller");
    for (const b of [ahu, fcu, ch]) expect(b.parsed.problems).toEqual([]);
    expect(ahu.titles.length).toBe(37);
    expect(fcu.titles.length).toBeGreaterThan(30);
    expect(ch.titles.length).toBeGreaterThan(30);
    expect(ahu.titles).toContain("Belt drives and VFDs");
    expect(fcu.titles).not.toContain("Belt drives and VFDs");
    expect(ch.titles).not.toContain("Belt drives and VFDs");
    expect(fcu.titles).toEqual(expect.arrayContaining(["Valves and valve packages", "Thermostats and controls", "Drain pans and condensate", "Installation accessories by the contractor", "Reference list"]));
    expect(ch.titles).toEqual(expect.arrayContaining(["Compressors", "Refrigerant and circuits", "Evaporator", "Condenser coils and fans", "Electrical panel", "Hydronic kit and accessories", "Reference list"]));
    expect(fcu.titles).not.toContain("Casing and panels (EN 1886)");
    // rules state no figures: a figure in a cited rule would pass the number check into a remark
    for (const b of [fcu, ch]) for (const r of b.parsed.rules) expect(`${r.title}: ${r.instruction} ${r.remark}`).not.toMatch(/\b\d+(\.\d+)?\s*(mm|bar|kpa|pa|kw|°c|db|%|hours?|years?)\b/i);
  });

  it("scope clauses answer by themselves; product clauses go to the advice rules", () => {
    const fcu = book("FCU").parsed.rules, ch = book("Chiller").parsed.rules;
    const hang = directRule(pickRules(fcu, "Hanger rods and spring hangers shall be provided by the contractor.", "INSTALLATION", 3).rules);
    expect(hang?.rule).toMatchObject({ title: "Installation accessories by the contractor", answer: "In Contractor's Scope" });
    // a clause about the unit's own hanging brackets is not site work
    expect(directRule(pickRules(fcu, "Units shall be supplied with hanging brackets for threaded rods.", "ACCESSORIES", 3).rules)).toBeNull();
    const pipe = directRule(pickRules(ch, "Connect chilled water piping with thermometers and pressure gauges.", "INSTALLATION", 3).rules);
    expect(pipe?.rule).toMatchObject({ title: "Piping and accessories by the contractor", answer: "In Contractor's Scope" });
    expect(directRule(pickRules(ch, "Seismic restraint design shall be by a delegated engineer.", "QUALITY ASSURANCE", 1).rules)?.rule.title).toBe("Seismic and vibration isolation design");
    // a product clause: advice only, no answer by itself
    const comp = pickRules(ch, "Compressors shall be semi-hermetic screw type with star-delta starters.", "COMPRESSORS", 2).rules;
    expect(comp[0].rule.title).toBe("Compressors");
    expect(directRule(comp)).toBeNull();
    const valves = pickRules(fcu, "Each unit shall have a 2-way PICV with modulating actuator.", "VALVES", 2).rules;
    expect(valves[0].rule.title).toBe("Valves and valve packages");
  });
});

describe("FCU and Chiller templates: routes", () => {
  beforeEach(async () => { await resetLogins(); });

  it("a rules editor makes the FCU and Chiller vocabularies and rule books from their templates; others are refused", async () => {
    const t = await login("teamAdmin"), sales = await login("sales");
    const fv = await ok("ai_vocab_create", { p_token: t, p_product_id: "fcu" });
    const cv = await ok("ai_vocab_create", { p_token: t, p_product_id: "chiller" });
    expect(fv).toMatchObject({ name: "Vocabulary: FCU" });
    expect(fv.types).toBeGreaterThan(60);
    expect(cv.types).toBeGreaterThan(60);
    const fr = await ok("ai_map_create", { p_token: t, p_product_id: "fcu", p_factory_id: "fcu-shenzhen" });
    const cr = await ok("ai_map_create", { p_token: t, p_product_id: "chiller", p_factory_id: "chiller-jeddah" });
    const fg = await ok("ai_map_get", { p_token: t, p_product_id: "fcu", p_factory_id: "fcu-shenzhen" });
    expect(fg.own).toMatchObject({ id: fr.id, name: "AI rules: FCU Shenzhen" });
    expect(fg.own.rules).toBe(book("FCU").titles.length);
    expect(fg.problems).toEqual([]);
    expect(fg.vocab).toMatchObject({ id: fv.id, problems: [] });
    const cg = await ok("ai_map_get", { p_token: t, p_product_id: "chiller", p_factory_id: "chiller-jeddah" });
    expect(cg.own).toMatchObject({ id: cr.id, name: "AI rules: Chiller Jeddah" });
    expect(cg.own.rules).toBe(book("Chiller").titles.length);
    // try a chiller clause: the vocabulary and the rule book both answer
    const tried = await ok("ai_try", { p_token: t, p_product_id: "chiller", p_factory_id: "chiller-jeddah", p_clause: "Refrigerant shall be R-134a.", p_section: "REFRIGERANT", p_part: 2 });
    expect(tried.asks[0]).toMatchObject({ title: "Refrigerant", component: "Refrigerant" });
    expect(tried.rules.map((r: any) => r.title)).toContain("Refrigerant and circuits");
    // a user with "Can edit" but no admin rights cannot make either
    expect(await refused("ai_vocab_create", { p_token: sales, p_product_id: "fcu" })).toMatch(/Only an admin/);
    expect(await refused("ai_map_create", { p_token: sales, p_product_id: "chiller", p_factory_id: "chiller-italy" })).toMatch(/Only an admin/);
    expect(await refused("ai_vocab_create", { p_token: "nope", p_product_id: "fcu" })).toBe("SESSION_EXPIRED");
  });

  it("Update from template brings an FCU vocabulary of 21 Oct up to date: old wording updated, missing types and standards added, edits kept", async () => {
    const t = await login("teamAdmin");
    const v = await ok("ai_vocab_create", { p_token: t, p_product_id: "fcu" });
    expect((await ok("ai_vocab_upgrade", { p_token: t, p_product_id: "fcu" })).done).toEqual([]);
    const node = async (title: string) => (await env.DB.prepare("SELECT id, special FROM mp_nodes WHERE map_id = ? AND title = ?").bind(v.id, title).first<any>());
    // the 21 Oct template: Unit › Cooling capacity had fewer terms; Rows (Coil) was edited by a person; Condensate pump and
    // the standard AHRI 440 did not exist
    const was = VOCAB_OTHER_2026_10_21["FCU › Unit › Cooling capacity"];
    await env.DB.prepare("UPDATE mp_nodes SET special = ?, notes = ? WHERE id = ?").bind(JSON.stringify(was.special), was.notes, (await node("Cooling capacity")).id).run();
    await env.DB.prepare("UPDATE mp_nodes SET special = ? WHERE id = ?").bind(JSON.stringify(["Kind: value", "Terms: rows, coil depth", "Direction: must match"]), (await node("Rows")).id).run();
    await env.DB.prepare("DELETE FROM mp_nodes WHERE id = ?").bind((await node("Condensate pump")).id).run();
    await env.DB.prepare("DELETE FROM mp_nodes WHERE id = ?").bind((await node("AHRI 440")).id).run();
    const r = await ok("ai_vocab_upgrade", { p_token: t, p_product_id: "fcu" });
    expect(r.done).toEqual(expect.arrayContaining(["Standards › AHRI 440 (added)", "Unit › Cooling capacity (updated)", "Drain pan › Condensate pump (added)"]));
    expect(r.done.join(" ")).not.toMatch(/Rows/);
    expect(JSON.parse((await node("Rows")).special)).toEqual(["Kind: value", "Terms: rows, coil depth", "Direction: must match"]);
    expect(JSON.parse((await node("Cooling capacity")).special).join(" ")).toMatch(/total cooling capacity/);
    expect((await ok("ai_vocab_upgrade", { p_token: t, p_product_id: "fcu" })).done).toEqual([]);
  });

  it("Update from template gives an older FCU rule book the FCU rules", async () => {
    const t = await login("teamAdmin");
    const made = await ok("ai_map_create", { p_token: t, p_product_id: "fcu", p_factory_id: "fcu-riyadh" });
    // a rule book made before 22 Oct had only the rules for every product: take the FCU ones out
    for (const title of ["Valves and valve packages", "Coils", "Installation accessories by the contractor"])
      await env.DB.prepare("DELETE FROM mp_nodes WHERE map_id = ? AND title = ?").bind(made.id, title).run();
    const r = await ok("ai_map_upgrade", { p_token: t, p_product_id: "fcu", p_factory_id: "fcu-riyadh" });
    expect(r.added).toEqual(expect.arrayContaining(["Valves and valve packages (added under Part 2 Products)", "Coils (added under Part 2 Products)", "Installation accessories by the contractor (added under Part 3 Execution)"]));
    expect(await refused("ai_map_upgrade", { p_token: await login("sales"), p_product_id: "fcu", p_factory_id: "fcu-riyadh" })).toMatch(/Only an admin/);
  });
});
