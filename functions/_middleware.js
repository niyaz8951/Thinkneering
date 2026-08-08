// Attaches the current user to every request, blocks the site during
// maintenance, and gates the tool pages that are members-only.
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

function needsAccount(pathname) {
  return SIGNED_IN_PAGES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p));
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

  // Send a signed-out visitor to the login form with a return path, rather
  // than rendering a page whose every button will 401.
  if (!data.user && needsAccount(url.pathname)) {
    const returnTo = url.pathname + url.search;
    return Response.redirect(url.origin + '/login/?next=' + encodeURIComponent(returnTo), 302);
  }

  return next();
};
