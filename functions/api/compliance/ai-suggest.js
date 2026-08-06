// functions/api/compliance/ai-suggest.js
// POST { product, items: [{ spec, context }], selectionFields?, selection? }
// Returns { suggestions: [{ status, remarks }] } aligned by index.
//
// Three-step priority per clause: (1) selection datasheet fields — the
// project's actual selected equipment data, OPTIONAL; (2) library — past
// verified answers already attached to each clause; (3) general guidance
// as a last resort, defaulting to TO VERIFY when nothing supports an
// answer. A false "Comply" is the most critical failure.
//
// Requires a Workers AI binding named "AI" on the Pages project.

import {
  requireUser, json, PRODUCTS, isValidFactory, complianceTier, withErrorHandling,
  loadFacts, pickFacts, factsBlock, loadSectionProfiles, normPath,
  learnUnitSections, loadUnitSections, unitSectionsBlock,
  candidateTerms, noteTerms, loadTerms, aliasGroups, plausibilityNote,
  loadSpecTopics, topicForPath, topicLine,
  loadCriteria, matchCriterion, compareValues, compareClasses, classTokens,
  loadOptions, offeringBlock,
} from '../../_compliance.js';

// Model note (2026-08-02): '@cf/meta/llama-3.1-8b-instruct' was deprecated
// by Cloudflare on 2026-05-30 — calling it now fails at the platform level
// (a 502 with a non-JSON body, since the request never reaches a real
// model). The '-fast' variant is explicitly confirmed to remain active in
// Cloudflare's own deprecation notice, same model family/behavior, so it's
// the minimal-risk fix. If this ever needs changing again, check
// https://developers.cloudflare.com/workers-ai/models/ for current IDs.
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_ITEMS = 3;   // lowered again: with a real datasheet attached (fields
                        // + fallback text), 3 clauses keeps total prompt size
                        // small enough to finish well inside platform limits
const MAX_TEXT = 1200;

// Allowed status vocabulary (from the compliance engine prompt). Anything
// the model returns outside this list is coerced to TO VERIFY.
const STATUSES = ['Comply', 'Deviation', 'Not Comply', 'By Contractor', 'TO VERIFY'];

// NOTHING ABOUT A PRODUCT OR A FACTORY IS HARDCODED HERE. What used to be a
// FACTORY_CONFIG constant (panel supplier, filter brand, fan model, leakage
// classes) is now rows in compliance_facts, retrieved per batch and scored
// against the clauses actually being answered. An empty knowledge base is a
// valid state: the prompt then says so and the model works from the
// selection datasheet and past verified answers alone.


/* ==========================================================================
   DATASHEET GROUNDING
   --------------------------------------------------------------------------
   The failure this exists to stop: a clause says "modules shall be 50 mm
   thick", the datasheet says "Panel • Insulation: 62 mm", and the model
   answers "Panel thickness is 50mm" — restating the REQUIREMENT as though it
   were the product's actual value. That is the most dangerous output this
   tool can produce, because it reads exactly like a verified fact.

   Three things were wrong, and all three are fixed in code rather than by
   asking the prompt more firmly:

   1. The model had to find the right field itself, among all 17, with no
      hint that "casing thickness" and "Panel • Insulation" are the same
      subject. Now the relevant fields are matched here and attached to the
      clause they belong to.
   2. The model had to do the arithmetic. Now the comparison is computed and
      stated as fact, and the model only writes the sentence.
   3. Nothing checked the answer afterwards. Now a measurement that appears
      in the clause but in no source is caught and the answer downgraded.
   ========================================================================== */

// Vocabulary, not product knowledge: these are words for the same subject in
// specification English. Deliberately NOT in the database — a factory's facts
// belong there, but "casing" and "panel" being the same thing is a property
// of the language, not of any factory. Extend freely.
const TERM_GROUPS = [
  ['casing', 'casings', 'panel', 'panels', 'skin', 'wall', 'enclosure', 'module', 'modules'],
  ['thickness', 'thick', 'depth', 'gauge', 'insulation', 'insulated'],
  ['filter', 'filters', 'filtration'],
  ['fan', 'fans', 'blower', 'impeller'],
  ['coil', 'coils'],
  ['motor', 'motors', 'drive'],
  ['control', 'controls', 'controller', 'bms'],
  ['damper', 'dampers'],
  ['leakage', 'leak', 'tightness'],
  ['sound', 'noise', 'acoustic'],
  ['drain', 'tray', 'pan'],
  ['frame', 'framework', 'profile'],
];

function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

// A clause's vocabulary plus every synonym of it, so "casing" reaches a field
// labelled "Panel".
function expandTerms(list, extraGroups = []) {
  const out = new Set(list);
  const groups = TERM_GROUPS.concat(extraGroups);
  list.forEach(w => groups.forEach(g => { if (g.includes(w)) g.forEach(x => out.add(x)); }));
  return out;
}

// Field labels arrive tagged with the unit section they came from, e.g.
// "Coil Cooling DX Supply • Tube Material • Thickness". This reads that tag.
function sectionOf(label) {
  const parts = String(label || '').split('\u2022');
  return parts.length > 1 ? parts[0].trim() : '';
}

