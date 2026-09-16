/**
 * The fabrication guard, shared.
 * =============================================================================
 * A measured value in an answer that appears in neither the question nor
 * anything the model was given is not something it could have known. This is
 * the last line of defence against a confident invented number, and it is the
 * single most important check in the whole answer path: a wrong sentence gets
 * argued with, a wrong number gets quoted to a consultant.
 *
 * Lifted out of functions/api/compliance/ask.js so that "Ask your graph" runs
 * the identical check. Two copies of a rule like this drift, and the copy that
 * drifts is always the one guarding the newer surface.
 */

/* Units that actually appear in this domain. Deliberately not \\w+: matching
   any trailing letters would treat "3 options" and "5 projects" as measured
   values and flag every answer that counts something. */
const MEASURE_RE =
  /(\d+(?:\.\d+)?)\s*(mm|cm|m\/s|kw|kg|pa|db|dba|micron|microns|µm|um|swg|inch|ppm|bar|hz|l\/s|cfm|m3\/h|k|°c|c|%|m)(?![a-z0-9])/gi;

export function measures(text) {
  const out = [];
  const s = String(text || '');
  let m;
  MEASURE_RE.lastIndex = 0;
  while ((m = MEASURE_RE.exec(s)) !== null) {
    out.push({ num: parseFloat(m[1]), unit: m[2].toLowerCase(), raw: m[0].trim() });
  }
  return out;
}

export function sameMeasure(a, b) {
  return !!a && !!b && a.unit === b.unit && Math.abs(a.num - b.num) < 1e-9;
}

/**
 * Measured values in `answer` that `allowed` cannot account for.
 *
 * Returns the raw strings, so the caller can name them to the reader rather
 * than saying something vague about the answer being unreliable.
 */
export function unsupportedMeasures(answer, allowed) {
  const known = measures(allowed);
  const seen = new Set();
  return measures(answer)
    .filter((a) => !known.some((k) => sameMeasure(k, a)))
    .filter((a) => (seen.has(a.raw) ? false : (seen.add(a.raw), true)))
    .map((a) => a.raw);
}
