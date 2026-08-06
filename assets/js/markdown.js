/* Thinkneering — markdown.js
   Converts between the markdown a writer types and the blocks the reader
   renders. Blocks stay the storage format; markdown is the editing surface.

   Syntax
     ## / ###        heading
     blank-line runs paragraph
     > text          quote  (a following "> — name" line becomes the citation)
     - item / 1.     list
     ---             divider
     ![alt](url "caption")   image
     | a | b |       table   (a "Table: caption" line above becomes the caption)
     ```chart {json} chart
     ```lang         code
     ::: warning Title ... :::   callout
*/
(function () {
  'use strict';

  function parse(md) {
    var lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    var blocks = [], i = 0;

    function flushPara(buf) {
      var text = buf.join('\n').trim();
      if (text) blocks.push({ type: 'text', data: { text: text } });
    }

    var para = [];
    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();

      // fenced: ```chart / ```code
      if (/^```/.test(t)) {
        flushPara(para); para = [];
        var lang = t.slice(3).trim();
        var body = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { body.push(lines[i]); i++; }
        i++;
        var raw = body.join('\n');
        if (lang === 'chart') {
          var parsed = {};
          try { parsed = JSON.parse(raw); } catch (e) { parsed = { chartType: 'bar', labels: [], values: [] }; }
          blocks.push({ type: 'chart', data: parsed });
        } else {
          blocks.push({ type: 'code', data: { text: raw, lang: lang || '' } });
        }
        continue;
      }

      // callout ::: tone Title
      if (/^:::/.test(t)) {
        flushPara(para); para = [];
        var head = t.slice(3).trim().split(/\s+/);
        var tone = ['info', 'success', 'warning', 'danger'].indexOf(head[0]) >= 0 ? head.shift() : 'info';
        var title = head.join(' ');
        var cb = [];
        i++;
        while (i < lines.length && lines[i].trim() !== ':::') { cb.push(lines[i]); i++; }
        i++;
        blocks.push({ type: 'callout', data: { tone: tone, title: title, text: cb.join('\n').trim() } });
        continue;
      }

      if (!t) { flushPara(para); para = []; i++; continue; }

      // divider
      if (/^(---|\*\*\*|___)$/.test(t)) {
        flushPara(para); para = [];
        blocks.push({ type: 'divider', data: {} });
        i++; continue;
      }

      // heading
      var h = t.match(/^(#{2,3})\s+(.*)$/);
      if (h) {
        flushPara(para); para = [];
        blocks.push({ type: 'heading', data: { level: h[1].length, text: h[2].trim() } });
        i++; continue;
      }

      // image
      var img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
      if (img) {
        flushPara(para); para = [];
        blocks.push({ type: 'image', data: { alt: img[1], url: img[2], caption: img[3] || '' } });
        i++; continue;
      }

      // table (optionally preceded by "Table: caption")
      if (/^\|/.test(t)) {
        // A trailing "Table: caption" line belongs to this table, not to the
        // paragraph above it — take it out before flushing.
        var caption = '';
        if (para.length) {
          var cm = para[para.length - 1].trim().match(/^Table:\s*(.*)$/i);
          if (cm) { caption = cm[1]; para.pop(); }
        }
        flushPara(para);
        para = [];
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          var cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
          if (!cells.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; })) rows.push(cells);
          i++;
        }
        if (rows.length) {
          blocks.push({ type: 'table', data: { caption: caption, headers: rows[0], rows: rows.slice(1) } });
        }
        continue;
      }

      // quote
      if (/^>/.test(t)) {
        flushPara(para); para = [];
        var qb = [], cite = '';
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          var q = lines[i].trim().replace(/^>\s?/, '');
          var cm2 = q.match(/^—\s*(.+)$/);
          if (cm2) cite = cm2[1]; else qb.push(q);
          i++;
        }
        blocks.push({ type: 'quote', data: { text: qb.join('\n').trim(), cite: cite } });
        continue;
      }

      // list
      if (/^([-*]|\d+[.)])\s+/.test(t)) {
        flushPara(para); para = [];
        var ordered = /^\d+[.)]\s+/.test(t);
        var items = [];
        while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
          items.push(lines[i].trim().replace(/^([-*]|\d+[.)])\s+/, ''));
          i++;
        }
        blocks.push({ type: 'list', data: { ordered: ordered, items: items } });
        continue;
      }

      para.push(line);
      i++;
    }
    flushPara(para);
    return blocks;
  }

  function serialize(blocks) {
    var out = (blocks || []).map(function (b) {
      var d = b.data || {};
      switch (b.type) {
        case 'heading': return (d.level === 3 ? '### ' : '## ') + (d.text || '');
        case 'text': return d.text || '';
        case 'quote':
          return String(d.text || '').split('\n').map(function (l) { return '> ' + l; }).join('\n') +
            (d.cite ? '\n> — ' + d.cite : '');
        case 'list':
          return (d.items || []).map(function (it, n) {
            return (d.ordered ? (n + 1) + '. ' : '- ') + it;
          }).join('\n');
        case 'divider': return '---';
        case 'image':
          return '![' + (d.alt || '') + '](' + (d.url || '') + (d.caption ? ' "' + d.caption + '"' : '') + ')';
        case 'table':
          var head = '| ' + (d.headers || []).join(' | ') + ' |';
          var sep = '| ' + (d.headers || []).map(function () { return '---'; }).join(' | ') + ' |';
          var body = (d.rows || []).map(function (r) { return '| ' + r.join(' | ') + ' |'; }).join('\n');
          return (d.caption ? 'Table: ' + d.caption + '\n' : '') + head + '\n' + sep + (body ? '\n' + body : '');
        case 'chart':
          return '```chart\n' + JSON.stringify(d, null, 2) + '\n```';
        case 'code':
          return '```' + (d.lang || '') + '\n' + (d.text || '') + '\n```';
        case 'callout':
          return ':::' + (d.tone || 'info') + (d.title ? ' ' + d.title : '') + '\n' + (d.text || '') + '\n:::';
        default: return '';
      }
    });
    return out.filter(function (s) { return s !== ''; }).join('\n\n') + '\n';
  }

  window.TNMarkdown = { parse: parse, serialize: serialize };
})();
