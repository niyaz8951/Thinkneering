/* The comparison carried over from the Thinkneering v3 Compliance Maker (worker/src/ai/compare.ts) and its use
   in the datasheet step (evidence.ts compareDatasheet). Each case is a wrong answer v3 met on a real job. */
import { describe, it, expect } from "vitest";
import { convert, propertyOf, judge, classTokens, classRequirements, compareClass, comparable, PROPERTIES } from "../../worker/src/ai/compare";
import { measurements } from "../../worker/src/ai/guard";
import { compareDatasheet, type SheetHit } from "../../worker/src/ai/evidence";

const hit = (o: Partial<SheetHit> & { cells: string[] }): SheetHit => ({
  key: o.key || "unit data||panel", section: o.section || "Unit Data", component: o.component || "Panel",
  label: o.label || `${o.section || "Unit Data"} • ${o.component || "Panel"}`, value: o.value || o.cells[0], entries: o.entries || [["panel"]], ...o });

describe("compare: units, directions, classes", () => {
  it("converts within a family only", () => {
    const [ls] = measurements("1200 l/s");
    expect(Math.round(convert(ls, "cfm")!)).toBe(2543);
    const [inwg] = measurements("1 in. wg");
    expect(inwg.unit).toBe("in.wg");
    expect(Math.round(convert(inwg, "pa")!)).toBe(249);
    const [tr] = measurements("100 TR");
    expect(Math.round(convert(tr, "kw")!)).toBe(352);
    const [f] = measurements("95°F");
    expect(Math.round(convert(f, "c")!)).toBe(35);
    expect(convert(measurements("50 mm")[0], "pa")).toBeNull();
  });

  it("knows which way is better", () => {
    expect(judge(50, 62, propertyOf("panel thickness"))).toBe("better");          // thicker panel: not a shortfall
    expect(judge(250, 180, propertyOf("pressure drop across the coil"))).toBe("better");
    expect(judge(2.5, 2.8, propertyOf("coil face velocity"))).toBe("worse");
    expect(judge(400, 380, propertyOf("power supply voltage"))).toBe("differs");
    expect(judge(50, 62, propertyOf("screw spacing"))).toBe("unknown");          // never fails a unit on the number alone
    expect(judge(50, 50, null)).toBe("equal");
  });

  it("keeps a thickness term from deciding a flow", () => {
    expect(propertyOf("panel air flow", { family: "flow" })?.name).toBe("air flow");
    expect(propertyOf("insulation thickness 50 mm", { family: "length" })?.name).toBe("insulation thickness");
  });

  it("reads classes on their published scale, not their digits", () => {
    const tb = PROPERTIES.find((p) => p.name.startsWith("thermal bridging"))!;
    const filter = PROPERTIES.find((p) => p.name.startsWith("filter"))!;
    expect(compareClass("TB3", "TB2", tb)).toBe("better");    // TB1 is the best class
    expect(compareClass("TB2", "TB3", tb)).toBe("worse");
    expect(compareClass("F7", "F9", filter)).toBe("better");  // here the digits run the other way
    expect(compareClass("F9", "M6", filter)).toBe("worse");
    expect(classTokens("Casing class D1, leakage L1, TB2")).toEqual(["D1", "L1", "TB2"]);
  });

  it("needs the subject before it reads a class", () => {
    expect(classRequirements("Fix with M5 stainless screws")).toEqual([]);
    expect(classRequirements("Bag filters shall be class F9").map((c) => c.cls)).toEqual(["F9"]);
    expect(classRequirements("Thermal bridging class TB2 to EN 1886").map((c) => c.prop.name)).toEqual(["thermal bridging class (EN 1886)"]);
  });

  it("reads thousands separators", () => {
    expect(measurements("1,200 l/s and 2,543 cfm, 1,5 mm")).toMatchObject([{ n: 1200 }, { n: 2543 }, { n: 1.5 }]);
  });

  it("finds a comparable figure in another unit", () => {
    const got = comparable("2,543 cfm", measurements("1200 l/s")[0])!;
    expect(got.converted).toBe(true);
    expect(Math.round(got.value)).toBe(1200);
  });
});

