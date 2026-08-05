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
- Follow the wording style of the past verified answers closely.

EXAMPLES OF THE OUTPUT QUALITY EXPECTED (format only — do not reuse this content):
- {"status":"Comply","remarks":"Comply as equivalent. Daikin AHUs comply with EUROVENT standards.","verified":true}
- {"status":"Comply","remarks":"0.7mm galvanized outer skin, 42mm PU foam insulation.","verified":true}
- {"status":"By Contractor","remarks":"By Contractor / Others. Daikin scope is equipment supply only.","verified":true}
- {"status":"Comply","remarks":"Daikin AHU standard construction includes this feature.","verified":false}
- {"status":"TO VERIFY","remarks":"Requires a specific filter class not in the datasheet or library.","verified":false}
BAD, do not do this: {"status":"TO VERIFY","remarks":"TO VERIFY","verified":false} — the remark must never just repeat the status word.
BAD, do not do this: {"status":"Comply","remarks":"Panel thickness is 1.2mm.","verified":false} — never fabricate a specific number under verified:false.

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
    return `CLAUSE ${i + 1}: "${spec}"` +
      (path ? `\n  Location in specification: ${path}` : '') + profLine +
      (ctx ? `\n  Past verified answers (Step 2 source):\n${ctx}`
           : '\n  Past verified answers: none for this clause.');
  }).join('\n\n');

  const userMsg = (datasheetBlock ? datasheetBlock + '\n' : '') + clauseBlock;

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

  const suggestions = attempt.suggestions;

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

  const out = { suggestions, model: MODEL, passes };
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
