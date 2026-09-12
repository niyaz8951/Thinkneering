// Attaches the current user to every request, blocks the site during
// maintenance, and gates the pages that are members-only.
import { currentUser, setting, json } from './_lib.js';

// The site is signed-in only. Everything except the paths below requires an
// account, so this is a deny list rather than the allow list it used to be —
// which means a new page is private by default and nobody has to remember to
// add it to a protected-pages array.
//
// The free browser-only tier is gone. It existed so a stranger could convert a
// PDF without an account; the tools that served strangers have moved to
// QuickTools, and what is left here answers from a knowledge graph that is
// per-account by definition.
const PUBLIC_PATHS = [
  '/login/',
  '/signup/',
];

// Prefixes served to anyone, because a login form that cannot load its own
// stylesheet is not a login form. These carry no user data.
const PUBLIC_PREFIXES = [
  '/assets/',
  '/favicon',
];

// Auth endpoints have to answer while signed out, or signing in is impossible.
// Everything else under /api/ is gated with the pages.
const PUBLIC_API = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/signup',
];

// Education stays stricter than simply being signed in: an admin has to
// approve the account. That check lives in the education API, and the page
// deliberately renders for a signed-in visitor so it can say "waiting on
// approval" rather than bouncing them to a login form they have already used.

function isPublic(pathname) {
  const clean = pathname.replace(/\/$/, '') || '/';
  if (PUBLIC_PATHS.some((p) => clean === p.replace(/\/$/, ''))) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (PUBLIC_API.some((p) => pathname === p)) return true;
  return false;
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
  if (!data.user && !isPublic(url.pathname)) {
    // An API call answers with JSON. Redirecting it to an HTML login page is
    // how a fetch() ends up reporting "Unexpected token '<'" and hiding the
    // real cause, which is simply that the session ended.
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Your session has ended. Sign in again.', signedOut: true }, 401);
    }
    const returnTo = url.pathname + url.search;
    return Response.redirect(url.origin + '/login/?next=' + encodeURIComponent(returnTo), 302);
  }

  // A signed-in but unapproved visitor is deliberately let through to the
  // page: the library and file APIs enforce approval, so nothing leaks, and
  // the page can say "waiting on approval" instead of bouncing them back to
  // a login form they have already used.

  return next();
};
