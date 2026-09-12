/**
 * /api/knowledge/actions — what is outstanding, and what was done.
 * =============================================================================
 *   GET  ?mapId=…              open actions on the map, overdue first
 *   GET  ?mapId=…&node=…       open actions on one node
 *   GET  ?mapId=…&history=1    closed actions with their outcomes
 *   POST { mapId, nodeId?, title, detail?, due?, priority?, owner? }
 *   PATCH { id, state?, outcome?, ... }
 *
 * Closing an action requires an outcome. That is enforced by a CHECK on the
 * table as well as here, because the outcome is the only part of this that is
 * worth anything in six months — an action closed with nothing written on it
 * records that you were busy, which you already knew.
 */

import {
  json, withJson, userOf, userId, requireRole, nowIso, newId
} from '../../_lib/knowledge.js';

const STATES = ['open', 'doing', 'waiting', 'done', 'dropped'];
const CLOSED = ['done', 'dropped'];

export const onRequestGet = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const url = new URL(request.url);
  const mapId = url.searchParams.get('mapId');
  if (!mapId) return json({ error: 'Missing mapId' }, 400);

  const role = await requireRole(env, user, mapId, 'viewer');
  if (!role) return json({ error: 'You cannot read this map' }, 403);

  const nodeId = url.searchParams.get('node');
  const assignee = url.searchParams.get('assignee');
  const wantHistory = url.searchParams.get('history') === '1';

  // Who is carrying what. The question a regional role asks most often, and
  // the one free-text owners could never answer.
  if (url.searchParams.get('people') === '1') {
    const res = await env.DB.prepare(
      'SELECT * FROM knowledge_person_load WHERE map_id = ? ORDER BY overdue_actions DESC, ' +
      'open_actions DESC, person ASC'
    ).bind(mapId).all();
    return json({ ok: true, people: (res && res.results) || [] });
  }

  if (wantHistory) {
    const binds = [mapId];
    let sql = 'SELECT * FROM knowledge_action_history WHERE map_id = ?';
    // A person's history is what they closed, wherever it hung. Filtering by
    // node as well would hide exactly the record you opened them to read.
    if (assignee) { sql += ' AND assignee_id = ?'; binds.push(assignee); }
    else if (nodeId) { sql += ' AND node_id = ?'; binds.push(nodeId); }
    // Most recent first: the question is almost always "have we hit this
    // before, and what did we do".
    sql += ' ORDER BY closed_at DESC LIMIT 100';
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return json({ ok: true, history: (res && res.results) || [] });
  }

  const binds = [mapId];
  let sql = 'SELECT * FROM knowledge_open_actions WHERE map_id = ?';
  if (assignee) { sql += ' AND assignee_id = ?'; binds.push(assignee); }
  else if (nodeId) { sql += ' AND node_id = ?'; binds.push(nodeId); }
  sql += ' ORDER BY overdue DESC, priority ASC, due IS NULL, due ASC, created_at ASC LIMIT 200';

  const res = await env.DB.prepare(sql).bind(...binds).all();
  const rows = (res && res.results) || [];

  return json({
    ok: true,
    actions: rows,
    open: rows.length,
    overdue: rows.filter((r) => r.overdue).length
  });
});

export const onRequestPost = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body = null;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || !body.mapId) return json({ error: 'Missing mapId' }, 400);

  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) return json({ error: 'An action needs a title' }, 400);

  const role = await requireRole(env, user, body.mapId, 'contributor');
  if (!role) return json({ error: 'You cannot add actions to this map' }, 403);

  // A node id that belongs to another map would attach the action to
  // something the reader of this map can never see.
  let nodeId = body.nodeId ? String(body.nodeId) : null;
  if (nodeId) {
    const owned = await env.DB.prepare(
      'SELECT id FROM knowledge_nodes WHERE id = ? AND map_id = ?'
    ).bind(nodeId, body.mapId).first();
    if (!owned) nodeId = null;
  }

  const assigneeId = await resolveAssignee(env, body.mapId, body.assigneeId);

  const id = newId('ka');
  const now = nowIso();

  await env.DB.prepare(
    'INSERT INTO knowledge_actions ' +
    '(id, map_id, node_id, assignee_id, title, detail, state, priority, due, owner, source_ref, ' +
    ' created_by, created_at, updated_at) ' +
    "VALUES (?,?,?,?,?,?,'open',?,?,?,?,?,?,?)"
  ).bind(
    id, body.mapId, nodeId, assigneeId, title,
    String(body.detail || '').slice(0, 2000),
    clampPriority(body.priority),
    normaliseDue(body.due),
    String(body.owner || '').slice(0, 120),
    String(body.sourceRef || '').slice(0, 200),
    userId(user), now, now
  ).run();

  return json({ ok: true, id });
});

