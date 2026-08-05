/* Thinkneering — global.js (v2)
   Injects shared chrome, exposes TN.* helpers. Loaded on every page. */
(function () {
  'use strict';

  // ---------------------------------------------------------- icons
  // Line icons, 1.5px stroke, currentColor. Add new keys here, never inline.
  var P = {
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 1-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2-2z"/>',
    wind: '<path d="M3 8h9a3 3 0 1 0-3-3"/><path d="M3 12h13a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    'book-open': '<path d="M12 6.5S10 4 3 4v14c7 0 9 2.5 9 2.5S14 18 21 18V4c-7 0-9 2.5-9 2.5z"/><path d="M12 6.5v14"/>',
    'file-check': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/>',
    calculator: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    feather: '<path d="M20.2 3.8a5 5 0 0 0-7 0L4 13v7h7l9.2-9.2a5 5 0 0 0 0-7z"/><path d="M16 8L2 22"/>',
    'graduation-cap': '<path d="M22 9L12 5 2 9l10 4 10-4z"/><path d="M6 11v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
    type: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
    unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.7-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.6 1.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 10a2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.6 1z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'
  };

  function icon(name, size) {
    var d = P[name] || P.square;
    return '<svg viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) +
      '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  // ------------------------------------------------------- utilities
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  async function api(path, options) {
    var opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    var res = await fetch(path, opts);
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function toast(message, kind) {
    var region = el('#toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.textContent = message;
    region.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }

  // ------------------------------------------------------- access UI
  // Server decides `allowed`; this only labels what the visitor sees.
  function accessChip(entry) {
    if (entry.allowed && entry.access_level === 'public') {
      return '<span class="chip chip--free">' + icon('unlock', 12) + 'Free</span>';
    }
    if (entry.allowed) {
      return '<span class="chip chip--restricted">' + icon('check', 12) + 'Unlocked</span>';
    }
    if (entry.access_level === 'auth') {
      return '<span class="chip chip--auth">' + icon('lock', 12) + 'Sign in</span>';
    }
    return '<span class="chip chip--restricted">' + icon('lock', 12) + 'Request access</span>';
  }

  function itemHref(entry) {
    if (!entry.allowed) return '/signup/?next=' + encodeURIComponent(entry.href || '/');
    if (entry.kind === 'book' && entry.book_slug) return '/read/' + entry.book_slug;
    return entry.href || '#';
  }

  function cardHTML(entry) {
    var locked = !entry.allowed;
    var body =
      '<span class="card__icon">' + icon(entry.icon, 20) + '</span>' +
      '<span class="card__title">' + esc(entry.title) + '</span>' +
      '<span class="card__desc">' + esc(locked && entry.teaser ? entry.teaser : entry.description || '') + '</span>' +
      '<span class="card__foot">' + accessChip(entry) +
      (entry.badge ? '<span class="chip">' + esc(entry.badge) + '</span>' : '') + '</span>';
    return '<a class="card' + (locked ? ' card--locked' : '') + '" href="' + esc(itemHref(entry)) + '">' + body + '</a>';
  }

  function renderCards(target, entries, emptyText) {
    var node = typeof target === 'string' ? el(target) : target;
    if (!node) return;
    if (!entries || !entries.length) {
      node.innerHTML = '<div class="empty">' + esc(emptyText || 'Nothing published here yet.') + '</div>';
      return;
    }
    node.className = 'grid';
    node.innerHTML = entries.map(cardHTML).join('');
  }

  // ---------------------------------------------------------- chrome
  var session = { user: null, loaded: false };

  function headerHTML(nav) {
    var links = (nav || []).map(function (s) {
      var href = '/s/' + s.slug;
      var current = location.pathname.indexOf(href) === 0 ? ' aria-current="page"' : '';
      return '<a href="' + esc(href) + '"' + current + '>' + esc(s.title) + '</a>';
    }).join('');
    var actions = session.user
      ? '<a class="btn btn--ghost btn--sm" href="/account/">' + esc(session.user.name || session.user.email) + '</a>' +
        (session.user.role === 'admin' ? '<a class="btn btn--ghost btn--sm" href="/admin/">Admin</a>' : '') +
        '<button class="btn btn--quiet btn--sm" data-signout aria-label="Sign out">' + icon('log-out', 18) + '</button>'
      : '<a class="btn btn--quiet btn--sm" href="/login/">Sign in</a>' +
        '<a class="btn btn--primary btn--sm" href="/signup/">Create account</a>';
    return '<div class="site-header__inner">' +
      '<a class="brand" href="/"><span class="brand__mark">' + icon('layers', 16) + '</span>Thinkneering</a>' +
      '<nav class="site-nav" aria-label="Sections">' + links + '</nav>' +
      '<div class="header-actions">' +
      '<button class="btn btn--quiet btn--sm" data-theme-toggle aria-label="Switch colour theme">' + icon('moon', 18) + '</button>' +
      actions + '</div></div>';
  }

  function footerHTML() {
    return '<div class="site-footer__inner">' +
      '<div>Thinkneering — tools that shorten office work.</div>' +
      '<nav aria-label="Footer"><a href="/">Home</a><a href="/s/tools">Tools</a>' +
      '<a href="/s/hvac">HVAC</a><a href="/s/education">Education</a><a href="/account/">Account</a></nav>' +
      '</div>';
  }

  function applyTheme(mode) {
    if (mode) document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('tn-theme', mode); } catch (e) {}
  }

  function initTheme() {
    var saved;
    try { saved = localStorage.getItem('tn-theme'); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }

  async function mountChrome() {
    var header = el('[data-site-header]');
    var footer = el('[data-site-footer]');
    var data = null;
    try { data = await api('/api/catalog'); } catch (e) { data = { user: null, sections: [] }; }
    session.user = data.user || null;
    session.loaded = true;
    TN.catalog = data;

    if (header) {
      header.className = 'site-header';
      header.innerHTML = headerHTML(data.sections || []);
    }
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = footerHTML();
    }
    var toggle = el('[data-theme-toggle]');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var now = document.documentElement.getAttribute('data-theme');
        applyTheme(now === 'dark' ? 'light' : 'dark');
      });
    }
    var out = el('[data-signout]');
    if (out) {
      out.addEventListener('click', async function () {
        await api('/api/auth/logout', { method: 'POST' });
        location.href = '/';
      });
    }
    if (data.announcement) {
      var bar = document.createElement('div');
      bar.className = 'wrap';
      bar.style.paddingTop = 'var(--space-3)';
      bar.innerHTML = '<div class="notice">' + icon('activity', 18) + '<div>' + esc(data.announcement) + '</div></div>';
      document.body.insertBefore(bar, el('main'));
    }
    document.dispatchEvent(new CustomEvent('tn:ready', { detail: data }));
  }

  async function requireRole(role) {
    if (!session.loaded) await mountChrome();
    if (!session.user || (role === 'admin' && session.user.role !== 'admin')) {
      location.href = '/login/?next=' + encodeURIComponent(location.pathname);
      return false;
    }
    return true;
  }

  var TN = {
    icon: icon, esc: esc, el: el, els: els, api: api, toast: toast,
    renderCards: renderCards, cardHTML: cardHTML, accessChip: accessChip,
    session: session, requireRole: requireRole, mountChrome: mountChrome
  };
  window.TN = TN;

  initTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountChrome);
  } else {
    mountChrome();
  }
})();
