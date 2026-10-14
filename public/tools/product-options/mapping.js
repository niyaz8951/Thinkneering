/* ============================================================
   Product Options - row mapping (admins, and users given edit access to Product Options).
   One mapping per product, the same for every factory and every user: it decides
   which datasheet rows Datasheet Notes prints, which rows the Product Options tree
   collects, and the keywords the project pages use to find a row in a specification.
   Each datasheet row has: Show, Name in Excel, Remove text, Response, Spec keywords.
   Opened from the Product Options page (?product=ahu) or from Admin > Products.
   Rows are found by loading a datasheet; every row listed is saved,
   so the list is there next time without loading a datasheet again.
   Database: Api.dnRules / Api.dnAdminSaveRules.
   Row keys and the response rule ($ or * = datasheet value) come
   from ds-parse.js, the same code the tool itself uses.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el, P = window.DSParse;
  var NO_VALUE = '‹datasheet value›';

  var productSel = $('dm-product'), hint = $('dm-scope-hint');
  var panel = $('dm-panel'), body = $('dm-body'), unmappedSel = $('dm-unmapped'), search = $('dm-search');
  var saveBtn = $('dm-save'), changes = $('dm-changes'), status = $('dm-status'), errorBox = $('dm-error');
  var products = [], productId = '', list = [], removed = [], savedUnmapped = true, sheet = null, sheetName = '', busy = false;

  function option(value, text) { return el('option', { value: value, text: text }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function fail(msg) { errorBox.hidden = !msg; errorBox.textContent = msg || ''; }

  /* ---------- state ---------- */
  function makeRow(src, rule, onSheet) {
    var r = {
      key: src.key, group: src.group, sub: src.sub, component: src.component,
      sample: onSheet ? src.value : null, onSheet: onSheet, saved: !!rule, isNew: !!(rule && rule['new']),
      show: rule ? rule.show !== false : unmappedSel.value === 'show',
      label: rule ? rule.label || '' : '', strip: rule ? rule.strip || '' : '', response: rule ? rule.response || '' : '',
      keywords: rule ? rule.keywords || '' : ''
    };
    r.orig = { show: r.show, label: r.label, strip: r.strip, response: r.response, keywords: r.keywords };
    return r;
  }

  /* saved rules + (if loaded) the rows of a datasheet -> the list on screen, grouped by section */
  function build(rules) {
    var byKey = {}, out = [], seen = {}, order = [];
    rules.forEach(function (r) { byKey[r.key] = r; });
    function add(row) { if (order.indexOf(row.group) < 0) order.push(row.group); out.push(row); }
    if (sheet) {
      var p = product();
      sheet.forEach(function (unit) {            // every unit in the PDF; the first value found is the example
        P.rows(unit, { product: p.name }).forEach(function (r) {
          if (seen[r.key]) return; seen[r.key] = 1;
          add(makeRow({ key: r.key, group: r.group, sub: /^Filter \d+$/i.test(r.sub) ? '' : r.sub, component: r.component, value: r.value }, byKey[r.key], true));
        });
      });
    }
    rules.forEach(function (r) {
      if (seen[r.key]) return; seen[r.key] = 1;
      add(makeRow({ key: r.key, group: r.section || 'Other', sub: r.sub || '', component: r.component || r.key }, r, false));
    });
    // keep each section's rows together, sections in the order they first appear
    list = [];
    order.forEach(function (g) { out.forEach(function (r) { if (r.group === g) list.push(r); }); });
  }

  function current() {            // what is on screen, as saved rules (keeps edits when a datasheet is loaded)
    return list.map(function (r) { return { key: r.key, section: r.group, sub: r.sub, component: r.component, show: r.show, label: r.label, strip: r.strip, response: r.response, keywords: r.keywords, 'new': r.isNew, _row: r }; });
  }

  /* A row a user's datasheet added (marked New) is already saved, so it is not a change: it does not
     count and does not trigger the leave warning. Save stays possible while there are New rows, so the
     admin can confirm them (saving clears the New mark). */
  function changed(r) { return !r.saved || r.show !== r.orig.show || r.label.trim() !== r.orig.label || r.strip.trim() !== r.orig.strip || r.response.trim() !== r.orig.response || r.keywords.trim() !== r.orig.keywords; }
  function pending() {
    var n = list.filter(changed).length + removed.length;
    if ((unmappedSel.value === 'show') !== savedUnmapped) n++;
    return n;
  }
  function refreshSave() {
    var n = pending(), fresh = list.filter(function (r) { return r.isNew; }).length;
    saveBtn.disabled = !(n || fresh) || busy;
    changes.textContent = n ? n + (n === 1 ? ' change' : ' changes') + ' not saved yet.'
      : fresh ? 'No changes to save. Save mapping confirms the ' + (fresh === 1 ? 'new row' : fresh + ' new rows') + ' (marked New).' : 'No changes to save.';
  }

  /* ---------- table ---------- */
  function resultText(r) {
    if (!r.show) return 'Left out';
    return P.fill(r.response, r.sample === null ? NO_VALUE : r.sample, r.strip);
  }

  function groupCount(g) {
    var rows = list.filter(function (r) { return r.group === g; });
    return rows.filter(function (r) { return r.show; }).length + ' of ' + rows.length + ' shown';
  }

  function render() {
    var frag = document.createDocumentFragment(), group = null;
    list.forEach(function (r) {
      if (r.group !== group) {
        group = r.group;
        var g = group;
        r_count[g] = el('span', { 'class': 'small muted', text: groupCount(g) });
        frag.appendChild(el('tr', { 'class': 'group', 'data-group': g }, el('td', { colspan: '7' }, el('div', { 'class': 'dm-group' }, [
          el('span', {}, [g + '  ', r_count[g]]),
          el('span', { 'class': 'row' }, [
            el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Show all', onclick: function () { setGroup(g, true); } }),
            el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Leave all out', onclick: function () { setGroup(g, false); } })
          ])
        ]))));
      }
      frag.appendChild(rowEl(r));
    });
    body.textContent = ''; body.appendChild(frag);
    $('dm-wrap').hidden = !list.length; $('dm-empty').hidden = !!list.length;
    applySearch(); refreshSave();
  }
  var r_count = {};

  function rowEl(r) {
    var name = (r.sub ? r.sub + ' › ' : '') + r.component;
    var check = el('input', { type: 'checkbox', 'aria-label': 'Show ' + name });
    var label = el('input', { 'class': 'input', maxlength: '120', placeholder: r.component, 'aria-label': 'Name in Excel for ' + name });
    var resp = el('input', { 'class': 'input', maxlength: '1000', placeholder: 'Datasheet value', 'aria-label': 'Response for ' + name });
    var result = el('td');
    var tr = el('tr', { 'data-group': r.group });
    var strip = el('input', { 'class': 'input', maxlength: '300', placeholder: 'Nothing', 'aria-label': 'Text to remove from the value of ' + name });
    var keys = el('textarea', { 'class': 'input dm-keys', maxlength: '600', rows: '1', placeholder: 'None', 'aria-label': 'Specification keywords for ' + name });
    check.checked = r.show; label.value = r.label; strip.value = r.strip; resp.value = r.response; keys.value = r.keywords;

    function paint() {
      tr.className = r.show ? '' : 'off';
      result.textContent = resultText(r);
      label.disabled = strip.disabled = resp.disabled = keys.disabled = !r.show;
    }
    check.addEventListener('change', function () { r.show = check.checked; paint(); r_count[r.group].textContent = groupCount(r.group); refreshSave(); });
    label.addEventListener('input', function () { r.label = label.value; refreshSave(); });
    strip.addEventListener('input', function () { r.strip = strip.value; paint(); refreshSave(); });
    keys.addEventListener('input', function () { r.keywords = keys.value.replace(/\s*\n+\s*/g, '; '); refreshSave(); });
    resp.addEventListener('input', function () { r.response = resp.value; paint(); refreshSave(); });
    r.paint = function () { check.checked = r.show; paint(); };
    r.tr = tr;
    r.text = (r.group + ' ' + name + ' ' + (r.sample || '') + (r.isNew ? ' new' : '')).toLowerCase();
    r.keysText = function () { return r.keywords.toLowerCase(); };

    var info = [el('span', { 'class': 'dm-name', text: name })];
    if (r.isNew) info.push(el('span', { 'class': 'badge brand', style: 'margin-left:8px', text: 'New' }));
    if (r.onSheet) info.push(el('span', { 'class': 'dm-sample', text: r.sample === '' ? 'Printed with no value' : r.sample }));
    else {
      info.push(el('span', { 'class': 'dm-sample', text: sheet ? 'Not on the loaded datasheet' : '' }));
      info.push(el('button', { type: 'button', 'class': 'btn danger sm', text: 'Remove', style: 'margin-top:6px',
        'aria-label': 'Remove ' + name + ' from the mapping', onclick: function () { removeRow(r); } }));
    }
    tr.appendChild(el('td', {}, el('label', { 'class': 'dm-check' }, check)));
    tr.appendChild(el('td', {}, info));
    tr.appendChild(el('td', {}, label));
    tr.appendChild(el('td', {}, strip));
    tr.appendChild(el('td', {}, resp));
    tr.appendChild(result);
    tr.appendChild(el('td', {}, keys));
    paint();
    return tr;
  }

  function setGroup(g, show) {
    list.forEach(function (r) { if (r.group === g && !r.tr.hidden) { r.show = show; r.paint(); } });
    r_count[g].textContent = groupCount(g); refreshSave();
  }

  function removeRow(r) {
    if (r.saved) removed.push(r.key);
    list = list.filter(function (x) { return x !== r; });
    render();
  }

  function applySearch() {
    var q = search.value.trim().toLowerCase(), visible = {};
    list.forEach(function (r) { r.tr.hidden = !!q && r.text.indexOf(q) < 0; if (!r.tr.hidden) visible[r.group] = 1; });
    [].forEach.call(body.querySelectorAll('tr.group'), function (tr) { tr.hidden = !visible[tr.getAttribute('data-group')]; });
  }
  search.addEventListener('input', applySearch);
  unmappedSel.addEventListener('change', refreshSave);

  function describe() {
    var n = list.length, fresh = list.filter(function (r) { return r.isNew; }).length;
    status.textContent = sheet
      ? n + ' rows: ' + list.filter(function (r) { return r.onSheet; }).length + ' from ' + sheetName +
        (list.some(function (r) { return !r.saved; }) ? ', including ' + list.filter(function (r) { return !r.saved; }).length + ' new rows that are saved when you press Save mapping.' : '.')
      : n ? n + ' saved rows' + (fresh ? ', ' + fresh + ' new from users\u2019 datasheets (marked New) until you save' : '') + '. Load a datasheet to see its values in the Result column and to find rows that are not listed yet.'
          : '';
  }

  /* ---------- load, save ---------- */
  function load() {
    var f = product();
    productId = f ? f.id : ''; sheet = null; sheetName = ''; removed = []; list = []; search.value = ''; fail('');
    panel.hidden = true;
    hint.textContent = f ? 'Loading the mapping…' : 'Choose a product to see its mapping.';
    if (!f) return;
    var id = f.id;
    window.Api.dnRules(window.Hub.token(), id).then(function (res) {
      if (productId !== id) return;
      savedUnmapped = res.show_unmapped !== false;
      unmappedSel.value = savedUnmapped ? 'show' : 'hide';
      build(res.rules || []);
      hint.textContent = 'Mapping for ' + f.name + ', used for every factory.';
      panel.hidden = false;
      render(); describe();
    }, function (err) {
      if (productId !== id) return;
      hint.textContent = '';
      panel.hidden = false; $('dm-wrap').hidden = true; $('dm-empty').hidden = true;
      fail('The mapping could not be loaded: ' + ((err && err.message) || err));
    });
  }

  $('dm-load').addEventListener('click', function () { if (!busy) $('dm-file').click(); });
  $('dm-file').addEventListener('change', function () {
    var file = this.files[0]; this.value = '';
    if (!file) return;
    busy = true; fail(''); status.textContent = 'Reading ' + file.name + '…';
    var id = productId;
    window.DSRead.file(file, window.DSRead.progress(function (t) { status.textContent = t; })).then(function (data) {
      window.DSRead.check(data, id);
      if (productId !== id) throw new Error('The product was changed while the datasheet was being read. Load it again.');
      var keep = current();
      sheet = data; sheetName = file.name;
      build(keep);
      // build() treats what it is given as saved rules: put the unsaved state back
      list.forEach(function (r) {
        var k = keep.filter(function (x) { return x.key === r.key; })[0];
        if (k) { r.saved = k._row.saved; r.orig = k._row.orig; }
      });
      render(); describe();
    }).then(null, function (err) { describe(); fail(err.message); })   // also a datasheet of another product (DSRead.check)
      .then(function () { busy = false; refreshSave(); });
  });

  saveBtn.addEventListener('click', function () {
    if (busy || !productId) return;
    busy = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; fail('');
    var id = productId, show = unmappedSel.value === 'show';
    var rules = list.map(function (r) { return { key: r.key, section: r.group, sub: r.sub, component: r.component, show: r.show, label: r.label.trim(), strip: r.strip.trim(), response: r.response.trim(), keywords: r.keywords.trim() }; });
    window.Api.dnAdminSaveRules(window.Hub.token(), { productId: id, showUnmapped: show, rules: rules, remove: removed }).then(function () {
      if (productId !== id) return;
      list.forEach(function (r) { r.saved = true; r.isNew = false; r.label = r.label.trim(); r.strip = r.strip.trim(); r.response = r.response.trim(); r.keywords = r.keywords.trim(); r.orig = { show: r.show, label: r.label, strip: r.strip, response: r.response, keywords: r.keywords }; });
      removed = []; savedUnmapped = show;
      render(); describe();
      window.Hub.toast('Mapping saved.');
    }, function (err) {
      fail('The mapping was not saved: ' + ((err && err.message) || err));
    }).then(function () { busy = false; saveBtn.textContent = 'Save mapping'; refreshSave(); });
  });

  /* ---------- product choice, leaving with unsaved changes ---------- */
  var lastProduct = '';
  function leaveOk() { return !productId || !pending() || window.confirm('Changes to this mapping are not saved. Leave them?'); }
  productSel.addEventListener('change', function () {
    if (!leaveOk()) { productSel.value = lastProduct; return; }
    lastProduct = productSel.value;
    load();
  });
  window.addEventListener('beforeunload', function (e) { if (productId && pending()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- start ---------- */
  window.Hub.requireLogin({ edit: 'product-options' }).then(function () {
    return window.Api.cmOptions(window.Hub.token());
  }).then(function (res) {
    // only products whose datasheet can be read have rows to map
    products = (res.products || []).filter(function (p) { return P.readers[String(p.id).toLowerCase()]; });
    productSel.textContent = '';
    productSel.appendChild(option('', 'Choose a product'));
    products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
    productSel.disabled = false;
    // opened from the Product Options page: start on the product shown there
    var wanted = String(window.Hub.param('product') || '').toLowerCase();
    var start = products.length === 1 ? products[0] : products.filter(function (p) { return String(p.id).toLowerCase() === wanted; })[0];
    if (start) { productSel.value = lastProduct = start.id; $('dm-back').href = 'index.html?product=' + encodeURIComponent(start.id); load(); }
  }, function (err) {
    productSel.textContent = ''; productSel.appendChild(option('', 'Could not load'));
    hint.className = 'notice error';
    hint.textContent = 'Could not load the product list: ' + ((err && err.message) || err) + ' Refresh the page to try again.';
  });
})();
