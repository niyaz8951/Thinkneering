/**
 * /api/knowledge/propose — a gap becomes an authoring task.
 * =============================================================================
 * When Compliance Maker meets a clause the approved graph cannot answer, the
 * honest reply is TO VERIFY. That reply used to be the end of it: the gap was
 * reported to one engineer, in one session, and forgotten. The same clause
 * came back next month and got the same shrug.
 *
 * This endpoint turns that gap into a draft node sitting in the review queue
 * with the clause that raised it attached, so the next person to open the
 * queue is looking at a specific question worth answering rather than an empty
 * canvas.
 *
 *   POST /api/knowledge/propose
 *     { mapId, title, kind?, summary?, clause?, sourceRef?, projectId?,
 *       facts?: [{ name, valueText|valueNum, unit, basis }] }
 *
 * Two rules:
 *
 *   1. Nothing created here is ever approved. It lands as a draft, invisible
 *      to Compliance Maker, until a reviewer decides. A proposal that could
 *      approve itself would make the trust boundary decorative.
 *
 *   2. A proposal that matches an existing node by alias is not created again.
 *      The existing node is returned instead, with the clause recorded against
 *      it. Without this the queue fills with six spellings of one component
 *      and reviewing it becomes a data-cleaning job.
 */

import {
  json, withJson, userOf, userId, requireRole,
  nowIso, newId, jsonField, normaliseTerm
} from '../../_lib/knowledge.js';

const MAX_FACTS = 12;

export const onRequestPost = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body = null;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || !body.mapId) return json({ error: 'Missing mapId' }, 400);

  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) return json({ error: 'Missing title' }, 400);

  // Contributor is enough to raise a proposal — that is the point of a review
  // queue. Only clearing one needs reviewer rights.
  const role = await requireRole(env, user, body.mapId, 'contributor');
  if (!role) return json({ error: 'You cannot contribute to this map' }, 403);

  const kindRow = await env.DB.prepare(
    'SELECT kind FROM knowledge_kinds WHERE kind = ? AND is_active = 1'
  ).bind(String(body.kind || 'component')).first();
  const kind = kindRow ? kindRow.kind : 'note';

  const norm = normaliseTerm(title);
  const me = userId(user);
  const now = nowIso();

  // ── Already known under this name? ────────────────────────────────────
  const existing = await env.DB.prepare(
    'SELECT n.id, n.title, n.status FROM knowledge_aliases a ' +
    'JOIN knowledge_nodes n ON n.id = a.node_id ' +
    'WHERE a.map_id = ? AND a.alias_norm = ? LIMIT 1'
  ).bind(body.mapId, norm).first();

  if (existing) {
    // Record the sighting against the node that already covers it. The clause
    // is evidence about that node whether or not anything new is created.
    if (body.clause) {
      await env.DB.prepare(
        'INSERT INTO knowledge_usage (id, node_id, consumer, context, outcome, user_id, created_at) ' +
        'VALUES (?,?,?,?,?,?,?)'
      ).bind(
        newId('ku'), existing.id, 'compliance-maker',
        String(body.clause).slice(0, 500), 'gap', me, now
      ).run();
    }
    return json({
      ok: true,
      created: false,
      nodeId: existing.id,
      status: existing.status,
      message: 'Already held as "' + existing.title + '".'
    });
  }

  // ── Create the draft ──────────────────────────────────────────────────
  const nodeId = newId('kn');

  // The clause goes in the body, verbatim. A reviewer deciding whether this
  // node should exist needs to read the words that raised it, not a summary of
  // them written by the thing that could not answer them.
  const bodyText = body.clause
    ? 'Raised from a specification clause Compliance Maker could not answer:\n\n> ' +
      String(body.clause).slice(0, 2000)
    : '';

  await env.DB.prepare(
    'INSERT INTO knowledge_nodes ' +
    '(id, map_id, kind, title, aliases, summary, body, attributes, tags, standards, lane, ' +
    ' x, y, status, scope, project_id, origin, source_ref, version, created_by, created_at, updated_at) ' +
    "VALUES (?,?,?,?,?,?,?,'[]','[]','[]','',0,0,'draft',?,?,?,?,1,?,?,?)"
  ).bind(
    nodeId, body.mapId, kind, title,
    jsonField(body.aliases || []),
    String(body.summary || '').slice(0, 2000),
    bodyText,
    String(body.projectId || '').trim() ? 'project' : 'general',
    String(body.projectId || '').trim() || null,
    'proposed',
    String(body.sourceRef || '').slice(0, 200) || null,
    me, now, now
  ).run();

  // ── Draft facts ───────────────────────────────────────────────────────
  // Values come across exactly as given. Nothing is inferred here: a fact with
  // a number but no unit is rejected by the table rather than guessed at, and
  // that rejection is more useful than a fabricated "mm".
  const facts = Array.isArray(body.facts) ? body.facts.slice(0, MAX_FACTS) : [];
  const skipped = [];

  for (const f of facts) {
    const name = String((f && f.name) || '').trim().slice(0, 120);
    if (!name) continue;

    const hasNum = f.valueNum !== undefined && f.valueNum !== null && f.valueNum !== '';
    const unit = String(f.unit || '').trim();

    if (hasNum && !unit) {
      skipped.push(name + ' (number with no unit)');
      continue;
    }

    try {
      await env.DB.prepare(
        'INSERT INTO knowledge_facts ' +
        '(id, map_id, node_id, name, value_type, value_num, unit, value_text, basis, ' +
        " scope, project_id, status, source_ref, created_by, created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)"
      ).bind(
        newId('kf'), body.mapId, nodeId, name,
        hasNum ? 'number' : 'text',
        hasNum ? Number(f.valueNum) : null,
        unit,
        String(f.valueText || '').slice(0, 500),
        String(f.basis || '').slice(0, 200),
        String(body.projectId || '').trim() ? 'project' : 'general',
        String(body.projectId || '').trim() || null,
        String(body.sourceRef || '').slice(0, 200) || null,
        me, now
      ).run();
    } catch (err) {
      skipped.push(name);
    }
  }

  await env.DB.prepare(
    'UPDATE knowledge_maps SET node_count = (SELECT COUNT(*) FROM knowledge_nodes WHERE map_id = ?1), ' +
    'updated_at = ?2 WHERE id = ?1'
  ).bind(body.mapId, now).run();

  return json({
    ok: true,
    created: true,
    nodeId,
    status: 'draft',
    skippedFacts: skipped,
    message: 'Added to the review queue.'
  });
});
