/* ============================================================
   Projects - Excel writer with several sheets.
   PRXlsx.build(sheets) -> Blob of an .xlsx
     sheets: [{ name, widths: [chars...], rows: [[cell...]], bold: [rowIndex...], part: [...], sect: [...] }]
     A cell is text or a number. Rows listed in "bold" are heading rows; "part" rows are the
     black PART rows and "sect" rows the blue section rows of a converted specification.
     The first row of every sheet stays in view when scrolling.
   PRXlsx.save(blob, fileName) starts the download.
   Colours below are written into the Excel file; they are not page colours.
   ============================================================ */
(function () {
  'use strict';

  var CRC = (function () { var t = [], n, c, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF, i; for (i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zip(files) {
    var enc = new TextEncoder(), chunks = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      chunks.push(new Uint8Array(lh.buffer), name, data); offset += 30 + name.length + data.length;
      central.push(new Uint8Array(ch.buffer), name);
    });
    var size = 0; central.forEach(function (c) { size += c.length; });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function esc(s) {
    // characters XML does not allow would make Excel refuse the file
    return String(s).replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function col(i) { var s = '', n = i + 1; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; }
  // Excel allows 31 characters in a sheet name and none of \ / ? * [ ] :
  function sheetName(s) { return String(s).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet'; }

  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  var NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

  function styles() {
    return HEAD + '<styleSheet ' + NS + '>' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0097E0"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF000000"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFBDE5F8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFBFC9D1"/></left><right style="thin"><color rgb="FFBFC9D1"/></right><top style="thin"><color rgb="FFBFC9D1"/></top><bottom style="thin"><color rgb="FFBFC9D1"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '</cellXfs></styleSheet>';
  }

  function sheetXml(sheet) {
    var bold = {}; (sheet.bold || [0]).forEach(function (i) { bold[i] = 2; });
    (sheet.part || []).forEach(function (i) { bold[i] = 3; }); (sheet.sect || []).forEach(function (i) { bold[i] = 4; });
    var cols = (sheet.widths || []).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('');
    var body = sheet.rows.map(function (row, r) {
      var style = bold[r] || 1;
      return '<row r="' + (r + 1) + '">' + row.map(function (v, c) {
        var ref = col(c) + (r + 1);
        if (v == null || v === '') return row.length > 1 || bold[r] ? '<c r="' + ref + '" s="' + style + '"/>' : '';
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="' + style + '"><v>' + v + '</v></c>';
        return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + esc(String(v).slice(0, 32000)) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');
    return HEAD + '<worksheet ' + NS + '><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + body + '</sheetData></worksheet>';
  }

  function build(sheets) {
    var used = {}, names = sheets.map(function (s) {
      var n = sheetName(s.name), k = 2, base = n;
      while (used[n.toLowerCase()]) n = base.slice(0, 28) + ' ' + (k++);
      used[n.toLowerCase()] = 1; return n;
    });
    var files = [
      ['[Content_Types].xml', HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>'],
      ['_rels/.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', HEAD + '<workbook ' + NS + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names.map(function (n, i) { return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', styles()]
    ];
    sheets.forEach(function (s, i) { files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)]); });
    return zip(files);
  }

  function save(blob, fileName) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = String(fileName).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  window.PRXlsx = { build: build, save: save };
})();
