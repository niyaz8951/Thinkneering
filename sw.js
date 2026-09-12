/**
 * Thinkneering service worker.
 * =============================================================================
 * What this caches, and — more importantly — what it refuses to.
 *
 * This is an account-only site with one live session per account. A service
 * worker that caches pages or API responses would break both guarantees:
 *
 *   - a cached HTML page would render for someone who has since been signed
 *     out, or whose session was taken over on another device;
 *   - a cached API response would show one account's data inside another
 *     account's session on a shared device;
 *   - an authenticated response sitting in the Cache API survives sign-out,
 *     because clearing a cookie does not clear a cache.
 *
 * So the rule is narrow and absolute: **only same-origin static assets are
 * cached** — CSS, JS, fonts, icons. Nothing under /api/. No HTML except the
 * offline page, which contains nothing. Documents always go to the network,
 * and fall back to the offline page only when the network genuinely fails.
 *
 * The result is not an offline app. It is an app that starts instantly, keeps
 * working through a lift or a basement long enough to not lose your place, and
 * cannot leak one person's work to another.
 */

const VERSION = 'tn-v1';
const STATIC = VERSION + '-static';
const OFFLINE_URL = '/offline.html';

/* Enough to paint the shell on a cold start. Deliberately short: a long
   precache list is a long list of things that can 404 and fail the whole
   install. */
const PRECACHE = [
  OFFLINE_URL,
  '/assets/css/global.css',
  '/assets/js/global.js',
  '/assets/icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC)
      // addAll is all-or-nothing; one missing file would leave the worker
      // uninstalled and the site with no offline page at all. Each is added
      // on its own so a miss costs only that file.
      .then((cache) => Promise.all(
        PRECACHE.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== STATIC).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Sign-out has to empty the cache. A cookie is cleared by the server; the
   Cache API is not, and anything left in it outlives the session that put it
   there. assets/js/global.js posts this before it navigates away. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TN_SIGNED_OUT') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

function isStaticAsset(url) {
  return url.pathname.startsWith('/assets/') &&
    /\.(css|js|mjs|png|svg|jpg|jpeg|webp|ico|woff2?|ttf)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET. A cached POST would be a replayed action, which is worse than
  // a failed one.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Someone else's origin is not ours to cache or to reason about.
  if (url.origin !== self.location.origin) return;

  // Never touch the API. Every response under it is account-specific, and
  // several are single-use.
  if (url.pathname.startsWith('/api/')) return;

  if (isStaticAsset(url)) {
    // Cache-first: these are versioned by ?v= in the markup, so a changed file
    // arrives under a new URL rather than needing revalidation.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Everything else is a page. Network only, with the offline page as the
  // fallback — never a cached copy of a real page, for the reasons at the top.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then(
        (hit) => hit || new Response(
          '<h1>Offline</h1><p>Reconnect and try again.</p>',
          { headers: { 'Content-Type': 'text/html' }, status: 503 }
        )
      ))
    );
  }
});
