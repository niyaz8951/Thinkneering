/* The four fixes of 22 Oct 2026, from the rule test run on Arcadis 237413 (KSA Automotive Supplier Park) against the
   ASTRAWEB datasheet HILTOP FINAL_R1_COPY (docs: Rule-Test-Run-2026-10-22.md). Every case below was a wrong verdict
   or a missed one in that run. Values as printed on the datasheet. */
import { describe, it, expect } from "vitest";
import { compareDatasheet, requirements, operatorOf, clauseDimension, rowDimension, type SheetHit } from "../../worker/src/ai/evidence";
import { match, topicOf, rowTopics, type MapRule } from "../../worker/src/lib/rows";

const UNITS = ["FAHU-RF-01", "FAHU-RF-03"];
const hit = (section: string, component: string, cells: string[], entries: string[][]): SheetHit => ({
  key: section.toLowerCase() + "||" + component.toLowerCase(), section, component, label: `${section} • ${component}`,
  cells, value: cells.join(", "), entries });

const BASE = hit("Unit Data", "AHU Base", ["100mm Galvanized", "100mm Galvanized"], [["base", "frame"], ["base", "rail"]]);
const PANEL = hit("Unit Data", "Panel", ["42 mm", "62 mm"], [["double", "wall"], ["panel", "thick"]]);
const FIN = hit("Coil Cooling DX Supply", "Fin Material", ["Al Pr 0.1 mm", "Al Pr 0.1 mm"], [["fin", "alumin"], ["fin", "material"]]);
const FIN_SPACE = hit("Coil Cooling DX Supply", "Fin Space", ["2.5 mm", "2.5 mm"], [["fin", "spac"], ["fins", "per"]]);
const LEAK = hit("Mechanical Characteristic (EN1886)", "Casing Leakage", ["L1(M)/L1(M)", "L1(M)/L1(M)"], [["casing", "leakage"], ["air", "leakage"]]);
const VELO = hit("Coil Cooling DX Supply", "Air Velocity", ["2.59 m/s", "2.47 m/s"], [["face", "velocity"]]);

describe("1. a length is compared only with a row of the same dimension", () => {
  it("knows the dimension of a figure and of a row", () => {
    const c = "Base Frame should be C Channel Type with a minimum thickness of 2.8 mm.";
    expect(clauseDimension(c, c.indexOf("2.8 mm"), "2.8 mm")).toBe("thickness");
    const w = "Access doors shall be equipped with 200 mm diameter, double-walled polycarbonate windows";
    expect(clauseDimension(w, w.indexOf("200 mm"), "200 mm")).toBe("diameter");
    expect(rowDimension("Unit Data • AHU Base")).toBe("height");
    expect(rowDimension("Unit Data • Panel")).toBe("thickness");
    expect(rowDimension("Coil Cooling DX Supply • Fin Space")).toBe("spacing");
    expect(rowDimension("Coil Cooling DX Supply • Tube Thickness")).toBe("thickness");
    expect(rowDimension("Filter Supply • Dimensions")).toBe("size");
  });

  it("does not answer a channel thickness with the base height (was a false Comply)", () => {
    expect(compareDatasheet("Base Frame should be C Channel Type with a minimum thickness of 2.8 mm.", [BASE], UNITS)).toBeNull();
  });

  it("still answers the base height", () => {
    const c = "All units shall be provided with Galvanized steel base frame of Minimum height 150 mm.";
    expect(compareDatasheet(c, [BASE], UNITS)?.compliance).toBe("Not Comply");
  });

  it("does not answer a window diameter with the panel thickness (was Comply with Remarks)", () => {
    const c = "Access doors shall be equipped with 200 mm diameter, double-walled polycarbonate windows to ensure transparency.";
    expect(compareDatasheet(c, [PANEL], UNITS)).toBeNull();
  });

  it("pairs fin thickness with the fin and fin spacing with the spacing (was Not Comply)", () => {
    const c = "The Aluminum fins used shall be having a thickness of 0.10 mm with minimum fin spacing of 2.0 mm.";
    const r = compareDatasheet(c, [FIN, FIN_SPACE], UNITS)!;
    expect(r.compliance).toBe("Comply");
    expect(r.reason).not.toMatch(/0\.1 mm < 2\.0 mm/);
  });

  it("leaves a figure with no dimension word to the keyword rule, as before", () => {
    expect(compareDatasheet("Casing panels shall be double skin, 50 mm.", [PANEL], UNITS)?.compliance).toBe("Comply with Remarks");
  });
});

