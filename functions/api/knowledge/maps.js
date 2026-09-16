/**
 * /api/knowledge/maps
 *
 * GET                 -> maps this user may see, with role and knowledge score
 * POST                -> create a map; optionally import a seed graph
 * PATCH ?id=          -> update title/description/visibility (owner or admin)
 * DELETE ?id=         -> archive (owner or admin). Nothing is hard-deleted.
 */

import {
  json, readJson, userOf, userId, isAdmin, visibleMaps, requireRole,
  jsonField, asArray, nowIso, newId, slugify, scoreMap, reindexNode, withJson
} from '../../_lib/knowledge.js';

async function _onRequestGet(context) {
  const { env } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const maps = await visibleMaps(env, user);
  return json({ ok: true, maps, isAdmin: isAdmin(user) });
}

async function _onRequestPost(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const body = await readJson(request);
  if (!body || !body.title) return json({ error: 'Missing title' }, 400);

  const kind = body.kind === 'process' ? 'process' : 'system';
  const domain = String(body.domain || 'hvac').slice(0, 40);
  const id = newId('map');
  const now = nowIso();
  const uid = userId(user);

  let slug = slugify(body.title);
  const clash = await env.DB.prepare('SELECT id FROM knowledge_maps WHERE slug = ?').bind(slug).first();
  if (clash) slug = slug + '-' + Math.random().toString(36).slice(2, 6);

  // Lanes belong to the map. A seeded map copies its pack's lanes; a blank
  // map starts with none so the user names their own, rather than silently
  // inheriting Refrigeration cycle / Air side / Water side.
  const lanes = Array.isArray(body.lanes) ? body.lanes.slice(0, 24).map((l, i) => ({
    id: String(l.id || '').replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 40) || 'lane' + (i + 1),
    label: String(l.label || '').slice(0, 60) || 'Lane ' + (i + 1),
    token: '--kg-lane-' + ((i % 7) + 1),
  })) : [];

  await env.DB.prepare(
    'INSERT INTO knowledge_maps (id, slug, title, kind, domain, description, owner_id, ' +
    'visibility, status, lanes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    id, slug, String(body.title).slice(0, 200), kind, domain,
    String(body.description || '').slice(0, 1000), uid,
    body.visibility === 'org' ? 'org' : 'restricted', 'active',
    JSON.stringify(lanes), now, now
  ).run();

  // The creator owns it. Everyone else needs an admin to grant access.
  await env.DB.prepare(
    'INSERT INTO knowledge_map_access (map_id, user_id, role, granted_by, granted_at) VALUES (?,?,?,?,?)'
  ).bind(id, uid, 'owner', uid, now).run();

  let imported = 0;
  if (body.seed && Array.isArray(body.seed.nodes)) {
    imported = await importSeed(env, id, body.seed, uid, body.autoApprove === true && isAdmin(user));
  }

  await refreshCounts(env, id);
  return json({ ok: true, id, slug, imported });
}

async function _onRequestPatch(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);
  if (!(await requireRole(env, user, id, 'owner'))) return json({ error: 'Not allowed' }, 403);

  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid body' }, 400);

  const sets = [], binds = [];
  if (typeof body.title === 'string') { sets.push('title = ?'); binds.push(body.title.slice(0, 200)); }
  if (typeof body.description === 'string') { sets.push('description = ?'); binds.push(body.description.slice(0, 1000)); }
  if (body.visibility === 'org' || body.visibility === 'restricted') {
    sets.push('visibility = ?'); binds.push(body.visibility);
  }
  if (Array.isArray(body.lanes)) {
    // Ids are stable and referenced by every node's `lane` column, so they
    // are taken as given. Only the colour is reassigned, by position, so the
    // palette stays in order when a lane is moved or removed.
    const lanes = body.lanes.slice(0, 24).map((l, i) => ({
      id: String(l.id || '').replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 40) || 'lane' + (i + 1),
      label: String(l.label || '').slice(0, 60) || 'Lane ' + (i + 1),
      token: '--kg-lane-' + ((i % 7) + 1),
    }));
    sets.push('lanes = ?'); binds.push(JSON.stringify(lanes));
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);

  sets.push('updated_at = ?'); binds.push(nowIso());
  binds.push(id);

  await env.DB.prepare('UPDATE knowledge_maps SET ' + sets.join(', ') + ' WHERE id = ?').bind(...binds).run();
  return json({ ok: true });
}

