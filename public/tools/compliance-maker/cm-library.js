/* ============================================================
   Compliance Maker - link to the master compliance library.
   - Shows the Product and Factory choice and keeps the rest of the
     tool hidden until both are chosen.
   - CMLibrary.saveRun() stores a conversion and returns the answers
     the library already holds for its lines.
   All database access goes through Api.* (assets/js/api.js).
   ============================================================ */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var productSel = $('cm-product'), factorySel = $('cm-factory'), hint = $('cm-scope-hint');
  var gated = [$('panel-input'), $('panel-format')];
  var products = [];

  function option(value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; return o; }
  function current() {
    var p = products.filter(function (x) { return x.id === productSel.value; })[0];
    var f = p && p.factories.filter(function (x) { return x.id === factorySel.value; })[0];
    return p && f ? { productId: p.id, productName: p.name, factoryId: f.id, factoryName: f.name } : null;
  }
  function applyGate() {
    var sel = current(), needProject = window.PRPick.required() && !window.PRPick.current();
    gated.forEach(function (el) { if (el) el.hidden = !sel || needProject; });
    hint.textContent = sel && needProject ? 'Choose a project to continue. Every conversion is saved in its project.' : sel ? 'Converting for ' + sel.productName + ' made in ' + sel.factoryName + '. Answers come from this factory’s library only.'
                           : 'Choose both to continue. Answers are kept separately for each factory.';
  }
  // A result belongs to the product/factory it was converted for: changing either clears it.
  // The chosen PDF and the pasted text stay, ready to convert for the new choice.
  function resetResult() {
    if (window.CMMaker) window.CMMaker.dropResult();
    var status = $('status'); if (status) { status.textContent = ''; status.className = 'status'; }
  }
  // The choice is kept for this browser tab (sessionStorage), so a reload or a visit to the library does not lose it.
  var KEEP = 'cm.scope';
  function remember() { try { sessionStorage.setItem(KEEP, JSON.stringify({ who: String(window.Hub.token() || ''), p: productSel.value, f: factorySel.value })); } catch (e) { /* not kept */ } }
  function restore() {
    var k = null;
    try { k = JSON.parse(sessionStorage.getItem(KEEP)); } catch (e) { k = null; }
    if (!k || !k.p || k.who !== String(window.Hub.token() || '')) return;
    productSel.value = k.p; if (productSel.value !== k.p) { productSel.value = ''; return; }
    fillFactories();
    factorySel.value = k.f || ''; if (factorySel.value !== (k.f || '')) factorySel.value = '';
  }

  function fillFactories() {
    var p = products.filter(function (x) { return x.id === productSel.value; })[0];
    factorySel.textContent = '';
    factorySel.appendChild(option('', p ? 'Choose a factory' : 'Choose a product first'));
    (p ? p.factories : []).forEach(function (f) { factorySel.appendChild(option(f.id, f.name)); });
    factorySel.disabled = !p;
  }

  productSel.addEventListener('change', function () { fillFactories(); resetResult(); applyGate(); remember(); });
  factorySel.addEventListener('change', function () { resetResult(); applyGate(); remember(); });

  (window.hubReady || Promise.reject(new Error('Not signed in'))).then(function (profile) {
    if (window.Hub.canEdit(profile, 'compliance-maker')) $('lib-manage').hidden = false;
    // The project this work is saved in (tools/projects/pr-pick.js). A result belongs to its project too.
    var first = true;
    window.PRPick.attach({ select: $('cm-project'), hint: $('cm-project-hint'), profile: profile,
      onChange: function () { if (!first) resetResult(); first = false; applyGate(); } });
    return window.Api.cmOptions(window.Hub.token());
  }).then(function (res) {
    products = res.products || [];
    productSel.textContent = '';
    productSel.appendChild(option('', 'Choose a product'));
    products.forEach(function (p) { productSel.appendChild(option(p.id, p.name)); });
    productSel.disabled = false;
    fillFactories(); restore(); applyGate();
  }, function (err) {
    productSel.textContent = ''; productSel.appendChild(option('', 'Could not load'));
    hint.textContent = 'Could not load the product list: ' + (err && err.message ? err.message : err) + ' Refresh the page to try again.';
    hint.className = 'status status--error';
  });

  window.CMLibrary = {
    selection: current,
    saveRun: function (rows, source, fileName) {
      var sel = current();
      if (!sel) return Promise.reject(new Error('Choose a product and factory first.'));
      var project = window.PRPick.current();
      if (window.PRPick.required() && !project) return Promise.reject(new Error('Choose a project first.'));
      return window.Api.cmSaveRun(window.Hub.token(), {
        factoryId: sel.factoryId, source: source, fileName: fileName, projectId: project ? project.id : null,
        lines: rows.map(function (r) { return { type: r.type || '', sr: r.sr || '', spec: r.spec || '' }; })
      });
    }
  };
})();
