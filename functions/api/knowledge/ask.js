/**
 * /api/knowledge/ask — put a question to your own approved knowledge.
 * =============================================================================
 * Compliance Maker answers clause-shaped questions inside a document. The
 * question people actually ask twenty times a day is a different shape:
 *
 *     "have we done ATEX on a Saudi job before?"
 *     "what casing class did we offer on the stadium?"
 *     "who covers Oman?"
 *
 * Same retrieval, same approved-only boundary, different door. This is the
 * door that makes the graph pay you back visibly — which is the only thing
 * that sustains the habit of putting knowledge into it.
 *
 * Four rules, all of them the same rules Compliance Maker follows:
 *
 *   1. Approved nodes and approved facts only. Draft knowledge is invisible
 *      here no matter who wrote it.
 *   2. The model composes prose from retrieved facts and may use nothing else.
 *      Every measured value it writes is checked against what it was given.
 *   3. When the graph cannot answer, it says so and names what it did not
 *      recognise. A confident wrong answer is worse than "not on file".
 *   4. Every answer carries its citations, and the use is logged, so a
 *      disputed answer walks back to the node and its approval.
 *
 * POST { question, mapId?, projectId? }
 *   -> { ok, answer, citations, gaps, grounded }
 */

import { json, withJson, userOf } from '../../_lib/knowledge.js';
import {
  retrieve, knowledgeBlock, allowedText, citations, logUsage, detectConflicts
} from '../../_lib/graph-retrieval.js';
import { unsupportedMeasures } from '../../_lib/measures.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

const SYSTEM = `You answer questions using ONLY the approved engineering knowledge given to you.

Rules:
- Use the knowledge block and nothing else. You have no other source.
- Never invent a number, a rating, a standard reference or a date. If a value is not in the block, it is not known.
- A value marked "recorded on one project, not a general rule" means it has been done once. Say so in those terms; never restate it as what we always do.
- If the block does not answer the question, say plainly that it is not on file. Do not guess and do not pad.
- If the block holds two different values for the same thing, give both and say the record disagrees.
- Answer in two or three sentences. An engineer is reading this between calls.
- Write plainly. No preamble, no restating the question.`;

export const onRequestPost = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  let body = null;
  try { body = await request.json(); } catch (err) { body = null; }

  const question = String((body && body.question) || '').trim();
  if (!question) return json({ error: 'Ask something.' }, 400);
  if (question.length > 600) return json({ error: 'That question is too long.' }, 400);

  const result = await retrieve(env, user, question, {
    projectId: (body && body.projectId) || null,
    limit: 10
  });

  const cited = citations(result);
  const conflicts = detectConflicts(result);

  /* Nothing matched. This is answered without the model entirely: there is
     nothing for it to compose from, and asking it anyway is exactly how a
     plausible invention gets produced. The unmatched terms are the useful
     part — they name what to write next. */
  if (!result.matches.length) {
    return json({
      ok: true,
      grounded: false,
      answer: 'Nothing approved covers this yet.',
      citations: [],
      gaps: result.unmatchedTerms.slice(0, 8),
      conflicts: []
    });
  }

  if (!env.AI) {
    // The retrieval still works without the AI binding, so hand back the raw
    // matches rather than failing. A list of relevant nodes beats an error.
    return json({
      ok: true,
      grounded: true,
      answer: '',
      matches: result.matches.slice(0, 6).map(trim),
      citations: cited,
      gaps: result.unmatchedTerms.slice(0, 8),
      conflicts
    });
  }

  const block = knowledgeBlock(result);
  let raw = '';
  try {
    const res = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: block + '\n\nQUESTION: ' + question }
      ],
      max_tokens: 320,
      temperature: 0.1
    });
    raw = String((res && (res.response || res.result)) || '').trim();
  } catch (err) {
    console.log('ask failed:', err && err.message);
    return json({
      ok: true,
      grounded: true,
      answer: '',
      matches: result.matches.slice(0, 6).map(trim),
      citations: cited,
      gaps: result.unmatchedTerms.slice(0, 8),
      conflicts,
      note: 'The summariser is unavailable. These are the nodes that matched.'
    });
  }

  // Every measured value in the reply has to be traceable to what the model
  // was given, or to the question itself.
  const allowed = question + ' ' + allowedText(result);
  const invented = unsupportedMeasures(raw, allowed);

  let note = '';
  if (invented.length) {
    note = 'Ignore ' + invented.slice(0, 4).join(', ') +
      ' — ' + (invented.length === 1 ? 'that figure is' : 'those figures are') +
      ' not on file and should not be quoted.';
  }
  if (conflicts.length) {
    note = (note ? note + ' ' : '') +
      'The record holds more than one approved value for ' +
      conflicts.slice(0, 3).map((c) => c.name).join(', ') + '.';
  }

  const answerId = crypto.randomUUID();
  context.waitUntil(logUsage(env, {
    result,
    context: question,
    outcome: 'used',
    userId: String(user.id || user.username),
    answerId
  }));

  return json({
    ok: true,
    grounded: true,
    answerId,
    answer: raw.slice(0, 1500),
    note: note || undefined,
    citations: cited,
    conflicts,
    // Terms nothing approved could answer. The most useful thing a knowledge
    // base produces is an honest list of what it does not know.
    gaps: result.unmatchedTerms.slice(0, 8)
  });
});

function trim(m) {
  return {
    nodeId: m.nodeId, title: m.title, kind: m.kind,
    summary: m.summary, scope: m.scope
  };
}
