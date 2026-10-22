import { describe, it, expect } from "vitest";
import { siteWarnings, tableSiteWarnings, tableValues } from "../../worker/src/lib/site";
import { poAutoKind } from "../../worker/src/lib/po-kind";

/* 22 Oct 2026, Arcadis 237413 test run: a KSA project's datasheet selected at ROMA URBE, Italy, 400 V / 50 Hz. */
const TABLE = [
  { section: "General", component: "Factory", cells: ["Dubai", "Dubai"] },
  { component: "Power Supply", cells: ["415V/3Ph/50Hz + PE", "400V/3Ph/50Hz + PE"] },
  { section: "Unit Data", component: "Panel", cells: ["42 mm", "62 mm"] },
  { component: "Location", cells: ["ROMA URBE, Italy", "ROMA URBE, Italy"] }
];

describe("datasheet against the project's site", () => {
  it("reads one row's values over every unit", () => {
    expect(tableValues(TABLE, "unit data", "location")).toEqual(["ROMA URBE, Italy"]);
    expect(tableValues(TABLE, "general", "power supply")).toEqual(["415V/3Ph/50Hz + PE", "400V/3Ph/50Hz + PE"]);
    expect(tableValues(TABLE, "unit data", "power supply")).toEqual([]);
  });

  it("warns on another country and on 50 Hz in Saudi Arabia", () => {
    const w = tableSiteWarnings("Saudi Arabia", TABLE);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/selected at ROMA URBE, Italy, but the project is in Saudi Arabia/);
    expect(w[1]).toMatch(/415V\/3Ph\/50Hz \+ PE; 400V\/3Ph\/50Hz \+ PE, but Saudi Arabia uses 60 Hz/);
  });

  it("stays quiet when the selection fits, and for regions with no single country", () => {
    expect(siteWarnings("Saudi Arabia", ["JEDDAH KING ABDULAZIZ INTL, Saudi Arabia"], ["380V/3Ph/60Hz + PE"])).toEqual([]);
    expect(siteWarnings("UAE", ["DUBAI INTL, United Arab Emirates"], ["400V/3Ph/50Hz"])).toEqual([]);
    expect(siteWarnings("Qatar", [], [])).toEqual([]);
    expect(tableSiteWarnings("Other Middle East", TABLE)).toEqual([]);
    expect(tableSiteWarnings("", TABLE)).toEqual([]);
    // UAE at 50 Hz: only the country is wrong
    expect(tableSiteWarnings("UAE", TABLE)).toHaveLength(1);
  });

  it("the NRVU and Electrical Power Inputs rows have a Product Options kind", () => {
    expect(poAutoKind("nrvu||drive type")).toBe("option");
    expect(poAutoKind("nrvu||external leakage (ru) +400pa")).toBe("option");
    expect(poAutoKind("nrvu||leakage eatr")).toBe("duty");
    expect(poAutoKind("nrvu||sfp internal")).toBe("duty");
    expect(poAutoKind("nrvu||summer outdoor conditions")).toBe("project");
    expect(poAutoKind("electrical power inputs|fan supply|absorbed power")).toBe("duty");
    expect(poAutoKind("electrical power inputs|fan supply|absorbed current")).toBe("duty");
    expect(poAutoKind("electrical power inputs|fan supply|electrical connection")).toBe("option");
  });
});
