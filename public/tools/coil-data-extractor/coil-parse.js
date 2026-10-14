/* =====================================================================
   coil-parse.js — turns coil selection quotations into one table.

   Written for WinCoil quotations (Oasis Coils & Coatings), which print one
   coil per block: a "Reference:" row, then PHYSICAL / AIR / FLUID DATA rows
   of  label | metric value | metric unit | imperial value | imperial unit,
   then a PRICING row with the coil code and quantity.

   Both inputs are first reduced to the same thing — a list of rows, each a
   list of cell strings — and ONE interpreter reads those rows. That is why a
   Word file and a PDF of the same selection give the same columns:

     .docx  -> unzip word/document.xml (+ header*.xml) -> table rows
     .pdf   -> pdf.js text items -> grouped into rows by baseline and into
               cells by the gap between items

   Nothing in the interpreter knows the field names. Every labelled row
   becomes a column, so a quotation that adds a field gains a column instead
   of silently losing it. The Python script this replaces held a fixed
   keyword list and dropped everything else.

   Pure logic, no DOM: loads in a worker, a page, or Node (see
   _dev/test-coil-extract.js). Exposes self.coilParse.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     ZIP reading — just enough for a .docx. The browser's own
     DecompressionStream inflates the entries, so no zlib is shipped.
     ------------------------------------------------------------------ */
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser cannot open .docx files. Try a current Chrome, Edge or Firefox.');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* Returns Map(name -> text) for the entries `want` accepts. */
  async function unzipText(buffer, want) {
    var d = new Uint8Array(buffer);
    var eocd = -1;
    for (var i = d.length - 22; i >= Math.max(0, d.length - 66000); i--) {
      if (u32(d, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a .docx file (no zip directory found)');
    var count = u16(d, eocd + 10);
    var ptr = u32(d, eocd + 16);
    var out = new Map();
    for (var n = 0; n < count; n++) {
      if (u32(d, ptr) !== 0x02014b50) break;
      var method = u16(d, ptr + 10);
      var compSize = u32(d, ptr + 20);
      var nameLen = u16(d, ptr + 28);
      var extraLen = u16(d, ptr + 30);
      var commentLen = u16(d, ptr + 32);
      var localOff = u32(d, ptr + 42);
      var name = new TextDecoder().decode(d.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;
      if (!want(name)) continue;
      var start = localOff + 30 + u16(d, localOff + 26) + u16(d, localOff + 28);
      var raw = d.subarray(start, start + compSize);
      var bytes = method === 0 ? raw : await inflateRaw(raw);
      out.set(name, new TextDecoder().decode(bytes));
    }
    return out;
  }

  /* ------------------------------------------------------------------
     DOCX -> rows. A tag scanner rather than DOMParser so the same code
     runs in Node for the tests. Word XML is machine-written and regular
     enough for this; the one trap is mc:Fallback, which repeats text-box
     content a second time for old readers, so it is skipped.
     ------------------------------------------------------------------ */
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      var k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k[1] === 'x') return String.fromCodePoint(parseInt(k.slice(2), 16));
      return String.fromCodePoint(parseInt(k.slice(1), 10));
    });
  }

  function docxRows(xml, where) {
    var rows = [];
    var re = /<(\/?)(w:tbl|w:tr|w:tc|w:p|w:t|w:tab|w:br|w:cr|w:noBreakHyphen|mc:Fallback)(?=[\s>\/])[^>]*?(\/?)>|([^<]+)/g;
    var rowStack = [];      // open rows, innermost last (nested tables)
    var cellStack = [];     // open cells, innermost last
    var para = null;        // text of a paragraph outside any table
    var inText = false;
    var fallback = 0;
    var tableNo = 0;
    var m;

    function sink(s) {
      if (fallback) return;
      if (cellStack.length) cellStack[cellStack.length - 1].text += s;
      else if (para !== null) para += s;
    }

    while ((m = re.exec(xml))) {
      if (m[4] !== undefined) { if (inText) sink(decodeEntities(m[4])); continue; }
      var closing = m[1] === '/';
      var selfClose = m[3] === '/';
      var tag = m[2];
      switch (tag) {
        case 'mc:Fallback':
          if (!selfClose) fallback += closing ? -1 : 1;
          break;
        case 'w:tbl':
          if (!closing) tableNo++;
          break;
        case 'w:tr':
          if (!closing) rowStack.push({ cells: [], where: where + ' · table ' + tableNo });
          else {
            var row = rowStack.pop();
            if (row) rows.push(row);
          }
          break;
        case 'w:tc':
          if (!closing) cellStack.push({ text: '' });
          else {
            var cell = cellStack.pop();
            if (cell && rowStack.length) rowStack[rowStack.length - 1].cells.push(cell.text);
          }
          break;
        case 'w:p':
          if (cellStack.length) {
            if (closing) cellStack[cellStack.length - 1].text += ' ';
          } else if (!closing && !selfClose) {
            para = '';
          } else if (closing && para !== null) {
            rows.push({ cells: [para], where: where });
            para = null;
          }
          break;
        case 'w:t':
          inText = !closing && !selfClose;
          break;
        case 'w:tab': case 'w:br': case 'w:cr':
          if (!closing) sink(' ');
          break;
        case 'w:noBreakHyphen':
          if (!closing) sink('-');
          break;
      }
    }
    return rows;
  }

  async function rowsFromDocx(buffer) {
    var parts = await unzipText(buffer, function (n) {
      return n === 'word/document.xml' || /^word\/header\d*\.xml$/.test(n);
    });
    if (!parts.has('word/document.xml')) throw new Error('no word/document.xml inside — not a Word file');
    var rows = [];
    /* Headers first: WinCoil puts Customer / Your Ref. / Date there, and the
       interpreter carries the latest header values onto every coil after it. */
    Array.from(parts.keys()).filter(function (n) { return n !== 'word/document.xml'; }).sort()
      .forEach(function (n) { rows = rows.concat(docxRows(parts.get(n), 'header')); });
    return rows.concat(docxRows(parts.get('word/document.xml'), 'body'));
  }

  /* ------------------------------------------------------------------
     PDF text items -> rows. pdf.js hands back runs, often split inside a
     word ("Y" "our" "R" "ef."), in no reliable order. Items are grouped
     into lines by baseline, sorted by x, then joined: touching runs join
     with nothing, runs a space apart join with a space, and anything
     further is a new cell. Table columns in these quotations sit ~100 pt
     apart, so the cell threshold has plenty of room either side.
     ------------------------------------------------------------------ */
  function pdfRows(items, where) {
    var list = items
      .filter(function (it) { return it.str && it.str.trim(); })
      .map(function (it) {
        return {
          s: it.str, x: it.transform[4], y: it.transform[5],
          w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 9,
        };
      })
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; });

    var lines = [];
    list.forEach(function (it) {
      var last = lines[lines.length - 1];
      /* Same line if the baselines are within a third of the text height —
         enough for a smaller font set in the same row ("Corrugated rippled
         edge" sits 0.9 pt off its label), not enough to merge two rows. */
      if (last && Math.abs(last.y - it.y) <= Math.max(2, it.h * 0.35)) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });

    return lines.map(function (line) {
      line.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [];
      var cur = null;
      line.items.forEach(function (it) {
        if (cur) {
          var gap = it.x - cur.end;
          if (gap < it.h * 0.12) { cur.text += it.s; cur.end = it.x + it.w; return; }
          if (gap < it.h * 0.7) { cur.text += ' ' + it.s; cur.end = it.x + it.w; return; }
          cells.push(cur.text);
        }
        cur = { text: it.s, end: it.x + it.w };
      });
      if (cur) cells.push(cur.text);
      return { cells: cells, where: where };
    });
  }

  /* ------------------------------------------------------------------
     Interpreter: rows -> coil records.
     ------------------------------------------------------------------ */
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* "~" and "-" are how the quotation says "not applicable". */
  function isBlank(v) { return v === '' || v === '~' || v === '-' || v === '\u2013'; }

  /* Something a value column holds, never a label. */
  function looksValue(t) { return isBlank(t) || /^-?\d[\d.,\/]*"?$/.test(t); }

  var HEADER_START = /^(customer|contact|mob)\b/i;
  var FOOTER_START = /^(yours faithfully|filename\b|version\b)/i;

  /* Keys kept from the page header. Contact and mobile describe who asked
     for the quote, not the coil, so they stay out of the table. */
  var META_KEYS = [
    { re: /^customer$/i, key: 'Customer' },
    { re: /^your ref\.?$/i, key: 'Your Ref.' },
    { re: /^our ref\.?$/i, key: 'Our Ref.' },
    { re: /^date$/i, key: 'Date' },
    { re: /^wincoil version$/i, key: 'WinCoil version' },
  ];

  function parseHeader(t, meta) {
    var keyRe = /^(customer|contact|mob|your ref\.?|our ref\.?|date|wincoil version)\s*:?\s*(.*)$/i;
    for (var i = 0; i < t.length; i++) {
      var m = keyRe.exec(t[i]);
      if (!m) continue;
      var key = m[1];
      var inline = clean(m[2]);
      var value = '';
      if (inline && inline !== ':') value = inline.replace(/^:\s*/, '');
      else {
        var j = i + 1;
        if (t[j] === ':') j++;
        if (j < t.length && !keyRe.test(t[j])) { value = t[j]; i = j; }
      }
      META_KEYS.forEach(function (k) { if (k.re.test(key.trim())) meta[k.key] = value; });
    }
  }

  function interpret(rows) {
    var meta = {};
    var items = [];
    var cur = null;
    var mode = 'none';          // none | data | pricing | closed
    var section = '';
    var lastField = null;       // field made by the previous row, for wrapped labels
    var pricedItem = false;

    rows.forEach(function (row) {
      var t = row.cells.map(clean).filter(Boolean);
      if (!t.length) return;
      var madeField = null;

      if (HEADER_START.test(t[0]) || t.some(function (x) { return /^wincoil version/i.test(x); })) {
        parseHeader(t, meta);
      } else if (FOOTER_START.test(t[0])) {
        if (cur) mode = 'closed';
      } else if (/^reference\s*:?$/i.test(t[0])) {
        var m = /^item\s*(\d+)\s*:\s*(.*)$/i.exec(t[1] || '');
        cur = {
          where: row.where,
          item: m ? Number(m[1]) : '',
          type: m ? clean(m[2]) : '',
          ref: m ? (t[2] || '') : (t[1] || ''),
          fields: [],
          desc: '', qty: '', notes: [],
          meta: Object.assign({}, meta),
        };
        items.push(cur);
        mode = 'data';
        section = '';
        pricedItem = false;
      } else if (!cur || mode === 'closed' || /^quotation$/i.test(t[0])) {
        /* outside a coil block — nothing to read */
      } else if (/^pricing$/i.test(t[0])) {
        mode = 'pricing';
      } else if (t.length === 1 && /^[A-Z][A-Z ]*DATA$/.test(t[0])) {
        section = t[0].replace(/\s*DATA$/, '');
        section = section.charAt(0) + section.slice(1).toLowerCase();
      } else if (mode === 'pricing') {
        /* "Item 10:" wraps onto two lines in the PDF, so item labels are
           dropped wherever they fall rather than expected in one place. */
        var p = t.filter(function (x) { return !/^item(\s*\d+\s*:?)?$/i.test(x) && !/^\d+\s*:$/.test(x); });
        if (!pricedItem) {
          var di = -1;
          p.forEach(function (x, k) { if (di < 0 && x.length >= 8 && /[a-z]/i.test(x) && /-/.test(x)) di = k; });
          if (di >= 0) {
            cur.desc = p[di];
            var q = p.slice(di + 1).filter(function (x) { return /^\d+$/.test(x); })[0];
            cur.qty = q ? Number(q) : '';
            pricedItem = true;
          }
        } else if (p.length) {
          cur.notes.push(p.join(' '));
        }
      } else if (looksValue(t[0])) {
        /* A row with values but no label. Kept only when it holds a value,
           and named after the row above so it can be traced back. */
        var v0 = t[0], iv0 = t.length >= 3 ? t[2] : '';
        if (!isBlank(v0) || !isBlank(iv0)) {
          var prev = cur.fields.length ? cur.fields[cur.fields.length - 1].label : section;
          madeField = addField(cur, section, 'Unlabelled after ' + prev,
            v0, t[1] || '', iv0, t[3] || '');
        }
      } else if (t.length === 1 && lastField && /^[a-z(]/.test(t[0])) {
        /* A label wrapped onto a second line ("Evaporating" / "temperature").
           The values sit on the first line, so only the label changes. */
        lastField.label += ' ' + t[0];
        madeField = lastField;
      } else {
        var r = t.slice(1);
        var v = r[0] || '', u = '', iv = '', iu = '';
        if (r.length >= 4) { u = r[1]; iv = r[2]; iu = r[3]; }
        else if (r.length === 3) { u = r[1]; iv = r[2]; }
        else if (r.length === 2) {
          if (r[0] === r[1] || looksValue(r[1])) iv = r[1];
          else u = r[1];
        }
        madeField = addField(cur, section, t[0], v, u, iv, iu);
      }
      lastField = madeField;
    });

    return { items: items, meta: meta };
  }

  function addField(item, section, label, v, u, iv, iu) {
    /* A label seen twice in one coil gets its section prefixed rather than
       overwriting the first value. */
    var taken = item.fields.some(function (f) { return f.label === label; });
    var f = {
      label: taken && section ? section + ' ' + label.charAt(0).toLowerCase() + label.slice(1) : label,
      section: section, v: v, u: u, iv: iv, iu: iu,
    };
    item.fields.push(f);
    return f;
  }

  /* ------------------------------------------------------------------
     Records -> one table. Columns are the union of every coil's fields,
     in the order the quotation prints them; a field that only some coils
     have is slotted in after the field it follows.
     ------------------------------------------------------------------ */
  function toCell(v) {
    v = clean(v);
    if (isBlank(v)) return '';
    return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }

  function header(label, unit) { return unit ? label + ' (' + unit + ')' : label; }

  function buildTable(records, opts) {
    opts = opts || {};
    var order = [];                 // field keys, in print order
    var info = new Map();           // key -> { label, u, iu, imperialDiffers }

    records.forEach(function (rec) {
      var prevKey = null;
      rec.item.fields.forEach(function (f) {
        var key = f.label + '\u0001' + f.u;
        if (!info.has(key)) {
          info.set(key, { label: f.label, u: f.u, iu: '', imperial: false });
          var at = prevKey ? order.indexOf(prevKey) + 1 : order.length;
          order.splice(at, 0, key);
        }
        var inf = info.get(key);
        if (f.iu && !inf.iu) inf.iu = f.iu;
        /* Imperial is only worth a column when it says something the metric
           column does not — a unit that differs, or a different value. */
        if (!isBlank(f.iv) && (f.iu ? f.iu !== f.u : f.iv !== f.v)) inf.imperial = true;
        prevKey = key;
      });
    });

    var LEAD = ['Source file', 'Location', 'Item', 'Reference', 'Coil type'];
    var TAIL = ['Coil code', 'Quantity', 'Notes', 'Customer', 'Your Ref.', 'Our Ref.', 'Date', 'WinCoil version'];

    var fieldCols = [];
    order.forEach(function (key) {
      var inf = info.get(key);
      fieldCols.push({ key: key, which: 'v', title: header(inf.label, inf.u) });
      if (opts.imperial && inf.imperial) {
        fieldCols.push({ key: key, which: 'iv', title: header(inf.label, inf.iu || 'imperial') });
      }
    });

    var columns = LEAD.concat(fieldCols.map(function (c) { return c.title; }), TAIL);
    var numeric = columns.map(function () { return false; });

    var rows = records.map(function (rec) {
      var it = rec.item;
      var byKey = new Map();
      it.fields.forEach(function (f) {
        var k = f.label + '\u0001' + f.u;
        if (!byKey.has(k)) byKey.set(k, f);
      });
      var row = [rec.file, it.where, it.item, it.ref, it.type];
      fieldCols.forEach(function (c) {
        var f = byKey.get(c.key);
        row.push(f ? toCell(f[c.which]) : '');
      });
      row.push(it.desc, it.qty, it.notes.join(' '),
        it.meta['Customer'] || '', it.meta['Your Ref.'] || '', it.meta['Our Ref.'] || '',
        it.meta['Date'] || '', it.meta['WinCoil version'] || '');
      row.forEach(function (v, i) { if (typeof v === 'number') numeric[i] = true; });
      return row;
    });

    return { columns: columns, rows: rows, numeric: numeric };
  }

  global.coilParse = {
    rowsFromDocx: rowsFromDocx,
    docxRows: docxRows,
    pdfRows: pdfRows,
    interpret: interpret,
    buildTable: buildTable,
  };
})(typeof self !== 'undefined' ? self : this);
