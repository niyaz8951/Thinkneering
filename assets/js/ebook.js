/* Thinkneering — ebook.js
   Turns a .docx or .epub file into one shape the reader understands:

     { format, title, subtitle, author, description, coverUrl,
       chapters: [ { slug, title, access, html } ] }

   Nothing here touches the network or the database. The file is the book:
   its title, its contents list and its chapters all come out of the file
   itself, which is why dropping a new one into /books/ is enough.

   Access is not decided here. The whole Education section is gated as one
   thing, so a file that reaches this point is one the reader is allowed to
   read in full.

   Requires zip.js.
*/
(function () {
  'use strict';

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var DC = 'http://purl.org/dc/elements/1.1/';

  var esc = window.TN ? window.TN.esc : function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function parseXML(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('The book file contains XML this reader could not read.');
    }
    return doc;
  }

  function slugify(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chapter';
  }

  function uniqueSlugs(chapters) {
    var seen = {};
    chapters.forEach(function (c, i) {
      var base = slugify(c.title) || 'chapter-' + (i + 1);
      var slug = base, n = 2;
      while (seen[slug]) { slug = base + '-' + n; n++; }
      seen[slug] = true;
      c.slug = slug;
    });
    return chapters;
  }

  // ------------------------------------------------------------- images
  // Media is pulled out of the archive and handed to the page as a blob URL,
  // so images survive without a server round trip or a media library.
  var MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff', emf: '', wmf: ''
  };

  async function blobURL(zip, path, revoke) {
    try {
      var ext = (path.split('.').pop() || '').toLowerCase();
      var type = MIME[ext];
      if (type === '') return null;                 // vector formats browsers cannot show
      var url = URL.createObjectURL(new Blob([await zip.bytes(path)], { type: type || 'application/octet-stream' }));
      revoke.push(url);
      return url;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------- verse grouping
  // Poems arrive as one paragraph per line. Left alone they render with a
  // full paragraph gap between every line, which reads as broken rather than
  // as a stanza. A run of short lines that mostly do not end a sentence is
  // treated as verse and set tight.
  var DIVIDER = /^([*\-\u2013\u2014_\u2022\u00b7#=~]\s*){3,}$/;

  function isShortLine(t) { return t.length > 0 && t.length <= 60; }
  function endsSentence(t) { return /[.!?][)"'\u2019\u201d]?$/.test(t); }

  function groupVerse(parts) {
    var out = [], run = [];

    function flush() {
      if (!run.length) return;
      var texts = run.map(function (p) { return p.text; });
      var terminal = texts.filter(endsSentence).length;
      if (run.length >= 4 && terminal / run.length <= 0.4) {
        out.push('<div class="verse">' + run.map(function (p) { return p.html; }).join('') + '</div>');
      } else {
        run.forEach(function (p) { out.push(p.html); });
      }
      run = [];
    }

    parts.forEach(function (p) {
      if (p && p.kind === 'para' && isShortLine(p.text)) { run.push(p); return; }
      flush();
      if (p) out.push(typeof p === 'string' ? p : p.html);
    });
    flush();
    return out.join('');
  }

  // ================================================================ DOCX
  function runHTML(node, rels, media) {
    var out = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var n = node.childNodes[i];
      if (n.nodeType !== 1) continue;
      var name = n.localName;

      if (name === 'hyperlink') {
        var rid = n.getAttributeNS(R, 'id');
        var href = rid && rels[rid] ? rels[rid].target : '';
        var inner = runHTML(n, rels, media);
        out += /^https?:\/\//.test(href)
          ? '<a href="' + esc(href) + '" rel="noopener">' + inner + '</a>'
          : inner;
        continue;
      }
      if (name !== 'r') continue;

      var props = n.getElementsByTagNameNS(W, 'rPr')[0];
      var bold = false, italic = false, mono = false;
      if (props) {
        bold = !!props.getElementsByTagNameNS(W, 'b')[0];
        italic = !!props.getElementsByTagNameNS(W, 'i')[0];
        var font = props.getElementsByTagNameNS(W, 'rFonts')[0];
        var face = font ? (font.getAttributeNS(W, 'ascii') || '') : '';
        mono = /consolas|courier|mono/i.test(face);
      }

      var piece = '';
      for (var j = 0; j < n.childNodes.length; j++) {
        var c = n.childNodes[j];
        if (c.nodeType !== 1) continue;
        if (c.localName === 't') piece += esc(c.textContent);
        else if (c.localName === 'br') piece += '<br>';
        else if (c.localName === 'tab') piece += ' ';
        else if (c.localName === 'drawing' || c.localName === 'pict') {
          var blips = c.getElementsByTagName('*');
          for (var k = 0; k < blips.length; k++) {
            var b = blips[k];
            if (b.localName !== 'blip' && b.localName !== 'imagedata') continue;
            var id = b.getAttributeNS(R, 'embed') || b.getAttributeNS(R, 'id');
            var url = id && media[id];
            if (url) piece += '<img src="' + esc(url) + '" alt="" loading="lazy">';
            break;
          }
        }
      }
      if (!piece) continue;
      if (mono) piece = '<code>' + piece + '</code>';
      if (bold) piece = '<strong>' + piece + '</strong>';
      if (italic) piece = '<em>' + piece + '</em>';
      out += piece;
    }
    return out;
  }

  function styleId(p) {
    var s = p.getElementsByTagNameNS(W, 'pStyle')[0];
    return s ? (s.getAttributeNS(W, 'val') || '').replace(/\s+/g, '').toLowerCase() : '';
  }

  function numbering(p) {
    var pr = p.getElementsByTagNameNS(W, 'numPr')[0];
    if (!pr) return null;
    var idEl = pr.getElementsByTagNameNS(W, 'numId')[0];
    return idEl ? (idEl.getAttributeNS(W, 'val') || '') : '';
  }

  function tableHTML(tbl, rels, media) {
    var rows = [];
    for (var i = 0; i < tbl.childNodes.length; i++) {
      var tr = tbl.childNodes[i];
      if (tr.nodeType !== 1 || tr.localName !== 'tr') continue;
      var cells = [];
      for (var j = 0; j < tr.childNodes.length; j++) {
        var tc = tr.childNodes[j];
        if (tc.nodeType !== 1 || tc.localName !== 'tc') continue;
        var inner = [];
        var ps = tc.getElementsByTagNameNS(W, 'p');
        for (var k = 0; k < ps.length; k++) inner.push(runHTML(ps[k], rels, media));
        cells.push(inner.filter(Boolean).join('<br>'));
      }
      rows.push(cells);
    }
    if (!rows.length) return '';
    var head = rows.shift();
    return '<div class="table-wrap"><table class="data"><thead><tr>' +
      head.map(function (c) { return '<th scope="col">' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  async function readDocx(zip, revoke) {
    if (!zip.has('word/document.xml')) throw new Error('That .docx has no document part.');

    // relationship id -> target, and the images among them as blob URLs
    var rels = {}, media = {};
    if (zip.has('word/_rels/document.xml.rels')) {
      var rx = parseXML(await zip.text('word/_rels/document.xml.rels'));
      var list = rx.getElementsByTagName('Relationship');
      for (var i = 0; i < list.length; i++) {
        var id = list[i].getAttribute('Id');
        var target = list[i].getAttribute('Target') || '';
        rels[id] = { target: target, type: list[i].getAttribute('Type') || '' };
        if (/^media\//.test(target)) {
          var url = await blobURL(zip, 'word/' + target, revoke);
          if (url) media[id] = url;
        }
      }
    }

    // Which numbering ids are ordered? Anything not explicitly a bullet.
    var ordered = {};
    if (zip.has('word/numbering.xml')) {
      try {
        var nx = parseXML(await zip.text('word/numbering.xml'));
        var abstractFmt = {};
        var abs = nx.getElementsByTagNameNS(W, 'abstractNum');
        for (var a = 0; a < abs.length; a++) {
          var lvl = abs[a].getElementsByTagNameNS(W, 'lvl')[0];
          var fmt = lvl && lvl.getElementsByTagNameNS(W, 'numFmt')[0];
          abstractFmt[abs[a].getAttributeNS(W, 'abstractNumId')] =
            fmt ? (fmt.getAttributeNS(W, 'val') || '') : '';
        }
        var nums = nx.getElementsByTagNameNS(W, 'num');
        for (var m = 0; m < nums.length; m++) {
          var ref = nums[m].getElementsByTagNameNS(W, 'abstractNumId')[0];
          var f = ref ? abstractFmt[ref.getAttributeNS(W, 'val')] : '';
          ordered[nums[m].getAttributeNS(W, 'numId')] = f !== 'bullet';
        }
      } catch (e) { /* numbering is a nicety, not a reason to fail */ }
    }

    var meta = { title: '', author: '', subtitle: '', description: '' };
    if (zip.has('docProps/core.xml')) {
      try {
        var cx = parseXML(await zip.text('docProps/core.xml'));
        var pick = function (tag) {
          var n = cx.getElementsByTagNameNS(DC, tag)[0];
          return n ? n.textContent.trim() : '';
        };
        meta.title = pick('title');
        meta.author = pick('creator');
        meta.subtitle = pick('subject');
        meta.description = pick('description');
      } catch (e) { /* keep going without metadata */ }
    }

    var doc = parseXML(await zip.text('word/document.xml'));
    var body = doc.getElementsByTagNameNS(W, 'body')[0];
    if (!body) throw new Error('That .docx has no readable body.');

    var chapters = [];
    var current = null;                       // { title, access, parts: [] }
    var listRun = null;                       // open <ul>/<ol> being collected
    var coverUrl = null;

    function open(title) {
      closeList();
      current = { title: title, parts: [] };
      chapters.push(current);
    }
    function closeList() {
      if (!current || !listRun) return;
      current.parts.push('<' + listRun.tag + '>' + listRun.items.join('') + '</' + listRun.tag + '>');
      listRun = null;
    }
    function push(html) {
      if (!html) return;
      if (!current) open(meta.title || 'Beginning');
      closeList();
      current.parts.push(html);
    }
    function pushPara(html, text) {
      if (!current) open(meta.title || 'Beginning');
      closeList();
      current.parts.push({ kind: 'para', html: html, text: text });
    }

    for (var b = 0; b < body.childNodes.length; b++) {
      var node = body.childNodes[b];
      if (node.nodeType !== 1) continue;

      if (node.localName === 'tbl') { push(tableHTML(node, rels, media)); continue; }
      if (node.localName !== 'p') continue;

      var style = styleId(node);
      var html = runHTML(node, rels, media);
      var text = (node.textContent || '').trim();

      if (style === 'title') { if (!meta.title) meta.title = text; continue; }
      if (style === 'subtitle') { if (!meta.subtitle) meta.subtitle = text; continue; }

      var h = /^heading([1-9])$/.exec(style);
      if (h && Number(h[1]) === 1) {
        open(text || 'Chapter ' + (chapters.length + 1));
        continue;
      }
      if (h) {
        var level = Math.min(Number(h[1]), 4);
        push('<h' + level + '>' + html + '</h' + level + '>');
        continue;
      }

      if (!text && !/<img/.test(html)) continue;                 // spacer paragraph

      // A standalone image paragraph becomes a figure, and the first one in
      // the file doubles as the cover when the file offers no other.
      if (!text && /<img/.test(html)) {
        if (!coverUrl) {
          var src = /src="([^"]+)"/.exec(html);
          if (src) coverUrl = src[1];
        }
        push('<figure>' + html + '</figure>');
        continue;
      }

      if (DIVIDER.test(text)) { push('<hr>'); continue; }

      var num = numbering(node);
      var isList = num !== null || style === 'listbullet' || style === 'listnumber' || style === 'listparagraph';
      if (isList) {
        var tag = (num !== null && ordered[num]) || style === 'listnumber' ? 'ol' : 'ul';
        if (!current) open(meta.title || 'Beginning');
        if (!listRun || listRun.tag !== tag) { closeList(); listRun = { tag: tag, items: [] }; }
        listRun.items.push('<li>' + html + '</li>');
        continue;
      }

      if (style === 'quote') { push('<blockquote>' + html + '</blockquote>'); continue; }
      if (style === 'intensequote') { push('<div class="notice"><div>' + html + '</div></div>'); continue; }
      if (style === 'caption') { push('<p class="ebook-caption">' + html + '</p>'); continue; }

      pushPara('<p>' + html + '</p>', text);
    }
    closeList();

    var out = chapters
      .filter(function (c) { return c.parts.length; })
      .map(function (c) {
        return { title: c.title, html: groupVerse(c.parts) };
      });

    return {
      format: 'docx',
      title: meta.title || 'Untitled',
      subtitle: meta.subtitle,
      author: meta.author,
      description: meta.description,
      coverUrl: coverUrl,
      chapters: uniqueSlugs(out)
    };
  }

  // ================================================================ EPUB
  var KEEP = {
    P: 'p', DIV: null, SPAN: null, BR: 'br', HR: 'hr',
    H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h4', H6: 'h4',
    EM: 'em', I: 'em', STRONG: 'strong', B: 'strong', U: 'em',
    UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote',
    TABLE: 'table', THEAD: 'thead', TBODY: 'tbody', TR: 'tr', TD: 'td', TH: 'th',
    SUP: 'sup', SUB: 'sub', CODE: 'code', PRE: 'pre', FIGURE: 'figure',
    FIGCAPTION: 'figcaption', IMG: 'img', A: 'a'
  };
  var BLOCKISH = { p: 1, h2: 1, h3: 1, h4: 1, ul: 1, ol: 1, blockquote: 1, table: 1, figure: 1, pre: 1, hr: 1 };

  // Rebuild each document from an allow-list. Anything unknown contributes
  // its text but not its markup, so a stray script or style cannot ride in
  // and the output always matches the site's own type styles.
  function sanitize(node, images, base) {
    return sanitizeNodes(node.childNodes, images, base);
  }

  function sanitizeNodes(nodes, images, base) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) { out += esc(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;

      var tag = KEEP[n.tagName.toUpperCase()];
      if (tag === undefined) continue;                 // drop node and subtree
      if (tag === null) { out += sanitize(n, images, base); continue; }

      if (tag === 'br' || tag === 'hr') { out += '<' + tag + '>'; continue; }

      if (tag === 'img') {
        var src = n.getAttribute('src') || '';
        var url = images[resolvePath(base, src)];
        if (url) out += '<img src="' + esc(url) + '" alt="' + esc(n.getAttribute('alt') || '') + '" loading="lazy">';
        continue;
      }

      var inner = sanitize(n, images, base);
      if (tag === 'a') {
        var href = n.getAttribute('href') || '';
        out += /^https?:\/\//.test(href)
          ? '<a href="' + esc(href) + '" rel="noopener">' + inner + '</a>'
          : inner;
        continue;
      }
      // Judge emptiness by text and images, not by markup: a paragraph
      // holding only a <br> is a spacer, and spacers are the layout of the
      // source file rather than content of the book.
      if (BLOCKISH[tag] && !(n.textContent || '').trim() && !/<img/.test(inner)) continue;
      out += '<' + tag + '>' + inner + '</' + tag + '>';
    }
    return out;
  }

  function resolvePath(base, rel) {
    if (!rel) return '';
    rel = rel.split('#')[0];
    if (!rel) return '';
    var stack = base ? base.split('/') : [];
    stack.pop();
    rel.split('/').forEach(function (part) {
      if (part === '.' || part === '') return;
      if (part === '..') stack.pop();
      else stack.push(part);
    });
    return stack.join('/');
  }

  // A contents link is a path plus an optional #anchor. Both matter: the path
  // says which document, the anchor says where inside it the chapter starts.
  function tocEntry(title, from, link) {
    var raw = link || '';
    var hash = raw.indexOf('#');
    var href = resolvePath(from, raw);
    return { title: title, href: href, raw: href + (hash >= 0 ? raw.slice(hash) : '') };
  }

  // Split a sanitized document back into paragraph parts so verse grouping
  // can run over epub content the same way it does over docx content.
  function partsOf(html) {
    var box = document.createElement('div');
    box.innerHTML = html;
    var parts = [];
    for (var i = 0; i < box.children.length; i++) {
      var el = box.children[i];
      var text = (el.textContent || '').trim();
      if (DIVIDER.test(text)) { parts.push('<hr>'); continue; }
      if (el.tagName === 'P') parts.push({ kind: 'para', html: el.outerHTML, text: text });
      else parts.push(el.outerHTML);
    }
    return parts;
  }

  async function readEpub(zip, revoke) {
    var rootPath = 'content.opf';
    if (zip.has('META-INF/container.xml')) {
      var cx = parseXML(await zip.text('META-INF/container.xml'));
      var rf = cx.getElementsByTagName('rootfile')[0];
      if (rf && rf.getAttribute('full-path')) rootPath = rf.getAttribute('full-path');
    }
    if (!zip.has(rootPath)) throw new Error('That .epub has no package file.');

    var opf = parseXML(await zip.text(rootPath));

    var dcPick = function (tag) {
      var n = opf.getElementsByTagNameNS(DC, tag)[0];
      return n ? n.textContent.trim() : '';
    };
    var meta = {
      title: dcPick('title'),
      author: dcPick('creator'),
      subtitle: '',
      description: dcPick('description')
    };

    // manifest: id -> { href (archive path), type, properties }
    var manifest = {}, byHref = {};
    var items = opf.getElementsByTagName('item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var href = resolvePath(rootPath, it.getAttribute('href') || '');
      var rec = {
        id: it.getAttribute('id'),
        href: href,
        type: it.getAttribute('media-type') || '',
        properties: it.getAttribute('properties') || ''
      };
      manifest[rec.id] = rec;
      byHref[href] = rec;
    }

    // images up front, so sanitising a document can resolve them synchronously
    var images = {};
    for (var key in manifest) {
      if (!/^image\//.test(manifest[key].type)) continue;
      var url = await blobURL(zip, manifest[key].href, revoke);
      if (url) images[manifest[key].href] = url;
    }

    var coverUrl = null;
    var coverMeta = opf.querySelector('meta[name="cover"]');
    if (coverMeta && manifest[coverMeta.getAttribute('content')]) {
      coverUrl = images[manifest[coverMeta.getAttribute('content')].href] || null;
    }
    if (!coverUrl) {
      for (var ck in manifest) {
        if (/cover/i.test(manifest[ck].properties + ' ' + manifest[ck].href) && images[manifest[ck].href]) {
          coverUrl = images[manifest[ck].href]; break;
        }
      }
    }

    // spine, in reading order
    var spine = [];
    var refs = opf.getElementsByTagName('itemref');
    for (var s = 0; s < refs.length; s++) {
      var m = manifest[refs[s].getAttribute('idref')];
      if (m && /xhtml|html/.test(m.type)) spine.push(m.href);
    }
    if (!spine.length) throw new Error('That .epub has no readable spine.');

    // ---- contents list: EPUB 3 nav document first, then the EPUB 2 NCX
    var toc = [];

    var navItem = null;
    for (var nk in manifest) {
      if (/\bnav\b/.test(manifest[nk].properties)) { navItem = manifest[nk]; break; }
    }
    if (navItem && zip.has(navItem.href)) {
      try {
        var navDoc = new DOMParser().parseFromString(await zip.text(navItem.href), 'application/xhtml+xml');
        var navEl = navDoc.querySelector('nav[*|type="toc"], nav[epub\\:type="toc"], nav');
        if (navEl) {
          navEl.querySelectorAll('a[href]').forEach(function (a) {
            toc.push(tocEntry((a.textContent || '').trim(), navItem.href, a.getAttribute('href')));
          });
        }
      } catch (e) { /* fall through to the NCX */ }
    }

    if (!toc.length) {
      var ncxHref = null;
      var spineEl = opf.getElementsByTagName('spine')[0];
      var tocId = spineEl && spineEl.getAttribute('toc');
      if (tocId && manifest[tocId]) ncxHref = manifest[tocId].href;
      if (!ncxHref) {
        for (var mk in manifest) {
          if (/ncx/.test(manifest[mk].type) || /\.ncx$/.test(manifest[mk].href)) { ncxHref = manifest[mk].href; break; }
        }
      }
      if (ncxHref && zip.has(ncxHref)) {
        var ncx = parseXML(await zip.text(ncxHref));
        var points = ncx.getElementsByTagName('navPoint');
        for (var q = 0; q < points.length; q++) {
          var label = points[q].getElementsByTagName('text')[0];
          var content = points[q].getElementsByTagName('content')[0];
          if (!label || !content) continue;
          toc.push(tocEntry((label.textContent || '').trim(), ncxHref, content.getAttribute('src') || ''));
        }
      }
    }

    // ---- fold the spine into chapters
    //
    // A contents entry rarely lines up one-to-one with a spine document. Two
    // things go wrong if you assume it does: a chapter split across three
    // files gets cut into three, and several chapters packed into one file
    // (marked only by a #fragment on the contents link) collapse into one.
    // Both happen in real books, so the spine is first cut into units — a
    // unit being a run of content between two fragment anchors — and the
    // contents entries then point at units rather than at whole files.

    var wanted = {};                       // archive path -> { anchorId: true }
    toc.forEach(function (t) {
      var hash = t.raw.indexOf('#');
      if (hash < 0) return;
      var anchor = t.raw.slice(hash + 1);
      if (!anchor) return;
      (wanted[t.href] || (wanted[t.href] = {}))[anchor] = true;
    });

    var units = [];                        // { path, anchor, nodes }
    var unitAt = {};                       // 'path#anchor' -> index in units

    for (var sp = 0; sp < spine.length; sp++) {
      var path = spine[sp];
      if (!zip.has(path)) continue;

      var docText = await zip.text(path);
      var xdoc = new DOMParser().parseFromString(docText, 'application/xhtml+xml');
      if (xdoc.getElementsByTagName('parsererror').length) {
        xdoc = new DOMParser().parseFromString(docText, 'text/html');
      }
      var bodyEl = xdoc.body || xdoc.getElementsByTagName('body')[0];
      if (!bodyEl) continue;

      var anchors = wanted[path] || {};
      var unit = { path: path, anchor: null, nodes: [] };
      unitAt[path + '#'] = units.length;
      units.push(unit);

      for (var c = 0; c < bodyEl.childNodes.length; c++) {
        var child = bodyEl.childNodes[c];
        var startsHere = child.nodeType === 1 && child.id && anchors[child.id];
        if (startsHere) {
          unit = { path: path, anchor: child.id, nodes: [] };
          unitAt[path + '#' + child.id] = units.length;
          units.push(unit);
        }
        unit.nodes.push(child);
      }
    }

    // Contents entries, resolved to unit positions and put in reading order.
    var marks = [];
    var takenUnit = {};
    toc.forEach(function (t) {
      var hash = t.raw.indexOf('#');
      var anchor = hash >= 0 ? t.raw.slice(hash + 1) : '';
      var at = unitAt[t.href + '#' + anchor];
      if (at === undefined) at = unitAt[t.href + '#'];      // anchor missing from the file
      if (at === undefined || takenUnit[at]) return;
      takenUnit[at] = true;
      marks.push({ title: t.title, at: at });
    });
    marks.sort(function (a, b) { return a.at - b.at; });

    var groups = [];
    if (marks.length) {
      if (marks[0].at > 0) {
        groups.push({ title: meta.title || 'Front matter', from: 0, to: marks[0].at });
      }
      marks.forEach(function (m, i) {
        groups.push({ title: m.title, from: m.at, to: i + 1 < marks.length ? marks[i + 1].at : units.length });
      });
    } else {
      units.forEach(function (u, i) { groups.push({ title: 'Section ' + (i + 1), from: i, to: i + 1 }); });
    }

    var chapters = [];
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var parts = [];

      for (var u = group.from; u < group.to; u++) {
        var block = units[u];
        if (!block) continue;
        var nodes = block.nodes;

        // The unit's opening heading repeats the contents entry; the reader
        // already prints the chapter title, so drop it rather than show it
        // twice. Only the first unit of a chapter can carry it.
        if (u === group.from && nodes.length) {
          var list = Array.prototype.slice.call(nodes);
          var at = 0;
          while (at < list.length && list[at].nodeType === 3 && !list[at].nodeValue.trim()) at++;
          var head = list[at];
          if (head && head.nodeType === 1 && /^h[1-3]$/i.test(head.tagName) &&
              (head.textContent || '').trim() === group.title.trim()) {
            list.splice(at, 1);
            nodes = list;
          }
        }

        var clean = sanitizeNodes(nodes, images, block.path);
        if (clean.trim()) parts = parts.concat(partsOf(clean));
      }

      var html = groupVerse(parts);
      if (!html.trim()) continue;
      chapters.push({ title: group.title || 'Section ' + (g + 1), html: html });
    }

    if (!chapters.length) throw new Error('That .epub had no readable chapters.');

    return {
      format: 'epub',
      title: meta.title || 'Untitled',
      subtitle: meta.subtitle,
      author: meta.author,
      description: meta.description,
      coverUrl: coverUrl,
      chapters: uniqueSlugs(chapters)
    };
  }


  // ================================================================ TEXT
  // A .txt file has no styles to read, so structure comes from convention:
  //
  //   # Chapter title      -> a new chapter
  //   ## Sub-heading       -> a heading inside one
  //   blank line           -> paragraph break
  //   * * * or ---         -> scene break
  //   - item / 1. item     -> list
  //
  // A file with no # lines is not an error. It becomes one chapter, which is
  // the right answer for a note or a single essay.

  var TXT_INLINE = /(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*[^*\n]+\*(?![*\w]))/;

  function txtInline(text) {
    return String(text || '').split(TXT_INLINE).map(function (piece) {
      if (!piece) return '';
      if (piece.slice(0, 2) === '**' && piece.slice(-2) === '**') {
        return '<strong>' + esc(piece.slice(2, -2)) + '</strong>';
      }
      if (piece[0] === '`' && piece.slice(-1) === '`') {
        return '<code>' + esc(piece.slice(1, -1)) + '</code>';
      }
      if (piece[0] === '*' && piece.slice(-1) === '*') {
        return '<em>' + esc(piece.slice(1, -1)) + '</em>';
      }
      return esc(piece);
    }).join('');
  }

  function readText(buffer) {
    var text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);        // strip BOM
    var lines = text.replace(/\r\n?/g, '\n').split('\n');

    var meta = { title: '', author: '', subtitle: '' };
    var chapters = [];
    var current = null, parts = [], para = [], list = null;

    function flushPara() {
      if (!para.length) return;

      // Consecutive lines normally join into one paragraph — that is what a
      // wrapped paragraph is. But a stanza is also consecutive lines, and
      // joining it destroys the poem. Same test used for the other formats:
      // several short lines, most not ending a sentence, is verse.
      var clean = para.map(function (l) { return l.split('\u0000BR').join('').trim(); });
      var terminal = clean.filter(endsSentence).length;
      if (clean.length >= 4 && clean.every(isShortLine) && terminal / clean.length <= 0.4) {
        parts.push('<div class="verse">' + clean.map(function (l) {
          return '<p>' + txtInline(l) + '</p>';
        }).join('') + '</div>');
        para = [];
        return;
      }

      var joined = para.join(' ').trim();
      if (joined) parts.push({ kind: 'para', html: '<p>' + txtInline(joined) + '</p>', text: joined });
      para = [];
    }
    function flushList() {
      if (!list) return;
      parts.push('<' + list.tag + '>' + list.items.join('') + '</' + list.tag + '>');
      list = null;
    }
    function flushChapter() {
      flushPara(); flushList();
      if (current && parts.length) {
        chapters.push({ title: current, html: groupVerse(parts) });
      }
      parts = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.trim();

      if (!line) { flushPara(); flushList(); continue; }

      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        if (h[1].length === 1) { flushChapter(); current = h[2].trim(); continue; }
        flushPara(); flushList();
        var level = Math.min(h[1].length, 4);
        parts.push('<h' + level + '>' + txtInline(h[2]) + '</h' + level + '>');
        continue;
      }

      if (DIVIDER.test(line)) { flushPara(); flushList(); parts.push('<hr>'); continue; }

      var li = /^([-*\u2022]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        flushPara();
        var tag = /^\d/.test(li[1]) ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
        list.items.push('<li>' + txtInline(li[2]) + '</li>');
        continue;
      }
      flushList();

      // An indented run is a quotation in most plain-text conventions.
      if (/^(\t| {4,})/.test(raw) && !para.length) {
        parts.push('<blockquote>' + txtInline(line) + '</blockquote>');
        continue;
      }

      // A line ending in two spaces is a hard break, which is how verse and
      // addresses survive a format that has no other way to say it.
      para.push(/\s{2,}$/.test(raw) && para.length ? line + '\u0000BR' : line);
    }
    flushChapter();

    // Nothing was marked with #, so the whole file is one chapter. Its first
    // line is the best title available.
    if (!chapters.length) {
      flushPara(); flushList();
      var first = lines.map(function (l) { return l.trim(); }).filter(Boolean)[0] || 'Untitled';
      if (parts.length) chapters.push({ title: first.slice(0, 80), html: groupVerse(parts) });
    }

    chapters.forEach(function (c) { c.html = c.html.split('\u0000BR').join('<br>'); });
    if (!chapters.length) throw new Error('That text file was empty.');

    // A single # at the very top names the book, not the first chapter.
    if (chapters.length > 1) meta.title = '';

    return {
      format: 'txt',
      title: meta.title || '',
      subtitle: '', author: '', description: '',
      coverUrl: null,
      chapters: uniqueSlugs(chapters)
    };
  }

  // ============================================================== entry
  // Format is decided by what is inside the archive, not by the file name,
  // so a mislabelled upload still opens.
  async function read(buffer, hint) {
    var revoke = [];
    var book;

    // Format comes from what the bytes are, not from the name. A ZIP always
    // starts "PK"; anything else is treated as text, so a mislabelled file
    // still opens instead of failing on its extension.
    var head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
    var isZip = head.length === 2 && head[0] === 0x50 && head[1] === 0x4B;

    if (!isZip) {
      book = readText(buffer);
    } else {
      var zip = await window.TNZip.open(buffer);
      var looksEpub = zip.has('META-INF/container.xml') || zip.has('content.opf');
      var looksDocx = zip.has('word/document.xml');

      if (looksDocx && (!looksEpub || /docx$/i.test(hint || ''))) book = await readDocx(zip, revoke);
      else if (looksEpub) book = await readEpub(zip, revoke);
      else throw new Error('That file is not a Word document, an EPUB or a text file.');
    }

    book.revoke = function () { revoke.forEach(function (u) { URL.revokeObjectURL(u); }); };
    return book;
  }

  window.TNEbook = { read: read, slugify: slugify };
})();
