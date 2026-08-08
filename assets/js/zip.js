/* Thinkneering — zip.js
   Reads a ZIP archive in the browser. Both .docx and .epub are ZIPs, so this
   is the one layer both book formats sit on.

   No dependency, no build step. Decompression prefers the browser's native
   DecompressionStream and falls back to the inflate below, so an older
   browser still opens a book rather than showing an error.

   Usage:
     var zip = await TNZip.open(arrayBuffer);
     zip.names();                 -> ['word/document.xml', ...]
     await zip.bytes('a/b.xml');  -> Uint8Array
     await zip.text('a/b.xml');   -> string (UTF-8)
*/
(function () {
  'use strict';

  // ------------------------------------------------------------- inflate
  // RFC 1951, raw deflate. Used only when DecompressionStream is missing.

  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
    769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
    9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  // A canonical Huffman table, stored as counts-per-length plus the symbols
  // in code order. Decoding then walks one bit at a time, which is slower
  // than a lookup table but small enough to read and verify.
  function buildTree(lengths) {
    var maxLen = 0, i;
    for (i = 0; i < lengths.length; i++) if (lengths[i] > maxLen) maxLen = lengths[i];
    var counts = new Int32Array(maxLen + 1);
    for (i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;

    var offsets = new Int32Array(maxLen + 2), total = 0;
    for (i = 1; i <= maxLen; i++) { offsets[i] = total; total += counts[i]; }

    var symbols = new Int32Array(total);
    for (i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;

    return { counts: counts, symbols: symbols, maxLen: maxLen };
  }

  function Reader(bytes) {
    this.b = bytes; this.pos = 0; this.bit = 0;
  }
  Reader.prototype.bits = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      if (this.pos >= this.b.length) throw new Error('Ran off the end of the compressed data.');
      v |= ((this.b[this.pos] >> this.bit) & 1) << i;
      this.bit++;
      if (this.bit === 8) { this.bit = 0; this.pos++; }
    }
    return v;
  };
  Reader.prototype.align = function () { if (this.bit) { this.bit = 0; this.pos++; } };
  Reader.prototype.symbol = function (tree) {
    var code = 0, first = 0, index = 0;
    for (var len = 1; len <= tree.maxLen; len++) {
      code |= this.bits(1);
      var count = tree.counts[len];
      if (code - first < count) return tree.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Bad Huffman code in the compressed data.');
  };

  var FIXED_LIT = null, FIXED_DIST = null;
  function fixedTrees() {
    if (FIXED_LIT) return;
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (i = 144; i < 256; i++) l[i] = 9;
    for (i = 256; i < 280; i++) l[i] = 7;
    for (i = 280; i < 288; i++) l[i] = 8;
    FIXED_LIT = buildTree(l);
    var d = new Uint8Array(30);
    for (i = 0; i < 30; i++) d[i] = 5;
    FIXED_DIST = buildTree(d);
  }

  function inflateRaw(bytes, expectedSize) {
    var r = new Reader(bytes);
    var out = new Uint8Array(expectedSize > 0 ? expectedSize : Math.max(1024, bytes.length * 4));
    var len = 0;

    function push(byte) {
      if (len === out.length) {
        var bigger = new Uint8Array(out.length * 2);
        bigger.set(out); out = bigger;
      }
      out[len++] = byte;
    }

    for (;;) {
      var last = r.bits(1);
      var type = r.bits(2);

      if (type === 0) {
        r.align();
        var n = r.b[r.pos] | (r.b[r.pos + 1] << 8);
        r.pos += 4;                       // skip LEN and its complement
        for (var s = 0; s < n; s++) push(r.b[r.pos++]);
      } else {
        var lit, dist;
        if (type === 1) {
          fixedTrees(); lit = FIXED_LIT; dist = FIXED_DIST;
        } else if (type === 2) {
          var hlit = r.bits(5) + 257, hdist = r.bits(5) + 1, hclen = r.bits(4) + 4;
          var clen = new Uint8Array(19), i;
          for (i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = r.bits(3);
          var clenTree = buildTree(clen);

          var all = new Uint8Array(hlit + hdist);
          for (i = 0; i < all.length;) {
            var sym = r.symbol(clenTree);
            if (sym < 16) { all[i++] = sym; }
            else if (sym === 16) {
              var prev = all[i - 1], rep = 3 + r.bits(2);
              while (rep--) all[i++] = prev;
            } else if (sym === 17) {
              var z = 3 + r.bits(3); while (z--) all[i++] = 0;
            } else {
              var z2 = 11 + r.bits(7); while (z2--) all[i++] = 0;
            }
          }
          lit = buildTree(all.subarray(0, hlit));
          dist = buildTree(all.subarray(hlit));
        } else {
          throw new Error('Unsupported compression block.');
        }

        for (;;) {
          var sym2 = r.symbol(lit);
          if (sym2 === 256) break;
          if (sym2 < 256) { push(sym2); continue; }
          var li = sym2 - 257;
          var length = LEN_BASE[li] + r.bits(LEN_EXTRA[li]);
          var di = r.symbol(dist);
          var distance = DIST_BASE[di] + r.bits(DIST_EXTRA[di]);
          var from = len - distance;
          for (var k = 0; k < length; k++) push(out[from + k]);
        }
      }
      if (last) break;
    }
    return out.subarray(0, len);
  }

  var NATIVE = typeof DecompressionStream === 'function';

  async function inflate(bytes, expectedSize) {
    if (NATIVE) {
      try {
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* fall through to the JS path */ }
    }
    return inflateRaw(bytes, expectedSize);
  }

  // ----------------------------------------------------------- zip reader
  // Read the central directory rather than scanning local headers: local
  // headers may carry zeroed sizes when a data descriptor was used, and the
  // central directory always holds the real values.

  function findEOCD(view, size) {
    var max = Math.min(size, 66000);        // comment field caps at 64 KB
    for (var i = size - 22; i >= size - max && i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  var utf8 = new TextDecoder('utf-8');

  async function open(buffer) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var eocd = findEOCD(view, bytes.length);
    if (eocd < 0) throw new Error('This file is not a readable ZIP archive.');

    var count = view.getUint16(eocd + 10, true);
    var start = view.getUint32(eocd + 16, true);

    // Zip64: the 32-bit fields saturate, so read the locator instead.
    if (start === 0xffffffff || count === 0xffff) {
      var loc = eocd - 20;
      if (loc >= 0 && view.getUint32(loc, true) === 0x07064b50) {
        var z64 = Number(view.getBigUint64(loc + 8, true));
        if (view.getUint32(z64, true) === 0x06064b50) {
          count = Number(view.getBigUint64(z64 + 32, true));
          start = Number(view.getBigUint64(z64 + 48, true));
        }
      }
    }

    var entries = {}, order = [], p = start;
    for (var n = 0; n < count && p + 46 <= bytes.length; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var rawSize = view.getUint32(p + 24, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var offset = view.getUint32(p + 42, true);
      var name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));

      // Zip64 extended information, when any 32-bit field saturated.
      if (rawSize === 0xffffffff || compSize === 0xffffffff || offset === 0xffffffff) {
        var e = p + 46 + nameLen, end = e + extraLen;
        while (e + 4 <= end) {
          var tag = view.getUint16(e, true), sz = view.getUint16(e + 2, true), q = e + 4;
          if (tag === 0x0001) {
            if (rawSize === 0xffffffff) { rawSize = Number(view.getBigUint64(q, true)); q += 8; }
            if (compSize === 0xffffffff) { compSize = Number(view.getBigUint64(q, true)); q += 8; }
            if (offset === 0xffffffff) { offset = Number(view.getBigUint64(q, true)); }
          }
          e += 4 + sz;
        }
      }

      if (!/\/$/.test(name)) {
        entries[name] = { method: method, compSize: compSize, rawSize: rawSize, offset: offset };
        order.push(name);
      }
      p += 46 + nameLen + extraLen + commentLen;
    }

    if (!order.length) throw new Error('That archive is empty.');

    var cache = {};

    async function bytesOf(name) {
      if (cache[name]) return cache[name];
      var e = entries[name];
      if (!e) throw new Error('Missing "' + name + '" inside the book file.');

      // The local header carries its own name/extra lengths, which need not
      // match the central directory's, so read them here rather than assume.
      var h = e.offset;
      if (view.getUint32(h, true) !== 0x04034b50) throw new Error('Damaged entry: ' + name);
      var dataAt = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true);
      var raw = bytes.subarray(dataAt, dataAt + e.compSize);

      var out;
      if (e.method === 0) out = raw;
      else if (e.method === 8) out = await inflate(raw, e.rawSize);
      else throw new Error('Unsupported compression in the book file.');

      cache[name] = out;
      return out;
    }

    return {
      names: function () { return order.slice(); },
      has: function (name) { return Object.prototype.hasOwnProperty.call(entries, name); },
      bytes: bytesOf,
      text: async function (name) { return utf8.decode(await bytesOf(name)); }
    };
  }

  window.TNZip = { open: open, inflateRaw: inflateRaw };
})();
