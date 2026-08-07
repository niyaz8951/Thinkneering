// functions/api/compliance/kb.js
// The product knowledge base as one editable sheet.
//
//   GET  ?product=          export
//   POST { product, rows }  replace what the sheet says
//
// One row per attribute. Columns:
//   Section | Attribute | Definition | Unit | Better when | Class scale
//         | Default | Option 2 | Option 3 ...
//
// The first value column is the DEFAULT. Moving a value into it is the whole
// editing gesture — there is no status column to interpret and no flag to
// tick, because every extra control is another thing to get wrong at 6pm.

import {
  requireUser, json, PRODUCTS, complianceTier,
  isMissingTable, SETUP_HINT, withErrorHandling,
} from '../../_compliance.js';
import { loadKb, kbPath, norm } from '../../_kb.js';

const MAX_ROWS = 800;

async function handleGet(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const tier = await complianceTier(context);
  if (!tier.canTrain) {
    return json({ error: 'Downloading the knowledge base is not enabled on your account — ask an admin for access.' }, 403);
  }
  const url = new URL(context.request.url);
  const product = String(url.searchParams.get('product') || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Invalid product' }, 400);

  try {
    return json({ product, entries: await loadKb(context, product) });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }
}

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const tier = await complianceTier(context);
  if (!tier.canTrain) {
    return json({ error: 'Editing the knowledge base is not enabled on your account — ask an admin for access.' }, 403);
  }

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a valid product' }, 400);
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, MAX_ROWS);
  if (!rows.length) return json({ error: 'No rows found in that file.' }, 400);

  const stmts = [];
  let saved = 0;
  for (const r of rows) {
    const section = String(r.section || 'Unit').trim() || 'Unit';
    const attribute = String(r.attribute || '').trim();
    if (!attribute) continue;
    const options = (Array.isArray(r.options) ? r.options : [])
      .map(v => String(v || '').trim()).filter(Boolean).slice(0, 12);
    if (!options.length) continue;

    // Anything a person typed is trusted at once. Someone writing a value
    // down deliberately is a stronger signal than having seen it on one PDF.
    stmts.push(context.env.DB.prepare(
      `INSERT INTO compliance_kb
         (id, product, section, attribute, path_norm, options, definition, aliases,
          unit, direction, scale_order, status, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'trusted',datetime('now'))
       ON CONFLICT(path_norm) DO UPDATE SET
         section=?3, attribute=?4, options=?6, definition=?7, aliases=?8,
         unit=?9, direction=?10, scale_order=?11, status='trusted',
         updated_at=datetime('now')`
    ).bind(
      'kb_' + crypto.randomUUID().slice(0, 12), product, section, attribute,
      kbPath(product, section, attribute), JSON.stringify(options),
      String(r.definition || '').trim(), String(r.aliases || norm(attribute)).trim(),
      String(r.unit || '').trim().toLowerCase(),
      ['higher', 'lower', 'exact', 'unknown'].includes(r.direction) ? r.direction : 'unknown',
      String(r.scale || '').trim()
    ));
    saved++;
  }
  if (!stmts.length) return json({ error: 'No usable rows — each needs an attribute and at least one value.' }, 400);

  try {
    for (let i = 0; i < stmts.length; i += 100) await context.env.DB.batch(stmts.slice(i, i + 100));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }
  return json({ ok: true, saved });
}

export const onRequestGet = withErrorHandling(handleGet);
export const onRequestPost = withErrorHandling(handlePost);
