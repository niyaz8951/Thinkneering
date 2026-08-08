// functions/api/education/[[path]].js
//
// GET /api/education/library        -> the book list, or why it is closed
// GET /api/education/file/<slug>    -> the raw .docx / .epub, gated
//
// The file endpoint is what makes the books folder safe to keep in the repo:
// /books/* is blocked outright by the middleware, so the only way to the
// bytes is through this check.

import { json, bad, track } from '../../_lib.js';
import { educationAllowed, denialReason, loadLibrary } from '../../_education.js';

export const onRequestGet = async ({ env, request, params, data }) => {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const user = data.user;
  const allowed = await educationAllowed(env, user);

  // ------------------------------------------------------------- library
  if (parts[0] === 'library') {
    if (!allowed) {
      const why = denialReason(user);
      // 200, not 403: "you are not approved yet" is a state the page draws,
      // not a request that failed. The book list is withheld either way.
      return json({ allowed: false, reason: why.code, message: why.message, books: [] });
    }

    const books = await loadLibrary(env, request);
    await track(env, user, 'view', 'section:education');

    // The file name never leaves the server. The reader asks for a slug and
    // this function decides which file that means, so renaming a book on
    // disk cannot break a saved link and a guessed name cannot fetch a book.
    return json({
      allowed: true,
      books: books.map(({ file, ...rest }) => rest)
    });
  }

  // ---------------------------------------------------------------- file
  if (parts[0] === 'file' && parts[1]) {
    if (!allowed) return bad(denialReason(user).message, user ? 403 : 401);

    const books = await loadLibrary(env, request);
    const book = books.find((b) => b.slug === parts[1]);
    if (!book) return bad('That book is not in the library.', 404);

    // Path traversal guard: a manifest entry is a file name inside /books/,
    // never a path out of it.
    if (/[\\/]|\.\./.test(book.file)) return bad('That book is misconfigured.', 500);

    const origin = new URL(request.url).origin;
    const asset = await env.ASSETS.fetch(
      new Request(origin + '/books/' + encodeURIComponent(book.file), { method: 'GET' })
    );
    if (!asset.ok) return bad('That book file is missing from the server.', 404);

    await track(env, user, 'open', 'book:' + book.slug);

    // Books are large and change rarely, so let the browser keep one. private
    // matters: this response is cut for one approved account, and a shared
    // cache must not hand it to the next person through.
    const headers = new Headers();
    headers.set('Content-Type', book.format === 'epub'
      ? 'application/epub+zip'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('Content-Disposition',
      'inline; filename="' + book.slug + (book.format === 'epub' ? '.epub' : '.docx') + '"');

    return new Response(asset.body, { status: 200, headers });
  }

  return bad('Unknown Education request.', 404);
};
