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
   Approval (19 Oct 2026): a value new to the factory waits ("to approve", v.wait) until the super
   user or an admin of this tile approves it (Api.poAdminApprove); users, the Excel download and the
   AI see only approved values. A rejected value is removed; seen again, it waits again.
   21 Oct 2026 (owner): Approve all / Reject all per row, Edit is a toggle, editors tick rows and leave them
   out together (Api.poAdminSetRowsHidden). AHU trees are cards per kind of component (see "AHU: one card"
   below and docs/Product-Options-Redesign.md): common options, accessories, a column per model, duty
   figures as ranges. FCU trees keep their series tables.
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
  function tickBox(keys, name, node) {
    var on = keys.every(function (k) { return picked[k]; });
    var box = el('input', { type: 'checkbox', 'class': 'po-tick', 'aria-label': 'Tick ' + name });
    box.checked = on;
    if (on && node) node.classList.add('picked');
    box.addEventListener('change', function () {
      keys.forEach(function (k) { if (box.checked) picked[k] = name; else delete picked[k]; });
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
    if (!modelMode()) [['general', 'Move to general'], ['model', 'Move to columns']].forEach(function (m) {
      bar.appendChild(el('button', { type: 'button', 'class': 'btn ghost sm', text: m[1], onclick: function (e) {
        var b = e.currentTarget; b.disabled = true;
        Api.poAdminSetPlace(window.Hub.token(), { factoryId: tree.factory.id, keys: keys, place: m[0] }).then(function () {
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
  function tidy(t) { return low(t).replace(/\s+/g, ' ').trim(); }
  function side(section) { var m = /\s(supply|return|exhaust|extract)$/i.exec(section || ''); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* the column of a value in card C: { key, label, head, family } or null (no column: belongs to the whole card) */
  function columnOf(C, row, v) {
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

  /* tree rows -> cards; extrasOnly (FCU): only the special options and notes */
  function buildCards(edit, extrasOnly) {
    var list = [], by = {}, rowBy = {};
    function card(section) {
      // the power supply leads; the notes of the whole product (section General) close the page
      var C = /^power supply$/i.test(section || '') ? { id: 'power', name: 'Power supply' }
            : /^general$/i.test(section || '') || !section ? { id: 'general', name: 'General' } : cardOf(section);
      var c = by[C.id];
      if (!c) { c = by[C.id] = { C: C, id: C.id, name: C.name, sections: [], lines: [], lineBy: {}, extras: [] }; list.push(c); }
      if (section && c.sections.indexOf(section) < 0) c.sections.push(section);
      return c;
    }
    tree.rows.forEach(function (r) {
      if (extrasOnly) return;
      var section = /^general\|\|power supply$/.test(r.key) ? 'Power Supply' : (r.section || 'General');
      if (!edit && r.hidden) return;
      var c = card(section), kind = r.kind || 'option';
      var name = /\|options\|option$/.test(r.key) ? 'Accessories' : r.component;
      var sub = kind === 'accessory' || /\s\d+$|^geometry$|^damper\b/i.test(r.sub || '') ? '' : r.sub || '';   // "Filter 1", "Damper One Supply": the column or the values say it      // "Filter 1": the column says which filter
      var lk = kind + '|' + tidy(sub) + '|' + tidy(name), ln = c.lineBy[lk];
      if (!ln) { ln = c.lineBy[lk] = { name: name, sub: sub, kind: kind, keys: [], rows: [], off: true, extras: [], sections: [] }; c.lines.push(ln); }
      ln.keys.push(r.key); ln.rows.push(r); if (!r.hidden) ln.off = false;
      if (r.place && !ln.place) ln.place = r.place;          // moved by an editor: general / per model
      if (ln.sections.indexOf(section) < 0) ln.sections.push(section);
      rowBy[r.key] = ln;
    });
    tree.extras.forEach(function (x) {
      if (x.key && rowBy[x.key]) rowBy[x.key].extras.push(x);
      else card(x.section || 'General').extras.push(x);
    });
    if (!extrasOnly) card('General');                         // the product's own notes, always at the end
    list.sort(function (a, b) { return (a.id === 'power' ? -1 : a.id === 'general' ? 1 : 0) - (b.id === 'power' ? -1 : b.id === 'general' ? 1 : 0); });
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
          var col = ln.kind === 'accessory' || ln.pl === 'general' ? null : columnOf(C, r, v);
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
    else if (edit) c.appendChild(xbtn(hidden ? 'Bring back' : 'Take out', function (e) {
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
    var add = edit ? addButtons(anchor, ln.rows[0].section || c.sections[0], ln.keys[0], where) : [];
    return (edit || waits.length) ? el('div', { 'class': 'po-tools' }, add.concat(waits, edit ? moveButtons(c, ln) : [], edit ? [leaveOut(ln.keys, ln.off)] : [])) : null;
  }
  /* move a row between General and the columns (owner, 21 Oct 2026): for every factory of the product (dn_map.place) */
  function canMove(c) { return !!(c.C.column || c.C.bySection); }
  function placeBtn(keys, place, label, done) {
    return xbtn(label, function (e) { busy(e.currentTarget, Api.poAdminSetPlace(window.Hub.token(), { factoryId: tree.factory.id, keys: keys, place: place }), done); });
  }
  function moveButtons(c, ln) {
    if (!canMove(c) || ln.kind === 'accessory') return [];
    var out = [ln.bucket === 'model' ? placeBtn(ln.keys, 'general', 'Move to general', ln.name + ' is in General now.')
                                    : placeBtn(ln.keys, 'model', 'Move to columns', ln.name + ' is shown per ' + ((UNIT[c.id] || ['model'])[0]) + ' now.')];
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
    var u = UNIT[c.id];
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
  function makeCard(c) { return !NO_MAKE[c.id]; }
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
      var t = dutyRow ? (edit ? el('div', { 'class': 'po-tools' }, [leaveOut(ln.keys, ln.off)]) : null) : lineTools(c, ln, edit, function () { return name; });
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
      body.appendChild(el('tr', { 'class': 'sub' }, [el('td', { colspan: String(cols.length + 1), text: 'Duty seen with each ' + ((UNIT[c.id] || ['column'])[0]) + ': figures of the selections so far, not limits' })]));
      dl.forEach(function (ln) { body.appendChild(cellsRow(ln, true)); });
    }
    var table = el('table', { 'class': 'table po-matrix', style: 'width:' + (first + w * cols.length) + 'px' }, [
      el('colgroup', {}, [first].concat(cols.map(function () { return w; })).map(function (x) { return el('col', { style: 'width:' + x + 'px' }); })),
      el('thead', {}, gradeRow(cols).concat([head])), body]);
    return el('div', { 'class': 'po-cols' }, [el('div', { 'class': 'table-wrap po-matrix-wrap', tabindex: '0', role: 'region', 'aria-label': c.name + ', one column per ' + ((UNIT[c.id] || ['column'])[0]) }, [table])]);
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

  /* the cards of a factory, in datasheet order; extrasOnly (FCU): only the special options and notes */
  function drawCards(q, edit, extrasOnly, skip) {
    var wrap = el('div', { 'class': 'po-cards' }), cards = buildCards(edit, extrasOnly), drawn = 0, nVals = 0, names = [];
    cards.forEach(function (c) {
      if (skip && skip(c)) return;
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
      var u = UNIT[c.id];
      return el('button', { type: 'button', 'class': 'po-jump', text: c.name + (c.cols.length && u ? ' · ' + c.cols.length : ''), onclick: function () {
        var d = $('po-card-' + c.id.replace(/[^a-z0-9]+/gi, '-'));
        if (!d) return;
        d.open = true; closed['card:' + c.id] = false;
        d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } });
    }));
  }

  /* FCU: one table per series. Rows = section > component, one column per model, so the models
     can be compared at a glance (owner's rule, 5 Oct 2026). The first model is the reference: a
     cell whose values differ from it is highlighted, one colour per different set of values, as
     in Datasheet Notes. The last column holds the special options and notes of the row (they are
     for every model) and, with Edit on, the buttons to add them and to leave the row out.
     The Component column stays in view when the table scrolls sideways. */
  /* a value read in two groups (the same size on two filters) once, with both counts; editing acts on the first */
  function once(list) {
    var by = {}, out = [];
    list.forEach(function (v) { var k = v.k; if (by[k]) by[k].n += v.n; else { by[k] = Object.assign({}, v); out.push(by[k]); } });
    return out;
  }
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
        var cells = cols.map(function (m) { return once(r.values.filter(function (v) { return v.model === m.model && (edit || !v.hidden); })); });
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
      if (edit) sx.appendChild(el('div', { 'class': 'po-tools' }, [].concat(addButtons(function () { return sx; }, s.name, '', s.name, true))));
      body.appendChild(el('tr', { 'class': 'sec' }, [el('td', { colspan: String(nCols - 1), text: s.name }), el('td', {}, [sx])]));

      var sub = '';
      lines.forEach(function (ln) {
        var r = ln.r;
        if (r.sub !== sub) { sub = r.sub; if (sub) body.appendChild(el('tr', { 'class': 'sub' }, [el('td', { colspan: String(nCols), text: sub })])); }
        var xcell = el('div', { 'class': 'po-vals' }), ctx = { where: s.name + ' > ' + r.name, anchor: function () { return xcell; } };
        extraNodes(r.extras, ctx, edit).forEach(function (n) { xcell.appendChild(n); });
        // Approve all / Reject all: the values of this row that wait, in the models of this series
        var waits = rowWaitButtons(r.values.filter(function (v) { return v.wait && names.indexOf(v.model) >= 0; }).map(function (v) { return item(r.key, v); }), r.name + ' (series ' + sr.name + ')');
        if (edit || waits.length) xcell.appendChild(el('div', { 'class': 'po-tools' }, (edit ? addButtons(function () { return xcell; }, s.name, r.key, ctx.where) : []).concat(waits, edit ? [leaveOut([r.key], r.off)] : [])));
        var tr = el('tr', { 'class': (r.off ? 'off' : '') + (ln.differs ? ' differs' : '') || null });
        tr.appendChild(el('td', { 'class': 'comp' }, [edit ? tickBox([r.key], r.name, tr) : null, document.createTextNode(r.name + (r.off ? ' (left out)' : ''))]));
        ln.cells.forEach(function (vals, i) {
          var mk = ln.marks[i], td = el('td', { 'class': mk ? 'diff d' + ((mk - 1) % 5 + 1) : null, title: mk ? 'Differs from ' + cols[0].model : null });
          var xk = cols[i].model + '|' + r.key, all = expanded[xk] || edit || vals.length <= 4;
          if (!vals.length) td.appendChild(el('span', { 'class': 'muted', text: '-' }));
          var rg = vals.length > 4 ? range(vals.filter(function (v) { return !v.hidden && !v.wait; })) : '';
          if (rg) td.appendChild(el('div', { 'class': 'po-cellv', text: rg }));
          (all ? vals : (rg ? [] : vals.slice(0, 4))).forEach(function (v) {
            var line = el('div', { 'class': 'po-cellv' + (v.hidden ? ' off' : '') }, [el('span', { text: v.v }),
              vals.length > 1 ? el('small', { text: ' ' + times(v.n), title: 'A datasheet run again is counted again.' }) : null]);
            if (v.wait) waitTag(v, r, line);
            else if (edit) line.appendChild(xbtn(v.hidden ? 'Bring back' : 'Take out', function (e) {
              busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, valueKey: v.k, model: v.model || '', grp: v.g || '', hidden: !v.hidden }), v.hidden ? 'Value is back in the tree.' : 'Value taken out.');
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
    waitBar();
    pickBar();

    var parts = [], series = modelMode() ? seriesList() : [], cardsShown = [];
    if (!modelMode()) {
      var g = drawCards(q, edit, false);
      drawn = g.drawn; nVals = g.values; cardsShown = g.cards;
      if (g.cards.length > 1 && !q) parts.push(cardStrip(g.cards));
      parts.push(g.wrap);
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
      var x = drawCards(q, edit, true, function (c) { return c.sections.length && c.sections.every(function (n) { return inTable[low(n)]; }); });
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
    [modelMode() ? series.length + (series.length === 1 ? ' series' : ' series') + ', ' + tree.models.length + (tree.models.length === 1 ? ' model' : ' models') : cardsShown.length + (cardsShown.length === 1 ? ' section' : ' sections'),
     modelMode() ? nRows + (nRows === 1 ? ' component' : ' components') : '', nVals + (nVals === 1 ? (modelMode() ? ' value' : ' option seen') : (modelMode() ? ' values' : ' options seen')),
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
        el('span', { 'class': 'hint', text: modelMode() ? 'One table per series, one column per model, with the values its units had on the datasheets run so far. Scroll sideways to see every model.'
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
  $('po-only').addEventListener('change', render);
  function setAll(open) {
    if (!tree) return;
    build().forEach(function (s) { closed[low(s.name)] = !open; });
    seriesList().forEach(function (sr) {
      closed['series:' + low(sr.name)] = !open;
      sr.models.forEach(function (m) { closed['model:' + low(m.model)] = !open; build().forEach(function (s) { closed['m:' + low(m.model) + ':' + low(s.name)] = !open; }); });
    });
    closed['series:all'] = !open;
    buildCards(false, false).forEach(function (c) {
      closed['card:' + c.id] = !open;
      c.cols.forEach(function (cc) { if (cc.family) closed['fam:' + c.id + ':' + low(cc.family)] = !open; });
    });
    render();
  }
  $('po-open').addEventListener('click', function () { setAll(true); });
  $('po-close').addEventListener('click', function () { setAll(false); });

  /* AHU Excel: the cards as a user sees them (nothing taken out, nothing waiting): one row per component and column */
  function ahuRows(txt) {
    var keep = onlyWait, out = [['Section', 'Column', 'Component', 'What it is', 'Seen on datasheets', 'Special options', 'Notes']];
    onlyWait = false;
    var cards = buildCards(false, false);
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

  /* Excel: what a user sees (nothing that was taken out, nothing that waits for approval), one row per component */
  $('po-download').addEventListener('click', function () {
    if (!tree) return;
    var byModel = modelMode(), secs = build(true);
    var rows = [(byModel ? ['Series', 'Model'] : []).concat(['Section', 'Sub-section', 'Component', 'Options seen on datasheets', 'Special options', 'Notes'])];
    function txt(list, kind) { return list.filter(function (x) { return x.kind === kind; }).map(function (x) { return x.body; }).join('\n'); }
    function block(model, series) {
      secs.forEach(function (s) {
        var lead = byModel ? [series, model] : [];
        if (!model && s.extras.length) rows.push(lead.concat([s.name, '', '(whole section)', '', txt(s.extras, 'option'), txt(s.extras, 'note')]));
        var gs = [], byG = {};
        s.rows.forEach(function (r) {
          if (r.off) return;
          var vals = model ? r.values.filter(function (v) { return !v.hidden && !v.wait && v.model === model; }) : (byModel ? [] : r.values.filter(function (v) { return !v.hidden && !v.wait; }));
          var extras = model ? [] : r.extras;
          if (model) vals = once(vals);
          var plain = model ? vals : vals.filter(function (v) { return !v.g; });
          if (plain.length || extras.length) rows.push(lead.concat([s.name, r.sub, r.name, cellText(plain), txt(extras, 'option'), txt(extras, 'note')]));
          if (model) return;
          vals.forEach(function (v) {
            if (!v.g) return;
            if (!byG[v.g]) { byG[v.g] = []; gs.push(v.g); }
            var line = byG[v.g].filter(function (x) { return x.r === r; })[0];
            if (line) line.vals.push(v); else byG[v.g].push({ r: r, vals: [v] });
          });
        });
        // the values of one item together (Sub-section = the item, e.g. "Filter Class: ISO Coarse 60%(G4)")
        gs.forEach(function (g) { byG[g].forEach(function (x) { rows.push(lead.concat([s.name, g, x.r.name, cellText(x.vals), '', ''])); }); });
      });
    }
    var widths = (byModel ? [12, 16] : []).concat([26, 24, 32, 44, 36, 44]);
    if (byModel) { seriesList().forEach(function (sr) { sr.models.forEach(function (m) { block(m.model, sr.name); }); }); block('', 'All models'); }
    else { rows = ahuRows(txt); widths = [20, 30, 32, 16, 44, 36, 44]; }
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
