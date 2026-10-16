/* Checks made by code on every model draft before it is written (AI-Roadmap principle 2: the model writes,
   code checks). Pure functions, unit-tested in tests/worker/ai-rules.test.ts. Learnt from the first AI tool
   (ai-suggest.js), where each of these failures was seen on real specifications:
     - a remark that states a measurement no source gave ("Panel thickness is 50 mm" restating the clause's
       requirement as if it were the product) -> the number becomes [value], confidence low
     - a remark that repeats the answer ("In Contractor's Scope. In contractor's scope ...") -> trimmed
     - hedging ("should", "typically", "approximately") is not consultant-ready -> confidence low
   Bare numbers are left alone: "AHRI 430" and "Section 23 73 13" are references, not measurements. */
import { CHOICES } from "../lib/cm";

const UNITS = "in\\.?\\s?w\\.?g\\.?|kg\\/m3|kg\\/m³|mm|cm|m|km|kg|g|t|kw|w|mw|kwr|tr|btu\\/h|btuh|kcal\\/h|pa|kpa|bar|psi|%|micron|microns|µm|um|°c|deg\\s?c|c|°f|f|db|dba|db\\(a\\)|m\\/s|fpm|m3\\/h|m³\\/h|cmh|l\\/s|lps|cfm|rpm|hz|v|vac|a|amp|amps|hours|hrs|h|years|yrs|ip\\d{2}";
// longest first, so "m/s" wins over "m" and "mm" over "m"
const UNIT_RE = UNITS.split("|").sort((a, b) => b.replace(/\\/g, "").length - a.replace(/\\/g, "").length).join("|");
// "1,200 l/s" is twelve hundred (comma before exactly three digits = thousands); "1,5 mm" is one and a half
const MEASURE = new RegExp(`(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?(?!\\d)|\\d+(?:[.,]\\d+)?)\\s*(${UNIT_RE})(?![a-z0-9])`, "gi");

export interface Measure { n: number; unit: string; raw: string }

function unitKey(u: string): string {
  const s = u.toLowerCase().replace(/\s+/g, "").replace("³", "3").replace("°", "");
  const alias: Record<string, string> = { "in.wg": "in.wg", inwg: "in.wg", "in.w.g.": "in.wg", "inw.g.": "in.wg", "in.w.g": "in.wg", "inw.g": "in.wg", "inwg.": "in.wg", "kg/m³": "kg/m3", degc: "c", microns: "micron", um: "micron", "µm": "micron", hrs: "h", hours: "h", yrs: "years", lps: "l/s", cmh: "m3/h", amps: "a", amp: "a", vac: "v", btuh: "btu/h", "db(a)": "dba" };
  return alias[s] || s;
}

export function measurements(text: unknown): Measure[] {
  const out: Measure[] = [];
  const re = new RegExp(MEASURE.source, "gi");
  let m: RegExpExecArray | null;
  const s = String(text ?? "");
  while ((m = re.exec(s))) {
    // "1.5 m" fine; skip a bare "c" / "f" / "a" / "h" / "t" / "g" unless glued to the number ("40C", "3h")
    const unit = m[2];
    if (/^[cfahtg]$/i.test(unit) && /\s/.test(m[0])) continue;
    const num = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(m[1]) ? m[1].replace(/,/g, "") : m[1].replace(",", ".");
    out.push({ n: parseFloat(num), unit: unitKey(unit), raw: m[0].trim() });
  }
  return out;
}

/* Every measurement in the remark must appear (same number, same unit) in one of the sources the model was
   given as true: library answers, rules and facts, the clause's own rules, the datasheet rows. The clause
   itself is NOT a source: it says what is required, not what the product is. */
export function groundRemarks(remarks: string, sources: string): { remarks: string; unsupported: string[] } {
  const have = measurements(sources);
  const unsupported: string[] = [];
  let out = remarks;
  for (const m of measurements(remarks)) {
    if (have.some((h) => h.n === m.n && h.unit === m.unit)) continue;
    unsupported.push(m.raw);
    out = out.replace(m.raw, "[value]");
  }
  return { remarks: out, unsupported };
}

/* "Comply with Remarks | Offered units are ..." or "In Contractor's Scope. Installation by others" -> the remark alone */
export function trimAnswerEcho(compliance: string, remarks: string): string {
  let out = String(remarks || "").trim();
  if (!out) return out;
  const piped = /^\s*([A-Za-z' ]{3,30})\s*[|:\u2013\u2014-]\s*(.+)$/s.exec(out);
  if (piped && CHOICES.some((c) => c.toLowerCase() === piped[1].trim().toLowerCase())) out = piped[2].trim();
  for (const c of [compliance, ...CHOICES]) {
    if (!c) continue;
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['\u2019]?");
    out = out.replace(new RegExp("^\\s*" + esc + "\\s*[.:,;\u2013\u2014-]*\\s*", "i"), "");
  }
  if (!out || CHOICES.some((c) => c.toLowerCase() === out.toLowerCase().replace(/[.\s]+$/, ""))) return "";
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/* Words a consultant reads as "not sure". */
export function hedges(remarks: string): boolean {
  return /\b(should|approximately|approx\.?|typically|expected|likely|probably|we believe|may be|might)\b/i.test(remarks);
}