// A field belongs to this clause only if the clause is ABOUT that section.
//
// This gate is the whole point of tagging fields by section. The unit in
// front of us has "Tube Material • Thickness: Copper • 0.4 mm" on the cooling
// coil. A clause about CASING thickness matches that field on the word
// "thickness" alone, and would be answered with the coil's tube gauge —
// a plausible-looking number from the wrong part of the machine, which is
// worse than no answer at all.
//
// Whole-unit data (Unit Data, or an untagged field from the AI extraction
// pass) is always eligible: it describes the machine, not one section of it.
function sectionApplies(clauseWords, label) {
  const sec = sectionOf(label);
  if (!sec || /^unit$/i.test(sec)) return true;
  const secWords = words(sec).filter(w => w !== 'supply' && w !== 'return' && w !== 'section');
  if (!secWords.length) return true;
  return secWords.some(w => clauseWords.has(w));
}

// The datasheet fields that actually concern THIS clause, best first.
function fieldsForClause(clauseText, fields, limit = 4, extraGroups = []) {
  const want = expandTerms(words(clauseText), extraGroups);
  return fields
    .filter(f => sectionApplies(want, f.label))
    .map(f => {
      const ft = words(f.label + ' ' + f.value);
      let hits = 0;
      for (const w of ft) if (want.has(w)) hits++;
      return { f, score: ft.length ? hits / Math.sqrt(ft.length) : 0 };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.f);
}

// Numbers that carry a unit of measurement. Bare numbers are ignored on
// purpose: "AHRI 430" and "Section 237313" are references, not measurements,
// and restating them is perfectly correct.
const MEASURE_RE = /(\d+(?:\.\d+)?)\s*(mm|cm|m|kg|kw|w|pa|%|micron|deg|°c)\b/gi;

function measurements(text) {
  const out = [];
  const re = new RegExp(MEASURE_RE);
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push({ n: parseFloat(m[1]), unit: m[2].toLowerCase(), raw: m[0].trim() });
  }
  return out;
}

// The arithmetic, done here so the model never has to. It states facts and
// refuses to conclude: whether 62mm against a 50mm requirement is Comply or
// Deviation is a commercial judgement, and that stays with the model and the
// engineer reviewing it.
// The comparison, decided here rather than by the model — including which
// way is BETTER. "62 mm where 50 mm was asked" is not a deviation; it is a
// thicker panel, and the tool used to answer Not Comply on exactly that.
//
// When the direction is not established, the check says so and explicitly
// forbids concluding Not Comply from the number. An unknown direction is a
// reason to ask, never a reason to fail a compliant unit.
// The same comparisons as comparisonCheck, as data rather than prose.
function verdictsFor(clauseText, relevant, criteria) {
  const out = [];
  for (const r of measurements(clauseText)) {
    for (const f of relevant) {
      for (const g of measurements(f.value).filter(x => x.unit === r.unit)) {
        const v = compareValues(r.n, g.n, matchCriterion(f.label + ' ' + clauseText, criteria, r.unit));
        if (v) out.push({ ok: v.ok, text: `${g.raw} against a required ${r.raw} — ${v.why}` });
      }
    }
  }
  for (const rc of classTokens(clauseText)) {
    for (const f of relevant) {
      for (const ac of classTokens(f.value)) {
        if (ac === rc) continue;
        const v = compareClasses(rc, ac, matchCriterion(f.label + ' ' + clauseText + ' ' + rc, criteria, ''));
        if (v) out.push({ ok: v.ok, text: `${ac} against a required ${rc} — ${v.why}` });
      }
    }
  }
  return out;
}

function comparisonCheck(clauseText, relevant, criteria) {
  const lines = [];
  const req = measurements(clauseText);

  for (const r of req) {
    for (const f of relevant) {
      for (const g of measurements(f.value).filter(x => x.unit === r.unit)) {
        const crit = matchCriterion(f.label + ' ' + clauseText, criteria, r.unit);
        const v = compareValues(r.n, g.n, crit);
        if (v) {
          lines.push(`  - Clause requires ${r.raw}. This unit is ${g.raw} (${f.label}), which ${v.why}. ` +
            `Correct status: ${v.ok ? 'Comply' : 'Not Comply or Deviation'}. ` +
            `State ${g.raw} as the value — never ${r.raw}.`);
        } else {
          lines.push(`  - Clause requires ${r.raw}. This unit is ${g.raw} (${f.label}). Whether ` +
            `${g.raw} is better or worse than ${r.raw} for this property is NOT established — ` +
            `do NOT answer Not Comply on the difference alone. State ${g.raw} and use TO VERIFY ` +
            `unless a past verified answer settles the direction.`);
        }
      }
    }
  }

  // Classed values — TB2 against TB3, F9 against F7. The digits do not agree
  // on a direction, so the ordering comes from the criterion's scale.
  const reqClasses = classTokens(clauseText);
  for (const rc of reqClasses) {
    for (const f of relevant) {
      for (const ac of classTokens(f.value)) {
        if (ac === rc) continue;
        const crit = matchCriterion(f.label + ' ' + clauseText + ' ' + rc, criteria, '');
        const v = compareClasses(rc, ac, crit);
        if (!v) continue;
        lines.push(`  - Clause requires class ${rc}. This unit is ${ac} (${f.label}), which ${v.why}. ` +
          `Correct status: ${v.ok ? 'Comply' : 'Not Comply or Deviation'}. State ${ac}.`);
      }
    }
  }

  if (!lines.length) return '';
  return `\n  COMPUTED COMPARISON (already decided for you — do not re-derive it, and do not ` +
    `contradict it):\n` + lines.join('\n');
}

