/**
 * Semantic retrieval.
 * =============================================================================
 * knowledge_terms matches literal words. Ask "explosion proof enclosure" and it
 * will not find your ATEX node unless somebody thought to add that alias — and
 * every miss teaches you to stop asking, which is how a knowledge base dies
 * quietly while looking healthy.
 *
 * This adds meaning-based matching beside it. Both run; the results merge. It
 * does not replace the keyword index, because the two fail in opposite ways:
 * keyword is exact and brittle, embeddings are fuzzy and occasionally
 * confident about nothing. A node found by both is almost certainly right, and
 * that agreement is what the merge scores highest.
 *
 * Everything here degrades to nothing. No VECTORIZE binding, no embedding
 * model, an API error — retrieval falls back to exactly what it did before.
 * A graph that stops answering because an optional index is missing would be
 * a worse system than the one that had no semantics at all.
 *
 * The approved-only rule is NOT relaxed. A vector match returns an id; the
 * node behind it is still loaded with `status = 'approved'` in the SQL, so a
 * draft node cannot reach an answer by the back door.
 */


import { EMBED_MODEL } from './models.js';

/* Vectorize returns cosine scores in roughly 0..1 for this model. Below this
   the "match" is usually the index shrugging — bge will happily return its
   nearest neighbour for a query with no real neighbour at all. */
const MIN_SCORE = 0.62;

export function semanticEnabled(env) {
  return !!(env && env.VECTORIZE && env.AI);
}

/**
 * The text a node is embedded from.
 *
 * Title, aliases and summary — not the body. The body is often a pasted clause
 * or a long note, and embedding it drowns the subject: a node about drain pans
 * whose body quotes four paragraphs of a specification starts matching
 * questions about specifications rather than about drain pans.
 */
export function embedText(node) {
  const aliases = parseList(node.aliases).join(', ');
  return [
    node.title,
    aliases,
    node.summary || '',
    node.kind ? '(' + node.kind + ')' : ''
  ].filter(Boolean).join(' — ').slice(0, 1200);
}

export async function embed(env, text) {
  if (!env.AI) return null;
  try {
    const res = await env.AI.run(EMBED_MODEL, { text: [String(text).slice(0, 1200)] });
    const v = res && res.data && res.data[0];
    return Array.isArray(v) && v.length ? v : null;
  } catch (err) {
    console.log('embedding failed:', err && err.message);
    return null;
  }
}

/**
 * Node ids whose meaning is close to the query, with their scores.
 * Returns [] for every failure mode — never throws into the answer path.
 */
export async function semanticIds(env, query, opts) {
  if (!semanticEnabled(env)) return [];

  const vector = await embed(env, query);
  if (!vector) return [];

  try {
    const res = await env.VECTORIZE.query(vector, {
      topK: Math.min(30, (opts && opts.limit) || 20),
      returnMetadata: 'indexed'
    });
    const matches = (res && res.matches) || [];
    return matches
      .filter((m) => m.score >= MIN_SCORE)
      .map((m) => ({ nodeId: m.id, score: m.score }));
  } catch (err) {
    console.log('vector query failed:', err && err.message);
    return [];
  }
}

/**
 * Write one node's vector. Called on approval and on edit.
 *
 * Only approved nodes are indexed. A draft in the index would be a draft the
 * ask box can find, and "approved only" has to mean the same thing on every
 * path or it means nothing.
 */
export async function indexNode(env, node) {
  if (!semanticEnabled(env) || !node) return false;

  if (node.status !== 'approved') {
    // Demotion matters as much as promotion: a node rejected after being
    // approved must leave the index, or it keeps answering.
    try { await env.VECTORIZE.deleteByIds([node.id]); } catch (err) { /* not there */ }
    return false;
  }

  const vector = await embed(env, embedText(node));
  if (!vector) return false;

  try {
    await env.VECTORIZE.upsert([{
      id: node.id,
      values: vector,
      // Kept small on purpose: Vectorize metadata is for filtering, not for
      // carrying the node. The database remains the single source of what a
      // node says — the index only ever answers "which ids".
      metadata: { mapId: node.map_id, kind: node.kind || '' }
    }]);
    return true;
  } catch (err) {
    console.log('vector upsert failed:', err && err.message);
    return false;
  }
}

export async function removeFromIndex(env, nodeId) {
  if (!semanticEnabled(env) || !nodeId) return;
  try { await env.VECTORIZE.deleteByIds([nodeId]); } catch (err) { /* not there */ }
}

/**
 * Merge keyword hits with semantic hits.
 *
 * Keyword scores are sums of term weights and run to double figures; cosine
 * scores sit in 0..1. Adding them raw would let one keyword hit outrank every
 * semantic result forever, so both are normalised to 0..1 against the best in
 * their own list first.
 *
 * A node found by both gets a deliberate bonus. Agreement between two methods
 * that fail differently is the strongest signal available here.
 */
export function mergeHits(keywordHits, semanticHits, limit) {
  const kMax = Math.max(1, ...keywordHits.map((h) => Number(h.score) || 0));
  const sMax = Math.max(0.0001, ...semanticHits.map((h) => h.score));

  const byId = new Map();

  for (const h of keywordHits) {
    byId.set(h.node_id, {
      node_id: h.node_id,
      keyword: (Number(h.score) || 0) / kMax,
      semantic: 0,
      matched: h.matched || ''
    });
  }

  for (const h of semanticHits) {
    const existing = byId.get(h.nodeId);
    if (existing) existing.semantic = h.score / sMax;
    else byId.set(h.nodeId, { node_id: h.nodeId, keyword: 0, semantic: h.score / sMax, matched: '' });
  }

  return Array.from(byId.values())
    .map((h) => {
      const both = h.keyword > 0 && h.semantic > 0;
      return Object.assign(h, {
        score: h.keyword * 0.6 + h.semantic * 0.5 + (both ? 0.25 : 0),
        via: both ? 'both' : (h.keyword > 0 ? 'keyword' : 'meaning')
      });
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function parseList(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch (err) {
    return [];
  }
}
