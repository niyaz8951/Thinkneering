/**
 * PWA glue: registration, the install prompt, and standalone detection.
 * =============================================================================
 * Loaded on every page after global.js. Everything here degrades to nothing if
 * the browser has no service worker support — the site works exactly as it did
 * before, which is the only acceptable failure mode for a progressive layer.
 */
(function () {
  'use strict';

  // Running from the home screen rather than a browser tab. Used to drop
  // browser-only affordances (an install button you cannot act on) and to let
  // CSS reclaim the space a URL bar used to take.
  var standalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (standalone) document.documentElement.setAttribute('data-standalone', 'true');

  /* ── Registration ──────────────────────────────────────────────────── */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (err) {
        // A failed registration is not worth interrupting anyone over: the
        // site is fully functional without it.
        console.log('service worker registration failed:', err && err.message);
      });
    });

    /* Sign-out must empty the cache. The server clears the cookie; it cannot
       clear the Cache API, and a cached stylesheet is harmless while a cached
       anything-else is not. global.js fires this before it navigates. */
    document.addEventListener('tn:signout', function () {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'TN_SIGNED_OUT' });
      }
    });
  }

  /* ── Install prompt ────────────────────────────────────────────────── */

  var deferred = null;

  window.addEventListener('beforeinstallprompt', function (ev) {
    // Chrome would otherwise show its own banner at a moment of its choosing.
    // Holding the event lets the button appear where it makes sense.
    ev.preventDefault();
    deferred = ev;
    showInstallButton();
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    hideInstallButton();
    try { localStorage.setItem('tn-installed', '1'); } catch (e) {}
  });

  function dismissed() {
    try { return localStorage.getItem('tn-install-dismissed') === '1'; } catch (e) { return false; }
  }

  function showInstallButton() {
    if (standalone || dismissed()) return;
    var host = document.querySelector('[data-install-slot]');
    if (!host || host.querySelector('[data-install]')) return;

    var btn = document.createElement('button');
    btn.className = 'btn btn--quiet btn--sm';
    btn.setAttribute('data-install', '');
    btn.setAttribute('aria-label', 'Install Thinkneering as an app');
    btn.textContent = 'Install';
    btn.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function (choice) {
        // A refusal is an answer. Asking again on the next page load is how an
        // install prompt becomes the thing people leave a site over.
        if (choice.outcome !== 'accepted') {
          try { localStorage.setItem('tn-install-dismissed', '1'); } catch (e) {}
        }
        deferred = null;
        hideInstallButton();
      });
    });
    host.appendChild(btn);
  }

  function hideInstallButton() {
    var btn = document.querySelector('[data-install]');
    if (btn) btn.remove();
  }

  // The header is built by global.js after its catalogue call, so the slot may
  // not exist yet when beforeinstallprompt fires.
  document.addEventListener('tn:ready', function () {
    if (deferred) showInstallButton();
  });

  window.TNPWA = { standalone: standalone };
})();
