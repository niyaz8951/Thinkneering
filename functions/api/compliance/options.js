// functions/api/compliance/options.js
// The standard offering — what the factory builds, learned from datasheets.
//
//   POST { mode:'observe', product, fields }  record a datasheet's values
//   POST { mode:'import',  product, rows }    set defaults from an edited sheet
//   GET  ?product=                            export for review
//
// Observing is open to anyone who can run AI review, because it is a
// by-product of work they are already doing and adds no judgement — a value
// either appeared in a real selection report or it did not. Changing the
// defaults is a decision about what the factory quotes when nobody has
// selected anything yet, so it needs the training grant.

import {
  requireUser, json, PRODUCTS, complianceTier, learnOptions, loadOptions,
  isMissingTable, SETUP_HINT, withErrorHandling,
} from '../../_compliance.js';
import { learnFromDatasheet } from '../../_kb.js';

const MAX_ROWS = 500;

function norm(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a valid product' }, 400);

  const tier = await complianceTier(context);
  const mode = body.mode === 'import' ? 'import' : 'observe';

  if (mode === 'observe') {
    if (!tier.ai) return json({ error: 'AI access required' }, 403);
    try {
      // Both are written for now: the KB is the source the AI reads, and the
      // legacy options table stays populated so nothing that still reads it
      // goes blind mid-migration. It can be dropped once /admin/ no longer
      // shows it.
      const n = await learnFromDatasheet(context, product, body.fields);
      try { await learnOptions(context, product, body.fields); } catch { /* legacy */ }
      return json({ ok: true, recorded: n });
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      return json({ error: SETUP_HINT }, 503);
    }
  }

  // ---- import: the edited sheet comes back ----
  if (!tier.canTrain) {
    return json({ error: 'Setting the standard offering is not enabled on your account — ask an admin for access.' }, 403);
  }
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, MAX_ROWS);
  if (!rows.length) return json({ error: 'No rows found in that file.' }, 400);

  const statements = [];
  let defaults = 0, added = 0;
  for (const r of rows) {
    const field = String(r.field || '').trim();
    const values = (Array.isArray(r.values) ? r.values : [])
      .map(v => String(v || '').trim()).filter(Boolean);
    if (!field || !values.length) continue;
    const fieldNorm = norm(field);

    // The FIRST value column is the default. Everything else in the row is an
    // option. Reordering the columns in Excel is the whole editing gesture —
    // no status column to understand, no separate default flag to tick.
    statements.push(context.env.DB.prepare(
      `UPDATE compliance_options SET is_default = 0, updated_at = datetime('now')
        WHERE product = ?1 AND field_norm = ?2`
    ).bind(product, fieldNorm));

    values.forEach((value, i) => {
      // Rows typed in by hand are trusted immediately: a human wrote them
      // down on purpose, which is a stronger signal than having seen a value
      // on one datasheet.
      statements.push(context.env.DB.prepare(
        `INSERT INTO compliance_options
           (id, product, field, field_norm, value, value_norm, is_default, times_seen, status, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 'trusted', datetime('now'))
         ON CONFLICT(product, field_norm, value_norm) DO UPDATE SET
           is_default = ?7, field = ?3, value = ?5, status = 'trusted', updated_at = datetime('now')`
      ).bind('copt_' + crypto.randomUUID().slice(0, 12), product, field, fieldNorm,
             value, norm(value), i === 0 ? 1 : 0));
      if (i === 0) defaults++; else added++;
    });
  }
  if (!statements.length) return json({ error: 'No usable rows — each needs a field name and at least one value.' }, 400);

  try {
    for (let i = 0; i < statements.length; i += 100) {
      await context.env.DB.batch(statements.slice(i, i + 100));
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }
  return json({ ok: true, defaults, options: added });
}

async function handleGet(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const tier = await complianceTier(context);
  if (!tier.canTrain) {
    return json({ error: 'Downloading the standard offering is not enabled on your account — ask an admin for access.' }, 403);
  }
  const url = new URL(context.request.url);
  const product = String(url.searchParams.get('product') || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Invalid product' }, 400);

  try {
    return json({ product, fields: await loadOptions(context, product) });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }
}

export const onRequestPost = withErrorHandling(handlePost);
export const onRequestGet = withErrorHandling(handleGet);
