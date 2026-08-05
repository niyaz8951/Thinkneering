// functions/api/compliance/answer-log/index.js
// POST { product, factory, rows: [{ spec, compliance, remarks, source }] }
//   -> appends to the log (called fire-and-forget when a matrix is downloaded)
// GET ?product=AHU&factory=UAE
//   -> { rows: [{ spec_text, compliance, remarks, source, created_at }] }
//      latest answer per clause, for the in-tool Excel export.
//
// One D1 table per (product, factory) PAIR — e.g. answer_log_ahu_uae,
// answer_log_fcu_china (see functions/_compliance.js answerLogTable()). Factory
// is not a fixed set shared by every product (AHU: UAE/KSA, FCU: China,
// Air Cooled Chiller: Italy/KSA), so validity is checked against
// PRODUCT_FACTORIES, and the table name is derived only from an
// already-validated pair — never from raw request input directly.

import { requireUser, json, PRODUCTS, isValidFactory, answerLogTable, withErrorHandling } from '../../../_compliance.js';

const MAX_ROWS = 500;
const MAX_TEXT = 4000;

function normSpec(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
}

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Invalid product' }, 400);
  const factory = String(body.factory || '').trim();
  if (!isValidFactory(product, factory)) return json({ error: 'Invalid factory for ' + product }, 400);
  const table = answerLogTable(product, factory);

  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, MAX_ROWS);
  if (!rows.length) return json({ saved: 0 });

  const stmt = context.env.DB.prepare(
    `INSERT INTO ${table} (norm_text, spec_text, compliance, remarks, source, path, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  );
  const batch = [];
  for (const r of rows) {
    const spec = String(r.spec || '').trim().slice(0, MAX_TEXT);
    const norm = normSpec(spec);
    const compliance = String(r.compliance || '').trim().slice(0, MAX_TEXT);
    const remarks = String(r.remarks || '').trim().slice(0, MAX_TEXT);
    if (norm.length < 8 || (!compliance && !remarks)) continue;
    // path is what makes the section rollup possible later — without it a
    // logged answer has no idea which part of the spec it came from.
    batch.push(stmt.bind(norm, spec, compliance, remarks,
      String(r.source || '').slice(0, 40), String(r.path || '').slice(0, 300), user.id));
  }
  if (batch.length) await context.env.DB.batch(batch);
  return json({ saved: batch.length });
}

async function handleGet(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const url = new URL(context.request.url);
  const product = String(url.searchParams.get('product') || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Invalid product' }, 400);
  const factory = String(url.searchParams.get('factory') || '').trim();
  if (!isValidFactory(product, factory)) return json({ error: 'Invalid factory for ' + product }, 400);
  const table = answerLogTable(product, factory);

  // Latest answer per clause = the row with MAX(id) per norm_text — no
  // product/factory filter needed, the table itself IS that pair.
  const rows = await context.env.DB.prepare(
    `SELECT a.spec_text, a.compliance, a.remarks, a.source, a.created_at
       FROM ${table} a
       JOIN (SELECT MAX(id) AS mid FROM ${table} GROUP BY norm_text) m
         ON a.id = m.mid
      ORDER BY a.id DESC
      LIMIT 5000`
  ).all();

  return json({ rows: rows.results });
}

// Every response is guaranteed JSON for any error this code can catch —
// see withErrorHandling() in _compliance.js.
export const onRequestPost = withErrorHandling(handlePost);
export const onRequestGet = withErrorHandling(handleGet);
