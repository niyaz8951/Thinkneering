/**
 * Graph retrieval — one implementation, two callers.
 * =============================================================================
 * /api/knowledge/search exposes this over HTTP for external callers and for
 * testing. Compliance Maker calls it in process: an answer endpoint should not
 * make an HTTP round trip to its own origin to read its own database.
 *
 * Until now Compliance Maker did neither. It read compliance_facts,
 * compliance_kb and compliance_options and never touched the knowledge graph
 * at all, while the Knowledge section told every visitor that approved nodes
 * are what it answers from. That sentence is now true.
 *
 * Three rules this module never breaks:
 *
 *   1. Only status = 'approved' is returned, for both the node and the fact.
 *      Draft knowledge is invisible here no matter who wrote it.
 *   2. Nothing is generated. Every value returned was written by a person and
 *      approved by a person.
 *   3. The gap list comes back with the matches. A clause the graph cannot
 *      answer is the most useful thing it produces, because it names exactly
 *      what to write next.
 */

import { isAdmin, normaliseTerm, singular } from './knowledge.js';
import { semanticIds, mergeHits, semanticEnabled } from './semantic.js';

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

/**
 * Single words plus two- and three-word phrases, because the terms that carry
 * meaning in a specification are usually phrases: "face velocity", "air
 * leakage class". Phrases are built from the raw stream so "en 1886" survives
 * even though "en" is too short to be a token on its own.
 */
