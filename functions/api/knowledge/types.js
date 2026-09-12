/**
 * /api/knowledge/types — node kinds, relations and the legality matrix.
 * =============================================================================
 * The matrix is held in D1 (knowledge_edge_rules) and enforced by a trigger, so
 * an API call cannot create a relationship the authoring UI would have refused.
 * This endpoint hands the same matrix to the UI, which uses it to refuse
 * earlier and with a better message.
 *
 * One source, two enforcers. Shipping the matrix as a second hardcoded copy in
 * the client is how the two drift apart, and the client copy always wins the
 * argument in the user's head until the save fails.
 *
 * Labels and colours stay in the client-side domain packs: presentation is the
 * pack's job, legality is the database's.
 */

import { json, withJson, userOf } from '../../_lib/knowledge.js';

export const onRequestGet = withJson(async (context) => {
  const { env } = context;
  if (!userOf(context)) return json({ error: 'Sign in required' }, 401);

  const kinds = await env.DB.prepare(
    'SELECT kind, label, hint FROM knowledge_kinds WHERE is_active = 1 ORDER BY sort_order, kind'
  ).all();

  const rules = await env.DB.prepare(
    'SELECT from_kind, to_kind, relation FROM knowledge_edge_rules'
  ).all();

  // Shipped as a nested lookup rather than a flat list: the UI asks "given
  // these two kinds, what may I offer" on every keystroke of the connect
  // dialog, and that should be a property access, not a scan.
  const legal = {};
  ((rules && rules.results) || []).forEach((r) => {
    (legal[r.from_kind] = legal[r.from_kind] || {});
    (legal[r.from_kind][r.to_kind] = legal[r.from_kind][r.to_kind] || []).push(r.relation);
  });

  return json({
    ok: true,
    kinds: (kinds && kinds.results) || [],
    legal,
    scopes: [
      { id: 'project', label: 'This project only',
        hint: 'Recorded once, on one job. Never quoted as a general rule.' },
      { id: 'family', label: 'Product family',
        hint: 'Holds across this product line.' },
      { id: 'general', label: 'General',
        hint: 'True regardless of project or product line.' }
    ]
  });
});
