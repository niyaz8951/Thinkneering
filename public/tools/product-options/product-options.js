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
   FCU: the values come per unit model (tree.models). Since 22 Oct 2026
   (owner: "as the AHU") the FCU tree is drawn with the AHU cards too:
   a card per part of the unit (Unit, Fan and motor, Coil, Filter, Drain
   pan, Electric heater, Sound: ds-fcu.js poCards), one column per model,
   the models of one series together, what every model has in common on
   top and the duty figures folded away as ranges. A trailing N on the
   Unit Model is a motor variant of the same model (FWW1600TAN is filed
   under FWW1600TA; the database does that), so the Unit Model row of a
   model lists the variants seen.
   Approval (19 Oct 2026): a value new to the factory waits ("to approve", v.wait) until the super
   user or an admin of this tile approves it (Api.poAdminApprove); users, the Excel download and the
   AI see only approved values. A rejected value is removed; seen again, it waits again.
   21 Oct 2026 (owner): Approve all / Reject all per row, Edit is a toggle, editors tick rows and leave them
   out together (Api.poAdminSetRowsHidden). AHU trees are cards per kind of component (see "AHU: one card"
   below and docs/Product-Options-Redesign.md): common options, accessories, a column per model, duty
   figures as ranges.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el, Api = window.Api;
  var TOOL = 'product-options', FEW = 8, LONG = 20, STORE = 'dame_po_choice';

  var productSel = $('po-product'), factorySel = $('po-factory'), search = $('po-search');
  var hint = $('po-hint'), result = $('po-result'), host = $('po-tree-host');
  var products = [], tree = null, canEdit = false, closed = {}, expanded = {}, loadNo = 0, mapper = false, onlyWait = false;
  var editOn = false, picked = {};          // picked: row key -> row name, the rows ticked for "Leave out rows"
  var pickedSeries = {};                     // FCU: row key -> { series: 1 }, the series a row was ticked in
  var pickedSeries = {};                     // FCU: row key -> { series: 1 } the series a row was ticked in

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
    if (!keep) { hint.className = 'hint'; hint.textContent = 'Loading…'; closed = {}; expanded = {}; picked = {}; }
    return Api.poTree(window.Hub.token(), id).then(function (res) {
      if (no !== loadNo) return;
      tree = res; canEdit = !!res.can_edit;
      if (!res.waiting) onlyWait = false;
      hint.className = 'hint'; hint.textContent = res.factory.product + ', ' + res.factory.name + ' factory.';
      $('po-edit').hidden = !canEdit;
      if (!canEdit) setEdit(false, true);
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
  // whole = true: every value (the Excel download); otherwise, with "Only values to approve" on, just the values
  // read from datasheets that wait for an admin's approval
  function build(whole) {
    var secs = [], by = {}, waitOnly = onlyWait && !whole;
    function sec(name) {
      var k = low(name);
      if (!by[k]) { by[k] = { name: name, rows: [], extras: [] }; secs.push(by[k]); }
      return by[k];
    }
    var rowBy = {};
    tree.rows.forEach(function (r) {
      var opt = /\|options\|option$/.test(r.key);      // the Options List lines of the section
      var vals = (r.values || []).filter(function (v) { return !waitOnly || v.wait; });
      if (waitOnly && !vals.length) return;
      var row = { key: r.key, sub: r.sub || '', name: opt ? 'From the options list' : r.component, off: !!r.hidden, values: vals, extras: [] };
      // the power supply has its own section, above Unit Data (owner, 21 Oct 2026)
      rowBy[r.key] = row; sec(/^general\|\|power supply$/.test(r.key) ? 'Power Supply' : (r.section || 'General')).rows.push(row);
    });
    if (!waitOnly) tree.extras.forEach(function (x) {
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
  function editing() { return canEdit && editOn; }
  function setEdit(on, quiet) {
    editOn = !!on;
    $('po-edit').setAttribute('aria-pressed', editOn ? 'true' : 'false');
    if (!editOn) picked = {};
    if (!quiet) render();
  }
  function when(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? window.Hub.date(iso) : ''; }

  function busy(btn, promise, done) {
    btn.disabled = true;
    return promise.then(function () { window.Hub.toast(done); return load(true); },
      function (err) { btn.disabled = false; window.Hub.toast((err && err.message) || String(err), true); });
  }

  function xbtn(text, fn, danger) { return el('button', { type: 'button', 'class': 'po-x' + (danger ? ' danger' : ''), text: text, onclick: fn }); }

  /* A value read from a datasheet waits for an admin (the super user or an admin of this tile) before it is a fact for
     the factory: until then users, the Excel download and the AI do not see it. */
  function waitTag(v, r, holder) { waitTagItems(v.v, [item(r.key, v)], holder); }
  function item(key, v) { return { key: key, model: v.model || '', grp: v.g || '', value_key: v.k }; }
  function waitTagItems(text, items, holder) {
    holder.classList.add('wait');
    holder.appendChild(el('b', { 'class': 'po-wait-tag', text: 'to approve' }));
    if (!tree.can_approve) return;
    holder.appendChild(xbtn('Approve', function (e) { busy(e.currentTarget, approveMany(items, true), 'Approved: "' + text + '" is now an option of the factory.'); }));
    holder.appendChild(xbtn('Reject', function (e) { busy(e.currentTarget, approveMany(items, false), 'Rejected: "' + text + '" removed.'); }, true));
  }
  /* the route takes 500 values a call */
  function approveMany(items, approve) {
    var chain = Promise.resolve();
    for (var i = 0; i < items.length; i += 500) (function (part) {
      chain = chain.then(function () { return Api.poAdminApprove(window.Hub.token(), { factoryId: tree.factory.id, items: part, approve: approve }); });
    })(items.slice(i, i + 500));
    return chain;
  }
  /* Approve all / Reject all for the values of one row that wait (approvers; owner, 21 Oct 2026) */
  function rowWaitButtons(items, name) {
    if (!tree.can_approve || !items.length) return [];
    var n = items.length;
    return [
      xbtn('Approve all ' + n, function (e) { busy(e.currentTarget, approveMany(items, true), n + (n === 1 ? ' value' : ' values') + ' of ' + name + ' approved.'); }),
      xbtn('Reject all', function (e) {
        var b = e.currentTarget;
        window.Hub.confirm('Remove the ' + n + (n === 1 ? ' value' : ' values') + ' of ' + name + ' that wait? A value seen again on a later datasheet waits again.', { title: 'Reject all', ok: 'Reject all', danger: true }).then(function (yes) {
          if (yes) busy(b, approveMany(items, false), n + (n === 1 ? ' value' : ' values') + ' of ' + name + ' rejected.');
        });
      }, true)
    ];
  }
  /* take out / bring back several values (one value shown once for two spellings of a location, say) */
  function hideMany(list, hidden) {
    var chain = Promise.resolve();
    list.forEach(function (x) {
      if (!!x.v.hidden === hidden) return;
      chain = chain.then(function () { return Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: x.key, valueKey: x.v.k, model: x.v.model || '', grp: x.v.g || '', hidden: hidden }); });
    });
    return chain;
  }

  /* ---------- rows ticked for "Leave out rows" (editors) ---------- */
  function tickBox(keys, name, node, series) {
    var on = keys.every(function (k) { return picked[k] && (!series || (pickedSeries[k] || {})[series]); });
    var box = el('input', { type: 'checkbox', 'class': 'po-tick', 'aria-label': 'Tick ' + name });
    box.checked = on;
    if (on && node) node.classList.add('picked');
    box.addEventListener('change', function () {
      keys.forEach(function (k) {
        var ps = pickedSeries[k] || (pickedSeries[k] = {});
        if (box.checked) { picked[k] = name; if (series) ps[series] = 1; }
        else { if (series) delete ps[series]; if (!series || !Object.keys(ps).length) delete picked[k]; }
      });
      if (node) node.classList.toggle('picked', box.checked);
      pickBar();
    });
    return box;
  }
  function offOf(key) { var r = tree.rows.filter(function (x) { return x.key === key; })[0]; return !!(r && r.hidden); }
  function pickBar() {
    var bar = $('po-pickbar'), keys = Object.keys(picked);
    bar.textContent = '';
    bar.hidden = !editing() || !keys.length;
    if (bar.hidden) return;
    var out = keys.filter(function (k) { return !offOf(k); }), back = keys.filter(offOf), all = tree.factory.product;
    bar.appendChild(el('strong', { text: keys.length + (keys.length === 1 ? ' row ticked' : ' rows ticked') }));
    function act(list, hidden, label, done) {
      return el('button', { type: 'button', 'class': 'btn sm' + (hidden ? '' : ' ghost'), text: label, onclick: function (e) {
        var b = e.currentTarget, names = list.map(function (k) { return picked[k]; });
        window.Hub.confirm((hidden ? 'Leave out ' : 'Bring back ') + list.length + (list.length === 1 ? ' row' : ' rows') + ' for every ' + all + ' factory? ' +
          names.slice(0, 12).join(', ') + (names.length > 12 ? ' and ' + (names.length - 12) + ' more' : ''), { title: label, ok: label, danger: hidden }).then(function (yes) {
          if (!yes) return;
          b.disabled = true;
          Api.poAdminSetRowsHidden(window.Hub.token(), { factoryId: tree.factory.id, keys: list, hidden: hidden }).then(function () {
            picked = {}; window.Hub.toast(done); return load(true);
          }, function (err) { b.disabled = false; window.Hub.toast((err && err.message) || String(err), true); });
        });
      } });
    }
    if (out.length) bar.appendChild(act(out, true, 'Leave out ' + out.length + (out.length === 1 ? ' row' : ' rows'), out.length + (out.length === 1 ? ' row' : ' rows') + ' left out for every ' + all + ' factory.'));
    if (back.length) bar.appendChild(act(back, false, 'Bring back ' + back.length + (back.length === 1 ? ' row' : ' rows'), 'Rows are back in the tree.'));
    [['general', 'Move to general'], ['model', 'Move to columns']].forEach(function (m) {
      bar.appendChild(el('button', { type: 'button', 'class': 'btn ghost sm', text: m[1], onclick: function (e) {
        var b = e.currentTarget; b.disabled = true;
        // FCU: each ticked row moves in the series it was ticked in (owner, 22 Oct 2026)
        var groups = {};
        if (modelMode()) keys.forEach(function (k) { Object.keys(pickedSeries[k] || {}).forEach(function (sr) { (groups[sr] = groups[sr] || []).push(k); }); });
        else groups[''] = keys;
        var chain = Promise.resolve();
        Object.keys(groups).forEach(function (sr) {
          chain = chain.then(function () { return Api.poAdminSetPlace(window.Hub.token(), { factoryId: tree.factory.id, keys: groups[sr], place: m[0], series: sr }); });
        });
        chain.then(function () {
          picked = {}; pickedSeries = {}; window.Hub.toast(keys.length + (keys.length === 1 ? ' row moved.' : ' rows moved.')); return load(true);
        }, function (err) { b.disabled = false; window.Hub.toast((err && err.message) || String(err), true); });
      } }));
    });
    [['duty', 'Move to duty figures'], ['option', 'Move to options']].forEach(function (m) {
      bar.appendChild(el('button', { type: 'button', 'class': 'btn ghost sm', text: m[1], onclick: function (e) {
        var b = e.currentTarget; b.disabled = true;
        Api.poAdminSetKind(window.Hub.token(), { factoryId: tree.factory.id, keys: keys, kind: m[0] }).then(function () {
          picked = {}; window.Hub.toast(keys.length + (keys.length === 1 ? ' row moved.' : ' rows moved.')); return load(true);
        }, function (err) { b.disabled = false; window.Hub.toast((err && err.message) || String(err), true); });
      } }));
    });
    bar.appendChild(el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Clear', onclick: function () { picked = {}; render(); } }));
  }
  function waitBar() {
    var bar = $('po-wait'), n = tree.waiting || 0;
    bar.hidden = !n; bar.textContent = '';
    if (!n) return;
    bar.appendChild(el('p', { text: n + (n === 1 ? ' value' : ' values') + ' read from datasheets ' + (n === 1 ? 'waits' : 'wait') + ' for approval (marked "to approve"). ' +
      (tree.can_approve ? 'Until you approve them, users and the AI do not see them; check them against the datasheet first, then approve or reject them value by value or row by row.' : 'An admin of this tile approves them; until then users and the AI do not see them.') }));
    var only = el('input', { type: 'checkbox' }); only.checked = onlyWait;
    only.addEventListener('change', function () { onlyWait = only.checked; render(); });
    // approved or rejected row by row (Approve all / Reject all on each row), never the whole factory at once (owner, 21 Oct 2026)
    bar.appendChild(el('div', { 'class': 'row' }, [el('label', { 'class': 'check' }, [only, document.createTextNode(' Only values to approve')])]));
  }

  /* one form at a time: add or change a special option / note */
  function openForm(anchor, d) {
    var old = host.querySelector('.po-form'); if (old) old.remove();
    var isNote = d.kind === 'note' || d.kind === 'ai', what = KIND[d.kind];
    var box = isNote ? el('textarea', { 'class': 'input', maxlength: 1000, 'aria-label': 'Note' })
                     : el('input', { 'class': 'input', type: 'text', maxlength: 1000, 'aria-label': 'Special option' });
    box.value = d.body || '';
    var msg = el('p', { 'class': 'hint', role: 'alert' });
    var save = el('button', { type: 'button', 'class': 'btn sm', text: d.id ? 'Save' : 'Add ' + what });
    var form = el('div', { 'class': 'po-form' }, [
      el('strong', { 'class': 'small', text: (d.id ? 'Change ' : 'New ') + what + ' for ' + d.where }),
      d.kind === 'ai' ? el('p', { 'class': 'hint', text: 'A fact for the AI about this factory\'s product (what is standard, what is offered). Only admins see AI notes; the AI reads them with the datasheet and the options.' }) : null,
      d.kind === 'make' ? el('p', { 'class': 'hint', text: 'A manufacturer the factory buys this component from, e.g. ebm-papst. Add one make at a time. For internal use: everyone on the site sees it, the AI never puts it in a compliance answer.' }) : null,
      box, msg,
      el('div', { 'class': 'row' }, [save, el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Cancel', onclick: function () { form.remove(); } })])
    ]);
    function submit() {
      var body = box.value.trim();
      if (!body) { msg.textContent = 'Type the text first.'; box.focus(); return; }
      msg.textContent = '';
      busy(save, Api.poAdminSaveExtra(window.Hub.token(), { factoryId: tree.factory.id, id: d.id, section: d.section, key: d.key, kind: d.kind, body: body }),
           d.id ? 'Saved.' : what.charAt(0).toUpperCase() + what.slice(1) + ' added.');
    }
    save.addEventListener('click', submit);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') form.remove();
      if (e.key === 'Enter' && (!isNote || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
    anchor.appendChild(form); box.focus();
  }

  var KIND = { option: 'special option', note: 'note', ai: 'AI note', make: 'make' };
  /* the buttons that add a special option, a note and (admins) an AI note */
  function addButtons(anchor, section, key, where, forSection) {
    var tail = forSection ? ' for the section' : '';
    return ['option', 'note', 'ai'].filter(function (k) { return k !== 'ai' || tree.can_approve; }).map(function (k) {
      return xbtn('+ ' + (k === 'option' ? 'Special option' : k === 'note' ? 'Note' : 'AI note') + tail, function () { openForm(anchor(), { kind: k, section: section, key: key, where: where }); });
    });
  }
  function extraNodes(list, ctx, edit) {
    var out = [];
    function tools(x, node) {
      if (!edit || (x.kind === 'ai' && !tree.can_approve)) return;
      node.appendChild(xbtn('Change', function () { openForm(ctx.anchor(), { id: x.id, kind: x.kind, body: x.body, section: x.section, key: x.key, where: ctx.where }); }));
      node.appendChild(xbtn('Delete', function (e) {
        var btn = e.currentTarget;
        window.Hub.confirm(x.body, { title: 'Delete this ' + KIND[x.kind] + '?', ok: 'Delete', danger: true }).then(function (yes) {
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
    // AI notes: only admins get them from the server; shown in read and edit mode (owner, 20 Oct 2026)
    list.filter(function (x) { return x.kind === 'ai'; }).forEach(function (x) {
      var n = el('p', { 'class': 'po-note ai', title: 'Seen by admins and the AI only' }, [el('b', { text: 'AI note ' }), el('span', { text: x.body }), el('span', { 'class': 'by', text: '  ' + [x.by, when(x.at)].filter(Boolean).join(', ') + ' ' })]);
      tools(x, n); out.push(n);
    });
    return out;
  }

  function leaveOut(keys, off) {
    return xbtn(off ? 'Bring row back' : 'Leave out row', function (e) {
      busy(e.currentTarget, Api.poAdminSetRowsHidden(window.Hub.token(), { factoryId: tree.factory.id, keys: keys, hidden: !off }),
           off ? 'Row is back in the tree.' : 'Row left out for every ' + tree.factory.product + ' factory.');
    }, !off);
  }

  /* ---------- AHU: one card per kind of component (owner, 21 Oct 2026; docs/Product-Options-Redesign.md) ----------
     The sections of the datasheet are gathered into cards (DSParse.PO_CARDS): supply and return together, the DX and
     chilled-water coils side by side, the casing with its EN 1886 / EN 13053 classes. In a card:
       Common to every unit seen   the options that are the same in every column (or belong to the whole section)
       Accessories offered         the Options List lines of the card's sections
       one column per model        filter class, fan model (EC / DIDW), model box, wheel, humidifier, coil type:
                                   the options that differ between them, then the duty figures seen with each
       Duty seen                   figures of one selection (flow, pressure, size ...) as "from - to", never approved
     The server says what each row is (row.kind: option / duty / accessory, lib/po-kind.ts, Row mapping can change it);
     which column a value belongs to is its group, saved when the datasheet was read (DSParse.poGroups). */
  var P = window.DSParse || null;
  var UNIT = { casing: ['model box', 'model boxes'], filters: ['filter class', 'filter classes'], fans: ['fan model', 'fan models'],
               recovery: ['heat wheel', 'heat wheels'], humidifiers: ['humidifier', 'humidifiers'], coils: ['coil type', 'coil types'] };
  function cardOf(section) {
    return P && P.poCard ? P.poCard(section) : { id: 'x:' + low(section), name: section || 'General' };
  }
  /* the words for a card's columns: "model box" / "model boxes", "model" / "models" (FCU) */
  function unitOf(c) { return c.C.unit || UNIT[c.id]; }
  /* FCU: the card of a row, from the reader (ds-fcu.js); null for an AHU or a row no FCU card names */
  function rowCard(key, section) { var r = reader(); return r && r.poCardOf ? r.poCardOf(key, section) : null; }
  /* the series of a model as the database gives it (FWW1400VA -> FWWVA) */
  function seriesOf(model) {
    var m = (tree.models || []).filter(function (x) { return x.model === model; })[0];
    return m ? m.series : String(model || '').replace(/\d+/g, '');
  }
  function tidy(t) { return low(t).replace(/\s+/g, ' ').trim(); }
  function side(section) { var m = /\s(supply|return|exhaust|extract)$/i.exec(section || ''); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* the column of a value in card C: { key, label, head, family } or null (no column: belongs to the whole card) */
  function columnOf(C, row, v) {
    if (C.byModel) return v.model ? { key: tidy(v.model), label: 'Model', head: v.model, family: 'Series ' + seriesOf(v.model) } : null;
    if (C.bySection) {
      // three coil types (owner, 21 Oct 2026): a "Cooling • Heating Water" coil is a cooling water coil
      var nm = String(row.section || '').replace(/\s+(supply|return)$/i, '').replace(/^coil\s+/i, '');
      nm = /\bdx\b/i.test(nm) ? 'Cooling DX' : /cool/i.test(nm) ? 'Cooling Water' : /heat/i.test(nm) ? 'Heating Water' : nm;
      return { key: tidy(nm), label: 'Coil', head: nm, family: '' };
    }
    if (!C.column || !v.g || !P) return null;
    var g = P.poGroupParts(v.g);
    if (!g || !(C.label ? tidy(g.label) === tidy(C.label) : C.column.test(g.label))) return null;
    return { key: tidy(g.family + '|' + g.value), label: g.label, head: g.value, family: g.family };
  }

  /* tree rows -> cards */
  function buildCards(edit) {
    var list = [], by = {}, rowBy = {};
    function card(section, key) {
      // the power supply leads; the notes of the whole product (section General) close the page
      var C = rowCard(key, section) || (/^power supply$/i.test(section || '') ? { id: 'power', name: 'Power supply' }
            : /^general$/i.test(section || '') || !section ? { id: 'general', name: 'General' } : cardOf(section));
      var c = by[C.id];
      if (!c) { c = by[C.id] = { C: C, id: C.id, name: C.name, sections: [], lines: [], lineBy: {}, extras: [] }; list.push(c); }
      if (section && c.sections.indexOf(section) < 0) c.sections.push(section);
      return c;
    }
    tree.rows.forEach(function (r) {
      var section = /^general\|\|power supply$/.test(r.key) ? 'Power Supply' : (r.section || 'General');
      if (!edit && r.hidden) return;
      var c = card(section, r.key), kind = r.kind || 'option';
      var name = /\|options\|option$/.test(r.key) ? 'Accessories' : r.component;
      // "Filter 1", "Damper One Supply": the column or the values say it; FCU coil: "Cooling" / "Heating" (same row names)
      var sub = c.C.sub ? c.C.sub(r.section) : kind === 'accessory' || /\s\d+$|^geometry$|^damper\b/i.test(r.sub || '') ? '' : r.sub || '';
      var lk = kind + '|' + tidy(sub) + '|' + tidy(name), ln = c.lineBy[lk];
      if (!ln) { ln = c.lineBy[lk] = { name: name, sub: sub, kind: kind, keys: [], rows: [], off: true, extras: [], sections: [] }; c.lines.push(ln); }
      ln.keys.push(r.key); ln.rows.push(r); if (!r.hidden) ln.off = false;
      if (r.place && !ln.place) ln.place = r.place;          // moved by an editor: general / per model
      if (ln.sections.indexOf(section) < 0) ln.sections.push(section);
      rowBy[r.key] = ln;
    });
    tree.extras.forEach(function (x) {
      if (x.key && rowBy[x.key]) rowBy[x.key].extras.push(x);
      else if (SERIES_NOTE.test(x.section || '')) return;       // FCU: a note of one series, shown in that series
      else card(x.section || 'General', x.key).extras.push(x);
    });
    card('General');                                          // the product's own notes, always at the end
    // power first, General last; FCU cards in their own order (Unit, Fan and motor, Coil ...), the rest as read
    function rank(c) { return c.id === 'power' ? -1 : c.id === 'general' ? 1e6 : c.C.order !== undefined ? c.C.order : 1e3; }
    list = list.map(function (c, i) { return { c: c, i: i }; })
      .sort(function (a, b) { return (rank(a.c) - rank(b.c)) || (a.i - b.i); }).map(function (x) { return x.c; });
    list.forEach(function (c) { shapeCard(c, edit); });
    return list;
  }

  /* values -> columns, cells, common / model-specific / duty / accessories */
  function shapeCard(c, edit) {
    var C = c.C, cols = [], colBy = {}, sides = {};
    /* where a row shows: the editor's move (dn_map.place), else the card's rule: heat recovery and humidifiers in General,
       the casing's model box rows per model box and the rest in General, the other cards decided by the values ('auto') */
    function placeOf(ln) {
      if (ln.place) return ln.place;
      if (C.general) return 'general';
      if (C.members) return C.members.test(ln.keys[0]) ? 'model' : 'general';
      return 'auto';
    }
    c.lines.forEach(function (ln) {
      ln.cells = {}; ln.loose = []; ln.pl = placeOf(ln);
      ln.rows.forEach(function (r) {
        r.values.forEach(function (v) {
          if (!edit && v.hidden) return;
          if (onlyWait && ln.kind !== 'duty' && !v.wait) return;
          // FCU values always keep their model: General is decided per series (fcuSeries)
          var col = ln.kind === 'accessory' || (ln.pl === 'general' && !C.byModel) ? null : columnOf(C, r, v);
          var x = { key: r.key, v: v, section: r.section };
          if (!col) { ln.loose.push(x); return; }
          var cc = colBy[col.key];
          if (!cc) { cc = colBy[col.key] = { key: col.key, label: col.label, head: col.head, family: col.family, spell: {}, n: 0, sides: {} }; cols.push(cc); }
          cc.spell[col.head] = (cc.spell[col.head] || 0) + (v.n || 0) + 0.001;
          if (ln.kind !== 'duty') cc.n = Math.max(cc.n, v.n || 0);
          if (side(r.section)) { cc.sides[side(r.section)] = 1; sides[side(r.section)] = 1; }
          (ln.cells[col.key] || (ln.cells[col.key] = [])).push(x);
        });
      });
    });
    cols.forEach(function (cc) { cc.head = Object.keys(cc.spell).sort(function (a, b) { return cc.spell[b] - cc.spell[a]; })[0]; });
    cols.forEach(function (cc) { cc.grade = C.id === 'filters' ? filterGrade(cc.head) : null; });
    cols.sort(function (a, b) {
      return a.family.localeCompare(b.family) || (a.grade && b.grade ? a.grade.rank - b.grade.rank : 0) ||
        a.head.localeCompare(b.head, undefined, { sensitivity: 'base', numeric: true });
    });
    c.cols = cols; c.sides = Object.keys(sides);
    c.common = []; c.model = []; c.duty = []; c.access = []; c.heads = []; c.drop = [];
    var dropped = {};
    function drop(x) { var k = x.key + '\u0001' + (x.v.g || ''); if (!dropped[k]) { dropped[k] = 1; c.drop.push({ key: x.key, grp: x.v.g || '' }); } }
    c.lines.forEach(function (ln) {
      if (!lineAll(ln).length && !ln.extras.length && !(edit && !onlyWait)) return;
      var inCols = cols.filter(function (cc) { return (ln.cells[cc.key] || []).length; });
      if (ln.kind === 'accessory') { c.access.push(ln); return; }
      if (cols.length && !C.bySection && C.column && C.column.test(ln.rows[0].key.split('|')[2] || '') && !ln.loose.length && !ln.extras.length) { c.heads.push(ln); return; }   // the column heading says it
      if (ln.kind === 'duty') { if (inCols.length || ln.loose.length || edit) c.duty.push(ln); ln.bucket = inCols.length ? 'model' : 'general'; return; }
      // an option: per model when moved there (or by the card's rule), in General when moved there, else common when
      // it is the same in every column (or has no column at all) and model-specific when it differs
      var sig = function (list) { return list.filter(function (x) { return !x.v.hidden; }).map(function (x) { return tidy(x.v.k); }).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort().join('\u0001'); };
      var same = ln.pl === 'general' || inCols.length === 0 || (ln.pl !== 'model' && cols.length > 1 && inCols.length === cols.length &&
        inCols.every(function (cc) { return sig(ln.cells[cc.key]) === sig(ln.cells[inCols[0].key]); }) &&
        (!ln.loose.length || sig(ln.loose) === sig(ln.cells[inCols[0].key])));
      if (same) { c.common.push(ln); ln.bucket = 'general'; }
      else {
        c.model.push(ln); ln.bucket = 'model';
        // values read before the columns existed (no group, or another kind of group): admins can remove them
        ln.loose.forEach(drop);
      }
    });
    c.stale = c.drop.length;
  }

  /* Filters are grouped by their grade (owner, 21 Oct 2026): the EN 779 / EN 1822 grade printed in brackets,
     "ePM1 65%(F7)" -> F7, or the class itself, "E10". Groups run coarse to fine: G, M, F, E, H, U. */
  var GRADE_ORDER = 'GMFEHU';
  function filterGrade(head) {
    var m = /\(\s*([GMFEHU])\s*(\d{1,2})\s*\)\s*$/i.exec(head || '') || /^\s*([GMFEHU])\s*(\d{1,2})\s*$/i.exec(head || '');
    if (!m) return { name: 'Other', rank: 9999 };
    var L = m[1].toUpperCase();
    return { name: L + Number(m[2]), rank: GRADE_ORDER.indexOf(L) * 100 + Number(m[2]) };
  }

  /* chips of one cell: the same value under two spellings or two rows (supply / return) is one chip */
  function chipsOf(list) {
    var out = [], by = {};
    list.forEach(function (x) {
      var k = tidy(x.v.k), ch = by[k];
      if (!ch) { ch = by[k] = { text: x.v.v, n: 0, list: [] }; out.push(ch); }
      ch.n += x.v.n || 0; ch.list.push(x);
    });
    return out;
  }
  function chipNode(ch, edit) {
    var hidden = ch.list.every(function (x) { return x.v.hidden; }), wait = ch.list.filter(function (x) { return x.v.wait; });
    var c = el('span', { 'class': 'po-chip' + (hidden ? ' off' : '') }, [el('span', { text: ch.text }),
      el('small', { text: times(ch.n), title: 'Seen ' + ch.n + (ch.n === 1 ? ' time' : ' times') + ' on the datasheets run so far. A datasheet run again is counted again.' })]);
    if (wait.length) waitTagItems(ch.text, wait.map(function (x) { return item(x.key, x.v); }), c);
    else {
      // a value of a left-out row nobody approved yet: kept for reference, not counted, approved once the row is back
      if (ch.list.some(function (x) { return x.v.held; })) c.appendChild(el('b', { 'class': 'po-held-tag', text: 'not approved',
        title: 'Kept for reference while the row is left out. It waits for approval again when the row is brought back.' }));
    }
    if (!wait.length && edit) c.appendChild(xbtn(hidden ? 'Bring back' : 'Take out', function (e) {
      busy(e.currentTarget, hideMany(ch.list, !hidden), hidden ? 'Value is back in the tree.' : 'Value taken out.');
    }));
    return c;
  }
  /* duty figures: "1.34 to 2.62 m/s", or the values themselves when they are not numbers of one unit */
  function dutyText(list) {
    var vals = list.filter(function (x) { return !x.v.hidden; }).map(function (x) { return x.v; });
    var uniq = []; vals.forEach(function (v) { if (uniq.indexOf(v.v) < 0) uniq.push(v.v); });
    if (!uniq.length) return '';
    if (uniq.length === 1) return uniq[0];
    var rg = range(uniq.map(function (t) { return { v: t }; }));
    if (rg) return rg;
    return uniq.length <= 4 ? uniq.join(' · ') : uniq.slice(0, 4).join(' · ') + ' and ' + (uniq.length - 4) + ' more';
  }
  function waitItems(list) { return list.filter(function (x) { return x.v.wait; }).map(function (x) { return item(x.key, x.v); }); }
  function lineAll(ln) { var out = ln.loose.slice(); Object.keys(ln.cells).forEach(function (k) { out = out.concat(ln.cells[k]); }); return out; }
  function lineName(ln) { return (ln.sub ? ln.sub + ' · ' : '') + ln.name + (ln.off ? ' (left out)' : ''); }
  /* tools of one line: tick, Approve all / Reject all, special option / note, leave out */
  function lineTools(c, ln, edit, anchor) {
    var waits = rowWaitButtons(waitItems(lineAll(ln)), ln.name);
    var where = c.name + ' > ' + ln.name;
    var add = edit ? addButtons(anchor, ln.noteSection || ln.rows[0].section || c.sections[0], ln.keys[0], where) : [];
    // Leave out row sits with Approve all / Reject all for whoever may edit, Edit on or not (owner, 22 Oct 2026)
    var out = edit || (waits.length && tree.can_edit) ? [leaveOut(ln.keys, ln.off)] : [];
    return (edit || waits.length) ? el('div', { 'class': 'po-tools' }, add.concat(waits, edit ? moveButtons(c, ln) : [], edit ? kindButtons(ln) : [], out)) : null;
  }
  /* option <-> duty figure from the page, as the Row mapping's "In Product Options" (owner, 22 Oct 2026): a duty figure
     is shown with the duty figures as from - to and never waits for approval; for every factory of the product */
  function kindButtons(ln) {
    if (ln.kind !== 'option' && ln.kind !== 'duty') return [];
    function go(kind, label, done) {
      return xbtn(label, function (e) { busy(e.currentTarget, Api.poAdminSetKind(window.Hub.token(), { factoryId: tree.factory.id, keys: ln.keys, kind: kind }), done); });
    }
    var out = [ln.kind === 'option' ? go('duty', 'Move to duty figures', ln.name + ' is a duty figure now.')
                                    : go('option', 'Move to options', ln.name + ' is an option now.')];
    if (ln.rows.some(function (r) { return r.kind_set; })) out.push(go('', 'Automatic kind', ln.name + ' is decided by its name again.'));
    return out;
  }
  /* move a row between General and the columns (owner, 21 Oct 2026): for every factory of the product (dn_map.place) */
  function canMove(c) { return !!(c.C.column || c.C.bySection || c.C.byModel); }
  function placeBtn(keys, place, label, done, series) {
    return xbtn(label, function (e) { busy(e.currentTarget, Api.poAdminSetPlace(window.Hub.token(), { factoryId: tree.factory.id, keys: keys, place: place, series: series || '' }), done); });
  }
  function moveButtons(c, ln) {
    if (!canMove(c) || ln.kind === 'accessory') return [];
    if (c.C.byModel) {      // FCU: a move is for the series the row is shown in (owner, 22 Oct 2026)
      if (ln.kind === 'duty' || !ln.series) return [];
      var S = ln.series, fcu = [], rowGeneral = ln.rows.some(function (r) { return r.place === 'general'; });
      // columns are where every row starts: back to them is "no move" unless the Row mapping puts the row in General
      if (ln.bucket === 'model') fcu.push(placeBtn(ln.keys, 'general', 'Move to general', ln.name + ' is in the General of series ' + S + ' now.', S));
      else fcu.push(placeBtn(ln.keys, rowGeneral ? 'model' : '', 'Move to columns', ln.name + ' is shown per model in series ' + S + ' now.', S));
      return fcu;
    }
    var out = [ln.bucket === 'model' ? placeBtn(ln.keys, 'general', 'Move to general', ln.name + ' is in General now.')
                                    : placeBtn(ln.keys, 'model', 'Move to columns', ln.name + ' is shown per ' + ((unitOf(c) || ['model'])[0]) + ' now.')];
    if (ln.place) out.push(placeBtn(ln.keys, '', 'Automatic place', ln.name + ' is back in its usual place.'));
    return out;
  }
  function lineExtras(c, ln, edit, anchor) { return extraNodes(ln.extras, { where: c.name + ' > ' + ln.name, anchor: anchor }, edit); }

  function words(q) { return q ? q.split(/\s+/) : []; }
  function hits(q, text) { var t = low(text); return words(q).every(function (w) { return t.indexOf(w) >= 0; }); }

  /* one card on screen; null when the search leaves nothing */
  function cardNode(c, q, edit) {
    var cols = c.cols, lines = { common: c.common, model: c.model, duty: c.duty, access: c.access };
    var extras = c.extras;
    if (q && !hits(q, c.name + ' ' + c.sections.join(' '))) {
      var colHit = cols.filter(function (cc) { return hits(q, cc.head + ' ' + cc.label + ' ' + cc.family); });
      var lineHit = function (ln) { return hits(q, lineName(ln) + ' ' + lineAll(ln).map(function (x) { return x.v.v; }).join(' ') + ' ' + ln.extras.map(function (x) { return x.body; }).join(' ')); };
      if (colHit.length) cols = colHit;
      else lines = { common: c.common.filter(lineHit), model: c.model.filter(lineHit), duty: c.duty.filter(lineHit), access: c.access.filter(lineHit) };
      extras = extras.filter(function (x) { return hits(q, x.body); });
      if (!colHit.length && !lines.common.length && !lines.model.length && !lines.duty.length && !lines.access.length && !extras.length) return null;
    }
    var body = el('div', { 'class': 'po-body' }), ck = 'card:' + c.id;
    var waiting = c.lines.reduce(function (n, ln) { return n + (ln.kind === 'duty' ? 0 : waitItems(lineAll(ln)).length); }, 0);
    var u = unitOf(c);
    var d = el('details', { 'class': 'po-sec po-card', id: 'po-card-' + c.id.replace(/[^a-z0-9]+/gi, '-'), open: q ? true : !closed[ck] }, [
      el('summary', {}, [el('span', { text: c.name }), el('span', { 'class': 'count', text: [
        cols.length && u ? plural(cols.length, u[0], u[1]) : '',
        c.sides.length > 1 ? c.sides.join(' and ') : '',
        waiting ? waiting + ' to approve' : ''].filter(Boolean).join(' · ') })]),
      body]);
    d.addEventListener('toggle', function () { if (!q) closed[ck] = !d.open; });

    // special options and notes of the whole card; editors add to its first section
    var sx = el('div', { 'class': 'po-secx' }, extraNodes(extras, { where: c.name, anchor: function () { return sx; } }, edit));
    if (edit) {
      var keys = [].concat.apply([], c.lines.map(function (ln) { return ln.keys; })), all = keys.length && keys.every(function (k) { return picked[k]; });
      sx.appendChild(el('div', { 'class': 'po-tools' }, addButtons(function () { return sx; }, c.sections[0] || c.name, '', c.name, true).concat(keys.length ? [
        xbtn(all ? 'Untick all rows' : 'Tick all rows', function () {
          c.lines.forEach(function (ln) { ln.keys.forEach(function (k) { if (all) delete picked[k]; else picked[k] = ln.name; }); });
          render();
        })] : [])));
    }
    if (sx.childNodes.length) body.appendChild(sx);

    if (c.stale && tree.can_approve && !q) body.appendChild(staleNotice(c));

    // General: the makes, then the options common to every column (or with no column)
    // fans keep a make per family (EC Fans, DIDW Fans: row key "family:EC Fans", owner 21 Oct 2026); a make for the
    // whole card stays in General
    var perFamily = c.id === 'fans' && cols.some(function (cc) { return cc.family; });
    var makes = c.extras.filter(function (x) { return x.kind === 'make' && !/^family:/.test(x.key || ''); });
    var makeRow = makeCard(c) && !q && (makes.length || (edit && tree.can_approve && !perFamily)) ? makeLine(c, makes, edit) : null;
    if (lines.common.length || makeRow) {
      body.appendChild(el('p', { 'class': 'po-part', text: canMove(c) && cols.length > 1 && !c.C.members ? 'Common to every ' + (u ? u[0] : 'column') : 'General' }));
      var grid = el('div', { 'class': 'po-grid' });
      if (makeRow) grid.appendChild(makeRow);
      lines.common.forEach(function (ln) {
        var vals = el('div', { 'class': 'po-vals' }), row = el('div', { 'class': 'po-line' + (ln.off ? ' off' : '') });
        chipsOf(lineAll(ln)).forEach(function (ch) { vals.appendChild(chipNode(ch, edit)); });
        lineExtras(c, ln, edit, function () { return row; }).forEach(function (n) { vals.appendChild(n); });
        row.appendChild(el('div', { 'class': 'po-name' }, [edit ? tickBox(ln.keys, ln.name, row) : null, document.createTextNode(lineName(ln))]));
        row.appendChild(vals);
        var t = lineTools(c, ln, edit, function () { return row; }); if (t) row.appendChild(t);
        grid.appendChild(row);
      });
      body.appendChild(grid);
    }
    // accessories offered (the Options List lines)
    if (lines.access.length) {
      body.appendChild(el('p', { 'class': 'po-part', text: 'Accessories offered' }));
      var acc = []; lines.access.forEach(function (ln) { acc = acc.concat(lineAll(ln)); });
      var av = el('div', { 'class': 'po-vals po-acc' });
      chipsOf(acc).forEach(function (ch) { av.appendChild(chipNode(ch, edit)); });
      var aln = { name: 'Accessories', sub: '', keys: [].concat.apply([], lines.access.map(function (l) { return l.keys; })), off: lines.access.every(function (l) { return l.off; }),
                  rows: lines.access[0].rows, extras: [].concat.apply([], lines.access.map(function (l) { return l.extras; })), loose: acc, cells: {} };
      lineExtras(c, aln, edit, function () { return av; }).forEach(function (n) { av.appendChild(n); });
      body.appendChild(av);
      var at = lineTools(c, aln, edit, function () { return av; }); if (at) body.appendChild(at);
    }
    // one table per family (EC Fans, DIDW Fans) or one for the card: a column per model
    var families = []; cols.forEach(function (cc) { if (families.indexOf(cc.family) < 0) families.push(cc.family); });
    // duty figures are folded away until asked for (a search shows them): the options stay readable
    var showDuty = !!expanded['duty:' + c.id] || !!q;
    var dutyCols = showDuty ? lines.duty.filter(function (ln) { return cols.some(function (cc) { return (ln.cells[cc.key] || []).length; }); }) : [];
    if (cols.length) families.forEach(function (fam) {
      var fc = cols.filter(function (cc) { return cc.family === fam; });
      var table = modelTable(c, fc, lines.model, dutyCols, edit);
      if (!fam) { body.appendChild(table); return; }
      // EC Fans and DIDW Fans fold on their own (owner, 21 Oct 2026)
      var fk = 'fam:' + c.id + ':' + low(fam);
      var fmakes = c.extras.filter(function (x) { return x.kind === 'make' && x.key === 'family:' + fam; });
      var fmake = !q && (fmakes.length || (edit && tree.can_approve)) ? el('div', { 'class': 'po-grid po-fam-make' }, [makeLine(c, fmakes, edit, fam)]) : null;
      var fd = el('details', { 'class': 'po-fam', open: q ? true : !closed[fk] }, [
        el('summary', {}, [el('span', { text: fam }), el('span', { 'class': 'count', text: plural(fc.length, (u || ['model'])[0], (u || ['', 'models'])[1]) })]), fmake, table]);
      fd.addEventListener('toggle', function () { if (!q) closed[fk] = !fd.open; });
      body.appendChild(fd);
    });
    if (lines.duty.length && !q) body.appendChild(el('button', { type: 'button', 'class': 'po-more po-duty-toggle', 'aria-expanded': showDuty ? 'true' : 'false',
      text: showDuty ? 'Hide duty figures' : 'Show duty figures (' + lines.duty.length + ')', title: 'Flows, pressures, sizes ... seen on the selections so far: not options and not limits.',
      onclick: function () { expanded['duty:' + c.id] = !showDuty; render(); } }));
    // duty seen for the whole card (and figures read before the columns existed)
    var dutyLoose = showDuty ? lines.duty.filter(function (ln) { return ln.loose.length || (edit && !lineAll(ln).length); }) : [];
    if (dutyLoose.length) {
      body.appendChild(el('p', { 'class': 'po-part', text: 'Duty seen', title: 'Figures of one selection: what was selected so far, not a limit of the factory.' }));
      var dg = el('div', { 'class': 'po-grid duty' });
      dutyLoose.forEach(function (ln) {
        var row = el('div', { 'class': 'po-line' + (ln.off ? ' off' : '') });
        row.appendChild(el('div', { 'class': 'po-name' }, [edit ? tickBox(ln.keys, ln.name, row) : null, document.createTextNode(lineName(ln))]));
        var dv = el('div', { 'class': 'po-vals' }, [el('span', { 'class': 'po-duty', text: dutyText(ln.loose) || '-' })]);
        lineExtras(c, ln, edit, function () { return row; }).forEach(function (n) { dv.appendChild(n); });
        row.appendChild(dv);
        if (edit) { var t = lineTools(c, ln, edit, function () { return row; }); if (t) row.appendChild(t); }
        dg.appendChild(row);
      });
      body.appendChild(dg);
    }
    if (!body.childNodes.length) {
      if (c.id === 'general' && !edit) return null;
      body.appendChild(el('p', { 'class': 'hint', text: c.id === 'general' ? 'Notes about the whole product go here.' : 'Nothing here yet.' }));
    }
    return d;
  }

  /* Make: the manufacturers the factory buys the component from (owner, 21 Oct 2026), kept by the admins */
  var NO_MAKE = { power: 1, general: 1, casing: 1, empty: 1 };
  function makeCard(c) { return c.C.byModel ? !!c.C.make : !NO_MAKE[c.id]; }
  function makeLine(c, makes, edit, family) {
    var row = el('div', { 'class': 'po-line' }), vals = el('div', { 'class': 'po-vals' });
    makes.forEach(function (x) {
      var chip = el('span', { 'class': 'po-chip make', title: 'Added by ' + (x.by || 'an admin') + (when(x.at) ? ', ' + when(x.at) : '') }, [el('span', { text: x.body })]);
      if (edit && tree.can_approve) {
        chip.appendChild(xbtn('Change', function () { openForm(row, { id: x.id, kind: 'make', body: x.body, section: x.section, key: x.key, where: family || c.name }); }));
        chip.appendChild(xbtn('Delete', function (e) {
          var b = e.currentTarget;
          window.Hub.confirm(x.body, { title: 'Delete this make?', ok: 'Delete', danger: true }).then(function (yes) { if (yes) busy(b, Api.poAdminDeleteExtra(window.Hub.token(), x.id), 'Deleted.'); });
        }, true));
      }
      vals.appendChild(chip);
    });
    if (!makes.length) vals.appendChild(el('span', { 'class': 'muted', text: 'None yet' }));
    row.appendChild(el('div', { 'class': 'po-name', text: 'Make', title: 'The manufacturers the factory buys ' + (family || 'this component') + ' from. For internal use: never named in a compliance answer.' }));
    row.appendChild(vals);
    if (edit && tree.can_approve) row.appendChild(el('div', { 'class': 'po-tools' }, [
      xbtn('+ Make', function () { openForm(row, { kind: 'make', section: c.sections[0] || c.name, key: family ? 'family:' + family : '', where: family || c.name }); })]));
    return row;
  }

  /* filters: one heading over the columns of each grade (F7 over ePM1 50%, 55% and 65%) */
  function gradeRow(cols) {
    if (!cols.length || !cols[0].grade) return [];
    var cells = [el('th', { 'class': 'grade-lead', 'aria-hidden': 'true' })], i = 0;
    while (i < cols.length) {
      var g = cols[i].grade.name, n = 0;
      while (i + n < cols.length && cols[i + n].grade.name === g) n++;
      cells.push(el('th', { 'class': 'grade', colspan: String(n), scope: 'colgroup', text: g }));
      i += n;
    }
    return [el('tr', { 'class': 'grades' }, cells)];
  }

  /* the columns of one card: the options that differ, then the duty figures seen with each column */
  function modelTable(c, cols, model, duty, edit) {
    var narrow = window.matchMedia('(max-width: 560px)').matches, first = narrow ? 140 : 210, w = cols.length > 6 ? 170 : 200;
    var head = el('tr', {}, [el('th', { text: c.cols.length && cols[0] ? cols[0].label : 'Component' })].concat(cols.map(function (cc) {
      // the column's own name (fan model, filter class ...) may wait for approval too
      var headWait = []; c.heads.forEach(function (ln) { headWait = headWait.concat(waitItems(ln.cells[cc.key] || [])); });
      var th = el('th', { 'class': 'unit' }, [el('div', { text: cc.head }), el('small', { text: cc.n ? times(cc.n) : '' }),
        headWait.length ? el('b', { 'class': 'po-wait-tag', text: ' to approve' }) : null]);
      if (tree.can_approve) {
        var w8 = headWait.slice(); model.forEach(function (ln) { w8 = w8.concat(waitItems(ln.cells[cc.key] || [])); });
        if (w8.length) th.appendChild(xbtn('Approve ' + w8.length, function (e) { busy(e.currentTarget, approveMany(w8, true), w8.length + (w8.length === 1 ? ' value' : ' values') + ' of ' + cc.head + ' approved.'); }));
      }
      return th;
    })));
    var body = el('tbody');
    function cellsRow(ln, dutyRow) {
      var tr = el('tr', { 'class': (ln.off ? 'off' : '') + (dutyRow ? ' duty' : '') || null });
      var name = el('td', { 'class': 'comp' }, [edit ? tickBox(ln.keys, ln.name, tr) : null, document.createTextNode(lineName(ln))]);
      lineExtras(c, ln, edit, function () { return name; }).forEach(function (n) { name.appendChild(n); });
      var t = dutyRow ? (edit ? el('div', { 'class': 'po-tools' }, kindButtons(ln).concat([leaveOut(ln.keys, ln.off)])) : null) : lineTools(c, ln, edit, function () { return name; });
      if (t) name.appendChild(t);
      tr.appendChild(name);
      cols.forEach(function (cc) {
        var list = ln.cells[cc.key] || [], td = el('td');
        if (!list.length) td.appendChild(el('span', { 'class': 'muted', text: '-' }));
        else if (dutyRow) td.appendChild(el('span', { 'class': 'po-duty', text: dutyText(list) }));
        else chipsOf(list).forEach(function (ch) { td.appendChild(chipNode(ch, edit)); });
        tr.appendChild(td);
      });
      return tr;
    }
    model.forEach(function (ln) { if (cols.some(function (cc) { return (ln.cells[cc.key] || []).length; }) || edit) body.appendChild(cellsRow(ln, false)); });
    if (c.sides.length > 1) {
      body.appendChild(el('tr', { 'class': 'used' }, [el('td', { 'class': 'comp', text: 'Used in' })].concat(cols.map(function (cc) {
        return el('td', { text: Object.keys(cc.sides).join(' · ') || '-' });
      }))));
    }
    var dl = duty.filter(function (ln) { return cols.some(function (cc) { return (ln.cells[cc.key] || []).length; }); });
    if (dl.length) {
      body.appendChild(el('tr', { 'class': 'sub' }, [el('td', { colspan: String(cols.length + 1), text: 'Duty seen with each ' + ((unitOf(c) || ['column'])[0]) + ': figures of the selections so far, not limits' })]));
      dl.forEach(function (ln) { body.appendChild(cellsRow(ln, true)); });
    }
    var table = el('table', { 'class': 'table po-matrix', style: 'width:' + (first + w * cols.length) + 'px' }, [
      el('colgroup', {}, [first].concat(cols.map(function () { return w; })).map(function (x) { return el('col', { style: 'width:' + x + 'px' }); })),
      el('thead', {}, gradeRow(cols).concat([head])), body]);
    return el('div', { 'class': 'po-cols' }, [el('div', { 'class': 'table-wrap po-matrix-wrap', tabindex: '0', role: 'region', 'aria-label': c.name + ', one column per ' + ((unitOf(c) || ['column'])[0]) }, [table])]);
  }

  /* values saved before the columns of this card existed (21 Oct 2026): read the datasheets again, then remove them */
  function staleNotice(c) {
    return el('div', { 'class': 'notice warn po-stale' }, [
      el('span', { text: plural(c.stale, 'old reading', 'old readings') + ' in ' + c.name + ': values read before this layout, kept next to the same rows read again. ' +
        'Read the datasheets again if you have not, then remove the old ones. ' }),
      el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Remove old readings', onclick: function (e) {
        var btn = e.currentTarget;
        window.Hub.confirm('Remove the old readings of ' + c.name + ' (' + tree.factory.name + ')? The values in their right place stay; a datasheet read again brings anything missing back.',
          { title: 'Remove old readings', ok: 'Remove', danger: true }).then(function (yes) {
          if (!yes) return;
          var chain = Promise.resolve();
          for (var i = 0; i < c.drop.length; i += 500) (function (part) {
            chain = chain.then(function () { return Api.poAdminClearUngrouped(window.Hub.token(), { factoryId: tree.factory.id, section: c.sections[0] || c.name, drop: part }); });
          })(c.drop.slice(i, i + 500));
          busy(btn, chain, 'Old readings removed.');
        });
      } })]);
  }

  /* the cards of a factory, in datasheet order */
  function drawCards(q, edit) {
    var wrap = el('div', { 'class': 'po-cards' }), cards = buildCards(edit), drawn = 0, nVals = 0, names = [];
    cards.forEach(function (c) {
      c.lines.forEach(function (ln) { if (ln.kind !== 'duty') nVals += lineAll(ln).filter(function (x) { return !x.v.hidden; }).length; });
      var n = cardNode(c, q, edit);
      if (!n) return;
      drawn++; names.push(c); wrap.appendChild(n);
    });
    return { wrap: wrap, drawn: drawn, values: nVals, cards: names };
  }
  /* jump to a card */
  function cardStrip(cards) {
    return el('nav', { 'class': 'po-strip', 'aria-label': 'Sections' }, cards.map(function (c) {
      var u = unitOf(c);
      return el('button', { type: 'button', 'class': 'po-jump', text: c.name + (c.cols.length && u ? ' · ' + c.cols.length : ''), onclick: function () {
        var d = $('po-card-' + c.id.replace(/[^a-z0-9]+/gi, '-'));
        if (!d) return;
        d.open = true; closed['card:' + c.id] = false;
        d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } });
    }));
  }

  /* ---------- FCU: one block per series (owner, 22 Oct 2026) ----------
       General            for every FCU: the product's own notes, special options, AI notes and makes
       Series FWWVA
         General          the rows an editor moved to its General (every row starts in the model columns)
         Models           one column per model: the options that differ, then the duty figures (folded)
     Series never mix: a series shows only its models' values, and "Move to general" / "Move to columns" act on that
     series only (po_series_place). A note typed inside a series is that series' (section "Series FWWVA"); notes of a
     row from before show wherever the row is. Inside a series the rows keep their parts (Unit, Fan and motor, Coil ...). */
  var SERIES_NOTE = /^Series (.+)$/;
  function seriesPlace(series, keys) {
    var hit = (tree.series_place || []).filter(function (x) { return x.series === series && keys.indexOf(x.key) >= 0; })[0];
    return hit ? hit.place : '';
  }
  function fcuSeries(edit) {
    var cards = buildCards(edit), main = [], list = [], by = {};
    function series(name) {
      if (!by[name]) { by[name] = { name: name, cols: [], colBy: {}, parts: [], notes: [] }; list.push(by[name]); }
      return by[name];
    }
    // the models of each series (a model's columns are the same in every part)
    cards.forEach(function (c) {
      if (!c.C.byModel) { main.push(c); return; }
      c.cols.forEach(function (cc) {
        var sr = series(cc.family.replace(/^Series /, '')), col = sr.colBy[cc.key];
        if (!col) { col = sr.colBy[cc.key] = { key: cc.key, label: cc.label, head: cc.head, family: cc.family, n: 0 }; sr.cols.push(col); }
        col.n = Math.max(col.n, cc.n || 0);
      });
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    list.forEach(function (sr) {
      sr.cols.sort(function (a, b) { return a.head.localeCompare(b.head, undefined, { sensitivity: 'base', numeric: true }); });
      cards.forEach(function (c) {
        if (!c.C.byModel) return;
        var part = { c: c, id: c.id, name: c.name, gen: [], model: [], duty: [] };
        c.lines.forEach(function (ln) {
          var cells = {}, any = false;
          sr.cols.forEach(function (cc) { var l = ln.cells[cc.key]; if (l && l.length) { cells[cc.key] = l; any = true; } });
          if (!any) return;
          var sp = seriesPlace(sr.name, ln.keys);
          var sl = { name: ln.name, sub: ln.sub, kind: ln.kind, keys: ln.keys, rows: ln.rows, off: ln.off, series: sr.name,
                     seriesPlace: sp, place: sp || ln.place || '', noteSection: 'Series ' + sr.name, cells: cells, loose: [],
                     extras: ln.extras.filter(function (x) { var m = SERIES_NOTE.exec(x.section || ''); return !m || m[1] === sr.name; }) };
          sl.pl = sl.place || 'auto';
          if (sl.kind === 'duty') { sl.bucket = 'model'; part.duty.push(sl); return; }
          // every row starts in the model columns; it is in the series' General only when an editor put it there, and
          // stays there: values read later for any model of the series show in that General (owner, 22 Oct 2026)
          if (sl.pl === 'general' || sl.kind === 'accessory') { sl.bucket = 'general'; part.gen.push(sl); }
          else { sl.bucket = 'model'; part.model.push(sl); }
        });
        if (part.gen.length || part.model.length || part.duty.length) sr.parts.push(part);
      });
    });
    tree.extras.forEach(function (x) {
      var m = SERIES_NOTE.exec(x.section || '');
      if (m && !x.key) series(m[1]).notes.push(x);
    });
    // what every FCU shares: the product's own entries, and notes kept for a part before the series layout
    var general = main.filter(function (c) { return c.id === 'general'; })[0] || { C: { id: 'general' }, id: 'general', name: 'General', sections: ['General'], lines: [], extras: [] };
    var older = cards.filter(function (c) { return c !== general && c.extras.length; });
    return { series: list.filter(function (sr) { return sr.cols.length || sr.notes.length; }), general: general, older: older };
  }
  function slAll(sl) { var out = []; Object.keys(sl.cells).forEach(function (k) { out = out.concat(sl.cells[k]); }); return out; }
  function seriesId(name) { return 'po-series-' + low(name).replace(/[^a-z0-9]+/g, '-'); }

  /* the General of every FCU */
  function fcuGeneralNode(d, q, edit) {
    var g = d.general, makes = [], extras = [], body = el('div', { 'class': 'po-body' });
    [g].concat(d.older).forEach(function (c) { c.extras.forEach(function (x) { (x.kind === 'make' ? makes : extras).push({ x: x, c: c }); }); });
    if (q) { makes = makes.filter(function (o) { return hits(q, o.x.body); }); extras = extras.filter(function (o) { return hits(q, o.x.body + ' ' + o.c.name); }); }
    if (q && !makes.length && !extras.length) return null;
    var sx = el('div', { 'class': 'po-secx' });
    var mine = extras.filter(function (o) { return o.c === g; }).map(function (o) { return o.x; });
    extraNodes(mine, { where: 'every FCU', anchor: function () { return sx; } }, edit).forEach(function (n) { sx.appendChild(n); });
    if (edit) sx.appendChild(el('div', { 'class': 'po-tools' }, addButtons(function () { return sx; }, 'General', '', 'every FCU', true)));
    if (sx.childNodes.length) body.appendChild(sx);
    // notes kept for a part (Coil, Drain pan ...) before the series layout: still for every FCU
    var byPart = {};
    extras.forEach(function (o) { if (o.c !== g) (byPart[o.c.name] = byPart[o.c.name] || { c: o.c, list: [] }).list.push(o.x); });
    Object.keys(byPart).forEach(function (n) {
      var box = el('div', { 'class': 'po-secx' });
      extraNodes(byPart[n].list, { where: n, anchor: function () { return box; } }, edit).forEach(function (x) { box.appendChild(x); });
      body.appendChild(el('p', { 'class': 'po-part', text: n }));
      body.appendChild(box);
    });
    if (makes.length || (edit && tree.can_approve)) {
      body.appendChild(el('div', { 'class': 'po-grid' }, [makeLine(g, makes.map(function (o) { return o.x; }), edit)]));
    }
    if (!body.childNodes.length) {
      if (!edit) return null;
      body.appendChild(el('p', { 'class': 'hint', text: 'Notes for every FCU go here.' }));
    }
    var k = 'fcu:general';
    var det = el('details', { 'class': 'po-sec po-card', id: 'po-series-general', open: q ? true : !closed[k] }, [
      el('summary', {}, [el('span', { text: 'General' }), el('span', { 'class': 'count', text: 'for every ' + tree.factory.product })]), body]);
    det.addEventListener('toggle', function () { if (!q) closed[k] = !det.open; });
    return det;
  }

  /* one series: its notes, its General (by part), its model columns, its duty figures */
  function fcuSeriesNode(sr, q, edit) {
    var cols = sr.cols, parts = sr.parts, notes = sr.notes;
    if (q && !hits(q, 'series ' + sr.name)) {
      var colHit = cols.filter(function (cc) { return hits(q, cc.head); });
      if (colHit.length) cols = colHit;
      else {
        var lineHit = function (sl) { return hits(q, (sl.sub ? sl.sub + ' ' : '') + sl.name + ' ' + slAll(sl).map(function (x) { return x.v.v; }).join(' ') + ' ' + sl.extras.map(function (x) { return x.body; }).join(' ')); };
        parts = parts.map(function (p) { return { c: p.c, id: p.id, name: p.name, gen: p.gen.filter(lineHit), model: p.model.filter(lineHit), duty: p.duty.filter(lineHit) }; })
          .filter(function (p) { return p.gen.length || p.model.length || p.duty.length; });
        notes = notes.filter(function (x) { return hits(q, x.body); });
        if (!parts.length && !notes.length) return null;
      }
    }
    var ctx = function (p) { return { C: p.c.C, id: p.id, name: 'Series ' + sr.name + ' > ' + p.name, sections: p.c.sections }; };
    var body = el('div', { 'class': 'po-body' });
    var waiting = 0;
    sr.parts.forEach(function (p) { p.gen.concat(p.model).forEach(function (sl) { waiting += waitItems(slAll(sl)).length; }); });

    // the series' own notes
    var sx = el('div', { 'class': 'po-secx' }, extraNodes(notes, { where: 'series ' + sr.name, anchor: function () { return sx; } }, edit));
    if (edit) sx.appendChild(el('div', { 'class': 'po-tools' }, addButtons(function () { return sx; }, 'Series ' + sr.name, '', 'series ' + sr.name, false)
      .map(function (b) { b.textContent = b.textContent + ' for the series'; return b; })));
    if (sx.childNodes.length) body.appendChild(sx);

    // General of the series, by part
    var genParts = parts.filter(function (p) { return p.gen.length; });
    if (genParts.length) {
      body.appendChild(el('p', { 'class': 'po-part po-series-head', text: 'General', title: 'Rows moved to the General of series ' + sr.name + ', with the values of all its models. For this series only.' }));
      genParts.forEach(function (p) {
        body.appendChild(el('p', { 'class': 'po-subpart', text: p.name }));
        var grid = el('div', { 'class': 'po-grid' });
        p.gen.forEach(function (sl) {
          var row = el('div', { 'class': 'po-line' + (sl.off ? ' off' : '') }), vals = el('div', { 'class': 'po-vals' });
          var list = []; cols.forEach(function (cc) { list = list.concat(sl.cells[cc.key] || []); });
          chipsOf(list).forEach(function (ch) { vals.appendChild(chipNode(ch, edit)); });
          lineExtras(ctx(p), sl, edit, function () { return row; }).forEach(function (n) { vals.appendChild(n); });
          row.appendChild(el('div', { 'class': 'po-name' }, [edit ? tickBox(sl.keys, sl.name, row, sr.name) : null, document.createTextNode(lineName(sl))]));
          row.appendChild(vals);
          var t = lineTools(ctx(p), sl, edit, function () { return row; }); if (t) row.appendChild(t);
          grid.appendChild(row);
        });
        body.appendChild(grid);
      });
    }

    // model columns: the options that differ, then the duty figures (folded until asked for)
    var showDuty = !!expanded['duty:' + sr.name] || !!q;
    var modelParts = parts.filter(function (p) { return p.model.length; }), dutyParts = showDuty ? parts.filter(function (p) { return p.duty.length; }) : [];
    var nDuty = parts.reduce(function (n, p) { return n + p.duty.length; }, 0);
    if (modelParts.length || dutyParts.length) {
      body.appendChild(el('p', { 'class': 'po-part po-series-head', text: 'Models', title: 'One column per model of series ' + sr.name + '.' }));
      body.appendChild(fcuTable(sr, cols, modelParts, dutyParts, edit, ctx));
    }
    if (nDuty && !q) body.appendChild(el('button', { type: 'button', 'class': 'po-more po-duty-toggle', 'aria-expanded': showDuty ? 'true' : 'false',
      text: showDuty ? 'Hide duty figures' : 'Show duty figures (' + nDuty + ')', title: 'Flows, pressures, capacities ... seen on the selections so far: not options and not limits.',
      onclick: function () { expanded['duty:' + sr.name] = !showDuty; render(); } }));
    if (!body.childNodes.length) body.appendChild(el('p', { 'class': 'hint', text: 'Nothing here yet.' }));

    var k = 'series:' + low(sr.name);
    var det = el('details', { 'class': 'po-sec po-card', id: seriesId(sr.name), open: q ? true : !closed[k] }, [
      el('summary', {}, [el('span', { text: 'Series ' + sr.name }), el('span', { 'class': 'count', text: [plural(sr.cols.length, 'model', 'models'),
        waiting ? waiting + ' to approve' : ''].filter(Boolean).join(' · ') })]), body]);
    det.addEventListener('toggle', function () { if (!q) closed[k] = !det.open; });
    return det;
  }

  /* one table per series: a column per model, the rows by part */
  function fcuTable(sr, cols, modelParts, dutyParts, edit, ctx) {
    var narrow = window.matchMedia('(max-width: 560px)').matches, first = narrow ? 140 : 210, w = cols.length > 6 ? 170 : 200;
    var all = []; modelParts.concat(dutyParts).forEach(function (p) { all = all.concat(p.model).concat(p.gen); });
    var head = el('tr', {}, [el('th', { text: 'Model' })].concat(cols.map(function (cc) {
      var th = el('th', { 'class': 'unit' }, [el('div', { text: cc.head }), el('small', { text: cc.n ? times(cc.n) : '' })]);
      if (tree.can_approve) {
        var w8 = []; sr.parts.forEach(function (p) { p.gen.concat(p.model).forEach(function (sl) { w8 = w8.concat(waitItems(sl.cells[cc.key] || [])); }); });
        if (w8.length) th.appendChild(xbtn('Approve ' + w8.length, function (e) { busy(e.currentTarget, approveMany(w8, true), w8.length + (w8.length === 1 ? ' value' : ' values') + ' of ' + cc.head + ' approved.'); }));
      }
      return th;
    })));
    var body = el('tbody'), span = String(cols.length + 1);
    function row(p, sl, duty) {
      var tr = el('tr', { 'class': (sl.off ? 'off' : '') + (duty ? ' duty' : '') || null });
      var name = el('td', { 'class': 'comp' }, [edit ? tickBox(sl.keys, sl.name, tr, sr.name) : null, document.createTextNode(lineName(sl))]);
      lineExtras(ctx(p), sl, edit, function () { return name; }).forEach(function (n) { name.appendChild(n); });
      var t = duty ? (edit ? el('div', { 'class': 'po-tools' }, kindButtons(sl).concat([leaveOut(sl.keys, sl.off)])) : null) : lineTools(ctx(p), sl, edit, function () { return name; });
      if (t) name.appendChild(t);
      tr.appendChild(name);
      cols.forEach(function (cc) {
        var list = sl.cells[cc.key] || [], td = el('td');
        if (!list.length) td.appendChild(el('span', { 'class': 'muted', text: '-' }));
        else if (duty) td.appendChild(el('span', { 'class': 'po-duty', text: dutyText(list) }));
        else chipsOf(list).forEach(function (ch) { td.appendChild(chipNode(ch, edit)); });
        tr.appendChild(td);
      });
      return tr;
    }
    modelParts.forEach(function (p) {
      body.appendChild(el('tr', { 'class': 'sub' }, [el('td', { colspan: span, text: p.name })]));
      p.model.forEach(function (sl) { body.appendChild(row(p, sl, false)); });
    });
    if (dutyParts.length) {
      body.appendChild(el('tr', { 'class': 'sub po-duty-head' }, [el('td', { colspan: span, text: 'Duty seen with each model: figures of the selections so far, not limits' })]));
      dutyParts.forEach(function (p) {
        body.appendChild(el('tr', { 'class': 'sub' }, [el('td', { colspan: span, text: p.name })]));
        p.duty.forEach(function (sl) { body.appendChild(row(p, sl, true)); });
      });
    }
    var table = el('table', { 'class': 'table po-matrix', style: 'width:' + (first + w * cols.length) + 'px' }, [
      el('colgroup', {}, [first].concat(cols.map(function () { return w; })).map(function (x) { return el('col', { style: 'width:' + x + 'px' }); })),
      el('thead', {}, [head]), body]);
    return el('div', { 'class': 'po-cols' }, [el('div', { 'class': 'table-wrap po-matrix-wrap', tabindex: '0', role: 'region', 'aria-label': 'Series ' + sr.name + ', one column per model' }, [table])]);
  }

  /* the FCU page: General, then one block per series */
  function drawFcu(q, edit) {
    var d = fcuSeries(edit), wrap = el('div', { 'class': 'po-cards' }), shown = [], nVals = 0;
    var g = fcuGeneralNode(d, q, edit);
    if (g) { wrap.appendChild(g); shown.push({ name: 'General', id: 'po-series-general' }); }
    d.series.forEach(function (sr) {
      sr.parts.forEach(function (p) { p.gen.concat(p.model).forEach(function (sl) { nVals += slAll(sl).filter(function (x) { return !x.v.hidden; }).length; }); });
      var n = fcuSeriesNode(sr, q, edit);
      if (n) { wrap.appendChild(n); shown.push({ name: sr.name + ' · ' + sr.cols.length, id: seriesId(sr.name), key: 'series:' + low(sr.name) }); }
    });
    var strip = el('nav', { 'class': 'po-strip', 'aria-label': 'Series' }, shown.map(function (x) {
      return el('button', { type: 'button', 'class': 'po-jump', text: x.name, onclick: function () {
        var det = $(x.id); if (!det) return;
        det.open = true; if (x.key) closed[x.key] = false;
        det.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } });
    }));
    return { wrap: wrap, strip: strip, drawn: shown.length, values: nVals, series: d.series };
  }

  /* FCU Excel: what a user sees, series by series */
  function fcuRows(txt) {
    var keep = onlyWait, out = [['Series', 'Column', 'Part', 'Component', 'What it is', 'Seen on datasheets', 'Special options', 'Notes']];
    onlyWait = false;
    var d = fcuSeries(false);
    onlyWait = keep;
    function ok(list) { return list.filter(function (x) { return !x.v.hidden && !x.v.wait; }); }
    function seen(list) { return cellText(chipsOf(ok(list)).map(function (ch) { return { v: ch.text, n: ch.n }; })); }
    d.general.extras.forEach(function (x) { out.push(['All', '', '', KIND[x.kind] || x.kind, '', x.body, '', '']); });
    d.older.forEach(function (c) { c.extras.forEach(function (x) { out.push(['All', '', c.name, KIND[x.kind] || x.kind, '', x.body, '', '']); }); });
    d.series.forEach(function (sr) {
      if (sr.notes.length) out.push([sr.name, '', '', '(whole series)', '', '', txt(sr.notes, 'option'), txt(sr.notes, 'note')]);
      sr.parts.forEach(function (p) {
        p.gen.forEach(function (sl) { var v = seen(slAll(sl)); if (v) out.push([sr.name, 'General', p.name, lineName(sl), 'General', v, txt(sl.extras, 'option'), txt(sl.extras, 'note')]); });
      });
      sr.cols.forEach(function (cc) {
        sr.parts.forEach(function (p) {
          p.model.forEach(function (sl) { var v = seen(sl.cells[cc.key] || []); if (v) out.push([sr.name, cc.head, p.name, lineName(sl), 'Model-specific', v, txt(sl.extras, 'option'), txt(sl.extras, 'note')]); });
          p.duty.forEach(function (sl) { var v = dutyText(ok(sl.cells[cc.key] || [])); if (v) out.push([sr.name, cc.head, p.name, lineName(sl), 'Duty (seen)', v, '', '']); });
        });
      });
    });
    return out;
  }

  /* FCU: values kept per unit model; the series are counted on the facts line */
  function modelMode() { return !!(tree && tree.models && tree.models.length); }
  function seriesCount() { var n = {}; (tree.models || []).forEach(function (m) { n[low(m.series)] = 1; }); return Object.keys(n).length; }

  function render() {
    if (!tree) return;
    var edit = editing(), q = low(search.value).trim(), secs = build();
    var nVals = 0, nExtra = tree.extras.length, drawn = 0;
    host.textContent = '';
    $('po-edit-note').hidden = !edit;
    waitBar();
    pickBar();

    var parts = [], cardsShown = [];
    if (modelMode()) {                                  // FCU: General, then one block per series
      var f = drawFcu(q, edit);
      drawn = f.drawn; nVals = f.values;
      if (f.drawn > 1 && !q) parts.push(f.strip);
      parts.push(f.wrap);
    } else {
      var g = drawCards(q, edit); cardsShown = g.cards;
      drawn = g.drawn; nVals = g.values;
      if (g.cards.length > 1 && !q) parts.push(cardStrip(g.cards));
      parts.push(g.wrap);
    }

    var facts = $('po-facts'); facts.textContent = '';
    [modelMode() ? '' : cardsShown.length + (cardsShown.length === 1 ? ' section' : ' sections'),
     modelMode() ? seriesCount() + ' series, ' + tree.models.length + (tree.models.length === 1 ? ' model' : ' models') : '',
     nVals + (nVals === 1 ? ' option seen' : ' options seen'),
     nExtra ? nExtra + ' special options and notes' : '', tree.waiting ? tree.waiting + ' to approve' : '', tree.updated ? 'Last datasheet ' + when(tree.updated) : '']
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
        el('span', { 'class': 'hint', text: modelMode() ? 'General holds what is for every ' + tree.factory.product + '. Each series has a column per model; rows an editor moves to the series\' General stay there, with the values of all its models. Duty figures fold away. Series never mix. A value not listed is not known yet.'
          : 'Each section shows what is common to every unit seen, the accessories offered, one column per model (filter class, fan model, model box ...) and the duty figures seen. Both factories can offer any option; a value not listed is not known yet.' })]));
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
      el('button', { type: 'button', 'class': 'btn ghost sm', text: '+ Note', onclick: function () { go('note'); } }),
      tree.can_approve ? el('button', { type: 'button', 'class': 'btn ghost sm', text: '+ AI note', onclick: function () { go('ai'); } }) : null]));
    box.appendChild(msg);
    return box;
  }

  /* ---------- controls ---------- */
  var timer;
  search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(render, 150); });
  $('po-edit').addEventListener('click', function () { setEdit(!editOn); });
  function setAll(open) {
    if (!tree) return;
    if (modelMode()) { closed['fcu:general'] = !open; fcuSeries(false).series.forEach(function (sr) { closed['series:' + low(sr.name)] = !open; }); render(); return; }
    buildCards(false).forEach(function (c) {
      closed['card:' + c.id] = !open;
      c.cols.forEach(function (cc) { if (cc.family) closed['fam:' + c.id + ':' + low(cc.family)] = !open; });
    });
    render();
  }
  $('po-open').addEventListener('click', function () { setAll(true); });
  $('po-close').addEventListener('click', function () { setAll(false); });

  /* Excel: the cards as a user sees them (nothing taken out, nothing waiting): one row per component and column */
  function cardRows(txt) {
    var keep = onlyWait, out = [['Section', 'Column', 'Component', 'What it is', 'Seen on datasheets', 'Special options', 'Notes']];
    onlyWait = false;
    var cards = buildCards(false);
    onlyWait = keep;
    function ok(list) { return list.filter(function (x) { return !x.v.hidden && !x.v.wait; }); }
    function seen(list) { return cellText(chipsOf(ok(list)).map(function (ch) { return { v: ch.text, n: ch.n }; })); }
    function colName(cc) { return (cc.family ? cc.family + ' · ' : '') + cc.label + ': ' + cc.head; }
    cards.forEach(function (c) {
      if (c.extras.some(function (x) { return x.kind !== 'make'; })) out.push([c.name, '', '(whole section)', '', '', txt(c.extras, 'option'), txt(c.extras, 'note')]);
      var mkBy = {};
      c.extras.forEach(function (x) { if (x.kind !== 'make') return; var col = /^family:/.test(x.key || '') ? x.key.slice(7) : 'All'; (mkBy[col] = mkBy[col] || []).push(x.body); });
      Object.keys(mkBy).forEach(function (col) { out.push([c.name, col, 'Make', 'Make', mkBy[col].join('\n'), '', '']); });
      c.common.forEach(function (ln) { var v = seen(lineAll(ln)); if (v || ln.extras.length) out.push([c.name, 'All', lineName(ln), 'Common', v, txt(ln.extras, 'option'), txt(ln.extras, 'note')]); });
      var acc = []; c.access.forEach(function (ln) { acc = acc.concat(lineAll(ln)); });
      if (ok(acc).length) out.push([c.name, 'All', 'Accessories', 'Accessory', seen(acc), '', '']);
      c.cols.forEach(function (cc) {
        c.model.forEach(function (ln) { var v = seen(ln.cells[cc.key] || []); if (v) out.push([c.name, colName(cc), lineName(ln), 'Model-specific', v, txt(ln.extras, 'option'), txt(ln.extras, 'note')]); });
        c.duty.forEach(function (ln) { var v = dutyText(ok(ln.cells[cc.key] || [])); if (v) out.push([c.name, colName(cc), lineName(ln), 'Duty (seen)', v, '', '']); });
      });
      c.duty.forEach(function (ln) { var v = dutyText(ok(ln.loose)); if (v) out.push([c.name, 'All', lineName(ln), 'Duty (seen)', v, txt(ln.extras, 'option'), txt(ln.extras, 'note')]); });
      c.model.forEach(function (ln) { var v = seen(ln.loose); if (v) out.push([c.name, 'Read before columns', lineName(ln), 'Model-specific', v, '', '']); });
    });
    return out;
  }

  $('po-download').addEventListener('click', function () {
    if (!tree) return;
    function txt(list, kind) { return list.filter(function (x) { return x.kind === kind; }).map(function (x) { return x.body; }).join('\n'); }
    var rows = modelMode() ? fcuRows(txt) : cardRows(txt), widths = modelMode() ? [12, 16, 18, 32, 16, 44, 36, 44] : [20, 30, 32, 16, 44, 36, 44];
    var name = tree.factory.product + ' ' + tree.factory.name + ' - Product Options.xlsx';
    var blob = window.POXlsx.build(rows, 'Product Options', widths);
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
