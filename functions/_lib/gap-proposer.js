/**
 * Gap proposer — an unanswerable clause becomes a reviewable node, or nothing.
 * =============================================================================
 * Compliance Maker meets clauses the approved graph cannot answer. Reporting
 * that as TO VERIFY and moving on means the same gap comes back next month and
 * gets the same shrug. Proposing a node for every gap means the review queue
 * fills with one-off project quirks and stops being read, which costs more than
 * it saves — an unread queue is worse than no queue, because it looks like
 * coverage.
 *
 * So a model judges. It is asked one narrow question — would a reusable
 * engineering node help here, or is this specific to one job — and it answers
 * in JSON. Everything it returns is then treated as untrusted:
 *
 *   - the kind must exist in knowledge_kinds, or the proposal is dropped;
 *   - the title must not already resolve through knowledge_aliases;
 *   - no numbers are accepted from the model at all. A proposal carries the
 *     clause verbatim and nothing else, because a fabricated value that reaches
 *     the queue is a fabricated value one click away from being approved.
 *
 * The proposal lands as a draft. Nothing here can approve anything.
 */

import { newId, nowIso, jsonField, normaliseTerm, requireRole } from './knowledge.js';
import { TEXT_MODEL } from './models.js';

const MODEL = TEXT_MODEL;

/* One proposal per answer. A clause that touches six unknown things is one
   gap, not six, and the reviewer would have to merge them anyway. */
const MAX_PER_ANSWER = 1;

const JUDGE_PROMPT = `You decide whether an engineering knowledge base should gain a new entry.

You are given a specification clause that our knowledge base could not answer, and the terms it did not recognise.

Answer with a reusable engineering subject ONLY if all of these hold:
- it is a piece of equipment, a component, a parameter, a standard, a clause of a standard, or a failure mode
- it would still be useful on a different project for a different client
- it is a thing, not an instruction, a quantity, a commercial term or a delivery condition

Say no when the clause is about: prices, delivery dates, warranties, submittals, site access, programme, payment, one client's naming, or a quantity specific to this job.

Reply with JSON only, no prose:
{"propose": true|false, "title": "short noun phrase", "kind": "equipment|component|parameter|standard|clause|requirement|failure", "aliases": ["other names"], "reason": "under 15 words"}

If propose is false, every other field may be empty. Never invent numbers, ratings or values.`;

/**
 * Ask the model whether this gap is worth a node.
 * Returns null for "no", or a sanitised proposal.
 */
export async function judgeGap(env, { clause, unmatchedTerms }) {
  if (!env.AI) return null;

  const terms = (unmatchedTerms || []).slice(0, 12).join(', ');
  const user = 'CLAUSE:\n' + String(clause || '').slice(0, 1200) +
    '\n\nUNRECOGNISED TERMS: ' + (terms || '(none)');

  let raw = '';
  try {
    const res = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: JUDGE_PROMPT },
        { role: 'user', content: user }
      ],
      max_tokens: 200,
      temperature: 0.1
    });
    raw = (res && (res.response || res.result)) || '';
  } catch (err) {
    // A judgment that cannot be made is a judgment of "no". Failing to propose
    // costs a queue entry; failing the answer costs the engineer their work.
    console.log('gap judgement failed:', err && err.message);
    return null;
  }

  const parsed = extractJson(String(raw));
  if (!parsed || parsed.propose !== true) return null;

  const title = String(parsed.title || '').trim().slice(0, 120);
  if (!title || title.length < 3) return null;

  // A title that is mostly digits is a quantity wearing a name.
  if (/^[\d\s.,/-]+$/.test(title)) return null;

  const aliases = Array.isArray(parsed.aliases)
    ? parsed.aliases.map((a) => String(a || '').trim()).filter((a) => a && a.length < 80).slice(0, 6)
    : [];

  return {
    title,
    kind: String(parsed.kind || '').trim(),
    aliases,
    reason: String(parsed.reason || '').trim().slice(0, 160)
  };
}

/**
 * Write a draft node. Shared with /api/knowledge/propose so the endpoint and
 * the automatic path cannot drift apart on what a proposal is allowed to be.
 *
 * Returns { created, nodeId, reason } — `created: false` with a reason is a
 * normal outcome, not an error.
 */
