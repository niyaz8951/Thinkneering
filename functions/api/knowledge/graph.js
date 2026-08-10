/**
 * /api/knowledge/graph?map=<mapId>
 *
 * GET    -> { map, nodes[], edges[], score, findings[], role }
 * POST   -> create or update a node or an edge
 *           { type: 'node' | 'edge', ...fields }
 * PATCH  -> change status: approve / reject / propose
 *           { type, id, status, reason? }        (reviewer or above)
 * DELETE -> ?type=node|edge&id=
 *
 * Every write records a revision. Approval is the only thing that writes to
 * knowledge_terms, which is what makes a node visible to Compliance Maker.
 */

import {
  json, readJson, userOf, userId, requireRole, roleOnMap,
  jsonField, asArray, nowIso, newId, scoreMap, reindexNode,
  rowToNode, rowToEdge
} from '../../_lib/knowledge.js';
import { refreshCounts } from './maps.js';

/* ── Read ──────────────────────────────────────────────────────────────── */

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const mapId = new URL(request.url).searchParams.get('map');
  if (!mapId) return json({ error: 'Missing map' }, 400);

  const role = await roleOnMap(env, user, mapId);
  if (!role) return json({ error: 'You do not have access to this map' }, 403);

  const map = await env.DB.prepare('SELECT * FROM knowledge_maps WHERE id = ?').bind(mapId).first();
  if (!map) return json({ error: 'Map not found' }, 404);

  const nodeRows = await env.DB.prepare(
    'SELECT * FROM knowledge_nodes WHERE map_id = ? ORDER BY lane, y'
  ).bind(mapId).all();
  const edgeRows = await env.DB.prepare(
    'SELECT * FROM knowledge_edges WHERE map_id = ?'
  ).bind(mapId).all();

  const nodes = ((nodeRows && nodeRows.results) || []);
  const edges = ((edgeRows && edgeRows.results) || []);
  const scored = scoreMap(nodes, edges);

  return json({
    ok: true,
    role,
    map: {
      id: map.id, slug: map.slug, title: map.title, kind: map.kind, domain: map.domain,
      description: map.description, visibility: map.visibility,
      knowledgeScore: map.knowledge_score, lastReviewedAt: map.last_reviewed_at,
      // Lanes come from the map row, not from the domain pack, so a blank
      // map is genuinely blank instead of inheriting someone else's columns.
      lanes: parseLanes(map.lanes)
    },
    nodes: nodes.map(rowToNode),
    edges: edges.map(rowToEdge),
    score: scored.score,
    findings: scored.findings
  });
}

function parseLanes(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (err) { return []; }
}

/* ── Create / update ───────────────────────────────────────────────────── */

export async function onRequestPost(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const body = await readJson(request);
  if (!body || !body.mapId) return json({ error: 'Missing mapId' }, 400);
  if (!(await requireRole(env, user, body.mapId, 'contributor'))) {
    return json({ error: 'You need contributor access to edit this map' }, 403);
  }

  const result = body.type === 'edge'
    ? await saveEdge(env, user, body)
    : await saveNode(env, user, body);

  if (result.error) return json({ error: result.error }, result.status || 400);

  await refreshCounts(env, body.mapId);
  return json({ ok: true, id: result.id, status: result.status });
}

async function saveNode(env, user, body) {
  const now = nowIso();
  const uid = userId(user);

  if (!body.title || !String(body.title).trim()) return { error: 'A node needs a title' };
  if (!body.kind) return { error: 'A node needs a kind' };

  const fields = {
    kind: String(body.kind).slice(0, 40),
    title: String(body.title).slice(0, 300),
    aliases: jsonField(body.aliases),
    summary: String(body.summary || '').slice(0, 2000),
    body: String(body.body || '').slice(0, 20000),
    attributes: jsonField(body.attributes),
    tags: jsonField(body.tags),
    standards: jsonField(body.standards),
    lane: String(body.lane || '').slice(0, 60),
    x: Number(body.x) || 0,
    y: Number(body.y) || 0
  };

  if (body.id) {
    const existing = await env.DB.prepare(
      'SELECT * FROM knowledge_nodes WHERE id = ? AND map_id = ?'
    ).bind(body.id, body.mapId).first();
    if (!existing) return { error: 'Node not found', status: 404 };

    await recordRevision(env, existing, uid, body.changeNote);

    // Editing an approved node sends it back for review and pulls it out of
    // the retrieval index. Approved knowledge cannot be changed silently
    // underneath Compliance Maker.
    const nextStatus = existing.status === 'approved' ? 'proposed' : existing.status;

    await env.DB.prepare(
      'UPDATE knowledge_nodes SET kind=?, title=?, aliases=?, summary=?, body=?, attributes=?, ' +
      'tags=?, standards=?, lane=?, x=?, y=?, status=?, version=version+1, updated_by=?, updated_at=? ' +
      'WHERE id = ?'
    ).bind(
      fields.kind, fields.title, fields.aliases, fields.summary, fields.body,
      fields.attributes, fields.tags, fields.standards, fields.lane, fields.x, fields.y,
      nextStatus, uid, now, body.id
    ).run();

    if (existing.status === 'approved' && nextStatus !== 'approved') {
      await env.DB.prepare('DELETE FROM knowledge_terms WHERE node_id = ?').bind(body.id).run();
    }

    return { id: body.id, status: nextStatus };
  }

  const id = newId('n');
  await env.DB.prepare(
    'INSERT INTO knowledge_nodes (id, map_id, kind, title, aliases, summary, body, attributes, ' +
    'tags, standards, lane, x, y, status, created_by, created_at, updated_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    id, body.mapId, fields.kind, fields.title, fields.aliases, fields.summary, fields.body,
    fields.attributes, fields.tags, fields.standards, fields.lane, fields.x, fields.y,
    'draft', uid, now, now
  ).run();

  return { id, status: 'draft' };
}

