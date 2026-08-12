// functions/api/education/[[path]].js
//
// GET    /api/education/library      -> the shelf, or why it is closed
// GET    /api/education/file/<slug>  -> the raw book file, gated
// POST   /api/education/upload       -> add or replace a book   (admin)
// DELETE /api/education/book/<slug>  -> remove a book           (admin)
//
// The library is the R2 bucket. There is no manifest to keep in step: an
// upload appears on the next page load, a delete removes it, and neither
// needs a commit or a deploy.

import { json, bad, track, audit } from '../../_lib.js';
import {
  educationAllowed, educationCanManage, denialReason,
  listBooks, bookKey, formatOf, slugify, encodeMeta, FORMATS
} from '../../_education.js';

// Comfortably above a large illustrated EPUB, well under the Workers request
// body ceiling. A file bigger than this is a sign something is wrong, and a
// clear message beats a truncated upload.
const MAX_BYTES = 40 * 1024 * 1024;

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const onRequestGet = async ({ env, request, params, data }) => {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const user = data.user;
  const allowed = await educationAllowed(env, user);

  // ------------------------------------------------------------- library
  if (parts[0] === 'library') {
    if (!allowed) {
      const why = denialReason(user);
      // 200, not 403: "you are not approved yet" is a state the page draws,
      // not a request that failed. The shelf is withheld either way.
      return json({ allowed: false, reason: why.code, message: why.message, books: [] });
    }

    try {
      const books = await listBooks(env);
      await track(env, user, 'view', 'section:education');
      return json({ allowed: true, canManage: educationCanManage(user), books });
    } catch (err) {
      return bad(err.message, 500);
    }
  }

  // ---------------------------------------------------------------- file
  if (parts[0] === 'file' && parts[1]) {
    if (!allowed) return bad(denialReason(user).message, user ? 403 : 401);

    const slug = String(parts[1]);
    if (!SLUG.test(slug)) return bad('That is not a book.', 400);

    // The slug identifies the book; the extension is found, not guessed, so
    // a caller cannot steer the key by asking for a different format.
    const books = await listBooks(env);
    const book = books.find((b) => b.slug === slug);
    if (!book) return bad('That book is not in the library.', 404);

    const obj = await env.BOOKS.get(bookKey(book.slug, book.format));
    if (!obj) return bad('That book file is missing from storage.', 404);

    await track(env, user, 'open', 'book:' + book.slug);

    const headers = new Headers();
    headers.set('Content-Type', FORMATS[book.format].mime);
    headers.set('Content-Disposition',
      'inline; filename="' + book.slug + FORMATS[book.format].ext + '"');
    // private matters: this response is cut for one approved account, and a
    // shared cache must not hand it to the next person through. The etag
    // lets the browser skip the download when the book has not changed.
    headers.set('Cache-Control', 'private, max-age=3600');
    if (obj.httpEtag) headers.set('ETag', obj.httpEtag);

    return new Response(obj.body, { status: 200, headers });
  }

  return bad('Unknown Education request.', 404);
};

// -------------------------------------------------------------- upload
// The bytes arrive as the raw request body rather than a JSON field, because
// base64 inflates a 20 MB book by a third for no benefit. Everything the
// shelf needs to draw a card travels in headers alongside it.
export const onRequestPost = async ({ env, request, params, data }) => {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  if (parts[0] !== 'upload') return bad('Unknown Education request.', 404);

  const user = data.user;
  if (!educationCanManage(user)) return bad('Only an admin can add books.', user ? 403 : 401);
  if (!env.BOOKS) return bad('The books bucket is not connected. Add the BOOKS R2 binding.', 500);

  const h = request.headers;
  const filename = h.get('X-Book-Filename') || '';
  const format = formatOf(filename);
  if (!format) return bad('Only .docx, .epub and .txt files can be added.', 415);

  const title = dec(h.get('X-Book-Title'));
  if (!title) return bad('That book has no title.', 400);

  // Prefer the slug the browser derived from the title, so the URL reads
  // like the book rather than like whatever the file was named.
  let slug = String(h.get('X-Book-Slug') || '').trim() || slugify(title) || slugify(filename);
  if (!SLUG.test(slug)) return bad('That book title does not make a usable web address.', 400);

  const declared = Number(h.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return bad('That file is larger than 40 MB.', 413);

  const body = await request.arrayBuffer();
  if (!body.byteLength) return bad('That file was empty.', 400);
  if (body.byteLength > MAX_BYTES) return bad('That file is larger than 40 MB.', 413);

  // Replacing a book means replacing its file. If the format changed, the old
  // object has a different extension and would otherwise linger as a second
  // copy of the same slug.
  const existing = (await listBooks(env)).find((b) => b.slug === slug);
  const replacing = !!existing;
  if (existing && existing.format !== format) {
    await env.BOOKS.delete(bookKey(slug, existing.format));
  }

  await env.BOOKS.put(bookKey(slug, format), body, {
    httpMetadata: { contentType: FORMATS[format].mime },
    customMetadata: {
      slug,
      title: encodeMeta(title),
      subtitle: encodeMeta(dec(h.get('X-Book-Subtitle'))),
      author: encodeMeta(dec(h.get('X-Book-Author'))),
      description: encodeMeta(dec(h.get('X-Book-Description'))),
      chapters: String(Number(h.get('X-Book-Chapters')) || 0),
      domain: encodeMeta(dec(h.get('X-Book-Domain')) || 'general'),
      uploadedBy: user.email || user.id,
      uploadedAt: new Date().toISOString()
    }
  });

  await audit(env, user, replacing ? 'book.replace' : 'book.upload', slug,
              { title, format, bytes: body.byteLength });

  return json({ ok: true, replaced: replacing, book: { slug, title, format } });
};

// -------------------------------------------------------------- delete
export const onRequestDelete = async ({ env, params, data }) => {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  if (parts[0] !== 'book' || !parts[1]) return bad('Unknown Education request.', 404);

  const user = data.user;
  if (!educationCanManage(user)) return bad('Only an admin can remove books.', user ? 403 : 401);
  if (!env.BOOKS) return bad('The books bucket is not connected.', 500);

  const slug = String(parts[1]);
  if (!SLUG.test(slug)) return bad('That is not a book.', 400);

  const book = (await listBooks(env)).find((b) => b.slug === slug);
  if (!book) return bad('That book is not in the library.', 404);

  await env.BOOKS.delete(bookKey(book.slug, book.format));

  // Reading positions for a book nobody can open are dead rows. Harmless,
  // but they would come back to life pointing at the wrong text if the slug
  // were ever reused for a different book.
  await env.DB.prepare('DELETE FROM reading_progress WHERE book_slug = ?1').bind(slug).run();

  await audit(env, user, 'book.delete', slug, { title: book.title });
  return json({ ok: true });
};

function dec(v) {
  if (!v) return '';
  try { return decodeURIComponent(v).trim(); } catch (e) { return String(v).trim(); }
}
