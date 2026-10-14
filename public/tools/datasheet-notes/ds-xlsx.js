/* ============================================================
   Datasheet Notes - Excel writer (no library).
   DSXlsx.build(grid, sheetName) -> Blob of a one-sheet .xlsx

   grid: { columns: [unit tag, ...], rows: [{ section, component, cells, kind }] }
   from DSParse.grid().
   Sheet: Section | Component | one column per unit tag | Remarks,
   header row filled, every cell bordered and wrapped, Remarks left
   empty to fill in. With several units, one line under the table
   says what the coloured cells mean (the table itself is not moved).
   Print: row 1 repeats on every page. Up to FIT_UNITS unit columns
   the sheet prints one page wide; with more, it prints at full size
   and Section and Component repeat on every page.
   ============================================================ */
(function () {
  'use strict';

  var HEADER_FILL = 'FF773562';   // header colour of the owner's compliance table format
  var SUB_FILL    = 'FFF4ECF1';
  // cells that differ from the first unit: yellow for the 1st different value in a row, then one colour
  // per further different value; after the last colour it starts again at yellow
  var DIFF_FILLS  = ['FFFFF59D', 'FFBDD7EE', 'FFC6E0B4', 'FFF8CBAD', 'FFD9C3EC'];
  var LINE        = 'FF8C8C8C';
  var FIT_UNITS   = 6;            // more unit columns than this are not squeezed onto one page width
  function colName(i) { var s = '', n = i + 1; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; }

  var CRC = (function () {
    var t = [], n, c, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF, i; for (i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /* zip, stored (no compression) */
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cell(col, row, style, text) {
    var ref = colName(col) + row;
    if (text === '' || text == null) return '<c r="' + ref + '" s="' + style + '"/>';
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + esc(text) + '</t></is></c>';
  }

  var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

  /* cell styles: 1 header, 2 section name, 3 body, 4 sub-heading, 5.. body with a "differs" fill */
  function stylesXml() {
    var side = '<left style="thin"><color rgb="' + LINE + '"/></left><right style="thin"><color rgb="' + LINE + '"/></right>' +
               '<top style="thin"><color rgb="' + LINE + '"/></top><bottom style="thin"><color rgb="' + LINE + '"/></bottom><diagonal/>';
    function xf(font, fill) {
      return '<xf numFmtId="0" fontId="' + font + '" fillId="' + fill + '" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
             '<alignment vertical="center" wrapText="1"/></xf>';
    }
    return X + '<styleSheet xmlns="' + NS + '">' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="' + (4 + DIFF_FILLS.length) + '"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="' + HEADER_FILL + '"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="' + SUB_FILL + '"/></patternFill></fill>' +
        DIFF_FILLS.map(function (c) { return '<fill><patternFill patternType="solid"><fgColor rgb="' + c + '"/></patternFill></fill>'; }).join('') + '</fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>' + side + '</border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + (5 + DIFF_FILLS.length) + '"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        xf(2, 2) + xf(1, 0) + xf(0, 0) + xf(1, 3) +
        DIFF_FILLS.map(function (c, i) { return xf(0, 4 + i); }).join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  function sheetXml(grid) {
    var units = grid.columns.length;
    var HEAD = ['Section', 'Component'].concat(grid.columns, ['Remarks']);
    var unitWidth = units === 1 ? 56 : units <= 3 ? 40 : 32;
    var WIDTHS = [26, 36].concat(grid.columns.map(function () { return unitWidth; }), [36]);
    var out = ['<row r="1" ht="24" customHeight="1">' + HEAD.map(function (h, i) { return cell(i, 1, 1, h); }).join('') + '</row>'];
    grid.rows.forEach(function (r, i) {
      var n = i + 2, st = r.kind === 'sub' ? 4 : 3;
      out.push('<row r="' + n + '">' + cell(0, n, 2, r.section) + cell(1, n, st, r.component) +
               r.cells.map(function (v, u) {
                 var mk = r.marks ? r.marks[u] : 0;
                 return cell(2 + u, n, mk ? 5 + (mk - 1) % DIFF_FILLS.length : st, v === '' && mk ? ' ' : v);
               }).join('') + cell(2 + units, n, st, '') + '</row>');
    });
    if (units > 1) {            // legend, one empty row below the table: plain cell, no wrap, so the table keeps its place
      out.push('<row r="' + (grid.rows.length + 3) + '">' + cell(0, grid.rows.length + 3, 0,
        'Coloured cells differ from ' + grid.columns[0] + ' (the first unit). One colour for each different value in a row; after ' +
        DIFF_FILLS.length + ' different values the colours start again.') + '</row>');
    }
    var fit = units <= FIT_UNITS;
    return X + '<worksheet xmlns="' + NS + '">' +
      (fit ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '') +      // prints one page wide
      '<sheetViews><sheetView workbookViewId="0">' +
        (units > 1 ? '<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>'
                   : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>') +
        '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + WIDTHS.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' +
      '<sheetData>' + out.join('') + '</sheetData>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="' + (units > 1 ? 'landscape' : 'portrait') + '"' + (fit ? ' fitToWidth="1" fitToHeight="0"' : '') + '/></worksheet>';
  }

  function build(grid, sheetName) {
    var name = esc(String(sheetName || 'Datasheet Notes').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31));
    var ref = "'" + name.replace(/'/g, "''") + "'!";
    // repeated when printed: the header row, and Section + Component when the sheet is not fitted to one page width
    var titles = (grid.columns.length > FIT_UNITS ? ref + '$A:$B,' : '') + ref + '$1:$1';
    return zip([
      ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', X + '<workbook xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">' + titles + '</definedName></definedNames></workbook>'],
      ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', stylesXml()],
      ['xl/worksheets/sheet1.xml', sheetXml(grid)]
    ]);
  }

  window.DSXlsx = { build: build };
})();
