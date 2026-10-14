/* ============================================================
   Product Options - page logic.
   A tree per product and factory: section > component > the values
   seen on the datasheets run in Datasheet Notes (Api.poTree), plus
   special options and notes added by editors.
   Only rows the product's row mapping shows are in the tree; the
   database decides that (po_get_tree), the page only draws it.
   The row mapping is one list per product, the same for every
   factory and every user (Datasheet Notes, this tree, the project
   pages all read it). Editors (admins, and users with "Can edit"
   for product-options) maintain it on mapping.html, reached by the
   Row mapping button, and get the Edit switch on the tree: add /
   change / delete special options and notes, take a value or a row
   out of the tree and bring it back.
   FCU: the values come per unit model (tree.models). Each series is
   one table: rows = section > component, one column per model with
   the values its units had, differences from the first model
   highlighted (owner's rules, 2 and 5 Oct 2026; seriesTable). A trailing N on the
   Unit Model is a motor variant of the same model (FWW1600TAN is
   filed under FWW1600TA; the database does that), so the Unit Model
   row inside a model lists the variants seen. Special options and
   notes are per section or row, not per model: they sit in the last
   column of every series table, where editors add them.
   AHU trees have no models and stay as before.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el, Api = window.Api;
  var TOOL = 'product-options', FEW = 8, LONG = 20, STORE = 'dame_po_choice';

  var productSel = $('po-product'), factorySel = $('po-factory'), search = $('po-search');
  var hint = $('po-hint'), result = $('po-result'), host = $('po-tree-host');
  var products = [], tree = null, canEdit = false, closed = {}, expanded = {}, loadNo = 0, mapper = false;

  function option(v, t) { return el('option', { value: v, text: t }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function low(s) { return String(s || '').toLowerCase(); }
  function remember() { try { localStorage.setItem(STORE, JSON.stringify({ p: productSel.value, f: factorySel.value })); } catch (e) { /* ignore */ } }
  function recall() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }

  /* ---------- selection ---------- */
  function fillFactories(wanted) {
    var p = product();
    factorySel.textContent = '';
    if (!p) { factorySel.appendChild(option('', 'Choose a product first')); factorySel.disabled = true; return; }
    factorySel.appendChild(option('', 'Choose a factory'));
    p.factories.forEach(function (f) { factorySel.appendChild(option(f.id, f.name)); });
    factorySel.disabled = false;
    if (p.factories.length === 1) factorySel.value = p.factories[0].id;
    else if (wanted && p.factories.some(function (f) { return f.id === wanted; })) factorySel.value = wanted;
  }
  /* Row mapping button (editors only): opens the mapping of the product shown here. The mapping
     is per product, so the button needs a product, not a factory. */
  function mappingLink() {
    var a = $('po-mapping'), p = product();
    a.hidden = !mapper;
    a.href = 'mapping.html' + (p ? '?product=' + encodeURIComponent(p.id) : '');
    a.title = p ? 'Which datasheet rows are used for ' + p.name + ' and what each says. Same for every factory and every user.' : 'Choose a product first';
    if (!p) a.setAttribute('aria-disabled', 'true'); else a.removeAttribute('aria-disabled');
  }
  $('po-mapping').addEventListener('click', function (e) { if (!product()) { e.preventDefault(); productSel.focus(); window.Hub.toast('Choose a product first.'); } });
  productSel.addEventListener('change', function () { fillFactories(); mappingLink(); load(); });
  factorySel.addEventListener('change', load);

  function load(keep) {
    var id = factorySel.value, no = ++loadNo;
    remember();
    if (!id) {
      tree = null; result.hidden = true; search.disabled = true;
      hint.className = 'hint'; hint.textContent = product() ? 'Choose a factory.' : 'Choose a product and a factory.';
      return Promise.resolve();
    }
    if (!keep) { hint.className = 'hint'; hint.textContent = 'Loading…'; closed = {}; expanded = {}; }
    return Api.poTree(window.Hub.token(), id).then(function (res) {
      if (no !== loadNo) return;
      tree = res; canEdit = !!res.can_edit;
      hint.className = 'hint'; hint.textContent = res.factory.product + ', ' + res.factory.name + ' factory.';
      $('po-edit-wrap').hidden = !canEdit;
      if (!canEdit) $('po-edit').checked = false;
      search.disabled = false; result.hidden = false; $('po-error').hidden = true;
      render();
    }, function (err) {
      if (no !== loadNo) return;
      hint.className = 'notice error';
      hint.textContent = 'Could not load the options: ' + ((err && err.message) || err) + ' Choose the factory again to retry.';
      if (!keep) result.hidden = true;
    });
  }

  /* ---------- flat lists from the database -> sections ---------- */
  function build() {
    var secs = [], by = {};
    function sec(name) {
      var k = low(name);
      if (!by[k]) { by[k] = { name: name, rows: [], extras: [] }; secs.push(by[k]); }
      return by[k];
    }
    var rowBy = {};
    tree.rows.forEach(function (r) {
      var opt = /\|options\|option$/.test(r.key);      // the Options List lines of the section
      var row = { key: r.key, sub: r.sub || '', name: opt ? 'From the options list' : r.component, off: !!r.hidden, values: r.values || [], extras: [] };
      rowBy[r.key] = row; sec(r.section || 'General').rows.push(row);
    });
    tree.extras.forEach(function (x) {
      if (x.key && rowBy[x.key]) rowBy[x.key].extras.push(x); else sec(x.section).extras.push(x);
    });
    return secs;
  }

  /* "2,500 m3/h" -> { n: 2500, s: "2,500", unit: "m3/h" }; null when the value is not a number with a unit */
  function number(text) {
    var m = /^(-?\d[\d.,]*)\s*(.*)$/.exec(text);
    if (!m) return null;
    var n = parseFloat(m[1].replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return isNaN(n) ? null : { n: n, s: m[1], unit: m[2] };
  }

  /* 2,500 m3/h ... 45,000 m3/h -> a range, when every value is a number with the same unit */
  function range(values) {
    var unit = null, min = null, max = null, ok = values.every(function (v) {
      var x = number(v.v);
      if (!x || (unit !== null && unit !== x.unit)) return false;
      unit = x.unit;
      if (min === null || x.n < min.n) min = x;
      if (max === null || x.n > max.n) max = x;
      return true;
    });
    return ok && min && min.n !== max.n ? min.s + ' to ' + max.s + (unit ? ' ' + unit : '') : '';
  }

  function times(n) { return 'seen ' + n + (n === 1 ? ' time' : ' times'); }

  /* The values of one row for an Excel cell: one per line with how often each was seen, numbers in
     numeric order, the range first when the page shows one. A long list (more than LONG values)
     is written on one wrapped line without the counts, so the cell stays readable. */
  function cellText(values) {
    var list = values.slice(), unit = null;
    if (list.length > 1 && list.every(function (v) { var x = number(v.v); if (!x || (unit !== null && unit !== x.unit)) return false; unit = x.unit; return true; })) {
      list.sort(function (a, b) { return number(a.v).n - number(b.v).n; });
    }
    var rg = list.length > FEW ? range(list) : '', lines = rg ? [rg] : [];
    if (list.length > LONG) lines.push(list.length + ' values: ' + list.map(function (v) { return v.v; }).join(', '));
    else list.forEach(function (v) { lines.push(v.v + ' (' + times(v.n) + ')'); });
    return lines.join('\n');
  }

  function matches(q, s, r) {
    if (!q) return true;
    var text = [s.name, r ? r.sub : '', r ? r.name : ''].concat(
      r ? r.values.map(function (v) { return v.v; }) : [],
      (r ? r.extras : s.extras).map(function (x) { return x.body; })).join(' \n ');
    return q.split(/\s+/).every(function (w) { return low(text).indexOf(w) >= 0; });
  }

  /* ---------- drawing ---------- */
  function editing() { return canEdit && $('po-edit').checked; }
  function when(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? window.Hub.date(iso) : ''; }

  function busy(btn, promise, done) {
    btn.disabled = true;
    return promise.then(function () { window.Hub.toast(done); return load(true); },
      function (err) { btn.disabled = false; window.Hub.toast((err && err.message) || String(err), true); });
  }

  function xbtn(text, fn, danger) { return el('button', { type: 'button', 'class': 'po-x' + (danger ? ' danger' : ''), text: text, onclick: fn }); }

  /* one form at a time: add or change a special option / note */
  function openForm(anchor, d) {
    var old = host.querySelector('.po-form'); if (old) old.remove();
    var isNote = d.kind === 'note';
    var box = isNote ? el('textarea', { 'class': 'input', maxlength: 1000, 'aria-label': 'Note' })
                     : el('input', { 'class': 'input', type: 'text', maxlength: 1000, 'aria-label': 'Special option' });
    box.value = d.body || '';
    var msg = el('p', { 'class': 'hint', role: 'alert' });
    var save = el('button', { type: 'button', 'class': 'btn sm', text: d.id ? 'Save' : (isNote ? 'Add note' : 'Add special option') });
    var form = el('div', { 'class': 'po-form' }, [
      el('strong', { 'class': 'small', text: (d.id ? 'Change ' : 'New ') + (isNote ? 'note' : 'special option') + ' for ' + d.where }),
      box, msg,
      el('div', { 'class': 'row' }, [save, el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Cancel', onclick: function () { form.remove(); } })])
    ]);
    function submit() {
      var body = box.value.trim();
      if (!body) { msg.textContent = 'Type the text first.'; box.focus(); return; }
      msg.textContent = '';
      busy(save, Api.poAdminSaveExtra(window.Hub.token(), { factoryId: tree.factory.id, id: d.id, section: d.section, key: d.key, kind: d.kind, body: body }),
           d.id ? 'Saved.' : (isNote ? 'Note added.' : 'Special option added.'));
    }
    save.addEventListener('click', submit);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') form.remove();
      if (e.key === 'Enter' && (!isNote || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
    anchor.appendChild(form); box.focus();
  }

  function extraNodes(list, ctx, edit) {
    var out = [];
    function tools(x, node) {
      if (!edit) return;
      node.appendChild(xbtn('Change', function () { openForm(ctx.anchor(), { id: x.id, kind: x.kind, body: x.body, section: x.section, key: x.key, where: ctx.where }); }));
      node.appendChild(xbtn('Delete', function (e) {
        var btn = e.currentTarget;
        window.Hub.confirm(x.body, { title: 'Delete this ' + (x.kind === 'note' ? 'note' : 'special option') + '?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) busy(btn, Api.poAdminDeleteExtra(window.Hub.token(), x.id), 'Deleted.');
        });
      }, true));
    }
    list.filter(function (x) { return x.kind === 'option'; }).forEach(function (x) {
      var c = el('span', { 'class': 'po-chip special', title: 'Added by ' + (x.by || 'an editor') + (when(x.at) ? ', ' + when(x.at) : '') }, [el('b', { text: 'Special' }), el('span', { text: x.body })]);
      tools(x, c); out.push(c);
    });
    list.filter(function (x) { return x.kind === 'note'; }).forEach(function (x) {
      var n = el('p', { 'class': 'po-note' }, [el('span', { text: x.body }), el('span', { 'class': 'by', text: '  ' + [x.by, when(x.at)].filter(Boolean).join(', ') + ' ' })]);
      tools(x, n); out.push(n);
    });
    return out;
  }

  function rowNode(s, r, edit) {
    var vals = el('div', { 'class': 'po-vals' }), node = el('div', { 'class': 'po-row' + (r.off ? ' off' : '') });
    var shown = r.values, xk = (r.model || '') + '|' + r.key, all = expanded[xk] || edit || shown.length <= FEW;
    var rg = shown.length > FEW ? range(shown.filter(function (v) { return !v.hidden; })) : '';
    if (rg) vals.appendChild(el('span', { 'class': 'po-chip range', title: 'Lowest and highest value seen so far', text: rg }));
    (all ? shown : (rg ? [] : shown.slice(0, FEW))).forEach(function (v) {
      var c = el('span', { 'class': 'po-chip' + (v.hidden ? ' off' : '') }, [el('span', { text: v.v }), el('small', { text: times(v.n), title: 'Seen ' + v.n + (v.n === 1 ? ' time' : ' times') + ' on the datasheets run so far. A datasheet run again is counted again.' })]);
      if (edit) c.appendChild(xbtn(v.hidden ? 'Bring back' : 'Take out', function (e) {
        busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, valueKey: v.k, model: v.model || '', hidden: !v.hidden }), v.hidden ? 'Value is back in the tree.' : 'Value taken out.');
      }));
      vals.appendChild(c);
    });
    if (!edit && shown.length > FEW) vals.appendChild(el('button', { type: 'button', 'class': 'po-more',
      text: all ? 'Show fewer' : (rg ? 'Show all ' + shown.length + ' values' : '+ ' + (shown.length - FEW) + ' more'),
      onclick: function () { expanded[xk] = !all; render(); } }));
    var ctx = { where: s.name + ' > ' + r.name, anchor: function () { return node; } };
    extraNodes(r.extras, ctx, edit && !r.model).forEach(function (n) { vals.appendChild(n); });
    node.appendChild(el('div', { 'class': 'po-name', text: r.name + (r.off ? ' (left out)' : '') }));
    node.appendChild(vals);
    if (edit && !r.model) node.appendChild(el('div', { 'class': 'po-tools' }, [
      xbtn('+ Special option', function () { openForm(node, { kind: 'option', section: s.name, key: r.key, where: ctx.where }); }),
      xbtn('+ Note', function () { openForm(node, { kind: 'note', section: s.name, key: r.key, where: ctx.where }); }),
      xbtn(r.off ? 'Bring row back' : 'Leave out row', function (e) {
        busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, hidden: !r.off }),
             r.off ? 'Row is back in the tree.' : 'Row left out for every ' + tree.factory.product + ' factory.');
      }, !r.off)
    ]));
    return node;
  }

  /* The sections of one group. model = '' : the plain tree (AHU) or, with extrasOnly, the
     special options and notes block of an FCU tree; model = 'FWW600VA' : that model's values only. */
  function drawSections(secs, q, edit, model, extrasOnly) {
    var wrap = el('div', { 'class': 'po-tree' }), drawn = 0, nRows = 0, nVals = 0, keys = {};
    secs.forEach(function (s) {
      var live = s.rows.filter(function (r) { return edit || !r.off; }).map(function (r) {
        // with Edit off an editor sees what users see: no values that were taken out
        var values = extrasOnly ? [] : r.values.filter(function (v) { return (edit || !v.hidden) && (model ? v.model === model : true); });
        return { key: r.key, sub: r.sub, name: r.name, off: r.off, values: values, extras: model ? [] : r.extras, model: model };
      }).filter(function (r) {
        return r.values.length || r.extras.length || (!model && !extrasOnly && edit);
      });
      live.forEach(function (r) { if (!r.off) { nRows++; keys[r.key] = 1; nVals += r.values.filter(function (v) { return !v.hidden; }).length; } });
      var secHit = q && q.split(/\s+/).every(function (w) { return low(s.name).indexOf(w) >= 0; });
      var rows = live.filter(function (r) { return secHit || matches(q, s, r); });
      var extras = model ? [] : s.extras.filter(function (x) { return secHit || !q || matches(q, { name: s.name, extras: [x] }); });
      if (!rows.length && !extras.length && !(edit && !q && !model)) return;
      drawn++;

      var body = el('div', { 'class': 'po-body' }), ck = (model ? 'm:' + low(model) + ':' : '') + low(s.name);
      var d = el('details', { 'class': 'po-sec', open: q ? true : !closed[ck] }, [
        el('summary', {}, [el('span', { text: s.name }), el('span', { 'class': 'count',
          text: [rows.length ? rows.length + (rows.length === 1 ? ' component' : ' components') : '',
                 (model ? 0 : s.extras.length) + live.reduce(function (n, r) { return n + r.extras.length; }, 0) ? 'special options and notes' : ''].filter(Boolean).join(' · ') })]),
        body
      ]);
      d.addEventListener('toggle', function () { if (!q) closed[ck] = !d.open; });

      if (!model) {
        var ctx = { where: s.name, anchor: function () { return sx; } };
        var sx = el('div', { 'class': 'po-secx' }, extraNodes(extras, ctx, edit));
        if (edit) sx.appendChild(el('div', { 'class': 'po-tools' }, [
          xbtn('+ Special option for the section', function () { openForm(sx, { kind: 'option', section: s.name, key: '', where: s.name }); }),
          xbtn('+ Note for the section', function () { openForm(sx, { kind: 'note', section: s.name, key: '', where: s.name }); })
        ]));
        if (sx.childNodes.length) body.appendChild(sx);
      }

      var sub = '';
      rows.forEach(function (r) {
        if (r.sub !== sub) { sub = r.sub; if (sub) body.appendChild(el('div', { 'class': 'po-sub', text: sub })); }
        body.appendChild(rowNode(s, r, edit));
      });
      wrap.appendChild(d);
    });
    return { wrap: wrap, drawn: drawn, rows: nRows, values: nVals, keys: keys };
  }

  /* FCU: one table per series. Rows = section > component, one column per model, so the models
     can be compared at a glance (owner's rule, 5 Oct 2026). The first model is the reference: a
     cell whose values differ from it is highlighted, one colour per different set of values, as
     in Datasheet Notes. The last column holds the special options and notes of the row (they are
     for every model) and, with Edit on, the buttons to add them and to leave the row out.
     The Component column stays in view when the table scrolls sideways. */
  function seriesTable(sr, secs, q, words, edit, only) {
    var srHit = !!q && words.every(function (w) { return low(sr.name).indexOf(w) >= 0; });
    var names = sr.models.map(function (m) { return m.model; });
    // a search for a model name keeps that model's column only
    var cols = q && !srHit ? sr.models.filter(function (m) { return words.every(function (w) { return low(m.model).indexOf(w) >= 0; }); }) : [];
    var modelHit = cols.length > 0;
    if (!modelHit) cols = sr.models;
    var out = { node: null, rows: 0, values: 0, keys: {}, sections: [], models: cols.length, differ: 0 };
    var body = el('tbody'), nCols = cols.length + 2;

    secs.forEach(function (s) {
      var lines = [], secHit = srHit || modelHit || (q && words.every(function (w) { return low(s.name).indexOf(w) >= 0; }));
      s.rows.forEach(function (r) {
        if (r.off && !edit) return;
        var cells = cols.map(function (m) { return r.values.filter(function (v) { return v.model === m.model && (edit || !v.hidden); }); });
        var inSeries = r.values.some(function (v) { return names.indexOf(v.model) >= 0 && (edit || !v.hidden); });
        if (!inSeries) return;                                       // this series never had the row
        if (!r.off) { out.keys[r.key] = 1; cells.forEach(function (c) { out.values += c.filter(function (v) { return !v.hidden; }).length; }); }
        // compare with the first model: same set of values = same mark
        var sig = cells.map(function (c) { return c.filter(function (v) { return !v.hidden; }).map(function (v) { return low(v.v).replace(/\s+/g, ' '); }).sort().join('\u0001'); });
        var seen = {}, next = 0, marks = sig.map(function (g, i) { if (i === 0 || g === sig[0]) return 0; if (!seen[g]) seen[g] = ++next; return seen[g]; });
        if (/\|unit model$/.test(r.key)) marks = marks.map(function () { return 0; });   // the model name differs by definition
        var differs = marks.some(Boolean);
        if (differs && !r.off) out.differ++;
        if (only && !differs) return;
        // the search looks at this series' own values, not at what other series printed in the row
        if (q && !secHit && !matches(q, s, { sub: r.sub, name: r.name, values: [].concat.apply([], cells), extras: r.extras })) return;
        lines.push({ r: r, cells: cells, marks: marks, differs: differs });
      });
      if (lines.length || s.rows.some(function (r) { return r.values.some(function (v) { return names.indexOf(v.model) >= 0; }); })) out.sections.push(s.name);
      if (!lines.length) return;

      // section row: its name, and the special options and notes of the whole section
      var sx = el('div', { 'class': 'po-vals' }), sctx = { where: s.name, anchor: function () { return sx; } };
      extraNodes(s.extras, sctx, edit).forEach(function (n) { sx.appendChild(n); });
      if (edit) sx.appendChild(el('div', { 'class': 'po-tools' }, [
        xbtn('+ Special option for the section', function () { openForm(sx, { kind: 'option', section: s.name, key: '', where: s.name }); }),
        xbtn('+ Note for the section', function () { openForm(sx, { kind: 'note', section: s.name, key: '', where: s.name }); })]));
      body.appendChild(el('tr', { 'class': 'sec' }, [el('td', { colspan: String(nCols - 1), text: s.name }), el('td', {}, [sx])]));

      var sub = '';
      lines.forEach(function (ln) {
        var r = ln.r;
        if (r.sub !== sub) { sub = r.sub; if (sub) body.appendChild(el('tr', { 'class': 'sub' }, [el('td', { colspan: String(nCols), text: sub })])); }
        var xcell = el('div', { 'class': 'po-vals' }), ctx = { where: s.name + ' > ' + r.name, anchor: function () { return xcell; } };
        extraNodes(r.extras, ctx, edit).forEach(function (n) { xcell.appendChild(n); });
        if (edit) xcell.appendChild(el('div', { 'class': 'po-tools' }, [
          xbtn('+ Special option', function () { openForm(xcell, { kind: 'option', section: s.name, key: r.key, where: ctx.where }); }),
          xbtn('+ Note', function () { openForm(xcell, { kind: 'note', section: s.name, key: r.key, where: ctx.where }); }),
          xbtn(r.off ? 'Bring row back' : 'Leave out row', function (e) {
            busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, hidden: !r.off }),
                 r.off ? 'Row is back in the tree.' : 'Row left out for every ' + tree.factory.product + ' factory.');
          }, !r.off)]));
        var tr = el('tr', { 'class': (r.off ? 'off' : '') + (ln.differs ? ' differs' : '') || null }, [el('td', { 'class': 'comp', text: r.name + (r.off ? ' (left out)' : '') })]);
        ln.cells.forEach(function (vals, i) {
          var mk = ln.marks[i], td = el('td', { 'class': mk ? 'diff d' + ((mk - 1) % 5 + 1) : null, title: mk ? 'Differs from ' + cols[0].model : null });
          var xk = cols[i].model + '|' + r.key, all = expanded[xk] || edit || vals.length <= 4;
          if (!vals.length) td.appendChild(el('span', { 'class': 'muted', text: '-' }));
          var rg = vals.length > 4 ? range(vals.filter(function (v) { return !v.hidden; })) : '';
          if (rg) td.appendChild(el('div', { 'class': 'po-cellv', text: rg }));
          (all ? vals : (rg ? [] : vals.slice(0, 4))).forEach(function (v) {
            var line = el('div', { 'class': 'po-cellv' + (v.hidden ? ' off' : '') }, [el('span', { text: v.v }),
              vals.length > 1 ? el('small', { text: ' ' + times(v.n), title: 'A datasheet run again is counted again.' }) : null]);
            if (edit) line.appendChild(xbtn(v.hidden ? 'Bring back' : 'Take out', function (e) {
              busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, valueKey: v.k, model: v.model || '', hidden: !v.hidden }), v.hidden ? 'Value is back in the tree.' : 'Value taken out.');
            }));
            td.appendChild(line);
          });
          if (!edit && vals.length > 4) td.appendChild(el('button', { type: 'button', 'class': 'po-more', text: all ? 'Show fewer' : (rg ? 'Show all ' + vals.length : '+ ' + (vals.length - 4) + ' more'),
            onclick: function () { expanded[xk] = !all; render(); } }));
          tr.appendChild(td);
        });
        tr.appendChild(el('td', {}, [xcell]));
        body.appendChild(tr); out.rows++;
      });
    });

    var head = el('tr', {}, [el('th', { text: 'Section / component' })]
      .concat(cols.map(function (m) { return el('th', { 'class': 'unit' }, [el('div', { text: m.model }), el('small', { text: units(m.units) })]); }),
              [el('th', { text: 'Special options and notes' })]));
    var colW = cols.length > 8 ? 150 : 190, narrow = window.matchMedia('(max-width: 560px)').matches, lead = narrow ? [130] : [230], extraW = edit ? 300 : 240;
    var colgroup = el('colgroup', {}, lead.concat(cols.map(function () { return colW; }), [extraW]).map(function (w) { return el('col', { style: 'width:' + w + 'px' }); }));
    var table = el('table', { 'class': 'table po-matrix', style: 'min-width:' + (lead[0] + colW * cols.length + extraW) + 'px' }, [colgroup, el('thead', {}, [head]), body]);
    out.node = el('div', { 'class': 'po-matrix-box' }, [
      cols.length > 1 ? el('p', { 'class': 'hint', text: cols[0].model + ' is the reference. A cell with other values than it is highlighted, one colour for each different set of values.' }) : null,
      el('div', { 'class': 'table-wrap po-matrix-wrap', tabindex: '0', role: 'region', 'aria-label': 'Series ' + sr.name + ', models side by side' }, [table])]);
    return out;
  }

  /* models grouped by series, in the order the database gives (series, then most units first) */
  function seriesList() {
    var out = [], by = {};
    (tree.models || []).forEach(function (m) {
      var k = low(m.series);
      if (!by[k]) { by[k] = { name: m.series, models: [], units: 0 }; out.push(by[k]); }
      by[k].models.push(m); by[k].units += m.units || 0;
    });
    return out;
  }
  function modelMode() { return !!(tree && tree.models && tree.models.length); }
  function units(n) { return times(n); }           // a datasheet run again is counted again, so not "units"

  function render() {
    if (!tree) return;
    var edit = editing(), q = low(search.value).trim(), secs = build();
    var nRows = 0, nVals = 0, nExtra = tree.extras.length, drawn = 0, distinct = {};
    host.textContent = '';
    $('po-edit-note').hidden = !edit;

    var parts = [], series = modelMode() ? seriesList() : [];
    if (!modelMode()) {
      var g = drawSections(secs, q, edit, '', false);
      drawn = g.drawn; nRows = g.rows; nVals = g.values; parts.push(g.wrap);
    } else {
      var words = q ? q.split(/\s+/) : [], only = $('po-only').checked, inTable = {};
      series.forEach(function (sr) {
        var g = seriesTable(sr, secs, q, words, edit, only);
        nVals += g.values;
        Object.keys(g.keys).forEach(function (k) { distinct[k] = 1; });   // a component counts once, however many models have it
        g.sections.forEach(function (n) { inTable[low(n)] = 1; });
        if (!g.rows) return;
        drawn += g.rows;
        var sk = 'series:' + low(sr.name);
        var sd = el('details', { 'class': 'po-series', open: q ? true : !closed[sk] }, [
          el('summary', {}, [el('span', { text: 'Series ' + sr.name }), el('span', { 'class': 'count',
            text: g.models + (g.models === 1 ? ' model' : ' models') + ' · ' + units(sr.units) + (g.differ ? ' · ' + g.differ + (g.differ === 1 ? ' row differs' : ' rows differ') + ' between models' : '') })]),
          g.node
        ]);
        sd.addEventListener('toggle', function () { if (!q) closed[sk] = !sd.open; });
        parts.push(sd);
      });
      nRows = Object.keys(distinct).length;
      // sections that have only special options and notes (no datasheet values in any series)
      var x = drawSections(secs.filter(function (s) { return !inTable[low(s.name)]; }), q, edit, '', true);
      if (x.drawn) {
        drawn += x.drawn;
        var xk = 'series:all';
        var xd = el('details', { 'class': 'po-series all', open: q ? true : !closed[xk] }, [
          el('summary', {}, [el('span', { text: 'Other sections' }), el('span', { 'class': 'count', text: 'special options and notes' })]),
          x.wrap
        ]);
        xd.addEventListener('toggle', function () { if (!q) closed[xk] = !xd.open; });
        parts.push(xd);
      }
    }
    $('po-only-wrap').hidden = !modelMode();

    var facts = $('po-facts'); facts.textContent = '';
    [modelMode() ? series.length + (series.length === 1 ? ' series' : ' series') + ', ' + tree.models.length + (tree.models.length === 1 ? ' model' : ' models') : secs.length + (secs.length === 1 ? ' section' : ' sections'),
     nRows + (nRows === 1 ? ' component' : ' components'), nVals + (nVals === 1 ? ' value' : ' values'),
     nExtra ? nExtra + ' special options and notes' : '', tree.updated ? 'Last datasheet ' + when(tree.updated) : '']
      .filter(Boolean).forEach(function (t) { facts.appendChild(el('span', { 'class': 'badge', text: t })); });

    var empty = $('po-empty'), nothing = !tree.rows.length && !tree.extras.length;
    empty.hidden = !!drawn; empty.textContent = '';
    if (!drawn) {
      if (q) empty.textContent = 'Nothing matches "' + search.value.trim() + '".';
      else if (!readable()) {
        empty.textContent = 'Datasheets for ' + tree.factory.product + (reader() ? ' from the ' + tree.factory.name + ' factory' : '') +
          ' cannot be read yet. Only special options and notes added by editors will show here.';
      } else {
        empty.appendChild(document.createTextNode('No datasheet has been run for this factory yet. Run one in '));
        empty.appendChild(el('a', { href: '../datasheet-notes/', text: 'Datasheet Notes' }));
        empty.appendChild(document.createTextNode(' and its mapped rows appear here.'));
      }
    }
    $('po-download').disabled = nothing;
    $('po-open').disabled = $('po-close').disabled = !drawn;

    if (drawn || edit) {
      host.appendChild(el('div', { 'class': 'po-root' }, [
        el('span', { text: tree.factory.product }), el('span', { 'class': 'badge', text: tree.factory.name + ' factory' }),
        modelMode() ? el('span', { 'class': 'hint', text: 'One table per series, one column per model, with the values its units had on the datasheets run so far. Scroll sideways to see every model.' }) : null]));
      parts.forEach(function (n) { host.appendChild(n); });
    }
    if (edit && !q) host.appendChild(addSection(secs));
  }

  /* Can Datasheet Notes read a datasheet of this product, and can a datasheet name this factory?
     From the readers of Datasheet Notes (ds-parse.js, ds-fcu.js). If they did not load, yes is assumed. */
  function reader() { return window.DSParse ? window.DSParse.readers[low(tree.factory.product_id)] || null : {}; }
  function readable() {
    var r = reader();
    return !!r && (!r.factories || r.factories.some(function (n) { return low(n) === low(tree.factory.name); }));
  }

  /* editors: an entry for a section that has nothing in the tree yet, or a new section */
  function addSection(secs) {
    var have = secs.map(function (s) { return low(s.name); });
    var names = (tree.sections || []).filter(function (n) { return have.indexOf(low(n)) < 0; });
    var input = el('input', { 'class': 'input', type: 'text', maxlength: 120, list: 'po-sections', placeholder: 'Section name, e.g. Humidifier', 'aria-label': 'Section name', style: 'max-width:280px' });
    var box = el('div', { 'class': 'po-add stack' });
    var msg = el('p', { 'class': 'hint', role: 'alert' });
    function go(kind) {
      var name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { msg.textContent = 'Type the section name first.'; input.focus(); return; }
      msg.textContent = '';
      openForm(box, { kind: kind, section: name, key: '', where: name });
    }
    box.appendChild(el('strong', { 'class': 'small', text: 'Add to another section' }));
    box.appendChild(el('div', { 'class': 'row' }, [input,
      el('datalist', { id: 'po-sections' }, names.map(function (n) { return el('option', { value: n }); })),
      el('button', { type: 'button', 'class': 'btn ghost sm', text: '+ Special option', onclick: function () { go('option'); } }),
      el('button', { type: 'button', 'class': 'btn ghost sm', text: '+ Note', onclick: function () { go('note'); } })]));
    box.appendChild(msg);
    return box;
  }

  /* ---------- controls ---------- */
  var timer;
  search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(render, 150); });
  $('po-edit').addEventListener('change', render);
  $('po-only').addEventListener('change', render);
  function setAll(open) {
    if (!tree) return;
    build().forEach(function (s) { closed[low(s.name)] = !open; });
    seriesList().forEach(function (sr) {
      closed['series:' + low(sr.name)] = !open;
      sr.models.forEach(function (m) { closed['model:' + low(m.model)] = !open; build().forEach(function (s) { closed['m:' + low(m.model) + ':' + low(s.name)] = !open; }); });
    });
    closed['series:all'] = !open;
    render();
  }
  $('po-open').addEventListener('click', function () { setAll(true); });
  $('po-close').addEventListener('click', function () { setAll(false); });

  /* Excel: what a user sees (nothing that was taken out), one row per component */
  $('po-download').addEventListener('click', function () {
    if (!tree) return;
    var byModel = modelMode(), secs = build();
    var rows = [(byModel ? ['Series', 'Model'] : []).concat(['Section', 'Sub-section', 'Component', 'Options seen on datasheets', 'Special options', 'Notes'])];
    function txt(list, kind) { return list.filter(function (x) { return x.kind === kind; }).map(function (x) { return x.body; }).join('\n'); }
    function block(model, series) {
      secs.forEach(function (s) {
        var lead = byModel ? [series, model] : [];
        if (!model && s.extras.length) rows.push(lead.concat([s.name, '', '(whole section)', '', txt(s.extras, 'option'), txt(s.extras, 'note')]));
        s.rows.forEach(function (r) {
          if (r.off) return;
          var vals = model ? r.values.filter(function (v) { return !v.hidden && v.model === model; }) : (byModel ? [] : r.values.filter(function (v) { return !v.hidden; }));
          var extras = model ? [] : r.extras;
          if (!vals.length && !extras.length) return;
          rows.push(lead.concat([s.name, r.sub, r.name, cellText(vals), txt(extras, 'option'), txt(extras, 'note')]));
        });
      });
    }
    if (byModel) { seriesList().forEach(function (sr) { sr.models.forEach(function (m) { block(m.model, sr.name); }); }); block('', 'All models'); }
    else block('', '');
    var name = tree.factory.product + ' ' + tree.factory.name + ' - Product Options.xlsx';
    var blob = window.POXlsx.build(rows, 'Product Options', (byModel ? [12, 16] : []).concat([26, 24, 32, 44, 36, 44]));
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    window.Hub.toast('Excel downloaded.');
  });

  /* ---------- start ---------- */
  window.Hub.requireLogin({ tool: TOOL }).then(function (profile) {
    mapper = window.Hub.canEdit(profile, TOOL);      // the database decides; this only shows the button
    return Api.cmOptions(window.Hub.token());
  }).then(function (res) {
    products = res.products || [];
    var last = recall();
    // opened from a datasheet row of a project: the address names the product, the factory and what to look for
    if (window.Hub.param('product')) { last = { p: window.Hub.param('product'), f: window.Hub.param('factory') }; search.value = window.Hub.param('q'); }
    productSel.textContent = '';
    productSel.appendChild(option('', 'Choose a product'));
    products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
    productSel.disabled = false;
    if (products.length === 1) productSel.value = products[0].id;
    else if (products.some(function (p) { return p.id === last.p; })) productSel.value = last.p;
    fillFactories(last.f);
    mappingLink();
    load();
  }, function (err) {
    productSel.textContent = ''; productSel.appendChild(option('', 'Could not load'));
    hint.className = 'notice error';
    hint.textContent = 'Could not load the product list: ' + ((err && err.message) || err) + ' Refresh the page to try again.';
  });
})();
