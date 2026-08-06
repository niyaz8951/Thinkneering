// functions/api/compliance/ingest.js
// POST { product, factory, rows: [{ spec, compliance, remarks, path? }] }
//
// The training loop. A completed matrix comes back with the answers a human
// actually shipped; each row is compared against what the AI proposed for
// that clause (compliance_suggestions, written at suggestion time), and the
// difference is the signal:
//
//   accepted  — shipped unchanged. The AI was right; confidence goes up.
//   corrected — shipped differently. The human answer wins, permanently.
//   new       — no suggestion on file. A clause the AI never saw.
//
// Confirmed answers land in the answer log with source='confirmed', which
// puts them straight into library pre-fill, the conflict check and the
// section rollup for EVERY signed-in user. That is the whole point: one
// person's correction becomes everyone's starting answer.
//
// Restricted to accounts granted the `training` item. Submitting a matrix
// rewrites what other people will be shown, so it is a separate permission
// from merely using AI review.

import {
  requireUser, json, PRODUCTS, isValidFactory, answerLogTable, complianceTier,
  rebuildSections, isMissingTable, SETUP_HINT, withErrorHandling,
} from '../../_compliance.js';

const MAX_ROWS = 4000;
const MAX_TEXT = 4000;

function normSpec(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
}

// Comparison normalisation. The [GUESS] prefix is a UI marker the tool adds
// to its own unverified answers — if a human ships that text untouched they
// have accepted the answer, not written a different one, so it is stripped
// before comparing rather than counted as a correction.
function normAns(s) {
  return String(s || '').replace(/^\[GUESS\]\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const tier = await complianceTier(context);
  if (!tier.canTrain) {
    return json({ error: 'Submitting completed matrices is not enabled on your account — ask an admin for access.' }, 403);
  }

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a valid product' }, 400);
  const factory = String(body.factory || '').trim();
  if (!isValidFactory(product, factory)) return json({ error: 'Select a valid factory for ' + product }, 400);
  const table = answerLogTable(product, factory);

  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, MAX_ROWS);
  if (!rows.length) return json({ error: 'No answered rows found in that file.' }, 400);

  // Prepare the incoming rows first, so one malformed line can't halt the run.
  // A BLANK ROW IS A DECISION, and until now it was thrown away.
  //
  // Measured on a real completed matrix: 461 of 585 clause rows (78%) were
  // deliberately left blank, and only 37% of the answered ones got a remark.
  // The tool fills every blank row, so it produces roughly twelve times the
  // text a human writes — and every extra line is something to read and
  // delete. That, not per-answer accuracy, is why the output feels unusable.
  //
  // Which rows deserve an answer is NOT predictable from the clause wording;
  // a reasonable linguistic rule scores 22% precision against this document,
  // barely above answering everything. It is judgement about what a given
  // consultant will scrutinise. So it cannot be inferred — it has to be
  // remembered, which means recording the blanks.
  //
  // They are kept OUT of the answer log (a blank is not an answer to
  // pre-fill) and in the feedback table, where the next run can look up
  // whether this clause has been deliberately skipped before.
  const clean = [];
  const blanks = [];
  for (const r of rows) {
    const spec = String(r.spec || '').trim().slice(0, MAX_TEXT);
    const norm = normSpec(spec);
    const compliance = String(r.compliance || '').trim().slice(0, MAX_TEXT);
    const remarks = String(r.remarks || '').trim().slice(0, MAX_TEXT);
    if (norm.length < 8) continue;
    if (!compliance && !remarks) {
      blanks.push({ spec, norm, path: String(r.path || '').slice(0, 300) });
      continue;
    }
    clean.push({ spec, norm, compliance, remarks, path: String(r.path || '').slice(0, 300) });
  }
  if (!clean.length && !blanks.length) return json({ error: 'No clause rows found in that file.' }, 400);
  if (!clean.length) return json({ error: 'No answered rows found — Compliance and Remarks were empty.' }, 400);

  // The latest suggestion per clause, for this pair only. Chunked IN queries
  // because a full matrix can be a few thousand rows.
  const suggested = new Map();
  const norms = [...new Set(clean.map(c => c.norm))];
  try {
    for (let i = 0; i < norms.length; i += 50) {
      const chunk = norms.slice(i, i + 50);
      const ph = chunk.map((_, k) => '?' + (k + 3)).join(',');
      const { results } = await context.env.DB.prepare(
        `SELECT s.norm_text, s.ai_status, s.ai_remarks, s.path
           FROM compliance_suggestions s
           JOIN (SELECT MAX(id) AS mid FROM compliance_suggestions
                  WHERE product = ?1 AND factory = ?2 AND norm_text IN (${ph})
                  GROUP BY norm_text) m ON s.id = m.mid`
      ).bind(product, factory, ...chunk).all();
      for (const r of results || []) suggested.set(r.norm_text, r);
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }

  const fbStmt = context.env.DB.prepare(
    `INSERT INTO compliance_feedback
       (id,product,factory,norm_text,spec_text,path,ai_status,ai_remarks,
        final_status,final_remarks,verdict,created_by,created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,datetime('now'))`
  );
  const logStmt = context.env.DB.prepare(
    `INSERT INTO ${table} (norm_text, spec_text, compliance, remarks, source, path, created_by)
     VALUES (?1, ?2, ?3, ?4, 'confirmed', ?5, ?6)`
  );

  const counts = { accepted: 0, corrected: 0, new: 0 };
  const batch = [];
  for (const c of clean) {
    const prior = suggested.get(c.norm);
    let verdict;
    if (!prior) verdict = 'new';
    else if (normAns(prior.ai_status) === normAns(c.compliance) &&
             normAns(prior.ai_remarks) === normAns(c.remarks)) verdict = 'accepted';
    else verdict = 'corrected';
    counts[verdict]++;

    batch.push(fbStmt.bind(
      'cfb_' + crypto.randomUUID().slice(0, 12), product, factory, c.norm, c.spec,
      c.path || (prior && prior.path) || '',
      prior ? prior.ai_status : '', prior ? prior.ai_remarks : '',
      c.compliance, c.remarks, verdict, user.id
    ));
    // Every confirmed row goes to the answer log regardless of verdict —
    // an accepted answer is just as much a confirmed answer as a corrected
    // one, and both should pre-fill next time.
    batch.push(logStmt.bind(c.norm, c.spec, c.compliance, c.remarks,
      c.path || (prior && prior.path) || '', user.id));
  }

  // Blanks, recorded as their own verdict so the corpus knows what a human
  // chose NOT to answer on this clause.
  for (const b of blanks.slice(0, 2000)) {
    batch.push(fbStmt.bind(
      'cfb_' + crypto.randomUUID().slice(0, 12), product, factory, b.norm, b.spec, b.path,
      '', '', '', '', 'blank', user.id));
  }

  try {
    for (let i = 0; i < batch.length; i += 200) {
      await context.env.DB.batch(batch.slice(i, i + 200));
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }

  // Refresh the section statistics right away. Summaries an admin has edited
  // stay locked, so this can never overwrite a human description with a
  // statistical one.
  let sections = 0;
  try { sections = await rebuildSections(context, product, factory, user.id); }
  catch { /* the answers are already saved; the rollup can be retried */ }

  return json({ ok: true, ...counts, blank: blanks.length, total: clean.length, sections });
}

export const onRequestPost = withErrorHandling(handlePost);

// GET /api/compliance/ingest?product=&factory=
// The corrections log, for the same accounts allowed to submit one. Reading
// what the AI got wrong is part of correcting it, so the two share a grant
// rather than the read being open to every signed-in user.
async function handleGet(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const tier = await complianceTier(context);
  if (!tier.canTrain) {
    return json({ error: 'Downloading the corrections log is not enabled on your account — ask an admin for access.' }, 403);
  }

  const url = new URL(context.request.url);
  const product = String(url.searchParams.get('product') || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Invalid product' }, 400);
  const factory = String(url.searchParams.get('factory') || '').trim();
  if (!isValidFactory(product, factory)) return json({ error: 'Invalid factory for ' + product }, 400);

  try {
    const { results } = await context.env.DB.prepare(
      `SELECT spec_text, path, ai_status, ai_remarks, final_status, final_remarks, verdict, created_at
         FROM compliance_feedback
        WHERE product = ?1 AND factory = ?2
        ORDER BY id DESC LIMIT 5000`
    ).bind(product, factory).all();
    return json({ rows: results || [] });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }
}

export const onRequestGet = withErrorHandling(handleGet);
