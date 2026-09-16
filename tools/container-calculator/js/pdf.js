/*
 * pdf.js — a small vector PDF writer.
 *
 * Enough of the PDF spec to produce a clean loading report: core fonts,
 * filled/stroked paths, text with alignment, tables, and the scene objects
 * from draw.js so the drawings on paper match the drawings on screen.
 *
 * No dependencies. Output is uncompressed, which keeps the writer honest
 * and the files perfectly readable by every viewer.
 */

/* Helvetica advance widths, per 1000 units, ASCII 32–126. */
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const ASCII_FOLD = {
  '×': 'x', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"',
  '≥': '>=', '≤': '<=', '·': '-', '→': '->', '…': '...', '™': 'TM', '½': '1/2',
};

function sanitise(s) {
  let out = '';
  for (const ch of String(s)) {
    if (ASCII_FOLD[ch]) { out += ASCII_FOLD[ch]; continue; }
    const code = ch.charCodeAt(0);
    out += code >= 32 && code <= 255 ? ch : '?';
  }
  return out;
}

function latin1(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}

function escapeText(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function widthOf(text, size, bold) {
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    const unit = c >= 32 && c <= 126 ? HELV[c - 32] : 556;
    w += unit;
  }
  return (w / 1000) * size * (bold ? 1.055 : 1);
}

export class PdfDoc {
  /**
   * @param {Object} opts
   * @param {[number,number]} opts.size  page size in points, default A4 landscape
   * @param {Object} opts.colors         token name → [r,g,b] 0–1
   */
  constructor({ size = [842, 595], colors = {} } = {}) {
    this.pageWidth = size[0];
    this.pageHeight = size[1];
    this.colors = colors;
    this.pages = [];
    this.ops = null;
  }

  rgb(token, shade = 1, fallback = [0, 0, 0]) {
    const c = this.colors[token] || fallback;
    return c.map((v) => Math.max(0, Math.min(1, v * shade)));
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    return this;
  }

  /* --- primitives ------------------------------------------------- */

  y(v) { return this.pageHeight - v; } // top-left origin for callers

  setFill(token, shade = 1, fallback) {
    const [r, g, b] = this.rgb(token, shade, fallback);
    this.ops.push(`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`);
  }

  setStroke(token, shade = 1, fallback) {
    const [r, g, b] = this.rgb(token, shade, fallback);
    this.ops.push(`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} RG`);
  }