describe("compareDatasheet with the v3 rules", () => {
  it("62 mm against 50 mm asked: Comply with Remarks, better, medium", () => {
    const c = compareDatasheet("Casing panels shall be 50 mm thick double skin.", [hit({ cells: ["62 mm"] })], ["AHU-01"])!;
    expect(c.compliance).toBe("Comply with Remarks");
    expect(c.confidence).toBe("medium");
    expect(c.reason).toMatch(/better for panel thickness/);
  });

  it("a thinner panel than asked is flagged for a person (low)", () => {
    const c = compareDatasheet("Casing panels shall be 62 mm thick.", [hit({ cells: ["50 mm"] })], ["AHU-01"])!;
    expect(c.compliance).toBe("Comply with Remarks");
    expect(c.confidence).toBe("low");
    expect(c.reason).toMatch(/worse for panel thickness/);
  });

  it("a minimum is a limit, after conversion", () => {
    const flow = hit({ key: "fan supply||air flow", section: "Fan Supply", component: "Air flow", entries: [["air", "flow"]], cells: ["1,200 l/s"] });
    expect(compareDatasheet("Supply air flow not less than 2,400 cfm.", [flow], ["AHU-01"])!.compliance).toBe("Comply");
    expect(compareDatasheet("Supply air flow not less than 2,600 cfm.", [flow], ["AHU-01"])!.compliance).toBe("Not Comply");
  });

  it("a class asked is a minimum on its scale", () => {
    const tb = hit({ key: "unit data||thermal bridging", component: "Thermal bridging", entries: [["thermal", "bridging"]], cells: ["TB2"] });
    expect(compareDatasheet("Casing thermal bridging class shall be TB3 or better.", [tb], ["AHU-01"])!.compliance).toBe("Comply");
    const c = compareDatasheet("Casing thermal bridging class shall be TB1.", [tb], ["AHU-01"])!;
    expect(c.compliance).toBe("Not Comply");
    expect(c.reason).toMatch(/TB2 worse than TB1/);
  });
});

describe("compareDatasheet: every part of a clause, ranges, metrics, rows that disagree (19 Oct 2026)", () => {
  const filter = (cells1: string[], cells2: string[]) => [
    hit({ key: "filter supply||filter class", section: "Filter Supply", component: "Filter Class · Filter 1", entries: [["filter", "class"], ["arrestance"]], cells: cells1, group: "filter supply||filter class" }),
    hit({ key: "filter supply||filter class", section: "Filter Supply", component: "Filter Class · Filter 2", entries: [["filter", "class"], ["arrestance"]], cells: cells2, group: "filter supply||filter class" })];
  it("a clean Comply carries no remark; the offer stays in the reason", () => {
    const c = compareDatasheet("Casing panels shall be not less than 50 mm thick.", [hit({ cells: ["62 mm"], value: "62 mm" })], ["AHU-01"])!;
    expect(c).toMatchObject({ compliance: "Comply", remarks: "" });
    expect(c.reason).toMatch(/Offered: 62 mm\./);
  });
  it("a figure no row answers leaves the clause open; a broken one still fails it", () => {
    const panel = [hit({ cells: ["62 mm"] })];
    expect(compareDatasheet("Panels not less than 50 mm thick with leakage not exceeding 2 percent at 1000 Pa.", panel, ["AHU-01"])).toBeNull();
    expect(compareDatasheet("Panels not less than 70 mm thick with leakage not exceeding 2 percent at 1000 Pa.", panel, ["AHU-01"])!.compliance).toBe("Not Comply");
  });
  it("reads a range as a range", () => {
    const hz = hit({ key: "general||power supply", section: "General", component: "Power Supply", entries: [["frequency"]], cells: ["380V/3Ph/60Hz"] });
    expect(compareDatasheet("Supply frequency 50 to 60 Hz.", [hz], ["AHU-01"])!.compliance).toBe("Comply");
    const c = compareDatasheet("Supply frequency 6 to 50 Hz.", [hz], ["AHU-01"])!;
    expect(c.compliance).toBe("Not Comply");
    expect(c.reason).toMatch(/60Hz outside 6 to 50 Hz required/);
  });
  it("a percentage of another metric is not compared (ISO Coarse is not an ASHRAE arrestance)", () => {
    expect(compareDatasheet("Bag filters, ASHRAE arrestance of 60 to 80 percent.", filter(["ISO Coarse 60%(G4)"], ["ePM1 65%(F7)"]), ["AHU-01"])).toBeNull();
  });
  it("Filter 1 and Filter 2 that disagree settle nothing; when both meet it, it is met", () => {
    expect(compareDatasheet("Filters shall be class F7.", filter(["ISO Coarse 60%(G4)"], ["ePM1 65%(F7)"]), ["AHU-01"])).toBeNull();
    expect(compareDatasheet("Filters shall be class M5.", filter(["ePM1 50%(M6)"], ["ePM1 65%(F7)"]), ["AHU-01"])!.compliance).toBe("Comply");
  });
});

