/* Thinkneering — service worker.
   Installs the site as an app and makes the shell load fast. That is the
   whole job. It caches static files only; every /api/ request, and with it
   every session check, D1 read and Workers AI call, goes to the network
   untouched — so signed-in state and approved knowledge are never stale and
   never shared between two people on one device.

   Bump SHELL_VERSION when a deploy changes shared CSS or JS. activate()
   deletes every cache with another name, so an old worker can never pin a
   stale global.css under a new page. */

var SHELL_VERSION = 'tn-shell-v1';

var PRECACHE = [
  '/',
  '/assets/css/global.css?v=9',
  '/assets/js/global.js?v=9',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_VERSION)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== SHELL_VERSION) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Only same-origin GETs for static files are ever handled. Anything else —
   API, auth, cross-origin fonts, POSTs — is left to the browser. */
function isShellRequest(request) {
  if (request.method !== 'GET') return false;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.indexOf('/api/') === 0) return false;
  if (url.pathname.indexOf('/data/') === 0) return false;   // login-gated workbooks
  if (url.pathname.indexOf('/books/') === 0) return false;
  return true;
}

function cacheable(response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false;
  // A page that arrived via a redirect (signed-out -> /login/) must not be
  // stored under the address that was asked for.
  if (response.redirected) return false;
  var cc = response.headers.get('Cache-Control') || '';
  return cc.indexOf('no-store') === -1;
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!isShellRequest(request)) return;

  var isPage = request.mode === 'navigate' ||
    (request.headers.get('Accept') || '').indexOf('text/html') !== -1;

  if (isPage) {
    /* Pages: network first. The server decides redirects (a signed-out
       visitor is sent to /login/ by the middleware) so the live answer
       always wins; the cached copy is only for opening the app offline. */
    event.respondWith(
      fetch(request).then(function (response) {
        if (cacheable(response)) {
          var copy = response.clone();
          caches.open(SHELL_VERSION).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        return caches.match(request).then(function (hit) { return hit || caches.match('/'); });
      })
    );
    return;
  }

  /* Static assets: cached copy first, refreshed in the background. Versioned
     query strings (?v=9) make a changed file a new cache key. */
  event.respondWith(
    caches.match(request).then(function (hit) {
      var refresh = fetch(request).then(function (response) {
        if (cacheable(response)) {
          var copy = response.clone();
          caches.open(SHELL_VERSION).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () { return hit; });
      return hit || refresh;
    })
  );
});
