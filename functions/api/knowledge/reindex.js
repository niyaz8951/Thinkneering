/**
 * /api/knowledge/reindex — build the vector index for what is already approved.
 * =============================================================================
 * Approval indexes a node from that moment on. Everything approved before
 * semantic retrieval existed — the whole seeded SBU map, every node you have
 * confirmed by hand — has no vector and is findable only by exact words.
 *
 * This walks them in batches. Batched rather than all-at-once because every
 * node costs one embedding call, and a Worker that tries six hundred of them
 * in a single request hits its time limit and leaves the index half built with
 * no record of where it stopped.
 *
 *   POST /api/knowledge/reindex           first batch
 *   POST { cursor }                       continue from where it stopped
 *
 * Admin only. It is idempotent — upsert by node id — so running it twice
 * costs time and nothing else.
 */

import { json, withJson, userOf, isAdmin } from '../../_lib/knowledge.js';
import { indexNode, semanticEnabled } from '../../_lib/semantic.js';

const BATCH = 25;

export const onRequestPost = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!isAdmin(user)) return json({ error: 'Admins only' }, 403);

  if (!semanticEnabled(env)) {
    return json({
      error: 'Semantic search is not configured. Add the VECTORIZE binding in ' +
             'wrangler.toml and create the index — see docs/refocus-2026-09.md.'
    }, 400);
  }

  let body = null;
  try { body = await request.json(); } catch (err) { body = null; }
  const cursor = (body && body.cursor) || '';

  /* Ordered by id so the cursor is stable. Ordering by updated_at would let a
     node edited mid-run jump backwards past the cursor and never be indexed. */
  const rows = await env.DB.prepare(
    "SELECT * FROM knowledge_nodes WHERE status = 'approved' AND id > ? " +
    'ORDER BY id LIMIT ?'
  ).bind(cursor, BATCH).all();

  const nodes = (rows && rows.results) || [];
  if (!nodes.length) {
    return json({ ok: true, done: true, indexed: 0, cursor: null });
  }

  let indexed = 0;
  let failed = 0;
  for (const node of nodes) {
    const ok = await indexNode(env, node);
    ok ? indexed++ : failed++;
  }

  return json({
    ok: true,
    done: false,
    indexed,
    // Reported rather than swallowed: a run that silently indexed half of
    // what it read would leave you believing search works when it half does.
    failed,
    cursor: nodes[nodes.length - 1].id,
    // So a caller can show progress without a second query.
    remaining: await countRemaining(env, nodes[nodes.length - 1].id)
  });
});

async function countRemaining(env, cursor) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM knowledge_nodes WHERE status = 'approved' AND id > ?"
  ).bind(cursor).first();
  return (row && row.n) || 0;
}
