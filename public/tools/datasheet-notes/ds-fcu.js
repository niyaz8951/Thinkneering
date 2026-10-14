/* ============================================================
   Datasheet Notes - reader for the Daikin FAN COIL UNIT TECHNICAL
   REPORT (McQuay Smart Tools selection software, text-based PDF).
   Registers itself as DSParse.readers.fcu; ds-parse.js must load first.

   One page = one unit. The page has a title block (project, unit
   number, software, selection date), then headings printed in bold
   on a band (General, Configuration information, Cooling coil
   (Cooling Mode), Cooling coil (Heating Mode), Electric Heater,
   Acoustical performance / Sound pressure level (dB(A))), each with
   rows printed in TWO columns: label | value | label | value. The
   acoustic part is a table: an "Octave Band" row with the band names,
   then one row per position or speed with a value under each band.
   The "Note" lines at the foot of the page are not unit data.

   What the reader gives (same shape as the AHU reader):
     hdr      unit (the Unit No., used as the column heading), project,
              software, date, power (the Power Source row), factory (from
              the Software Name: McQuay Smart Tools = Shenzhen)
     unit     the rows under "General" = the Unit Data block
     sections every other heading in order, no section numbers
              acoustic rows: sub-heading = the row label (Lw Inlet + Rad,
              High speed ...), component = the band (63Hz ... Overall)

   Rule: nothing is added or assumed. Every value is text printed on
   the datasheet. Labels and values are told apart by their column
   position, not by the gap between them (a long label can end a few
   points before its value).
   ============================================================ */
