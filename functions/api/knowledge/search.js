/**
 * /api/knowledge/search — the retrieval contract, over HTTP.
 * =============================================================================
 * The matching, access rules and scoring live in _lib/graph-retrieval.js, which
 * Compliance Maker calls directly. This endpoint is the same retrieval exposed
 * for external callers and for testing a clause by hand.
 *
 * It used to hold its own copy of the tokeniser, the access query and an
 * isAdmin() that tested fields the session user does not carry — so the admin
 * branch never fired and an admin saw no maps at all. One implementation now.
 *
 * POST /api/knowledge/search
 *   { query, domain?, kinds?, projectId?, limit? }
 * →
 *   { ok, matches: [{ nodeId, title, kind, scope, summary, facts, standards,
 *                     related, matchedTerms, score, approvedAt }],
 *     unmatchedTerms: [...] }
 *
 * GET /api/knowledge/search?q=... does the same for quick testing.
 *
 * unmatchedTerms is returned deliberately. A clause the graph cannot answer is
 * the most useful signal it produces: it names exactly what to write next.
 */

import { json, withJson, userOf } from '../../_lib/knowledge.js';
import { retrieve } from '../../_lib/graph-retrieval.js';

async function handle(context, body) {
  const { env } = context;
  const user = userOf(context);

  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);
  if (!body || !String(body.query || '').trim()) return json({ error: 'Missing query' }, 400);

  const result = await retrieve(env, user, body.query, {
    domain: body.domain || null,
    kinds: Array.isArray(body.kinds) ? body.kinds : null,
    projectId: body.projectId || null,
    limit: Number(body.limit) || 8
  });

  return json({ ok: true, matches: result.matches, unmatchedTerms: result.unmatchedTerms });
}

export const onRequestPost = withJson(async (context) => {
  let body = null;
  try { body = await context.request.json(); } catch (err) { body = null; }
  return handle(context, body);
});

export const onRequestGet = withJson(async (context) => {
  const url = new URL(context.request.url);
  return handle(context, {
    query: url.searchParams.get('q') || '',
    domain: url.searchParams.get('domain') || null,
    projectId: url.searchParams.get('projectId') || null,
    limit: Number(url.searchParams.get('limit')) || 8
  });
});
