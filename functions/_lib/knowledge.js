/**
 * Shared helpers for the knowledge graph endpoints.
 * Folders starting with "_" are not routed by Cloudflare Pages, so this file
 * is a module and never an endpoint.
 */

/* ── Responses ─────────────────────────────────────────────────────────── */

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function readJson(request) {
  try { return await request.json(); }
  catch (err) { return null; }
}

/**
 * Wraps an endpoint so a throw is answered with JSON instead of Cloudflare's
 * HTML error page. The frontend reads every response as JSON, so an unwrapped
 * exception surfaces as "Unexpected token '<'" and hides the real fault.
 */
export function withJson(handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      console.log('knowledge error:', err && err.stack ? err.stack : err);
      return json({ error: (err && err.message) || 'Unexpected server error.' }, 500);
    }
  };
}

/* ── Identity ──────────────────────────────────────────────────────────── */

export function userOf(context) {
  return (context.data && context.data.user) || null;
}

export function userId(user) {
  return String(user.id || user.username);
}

export function isAdmin(user) {
  if (!user) return false;
  // currentUser() selects id, email, name, role, status and plan — there is no
  // is_admin column and no groups column on the session user, so the two tests
  // below could never fire. Without this line every admin check in the
  // knowledge tools silently returned false: the admin footnote stayed hidden,
  // and visibleMaps() never took its admin branch.
  if (user.role === 'admin') return true;
  if (user.is_admin === 1 || user.is_admin === true || user.isAdmin === true) return true;
  return String(user.groups || '').split(',').map(g => g.trim()).indexOf('admin') !== -1;
}

/* ── Access ────────────────────────────────────────────────────────────────
   Two gates. The site middleware decides whether a user may reach
   /tools/knowledge/* at all. This decides which maps they see and what they
   may do inside them. An admin grants the rows; nothing is implicit.
   ------------------------------------------------------------------------ */

const ROLE_RANK = { viewer: 1, contributor: 2, reviewer: 3, owner: 4 };

export async function roleOnMap(env, user, mapId) {
  if (isAdmin(user)) return 'owner';

  const row = await env.DB.prepare(
    'SELECT role FROM knowledge_map_access WHERE map_id = ? AND user_id = ?'
  ).bind(mapId, userId(user)).first();
  if (row && row.role) return row.role;

  const map = await env.DB.prepare(
    'SELECT visibility, owner_id FROM knowledge_maps WHERE id = ?'
  ).bind(mapId).first();
  if (!map) return null;
  if (map.owner_id === userId(user)) return 'owner';
  if (map.visibility === 'org') return 'viewer';
  return null;
}

export function atLeast(role, needed) {
  return !!role && (ROLE_RANK[role] || 0) >= (ROLE_RANK[needed] || 99);
}

export async function requireRole(env, user, mapId, needed) {
  const role = await roleOnMap(env, user, mapId);
  if (!atLeast(role, needed)) return null;
  return role;
}

export async function visibleMaps(env, user) {
  if (isAdmin(user)) {
    const all = await env.DB.prepare(
      "SELECT * FROM knowledge_maps WHERE status = 'active' ORDER BY updated_at DESC"
    ).all();
    return ((all && all.results) || []).map(m => Object.assign({ role: 'owner' }, m));
  }

  const rows = await env.DB.prepare(
    'SELECT m.*, a.role AS role FROM knowledge_maps m ' +
    'LEFT JOIN knowledge_map_access a ON a.map_id = m.id AND a.user_id = ? ' +
    "WHERE m.status = 'active' AND (a.user_id IS NOT NULL OR m.visibility = 'org' OR m.owner_id = ?) " +
    'ORDER BY m.updated_at DESC'
  ).bind(userId(user), userId(user)).all();

  return ((rows && rows.results) || []).map(m => Object.assign({}, m, { role: m.role || 'viewer' }));
}

/* ── Term indexing ─────────────────────────────────────────────────────────
   Rebuilt from a node every time it is approved. This is the index Compliance
   Maker searches, so what goes in here decides what the graph can answer.

   Weights are deliberate:
     title      3.0  — a direct name match is the strongest signal
     alias      2.5  — "air handler" should score almost as well as "AHU"
     standard   2.0  — a clause citing EN 1886 should find the casing node
     attribute  1.5  — "face velocity" finds the coil
     tag        1.0  — broad grouping, weakest signal
   ------------------------------------------------------------------------ */

const WEIGHTS = { title: 3.0, alias: 2.5, standard: 2.0, attribute: 1.5, tag: 1.0 };

