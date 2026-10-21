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
const STANDARD_BEFORE = /\b(NFPA|UL|ASHRAE|AHRI|ARI|AMCA|ASTM|SMACNA|ANSI|ISO|IEC|EN|BS|DIN|SASO)[\s-]*$/i;

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
    // "NFPA 90A", "UL 181A": a standard's number, not 90 amperes (a remark naming the code is not a figure)
    if (/^[a-z]$/i.test(unit) && STANDARD_BEFORE.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
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

/* ---------- the remark lock and the review priority (master prompt v4.1 essence, 19 Oct 2026) ----------
   Code, not model instructions: applied once to every draft whatever made it (datasheet, library, rule, model).
   The six answers stay (owner, 19 Oct 2026):
     Comply                 no confirming remark ("Comply", "As specified", "Noted" ...): it is blanked
     Comply with Remarks    needs its one line: without one it is a plain Comply
     Not Comply / Not Applicable   need a remark saying what / why: without one, low confidence
     In Contractor's Scope  the standard scope line when it has none
   Wording a consultant must not read (an internal source named, "please verify", TBC, a promise of a later
   document, hedging) is not rewritten: the draft goes low confidence and the reason says what to fix. */
export const SCOPE_REMARK = "By Contractor / others. Daikin scope is supply of equipment.";
const ECHO = /^(comply|complies|complied( with)?|compliant|as specified|as per (the )?spec(ification)?s?|as required|as per requirement|noted|confirmed|acknowledged|included|provided( as specified)?|accepted|agreed|ok|yes)[\s.!]*$/i;
const BANNED: [RegExp, string][] = [
  [/\b(please (verify|confirm|check)|to be (verified|confirmed|checked)|(verify|confirm|check) (with|by|before|at site))\b/i, "asks the reader to verify"],
  [/\b(tbc|tbd|pending|subject to (confirmation|approval)|to be advised)\b/i, "leaves the point open"],
  [/\b(as )?per (the )?(daikin )?(catalog(ue)?|selection( report| software)?|(technical )?data ?sheet|database|reference compliance|internal (document|data)|project knowledge|library)\b/i, "names an internal source"],
  [/\b(will be (submitted|provided|sent|furnished|issued)|shall be submitted later|to follow later|in due course|at a later stage)\b/i, "promises a later document"]
];
export function bannedIn(remarks: string): string[] {
  const out = BANNED.filter(([re]) => re.test(remarks)).map(([, why]) => why);
  if (hedges(remarks)) out.push("is not definite");
  return out;
}
export type Priority = "green" | "amber" | "red";
export interface Locked { compliance: string; remarks: string; confidence: "high" | "medium" | "low"; notes: string[] }
export function lockRemarks(compliance: string, remarks: string, confidence: "high" | "medium" | "low"): Locked {
  let c = compliance, r = String(remarks || "").replace(/\s*\n+\s*/g, " ").trim(), conf = confidence;
  const notes: string[] = [];
  if (ECHO.test(r)) r = "";
  if (c === "Comply with Remarks" && !r) c = "Comply";
  if ((c === "Not Comply" || c === "Not Applicable") && !r) { conf = "low"; notes.push(`a ${c} needs a remark saying ${c === "Not Comply" ? "what is offered" : "why"}`); }
  if (c === "In Contractor's Scope" && !r) r = SCOPE_REMARK;
  const banned = r ? bannedIn(r) : [];
  if (banned.length) { conf = "low"; notes.push("the remark " + banned.join(", ")); }
  return { compliance: c, remarks: r, confidence: conf, notes };
}
/* Where the reviewer looks: GREEN = settled by a rule, the same clause answered before, or the datasheet meeting
   it; RED = low confidence, Not Comply, or a library answer the datasheet contradicts; AMBER = the rest (model
   drafts, Comply with Remarks, similar but not identical clauses). The engineer reviews RED and AMBER. */
export function priorityOf(d: { compliance: string; confidence: string; source: string; sources?: { score: number }[] }, conflict = false): Priority {
  if (d.confidence === "low" || d.compliance === "Not Comply" || conflict) return "red";
  if (d.confidence !== "high" || d.compliance === "Comply with Remarks") return "amber";
  const top = d.sources && d.sources[0] ? d.sources[0].score : 0;
  if (d.source === "rule" || d.source === "record" || (d.source === "datasheet" && d.compliance === "Comply") || (d.source === "library-similar" && top >= 0.97)) return "green";
  return "amber";
}
