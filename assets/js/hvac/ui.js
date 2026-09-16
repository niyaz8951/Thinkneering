/* Thinkneering — HVAC calculators: shared UI kit
   Builds on the existing global.css components (.panel, .field, .field-row,
   .segmented, .chip, .notice, .table-wrap). Nothing here invents a new
   structural pattern — it only assembles the ones that already exist. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;
  var esc = window.TN ? TN.esc : function (s) { return String(s == null ? '' : s); };

  /* ------------------------------------------------------------- fields */

  function number(opts) {
    var id = opts.id;
    return '<div class="field">' +
      '<label for="' + id + '">' + esc(opts.label) +
      (opts.unit ? ' <span class="unit">' + esc(opts.unit) + '</span>' : '') + '</label>' +
      '<input type="number" id="' + id + '" name="' + id + '"' +
      ' value="' + (opts.value == null ? '' : opts.value) + '"' +
      (opts.step != null ? ' step="' + opts.step + '"' : ' step="any"') +
      (opts.min != null ? ' min="' + opts.min + '"' : '') +
      (opts.max != null ? ' max="' + opts.max + '"' : '') +
      (opts.disabled ? ' disabled' : '') +
      ' inputmode="decimal">' +
      (opts.hint ? '<p class="hint">' + esc(opts.hint) + '</p>' : '') +
      '</div>';
  }

  function select(opts) {
    var id = opts.id;
    var options = opts.options.map(function (o) {
      var value = o.id != null ? o.id : o.value;
      var label = o.name != null ? o.name : o.label;
      return '<option value="' + esc(value) + '"' +
        (String(value) === String(opts.value) ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    return '<div class="field">' +
      '<label for="' + id + '">' + esc(opts.label) + '</label>' +
      '<select id="' + id + '" name="' + id + '">' + options + '</select>' +
      (opts.hint ? '<p class="hint">' + esc(opts.hint) + '</p>' : '') +
      '</div>';
  }

  function row(fields) { return '<div class="field-row">' + fields.join('') + '</div>'; }

  function segmented(id, options, value, label) {
    var buttons = options.map(function (o) {
      return '<button type="button" data-value="' + esc(o.value) + '"' +
        ' aria-pressed="' + (o.value === value ? 'true' : 'false') + '">' + esc(o.label) + '</button>';
    }).join('');
    return '<div class="field">' +
      (label ? '<span class="label" id="' + id + '-label">' + esc(label) + '</span>' : '') +
      '<div class="segmented" id="' + id + '" role="group"' +
      (label ? ' aria-labelledby="' + id + '-label"' : '') + '>' + buttons + '</div></div>';
  }

  /* Wire a segmented control. onChange receives the selected value. */
  function bindSegmented(id, onChange) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      Array.prototype.forEach.call(el.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      onChange(btn.dataset.value);
    });
  }

  function segmentedValue(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var on = el.querySelector('button[aria-pressed="true"]');
    return on ? on.dataset.value : null;
  }

  /* -------------------------------------------------------- result rows */

  /* The headline number for a calculator. */
  function primary(value, unit, label, note) {
    return '<div class="result-primary">' +
      '<span class="result-primary__label">' + esc(label) + '</span>' +
      '<span class="result-primary__value">' + esc(value) +
      '<span class="result-primary__unit">' + esc(unit) + '</span></span>' +
      (note ? '<span class="result-primary__note">' + esc(note) + '</span>' : '') +
      '</div>';
  }

  /* Secondary results as a definition grid. items: [{label, value, unit}] */
  function metrics(items) {
    return '<dl class="metrics">' + items.map(function (i) {
      return '<div class="metric' + (i.emphasis ? ' metric--emphasis' : '') + '">' +
        '<dt>' + esc(i.label) + '</dt>' +
        '<dd>' + esc(i.value) +
        (i.unit ? ' <span class="unit">' + esc(i.unit) + '</span>' : '') + '</dd></div>';
    }).join('') + '</dl>';
  }

  function notice(message, kind) {
    var icons = { warning: 'activity', danger: 'activity', success: 'check' };
    var ic = window.TN ? TN.icon(icons[kind] || 'activity', 18) : '';
    return '<div class="notice' + (kind ? ' notice--' + kind : '') + '">' + ic +
      '<div>' + esc(message) + '</div></div>';
  }

  /* Collapsible formula / assumptions block. This is what makes the tool
     defensible in a review — every page carries one. */
  function formulas(title, rows, assumptions) {
    return '<details class="formulas">' +
      '<summary>' + esc(title || 'Formulas & assumptions') + '</summary>' +
      '<div class="formulas__body">' +
      rows.map(function (r) {
        return '<div class="formula">' +
          '<code>' + esc(r.equation) + '</code>' +
          '<p>' + esc(r.note) + '</p></div>';
      }).join('') +
      (assumptions && assumptions.length
        ? '<div class="formulas__limits"><h4>Limits of this calculation</h4><ul>' +
          assumptions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') +
          '</ul></div>'
        : '') +
      '</div></details>';
  }

  /* Standard page header for a calculator. */
  function pageHead(title, description) {
    return '<div class="page-head">' +
      '<p class="eyebrow"><a href="/tools/hvac/">HVAC</a> / Calculators</p>' +
      '<h1>' + esc(title) + '</h1>' +
      '<p>' + esc(description) + '</p></div>';
  }

  /* --------------------------------------------------------- plumbing */

  function val(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback == null ? 0 : fallback;
    if (el.tagName === 'SELECT') return el.value;
    return U.num(el.value, fallback);
  }

  function text(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function set(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
  }

  function html(id, markup) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = markup;
  }

  /* Recalculate on any input in a container, debounced just enough to stay
     responsive while typing without recomputing on every keystroke. */
  function live(containerId, handler) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var timer = null;
    function run() {
      clearTimeout(timer);
      timer = setTimeout(handler, 90);
    }
    el.addEventListener('input', run);
    el.addEventListener('change', run);
    handler();
  }

  /* localStorage persistence. Deliberately not the D1 sync layer yet — this
     keeps the calculators fully client-side with no backend. */
  function store(key) {
    var full = 'tn-hvac-' + key;
    return {
      read: function (fallback) {
        try {
          var raw = localStorage.getItem(full);
          return raw ? JSON.parse(raw) : fallback;
        } catch (e) { return fallback; }
      },
      write: function (data) {
        try { localStorage.setItem(full, JSON.stringify(data)); } catch (e) {}
      },
      clear: function () {
        try { localStorage.removeItem(full); } catch (e) {}
      }
    };
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csv(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  H.ui = {
    number: number, select: select, row: row, segmented: segmented,
    bindSegmented: bindSegmented, segmentedValue: segmentedValue,
    primary: primary, metrics: metrics, notice: notice, formulas: formulas,
    pageHead: pageHead, val: val, text: text, set: set, html: html,
    live: live, store: store, download: download, csv: csv, esc: esc
  };
})();