export function normaliseTerm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9./\s-]/g, ' ')
    // Keep internal dots and slashes ("62.1", "550/590") but drop trailing ones,
    // otherwise a clause ending "...to EN 1886." indexes as "en 1886." and
    // never matches the standard.
    .replace(/([a-z0-9])[./]+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* A crude singular form. Not a stemmer — just enough that a clause saying
   "air filters shall be..." finds a node titled "Air filter". */
export function singular(word) {
  if (word.length < 4) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(ches|shes|xes|ses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

export function buildTerms(node) {
  const seen = new Map();

  const add = (raw, source) => {
    const term = normaliseTerm(raw);
    if (!term || term.length < 2) return;
    const weight = WEIGHTS[source] || 1;
    // Keep the strongest source if the same term arrives twice.
    if (!seen.has(term) || seen.get(term).weight < weight) {
      seen.set(term, { term, weight, source });
    }
  };

  // Index a phrase and also its individual significant words, each in both
  // written and singular form. Without the word-level pass, a four-word
  // attribute name like "Casing mechanical strength class" can never be hit:
  // the query tokeniser only builds phrases up to three words.
  const addPhrase = (raw, source, wordSource) => {
    add(raw, source);
    normaliseTerm(raw).split(' ')
      .filter(w => w.length > 3)
      .forEach(w => {
        add(w, wordSource);
        const s = singular(w);
        if (s !== w) add(s, wordSource);
      });
  };

  addPhrase(node.title, 'title', 'attribute');
  asArray(node.aliases).forEach(a => addPhrase(a, 'alias', 'attribute'));
  asArray(node.tags).forEach(t => add(t, 'tag'));
  asArray(node.standards).forEach(s => addPhrase(s, 'standard', 'attribute'));

  asArray(node.attributes).forEach(a => {
    if (a && a.name) addPhrase(a.name, 'attribute', 'tag');
  });

  return Array.from(seen.values()).slice(0, 200);
}

export async function reindexNode(env, node) {
  await env.DB.prepare('DELETE FROM knowledge_terms WHERE node_id = ?').bind(node.id).run();
  if (node.status !== 'approved') return 0;

  const terms = buildTerms(node);
  if (!terms.length) return 0;

  // D1 batches beat sequential inserts by a wide margin here.
  const stmt = env.DB.prepare(
    'INSERT INTO knowledge_terms (map_id, node_id, term, weight, source) VALUES (?,?,?,?,?)'
  );
  await env.DB.batch(terms.map(t =>
    stmt.bind(node.map_id, node.id, t.term, t.weight, t.source)
  ));
  return terms.length;
}

/* ── Knowledge score ───────────────────────────────────────────────────────
   Deterministic, calculated from the graph itself. Not an AI opinion.
   ------------------------------------------------------------------------ */

export function scoreMap(nodes, edges) {
  if (!nodes.length) return { score: null, findings: [] };

  let score = 100;
  const findings = [];
  const deduct = (points, message, fix) => {
    if (points <= 0) return;
    score -= points;
    findings.push({ weight: points, message, fix });
  };

  const approved = nodes.filter(n => n.status === 'approved');
  const approvedShare = approved.length / nodes.length;
  if (approvedShare < 0.7) {
    deduct(Math.min(20, Math.round((0.7 - approvedShare) * 40)),
      Math.round(approvedShare * 100) + '% of nodes are approved',
      'Only approved nodes are visible to Compliance Maker. Unapproved knowledge does no work.');
  }

  const noSummary = nodes.filter(n => !(n.summary || '').trim());
  if (noSummary.length) {
    deduct(Math.min(15, Math.round(noSummary.length / nodes.length * 25)),
      noSummary.length + ' node' + (noSummary.length > 1 ? 's have' : ' has') + ' no summary',
      'The summary is what a downstream app reads first. A node without one returns nothing useful.');
  }

  const noAliases = nodes.filter(n => !asArray(n.aliases).length);
  if (noAliases.length / nodes.length > 0.4) {
    deduct(12,
      Math.round(noAliases.length / nodes.length * 100) + '% of nodes have no aliases',
      'Aliases are how a specification clause finds a node. "Air handler" and "AHU" have to both work.');
  }

  const connected = new Set();
  edges.forEach(e => { connected.add(e.from_id); connected.add(e.to_id); });
  const orphans = nodes.filter(n => !connected.has(n.id));
  if (orphans.length) {
    deduct(Math.min(15, orphans.length * 3),
      orphans.length + ' node' + (orphans.length > 1 ? 's are' : ' is') + ' not connected to anything',
      'An isolated node is a note, not knowledge. Connect it or fold it into its parent.');
  }

  const withAttrs = nodes.filter(n => asArray(n.attributes).length);
  if (withAttrs.length / nodes.length < 0.3) {
    deduct(10,
      'Few nodes carry structured attributes',
      'Attributes are what answer a compliance line. Prose alone cannot be checked against a clause.');
  }

  findings.sort((a, b) => b.weight - a.weight);
  return { score: Math.max(0, Math.min(100, Math.round(score))), findings };
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) { return []; }
  }
  return [];
}

export function jsonField(value) {
  return JSON.stringify(Array.isArray(value) ? value : asArray(value));
}

export function nowIso() { return new Date().toISOString(); }

export function newId(prefix) {
  return (prefix ? prefix + '-' : '') + crypto.randomUUID();
}

export function slugify(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'map';
}

export function rowToNode(r) {
  return {
    id: r.id, mapId: r.map_id, kind: r.kind, title: r.title,
    aliases: asArray(r.aliases), summary: r.summary || '', body: r.body || '',
    attributes: asArray(r.attributes), tags: asArray(r.tags), standards: asArray(r.standards),
    lane: r.lane || '', x: r.x, y: r.y,
    status: r.status, confidence: r.confidence,
    aiSummary: r.ai_summary || '', aiGaps: asArray(r.ai_gaps),
    version: r.version,
    createdBy: r.created_by, createdAt: r.created_at,
    updatedAt: r.updated_at, approvedBy: r.approved_by, approvedAt: r.approved_at,
    rejectReason: r.reject_reason || ''
  };
}

export function rowToEdge(r) {
  return {
    id: r.id, mapId: r.map_id, from: r.from_id, to: r.to_id,
    relation: r.relation, medium: r.medium || '', label: r.label || '',
    status: r.status
  };
}
