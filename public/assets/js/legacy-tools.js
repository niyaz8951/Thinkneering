/* ============================================================
   DAME Tools Hub - Quicktools compatibility helpers
   Tools brought over from Quicktools call TN.icon / TN.esc /
   TN.toast. This file provides them on top of the hub shell.
   Load after hub.js. New tools should use Hub.* instead.
   ============================================================ */
(function () {
  'use strict';

  // Line icons copied from the Quicktools global.js
  var P = {
    'file-check': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/>',
    container: '<rect x="2" y="7" width="20" height="10" rx="1"/><path d="M7 7v10M12 7v10M17 7v10"/>',
    layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    crosshair: '<circle cx="12" cy="12" r="9"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
    psychro: '<path d="M4 4v14a2 2 0 0 0 2 2h14"/><path d="M20 7c-7 1-11 5-13 12"/><circle cx="14" cy="14" r="1.6"/>',
    acoustic: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    coil: '<path d="M3 5h15a2 2 0 0 1 0 4H6a2 2 0 0 0 0 4h12a2 2 0 0 1 0 4H3"/><path d="M3 21h18"/>'
  };

  function icon(name, size) {
    var d = P[name] || P.square;
    return '<svg viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) +
      '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function toast(message, kind) { window.Hub.toast(message, kind === 'error'); }

  window.TN = { base: window.Hub.url(''), icon: icon, esc: esc, el: el, els: els, toast: toast };

  function ready() { document.dispatchEvent(new CustomEvent('tn:ready', { detail: {} })); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();

  // Canvas drawings read their colours when they draw. Tell them to redraw when day/night is switched.
  if (window.MutationObserver) {
    new MutationObserver(function () {
      document.dispatchEvent(new CustomEvent('hub:theme'));
      window.dispatchEvent(new Event('resize'));
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
})();
