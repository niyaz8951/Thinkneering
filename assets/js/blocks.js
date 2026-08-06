/* Thinkneering — blocks.js
   Renders book content blocks. Shared by the reader and the admin editor
   preview so authors always see exactly what readers see. */
(function () {
  'use strict';
  var esc = window.TN ? window.TN.esc : function (s) { return String(s == null ? '' : s); };

  // Inline emphasis. Escape first, then apply markers, so no markup can be
  // injected through content.
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  }

  var TYPES = [
    { type: 'heading',  label: 'Heading' },
    { type: 'text',     label: 'Paragraph' },
    { type: 'image',    label: 'Image' },
    { type: 'table',    label: 'Table' },
    { type: 'chart',    label: 'Chart' },
    { type: 'list',     label: 'List' },
    { type: 'callout',  label: 'Callout' },
    { type: 'quote',    label: 'Quote' },
    { type: 'code',     label: 'Code' },
    { type: 'divider',  label: 'Divider' }
  ];

  function blank(type) {
    switch (type) {
      case 'heading': return { level: 2, text: 'Heading' };
      case 'text':    return { text: '' };
      case 'image':   return { url: '', alt: '', caption: '' };
      case 'table':   return { caption: '', headers: ['Column A', 'Column B'], rows: [['', '']] };
      case 'chart':   return { chartType: 'bar', title: '', labels: ['A', 'B'], values: [1, 2], unit: '' };
      case 'list':    return { ordered: false, items: [''] };
      case 'callout': return { tone: 'info', title: '', text: '' };
      case 'quote':   return { text: '', cite: '' };
      case 'code':    return { text: '' };
      default:        return {};
    }
  }

  // ------------------------------------------------------ mini charts
  function chartSVG(d) {
    var labels = d.labels || [], values = (d.values || []).map(Number);
    if (!labels.length || !values.length) return '<div class="empty">Chart has no data yet.</div>';
    var W = 640, H = 260, padL = 44, padR = 16, padT = 24, padB = 36;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = Math.max.apply(null, values.concat([0]));
    var min = Math.min.apply(null, values.concat([0]));
    var span = (max - min) || 1;
    var y = function (v) { return padT + ih - ((v - min) / span) * ih; };
    var parts = [];

    // grid + axis labels
    for (var g = 0; g <= 4; g++) {
      var val = min + (span * g) / 4;
      var gy = y(val);
      parts.push('<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy +
        '" stroke="currentColor" stroke-opacity="0.12"/>');
      parts.push('<text x="' + (padL - 8) + '" y="' + (gy + 3) + '" text-anchor="end">' +
        (Math.round(val * 100) / 100) + '</text>');
    }

    if (d.chartType === 'line') {
      var step = labels.length > 1 ? iw / (labels.length - 1) : 0;
      var pts = values.map(function (v, i) { return (padL + i * step) + ',' + y(v); }).join(' ');
      parts.push('<polyline points="' + pts + '" fill="none" stroke="var(--color-primary)" stroke-width="2"/>');
      values.forEach(function (v, i) {
        parts.push('<circle cx="' + (padL + i * step) + '" cy="' + y(v) + '" r="3" fill="var(--color-primary)"/>');
      });
      labels.forEach(function (l, i) {
        parts.push('<text x="' + (padL + i * step) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(l) + '</text>');
      });
    } else {
      var bw = iw / labels.length;
      values.forEach(function (v, i) {
        var top = y(Math.max(v, 0)), base = y(0);
        parts.push('<rect x="' + (padL + i * bw + bw * 0.2) + '" y="' + Math.min(top, base) +
          '" width="' + bw * 0.6 + '" height="' + Math.max(Math.abs(base - top), 1) +
          '" rx="4" fill="var(--color-primary)"/>');
        parts.push('<text x="' + (padL + i * bw + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle">' +
          esc(labels[i]) + '</text>');
      });
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(d.title || 'Chart') + '">' + parts.join('') + '</svg>';
  }

  // --------------------------------------------------------- renderer
  function renderBlock(b) {
    var d = b.data || {};
    switch (b.type) {
      case 'heading':
        var lvl = d.level === 3 ? 3 : 2;
        return '<h' + lvl + '>' + inline(d.text) + '</h' + lvl + '>';
      case 'text':
        return String(d.text == null ? '' : d.text).split(/\n{2,}/).map(function (p) {
          return '<p>' + inline(p).replace(/\n/g, '<br>') + '</p>';
        }).join('');
      case 'image':
        return '<figure><img src="' + esc(d.url) + '" alt="' + esc(d.alt || '') + '" loading="lazy">' +
          (d.caption ? '<figcaption>' + inline(d.caption) + '</figcaption>' : '') + '</figure>';
      case 'table':
        return '<figure><div class="table-wrap"><table class="data"><thead><tr>' +
          (d.headers || []).map(function (h) { return '<th scope="col">' + inline(h) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          (d.rows || []).map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table></div>' +
          (d.caption ? '<figcaption>' + inline(d.caption) + '</figcaption>' : '') + '</figure>';
      case 'chart':
        return '<figure>' + chartSVG(d) +
          (d.title ? '<figcaption>' + esc(d.title) + (d.unit ? ' (' + esc(d.unit) + ')' : '') + '</figcaption>' : '') +
          '</figure>';
      case 'list':
        var tag = d.ordered ? 'ol' : 'ul';
        return '<' + tag + '>' + (d.items || []).map(function (i) {
          return '<li>' + inline(i) + '</li>';
        }).join('') + '</' + tag + '>';
      case 'callout':
        var tone = { info: '', warning: ' notice--warning', danger: ' notice--danger', success: ' notice--success' }[d.tone] || '';
        return '<div class="notice' + tone + '"><div>' +
          (d.title ? '<strong>' + inline(d.title) + '</strong><br>' : '') + inline(d.text) + '</div></div>';
      case 'quote':
        return '<blockquote>' + inline(d.text).replace(/\n/g, '<br>') +
          (d.cite ? '<footer class="muted">— ' + inline(d.cite) + '</footer>' : '') + '</blockquote>';
      case 'code':
        return '<pre><code>' + esc(d.text) + '</code></pre>';
      case 'divider':
        return '<hr>';
      default:
        return '';
    }
  }

  function render(blocks) {
    return (blocks || []).map(renderBlock).join('');
  }

  window.TNBlocks = { render: render, renderBlock: renderBlock, TYPES: TYPES, blank: blank,
                      chartSVG: chartSVG, inline: inline };
})();
