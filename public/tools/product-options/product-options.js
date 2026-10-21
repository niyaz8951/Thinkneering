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
   21 Oct 2026 (owner): Approve all / Reject all per row (before "Leave out row"), none for the whole
   factory at the top; Edit is a toggle button; editors tick several rows and leave them out together
   (Api.poAdminSetRowsHidden); the locations are one table with a column per location (A to Z); the
   fans are two sections of their own, EC Fans and DIDW Fans, with a column per fan model holding its
   type and materials (groups made by DSParse.fanGroups when the datasheet is read).
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
  /* every value of a row that waits, in every group (AHU) */
  function waitingOf(key) {
    var r = tree.rows.filter(function (x) { return x.key === key; })[0];
    return r ? (r.values || []).filter(function (v) { return v.wait; }).map(function (v) { return item(key, v); }) : [];
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

  var KIND = { option: 'special option', note: 'note', ai: 'AI note' };
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

  function rowNode(s, r, edit) {
    var vals = el('div', { 'class': 'po-vals' }), node = el('div', { 'class': 'po-row' + (r.off ? ' off' : '') });
    var shown = r.values, xk = (r.model || '') + '|' + r.key + '|' + (r.grp || ''), all = expanded[xk] || edit || shown.length <= FEW;
    var rg = shown.length > FEW ? range(shown.filter(function (v) { return !v.hidden && !v.wait; })) : '';
    if (rg) vals.appendChild(el('span', { 'class': 'po-chip range', title: 'Lowest and highest value seen so far', text: rg }));
    (all ? shown : (rg ? [] : shown.slice(0, FEW))).forEach(function (v) {
      var c = el('span', { 'class': 'po-chip' + (v.hidden ? ' off' : '') }, [el('span', { text: v.v }), el('small', { text: times(v.n), title: 'Seen ' + v.n + (v.n === 1 ? ' time' : ' times') + ' on the datasheets run so far. A datasheet run again is counted again.' })]);
      if (v.wait) waitTag(v, r, c);
      else if (edit) c.appendChild(xbtn(v.hidden ? 'Bring back' : 'Take out', function (e) {
        busy(e.currentTarget, Api.poAdminSetHidden(window.Hub.token(), { factoryId: tree.factory.id, key: r.key, valueKey: v.k, model: v.model || '', grp: v.g || '', hidden: !v.hidden }), v.hidden ? 'Value is back in the tree.' : 'Value taken out.');
      }));
      vals.appendChild(c);
    });
    if (!edit && shown.length > FEW) vals.appendChild(el('button', { type: 'button', 'class': 'po-more',
      text: all ? 'Show fewer' : (rg ? 'Show all ' + shown.length + ' values' : '+ ' + (shown.length - FEW) + ' more'),
      onclick: function () { expanded[xk] = !all; render(); } }));
    var ctx = { where: s.name + ' > ' + r.name, anchor: function () { return node; } };
    extraNodes(r.extras, ctx, edit && !r.model).forEach(function (n) { vals.appendChild(n); });
    var tools = !r.model && !r.noTools, label = r.name + (r.off ? ' (left out)' : '');
    node.appendChild(el('div', { 'class': 'po-name' }, [edit && tools ? tickBox([r.key], r.name, node) : null, document.createTextNode(label)]));
    node.appendChild(vals);
    // Approve all / Reject all of the row come before "Leave out row" (owner, 21 Oct 2026); approvers get them with Edit off too
    var waits = tools ? rowWaitButtons(waitingOf(r.key), r.name) : [];
    if (tools && (edit || waits.length)) node.appendChild(el('div', { 'class': 'po-tools' },
      (edit ? addButtons(function () { return node; }, s.name, r.key, ctx.where) : []).concat(waits, edit ? [leaveOut([r.key], r.off)] : [])));
    return node;
  }
  function leaveOut(keys, off) {
    return xbtn(off ? 'Bring row back' : 'Leave out row', function (e) {
      busy(e.currentTarget, Api.poAdminSetRowsHidden(window.Hub.token(), { factoryId: tree.factory.id, keys: keys, hidden: !off }),
           off ? 'Row is back in the tree.' : 'Row left out for every ' + tree.factory.product + ' factory.');
    }, !off);
  }

  /* The sections of one group. model = '' : the plain tree (AHU) or, with extrasOnly, the
     special options and notes block of an FCU tree; model = 'FWW600VA' : that model's values only. */
  /* Rows whose values belong to another row's value (DSParse.LINKED, owner 21 Oct 2026): one tile per lead value,
     shown right under the lead row: under Profile a tile per profile with its EN 1886 classes; under Model Box Ref. a
     tile per model box with its panel and insulation. Their values leave their own section. */
  function linkOf(key) { return window.DSParse && window.DSParse.linkOf ? window.DSParse.linkOf(key) : null; }
  function leadOf(key) { return window.DSParse && window.DSParse.leadOf ? window.DSParse.leadOf(key) : null; }
  function leadTiles(secs, edit) {
    var out = {};
    secs.forEach(function (s) {
      s.rows.forEach(function (r) {
        if (!edit && r.off) return;
        var L = linkOf(r.key); if (!L) return;
        r.values.forEach(function (v) {
          if (!v.g || (!edit && v.hidden)) return;
          var T = out[L.id] || (out[L.id] = { L: L, order: [], by: {}, home: s.name, placed: false });
          if (!T.by[v.g]) { T.by[v.g] = []; T.order.push(v.g); }
          var line = T.by[v.g].filter(function (x) { return x.r.key === r.key; })[0];
          if (line) line.vals.push(v); else T.by[v.g].push({ s: s, r: r, vals: [v] });
        });
      });
    });
    return out;
  }
  function tileNodes(T, q, edit) {
    if (T.L.columns) {                         // the locations: one table, a column per location (owner, 21 Oct 2026)
      var entries = [];
      T.order.forEach(function (g) { T.by[g].forEach(function (x) { x.vals.forEach(function (v) { entries.push({ s: x.s, r: x.r, v: v }); }); }); });
      var t = colTable(entries, { q: q, edit: edit, head: plainHead, aria: 'Values per ' + low(T.L.id) });
      return t ? [t] : [];
    }
    return T.order.map(function (g) {
      var cut = g.indexOf(': '), label = cut > 0 ? g.slice(0, cut) : '', head = cut > 0 ? g.slice(cut + 2) : g;
      var lines = T.by[g];
      if (q && !lines.some(function (x) { return matches(q, x.s, { sub: x.r.sub, name: x.r.name, values: x.vals, extras: [] }); }) &&
          !q.split(/\s+/).every(function (w) { return low(g).indexOf(w) >= 0; })) return null;
      var box = el('div', { 'class': 'po-group po-lead' }, [el('div', { 'class': 'po-group-name' }, [label ? el('small', { text: label }) : null, el('span', { text: head })])]);
      lines.forEach(function (x) { box.appendChild(rowNode(x.s, Object.assign({}, x.r, { values: x.vals, extras: [], grp: g, noTools: true }), edit)); });
      return box;
    }).filter(Boolean);
  }
  /* A group shown as one table (owner, 21 Oct 2026): one column per group value (a location, a fan model), A to Z, the
     same value printed in other capitals one column; one row per component, rows of the same name from two sections
     (Fan Supply, Fan Return) one row. Scrolls sideways; the component column stays in view.
     entries: [{ s, r, v }] with v.g the group; o: { q, edit, head(g) -> { label, head }, skip(r), first, aria }. */
  function plainHead(g) { var cut = g.indexOf(': '); return cut > 0 ? { label: g.slice(0, cut), head: g.slice(cut + 2) } : { label: '', head: g }; }
  function fanHead(g) { var m = window.DSParse.FAN.island.exec(g); return plainHead(m ? m[2] : g); }
  function fanFamily(g) { var F = window.DSParse && window.DSParse.FAN, m = F ? F.island.exec(g || '') : null; return m ? m[1] + ' Fans' : ''; }
  function tidyKey(t) { return low(t).replace(/\s+/g, ' ').trim(); }
  function colTable(entries, o) {
    var cols = [], colBy = {}, lines = [], lineBy = {}, words = o.q ? o.q.split(/\s+/) : [];
    entries.forEach(function (e) {
      if (o.skip && o.skip(e.r)) return;
      if (!o.edit && (e.v.hidden || e.r.off)) return;
      var h = o.head(e.v.g), ck = tidyKey(h.head);
      var c = colBy[ck];
      if (!c) { c = colBy[ck] = { key: ck, label: h.label, spell: {} }; cols.push(c); }
      c.spell[h.head] = (c.spell[h.head] || 0) + (e.v.n || 0) + 0.001;
      var lk = tidyKey(e.r.name), ln = lineBy[lk];
      if (!ln) { ln = lineBy[lk] = { name: e.r.name, s: e.s, keys: [], off: true, cells: {} }; lines.push(ln); }
      if (ln.keys.indexOf(e.r.key) < 0) ln.keys.push(e.r.key);
      if (!e.r.off) ln.off = false;
      var cell = ln.cells[ck] || (ln.cells[ck] = []), vk = tidyKey(e.v.k);
      var chip = cell.filter(function (x) { return x.k === vk; })[0];
      if (!chip) { chip = { k: vk, text: e.v.v, n: 0, list: [] }; cell.push(chip); }
      chip.n += e.v.n || 0; chip.list.push({ key: e.r.key, v: e.v });
    });
    cols.forEach(function (c) { c.head = Object.keys(c.spell).sort(function (a, b) { return c.spell[b] - c.spell[a]; })[0]; });
    cols.sort(function (a, b) { return a.head.localeCompare(b.head, undefined, { sensitivity: 'base', numeric: true }); });
    function texts(ln, c) { return (ln.cells[c.key] || []).map(function (x) { return x.text; }).join(' '); }
    if (words.length) {
      // a column whose name matches keeps every row; otherwise the cells whose row name or values match
      var hit = function (t) { t = low(t); return words.every(function (w) { return t.indexOf(w) >= 0; }); };
      if (o.title && hit(o.title)) words = [];
      var cHit = words.length ? cols.filter(function (c) { return hit(c.head + ' ' + c.label); }) : cols;
      if (cHit.length) cols = cHit;
      else {
        var keepC = {}, keepL = [];
        lines.forEach(function (ln) {
          var any = false;
          cols.forEach(function (c) { if (ln.cells[c.key] && hit(ln.name + ' ' + ln.s.name + ' ' + texts(ln, c))) { keepC[c.key] = 1; any = true; } });
          if (any) keepL.push(ln);
        });
        cols = cols.filter(function (c) { return keepC[c.key]; }); lines = keepL;
      }
    }
    lines = lines.filter(function (ln) { return cols.some(function (c) { return ln.cells[c.key]; }); });
    if (!cols.length || !lines.length) return null;

    var head = el('tr', {}, [el('th', { text: o.first || 'Component' })].concat(cols.map(function (c) {
      return el('th', { 'class': 'unit' }, [c.label ? el('small', { 'class': 'lbl', text: c.label }) : null, el('div', { text: c.head })]);
    })));
    var body = el('tbody');
    lines.forEach(function (ln) {
      var tr = el('tr', { 'class': ln.off ? 'off' : null }), waits = [];
      cols.forEach(function (c) { (ln.cells[c.key] || []).forEach(function (ch) { ch.list.forEach(function (x) { if (x.v.wait) waits.push(item(x.key, x.v)); }); }); });
      var name = el('td', { 'class': 'comp' }, [o.edit ? tickBox(ln.keys, ln.name, tr) : null, document.createTextNode(ln.name + (ln.off ? ' (left out)' : ''))]);
      var tools = rowWaitButtons(waits, ln.name).concat(o.edit ? [leaveOut(ln.keys, ln.off)] : []);
      if (tools.length) name.appendChild(el('div', { 'class': 'po-tools' }, tools));
      tr.appendChild(name);
      cols.forEach(function (c) {
        var td = el('td'), cell = ln.cells[c.key] || [];
        if (!cell.length) td.appendChild(el('span', { 'class': 'muted', text: '-' }));
        cell.forEach(function (ch) {
          var hidden = ch.list.every(function (x) { return x.v.hidden; }), wait = ch.list.filter(function (x) { return x.v.wait; });
          var chip = el('span', { 'class': 'po-chip' + (hidden ? ' off' : '') }, [el('span', { text: ch.text }),
            el('small', { text: times(ch.n), title: 'Seen ' + ch.n + (ch.n === 1 ? ' time' : ' times') + ' on the datasheets run so far. A datasheet run again is counted again.' })]);
          if (wait.length) waitTagItems(ch.text, wait.map(function (x) { return item(x.key, x.v); }), chip);
          else if (o.edit) chip.appendChild(xbtn(hidden ? 'Bring back' : 'Take out', function (e) {
            busy(e.currentTarget, hideMany(ch.list, !hidden), hidden ? 'Value is back in the tree.' : 'Value taken out.');
          }));
          td.appendChild(chip);
        });
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    var narrow = window.matchMedia('(max-width: 560px)').matches, first = narrow ? 140 : 220, w = 210;
    var table = el('table', { 'class': 'table po-matrix', style: 'min-width:' + (first + w * cols.length) + 'px' }, [
      el('colgroup', {}, [first].concat(cols.map(function () { return w; })).map(function (x) { return el('col', { style: 'width:' + x + 'px' }); })),
      el('thead', {}, [head]), body]);
    var box = el('div', { 'class': 'po-cols' }, [el('div', { 'class': 'table-wrap po-matrix-wrap', tabindex: '0', role: 'region', 'aria-label': o.aria || 'Values side by side' }, [table])]);
    box.nCols = cols.length;
    return box;
  }

  function drawSections(secs, q, edit, model, extrasOnly) {
    var wrap = el('div', { 'class': 'po-tree' }), drawn = 0, nRows = 0, nVals = 0, keys = {};
    var islands = {}, islandAt = null;          // fan families (EC Fans, DIDW Fans): their own sections after the first fan section
    var tiles = model || extrasOnly ? {} : leadTiles(secs, edit);
    // a lead row that is not in the tree (left out of the mapping): its tiles stay in the section of their rows
    Object.keys(tiles).forEach(function (id) {
      var T = tiles[id];
      T.leadShown = secs.some(function (s) { return s.rows.some(function (r) { return T.L.lead.test(r.key) && (edit || !r.off); }); });
      T.order.forEach(function (g) { T.by[g].forEach(function (x) { nVals += x.vals.filter(function (v) { return !v.hidden; }).length; }); });
    });
    secs.forEach(function (s) {
      var live = s.rows.filter(function (r) { return edit || !r.off; }).map(function (r) {
        // with Edit off an editor sees what users see: no values that were taken out
        var values = extrasOnly ? [] : r.values.filter(function (v) { return (edit || !v.hidden) && (model ? v.model === model : true); });
        var L = !model && !extrasOnly ? linkOf(r.key) : null, moved = 0;
        if (L && tiles[L.id]) { moved = values.filter(function (v) { return v.g; }).length; values = values.filter(function (v) { return !v.g; }); }
        return { key: r.key, sub: r.sub, name: r.name, off: r.off, values: values, extras: model ? [] : r.extras, model: model, moved: moved };
      }).filter(function (r) {
        if (r.moved && !r.values.length && !r.extras.length) return false;     // all its values are in the tiles
        return r.values.length || r.extras.length || (!model && !extrasOnly && edit);
      });
      var hereTiles = Object.keys(tiles).filter(function (id) { return !tiles[id].leadShown && tiles[id].home === s.name; });
      var leadHere = live.some(function (r) { var L = leadOf(r.key); return L && tiles[L.id]; });
      live.forEach(function (r) { if (!r.off) { nRows++; keys[r.key] = 1; nVals += r.values.filter(function (v) { return !v.hidden; }).length; } });
      var secHit = q && q.split(/\s+/).every(function (w) { return low(s.name).indexOf(w) >= 0; });
      var rows = live.filter(function (r) { return secHit || matches(q, s, r); });
      var extras = model ? [] : s.extras.filter(function (x) { return secHit || !q || matches(q, { name: s.name, extras: [x] }); });
      var keepForTiles = hereTiles.length || (leadHere && !rows.length);
      // the type, model and materials of each fan go to their family's section (owner, 21 Oct 2026)
      var fanHere = false;
      if (!model && !extrasOnly) live.forEach(function (r) {
        r.values.forEach(function (v) {
          var fam = fanFamily(v.g); if (!fam) return;
          fanHere = true; (islands[fam] || (islands[fam] = [])).push({ s: s, r: r, v: v });
        });
      });
      var mark = fanHere && !islandAt ? (islandAt = document.createComment('fans')) : null;
      // rows whose every value is in a fan family are shown there only; a section left empty is not drawn
      rows = rows.filter(function (r) { return !(r.values.length && !r.extras.length && r.values.every(function (v) { return fanFamily(v.g); })); });
      if (!rows.length && !extras.length && !keepForTiles && !(edit && !q && !model)) { if (mark) wrap.appendChild(mark); return; }
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
        if (edit) {
          var secKeys = live.map(function (r) { return r.key; }), allTicked = secKeys.length && secKeys.every(function (k) { return picked[k]; });
          sx.appendChild(el('div', { 'class': 'po-tools' }, addButtons(function () { return sx; }, s.name, '', s.name, true).concat(secKeys.length ? [
            xbtn(allTicked ? 'Untick all rows' : 'Tick all rows', function () {
              live.forEach(function (r) { if (allTicked) delete picked[r.key]; else picked[r.key] = r.name; });
              render();
            })] : [])));
        }
        if (sx.childNodes.length) body.appendChild(sx);
      }

      // values of one item kept together (owner, 20 Oct 2026): Filter 1 (its class, name, material, sizes, pressure
      // drops) and Filter 2 are two groups; the EN 1886 classes are grouped under the profile they belong to
      var groups = [];
      if (!model) rows.forEach(function (r) { r.values.forEach(function (v) { if (v.g && !fanFamily(v.g) && groups.indexOf(v.g) < 0) groups.push(v.g); }); });
      var grouped = function (r) { return !model && r.values.some(function (v) { return v.g; }); };
      // values read before the groups (20 Oct 2026; fans 21 Oct 2026) in rows that now have groups: admins can remove them
      var stale = 0;
      rows.forEach(function (r) { if (grouped(r)) stale += r.values.filter(function (v) { return !v.g; }).length; });
      rows.forEach(function (r) { if (r.moved) stale += r.values.length; });
      if (stale && tree.can_approve) body.appendChild(el('div', { 'class': 'notice warn po-stale' }, [
        el('span', { text: stale + (stale === 1 ? ' value' : ' values') + ' of this section were saved before values were grouped, so they belong to no filter, profile, location or fan model. Read the datasheets again to have them grouped, then remove the old ones. ' }),
        el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Remove values without a group', onclick: function (e) {
          var btn = e.currentTarget;
          window.Hub.confirm('Remove the ' + stale + ' values of ' + s.name + ' (' + tree.factory.name + ') that have no group? The grouped values stay. A datasheet read again brings them back in their group.', { title: 'Remove values without a group', ok: 'Remove', danger: true }).then(function (yes) {
            if (yes) busy(btn, Api.poAdminClearUngrouped(window.Hub.token(), { factoryId: tree.factory.id, section: s.name }), 'Removed.');
          });
        } })]));
      var sub = '', tooled = {};
      rows.forEach(function (r) {
        var g = grouped(r), plain = g ? r.values.filter(function (v) { return !v.g; }) : r.values;
        if (g && !plain.length && !r.extras.length) return;   // shown in its groups, its fan family or its location table only
        if (r.sub !== sub) { sub = r.sub; if (sub) body.appendChild(el('div', { 'class': 'po-sub', text: sub })); }
        tooled[r.key] = 1;
        body.appendChild(rowNode(s, g ? Object.assign({}, r, { values: plain }) : r, edit));
        var L = leadOf(r.key);
        if (L && tiles[L.id]) tileNodes(tiles[L.id], q, edit).forEach(function (t) { body.appendChild(t); });
      });
      hereTiles.forEach(function (id) { tileNodes(tiles[id], q, edit).forEach(function (t) { body.appendChild(t); }); });
      groups.forEach(function (g) {
        var box = el('div', { 'class': 'po-group' }, [el('div', { 'class': 'po-group-name', text: g })]);
        rows.forEach(function (r) {
          var vals = r.values.filter(function (v) { return v.g === g; });
          if (!vals.length) return;
          box.appendChild(rowNode(s, Object.assign({}, r, { values: vals, extras: [], grp: g, noTools: !!tooled[r.key] }), edit));
          tooled[r.key] = 1;
        });
        body.appendChild(box);
      });
      wrap.appendChild(d);
      if (mark) wrap.appendChild(mark);
    });
    // the fan families, right after the first fan section: one column per fan model with its type and materials
    if (islandAt) ['EC Fans', 'DIDW Fans', 'Other Fans'].forEach(function (fam) {
      if (!islands[fam]) return;
      var F = window.DSParse.FAN;
      var t = colTable(islands[fam], { q: q, edit: edit, head: fanHead, title: fam, aria: fam + ', one column per fan model',
        skip: function (r) { return F.model.test(r.key.split('|')[2] || ''); } });     // the model is the column heading
      if (!t) return;
      drawn++;
      var ck = low(fam), d = el('details', { 'class': 'po-sec', open: q ? true : !closed[ck] }, [
        el('summary', {}, [el('span', { text: fam }), el('span', { 'class': 'count', text: t.nCols + (t.nCols === 1 ? ' fan model' : ' fan models') })]),
        el('div', { 'class': 'po-body' }, [t])]);
      d.addEventListener('toggle', function () { if (!q) closed[ck] = !d.open; });
      wrap.insertBefore(d, islandAt);
    });
    return { wrap: wrap, drawn: drawn, rows: nRows, values: nVals, keys: keys };
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
    ['ec fans', 'didw fans', 'other fans'].forEach(function (k) { closed[k] = !open; });     // the fan families
    render();
  }
  $('po-open').addEventListener('click', function () { setAll(true); });
  $('po-close').addEventListener('click', function () { setAll(false); });

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
