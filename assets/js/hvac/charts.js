/* Thinkneering — HVAC calculators: SVG charts
   Hand-rolled SVG, no charting library. All colour comes from CSS custom
   properties so light/dark and theming are handled by global.css. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;
  var esc = window.TN ? TN.esc : function (s) { return String(s == null ? '' : s); };

  var SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
    'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'];

  function color(i) { return SERIES[i % SERIES.length]; }

  function svg(w, h, body, cls) {
    return '<svg class="chart ' + (cls || '') + '" viewBox="0 0 ' + w + ' ' + h + '" ' +
      'preserveAspectRatio="xMidYMid meet" role="img">' + body + '</svg>';
  }

  /* ---------------------------------------------- horizontal bar breakdown */
  /* items: [{name, value, kind}] — the cooling-load component breakdown. */
  function breakdown(items, opts) {
    opts = opts || {};
    var rows = items.filter(function (i) { return Math.abs(i.value) > 0.0001; });
    if (!rows.length) return '<div class="empty">Nothing to show yet.</div>';

    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value); }));
    var total = rows.reduce(function (a, r) { return a + Math.abs(r.value); }, 0);
    var rowH = 30, pad = 8, labelW = 150, valueW = 96;
    var w = 640, h = rows.length * rowH + pad * 2;
    var barW = w - labelW - valueW - 12;

    var body = rows.map(function (r, i) {
      var y = pad + i * rowH;
      var len = Math.max(2, Math.abs(r.value) / max * barW);
      var pct = total > 0 ? Math.abs(r.value) / total * 100 : 0;
      return '<text x="0" y="' + (y + 15) + '" class="chart__label">' + esc(r.name) + '</text>' +
        '<rect x="' + labelW + '" y="' + (y + 4) + '" width="' + len + '" height="16" rx="3" ' +
        'fill="' + color(i) + '"><title>' + esc(r.name) + ': ' + U.fmt(r.value) + ' kW</title></rect>' +
        '<text x="' + (w - 4) + '" y="' + (y + 16) + '" class="chart__value" text-anchor="end">' +
        U.fmt(r.value) + ' kW  ·  ' + pct.toFixed(0) + '%</text>';
    }).join('');

    return svg(w, h, body, 'chart--breakdown');
  }

  /* ------------------------------------------------------------ donut */
  function donut(items, centreLabel, centreValue) {
    var rows = items.filter(function (i) { return i.value > 0.0001; });
    var total = rows.reduce(function (a, r) { return a + r.value; }, 0);
    if (total <= 0) return '<div class="empty">Nothing to show yet.</div>';

    var size = 220, cx = size / 2, cy = size / 2, r = 88, stroke = 26;
    var circ = 2 * Math.PI * r, offset = 0;

    var arcs = rows.map(function (row, i) {
      var frac = row.value / total;
      var dash = circ * frac;
      var seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
        'stroke="' + color(i) + '" stroke-width="' + stroke + '" ' +
        'stroke-dasharray="' + dash + ' ' + (circ - dash) + '" ' +
        'stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')">' +
        '<title>' + esc(row.name) + ': ' + U.fmt(row.value) + ' (' + (frac * 100).toFixed(0) + '%)</title>' +
        '</circle>';
      offset += dash;
      return seg;
    }).join('');

    var centre = '<text x="' + cx + '" y="' + (cy - 2) + '" class="chart__centre" text-anchor="middle">' +
      esc(centreValue) + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 18) + '" class="chart__label" text-anchor="middle">' +
      esc(centreLabel) + '</text>';

    return svg(size, size, arcs + centre, 'chart--donut');
  }

  function legend(items) {
    return '<ul class="chart-legend">' + items.map(function (i, n) {
      return '<li><span class="chart-legend__dot" style="background:' + color(n) + '"></span>' +
        esc(i.name) + '<span class="chart-legend__value">' + U.fmt(i.value) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* ------------------------------------------------- 24-hour line profile */
  /* series: [{name, values[24], color}] */
  function profile(series, opts) {
    opts = opts || {};
    var w = 640, h = 240, l = 48, rgt = 12, t = 16, b = 32;
    var pw = w - l - rgt, ph = h - t - b;

    var all = [];
    series.forEach(function (s) { all = all.concat(s.values); });
    var max = Math.max.apply(null, all.concat([0.1]));
    var min = Math.min.apply(null, all.concat([0]));
    max = max * 1.08;

    function x(i) { return l + (i / 23) * pw; }
    function y(v) { return t + ph - ((v - min) / (max - min || 1)) * ph; }

    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var gv = min + (max - min) * g / 4;
      var gy = y(gv);
      grid += '<line x1="' + l + '" y1="' + gy + '" x2="' + (w - rgt) + '" y2="' + gy + '" class="chart__grid"/>' +
        '<text x="' + (l - 6) + '" y="' + (gy + 4) + '" class="chart__label" text-anchor="end">' + U.fmt(gv) + '</text>';
    }
    for (var hh = 0; hh < 24; hh += 3) {
      grid += '<text x="' + x(hh) + '" y="' + (h - 10) + '" class="chart__label" text-anchor="middle">' +
        (hh < 10 ? '0' + hh : hh) + ':00</text>';
    }

    var lines = series.map(function (s, i) {
      var d = s.values.map(function (v, n) { return (n ? 'L' : 'M') + x(n).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + (s.color || color(i)) + '" stroke-width="2" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>';
    }).join('');

    var marker = '';
    if (opts.peakHour != null && series[0]) {
      var px = x(opts.peakHour), py = y(series[0].values[opts.peakHour]);
      marker = '<line x1="' + px + '" y1="' + t + '" x2="' + px + '" y2="' + (t + ph) + '" class="chart__marker"/>' +
        '<circle cx="' + px + '" cy="' + py + '" r="4" fill="var(--chart-1)"/>' +
        '<text x="' + px + '" y="' + (t - 4) + '" class="chart__value" text-anchor="middle">peak ' +
        (opts.peakHour < 10 ? '0' + opts.peakHour : opts.peakHour) + ':00</text>';
    }

    return svg(w, h, grid + lines + marker, 'chart--profile');
  }

  /* --------------------------------------------------- duct cross-section */
  function ductViz(result, shape) {
    var w = 320, h = 190;
    var body, caption;
    var maxDim = 130;

    if (shape === 'round') {
      var d = result.dims.d;
      var r = maxDim / 2;
      body = '<circle cx="' + (w / 2) + '" cy="86" r="' + r + '" class="duct__wall"/>' +
        '<line x1="' + (w / 2 - r) + '" y1="86" x2="' + (w / 2 + r) + '" y2="86" class="duct__dim"/>' +
        '<text x="' + (w / 2) + '" y="80" class="chart__value" text-anchor="middle">Ø ' + U.fmt(d, 0) + ' mm</text>';
      caption = 'Ø' + U.fmt(d, 0) + ' mm';
    } else {
      var a = result.dims.w, bb = result.dims.h;
      var scale = maxDim / Math.max(a, bb);
      var rw = a * scale, rh = bb * scale;
      body = '<rect x="' + (w / 2 - rw / 2) + '" y="' + (86 - rh / 2) + '" width="' + rw + '" height="' + rh +
        '" rx="4" class="duct__wall"/>' +
        '<text x="' + (w / 2) + '" y="' + (86 - rh / 2 - 8) + '" class="chart__value" text-anchor="middle">' +
        U.fmt(a, 0) + ' mm</text>' +
        '<text x="' + (w / 2 + rw / 2 + 10) + '" y="90" class="chart__value">' + U.fmt(bb, 0) + ' mm</text>';
      caption = U.fmt(a, 0) + ' × ' + U.fmt(bb, 0) + ' mm';
    }

    // Flow arrows scaled to velocity so a fast duct visibly reads as fast.
    var arrows = '';
    var n = Math.round(U.clamp(result.velocity, 1, 12));
    for (var i = 0; i < 5; i++) {
      var ax = 40 + i * 60;
      arrows += '<line x1="' + ax + '" y1="165" x2="' + (ax + 10 + n * 2) + '" y2="165" class="duct__flow"/>';
    }
    arrows += '<text x="' + (w / 2) + '" y="185" class="chart__label" text-anchor="middle">' +
      U.fmt(result.velocity) + ' m/s  ·  Re ' + U.fmt(result.re, 0) + '</text>';

    return svg(w, h, body + arrows, 'chart--duct') ;
  }

  /* ------------------------------------------------------- fan curve */
  function fanCurve(system, points, operating) {
    var w = 560, h = 260, l = 56, rgt = 14, t = 16, b = 36;
    var pw = w - l - rgt, ph = h - t - b;
    var maxF = Math.max.apply(null, system.map(function (p) { return p.flow; }));
    var maxP = Math.max.apply(null, system.map(function (p) { return p.pressure; })) * 1.15;

    function x(f) { return l + (f / maxF) * pw; }
    function y(p) { return t + ph - (p / maxP) * ph; }

    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var gy = t + ph - (ph * g / 4);
      grid += '<line x1="' + l + '" y1="' + gy + '" x2="' + (w - rgt) + '" y2="' + gy + '" class="chart__grid"/>' +
        '<text x="' + (l - 6) + '" y="' + (gy + 4) + '" class="chart__label" text-anchor="end">' +
        U.fmt(maxP * g / 4, 0) + '</text>';
    }

    var sysPath = system.map(function (p, i) {
      return (i ? 'L' : 'M') + x(p.flow).toFixed(1) + ' ' + y(p.pressure).toFixed(1);
    }).join(' ');

    var dots = (points || []).map(function (p, i) {
      return '<circle cx="' + x(p.flow) + '" cy="' + y(p.pressure) + '" r="5" fill="' + color(i + 1) + '">' +
        '<title>' + esc(p.name) + '</title></circle>' +
        '<text x="' + x(p.flow) + '" y="' + (y(p.pressure) - 10) + '" class="chart__value" text-anchor="middle">' +
        esc(p.name) + '</text>';
    }).join('');

    var axis = '<text x="' + (l + pw / 2) + '" y="' + (h - 6) + '" class="chart__label" text-anchor="middle">Airflow (L/s)</text>' +
      '<text x="12" y="' + (t + ph / 2) + '" class="chart__label" transform="rotate(-90 12 ' + (t + ph / 2) + ')" text-anchor="middle">Pressure (Pa)</text>';

    return svg(w, h, grid +
      '<path d="' + sysPath + '" fill="none" stroke="var(--chart-3)" stroke-width="2" stroke-dasharray="5 4"/>' +
      dots + axis, 'chart--fan');
  }

  H.charts = {
    color: color, svg: svg, breakdown: breakdown, donut: donut, legend: legend,
    profile: profile, ductViz: ductViz, fanCurve: fanCurve
  };
})();
