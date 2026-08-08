// functions/api/content/progress.js
//
// Durable reading position, so "continue where you left off" survives a
// change of browser or device. localStorage still holds an instant copy;
// this is the one that travels with the account.
//
// GET  /api/content/progress?book=<slug>   -> { chapter, y, updated_at } | { chapter: null }
// POST /api/content/progress               -> { ok: true }
//      { book: '<slug>', chapter: '<slug>', y: 1234 }
//
// Books no longer have rows in D1 — the file in /books/ is the book — so
// this stores slugs and validates nothing against a chapters table. A slug
// that no longer exists is harmless: the reader checks the position against
// the contents list it parsed and falls back to the first chapter.

import { json, bad } from '../../_lib.js';
import { educationAllowed } from '../../_education.js';

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const onRequestGet = async ({ env, request, data }) => {
  const user = data.user;
  if (!user) return json({ chapter: null, anonymous: true });
  if (!(await educationAllowed(env, user))) return json({ chapter: null });

  const book = String(new URL(request.url).searchParams.get('book') || '');
  if (!SLUG.test(book)) return bad('Unknown book.', 400);

  const row = await env.DB.prepare(
    'SELECT chapter_slug, scroll_y, updated_at FROM reading_progress WHERE user_id = ?1 AND book_slug = ?2'
  ).bind(user.id, book).first();

  if (!row) return json({ chapter: null });
  return json({ chapter: row.chapter_slug, y: row.scroll_y || 0, updated_at: row.updated_at });
};

export const onRequestPost = async ({ env, request, data }) => {
  const user = data.user;
  // Nothing to store for a guest, but this must not read as a failure —
  // the reader fires it on a scroll timer and would otherwise log noise.
  if (!user) return json({ ok: true, stored: false });
  if (!(await educationAllowed(env, user))) return json({ ok: true, stored: false });

  const body = await request.json().catch(() => ({}));
  const book = String(body.book || '');
  const chapter = String(body.chapter || '').trim().slice(0, 80);

  if (!SLUG.test(book)) return bad('Unknown book.', 400);
  if (!chapter) return bad('Missing chapter.', 400);

  const y = Math.max(0, Math.min(2000000, Number(body.y) || 0));

  await env.DB.prepare(
    'INSERT INTO reading_progress (user_id, book_slug, chapter_slug, scroll_y, updated_at) ' +
    "VALUES (?1, ?2, ?3, ?4, datetime('now')) " +
    'ON CONFLICT(user_id, book_slug) DO UPDATE SET ' +
    'chapter_slug = excluded.chapter_slug, scroll_y = excluded.scroll_y, updated_at = excluded.updated_at'
  ).bind(user.id, book, chapter, y).run();

  return json({ ok: true, stored: true });
};
