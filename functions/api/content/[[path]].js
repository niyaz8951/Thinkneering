import { json, bad, canAccess, loadGrants, strictest, track } from '../../_lib.js';

// GET /api/content/book/:bookSlug
// GET /api/content/book/:bookSlug/:chapterSlug
export const onRequestGet = async ({ env, params, data }) => {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  if (parts[0] !== 'book' || !parts[1]) return bad('Unknown content request.', 404);

  const user = data.user;
  const isAdmin = !!user && user.role === 'admin';
  const grants = await loadGrants(env, user);

  const book = await env.DB.prepare('SELECT * FROM books WHERE slug = ?1').bind(parts[1]).first();
  if (!book) return bad('That book does not exist.', 404);
  if (book.status !== 'published' && !isAdmin) return bad('That book is not published yet.', 404);

  const bookAllowed = canAccess(user, book.access_level, book.required_plan, grants, 'book:' + book.id);

  const { results: chapterRows } = await env.DB.prepare(
    'SELECT * FROM chapters WHERE book_id = ?1 ORDER BY sort_order, title'
  ).bind(book.id).all();

  const chapters = (chapterRows || [])
    .filter((c) => isAdmin || c.is_published)
    .map((c) => {
      const level = c.access_level === 'inherit'
        ? book.access_level
        : strictest(c.access_level, book.access_level);
      return {
        id: c.id, slug: c.slug, title: c.title, summary: c.summary,
        access_level: level,
        allowed: canAccess(user, level, book.required_plan, grants, 'book:' + book.id)
      };
    });

  const meta = {
    book: {
      id: book.id, slug: book.slug, title: book.title, subtitle: book.subtitle,
      author: book.author, cover_url: book.cover_url, description: book.description,
      access_level: book.access_level, status: book.status, allowed: bookAllowed
    },
    chapters
  };

  if (!parts[2]) {
    await track(env, user, 'view', 'book:' + book.id);
    return json(meta);
  }

  const chapter = chapters.find((c) => c.slug === parts[2]);
  if (!chapter) return bad('That chapter does not exist.', 404);
  if (!chapter.allowed) {
    await track(env, user, 'denied', 'chapter:' + chapter.id);
    return json({ ...meta, chapter: { ...chapter, blocks: null },
      locked: true,
      reason: chapter.access_level === 'auth'
        ? 'Sign in to read this chapter.'
        : 'This chapter is available to readers with access. Ask an admin to unlock it.' }, 200);
  }

  const { results: blockRows } = await env.DB.prepare(
    'SELECT id, type, data, sort_order FROM blocks WHERE chapter_id = ?1 ORDER BY sort_order'
  ).bind(chapter.id).all();

  const blocks = (blockRows || []).map((b) => {
    let parsed = {};
    try { parsed = JSON.parse(b.data); } catch (e) { parsed = {}; }
    return { id: b.id, type: b.type, data: parsed };
  });

  await track(env, user, 'open', 'chapter:' + chapter.id);
  return json({ ...meta, chapter: { ...chapter, blocks }, locked: false });
};
