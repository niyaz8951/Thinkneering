/**
 * /api/knowledge/review — the review queue.
 * =============================================================================
 * Draft nodes surface here oldest first, one at a time, and leave by a human
 * decision. This is the loop that makes the graph improve rather than only
 * grow: a clause Compliance Maker could not answer becomes a specific
 * authoring task instead of a silent TO VERIFY nobody ever revisits.
 *
 * One at a time is deliberate. Batch approval is faster and is how a review
 * queue stops being a review — the whole value of the approved tier is that
 * somebody actually read each row before it started answering consultants.
 *
 *   GET  /api/knowledge/review              next item + remaining count
 *   GET  /api/knowledge/review?all=1        the queue, for a list view
 *   POST /api/knowledge/review  { nodeId, action: 'approve'|'reject',
 *                                 scope?, reason?, edits? }
 *
 * Approving reindexes the node, so it becomes visible to Compliance Maker in
 * the same request. Rejecting keeps the row with its reason: knowing that a
 * proposal was considered and refused is worth more than a clean table, and it
 * stops the same gap being raised again next week.
 */

import {
  json, withJson, userOf, userId, isAdmin,
  requireRole, reindexNode, rowToNode, nowIso, asArray, jsonField, newId
} from '../../_lib/knowledge.js';
import { indexNode, removeFromIndex } from '../../_lib/semantic.js';

const VALID_SCOPES = ['project', 'family', 'general'];

/* ── Read ─────────────────────────────────────────────────────────────── */

export const onRequestGet = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const url = new URL(request.url);
  const wantAll = url.searchParams.get('all') === '1';
  const mapFilter = url.searchParams.get('mapId') || null;

  const maps = await reviewableMapIds(env, user);
  if (!maps.length) return json({ ok: true, next: null, remaining: 0, queue: [] });

  const ids = mapFilter ? maps.filter((m) => m === mapFilter) : maps;
  if (!ids.length) return json({ ok: true, next: null, remaining: 0, queue: [] });

  const ph = ids.map(() => '?').join(',');
  const res = await env.DB.prepare(
    'SELECT * FROM knowledge_review_queue WHERE map_id IN (' + ph + ') ' +
    'ORDER BY created_at ASC LIMIT ?'
  ).bind(...ids, wantAll ? 100 : 1).all();

  const rows = (res && res.results) || [];
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM knowledge_review_queue WHERE map_id IN (' + ph + ')'
  ).bind(...ids).first();

  const next = rows.length ? await expand(env, rows[0]) : null;

  return json({
    ok: true,
    next,
    remaining: (count && count.n) || 0,
    queue: wantAll ? rows : []
  });
});

/* Everything needed to decide, without a second request. */
async function expand(env, row) {
  const node = await env.DB.prepare(
    'SELECT * FROM knowledge_nodes WHERE id = ?'
  ).bind(row.id).first();

  const facts = await env.DB.prepare(
    "SELECT * FROM knowledge_facts WHERE node_id = ? AND status = 'draft' ORDER BY name"
  ).bind(row.id).all();

  const edges = await env.DB.prepare(
    'SELECT e.*, nf.title AS from_title, nt.title AS to_title ' +
    'FROM knowledge_edges e ' +
    'LEFT JOIN knowledge_nodes nf ON nf.id = e.from_id ' +
    'LEFT JOIN knowledge_nodes nt ON nt.id = e.to_id ' +
    "WHERE (e.from_id = ?1 OR e.to_id = ?1) AND e.status = 'draft'"
  ).bind(row.id).all();

  // A node proposed from a clause usually names something the graph already
  // holds under another name. Showing the near-miss beside the proposal is
  // what stops the queue quietly manufacturing duplicates.
  const similar = await env.DB.prepare(
    'SELECT id, title, kind, status FROM knowledge_nodes ' +
    "WHERE map_id = ?1 AND id <> ?2 AND status = 'approved' " +
    'AND (lower(title) LIKE ?3 OR lower(title) = ?4) LIMIT 5'
  ).bind(
    row.map_id, row.id,
    '%' + String(row.title || '').toLowerCase().slice(0, 24) + '%',
    String(row.title || '').toLowerCase()
  ).all();

  return {
    ...rowToNode(node || {}),
    mapTitle: row.map_title,
    sourceRef: (node && node.source_ref) || '',
    origin: (node && node.origin) || 'human',
    scope: (node && node.scope) || 'project',
    draftFacts: (facts && facts.results) || [],
    draftEdges: (edges && edges.results) || [],
    similar: (similar && similar.results) || []
  };
}

/* ── Decide ───────────────────────────────────────────────────────────── */