// Phrases the prompt shows as illustrations. A small model parrots these
// onto clauses they do not fit — which is exactly what happened: a casing
// thickness clause came back answered "Comply as equivalent. Daikin AHUs
// comply with EUROVENT standards", and an insulation clause came back with
// the example's own "0.7mm galvanized outer skin, 42mm PU foam insulation".
// Both were example text, reproduced word for word, on the wrong clauses.
//
// Telling the model not to reuse them does not work, so the examples no
// longer contain real values AND anything matching one is discarded here.
// The By Contractor sentence is deliberately absent: that one is meant to be
// reproduced exactly.
const ECHO_PHRASES = [
  'comply as equivalent. daikin ahus comply with eurovent standards',
  'galvanized outer skin',
  'pu foam insulation',
  'requires a specific filter class not in the datasheet or library',
  'daikin ahu standard construction includes this feature',
];

function withdraw(reason) {
  return { status: 'TO VERIFY', remarks: reason, verified: false, guarded: true };
}

// Everything checked after the model answers, in one place.
//
// The principle behind all four checks: a remark is only allowed to contain
// what a source actually said. An answer that cannot be traced is withdrawn
// rather than shown, because a blank row costs a few minutes of someone's
// time and a confident wrong answer costs a commitment nobody agreed to.
function guardAnswer(suggestion, meta, sourceText) {
  if (!suggestion || !suggestion.remarks) return suggestion;
  const remark = String(suggestion.remarks);
  const low = remark.toLowerCase();

  // 1. Placeholder leaked out of an example pattern.
  if (/\[[^\]]{2,40}\]/.test(remark)) {
    return withdraw('AI returned an unfilled template. Answer this clause manually.');
  }

  // 2. Example text reproduced on a clause it does not fit.
  if (ECHO_PHRASES.some(ph => low.includes(ph))) {
    return withdraw('AI repeated a sample answer instead of answering this clause. Answer it manually.');
  }

  // 3. A measurement no source provided. This now covers BOTH failure modes:
  //    restating the clause's own requirement as the product value, and
  //    inventing a value from nowhere. Earlier only the first was caught,
  //    which is why "42mm PU foam" survived — 42 appears in neither the
  //    clause nor the datasheet, so nothing objected to it.
  const inRemark = measurements(remark);
  const inSource = measurements(sourceText);
  const unsupported = inRemark.filter(m => !inSource.some(s => s.n === m.n && s.unit === m.unit));
  if (unsupported.length) {
    return withdraw('Requires confirmation of ' + unsupported.map(m => m.raw).join(', ') +
      ' against the selected unit — no datasheet field or past answer states that value.');
  }

  // 5. The answer contradicts a comparison that was already decided. This
  //    is the failure that made a compliant unit look non-compliant: 62 mm
  //    of insulation where 50 mm was asked for is a BETTER panel, and the
  //    model answered Not Comply because the numbers differed. It is caught
  //    in both directions — a false Comply against a genuinely worse value
  //    is the more expensive mistake of the two.
  if (meta && meta.verdicts && meta.verdicts.length) {
    const st = String(suggestion.status || '').toLowerCase();
    const saysNo = /not comply|deviation/.test(st);
    const saysYes = /^comply/.test(st);
    const satisfied = meta.verdicts.filter(v => v.ok);
    const failed = meta.verdicts.filter(v => !v.ok);
    if (saysNo && satisfied.length && !failed.length) {
      return withdraw('This unit meets the requirement: ' + satisfied[0].text +
        '. The AI answered ' + suggestion.status + ' anyway. Confirm and answer manually.');
    }
    if (saysYes && failed.length) {
      return withdraw('This unit does NOT meet the requirement: ' + failed[0].text +
        '. The AI answered Comply anyway. Confirm and answer manually.');
    }
  }

  // 4. The datasheet answered this clause and the model ignored it. When a
  //    computed measurement check was supplied, the remark must cite one of
  //    those values; talking about certification instead is answering a
  //    different question.
  if (meta && meta.expect && meta.expect.length) {
    const cited = meta.expect.some(v => inRemark.some(m => m.n === v.n && m.unit === v.unit));
    if (!cited) {
      return withdraw('The datasheet states ' + meta.expect.map(v => v.raw).join(', ') +
        ' for this clause and the AI answer did not address it. Confirm and answer manually.');
    }
  }

  return suggestion;
}

