/* The AHU rule book (template-ahu.ts): Facts the AI may cite, the AHU rules on the clauses of the Riyadh Metro AHU
   specification, and how Create / Update from template bring them in. Owner, 16 Oct 2026. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, login, resetLogins } from "./helpers";
import { seedTree, parseMap, type MapNode, type Seed } from "../../worker/src/ai/map";
import { pickRules, directRule } from "../../worker/src/ai/rules";
import { draftAnswer, NeedsSource } from "../../worker/src/ai/draft";

/* The template as the nodes of a map (a branch "to verify" is off). */
function nodesOf(seeds: Seed[]): MapNode[] {
  const out: MapNode[] = [{ id: "root", parent_id: null, title: "AI rules", notes: "", special: "[]", sort: 0, verified: 1 }];
  let n = 0;
  const add = (s: Seed, parent: string, sort: number) => {
    const id = "n" + n++;
    out.push({ id, parent_id: parent, title: s.title, notes: s.notes || "", special: JSON.stringify(s.special || []), sort, verified: s.off ? 0 : 1 });
    (s.kids || []).forEach((k, i) => add(k, id, i));
  };
  seeds.forEach((s, i) => add(s, "root", i));
  return out;
}
const ahu = parseMap(nodesOf(seedTree("AHU", null)), null);
const pick = (clause: string, section: string, part: number) => pickRules(ahu.rules, clause, section, part, 8);
const direct = (clause: string, section: string, part: number) => directRule(pick(clause, section, part).rules);

