/* lib/rows.ts: the clause-to-datasheet-row match (with the topic gate) and the value lookup of saved tables
   (every row kept, newest table wins per unit tag). The browser copy (cm-rows.js, pr-match.js) is checked against
   these by scripts/rows-parity.mjs. Examples from the Qiddiya base test (19 Oct 2026), values made up. */
import { describe, it, expect } from "vitest";
import { match, unitLookup, topicOf, rowTopics, type MapRule } from "../../worker/src/lib/rows";

const SPEC = [
  { type: "part", sr: "", spec: "PART 2 - PRODUCTS" },
  { type: "section", sr: "2.1", spec: "UNIT CASINGS" },
  { type: "letter", sr: "A.", spec: "General Fabrication Requirements for Casings:" },
  { type: "number", sr: "1.", spec: "Forming: Form walls, roofs, and floors with at least two breaks at each joint." },
  { type: "number", sr: "2.", spec: "Casing: Galvanized steel double skin insulated panels, 50 mm thick." },
  { type: "section", sr: "2.2", spec: "FAN, DRIVE, AND MOTOR SECTION" },
  { type: "letter", sr: "J.", spec: "Variable Frequency Controllers:" },
  { type: "number", sr: "1.", spec: "Description: NEMA ICS 2, IGBT, PWM, VFC; arranged to provide variable speed by adjusting output voltage and frequency." },
  { type: "number", sr: "2.", spec: "Output Rating: 3-phase; 6 to 60 Hz, with voltage proportional to frequency." },
  { type: "letter", sr: "K.", spec: "Electrical power supply shall be 380 V, 3 phase, 60 Hz." },
  { type: "section", sr: "2.4", spec: "AIR FILTRATION SECTION" },
  { type: "letter", sr: "B.", spec: "Extended-Surface, Disposable Panel Filters:" },
  { type: "number", sr: "1.", spec: "Thickness: 50 mm." },
  { type: "number", sr: "2.", spec: "Media: Fibrous material formed into pleats, rated-airflow conditions." },
  { type: "section", sr: "2.6", spec: "HUMIDIFIERS" },
  { type: "letter", sr: "B.", spec: "Wet Glass Cell Washer Section:" },
  { type: "number", sr: "1.", spec: "75-mm deep cells with random packed, glass-fiber media; insulation of the casing as above." }
];
const RULES: MapRule[] = [
  { key: "general||power supply", section: "General", sub: "", component: "Power Supply", show: true, label: "", keywords: "power supply; electrical characteristic; electrical supply; supply voltage" },
  { key: "unit data||panel", section: "Unit Data", sub: "", component: "Panel", show: true, label: "", keywords: "double skin; panel thick" },
  { key: "unit data||insulation", section: "Unit Data", sub: "", component: "Insulation", show: true, label: "", keywords: "insulation; insulated panel" },
  { key: "unit data||roof", section: "Unit Data", sub: "", component: "Roof", show: true, label: "", keywords: "outdoor installation; weatherproof" },
  { key: "unit data||supply air flow", section: "Unit Data", sub: "", component: "Supply Air Flow", show: true, label: "", keywords: "design air flow; air flow rate" },
  { key: "filter supply||dimensions", section: "Filter Supply", sub: "", component: "Dimensions", show: true, label: "", keywords: "thickness; filter depth" },
  { key: "fan supply|motor data|electrical connection", section: "Fan Supply", sub: "Motor Data", component: "Electrical Connection", show: true, label: "", keywords: "motor volt; output voltage" }
];
const found = (key: string) => { const r = match(SPEC, RULES).find((x) => x.key === key)!; return r.lines.map((i) => SPEC[i].sr + " " + SPEC[i].spec.slice(0, 20)); };