export const onRequestPatch = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body = null;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || !body.id) return json({ error: 'Missing id' }, 400);

  const row = await env.DB.prepare(
    'SELECT * FROM knowledge_actions WHERE id = ?'
  ).bind(body.id).first();
  if (!row) return json({ error: 'No such action' }, 404);

  const role = await requireRole(env, user, row.map_id, 'contributor');
  if (!role) return json({ error: 'You cannot change actions on this map' }, 403);

  const state = STATES.indexOf(String(body.state || '')) !== -1 ? String(body.state) : row.state;
  const outcome = body.outcome !== undefined
    ? String(body.outcome).slice(0, 4000)
    : row.outcome;

  // The rule worth stating twice. 'dropped' is exempt: "we decided not to"
  // is a complete outcome, and forcing prose for it would just produce "n/a".
  if (state === 'done' && !outcome.trim()) {
    return json({
      error: 'Write what happened before closing this. An action closed with nothing ' +
             'on it records that you were busy, which is not worth keeping.'
    }, 400);
  }

  const assigneeId = body.assigneeId !== undefined
    ? await resolveAssignee(env, row.map_id, body.assigneeId)
    : row.assignee_id;

  await env.DB.prepare(
    'UPDATE knowledge_actions SET title = ?, detail = ?, state = ?, priority = ?, ' +
    'due = ?, owner = ?, outcome = ?, source_ref = ?, assignee_id = ?, updated_at = ? WHERE id = ?'
  ).bind(
    body.title !== undefined ? String(body.title).slice(0, 200) : row.title,
    body.detail !== undefined ? String(body.detail).slice(0, 2000) : row.detail,
    state,
    body.priority !== undefined ? clampPriority(body.priority) : row.priority,
    body.due !== undefined ? normaliseDue(body.due) : row.due,
    body.owner !== undefined ? String(body.owner).slice(0, 120) : row.owner,
    outcome,
    body.sourceRef !== undefined ? String(body.sourceRef).slice(0, 200) : row.source_ref,
    assigneeId,
    nowIso(), body.id
  ).run();

  return json({ ok: true, state, closed: CLOSED.indexOf(state) !== -1 });
});

export const onRequestDelete = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  const row = await env.DB.prepare(
    'SELECT map_id, state FROM knowledge_actions WHERE id = ?'
  ).bind(id).first();
  if (!row) return json({ error: 'No such action' }, 404);

  // Reviewer to delete, contributor to close. Deleting a closed action
  // destroys the record of what was done, which is the asset here; dropping
  // it with a reason keeps it.
  const need = CLOSED.indexOf(row.state) !== -1 ? 'reviewer' : 'contributor';
  const role = await requireRole(env, user, row.map_id, need);
  if (!role) {
    return json({
      error: need === 'reviewer'
        ? 'Closed actions are the record of what was done. Only a reviewer can delete one.'
        : 'You cannot change actions on this map'
    }, 403);
  }

  await env.DB.prepare('DELETE FROM knowledge_actions WHERE id = ?').bind(id).run();
  return json({ ok: true });
});

/**
 * An assignee must be a person node on this map.
 *
 * Not merely a node: pointing an action at a factory or a process would make
 * knowledge_person_load quietly wrong, and a workload view that is quietly
 * wrong is worse than none. An unresolvable value clears the assignment
 * rather than half-storing it — the free-text `owner` field is there for
 * anyone who genuinely has no node.
 */
async function resolveAssignee(env, mapId, assigneeId) {
  if (!assigneeId) return null;
  const row = await env.DB.prepare(
    "SELECT id FROM knowledge_nodes WHERE id = ? AND map_id = ? AND kind = 'person'"
  ).bind(String(assigneeId), mapId).first();
  return row ? row.id : null;
}

function clampPriority(v) {
  const n = Number(v);
  if (!n || n < 1) return 2;
  return n > 3 ? 3 : Math.round(n);
}

/* Dates are stored as plain YYYY-MM-DD so the overdue comparison in
   knowledge_open_actions is a string compare against date('now'). Anything
   else is dropped rather than coerced into a date nobody meant. */
function normaliseDue(v) {
  if (!v) return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
