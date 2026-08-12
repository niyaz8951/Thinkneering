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

  // Books live in the R2 bucket, not in the deployed assets, so there is no
  // public path to block. The only way to a book is /api/education/file/<slug>,
  // which checks approval before it touches storage. This stays as a guard in
  // case a stray /books/ file is ever committed by hand.
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

  return next();
};