export function tokenise(text) {
  const cleaned = normaliseTerm(text);
  const raw = cleaned.split(' ').filter(Boolean);
  const out = new Set();

  raw.forEach((w) => {
    if (w.length <= 1 || STOPWORDS.has(w)) return;
    out.add(w);
    const s = singular(w);
    if (s !== w && !STOPWORDS.has(s)) out.add(s);
  });

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

/**
 * Which maps this caller may read. Access is per map and granted by an admin;
 * an org-visible map is readable by any signed-in user.
 *
 * This used to exist twice, and the copy in search.js tested `user.is_admin`
 * and `user.groups` — neither of which the session user carries — so the admin
 * branch could never fire and an admin saw no maps at all. There is one copy
 * now and it uses the shared isAdmin().
 */
export async function visibleMapIds(env, user) {
  if (!user) return [];
  const uid = String(user.id || user.username);

  if (isAdmin(user)) {
    const all = await env.DB.prepare(
      "SELECT id FROM knowledge_maps WHERE status = 'active'"
    ).all();
    return ((all && all.results) || []).map((r) => r.id);
  }

  const rows = await env.DB.prepare(
    'SELECT m.id AS id FROM knowledge_maps m ' +
    'LEFT JOIN knowledge_map_access a ON a.map_id = m.id AND a.user_id = ? ' +
    "WHERE m.status = 'active' AND (a.user_id IS NOT NULL OR m.visibility = 'org' OR m.owner_id = ?)"
  ).bind(uid, uid).all();

  return ((rows && rows.results) || []).map((r) => r.id);
}

/**
 * Retrieve approved knowledge for a clause or question.
 *
 * Returns { matches, unmatchedTerms, facts }, where `facts` is the flat list
 * of approved facts behind the matches, ordered by scope precedence:
 * a value recorded for this project beats one recorded for the product family,
 * which beats a general rule. That ordering is the calibration rule doing its
 * job at read time — the specific thing someone confirmed on a job is what
 * should answer a question about that job.
 */
export async function retrieve(env, user, query, opts) {
  const options = opts || {};
  const limit = Math.min(25, Math.max(1, Number(options.limit) || 8));
  const terms = tokenise(String(query || ''));
  const empty = { matches: [], unmatchedTerms: terms, facts: [] };

  if (!env.DB || !terms.length) return empty;

  const maps = await visibleMapIds(env, user);
  if (!maps.length) return empty;

  const termPh = terms.map(() => '?').join(',');
  const mapPh = maps.map(() => '?').join(',');

  let sql =
    'SELECT t.node_id AS node_id, SUM(t.weight) AS score, ' +
    'GROUP_CONCAT(DISTINCT t.term) AS matched ' +
    'FROM knowledge_terms t JOIN knowledge_nodes n ON n.id = t.node_id ' +
    'WHERE t.term IN (' + termPh + ') AND t.map_id IN (' + mapPh + ") " +
    "AND n.status = 'approved' ";
  const binds = terms.concat(maps);

  if (options.domain) {
    sql += 'AND t.map_id IN (SELECT id FROM knowledge_maps WHERE domain = ?) ';
    binds.push(String(options.domain));
  }
  sql += 'GROUP BY t.node_id ORDER BY score DESC LIMIT ?';
  binds.push(limit);

  /* Keyword and meaning run together, not in sequence: the semantic call is a
     network round trip, and waiting for the keyword result before starting it
     would double the latency of the ask box for no benefit. */
  const [hits, semantic] = await Promise.all([
    env.DB.prepare(sql).bind(...binds).all(),
    semanticEnabled(env) ? semanticIds(env, String(query), { limit }) : Promise.resolve([])
  ]);

  const keywordRows = (hits && hits.results) || [];

  /* A vector match returns an id and nothing else. It may point at a node on
     a map this person cannot open, so the ids are filtered against the maps
     they were already allowed to search. */
  const mapSet = new Set(maps);
  let semanticRows = semantic;
  if (semanticRows.length) {
    const ph2 = semanticRows.map(() => '?').join(',');
    const allowedRows = await env.DB.prepare(
      "SELECT id FROM knowledge_nodes WHERE id IN (" + ph2 + ") AND status = 'approved' " +
      'AND map_id IN (' + maps.map(() => '?').join(',') + ')'
    ).bind(...semanticRows.map((r) => r.nodeId), ...maps).all();
    const ok = new Set(((allowedRows && allowedRows.results) || []).map((r) => r.id));
    semanticRows = semanticRows.filter((r) => ok.has(r.nodeId));
  }

  const rows = mergeHits(keywordRows, semanticRows, limit);
  if (!rows.length) return empty;

  const ids = rows.map((r) => r.node_id);
  const [nodes, facts, related] = await Promise.all([
    loadNodes(env, ids, options.kinds),
    loadFacts(env, ids, options.projectId),
    loadRelated(env, ids)
  ]);

  const matches = rows.map((r) => {
    const n = nodes[r.node_id];
    if (!n) return null;
    return {
      nodeId: n.id,
      mapId: n.map_id,
      mapTitle: n.map_title,
      kind: n.kind,
      title: n.title,
      summary: n.summary || '',
      scope: n.scope || 'general',
      sourceRef: n.source_ref || '',
      facts: facts.filter((f) => f.node_id === n.id),
      // The JSON attribute list stays on the payload for nodes authored before
      // knowledge_facts existed. It is unit-less and unqueryable, which is why
      // facts replaced it, but dropping it would blank out older nodes.
      attributes: parseJson(n.attributes, []),
      standards: parseJson(n.standards, []),
      tags: parseJson(n.tags, []),
      related: related[n.id] || [],
      confidence: n.confidence,
      score: Math.round(Number(r.score) * 100) / 100,
      // 'keyword', 'meaning' or 'both'. Worth surfacing: a node found only by
      // meaning is one whose aliases are missing a word people actually use,
      // which is a small, specific thing you can fix.
      via: r.via || 'keyword',
      matchedTerms: String(r.matched || '').split(',').filter(Boolean),
      approvedAt: n.approved_at,
      approvedBy: n.approved_by
    };
  }).filter(Boolean);

  /* Covered means a keyword actually matched. A semantic hit covers no
     specific term — treating it as if it did would hide exactly the gaps
     worth knowing about, which are the terms nothing in the graph is
     literally called. */
  const covered = new Set();
  matches.forEach((m) => m.matchedTerms.forEach((t) => covered.add(t)));

  return {
    matches,
    unmatchedTerms: terms.filter((t) => !covered.has(t)),
    facts
  };
}

/**
 * Approved facts that disagree with each other.
 *
 * Two approved values for the same parameter is not a data error to clean up
 * quietly — it is usually two real jobs that were specified differently, and
 * the engineer is the only one who knows which applies here. Picking the
 * higher-ranked one and saying nothing is the failure mode worth avoiding:
 * the answer looks just as confident as an uncontested one.
 *
 * A project value differing from a general one is NOT a conflict. That is
 * precedence working as designed — the specific thing confirmed on this job
 * beats the general rule. Only same-tier disagreement counts.
 */
export function detectConflicts(result) {
  if (!result || !result.facts || !result.facts.length) return [];

  const groups = new Map();
  for (const f of result.facts) {
    // Same node, same parameter, same scope tier. Anything else is either a
    // different subject or precedence.
    const key = f.node_id + '\u0000' + normaliseTerm(f.name) + '\u0000' + f.scope;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  const out = [];
  for (const facts of groups.values()) {
    if (facts.length < 2) continue;

    const distinct = new Map();
    for (const f of facts) {
      const sig = factSignature(f);
      if (!distinct.has(sig)) distinct.set(sig, f);
    }
    if (distinct.size < 2) continue;    // same value recorded twice, not a clash

    const sample = facts[0];
    out.push({
      nodeId: sample.node_id,
      nodeTitle: sample.node_title || '',
      name: sample.name,
      scope: sample.scope,
      values: Array.from(distinct.values()).map((f) => ({
        factId: f.id,
        display: factDisplay(f),
        sourceRef: f.source_ref || '',
        approvedAt: f.approved_at || ''
      }))
    });
  }
  return out;
}

function factDisplay(f) {
  if (f.value_type === 'range') return f.value_num + '\u2013' + f.value_num_max + ' ' + f.unit;
  if (f.value_type === 'number') return f.value_num + ' ' + f.unit;
  return f.value_text || '';
}

/* Compared on the value, not the row: the same number entered twice from two
   documents is one value, and flagging it as a conflict would train the
   reader to ignore the flag. */
function factSignature(f) {
  return [
    f.value_type,
    f.value_num === null || f.value_num === undefined ? '' : f.value_num,
    f.value_num_max === null || f.value_num_max === undefined ? '' : f.value_num_max,
    String(f.unit || '').trim().toLowerCase(),
    String(f.value_text || '').trim().toLowerCase()
  ].join('|');
}

/**
 * The retrieved knowledge as prompt text.
 *
 * Every line carries its provenance, because the model is told elsewhere that
 * it may not invent numbers — and the only way that instruction is checkable
 * is if each number it is allowed to use arrives attached to where it came
 * from. Project-scoped values are labelled as such so a value confirmed on one
 * job is never restated as a general rule.
 */
export function knowledgeBlock(result) {
  if (!result || !result.matches.length) return '';

  const lines = [];
  for (const m of result.matches.slice(0, 6)) {
    const head = m.title + (m.kind ? ' (' + m.kind + ')' : '');
    lines.push('- ' + head + (m.summary ? ': ' + m.summary : ''));

    for (const f of m.facts.slice(0, 8)) {
      const value = f.value_type === 'range'
        ? f.value_num + '–' + f.value_num_max + ' ' + f.unit
        : f.value_type === 'number'
          ? f.value_num + ' ' + f.unit
          : f.value_text;
      if (!value) continue;
      const tail = [];
      if (f.scope === 'project') tail.push('recorded on one project, not a general rule');
      else if (f.scope === 'family') tail.push('holds for this product family');
      if (f.source_ref) tail.push(f.source_ref);
      lines.push('    ' + f.name + ': ' + value + (tail.length ? ' [' + tail.join('; ') + ']' : ''));
    }

    for (const s of (m.standards || []).slice(0, 3)) lines.push('    cites ' + s);
  }

  let block = 'APPROVED KNOWLEDGE — written and approved by an engineer. ' +
    'These values may be quoted; nothing outside this block may be.\n' + lines.join('\n');

  const conflicts = detectConflicts(result);
  if (conflicts.length) {
    const cl = conflicts.slice(0, 4).map((c) => {
      const vals = c.values.map((v) => v.display + (v.sourceRef ? ' (' + v.sourceRef + ')' : ''));
      return '- ' + c.nodeTitle + ' \u2014 ' + c.name + ': ' + vals.join('  vs  ');
    });
    block += '\n\nCONFLICTING APPROVED VALUES — more than one approved value exists for ' +
      'the same parameter. Do not silently choose one. State that the record disagrees, ' +
      'give both values, and set the status to TO VERIFY.\n' + cl.join('\n');
  }

  return block;
}

/**
 * Everything the model is allowed to repeat, as one string, for the
 * fabrication guard in ask.js. Without this the guard would flag a correctly
 * retrieved graph value as invented and downgrade a good answer to TO VERIFY.
 */
export function allowedText(result) {
  if (!result || !result.matches.length) return '';
  const parts = [];
  for (const m of result.matches) {
    parts.push(m.title, m.summary);
    for (const f of m.facts) {
      parts.push(f.name, f.unit, f.value_text);
      if (f.value_num !== null && f.value_num !== undefined) parts.push(String(f.value_num));
      if (f.value_num_max !== null && f.value_num_max !== undefined) parts.push(String(f.value_num_max));
    }
    (m.standards || []).forEach((s) => parts.push(String(s)));
    (m.attributes || []).forEach((a) => {
      if (a && a.value) parts.push(String(a.value), String(a.unit || ''));
    });
  }
  return parts.filter(Boolean).join(' ');
}

/** Citations for the UI: what the answer stands on, in the reader's terms. */
export function citations(result) {
  if (!result || !result.matches.length) return [];
  return result.matches.slice(0, 6).map((m) => ({
    nodeId: m.nodeId,
    mapId: m.mapId,
    title: m.title,
    kind: m.kind,
    scope: m.scope,
    sourceRef: m.sourceRef,
    factCount: m.facts.length,
    approvedAt: m.approvedAt
  }));
}

/**
 * Record that the graph was used, and bind the answer to the exact facts
 * behind it. A disputed answer can then be walked back to the fact, the node
 * and the approval — which is what makes "cite the clause it came from" a
 * feature rather than a claim.
 *
 * Never throws: a logging failure must not lose the engineer their answer.
 */
export async function logUsage(env, { result, context, outcome, userId, answerId }) {
  if (!env.DB || !result || !result.matches.length) return;
  const now = new Date().toISOString();
  const stmts = [];

  const usage = env.DB.prepare(
    'INSERT INTO knowledge_usage (id, node_id, consumer, context, outcome, user_id, created_at) ' +
    'VALUES (?,?,?,?,?,?,?)'
  );
  for (const m of result.matches) {
    stmts.push(usage.bind(
      crypto.randomUUID(), m.nodeId, 'compliance-maker',
      String(context || '').slice(0, 500), outcome || 'used', userId || null, now
    ));
  }

  if (answerId) {
    const link = env.DB.prepare(
      'INSERT OR IGNORE INTO knowledge_answer_facts (answer_id, fact_id, node_id, created_at) VALUES (?,?,?,?)'
    );
    for (const f of result.facts) {
      stmts.push(link.bind(answerId, f.id, f.node_id, now));
    }
  }

  try {
    if (stmts.length) await env.DB.batch(stmts);
  } catch (err) {
    console.log('knowledge usage log failed:', err && err.message);
  }
}

/* ── Loading ──────────────────────────────────────────────────────────── */

async function loadNodes(env, ids, kinds) {
  const ph = ids.map(() => '?').join(',');
  let sql =
    'SELECT n.*, m.title AS map_title FROM knowledge_nodes n ' +
    'JOIN knowledge_maps m ON m.id = n.map_id WHERE n.id IN (' + ph + ')';
  const binds = ids.slice();

  if (Array.isArray(kinds) && kinds.length) {
    sql += ' AND n.kind IN (' + kinds.map(() => '?').join(',') + ')';
    kinds.forEach((k) => binds.push(String(k)));
  }

  const res = await env.DB.prepare(sql).bind(...binds).all();
  const out = {};
  ((res && res.results) || []).forEach((r) => { out[r.id] = r; });
  return out;
}

/**
 * Approved facts for these nodes, scope-ranked. A fact tied to a different
 * project is excluded outright: another job's confirmed value is not evidence
 * about this one, and showing it invites exactly the leak that scope exists to
 * prevent.
 */
async function loadFacts(env, ids, projectId) {
  const ph = ids.map(() => '?').join(',');
  const binds = ids.slice();
  let sql =
    'SELECT * FROM knowledge_approved_facts WHERE node_id IN (' + ph + ') ';
  if (projectId) {
    sql += 'AND (project_id IS NULL OR project_id = ?) ';
    binds.push(String(projectId));
  } else {
    sql += "AND (project_id IS NULL OR scope <> 'project') ";
  }
  sql += 'ORDER BY scope_rank ASC, name ASC LIMIT 200';

  try {
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return (res && res.results) || [];
  } catch (err) {
    // The view arrives with db/2026-09-knowledge-typed.sql. Before that
    // migration runs, retrieval degrades to nodes without facts rather than
    // failing the whole answer.
    console.log('knowledge_approved_facts unavailable:', err && err.message);
    return [];
  }
}

async function loadRelated(env, ids) {
  const ph = ids.map(() => '?').join(',');
  const res = await env.DB.prepare(
    'SELECT e.from_id, e.to_id, e.relation, ' +
    '       nf.title AS from_title, nt.title AS to_title ' +
    'FROM knowledge_edges e ' +
    'JOIN knowledge_nodes nf ON nf.id = e.from_id ' +
    'JOIN knowledge_nodes nt ON nt.id = e.to_id ' +
    "WHERE e.status = 'approved' AND (e.from_id IN (" + ph + ') OR e.to_id IN (' + ph + '))'
  ).bind(...ids, ...ids).all();

  const out = {};
  ((res && res.results) || []).forEach((r) => {
    (out[r.from_id] = out[r.from_id] || []).push({ relation: r.relation, title: r.to_title });
    (out[r.to_id] = out[r.to_id] || []).push({ relation: r.relation + ' (of)', title: r.from_title });
  });
  return out;
}

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw || 'null');
    return v === null || v === undefined ? fallback : v;
  } catch (err) {
    return fallback;
  }
}
