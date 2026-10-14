/* ==========================================================================
   DAME Tools Hub — psychrometric chart renderer

   Draws an ASHRAE-style chart as inline SVG: dry-bulb temperature along the
   bottom, humidity ratio up the right-hand edge, and the five families of
   property lines (saturation, relative humidity, wet bulb, enthalpy, specific
   volume) that make the chart readable rather than merely a scatter plot.

   Colours are never written as literals. Series take the --chart-1..8 tokens
   defined in styles.css from the hub's Daikin tokens, and the furniture takes
   the hub tokens directly, both through `style="stroke:var(--token)"` — SVG
   presentation attributes cannot resolve var(), but the style attribute is
   CSS and can. That is what lets the chart follow day and night mode without
   a second palette, and without needing to redraw on the hub:theme event.

   Line families and spacing follow ASHRAE Psychrometric Chart No. 1: dry
   bulb along the bottom, humidity ratio on the right, saturation curve as
   the upper boundary, wet-bulb lines every 1 °C labelled on the saturation
   curve, enthalpy every 5 kJ/kg with its scale outside the curve, relative
   humidity every 10 %, specific volume every 0.01 m3/kg, and the sensible
   heat ratio protractor in the blank corner.

   Units: the engine and the plot geometry are SI throughout. For an IP chart
   only what is written and where the lines fall changes: the frame, the ticks
   and the line families are stepped in round IP figures (10 °F, gr/lb,
   Btu/lb, ft3/lb) and each one is converted back to SI to be placed. There is
   no second equation set.

   Depends on TN.psychro. No other dependency.
   ========================================================================== */

