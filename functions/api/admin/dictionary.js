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
import { userId } from '../../_lib/knowledge.js';
import { promoteToGraph, demoteFromGraph } from '../../_lib/dictionary.js';
import { normalise, dictionaryCase } from '../dictionary/lookup.js';

// `pos` is editable so a wrong part of speech can be corrected before the
// word is approved into a lane; `term` so a bad headword can be fixed.
const EDITABLE = ['meaning', 'memory_hook', 'connection', 'origin',
  'hindi', 'urdu', 'urdu_roman', 'pos', 'term'];

async function handleGet(context) {
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

  let guidance = '';
  let corrections = 0;
  try {
    const g = await env.DB.prepare("SELECT value FROM settings WHERE key = 'dictionary_guidance'").first();
    guidance = (g && g.value) || '';
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM dictionary_corrections').first();
    corrections = (c && c.n) || 0;
  } catch (err) { /* not migrated yet */ }

  return json({ entries: rows.results || [], guidance, corrections });
}

async function handlePost(context) {
  const { request, env, data } = context;
  if (!isAdmin(data)) return json({ error: 'Admin access required.' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  // The reviewer's standing note for the model. Saved on its own, no entry.
  if (typeof body.guidance === 'string') {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('dictionary_guidance', ?1) " +
      'ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    ).bind(body.guidance.slice(0, 1500)).run();
    return json({ ok: true, guidance: body.guidance.slice(0, 1500) });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id)) return json({ error: 'An entry id is required.' }, 400);

  // What the model wrote, before the reviewer's edits land — the "before"
  // half of every correction recorded below.
  const before = await env.DB.prepare('SELECT * FROM dictionary_entries WHERE id = ?1').bind(id).first();
  if (!before) return json({ error: 'No such entry.' }, 404);

  if (body.fields && typeof body.fields === 'object') {
    for (const key of EDITABLE) {
      if (!(key in body.fields)) continue;
      let value = body.fields[key] === null ? null : String(body.fields[key]).slice(0, 400);

      if (key === 'term') {
        // The headword is the row's identity. Changing it re-keys the row,
        // in dictionary case, and refuses to collide with another word.
        value = dictionaryCase(String(value || '').trim());
        await recordCorrection(env, before, key, value, actor(data));
        const termKey = normalise(value);
        if (!termKey) return json({ error: 'A word needs a headword.' }, 400);
        const clash = await env.DB.prepare(
          'SELECT id FROM dictionary_entries WHERE term_key = ?1 AND domain = ' +
          '(SELECT domain FROM dictionary_entries WHERE id = ?2) AND id <> ?2'
        ).bind(termKey, id).first();
        if (clash) return json({ error: '"' + value + '" is already on file as another entry.' }, 409);
        await env.DB.prepare('UPDATE dictionary_entries SET term = ?1, term_key = ?2 WHERE id = ?3')
          .bind(value, termKey, id).run();
        continue;
      }

      await recordCorrection(env, before, key, value, actor(data));
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

    // Approval is what puts the term into the graph. Until then it is just a
    // cache row; afterwards it is a node on a map and part of the term index.
    const entry = await env.DB.prepare('SELECT * FROM dictionary_entries WHERE id = ?1')
      .bind(id).first();

    if (entry && status === 'approved') {
      const placed = await promoteToGraph(env, entry, userId(data.user));
      await env.DB.prepare(
        'UPDATE dictionary_entries SET map_id = ?1, node_id = ?2 WHERE id = ?3'
      ).bind(placed.mapId, placed.nodeId, id).run();
    } else if (entry) {
      await demoteFromGraph(env, entry);
    }
  }

  const row = await env.DB.prepare('SELECT * FROM dictionary_entries WHERE id = ?1')
    .bind(id).first();

  return json({ entry: row });
}

/**
 * A changed field is a lesson. Kept only when the reviewer actually changed
 * something the model wrote — re-saving an identical value teaches nothing.
 * Never allowed to fail a save: the table may not be migrated yet.
 */
async function recordCorrection(env, before, field, value, reviewer) {
  const old = before[field] == null ? '' : String(before[field]);
  const now = value == null ? '' : String(value);
  if (old.trim() === now.trim()) return;
  try {
    await env.DB.prepare(
      `INSERT INTO dictionary_corrections (entry_id, term, domain, field, ai_value, human_value, reviewer)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(before.id, before.term, before.domain, field, old || null, now || null, reviewer).run();
  } catch (err) {
    console.log('dictionary: correction not recorded —', err.message);
  }
}

function actor(data) {
  return data?.user?.email || data?.user?.id || 'admin';
}

// Same admin test _middleware.js uses for the maintenance bypass.
function isAdmin(data) {
  return data?.user?.role === 'admin';
}

/**
 * Any throw that escapes a Pages Function is served as an HTML error page,
 * and a client calling response.json() on that gets a parse failure rather
 * than the real reason. Wrapping every handler keeps the contract JSON, so
 * "no such column: hindi" reaches the browser as those words.
 */
function withJson(handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      console.log('dictionary error:', err && err.stack ? err.stack : err);
      return json({ error: (err && err.message) || 'Unexpected server error.' }, 500);
    }
  };
}

export const onRequestGet = withJson(handleGet);
export const onRequestPost = withJson(handlePost);
