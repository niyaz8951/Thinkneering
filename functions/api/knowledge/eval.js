/**
 * /api/knowledge/eval — does retrieval actually work, and is it getting better?
 * =============================================================================
 * Every prompt change and every retrieval tweak is a guess until something
 * measures it. This runs the cases in _dev/eval/retrieval-cases.js through
 * the real retrieval path and scores them.
 *
 * It scores RETRIEVAL, not prose. Whether the right nodes came back is
 * objective and cheap; whether the sentence reads well is neither — and if
 * retrieval is wrong the answer cannot be right, so this is the half worth
 * measuring first.
 *
 * Two numbers matter and they pull against each other:
 *
 *   hitRate   — of the questions the graph should answer, how many surfaced
 *               every node they needed.
 *   falseHits — of the questions it should NOT answer, how many it answered
 *               anyway.
 *
 * Chasing hitRate alone is easy: lower MIN_SCORE until everything matches
 * something. falseHits is what stops that being an improvement. A change that
 * raises one and the other is not progress, and this endpoint exists so that
 * is visible rather than argued about.
 *
 * Admin only. Read-only: it runs retrieval and writes nothing.
 */

import { json, withJson, userOf, isAdmin } from '../../_lib/knowledge.js';
import { retrieve } from '../../_lib/graph-retrieval.js';
import { semanticEnabled } from '../../_lib/semantic.js';
import { CASES } from '../../../_dev/eval/retrieval-cases.js';

export const onRequestPost = withJson(async (context) => {
  const { env } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!isAdmin(user)) return json({ error: 'Admins only' }, 403);

  const cases = CASES || [];
  const results = [];

  let shouldAnswer = 0, hits = 0;
  let shouldNotAnswer = 0, falseHits = 0;

  for (const c of cases) {
    const topK = c.topK || 8;
    const found = await retrieve(env, user, c.q, { limit: topK });
    const slugs = found.matches.map((m) => m.nodeId);

    if (c.expectNone) {
      shouldNotAnswer++;
      const answered = found.matches.length > 0;
      if (answered) falseHits++;
      results.push({
        q: c.q,
        kind: 'should-not-answer',
        pass: !answered,
        got: slugs.slice(0, 3),
        why: c.why
      });
      continue;
    }

    shouldAnswer++;
    const missing = (c.expect || []).filter((id) => slugs.indexOf(id) === -1);
    if (!missing.length) hits++;

    results.push({
      q: c.q,
      kind: 'should-answer',
      pass: !missing.length,
      missing,
      // Where each expected node landed. A node at position 7 of 8 passes but
      // is one edit away from failing, and that is worth seeing before it does.
      ranks: (c.expect || []).map((id) => ({ id, rank: slugs.indexOf(id) + 1 || null })),
      via: found.matches.slice(0, 3).map((m) => m.via),
      why: c.why
    });
  }

  return json({
    ok: true,
    semantic: semanticEnabled(env),
    summary: {
      cases: cases.length,
      hitRate: shouldAnswer ? Math.round((hits / shouldAnswer) * 100) : null,
      hits,
      shouldAnswer,
      falseHits,
      shouldNotAnswer,
      // The one line to record after each change. Both numbers, always
      // together: either on its own can be improved by making the other worse.
      headline: hits + '/' + shouldAnswer + ' found, ' +
        falseHits + '/' + shouldNotAnswer + ' answered when they should not have'
    },
    results
  });
});
