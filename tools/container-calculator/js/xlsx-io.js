/*
 * xlsx-io.js — read and write spreadsheets with no library.
 *
 * Reading uses the browser's native DecompressionStream('deflate-raw') to
 * inflate the .xlsx zip, then DOMParser on the sheet XML.
 * Writing emits a small, valid .xlsx with stored (uncompressed) zip entries.
 * CSV is handled directly.
 */

/* ------------------------------------------------------------------ *
 * ZIP reading
 * ------------------------------------------------------------------ */

function u16(d, o) { return d[o] | (d[o + 1] << 8); }
function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot read .xlsx files. Save the sheet as CSV and upload that instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(arrayBuffer) {
  const d = new Uint8Array(arrayBuffer);
  // End of central directory
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 66000); i--) {
    if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That file is not a readable .xlsx workbook.');
  const count = u16(d, eocd + 10);
  let ptr = u32(d, eocd + 16);
  const files = new Map();

  for (let n = 0; n < count; n++) {
    if (u32(d, ptr) !== 0x02014b50) break;
    const method = u16(d, ptr + 10);
    const compSize = u32(d, ptr + 20);
    const nameLen = u16(d, ptr + 28);
    const extraLen = u16(d, ptr + 30);
    const commentLen = u16(d, ptr + 32);
    const localOff = u32(d, ptr + 42);
    const name = new TextDecoder().decode(d.subarray(ptr + 46, ptr + 46 + nameLen));

    const lNameLen = u16(d, localOff + 26);
    const lExtraLen = u16(d, localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = d.subarray(start, start + compSize);
    files.set(name, { method, raw });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map();
  for (const [name, entry] of files) {
    if (!/^xl\/|^\[Content_Types\]/.test(name)) continue;
    const bytes = entry.method === 0 ? entry.raw : await inflateRaw(entry.raw);
    out.set(name, new TextDecoder().decode(bytes));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Sheet parsing
 * ------------------------------------------------------------------ */

function colToIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The workbook XML could not be read.');
  return doc;
}

function sharedStrings(files) {
  const xml = files.get('xl/sharedStrings.xml');
  if (!xml) return [];
  const doc = parseXml(xml);
  return [...doc.getElementsByTagName('si')].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')
  );
}

function firstSheetPath(files) {
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    try {
      const sheet = parseXml(wb).getElementsByTagName('sheet')[0];
      const rid = sheet && (sheet.getAttribute('r:id') || sheet.getAttribute('id'));
      if (rid) {
        for (const rel of parseXml(rels).getElementsByTagName('Relationship')) {
          if (rel.getAttribute('Id') === rid) {
            const target = rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
            return `xl/${target}`;
          }
        }
      }
    } catch { /* fall through to the default path */ }
  }
  return 'xl/worksheets/sheet1.xml';
}

function sheetToRows(xml, strings) {
  const doc = parseXml(xml);
  const rows = [];
  for (const row of doc.getElementsByTagName('row')) {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      const idx = ref ? colToIndex(ref) : cells.length;
      const type = c.getAttribute('t');
      let value = '';
      if (type === 'inlineStr') {
        value = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
      } else {
        const v = c.getElementsByTagName('v')[0];
        const raw = v ? v.textContent : '';
        value = type === 's' ? (strings[Number(raw)] ?? '') : raw;
      }
      cells[idx] = value;
    }
    rows.push([...cells].map((v) => (v === undefined ? '' : v)));
  }
  return rows;
}

/** Read the first worksheet of an .xlsx file into an array of row arrays. */
export async function readWorkbook(file) {
  const files = await unzip(await file.arrayBuffer());
  const path = firstSheetPath(files);
  const xml = files.get(path) || files.get('xl/worksheets/sheet1.xml');
  if (!xml) throw new Error('No worksheet was found in that workbook.');
  return sheetToRows(xml, sharedStrings(files));
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',' || ch === '\t' || ch === ';') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/* ------------------------------------------------------------------ *
 * Header mapping — tolerant of real-world sheets
 * ------------------------------------------------------------------ */

/* Order matters: earlier aliases win when a sheet has several candidates.
   A packing list with both "Product Code" and "Unit Reference" should be
   tagged by the reference, because that is what identifies the crate. */
const SYNONYMS = {
  tag: ['tag', 'unit reference', 'reference', 'description', 'item', 'name', 'mark', 'label', 'product code'],
  length: ['length', 'l', 'len', 'length m', 'length mm', 'lengthm'],
  width: ['width', 'w', 'wid', 'width m', 'width mm'],
  height: ['height', 'h', 'ht', 'height m', 'height mm', 'depth'],
  weight: ['gross weight', 'gross weight kgs', 'gross weight kg', 'weight', 'weight kg', 'weight kgs', 'gross wt', 'kg'],
  qty: ['qty', 'quantity', 'nos', 'no', 'count', 'pcs'],
  stackable: ['stackable', 'can stack', 'stack'],
};

