/**
 * Dictionary <-> Knowledge Graph bridge.
 *
 * An approved dictionary entry stops being a private cache row and becomes a
 * `term` node in a Dictionary map, indexed into knowledge_terms like any other
 * approved node. From that point on it is served by tier 1 of the lookup, it
 * shows up in the map view, and Compliance Maker can match against it.
 *
 * The `term` node kind already exists in the HVAC domain pack — "Vocabulary
 * and unit definitions" — so nothing new is invented here.
 */

import { newId, nowIso, slugify, jsonField, reindexNode } from './knowledge.js';

const DICTIONARY_LANE = 'Dictionary';

const MAP_TITLES = {
  english: 'Dictionary — English reading',
  hvac: 'Dictionary — HVAC and MEP',
  business: 'Dictionary — Business process',
  general: 'Dictionary — General'
};

/** Map ids that tier 1 is allowed to answer from. */
export async function dictionaryMapIds(env) {
  const rows = await env.DB.prepare(
    "SELECT id FROM knowledge_maps WHERE slug LIKE 'dictionary-%' AND status = 'active'"
  ).all();
  return ((rows && rows.results) || []).map((r) => r.id);
}

/**
 * Finds the Dictionary map for a domain, creating it on first approval.
 * Visibility is 'org' on purpose: a dictionary that only its owner can read
 * would resolve for nobody.
 */
export async function ensureDictionaryMap(env, domain, uid) {
  const slug = 'dictionary-' + slugify(domain || 'general');

  const existing = await env.DB.prepare(
    'SELECT id FROM knowledge_maps WHERE slug = ?'
  ).bind(slug).first();
  if (existing) return existing.id;

  const id = newId('map');
  const now = nowIso();

  await env.DB.prepare(
    'INSERT INTO knowledge_maps (id, slug, title, kind, domain, description, owner_id, ' +
    'visibility, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    id, slug,
    MAP_TITLES[domain] || ('Dictionary — ' + domain),
    'system',
    domain || 'general',
    'Words readers looked up, kept once reviewed. Each node is one term.',
    uid, 'org', 'active', now, now
  ).run();

  await env.DB.prepare(
    'INSERT INTO knowledge_map_access (map_id, user_id, role, granted_by, granted_at) VALUES (?,?,?,?,?)'
  ).bind(id, uid, 'owner', uid, now).run();

  return id;
}

/**
 * Writes an approved entry into the graph and indexes it. Returns
 * { mapId, nodeId }. Safe to call twice: an entry that already has a node
 * updates that node rather than creating a duplicate.
 */
export async function promoteToGraph(env, entry, uid) {
  const mapId = entry.map_id || await ensureDictionaryMap(env, entry.domain, uid);
  const now = nowIso();

  const related = parseOr(entry.related_json, null);
  const aliases = related && Array.isArray(related.synonyms) ? related.synonyms.slice(0, 8) : [];
  const tags = ['dictionary', entry.domain].filter(Boolean);

  // The Hindi and Urdu forms go in as aliases, so searching the graph for
  // संविधान finds the node the same way searching for the English word does.
  [entry.hindi, entry.urdu, entry.urdu_roman].forEach((form) => {
    if (form && aliases.indexOf(form) === -1) aliases.push(form);
  });
  const body = buildBody(entry);

  if (entry.node_id) {
    const existing = await env.DB.prepare(
      'SELECT * FROM knowledge_nodes WHERE id = ?'
    ).bind(entry.node_id).first();

    if (existing) {
      await env.DB.prepare(
        'UPDATE knowledge_nodes SET title = ?, aliases = ?, summary = ?, body = ?, tags = ?, ' +
        "status = 'approved', updated_by = ?, updated_at = ?, approved_by = ?, approved_at = ?, " +
        'version = version + 1 WHERE id = ?'
      ).bind(
        entry.term, jsonField(aliases), entry.meaning || '', body, jsonField(tags),
        uid, now, uid, now, entry.node_id
      ).run();

      await reindexNode(env, {
        id: entry.node_id, map_id: mapId, status: 'approved',
        title: entry.term, aliases, tags, attributes: [], standards: []
      });

      await refreshCounts(env, mapId);
      return { mapId, nodeId: entry.node_id };
    }
  }

  const nodeId = newId('n');
  const position = await nextPosition(env, mapId);

  await env.DB.prepare(
    'INSERT INTO knowledge_nodes (id, map_id, kind, title, aliases, summary, body, attributes, ' +
    'tags, standards, lane, x, y, status, created_by, created_at, updated_at, approved_by, approved_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    nodeId, mapId, 'term', entry.term,
    jsonField(aliases), entry.meaning || '', body,
    jsonField([]), jsonField(tags), jsonField([]),
    DICTIONARY_LANE, position.x, position.y,
    'approved', uid, now, now, uid, now
  ).run();

  await reindexNode(env, {
    id: nodeId, map_id: mapId, status: 'approved',
    title: entry.term, aliases, tags, attributes: [], standards: []
  });

  await refreshCounts(env, mapId);
  return { mapId, nodeId };
}

