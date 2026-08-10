// Attaches the current user to every request, blocks the site during
// maintenance, and gates the pages that are members-only.
import { currentUser, setting, json } from './_lib.js';

// Page paths that require a signed-in account before the HTML is served.
// The APIs behind these tools already enforce auth and per-map access, so
// this is not the security boundary — it is so an unauthorised visitor gets
// the sign-in page instead of a working-looking shell that fails on every
// action. Compliance Maker is deliberately absent: it has a free tier that
// runs entirely in the browser.
const SIGNED_IN_PAGES = [
  '/tools/knowledge/',
  '/tools/process-map/',
];

// Education is stricter than the list above: signed in is not enough, an
// admin has to approve the account. The pages still render for a signed-in
// visitor so they can be told they are waiting on approval rather than
// bounced to a login form they have already used.
const EDUCATION_PAGES = ['/education/', '/read/'];

// Paths that are read by one HTML shell rather than a file of their own.
// The shell reads the rest of the path itself and fetches what it needs.
const SHELLS = [
  [/^\/read(\/|$)/, '/reader.html'],
  [/^\/s(\/|$)/, '/section.html'],
];

function shellFor(pathname) {
  for (const [pattern, file] of SHELLS) {
    if (pattern.test(pathname)) return file;
  }
  return null;
}

function matches(pathname, list) {
  return list.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
}

export const onRequest = async (context) => {
  const { env, request, next, data } = context;

  try {
    data.user = await currentUser(env, request);
  } catch (e) {
    data.user = null;
  }

  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
    const mode = await setting(env, 'maintenance', 'off');
    if (mode === 'on' && (!data.user || data.user.role !== 'admin')) {
      return json({ error: 'Thinkneering is down for maintenance. Try again shortly.' }, 503);
    }
  }

  // The book files deploy like any other repo file, which would otherwise
  // make them public downloads. Nothing may reach /books/* directly; the
  // only way to a book is /api/education/file/<slug>, which checks approval
  // first and then reads the asset with env.ASSETS.fetch() — that call does
  // not re-enter Functions, so it is not caught by this block.
  if (url.pathname.startsWith('/books/')) {
    return new Response('Not found', { status: 404 });
  }

  // Send a signed-out visitor to the login form with a return path, rather
  // than rendering a page whose every button will 401.
  if (!data.user && (matches(url.pathname, SIGNED_IN_PAGES) || matches(url.pathname, EDUCATION_PAGES))) {
    const returnTo = url.pathname + url.search;
    return Response.redirect(url.origin + '/login/?next=' + encodeURIComponent(returnTo), 302);
  }

  // A signed-in but unapproved visitor is deliberately let through to the
  // page: the library and file APIs enforce approval, so nothing leaks, and
  // the page can say "waiting on approval" instead of bouncing them back to
  // a login form they have already used.

  // Clean URLs, served here rather than left to _redirects.
  //
  // This middleware sits at the root of functions/, so every request to the
  // site enters Functions — and the rewrite rules in _redirects are only
  // applied to requests the asset server handles on its own. That leaves
  // /read/<book> and /s/<section> depending on next() falling through in a
  // way that is not guaranteed, which is how /read/humonks ended up serving
  // the home page. Reading the shell explicitly removes the guesswork.
  //
  // ASSETS.fetch() does not re-enter Functions, so this cannot loop.
  const shell = shellFor(url.pathname);
  if (shell) {
    const asset = await env.ASSETS.fetch(new Request(url.origin + shell, { method: 'GET' }));
    if (asset.ok) {
      return new Response(asset.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }
  }

  return next();
};
