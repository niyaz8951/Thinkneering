/* ============================================================
   The specification looks like another product (owner, 22 Oct 2026).
   The server reads what a specification names before it saves anything
   (worker/src/lib/product-detect.ts). When it is clearly another product
   than the one chosen (an FCU spec saved as AHU, a chiller spec as FCU),
   cm_save_run / cm_admin_import refuse with code PRODUCT_MISMATCH and the
   product it looks like. This asks the person, in one sheet:
     "Change to <product>"  -> 'switch' (the page sets the product and asks for the factory)
     "It is <chosen>, save it" -> 'keep'  (the page calls again with productConfirmed: the
                                           server audits that the choice was kept)
     Cancel / Esc / outside  -> null     (nothing saved)
   Used by Add a specification (projects), the classic Compliance Maker and the library upload.
   ============================================================ */
(function () {
  'use strict';
  function is(err) { return !!(err && err.code === 'PRODUCT_MISMATCH' && err.data && err.data.chosen); }

  function ask(err) {
    var el = window.Hub.el, d = err.data, other = d.detected;
    return new Promise(function (resolve) {
      function done(v) { document.removeEventListener('keydown', key, true); back.remove(); resolve(v); }
      function key(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } }
      var title = other ? 'This looks like ' + (/^[aeiou]/i.test(other.name) || /^[FHLMNRSX][A-Z0-9]/.test(other.name) ? 'an ' : 'a ') + other.name + ' specification' : 'This looks like another product';
      var cancel = el('button', { type: 'button', 'class': 'btn ghost', text: 'Cancel', onclick: function () { done(null); } });
      var box = el('div', { 'class': 'hub-sheet', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }, [
        el('h2', { text: title }),
        el('p', { text: String(err.message || '').replace(/^This looks like[^.]*\.\s*/, '') }),   // the title says it already
        el('div', { 'class': 'hub-sheet-actions', style: 'grid-auto-flow:row' }, [
          other ? el('button', { type: 'button', 'class': 'btn', text: 'Change to ' + other.name, onclick: function () { done('switch'); } }) : null,
          el('button', { type: 'button', 'class': 'btn ghost', text: 'It is ' + d.chosen.name + ', save it as ' + d.chosen.name, onclick: function () { done('keep'); } }),
          cancel])
      ]);
      var back = el('div', { 'class': 'hub-sheet-back', onclick: function (e) { if (e.target === back) done(null); } }, [box]);
      document.addEventListener('keydown', key, true);
      document.body.appendChild(back);
      cancel.focus();
    });
  }

  window.CMProductCheck = { is: is, ask: ask };
})();