/** Removes a rejected entry's node from the graph and the term index. */
export async function demoteFromGraph(env, entry) {
  if (!entry.node_id) return;
  await env.DB.prepare('DELETE FROM knowledge_terms WHERE node_id = ?').bind(entry.node_id).run();
  await env.DB.prepare(
    "UPDATE knowledge_nodes SET status = 'archived', updated_at = ? WHERE id = ?"
  ).bind(nowIso(), entry.node_id).run();
  if (entry.map_id) await refreshCounts(env, entry.map_id);
}

/* ------------------------------------------------------------------ */

function buildBody(entry) {
  const lines = [];

  const scripts = [entry.hindi, entry.urdu].filter(Boolean).join(' · ');
  if (scripts) {
    lines.push(scripts + (entry.urdu_roman ? ' (' + entry.urdu_roman + ')' : ''), '');
  }

  const usage = parseOr(entry.usage_json, null);
  const senses = parseOr(entry.senses_json, null);
  const related = parseOr(entry.related_json, null);

  if (usage && usage.length) {
    lines.push('**In use**', '');
    usage.forEach((line) => lines.push('- ' + line));
    lines.push('');
  }

  if (senses && senses.length) {
    lines.push('**Depends on context**', '');
    senses.forEach((s) => lines.push('- *' + s.field + '* — ' + s.sense));
    lines.push('');
  }

  if (related) {
    const groups = [
      ['Synonyms', related.synonyms],
      ['Antonyms', related.antonyms],
      ['Related concepts', related.concepts]
    ].filter((g) => Array.isArray(g[1]) && g[1].length);

    if (groups.length) {
      lines.push('**Related words**', '');
      groups.forEach((g) => lines.push('- ' + g[0] + ': ' + g[1].join(', ')));
      lines.push('');
    }
  }

  if (entry.origin) lines.push('**Where it comes from**', '', entry.origin, '');
  if (entry.connection) lines.push('**Worth knowing**', '', entry.connection, '');
  if (entry.memory_hook) lines.push('**Remember it**', '', entry.memory_hook, '');

  return lines.join('\n').trim();
}

/** Stacks new terms down one lane rather than piling them at the origin. */
async function nextPosition(env, mapId) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM knowledge_nodes WHERE map_id = ? AND lane = ?'
  ).bind(mapId, DICTIONARY_LANE).first();

  const index = (row && row.n) || 0;
  return { x: 120 + (Math.floor(index / 12) * 320), y: 120 + ((index % 12) * 150) };
}

async function refreshCounts(env, mapId) {
  await env.DB.prepare(
    'UPDATE knowledge_maps SET ' +
    'node_count = (SELECT COUNT(*) FROM knowledge_nodes WHERE map_id = ?1), ' +
    "approved_count = (SELECT COUNT(*) FROM knowledge_nodes WHERE map_id = ?1 AND status = 'approved'), " +
    'updated_at = ?2 WHERE id = ?1'
  ).bind(mapId, nowIso()).run();
}

function parseOr(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