function buildSystemPrompt(product, factory, itemCount, hasDatasheet, reference) {
  return (
`You are the Compliance Sheet Engine for Daikin Applied Products — ${factory} Factory, ${product}. Your output goes into compliance matrices submitted to MEP consultants under Daikin's name.

PRIORITY ORDER: 1. Accuracy  2. Traceability  3. Completeness  4. Speed.
A false "Comply" is the most critical failure. An empty field is preferable to an incorrect value.

ANSWER EACH CLAUSE IN THIS EXACT ORDER — stop at the first step that resolves it:

STEP 1 — SELECTION DATASHEET FIELDS (highest authority; project-specific, overrides everything else). Any answer from this step is "verified": true.
${hasDatasheet
  ? 'A "DATASHEET FIELDS" list is provided below (Label: Value, extracted from the actual project selection report). ' +
    'For any clause stating a requirement with a number, material, class, or rating (e.g. "casing thickness shall be minimum 1mm", ' +
    '"filter class shall be F7 or better"), FIRST search these fields for the matching value (e.g. a "Panel • Insulation" or ' +
    '"Panel Inner Skin" field for a casing-thickness clause) and compare it numerically/technically against the requirement. ' +
    'If the field satisfies the requirement, status is Comply and the remark states the actual value from the datasheet ' +
    '(e.g. "0.7mm galvanized outer skin, 42mm PU foam insulation"). If the field contradicts the requirement, status is Not Comply, ' +
    'citing the actual value. A raw fallback text block may also be provided for anything not in the fields list — use it the same way. ' +
    'Only if the datasheet has no field relevant to this clause, proceed to Step 2.'
  : 'No selection datasheet was provided for this conversion. Skip this step and proceed to Step 2 for every clause.'}

STEP 2 — LIBRARY (past verified answers attached to each clause, from Daikin's approved ${product} compliance library). Any answer from this step is "verified": true.
Only reached if Step 1 did not resolve the clause. If a past verified answer is provided and clearly addresses this clause, use its status and follow its remark wording. Equivalency: if a past verified answer documents an equivalent standard, status is "Comply" with remark beginning "Comply as equivalent."

STEP 3 — BEST-EFFORT CONSTRUCTED ANSWER (only if Steps 1 and 2 did not resolve the clause).
Every clause gets an answer — do not leave this step with TO VERIFY as your first instinct.
${reference}
Look at the PAST VERIFIED ANSWERS provided with nearby/similar clauses (even if none was an exact match for Step 2) and the general pattern of how ${product} clauses in this section tend to be answered. Construct the MOST LIKELY status and a short, plausible remark by following that pattern — the same way an experienced engineer would sketch a first-pass answer before checking it.
Set "verified": false on every Step 3 answer (Steps 1 and 2 answers are "verified": true). This is what marks it as a starting point, not a checked fact — never write "GUESS" or similar into the remarks text yourself, the server adds that marking.
HARD LIMIT — do not invent SPECIFIC technical facts you have no basis for: no fabricated dimensions, thicknesses, model numbers, ratings, or standard numbers. A qualitative pattern-based guess is fine ("Comply — Daikin ${product} standard construction includes this feature"); a specific fabricated number is not. If the clause can ONLY be answered with a specific number/fact you don't have (e.g. an exact filter class, a project-specific dimension) and no pattern gives you a defensible one, status is TO VERIFY with "verified": false and a remark naming what's missing — this is the one case TO VERIFY is still correct.
NEVER estimate, interpolate, calculate, or use general HVAC knowledge for a NUMBER — general pattern-following for a STATUS/qualitative remark is what Step 3 is for; inventing a specific fact is not.

Each clause includes its location in the specification hierarchy (e.g. "PART 2 PRODUCTS \u2192 2.02 CASING"). Answer strictly in that context for the ${product} — a requirement under CASING is about the ${product} casing, and so on. The section path is context only, never a technical data source.

STATUS RULES — status must be exactly one of: Comply | Deviation | Not Comply | By Contractor | TO VERIFY
- By Contractor: any site-execution requirement (installation, erection, rigging, lifting, unloading, storage, positioning, alignment, anchoring, assembly, duct connection, piping, electrical connection, touch-up painting, site testing, commissioning labour). Remark must be VERBATIM, word for word, nothing added before or after: "By Contractor / Others. Daikin scope is equipment supply only." Never classify these as Comply, Deviation, or Not Comply.
- Deviation: ONLY from a Step 1 or Step 2 source — never a Step 3 guess. A guessed Deviation would misrepresent what Daikin actually offers; if you're not sure, that's TO VERIFY, not a guessed Deviation.
- Not Comply: ONLY from a Step 1 or Step 2 source — never a Step 3 guess, for the same reason. Guessing "Not Comply" can be as damaging as a false "Comply".
- TO VERIFY: ambiguous wording (never interpret ambiguity), or a Step 3 clause needing a specific fact you don't have.
- Step 3 (verified: false) may ONLY produce Comply or TO VERIFY — never a guessed Deviation or Not Comply.

SECTION CONTEXT:
- A clause with a PARENT CLAUSE is a list item continuing it (e.g. parent "The unit shall be fabricated with fan plus accessories, including:" with item "Cooling coil section." means: the ${product} shall include a cooling coil section). Always read the item together with its parent; never answer a list item in isolation.
- If the section path shows the clause belongs to a different discipline or equipment than ${product} scope, status is TO VERIFY.

REMARK STYLE (consultant-facing):
- Definitive, concise, one or two sentences that close the issue.
- Forbidden words: should, approximately, typically, expected, likely, we believe.
- Never mention internal catalogues, datasheets, selection reports, or file names — state the value itself, not its source document.
- NEVER REPEAT A MEASUREMENT FROM THE CLAUSE AS THE PRODUCT'S VALUE. The clause states what is REQUIRED; only a datasheet field or a past verified answer states what the product IS. If the clause asks for 50 mm and the datasheet says 62 mm, the answer says 62 mm. If the clause asks for 50 mm and no source states a thickness at all, you do not know the thickness — that is TO VERIFY, not "50 mm".
- Follow the wording style of the past verified answers closely.

SHAPE OF A GOOD REMARK (these are patterns, NOT text to copy — every one of
them is missing the actual values on purpose, and you must fill them from the
datasheet fields and past answers supplied with the clause):
- Datasheet-backed: state the unit's real measured value and what it is.
    {"status":"Comply","remarks":"[actual value from the datasheet field] [what it is].","verified":true}
- Equivalency: name the standard the CLAUSE asked about, not a different one.
    {"status":"Comply","remarks":"Comply as equivalent. [the standard this clause names].","verified":true}
- Site work: this one wording is fixed and is the only text you may reproduce exactly.
    {"status":"By Contractor","remarks":"By Contractor / Others. Daikin scope is equipment supply only.","verified":true}
- Qualitative, no measurement available:
    {"status":"Comply","remarks":"Standard construction includes this feature.","verified":false}
- Nothing supports an answer:
    {"status":"TO VERIFY","remarks":"Requires [the specific thing missing], not in the datasheet or library.","verified":false}

DO NOT COPY ANY EXAMPLE TEXT. Square brackets above mark places where a real
value belongs; an answer containing brackets, or repeating an example's
wording on a clause it does not fit, is a failed answer and will be discarded.

BAD: {"status":"TO VERIFY","remarks":"TO VERIFY","verified":false} — the remark must never just repeat the status word.
BAD: {"status":"Comply","remarks":"Panel thickness is 1.2mm.","verified":false} — never state a measurement no source gave you.
BAD: answering a thickness clause by talking about certification, or a certification clause by quoting a dimension — the remark must answer THE CLAUSE IN FRONT OF YOU.

OUTPUT: ONLY a JSON array, no markdown, no commentary — exactly ${itemCount} objects in the same order as the clauses:
[{"status":"...","remarks":"...","verified":true|false}, ...]`
  );
}

