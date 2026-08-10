/**
 * POST /api/dictionary/prefetch
 * Body: { terms: string[], domain }
 *
 * Returns entries that are already settled — approved cache rows and approved
 * graph nodes. It never calls the model and never writes a row, so warming the
 * cache for a chapter costs one query and no AI budget.
 *
 * The point is the first tap of a reading session. A word the reader has met
 * before should open instantly rather than showing a spinner while a request
 * goes out.
 */

import { json } from '../../_lib.js';
import { normaliseTerm } from '../../_lib/knowledge.js';

const MAX_TERMS = 300;
const ALLOWED_DOMAINS = ['general', 'english', 'hvac', 'business'];

async function handlePrefetch(context) {
  const { env, request, data } = context;
  if (!data?.user) return json({ error: 'Sign in first.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const domain = ALLOWED_DOMAINS.includes(body.domain) ? body.domain : 'general';
  const terms = Array.isArray(body.terms) ? body.terms : [];

  const keys = [];
  const seen = new Set();
  for (const raw of terms) {
    const key = normalise(String(raw || ''));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= MAX_TERMS) break;
  }

  if (!keys.length) return json({ entries: [] });

  const holes = keys.map((_, i) => '?' + (i + 2)).join(',');

  const cached = await env.DB.prepare(
    `SELECT * FROM dictionary_entries
     WHERE domain = ?1 AND status = 'approved' AND term_key IN (${holes})`
  ).bind(domain, ...keys).all();

  const entries = ((cached && cached.results) || []).map(shape);
  const covered = new Set(entries.map((e) => e.key));

  // Anything the cache missed may still be an approved node on a Dictionary
  // map. Those are matched on the graph's own normalisation, not ours.
  const graphKeys = keys.filter((k) => !covered.has(k)).map((k) => [k, normaliseTerm(k)]);

  if (graphKeys.length) {
    const graphHoles = graphKeys.map((_, i) => '?' + (i + 3)).join(',');
    try {
      const nodes = await env.DB.prepare(
        `SELECT t.term AS matched, n.title AS term, n.summary AS meaning, m.id AS map_id
         FROM knowledge_terms t
         JOIN knowledge_nodes n ON n.id = t.node_id
         JOIN knowledge_maps  m ON m.id = t.map_id
         LEFT JOIN knowledge_map_access a ON a.map_id = m.id AND a.user_id = ?2
         WHERE n.status = 'approved' AND m.status = 'active' AND m.domain = ?1
           AND (a.user_id IS NOT NULL OR m.visibility = 'org' OR m.owner_id = ?2)
           AND t.term IN (${graphHoles})`
      ).bind(domain, data.user.id || data.user.email, ...graphKeys.map((g) => g[1])).all();

      const byMatched = new Map(((nodes && nodes.results) || []).map((r) => [r.matched, r]));

      for (const [key, graphKey] of graphKeys) {
        const node = byMatched.get(graphKey);
        if (!node || !node.meaning) continue;
        entries.push({
          key,
          term: node.term,
          domain,
          status: 'approved',
          source: 'kg',
          meaning: node.meaning,
          usage: [],
          senses: [],
          related: null,
          memoryHook: null,
          hindi: null,
          urdu: null,
          urduRoman: null,
          connection: null,
          origin: null,
          mapId: node.map_id,
          mapTitle: null
        });
      }
    } catch (err) {
      console.log('dictionary prefetch: graph pass skipped —', err.message);
    }
  }

  return json({ entries });
}

function shape(row) {
  return {
    key: row.term_key,
    term: row.term,
    domain: row.domain,
    status: row.status,
    source: 'cache',
    entryId: row.id,
    meaning: row.meaning,
    usage: parseOr(row.usage_json, []),
    senses: parseOr(row.senses_json, []),
    related: parseOr(row.related_json, null),
    memoryHook: row.memory_hook || null,
    hindi: row.hindi || null,
    urdu: row.urdu || null,
    urduRoman: row.urdu_roman || null,
    connection: row.connection || null,
    origin: row.origin || null,
    mapId: row.map_id || null,
    mapTitle: null
  };
}

function parseOr(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalise(term) {
  return term
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^['\-]+|['\-]+$/g, '')
    .trim();
}

/**
 * Any throw that escapes a Pages Function is served as an HTML error page,
 * and a client calling response.json() on that gets a parse failure rather
 * than the real reason. Wrapping every handler keeps the contract JSON, so
 * "no such column: hindi" reaches the browser as those words.
 */
function withJson(handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      console.log('dictionary error:', err && err.stack ? err.stack : err);
      return json({ error: (err && err.message) || 'Unexpected server error.' }, 500);
    }
  };
}

export const onRequestPost = withJson(handlePrefetch);