async function _onRequestDelete(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);
  if (!(await requireRole(env, user, id, 'owner'))) return json({ error: 'Not allowed' }, 403);

  await env.DB.prepare("UPDATE knowledge_maps SET status = 'archived', updated_at = ? WHERE id = ?")
    .bind(nowIso(), id).run();

  // Archived knowledge must stop answering downstream queries immediately.
  await env.DB.prepare('DELETE FROM knowledge_terms WHERE map_id = ?').bind(id).run();

  return json({ ok: true });
}

/* ── Seed import ───────────────────────────────────────────────────────────
   Seed nodes arrive as drafts by default. An admin can auto-approve on import
   to get the HVAC starter graph answering queries straight away, but the
   normal path is that a person reads each node before it becomes trusted.
   ------------------------------------------------------------------------ */

async function importSeed(env, mapId, seed, uid, autoApprove) {
  const now = nowIso();
  const status = autoApprove ? 'approved' : 'draft';
  const byRef = {};

  const lanes = {};
  (seed.nodes || []).forEach(n => { lanes[n.lane] = (lanes[n.lane] || 0) + 1; });
  const laneOrder = Object.keys(lanes);
  const laneRow = {};

  const nodeStmt = env.DB.prepare(
    'INSERT INTO knowledge_nodes (id, map_id, kind, title, aliases, summary, body, attributes, ' +
    'tags, standards, lane, x, y, status, created_by, created_at, updated_at, approved_by, approved_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );

  const nodeBatch = (seed.nodes || []).slice(0, 500).map(n => {
    const id = newId('n');
    byRef[n.ref] = id;
    const laneIndex = Math.max(0, laneOrder.indexOf(n.lane));
    const row = (laneRow[n.lane] = (laneRow[n.lane] || 0) + 1) - 1;
    return nodeStmt.bind(
      id, mapId, n.kind, n.title,
      jsonField(n.aliases), n.summary || '', n.body || '',
      jsonField(n.attributes), jsonField(n.tags), jsonField(n.standards),
      n.lane || '', 120 + laneIndex * 320, 120 + row * 150,
      status, uid, now, now,
      autoApprove ? uid : null, autoApprove ? now : null
    );
  });

  if (nodeBatch.length) await env.DB.batch(nodeBatch);

  const edgeStmt = env.DB.prepare(
    'INSERT INTO knowledge_edges (id, map_id, from_id, to_id, relation, medium, label, status, ' +
    'created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  );

  const edgeBatch = (seed.edges || []).map(e => {
    const from = byRef[e[0]], to = byRef[e[2]];
    if (!from || !to) return null;
    return edgeStmt.bind(
      newId('e'), mapId, from, to, e[1], e[3] || null, e[4] || null, status, uid, now
    );
  }).filter(Boolean);

  if (edgeBatch.length) await env.DB.batch(edgeBatch);

  if (autoApprove) {
    const rows = await env.DB.prepare('SELECT * FROM knowledge_nodes WHERE map_id = ?').bind(mapId).all();
    for (const r of ((rows && rows.results) || [])) {
      await reindexNode(env, r);
    }
  }

  return nodeBatch.length;
}

/* Keep the dashboard counters and score honest without recomputing on read. */
export async function refreshCounts(env, mapId) {
  const nodes = await env.DB.prepare(
    'SELECT id, status, summary, aliases, attributes FROM knowledge_nodes WHERE map_id = ?'
  ).bind(mapId).all();
  const edges = await env.DB.prepare(
    'SELECT from_id, to_id FROM knowledge_edges WHERE map_id = ?'
  ).bind(mapId).all();

  const nodeRows = (nodes && nodes.results) || [];
  const edgeRows = (edges && edges.results) || [];
  const approved = nodeRows.filter(n => n.status === 'approved').length;
  const scored = scoreMap(nodeRows, edgeRows);

  await env.DB.prepare(
    'UPDATE knowledge_maps SET node_count = ?, approved_count = ?, knowledge_score = ?, updated_at = ? WHERE id = ?'
  ).bind(nodeRows.length, approved, scored.score, nowIso(), mapId).run();

  return scored;
}

/* Wrapped so a database or runtime failure returns JSON the front end
   can read, instead of Cloudflare's HTML error page. */
export const onRequestGet = withJson(_onRequestGet);
export const onRequestPost = withJson(_onRequestPost);
export const onRequestPatch = withJson(_onRequestPatch);
export const onRequestDelete = withJson(_onRequestDelete);
