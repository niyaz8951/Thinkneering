/* The fixes from the Riyadh Metro AHU trace (docs/Compliance-AI-Walkthrough.md, gaps G1-G13) and the contract that
   keeps the AI to its sources: every source has an id, answers about the product must cite one, corrections people
   made are shown on similar clauses. Pure parts first, then the routes. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { ok, login, resetLogins } from "./helpers";
import { measurements } from "../../worker/src/ai/guard";
import { requirements, operatorOf, compareDatasheet, subjectOf, type SheetHit } from "../../worker/src/ai/evidence";
import { parentOf, ruleHit, type AiRule } from "../../worker/src/ai/rules";
import { parseMap, type MapNode } from "../../worker/src/ai/map";
import { draftAnswer, userPrompt, evidenceOf, NeedsSource } from "../../worker/src/ai/draft";

const rule = (o: Partial<AiRule>): AiRule => ({ id: o.id || "r" + Math.random(), product_id: "ahu", factory_id: null, kind: "rule", title: "", keywords: "", part: 0,
  instruction: "", answer: "", remark: "", active: 1, sort: 0, ...o });

function model(replies: (string | Record<string, unknown>)[]) {
  const calls: string[] = [];
  let i = 0;
  const ai = { async run(_m: string, input: any) {
    calls.push(String(input?.messages?.[1]?.content || ""));
    const r = replies[Math.min(i++, replies.length - 1)];
    return { response: typeof r === "string" ? r : JSON.stringify(r), usage: { prompt_tokens: 10, completion_tokens: 5 } };
  } };
  return { ai, calls };
}

describe("G1: limit wording", () => {
  it("reads negative maximums as maximums and 'not less than' as a minimum", () => {
    const op = (t: string) => requirements(t)[0].op;
    expect(op("Screw spacing shall not be greater than 229 mm (nine inches).")).toBe("<=");
    expect(op("pressure drop not more than 250 Pa")).toBe("<=");
    expect(op("no more than 250 Pa")).toBe("<=");
    expect(op("not greater than 250 Pa")).toBe("<=");
    expect(op("Coil face area velocity is not to exceed 2.5 meters per second")).toBe("<=");
    expect(op("shall not exceed 2 percent of air quantity")).toBe("<=");
    expect(op("Doors shall be a maximum of 1850 mm")).toBe("<=");
    expect(op("not less than 40 kg/m3")).toBe(">=");
    expect(op("a minimum of 600 mm (24 inches) wide")).toBe(">=");
    expect(op("at least 43 mm (1.7 inches)")).toBe(">=");
    expect(op("Thickness: 50 mm.")).toBe("=");
    expect(operatorOf("", " or more")).toBe(">=");
  });

  it("a figure in brackets after another is the same requirement, not a second one", () => {
    expect(requirements("minimum 152 mm (6 inch) high 3.5 mm (10 gauge) steel base rails").map((r) => r.m.raw)).toEqual(["152 mm", "3.5 mm"]);
  });

  it("a value above a 'not more than' limit is Not Comply, not Comply", () => {
    const hit: SheetHit = { key: "coil||pd", section: "Coil", component: "Pressure drop", label: "Coil • Pressure drop", cells: ["300 Pa"], value: "300 Pa", entries: [["pressure", "drop"]] };
    expect(compareDatasheet("Air pressure drop not more than 250 Pa.", [hit], ["AHU-01"])!.compliance).toBe("Not Comply");
    const v: SheetHit = { key: "coil||fv", section: "Coil", component: "Face velocity", label: "Coil • Face velocity", cells: ["2.4 m/s"], value: "2.4 m/s", entries: [["face", "velocity"]] };
    expect(compareDatasheet("Coil face area velocity is not to exceed 2.5 meters per second.", [v], ["AHU-01"])!.compliance).toBe("Comply");
  });
});

describe("G4: units written in words", () => {
  it("reads the units of the Riyadh Metro spec", () => {
    const u = (t: string) => measurements(t).map((m) => `${m.n} ${m.unit}`);
    expect(u("2.5 meters per second")).toEqual(["2.5 m/s"]);
    expect(u("2 percent of air quantity")).toEqual(["2 %"]);
    expect(u("0.035 inches")).toEqual(["0.035 in"]);
    expect(u("1000-Pa (4-inch wg)")).toEqual(["1000 pa", "4 in.wg"]);
    expect(u("10-m/s (2000-fpm)")).toEqual(["10 m/s", "2000 fpm"]);
    expect(u("0.68 W/square meter. K")).toEqual(["0.68 w/m2k"]);
    expect(u("44 kg/cubic meter minimum")).toEqual(["44 kg/m3"]);
    expect(u("488 kg/square meter")).toEqual(["488 kg/m2"]);
    expect(u("ANSI/AHRI 430, Section 237313, IEC 60034")).toEqual([]);
  });
});

describe("G2: the parent clause", () => {
  it("is found with labels as the record stores them (no full stop)", () => {
    const rows = [{ seq: 1, type: "letter", sr: "H", spec: "Insulation: CFC free polyurethane insulation." }, { seq: 2, type: "number", sr: "2", spec: "Thickness: 50 mm." },
      { seq: 3, type: "letter", sr: "a", spec: "Rated Bearing Life: L-50 of 200,000 hours." }];
    expect(parentOf(rows, 2)).toBe("Insulation: CFC free polyurethane insulation.");
    expect(parentOf(rows, 3)).toBe("Thickness: 50 mm.");
    expect(parentOf(rows.map((r) => ({ ...r, sr: r.sr + "." })), 2)).toBe("Insulation: CFC free polyurethane insulation.");
    expect(subjectOf("Insulation: CFC free polyurethane insulation.")).toBe("Insulation");
  });

  it("lets a list item reach its datasheet row through the parent's subject", () => {
    const ins: SheetHit = { key: "unit data||insulation", section: "Unit Data", component: "Insulation", label: "Unit Data • Insulation", cells: ["62 mm"], value: "62 mm", entries: [["insulation"]] };
    expect(compareDatasheet("Thickness: 50 mm.", [ins], ["AHU-01"])).toBeNull();
    expect(compareDatasheet("Thickness: 50 mm.", [ins], ["AHU-01"], "Insulation")!.compliance).toBe("Comply with Remarks");
  });
});

describe("G3: rules that must stay off a clause", () => {
  it("Unless keeps a rule off", () => {
    const scope = rule({ title: "Scope statements", sections: "summary", unless: "shall, provide, select, standards", answer: "Noted", remark: "Noted.", part: 1 });
    expect(ruleHit(scope, "This Section includes constant or variable-volume air-handling units.", "SUMMARY", 1)).not.toBeNull();
    expect(ruleHit(scope, "Provide fans and motors capable of stable operation at design conditions.", "SUMMARY", 1)).toBeNull();
    expect(ruleHit(scope, "Operating Limits: AMCA 99 or equivalent relevant BS/EN standards.", "SUMMARY", 1)).toBeNull();
  });

  it("a map's Unless is read and passes to the branches under it", () => {
    const nodes: MapNode[] = [
      { id: "root", parent_id: null, title: "AI rules", notes: "", special: "[]", sort: 0, verified: 1 },
      { id: "p3", parent_id: "root", title: "Part 3 Execution", notes: "", special: JSON.stringify(["Unless: factory installed"]), sort: 1, verified: 1 },
      { id: "sw", parent_id: "p3", title: "Site works", notes: "", special: JSON.stringify(["When: install", "Unless: training", "Answer: In Contractor's Scope", "Remark: By others."]), sort: 0, verified: 1 }
    ];
    const got = parseMap(nodes, null);
    expect(got.problems).toEqual([]);
    expect(got.rules.find((r) => r.title === "Site works")!.unless).toBe("factory installed, training");
  });
});

describe("The source contract", () => {
  afterEach(() => { delete (env as any).AI; });
  const base = { clause: "Fans shall be plug type, directly driven by EC motors.", sr: "A", part: 2, section: "FANS", product: "AHU", factory: "Riyadh", similar: [], comments: "" };
  const opts = ["Seen on datasheets: Fan Supply • Fan type: EC plug fan | Belt-driven DIDW"];

  it("every source in the prompt carries an id", () => {
    const d = { ...base, options: opts, notes: ["Fans are ebm-papst EC plug fans."], datasheet: [{ label: "Fan Supply • Fan type", value: "EC plug fan", key: "k" }] };
    expect(evidenceOf(d).map((e) => e.id)).toEqual(["D1", "O1", "N1"]);
    const u = userPrompt(d);
    expect(u).toMatch(/\[D1\] Fan Supply • Fan type: EC plug fan/);
    expect(u).toMatch(/\[O1\] Seen on datasheets/);
    expect(u).toMatch(/\[N1\] Fans are ebm-papst/);
  });

  it("a Part 2 clause with nothing on file is not sent to the model", async () => {
    const m = model([{ compliance: "Comply", remarks: "", reason: "r", confidence: "low", cites: [] }]);
    (env as any).AI = m.ai;
    await expect(draftAnswer(env, base)).rejects.toBeInstanceOf(NeedsSource);
    expect(m.calls).toHaveLength(0);
  });

  it("an answer that cites no source is asked once more, then left for a person", async () => {
    const m = model([{ compliance: "Comply", remarks: "", reason: "Standard.", confidence: "medium", cites: [] }, { compliance: "Comply", remarks: "", reason: "Standard.", confidence: "medium", cites: ["X9"] }]);
    (env as any).AI = m.ai;
    await expect(draftAnswer(env, { ...base, options: opts })).rejects.toThrow(/No source supports an answer/);
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]).toMatch(/"Comply" cites no source id from the message \(O1\)/);
  });

  it("the model may decline: the clause goes to a person at once", async () => {
    const m = model([{ compliance: "", remarks: "", reason: "Nothing says what the fan type is.", confidence: "low", cites: [] }]);
    (env as any).AI = m.ai;
    await expect(draftAnswer(env, { ...base, options: opts })).rejects.toThrow(/Nothing says what the fan type is/);
    expect(m.calls).toHaveLength(1);
  });

  it("a cited answer is drafted, and names what it used", async () => {
    (env as any).AI = model([{ compliance: "Comply", remarks: "EC plug fans.", reason: "Product Options show EC plug fans.", confidence: "high", cites: ["O1"] }]).ai;
    const d = await draftAnswer(env, { ...base, options: opts });
    expect(d).toMatchObject({ compliance: "Comply", remarks: "EC plug fans.", confidence: "medium" });      // Product Options alone do not make it high
    expect(d.reason).toMatch(/Used: Product Options\./);
    expect(d.sources).toEqual([expect.objectContaining({ kind: "options" })]);
  });

  it("a figure must come from a source it cites", async () => {
    (env as any).AI = model([{ compliance: "Comply with Remarks", remarks: "62 mm panels, 45 kg/m3 foam.", reason: "Datasheet.", confidence: "high", cites: ["D1"] }]).ai;
    const d = await draftAnswer(env, { ...base, clause: "Panels shall be 50 mm.", section: "CASING",
      datasheet: [{ label: "Unit Data • Panel", value: "62 mm", key: "p" }], notes: ["Foam density 45 kg/m3."] });
    expect(d.remarks).toBe("62 mm panels, [value] foam.");                       // 45 kg/m3 is in a note it did not cite
    expect(d.confidence).toBe("low");
  });

  it("Noted and In Contractor's Scope need no source; with 'Answer without a source: yes' an uncited Comply is drafted low", async () => {
    (env as any).AI = model([{ compliance: "Noted", remarks: "", reason: "A reference.", confidence: "medium", cites: ["I"] }]).ai;
    expect((await draftAnswer(env, { ...base, clause: "Refer to Section 230513.", part: 1, section: "GENERAL" })).compliance).toBe("Noted");
    (env as any).AI = model([{ compliance: "Comply", remarks: "", reason: "Standard.", confidence: "high", cites: [] }]).ai;
    const d = await draftAnswer(env, { ...base, unsourced: true });
    expect(d).toMatchObject({ compliance: "Comply", confidence: "low" });
    expect(d.reason).toMatch(/Check: no source cited/);
  });

  it("corrections people made are shown on similar clauses and may be cited", async () => {
    const corrections = [{ spec: "Fans shall be belt driven centrifugal fans with DIDW wheels.", suggested: "Comply", suggested_remarks: "", final: "Not Applicable",
      final_remarks: "Direct-driven EC plug fans are provided.", score: 0.72 }];
    const u = userPrompt({ ...base, clause: "Fans shall be belt-driven centrifugal fans.", corrections });
    expect(u).toMatch(/Corrections people made to the AI's answers on similar clauses \(the person is right; follow the person\):\n\[M1\] \(similarity 0\.72\)/);
    expect(u).toMatch(/The AI answered: Comply\n   A person answered instead: Not Applicable \| Direct-driven EC plug fans are provided\./);
    (env as any).AI = model([{ compliance: "Not Applicable", remarks: "Direct-driven EC plug fans are provided.", reason: "A person corrected this before.", confidence: "high", cites: ["M1"] }]).ai;
    const d = await draftAnswer(env, { ...base, clause: "Fans shall be belt-driven centrifugal fans.", corrections });
    expect(d).toMatchObject({ compliance: "Not Applicable", confidence: "high" });
    expect(d.sources[0].kind).toBe("correction");
  });
});

describe("Routes: strict review, learning loop, template update", () => {
  beforeEach(async () => { await resetLogins(); });
  afterEach(() => { delete (env as any).AI; });

  it("a Part 2 clause with nothing on file waits for a person; a correction is shown on the next similar clause", async () => {
    const t = await login("admin");
    const p = await ok("pr_save", { p_token: t, p_name: "Tower S", p_client_type: "Consultant", p_client_name: "ACME", p_region: "UAE" });
    const lines = [{ type: "part", sr: "", spec: "PART 2 - PRODUCTS" }, { type: "section", sr: "2.5", spec: "FAN SECTION" },
      { type: "letter", sr: "A", spec: "Fans shall be belt driven centrifugal fans with double width double inlet wheels." }];
    const run = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-riyadh", p_source: "text", p_file_name: "a", p_lines: lines, p_project_id: p.id });
    const calls: string[] = [];
    (env as any).AI = { async run(_m: string, input: any) { calls.push(String(input?.messages?.[1]?.content || "")); return { response: JSON.stringify({ compliance: "Comply", remarks: "", reason: "r", confidence: "low", cites: [] }) }; } };
    const r = await ok("ai_review_run", { p_token: t, p_run_id: run.run_id, p_limit: 10 });
    expect(r).toMatchObject({ done: 0, waiting: 1 });
    expect(r.errors[0]).toMatch(/No source on file for this clause/);
    expect(calls).toHaveLength(0);
    // a person answers it, as if correcting an AI draft: the feedback row is what the AI learns from
    await env.DB.prepare(`INSERT INTO ai_feedback (id, run_id, seq, line_id, product_id, factory_id, part, section, source, suggested, suggested_remarks, final, final_remarks, outcome)
      SELECT 'fb1', run_id, seq, line_id, 'ahu', 'ahu-riyadh', 2, 'FAN SECTION', 'model', 'Comply', '', 'Not Applicable', 'Direct-driven EC plug fans are provided.', 'replaced' FROM cm_run_lines WHERE run_id = ? AND seq = 2`).bind(run.run_id).run();
    // the next specification has a similar clause: the correction is a source [M1]
    const run2 = await ok("cm_save_run", { p_token: t, p_factory_id: "ahu-riyadh", p_source: "text", p_file_name: "b", p_project_id: p.id,
      p_lines: [lines[0], lines[1], { type: "letter", sr: "A", spec: "Fans shall be belt driven centrifugal fans with DIDW wheels and adjustable sheaves." }] });
    (env as any).AI = { async run(_m: string, input: any) { calls.push(String(input?.messages?.[1]?.content || ""));
      return { response: JSON.stringify({ compliance: "Not Applicable", remarks: "Direct-driven EC plug fans are provided.", reason: "Corrected before.", confidence: "high", cites: ["M1"] }) }; } };
    const r2 = await ok("ai_review_run", { p_token: t, p_run_id: run2.run_id, p_limit: 10 });
    expect(r2).toMatchObject({ done: 1, drafted: 1 });
    expect(calls[0]).toMatch(/\[M1\][\s\S]*A person answered instead: Not Applicable/);
    const rec = await ok("pr_run_get", { p_token: t, p_run_id: run2.run_id });
    expect(rec.lines.find((l: any) => l.ai_draft)).toMatchObject({ compliance: "Not Applicable" });
  });

  it("Update from template brings untouched template rules up to date and leaves edited ones alone", async () => {
    const t = await login("teamAdmin");
    const made = await ok("ai_map_create", { p_token: t, p_product_id: "ahu" });
    // make it look like a map created from the earlier template: old Scope statements, Concrete bases under Any Part, no Coordination rule
    const node = (title: string) => env.DB.prepare("SELECT id, parent_id FROM mp_nodes WHERE map_id = ? AND title = ?").bind(made.id, title).first<any>();
    const anyPart = await node("Any Part"), scope = await node("Scope statements"), concrete = await node("Concrete bases"), site = await node("Site works");
    await env.DB.batch([
      env.DB.prepare("UPDATE mp_nodes SET special = ? WHERE id = ?").bind(JSON.stringify(["Section: section includes, related sections, related documents, summary, description of work", "Answer: Noted", "Remark: Noted."]), scope.id),
      env.DB.prepare("UPDATE mp_nodes SET special = ?, parent_id = ? WHERE id = ?").bind(JSON.stringify(["When: concrete base, housekeeping pad, plinth", "Answer: In Contractor's Scope", "Remark: By Contractor / others. Daikin scope is supply of equipment."]), anyPart.id, concrete.id),
      env.DB.prepare("UPDATE mp_nodes SET special = ? WHERE id = ?").bind(JSON.stringify(["When: rigging", "Answer: In Contractor's Scope", "Remark: Our own wording."]), site.id),
      env.DB.prepare("DELETE FROM mp_nodes WHERE map_id = ? AND title = 'Coordination by the contractor'").bind(made.id)
    ]);
    const up = await ok("ai_map_upgrade", { p_token: t, p_product_id: "ahu" });
    expect(up.added).toEqual(expect.arrayContaining(["Scope statements (updated)", "Concrete bases (updated, moved to Part 3 Execution)", "Coordination by the contractor (added under Part 1 General)"]));
    expect(up.added.join(" ")).not.toMatch(/Site works/);                        // edited by a person: left alone
    const sc = await node("Scope statements");
    expect(JSON.parse((await env.DB.prepare("SELECT special FROM mp_nodes WHERE id = ?").bind(sc.id).first<any>()).special).join(" ")).toMatch(/Unless: shall/);
    expect((await node("Concrete bases")).parent_id).toBe((await node("Part 3 Execution")).id);
    expect(JSON.parse((await env.DB.prepare("SELECT special FROM mp_nodes WHERE id = ?").bind(site.id).first<any>()).special)).toContain("Remark: Our own wording.");
    // pressing it again changes nothing
    expect((await ok("ai_map_upgrade", { p_token: t, p_product_id: "ahu" })).added).toEqual([]);
    // the corrected rules on the Riyadh Metro clauses
    const tr = (clause: string, section: string, part: number) => ok("ai_try", { p_token: t, p_product_id: "ahu", p_factory_id: "ahu-riyadh", p_clause: clause, p_section: section, p_part: part });
    expect((await tr("Provide fans and motors capable of stable operation at design conditions.", "SUMMARY", 1)).direct).toBeNull();
    expect((await tr("This Section includes constant or variable-volume, central-station air-handling units.", "SUMMARY", 1)).direct).toMatchObject({ answer: "Noted" });
    expect((await tr("AHUs shall be completely self-supporting for installation on concrete housekeeping pad.", "BASE", 2)).direct).toBeNull();
    expect((await tr("Coordinate size and location of concrete housekeeping bases.", "COORDINATION", 1)).direct).toMatchObject({ answer: "In Contractor's Scope" });
  });
});
