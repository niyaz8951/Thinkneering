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
  json, withJson, userOf, userId, requireRole, nowIso, newId
} from '../../_lib/knowledge.js';
import { proposeNode } from '../../_lib/gap-proposer.js';

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

  const written = await proposeNode(env, user, {
    mapId: body.mapId,
    title,
    kind: body.kind,
    aliases: body.aliases || [],
    clause: body.clause,
    projectId: String(body.projectId || '').trim() || null,
    sourceRef: body.sourceRef
  });

  if (!written.created) {
    // Recording the sighting against whatever already covers it: the clause is
    // evidence about that node whether or not anything new was made.
    if (body.clause && written.nodeId) {
      await env.DB.prepare(
        'INSERT INTO knowledge_usage (id, node_id, consumer, context, outcome, user_id, created_at) ' +
        'VALUES (?,?,?,?,?,?,?)'
      ).bind(
        newId('ku'), written.nodeId, 'compliance-maker',
        String(body.clause).slice(0, 500), 'gap', userId(user), nowIso()
      ).run();
    }
    return json({ ok: true, created: false, nodeId: written.nodeId || null, message: written.reason });
  }

  const nodeId = written.nodeId;
  const me = userId(user);
  const now = nowIso();

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
