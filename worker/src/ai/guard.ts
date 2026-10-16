/* Checks made by code on every model draft before it is written (AI-Roadmap principle 2: the model writes,
   code checks). Pure functions, unit-tested in tests/worker/ai-rules.test.ts. Learnt from the first AI tool
   (ai-suggest.js), where each of these failures was seen on real specifications:
     - a remark that states a measurement no source gave ("Panel thickness is 50 mm" restating the clause's
       requirement as if it were the product) -> the number becomes [value], confidence low
     - a remark that repeats the answer ("In Contractor's Scope. In contractor's scope ...") -> trimmed
     - hedging ("should", "typically", "approximately") is not consultant-ready -> confidence low
   Bare numbers are left alone: "AHRI 430" and "Section 23 73 13" are references, not measurements. */
import { CHOICES } from "../lib/cm";

// Units as specifications write them, symbols and words ("2.5 meters per second", "2 percent", "0.035 inches",
// "0.68 W/square meter. K", "44 kg/cubic meter"): a figure the code cannot read cannot be compared or checked.
const UNIT_LIST = [
  "met(?:er|re)s?\\s+per\\s+second", "per\\s?cent",
  "inch(?:es)?\\s+(?:of\\s+)?(?:water(?:\\s+gauge|\\s+column)?|w\\.?\\s?g\\.?|w\\.?\\s?c\\.?)", "in\\.?\\s?w\\.?g\\.?", "inch(?:es)?",
  "w\\s?\\/\\s?\\(?\\s?(?:square\\s+met(?:er|re)|sq\\.?\\s?m|m2|m²)\\.?\\s?(?:k|°c|deg\\s?c)\\)?",
  "kg\\s?\\/\\s?(?:square\\s+met(?:er|re)|sq\\.?\\s?m|m2|m²)", "kg\\s?\\/\\s?(?:cubic\\s+met(?:er|re)|cu\\.?\\s?m|m3|m³)",
  "degrees?\\s+(?:celsius|fahrenheit|c|f)", "millimet(?:er|re)s?", "met(?:er|re)s?", "feet", "foot", "ft", "pounds?", "lbs?",
  "mm", "cm", "m", "km", "kg", "g", "t", "kw", "w", "mw", "kwr", "tr", "btu\\/h", "btuh", "kcal\\/h", "pa", "kpa", "bar", "psi", "%",
  "micron", "microns", "µm", "um", "°c", "deg\\s?c", "c", "°f", "f", "db", "dba", "db\\(a\\)", "m\\/s", "fpm", "m3\\/h", "m³\\/h", "cmh",
  "l\\/s", "lps", "cfm", "rpm", "hz", "v", "vac", "a", "amp", "amps", "hours", "hrs", "h", "years", "yrs", "ip\\d{2}"
];
// longest first, so "m/s" wins over "m", "mm" over "m" and "meters per second" over "meters" (sorted as a list:
// several entries hold groups with "|" inside, so the joined pattern must never be split again)
const UNIT_RE = UNIT_LIST.slice().sort((a, b) => b.replace(/\\/g, "").length - a.replace(/\\/g, "").length).join("|");
// "1,200 l/s" is twelve hundred (comma before exactly three digits = thousands); "1,5 mm" is one and a half;
// "10-m/s" and "1000-Pa" (a hyphen between figure and unit) are read as "10 m/s" and "1000 Pa"
const MEASURE = new RegExp(`(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?(?!\\d)|\\d+(?:[.,]\\d+)?)\\s*-?\\s*(${UNIT_RE})(?![a-z0-9])`, "gi");

export interface Measure { n: number; unit: string; raw: string }

function unitKey(u: string): string {
  const s = u.toLowerCase().replace(/\s+/g, "").replace(/³/g, "3").replace(/²/g, "2").replace(/°/g, "");
  if (/^met(er|re)s?persecond$/.test(s)) return "m/s";
  if (/^percent$/.test(s)) return "%";
  if (/^(inch|inches|in)\.?(of)?(water|w\.?g|w\.?c)/.test(s)) return "in.wg";
  if (/^inch(es)?$/.test(s)) return "in";
  if (/^w\/\(?(squaremet(er|re)|sq\.?m|m2)\.?(k|c|degc)\)?$/.test(s)) return "w/m2k";
  if (/^kg\/(squaremet(er|re)|sq\.?m|m2)$/.test(s)) return "kg/m2";
  if (/^kg\/(cubicmet(er|re)|cu\.?m|m3)$/.test(s)) return "kg/m3";
  if (/^degrees?(celsius|c)$/.test(s)) return "c";
  if (/^degrees?(fahrenheit|f)$/.test(s)) return "f";
  if (/^millimet(er|re)s?$/.test(s)) return "mm";
  if (/^met(er|re)s?$/.test(s)) return "m";
  if (/^(feet|foot|ft)$/.test(s)) return "ft";
  if (/^(pound|pounds|lb|lbs)$/.test(s)) return "lb";
  const alias: Record<string, string> = { degc: "c", microns: "micron", um: "micron", "µm": "micron", hrs: "h", hours: "h", yrs: "years", lps: "l/s", cmh: "m3/h", amps: "a", amp: "a", vac: "v", btuh: "btu/h", "db(a)": "dba" };
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