function normalise(s) {
  return String(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** @returns {{field:string, rank:number}|null} lower rank is a better match */
function matchField(header) {
  const h = normalise(header);
  if (!h) return null;
  for (const [field, list] of Object.entries(SYNONYMS)) {
    const exact = list.indexOf(h);
    if (exact >= 0) return { field, rank: exact };
  }
  for (const [field, list] of Object.entries(SYNONYMS)) {
    const prefix = list.findIndex((alias) => alias.length > 2 && h.startsWith(alias));
    if (prefix >= 0) return { field, rank: 100 + prefix };
  }
  return null;
}

function findHeaderRow(rows) {
  let best = { score: 0, index: -1, map: null };
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const map = {};
    const ranks = {};
    rows[i].forEach((cell, c) => {
      const hit = matchField(cell);
      if (!hit) return;
      if (ranks[hit.field] === undefined || hit.rank < ranks[hit.field]) {
        map[hit.field] = c;
        ranks[hit.field] = hit.rank;
      }
    });
    const score = Object.keys(map).length;
    const usable = ['length', 'width', 'height'].every((f) => map[f] !== undefined);
    if (usable && score > best.score) best = { score, index: i, map };
  }
  return best.index >= 0 ? best : null;
}

function num(v) {
  if (v === undefined || v === null || v === '') return NaN;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Turn raw sheet rows into item rows.
 * Detects millimetres automatically — a "length" of 12000 is not 12 km of AHU.
 * @returns {{items:Array, unit:'m'|'mm', headerRow:number, skipped:number, mapped:Object}}
 */
export function rowsToItems(rows) {
  const found = findHeaderRow(rows);
  if (!found) {
    throw new Error('No header row found. The sheet needs columns named Tag, Length, Width, Height and Gross Weight.');
  }
  const { index, map } = found;
  const raw = [];
  let skipped = 0;

  for (let r = index + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const l = num(row[map.length]);
    const w = num(row[map.width]);
    const h = num(row[map.height]);
    if (!(l > 0 && w > 0 && h > 0)) { skipped++; continue; }
    const stackRaw = map.stackable !== undefined ? String(row[map.stackable]).trim().toLowerCase() : '';
    raw.push({
      tag: map.tag !== undefined ? String(row[map.tag] || '').trim() || `Item ${raw.length + 1}` : `Item ${raw.length + 1}`,
      length: l,
      width: w,
      height: h,
      weight: map.weight !== undefined ? (num(row[map.weight]) || 0) : 0,
      qty: map.qty !== undefined ? Math.max(1, Math.round(num(row[map.qty]) || 1)) : 1,
      stackable: stackRaw === '' ? true : !['no', 'n', 'false', '0', 'do not stack'].includes(stackRaw),
    });
  }

  // Millimetre detection: if the biggest dimension is implausible in metres.
  const maxDim = raw.reduce((m, i) => Math.max(m, i.length, i.width, i.height), 0);
  const unit = maxDim > 25 ? 'mm' : 'm';
  if (unit === 'mm') {
    for (const i of raw) { i.length /= 1000; i.width /= 1000; i.height /= 1000; }
  }
  return { items: raw, unit, headerRow: index + 1, skipped, mapped: map };
}

/* ------------------------------------------------------------------ *
 * ZIP writing (stored entries)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const push = (arr) => { chunks.push(arr); offset += arr.length; };
  const head = (size) => new DataView(new ArrayBuffer(size));

  for (const [name, text] of entries) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const lh = head(30);
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true);      // stored
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    const localOffset = offset;
    push(new Uint8Array(lh.buffer));
    push(nameBytes);
    push(data);

    const ch = head(46);
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, localOffset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { chunks.push(c); cdSize += c.length; }
  const eocd = head(22);
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  chunks.push(new Uint8Array(eocd.buffer));

  return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colName(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sheetXml(rows, widths) {
  const cols = widths
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const body = rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (cell === null || cell === undefined || cell === '') return '';
      if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** Build a single-sheet .xlsx Blob from an array of row arrays. */
export function buildWorkbook(rows, sheetName = 'Sheet1', widths = null) {
  const entries = [
    ['[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheetXml(rows, widths)],
  ];
  return zipStore(entries);
}

/** The blank input sheet users download, fill in and upload back. */
export function templateWorkbook() {
  const rows = [
    ['Tag', 'Length (m)', 'Width (m)', 'Height (m)', 'Gross Weight (kg)', 'Qty', 'Stackable'],
    ['FAHU-1 (SECTION 1/6)', 3.9, 1.8, 2.5, 648, 1, 'Yes'],
    ['FAHU-1 (SECTION 2/6)', 3.9, 1.0, 2.2, 148, 1, 'Yes'],
    ['HRW-3200-EZ-200', 3.9, 1.0, 2.4, 720, 2, 'No'],
  ];
  return buildWorkbook(rows, 'Items', [28, 12, 12, 12, 18, 8, 11]);
}
