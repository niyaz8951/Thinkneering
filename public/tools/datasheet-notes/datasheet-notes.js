/* ============================================================
   Datasheet Notes - page logic.
   The product must be chosen before the upload appears. There is no
   factory choice: one row mapping per product serves every factory.
   The PDF is read in the browser (ds-read.js); the PDF itself is
   never sent to the database. The table made from it is saved in
   the chosen project (Api.prNoteSave, tools/projects/pr-pick.js). One PDF can hold several units and
   several PDFs can be chosen at once: every unit gets its own
   column, headed by its unit tag. The power supply is read from
   the datasheet (Fan Supply under Electrical Power Inputs Data).
   Which rows appear and what they say follows the admin's row
   mapping for the chosen product (Api.dnRules, edited by Product Options editors on
   tools/product-options/mapping.html; one mapping per product, every factory, every user).
   Row names the mapping has not seen are added to it (Api.dnAddRows).
   Products and factories come from the same list the Compliance
   Maker uses (Api.cmOptions).
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var el = window.Hub.el;

  var productSel = $('dn-product');
  var hint = $('dn-scope-hint'), upload = $('dn-upload'), result = $('dn-result');
  var drop = $('dn-drop'), fileInput = $('dn-file'), status = $('dn-status'), mapNote = $('dn-map-note');
  var products = [], parsed = null, grid = null, fileName = '', busy = false;   // parsed: [unit, ...]
  var failed = [], runNo = 0;                    // failed: files of the last run that could not be read
  var STORE = 'dame_dn_product';                 // the chosen product is kept for this tab (sessionStorage)
  var narrow = window.matchMedia('(max-width: 560px)');
  var mappings = {}, mapping = null, mapProduct = '';   // mapping per product, loaded once each

  /* ---------- selection ---------- */
  function option(value, text) { return el('option', { value: value, text: text }); }
  function product() { return products.filter(function (p) { return p.id === productSel.value; })[0] || null; }
  function choice() {
    var p = product();
    return p ? { productId: p.id, product: p.name } : null;
  }
  function canRead(p) { return !!(p && window.DSParse.readers[String(p.id).toLowerCase()]); }

  /* The admin's row mapping for the chosen product. If it cannot be loaded the tool still
     works and shows every datasheet row, with a notice saying so. */
  function loadMapping(productId) {
    mapProduct = productId; mapping = mappings[productId] || null;
    mapNote.hidden = true;
    if (!productId || mapping) return;
    window.Api.dnRules(window.Hub.token(), productId).then(function (res) {
      var rules = {};
      (res.rules || []).forEach(function (r) { rules[r.key] = r; });
      mappings[productId] = { showUnmapped: res.show_unmapped !== false, rules: rules, count: (res.rules || []).length };
    }, function (err) {
      mappings[productId] = { showUnmapped: true, rules: {}, count: 0, error: (err && err.message) || String(err) };
    }).then(function () { if (mapProduct === productId) { mapping = mappings[productId]; applyGate(); } });
  }

  function applyGate() {
    var p = product(), c = choice();
    hint.className = 'hint';
    if (p && !canRead(p)) {
      hint.className = 'notice warn';
      hint.textContent = 'The ' + p.name + ' datasheet reader is not ready yet. Only ' + Object.keys(window.DSParse.readers).map(function (k) { return k.toUpperCase(); }).join(' and ') + ' datasheets can be read for now.';
      upload.hidden = true; result.hidden = true;
      return;
    }
    var needProject = window.PRPick.required() && !window.PRPick.current();
    hint.textContent = c && needProject ? 'Choose a project to continue. Every table is saved in its project.'
                     : c ? 'The unit tags and the power supply are read from the datasheet.'
                         : 'Choose a product to continue.';
    var ready = !!(c && mapping) && !needProject;
    upload.hidden = !ready;
    mapNote.hidden = !(ready && mapping.error);
    if (ready && mapping.error) mapNote.textContent = 'The row mapping for this product could not be loaded (' + mapping.error + '). Every datasheet row is shown as printed.';
    if (!ready) result.hidden = true;
    else if (parsed) render();            // the mapping has loaded: draw the table
  }

  /* A result belongs to the product it was read for: changing the product clears it. */
  function clearResult() { parsed = null; grid = null; fileName = ''; failed = []; result.hidden = true; say(''); $('dn-saved').hidden = true; }
  function remember() { try { sessionStorage.setItem(STORE, productSel.value); } catch (e) { /* ignore */ } }

  productSel.addEventListener('change', function () {
    var p = product();
    if (busy) stop();
    clearResult(); remember();
    loadMapping(p && canRead(p) ? p.id : ''); applyGate();
  });

  /* ---------- file ---------- */
  function say(text, kind) {
    status.hidden = !text;
    status.className = 'notice' + (kind ? ' ' + kind : '');
    status.textContent = text || '';
  }

  drop.addEventListener('click', function () { if (!busy) fileInput.click(); });
  fileInput.addEventListener('change', function () { if (fileInput.files.length) read([].slice.call(fileInput.files)); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length && !busy) read([].slice.call(f));
  });
  // a PDF dropped beside the box must not replace the page
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  /* Cancel: the run in hand is dropped (its number no longer matches) and the reader stops at the next page. */
  function stop() { runNo++; busy = false; drop.disabled = false; $('dn-cancel').hidden = true; say(''); }
  $('dn-cancel').addEventListener('click', function () { if (busy) { stop(); drop.focus(); } });

  function read(files) {
    var c = choice();
    if (!c) return;
    var no = ++runNo, stopped = function () { return no !== runNo; };
    busy = true; drop.disabled = true; parsed = null; failed = []; result.hidden = true;
    $('dn-cancel').hidden = false;
    say('Reading ' + (files.length === 1 ? files[0].name : files.length + ' files') + '…');
    // each file is checked against the product: an FCU datasheet run as AHU would be mapped under the wrong product
    window.DSRead.files(files, window.DSRead.progress(say, stopped), c.productId, stopped).then(function (units) {
      if (stopped()) return;
      say('Building the table for ' + units.length + (units.length === 1 ? ' unit…' : ' units…'));
      return new Promise(function (go) { setTimeout(go, 30); }).then(function () {   // let the message show first
        if (stopped()) return;
        parsed = units; fileName = units.names[0]; failed = units.failed;
        say('');
        render();
        register();
        keep(c, units.names || []);
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }).then(null, function (err) { if (!stopped()) say(err.message, 'error'); })
      .then(function () { if (!stopped()) { busy = false; drop.disabled = false; $('dn-cancel').hidden = true; } });
  }

  /* Row names this product's mapping has not seen before are added to the admins' mapping list,
     so new sections and rows turn up there without anyone loading the datasheet again.
     Only names go to the database, never values. The table on screen does not wait for it. */
  function register() {
    var c = choice();
    if (!parsed || !c || !mapping || mapping.error) return;
    var seen = {}, fresh = [], m = mapping;
    parsed.forEach(function (unit) {
      window.DSParse.rows(unit, c).forEach(function (r) {
        if (m.rules[r.key] || seen[r.key]) return; seen[r.key] = 1;
        fresh.push({ key: r.key, section: r.group, sub: /^Filter \d+$/i.test(r.sub) ? '' : r.sub, component: r.component });
      });
    });
    var units = parsed;
    if (!fresh.length) { collect(c, m, units); return; }
    window.Api.dnAddRows(window.Hub.token(), { productId: c.productId, rows: fresh }).then(function () {
      // remembered as they were added, so the next datasheet in this visit does not send them again
      fresh.forEach(function (r) { m.rules[r.key] = { key: r.key, show: m.showUnmapped, label: '', response: '' }; });
    }, function () { /* the next run sends them again */ }).then(function () { collect(c, m, units); });
  }

  /* The values of the rows the mapping shows go to the Product Options tree of the unit's factory
     (the factory read from the datasheet). The database takes only mapped rows and never the
     project, reference, material name, report date or unit tag; they are not sent either.
     The value is sent as printed, after the row's "Remove text", not the standard response. */
  var PROJECT_ROWS = /^general\|\|(?!power supply$)/;
  // FCU trees are kept per unit model (series > model): the model is the datasheet's Unit Model row.
  var MODEL_ROW = { fcu: 'unit data||unit model' };
  function collect(c, m, units) {
    var items = [];
    units.forEach(function (unit) {
      if (!unit.hdr.factory) return;
      var rows = window.DSParse.rows(unit, c), modelKey = MODEL_ROW[unit.type], model = '';
      if (modelKey) rows.forEach(function (r) { if (r.key === modelKey && !model) model = window.DSParse.fill('', r.value); });
      rows.forEach(function (r) {
        var rule = m.rules[r.key];
        if (PROJECT_ROWS.test(r.key) || (rule ? rule.show === false : !m.showUnmapped)) return;
        var v = window.DSParse.fill('', r.value, rule && rule.strip);
        if (v && v !== '-') items.push({ factory: unit.hdr.factory, key: r.key, value: v, model: model });
      });
    });
    // the database takes at most 20000 values per call; a long FCU schedule gives more
    var chain = Promise.resolve();
    for (var i = 0; i < items.length; i += 20000) (function (part) {
      chain = chain.then(function () { return window.Api.poCollect(window.Hub.token(), { productId: c.productId, items: part }); });
    })(items.slice(i, i + 20000));
    chain.then(null, function () { /* the tree misses this run */ });
  }

  /* The table on screen is saved in the project, once per read. The Excel does not wait for it. */
  function keep(c, names) {
    var box = $('dn-saved'), project = window.PRPick.current(), no = runNo;
    function tell(text, kind) { if (no !== runNo) return; box.hidden = false; box.className = 'notice' + (kind ? ' ' + kind : ''); box.textContent = text; }
    box.hidden = true;
    if (!project || !grid || !grid.rows.length) return;
    var rows = grid.rows.map(function (r) { return { section: r.section || '', component: r.component || '', cells: r.cells || [], marks: r.marks || null, kind: r.kind || 'row', key: r.key || '' }; });
    if (JSON.stringify(rows).length > 11000000) {
      tell('This table is too large to save in the project (' + grid.columns.length + ' units). Download the Excel and keep it, or read the datasheets in smaller groups.', 'warn');
      return;
    }
    tell('Saving in ' + project.name + '…');
    window.Api.prNoteSave(window.Hub.token(), { projectId: project.id, productId: c.productId, fileNames: names.join(', '), columns: grid.columns, rows: rows }).then(function () {
      tell('Saved in ' + project.name + '. Go back to the project to see it beside the specification.', 'ok');
    }, function (err) {
      tell('The table was not saved in the project: ' + ((err && err.message) || err) + ' Download the Excel now and read the datasheet again later.', 'error');
    });
  }

  /* ---------- result ---------- */
  function count(g) { return g.rows.filter(function (r) { return r.kind !== 'sub'; }).length; }
  function projects() {
    var seen = [];
    parsed.forEach(function (u) { if (u.hdr.project && seen.indexOf(u.hdr.project) < 0) seen.push(u.hdr.project); });
    return seen;
  }

  /* The rows to draw. With "Only rows that differ" ticked, rows that match the first unit are
     dropped; the section name and the sub-heading move to the first row that is kept.
     The Excel always holds every row. */
  function onScreen() {
    if (!$('dn-only').checked) return grid.rows;
    var out = [], sec = '', secDone = true, sub = null;
    grid.rows.forEach(function (r) {
      if (r.section) { sec = r.section; secDone = false; sub = null; }
      if (r.kind === 'sub') { sub = r; return; }
      if (!r.marks || !r.marks.some(Boolean)) return;
      if (sub) { out.push({ section: secDone ? '' : sec, component: sub.component, cells: sub.cells, kind: 'sub' }); secDone = true; sub = null; }
      out.push({ section: secDone ? '' : sec, component: r.component, cells: r.cells, marks: r.marks, kind: 'row' });
      secDone = true;
    });
    return out;
  }

  function render() {
    var c = choice();
    if (!parsed || !c || !mapping) return;
    grid = window.DSParse.grid(parsed, c, mapping);
    var units = grid.columns.length, shown = count(grid), total = count(window.DSParse.grid(parsed, c, null));

    var h = parsed[0].hdr, named = grid.columns.slice(0, 12);
    $('dn-title').textContent = (units === 1
      ? [h.project, grid.columns[0], h.reference ? 'Ref. ' + h.reference : '']
      : [projects().join(', '), units + ' units: ' + named.join(', ') + (units > named.length ? ' … (' + (units - named.length) + ' more)' : '')]).filter(Boolean).join('  ·  ') || fileName;

    var facts = $('dn-facts'); facts.textContent = '';
    var list = [units + (units === 1 ? ' unit' : ' units'), shown + (shown === 1 ? ' row' : ' rows')];
    if (shown < total) list.push((total - shown) + ' datasheet rows left out by the row mapping');
    var differ = grid.rows.filter(function (r) { return r.marks && r.marks.some(Boolean); }).length;
    if (units > 1) list.push(differ ? differ + (differ === 1 ? ' row differs' : ' rows differ') + ' from ' + grid.columns[0] : 'All units match ' + grid.columns[0]);
    $('dn-diff').hidden = units < 2;
    $('dn-diff-text').textContent = grid.columns[0] + ' is taken as the reference. In each row, a value that differs from it is highlighted, with one colour for each different value. The same value in a row always has the same colour; after 5 different values the colours start again.';
    $('dn-only-wrap').hidden = !differ;
    if (!differ) $('dn-only').checked = false;
    list.forEach(function (t) { facts.appendChild(el('span', { 'class': 'badge', text: t })); });

    // one line per distinct point, naming the units it concerns (every unit = no names)
    var notes = [], byText = {}, order = [];
    parsed.forEach(function (u, i) {
      var r = window.DSParse.readers[u.type] || window.DSParse.readers.ahu, list = u.warnings.slice();
      if (!u.unit.rows.length) list.push('No "' + r.unitBlock + '" block was found on the datasheet.');
      if (!u.sections.length) list.push('No ' + r.sectionsName + ' were found on the datasheet.');
      list.forEach(function (w) {
        if (!byText[w]) { byText[w] = []; order.push(w); }
        byText[w].push(grid.columns[i]);
      });
    });
    order.forEach(function (w) {
      var who = byText[w];
      if (units === 1 || who.length === units) notes.push(w);
      else notes.push(who.slice(0, 5).join(', ') + (who.length > 5 ? ' and ' + (who.length - 5) + ' more' : '') + ': ' + w);
    });
    // files of this run that could not be read: the table is for the others
    var bad = $('dn-failed'); bad.textContent = ''; bad.hidden = !failed.length;
    if (failed.length) {
      bad.appendChild(el('strong', { text: failed.length === 1 ? '1 file was not read. The table is for the other files.' : failed.length + ' files were not read. The table is for the other files.' }));
      bad.appendChild(el('ul', { 'class': 'dn-list' }, failed.map(function (n) { return el('li', { text: n }); })));
    }

    var warn = $('dn-warn'); warn.textContent = ''; warn.hidden = !notes.length;
    if (notes.length) {
      warn.appendChild(el('strong', { text: 'Check these points:' }));
      warn.appendChild(el('ul', { 'class': 'dn-list' }, notes.map(function (n) { return el('li', { text: n }); })));
    }

    // Section | Component | one column per unit tag | Remarks
    var table = $('dn-table').querySelector('table'), cols = $('dn-cols'), head = $('dn-head-row');
    var unitW = units === 1 ? 320 : units > 12 ? 160 : 220;
    cols.textContent = ''; head.textContent = '';
    var lead = narrow.matches ? [92, 116] : [170, 210];   // Section and Component stay in view, so they are kept slim on a phone
    lead.concat(grid.columns.map(function () { return unitW; }), [130]).forEach(function (w) { cols.appendChild(el('col', { style: 'width:' + w + 'px' })); });
    ['Section', 'Component'].concat(grid.columns, ['Remarks']).forEach(function (t, i) {
      head.appendChild(el('th', { text: t, 'class': i >= 2 && i < 2 + units ? 'unit' : null }));
    });
    table.style.minWidth = (lead[0] + lead[1] + 130 + unitW * units) + 'px';

    var body = $('dn-body'), frag = document.createDocumentFragment();
    onScreen().forEach(function (r) {
      var cls = (r.kind === 'sub' ? 'sub' : '') + (r.section ? ' first' : '') + (r.marks && r.marks.some(Boolean) ? ' differs' : '');
      frag.appendChild(el('tr', { 'class': cls.trim() || null },
        [el('td', { 'class': 'sec', text: r.section }), el('td', { text: r.component })]
          .concat(r.cells.map(function (v, u) {
            var mk = r.marks ? r.marks[u] : 0;
            return el('td', { text: v, 'class': mk ? 'diff d' + ((mk - 1) % 5 + 1) : null, title: mk ? 'Differs from ' + grid.columns[0] : null });
          }), [el('td')])));
    });
    body.textContent = ''; body.appendChild(frag);
    $('dn-table').hidden = !grid.rows.length;
    $('dn-empty').hidden = !!grid.rows.length;
    $('dn-download').disabled = !grid.rows.length;
    result.hidden = false;
    pinColumns();
  }

  /* Component is pinned beside Section: it needs the width Section was given (the columns stretch on a wide screen). */
  function pinColumns() {
    var first = $('dn-head-row').firstChild;
    if (first && !result.hidden) $('dn-table').style.setProperty('--dn-c1', first.offsetWidth + 'px');
  }
  window.addEventListener('resize', pinColumns);
  function onNarrow() { if (parsed && !result.hidden) render(); }
  if (narrow.addEventListener) narrow.addEventListener('change', onNarrow); else if (narrow.addListener) narrow.addListener(onNarrow);

  function safeName(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }

  $('dn-download').addEventListener('click', function () {
    if (!grid || !grid.rows.length) return;
    var name = grid.columns.length === 1 ? grid.columns[0] : (projects()[0] || fileName.replace(/\.pdf$/i, '')) + ' - ' + grid.columns.length + ' units';
    var blob = window.DSXlsx.build(grid, 'Datasheet Notes');
    var a = el('a', { href: URL.createObjectURL(blob), download: (safeName(name) || 'Datasheet') + ' - Datasheet Notes.xlsx' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    window.Hub.toast('Excel downloaded.');
  });

  $('dn-only').addEventListener('change', render);

  $('dn-clear').addEventListener('click', function () {
    clearResult();
    drop.focus();
  });

  /* ---------- start ---------- */
  window.Hub.requireLogin({ tool: 'datasheet-notes' }).then(function (profile) {
    // a table belongs to the project it was read for: changing the project clears it
    var first = true;
    window.PRPick.attach({ select: $('dn-project'), hint: $('dn-project-hint'), profile: profile,
      onChange: function () { if (!first) { if (busy) stop(); clearResult(); } first = false; applyGate(); } });
    return window.Api.cmOptions(window.Hub.token());
  }).then(function (res) {
    products = res.products || [];
    productSel.textContent = '';
    productSel.appendChild(option('', 'Choose a product'));
    products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
    productSel.disabled = false;
    var last = '';
    try { last = sessionStorage.getItem(STORE) || ''; } catch (e) { /* ignore */ }
    if (products.length === 1) productSel.value = products[0].id;
    else if (products.some(function (p) { return p.id === last; })) productSel.value = last;   // the product chosen before a reload
    if (product()) loadMapping(canRead(product()) ? product().id : '');
    applyGate();
  }, function (err) {
    productSel.textContent = ''; productSel.appendChild(option('', 'Could not load'));
    hint.className = 'notice error';
    hint.textContent = 'Could not load the product list: ' + ((err && err.message) || err) + ' Refresh the page to try again.';
  });
})();
