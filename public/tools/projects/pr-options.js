/* ============================================================
   Projects - what the factory offers for one datasheet row.
   Opened from a row of a saved datasheet table (note.html) or of
   the specification-against-datasheet view (compare.html):

     PROptions.open({ productId, product, factory,      factory name read from the datasheet ('' = ask)
                      key, section, component,           the row (key when the table carries it)
                      values: [text] })                  what this project's units have in the row

   Shows the values seen on datasheets for that row at that factory
   (the Product Options tree, Api.poTree), marks the ones this project
   uses, and lists the team's special options and notes. Read only:
   editing stays on the Product Options page, linked at the bottom.
   ============================================================ */
(function () {
  'use strict';
  var el = window.Hub.el, Api = window.Api, STYLE = 'pr-options-style';
  var productsP = null, trees = {};

  var CSS = [
    '.po-panel { max-width: 520px; max-height: min(86vh, 720px); overflow-y: auto; gap: 14px; }',
    '.po-panel h2 { overflow-wrap: anywhere; }',
    '.po-panel .where { color: var(--text-soft); font-size: 14px; margin-top: -8px; }',
    '.po-panel h3 { margin: 0 0 6px; font: 650 12px/1.3 var(--font); text-transform: uppercase; letter-spacing: .05em; color: var(--text-soft); }',
    '.po-panel .vals { display: flex; flex-wrap: wrap; gap: 6px; }',
    '.po-panel .v { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 14px; background: var(--surface-2); overflow-wrap: anywhere; }',
    '.po-panel .v small { color: var(--text-soft); font-size: 12px; white-space: nowrap; }',
    '.po-panel .v.mine { background: var(--brand); color: var(--on-brand); } .po-panel .v.mine small { color: var(--on-brand); opacity: .9; }',
    '.po-panel .v.special { background: var(--ok-bg); color: var(--ok); }',
    '.po-panel .note { margin: 0 0 6px; padding: 8px 10px; border-left: 3px solid var(--brand); background: var(--surface-2); border-radius: 0 8px 8px 0; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }',
    '.po-panel .quiet { color: var(--text-soft); font-size: 14px; }',
    '.po-panel .facs { display: flex; flex-wrap: wrap; gap: 8px; }'
  ].join('\n');

  function low(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  // "2) Filter Supply" and "Filter Supply (2)" are the section "filter supply"
  function secName(s) { return low(s).replace(/^\d+\)\s*/, '').replace(/\s*\(\d+\)$/, ''); }
  function times(n) { return 'seen ' + n + (n === 1 ? ' time' : ' times'); }

  function products() { return productsP || (productsP = Api.cmOptions(window.Hub.token()).then(function (r) { return r.products || []; })); }
  function tree(factoryId) { return trees[factoryId] || (trees[factoryId] = Api.poTree(window.Hub.token(), factoryId).then(null, function (e) { delete trees[factoryId]; throw e; })); }

  function findRow(t, o) {
    var rows = t.rows || [];
    if (o.key) { var byKey = rows.filter(function (r) { return r.key === o.key; })[0]; if (byKey) return byKey; }
    var s = secName(o.section), c = low(o.component);
    return rows.filter(function (r) { return secName(r.section) === s && low(r.component) === c; })[0] || null;
  }

  function open(o) {
    if (!document.getElementById(STYLE)) document.head.appendChild(el('style', { id: STYLE, text: CSS }));
    var body = el('div', { 'class': 'stack' }, [el('p', { 'class': 'quiet', text: 'Loading…' })]);
    var where = el('p', { 'class': 'where' });
    var link = el('a', { 'class': 'btn ghost', href: '#', text: 'Open Product Options' });
    var box = el('div', { 'class': 'hub-sheet po-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Factory options for ' + o.component }, [
      el('h2', { text: o.component }), where, body,
      el('div', { 'class': 'hub-sheet-actions' }, [link, el('button', { type: 'button', 'class': 'btn', text: 'Done', onclick: close })])
    ]);
    var back = el('div', { 'class': 'hub-sheet-back', onclick: function (e) { if (e.target === back) close(); } }, [box]);
    var last = document.activeElement;
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
    function close() { document.removeEventListener('keydown', key, true); back.remove(); if (last && last.focus) last.focus(); }
    document.addEventListener('keydown', key, true);
    document.body.appendChild(back);

    function fill(node) { body.textContent = ''; [].concat(node).forEach(function (n) { if (n) body.appendChild(n); }); }

    function show(f) {
      where.textContent = secName(o.section).replace(/^./, function (c) { return c.toUpperCase(); }) + ' · ' + o.product + ', ' + f.name + ' factory';
      link.href = window.Hub.url('tools/product-options/index.html?from=projects&product=' + encodeURIComponent(o.productId) + '&factory=' + encodeURIComponent(f.id) + '&q=' + encodeURIComponent(o.component));
      fill(el('p', { 'class': 'quiet', text: 'Loading…' }));
      tree(f.id).then(function (t) {
        var row = findRow(t, o), mine = {}, out = [];
        (o.values || []).forEach(function (v) { v = low(v); if (v && v !== '-') mine[v] = 1; });
        var vals = row ? (row.values || []).filter(function (v) { return !v.hidden; }) : [];
        // one line per distinct value, however many models had it
        var seen = {}, list = [];
        vals.forEach(function (v) { var k = low(v.v); if (seen[k]) seen[k].n += v.n; else list.push(seen[k] = { v: v.v, n: v.n }); });
        list.sort(function (a, b) { return (mine[low(b.v)] ? 1 : 0) - (mine[low(a.v)] ? 1 : 0) || b.n - a.n; });
        var extras = (t.extras || []).filter(function (x) { return row ? x.key === row.key : false; });
        var secExtras = (t.extras || []).filter(function (x) { return !x.key && secName(x.section) === secName(o.section); });

        if (list.length) out.push(el('div', {}, [el('h3', { text: 'Seen on datasheets' }),
          el('div', { 'class': 'vals' }, list.slice(0, 60).map(function (v) {
            return el('span', { 'class': 'v' + (mine[low(v.v)] ? ' mine' : '') }, [el('span', { text: v.v }), el('small', { text: mine[low(v.v)] ? 'in this project' : times(v.n) })]);
          })), list.length > 60 ? el('p', { 'class': 'quiet', text: '+ ' + (list.length - 60) + ' more on the Product Options page.' }) : null]));
        var special = extras.concat(secExtras).filter(function (x) { return x.kind === 'option'; });
        if (special.length) out.push(el('div', {}, [el('h3', { text: 'Special options' }), el('div', { 'class': 'vals' }, special.map(function (x) { return el('span', { 'class': 'v special', text: x.body }); }))]));
        var notes = extras.concat(secExtras).filter(function (x) { return x.kind === 'note'; });
        if (notes.length) out.push(el('div', {}, [el('h3', { text: 'Notes from the team' })].concat(notes.map(function (x) { return el('p', { 'class': 'note', text: x.body }); }))));
        if (!out.length) out.push(el('p', { 'class': 'quiet', text: 'Nothing is known for this row at the ' + f.name + ' factory yet. It fills up as datasheets are read.' }));
        else out.push(el('p', { 'class': 'quiet', text: 'A value not listed is not known yet. It does not mean the factory cannot offer it.' }));
        fill(out);
      }, function (err) { fill(el('div', { 'class': 'notice error', text: 'Could not load the options: ' + ((err && err.message) || err) })); });
    }

    products().then(function (list) {
      var p = list.filter(function (x) { return x.id === o.productId || low(x.name) === low(o.product); })[0];
      if (!p) { fill(el('p', { 'class': 'quiet', text: 'This product has no options list.' })); link.hidden = true; return; }
      o.productId = p.id; o.product = p.name;
      var f = p.factories.filter(function (x) { return low(x.name) === low(o.factory); })[0];
      if (f) { show(f); return; }
      // the table does not say which factory: ask
      where.textContent = o.product;
      fill([el('p', { 'class': 'quiet', text: 'The datasheet does not name the factory. Choose one:' }),
        el('div', { 'class': 'facs' }, p.factories.map(function (x) { return el('button', { type: 'button', 'class': 'btn ghost', text: x.name, onclick: function () { show(x); } }); }))]);
    }, function (err) { fill(el('div', { 'class': 'notice error', text: 'Could not load the products: ' + ((err && err.message) || err) })); });
  }

  /* The factory a saved table names: its General > Factory row, first unit that has one. */
  function factoryOf(rows) {
    var sec = '', name = '';
    (rows || []).forEach(function (r) {
      if (r.section) sec = r.section;
      if (!name && secName(sec) === 'general' && low(r.component) === 'factory') name = ((r.cells || []).filter(function (v) { return v && v !== '-'; })[0]) || '';
    });
    return name;
  }

  window.PROptions = { open: open, factoryOf: factoryOf, sectionName: secName };
})();
