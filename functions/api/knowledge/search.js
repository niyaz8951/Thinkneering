/**
 * /api/knowledge/search — the retrieval contract
 * =============================================================================
 * This is the endpoint that replaces the knowledge-tree spreadsheet. Compliance
 * Maker calls it with a specification clause and gets back approved facts with
 * provenance.
 *
 * POST /api/knowledge/search
 *   {
 *     query: "AHU casing shall achieve mechanical strength class D1 to EN 1886",
 *     domain: "hvac",            // optional filter
 *     kinds: ["equipment"],      // optional filter on node kind
 *     limit: 8                   // default 8, max 25
 *   }
 * →
 *   {
 *     ok: true,
 *     matches: [{
 *       nodeId, mapId, mapTitle, kind, title, summary,
 *       attributes: [{name, value, unit, basis}],
 *       standards: ["EN 1886"],
 *       related: [{relation, title}],
 *       confidence, score, matchedTerms: ["ahu", "en 1886", "casing"],
 *       approvedAt, approvedBy
 *     }],
 *     unmatchedTerms: ["mechanical strength class"]
 *   }
 *
 * Three rules this endpoint never breaks:
 *
 *   1. ONLY status = 'approved' rows are returned. Draft and proposed knowledge
 *      is invisible here no matter who wrote it. That is the whole point of the
 *      approval step.
 *   2. Nothing is generated. This is a lookup, not a model call. Whatever comes
 *      back was written by a person and approved by a person.
 *   3. unmatchedTerms is returned deliberately. When Compliance Maker gets a
 *      clause it has no knowledge for, that gap is the most useful signal the
 *      graph produces — it tells you exactly what to write next.
 *
 * GET /api/knowledge/search?q=... does the same thing for quick testing.
 * =============================================================================
 */

/* Words that carry no retrieval value in a specification clause. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'be', 'is',
  'are', 'as', 'at', 'by', 'on', 'from', 'that', 'this', 'it', 'its', 'shall',
  'should', 'must', 'may', 'will', 'not', 'all', 'any', 'each', 'per', 'such',
  'which', 'their', 'these', 'those', 'other', 'than', 'have', 'has', 'been',
  'provide', 'provided', 'including', 'include', 'included', 'required',
  'requirement', 'requirements', 'specified', 'specification', 'accordance',
  'complying', 'comply', 'suitable', 'approved', 'equal', 'above', 'below'
]);

const MAX_LIMIT = 25;

export async function onRequestPost(context) {
  return handle(context, await readBody(context.request));
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  return handle(context, {
    query: url.searchParams.get('q') || '',
    domain: url.searchParams.get('domain') || null,
    limit: Number(url.searchParams.get('limit')) || 8
  });
}

async function readBody(request) {
  try { return await request.json(); }
  catch (err) { return null; }
}

async function handle(context, body) {
  const { env } = context;

  const user = context.data && context.data.user;
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);
  if (!body || !body.query || !String(body.query).trim()) {
    return json({ error: 'Missing query' }, 400);
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || 8));
  const terms = tokenise(String(body.query));
  if (!terms.length) return json({ ok: true, matches: [], unmatchedTerms: [] });

  // Which maps may this caller see? Access is per map, granted by an admin.
  const visibleMaps = await visibleMapIds(env, user);
  if (!visibleMaps.length) return json({ ok: true, matches: [], unmatchedTerms: terms });

  const mapPlaceholders = visibleMaps.map(() => '?').join(',');
  const termPlaceholders = terms.map(() => '?').join(',');

  // Score = sum of term weights, so a node matching "ahu" (title, weight 3)
  // and "en 1886" (standard, weight 2) outranks one matching a single tag.
  const sql =
    'SELECT t.node_id AS node_id, ' +
    '       SUM(t.weight) AS score, ' +
    "       GROUP_CONCAT(DISTINCT t.term) AS matched " +
    'FROM knowledge_terms t ' +
    'JOIN knowledge_nodes n ON n.id = t.node_id ' +
    'WHERE t.term IN (' + termPlaceholders + ') ' +
    '  AND t.map_id IN (' + mapPlaceholders + ') ' +
    "  AND n.status = 'approved' " +
    (body.domain ? '  AND t.map_id IN (SELECT id FROM knowledge_maps WHERE domain = ?) ' : '') +
    'GROUP BY t.node_id ' +
    'ORDER BY score DESC ' +
    'LIMIT ?';

  const binds = terms.concat(visibleMaps);
  if (body.domain) binds.push(String(body.domain));
  binds.push(limit);

  let hits;
  try {
    hits = await env.DB.prepare(sql).bind(...binds).all();
  } catch (err) {
    return json({ error: 'Retrieval failed' }, 500);
  }

  const rows = (hits && hits.results) || [];
  if (!rows.length) return json({ ok: true, matches: [], unmatchedTerms: terms });

  const nodeIds = rows.map(r => r.node_id);
  const nodes = await loadNodes(env, nodeIds, body.kinds);
  const related = await loadRelated(env, nodeIds);

  const matches = rows.map(r => {
    const n = nodes[r.node_id];
    if (!n) return null;
    return {
      nodeId: n.id,
      mapId: n.map_id,
      mapTitle: n.map_title,
      kind: n.kind,
      title: n.title,
      summary: n.summary,
      attributes: parseJson(n.attributes, []),
      standards: parseJson(n.standards, []),
      tags: parseJson(n.tags, []),
      related: related[n.id] || [],
      confidence: n.confidence,
      score: Math.round(Number(r.score) * 100) / 100,
      matchedTerms: String(r.matched || '').split(',').filter(Boolean),
      approvedAt: n.approved_at,
      approvedBy: n.approved_by
    };
  }).filter(Boolean);

  // Terms nothing answered. This is the gap list.
  const covered = new Set();
  matches.forEach(m => m.matchedTerms.forEach(t => covered.add(t)));
  const unmatchedTerms = terms.filter(t => !covered.has(t));

  return json({ ok: true, matches, unmatchedTerms });
}

/* ── Tokenising ────────────────────────────────────────────────────────────
   Produces single words plus two- and three-word phrases, because the terms
   that matter in a specification are usually phrases: "face velocity",
   "air leakage class", "external static pressure". Standard designations
   like "EN 1886" and "ISO 16890" are preserved as phrases too.
   ------------------------------------------------------------------------ */

