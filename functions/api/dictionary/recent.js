/**
 * GET /api/dictionary/recent?book=<slug>&limit=20
 *
 * Words this reader has looked up, newest first. With ?book= it is the words
 * they met in that book; without it, everything they have ever tapped.
 *
 * Grouped by term, so a word looked up four times is one entry with a count
 * rather than four rows — a list of repeats is the sign of a word that has
 * not stuck, which is exactly what is worth showing back to a reader.
 */

import { json } from '../../_lib.js';

export async function onRequestGet(context) {
  const { request, env, data } = context;
  if (!data?.user) return json({ error: 'Sign in first.' }, 401);

  const url = new URL(request.url);
  const book = url.searchParams.get('book') || null;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);
  const who = data.user.email || data.user.id;

  const rows = await env.DB.prepare(
    `SELECT l.term_key,
            l.domain,
            COUNT(*)            AS times,
            MAX(l.created_at)   AS last_at,
            COALESCE(e.term, l.term_key) AS term,
            e.meaning           AS meaning,
            e.status            AS status
     FROM dictionary_lookups l
     LEFT JOIN dictionary_entries e
            ON e.term_key = l.term_key AND e.domain = l.domain
     WHERE l.user_email = ?1
       AND (?2 IS NULL OR l.book_slug = ?2)
     GROUP BY l.term_key, l.domain
     ORDER BY last_at DESC
     LIMIT ?3`
  ).bind(who, book, limit).all();

  return json({
    book,
    words: ((rows && rows.results) || []).map((r) => ({
      term: r.term,
      domain: r.domain,
      times: r.times,
      lastAt: r.last_at,
      meaning: r.meaning || null,
      status: r.status || null
    }))
  });
}