// GET -> { mode } for the signed-in user. The tool uses this to decide
// whether to show the AI button at all.
async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);
  // SERVER-SIDE gate — the real enforcement. Hiding the button in the UI is
  // convenience; this line is the permission. Access follows the `ai-review`
  // item in the catalogue, so it is granted in /admin/ like anything else on
  // the site — by plan, or by an explicit per-user grant.
  const tier = await complianceTier(context);
  if (tier.tier !== 'pro') {
    return json({ error: 'AI clause review is not enabled on your account yet — ask an admin for access.' }, 403);
  }
  if (!context.env.AI) {
    return json({ error: 'AI binding not configured — add a Workers AI binding named "AI" to the Pages project.' }, 500);
  }

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a valid product' }, 400);
  const factory = String(body.factory || '').trim();
  if (!isValidFactory(product, factory)) return json({ error: 'Select a valid factory for ' + product }, 400);

  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS);
  if (!items.length) return json({ suggestions: [] });

  // The project selection datasheet is OPTIONAL. When present, structured
  // fields (Label: Value, extracted client-side from the actual PDF) are
  // the primary source — far more reliable for the model to check a
  // specific value against (e.g. "casing thickness") than a wall of raw
  // text, which selection-report PDFs often extract in a jumbled column
  // order. Raw text is kept only as a fallback for anything outside the
  // known field dictionary.
  const fields = (Array.isArray(body.selectionFields) ? body.selectionFields : [])
    .slice(0, 40)
    .map(f => ({ label: String(f.label || '').slice(0, 80), value: String(f.value || '').slice(0, 200) }))
    .filter(f => f.label && f.value);
  // The sections this unit is built from, read off the selection report.
  // Learned into the product's catalogue as drafts for an admin to confirm —
  // a datasheet is evidence, not authority.
  const unitSections = (Array.isArray(body.unitSections) ? body.unitSections : [])
    .map(n => String(n || '').trim()).filter(Boolean).slice(0, 30);
  if (unitSections.length) {
    try { await learnUnitSections(context, product, unitSections); }
    catch (err) { console.error('[ai-suggest] could not learn unit sections:', err && err.message); }
  }

  const selectionRaw = String(body.selection || '').slice(0, 1500).trim();
  const hasDatasheet = fields.length > 0 || selectionRaw.length >= 40;

  let datasheetBlock = '';
  if (hasDatasheet) {
    datasheetBlock = 'DATASHEET FIELDS (extracted from the project selection report — authorized source #1):\n';
    if (fields.length) {
      datasheetBlock += fields.map(f => `- ${f.label}: ${f.value}`).join('\n') + '\n';
    } else {
      datasheetBlock += '(none recognized by the field parser)\n';
    }
    if (selectionRaw) {
      datasheetBlock += '\nRaw datasheet text (fallback, may be unordered — use only if a needed value isn\'t in the fields above):\n"""\n' + selectionRaw + '\n"""\n';
    }
  }

  // ---- learned knowledge, retrieved for THIS batch -------------------
  // Facts scored against the clauses in hand; section profiles keyed on the
  // hierarchy path the parser produced. Both come from D1 and both may be
  // empty, which is a normal state on a new install.
  const clauseTexts = items.map(it => String(it.spec || '') + ' ' + String(it.path || ''));
  const reference = factsBlock(product, factory, pickFacts(clauseTexts, await loadFacts(context, product, factory)));
  const profiles = await loadSectionProfiles(context, product, factory, items.map(it => it.path || ''));
  const sectionBlock = unitSectionsBlock(product, unitSections, await loadUnitSections(context, product));
  // What KIND of question each clause's section asks — product requirement,
  // contractor scope, or standards. Confirmed sections only.
  const specTopics = await loadSpecTopics(context, product);
  // Which way is better for each kind of value. Configured criteria for this
  // product override the built-in engineering defaults.
  const criteria = await loadCriteria(context, product);
  // What the factory builds, gathered from past selection reports. Matters
  // most when NO datasheet is attached: without it those clauses could only
  // ever be answered TO VERIFY.
  const offering = offeringBlock(product, await loadOptions(context, product), hasDatasheet);

  // Vocabulary. Discovery is silent and free — terms are only RECORDED here,
  // never described, because describing costs an AI call and is a decision.
  const vocab = await loadTerms(context, product);
  try {
    const seen = [];
    items.forEach(it => candidateTerms(it.spec).forEach(t => seen.push(t)));
    if (seen.length) await noteTerms(context, product, seen);
  } catch (err) { console.error('[ai-suggest] term discovery:', err && err.message); }

  // Confirmed aliases extend the field matcher at runtime, so a term approved
  // in /admin/ improves matching without a deploy.
  const runtimeGroups = aliasGroups(vocab);

  // A short glossary for the terms actually in this batch. Explicitly labelled
  // as general industry meaning, and explicitly NOT a source for an answer —
  // it is here so the model understands the words, not so it can quote them.
  const batchTerms = vocab.filter(t =>
    items.some(it => String(it.spec || '').toLowerCase().includes(t.term_norm))).slice(0, 8);
  const glossary = batchTerms.length
    ? '\nGLOSSARY (general industry meaning — context only, NEVER a source for an answer ' +
      'and never quoted as this unit\'s specification):\n' +
      batchTerms.map(t => `- ${t.term}: ${t.definition}` +
        (t.typical_range ? ` Typically ${t.typical_range} across the market.` : '')).join('\n') + '\n'
    : '';

  const clauseMeta = [];
  const clauseBlock = items.map((it, i) => {
    const spec = String(it.spec || '').slice(0, MAX_TEXT);
    const path = String(it.path || '').slice(0, 300);
    const ctx = (Array.isArray(it.context) ? it.context : []).slice(0, 5)
      .map(c => `    - Past clause: "${String(c.spec || '').slice(0, 300)}"\n` +
                `      Verified answer: status="${String(c.compliance || '').slice(0, 200)}", ` +
                `remark="${String(c.remarks || '').slice(0, 200)}"`)
      .join('\n');
    // What this section IS, learned from confirmed answers rather than from
    // a rule someone wrote. Absent for a section nobody has answered yet —
    // and saying nothing is better than guessing at the subject matter.
    const prof = profiles.get(normPath(path));
    const profLine = prof
      ? `\n  About this section (learned from ${prof.n_answers} confirmed answer(s)): ${prof.summary}` +
        (prof.typical_status ? `\n  Status most often correct here: ${prof.typical_status}` : '')
      : '';
    // The datasheet fields that concern THIS clause, attached to it rather
    // than left in a list of seventeen at the top of the prompt for the
    // model to search. This is what connects "casing thickness" to a field
    // labelled "Panel • Insulation".
    const relevant = fieldsForClause(spec + ' ' + path, fields, 4, runtimeGroups);
    // The datasheet values this clause's answer is expected to address:
    // same unit as the clause's own requirement. If these exist and the
    // answer ignores them, it answered a different question.
    const reqUnits = new Set(measurements(spec).map(m => m.unit));
    clauseMeta[i] = {
      spec,
      expect: relevant.flatMap(f => measurements(f.value)).filter(m => reqUnits.has(m.unit)),
      // The verdicts the comparison already reached, so a contradicting
      // answer can be caught rather than shipped.
      verdicts: verdictsFor(spec, relevant, criteria),
    };
    const fieldLines = relevant.length
      ? `\n  DATASHEET FIELDS FOR THIS CLAUSE (authorized source #1 — the product's ACTUAL values):\n` +
        relevant.map(f => `    - ${f.label}: ${f.value}`).join('\n')
      : (fields.length ? '\n  No datasheet field matches this clause.' : '');

    return `CLAUSE ${i + 1}: "${spec}"` +
      (path ? `\n  Location in specification: ${path}` : '') +
      topicLine(topicForPath(specTopics, path)) + profLine +
      fieldLines + comparisonCheck(spec, relevant, criteria) +
      (ctx ? `\n  Past verified answers (Step 2 source):\n${ctx}`
           : '\n  Past verified answers: none for this clause.');
  }).join('\n\n');

  const userMsg = (datasheetBlock ? datasheetBlock + '\n' : '') +
                  (sectionBlock ? sectionBlock + '\n' : '') +
                  (offering ? offering + '\n' : '') + glossary + clauseBlock;

  // ---- ask, then ask again if the answer was empty ---------------------
  // An 8B model under a JSON grammar will occasionally satisfy the schema
  // with an EMPTY array: `{"suggestions":[]}`. That is not a refusal and it
  // is not a crash — it is the model running out of room to think while the
  // grammar still forces well-formed output, and it happens more often the
  // longer the prompt is. So an empty result is treated as a retryable
  // condition rather than a verdict:
  //   1. full prompt (facts, section profiles, datasheet, past answers)
  //   2. same clauses, stripped prompt — the single biggest lever, since
  //      length is what causes this
  //   3. one clause at a time, which nearly always lands
  // Only after all three does a clause come back unanswered.
  const sysFull = buildSystemPrompt(product, factory, items.length, hasDatasheet, reference);
  let attempt, passes = 1;
  try {
    attempt = await askModel(context, sysFull, userMsg, items.length);
  } catch (err) {
    return json({ error: err.message }, 502);
  }

  if (!usable(attempt.suggestions) && items.length) {
    const sysTerse = buildTersePrompt(product, factory, items.length);
    const terseUser = (fields.length
      ? 'DATASHEET FIELDS:\n' + fields.slice(0, 15).map(f => `- ${f.label}: ${f.value}`).join('\n') + '\n\n'
      : '') +
      items.map((it, i) => `CLAUSE ${i + 1}: "${String(it.spec || '').slice(0, 600)}"`).join('\n');
    try {
      attempt = await askModel(context, sysTerse, terseUser, items.length);
      passes = 2;
    } catch { /* keep the first attempt's empty result and fall through */ }
  }

  if (!usable(attempt.suggestions) && items.length > 1) {
    const single = [];
    for (const it of items) {
      try {
        const one = await askModel(
          context,
          buildTersePrompt(product, factory, 1),
          `CLAUSE 1: "${String(it.spec || '').slice(0, 600)}"`,
          1
        );
        single.push(one.suggestions[0] || { status: '', remarks: '', verified: false });
      } catch {
        // One clause failing shouldn't cost the other two their answers.
        single.push({ status: '', remarks: '', verified: false });
      }
    }
    attempt = { suggestions: single, raw: attempt.raw };
    passes = 3;
  }

  // Every answer is checked for restated requirements before it is returned,
  // logged as a suggestion, or shown to anyone.
  let guarded = 0;
  const sourceText = offering + ' ' +
    fields.map(f => f.label + ' ' + f.value).join(' ') + ' ' + selectionRaw + ' ' +
    items.map(it => (Array.isArray(it.context) ? it.context : [])
      .map(c => String(c.compliance || '') + ' ' + String(c.remarks || '')).join(' ')).join(' ');
  const suggestions = attempt.suggestions.map((sg, i) => {
    const checked = guardAnswer(sg, clauseMeta[i], sourceText);
    if (checked && checked.guarded) guarded++;
    return checked;
  });

  // Record what we just proposed. This is the half of the training
  // comparison that cannot be reconstructed later: the exported matrix only
  // ever carries the FINAL text, so without this row a correction is
  // indistinguishable from an answer nobody touched. Best-effort — a
  // logging failure must never cost the user their suggestions.
  try {
    const stmt = context.env.DB.prepare(
      `INSERT INTO compliance_suggestions
         (id,product,factory,norm_text,spec_text,path,ai_status,ai_remarks,ai_verified,created_by,created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,datetime('now'))`
    );
    const writes = [];
    suggestions.forEach((sg, i) => {
      if (!sg || (!sg.status && !sg.remarks)) return;
      const spec = String(items[i] && items[i].spec || '').slice(0, MAX_TEXT);
      const norm = spec.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
      if (norm.length < 8) return;
      writes.push(stmt.bind('csug_' + crypto.randomUUID().slice(0, 12), product, factory, norm, spec,
        String(items[i].path || '').slice(0, 300), sg.status || '', sg.remarks || '',
        sg.verified ? 1 : 0, user.id));
    });
    if (writes.length) await context.env.DB.batch(writes);
  } catch (err) {
    console.error('[ai-suggest] could not record suggestions:', err && err.message);
  }

  // Values that sit outside what is normal in the market. These are NOTICES
  // for a person, returned separately from the answers and never written into
  // a remark — an unusual value is a reason to look, not a reason to change
  // what the datasheet says.
  const notices = [];
  for (const f of fields) {
    const note = plausibilityNote(vocab, f.label, f.value);
    if (note) notices.push(note);
  }

  const out = { suggestions, model: MODEL, passes, guarded, notices };
  if (!usable(suggestions)) {
    // Genuinely nothing after three tries. Log the raw output for the
    // Functions log and hand a snippet back, so this stays diagnosable
    // without dashboard access.
    console.error('[ai-suggest] no usable suggestions after', passes, 'pass(es). raw:', attempt.raw);
    out.debug = String(attempt.raw || '').slice(0, 400);
  }
  return json(out);
}