function tokenise(text) {
  // Must match normaliseTerm() in _lib/knowledge.js exactly, or the index and
  // the query will disagree about punctuation and nothing will ever match.
  const cleaned = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9./\s-]/g, ' ')
    .replace(/([a-z0-9])[./]+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const raw = cleaned.split(' ').filter(Boolean);
  const out = new Set();

  raw.forEach(w => {
    if (w.length <= 1 || STOPWORDS.has(w)) return;
    out.add(w);
    const s = singular(w);
    if (s !== w && !STOPWORDS.has(s)) out.add(s);
  });

  // Phrases come from the raw stream, so "en 1886" survives even though "en"
  // is too short to be a token on its own.
  for (let i = 0; i < raw.length - 1; i++) {
    const two = raw[i] + ' ' + raw[i + 1];
    if (two.length > 4) out.add(two);
    if (i < raw.length - 2) {
      const three = two + ' ' + raw[i + 2];
      if (three.length > 8) out.add(three);
    }
  }

  return Array.from(out).slice(0, 80);
}

function singular(word) {
  if (word.length < 4) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(ches|shes|xes|ses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/* ── Access ───────────────────────────────────────────────────────────────
   A signed-in user sees a map only if an admin granted them a row, or the map
   is marked visible to the whole organisation. Admins see everything.
   ------------------------------------------------------------------------ */

async function visibleMapIds(env, user) {
  const userId = String(user.id || user.username);

  if (isAdmin(user)) {
    const all = await env.DB.prepare(
      "SELECT id FROM knowledge_maps WHERE status = 'active'"
    ).all();
    return ((all && all.results) || []).map(r => r.id);
  }

  const rows = await env.DB.prepare(
    'SELECT m.id AS id FROM knowledge_maps m ' +
    'LEFT JOIN knowledge_map_access a ON a.map_id = m.id AND a.user_id = ? ' +
    "WHERE m.status = 'active' AND (a.user_id IS NOT NULL OR m.visibility = 'org')"
  ).bind(userId).all();

  return ((rows && rows.results) || []).map(r => r.id);
}

function isAdmin(user) {
  if (!user) return false;
  if (user.is_admin === 1 || user.is_admin === true || user.isAdmin === true) return true;
  const groups = String(user.groups || '');
  return groups.split(',').map(g => g.trim()).indexOf('admin') !== -1;
}

/* ── Loading ──────────────────────────────────────────────────────────── */

async function loadNodes(env, ids, kinds) {
  const ph = ids.map(() => '?').join(',');
  let sql =
    'SELECT n.*, m.title AS map_title FROM knowledge_nodes n ' +
    'JOIN knowledge_maps m ON m.id = n.map_id ' +
    'WHERE n.id IN (' + ph + ')';
  const binds = ids.slice();

  if (Array.isArray(kinds) && kinds.length) {
    sql += ' AND n.kind IN (' + kinds.map(() => '?').join(',') + ')';
    kinds.forEach(k => binds.push(String(k)));
  }

  const res = await env.DB.prepare(sql).bind(...binds).all();
  const out = {};
  ((res && res.results) || []).forEach(r => { out[r.id] = r; });
  return out;
}

/* One hop of context. A clause about a cooling coil is easier to answer when
   you can also see that it sits inside an AHU and needs chilled water. */
async function loadRelated(env, ids) {
  const ph = ids.map(() => '?').join(',');
  const res = await env.DB.prepare(
    'SELECT e.from_id, e.to_id, e.relation, e.label, ' +
    '       nf.title AS from_title, nt.title AS to_title ' +
    'FROM knowledge_edges e ' +
    'JOIN knowledge_nodes nf ON nf.id = e.from_id ' +
    'JOIN knowledge_nodes nt ON nt.id = e.to_id ' +
    "WHERE e.status = 'approved' " +
    "  AND nf.status = 'approved' AND nt.status = 'approved' " +
    '  AND (e.from_id IN (' + ph + ') OR e.to_id IN (' + ph + '))'
  ).bind(...ids, ...ids).all();

  const out = {};
  ((res && res.results) || []).forEach(r => {
    (out[r.from_id] = out[r.from_id] || []).push({
      relation: r.relation, direction: 'out', title: r.to_title, label: r.label
    });
    (out[r.to_id] = out[r.to_id] || []).push({
      relation: r.relation, direction: 'in', title: r.from_title, label: r.label
    });
  });

  // Keep it to a handful per node so a Compliance Maker prompt stays small.
  Object.keys(out).forEach(k => { out[k] = out[k].slice(0, 8); });
  return out;
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (err) { return fallback; }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
