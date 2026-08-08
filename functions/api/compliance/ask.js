// functions/api/compliance/ask.js
// Free-text question answering for the compliance chat.
//
// The answer is the same judgement a converted matrix row would carry, said
// out loud: a status from the matrix vocabulary, the remark that would sit
// beside it, and a short natural-language reply that reads as if an
// application engineer answered the question rather than filled a cell.
//
// THREE THINGS WERE WRONG AND ARE FIXED HERE IN CODE, NOT BY ASKING THE
// PROMPT MORE FIRMLY:
//
//   1. "[object Object]" in the chat bubble. The model sometimes returns
//      `answer` as a nested object rather than a string, and String({}) is
//      "[object Object]". Every field coming back from the model now goes
//      through asText(), which flattens objects and arrays to readable prose
//      instead of throwing a good reply away on a shape slip.
//
//   2. The answer had almost nothing to work from. Ask only ever saw
//      compliance_facts and compliance_kb. It never saw compliance_options —
//      the standard offering learned from every selection report, which is
//      the one table that actually knows which panel thicknesses, filter
//      classes and materials this factory has built. It does now, narrowed
//      to the fields the question is about.
//
//   3. "Can we give 62 mm panel?" is not a compliance judgement — it is a
//      lookup, and a model asked to reason its way to a lookup will guess.
//      The lookup now happens here against the recorded options, and when it
//      is decisive the status is set in code and the model only writes the
//      sentence around it.
//
// Response shape is { status, remarks, answer, note? } and the front end
// renders `answer` as the body with `status` as a chip.

import {
  requireUser, json, PRODUCTS, isValidFactory, complianceTier, withErrorHandling,
  loadFacts, pickFacts, factsBlock, loadOptions,
  loadCriteria, matchCriterion, compareValues, compareClasses, classTokens,
} from '../../_compliance.js';
import { loadKb, kbForClause, kbLines } from '../../_kb.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_Q = 400;
const MAX_TURNS = 8;

// The vocabulary real engineers write in these matrices. "Deviation" and
// "Not Comply" are deliberately absent — they are not used in practice.
// "By Contractor" was missing here while ai-suggest.js has it; a question
// about ductwork or rigging has no other correct answer, so it is back.
const STATUSES = [
  'Comply',
  'Comply with remarks',
  'Not Applicable',
  'By Contractor',
  'Noted',
  'TO VERIFY',
];

/* ==========================================================================
   TEXT COERCION — the [object Object] fix
   ========================================================================== */

// Everything the model returns is treated as possibly-not-a-string. A nested
// object is flattened to its readable values rather than discarded, because
// the content is usually right even when the shape is not.
function asText(v, depth = 0) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (depth > 2) return '';
  if (Array.isArray(v)) {
    return v.map(x => asText(x, depth + 1)).filter(Boolean).join(' ').trim();
  }
  if (typeof v === 'object') {
    // A model that wraps its reply almost always uses one of these keys.
    for (const k of ['answer', 'text', 'response', 'reply', 'content', 'value', 'remarks', 'remark']) {
      if (v[k] != null) {
        const t = asText(v[k], depth + 1);
        if (t) return t;
      }
    }
    return Object.values(v).map(x => asText(x, depth + 1)).filter(Boolean).join(' ').trim();
  }
  return '';
}

/* ==========================================================================
   VOCABULARY
   --------------------------------------------------------------------------
   Words for the same subject in specification English. A property of the
   language, not of any factory, so it belongs in code and not in the
   database. Kept in step with _kb.js and ai-suggest.js.
   ========================================================================== */

const TERM_GROUPS = [
  ['casing', 'casings', 'panel', 'panels', 'skin', 'wall', 'enclosure', 'module', 'modules'],
  ['thickness', 'thick', 'depth', 'gauge', 'insulation', 'insulated'],
  ['filter', 'filters', 'filtration'],
  ['fan', 'fans', 'blower', 'impeller', 'plenum'],
  ['coil', 'coils', 'tube', 'tubes', 'fin', 'fins'],
  ['motor', 'motors', 'drive', 'vfd', 'inverter'],
  ['damper', 'dampers', 'actuator'],
  ['door', 'doors', 'access', 'hinge', 'hinges'],
  ['drain', 'tray', 'pan'],
  ['frame', 'framework', 'profile'],
  ['control', 'controls', 'controller', 'bms'],
  ['leakage', 'leak', 'tightness'],
  ['sound', 'noise', 'acoustic'],
];

