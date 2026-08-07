/**
 * /api/knowledge/admin — admin console backend
 *
 * GET  ?view=access&map=   -> who has access to a map, plus the user list
 * GET  ?view=queue         -> everything waiting for approval, across all maps
 * GET  ?view=questions     -> open questions waiting for an answer
 * GET  ?view=gaps          -> queries Compliance Maker could not answer
 *
 * POST { action: 'grant',  mapId, userId, role }
 * POST { action: 'revoke', mapId, userId }
 * POST { action: 'bulk-approve', mapId, ids: [] }
 *
 * Every route here requires admin. Per-map ownership is not enough — granting
 * access to other people is an organisation-level decision.
 */

import {
  json, readJson, userOf, userId, isAdmin, nowIso, reindexNode, asArray
} from '../../_lib/knowledge.js';
import { refreshCounts } from './maps.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!isAdmin(user)) return json({ error: 'Admin only' }, 403);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'queue';

  if (view === 'access') return accessView(env, url.searchParams.get('map'));
  if (view === 'questions') return questionsView(env);
  if (view === 'gaps') return gapsView(env);
  return queueView(env);
}

async function accessView(env, mapId) {
  if (!mapId) return json({ error: 'Missing map' }, 400);

  const granted = await env.DB.prepare(
    'SELECT user_id, role, granted_by, granted_at FROM knowledge_map_access ' +
    'WHERE map_id = ? ORDER BY granted_at DESC'
  ).bind(mapId).all();

  // The users table lives outside this feature, so read it defensively —
  // column names differ between installs and a wrong guess should not 500.
  let users = [];
  try {
    const res = await env.DB.prepare(
      'SELECT id, username, email, groups FROM users ORDER BY username LIMIT 500'
    ).all();
    users = (res && res.results) || [];
  } catch (err) {
    users = [];
  }

  return json({
    ok: true,
    access: (granted && granted.results) || [],
    users,
    usersReadable: users.length > 0
  });
}

async function queueView(env) {
  const nodes = await env.DB.prepare(
    'SELECT n.id, n.map_id, n.kind, n.title, n.summary, n.status, n.created_by, n.updated_at, ' +
    '       n.confidence, m.title AS map_title ' +
    'FROM knowledge_nodes n JOIN knowledge_maps m ON m.id = n.map_id ' +
    "WHERE n.status IN ('proposed','draft') AND m.status = 'active' " +
    'ORDER BY CASE n.status WHEN \'proposed\' THEN 0 ELSE 1 END, n.updated_at DESC LIMIT 300'
  ).all();

  return json({ ok: true, queue: (nodes && nodes.results) || [] });
}

async function questionsView(env) {
  const rows = await env.DB.prepare(
    'SELECT q.*, m.title AS map_title FROM knowledge_questions q ' +
    'LEFT JOIN knowledge_maps m ON m.id = q.map_id ' +
    "WHERE q.status IN ('open','answered') ORDER BY q.created_at DESC LIMIT 200"
  ).all();
  return json({ ok: true, questions: (rows && rows.results) || [] });
}

/* The most useful screen in the admin console: what downstream apps asked for
   and the graph could not answer. This is the writing list. */
async function gapsView(env) {
  const rows = await env.DB.prepare(
    "SELECT context, COUNT(*) AS hits, MAX(created_at) AS last_seen " +
    "FROM knowledge_usage WHERE outcome = 'unanswered' " +
    'GROUP BY context ORDER BY hits DESC LIMIT 100'
  ).all();

  const corrections = await env.DB.prepare(
    'SELECT u.node_id, n.title, COUNT(*) AS corrections, MAX(u.created_at) AS last_seen ' +
    'FROM knowledge_usage u LEFT JOIN knowledge_nodes n ON n.id = u.node_id ' +
    "WHERE u.outcome = 'corrected' GROUP BY u.node_id ORDER BY corrections DESC LIMIT 50"
  ).all();

  return json({
    ok: true,
    gaps: (rows && rows.results) || [],
    corrected: (corrections && corrections.results) || []
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!isAdmin(user)) return json({ error: 'Admin only' }, 403);

  const body = await readJson(request);
  if (!body || !body.action) return json({ error: 'Missing action' }, 400);

  const now = nowIso();
  const me = userId(user);

  if (body.action === 'grant') {
    if (!body.mapId || !body.userId) return json({ error: 'Missing mapId or userId' }, 400);
    const role = ['viewer', 'contributor', 'reviewer', 'owner'].indexOf(body.role) !== -1
      ? body.role : 'viewer';

    await env.DB.prepare(
      'INSERT INTO knowledge_map_access (map_id, user_id, role, granted_by, granted_at) ' +
      'VALUES (?,?,?,?,?) ON CONFLICT(map_id, user_id) DO UPDATE SET ' +
      'role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at'
    ).bind(body.mapId, String(body.userId), role, me, now).run();

    return json({ ok: true, role });
  }

  if (body.action === 'revoke') {
    if (!body.mapId || !body.userId) return json({ error: 'Missing mapId or userId' }, 400);
    await env.DB.prepare('DELETE FROM knowledge_map_access WHERE map_id = ? AND user_id = ?')
      .bind(body.mapId, String(body.userId)).run();
    return json({ ok: true });
  }

  if (body.action === 'bulk-approve') {
    const ids = asArray(body.ids).slice(0, 200);
    if (!body.mapId || !ids.length) return json({ error: 'Missing mapId or ids' }, 400);

    const ph = ids.map(() => '?').join(',');
    await env.DB.prepare(
      "UPDATE knowledge_nodes SET status = 'approved', approved_by = ?, approved_at = ?, " +
      'updated_at = ? WHERE map_id = ? AND id IN (' + ph + ')'
    ).bind(me, now, now, body.mapId, ...ids).run();

    // Edges between two approved nodes become approved with them; an edge to a
    // node still in draft stays hidden, so the graph never exposes half a fact.
    await env.DB.prepare(
      "UPDATE knowledge_edges SET status = 'approved' WHERE map_id = ? " +
      "AND from_id IN (SELECT id FROM knowledge_nodes WHERE map_id = ? AND status = 'approved') " +
      "AND to_id IN (SELECT id FROM knowledge_nodes WHERE map_id = ? AND status = 'approved')"
    ).bind(body.mapId, body.mapId, body.mapId).run();

    const rows = await env.DB.prepare(
      'SELECT * FROM knowledge_nodes WHERE map_id = ? AND id IN (' + ph + ')'
    ).bind(body.mapId, ...ids).all();

    let indexed = 0;
    for (const r of ((rows && rows.results) || [])) {
      indexed += await reindexNode(env, r);
    }

    await refreshCounts(env, body.mapId);
    return json({ ok: true, approved: ids.length, indexedTerms: indexed });
  }

  return json({ error: 'Unknown action' }, 400);
}
