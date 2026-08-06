// functions/api/compliance/tree.js
// GET /api/compliance/tree?product=
//
// The knowledge tree, for review. Same grant as the rest of the training
// data: the people who correct what everyone is shown are the people who
// should be able to read what the system currently believes.
//
// Every kind is returned, not just spec-topics — reviewing the tree means
// seeing the datasheet vocabulary and the specification classification side
// by side, which is the point of calling it a tree.

import {
  requireUser, json, PRODUCTS, complianceTier, isMissingTable, SETUP_HINT, withErrorHandling,
  loadCriteria,
} from '../../_compliance.js';

async function handleGet(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const tier = await complianceTier(context);
  if (!tier.canTrain) {
    return json({ error: 'Downloading the knowledge tree is not enabled on your account — ask an admin for access.' }, 403);
  }

  const url = new URL(context.request.url);
  const product = String(url.searchParams.get('product') || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Invalid product' }, 400);

  const out = { product, specTopics: [], unitSections: [] };
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT kind, name, scope, notes, times_seen, status, updated_at
         FROM compliance_tree
        WHERE product = ?1
        ORDER BY kind, status = 'blocked', times_seen DESC LIMIT 1000`
    ).bind(product).all();
    out.specTopics = (results || []).filter(r => r.kind === 'spec-topic');
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return json({ error: SETUP_HINT }, 503);
  }

  // The datasheet side still lives in its own table (see Option A: the two
  // vocabularies are learned from different documents and left separate).
  // It is joined in here so one download shows the whole picture.
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT name, notes, times_seen, status, updated_at FROM compliance_unit_sections
        WHERE product = ?1 ORDER BY times_seen DESC LIMIT 200`
    ).bind(product).all();
    out.unitSections = results || [];
  } catch { out.unitSections = []; }

  // How each kind of value is compared — which way is better, and the class
  // scales. Includes the built-in defaults, flagged, so the download shows
  // what the AI is ACTUALLY using rather than only what has been configured.
  try {
    out.criteria = (await loadCriteria(context, product)).map(c => ({
      name: c.name, terms: c.terms, direction: c.direction,
      unit: c.unit, scale: c.scale || '', notes: c.notes || '',
      source: c.custom ? 'configured' : 'built-in default',
    }));
  } catch { out.criteria = []; }

  return json(out);
}

export const onRequestGet = withErrorHandling(handleGet);