export async function proposeNode(env, user, payload) {
  const mapId = String(payload.mapId || '');
  const title = String(payload.title || '').trim().slice(0, 200);
  if (!mapId || !title) return { created: false, reason: 'missing map or title' };

  const kindRow = await env.DB.prepare(
    'SELECT kind FROM knowledge_kinds WHERE kind = ? AND is_active = 1'
  ).bind(String(payload.kind || '')).first();
  // An unrecognised kind becomes a note rather than being invented into
  // existence. A note is reviewable; a kind nobody defined is not.
  const kind = kindRow ? kindRow.kind : 'note';

  const norm = normaliseTerm(title);

  // Already held under this name, or under one of the offered aliases.
  const candidates = [norm].concat((payload.aliases || []).map(normaliseTerm)).filter(Boolean);
  const ph = candidates.map(() => '?').join(',');
  const existing = await env.DB.prepare(
    'SELECT n.id, n.title FROM knowledge_aliases a ' +
    'JOIN knowledge_nodes n ON n.id = a.node_id ' +
    'WHERE a.map_id = ? AND a.alias_norm IN (' + ph + ') LIMIT 1'
  ).bind(mapId, ...candidates).first();

  if (existing) {
    return { created: false, nodeId: existing.id, reason: 'already held as "' + existing.title + '"' };
  }

  // Also refuse a second draft for the same thing: a clause asked twice in a
  // week should not produce two identical queue entries.
  const pending = await env.DB.prepare(
    "SELECT id FROM knowledge_nodes WHERE map_id = ? AND status IN ('draft','proposed') " +
    'AND lower(title) = ? LIMIT 1'
  ).bind(mapId, title.toLowerCase()).first();

  if (pending) return { created: false, nodeId: pending.id, reason: 'already in the review queue' };

  const nodeId = newId('kn');
  const now = nowIso();
  const me = user ? String(user.id || user.username) : null;

  // The clause goes in verbatim. A reviewer deciding whether this node should
  // exist needs the words that raised it, not a summary written by the thing
  // that could not answer them.
  const body = payload.clause
    ? 'Raised automatically from a specification clause Compliance Maker could not answer.\n\n> ' +
      String(payload.clause).slice(0, 2000) +
      (payload.reason ? '\n\nWhy it was proposed: ' + payload.reason : '')
    : '';

  await env.DB.prepare(
    'INSERT INTO knowledge_nodes ' +
    '(id, map_id, kind, title, aliases, summary, body, attributes, tags, standards, lane, ' +
    " x, y, status, scope, project_id, origin, source_ref, version, created_by, created_at, updated_at) " +
    "VALUES (?,?,?,?,?,'',?,'[]','[]','[]','',0,0,'draft',?,?,'ai-proposed',?,1,?,?,?)"
  ).bind(
    nodeId, mapId, kind, title,
    jsonField(payload.aliases || []),
    body,
    payload.projectId ? 'project' : 'general',
    payload.projectId || null,
    String(payload.sourceRef || '').slice(0, 200) || null,
    me, now, now
  ).run();

  return { created: true, nodeId, kind };
}

/**
 * The whole automatic path: judge, then write if the judgment says so.
 *
 * Never throws and never blocks the answer. This runs in waitUntil, after the
 * engineer already has their reply — a proposal is a side effect of answering,
 * never a cost added to it.
 */
export async function proposeFromGap(env, user, { clause, result, mapId, projectId, sourceRef }) {
  try {
    if (!env.DB || !env.AI || !user || !mapId) return null;
    if (!result || !result.unmatchedTerms || !result.unmatchedTerms.length) return null;

    // Contributor rights at least. Someone who cannot write to a map should
    // not fill its queue by asking questions.
    const role = await requireRole(env, user, mapId, 'contributor');
    if (!role) return null;

    const verdict = await judgeGap(env, { clause, unmatchedTerms: result.unmatchedTerms });
    if (!verdict) return null;

    const written = await proposeNode(env, user, {
      mapId,
      title: verdict.title,
      kind: verdict.kind,
      aliases: verdict.aliases,
      clause,
      reason: verdict.reason,
      projectId,
      sourceRef
    });

    return written.created ? written : null;
  } catch (err) {
    console.log('automatic proposal failed:', err && err.message);
    return null;
  }
}

/* The model is asked for JSON and sometimes wraps it in prose or a fence.
   Nothing here trusts the result — it is validated by the caller. */
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    return null;
  }
}

export const MAX_PROPOSALS_PER_ANSWER = MAX_PER_ANSWER;
