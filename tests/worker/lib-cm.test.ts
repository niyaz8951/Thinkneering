import { describe, it, expect } from "vitest";
import { cmNorm, cmPartNo, cmTopic, cmLibraryOrder, rowKey, libraryKey, placeRows } from "../../worker/src/lib/cm";

describe("lib/cm (the old plpgsql helpers)", () => {
  it("cm__norm: lower case, punctuation and spacing ignored", () => {
    expect(cmNorm("  Casing, shall be DOUBLE-skin;  50 mm. ")).toBe("casing shall be double skin 50 mm");
    expect(cmNorm(null)).toBe("");
  });
  it("only body rows of 8+ characters enter the library; contents lines never", () => {
    expect(libraryKey("letter", "Casing shall be double skin.")).toBe("casing shall be double skin");
    expect(libraryKey("number", "Short.")).toBeNull();
    expect(libraryKey("section", "CASING OF THE UNIT")).toBeNull();
    expect(libraryKey("text", "1.04 REFERENCES ........ 2")).toBeNull();
  });
  it("cm__part_no", () => {
    expect(cmPartNo("PART 2 - PRODUCTS")).toBe(2);
    expect(cmPartNo("Part III Execution")).toBe(3);
    expect(cmPartNo("PART 1.0 - GENERAL")).toBe(1);
    expect(cmPartNo("PARTITIONS")).toBe(0);
    expect(cmPartNo("PART 12")).toBe(9);
  });
  it("cm__topic: first match wins", () => {
    expect(cmTopic("FANS")).toBe("Fans and drives");
    expect(cmTopic("Supply Fan Section")).toBe("Fans and drives");
    expect(cmTopic("BEARINGS AND DRIVES")).toBe("Fans and drives");
    expect(cmTopic("QUALITY CONTROL")).toBe("Standards and quality");
    expect(cmTopic("FIELD QUALITY CONTROL")).toBe("Installation and testing");
    expect(cmTopic("CASING")).toBe("Casing and base");
    expect(cmTopic("COOLING COILS")).toBe("Coils");
    expect(cmTopic("")).toBe("");
    expect(cmTopic("Zebra")).toBe("Other");
  });
  it("cm__library_order: Part, section title groups by lowest number, blocks per conversion, document order", () => {
    const L = (id: string, part: number, section: string, section_sr: string, home_run: string, home_seq: number, run_at: string) =>
      ({ id, part, section, section_sr, home_run, home_seq, run_at, first_seen_at: run_at });
    const lines = [
      L("f", 2, "FANS", "2.03", "r1", 30, "2026-01-01"),
      L("c", 1, "QUALITY CONTROL", "1.07", "r1", 20, "2026-01-01"),
      L("d", 1, "QUALITY CONTROL", "1.05", "r2", 5, "2026-02-01"),
      L("a", 1, "SUMMARY", "1.01", "r1", 2, "2026-01-01"),
      L("b", 1, "SUMMARY", "1.01", "r1", 3, "2026-01-01"),
      L("z", 0, "", "", null as any, null as any, null as any),
      L("e", 2, "CASING", "2.01", "r1", 25, "2026-01-01")
    ];
    expect(cmLibraryOrder(lines).map((x) => x.id)).toEqual(["a", "b", "c", "d", "e", "f", "z"]);
  });
  it("pr__check_row key", () => {
    expect(rowKey("A. Casing shall be double-skin, 50 mm thick, with thermal break profiles throughout.")).toBe("acasingshallbedoubleskin50mmthickwiththe");
  });
  it("placeRows: the nearest PART and section above a clause; contents and 0. sections ignored", () => {
    const rows = [
      { seq: 0, type: "part", sr: "", spec: "PART 2 - PRODUCTS" },
      { seq: 1, type: "section", sr: "2.01", spec: "CASING" },
      { seq: 2, type: "letter", sr: "A.", spec: "Casing shall be double skin." },
      { seq: 3, type: "section", sr: "0.68", spec: "W/m2 K maximum" },
      { seq: 4, type: "letter", sr: "B.", spec: "Panels shall be 50 mm." },
      { seq: 5, type: "part", sr: "", spec: "PART 3 - EXECUTION" },
      { seq: 6, type: "text", sr: "", spec: "Install as shown." }
    ];
    const m = placeRows(rows);
    expect(m.get(2)).toEqual({ part: 2, section: "CASING", section_sr: "2.01" });
    expect(m.get(4)).toEqual({ part: 2, section: "CASING", section_sr: "2.01" });
    expect(m.get(6)).toEqual({ part: 3, section: "", section_sr: "" });
  });
});
