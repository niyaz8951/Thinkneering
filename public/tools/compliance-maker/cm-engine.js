/* ============================================================
   Compliance Maker - the conversion engine.
   Specification text or PDF in, classified rows out:
     { type: 'part' | 'section' | 'letter' | 'number' | 'text', sr, spec }
   No page, no database: used by the classic Compliance Maker page
   (compliance-maker.js) and by "Add a specification" in a project
   (tools/projects/add-spec.html). This is the only copy of the parser.

   CMEngine.fromText(text, { skipFront, keepBreaks })      -> { rows, info: [text], partial }
   CMEngine.fromPdf(file, { skipFront, onProgress(text) }) -> Promise of the same; rejects with a plain message
   CMEngine.parseLines, skipFrontMatter, dropPageFurniture, extractLinesFromTextContent, frontNote
   ============================================================ */
(function () {
  'use strict';

  /* Page ceiling. Nothing enforces this but this line — there is no server to
     disagree with it. It exists to stop a 400-page spec locking up the tab,
     not to ration anything. */
  var MAX_PAGES = 50;
  var CHARS_PER_PAGE = 3000;

  /* ======================================================================
     PARSER — lines to classified rows.
     ====================================================================== */

  var RE = {
    part:    /^(PART\s+[0-9IVX]+(?:\.0)?)(?![0-9A-Za-z.])\s*(.*)$/i,   // PART 1, PART II, PART 1.0
    section: /^(\d{1,2}\.\d{1,2})\.?\s+(.*)$/,     // 1.01, 1.1, 2.1, 1.3 and "3.2." with a full stop
    deep:    /^(\d{1,2}(?:\.\d{1,2}){2,4})\.?\s+(.*)$/,   // 1.2.1, 3.23.4, 2.1.1.1
    number:  /^(\d{1,2})\.\s+(.*)$/,               // 1.
    letter:  /^([A-Z])\.\s+(.*)$/,                 // A.
    letter2: /^(AA|BB|CC|DD|EE|FF|GG|HH|JJ|KK|LL|MM|NN|PP|QQ|RR|SS|TT|UU|VV|WW|XX|YY|ZZ)\.\s+(.*)$/,   // after Z comes AA.
    letterLoose: /^([a-zA-Z])[.)]\s+(.*)$/,
    roman:   /^(i{2,3}|iv|vi{1,3}|ix|xi{0,3}|II|III|IV|VI{1,3}|IX|XI{1,3})[.)]\s+(.*)$/,          // ii. iii) iv.  ("i." and "v." are letters above)
    paren:   /^\(([a-zA-Z]|i{1,3}|iv|vi{0,3}|ix|x|\d{1,2})\)\s+(.*)$/,   // (a) (iv) (2)
    // a list mark: a bullet glyph (also the private-use ones Word fonts put in a PDF), or a dash before a capital
    bullet:  /^(?:[\u2022\u2023\u2043\u25AA\u25AB\u25CF\u25CB\u25A0\u25A1\u25E6\u2219\u00B7\u27A2\u2794\u2713\uF000-\uF0FF]\s*|[-\u2013\u2014]\s+(?=[A-Z(]))(\S.*)$/
  };

  /* How the document numbers itself, decided once per document (parseLines):
       classic  "2.01 CASING": two-decimal numbers with a leading zero. Every x.xx is a section.
       deep     "1.2 Submittals" over "1.2.1 Product Data: ...": three-level numbers are in use, so a
                short x.y line with no verb is a heading even when it is not in Proper Case.
     A document that is neither keeps the heading test it always had. */
  var style = { classic: true, deep: false };
  var PARA = '\u2029';      // put in front of a PDF line that starts a new paragraph on the page
  var TABLE = '\u2028';     // put in front of a PDF line that is a row of a table (its cells are separated by " | ")

  // Mirrors the Excel tool's section test: a numbered heading is a blue
  // SECTION when its text is short and heading-shaped (Proper Case, ALL CAPS,
  // "CAPS-word + Proper rest", or ends with ":"). Otherwise it's a body row
  // (e.g. "1.1 The unit shall...") so it doesn't wrongly turn blue.
  function isSectionHeading(text) {
    if (!text) return true;                 // bare "1.3" with title on next line
    var words = text.split(/\s+/);
    if (words.length > 6) return false;      // long sentence -> not a heading
    if (/[.]/.test(text.replace(/:$/, ''))) return false; // decimals/periods inside -> not heading
    var stripped = text.replace(/:$/, '');
    var isCaps = stripped === stripped.toUpperCase();
    var isProper = words.every(function (w) {
      return !w || w[0] === w[0].toUpperCase() || SMALL.test(w);
    });
    var endsColon = /:$/.test(text);
    if (isCaps || isProper || endsColon) return true;
    // deep numbering: "2.1 Air Cooled packaged chillers" is the heading over 2.1.1, 2.1.2, ...
    return style.deep && words.length <= 5 && /^[A-Z]/.test(text) && !/[,;]$/.test(text) && !VERB.test(text);
  }
  var SMALL = /^(of|and|the|for|in|to|with|or|on|by|a|an|at|\/|&|-)$/;
  var VERB = /\b(shall|must|will|should|is|are|be|to)\b/i;
  // "1.0 SCOPE OF WORKS." and "3.0 AIR COOLED PACKAGE CHILLERS": the top level of a document without PART headings
  function topLevel(m) {
    var t = m[2].trim().replace(/[.:]$/, '');
    return /^\d{1,2}\.0$/.test(m[1]) && t.length > 2 && t === t.toUpperCase() && /[A-Z]{3}/.test(t);
  }

  // "2.02 CASING" is a section. A wrapped line that happens to start with a decimal
  // ("0.68 W/m2 °K ...", "1.52 mm (16 gage) ...") is not: sections start at 1 and their
  // title starts with a capitalised word, not a unit.
  function sectionMatch(line) {
    var m = line.match(RE.section);
    if (!m) return null;
    if (/^\d{1,2}\.\d{1,2}\.$/.test(line.split(/\s/)[0]) && !/^[A-Z]/.test(m[2])) return null;   // "3.2. the" inside a sentence
    var first = m[2].trim().split(/\s+/)[0] || '';
    if (/^0\./.test(m[1])) return null;
    if (first && /^[a-z]/.test(first) && RE_UNIT.test(first)) return null;        // "2.5 kW heater" at the start of a wrapped line
    if (first && !/^[A-Z][A-Za-z,&'’\-]*[:.]?$/.test(first)) {
      if (/^\d{1,2}\.\d{2}$/.test(m[1]) || !/^[A-Za-z]/.test(first)) return null;
    }
    return m;
  }

  function deepMatch(line) {
    var m = line.match(RE.deep);
    return m && /^[A-Z(\u201c"']/.test(m[2]) ? m : null;       // a clause opens with a capital; "1.2.3 mm" does not
  }
  // "PART 2 - PRODUCTS" is a heading. "Part I of the contract." at the start of a wrapped line is a sentence.
  function partMatch(line) {
    var m = line.match(RE.part);
    if (!m) return null;
    var rest = (m[2] || '').replace(/^[\s\-\u2013\u2014:.]+/, '');
    if (/^PART\s/.test(line) && (!rest || /^[A-Z]/.test(rest)) && !/\b(shall|and shall|of the)\b/.test(rest)) return m;
    return !/[.;,]$/.test(rest) && rest.split(/\s+/).length <= 6 && (!rest || /^[A-Z]/.test(rest)) && !/\b(of|shall|is|are|the)\b/i.test(rest) ? m : null;
  }
  function startsNewItem(line) {
    return !!partMatch(line) || !!deepMatch(line) || !!sectionMatch(line) ||
           RE.number.test(line) || RE.letter.test(line) || RE.letter2.test(line) ||
           RE.letterLoose.test(line) || RE.roman.test(line) || RE.paren.test(line) || RE.bullet.test(line);
  }

  function classify(line) {
    var m;
    if ((m = partMatch(line)))        return { type: 'part',    sr: m[1].toUpperCase(), spec: (m[2] || '').trim() };
    if ((m = deepMatch(line))) {
      // "2.1.3 Cooler / Evaporator" is a sub-heading, "1.2.1 Product Data : Submit ..." is a clause
      var dtext = m[2].trim();
      return { type: isSectionHeading(dtext.replace(/\s+:$/, ':')) ? 'section' : 'number', sr: m[1], spec: dtext };
    }
    if ((m = sectionMatch(line))) {
      var stext = m[2].trim();
      if (topLevel(m)) return { type: 'part', sr: m[1], spec: stext.replace(/\.$/, '') };
      // x.xx (two-decimal) is always a section in classic spec numbering ("2.01 CASING").
      // Otherwise a section only if it reads like a heading.
      var twoDecimal = style.classic && /^\d{1,2}\.\d{2}$/.test(m[1]);
      if (twoDecimal || isSectionHeading(stext)) {
        return { type: 'section', sr: m[1], spec: stext };
      }
      // Otherwise treat as a normal numbered body clause.
      return { type: 'number', sr: m[1], spec: stext };
    }
    if ((m = line.match(RE.number)))  return { type: 'number',  sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.letter)))  return { type: 'letter',  sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.letter2))) return { type: 'letter',  sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.letterLoose))) return { type: 'letter', sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.roman)))   return { type: 'letter', sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.paren)))   return { type: /^\d/.test(m[1]) ? 'number' : 'letter', sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.bullet)))  return { type: 'text', sr: '\u2022', spec: m[1].trim() };
    return { type: 'text', sr: '', spec: line.trim() };
  }

  /* ---------------------------------------------------------------------
     BARE LABELS — "1  Wheel Media", with no full stop after the number.

     Spec authors write these constantly, and every strict pattern above
     misses them, so the clause underneath is read as a wrap and glued on.
     That is the whole reason a five-clause paste came out as one row.

     Promoting any leading number would be worse than the bug. "25 mm
     nominal bore" and "2019 edition" open a line exactly the same way, and
     a number wrongly promoted to a label splits a clause in half — a
     failure that is much harder to spot in a 300-row matrix than a missed
     label is.

     What separates a label from a stray number is that labels COUNT. So
     candidates are collected first and only promoted where they form an
     ascending run: 1, 2, 3 in order. A lone number is promoted only when
     it is 1, which is a list beginning. "25 mm" has nothing before it and
     nothing after, so it stays part of its sentence.
     --------------------------------------------------------------------- */
  var RE_BARE = /^(\d{1,2})[ \t]+(\S.*)$/;

  // A label's text reads like the start of a clause. These open a
  // measurement or a count instead, so the number in front is a quantity.
  var RE_UNIT = /^(mm|cm|m|km|kg|g|lb|t|%|deg|k|hz|kw|kva|hp|w|v|a|bar|pa|kpa|psi|cfm|ls|m2|m3|nos?|off|x|to|and|or|of|per|min|mins|minutes|hour|hours|hrs|day|days|week|weeks|month|months|year|years|pcs|sets?|units?|copies|no)\b/i;

  function normaliseBareLabels(lines) {
    var runs = [], run = [];
    function closeRun() { if (run.length) runs.push(run); run = []; }

    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i]).replace(/\s+/g, ' ').trim();
      if (!line) continue;

      // A part or section header ends whatever list was running — numbering
      // restarts underneath it.
      if (RE.part.test(line) || RE.section.test(line)) { closeRun(); continue; }

      // Already labelled by a strict pattern; leave it alone.
      if (RE.number.test(line) || RE.letter.test(line) || RE.letterLoose.test(line) || RE.deep.test(line)) continue;

      var m = line.match(RE_BARE);
      if (!m) continue;
      var rest = m[2];

      // A clause opens with a capital. A quantity ("2 pumps and a tank")
      // usually does not, and that is the cheapest signal available that
      // tells the two apart mid-sentence.
      if (!/^[A-Z(\u201c"']/.test(rest)) continue;
      if (RE_UNIT.test(rest)) continue;

      var n = parseInt(m[1], 10);
      var cand = { i: i, n: n, sr: m[1], rest: rest };
      if (run.length && n === run[run.length - 1].n + 1) run.push(cand);
      else { closeRun(); run = [cand]; }
    }
    closeRun();

    var out = lines.slice();
    runs.forEach(function (r) {
      // Two or more in sequence is a list. One on its own is a list only if
      // it is the number 1.
      if (r.length < 2 && r[0].n !== 1) return;
      r.forEach(function (c) { out[c.i] = c.sr + '. ' + c.rest; });
    });
    return out;
  }

  // "END OF SECTION" closes a specification section. It is a divider, not a
  // clause — but it arrives at the tail of the last clause's line, where the
  // continuation rule would silently glue it onto that clause's text. So it
  // is split off first and emitted as its own black band row, the same
  // treatment a PART header gets.
  var END_OF_SECTION_RE = /[-\u2013\u2014\s]*\bend\s+of\s+section\b[-\u2013\u2014.:\s]*$/i;

  // opts.keepBreaks — treat every line as its own row instead of folding
  // unlabeled lines into the clause above. Only the paste path passes this;
  // a PDF's line breaks come from the page layout, not the author, so folding
  // them back together is the only way to recover the real clause there.
  // Control characters a PDF or a Word copy can carry are not text: drop them here so the
  // preview, the library and the Excel all hold the same clause.
  function stripInvalid(s) {
    return window.xlsxWriter && window.xlsxWriter.clean ? window.xlsxWriter.clean(s) : String(s);
  }

  function parseLines(rawLines, opts) {
    var keepBreaks = !!(opts && opts.keepBreaks);
    // how this document numbers itself (see "style" above)
    var flat = rawLines.map(function (l) { return String(l).replace(/\s+/g, ' ').trim(); });
    if (!(opts && opts.whole)) rawLines = splitInline(rawLines);        // whole: each line given is one row (a row being split by hand)
    flat = rawLines.map(function (l) { return String(l).replace(/\s+/g, ' ').trim(); });
    style = { classic: flat.some(function (l) { return /^\d{1,2}\.0\d\s/.test(l); }),
              deep: flat.filter(function (l) { return !!deepMatch(l); }).length >= 2 };
    if (!style.classic && !style.deep && !flat.some(function (l) { return /^\d{1,2}\.\d{1,2}\.?\s+[A-Z][a-z]+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S/.test(l); })) style.classic = true;
    if (opts && opts.style) style = { classic: !!opts.style.classic, deep: !!opts.style.deep };      // the caller knows the document (a row being split)
    var paraAt = rawLines.map(function (l) { l = String(l); return l.charAt(0) !== PARA ? 0 : l.charAt(1) === PARA ? 2 : 1; });
    var tableAt = rawLines.map(function (l) { return /^\u2029*\u2028/.test(String(l)); });
    // Promote bare labels before anything else looks at the lines, so the
    // rest of the parser sees one canonical label shape. The copy also keeps
    // the END OF SECTION splice below from mutating the caller's array.
    rawLines = normaliseBareLabels(rawLines);
    var rows = [];
    for (var i = 0; i < rawLines.length; i++) {
      // a bullet glyph from a symbol font is not valid text: read it as a list mark before the clean-up removes it
      var raw = String(rawLines[i]).replace(/\s+/g, ' ').trim(), mark = /^[\uF000-\uF0FF]/.test(raw);
      var line = stripInvalid(mark ? raw.replace(/^[\uF000-\uF0FF]\s*/, '') : raw).replace(/\s+/g, ' ').trim();
      if (!line) continue;
      if (mark) line = '\u2022 ' + line;
      var para = paraAt[i];

      var endMatch = opts && opts.whole ? null : line.match(END_OF_SECTION_RE);
      if (endMatch && endMatch.index > 0 && !/END\s+OF\s+SECTION/.test(endMatch[0])) endMatch = null;      // "... listed at the end of section." is a sentence
      if (endMatch) {
        // Whatever came before it on the same line is still a real clause,
        // so process that remainder first and let the divider follow.
        var before = line.slice(0, endMatch.index).trim();
        if (before) {
          rawLines.splice(i + 1, 0, 'END OF SECTION'); paraAt.splice(i + 1, 0, 0); tableAt.splice(i + 1, 0, false);
          line = before;
        } else {
          rows.push({ type: 'part', sr: '', spec: 'END OF SECTION' });
          continue;
        }
      }

      if (startsNewItem(line)) {
        rows.push(classify(line));
      } else if (tableAt[i] && !keepBreaks && (para || !/^[a-z]/.test(line) || !rows.length)) {
        // a row of a table is its own row, whatever is above it (a line that carries on in small letters is the end of a clause)
        rows.push({ type: 'text', sr: '', spec: line });
      } else if (!keepBreaks && rows.length && (rows[rows.length - 1].type === 'part' || rows[rows.length - 1].type === 'section') &&
                 !para && headingWrap(rows[rows.length - 1], line)) {
        // a heading in capitals that runs over two lines
        rows[rows.length - 1].spec = (rows[rows.length - 1].spec + ' ' + line).trim();
      } else if (!keepBreaks && rows.length &&
                 rows[rows.length - 1].type !== 'part' &&
                 rows[rows.length - 1].type !== 'section' &&
                 !(para && newParagraph(rows[rows.length - 1].spec, line, para === 2))) {
        // Wrapped continuation of the previous clause — append.
        rows[rows.length - 1].spec =
          (rows[rows.length - 1].spec + ' ' + line).trim();
      } else {
        // Unlabeled paragraph directly after a PART/section header (or at
        // the start) is its own body row — headers never absorb body text.
        rows.push({ type: 'text', sr: '', spec: line });
      }
    }
    rows.forEach(function (r) {
      if (r.type === 'part') {
        r.spec = (r.sr + (r.spec ? ' ' + r.spec : '')).trim();
        r.sr = '';
      }
    });
    return rows;
  }

  /* Clauses that came on one line: text pasted without its line breaks, or a PDF line that holds two.
     A line is cut before a clause number that continues the numbering the document is already in
     (3.11.1 then 3.11.2, or 3.11 then 3.11.1, or back up to 3.12), before the next letter of a
     list in brackets (a) ... b) ...), and at a bullet glyph. A number that does not continue the
     sequence ("see clause 4.2", "25.4 mm") is left alone. */
  function follows(last, cand) {
    var a = last.split('.').map(Number), c = cand.split('.').map(Number), k;
    if (c.length > a.length + 1) return false;
    if (c.length === 2 && c[0] === a[0] + 1 && c[1] <= 1) return true;                            // 2.4 -> 3.0 or 3.1
    var same = Math.min(a.length, c.length) - (c.length <= a.length ? 1 : 0);
    for (k = 0; k < same; k++) if (a[k] !== c[k]) return false;
    if (c.length === a.length + 1) return c[c.length - 1] === 1 || c[c.length - 1] === 0;       // 3.11 -> 3.11.1
    return c[c.length - 1] === a[c.length - 1] + 1;                                               // 3.11.1 -> 3.11.2, 3.11.7 -> 3.12
  }
  function splitInline(lines) {
    var out = [], lastNum = '', lastLet = '', partNo = 0;
    lines.forEach(function (raw) {
      raw = String(raw);
      var lead = (raw.match(/^[\u2028\u2029]+/) || [''])[0], text = raw.slice(lead.length), cuts = [], m;
      var ph = text.replace(/^\s+/, '').match(/^PART\s+(\d{1,2})/i); if (ph) { partNo = +ph[1]; lastNum = ''; }
      var head = text.replace(/^\s+/, '').match(/^(\d{1,2}(?:\.\d{1,2}){1,4})\.?\s+(?=[A-Z(])/);      // "1.5 x 2.0 metres" at the start of a wrapped line is not a label
      // A real line (a PDF line, a pasted line of normal length) holds one clause: a number inside it is part of the
      // sentence ("type 3.1 B", "shall not exceed 1.3 Pa"). Only a long run of text, pasted without its line
      // breaks, is searched for the numbers that start the next clauses.
      var blob = text.length > 320;
      if (head) { lastNum = head[1]; lastLet = ''; }
      var hl = text.replace(/^\s+/, '').match(/^\(?([a-z])\)\s/); if (hl) lastLet = hl[1];
      var re = /\s(?=PART\s+(\d{1,2})(?:\.0)?\s*[-\u2013:]?\s*[A-Z]{3})|\s(\d{1,2}(?:\.\d{1,2}){1,4})\.?\s+(?=[A-Z])|\s\(?([a-z])\)\s+(?=[A-Z])|\s(?=[\u2022\u25AA\u25CF\u25A0\uF0A7\uF0B7\uF0D8\uF0FC]\s*\S)/g;
      while ((m = re.exec(text)) !== null) {
        if (m[1]) { if (blob) { cuts.push(m.index); partNo = +m[1]; lastNum = ''; lastLet = ''; } }
        else if (m[2]) {
          if (!blob || /PART$/i.test(text.slice(0, m.index).trim())) continue;       // "PART 1.0 GENERAL": the number belongs to PART
          // after a PART heading the first number of that part starts the count ("PART 3 - EXECUTION 3.1 ...")
          if (lastNum ? follows(lastNum, m[2]) : (partNo && +m[2].split('.')[0] === partNo)) { cuts.push(m.index); lastNum = m[2]; lastLet = ''; }
        }
        else if (m[3]) {
          // "a) ... b) ..." in one line: a) starts the list when b) follows it
          if (!blob) continue;
          var first = m[3] === 'a' && /\s\(?b\)\s+[A-Z]/.test(text.slice(m.index));
          if (first || (lastLet && m[3].charCodeAt(0) === lastLet.charCodeAt(0) + 1)) { cuts.push(m.index); lastLet = m[3]; }
        }
        else if (m.index > 0) cuts.push(m.index);
      }
      if (!cuts.length) { out.push(raw); return; }
      var at = 0;
      cuts.forEach(function (c, k) { out.push((k ? PARA : lead) + text.slice(at, c)); at = c + 1; });
      out.push(PARA + text.slice(at));
    });
    return out;
  }

  // A PDF line that starts a new paragraph on the page (see extractLinesFromTextContent) is its own row
  // when the text above is a finished sentence and this line opens one. Anything else is a wrap.
  // Set apart by space on the page (apart): a new row unless the text above plainly runs on into it.
  function newParagraph(above, line, apart) {
    if (!/^[A-Z(\u201c"']/.test(line) || line.length < 4) return false;
    if (/[.:;)]$/.test(above)) return true;
    return !!apart && !/(,|-|\b(and|or|of|the|to|with|for|in|by|a|an|at|as|from|be|shall|is|are|on|than|that|which|per|not))$/i.test(above);
  }
  function headingWrap(head, line) {
    var t = head.spec;
    return t.length > 20 && t === t.toUpperCase() && line === line.toUpperCase() && /[A-Z]{3}/.test(line) && line.length < 80 && !/[.:]$/.test(t) &&
           line.split(/\s+/).length <= 7 && !/[.;]$/.test(line) && !/\b(SHALL|MUST|WILL|IS|ARE)\b/.test(line);       // a sentence in capitals is a clause, not the rest of the title
  }

  /* ======================================================================
     PDF READING
     ====================================================================== */

  /* Text items to lines (items on the same baseline are one line). A line that starts a new paragraph
     gets PARA in front (twice when both signs are there). Two signs, either is enough:
       - the space above it is clearly larger than the usual line spacing of the page;
       - the line above stops well short of the right edge of the text and ends a sentence.
     parseLines decides what to do with the mark; every other reader of the lines ignores it. */
  function extractLinesFromTextContent(tc) {
    var items = tc.items.filter(function (it) { return it.str !== undefined; });
    var lines = [];
    items.forEach(function (it) {
      var x = it.transform[4], y = it.transform[5], cur = null;
      // same baseline as one of the last few lines: the same line (a table row is not always written left to right in one go)
      // (only across a column gap: text that carries on right after a superscript stays in reading order)
      for (var b = lines.length - 1; b >= 0 && b >= lines.length - 4; b--) {
        if (Math.abs(y - lines[b].y) > 2) continue;
        var small = lines[lines.length - 1].h > 0 && (it.height || 0) < lines[lines.length - 1].h * 0.8;      // a superscript
        if (b === lines.length - 1 || (it.str.trim() && !small && x - lines[b].right >= COL_GAP)) cur = lines[b];
        break;
      }
      if (!cur) { cur = { y: y, parts: [], left: Infinity, right: -Infinity, h: 0 }; lines.push(cur); }
      if (it.str.trim()) cur.h = Math.max(cur.h, it.height || 0);
      cur.parts.push({ x: x, r: x + (it.width || 0), s: it.str, n: cur.parts.length });
      if (it.str.trim()) { cur.right = Math.max(cur.right, x + (it.width || 0)); cur.left = Math.min(cur.left, x); }
    });
    lines.forEach(function (l) {
      // a row put together from several runs is read left to right
      var inOrder = l.parts.every(function (p, k) { return !k || !p.s.trim() || p.x >= l.parts[k - 1].x - 1 || !l.parts[k - 1].s.trim(); });
      if (!inOrder) l.parts.sort(function (a, b) { return a.x - b.x || a.n - b.n; });
      // columns: a wide empty stretch between two pieces of text. The stretch after a clause label ("1.2.1", "a)") is its tab, not a column.
      var text = '', lastR = null, cols = 0;
      l.parts.forEach(function (p) {
        if (p.s.trim() && lastR !== null && p.x - lastR >= COL_GAP && text.trim()) {
          if (LABEL_ONLY.test(text.trim())) text = text.replace(/\s*$/, ' ');
          else { text = text.replace(/\s*$/, '') + ' | '; cols++; }
        } else if (p.s.trim() && lastR !== null && p.x - lastR > 2.5 && !/\s$/.test(text) && !/^\s/.test(p.s)) text += ' ';
        text += p.s;
        if (p.s.trim()) lastR = p.r;
      });
      // a labelled clause with one tab stop ("1. AMCA 210   Laboratory Methods ...") is a clause, not a table row
      if (cols === 1 && startsNewItem(text.replace(/\s+/g, ' ').trim())) { text = text.replace(' | ', ' '); cols = 0; }
      l.text = text; l.table = cols > 0;
    });
    var real = lines.filter(function (l) { return l.text.trim(); }), gaps = [], edge = 0;
    for (var k = 1; k < real.length; k++) { var g = real[k - 1].y - real[k].y; if (g > 4) gaps.push(g); }
    gaps.sort(function (a, b) { return a - b; });
    var usual = gaps.length ? gaps[Math.floor(gaps.length * 0.35)] : 0;       // the common single-line step
    var rights = real.map(function (l) { return l.right; }).filter(isFinite).sort(function (a, b) { return a - b; });
    if (rights.length) edge = rights[Math.floor(rights.length * 0.9)];
    var lefts = real.map(function (l) { return l.left; }).filter(isFinite);
    var leftMost = lefts.length ? Math.min.apply(null, lefts) : 0;
    // where the text of the clause above starts: after the tab that follows its label
    // (kept from the page before: a list often runs over a page break; fromPdf clears it for a new document)
    var bodyX = carryBodyX, waiting = false;
    function clauseStart(l) {
      if (!startsNewItem(l.text.replace(/\s+/g, ' ').trim())) {
        if (waiting && !l.para && isFinite(l.left)) { bodyX = l.left; waiting = false; }      // its first wrapped line shows where the text starts
        return;
      }
      var solid = l.parts.filter(function (p) { return p.s.trim(); }), after = null;
      for (var q = 1; q < solid.length && q < 4; q++) if (solid[q].x - solid[q - 1].r >= 6) { after = solid[q]; break; }      // the piece after the label's tab
      bodyX = after ? after.x : null; waiting = !after;       // label and text in one piece: not known yet
    }
    if (real.length) clauseStart(real[0]);
    for (k = 1; k < real.length; k++) {
      var up = real[k - 1], me = real[k], step = up.y - me.y;
      var spaced = usual > 0 && step > usual * 1.3 && step < usual * 6;
      var short = edge > 0 && isFinite(up.right) && up.right < leftMost + (edge - leftMost) * 0.8 && /[.:;]\s*$/.test(up.text);
      var blank = usual > 0 && step > usual * 1.6 && step < usual * 6;       // a clear empty line above: a list item or a new paragraph even without a full stop
      if (step > 4 && (spaced || short)) me.para = blank ? 2 : 1;
      // a list whose bullets are pictures: no mark in the text, but every item stands apart and starts to the right of the ordinary text
      if (me.para === 2 && !me.table && bodyX !== null && me.left > bodyX + 16 && me.left < bodyX + 90 &&
          /^\s*[A-Z]/.test(me.text) && !startsNewItem(me.text.replace(/\s+/g, ' ').trim())) me.item = true;
      clauseStart(me);
    }
    carryBodyX = bodyX;
    return lines.map(function (l) { return (l.para === 2 ? PARA + PARA : l.para ? PARA : '') + (l.table ? TABLE : '') + (l.item ? '\u2022 ' : '') + l.text; });
  }
  var carryBodyX = null;
  var COL_GAP = 28;        // points; a word space is 3 to 6, a label's tab 10 to 25
  var LABEL_ONLY = /^(?:PART\s+\S+|\d{1,2}(?:\.\d{1,2}){0,4}\.?|[A-Za-z]{1,2}[.)]|\([A-Za-z0-9]{1,4}\)|[ivx]{1,4}[.)]|[-\u2013\u2014\u2022\uF000-\uF0FF])$/;

  /* Running headers and footers ("SECTION 15720", "Rev 0  12 of 32  Contract No:") sit in
     the first or last few lines of a page and repeat on most pages. Left in, they get glued
     into the middle of a clause that runs over a page break. A line is removed only when
     the same text (digits ignored) is at the top or bottom of at least 3 pages and 40% of
     the pages. Edits pageLines in place and returns how many lines were removed. */
  var EDGE_LINES = 4;
  function dropPageFurniture(pageLines) {
    function key(s) {   // \s takes the paragraph mark too
      var t = s.replace(/\s+/g, ' ').trim();
      if (/^(\d{1,2}(\.\d{1,2}){0,4}[.)]|\(?[A-Za-z]{1,2}[.)]|[ivxIVX]{1,4}[.)])$/.test(t)) return '';      // "1." or "a)" alone on a line is a clause label, never page furniture
      return t.replace(/\d+/g, '#').toLowerCase();
    }
    function edges(lines) {
      var idx = [];
      lines.forEach(function (l, i) { if (l.trim()) idx.push(i); });
      return idx.slice(0, EDGE_LINES).concat(idx.slice(-EDGE_LINES)).filter(function (v, i, a) { return a.indexOf(v) === i; });
    }
    // A header of eight lines is taken off four at a time: the pass is repeated while it still finds some.
    var removed = 0;
    for (var pass = 0; pass < 4; pass++) {
      var count = {}, got = 0;
      pageLines.forEach(function (lines) {
        var seen = {};
        edges(lines).forEach(function (i) { var k = key(lines[i]); if (k && !seen[k]) { seen[k] = 1; count[k] = (count[k] || 0) + 1; } });
      });
      var need = Math.max(3, Math.ceil(pageLines.length * 0.4));
      pageLines.forEach(function (lines, p) {
        var drop = {};
        edges(lines).forEach(function (i) { if (count[key(lines[i])] >= need) drop[i] = 1; });
        pageLines[p] = lines.filter(function (l, i) { if (drop[i]) { got++; return false; } return true; });
      });
      removed += got;
      if (!got) break;
    }
    return removed;
  }

  /* Cover sheets, revision tables and the table of contents come before the specification
     and are not clauses. Lines are dropped from the top of the document only:
       1. up to the first real "PART 1" heading, i.e. one that is not a contents entry
          (a contents entry ends in dot leaders and a page number);
       2. if the document has no PART 1 heading, up to the last contents entry of a table of
          contents that sits in the first third of the document.
     Nothing after that point is touched. Returns { lines, skipped, why }. */
  var TOC_LINE = /\.{5,}\s*\d*\s*$/;
  var PART_ONE = /^\s*PART\s+(1|I|ONE)\b(?!\s*[0-9IVX])/i;
  function skipFrontMatter(lines) {
    var i, start = -1, why = '';
    for (i = 0; i < lines.length; i++) {
      if (PART_ONE.test(lines[i]) && !TOC_LINE.test(lines[i])) { start = i; why = 'before PART 1'; break; }
    }
    if (start < 0) {
      var last = -1, count = 0;
      for (i = 0; i < Math.ceil(lines.length / 3); i++) if (TOC_LINE.test(lines[i])) { last = i; count++; }
      if (count >= 3) { start = last + 1; why = 'up to the end of the contents'; }
    }
    if (start <= 0) return { lines: lines, skipped: 0, why: '' };
    var skipped = lines.slice(0, start).filter(function (l) { return l.trim(); }).length;
    return { lines: lines.slice(start), skipped: skipped, why: why };
  }
  function frontNote(f) {
    return f.skipped ? ' · cover and contents skipped (' + f.skipped + (f.skipped === 1 ? ' line' : ' lines') + ' ' + f.why + ')' : '';
  }

  /* ======================================================================
     BUILD
     ====================================================================== */

  function capText(raw) {
    var cap = MAX_PAGES * CHARS_PER_PAGE, partial = '';
    if (raw.length > cap) {
      var total = raw.split(/\r\n|\r|\n/).length;
      var cut = Math.max(raw.lastIndexOf('\n', cap), raw.lastIndexOf('\r', cap));   // at the end of a line, never inside a clause
      raw = raw.slice(0, cut > 0 ? cut : cap);
      partial = 'Only the first ' + raw.split(/\r\n|\r|\n/).length + ' of ' + total + ' pasted lines were converted (about ' + MAX_PAGES + ' pages of text).';
    }
    return { raw: raw, partial: partial };
  }

  function fromText(text, o) {
    o = o || {};
    var c = capText(String(text || '')), lines = c.raw.split(/\r\n|\r|\n/);
    var front = o.skipFront === false ? { lines: lines, skipped: 0, why: '' } : skipFrontMatter(lines);
    var rows = parseLines(front.lines, { keepBreaks: !!o.keepBreaks }), info = [];
    if (front.skipped) info.push(front.skipped + (front.skipped === 1 ? ' line' : ' lines') + ' of cover and contents skipped');
    return { rows: rows, info: info, partial: c.partial };
  }

  function fromPdf(file, o) {
    o = o || {};
    var say = o.onProgress || function () {};
    return new Promise(function (resolve, reject) {
      if (!window.pdfjsLib) { reject(new Error('The PDF reader did not load. Refresh the page and try again.')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the file.')); };
      reader.onload = function () {
        window.pdfjsLib.getDocument({ data: new Uint8Array(reader.result) }).promise.then(function (pdf) {
          var max = Math.min(pdf.numPages, MAX_PAGES), pageLines = [];
          carryBodyX = null;
          function page(p) {
            if (p > max) return Promise.resolve();
            say('Reading page ' + p + ' of ' + max + '\u2026');
            return pdf.getPage(p).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
              pageLines.push(extractLinesFromTextContent(tc));
              return new Promise(function (r) { setTimeout(r, 0); });           // let the page draw the progress
            }).then(function () { return page(p + 1); });
          }
          return page(1).then(function () {
            var dropped = dropPageFurniture(pageLines), all = [];
            pageLines.forEach(function (pl) { all = all.concat(pl); });
            if (!all.join('').trim()) throw new Error('No text was found in this PDF. It looks like a scan; a scanned PDF cannot be read.');
            say('Sorting the clauses\u2026');
            var front = o.skipFront === false ? { lines: all, skipped: 0, why: '' } : skipFrontMatter(all);
            var rows = parseLines(front.lines), info = [];
            if (dropped) info.push(dropped + ' page header and footer lines removed');
            if (front.skipped) info.push(front.skipped + (front.skipped === 1 ? ' line' : ' lines') + ' of cover and contents skipped');
            resolve({ rows: rows, info: info, partial: pdf.numPages > MAX_PAGES ? 'Only the first ' + MAX_PAGES + ' of ' + pdf.numPages + ' pages were converted.' : '' });
          });
        }).then(null, function (err) {
          reject(err && err.name === 'PasswordException' ? new Error('That PDF is password-protected. Remove the password and try again.')
               : err && /scan|No text/.test(err.message || '') ? err
               : new Error('Could not read that PDF. It may be damaged or not a real PDF file.'));
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  window.CMEngine = {
    MAX_PAGES: MAX_PAGES, CHARS_PER_PAGE: CHARS_PER_PAGE,
    parseLines: parseLines, skipFrontMatter: skipFrontMatter, dropPageFurniture: dropPageFurniture,
    extractLinesFromTextContent: extractLinesFromTextContent, frontNote: frontNote,
    fromText: fromText, fromPdf: fromPdf
  };
})();