  rect(x, y, w, h, { fill, stroke, shade = 1, width = 0.6, dash = null } = {}) {
    if (fill) this.setFill(fill, shade);
    if (stroke) { this.setStroke(stroke); this.ops.push(`${width} w`); }
    this.ops.push(dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d');
    this.ops.push(`${x.toFixed(2)} ${this.y(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    this.ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
  }

  line(x1, y1, x2, y2, { stroke = 'border', width = 0.6, dash = null } = {}) {
    this.setStroke(stroke);
    this.ops.push(`${width} w`, dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d');
    this.ops.push(`${x1.toFixed(2)} ${this.y(y1).toFixed(2)} m ${x2.toFixed(2)} ${this.y(y2).toFixed(2)} l S`);
  }

  /** Flatten a token to an opaque colour over white paper. */
  setFillBlended(token, shade, opacity) {
    const [r, g, b] = this.rgb(token, shade).map((c) => c * opacity + (1 - opacity));
    this.ops.push(`${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`);
  }

  polygon(pts, { fill, shade = 1, opacity = 1, stroke, width = 0.5, dash = null } = {}) {
    if (!pts.length) return;
    if (fill) this.setFillBlended(fill, shade, opacity);
    if (stroke) { this.setStroke(stroke); this.ops.push(`${width} w`); }
    this.ops.push(dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d');
    this.ops.push(`${pts[0][0].toFixed(2)} ${this.y(pts[0][1]).toFixed(2)} m`);
    for (let i = 1; i < pts.length; i++) this.ops.push(`${pts[i][0].toFixed(2)} ${this.y(pts[i][1]).toFixed(2)} l`);
    this.ops.push('h');
    this.ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
  }

  /**
   * @param {string} align  'left' | 'center' | 'right'
   */
  text(str, x, y, { size = 9, bold = false, mono = false, color = 'text', align = 'left', shade = 1 } = {}) {
    const s = escapeText(sanitise(str));
    const plain = sanitise(str);
    let tx = x;
    if (align !== 'left') {
      const w = mono ? plain.length * size * 0.6 : widthOf(plain, size, bold);
      tx = align === 'center' ? x - w / 2 : x - w;
    }
    const font = mono ? '/F3' : bold ? '/F2' : '/F1';
    const [r, g, b] = this.rgb(color, shade);
    this.ops.push('BT', `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`, `${font} ${size} Tf`,
      `1 0 0 1 ${tx.toFixed(2)} ${this.y(y).toFixed(2)} Tm`, `(${s}) Tj`, 'ET');
    return this;
  }

  textWidth(str, size, bold) { return widthOf(sanitise(str), size, bold); }

  /** Wrap a paragraph to a width, returning the y position after it. */
  paragraph(str, x, y, maxWidth, { size = 8.5, leading = 11, color = 'text-muted' } = {}) {
    const words = sanitise(str).split(/\s+/);
    let line = '';
    let cy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (widthOf(test, size, false) > maxWidth && line) {
        this.text(line, x, cy, { size, color });
        line = word;
        cy += leading;
      } else line = test;
    }
    if (line) { this.text(line, x, cy, { size, color }); cy += leading; }
    return cy;
  }

  /* --- composites -------------------------------------------------- */

  /**
   * Draw a table. Rows are arrays of strings; `align` per column.
   * Returns the y position below the table.
   */
  table(rows, x, y, widths, {
    size = 8, rowHeight = 15, header = true, align = [], zebra = true,
  } = {}) {
    const total = widths.reduce((s, w) => s + w, 0);
    let cy = y;
    rows.forEach((row, r) => {
      const isHead = header && r === 0;
      if (isHead) {
        this.rect(x, cy, total, rowHeight, { fill: 'primary' });
      } else if (zebra && r % 2 === 0) {
        this.rect(x, cy, total, rowHeight, { fill: 'bg' });
      }
      let cx = x;
      row.forEach((cell, c) => {
        const a = align[c] || 'left';
        const pad = 5;
        const tx = a === 'right' ? cx + widths[c] - pad : a === 'center' ? cx + widths[c] / 2 : cx + pad;
        this.text(String(cell ?? ''), tx, cy + rowHeight - 5, {
          size, bold: isHead, align: a, color: isHead ? 'surface' : 'text',
        });
        cx += widths[c];
      });
      this.line(x, cy + rowHeight, x + total, cy + rowHeight, { stroke: 'border', width: 0.4 });
      cy += rowHeight;
    });
    return cy;
  }

  /**
   * Paint a scene from draw.js into a box on the page.
   * The scene's item list is already in paint order, so walk it once.
   */
  scene(scene, x, y, boxWidth) {
    const scale = boxWidth / scene.width;
    const M = (p) => [x + p[0] * scale, y + p[1] * scale];
    for (const it of scene.items) {
      if (it.type === 'poly') {
        this.polygon(it.pts.map(M), {
          fill: it.fill,
          shade: it.shade ?? 1,
          opacity: it.opacity ?? 1,
          stroke: it.stroke,
          width: (it.strokeWidth ?? 0.5) * scale,
          dash: it.dash,
        });
      } else if (it.type === 'line') {
        const a = M(it.a); const b = M(it.b);
        this.line(a[0], a[1], b[0], b[1], {
          stroke: it.color, width: (it.width ?? 0.5), dash: it.dash,
        });
      } else {
        const p = M([it.x, it.y]);
        this.text(it.text, p[0], p[1], {
          size: Math.max(4.5, it.size * scale), color: it.color, align: it.align, bold: it.weight === 'bold',
        });
      }
    }
    return y + scene.height * scale;
  }

  /* --- assembly ---------------------------------------------------- */

  build() {
    const chunks = [];
    let length = 0;
    const offsets = [];
    const put = (str) => { const b = latin1(str); chunks.push(b); length += b.length; };
    const obj = (n, body) => { offsets[n] = length; put(`${n} 0 obj\n${body}\nendobj\n`); };

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const pageCount = this.pages.length;
    const firstPage = 6;
    const kids = [];
    for (let i = 0; i < pageCount; i++) kids.push(`${firstPage + i * 2} 0 R`);

    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(' ')}] >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

    this.pages.forEach((ops, i) => {
      const pageObj = firstPage + i * 2;
      const streamObj = pageObj + 1;
      obj(pageObj,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${streamObj} 0 R >>`);
      const content = ops.join('\n');
      obj(streamObj, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });

    const xrefStart = length;
    const maxObj = firstPage + pageCount * 2;
    let xref = `xref\n0 ${maxObj}\n0000000000 65535 f \n`;
    for (let n = 1; n < maxObj; n++) {
      xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    put(xref);
    put(`trailer\n<< /Size ${maxObj} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });
  }
}