(function () {
  'use strict';
  var P = window.DSParse, clean = P.clean;

  var TITLE = /^FAN COIL UNIT TECHNICAL REPORT$/i;
  // Factory from the Software Name in the title block (owner's rule, 2 Oct 2026): McQuay Smart Tools = Shenzhen.
  // Other software names are added here when the owner gives them.
  var FACTORY = [{ software: /^McQuay Smart Tools$/i, name: 'Shenzhen' }];
  var NOTE  = /^Notes?\s*:?$/i;
  var SAME_X = 3;          // points: two pieces of text start in the same column
  var SUB_GAP = 25;        // points: pieces closer than this belong to the same label or value

  function startsUnit(pg) { return pg.some(function (ln) { return TITLE.test(ln.text); }); }

  /* The most common font on the page is the body font; headings use the bold one. */
  function bodyFont(pages) {
    var count = {}, best = '', n = 0;
    pages.forEach(function (pg) { pg.forEach(function (ln) { ln.items.forEach(function (it) {
      count[it.f] = (count[it.f] || 0) + 1;
      if (count[it.f] > n) { n = count[it.f]; best = it.f; }
    }); }); });
    return best;
  }

  /* Column positions of one page, from where the text starts:
       left   x of the left labels (the left margin)
       right  x of the right labels (the most common start between 40% and 60% of the width)
       value  per half: x of the values (the most common start that is not the label start) */
  function columns(pg) {
    var xs = {}, width = 0;
    pg.forEach(function (ln) { ln.items.forEach(function (it) {
      var k = Math.round(it.x); xs[k] = (xs[k] || 0) + 1; width = Math.max(width, it.x + it.w);
    }); });
    var left = Infinity, right = null, rn = 0;
    Object.keys(xs).forEach(function (k) {
      var x = +k;
      if (x < left) left = x;
      if (x >= width * 0.4 && x <= width * 0.6 && xs[k] > rn) { rn = xs[k]; right = x; }
    });
    if (right === null) right = width / 2;
    function valueX(from, to, label) {
      var best = null, n = 0;
      Object.keys(xs).forEach(function (k) {
        var x = +k;
        if (x > from + SAME_X && x < to && Math.abs(x - label) > SAME_X && xs[k] > n) { n = xs[k]; best = x; }
      });
      return best;
    }
    return { left: left, right: right, leftValue: valueX(left, right - SAME_X, left), rightValue: valueX(right, width + 1, right) };
  }

  /* The pieces of one half of a line -> { label, value }. The label starts in the label column;
     the value starts in the value column (or, when the page has no clear value column, after a
     gap of SUB_GAP). Pieces between label start and value start belong to the label
     ("Running current" + "(A)"); pieces after the value start belong to the value. */
  function pair(items, labelX, valueX) {
    if (!items.length) return null;
    var label = [], value = [], inValue = false, end = null;
    items.forEach(function (it) {
      if (!inValue) {
        if (valueX !== null ? it.x >= valueX - SAME_X : (end !== null && it.x - end > SUB_GAP)) inValue = true;
      }
      (inValue ? value : label).push(it.s);
      end = it.x + it.w;
    });
    var hasLabel = Math.abs(items[0].x - labelX) <= SAME_X;
    if (!hasLabel) return { label: '', value: clean(label.concat(value).join(' ')) };
    return { label: clean(label.join(' ')), value: clean(value.join(' ')) };
  }

  function parse(pages) {
    var body = bodyFont(pages);
    var hdr = {}, unit = { rows: [], options: [] }, sections = [], warnings = [];
    var mode = 'head', sec = null, bands = null, last = { left: null, right: null };

    function target() { return sec || unit; }
    /* Rows are listed column by column (the left column of a block, then its right column), as the
       datasheet groups related figures by column; side 0 = left, 1 = right, 2 = acoustic table. */
    function addRow(sub, param, value, page, side) {
      var r = { sub: sub, param: param, value: value, page: page, side: side };
      target().rows.push(r);
      return r;
    }
    function byColumn(t) {
      t.rows = t.rows.map(function (r, i) { r.i = i; return r; })
        .sort(function (a, b) { return a.side - b.side || a.i - b.i; })
        .map(function (r) { delete r.side; delete r.i; return r; });
    }
    /* Title block. Two fields can share a line ("Software Name: McQuay Smart Tools   Selection date:17/7/2026"),
       so the line is cut at the field names. A field name counts only where the title block prints one:
       - at the start of a piece of text (a piece = text set apart by a gap), with or without a colon
         ("Unit No." is printed with or without one), or
       - further along, when it is followed by a colon ("... Selection date:17/7/2026"), or is "Unit No."
         with its full stop.
       The same words inside a value stay in the value: the project "Aramco Stadium Project" or
       "Project Unit No 5 Tower" is kept whole. A field that is already filled is not emptied. */
    var NAMES = 'Project|Unit No\\.?|Software Name|Software version|Selection date';
    var FIELD_START = new RegExp('^(' + NAMES + ')(?:\\s*:\\s*|\\s+|$)', 'i');
    var FIELD_START_NO = /^(Unit No\.)\s*:?\s*/i;                       // "Unit No.FCU-01"
    var FIELD_INSIDE = new RegExp('\\s(' + NAMES + ')\\s*:\\s*|\\s(Unit No\\.)\\s*', 'gi');
    var head = {};
    function headCell(text) {
      var m = FIELD_START_NO.exec(text) || FIELD_START.exec(text);
      if (!m) return;
      var name = m[1], from = m[0].length, n;
      function put(to) {
        var k = name.replace(/\.$/, '').toLowerCase(), v = clean(text.slice(from, to));
        if (v || !head[k]) head[k] = v;
      }
      FIELD_INSIDE.lastIndex = from;
      while ((n = FIELD_INSIDE.exec(text))) {
        put(n.index);
        name = n[1] || n[2]; from = n.index + n[0].length;
      }
      put(text.length);
    }
    function headLine(ln) { ln.cells.forEach(function (c) { headCell(c.s); }); }

    pages.forEach(function (pg) {
      var col = columns(pg);
      pg.forEach(function (ln) {
        var text = ln.text, first = ln.items[0];
        if (mode === 'skip') return;
        if (TITLE.test(text)) { mode = 'head'; return; }
        if (mode === 'head') headLine(ln);

        // a bold line alone at the left margin is a heading; "Note" ends the unit
        var heading = ln.items.length === 1 && Math.abs(first.x - col.left) <= SAME_X && first.f !== body;
        if (heading) {
          bands = null; last = { left: null, right: null };
          if (/^General$/i.test(text)) { sec = null; mode = 'body'; return; }
          sec = { no: '', name: clean(text), rows: [], options: [], page: ln.page };
          sections.push(sec); mode = 'body';
          return;
        }
        if (mode !== 'body') return;
        if (NOTE.test(text) && Math.abs(first.x - col.left) <= SAME_X) { mode = 'skip'; return; }

        // acoustic table: the "Octave Band" row names the bands; the rows under it give one value per band
        if (/^Octave Band$/i.test(first.s)) {
          bands = ln.items.slice(1).map(function (it) { return { x: it.x, name: it.s }; });
          return;
        }
        if (bands && ln.items.length > 1 && Math.abs(first.x - col.left) <= SAME_X) {
          var vals = bands.map(function () { return []; });
          ln.items.slice(1).forEach(function (it) {
            var best = 0;
            bands.forEach(function (b, i) { if (Math.abs(it.x - b.x) < Math.abs(it.x - bands[best].x)) best = i; });
            vals[best].push(it.s);
          });
          bands.forEach(function (b, i) { addRow(first.s, b.name, clean(vals[i].join(' ')), ln.page, 2); });
          return;
        }

        // two columns: label | value | label | value, told apart by where the text starts
        var halves = { left: [], right: [] };
        ln.items.forEach(function (it) { halves[it.x < col.right - SAME_X ? 'left' : 'right'].push(it); });
        ['left', 'right'].forEach(function (side) {
          var p = pair(halves[side], side === 'left' ? col.left : col.right, side === 'left' ? col.leftValue : col.rightValue);
          if (!p) return;
          if (!p.label) {                                    // value wrapped onto the next line
            if (last[side]) last[side].value = clean(last[side].value + ' ' + p.value);
            else warnings.push('"' + p.value + '" on page ' + ln.page + ' has no label and was left out.');
            return;
          }
          if (!sec && /^Power Source$/i.test(p.label)) { hdr.power = p.value; hdr.powerFrom = p.label; return; }
          last[side] = addRow('', p.label, p.value, ln.page, side === 'left' ? 0 : 1);
        });
      });
    });

    byColumn(unit); sections.forEach(byColumn);
    hdr.project = head.project; hdr.unit = head['unit no']; hdr.date = head['selection date'];
    hdr.software = clean((head['software name'] || '') + ' ' + (head['software version'] || '')) || undefined;
    var sw = clean(head['software name'] || '');
    FACTORY.forEach(function (f) { if (!hdr.factory && f.software.test(sw)) hdr.factory = f.name; });
    if (!hdr.unit) warnings.push('No "Unit No." was found in the title block of the datasheet.');
    if (!hdr.power) warnings.push('No "Power Source" row was found under "General", so the Power Supply row is missing.');
    if (!hdr.factory) warnings.push(sw ? 'The Software Name "' + sw + '" is not known (McQuay Smart Tools = Shenzhen), so the factory is not known, the Factory row is missing and the values are not collected for Product Options.'
                                       : 'No Software Name was found in the title block, so the factory is not known and the Factory row is missing.');
    return { type: 'fcu', hdr: hdr, unit: unit, sections: sections, warnings: warnings, elec: [] };
  }

  P.readers.fcu = { name: 'Daikin FAN COIL UNIT TECHNICAL REPORT (McQuay Smart Tools)', unitBlock: 'General',
                    sectionsName: 'sections', starts: startsUnit, parse: parse,
                    factories: FACTORY.map(function (f) { return f.name; }) };   // the factories a datasheet can name
})();
