/* Which product a specification is about (owner, 22 Oct 2026: "someone will run an AHU spec as FCU, an FCU spec as
   chiller ..."). A specification saved under the wrong product puts its clauses in that product's library, gets that
   product's answers and the wrong AI rules. Code reads what the text names, the way an engineer glances at a spec:
     - the product's own name (air handling unit / AHU, fan coil unit / FCU, chiller), counted three times in headings
       and in the title lines at the top;
     - the MasterFormat section number (23 73 xx / 23 74 xx AHUs, 23 82 19 fan coil units, 23 64 xx chillers);
     - a little weight for parts only that product has (EN 1886 casing classes; valve packages; compressors).
   It says "another product" only when that product clearly dominates: a spec covering several products (a schedule of
   AHUs and FCUs, an HVAC equipment section) or a short paste is left alone. */

export type ProductKey = "AHU" | "FCU" | "CHILLER";
export const PRODUCT_KEYS: ProductKey[] = ["AHU", "FCU", "CHILLER"];

/* Which product family a product's name is (the template and this check go by it): AHU, FCU, CHILLER or "". */
export function productKey(product: string): ProductKey | "" {
  const p = String(product || "").toUpperCase();
  return /AHU|AIR[\s-]*HANDL/.test(p) ? "AHU" : /FCU|FAN[\s-]*COIL/.test(p) ? "FCU" : /CHILL/.test(p) ? "CHILLER" : "";
}

type Cue = { re: RegExp; label: string };
const STRONG: Record<ProductKey, Cue[]> = {
  AHU: [
    { re: /\bair[\s-]*handling[\s-]*units?\b/gi, label: "air handling unit" },
    { re: /\b(?:F|D|R|P)?AHUs?\b/g, label: "AHU" },
    { re: /\bair[\s-]*handlers?\b/gi, label: "air handler" },
    { re: /\b23\s?7[34]\s?\d\d\b/g, label: "section 23 73 / 23 74" }
  ],
  FCU: [
    { re: /\bfan[\s-]*coil(?:[\s-]*units?)?s?\b/gi, label: "fan coil unit" },
    { re: /\bFCUs?\b/g, label: "FCU" },
    { re: /\b23\s?82\s?19\b/g, label: "section 23 82 19" }
  ],
  CHILLER: [
    { re: /\bchillers?\b/gi, label: "chiller" },
    { re: /\b(?:water|liquid)[\s-]*chilling\b/gi, label: "water chilling package" },
    { re: /\b23\s?64\s?\d\d\b/g, label: "section 23 64" }
  ]
};
const WEAK: Record<ProductKey, RegExp> = {
  AHU: /\b(EN\s?1886|EN\s?13053|casing leakage|thermal bridging|heat wheel|thermal wheel|plug fans?|mixing box(?:es)?|central[\s-]station)\b/gi,
  FCU: /\b(valve packages?|[24][\s-]pipe|room thermostats?|PICV|auxiliary drain pan|ceiling void)\b/gi,
  CHILLER: /\b(compressors?|evaporators?|condensers?|refrigerant circuits?|IPLV|NPLV|kW\/TR|crankcase heaters?)\b/gi
};
const HEADING = new Set(["part", "section", "heading", "sub", "title"]);

export interface Detected { key: ProductKey | ""; scores: Record<ProductKey, number>; named: Record<ProductKey, string[]> }

export function detectProduct(lines: { type?: string; spec?: string }[]): Detected {
  const scores: Record<ProductKey, number> = { AHU: 0, FCU: 0, CHILLER: 0 };
  const hits: Record<ProductKey, Map<string, number>> = { AHU: new Map(), FCU: new Map(), CHILLER: new Map() };
  lines.slice(0, 8000).forEach((ln, i) => {
    const text = String(ln.spec || "");
    if (!text) return;
    const w = HEADING.has(String(ln.type || "")) || i < 40 ? 3 : 1;          // headings and the title lines weigh more
    for (const k of PRODUCT_KEYS) {
      for (const c of STRONG[k]) {
        const n = (text.match(c.re) || []).length;
        if (n) { scores[k] += n * w; hits[k].set(c.label, (hits[k].get(c.label) || 0) + n); }
      }
      scores[k] += (text.match(WEAK[k]) || []).length * 0.3;
    }
  });
  // "chilled water" coils are in every AHU and FCU spec, but the word chiller is not: an AHU spec that names the chiller
  // plant a few times stays an AHU spec through the dominance rule below
  const named = {} as Record<ProductKey, string[]>;
  for (const k of PRODUCT_KEYS) named[k] = [...hits[k].entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `"${l}" ${n}x`);
  const order = [...PRODUCT_KEYS].sort((a, b) => scores[b] - scores[a]);
  const [top, second] = order;
  const clear = scores[top] >= 6 && scores[top] >= 4 * scores[second];
  return { key: clear ? top : "", scores, named };
}

const NAMES: Record<ProductKey, string> = { AHU: "air handling unit", FCU: "fan coil unit", CHILLER: "chiller" };

/* The specification is clearly about another product than the one chosen: what it is, and why (plain words), or null.
   A product with no family (a product the owner adds later) is never checked. */
export function productMismatch(chosenName: string, lines: { type?: string; spec?: string }[]): { detected: ProductKey; chosen: ProductKey; reason: string } | null {
  const chosen = productKey(chosenName);
  if (!chosen) return null;
  const d = detectProduct(lines);
  if (!d.key || d.key === chosen || d.scores[chosen] * 4 > d.scores[d.key]) return null;
  const theirs = d.named[d.key].slice(0, 3).join(", ");
  const mine = d.named[chosen].length ? d.named[chosen].slice(0, 2).join(", ") : "never";
  return { detected: d.key, chosen, reason: `It reads as ${/^[aeiou]/.test(NAMES[d.key]) ? "an" : "a"} ${NAMES[d.key]} specification: it names ${theirs}; ${NAMES[chosen]} ${d.named[chosen].length ? "only " + mine : "is never named"}.` };
}
