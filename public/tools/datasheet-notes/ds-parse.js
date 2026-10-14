/* ============================================================
   Datasheet Notes - reader for the Daikin AHU technical report
   (ASTRAWEB selection software, text-based PDF), plus the shared
   parts every reader uses (lines, rows, keys, mapping rules, grid).
   The FCU reader is in ds-fcu.js and registers itself in DSParse.readers.

   DSParse.lines(items, pageNo)  pdf.js text items -> lines of cells
   DSParse.parseAll(pages)       lines of every page -> [structured data, one per unit]
                                 (picks the reader from the pages: DSParse.detect)
   DSParse.rows(data, choice)    one unit -> every row, each with a mapping key
   DSParse.grid(units, choice, mapping)   all units + the admin's row mapping -> the table
                                 (one column per unit tag)

   Rule: the reader adds and assumes nothing. Every value is text
   printed on the datasheet; wording is changed only by the admin's
   row mapping (Product Options > Row mapping). The reader rearranges
   three things:
   - "A • B" labels with "x • y" values become one row each
   - two filters printed in one section are shown as Filter 1 / Filter 2
   - the Options List lines are placed under their own section
   ============================================================ */
(function () {
  'use strict';

  var SKIP = /^(Technical Report\s*•|The certified standard performances|\d+\s*\/\s*\d+$)/;
  var TOP  = /^(EN\s*13053|Section List|Options List|Sound Report|NRVU\b.*|Electrical Power Inputs Data)$/i;
  var NUMBERED = /^(\d+)\)\s*(.+)$/;
  var FACTORY = { '9': 'Riyadh', '5': 'Dubai' };   // last character of the Material Name, e.g. ADN10FGW9
  var CELL_GAP = 25;      // points between two pieces of text that makes them separate cells
  var DOT = /\s*•\s*/;

  function clean(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  /* A superscript is printed as its own tiny item (the "3" of m³) a little above its line, and the
     host item carries a space where it belongs: "Air Flow(m /h)". The digit goes back into the host
     as ² or ³ so the row reads as printed. Only one or two digits are taken; anything longer is
     tiny print (energy label) and is left alone. */
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function superscripts(list) {
    var tiny = list.filter(function (it) { return it.h < 7.5 && /^\d{1,2}$/.test(it.s.trim()); });
    if (!tiny.length) return list;
    tiny.forEach(function (t) {
      var host = list.filter(function (h) {
        return h !== t && h.h >= 8 && t.y - h.y >= 2 && t.y - h.y <= 7 && t.x >= h.x && t.x <= h.x + h.w + 1;
      })[0];
      if (!host || !host.w) return;
      var sup = t.s.trim().split('').map(function (d) { return SUP[d]; }).join('');
      var at = Math.round((t.x - host.x) / host.w * host.s.length), s = host.s, i;
      for (i = 0; i <= 2; i++) {                                   // the space left for it, if there is one
        if (s[at - i] === ' ') { host.s = s.slice(0, at - i) + sup + s.slice(at - i + 1); t.used = true; return; }
        if (s[at + i] === ' ') { host.s = s.slice(0, at + i) + sup + s.slice(at + i + 1); t.used = true; return; }
      }
      at = Math.max(0, Math.min(s.length, at));
      host.s = s.slice(0, at) + sup + s.slice(at); t.used = true;
    });
    return list.filter(function (it) { return !it.used; });
  }

  /* ---- pdf.js items of one page -> lines, top to bottom ----
     Each line: { page, y, x, h, cells, text, items }
       cells  pieces of text separated by a gap of CELL_GAP or more (label | value for the AHU report)
       items  every piece as printed { x, w, h, s, f } (f = font name), for readers that split by column */
  function lines(items, pageNo) {
    var list = items
      .filter(function (it) { return it.str && it.str.trim(); })
      .map(function (it) {
        return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0,
                 h: Math.abs(it.transform[3]) || it.height || 10, f: it.fontName || '' };
      });
    list = superscripts(list)
      .filter(function (it) { return it.h >= 6; })          // tiny print inside the energy label picture
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; });

    var rows = [];
    list.forEach(function (it) {
      var last = rows[rows.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    });

    return rows.map(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [], end = null, h = 0;
      r.items.forEach(function (it) {
        h = Math.max(h, it.h);
        var cur = cells[cells.length - 1];
        if (cur && it.x - end <= CELL_GAP) cur.s += (it.x - end > 1 ? ' ' : '') + it.s;
        else cells.push({ x: it.x, s: it.s });
        end = it.x + it.w;
      });
      cells.forEach(function (c) { c.s = clean(c.s); });
      return { page: pageNo, y: r.y, x: cells[0].x, h: h, cells: cells,
               text: cells.map(function (c) { return c.s; }).join(' '),
               items: r.items.map(function (it) { return { x: it.x, w: it.w, h: it.h, s: clean(it.s), f: it.f }; }) };
    });
  }

  /* ---- most common text height = body text; anything taller is a heading ---- */
  function bodyHeight(pages) {
    var count = {}, best = 10, n = 0;
    pages.forEach(function (pg) { pg.forEach(function (ln) {
      var k = Math.round(ln.h * 2) / 2; count[k] = (count[k] || 0) + 1;
      if (count[k] > n) { n = count[k]; best = k; }
    }); });
    return best;
  }

  function parse(pages) {
    var body = bodyHeight(pages);
    var hdr = {}, unit = { rows: [], options: [] }, sections = [], warnings = [], elec = [];
    var mode = 'head', sec = null, sub = '', optTarget = null;
    var valueX = null, labelX = null, lastY = null, lastRow = null, secHeadH = null;

    function target() { return mode === 'unit' ? unit : sec; }

    pages.forEach(function (pg) {
      lastY = null;                                  // a block carries on across a page break
      pg.forEach(function (ln) {
        var text = ln.text;
        if (SKIP.test(text)) return;
        var heading = ln.h >= body + 0.8;
        var m = NUMBERED.exec(text);

        if (/^Electrical Power Inputs Data$/i.test(text)) { mode = 'elec'; return; }
        if (mode === 'elec') {
          // table rows: Component | Electrical Connection | Absorbed power - current
          if (!heading && ln.cells.length >= 2) elec.push({ component: ln.cells[0].s, connection: ln.cells[1].s });
          if (!heading || /Component|Electrical Connection|Absorbed|Current/i.test(text)) return;
          mode = 'skip';          // the table has ended; the heading that ends it is read as any other heading
        }

        if (heading) {
          if (/^Unit Data$/i.test(text)) { mode = 'unit'; lastRow = null; return; }
          if (/^Options List$/i.test(text)) { mode = 'options'; optTarget = null; return; }
          if (mode === 'options') {
            if (/^Unit Options$/i.test(text)) { optTarget = unit; return; }
            if (m) {
              optTarget = sections.filter(function (s) { return s.no === m[1]; })[0] || null;
              if (!optTarget) warnings.push('Options for "' + text + '" have no matching section in the datasheet and were left out.');
              else if (optTarget.name !== clean(m[2])) warnings.push('Options list names section ' + m[1] + ' "' + clean(m[2]) + '" but the section is "' + optTarget.name + '". Check these options.');
              return;
            }
            mode = 'skip'; return;
          }
          if (m) {
            mode = 'section'; sub = ''; lastRow = null; lastY = null; secHeadH = ln.h;
            sec = { no: m[1], name: clean(m[2]), rows: [], options: [], page: ln.page };
            sections.push(sec);
            return;
          }
          if (mode === 'section') {
            if (TOP.test(text) || (secHeadH && ln.h >= secHeadH)) { mode = 'skip'; return; }
            sub = text; lastY = null; lastRow = null;  // sub-heading: Damper One Supply, Geometry, Cooling, Motor Data
            return;
          }
          if (mode === 'head') {
            var pm = /^Project\s+(.+)$/.exec(text), um = /^Unit\s+(.+)$/.exec(text);
            if (pm) hdr.project = pm[1]; else if (um) hdr.unit = um[1];
            return;
          }
          mode = 'skip';
          return;
        }

        if (mode === 'head') {
          var c0 = ln.cells[0].s, c1 = ln.cells[1] ? ln.cells[1].s : '';
          if (/^Technical Report$/i.test(c0) && c1) hdr.date = c1;
          else if (/^Material Name$/i.test(c0) && c1) hdr.material = c1;
          else if (/^Ref\.\s*/i.test(c1)) { hdr.software = c0; hdr.reference = c1.replace(/^Ref\.\s*/i, ''); }
          return;
        }

        if (mode === 'unit' || mode === 'section') {
          var t = target();
          if (ln.cells.length >= 2) {
            // a wide empty gap after a sub-block ends it (Recirculated Air / Drain Pan after the dampers)
            if (mode === 'section' && sub && lastY !== null && lastY - ln.y > body * 2.8) sub = '';
            lastRow = { sub: mode === 'section' ? sub : '', param: ln.cells[0].s,
                        value: ln.cells.slice(1).map(function (c) { return c.s; }).join(' '), page: ln.page };
            t.rows.push(lastRow);
            labelX = ln.cells[0].x; valueX = ln.cells[1].x; lastY = ln.y;
            return;
          }
          var cell = ln.cells[0];
          if (valueX !== null && cell.x >= valueX - 12) {         // value wrapped onto a second line
            if (lastRow) { lastRow.value += ' ' + cell.s; lastY = ln.y; }
            return;
          }
          if (/:$/.test(cell.s)) return;                          // group label, e.g. "Specific fan power efficiency rating:"
          if (labelX !== null && Math.abs(cell.x - labelX) <= 4) { // label printed with no value
            lastRow = { sub: mode === 'section' ? sub : '', param: cell.s, value: '', page: ln.page };
            t.rows.push(lastRow); lastY = ln.y;
            return;
          }
          // free text under a block, e.g. "Calculated in Wet Condition": kept with the block it is printed in
          t.rows.push({ sub: mode === 'section' ? sub : '', param: 'Note', value: cell.s, page: ln.page });
          lastRow = null;
          return;
        }

        if (mode === 'options' && optTarget) optTarget.options.push(text);
      });
    });

    sections.forEach(splitFilters);

    // Power supply = the Electrical Connection printed for Fan Supply in "Electrical Power Inputs Data".
    var fan = elec.filter(function (e) { return /^Fan Supply$/i.test(e.component); })[0] ||
              elec.filter(function (e) { return /^Fan\b/i.test(e.component); })[0];
    // Factory = the last character of the Material Name (owner's rule): ...9 Riyadh, ...5 Dubai.
    var code = clean(hdr.material || '').slice(-1);
    if (FACTORY[code]) hdr.factory = FACTORY[code];
    else warnings.push(hdr.material ? 'The Material Name "' + hdr.material + '" does not end in ' + Object.keys(FACTORY).join(' or ') + ', so the factory is not known and the Factory row is missing.'
                                    : 'No Material Name was found on the datasheet, so the Factory row is missing.');

    if (fan) { hdr.power = fan.connection; hdr.powerFrom = fan.component; }
    else warnings.push('No Fan Supply line was found under "Electrical Power Inputs Data", so the Power Supply row is missing.');
    return { type: 'ahu', hdr: hdr, unit: unit, sections: sections, warnings: warnings, elec: elec };
  }

  /* ---- readers, one per product id (the id used in cm_products) ----
     Each: { name, starts(page lines) -> true when this page starts a unit, parse(pages) -> unit data,
             unitBlock, sectionsName (words used in notices) }.
     The AHU reader is in this file; others register themselves (ds-fcu.js). */
  var readers = {
    ahu: { name: 'Daikin AHU technical report (ASTRAWEB)', unitBlock: 'Unit Data', sectionsName: 'numbered sections',
           starts: function (pg) { return pg.some(function (ln) { return /^Unit Data$/i.test(ln.text); }); },
           parse: parse,
           factories: Object.keys(FACTORY).map(function (k) { return FACTORY[k]; }) }   // the factories a datasheet can name
  };

  /* Which reader a PDF needs: the first reader whose start page is found. */
  function detect(pages) {
    var ids = Object.keys(readers);
    for (var i = 0; i < ids.length; i++) {
      var r = readers[ids[i]];
      if (r.starts && pages.some(r.starts)) return ids[i];
    }
    return null;
  }

  /* One PDF can hold several units, each starting on a page the reader recognises (the "Unit Data"
     heading for an AHU, the report title for an FCU). Pages are cut into one block per unit and
     each block is read on its own. A PDF no reader recognises is read as an AHU, which gives the
     "nothing found" message in ds-read.js. */
  function parseAll(pages) {
    var id = detect(pages) || 'ahu', r = readers[id], starts = [];
    pages.forEach(function (pg, i) { if (r.starts(pg)) starts.push(i); });
    if (starts.length < 2) return [r.parse(pages)];
    return starts.map(function (from, k) {
      return r.parse(pages.slice(k === 0 ? 0 : from, k + 1 < starts.length ? starts[k + 1] : pages.length));
    });
  }

  /* One filter section can hold two filters: a repeated "Filter Class" starts the next one. */
  function splitFilters(s) {
    var starts = [];
    s.rows.forEach(function (r, i) { if (!r.sub && /^Filter Class$/i.test(r.param)) starts.push(i); });
    if (starts.length < 2) return;
    starts.forEach(function (from, k) {
      var to = k + 1 < starts.length ? starts[k + 1] : s.rows.length;
      for (var i = from; i < to; i++) if (!s.rows[i].sub) s.rows[i].sub = 'Filter ' + (k + 1);
    });
  }

  /* "Panel • Insulation" = "62 mm • Foam"  ->  Panel: 62 mm, Insulation: Foam.
     A short second label takes its meaning from the first one:
     "Temp. Dry Bulb In • Out" -> "Temp. Dry Bulb In", "Temp. Dry Bulb Out". */
  var STANDALONE = /^(Door|Altitude|Rows|Insulation)$/i;
  function expand(param, value) {
    var lp = param.split(DOT), vp = value.split(DOT);
    if (lp.length < 2 || lp.length !== vp.length) return [{ param: param, value: value }];
    var words = lp[0].split(' ');
    return lp.map(function (l, i) {
      var name = l;
      if (i > 0 && l.indexOf(' ') < 0 && words.length > 1 && !STANDALONE.test(l)) {
        var base = words.slice(0, -1);
        while (base.length > 1 && /^(Diam|Dia)\.?$/i.test(base[base.length - 1])) base.pop();
        name = base.join(' ') + ' ' + l;
      }
      return { param: name, value: vp[i] };
    });
  }

  /* ---- structured data + the user's choices -> every row the datasheet gives ----
     Each row: { group, title, sub, component, value, key }
       group  section name without its number ("Filter Supply"); rows of every section
              with the same name share their mapping
       title  what is printed in the Section column ("2) Filter Supply")
       key    what the admin's row mapping is stored under: group | sub | component.
              "Filter 1" / "Filter 2" are left out of the key so one rule covers every filter. */
  function norm(s) { return clean(s).toLowerCase(); }
  function rowKey(group, sub, component) {
    return norm(group) + '|' + (/^Filter \d+$/i.test(sub) ? '' : norm(sub)) + '|' + norm(component);
  }

  function rows(data, choice) {
    var out = [], count = {};
    function push(group, title, nth, sub, component, value) {
      out.push({ group: group, title: title, nth: nth, sub: sub, component: component, value: value, key: rowKey(group, sub, component) });
    }
    function body(group, title, nth, t) {
      var subs = [];
      function add(r) { expand(r.param, r.value).forEach(function (e) { push(group, title, nth, r.sub, e.param, e.value); }); }
      t.rows.forEach(function (r) { if (!r.sub) add(r); else if (subs.indexOf(r.sub) < 0) subs.push(r.sub); });
      subs.forEach(function (s) { t.rows.forEach(function (r) { if (r.sub === s) add(r); }); });
      t.options.forEach(function (o) { push(group, title, nth, 'Options', 'Option', o); });
    }

    // The unit tag is the heading of the unit's column, so there is no "Unit" row.
    var h = data.hdr;
    function g(label, v) { if (v) push('General', 'General', 1, '', label, v); }
    g('Factory', h.factory); g('Product', choice && choice.product); g('Power Supply', h.power);
    g('Project', h.project); g('Reference', h.reference);
    g('Material Name', h.material); g('Selection Software', h.software); g('Report Date', h.date);
    body('Unit Data', 'Unit Data', 1, data.unit);
    data.sections.forEach(function (s) {
      count[s.name] = (count[s.name] || 0) + 1;          // 2nd, 3rd ... section with the same name in this unit
      body(s.name, s.no ? s.no + ') ' + s.name : s.name, count[s.name], s);   // FCU sections carry no number
    });
    return out;
  }

  /* An admin response: empty = the datasheet value, plain text = a standard response,
     $ or * inside the text = the place where the datasheet value goes. */
  function fill(response, value, strip) {
    var v = remove(value, strip), r = clean(response || '');
    if (!r) return v;
    return r.replace(/[$*]/g, function () { return v; });
  }

  /* "Remove from value": text the admin wants taken out of the datasheet value before it is used,
     e.g. "+ PE" turns "380V/3Ph/60Hz + PE" into "380V/3Ph/60Hz". Several texts are separated by ";".
     Upper and lower case are treated the same. */
  function remove(value, strip) {
    var v = String(value == null ? '' : value);
    String(strip || '').split(';').forEach(function (part) {
      part = clean(part);
      if (!part) return;
      var re = new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*'), 'gi');
      v = v.replace(re, ' ');
    });
    return clean(v);
  }

  /* ---- every unit + the admin's mapping -> the table that is shown and exported ----
     units:   [data, ...] from parseAll()
     mapping: { showUnmapped: true|false, rules: { key: { show, label, strip, response } } }
     Out: { columns: [unit tag, ...], rows: [{ section, component, cells: [one per unit], marks, kind }] }
       marks: per cell, 0 = same as the first unit, 1, 2 ... = 1st, 2nd ... different value (see marks()).
       kind = 'row' | 'sub'. section is filled on the first row of a section only. A sub-heading
       is written only when at least one of its rows is shown.

     One unit: the Section column shows the datasheet's own heading ("2) Filter Supply").
     Several units: section numbers differ from unit to unit, so rows are lined up by section
     NAME (2nd, 3rd section of the same name as "Filter Supply (2)" ...), sub-heading and
     component. Option lines are lined up by their text. A unit that does not have a row
     gets "-" in its cell. */
  var MISSING = '-';

  /* The first unit is the reference. For one row: 0 = same as the first unit, 1 = the first
     different value, 2 = the next different value ... so equal deviations share a number
     (and a colour). Compared as printed in the table, ignoring case and spacing. */
  function marks(cells) {
    var seen = [norm(cells[0])];
    return cells.map(function (c) {
      var k = norm(c), i = seen.indexOf(k);
      if (i < 0) { seen.push(k); i = seen.length - 1; }
      return i;
    });
  }
  function optionId(text) { return norm(text).replace(/^\d+\s*x\s+/, ''); }

  function tags(units) {
    var seen = {};
    return units.map(function (u, i) {
      var t = clean(u.hdr.unit || '') || 'Unit ' + (i + 1);
      seen[t] = (seen[t] || 0) + 1;
      return seen[t] > 1 ? t + ' (' + seen[t] + ')' : t;
    });
  }

  function grid(units, choice, mapping) {
    var rules = (mapping && mapping.rules) || {}, unmapped = !mapping || mapping.showUnmapped !== false;
    var many = units.length > 1, merged = [], byId = {};

    units.forEach(function (data, u) {
      var pos = -1, dup = {};
      rows(data, choice).forEach(function (r) {
        var id = norm(r.group) + '#' + r.nth + '|' + norm(r.sub) + '|';
        if (r.sub === 'Options') id += optionId(r.value);
        else { id += norm(r.component); dup[id] = (dup[id] || 0) + 1; if (dup[id] > 1) id += '#' + dup[id]; }
        var m = byId[id];
        if (m) pos = Math.max(pos, merged.indexOf(m));
        else {
          m = byId[id] = { key: r.key, sub: r.sub, component: r.component, values: [],
                           title: many ? r.group + (r.nth > 1 ? ' (' + r.nth + ')' : '') : r.title };
          merged.splice(++pos, 0, m);                      // a row only a later unit has goes after the row before it
        }
        m.values[u] = r.value;
      });
    });

    var out = [], title = null, sub = '', blank = units.map(function () { return ''; });
    merged.forEach(function (m) {
      var rule = rules[m.key];
      if (rule ? rule.show === false : !unmapped) return;
      var first = m.title !== title;
      if (first) { title = m.title; sub = ''; }
      if (m.sub !== sub) {
        sub = m.sub;
        if (sub) { out.push({ section: first ? title : '', component: sub, cells: blank, kind: 'sub' }); first = false; }
      }
      var cells = units.map(function (x, u) { return m.values[u] === undefined ? MISSING : fill(rule && rule.response, m.values[u], rule && rule.strip); });
      out.push({ section: first ? title : '', component: (rule && clean(rule.label || '')) || m.component, kind: 'row',
                 cells: cells, marks: marks(cells), key: m.key });
    });
    return { columns: tags(units), rows: out };
  }

  window.DSParse = { readers: readers, detect: detect, clean: clean, lines: lines, parse: parse, parseAll: parseAll,
                     rows: rows, grid: grid, fill: fill, expand: expand, rowKey: rowKey };
})();