/* ---------- the remark lock and the review priority (guard.ts) ---------- */
import { lockRemarks, priorityOf, SCOPE_REMARK } from "../../worker/src/ai/guard";
import { DEFAULT_INSTRUCTIONS, OLD_INSTRUCTIONS } from "../../worker/src/ai/map";
import { valuesNotOnSheet } from "../../worker/src/ai/draft";
describe("remark lock and review priority", () => {
  it("blanks a confirming remark, keeps a real one, fills the scope line, flags wording", () => {
    expect(DEFAULT_INSTRUCTIONS.find((x) => x.title === "Remarks")!.text).toMatch(/Never name the make or manufacturer/);
    expect(OLD_INSTRUCTIONS.some((x) => x.title === "Remarks" && !/make or manufacturer/.test(x.text) && /Daikin submits/.test(x.text))).toBe(true);   // an unedited Remarks gets the new line
    expect(lockRemarks("Comply", "Complies.", "high")).toMatchObject({ compliance: "Comply", remarks: "", confidence: "high" });
    // makes are internal (owner, 21 Oct 2026): a remark naming one goes low with a note; a word that only contains it does not
    const named = lockRemarks("Comply with Remarks", "Direct-driven EC plug fans by EBM-Papst are offered.", "high", ["ebm-papst", "Nicotra Gebhardt"]);
    expect(named.confidence).toBe("low");
    expect(named.notes.join(" ")).toMatch(/names a make \(ebm-papst\)/);
    expect(lockRemarks("Comply with Remarks", "Direct-driven EC plug fans are offered.", "high", ["ebm-papst"]).confidence).toBe("high");
    expect(lockRemarks("Comply with Remarks", "Hydronic coils are offered.", "high", ["Hydro"]).confidence).toBe("high");
    expect(lockRemarks("Comply with Remarks", "As specified", "medium")).toMatchObject({ compliance: "Comply", remarks: "" });
    expect(lockRemarks("In Contractor's Scope", "", "high")).toMatchObject({ remarks: SCOPE_REMARK });
    expect(lockRemarks("Not Comply", "", "high")).toMatchObject({ confidence: "low" });
    const b = lockRemarks("Comply with Remarks", "Panels are 62 mm as per the datasheet, please confirm.", "high");
    expect(b.confidence).toBe("low");
    expect(b.notes.join(" ")).toMatch(/asks the reader to verify.*names an internal source|names an internal source.*asks the reader/);
    expect(lockRemarks("Comply with Remarks", "Offered bag length: 510 mm.", "medium")).toMatchObject({ confidence: "medium", notes: [] });
  });
  it("puts each draft where the reviewer looks", () => {
    expect(priorityOf({ compliance: "Comply", confidence: "high", source: "datasheet" })).toBe("green");
    expect(priorityOf({ compliance: "In Contractor's Scope", confidence: "high", source: "rule" })).toBe("green");
    expect(priorityOf({ compliance: "Comply", confidence: "high", source: "library-similar", sources: [{ score: 0.93 }] })).toBe("amber");
    expect(priorityOf({ compliance: "Comply with Remarks", confidence: "high", source: "datasheet" })).toBe("amber");
    expect(priorityOf({ compliance: "Comply", confidence: "medium", source: "model" })).toBe("amber");
    expect(priorityOf({ compliance: "Not Comply", confidence: "high", source: "datasheet" })).toBe("red");
    expect(priorityOf({ compliance: "Comply", confidence: "high", source: "library-similar", sources: [{ score: 1 }] }, true)).toBe("red");
  });
  it("finds the figures a copied answer states that the project's datasheet does not show", () => {
    expect(valuesNotOnSheet("62 mm panels, 45 kg/m3 foam.", [{ value: "62 mm" }])).toEqual(["45 kg/m3"]);
    expect(valuesNotOnSheet("Thermal break profile.", [])).toEqual([]);
  });
});

/* ---------- section kinds and sections a unit does not have (sections.ts, draft.ts) ---------- */
import { afterEach } from "vitest";
import { env } from "cloudflare:test";
import { classifySection, sectionKey, TRUST_AT } from "../../worker/src/ai/sections";
import { draftAnswer, userPrompt } from "../../worker/src/ai/draft";

