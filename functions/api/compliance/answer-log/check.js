// functions/api/compliance/answer-log/check.js
// POST { product, factory, items: [{ spec, compliance, remarks }] }
// -> { conflicts: { [index]: { compliance, remarks, at } } }
//
// For each clause that HAS a current answer, look up the latest logged
// answer in THIS (product, factory) PAIR'S own table (see
// functions/_compliance.js answerLogTable()); if they differ, return the logged
// version so the tool can highlight the row as ambiguous (red) for review.
// Different factories for the same product — or the same clause text
// appearing under a different product entirely — can never be compared
// against each other, because each pair has its own table. Rows with no
// logged history, or matching history, are not returned.

import { requireUser, json, PRODUCTS, isValidFactory, answerLogTable, withErrorHandling, isMissingTable } from '../../../_compliance.js';

const MAX_ITEMS = 1500;

function normSpec(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
}
function normAns(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Invalid product' }, 400);
  const factory = String(body.factory || '').trim();
  if (!isValidFactory(product, factory)) return json({ error: 'Invalid factory for ' + product }, 400);
  const table = answerLogTable(product, factory);

  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS);
  if (!items.length) return json({ conflicts: {} });

  const norms = items.map(it => normSpec(it.spec));
  const wanted = [...new Set(norms.filter(n => n.length >= 8))];

  // Latest logged answer per requested clause, this pair's table only
  // (chunked IN queries — no bound params ahead of the chunk this time,
  // since the table itself already scopes to product+factory).
  const latest = new Map();
  try {
    for (let i = 0; i < wanted.length; i += 50) {
      const chunk = wanted.slice(i, i + 50);
      const ph = chunk.map((_, k) => '?' + (k + 1)).join(',');
      const rows = await context.env.DB.prepare(
        `SELECT a.norm_text, a.compliance, a.remarks, a.created_at
           FROM ${table} a
           JOIN (SELECT MAX(id) AS mid FROM ${table}
                  WHERE norm_text IN (${ph})
                  GROUP BY norm_text) m
             ON a.id = m.mid`
      ).bind(...chunk).all();
      for (const r of rows.results) latest.set(r.norm_text, r);
    }
  } catch (err) {
    // No log table yet = no history = nothing can contradict anything. This
    // runs on every signed-in conversion, so it must never be the reason a
    // conversion fails.
    if (!isMissingTable(err)) throw err;
    return json({ conflicts: {}, notice: 'answer-log-unavailable' });
  }

  const conflicts = {};
  items.forEach((it, i) => {
    const logged = latest.get(norms[i]);
    if (!logged) return;
    const curC = normAns(it.compliance), curR = normAns(it.remarks);
    if (!curC && !curR) return; // no current answer -> nothing to conflict with
    if (normAns(logged.compliance) !== curC || normAns(logged.remarks) !== curR) {
      conflicts[i] = {
        compliance: logged.compliance,
        remarks: logged.remarks,
        at: logged.created_at,
      };
    }
  });

  return json({ conflicts });
}

// Every response is guaranteed JSON for any error this code can catch —
// see withErrorHandling() in _compliance.js.
export const onRequestPost = withErrorHandling(handlePost);
