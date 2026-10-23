/* ============================================================
   Thinkneering Tools - Maps: the 2D view of a piping map (owner, 23 Oct 2026: "a 2D view like the picture of a typical
   chilled water system, to understand water flow in and out") and of a wiring map (same day: "2D view is great, can it be
   done for electrical also?"): a single-line diagram, sources at the top, each board a busbar over what it feeds.
   Draws the map's equipment as schematic symbols where their special note "Place: x, y" (headers "Place: x, y, w, h")
   puts them, and its pipes as square-cornered lines between them, each circuit in its own colour and line (supply solid,
   return dashed), with the way the water goes (arrows and moving dots) and the figures maps.js passes in. Branches on a
   pipe without a place wait in a row under the drawing ("not placed yet") until someone drags them (Edit). A wiring map
   needs no places: layout() sets every branch without one as a single-line diagram (from the power wires), and a branch
   dragged in Edit keeps the place it was given.
   Only drawing and dragging here: what the water does comes from mp-water.js, through maps.js.
   Symbols are drawn with currentColor and theme tokens only (day and night).
   ============================================================ */
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; }

  // the size of a symbol (px), by its sign
  var SIZE = { chiller: [140, 100], tower: [110, 100], ahu: [150, 60], fcu: [120, 46], pump: [52, 52], tank: [36, 64], separator: [36, 64],
    valve: [36, 36], hx: [60, 80], pipe: [16, 16], header: [200, 14], coil: [60, 44], filter: [44, 52], fan: [52, 52], motor: [48, 48], controller: [56, 44],
    transformer: [40, 66], generator: [54, 54], breaker: [30, 52], utility: [64, 46], earth: [32, 32], drive: [50, 56], panel: [64, 50], terminal: [64, 30] };
  // a size in the place ("Place: x, y, w, h") wins: a header or a board drawn as a bar, a box made wider for its wires
  function sizeOf(kind, place) {
    var d = SIZE[kind] || [56, 44];
    if (place && place.w) return [place.w, place.h || (kind === "header" || kind === "panel" ? 14 : d[1])];
    return d;
  }
  function isBar(kind, w, h) { return kind === "header" || (kind === "panel" && h <= 20 && w > h); }
  // the drawings: local coordinates 0..w, 0..h; classes sx-body (outline on the surface), sx-part (a filled part)
  function art(kind, w, h, signSvg) {
    switch (kind) {
      case "chiller": return '<rect class="sx-body" x="1" y="1" width="138" height="98" rx="8"/>' +
        '<rect class="sx-part" x="12" y="10" width="116" height="28" rx="14"/><rect class="sx-part" x="12" y="62" width="116" height="28" rx="14"/>' +
        '<circle class="sx-body" cx="70" cy="50" r="8"/><path d="M70 38v4M70 58v4M64 47l6 3 6-3"/>' +
        '<text class="sx-t" x="70" y="28">CONDENSER</text><text class="sx-t" x="70" y="80">EVAPORATOR</text>';
      case "tower": return '<path class="sx-body" d="M14 96 26 30h58l12 66z"/><rect class="sx-part" x="36" y="6" width="38" height="24" rx="3"/>' +
        '<path d="M43 18h24M55 11v14M24 88h62"/><path class="sx-thin" d="M30 52 80 76M30 76 80 52M28 64h54"/>' +
        '<path class="sx-thin" d="M8 44l8 3M8 58l7 2M102 44l-8 3M102 58l-7 2"/>';
      case "ahu": return '<rect class="sx-body" x="1" y="1" width="148" height="58" rx="4"/><path d="M40 1v58M78 1v58M116 1v58"/>' +
        '<path class="sx-thin" d="M6 54 36 6M6 30 21 6M21 54 36 30"/><path d="M50 10l18 8-18 8 18 8-18 8 18 6"/>' +
        '<circle class="sx-body" cx="97" cy="30" r="13"/><path d="M97 30l10-6M97 30l-3 12M97 30l-10-5"/><path d="M122 30h20M136 24l6 6-6 6"/>' +
        '<text class="sx-t" x="20" y="57">F</text><text class="sx-t" x="59" y="57">C</text><text class="sx-t" x="97" y="57">FAN</text>';
      case "fcu": return '<rect class="sx-body" x="1" y="1" width="118" height="44" rx="4"/><path d="M10 9l14 6-14 6 14 6-14 6 14 5"/>' +
        '<circle class="sx-body" cx="58" cy="23" r="11"/><path d="M58 23l8-5M58 23l-2 10M58 23l-8-4"/><path class="sx-thin" d="M80 12h30M80 19h30M80 26h30M80 33h30"/>';
      case "pump": return '<circle class="sx-body" cx="26" cy="26" r="23"/><path class="sx-fill" d="M17 14 41 26 17 38z"/>';
      case "tank": return '<rect class="sx-body" x="2" y="2" width="32" height="60" rx="16"/><path d="M2 30c10 6 22 6 32 0"/><text class="sx-t" x="18" y="50">ET</text>';
      case "separator": return '<rect class="sx-body" x="2" y="2" width="32" height="60" rx="8"/><path d="M18 2v-6M12 -4h12"/>' +
        '<circle class="sx-fill" cx="13" cy="20" r="1.6"/><circle class="sx-fill" cx="22" cy="28" r="1.6"/><circle class="sx-fill" cx="15" cy="36" r="1.6"/><circle class="sx-fill" cx="21" cy="45" r="1.6"/>';
      case "valve": return '<path class="sx-body" d="M3 10v18l15-9zM33 10v18l-15-9z"/><path d="M18 19V4M12 4h12"/>';
      case "hx": return '<rect class="sx-body" x="1" y="1" width="58" height="78" rx="4"/><path class="sx-thin" d="M14 1v78M24 1v78M34 1v78M44 1v78"/>';
      case "header": return '<rect class="sx-hdr" x="0" y="0" width="' + w + '" height="' + h + '" rx="' + Math.min(w, h) / 2 + '"/>';
      case "panel": if (isBar(kind, w, h)) return '<rect class="sx-bus" x="0" y="0" width="' + w + '" height="' + h + '" rx="2"/>'; break;
      // single-line symbols (IEC 60617 style): two windings, a G in a circle, a breaker's blade, an M in a circle
      case "transformer": return '<circle class="sx-body" cx="20" cy="22" r="17"/><circle cx="20" cy="44" r="17"/>';
      case "generator": return '<circle class="sx-body" cx="27" cy="27" r="25"/><text class="sx-T" x="27" y="27">G</text><path class="sx-thin" d="M18 40c3-4 6-4 9 0s6 4 9 0"/>';
      case "breaker": return '<rect class="sx-hit2" x="0" y="0" width="30" height="52"/><path d="M15 0v13M15 39v13M15 39 27 15M11 9l8 8M19 9l-8 8"/>';
      case "motor": return '<circle class="sx-body" cx="24" cy="24" r="22"/><text class="sx-T" x="24" y="25">M</text>';
      case "pipe": return '<circle class="sx-jn" cx="8" cy="8" r="6"/>';
    }
    var s = Math.min(w, h, 56) - 14;
    return '<rect class="sx-body" x="1" y="1" width="' + (w - 2) + '" height="' + (h - 2) + '" rx="6"/>' +
      (signSvg ? signSvg.replace("<svg ", '<svg x="' + (w - s) / 2 + '" y="' + (h - s) / 2 + '" width="' + s + '" height="' + s + '" ') : "");
  }

  // which side of box b faces point p: inside its width (with some margin) top / bottom, inside its height left / right
  function sideOf(b, p) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = p.x - cx, dy = p.y - cy;
    if (b.w <= 20 && b.h <= 20) return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : (dy > 0 ? "b" : "t");
    var inX = p.x > b.x + 8 && p.x < b.x + b.w - 8, inY = p.y > b.y + 4 && p.y < b.y + b.h - 4;
    if (inX && !inY) return dy > 0 ? "b" : "t";
    if (inY && !inX) return dx > 0 ? "r" : "l";
    return Math.abs(dx) / (b.w / 2 + 30) > Math.abs(dy) / (b.h / 2 + 30) ? (dx > 0 ? "r" : "l") : (dy > 0 ? "b" : "t");
  }
  var NORMAL = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

  /* stage: the map's stage element; opt: {
       items: [{ id, kind, place: {x, y, w?, h?} | null, sign: svg string, dead, sel, unit (draw its control valve) }],
       pipes: [{ a, b, rel, q (flow a > b, < 0 the other way, 0 none), label, dir: true when it has flow }],
       label(id) -> [Node] (title and figure lines), pipeLabels: "all" | "chosen" | "off", flowOn, el (Hub.el) }
     returns { w, h, box: { id: {x, y, w, h} } } */
  function draw(stage, opt) {
    var el = opt.el, box = {}, maxX = 0, maxY = 0, unplaced = [];
    opt.items.forEach(function (it) {
      if (!it.place) { unplaced.push(it); return; }
      var s = sizeOf(it.kind, it.place);
      var bar = isBar(it.kind, s[0], s[1]);
      box[it.id] = { x: it.place.x, y: it.place.y, w: s[0], h: s[1], kind: it.kind, sized: !!it.place.w, bar: bar, bus: bar && it.kind === "panel" };
      maxX = Math.max(maxX, it.place.x + s[0]); maxY = Math.max(maxY, it.place.y + s[1]);
    });
    // not placed yet: a row under the drawing
    var tx = 30, ty = maxY + 110, rowH = 0;
    if (unplaced.length) {
      unplaced.forEach(function (it) {
        var s = sizeOf(it.kind, null);
        if (tx + s[0] > Math.max(maxX, 900)) { tx = 30; ty += rowH + 90; rowH = 0; }
        box[it.id] = { x: tx, y: ty, w: s[0], h: s[1], tray: true, kind: it.kind };
        tx += s[0] + 110; rowH = Math.max(rowH, s[1]);
        maxX = Math.max(maxX, box[it.id].x + s[0]); maxY = Math.max(maxY, ty + s[1]);
      });
    }
    var svg = svgEl("svg", { "class": "sx-svg" });
    stage.appendChild(svg);
    var gPipes = svgEl("g", {}), gNodes = svgEl("g", {});
    svg.appendChild(gPipes); svg.appendChild(gNodes);
    if (unplaced.length) {
      var t = el("div", { "class": "sx-tray", text: "Not placed yet" + (opt.edit ? ": drag each one where it belongs" : " (Edit, then drag them into place)") });
      t.style.left = "30px"; t.style.top = (box[unplaced[0].id].y - 70) + "px"; stage.appendChild(t);
    }

    // sides: for every pipe the pair of sides (facing the other end across or up and down) whose square-cornered route
    // passes through the fewest other symbols, then the shortest; its ends are then spread along those sides
    var ids = Object.keys(box);
    function route(A, sa, B, sb, stA, stB) {
      var na = NORMAL[sa], nb = NORMAL[sb], A1 = { x: A.x + na[0] * stA, y: A.y + na[1] * stA }, B1 = { x: B.x + nb[0] * stB, y: B.y + nb[1] * stB };
      var ha = na[0] !== 0, hb = nb[0] !== 0;
      if (ha && hb) { var mx = (A1.x + B1.x) / 2; return [A, A1, { x: mx, y: A1.y }, { x: mx, y: B1.y }, B1, B]; }
      if (!ha && !hb) { var my = (A1.y + B1.y) / 2; return [A, A1, { x: A1.x, y: my }, { x: B1.x, y: my }, B1, B]; }
      if (ha) return [A, A1, { x: B1.x, y: A1.y }, B1, B];
      return [A, A1, { x: A1.x, y: B1.y }, B1, B];
    }
    // the point of a side nearest to the other end (kept off the corners): where a pipe to it would most likely leave
    function mid(b, side, o) {
      var cl = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }, mx = b.bus ? 8 : b.w * 0.2, my = b.h * 0.2;
      var x = cl(o.x, b.x + mx, b.x + b.w - mx), y = cl(o.y, b.y + my, b.y + b.h - my);
      return side === "t" ? { x: x, y: b.y } : side === "b" ? { x: x, y: b.y + b.h } : side === "l" ? { x: b.x, y: y } : { x: b.x + b.w, y: y };
    }
    function hits(pts, skipA, skipB) {
      var n = 0;
      for (var i = 1; i < pts.length; i++) {
        var p0 = pts[i - 1], p1 = pts[i], x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x), y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
        ids.forEach(function (id) {
          if (id === skipA || id === skipB) return;
          var b = box[id];
          if (b.kind === "header" || b.kind === "pipe" || b.bar) return;          // a pipe may pass behind a header, a busbar or a junction
          if (x1 > b.x - 3 && x0 < b.x + b.w + 3 && y1 > b.y - 3 && y0 < b.y + b.h + 3) n++;
        });
      }
      return n;
    }
    function length(pts) { var t = 0; for (var i = 1; i < pts.length; i++) t += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y); return t; }
    function stub(b) { return b.w <= 20 ? 0 : 14; }
    // schematic habit: a coil unit is piped from its sides, a chiller and a tower from above and below
    var HABIT = opt.habit || { ahu: "lr", fcu: "lr", chiller: "tb", tower: "tb" };
    function habit(b, side) { var h = HABIT[b.kind]; return h && h.indexOf(side) < 0 ? 400 : 0; }
    var ends = {}, used = {};
    opt.pipes.forEach(function (p, i) {
      var A = box[p.a], B = box[p.b]; if (!A || !B) return;
      var ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
      var sA = [cb.x >= ca.x ? "r" : "l", cb.y >= ca.y ? "b" : "t"], sB = [ca.x >= cb.x ? "r" : "l", ca.y >= cb.y ? "b" : "t"], best = null;
      // a side facing straight at the other symbol first (a header right under a tower is reached from below)
      var pref = [sideOf(A, cb), sideOf(B, ca)];
      sA.forEach(function (sa) {
        sB.forEach(function (sb) {
          var pts = route(mid(A, sa, cb), sa, mid(B, sb, ca), sb, stub(A), stub(B)), score = hits(pts, p.a, p.b) * 10000 + length(pts) + (sa === pref[0] ? 0 : 30) + (sb === pref[1] ? 0 : 30) + habit(A, sa) + habit(B, sb);
          if (!best || score < best.score) best = { score: score, sa: sa, sb: sb };
        });
      });
      p._sa = best.sa; p._sb = best.sb;
      (ends[p.a + p._sa] = ends[p.a + p._sa] || []).push({ p: i, end: "a", o: cb });
      (ends[p.b + p._sb] = ends[p.b + p._sb] || []).push({ p: i, end: "b", o: ca });
      if (!p.minor) used[p.a + p._sa] = used[p.b + p._sb] = 1;             // a thin control wire may cross a name
    });
    Object.keys(ends).forEach(function (k) {
      var list = ends[k], first = opt.pipes[list[0].p], id = list[0].end === "a" ? first.a : first.b, side = list[0].end === "a" ? first._sa : first._sb, b = box[id];
      var vert = side === "t" || side === "b";
      list.sort(function (u, v) { return vert ? u.o.x - v.o.x : u.o.y - v.o.y; });
      var len = vert ? b.w : b.h, small = len <= 20, m = Math.min(len * 0.18, 24);
      list.forEach(function (e, i) {
        var f = small || list.length === 1 ? len / 2 : m + (len - 2 * m) * i / (list.length - 1);
        // a busbar: each wire drops straight from it to what it feeds (in the bar's length), as a single-line diagram
        // (bar to bar: both at the middle of the shorter one)
        if (b.bus && vert) {
          var pe = opt.pipes[e.p], ob = box[e.end === "a" ? pe.b : pe.a], tx = ob && ob.bus ? (ob.w <= b.w ? ob.x + ob.w / 2 : b.x + b.w / 2) : e.o.x;
          f = Math.max(8, Math.min(len - 8, tx - b.x + (list.filter(function (u, j) { return j < i && Math.abs(u.o.x - e.o.x) < 6; }).length * 10)));
        }
        var pt = side === "t" ? { x: b.x + f, y: b.y } : side === "b" ? { x: b.x + f, y: b.y + b.h } : side === "l" ? { x: b.x, y: b.y + f } : { x: b.x + b.w, y: b.y + f };
        if (small) pt = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        opt.pipes[e.p][e.end === "a" ? "_pa" : "_pb"] = pt;
      });
    });
    // routes: out of each port a little, then square corners
    var chips = [];
    opt.pipes.forEach(function (p) {
      if (!p._pa || !p._pb) return;
      var na = NORMAL[p._sa], nb = NORMAL[p._sb], pts = route(p._pa, p._sa, p._pb, p._sb, stub(box[p.a]), stub(box[p.b]));
      var A1 = pts[1], B1 = pts[pts.length - 2];
      var d = "M" + pts.map(function (q) { return Math.round(q.x * 10) / 10 + " " + Math.round(q.y * 10) / 10; }).join("L");
      var path = svgEl("path", { d: d, "class": "sxp x-" + p.rel + (p.minor ? " minor" : "") + (p.shed ? " shed" : p.lim ? " lim" : p.warm ? " warm" : p.q || p.live ? "" : " off") });
      gPipes.appendChild(path);
      // the longest straight piece carries the arrow and the words
      var best = 0, mid = null, ang = 0;
      for (var i = 1; i < pts.length; i++) {
        var L = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
        if (L > best) { best = L; mid = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 }; ang = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) * 180 / Math.PI; }
      }
      if (p.pulse && opt.flowOn) gPipes.appendChild(svgEl("path", { d: d, "class": "mpx-pulse" + (p.pulse < 0 ? " rev" : "") }));
      if (p.q) {
        if (opt.flowOn) { var dots = svgEl("path", { d: d, "class": "mpx-flow" + (p.q < 0 ? " rev" : "") }); dots.style.animationDuration = p.speed + "s"; gPipes.appendChild(dots); }
        if (mid && best > 40) gPipes.appendChild(svgEl("path", { d: "M-6 -5 L5 0 L-6 5 z", "class": "sxa x-" + p.rel, transform: "translate(" + mid.x + " " + mid.y + ") rotate(" + (ang + (p.q < 0 ? 180 : 0)) + ")" }));
      }
      if (p.label && mid && (!p.minor || p.chosen || opt.pipeLabels === "all")) chips.push({ x: mid.x, y: mid.y, horiz: Math.abs(ang) < 45 || Math.abs(ang) > 135, p: p });
      // a unit's 2-way control valve, on its return
      if (p.valveAt) {
        var vp = p.valveAt === "a" ? A1 : B1, vn = p.valveAt === "a" ? na : nb, vx = vp.x + vn[0] * 6, vy = vp.y + vn[1] * 6;
        var rot = vn[0] !== 0 ? 0 : 90;
        gPipes.appendChild(svgEl("path", { d: "M-8 -5v10l8-5zM8 -5v10l-8-5z", "class": "sxv", transform: "translate(" + vx + " " + vy + ") rotate(" + rot + ")" }));
      }
    });
    // symbols, then their names and figures
    var labels = [];
    // headers first: long and fixed, their names go above them; the rest find room around them
    opt.items.slice().sort(function (u, v) { return (u.kind === "header" ? 0 : 1) - (v.kind === "header" ? 0 : 1); }).forEach(function (it) {
      var b = box[it.id]; if (!b) return;
      var g = svgEl("g", { "class": "sxn" + (it.dead ? " dead" : "") + (it.sel ? " sel" : "") + (b.tray ? " tray" : "") + (it.outside ? " out" : "") + (it.warn ? " warn" : ""), "data-node": it.id, "data-sx": "1", tabindex: "0",
        transform: "translate(" + b.x + " " + b.y + ")", role: "treeitem", "aria-label": it.title });
      g.appendChild(svgEl("rect", { "class": "sx-hit", x: -6, y: -6, width: b.w + 12, height: b.h + 12, rx: 8 }));
      var inner = svgEl("g", {}); inner.innerHTML = art(it.kind, b.w, b.h, it.sign);
      g.appendChild(inner);
      gNodes.appendChild(g);
      // the name and figures beside the symbol: on the side that no pipe uses and that covers the fewest other symbols
      // and names (in the order below, right, left, above; a horizontal header above, then below)
      var lab = el("div", { "class": "sx-label" + (it.dead ? " dead" : "") + (it.sel ? " sel" : "") + (it.warn ? " warn" : ""), "data-node": it.id }, opt.label(it.id));
      lab.style.left = "0px"; lab.style.top = "0px"; lab.style.visibility = "hidden";
      stage.appendChild(lab);
      var lw = lab.offsetWidth, lh = lab.offsetHeight, hdr = b.bar && b.w >= b.h;
      var order = hdr ? ["t", "b"] : ["b", "r", "l", "t"], pick = null;
      order.forEach(function (sd, oi) {
        var r = sd === "b" ? { x: b.x + b.w / 2 - lw / 2, y: b.y + b.h + 6 } : sd === "t" ? { x: hdr ? b.x : b.x + b.w / 2 - lw / 2, y: b.y - 6 - lh }
          : sd === "r" ? { x: b.x + b.w + 8, y: b.y + b.h / 2 - lh / 2 } : { x: b.x - 8 - lw, y: b.y + b.h / 2 - lh / 2 };
        r.w = lw; r.h = lh;
        var cost = (used[it.id + sd] ? 1e7 : 0) + oi * 50 + (r.x < 0 || r.y < 0 ? 1e6 : 0);
        var over = function (q) { var ox = Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x), oy = Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y); return ox > 0 && oy > 0 ? ox * oy : 0; };
        ids.forEach(function (k) { if (k !== it.id) cost += over(box[k]) * 4; });
        labels.forEach(function (q) { cost += over(q) * 3; });
        if (!pick || cost < pick.cost) pick = { cost: cost, r: r, sd: sd };
      });
      labels.push(pick.r);
      lab.classList.add("at-" + pick.sd);
      lab.style.left = pick.r.x + "px"; lab.style.top = pick.r.y + "px"; lab.style.visibility = "";
      maxX = Math.max(maxX, pick.r.x + lw + 20); maxY = Math.max(maxY, pick.r.y + lh + 20);
      maxX = Math.max(maxX, b.x + b.w + 20);
      maxY = Math.max(maxY, b.y + b.h + 20);
    });
    // the pipes' words, stepped so they do not sit on each other
    var placed = [];
    chips.forEach(function (c) {
      if (opt.pipeLabels === "off" || (opt.pipeLabels === "chosen" && !c.p.chosen)) return;
      var y = c.y, x = c.x;
      for (var k = 0; k < 10 && placed.some(function (q) { return Math.abs(q.y - y) < 18 && Math.abs(q.x - x) < 130; }); k++) { if (c.horiz) y += 18; else x += 24; }
      placed.push({ x: x, y: y });
      var chip = el("button", { type: "button", "class": "mp-xl sx-chip x-" + c.p.rel, title: c.p.title || c.p.label, text: c.p.label, onclick: c.p.go });
      chip.style.left = x + "px"; chip.style.top = y + "px";
      stage.appendChild(chip);
    });
    var W = maxX + 60, H = maxY + 40;
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    return { w: W, h: H, box: box };
  }

  /* A single-line diagram for the branches that have no place (wiring maps): items [{ id, kind, place }], edges
     [{ a, b, power }], rank(id) = how far from a source (lower first; sources 0). The power wires make a tree from the
     sources down, one row per step, each branch centred over what it feeds; a board (panel) with branches under it is a
     busbar across them. A source whose chain only joins a board already drawn (the standby generator to its incomer, to
     the main switchboard) stands beside that board's own incoming chain. Branches with only control wires (the BMS) get a
     row at the bottom, wide enough for their wires. Sets it.place = { x, y[, w, h] } on the items without one. */
  function layout(items, edges, rank) {
    var by = {}, padj = {}, cdeg = {}, cadj = {};
    items.forEach(function (it) { by[it.id] = it; padj[it.id] = []; cdeg[it.id] = 0; cadj[it.id] = []; });
    edges.forEach(function (e) {
      if (!by[e.a] || !by[e.b] || e.a === e.b) return;
      if (e.power) { if (padj[e.a].indexOf(e.b) < 0) { padj[e.a].push(e.b); padj[e.b].push(e.a); } }
      else { cdeg[e.a]++; cdeg[e.b]++; cadj[e.a].push(e.b); cadj[e.b].push(e.a); }
    });
    var ids = items.map(function (it) { return it.id; }), order = {};
    ids.forEach(function (id, i) { order[id] = i; });
    var start = ids.filter(function (id) { return padj[id].length; }).sort(function (a, b) { return (rank(a) - rank(b)) || (order[a] - order[b]); });
    var seen = {}, kids = {}, depth = {}, parent = {}, roots = [];
    start.forEach(function (r) {
      if (seen[r]) return;
      seen[r] = 1; depth[r] = 0; roots.push(r);
      var q = [r];
      // down only: never from a branch to one nearer a source (the generator's incomer is not fed by the switchboard)
      while (q.length) { var a = q.shift(); kids[a] = []; padj[a].forEach(function (b) { if (seen[b] || rank(b) < rank(a)) return; seen[b] = 1; parent[b] = a; depth[b] = depth[a] + 1; kids[a].push(b); q.push(b); }); }
    });
    // satellites: a whole tree that is one chain, whose last branch feeds a branch of a tree drawn before it
    var tree = {}, sat = {};
    roots.forEach(function (r) { (function m(id) { tree[id] = r; kids[id].forEach(m); })(r); });
    roots.forEach(function (r, ri) {
      if (!ri) return;
      var leaf = r; while (kids[leaf].length === 1) leaf = kids[leaf][0];
      if (kids[leaf].length) return;
      var into = padj[leaf].filter(function (b) { return tree[b] !== r && roots.indexOf(tree[b]) < ri; })[0];
      if (into) sat[r] = { leaf: leaf, into: into };
    });
    var bar = function (id) { return by[id].kind === "panel" && kids[id] && kids[id].length > 0; };
    var size = function (id) { return sizeOf(by[id].kind, null); };
    var slot = {}, cx = {};
    function slotOf(id) {
      var own = bar(id) ? 180 : Math.max(size(id)[0], 150) + 50, sum = 0;
      kids[id].forEach(function (k) { sum += slotOf(k); });
      return (slot[id] = Math.max(own, sum));
    }
    function placeX(id, x0) {
      var ks = kids[id];
      if (!ks.length) { cx[id] = x0 + slot[id] / 2; return; }
      var sum = 0; ks.forEach(function (k) { sum += slot[k]; });
      var x = x0 + (slot[id] - sum) / 2;
      ks.forEach(function (k) { placeX(k, x); x += slot[k]; });
      cx[id] = (cx[ks[0]] + cx[ks[ks.length - 1]]) / 2;
    }
    var x0 = 30;
    roots.forEach(function (r) { if (sat[r]) return; slotOf(r); placeX(r, x0); x0 += slot[r]; });
    var satAt = {};
    roots.forEach(function (r) {
      if (!sat[r]) return;
      var s = sat[r], chain = [], id = r; while (true) { chain.push(id); if (!kids[id].length) break; id = kids[id][0]; }
      var shift = depth[s.into] - 1 - depth[s.leaf];
      satAt[s.into] = (satAt[s.into] || 0) + 1;
      chain.forEach(function (c) { depth[c] += shift; cx[c] = cx[s.into] + 200 * satAt[s.into]; x0 = Math.max(x0, cx[c] + 120); });
      if (depth[r] < 0) { var up = -depth[r]; Object.keys(depth).forEach(function (k) { depth[k] += up; }); }
    });
    // rows: each as high as its tallest symbol, with room for the names under them
    var rowH = [], rowTop = [];
    Object.keys(depth).forEach(function (id) { var h = bar(id) ? 20 : size(id)[1]; rowH[depth[id]] = Math.max(rowH[depth[id]] || 0, h); });
    var y = 30;
    for (var d = 0; d < rowH.length; d++) { rowTop[d] = y; y += (rowH[d] || 0) + 110; }
    Object.keys(depth).forEach(function (id) {
      var it = by[id]; if (it.place) return;
      var top = rowTop[depth[id]], rh = rowH[depth[id]];
      if (bar(id)) {
        var ks = kids[id], a = cx[ks[0]], b = cx[ks[ks.length - 1]], w = Math.max(140, b - a + 80);
        it.place = { x: Math.round((a + b) / 2 - w / 2), y: Math.round(top + (rh - 12) / 2), w: Math.round(w), h: 12 };
        return;
      }
      var s = size(id);
      it.place = { x: Math.round(cx[id] - s[0] / 2), y: Math.round(top + (rh - s[1]) / 2) };
    });
    // the rest (control wires only, or none): a row at the bottom, centred under the drawing
    var rest = ids.filter(function (id) { return depth[id] == null && !by[id].place; });
    // in the order of what they are wired to (fewest crossings): the mean place of their neighbours above, twice over
    var at = {};
    for (var pass = 0; pass < 2; pass++) rest.forEach(function (id) {
      var xs = cadj[id].map(function (o) { return cx[o] != null ? cx[o] : at[o]; }).filter(function (v) { return v != null; });
      at[id] = xs.length ? xs.reduce(function (t, v) { return t + v; }, 0) / xs.length : null;
    });
    rest.sort(function (a, b) { return (at[a] == null ? 1e9 : at[a]) - (at[b] == null ? 1e9 : at[b]) || order[a] - order[b]; });
    if (rest.length) {
      var ws = rest.map(function (id) { var s = size(id); return Math.max(s[0], Math.min(320, 22 * cdeg[id])); });
      var total = ws.reduce(function (t, w) { return t + w + 140; }, -140), x = Math.max(30, 30 + (x0 - 30) / 2 - total / 2);
      rest.forEach(function (id, i) {
        var s = size(id), w = ws[i];
        by[id].place = w > s[0] ? { x: Math.round(x), y: y + 10, w: Math.round(w), h: s[1] } : { x: Math.round(x), y: y + 10 };
        x += w + 140;
      });
    }
  }
  root.MPSchematic = { draw: draw, sizeOf: sizeOf, layout: layout };
})(typeof window !== "undefined" ? window : this);