async function saveEdge(env, user, body) {
  const now = nowIso();
  const uid = userId(user);

  if (!body.from || !body.to) return { error: 'An edge needs both ends' };
  if (body.from === body.to) return { error: 'A node cannot connect to itself' };
  if (!body.relation) return { error: 'An edge needs a relation type' };

  if (body.id) {
    await env.DB.prepare(
      'UPDATE knowledge_edges SET from_id=?, to_id=?, relation=?, medium=?, label=? WHERE id=? AND map_id=?'
    ).bind(
      body.from, body.to, body.relation,
      body.medium || null, String(body.label || '').slice(0, 120),
      body.id, body.mapId
    ).run();
    return { id: body.id, status: 'updated' };
  }

  const dup = await env.DB.prepare(
    'SELECT id FROM knowledge_edges WHERE map_id=? AND from_id=? AND to_id=? AND relation=?'
  ).bind(body.mapId, body.from, body.to, body.relation).first();
  if (dup) return { id: dup.id, status: 'exists' };

  const id = newId('e');
  await env.DB.prepare(
    'INSERT INTO knowledge_edges (id, map_id, from_id, to_id, relation, medium, label, status, ' +
    'created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    id, body.mapId, body.from, body.to, body.relation,
    body.medium || null, String(body.label || '').slice(0, 120),
    'draft', uid, now
  ).run();

  return { id, status: 'draft' };
}

/* ── Status changes ────────────────────────────────────────────────────── */

export async function onRequestPatch(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const body = await readJson(request);
  if (!body || !body.mapId || !body.id || !body.status) {
    return json({ error: 'Missing mapId, id or status' }, 400);
  }

  const allowed = ['draft', 'proposed', 'approved', 'rejected', 'archived'];
  if (allowed.indexOf(body.status) === -1) return json({ error: 'Unknown status' }, 400);

  // Anyone with contributor access can propose. Only a reviewer approves.
  const needed = (body.status === 'approved' || body.status === 'rejected') ? 'reviewer' : 'contributor';
  if (!(await requireRole(env, user, body.mapId, needed))) {
    return json({ error: 'You need ' + needed + ' access for that' }, 403);
  }

  const now = nowIso();
  const uid = userId(user);
  const table = body.type === 'edge' ? 'knowledge_edges' : 'knowledge_nodes';

  if (body.type === 'edge') {
    await env.DB.prepare('UPDATE knowledge_edges SET status = ? WHERE id = ? AND map_id = ?')
      .bind(body.status, body.id, body.mapId).run();
    await refreshCounts(env, body.mapId);
    return json({ ok: true });
  }

  await env.DB.prepare(
    'UPDATE knowledge_nodes SET status = ?, approved_by = ?, approved_at = ?, reject_reason = ?, ' +
    'updated_at = ? WHERE id = ? AND map_id = ?'
  ).bind(
    body.status,
    body.status === 'approved' ? uid : null,
    body.status === 'approved' ? now : null,
    body.status === 'rejected' ? String(body.reason || '').slice(0, 1000) : null,
    now, body.id, body.mapId
  ).run();

  const row = await env.DB.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').bind(body.id).first();
  const indexed = row ? await reindexNode(env, row) : 0;

  await refreshCounts(env, body.mapId);
  return json({ ok: true, status: body.status, indexedTerms: indexed });
}

/* ── Delete ────────────────────────────────────────────────────────────── */

export async function onRequestDelete(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'node';
  const id = url.searchParams.get('id');
  const mapId = url.searchParams.get('map');
  if (!id || !mapId) return json({ error: 'Missing id or map' }, 400);
  if (!(await requireRole(env, user, mapId, 'contributor'))) return json({ error: 'Not allowed' }, 403);

  if (type === 'edge') {
    await env.DB.prepare('DELETE FROM knowledge_edges WHERE id = ? AND map_id = ?').bind(id, mapId).run();
  } else {
    await env.DB.prepare('DELETE FROM knowledge_terms WHERE node_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM knowledge_edges WHERE from_id = ? OR to_id = ?').bind(id, id).run();
    await env.DB.prepare('DELETE FROM knowledge_nodes WHERE id = ? AND map_id = ?').bind(id, mapId).run();
  }

  await refreshCounts(env, mapId);
  return json({ ok: true });
}

/* ── Revisions ─────────────────────────────────────────────────────────── */

async function recordRevision(env, existing, uid, note) {
  try {
    await env.DB.prepare(
      'INSERT INTO knowledge_revisions (id, node_id, map_id, version, snapshot, change_note, ' +
      'changed_by, changed_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(
      newId('rev'), existing.id, existing.map_id, existing.version || 1,
      JSON.stringify(existing).slice(0, 100000),
      String(note || '').slice(0, 500), uid, nowIso()
    ).run();
  } catch (err) {
    // History is valuable but never worth failing a save over.
  }
}
