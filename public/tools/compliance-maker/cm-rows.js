/* ============================================================
   Compliance Maker - "Datasheet rows" sheet.

   Takes the rows of the converted specification and the row
   mapping of the Datasheet Notes tool (Api.dnRules, one mapping
   per product) and builds a second table: the same Section /
   Component rows the datasheet table has, with the specification
   clause that talks about each row beside it. No AI: a clause is
   found by the keywords an editor typed for the row on the
   Product Options > Row mapping screen.

   Matching rule (CMRows.match):
   - Keywords are entries separated by ";". An entry matches a clause
     when every word of the entry starts a word of the clause or of
     the heading it sits under ("fin spac" finds "fins shall be
     spaced"; "inside casing" finds the items listed under the
     heading "Inside Casing"). Section titles ("2.02 CASING") are
     not used: they would match every clause of the section.
   - Part 2 (Products) is searched first. Part 1 is used only for a
     row Part 2 has nothing for. Part 3 (Execution) is never searched.
   - The words of an entry must stand near each other in the clause.
   - Up to MAX clauses per row, best first; clauses that match much
     less well than the best one are dropped. Nothing found = empty.

   window.CMRows = { update(rows, product), clear(), sheet(), match, clauses }
   ============================================================ */
(function () {
  'use strict';

  var MAX = 3;
  var $ = function (id) { return document.getElementById(id); };
  var panel = $('rows-panel'), body = $('rows-body'), note = $('rows-note'), only = $('rows-only');
  var cache = {}, table = null, token = 0;

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function words(s) { var n = norm(s); return n ? n.split(' ') : []; }
  function shortHeading(text) { return words(text).length <= 8 && !/\b(shall|must|will|should)\b/i.test(text); }

  /* Spec rows -> clauses that can be matched, each with its part, reference and headings.
     Row types come from compliance-maker.js: part, section, letter, number, text. */
  function clauses(rows) {
    var out = [], part = 0, sec = null, lvl1 = null, lvl2 = null;
    rows.forEach(function (r, i) {
      var text = String(r.spec || '').trim();
      if (r.type === 'part') {
        var m = /PART\s+([0-9IVX]+)/i.exec(text);
        if (m) part = { I: 1, II: 2, III: 3 }[m[1].toUpperCase()] || parseInt(m[1], 10) || part;
        sec = lvl1 = lvl2 = null;
        return;
      }
      if (/\.{5,}/.test(text)) return;                       // table of contents line
      if (r.type === 'section') { sec = { sr: r.sr, text: text }; lvl1 = lvl2 = null; return; }
      if (!text) return;

      var sr = String(r.sr || '').replace(/[.)]\s*$/, ''), level = 0;
      if (r.type === 'letter') level = /^[A-Z]$/.test(sr) ? 1 : 3;
      else if (r.type === 'number') level = 2;

      var next = rows[i + 1];
      var hasChildren = !!next && ((level === 1 && (next.type === 'number' || (next.type === 'letter' && /^[a-z]/.test(String(next.sr))))) ||
                                   (level === 2 && next.type === 'letter' && /^[a-z]/.test(String(next.sr))));
      if (level === 1) { lvl1 = { sr: sr, text: text, heading: shortHeading(text) }; lvl2 = null; }
      if (level === 2) lvl2 = { sr: sr, text: text, heading: shortHeading(text) };

      var ref = sec ? sec.sr : '', ctx = '';
      if (level === 1) ref += ' ' + sr;
      else {
        if (lvl1) { ref += ' ' + lvl1.sr; if (lvl1.heading) ctx += ' ' + lvl1.text; }
        if (level === 2) ref += (lvl1 ? '.' : ' ') + sr;
        if (level === 3) { if (lvl2) { ref += (lvl1 ? '.' : ' ') + lvl2.sr; if (lvl2.heading) ctx += ' ' + lvl2.text; } ref += '.' + sr; }
      }
      // a title such as "G. Air Filters" or "2. Inside Casing" is only context for the items under it
      if (hasChildren && ((level === 1 && lvl1.heading) || (level === 2 && lvl2.heading))) return;
      out.push({ row: i, part: part, ref: ref.trim(), text: text, ctx: words(ctx),
                 toks: words(text).filter(function (w) { return !/^\d+$/.test(w); }) });
    });
    return out;
  }

  function starts(list, w) { for (var i = 0; i < list.length; i++) if (list[i].indexOf(w) === 0) return true; return false; }

  /* Smallest run of clause words that holds every keyword word once. Numbers are not counted,
     so "Fin thickness 0.165 mm (0.0065 in.) aluminum" keeps "fin" and "aluminum" close. */
  function span(toks, ws) {
    var best = Infinity;
    for (var p = 0; p < toks.length; p++) {
      var end = p, ok = true;
      for (var k = 0; k < ws.length && ok; k++) {
        var q = p;
        while (q < toks.length && toks[q].indexOf(ws[k]) !== 0) q++;
        if (q === toks.length) ok = false; else if (q > end) end = q;
      }
      if (!ok) break;                                    // not found from here on: no later start can work
      if (end - p + 1 < best) best = end - p + 1;
    }
    return best;
  }

  /* How well one row's keyword entries match this clause (0 = no match).
     Per entry: every word must start a word of the clause or of the heading above it, and the
     words found in the clause must sit within FAR other words of each other, so two topics of
     one long clause do not make a match. 2 points per word in the clause, 1 per word in the
     heading, 1 more when the words stand together. */
  var FAR = 6;
  function score(entries, c) {
    var n = 0;
    entries.forEach(function (e) {
      var pts = 0, inText = [];
      for (var i = 0; i < e.length; i++) {
        if (starts(c.toks, e[i])) { pts += 2; inText.push(e[i]); }
        else if (starts(c.ctx, e[i])) pts += 1;
        else return;
      }
      if (inText.length > 1) {
        var sp = span(c.toks, inText);
        if (sp > inText.length + FAR) return;
        if (sp <= inText.length + 1) pts += 1;
      }
      n += pts;
    });
    return n;
  }

  /* rules: [{ key, section, sub, component, show, label, keywords }] in mapping order.
     Out: [{ section, component, text, found, kind, key, lines }]  kind = 'row' | 'sub';
     section is filled on the first row of a section only. */
  function match(specRows, rules) {
    var cl = clauses(specRows);
    var hasPart2 = cl.some(function (c) { return c.part === 2; });
    var out = [], section = null, sub = '';

    // keep each section's rows together, sections in the order they first appear
    var order = [];
    rules.forEach(function (r) { if (r.show !== false && order.indexOf(r.section) < 0) order.push(r.section); });
    order.forEach(function (sec) {
      rules.forEach(function (r) {
        if (r.show === false || r.section !== sec) return;
        var entries = String(r.keywords || '').split(';').map(words).filter(function (e) { return e.length; });
        var hits = [];
        if (entries.length) {
          [2, 1].some(function (p) {
            cl.forEach(function (c, i) {
              if (hasPart2 ? c.part !== p : p !== 2) return;      // a spec with no parts is searched whole, once
              var s = score(entries, c);
              if (s) hits.push({ c: c, s: s, i: i });
            });
            return hits.length > 0;
          });
          hits.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
          // a clause that matches far less well than the best one is noise, not a second answer
          var top = hits.length ? hits[0].s : 0;
          hits = hits.filter(function (h) { return h.s * 2 >= top; });
        }
        var shown = hits.slice(0, MAX).sort(function (a, b) { return a.i - b.i; });
        var text = shown.map(function (h) { return (h.c.ref ? h.c.ref + ': ' : '') + h.c.text; }).join('\n');
        if (hits.length > MAX) text += '\n(+ ' + (hits.length - MAX) + ' more ' + (hits.length - MAX === 1 ? 'clause' : 'clauses') + ' with these keywords)';

        var first = section !== sec;
        if (first) { section = sec; sub = ''; }
        var s2 = r.sub || '';
        if (s2 !== sub) {
          sub = s2;
          if (sub) { out.push({ section: first ? sec : '', component: sub, text: '', found: false, kind: 'sub' }); first = false; }
        }
        out.push({ section: first ? sec : '', component: String(r.label || '').trim() || r.component, text: text,
                   found: hits.length > 0, keywords: entries.length > 0, kind: 'row', key: r.key,
                   lines: shown.map(function (h) { return h.c.row; }) });      // positions of the clauses in specRows
      });
    });
    return out;
  }

  /* ---------- page ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function onScreen() {
    if (!only.checked) return table;
    var out = [], sec = '', secDone = true, sub = null;
    table.forEach(function (r) {
      if (r.section) { sec = r.section; secDone = false; sub = null; }
      if (r.kind === 'sub') { sub = r; return; }
      if (!r.found) return;
      if (sub) { out.push({ section: secDone ? '' : sec, component: sub.component, text: '', kind: 'sub' }); secDone = true; sub = null; }
      out.push({ section: secDone ? '' : sec, component: r.component, text: r.text, found: true, kind: 'row' });
      secDone = true;
    });
    return out;
  }

  function render() {
    var frag = document.createDocumentFragment();
    onScreen().forEach(function (r) {
      var tr = el('tr', (r.kind === 'sub' ? 'rows-sub' : '') + (r.section ? ' rows-first' : ''));
      tr.appendChild(el('td', 'rows-sec', r.section));
      tr.appendChild(el('td', '', r.component));
      tr.appendChild(el('td', 'rows-text', r.text));
      tr.appendChild(el('td'));
      frag.appendChild(tr);
    });
    body.textContent = ''; body.appendChild(frag);
  }

  function clear() { token++; table = null; if (panel) panel.hidden = true; if (body) body.textContent = ''; }

  /* Called after every conversion. product: { id, name } of the chosen product. */
  function update(specRows, product) {
    clear();
    if (!panel || !product || !product.id) return;
    var mine = token;
    var load = cache[product.id] || (cache[product.id] = window.Api.dnRules(window.Hub.token(), product.id));
    load.then(function (res) {
      if (mine !== token) return;                        // cleared or converted again meanwhile
      var rules = (res && res.rules) || [];
      if (!rules.length) return;                         // no datasheet mapping for this product: nothing to show
      table = match(specRows, rules);
      var rowsN = table.filter(function (r) { return r.kind === 'row'; }).length;
      var found = table.filter(function (r) { return r.found; }).length;
      var withKeys = table.filter(function (r) { return r.keywords; }).length;
      note.textContent = !withKeys
        ? 'No row has keywords yet, so nothing can be found. An editor adds them in Product Options > Row mapping.'
        : found + ' of ' + rowsN + ' datasheet rows found in this specification (' + withKeys + (withKeys === 1 ? ' row has' : ' rows have') + ' keywords). ' +
          'Rows that are not found stay empty. Check each clause: it is found by keywords, not by meaning.';
      only.checked = found > 0;
      only.disabled = !found;
      render();
      panel.hidden = false;
    }, function (err) {
      delete cache[product.id];                          // try again on the next conversion
      if (mine !== token) return;
      table = null;
      note.textContent = 'The datasheet rows could not be loaded: ' + ((err && err.message) || err) + ' Press Convert to try again.';
      body.textContent = ''; only.disabled = true;
      panel.hidden = false;
    });
  }

  if (only) only.addEventListener('change', function () { if (table) render(); });

  window.CMRows = {
    update: update, clear: clear, match: match, clauses: clauses,
    /* For the Excel: every row, found or not. null when there is no table. */
    sheet: function () { return table && table.length ? { name: 'Datasheet rows', rows: table } : null; }
  };
})();
