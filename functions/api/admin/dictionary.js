/**
 * GET  /api/admin/dictionary?status=pending&domain=english&limit=50
 *      -> entries awaiting review, most-corrected first
 *
 * POST /api/admin/dictionary
 *      { id, action: "approve" | "reject", fields?: { meaning, memory_hook, connection, origin } }
 *
 * Approving a row is what promotes it into tier 2 and stops the model being
 * called for that term again. `connection` and `origin` only ever reach a
 * reader after they have been read and approved here.
 */

import { json } from '../../_lib.js';

const EDITABLE = ['meaning', 'memory_hook', 'connection', 'origin'];

export async function onRequestGet(context) {
  const { request, env, data } = context;
  if (!isAdmin(data)) return json({ error: 'Admin access required.' }, 403);

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const domain = url.searchParams.get('domain');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

  const rows = await env.DB.prepare(
    `SELECT e.*,
            (SELECT COUNT(*) FROM dictionary_lookups l
              WHERE l.term_key = e.term_key AND l.domain = e.domain
                AND l.outcome = 'corrected') AS corrected_count,
            (SELECT COUNT(*) FROM dictionary_lookups l
              WHERE l.term_key = e.term_key AND l.domain = e.domain) AS lookup_count
     FROM dictionary_entries e
     WHERE e.status = ?1 AND (?2 IS NULL OR e.domain = ?2)
     ORDER BY corrected_count DESC, lookup_count DESC, e.created_at ASC
     LIMIT ?3`
  ).bind(status, domain, limit).all();

  return json({ entries: rows.results || [] });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  if (!isAdmin(data)) return json({ error: 'Admin access required.' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: 'An entry id is required.' }, 400);

  if (body.fields && typeof body.fields === 'object') {
    for (const key of EDITABLE) {
      if (!(key in body.fields)) continue;
      const value = body.fields[key] === null ? null : String(body.fields[key]).slice(0, 400);
      await env.DB.prepare(`UPDATE dictionary_entries SET ${key} = ?1 WHERE id = ?2`)
        .bind(value, id).run();
    }
  }

  if (body.action === 'approve' || body.action === 'reject') {
    const status = body.action === 'approve' ? 'approved' : 'rejected';
    await env.DB.prepare(
      `UPDATE dictionary_entries
       SET status = ?1, source = CASE WHEN ?1 = 'approved' THEN 'human' ELSE source END,
           approved_by = ?2, approved_at = datetime('now')
       WHERE id = ?3`
    ).bind(status, actor(data), id).run();
  }

  const row = await env.DB.prepare('SELECT * FROM dictionary_entries WHERE id = ?1')
    .bind(id).first();

  return json({ entry: row });
}

function actor(data) {
  return data?.user?.email || data?.user?.id || 'admin';
}

// Same admin test _middleware.js uses for the maintenance bypass.
function isAdmin(data) {
  return data?.user?.role === 'admin';
}
