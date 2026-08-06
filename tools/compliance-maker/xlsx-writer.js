/* ==========================================================================
   xlsx-writer.js — minimal, dependency-free .xlsx (OOXML) generator.

   Why this exists: the free SheetJS community build cannot write cell fills or
   font colors, and the sample output needs both (black PART row, blue section
   rows, colored Sr labels, red highlighted keywords via rich text). This module
   emits a valid .xlsx by building the OOXML parts and packaging them as a
   store-only ZIP (no compression -> no zlib needed).

   Public API:
     window.xlsxWriter.build(rows, highlightRegex, splitRuns, meta) -> Blob
     meta (optional): { title, revision, projectName, bandText } — see the
     comment above build() for details. Rows 1-6 are a mandatory branded
     header block (title/date/product band + the functional column-header
     row); data starts at row 7.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- CRC32 (for ZIP) ---------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- store-only ZIP ---------------- */
  function strToU8(str) {
    // UTF-8 encode
    return new TextEncoder().encode(str);
  }
  function zip(files) {
    // files: [{ name, data:Uint8Array }]
    var chunks = [];
    var central = [];
    var offset = 0;

    function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
    function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

    files.forEach(function (f) {
      var nameBytes = strToU8(f.name);
      var crc = crc32(f.data);
      var size = f.data.length;

      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0)
      );
      chunks.push(new Uint8Array(local));
      chunks.push(nameBytes);
      chunks.push(f.data);

      var cen = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset)
      );
      central.push({ head: new Uint8Array(cen), name: nameBytes });

      offset += local.length + nameBytes.length + size;
    });

    var centralStart = offset;
    var centralChunks = [];
    var centralSize = 0;
    central.forEach(function (c) {
      centralChunks.push(c.head, c.name);
      centralSize += c.head.length + c.name.length;
    });

    var end = [].concat(
      u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(centralSize), u32(centralStart), u16(0)
    );

    var all = chunks.concat(centralChunks, [new Uint8Array(end)]);
    var total = all.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  /* ---------------- XML helpers ---------------- */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function colLetter(idx) { // 1 -> A
    var s = '';
    while (idx > 0) { var m = (idx - 1) % 26; s = String.fromCharCode(65 + m) + s; idx = (idx - m - 1) / 26; }
    return s;
  }

  /* ---------------- style palette ----------------
     Style indexes (s="...") map to <cellXfs> below.
       0 header (bold, grey fill, border)
       1 part   (bold white on black)
       2 section spec (bold, blue fill)
       3 section sr   (bold, blue fill, primary-dark text, centered)
       4 body spec (wrap, top, border)
       5 sr letter (maroon, bold, centered)
       6 sr number (green, bold, centered)
       7 sr plain  (centered)
       8 empty cell (border only) — Compliance/Remarks
  ------------------------------------------------- */
  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="12">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +                                 // 0 default
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +                             // 1 bold
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +      // 2 bold white
        '<font><b/><sz val="11"/><color rgb="FF1E3FCC"/><name val="Calibri"/></font>' +      // 3 bold primary-dark
        '<font><b/><sz val="11"/><color rgb="FF9C4A1A"/><name val="Calibri"/></font>' +      // 4 bold maroon
        '<font><b/><sz val="11"/><color rgb="FF1FA971"/><name val="Calibri"/></font>' +      // 5 bold green
        '<font><sz val="11"/><color rgb="FFE0432F"/><name val="Calibri"/></font>' +          // 6 red (unused as cell font; rich text uses inline)
        '<font><i/><sz val="10"/><color rgb="FF5C6270"/><name val="Calibri"/></font>' +      // 7 italic grey (Comments column)
        '<font><b/><sz val="20"/><color rgb="FF008EC0"/><name val="Calibri"/></font>' +      // 8 title (COMPLIANCE STATEMENT)
        '<font><b/><sz val="14"/><color rgb="FFC00000"/><name val="Calibri"/></font>' +      // 9 project name value (red)
        '<font><b/><sz val="12"/><color rgb="FF0094C8"/><name val="Calibri"/></font>' +      // 10 Compliance/Remarks column labels (blue)
        '<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +      // 11 product/section band (white)
      '</fonts>' +
      '<fills count="10">' +
        '<fill><patternFill patternType="none"/></fill>' +                                   // 0
        '<fill><patternFill patternType="gray125"/></fill>' +                                // 1 (reserved)
        '<fill><patternFill patternType="solid"><fgColor rgb="FF000000"/></patternFill></fill>' + // 2 black
        '<fill><patternFill patternType="solid"><fgColor rgb="FFBDE5F8"/></patternFill></fill>' + // 3 blue
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F4"/></patternFill></fill>' + // 4 grey header
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>' + // 5 yellow (library auto-fill)
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/></patternFill></fill>' + // 6 orange (AI suggestion)
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/></patternFill></fill>' + // 7 red (conflicts logged answer)
        '<fill><patternFill patternType="solid"><fgColor rgb="FF0094C8"/></patternFill></fill>' + // 8 product/section band fill
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF4B400"/></patternFill></fill>' + // 9 amber (unverified AI guess — distinct from both library-yellow and AI-orange, survives even if Comments is deleted)
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +                        // 0 none
        '<border>' +
          '<left style="thin"><color rgb="FFB0B4BB"/></left>' +
          '<right style="thin"><color rgb="FFB0B4BB"/></right>' +
          '<top style="thin"><color rgb="FFB0B4BB"/></top>' +
          '<bottom style="thin"><color rgb="FFB0B4BB"/></bottom>' +
        '</border>' +                                                                          // 1 thin box
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="21">' +
        // 0 header
        '<xf fontId="1" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>' +
        // 1 part (white on black)
        '<xf fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>' +
        // 2 section spec (bold blue)
        '<xf fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>' +
        // 3 section sr (bold blue, primary-dark, centered)
        '<xf fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
        // 4 body spec (wrap, top)
        '<xf fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>' +
        // 5 sr letter (maroon centered)
        '<xf fontId="4" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>' +
        // 6 sr number (green centered)
        '<xf fontId="5" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>' +
        // 7 sr plain (centered)
        '<xf fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>' +
        // 8 empty
        '<xf fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment vertical="top"/></xf>' +
        // 9 library auto-fill (yellow, wrap) — Compliance/Remarks pre-filled from the library
        '<xf fontId="0" fillId="5" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>' +
        // 10 AI suggestion (orange, wrap) — must be verified by the engineer
        '<xf fontId="0" fillId="6" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>' +
        // 11 conflict (red, wrap) — differs from the logged answer; resolve
        '<xf fontId="0" fillId="7" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>' +
        // 12 comments (italic grey, wrap) — internal flags, delete before sending
        '<xf fontId="7" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>' +
        // ---- mandatory first-5-rows branded header block ----
        // 13 title "COMPLIANCE STATEMENT" (row 1, centered)
        '<xf fontId="8" fillId="0" borderId="0" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>' +
        // 14 revision cell (row 1, E1) — editable placeholder, e.g. "R0"
        '<xf fontId="9" fillId="0" borderId="0" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>' +
        // 15 field label, bold black (row2/3: "Project Name", "Date")
        '<xf fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment horizontal="left" vertical="center"/></xf>' +
        // 16 project name value — editable placeholder, red bold
        '<xf fontId="9" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment horizontal="left" vertical="center"/></xf>' +
        // 17 field value, bold (row2: date value)
        '<xf fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
        // 18 "Compliance"/"Remarks" column labels (row3, blue bold)
        '<xf fontId="10" fillId="0" borderId="1" applyFont="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
        // 19 product/section band (row4, white bold on blue, full width)
        '<xf fontId="11" fillId="8" borderId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>' +
        // 20 AI unverified guess (amber, wrap) — distinct from library-yellow
        // (9) and AI-verified-orange (10); the color itself is a durability
        // signal that survives even if the Comments column gets deleted.
        '<xf fontId="0" fillId="9" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------------- inline string builders ---------------- */
  function preserve(t) {
    return (/^\s|\s$|  /.test(t)) ? ' xml:space="preserve"' : '';
  }
  // Plain inline string cell
  function inlineStrCell(ref, style, text) {
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is>' +
      '<t' + preserve(text) + '>' + esc(text) + '</t></is></c>';
  }
  // Rich inline string cell from runs [{text, style}] where style is
  // '' | 'red' | 'redbold' | 'underline'. Mirrors the preview.
  function runProps(style) {
    if (style === 'colon')     return '<rPr><b/><color rgb="FFA24A0E"/><sz val="11"/><rFont val="Calibri"/></rPr>';
    if (style === 'redbold')   return '<rPr><b/><color rgb="FFE0432F"/><sz val="11"/><rFont val="Calibri"/></rPr>';
    if (style === 'underline') return '<rPr><u/><sz val="11"/><rFont val="Calibri"/></rPr>';
    if (style === 'red' || style === true) return '<rPr><color rgb="FFE0432F"/><sz val="11"/><rFont val="Calibri"/></rPr>';
    return '<rPr><sz val="11"/><rFont val="Calibri"/></rPr>';
  }
  function richStrCell(ref, style, runs) {
    var body = runs.map(function (run) {
      // Back-compat: older runs used {hl:true}. Map to 'red'.
      var st = run.style != null ? run.style : (run.hl ? 'red' : '');
      return '<r>' + runProps(st) + '<t' + preserve(run.text) + '>' + esc(run.text) + '</t></r>';
    }).join('');
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is>' + body + '</is></c>';
  }
  function emptyCell(ref) { return '<c r="' + ref + '" s="8"/>'; }

  // Always "today" at the moment of export — never a stored/stale value.
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function todayStr() {
    var d = new Date();
    var dd = ('0' + d.getDate()).slice(-2);
    return dd + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
  }

  // Internal flag text for the Comments column (E). Conflict outranks
  // provenance because it demands action.
  function commentFor(r) {
    if (r.conflict && (r.compliance || r.remarks)) {
      return 'CONFLICT — previously answered: Compliance "' +
        (r.conflict.compliance || '(blank)') + '"; Remarks "' +
        (r.conflict.remarks || '(blank)') + '"' +
        (r.conflict.at ? ' (' + String(r.conflict.at).slice(0, 10) + ')' : '') +
        '. Resolve, then correct the library file.';
    }
    if (!r.auto || (!r.compliance && !r.remarks)) return '';
    if (r.auto.type === 'exact') return 'From library (exact match).';
    if (r.auto.type === 'fuzzy') return 'From library (' + Math.round((r.auto.score || 0) * 100) + '% similar).';
    if (r.auto.type === 'rule')  return 'Scope rule: site-execution clause.';
    if (r.auto.type === 'ai')    return 'AI suggestion — verify against the selection.';
    if (r.auto.type === 'ai-guess') return r.auto.comments || 'WILD GUESS — NOT VERIFIED. CONFIRM BEFORE SENDING.';
    return '';
  }
  function commentCell(ref, r) {
    var text = commentFor(r);
    return text ? inlineStrCell(ref, 12, text) : '<c r="' + ref + '" s="12"/>';
  }

  /* ---------------- worksheet ---------------- */
  // The header block (rows 1-5) spans the FULL width starting at column A —
  // a clean, unbroken banner. Only the DATA TABLE below it (row 6 header +
  // all rows) is shifted one column right: A is a blank margin there, with
  // B=Sr, C=Specifications, D=Compliance, E=Remarks, F=Comments.
  function buildSheet(rows, re, splitRuns, meta) {
    meta = meta || {};
    var lines = [];
    var merges = [];
    var rowNum = 1;

    // ---- Rows 1-5: mandatory branded header block (full width, from A) ----
    // Row 1: title (A:D) + revision (E)
    merges.push('A1:D1');
    lines.push(
      '<row r="1" ht="30" customHeight="1">' +
        inlineStrCell('A1', 13, meta.title || 'COMPLIANCE STATEMENT') +
        '<c r="B1" s="13"/><c r="C1" s="13"/><c r="D1" s="13"/>' +
        inlineStrCell('E1', 14, meta.revision || 'R0') +
        '<c r="F1" s="8"/>' +
      '</row>'
    );
    // Row 2-3: Project Name / value (2-row merge) + Date (row2) + Compliance/Remarks labels (row3)
    merges.push('A2:B3', 'C2:C3');
    lines.push(
      '<row r="2" ht="18">' +
        inlineStrCell('A2', 15, 'Project Name') + '<c r="B2" s="15"/>' +
        inlineStrCell('C2', 16, meta.projectName || 'Project name here') +
        inlineStrCell('D2', 15, 'Date') +
        inlineStrCell('E2', 17, todayStr()) +
        '<c r="F2" s="8"/>' +
      '</row>'
    );
    lines.push(
      '<row r="3" ht="18">' +
        inlineStrCell('D3', 18, 'Compliance') +
        inlineStrCell('E3', 18, 'Remarks') +
        '<c r="F3" s="8"/>' +
      '</row>'
    );
    // Row 4: product / section band, full width (A through E — matches the
    // title band above it; F is left out of the merge to stay a plain cell)
    merges.push('A4:E4');
    lines.push(
      '<row r="4" ht="24" customHeight="1">' +
        inlineStrCell('A4', 19, meta.bandText || '') +
        '<c r="B4" s="19"/><c r="C4" s="19"/><c r="D4" s="19"/><c r="E4" s="19"/>' +
        '<c r="F4" s="8"/>' +
      '</row>'
    );
    // Row 5: blank spacer (no content, no special style)
    lines.push('<row r="5"></row>');
    rowNum = 6;

    // ---- Row 6: the FUNCTIONAL table header. This text is what the
    // library/answer-log parsers search for to locate the data (they scan
    // every column dynamically, so the shift below doesn't break them) —
    // it must stay exactly "Sr" / "Specifications" / "Compliance" /
    // "Remarks", so it is kept even though rows 1-5 above already show
    // "Compliance"/"Remarks" as a title-block label. From here down,
    // column A becomes the blank margin and the table starts at B. ----
    lines.push(
      '<row r="' + rowNum + '" ht="20" customHeight="1">' +
        '<c r="A' + rowNum + '" s="8"/>' +
        inlineStrCell('B' + rowNum, 0, 'Sr') +
        inlineStrCell('C' + rowNum, 0, 'Specifications') +
        inlineStrCell('D' + rowNum, 0, 'Compliance') +
        inlineStrCell('E' + rowNum, 0, 'Remarks') +
        inlineStrCell('F' + rowNum, 0, 'Comments') +
      '</row>'
    );
    rowNum++;

    rows.forEach(function (r) {
      var srStyle, specCell;
      var srRef = 'B' + rowNum, specRef = 'C' + rowNum;

      if (r.type === 'part') {
        // Whole row black, INCLUDING column A — the banding starts at the
        // sheet's left edge. Comments (F) is the one exception: internal-use
        // only (deleted before sending to the client), so it never carries
        // the PART/section row coloring; style 8 = plain bordered cell.
        srStyle = 1;
        specCell = inlineStrCell(specRef, 1, r.spec);
        lines.push(
          '<row r="' + rowNum + '">' +
            '<c r="A' + rowNum + '" s="1"/>' +
            '<c r="' + srRef + '" s="1"/>' +   // empty black sr cell
            specCell +
            '<c r="D' + rowNum + '" s="1"/>' +
            '<c r="E' + rowNum + '" s="1"/>' +
            '<c r="F' + rowNum + '" s="8"/>' +
          '</row>'
        );
        rowNum++;
        return;
      }

      if (r.type === 'section') {
        // Same rule: blue banding starts at column A; Comments (F) stays
        // plain, not blue-filled.
        lines.push(
          '<row r="' + rowNum + '">' +
            '<c r="A' + rowNum + '" s="3"/>' +
            inlineStrCell(srRef, 3, r.sr) +
            inlineStrCell(specRef, 2, r.spec) +
            '<c r="D' + rowNum + '" s="3"/>' +
            '<c r="E' + rowNum + '" s="3"/>' +
            '<c r="F' + rowNum + '" s="8"/>' +
          '</row>'
        );
        rowNum++;
        return;
      }

      // letter / number / text
      if (r.type === 'letter') srStyle = 5;
      else if (r.type === 'number') srStyle = 6;
      else srStyle = 7;

      var runs = splitRuns(r.spec, re);
      specCell = richStrCell(specRef, 4, runs);

      // Compliance/Remarks fills: 9 = yellow (library answer), 10 = orange
      // (AI suggestion, verified, still worth checking), 20 = amber
      // (AI GUESS, unverified — a stronger signal than orange), 8 = plain;
      // blanks stay empty bordered cells.
      var fillStyle = 8;
      if (r.conflict && (r.compliance || r.remarks)) {
        fillStyle = 11; // conflict outranks everything — it demands review
      } else if (r.auto && (r.compliance || r.remarks)) {
        fillStyle = r.auto.type === 'ai-guess' ? 20 : (r.auto.type === 'ai' ? 10 : 9);
      }
      var compCell = r.compliance
        ? inlineStrCell('D' + rowNum, fillStyle, r.compliance)
        : emptyCell('D' + rowNum);
      var remCell = r.remarks
        ? inlineStrCell('E' + rowNum, fillStyle, r.remarks)
        : emptyCell('E' + rowNum);

      lines.push(
        '<row r="' + rowNum + '">' +
          '<c r="A' + rowNum + '" s="8"/>' +
          inlineStrCell(srRef, srStyle, r.sr || '') +
          specCell +
          compCell +
          remCell +
          commentCell('F' + rowNum, r) +
        '</row>'
      );
      rowNum++;
    });

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<cols>' +
          '<col min="1" max="1" width="3" customWidth="1"/>' +
          '<col min="2" max="2" width="10" customWidth="1"/>' +
          '<col min="3" max="3" width="70" customWidth="1"/>' +
          '<col min="4" max="4" width="14" customWidth="1"/>' +
          '<col min="5" max="5" width="18" customWidth="1"/>' +
          '<col min="6" max="6" width="36" customWidth="1"/>' +
        '</cols>' +
        '<sheetData>' + lines.join('') + '</sheetData>' +
        (merges.length ? '<mergeCells count="' + merges.length + '">' +
          merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') +
          '</mergeCells>' : '') +
      '</worksheet>';
  }

  /* ---------------- package parts ---------------- */
  // meta (optional): { title, revision, projectName, bandText }
  //   - title:       default "COMPLIANCE STATEMENT"
  //   - revision:    default "R0" (editable placeholder — this tool doesn't
  //                  track revisions; edit per-project in Excel)
  //   - projectName: default "Project name here" (editable placeholder)
  //   - bandText:    the row-4 banner, e.g. "Product : AHU" — pass the
  //                  selected product; left blank (still shows the blue
  //                  band) if none is available (e.g. convert-only mode)
  //   Date (row 2) is ALWAYS today's date at export time — see todayStr().
  function build(rows, re, splitRuns, meta) {
    var sheetXml = buildSheet(rows, re, splitRuns, meta);

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Compliance" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var files = [
      { name: '[Content_Types].xml',        data: strToU8(contentTypes) },
      { name: '_rels/.rels',                data: strToU8(rootRels) },
      { name: 'xl/workbook.xml',            data: strToU8(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: strToU8(wbRels) },
      { name: 'xl/styles.xml',              data: strToU8(STYLES_XML) },
      { name: 'xl/worksheets/sheet1.xml',   data: strToU8(sheetXml) }
    ];

    var zipped = zip(files);
    return new Blob([zipped], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  window.xlsxWriter = { build: build };
})();
