/* ============================================================
   Projects - specification lines, datasheet rows and unit values
   brought together for one product of one project.

   PRMatch.load({ projectId, productId, detail, specRows }) -> Promise of
     { product, factory, columns: [unit tag...], keyed, hasNotes, runs, notes,
       table: [{ section, kind: 'row' | 'sub', key, component,
                 spec, found,          the clauses found for the row (text) and whether any was
                 lines: [index...],    positions of those clauses in specRows
                 cells: [value...] }] }  one value per unit column
     detail    the project as Api.prGet gave it (fetched when left out)
     specRows  [{ type, sr, spec }] to match; left out = every specification of the
               product in the project, oldest first

   Rows       = the product's row mapping (Api.dnRules), rows with Show ticked.
   Clauses    = found by the row's Spec keywords (CMRows.match in cm-rows.js, which
                must be loaded first). Keyword matching, not meaning.
   Values     = from every saved datasheet table of the product (Api.prNoteGet). A row
                is tied to its value by the row key saved with the table, or by section
                and component name for tables saved before keys were kept.
   Used by compare.html, record.html and the project Excel (project.html).
   ============================================================ */
(function () {
  'use strict';
  var Api = window.Api;
  function low(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  // "2) Filter Supply" and "Filter Supply (2)" are the section "filter supply"
  function sec(s) { return low(s).replace(/^\d+\)\s*/, '').replace(/\s*\(\d+\)$/, ''); }

  /* Every unit of every saved table becomes a column. Returns a function giving a row's values. */
  function unitLookup(notes, columns) {
    var byKey = {}, byName = {}, n = 0;
    notes.forEach(function (note) {
      var s = '', used = {};
      note.columns.forEach(function (tag) { var t = tag, k = 2; while (columns.indexOf(t) >= 0) t = tag + ' (' + (k++) + ')'; columns.push(t); });
      note.rows.forEach(function (r) {
        if (r.section) s = r.section;
        if (r.kind === 'sub') return;
        [r.key ? 'k:' + r.key : null, 'n:' + sec(s) + '|' + low(r.component)].forEach(function (k) {
          if (!k || used[k]) return; used[k] = 1;                     // the first section of that name wins
          var map = k.charAt(0) === 'k' ? byKey : byName;
          (map[k] = map[k] || []).push({ at: n, cells: r.cells || [] });
        });
      });
      n += note.columns.length;
    });
    return function (row) {
      var hit = (row.key && byKey['k:' + row.key]) || byName['n:' + sec(row.section) + '|' + low(row.component)] || [];
      var out = columns.map(function () { return ''; });
      hit.forEach(function (h) { h.cells.forEach(function (v, i) { out[h.at + i] = v == null ? '' : String(v); }); });
      return out;
    };
  }

  /* The factory a saved table names: its General > Factory row, first unit that has one. */
  function factoryOf(rows) {
    var s = '', name = '';
    (rows || []).forEach(function (r) {
      if (r.section) s = r.section;
      if (!name && sec(s) === 'general' && low(r.component) === 'factory') name = ((r.cells || []).filter(function (v) { return v && v !== '-'; })[0]) || '';
    });
    return name;
  }

  function load(o) {
    var t = window.Hub.token();
    var detail = o.detail ? Promise.resolve(o.detail) : Api.prGet(t, o.projectId);
    return detail.then(function (d) {
      var runs = d.runs.filter(function (r) { return r.product_id === o.productId; }).slice().reverse();     // oldest first
      var notes = d.notes.filter(function (n) { return n.product_id === o.productId; }).slice().reverse();
      var product = (runs[0] || notes[0] || {}).product || o.productId;
      var spec = o.specRows ? Promise.resolve(o.specRows)
        : Promise.all(runs.map(function (r) { return Api.prRunGet(t, r.id); })).then(function (got) {
            var rows = []; got.forEach(function (g) { (g.lines || []).forEach(function (l) { rows.push({ type: l.type, sr: l.sr, spec: l.spec }); }); }); return rows;
          });
      return Promise.all([Api.dnRules(t, o.productId).then(function (r) { return (r && r.rules) || []; }, function () { return []; }), spec,
        Promise.all(notes.map(function (n) { return Api.prNoteGet(t, n.id); }))]).then(function (got) {
        var rules = got[0], specRows = got[1], tables = got[2], columns = [], factory = '';
        tables.forEach(function (n) { if (!factory) factory = factoryOf(n.rows); });
        var values = unitLookup(tables, columns), s = '';
        var table = window.CMRows.match(specRows, rules).map(function (r) {
          if (r.section) s = r.section;
          return { section: s, kind: r.kind, key: r.key || '', component: r.component, spec: r.text || '', found: !!r.found, lines: r.lines || [],
                   cells: r.kind === 'sub' ? [] : values({ key: r.key, section: s, component: r.component }) };
        });
        return { product: product, factory: factory, columns: columns, table: table, runs: runs, notes: notes, hasNotes: tables.length > 0,
                 keyed: rules.filter(function (r) { return r.show !== false && String(r.keywords || '').trim(); }).length };
      });
    });
  }

  function hasValue(r) { return (r.cells || []).some(function (v) { return v && v !== '-'; }); }

  /* The table as rows for an Excel sheet: section name on its first row, rows with nothing on
     either side left out. only = keep just the rows the specification asks about. */
  function sheetRows(m, only) {
    var out = [], last = null, sub = null;
    m.table.forEach(function (r) {
      if (r.kind === 'sub') { sub = r; return; }
      if ((!r.found && !hasValue(r)) || (only && !r.found)) return;
      var first = r.section !== last; last = r.section;
      if (sub && sub.section === r.section) { out.push({ section: first ? r.section : '', component: sub.component, text: '', kind: 'sub', cells: [] }); first = false; }
      sub = null;
      out.push({ section: first ? r.section : '', component: r.component, text: r.spec, kind: 'row', cells: r.cells.map(function (v) { return v || '-'; }) });
    });
    return out;
  }

  window.PRMatch = { load: load, hasValue: hasValue, sheetRows: sheetRows, sectionName: sec };
})();
