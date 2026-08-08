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
// Signed out is not an error here. The reader falls back to localStorage and
// carries on, so a guest reading the free chapters is never interrupted.

import { json, bad } from '../../_lib.js';

async function bookBySlug(env, slug) {
  if (!slug) return null;
  return env.DB.prepare('SELECT id, slug FROM books WHERE slug = ?1').bind(slug).first();
}

export const onRequestGet = async ({ env, request, data }) => {
  const user = data.user;
  if (!user) return json({ chapter: null, anonymous: true });

  const slug = new URL(request.url).searchParams.get('book');
  const book = await bookBySlug(env, slug);
  if (!book) return bad('Unknown book.', 404);

  const row = await env.DB.prepare(
    'SELECT chapter_slug, scroll_y, updated_at FROM reading_progress WHERE user_id = ?1 AND book_id = ?2'
  ).bind(user.id, book.id).first();

  if (!row) return json({ chapter: null });
  return json({ chapter: row.chapter_slug, y: row.scroll_y || 0, updated_at: row.updated_at });
};

export const onRequestPost = async ({ env, request, data }) => {
  const user = data.user;
  // Nothing to store for a guest, but this must not read as a failure —
  // the reader fires it on a scroll timer and would otherwise log noise.
  if (!user) return json({ ok: true, stored: false });

  const body = await request.json().catch(() => ({}));
  const book = await bookBySlug(env, String(body.book || ''));
  if (!book) return bad('Unknown book.', 404);

  const chapter = String(body.chapter || '').trim();
  if (!chapter) return bad('Missing chapter.', 400);

  // Confirm the chapter belongs to the book before storing it, so a stale or
  // hand-edited URL cannot park someone on a position that never resolves.
  const exists = await env.DB.prepare(
    'SELECT id FROM chapters WHERE book_id = ?1 AND slug = ?2'
  ).bind(book.id, chapter).first();
  if (!exists) return bad('Unknown chapter.', 404);

  const y = Math.max(0, Math.min(2000000, Number(body.y) || 0));

  await env.DB.prepare(
    'INSERT INTO reading_progress (user_id, book_id, chapter_slug, scroll_y, updated_at) ' +
    "VALUES (?1, ?2, ?3, ?4, datetime('now')) " +
    'ON CONFLICT(user_id, book_id) DO UPDATE SET ' +
    'chapter_slug = excluded.chapter_slug, scroll_y = excluded.scroll_y, updated_at = excluded.updated_at'
  ).bind(user.id, book.id, chapter, y).run();

  return json({ ok: true, stored: true });
};
