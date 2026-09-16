/**
 * /api/knowledge/usage — the feedback loop
 *
 * POST {
 *   consumer: 'compliance-maker',
 *   context:  '<the spec clause that was being answered>',
 *   outcome:  'used' | 'corrected' | 'rejected' | 'unanswered',
 *   nodeId?:  '<node the answer came from>',
 *   correction?: '<what the engineer changed it to>'
 * }
 *
 * Call this twice from Compliance Maker:
 *   1. 'used' when a knowledge node feeds an answer
 *   2. 'corrected' when the engineer edits that answer before submitting
 *
 * And once with 'unanswered' when a clause returns no matches. That third one
 * is the most valuable of the three — it is a list, written by real work, of
 * exactly what the knowledge base is still missing. It shows up in the admin
 * console under Gaps.
 *
 * Without this endpoint the graph only grows. With it, the graph improves.
 */

import { json, readJson, userOf, userId, isAdmin, nowIso, newId, withJson
} from '../../_lib/knowledge.js';

const OUTCOMES = ['used', 'corrected', 'rejected', 'unanswered'];

async function _onRequestPost(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid body' }, 400);
  if (OUTCOMES.indexOf(body.outcome) === -1) return json({ error: 'Unknown outcome' }, 400);
  if (body.outcome !== 'unanswered' && !body.nodeId) {
    return json({ error: 'nodeId is required unless the outcome is unanswered' }, 400);
  }

  await env.DB.prepare(
    'INSERT INTO knowledge_usage (id, node_id, consumer, context, outcome, correction, user_id, ' +
    'created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(
    newId('use'),
    String(body.nodeId || ''),
    String(body.consumer || 'unknown').slice(0, 60),
    String(body.context || '').slice(0, 2000),
    body.outcome,
    body.correction ? String(body.correction).slice(0, 4000) : null,
    userId(user),
    nowIso()
  ).run();

  return json({ ok: true });
}

/**
 * GET ?node=<id> -> how a single node has performed downstream.
 * A node with a high correction rate is worse than a missing node: it is
 * confidently wrong, and it is quietly shaping answers.
 */
async function _onRequestGet(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const nodeId = new URL(request.url).searchParams.get('node');
  if (!nodeId) return json({ error: 'Missing node' }, 400);

  const rows = await env.DB.prepare(
    'SELECT outcome, COUNT(*) AS count FROM knowledge_usage WHERE node_id = ? GROUP BY outcome'
  ).bind(nodeId).all();

  const counts = {};
  ((rows && rows.results) || []).forEach(r => { counts[r.outcome] = r.count; });

  const used = counts.used || 0;
  const corrected = counts.corrected || 0;
  const total = used + corrected + (counts.rejected || 0);

  let recent = [];
  if (isAdmin(user)) {
    const res = await env.DB.prepare(
      'SELECT context, outcome, correction, created_at FROM knowledge_usage ' +
      'WHERE node_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(nodeId).all();
    recent = (res && res.results) || [];
  }

  return json({
    ok: true,
    counts,
    total,
    correctionRate: total ? Math.round((corrected / total) * 100) : null,
    recent
  });
}

/* Wrapped so a database or runtime failure returns JSON the front end
   can read, instead of Cloudflare's HTML error page. */
export const onRequestGet = withJson(_onRequestGet);
export const onRequestPost = withJson(_onRequestPost);