describe("The AHU rule book template", () => {
  it("has Facts and AHU rules for AHUs only; the Riyadh rule book gets the KSA defaults, to verify", () => {
    const facts = (tree: Seed[]) => tree.find((x) => x.title === "Facts")!.kids || [];
    expect(facts(seedTree("AHU", null)).map((f) => f.title)).toEqual(expect.arrayContaining(["Eurovent certification", "AHU datasheet", "Manuals", "Warranty period"]));
    expect(facts(seedTree("FCU", null))).toEqual([]);
    expect(seedTree("FCU", null).find((x) => x.title === "Part 2 Products")!.kids!.map((k) => k.title)).not.toContain("Fans");
    // every factory's rule book is the whole template (20 Oct 2026); Riyadh's also gets the KSA defaults, to verify
    const ksa = facts(seedTree("AHU", "Riyadh")).filter((f) => /\(Riyadh\)$/.test(f.title));
    expect(ksa.map((f) => f.title)).toEqual(["Panels (Riyadh)", "Filters (Riyadh)", "Fans (Riyadh)", "Controls (Riyadh)", "Filter bypass leakage (Riyadh)"]);
    expect(ksa.every((f) => f.off)).toBe(true);
    expect(facts(seedTree("AHU", "Riyadh")).map((f) => f.title)).toEqual(expect.arrayContaining(["Eurovent certification", "Warranty period"]));
    expect(facts(seedTree("AHU", "Dubai")).filter((f) => /\(/.test(f.title))).toEqual([]);
    expect(ahu.problems).toEqual([]);
  });

  it("reads Facts as facts; a fact to verify is not used; a fact without When is reported", () => {
    const factRules = ahu.rules.filter((r) => r.kind === "fact");
    expect(factRules.map((r) => r.title)).toEqual(["Eurovent certification", "AHU datasheet", "Manuals"]);     // the others come in to verify
    const bare = parseMap([
      { id: "root", parent_id: null, title: "AI rules", notes: "", special: "[]", sort: 0, verified: 1 },
      { id: "f", parent_id: "root", title: "Facts", notes: "", special: "[]", sort: 0, verified: 1 },
      { id: "f1", parent_id: "f", title: "Paint", notes: "Units are powder coated.", special: "[]", sort: 0, verified: 1 }], null);
    expect(bare.rules[0]).toMatchObject({ kind: "fact", title: "Paint" });
    expect(bare.problems.join(" ")).toMatch(/fact "Facts › Paint" has no When or Section/);
  });

  it("answers the scope clauses of the Riyadh Metro spec by itself, and leaves product clauses to the model", () => {
    expect(direct("Delegated Design: Design vibration isolation and seismic-restraint details, including comprehensive engineering analysis by a qualified professional engineer.", "PERFORMANCE REQUIREMENTS", 1)!.rule)
      .toMatchObject({ title: "Seismic and vibration isolation design", answer: "In Contractor's Scope" });
    expect(direct("Structural Performance: Casing panels shall be self-supporting and capable of withstanding 133 percent of internal static pressures indicated.", "PERFORMANCE REQUIREMENTS", 1)).toBeNull();
    expect(direct("Coordination Drawings, including floor plans and sections drawn to scale. Submit with Shop Drawings.", "SUBMITTALS", 1)!.rule.title).toBe("Contractor's documents");
    expect(direct("Unit shall be handled and stored in accordance with the manufacturer's instructions.", "DELIVERY, STORAGE, AND HANDLING", 1)!.rule.title).toBe("Storage and handling at site");
    expect(direct("Deliver air-handling unit as a factory-assembled module with protective crating and covering.", "DELIVERY, STORAGE, AND HANDLING", 1)).toBeNull();
    expect(direct("Damper operators are specified in Section \"Building Management System.\"", "DAMPERS", 2)!.rule.title).toBe("Controls specified elsewhere");
    expect(direct("Manually operate dampers from fully closed to fully open position and record fan performance.", "COMMISSIONING", 3)!.rule.title).toBe("Field tests and commissioning");
    expect(direct("Manufacturer's Field Inspection: Engage a factory-authorized service representative to perform the following:", "COMMISSIONING", 3)).toBeNull();
    expect(pick("Manufacturer's Field Inspection: Engage a factory-authorized service representative to perform the following:", "COMMISSIONING", 3).rules.map((h) => h.rule.title)).toContain("Manufacturer's service at site");
    expect(pick("Engage a factory-authorized service representative to train Employer's maintenance personnel.", "DEMONSTRATION", 3).rules.map((h) => h.rule.title)).toContain("Training and demonstration");
    // a product clause: the casing rule and the Eurovent fact, no fixed answer
    const casing = pick("Thermal Conductance (C): Maximum overall thermal conductance of casing panels shall not exceed 0.68 W/square meter. K.", "CABINET", 2);
    expect(casing.rules.map((h) => h.rule.title)).toContain("Casing and panels (EN 1886)");
    expect(casing.facts.map((h) => h.rule.title)).toContain("Eurovent certification");
    expect(directRule(casing.rules)).toBeNull();
    // belt parts with EC fans: the fan rules, which need Product Options or the datasheet to apply
    expect(pick("Belt Guards: Fabricate to OSHA/SMACNA requirements, 2.7 mm thick.", "FAN SECTION", 2).rules.map((h) => h.rule.title)).toEqual(expect.arrayContaining(["Belt drives and VFDs"]));
  });
});

describe("Facts and instructions in the source contract", () => {
  afterEach(() => { delete (env as any).AI; });
  const base = { clause: "Inside Casing: Galvanized steel, 1 mm.", sr: "3", part: 2, section: "CABINET", product: "AHU", factory: "Riyadh", similar: [], comments: "" };
  const casingRule = pick("Inside Casing: Galvanized steel, 1 mm.", "CABINET", 2).rules;

  function model(reply: Record<string, unknown>) {
    const calls: string[] = [];
    return { calls, ai: { async run(_m: string, input: any) { calls.push(String(input?.messages?.[1]?.content || "")); return { response: JSON.stringify(reply) }; } } };
  }

  it("a Part 2 clause with only instruction rules on file is not sent to the model", async () => {
    const m = model({ cites: ["R1"], reason: "Rule.", compliance: "Comply", remarks: "", confidence: "medium" });
    (env as any).AI = m.ai;
    expect(casingRule.length).toBeGreaterThan(0);
    await expect(draftAnswer(env as any, { ...base, rules: casingRule })).rejects.toThrow(/No fact on file for this clause: only instructions apply/);
    expect(m.calls).toHaveLength(0);
  });

  it("citing an instruction rule alone does not back Comply; citing a fact does", async () => {
    const fact = { rule: { id: "f1", product_id: "ahu", factory_id: null, kind: "fact" as const, title: "Inner skin", keywords: "inside casing", part: 0, instruction: "The inner skin is galvanised steel, 0.8 mm.", answer: "", remark: "", active: 1, sort: 0 }, score: 1, matched: ["inside casing"] };
    const r1 = model({ cites: ["R1"], reason: "Rule.", compliance: "Comply", remarks: "", confidence: "medium" });
    (env as any).AI = r1.ai;
    await expect(draftAnswer(env as any, { ...base, rules: casingRule, facts: [fact] })).rejects.toBeInstanceOf(NeedsSource);
    expect(r1.calls).toHaveLength(2);
    expect(r1.calls[1]).toMatch(/cites only instruction rules \(R1\), which are not facts about the product \(facts on file: F1\)/);
    (env as any).AI = model({ cites: ["F1", "R1"], reason: "Inner skin 0.8 mm galvanised, thinner than asked.", compliance: "Comply with Remarks", remarks: "Inner skin is galvanised steel, 0.8 mm.", confidence: "medium" }).ai;
    const d = await draftAnswer(env as any, { ...base, rules: casingRule, facts: [fact] });
    expect(d).toMatchObject({ compliance: "Comply with Remarks", remarks: "Inner skin is galvanised steel, 0.8 mm." });
    expect(d.reason).toMatch(/Used: fact "Inner skin"/);
  });
});

describe("Create and Update from template", () => {
  beforeEach(async () => { await resetLogins(); });

  it("an AHU rule book gets the AHU rules and facts; the Riyadh one gets the KSA facts to verify; nothing twice", async () => {
    const t = await login("teamAdmin");
    const made = await ok("ai_map_create", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai" });
    const titles = async (id: string, sql = "") => (await env.DB.prepare("SELECT title, verified FROM mp_nodes WHERE map_id = ? " + sql).bind(id).all<any>()).results;
    expect((await titles(made.id)).map((x: any) => x.title)).toEqual(expect.arrayContaining(["Facts", "Fans", "Submittals", "Eurovent certification", "Warranty period"]));
    expect((await titles(made.id, "AND title = 'Warranty period'"))[0].verified).toBe(0);
    expect((await ok("ai_map_upgrade", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai" })).added).toEqual([]);
    // an AHU rule book from before: no Facts, no AHU rules
    await env.DB.prepare("DELETE FROM mp_nodes WHERE map_id = ? AND (title IN ('Facts', 'Fans', 'Coils') OR parent_id IN (SELECT id FROM mp_nodes WHERE map_id = ? AND title = 'Facts'))").bind(made.id, made.id).run();
    const up = (await ok("ai_map_upgrade", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai" })).added;
    expect(up).toEqual(expect.arrayContaining(["Facts", "Fans (added under Part 2 Products)", "Coils (added under Part 2 Products)"]));
    expect((await ok("ai_map_upgrade", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-dubai" })).added).toEqual([]);
    // the Riyadh rule book
    const own = await ok("ai_map_create", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh" });
    const ksa = await titles(own.id, "AND title LIKE '%(Riyadh)'");
    expect(ksa.map((x: any) => x.title).sort()).toEqual(["Controls (Riyadh)", "Fans (Riyadh)", "Filter bypass leakage (Riyadh)", "Filters (Riyadh)", "Panels (Riyadh)"]);
    expect(ksa.every((x: any) => x.verified === 0)).toBe(true);
    // what the AI sees: the verified AHU facts, not the ones to verify
    const tried = await ok("ai_try", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_clause: "Casing air leakage shall be class L1 at -400 Pa to EN 1886.", p_section: "CABINET", p_part: 2 });
    expect(tried.facts.map((f: any) => f.title)).toEqual(["Eurovent certification"]);
    expect(tried.prompt.user).toMatch(/\[F1\] Eurovent certification: Daikin AHUs \(D-AHU\) are Eurovent certified/);
  });
});