const rowsOf = (n: number, compliance: string, spec: string) => Array.from({ length: n }, () => ({ compliance, spec_text: spec }));

describe("section kinds, learned from people's answers", () => {
  it("needs 5 confirmed answers before it says anything", () => {
    expect(classifySection("INSTALLATION", rowsOf(TRUST_AT - 1, "By contractor", "Install the units."))).toBeNull();
    expect(classifySection("INSTALLATION", rowsOf(TRUST_AT, "By contractor", "Install the units."))).toEqual({ kind: "contractor", n: 5 });
  });

  it("a casing section citing EN 1886 on every line is still about the product", () => {
    const casing = rowsOf(6, "Comply", "Casing shall be 50 mm thick, class D1 to EN 1886.");
    expect(classifySection("CASING", casing)?.kind).toBe("product");
    expect(classifySection("QUALITY ASSURANCE", rowsOf(6, "Comply", "Units shall be certified by Eurovent."))?.kind).toBe("reference");
  });

  it("matches a section by its words, not its number", () => {
    expect(sectionKey("3.02 INSTALLATION")).toBe(sectionKey("Installation"));
  });
});

describe("the model is told the section kind and the missing sections", () => {
  afterEach(() => { delete (env as any).AI; });
  const base = { clause: "Units shall include a heat recovery wheel.", sr: "C.", part: 2, section: "HEAT RECOVERY", product: "AHU", factory: "Riyadh", similar: [], comments: "" };

  it("puts both in the prompt", () => {
    const p = userPrompt({ ...base, sectionKind: "contractor", sectionAnswers: 7, absent: ["Heat Wheel"] });
    expect(p).toMatch(/Kind of section \(learned from 7 answers.*\): contractor\. This section is site execution/);
    expect(p).toMatch(/datasheet has no Heat Wheel section/);
  });

  it("a Comply about a section the unit does not have is low confidence", async () => {
    (env as any).AI = { async run() { return { response: JSON.stringify({ compliance: "Comply", remarks: "Heat recovery wheel is provided.", reason: "Standard option.", confidence: "high", cites: ["O1"] }), usage: { prompt_tokens: 1, completion_tokens: 1 } }; } };
    const d = await draftAnswer(env, { ...base, absent: ["Heat Wheel"], options: ["Special option: Heat recovery wheel on request"] });
    expect(d.confidence).toBe("low");
    expect(d.reason).toMatch(/the datasheet has no Heat Wheel section/);
  });
});

/* No datasheet: the closest HIGHER Product Options value (owner, 20 Oct 2026: "skin thickness 0.9 mm GI asked, we comply
   with 1.0 mm"), never a lower one; the offer is the remark. */
import { optionPicks, compareOptions } from "../../worker/src/ai/evidence";
describe("Product Options without a datasheet: closest higher", () => {
  const row = [{ key: "unit data||inner skin", section: "Unit Data", component: "Inner skin", entries: [["skin"]] }];
  const vals = (...v: [string, number][]) => new Map([["unit data||inner skin", v.map(([value, times]) => ({ value, times }))]]);

  it("0.9 mm asked, 0.8 / 1.0 / 1.2 mm seen: 1.0 mm, Comply with Remarks naming it", () => {
    const clause = "Inner skin: galvanized steel sheet, 0.9 mm thick.";
    const picks = optionPicks(clause, row, vals(["0.8 mm", 40], ["1.2 mm", 20], ["1.0 mm", 5]));
    expect(picks[0]).toMatchObject({ status: "meets", pick: "1.0 mm", exact: false });
    expect(picks[0].reason).toMatch(/closest higher value/);
    expect(compareOptions(clause, picks, "Riyadh")).toMatchObject({ compliance: "Comply with Remarks", remarks: "1.0 mm", confidence: "medium" });
  });

  it("the value asked is seen: Comply, no remark; only lower values: none meets", () => {
    const clause = "Inner skin: galvanized steel sheet, 0.9 mm thick.";
    const exact = optionPicks(clause, row, vals(["1.0 mm", 40], ["0.9 mm", 2]));
    expect(exact[0]).toMatchObject({ status: "meets", pick: "0.9 mm", exact: true });
    expect(compareOptions(clause, exact, "Riyadh")).toMatchObject({ compliance: "Comply", remarks: "" });
    const low = optionPicks(clause, row, vals(["0.8 mm", 40], ["0.7 mm", 2]));
    expect(low[0].status).toBe("not seen");
    expect(compareOptions(clause, low, "Riyadh")).toBeNull();
  });
});
