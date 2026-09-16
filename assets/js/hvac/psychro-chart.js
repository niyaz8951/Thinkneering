/* Thinkneering — HVAC calculators: psychrometric chart
   SVG chart drawn from PsychroLib, styled entirely from CSS custom properties.
   Dry bulb on x, humidity ratio on y, saturation curve, RH family, enthalpy
   and specific-volume families, plotted state points and process lines. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;
  var esc = window.TN ? TN.esc : function (s) { return String(s == null ? '' : s); };

  var DEF = {
    tMin: 0, tMax: 55,      // C
    wMax: 0.030,            // kg/kg
    width: 720, height: 480,
    padL: 52, padR: 78, padT: 20, padB: 48
  };

  function build(opts) {
    var o = Object.assign({}, DEF, opts || {});
    var p = o.pressure || U.C.P_ATM;
    var pw = o.width - o.padL - o.padR;
    var ph = o.height - o.padT - o.padB;

    function x(t) { return o.padL + (t - o.tMin) / (o.tMax - o.tMin) * pw; }
    function y(w) { return o.padT + ph - (w / o.wMax) * ph; }

    var parts = [];

    /* --- grid ---------------------------------------------------------- */
    var grid = '';
    for (var t = o.tMin; t <= o.tMax; t += 5) {
      grid += '<line x1="' + x(t) + '" y1="' + o.padT + '" x2="' + x(t) + '" y2="' + (o.padT + ph) +
        '" class="psy__grid"/>' +
        '<text x="' + x(t) + '" y="' + (o.padT + ph + 18) + '" class="chart__label" text-anchor="middle">' + t + '</text>';
    }
    for (var w = 0; w <= o.wMax + 1e-9; w += 0.005) {
      grid += '<line x1="' + o.padL + '" y1="' + y(w) + '" x2="' + (o.padL + pw) + '" y2="' + y(w) +
        '" class="psy__grid"/>' +
        '<text x="' + (o.padL + pw + 8) + '" y="' + (y(w) + 4) + '" class="chart__label">' +
        (w * 1000).toFixed(0) + '</text>';
    }
    parts.push('<g class="psy__grid-group">' + grid + '</g>');

    /* --- constant relative humidity family ------------------------------ */
    var rhLines = '';
    [10, 20, 30, 40, 50, 60, 70, 80, 90].forEach(function (rh) {
      var d = '', started = false, labelPt = null;
      for (var tt = o.tMin; tt <= o.tMax; tt += 0.5) {
        var ww = H.psy.wAt(tt, rh, p);
        if (ww > o.wMax) break;
        d += (started ? 'L' : 'M') + x(tt).toFixed(1) + ' ' + y(ww).toFixed(1) + ' ';
        started = true;
        labelPt = { t: tt, w: ww };
      }
      if (!started) return;
      rhLines += '<path d="' + d + '" class="psy__rh"/>';
      if (labelPt) {
        rhLines += '<text x="' + (x(labelPt.t) - 4) + '" y="' + (y(labelPt.w) - 4) +
          '" class="psy__rh-label" text-anchor="end">' + rh + '%</text>';
      }
    });
    parts.push('<g>' + rhLines + '</g>');

    /* --- constant enthalpy family --------------------------------------- */
    var hLines = '';
    for (var hv = 10; hv <= 120; hv += 10) {
      var d2 = '', on = false;
      for (var ww2 = 0; ww2 <= o.wMax; ww2 += 0.001) {
        var tdb = H.psy.tdbFromHW(hv, ww2);
        if (tdb < o.tMin || tdb > o.tMax) { if (on) break; else continue; }
        if (ww2 > H.psy.satW(tdb, p) + 0.0002) { if (on) break; else continue; }
        d2 += (on ? 'L' : 'M') + x(tdb).toFixed(1) + ' ' + y(ww2).toFixed(1) + ' ';
        on = true;
      }
      if (on) hLines += '<path d="' + d2 + '" class="psy__enthalpy"/>';
    }
    parts.push('<g>' + hLines + '</g>');

    /* --- saturation curve ------------------------------------------------ */
    var sat = '', satOn = false;
    for (var ts = o.tMin; ts <= o.tMax; ts += 0.25) {
      var ws = H.psy.satW(ts, p);
      if (ws > o.wMax) break;
      sat += (satOn ? 'L' : 'M') + x(ts).toFixed(1) + ' ' + y(ws).toFixed(1) + ' ';
      satOn = true;
    }
    parts.push('<path d="' + sat + '" class="psy__saturation"/>');

    /* --- frame + axis titles --------------------------------------------- */
    parts.push('<rect x="' + o.padL + '" y="' + o.padT + '" width="' + pw + '" height="' + ph +
      '" class="psy__frame"/>');
    parts.push('<text x="' + (o.padL + pw / 2) + '" y="' + (o.height - 10) +
      '" class="chart__label" text-anchor="middle">Dry-bulb temperature (°C)</text>');
    parts.push('<text x="' + (o.padL + pw + 40) + '" y="' + (o.padT + ph / 2) +
      '" class="chart__label" text-anchor="middle" transform="rotate(-90 ' +
      (o.padL + pw + 40) + ' ' + (o.padT + ph / 2) + ')">Humidity ratio (g/kg dry air)</text>');

    /* --- process lines between plotted points ---------------------------- */
    (o.processes || []).forEach(function (proc) {
      var a = proc.from, b = proc.to;
      if (!a || !b) return;
      parts.push('<line x1="' + x(a.tdb) + '" y1="' + y(a.w) + '" x2="' + x(b.tdb) + '" y2="' + y(b.w) +
        '" class="psy__process' + (proc.dashed ? ' psy__process--dashed' : '') + '"/>');
    });

    /* --- state points ----------------------------------------------------- */
    (o.points || []).forEach(function (pt, i) {
      if (!pt.state) return;
      var cx = x(pt.state.tdb), cy = y(pt.state.w);
      if (cx < o.padL || cx > o.padL + pw || cy < o.padT || cy > o.padT + ph) return;
      var col = pt.color || H.charts.color(i);
      parts.push('<g class="psy__point">' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + col + '"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="11" fill="none" stroke="' + col + '" stroke-opacity="0.35"/>' +
        '<text x="' + (cx + 14) + '" y="' + (cy + 4) + '" class="psy__point-label">' + esc(pt.label) + '</text>' +
        '<title>' + esc(pt.label) + ': ' + U.fmt(pt.state.tdb, 1) + ' °C DB, ' +
        U.fmt(pt.state.rh, 0) + '% RH, ' + U.fmt(pt.state.w * 1000, 2) + ' g/kg, ' +
        U.fmt(pt.state.h, 1) + ' kJ/kg</title></g>');
    });

    return '<svg class="chart psy-chart" viewBox="0 0 ' + o.width + ' ' + o.height +
      '" preserveAspectRatio="xMidYMid meet" role="img" ' +
      'aria-label="Psychrometric chart">' + parts.join('') + '</svg>';
  }

  H.psyChart = { build: build, DEF: DEF };
})();
