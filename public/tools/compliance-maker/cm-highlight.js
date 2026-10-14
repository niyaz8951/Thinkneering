/* ============================================================
   Compliance library - the highlighting of the Compliance Maker,
   for pages that only show clauses (library.html).

   Same rules as compliance-maker.js with its default options:
   the shared list data/highlight-rules.json (red, red bold,
   underline), numbers and ALL-CAPS words in red, and a short
   "Label:" prefix in brown bold. If that file changes its rules,
   change this one too.

   CMHighlight.load()      -> Promise, resolves when the rules are in
   CMHighlight.runs(text)  -> [{ text, style }]  style: '' | red | redbold | underline | colon
   ============================================================ */
(function () {
  'use strict';
  var hl = { wordStyle: {}, phrases: [] }, loaded = null;

  function add(list, style) {
    (list || []).forEach(function (item) {
      if (/\s/.test(item)) hl.phrases.push({ text: item, style: style });
      else hl.wordStyle[item.toLowerCase()] = hl.wordStyle[item.toLowerCase()] || style;
    });
  }
  function load() {
    if (loaded) return loaded;
    loaded = fetch('../../data/highlight-rules.json').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) {
        add(d.redbold, 'redbold'); add(d.underline, 'underline'); add(d.red, 'red');
        hl.phrases.sort(function (a, b) { return b.text.length - a.text.length; });
      }, function () { /* no rules file: numbers, capitals and the colon prefix still work */ });
    return loaded;
  }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function tokenStyle(tok) {
    var low = tok.toLowerCase();
    if (hl.wordStyle[low]) return hl.wordStyle[low];
    if (/^\d+(?:\.\d+)?$/.test(tok)) return 'red';
    if (/^[A-Z][A-Z0-9&/-]*[A-Z0-9]$|^[A-Z]{2,}$/.test(tok)) return 'red';
    return '';
  }
  function runs(text) {
    if (!text) return [{ text: text || '', style: '' }];
    var ci = text.indexOf(':'), colonEnd = ci > 0 && ci < 40 ? ci + 1 : 0, locked = [];
    hl.phrases.forEach(function (p) {
      var re = new RegExp('\\b' + esc(p.text) + '\\b', 'gi'), m;
      while ((m = re.exec(text)) !== null) {
        var a = m.index, b = a + m[0].length;
        if (!locked.some(function (L) { return a < L.b && b > L.a; })) locked.push({ a: a, b: b, style: p.style });
      }
    });
    function lockedAt(i) {
      if (colonEnd && i < colonEnd) return 'colon';
      for (var k = 0; k < locked.length; k++) if (i >= locked[k].a && i < locked[k].b) return locked[k].style;
      return null;
    }
    var out = [], re = /[A-Za-z0-9][A-Za-z0-9&/.-]*|[^A-Za-z0-9]+/g, m;
    while ((m = re.exec(text)) !== null) {
      var tok = m[0], lock = lockedAt(m.index);
      var style = lock || (/[A-Za-z0-9]/.test(tok[0]) ? tokenStyle(tok.replace(/\.+$/, '')) : '');
      if (out.length && out[out.length - 1].style === style) out[out.length - 1].text += tok;
      else out.push({ text: tok, style: style });
    }
    return out.length ? out : [{ text: text, style: '' }];
  }
  window.CMHighlight = { load: load, runs: runs };
})();