export const onRequestPost = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body = null;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || !body.nodeId) return json({ error: 'Missing nodeId' }, 400);

  const action = String(body.action || '');
  if (action !== 'approve' && action !== 'reject') {
    return json({ error: "action must be 'approve' or 'reject'" }, 400);
  }

  const node = await env.DB.prepare(
    'SELECT * FROM knowledge_nodes WHERE id = ?'
  ).bind(body.nodeId).first();
  if (!node) return json({ error: 'No such node' }, 404);

  // Reviewer or above. Approval is the trust boundary; a contributor who can
  // write drafts must not also be the one who clears them.
  const role = await requireRole(env, user, node.map_id, 'reviewer');
  if (!role) return json({ error: 'You do not have review rights on this map' }, 403);

  const now = nowIso();
  const me = userId(user);

  if (action === 'reject') {
    await env.DB.prepare(
      "UPDATE knowledge_nodes SET status = 'rejected', reject_reason = ?, " +
      'updated_by = ?, updated_at = ? WHERE id = ?'
    ).bind(String(body.reason || '').slice(0, 400), me, now, node.id).run();

    await env.DB.prepare(
      "UPDATE knowledge_facts SET status = 'rejected' WHERE node_id = ? AND status = 'draft'"
    ).bind(node.id).run();

    // A rejected node must not keep answering from a stale index — either of
    // them. Demotion matters as much as promotion.
    await env.DB.prepare('DELETE FROM knowledge_terms WHERE node_id = ?').bind(node.id).run();
    await removeFromIndex(env, node.id);

    return json({ ok: true, status: 'rejected' });
  }

  /* ---- approve ---- */

  const scope = VALID_SCOPES.indexOf(String(body.scope || '')) !== -1
    ? String(body.scope)
    : (node.scope || 'project');

  // Edits made in the review sheet are the reviewer's own words and are saved
  // with the approval, so a nearly-right proposal is corrected rather than
  // rejected and retyped.
  const edits = body.edits && typeof body.edits === 'object' ? body.edits : {};
  const title = String(edits.title || node.title).slice(0, 200);
  const summary = String(edits.summary !== undefined ? edits.summary : (node.summary || '')).slice(0, 2000);
  const aliases = edits.aliases !== undefined ? jsonField(edits.aliases) : node.aliases;

  await env.DB.prepare(
    "UPDATE knowledge_nodes SET status = 'approved', title = ?, summary = ?, aliases = ?, " +
    'scope = ?, approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, ' +
    'version = version + 1 WHERE id = ?'
  ).bind(title, summary, aliases, scope, me, now, me, now, node.id).run();

  // Facts inherit the node's scope unless the reviewer set one per fact. They
  // cannot be approved by anyone else: the CHECK on knowledge_facts refuses an
  // approved row with no approver.
  await env.DB.prepare(
    "UPDATE knowledge_facts SET status = 'approved', approved_by = ?, approved_at = ?, scope = ? " +
    "WHERE node_id = ? AND status = 'draft'"
  ).bind(me, now, scope, node.id).run();

  await env.DB.prepare(
    "UPDATE knowledge_edges SET status = 'approved' WHERE " +
    "(from_id = ?1 OR to_id = ?1) AND status = 'draft' " +
    // Only edges whose other end is itself approved. Approving an edge into a
    // draft node would publish that node by the back door.
    'AND (SELECT status FROM knowledge_nodes WHERE id = ' +
    'CASE WHEN knowledge_edges.from_id = ?1 THEN knowledge_edges.to_id ' +
    "ELSE knowledge_edges.from_id END) = 'approved'"
  ).bind(node.id).run();

  await syncAliases(env, node.map_id, node.id, asArray(aliases), title);

  const fresh = await env.DB.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').bind(node.id).first();
  await reindexNode(env, fresh);
  // Best-effort: a failed embedding must not fail an approval the reviewer
  // has already made. The node is findable by keyword either way.
  await indexNode(env, fresh);
  await refreshCounts(env, node.map_id);

  return json({ ok: true, status: 'approved', scope });
});

/**
 * Keep knowledge_aliases in step with the node's own alias list.
 *
 * A collision means another node in this map already claims that name, which
 * is exactly the duplicate the unique index exists to catch. It is reported,
 * not silently dropped: the reviewer needs to know two nodes are fighting over
 * one term before a clause starts matching the wrong one.
 */
async function syncAliases(env, mapId, nodeId, aliases, title) {
  await env.DB.prepare('DELETE FROM knowledge_aliases WHERE node_id = ?').bind(nodeId).run();

  const wanted = [title].concat(aliases || [])
    .map((a) => String(a || '').trim())
    .filter(Boolean);

  const clashes = [];
  for (const alias of wanted) {
    const norm = normalise(alias);
    if (!norm) continue;
    try {
      await env.DB.prepare(
        'INSERT INTO knowledge_aliases (id, map_id, node_id, alias, alias_norm, created_at) ' +
        'VALUES (?,?,?,?,?,?)'
      ).bind(newId('ka'), mapId, nodeId, alias, norm, nowIso()).run();
    } catch (err) {
      clashes.push(alias);
    }
  }
  return clashes;
}

/* Must match normaliseTerm() in _lib/knowledge.js, or the unique index stops
   catching the duplicates it was added for. */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9./\s-]/g, ' ')
    .replace(/([a-z0-9])[./]+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function refreshCounts(env, mapId) {
  await env.DB.prepare(
    'UPDATE knowledge_maps SET ' +
    'node_count = (SELECT COUNT(*) FROM knowledge_nodes WHERE map_id = ?1), ' +
    "approved_count = (SELECT COUNT(*) FROM knowledge_nodes WHERE map_id = ?1 AND status = 'approved'), " +
    'updated_at = ?2 WHERE id = ?1'
  ).bind(mapId, nowIso()).run();
}

async function reviewableMapIds(env, user) {
  if (isAdmin(user)) {
    const all = await env.DB.prepare(
      "SELECT id FROM knowledge_maps WHERE status = 'active'"
    ).all();
    return ((all && all.results) || []).map((r) => r.id);
  }
  const rows = await env.DB.prepare(
    'SELECT m.id AS id FROM knowledge_maps m ' +
    'JOIN knowledge_map_access a ON a.map_id = m.id AND a.user_id = ? ' +
    "WHERE m.status = 'active' AND a.role IN ('reviewer','owner')"
  ).bind(userId(user)).all();
  return ((rows && rows.results) || []).map((r) => r.id);
}
