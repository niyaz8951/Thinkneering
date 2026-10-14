/* =====================================================================
   xlsx-out.js — .xlsx writer for the Coil Data Extractor.

   A copy of tools/parts-extractor/xlsx-out.js with two additions this tool
   needs: numeric cells (so capacities and airflows can be summed and
   filtered as numbers, not text) and column widths sized to the content.
   Kept inside the tool folder because each tool is self-contained; the two
   copies are candidates for one shared writer in assets/js/ if a third
   tool ever needs it.

   API:
     await xlsxOut.build([
       { name: 'Coils',
         columns: ['A','B'],
         rows: [['text', 12.5], ...],   // numbers are written as numbers
         fills: [0, 1, ...]             // optional, per data row: 0 none, 1 highlight
       }, ...
     ])  ->  Uint8Array
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------------- CRC32 ---------------- */
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

  function strToU8(str) { return new TextEncoder().encode(str); }

  /* ---------------- deflate ---------------- */
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const parts = [];
      const reader = cs.readable.getReader();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        total += value.length;
      }
      const out = new Uint8Array(total);
      let p = 0;
      for (const part of parts) { out.set(part, p); p += part.length; }
      return out;
    } catch (e) {
      return null;   // any failure falls back to storing
    }
  }

  /* ---------------- ZIP ---------------- */
  async function zip(files) {
    var chunks = [];
    var central = [];
    var offset = 0;

    function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
    function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

    for (const f of files) {
      var nameBytes = strToU8(f.name);
      var raw = f.data;
      var crc = crc32(raw);              // CRC is always of the UNCOMPRESSED bytes
      var size = raw.length;

      var packed = await deflateRaw(raw);
      var method = packed ? 8 : 0;
      var body = packed || raw;
      var csize = body.length;

      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
        u32(crc), u32(csize), u32(size),
        u16(nameBytes.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameBytes, body);

      var cen = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
        u32(crc), u32(csize), u32(size),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset)
      );
      central.push({ head: new Uint8Array(cen), name: nameBytes });

      offset += local.length + nameBytes.length + csize;
    }

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

  /* ---------------- XML ---------------- */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      /* Excel rejects most control characters outright. Strip them rather
         than produce a file that will not open. */
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  function colLetter(idx) {   // 1 -> A
    var s = '';
    while (idx > 0) {
      var m = (idx - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      idx = Math.floor((idx - m) / 26);
    }
    return s;
  }

  /* Style indices used below:
       0 body
       1 header      (bold, grey fill, border)
       2 highlighted (amber fill) — a row the tool wants looked at */
  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="4">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F4"/></patternFill></fill>' +   // 2 header grey
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>' +   // 3 amber highlight
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color rgb="FFD0D3DA"/></left><right style="thin"><color rgb="FFD0D3DA"/></right>' +
        '<top style="thin"><color rgb="FFD0D3DA"/></top><bottom style="thin"><color rgb="FFD0D3DA"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------------- build ---------------- */
  async function build(sheets) {
    /* One shared string table across every sheet. Indices are assigned on
       first sight; an empty cell is written as no cell at all. */
    var strings = [];
    var index = new Map();
    function sid(v) {
      var s = String(v);
      var i = index.get(s);
      if (i === undefined) { i = strings.length; index.set(s, i); strings.push(s); }
      return i;
    }

    var sheetXml = sheets.map(function (sheet) {
      var cols = sheet.columns;
      var out = [];
      /* Width from the longest text in each column, capped so one long
         coil code does not push everything else off screen. */
      var widths = cols.map(function (c, k) {
        var w = String(c).length;
        for (var r = 0; r < sheet.rows.length && r < 500; r++) {
          var v = sheet.rows[r][k];
          if (v !== undefined && v !== null) w = Math.max(w, String(v).length);
        }
        return Math.min(60, Math.max(8, w + 2));
      });
      out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>' +
        '<cols>' + widths.map(function (w, k) {
          return '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + w + '" customWidth="1"/>';
        }).join('') + '</cols>' +
        '<sheetData>');

      // header
      var h = ['<row r="1">'];
      for (var c = 0; c < cols.length; c++) {
        h.push('<c r="' + colLetter(c + 1) + '1" t="s" s="1"><v>' + sid(cols[c]) + '</v></c>');
      }
      h.push('</row>');
      out.push(h.join(''));

      // body
      var fills = sheet.fills || [];
      for (var r = 0; r < sheet.rows.length; r++) {
        var row = sheet.rows[r];
        var st = fills[r] ? ' s="2"' : '';
        var rn = r + 2;
        var parts = ['<row r="' + rn + '">'];
        for (var k = 0; k < cols.length; k++) {
          var v = row[k];
          if (v === undefined || v === null || v === '') continue;
          if (typeof v === 'number' && isFinite(v)) {
            parts.push('<c r="' + colLetter(k + 1) + rn + '"' + st + '><v>' + v + '</v></c>');
          } else {
            parts.push('<c r="' + colLetter(k + 1) + rn + '" t="s"' + st + '><v>' + sid(v) + '</v></c>');
          }
        }
        parts.push('</row>');
        out.push(parts.join(''));
      }

      out.push('</sheetData>' +
        '<autoFilter ref="A1:' + colLetter(cols.length) + (sheet.rows.length + 1) + '"/>' +
        '</worksheet>');
      return out.join('');
    });

    var sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
      strings.length + '" uniqueCount="' + strings.length + '">' +
      strings.map(function (s) { return '<si><t xml:space="preserve">' + esc(s) + '</t></si>'; }).join('') +
      '</sst>';

    var wbXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) {
        return '<sheet name="' + esc(s.name).slice(0, 31) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') +
      '</sheets></workbook>';

    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId' + (sheets.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '</Relationships>';

    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var files = [
      { name: '[Content_Types].xml', data: strToU8(types) },
      { name: '_rels/.rels', data: strToU8(rels) },
      { name: 'xl/workbook.xml', data: strToU8(wbXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: strToU8(wbRels) },
      { name: 'xl/styles.xml', data: strToU8(STYLES) },
      { name: 'xl/sharedStrings.xml', data: strToU8(sst) },
    ];
    sheetXml.forEach(function (x, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: strToU8(x) });
    });

    return zip(files);
  }

  global.xlsxOut = { build: build };
})(typeof self !== 'undefined' ? self : this);