function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9. ]+/g, ' ')
    .split(/\s+/).filter(w => w.length > 2);
}

function expandWords(list) {
  const out = new Set(list);
  list.forEach(w => TERM_GROUPS.forEach(g => { if (g.includes(w)) g.forEach(x => out.add(x)); }));
  return out;
}

/* ==========================================================================
   STANDARD OFFERING, NARROWED TO THE QUESTION
   --------------------------------------------------------------------------
   loadOptions returns every field ever seen on a selection report — far too
   much to put in front of a question about panels. Only the fields the
   question is actually about are shown, so the values that matter are not
   buried under forty unrelated ones.
   ========================================================================== */

// A value seen exactly once is as likely to be a project quirk as a standard
// offering. Same bar the converter's offering block uses.
function usableValues(group) {
  return (group.values || []).filter(v => v.status === 'trusted' || v.times_seen > 1);
}

function offeringFor(question, grouped, limit = 8) {
  const want = expandWords(words(question));
  return grouped
    .map(g => ({ group: g, values: usableValues(g) }))
    .filter(x => x.values.length)
    .map(x => {
      const ft = words(x.group.field);
      let hits = 0;
      for (const w of ft) if (want.has(w)) hits++;
      return { group: x.group, values: x.values, score: ft.length ? hits / Math.sqrt(ft.length) : 0 };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function offeringLines(hits) {
  if (!hits.length) return '';
  return hits.map(h => {
    const def = h.values.find(v => v.is_default) || h.values[0];
    const others = h.values.filter(v => v !== def).map(v => v.value);
    return `- ${h.group.field}: ${def.value} (standard)` +
      (others.length ? `; also supplied: ${others.join('; ')}` : '');
  }).join('\n');
}

/* ==========================================================================
   MEASUREMENTS
   ========================================================================== */

// Numbers carrying a unit — 62 mm, 0.8 mm, 400 Pa, 55 dB, 3 %. A bare number
// is ignored, because "clause 2.02" is not a measurement.
const MEASURE_RE = /(\d+(?:\.\d+)?)\s*(mm|cm|kw|kg|pa|db|micron|microns|µm|um|swg|inch|ppm|m|%)(?![a-z0-9])/gi;

function measures(text) {
  const out = [];
  const s = String(text || '');
  let m;
  MEASURE_RE.lastIndex = 0;
  while ((m = MEASURE_RE.exec(s)) !== null) {
    out.push({ num: parseFloat(m[1]), unit: m[2].toLowerCase(), raw: m[0].trim() });
  }
  return out;
}

function sameMeasure(a, b) {
  return !!a && !!b && a.unit === b.unit && Math.abs(a.num - b.num) < 1e-9;
}

/* ==========================================================================
   THE AVAILABILITY LOOKUP
   --------------------------------------------------------------------------
   "Can we give 62 mm panel?" asks whether a value is on the menu. That is a
   lookup with three outcomes, and it is decided here rather than reasoned:

     value is on the list      -> Comply, or Comply with remarks if it is an
                                  option rather than the standard
     field known, value is not
       on the list             -> TO VERIFY, naming what IS on the list. NOT
                                  "we cannot" — the table records what has
                                  been selected before, not the catalogue.
     field not known           -> undecided; the model answers as normal
   ========================================================================== */

const ASKING_IF_WE_CAN =
  /\b(can|could|do|does|are|is|will)\s+(we|you|it|they|daikin)\b|\bavailable\b|\bpossible\b|\boffer(ed|ing)?\b|\bsupply\b|\bprovide\b/i;

function isAvailabilityQuestion(q) {
  return ASKING_IF_WE_CAN.test(String(q || ''));
}

function decideAvailability(question, offerHits) {
  const asked = measures(question);
  const askedClasses = classTokens(question);
  if (!asked.length && !askedClasses.length) return null;
  if (!offerHits.length) return null;

  // The best-matching field is the one the question is about.
  const hit = offerHits[0];
  const def = hit.values.find(v => v.is_default) || hit.values[0];
  const listed = hit.values.map(v => v.value);

  for (const a of asked) {
    for (const v of hit.values) {
      if (!measures(v.value).some(x => sameMeasure(x, a))) continue;
      const isDefault = v === def;
      return {
        status: isDefault ? 'Comply' : 'Comply with remarks',
        field: hit.group.field,
        asked: a.raw,
        standard: def.value,
        listed,
        finding: isDefault
          ? `${a.raw} is the standard value on file for ${hit.group.field}.`
          : `${a.raw} is on file for ${hit.group.field} as an alternative to the standard ` +
            `${def.value}. It has been supplied before, so it can be offered.`,
      };
    }
  }

  for (const c of askedClasses) {
    for (const v of hit.values) {
      if (!classTokens(v.value).includes(c)) continue;
      const isDefault = v === def;
      return {
        status: isDefault ? 'Comply' : 'Comply with remarks',
        field: hit.group.field,
        asked: c,
        standard: def.value,
        listed,
        finding: isDefault
          ? `${c} is the standard value on file for ${hit.group.field}.`
          : `${c} is on file for ${hit.group.field} alongside the standard ${def.value}.`,
      };
    }
  }

  const askedRaw = (asked[0] && asked[0].raw) || askedClasses[0];
  return {
    status: 'TO VERIFY',
    field: hit.group.field,
    asked: askedRaw,
    standard: def.value,
    listed,
    finding: `${askedRaw} is NOT among the values on file for ${hit.group.field}. What is on ` +
      `file: ${listed.join('; ')}. That does not mean it cannot be built — it means no past ` +
      `selection confirms it, so the factory has to confirm before it is offered.`,
  };
}

/* ==========================================================================
   REQUIREMENT COMPARISON
   --------------------------------------------------------------------------
   "The spec asks for 50 mm casing — do we comply?" is the other shape. The
   arithmetic is done here so the model only writes the sentence, and so a
   better-than-required value is never reported as a deviation.
   ========================================================================== */

function compareToOffering(question, offerHits, criteria) {
  const asked = measures(question);
  const askedClasses = classTokens(question);
  if ((!asked.length && !askedClasses.length) || !offerHits.length) return '';

  const hit = offerHits[0];
  const def = hit.values.find(v => v.is_default) || hit.values[0];
  const lines = [];

  for (const a of asked.slice(0, 2)) {
    const actual = measures(def.value).find(x => x.unit === a.unit);
    if (!actual) continue;
    const crit = matchCriterion(hit.group.field + ' ' + question, criteria, a.unit);
    const verdict = compareValues(a.num, actual.num, crit);
    if (!verdict) continue;
    lines.push(`- Asked about ${a.raw}. On file, ${hit.group.field} is ${def.value}. ` +
      `${actual.raw} ${verdict.why}.`);
  }

  for (const c of askedClasses.slice(0, 2)) {
    const actualTok = classTokens(def.value)[0];
    if (!actualTok) continue;
    const crit = matchCriterion(hit.group.field + ' ' + question, criteria, '');
    const verdict = compareClasses(c, actualTok, crit);
    if (!verdict) continue;
    lines.push(`- Asked about ${c}. On file, ${hit.group.field} is ${def.value}. ${actualTok} ${verdict.why}.`);
  }

  return lines.length
    ? `COMPARISON ALREADY WORKED OUT — the arithmetic is done. State it, do not redo it:\n${lines.join('\n')}`
    : '';
}

/* ==========================================================================
   PROMPT
   ========================================================================== */

function engineeringPrompt({ product, factory, reference, kb, offering, comparison, decided, ctx }) {
  const sources = [
    reference,
    kb ? 'WHAT THIS PRODUCT CAN BE BUILT WITH (product knowledge base)\n' + kb : '',
    offering ? 'STANDARD OFFERING — values recorded from past selection reports for this factory\n' + offering : '',
    comparison,
    ctx ? 'PAST VERIFIED ANSWERS — checked by an engineer, follow them\n' + ctx : '',
  ].filter(Boolean).join('\n\n');

  const decidedBlock = decided
    ? `\nTHE LOOKUP IS ALREADY DONE. This finding is correct and is not yours to revise:
  ${decided.finding}
  The status is ${decided.status}.
  Write the reply and the remark around this finding, naming the actual values.\n`
    : '';

  return `You are a Daikin application engineer answering a colleague's question about
${product} units built at the ${factory} factory. Answer the way you would across a
desk: direct, specific, naming real values. No padding, no restating the question.

WHAT YOU KNOW
${sources || 'Nothing is on file that speaks to this question.'}
${decidedBlock}
HOW TO ANSWER

Pick one status from exactly this list:
  Comply                — we meet it as standard, or the value asked about is our standard.
  Comply with remarks   — we can meet it, but with a qualification worth stating
                          (an option rather than the standard, or a different but better value).
  Not Applicable        — the requirement does not apply to this product or this scope.
  By Contractor         — installation, rigging, ductwork, commissioning, site work.
                          We supply the equipment; the contractor executes on site.
  Noted                 — information only; nothing to confirm or supply.
  TO VERIFY             — nothing above supports an answer. Say exactly what is missing.

"remarks" is the sentence you would type into the Remarks column: factual, roughly
20 to 30 words, with no lead-in label.

"answer" is two to four sentences of plain speech to your colleague. It must
name the actual value or values on file rather than only giving a verdict, say
plainly whether we can do what was asked and on what basis, and never open with
the status word or the labels "Compliance:" or "Remarks:".

HARD RULES
- Every number, class, material, standard and model you write must appear above
  or in the question. Never derive one, never round one, never fill a gap with a
  typical industry value. If a specific value is needed and it is not above, the
  status is TO VERIFY and you name the value that is missing.
- "Not on file" is not "not possible". If a value is not recorded, say the
  factory must confirm it — do not say we cannot supply it.
- Never claim a certification, standard or conformity that is not stated above.
- Installation, rigging, commissioning, ductwork and site work are the
  contractor's scope. We supply equipment only.

Reply with ONE JSON object and nothing else. Every value is a plain string:
{"status":"...","remarks":"...","answer":"..."}`;
}

/* ==========================================================================
   PARSING AND GUARDS
   ========================================================================== */

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { return null; }
}

// Accept near-misses on the status wording rather than throwing the answer
// away — models reliably return the right judgement in slightly wrong case.
function normaliseStatus(value) {
  const raw = asText(value);
  if (!raw) return 'TO VERIFY';
  const hit = STATUSES.find(s => s.toLowerCase() === raw.toLowerCase());
  if (hit) return hit;
  const low = raw.toLowerCase();
  if (low.startsWith('comply with')) return 'Comply with remarks';
  if (low.startsWith('comply')) return 'Comply';
  if (low.includes('not applicable') || low === 'n/a' || low === 'na') return 'Not Applicable';
  if (low.includes('contractor')) return 'By Contractor';
  if (low.startsWith('noted')) return 'Noted';
  return 'TO VERIFY';
}

function shape(parsed, fallbackText) {
  if (!parsed) {
    // The model wrote prose instead of JSON. Prose is still useful, so keep
    // it as the answer rather than discarding a good reply on a format slip.
    const text = asText(fallbackText);
    return text ? { status: 'TO VERIFY', remarks: '', answer: text.slice(0, 2000) } : null;
  }
  const status = normaliseStatus(parsed.status);
  const remarks = asText(parsed.remarks != null ? parsed.remarks : parsed.remark).slice(0, 600);
  let answer = asText(parsed.answer).slice(0, 2000);
  // If only remarks came back, that sentence is the answer.
  if (!answer) answer = remarks;
  if (!answer) return null;
  return { status, remarks, answer };
}

// The last line of defence against a confident invented number. A measured
// value in the answer that appears in neither the question nor anything the
// model was given is not something it could have known.
function unsupportedMeasures(answer, allowed) {
  const known = measures(allowed);
  const seen = new Set();
  return measures(answer)
    .filter(a => !known.some(k => sameMeasure(k, a)))
    .filter(a => (seen.has(a.raw) ? false : (seen.add(a.raw), true)))
    .map(a => a.raw);
}

/* ========================================================================== */

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const tier = await complianceTier(context);
  if (!tier.ai) {
    return json({ error: 'Ask is not enabled on your account yet — ask an admin for access.' }, 403);
  }
  if (!context.env.AI) return json({ error: 'AI binding "AI" is not configured.' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a product first.' }, 400);

  const factory = String(body.factory || '').trim();
  if (!isValidFactory(product, factory)) {
    return json({ error: `Select a valid factory for ${product}.` }, 400);
  }

  const question = String(body.question || '').trim();
  if (!question) return json({ error: 'Ask a question.' }, 400);
  if (question.length > MAX_Q) {
    return json({
      error: `Question too long (${question.length} chars). Paste specifications into the converter instead.`,
    }, 400);
  }

  const [facts, kb, options, criteria] = await Promise.all([
    loadFacts(context, product, factory),
    loadKb(context, product),
    loadOptions(context, product),
    loadCriteria(context, product),
  ]);

  const kbHits = kbForClause(question, kb);
  const kbText = kbLines(kbHits);
  const reference = factsBlock(product, factory, pickFacts([question], facts));
  const offerHits = offeringFor(question, options);
  const offering = offeringLines(offerHits);
  const comparison = compareToOffering(question, offerHits, criteria);

  // The lookup, when the question is one. Decided here; the model only
  // writes the sentence around it.
  const decided = isAvailabilityQuestion(question)
    ? decideAvailability(question, offerHits)
    : null;

  const ctx = (Array.isArray(body.context) ? body.context : []).slice(0, 4)
    .map(c => `- "${String(c.spec || '').slice(0, 220)}"\n  -> ${String(c.compliance || '').slice(0, 120)}: ${String(c.remarks || '').slice(0, 200)}`)
    .join('\n');

  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_TURNS)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }));

  const messages = [
    {
      role: 'system',
      content: engineeringPrompt({
        product, factory, reference, kb: kbText, offering, comparison, decided, ctx,
      }),
    },
    ...history,
    { role: 'user', content: question },
  ];

  // Two attempts: a tight one for accuracy, a looser one only if the first
  // came back unparseable.
  let result = null;
  let lastRaw = '';
  for (const opts of [{ temperature: 0.1 }, { temperature: 0.4 }]) {
    let raw = '';
    try {
      const res = await context.env.AI.run(MODEL, { messages, max_tokens: 500, ...opts });
      raw = (res && (res.response || res.result)) || '';
    } catch (err) {
      return json({ error: 'AI request failed: ' + (err.message || 'unknown') }, 502);
    }
    lastRaw = asText(raw);
    result = shape(extractJson(lastRaw), null);
    if (result) break;
  }
  if (!result) result = shape(null, lastRaw);

  if (!result) {
    return json({ error: 'The model returned an empty response. Try rephrasing the question.' }, 500);
  }

  // Where the lookup was decisive, the code's status wins. The model is here
  // for the wording, not for the verdict.
  if (decided) {
    result.status = decided.status;
    if (!result.remarks) result.remarks = decided.finding.slice(0, 600);
  }

  // Fabrication guard: everything the model was legitimately allowed to
  // quote, in one string, plus the question itself.
  const allowed = [question, reference, kbText, offering, comparison, ctx,
    decided ? decided.finding : ''].join(' ');
  const invented = unsupportedMeasures(result.answer + ' ' + result.remarks, allowed);
  let note = '';
  if (invented.length) {
    const listed = invented.slice(0, 4).join(', ');
    if (decided) {
      // The verdict came from the lookup and stands; only the wording
      // wandered, and the reader is told which part not to trust.
      note = 'The reply mentions ' + listed + ', which is not on file. Ignore those values — ' +
        'the status above comes from the recorded options, not from them.';
    } else if (result.status !== 'TO VERIFY') {
      result.status = 'TO VERIFY';
      note = 'Downgraded to TO VERIFY: this answer used ' + listed + ', which is not in the ' +
        'library, the knowledge base or the recorded offering. Confirm before using it.';
    } else {
      note = 'Contains values not on file (' + listed + '). Confirm before use.';
    }
  }

  return json({ ...result, note: note || undefined, source: 'ai' });
}

export const onRequestPost = withErrorHandling(handlePost);