(function (global) {
  'use strict';

  var P = global.TN.psychro;

  /* Plot geometry. The humidity-ratio axis sits on the RIGHT and the enthalpy
     scale runs outside the saturation curve on the upper left, which is the
     ASHRAE Chart No. 1 arrangement; putting W on the left would read as a
     generic XY plot to anyone used to the real thing. */
  var VB = { w: 940, h: 580 };
  var M = { top: 34, right: 84, bottom: 58, left: 86 };

  var PLOT = {
    x0: M.left,
    y0: M.top,
    x1: VB.w - M.right,
    y1: VB.h - M.bottom
  };

  /* Which property families are drawn. Values are the constant lines to draw
     and the subset of those to label — labelling every line turns the chart
     into noise, and these intervals match a printed ASHRAE chart. */
  var RH_LINES = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  var WB_LABEL_EVERY = 5;   /* °C between labelled wet-bulb lines           */
  var H_STEP = 5;           /* kJ/kg between enthalpy lines                 */
  var V_STEP = 0.01;        /* m3/kg between specific-volume lines          */

  /* Wet-bulb lines every 1 °C as on the printed chart while the frame is
     narrow enough to keep them apart; every 2 °C on a wide frame. */
  function wbStep(range) {
    return (range.tMax - range.tMin) <= 60 ? 1 : 2;
  }

  function same(v) { return v; }

  /* What the chart is written in. `t`, `w`, `h`, `v` turn an SI figure into
     the displayed one and the `...Inv` functions turn it back, so a line can
     be chosen at a round displayed value and placed with its SI value. */
  var SI_UNITS = {
    ip: false,
    t: same, tInv: same, w: same, wInv: same, h: same, hInv: same, v: same, vInv: same,
    tUnit: '&#176;C', wUnit: 'g/kg', hUnit: 'kJ/kg', wDigits: 1,
    tRound: 5, tSpanMin: 20, wRound: 2, wFloor: 8,
    wbStep: wbStep, wbLabelEvery: function (step) { return step === 1 ? WB_LABEL_EVERY : WB_LABEL_EVERY * 2; },
    hStep: H_STEP, hScaleStep: H_STEP * 2, vStep: V_STEP, vDigits: 2,
    pressure: function (kPa) { return kPa.toFixed(3) + ' kPa'; },
    empty: { tMin: 0, tMax: 50, wMin: 0, wMax: 30 }
  };
  var IP_UNITS = {
    ip: true,
    t: P.ip.tempToF, tInv: P.ip.tempToC,
    w: function (gkg) { return gkg * 7; }, wInv: function (grlb) { return grlb / 7; },
    h: P.ip.enthalpyToIP, hInv: P.ip.enthalpyToSI,
    v: P.ip.volumeToIP, vInv: function (ft3lb) { return ft3lb / P.ip.volumeToIP(1); },
    tUnit: '&#176;F', wUnit: 'gr/lb', hUnit: 'Btu/lb', wDigits: 0,
    tRound: 10, tSpanMin: 40, wRound: 20, wFloor: 60,
    /* Every 2 °F, or every 5 °F on a wide frame; labelled every 10 °F. */
    wbStep: function (range) { return (range.tMax - range.tMin) * 1.8 <= 110 ? 2 : 5; },
    wbLabelEvery: function (step) { return step === 2 ? 10 : 20; },
    hStep: 2.5, hScaleStep: 5, vStep: 0.5, vDigits: 1,
    pressure: function (kPa) { return P.ip.pressureToIP(kPa).toFixed(3) + ' in.Hg'; },
    empty: { tMin: P.ip.tempToC(30), tMax: P.ip.tempToC(120), wMin: 0, wMax: 210 / 7 }
  };
  var U = SI_UNITS;                     /* set by render() for each drawing */

  /* First multiple of `step` at or above `from`, forgiving the rounding that
     a conversion there and back leaves behind. */
  function firstStep(from, step) {
    return Math.ceil((from - 1e-6) / step) * step;
  }

  /* ------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function niceStep(span, target) {
    var raw = span / target;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  /* ------------------------------------------------------------ the view */

  /* A view is the mapping between chart units and SVG units, plus the range
     it covers. Everything that draws takes one of these, so nothing has to
     know how the range was arrived at. */
  function makeView(range, pressure) {
    var tSpan = range.tMax - range.tMin;
    var wSpan = range.wMax - range.wMin;      /* g/kg */
    return {
      range: range,
      p: pressure,
      x: function (t) { return PLOT.x0 + (t - range.tMin) / tSpan * (PLOT.x1 - PLOT.x0); },
      y: function (w) { return PLOT.y1 - (w - range.wMin) / wSpan * (PLOT.y1 - PLOT.y0); },
      /* Inverses, for turning a pointer position back into a state. */
      t: function (px) { return range.tMin + (px - PLOT.x0) / (PLOT.x1 - PLOT.x0) * tSpan; },
      w: function (py) { return range.wMin + (PLOT.y1 - py) / (PLOT.y1 - PLOT.y0) * wSpan; }
    };
  }

  /* Work out a range that holds every plotted point with room to read it.

     This is the fix for the failure mode where a 46 °C Gulf design condition
     silently vanished off a chart hardwired to 50 °C and 28 g/kg. The range
     follows the data; the presets remain available for anyone who wants a
     fixed frame to compare two printouts against. */
  function autoRange(states, pressure) {
    var tLo = Infinity;
    var tHi = -Infinity;
    var wHi = 0;
    var any = false;

    states.forEach(function (s) {
      if (!s || !s.ok) { return; }
      any = true;
      tLo = Math.min(tLo, s.db);
      tHi = Math.max(tHi, s.db);
      wHi = Math.max(wHi, s.W * 1000);
      /* A cooling process is read against its apparatus dew point, which sits
         below the leaving state, so the frame has to reach past it. Perfectly
         dry air has no dew point, and a single NaN here would poison every
         bound and collapse the whole chart, so it is guarded. */
      if (isFinite(s.dp)) { tLo = Math.min(tLo, s.dp - 2); }
    });

    if (!any) { return U.empty; }

    /* Padding is a share of the span with a floor and a ceiling. A share
       alone leaves a single point with no frame at all; a fixed margin alone
       swamps a narrow process and pinches a wide one. */
    /* The frame ends on round figures of the unit on show (5 °C or 10 °F),
       so the axis numbers are round in either system. */
    var pad = Math.min(9, Math.max(3, (tHi - tLo) * 0.14));
    var tMin = Math.floor(U.t(tLo - pad) / U.tRound) * U.tRound;
    var tMax = Math.ceil(U.t(tHi + pad) / U.tRound) * U.tRound;

    /* Humidity ratio is rounded to a multiple of two, which keeps the grid
       labels whole without throwing away half the height. An earlier version
       forced the frame tall enough to show the saturation curve at the warm
       end, which pushed a 24 g/kg process onto a 40 g/kg chart and left every
       plotted point squashed into the lower third. The curve looks after
       itself: it is drawn wherever it falls and clipped where it does not. */
    var wMax = Math.ceil(U.w(wHi * 1.15 + 1) / U.wRound) * U.wRound;

    return {
      tMin: U.tInv(tMin),
      tMax: U.tInv(Math.max(tMax, tMin + U.tSpanMin)),
      wMin: 0,
      wMax: U.wInv(Math.max(wMax, U.wFloor))
    };
  }

  var PRESETS = {
    normal: { tMin: 0, tMax: 50, wMin: 0, wMax: 30, label: 'Normal temperature (0 to 50 °C)' },
    gulf: { tMin: 10, tMax: 55, wMin: 0, wMax: 35, label: 'High ambient (10 to 55 °C)' },
    low: { tMin: -30, tMax: 20, wMin: 0, wMax: 12, label: 'Low temperature (-30 to 20 °C)' },
    wide: { tMin: -10, tMax: 60, wMin: 0, wMax: 40, label: 'Wide (-10 to 60 °C)' }
  };

  /* The same four frames in round IP figures (°F and gr/lb). */
  function ipPreset(tMinF, tMaxF, wMaxGr, label) {
    return { tMin: P.ip.tempToC(tMinF), tMax: P.ip.tempToC(tMaxF), wMin: 0, wMax: wMaxGr / 7, label: label };
  }
  var PRESETS_IP = {
    normal: ipPreset(30, 120, 210, 'Normal temperature (30 to 120 °F)'),
    gulf: ipPreset(50, 130, 240, 'High ambient (50 to 130 °F)'),
    low: ipPreset(-20, 70, 80, 'Low temperature (-20 to 70 °F)'),
    wide: ipPreset(0, 140, 280, 'Wide (0 to 140 °F)')
  };

  function presetLabels(ip) {
    var set = ip ? PRESETS_IP : PRESETS;
    var out = {};
    Object.keys(set).forEach(function (k) { out[k] = set[k].label; });
    return out;
  }

  /* ------------------------------------------------------- path builders */

  /* Points are emitted only while they stay inside the frame, and the path is
     broken wherever it leaves, so a line that re-enters does not get a false
     chord drawn across the chart. */
  function polyline(pts) {
    var d = '';
    var pen = false;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i] === null) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + pts[i][0].toFixed(2) + ',' + pts[i][1].toFixed(2);
      pen = true;
    }
    return d;
  }

  function sample(view, tFrom, tTo, stepK, wOf) {
    var pts = [];
    var r = view.range;
    for (var t = tFrom; t <= tTo + 1e-9; t += stepK) {
      var w = wOf(t);
      if (!isFinite(w) || w < r.wMin - 0.001 || w > r.wMax + 0.001) { pts.push(null); continue; }
      pts.push([view.x(t), view.y(w)]);
    }
    return pts;
  }

  /* The chart body is the region below the saturation curve — air cannot hold
     more moisture than that, so a printed chart leaves the corner blank. Using
     it as a clip path means no property line has to be trimmed by hand. */
  function bodyPath(view) {
    var r = view.range;
    var d = 'M' + view.x(r.tMin) + ',' + view.y(r.wMin) +
            'L' + view.x(r.tMax) + ',' + view.y(r.wMin);
    var step = (r.tMax - r.tMin) / 400;
    for (var t = r.tMax; t >= r.tMin - 1e-9; t -= step) {
      var wsat = P.satHumRatio(t, view.p) * 1000;
      d += 'L' + view.x(t).toFixed(2) + ',' + view.y(Math.min(wsat, r.wMax)).toFixed(2);
    }
    return d + 'Z';
  }

  /* ------------------------------------------------------------- layers */

  /* Returns the grid lines (drawn inside the moist-air clip) and the axis
     numbers separately: the numbers sit in the margins, outside the clip,
     and vanish if they are drawn inside it. */
  function drawGrid(view) {
    var r = view.range;
    var out = [];
    var ticks = [];
    /* Lines are stepped in the unit on show and placed with the SI value. */
    var tLo = U.t(r.tMin);
    var tHi = U.t(r.tMax);
    var wLo = U.w(r.wMin);
    var wHi = U.w(r.wMax);
    var tStep = niceStep(tHi - tLo, 10);
    var wStep = niceStep(wHi - wLo, 8);
    var t, w, x, y;

    /* Fine grid, as on the printed chart: 1 °C and 1 g/kg (or 0.5 g/kg on a
       short frame), drawn lighter than the labelled lines. Skipped when the
       frame is so wide that the minor lines would crowd into a grey wash. */
    var tMinor = tStep >= 5 ? tStep / 5 : 0;
    var wMinor = wStep >= 5 ? wStep / 5 : (wStep >= 2 ? wStep / 2 : 0);
    if (tMinor && (tHi - tLo) / tMinor <= 80) {
      for (t = firstStep(tLo, tMinor); t <= tHi + 1e-6; t += tMinor) {
        if (Math.abs(t / tStep - Math.round(t / tStep)) < 1e-6) { continue; }
        x = view.x(U.tInv(t));
        out.push('<line class="psy-grid psy-grid--minor" x1="' + x.toFixed(1) + '" y1="' + PLOT.y0 +
                 '" x2="' + x.toFixed(1) + '" y2="' + PLOT.y1 + '"/>');
      }
    }
    if (wMinor && (wHi - wLo) / wMinor <= 60) {
      for (w = firstStep(wLo, wMinor); w <= wHi + 1e-6; w += wMinor) {
        if (Math.abs(w / wStep - Math.round(w / wStep)) < 1e-6) { continue; }
        y = view.y(U.wInv(w));
        out.push('<line class="psy-grid psy-grid--minor" x1="' + PLOT.x0 + '" y1="' + y.toFixed(1) +
                 '" x2="' + PLOT.x1 + '" y2="' + y.toFixed(1) + '"/>');
      }
    }

    for (t = firstStep(tLo, tStep); t <= tHi + 1e-6; t += tStep) {
      x = view.x(U.tInv(t));
      out.push('<line class="psy-grid" x1="' + x.toFixed(1) + '" y1="' + PLOT.y0 +
               '" x2="' + x.toFixed(1) + '" y2="' + PLOT.y1 + '"/>');
      ticks.push('<text class="psy-axis-tick" x="' + x.toFixed(1) + '" y="' + (PLOT.y1 + 18) +
                 '" text-anchor="middle">' + (+t.toFixed(4)) + '</text>');
    }

    for (w = firstStep(wLo, wStep); w <= wHi + 1e-6; w += wStep) {
      y = view.y(U.wInv(w));
      out.push('<line class="psy-grid" x1="' + PLOT.x0 + '" y1="' + y.toFixed(1) +
               '" x2="' + PLOT.x1 + '" y2="' + y.toFixed(1) + '"/>');
      /* Humidity ratio is read off the right-hand edge, as on a printed chart. */
      ticks.push('<text class="psy-axis-tick" x="' + (PLOT.x1 + 8) + '" y="' + (y + 4).toFixed(1) +
                 '" text-anchor="start">' + (+w.toFixed(4)) + '</text>');
    }
    return { lines: out.join(''), ticks: ticks.join('') };
  }

  function drawRH(view) {
    var r = view.range;
    var out = [];
    RH_LINES.forEach(function (rh) {
      var pts = sample(view, r.tMin, r.tMax, (r.tMax - r.tMin) / 300, function (t) {
        return P.humRatioFromRH(t, rh, view.p) * 1000;
      });
      var d = polyline(pts);
      if (!d) { return; }
      out.push('<path class="psy-line psy-line--rh" d="' + d + '"/>');

      /* Label where the line is still inside the frame, walking in from the
         warm end so the labels stagger up the curve instead of stacking. */
      for (var t = r.tMax; t > r.tMin; t -= (r.tMax - r.tMin) / 60) {
        var w = P.humRatioFromRH(t, rh, view.p) * 1000;
        if (w <= r.wMax * 0.94 && w >= r.wMin) {
          var slope = (P.humRatioFromRH(t + 0.5, rh, view.p) * 1000 - w);
          var ang = Math.atan2(-(view.y(w + slope) - view.y(w)), view.x(t + 0.5) - view.x(t));
          out.push('<text class="psy-label psy-label--rh" x="' + view.x(t).toFixed(1) +
                   '" y="' + (view.y(w) - 3).toFixed(1) + '" text-anchor="end" transform="rotate(' +
                   (-ang * 180 / Math.PI).toFixed(1) + ',' + view.x(t).toFixed(1) + ',' +
                   (view.y(w) - 3).toFixed(1) + ')">' + rh + '%</text>');
          break;
        }
      }
    });
    return out.join('');
  }

  /* Returns the clipped lines and, separately, the labels: the labels sit on
     the saturation curve as on ASHRAE Chart No. 1, which is the clip boundary,
     so they have to be drawn outside the clipped group or they are cut away. */
  function drawWetBulb(view) {
    var r = view.range;
    var lines = [];
    var labels = [];
    var step = U.wbStep(r);
    var every = U.wbLabelEvery(step);
    for (var shown = firstStep(U.t(r.tMin), step); shown <= U.t(r.tMax) + 1e-6; shown += step) {
      var wb = U.tInv(shown);
      /* A wet-bulb line starts on the saturation curve at its own temperature
         and runs down and to the right from there. */
      var wSat = P.satHumRatio(wb, view.p) * 1000;
      if (wSat > r.wMax) { continue; }
      var pts = sample(view, wb, r.tMax, (r.tMax - wb) / 60 || 1, function (t) {
        return P.humRatioFromWetBulb(t, wb, view.p) * 1000;
      });
      var d = polyline(pts);
      if (!d) { continue; }
      var major = Math.abs(shown / every - Math.round(shown / every)) < 1e-6;
      lines.push('<path class="psy-line psy-line--wb' + (major ? ' psy-line--wb-major' : '') + '" d="' + d + '"/>');
      if (major && wSat >= r.wMin) {
        /* Just outside the saturation curve, up and to the left of the point
           where the line starts, following the local slope of the curve. */
        var xs = view.x(wb);
        var ys = view.y(wSat);
        var w2 = P.satHumRatio(wb + 1, view.p) * 1000;
        var ang = Math.atan2(view.y(w2) - ys, view.x(wb + 1) - xs);
        var nx = Math.sin(ang);
        var ny = -Math.cos(ang);
        var lx = xs + nx * 9;
        var ly = ys + ny * 9;
        if (lx > PLOT.x0 - 30 && ly > PLOT.y0 - 14 && lx < PLOT.x1) {
          labels.push('<text class="psy-label psy-label--wb" x="' + lx.toFixed(1) + '" y="' +
                      (ly + 3).toFixed(1) + '" text-anchor="middle">' + Math.round(shown) + '</text>');
        }
      }
    }
    return { lines: lines.join(''), labels: labels.join('') };
  }

  function drawEnthalpy(view) {
    var r = view.range;
    var out = [];
    /* Range of enthalpy actually present on this chart, so the loop does not
       walk hundreds of lines that all fall outside the frame. */
    var hLo = U.h(P.enthalpy(r.tMin, r.wMin / 1000));
    var hHi = U.h(P.enthalpy(r.tMax, r.wMax / 1000));
    var step = U.hStep;
    while ((hHi - hLo) / step > 40) { step *= 2; }

    for (var shown = firstStep(hLo, step); shown <= hHi; shown += step) {
      var h = U.hInv(shown);
      /* Solve Eq 30 for t at each humidity ratio: the line is very nearly
         straight, so a handful of samples is plenty. */
      var pts = [];
      for (var w = r.wMin; w <= r.wMax + 1e-9; w += (r.wMax - r.wMin) / 24) {
        var W = w / 1000;
        var t = (h - W * P.H_FG0) / (1.006 + W * 1.86);
        if (t < r.tMin || t > r.tMax) { pts.push(null); continue; }
        pts.push([view.x(t), view.y(w)]);
      }
      var d = polyline(pts);
      if (!d) { continue; }
      out.push('<path class="psy-line psy-line--h" d="' + d + '"/>');
    }
    return out.join('');
  }

  /* The enthalpy scale proper: short ticks sitting just outside the saturation
     curve, which is where a printed chart puts it. Drawn outside the clip so
     it is visible in the blank corner. */
  function drawEnthalpyScale(view) {
    var r = view.range;
    var out = [];
    var hLo = U.h(P.enthalpy(r.tMin, 0));
    var hHi = U.h(P.enthalpy(r.tMax, r.wMax / 1000));
    var step = U.hScaleStep;
    while ((hHi - hLo) / step > 16) { step *= 2; }

    for (var shown = firstStep(hLo, step); shown <= hHi; shown += step) {
      var h = U.hInv(shown);
      /* Find where this enthalpy line meets the saturation curve. */
      var lo = r.tMin - 20;
      var hi = r.tMax + 5;
      var found = false;
      for (var i = 0; i < 60; i++) {
        var mid = (lo + hi) / 2;
        if (P.enthalpy(mid, P.satHumRatio(mid, view.p)) < h) { lo = mid; } else { hi = mid; }
        if (hi - lo < 1e-6) { found = true; break; }
      }
      if (!found) { continue; }
      var tSat = (lo + hi) / 2;
      var wSat = P.satHumRatio(tSat, view.p) * 1000;
      if (wSat > r.wMax || tSat < r.tMin - 15) { continue; }

      /* The tick steps out from the curve along its own enthalpy line, by a
         fixed number of pixels rather than a fixed step in humidity ratio.
         In chart units the same step becomes a short stub on a tall frame and
         a line halfway across the chart on a wide one, because an enthalpy
         line is very nearly horizontal. */
      var xa = view.x(tSat);
      var ya = view.y(wSat);
      var probeW = wSat + (r.wMax - r.wMin) * 0.01;
      var probeT = (h - (probeW / 1000) * P.H_FG0) / (1.006 + (probeW / 1000) * 1.86);
      var vx = view.x(probeT) - xa;
      var vy = view.y(probeW) - ya;
      var len = Math.sqrt(vx * vx + vy * vy);
      if (!(len > 0)) { continue; }
      /* The tick starts clear of the wet-bulb labels that sit on the curve,
         and runs out to where the scale figures are read. */
      var FROM = 20;
      var TICK = 36;
      var xa2 = xa + vx / len * FROM;
      var ya2 = ya + vy / len * FROM;
      var xb = xa + vx / len * TICK;
      var yb = ya + vy / len * TICK;
      if (xb < PLOT.x0 - 60 || yb < PLOT.y0 - 20) { continue; }

      out.push('<line class="psy-hscale-tick" x1="' + xa2.toFixed(1) + '" y1="' + ya2.toFixed(1) +
               '" x2="' + xb.toFixed(1) + '" y2="' + yb.toFixed(1) + '"/>');
      out.push('<text class="psy-label psy-label--hscale" x="' + (xb - 3).toFixed(1) +
               '" y="' + (yb - 3).toFixed(1) + '" text-anchor="end">' + (+shown.toFixed(1)) + '</text>');
    }
    return out.join('');
  }

  function drawVolume(view) {
    var r = view.range;
    var out = [];
    var vLo = U.v(P.specificVolume(r.tMin, r.wMin / 1000, view.p));
    var vHi = U.v(P.specificVolume(r.tMax, r.wMax / 1000, view.p));
    var step = U.vStep;
    while ((vHi - vLo) / step > 14) { step *= 2; }

    for (var shown = firstStep(vLo, step); shown <= vHi; shown += step) {
      var v = U.vInv(shown);
      var pts = [];
      for (var w = r.wMin; w <= r.wMax + 1e-9; w += (r.wMax - r.wMin) / 20) {
        /* Eq 26 solved for temperature. */
        var W = w / 1000;
        var t = v * view.p / (0.287042 * (1 + 1.607858 * W)) - 273.15;
        if (t < r.tMin || t > r.tMax) { pts.push(null); continue; }
        pts.push([view.x(t), view.y(w)]);
      }
      var d = polyline(pts);
      if (!d) { continue; }
      out.push('<path class="psy-line psy-line--v" d="' + d + '"/>');
      /* Label at the bottom end, where the line leaves the chart. */
      var tBase = v * view.p / 0.287042 - 273.15;
      if (tBase > r.tMin && tBase < r.tMax) {
        out.push('<text class="psy-label psy-label--v" x="' + (view.x(tBase) + 3).toFixed(1) +
                 '" y="' + (PLOT.y1 - 5) + '">' + shown.toFixed(U.vDigits) + '</text>');
      }
    }
    return out.join('');
  }

  function drawSaturation(view) {
    var r = view.range;
    var pts = sample(view, r.tMin, r.tMax, (r.tMax - r.tMin) / 400, function (t) {
      return P.satHumRatio(t, view.p) * 1000;
    });
    /* The curve is not named in words: as on the printed chart, the wet-bulb
       temperatures written along it identify it, and a text label here
       collided with them and with the enthalpy scale. */
    return '<path class="psy-sat" d="' + polyline(pts) + '"/>';
  }

  /* ASHRAE Standard 55 summer and winter comfort zones, drawn as the operative
     temperature bands most often quoted for 0.5 clo and 1.0 clo at light
     activity. This is an indicative overlay for orientation on the chart, not
     a compliance check: Standard 55 depends on air speed, clothing, metabolic
     rate and radiant temperature, none of which a chart can know. */
  var COMFORT = {
    winter: { pts: [[20, 0], [24, 0], [23.4, 12], [19.4, 12]], label: 'winter' },
    summer: { pts: [[24.5, 0], [28, 0], [27.2, 12], [23.8, 12]], label: 'summer' }
  };

  function drawComfort(view) {
    var out = [];
    Object.keys(COMFORT).forEach(function (key) {
      var zone = COMFORT[key];
      var pts = zone.pts.map(function (pt) {
        return view.x(pt[0]).toFixed(1) + ',' + view.y(pt[1]).toFixed(1);
      }).join(' ');
      out.push('<polygon class="psy-comfort psy-comfort--' + key + '" points="' + pts + '"/>');
      /* The label sits on the upper edge of its own band. Putting both in the
         middle stacked them on top of each other wherever the two overlap,
         which is most of the time — the zones differ by clothing, not by
         occupying different parts of the chart. */
      var top = (zone.pts[2][0] + zone.pts[3][0]) / 2;
      out.push('<text class="psy-label psy-label--comfort" x="' + view.x(top).toFixed(1) +
               '" y="' + (view.y(12) - 4).toFixed(1) + '" text-anchor="middle">' +
               zone.label + '</text>');
    });
    return out.join('');
  }

  /* --------------------------------------------------- process and points */

  /* A step into a mixed state is two airstreams meeting, not a coil: it is
     drawn dashed, from each of the two sources, with no sensible and latent
     legs and no apparatus dew point. */
  function drawSegments(view, points, opts) {
    var out = [];
    function line(a, b, markerIndex, cls) {
      return '<line class="psy-process' + cls + '" style="stroke:var(' + b.colour + ')" marker-end="url(#psy-arrow-' +
             (markerIndex % 8) + ')" x1="' + view.x(a.state.db).toFixed(1) + '" y1="' + view.y(a.state.W * 1000).toFixed(1) +
             '" x2="' + view.x(b.state.db).toFixed(1) + '" y2="' + view.y(b.state.W * 1000).toFixed(1) + '"/>';
    }
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      if (!a.state || !a.state.ok || !b.state || !b.state.ok) { continue; }
      var x1 = view.x(a.state.db);
      var y1 = view.y(a.state.W * 1000);
      var x2 = view.x(b.state.db);
      var y2 = view.y(b.state.W * 1000);
      var active = opts.activeSegment === i;

      if (b.mixed) {
        out.push(line(a, b, i, ' psy-process--mix' + (active ? ' is-active' : '')));
        continue;
      }

      /* The sensible and latent legs of the change, as a right-angled
         construction under the process line. This is how the split is read off
         a chart by hand, and it makes a low sensible heat ratio visible at a
         glance rather than only in the numbers. */
      if (opts.showLegs && Math.abs(x2 - x1) > 2 && Math.abs(y2 - y1) > 2) {
        out.push('<path class="psy-leg psy-leg--sensible" d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) +
                 'L' + x2.toFixed(1) + ',' + y1.toFixed(1) + '"/>');
        out.push('<path class="psy-leg psy-leg--latent" d="M' + x2.toFixed(1) + ',' + y1.toFixed(1) +
                 'L' + x2.toFixed(1) + ',' + y2.toFixed(1) + '"/>');
      }

      out.push(line(a, b, i, active ? ' is-active' : ''));
    }

    /* The other airstream of each mix, which is not the row just above it. */
    points.forEach(function (b, k) {
      if (!b.mixed || !b.state || !b.state.ok) { return; }
      (b.mixFrom || []).forEach(function (j) {
        var a = points[j];
        if (j === k - 1 || !a || !a.state || !a.state.ok) { return; }
        out.push(line(a, b, Math.max(0, k - 1), ' psy-process--mix'));
      });
    });
    return out.join('');
  }

  /* Every straight line between plotted states, for the label placement. */
  function processLines(view, points) {
    var out = [];
    function add(a, b) {
      if (!a || !b || !a.state || !a.state.ok || !b.state || !b.state.ok) { return; }
      out.push([view.x(a.state.db), view.y(a.state.W * 1000), view.x(b.state.db), view.y(b.state.W * 1000)]);
    }
    for (var i = 0; i < points.length - 1; i++) { add(points[i], points[i + 1]); }
    points.forEach(function (b, k) {
      if (!b.mixed) { return; }
      (b.mixFrom || []).forEach(function (j) { if (j !== k - 1) { add(points[j], b); } });
    });
    return out;
  }

  function overlap(a, b) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  }

  /* True when a line runs through the box: sampled along its length, which is
     plenty for boxes the size of a label. */
  function lineCrosses(seg, box) {
    for (var k = 0; k <= 40; k++) {
      var x = seg[0] + (seg[2] - seg[0]) * k / 40;
      var y = seg[1] + (seg[3] - seg[1]) * k / 40;
      if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) { return true; }
    }
    return false;
  }

  function markerBoxes(view, points) {
    var out = [];
    points.forEach(function (pt) {
      if (!pt.state || !pt.state.ok) { return; }
      var x = view.x(pt.state.db);
      var y = view.y(pt.state.W * 1000);
      out.push({ x0: x - 9, y0: y - 9, x1: x + 9, y1: y + 9 });
    });
    return out;
  }

  /* Returns the apparatus dew point construction and the boxes its labels
     take up, so the point captions can keep clear of them. */
  function drawAdp(view, points, opts) {
    var out = [];
    var boxes = [];
    if (!opts.showAdp) { return { svg: '', boxes: boxes }; }
    var markers = markerBoxes(view, points);
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      if (b.mixed || !a.state || !a.state.ok || !b.state || !b.state.ok) { continue; }
      var adp = P.apparatusDewPoint(a.state, b.state);
      if (!adp) { continue; }
      var x2 = view.x(b.state.db);
      var y2 = view.y(b.state.W * 1000);
      var xa = view.x(adp.t);
      var ya = view.y(adp.W * 1000);
      out.push('<line class="psy-adp-line" x1="' + x2.toFixed(1) + '" y1="' + y2.toFixed(1) +
               '" x2="' + xa.toFixed(1) + '" y2="' + ya.toFixed(1) + '"/>');
      out.push('<circle class="psy-adp-dot" cx="' + xa.toFixed(1) + '" cy="' + ya.toFixed(1) + '" r="4"/>');
      boxes.push({ x0: xa - 5, y0: ya - 5, x1: xa + 5, y1: ya + 5 });

      /* Down and to the right of the marker: up and to the left is outside
         the saturation curve, and therefore outside the clip. Stepped further
         down while it would sit on a state marker or another ADP label. */
      var text = 'ADP ' + U.t(adp.t).toFixed(1) + U.tUnit;
      var width = (text.length - 5) * 6.2 + 4;
      var box = null;
      for (var row = 0; row < 6; row++) {
        var ty = ya + 15 + row * 13;
        var cand = { x0: xa + 6, y0: ty - 10, x1: xa + 8 + width, y1: ty + 3, ty: ty };
        if (cand.y1 > PLOT.y1 - 2) { break; }
        var hit = markers.concat(boxes).some(function (m) { return overlap(cand, m); });
        if (!hit) { box = cand; break; }
        if (!box) { box = cand; }
      }
      boxes.push(box);
      out.push('<text class="psy-label psy-label--adp" x="' + (xa + 8).toFixed(1) +
               '" y="' + box.ty.toFixed(1) + '" text-anchor="start">' + text + '</text>');
    }
    return { svg: out.join(''), boxes: boxes };
  }

  /* Text with a knocked-out backdrop — see the note in drawPoints. */
  function haloText(cls, spot, dy, content, colour) {
    var x = spot.x.toFixed(1);
    var y = (spot.y + dy).toFixed(1);
    var common = ' x="' + x + '" y="' + y + '" text-anchor="' + spot.anchor + '">';
    return '<text class="' + cls + ' psy-halo"' + common + content + '</text>' +
           '<text class="' + cls + '"' + (colour ? ' style="fill:' + colour + '"' : '') +
           common + content + '</text>';
  }

  function drawPoints(view, points, taken) {
    var out = [];
    var placed = [];
    var markers = markerBoxes(view, points);
    var lines = processLines(view, points);

    /* Each label is two lines of text, so a cluster of states a few degrees
       apart — an off-coil, a supply and a room condition, which is the normal
       case — piles four or six lines on the same spot and none of them can be
       read. Each label is therefore given a box sized to its own text and
       tried in turn on the preferred side, the other side, then further above
       and below, until it is clear of the labels already placed, of every
       state marker, of the apparatus dew point labels and of the process
       lines. A leader line is drawn whenever the label ends up far enough from
       its marker that the pairing stops being obvious. */
    var LH = 30;       /* height of the two lines, px                        */

    function boxAt(cand, width) {
      return {
        x0: cand.anchor === 'start' ? cand.x - 2 : cand.x - width - 2,
        x1: cand.anchor === 'start' ? cand.x + width + 2 : cand.x + 2,
        y0: cand.y - 11,
        y1: cand.y + 17
      };
    }

    function trouble(box, own) {
      var n = 0;
      placed.forEach(function (b) { if (overlap(box, b)) { n += 4; } });
      (taken || []).forEach(function (b) { if (overlap(box, b)) { n += 3; } });
      markers.forEach(function (b, k) { if (k !== own && overlap(box, b)) { n += 3; } });
      lines.forEach(function (seg) { if (lineCrosses(seg, box)) { n += 1; } });
      return n;
    }

    var shown = -1;
    points.forEach(function (pt, i) {
      var s = pt.state;
      if (!s || !s.ok) { return; }
      shown += 1;
      var x = view.x(s.db);
      var y = view.y(s.W * 1000);
      var colour = 'var(' + pt.colour + ')';

      out.push('<circle class="psy-pt-halo" style="fill:' + colour + '" cx="' + x.toFixed(1) +
               '" cy="' + y.toFixed(1) + '" r="10"/>');
      out.push('<circle class="psy-pt" style="fill:' + colour + '" cx="' + x.toFixed(1) +
               '" cy="' + y.toFixed(1) + '" r="5.5"/>');

      var rawName = String(pt.label || ('Point ' + (i + 1)));
      var name = esc(rawName);
      var subText = U.t(s.db).toFixed(1) + ' ' + U.tUnit + ' &#183; ' + s.rh.toFixed(0) + '% &#183; ' +
                    U.w(s.W * 1000).toFixed(U.wDigits) + ' ' + U.wUnit;
      var subLength = subText.replace(/&#\d+;/g, 'x').length;
      var width = Math.max(rawName.length * 7.2, subLength * 6.1);

      /* Near the right edge the label has to open leftwards or it is clipped. */
      var preferRight = x + 13 + width < PLOT.x1 + M.right - 6;
      var best = null;
      var bestScore = Infinity;
      [0, -1, 1, -2, 2, -3, 3, -4, 4].forEach(function (row, order) {
        [preferRight, !preferRight].forEach(function (toRight, side) {
          var cand = {
            x: toRight ? x + 13 : x - 13,
            y: y - 12 + row * LH,
            anchor: toRight ? 'start' : 'end'
          };
          if (cand.y < PLOT.y0 + 16 || cand.y > PLOT.y1 - 18) { return; }
          var box = boxAt(cand, width);
          if (box.x0 < 2 || box.x1 > VB.w - 2) { return; }
          /* Clear spots win; among those, the nearest to the marker. */
          var score = trouble(box, shown) * 100 + order * 2 + side;
          if (score < bestScore) { bestScore = score; best = cand; best.box = box; }
        });
      });
      var spot = best || { x: x + 13, y: y - 12, anchor: 'start', box: boxAt({ x: x + 13, y: y - 12, anchor: 'start' }, width) };
      placed.push(spot.box);

      /* Once a label has been pushed clear of its marker, say which marker it
         belongs to rather than leaving the reader to guess. */
      if (Math.abs(spot.y - (y - 12)) > 6) {
        out.push('<line class="psy-pt-leader" x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) +
                 '" x2="' + spot.x.toFixed(1) + '" y2="' + (spot.y - 4).toFixed(1) + '"/>');
      }

      /* Each label is drawn twice: once as a thick stroke in the surface
         colour to knock a hole in the property lines underneath, then again
         as the text itself. `paint-order: stroke` would do the same in one
         element, but it is not honoured everywhere the chart is rendered —
         including some SVG-to-image paths — and where it is missed the label
         becomes a solid white blob. Two elements always work. */
      out.push(haloText('psy-pt-label', spot, 0, name, colour));
      out.push(haloText('psy-pt-sub', spot, 13, subText, null));
    });
    return out.join('');
  }

  /* The sensible heat ratio protractor, the ASHRAE chart's own instrument.
     Sits in the blank corner above the saturation curve. The needle shows the
     ratio for the selected process, so the slope on the chart and the number
     in the table are visibly the same quantity. */
  function drawProtractor(view, shr) {
    var cx = PLOT.x0 + 96;
    var cy = PLOT.y0 + 92;
    var R = 54;
    var out = [];

    /* Chart pixels per unit of temperature and of humidity ratio. The slope a
       given SHR makes on screen depends on both scales, so it has to be worked
       out from the view rather than assumed. */
    var pxPerK = view.x(1) - view.x(0);
    var pxPerG = view.y(0) - view.y(1);

    function angleFor(ratio) {
      /* dW/dT for a ratio, from q_s = cp·dT and q_l = hfg·dW. */
      var dWdT = ratio <= 0 ? Infinity : (1.006 / P.H_FG0) * (1 / ratio - 1) * 1000;
      var dx = pxPerK;
      var dy = -dWdT * pxPerG;
      if (!isFinite(dWdT)) { dx = 0; dy = -pxPerG; }
      return Math.atan2(dy, dx);
    }

    out.push('<circle class="psy-prot-face" cx="' + cx + '" cy="' + cy + '" r="' + R + '"/>');

    /* The scale is deliberately not linear in angle. A given ratio has one
       true direction on this chart and no other, so the ticks land where the
       geometry puts them — which crowds the high end, exactly as it does on a
       printed ASHRAE protractor. Spreading them evenly would look tidier and
       would stop the instrument working, since the whole point is that the
       needle's direction can be carried straight onto the process line.
       Labels alternate between two radii so the crowded end stays legible. */
    var TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];
    TICKS.forEach(function (ratio, k) {
      var a = angleFor(ratio);
      out.push('<line class="psy-prot-tick" x1="' + (cx + (R - 9) * Math.cos(a)).toFixed(1) +
               '" y1="' + (cy + (R - 9) * Math.sin(a)).toFixed(1) +
               '" x2="' + (cx + R * Math.cos(a)).toFixed(1) +
               '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '"/>');
      var lr = R + (k % 2 ? 22 : 11);
      out.push('<line class="psy-prot-tick" x1="' + (cx + R * Math.cos(a)).toFixed(1) +
               '" y1="' + (cy + R * Math.sin(a)).toFixed(1) +
               '" x2="' + (cx + (lr - 6) * Math.cos(a)).toFixed(1) +
               '" y2="' + (cy + (lr - 6) * Math.sin(a)).toFixed(1) + '"/>');
      out.push('<text class="psy-label psy-label--prot" x="' + (cx + lr * Math.cos(a)).toFixed(1) +
               '" y="' + (cy + lr * Math.sin(a) + 3.5).toFixed(1) +
               '" text-anchor="middle">' + ratio.toFixed(1) + '</text>');
    });
    out.push('<text class="psy-label psy-label--prot-title" x="' + cx + '" y="' + (cy - R - 26) +
             '" text-anchor="middle">SENSIBLE HEAT RATIO</text>');

    if (isFinite(shr)) {
      var clamped = Math.max(0, Math.min(1, shr));
      var an = angleFor(clamped);
      /* Drawn right across the face rather than out from the hub: the
         protractor states a direction that a process line is parallel to, and
         a process may run either way along it. A half needle implies a sense
         the instrument does not carry. */
      out.push('<line class="psy-prot-needle" x1="' + (cx - R * Math.cos(an)).toFixed(1) +
               '" y1="' + (cy - R * Math.sin(an)).toFixed(1) +
               '" x2="' + (cx + R * Math.cos(an)).toFixed(1) +
               '" y2="' + (cy + R * Math.sin(an)).toFixed(1) + '"/>');
      out.push('<circle class="psy-prot-hub" cx="' + cx + '" cy="' + cy + '" r="3"/>');
      out.push('<text class="psy-prot-value" x="' + cx + '" y="' + (cy + R + 20) +
               '" text-anchor="middle">' + shr.toFixed(2) + '</text>');
    }
    return out.join('');
  }

  /* ---------------------------------------------------------------- axes */

  function drawFrame(view) {
    return '<rect class="psy-frame" x="' + PLOT.x0 + '" y="' + PLOT.y0 +
      '" width="' + (PLOT.x1 - PLOT.x0) + '" height="' + (PLOT.y1 - PLOT.y0) + '"/>' +
      '<text class="psy-axis-title" x="' + ((PLOT.x0 + PLOT.x1) / 2) + '" y="' + (VB.h - 14) +
      '" text-anchor="middle">Dry-bulb temperature (' + U.tUnit + ')</text>' +
      '<text class="psy-axis-title" x="' + (VB.w - 16) + '" y="' + ((PLOT.y0 + PLOT.y1) / 2) +
      '" text-anchor="middle" transform="rotate(90,' + (VB.w - 16) + ',' + ((PLOT.y0 + PLOT.y1) / 2) +
      ')">Humidity ratio (' + U.wUnit + ' dry air)</text>' +
      '<text class="psy-axis-title psy-axis-title--h" x="' + (PLOT.x0 - 52) + '" y="' + (PLOT.y0 + 190) +
      '" text-anchor="middle" transform="rotate(-90,' + (PLOT.x0 - 52) + ',' + (PLOT.y0 + 190) +
      ')">Enthalpy (' + U.hUnit + ' dry air)</text>';
  }

  /* The chart's own caption, as printed on ASHRAE Chart No. 1: which pressure
     and altitude it is drawn for. A chart saved as an image without this is
     a chart nobody can trust later. Sits under the protractor in the blank
     corner; when the protractor is off it takes the top of that corner. */
  function drawCaption(view, opts) {
    /* One line in the top margin, right-aligned to the frame, clear of every
       property line and of the enthalpy scale in the top-left corner. */
    var y = PLOT.y0 - 10;
    var parts = ['Barometric pressure ' + U.pressure(view.p)];
    if (opts.captionAltitude) { parts.push(opts.captionAltitude); }
    return '<text class="psy-caption psy-caption--title" x="' + PLOT.x0 + '" y="' + y +
           '" text-anchor="start">ASHRAE-style psychrometric chart</text>' +
           '<text class="psy-caption" x="' + PLOT.x1 + '" y="' + y + '" text-anchor="end">' +
           esc(parts.join(' · ')) + '</text>';
  }

  /* ------------------------------------------------------------- markers */

  function defs(points) {
    var out = ['<defs>'];
    /* One arrowhead per series colour: a marker cannot inherit the stroke of
       the line that references it, so each has to carry its own fill. */
    for (var i = 0; i < 8; i++) {
      var colour = (points[i + 1] && points[i + 1].colour) || ('--chart-' + ((i % 8) + 1));
      out.push('<marker id="psy-arrow-' + i + '" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto">' +
               '<path d="M0,0 L7,3 L0,6 Z" style="fill:var(' + colour + ')"/></marker>');
    }
    out.push('<clipPath id="psy-body"><path d="' + '{BODY}' + '"/></clipPath>');
    out.push('</defs>');
    return out.join('');
  }

  /* --------------------------------------------------------------- render */

  /* points: [{ label, colour, state }]  — colour is a --chart-N token name.
             a point may also carry mixed (true) and mixFrom ([index, index]).
     opts:   { rangeMode, pressure, layers:{}, activeSegment, showAdp, showLegs, ip } */
  function render(points, opts) {
    var pressure = opts.pressure;
    U = opts.ip ? IP_UNITS : SI_UNITS;
    var presets = opts.ip ? PRESETS_IP : PRESETS;
    var range = opts.rangeMode === 'auto'
      ? autoRange(points.map(function (p) { return p.state; }), pressure)
      : presets[opts.rangeMode] || presets.normal;
    var view = makeView(range, pressure);
    var L = opts.layers || {};

    var body = bodyPath(view);
    var out = [];

    out.push(defs(points).replace('{BODY}', body));
    out.push('<rect class="psy-bg" x="' + PLOT.x0 + '" y="' + PLOT.y0 + '" width="' +
             (PLOT.x1 - PLOT.x0) + '" height="' + (PLOT.y1 - PLOT.y0) + '"/>');

    /* Everything that belongs inside the moist-air region is clipped to it. */
    var wb = L.wetBulb ? drawWetBulb(view) : null;
    var grid = drawGrid(view);

    out.push(grid.ticks);
    out.push('<g clip-path="url(#psy-body)">');
    out.push(grid.lines);
    if (L.volume) { out.push(drawVolume(view)); }
    if (L.enthalpy) { out.push(drawEnthalpy(view)); }
    if (wb) { out.push(wb.lines); }
    if (L.rh) { out.push(drawRH(view)); }
    if (L.comfort) { out.push(drawComfort(view)); }
    out.push('</g>');

    out.push(drawSaturation(view));
    if (wb) { out.push(wb.labels); }
    if (L.enthalpy) { out.push(drawEnthalpyScale(view)); }
    out.push(drawFrame(view));
    out.push(drawCaption(view, opts));

    var adp = drawAdp(view, points, opts);
    out.push('<g clip-path="url(#psy-body)">');
    out.push(adp.svg);
    out.push(drawSegments(view, points, opts));
    out.push('</g>');
    out.push(drawPoints(view, points, adp.boxes));

    if (L.protractor) { out.push(drawProtractor(view, opts.shr)); }

    /* Layer for the pointer crosshair, filled in by the page. */
    out.push('<g class="psy-cursor" aria-hidden="true"></g>');

    return { svg: out.join(''), view: view, range: range };
  }

  global.TN.psychroChart = {
    render: render,
    makeView: makeView,
    autoRange: autoRange,
    PRESETS: PRESETS,
    presetLabels: presetLabels,
    PLOT: PLOT,
    VB: VB
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