function usable(suggestions) {
  return Array.isArray(suggestions) && suggestions.some(s => s && (s.status || s.remarks));
}

// One call to the model, normalised. Returns coerced suggestions plus the
// raw text, so the caller can decide whether to try again.
async function askModel(context, system, user, count) {
  let raw = '';
  let directArr = null;
  try {
    const res = await context.env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 160 * count,
      temperature: 0.1,
      // JSON Mode constrains the output GRAMMAR at the API level rather than
      // only asking nicely in the prompt. minItems/maxItems are the part
      // that matters here: they make the empty array invalid, so the grammar
      // itself pushes back on the failure mode described above.
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array',
              minItems: count,
              maxItems: count,
              items: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  remarks: { type: 'string' },
                  verified: { type: 'boolean' },
                },
                required: ['status', 'remarks', 'verified'],
              },
            },
          },
          required: ['suggestions'],
        },
      },
    });
    if (res && res.response && typeof res.response === 'object' && Array.isArray(res.response.suggestions)) {
      directArr = res.response.suggestions;
    } else {
      raw = res && (typeof res.response === 'string' ? res.response
        : (res.result || JSON.stringify(res.response || ''))) || '';
    }
  } catch (err) {
    // A thrown call is different from an empty one: retrying it would just
    // burn the same quota again, so it stops here.
    throw new Error('AI request failed: ' + (err.message || 'unknown') +
      ' (daily free allocation may be exhausted — resets 00:00 UTC)');
  }
  const arr = directArr || extractJsonArray(String(raw));
  return {
    suggestions: coerceSuggestions(arr, count),
    raw: directArr ? JSON.stringify(directArr) : raw,
  };
}