describe("2. a limit turned round by a refusal", () => {
  it("reads 'less than X will not be permitted' as a minimum", () => {
    expect(operatorOf("Panel Insulation thickness less than ", " will not be permitted.")).toBe(">=");
    expect(operatorOf("velocity more than ", " is not acceptable")).toBe("<=");
    expect(operatorOf("less than ", " in any case")).toBe("<=");          // no refusal: unchanged
  });

  it("fails the 42 mm units and passes the 62 mm one, with the right reason", () => {
    const r = compareDatasheet("Panel Insulation thickness less than 60mm will not be permitted.", [PANEL], UNITS)!;
    expect(r.compliance).toBe("Not Comply");
    expect(r.reason).toMatch(/42 mm < 60mm required/);
    expect(r.reason).not.toMatch(/62 mm >/);
  });
});

describe("3. test conditions are not requirements", () => {
  it("marks the pressure beside a class, 'at', 'exposed to' and an if-part as conditions", () => {
    expect(requirements("Casing Air Leakage -400 Pa | Class L1(M)")[0].condition).toBe(true);
    expect(requirements("Coils shall be leak tested according to PED 97/23 CE at 24 bar.")[0].condition).toBe(true);
    expect(requirements("AHU Casing when exposed to 2500 Pa Positive and Negative pressure shall not cause any permanent deflection.")[0].condition).toBe(true);
    const v = requirements("The Coil Face Velocity shall not exceed 2.50 m/s. If the coil Face Velocity exceeds 2.50 m/s or if SH/TH ratio is below 0.65 at 2.50 m/s coil face velocity, eliminators must be provided.");
    expect(v.map((r) => !!r.condition)).toEqual([false, true, true]);
  });

  it("compares the leakage class once the test pressure is out of the way", () => {
    expect(compareDatasheet("Casing Air Leakage -400 Pa | Class L1(M)", [LEAK], UNITS)?.compliance).toBe("Comply");
  });

  it("judges the face velocity on the limit, not on the condition", () => {
    const r = compareDatasheet("The Coil Face Velocity shall not exceed 2.50 m/s. If the coil Face Velocity exceeds 2.50 m/s or if SH/TH ratio is below 0.65 at 2.50 m/s coil face velocity, eliminators must be provided.", [VELO], UNITS)!;
    expect(r.compliance).toBe("Not Comply");
    expect(r.reason).toMatch(/2\.59 m\/s > 2\.50 m\/s required \(FAHU-RF-01\)/);
  });
});

describe("4. a part the unit does not have", () => {
  it("knows heat pipes, attenuators and heating-coil sections", () => {
    expect(topicOf("HORSESHOE HEAT PIPE (WHEREVER APPLICABLE, AS PER EQUIPMENT SCHEDULE)")).toBe("heatpipe");
    expect(topicOf("SOUND ATTENUATOR (Wherever Applicable, as per equipment schedule)")).toBe("attenuator");
    expect(rowTopics({ section: "Coil Heating Water Supply", component: "Rows" })).toEqual(["heater", "coil"]);
    expect(rowTopics({ section: "Coil Cooling DX Supply", component: "Fin Space" })).toEqual(["coil"]);
  });

  it("does not link heat-pipe clauses to the DX coil (was a false Comply on fin thickness)", () => {
    const spec = [
      { type: "part", sr: "", spec: "PART 2 – PRODUCTS" },
      { type: "number", sr: "16", spec: "HEAT RECOVERY WHEEL (WHEREVER APPLICABLE, AS PER EQUIPMENT SCHEDULE)" },
      { type: "letter", sr: "a", spec: "The Rotor shall be constructed of alternate layers of corrugated and flat aluminum foil." },
      { type: "number", sr: "17", spec: "HORSESHOE HEAT PIPE (WHEREVER APPLICABLE, AS PER EQUIPMENT SCHEDULE)" },
      { type: "letter", sr: "a", spec: "The heat pipes shall consist of a precool and reheat fin block." },
      { type: "letter", sr: "b", spec: "The external fins shall be of aluminum with a minimum thickness of 0.14mm. Fins shall be of the continuous plate type, spaced as required." }
    ];
    const rules: MapRule[] = [{ key: "coil cooling dx supply|geometry|fin space", section: "Coil Cooling DX Supply", sub: "geometry", component: "Fin Space", show: true, label: "", keywords: "fins per; fin spac; fpi" }];
    const m = match(spec, rules)[0];
    expect(m.found).toBe(false);
  });
});