describe("topic gate", () => {
  it("names the part of the unit a heading is about, most specific first", () => {
    expect(topicOf("Variable Frequency Controllers")).toBe("vfd");
    expect(topicOf("Extended-Surface, Disposable Panel Filters")).toBe("filter");
    expect(topicOf("Electrical Heating Coils, Controls, and Accessories")).toBe("heater");
    expect(topicOf("FAN, DRIVE, AND MOTOR SECTION")).toBe("fan");
    expect(topicOf("Submittals")).toBe("");
    expect(rowTopics({ section: "Unit Data", component: "Panel" })).toEqual(["casing", "performance"]);
    expect(rowTopics({ section: "Fan Supply", sub: "Motor Data", component: "Electrical Connection" })).toEqual(["fan", "electrical"]);
    expect(rowTopics({ section: "Mechanical Characteristic (EN1886)", component: "Casing Strength" })).toEqual(["casing"]);
  });
  it("a VFD clause links no power-supply or motor row; a filter clause links filter rows only; a casing clause the casing rows", () => {
    expect(found("general||power supply")).toEqual(["K. Electrical power sup"]);      // not 2.2 J.1 / J.2 (VFD)
    expect(found("fan supply|motor data|electrical connection")).toEqual([]);           // "output voltage" is a VFD clause
    expect(found("filter supply||dimensions")).toEqual(["1. Thickness: 50 mm."]);
    expect(found("unit data||panel")).toEqual(["2. Casing: Galvanized s"]);              // not the filter thickness under "Panel Filters"
    expect(found("unit data||insulation")).toEqual(["2. Casing: Galvanized s"]);         // not the humidifier's glass-fiber media
    expect(found("unit data||supply air flow")).toEqual([]);                             // "rated-airflow" of filter media
  });
});

describe("unitLookup", () => {
  const table = (columns: string[], filter2: string[]) => ({ columns, rows: [
    { section: "Filter Supply", component: "Mounting", cells: columns.map(() => "Slide"), key: "filter supply||mounting" },
    { kind: "sub", component: "Filter 1", cells: [] },
    { component: "Filter Class", cells: columns.map(() => "ISO Coarse 60%(G4)"), key: "filter supply||filter class" },
    { kind: "sub", component: "Filter 2", cells: [] },
    { component: "Filter Class", cells: filter2, key: "filter supply||filter class" },
    { section: "Empty Section Supply", component: "Length", cells: columns.map(() => "430 mm"), key: "empty section supply||length" },
    { section: "Empty Section Supply (2)", component: "Length", cells: columns.map(() => "400 mm"), key: "empty section supply||length" }
  ] });
  it("keeps every row of a key, named by its sub-heading or section", () => {
    const look = unitLookup([table(["AHU-01", "AHU-02"], ["ePM1 65%(F7)", "ePM1 50%(F7)"])]);
    expect(look.entries({ key: "filter supply||filter class", section: "Filter Supply", component: "Filter Class" })).toEqual([
      { qual: "Filter 1", cells: ["ISO Coarse 60%(G4)", "ISO Coarse 60%(G4)"] }, { qual: "Filter 2", cells: ["ePM1 65%(F7)", "ePM1 50%(F7)"] }]);
    expect(look.entries({ key: "empty section supply||length", section: "Empty Section Supply", component: "Length" }).map((e) => e.qual + ": " + e.cells[0]))
      .toEqual([": 430 mm", "empty section supply 2: 400 mm"]);
    expect(look.entries({ key: "filter supply||mounting", section: "Filter Supply", component: "Mounting" })).toEqual([{ qual: "", cells: ["Slide", "Slide"] }]);
    // a table saved before keys were kept: found by section and name, rows told apart the same way
    const old = unitLookup([{ columns: ["U1"], rows: table(["U1"], ["F7"]).rows.map(({ key, ...r }) => r) }]);
    expect(old.entries({ key: "x", section: "Filter Supply", component: "Filter Class" }).map((e) => e.cells[0])).toEqual(["ISO Coarse 60%(G4)", "F7"]);
  });
  it("a unit read again in a newer table is taken from the newest only", () => {
    const look = unitLookup([table(["AHU-01", "AHU-02"], ["F7 old", "F7 old"]), table(["AHU-02", "AHU-03"], ["F7 new", "F9 new"])]);
    expect(look.columns).toEqual(["AHU-01", "AHU-02", "AHU-03"]);
    expect(look.entries({ key: "filter supply||filter class", section: "Filter Supply", component: "Filter Class" })[1].cells).toEqual(["F7 old", "F7 new", "F9 new"]);
  });
});