// The fallback prompt. Everything optional is gone — no priority ladder, no
// worked examples, no reference data. It exists to get SOMETHING sensible
// back when the full prompt produced nothing, so brevity is the feature.
function buildTersePrompt(product, factory, count) {
  return `You write compliance matrix answers for ${product} units from the ${factory} factory.
For each clause below, reply with a status and a short remark.
status must be exactly one of: ${STATUSES.join(', ')}.
verified: true only if a datasheet field or past answer above supports it; otherwise false.
If you are unsure, use "TO VERIFY" and say what is missing — never leave the array empty.
Return exactly ${count} object(s), in order, as JSON: {"suggestions":[{"status":"...","remarks":"...","verified":true|false}]}`;
}

// Pulls the JSON array out of raw model text. Tries a couple of common
// near-miss LLM-JSON repairs before giving up, since smaller/faster models
// are more prone to trailing commas or stray prose around the array than
// larger ones — even with JSON Mode engaged, this is the fallback path.
function extractJsonArray(raw) {
  let text = raw.replace(/```(?:json)?/gi, '').trim();
  // If the model wrapped the array in {"suggestions": [...]}, unwrap it.
  const objStart = text.indexOf('{');
  if (objStart === 0 || (objStart >= 0 && objStart < text.indexOf('['))) {
    try {
      const obj = JSON.parse(text);
      if (obj && Array.isArray(obj.suggestions)) return obj.suggestions;
    } catch {}
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  return tryParseJsonArray(text.slice(start, end + 1));
}

// Coerces a raw array (from either JSON Mode or text extraction) into n
// validated {status, remarks} objects — ENFORCES the status vocabulary +
// remark hygiene server-side, since the prompt/schema only ask for it.
const BY_CONTRACTOR_REMARK = 'By Contractor / Others. Daikin scope is equipment supply only.';
const GUESS_FLAG = 'WILD GUESS \u2014 NOT VERIFIED AGAINST DATASHEET OR LIBRARY. CONFIRM BEFORE SENDING.';

function coerceSuggestions(arr, n) {
  const blank = { status: '', remarks: '', comments: '' };
  const banned = /\b(should|approximately|typically|expected|likely|we believe)\b/i;
  return Array.from({ length: n }, (_, i) => {
    const s = arr[i];
    if (!s || typeof s !== 'object') return blank;
    let status = String(s.status || s.compliance || '').trim();
    let remarks = String(s.remarks || '').slice(0, 500).trim();
    let verified = s.verified === true; // anything else (missing, "true" string, etc.) treated as unverified — the SAFER default
    // Coerce any off-vocabulary status to TO VERIFY (never let free text
    // masquerade as a compliance decision).
    const match = STATUSES.find(v => v.toLowerCase() === status.toLowerCase());
    if (!match) {
      if (!status && !remarks) return blank;
      status = 'TO VERIFY';
    } else {
      status = match;
    }
    // A remark using uncertain language is not consultant-ready — demote.
    if (remarks && banned.test(remarks) && status === 'Comply') {
      status = 'TO VERIFY';
    }
    // By Contractor's remark is a fixed, non-negotiable sentence — don't
    // trust the model to reproduce it verbatim (it drifted in testing,
    // appending extra commentary the prompt didn't ask for). Overwrite
    // rather than merely instruct. By Contractor is always a rule-level
    // fact, never a guess.
    if (status === 'By Contractor') {
      remarks = BY_CONTRACTOR_REMARK;
      verified = true;
    }
    // ENFORCED, not just requested: an unverified answer can only be
    // Comply or TO VERIFY — a guessed Deviation or Not Comply can be as
    // damaging as a false Comply, so downgrade rather than trust the
    // prompt alone to avoid it.
    if (!verified && (status === 'Deviation' || status === 'Not Comply')) {
      status = 'TO VERIFY';
    }
    // ENFORCED (the reverse direction too): TO VERIFY can NEVER be
    // verified:true, by definition — "not resolved" and "verified" are
    // contradictory. Seen in testing: the model sometimes marks a TO
    // VERIFY answer verified:true anyway, which suppressed the WILD GUESS
    // flag on a row that was, in fact, unresolved. Force it here rather
    // than trust the model to keep the two fields consistent.
    if (status === 'TO VERIFY') {
      verified = false;
    }
    // A TO VERIFY remark that just repeats the status word tells the
    // engineer nothing about what to go check — replace with a generic-
    // but-honest fallback rather than shipping "TO VERIFY".
    if (status === 'TO VERIFY' && (!remarks || remarks.toLowerCase() === 'to verify')) {
      remarks = 'No matching datasheet field or library precedent found.';
    }
    // The guess flag is CONSTRUCTED HERE, not trusted from the model's own
    // text — guarantees consistent wording every time and means the model
    // never needs to (and is told not to) write it itself. Lands in
    // "comments" — the internal-only column, kept separate from the
    // consultant-facing Compliance/Remarks. Applied to every unverified
    // (Step 3) answer, whatever status it landed on.
    const comments = !verified ? GUESS_FLAG : '';
    return { status, remarks, comments, verified };
  });
}

// Strict parse first; if that fails, try a couple of cheap, safe repairs
// for the most common near-miss LLM JSON mistakes before giving up. Never
// attempts anything that could change meaning — only formatting fixes.
function tryParseJsonArray(text) {
  try { return JSON.parse(text); } catch {}
  // Repair 1: trailing commas before ] or } (very common LLM mistake).
  try {
    return JSON.parse(text.replace(/,(\s*[\]}])/g, '$1'));
  } catch {}
  // Repair 2: both trailing commas AND smart/curly quotes swapped for
  // straight ones (some models emit typographic quotes in prose-adjacent output).
  try {
    const fixed = text
      .replace(/,(\s*[\]}])/g, '$1')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
    return JSON.parse(fixed);
  } catch {}
  return [];
}

// Every response is guaranteed JSON for any error THIS CODE can catch (bugs,
// thrown exceptions, binding failures) — see withErrorHandling() in _compliance.js.
// A hard platform-level timeout (the edge killing the connection before our
// code runs at all) can't be caught by any JS handler; MAX_ITEMS/max_tokens
// below are kept conservative specifically to avoid triggering that case.
export const onRequestPost = withErrorHandling(handlePost);
