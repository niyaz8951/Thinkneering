/* ============================================================
   Thinkneering Tools - Maps: the Flow view of a water or electrical map (owner, 23 Oct 2026: "imagine you are a drop
   of water or an electron: every place you stop on the way to the last component should be in the map, always going
   forward ... and some incredible way to show the loop closing"; "the 2D layout must not be disturbed").
   Pure layout (no page): maps.js gives the equipment and the pipes or wires the 2D view uses, oriented the way the
   water or current goes, and draws what this returns; scripts/mp-flow-check.mjs checks it.

   - Columns are steps of the journey, left to right: every flow line goes forward to a later column.
   - A loop (water) is cut where it begins again: a line into a source (back into the chiller, back to the cooling
     tower) ends at the source's mirror, a "↺" stop after the last step, and maps.js joins the mirror to the source by
     a ribbon round the lane: the loop closes in one stroke, with what the source does to the water written on it.
     Any other loop someone draws is cut the same way, at the branch it comes back to.
   - Lanes (rows): one per circuit (condenser water above chilled water) or Power, then Controls; a branch on two
     circuits (a chiller) sits in the lane of the circuit it is the source of, so the condenser water dips down to it.
   - A branch with nothing coming in (an expansion tank, a standby generator) stands one step before what it joins;
     a branch with only control lines (the BMS) one step before the first branch it commands, in the Controls lane.
   - In each column the branches are ordered to cross as little as possible (median sweeps), each column centred in
     its lane.
   ============================================================ */
(function (root) {
  "use strict";
  var GAP_X = 96, GAP_Y = 16, LANE_GAP = 70, TOP = 40, LEFT = 40;

  /* nodes: [{ id, lane, source: { circuit: true }, w, h }], edges: [{ a, b, minor, circuit }] (a -> b the way it flows),
     lanes: lane ids top to bottom; a line closes a loop when it goes into the source of its own circuit.
     returns { pos: { id: {x, y, w, h, layer, lane} }, mirrors: [{ id, of, x, y, w, h, layer, lane }], edges: [{ a, b, minor, to }] (to = the
     mirror id when the line closes a loop), lanes: [{ id, y, h }], w, h } */
  function layout(nodes, edges, lanes, mirrorSize) {
    var by = {}, ids = [];
    nodes.forEach(function (n) { by[n.id] = n; ids.push(n.id); });
    var main = edges.filter(function (e) { return !e.minor && by[e.a] && by[e.b] && e.a !== e.b; });
    var minor = edges.filter(function (e) { return e.minor && by[e.a] && by[e.b] && e.a !== e.b; });
    // cut the loops: a line into a source goes to its mirror; then any cycle left is cut where it comes back
    var mir = {}, out = [];
    function mirrorOf(id) { if (!mir[id]) mir[id] = { id: id + "~loop", of: id, lane: by[id].lane }; return mir[id].id; }
    var srcOf = function (id, c) { var s = by[id].source; return !!(s && s[c]); };
    main.forEach(function (e) { out.push({ a: e.a, b: e.b, minor: false, to: srcOf(e.b, e.circuit) ? mirrorOf(e.b) : null, src: e }); });
    var succ = {}, color = {};
    function rebuild() { succ = {}; out.forEach(function (e) { if (e.to) return; (succ[e.a] = succ[e.a] || []).push(e); }); }
    rebuild();
    var starts = ids.filter(function (id) { return by[id].source && Object.keys(by[id].source).length; }).concat(ids);
    function dfs(u) {
      color[u] = 1;
      (succ[u] || []).forEach(function (e) {
        if (color[e.b] === 1) e.to = mirrorOf(e.b);                       // back to a branch on the way: cut here
        else if (!color[e.b]) dfs(e.b);
      });
      color[u] = 2;
    }
    starts.forEach(function (id) { if (!color[id]) dfs(id); });
    rebuild();
    // steps: the longest way from where nothing comes in (Kahn), mirrors one step after what reaches them
    var indeg = {}, pred = {}, layer = {};
    ids.forEach(function (id) { indeg[id] = 0; pred[id] = []; });
    out.forEach(function (e) { if (!e.to) { indeg[e.b]++; pred[e.b].push(e.a); } });
    var q = ids.filter(function (id) { return !indeg[id] && (succ[id] || out.some(function (e) { return e.a === id; })); }), seq = [];
    q.forEach(function (id) { layer[id] = 0; });
    while (q.length) {
      var u = q.shift(); seq.push(u);
      (succ[u] || []).forEach(function (e) { layer[e.b] = Math.max(layer[e.b] || 0, layer[u] + 1); if (--indeg[e.b] === 0) q.push(e.b); });
    }
    // nothing coming in: one step before what it joins (sources whose chain feeds a later step move up too)
    for (var i = seq.length - 1; i >= 0; i--) {
      var id = seq[i];
      if (pred[id].length) continue;
      var s = (succ[id] || []).map(function (e) { return layer[e.b]; });
      if (s.length) layer[id] = Math.max(layer[id] || 0, Math.min.apply(null, s) - 1);
    }
    // a chain into a later step moves up with it (the generator beside the transformer, its incomer beside the main incomer)
    for (var pass = 0; pass < 3; pass++) for (var j = seq.length - 1; j >= 0; j--) {
      var v = seq[j], sl = (succ[v] || []).map(function (e) { return layer[e.b]; });
      if (sl.length && pred[v].every(function (p) { return (succ[p] || []).length === 1; })) {
        var want = Math.min.apply(null, sl) - 1;
        if (want > layer[v] && pred[v].every(function (p) { return layer[p] < want; })) layer[v] = want;
      }
    }
    // control-only branches: one step before the first branch they command
    ids.forEach(function (id) {
      if (layer[id] != null) return;
      var nb = minor.filter(function (e) { return e.a === id || e.b === id; }).map(function (e) { return layer[e.a === id ? e.b : e.a]; }).filter(function (x) { return x != null; });
      if (nb.length) layer[id] = Math.max(0, Math.min.apply(null, nb) - 1);
    });
    var mirrors = Object.keys(mir).map(function (k) { return mir[k]; });
    mirrors.forEach(function (m) {
      var into = out.filter(function (e) { return e.to === m.id; }).map(function (e) { return layer[e.a]; }).filter(function (x) { return x != null; });
      m.layer = (into.length ? Math.max.apply(null, into) : 0) + 1;
    });
    // columns: each with its lanes; ordered by the median of the branches before them, then after them
    var nL = 0, cols = [];
    ids.forEach(function (id) { if (layer[id] != null) nL = Math.max(nL, layer[id] + 1); });
    mirrors.forEach(function (m) { nL = Math.max(nL, m.layer + 1); });
    for (var c = 0; c < nL; c++) cols.push([]);
    var info = {}, order = {};
    ids.forEach(function (id, k) { if (layer[id] == null) return; info[id] = { id: id, lane: by[id].lane, w: by[id].w, h: by[id].h, layer: layer[id] }; cols[layer[id]].push(id); order[id] = k; });
    mirrors.forEach(function (m, k) { info[m.id] = { id: m.id, lane: m.lane, w: mirrorSize[0], h: mirrorSize[1], layer: m.layer, mirror: true }; cols[m.layer].push(m.id); order[m.id] = ids.length + k; });
    var nbrUp = {}, nbrDown = {};
    out.forEach(function (e) {
      var b = e.to || e.b; if (!info[e.a] || !info[b]) return;
      (nbrDown[e.a] = nbrDown[e.a] || []).push(b); (nbrUp[b] = nbrUp[b] || []).push(e.a);
    });
    // (a control-only branch is ordered by what it commands; control lines never move the branches on the flow)
    minor.forEach(function (e) {
      if (!info[e.a] || !info[e.b]) return;
      if (!nbrUp[e.a] && !nbrDown[e.a]) (nbrDown[e.a + "#c"] = nbrDown[e.a + "#c"] || []).push(e.b);
    });
    Object.keys(nbrDown).forEach(function (k) { if (/#c$/.test(k)) { var id = k.slice(0, -2); nbrUp[id] = (nbrUp[id] || []).concat(nbrDown[k]); delete nbrDown[k]; } });
    var laneIx = {}; lanes.forEach(function (l, k) { laneIx[l] = k; });
    var rank = {};
    function setRank() { cols.forEach(function (col) { col.forEach(function (id, k) { rank[id] = k; }); }); }
    function median(list) { if (!list || !list.length) return null; var v = list.map(function (x) { return rank[x]; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; }); if (!v.length) return null; var m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
    function sortCol(col, nb) {
      var key = {}; col.forEach(function (id) { var m = median(nb[id]); key[id] = m == null ? rank[id] : m; });
      col.sort(function (a, b) { return (laneIx[info[a].lane] - laneIx[info[b].lane]) || (key[a] - key[b]) || (order[a] - order[b]); });
    }
    cols.forEach(function (col) { col.sort(function (a, b) { return (laneIx[info[a].lane] - laneIx[info[b].lane]) || (order[a] - order[b]); }); });
    setRank();
    // (ending on a sweep by what comes before: a branch stays with the others its board or pipe feeds)
    for (var sweep = 0; sweep < 4; sweep++) {
      for (var d = 1; d < nL; d++) { sortCol(cols[d], nbrUp); setRank(); }
      for (var u2 = nL - 2; u2 >= 0; u2--) { sortCol(cols[u2], nbrDown); setRank(); }
    }
    for (var d2 = 1; d2 < nL; d2++) { sortCol(cols[d2], nbrUp); setRank(); }
    // sizes: column widths; lane heights (the tallest stack of that lane in any column)
    var colW = cols.map(function (col) { return col.reduce(function (m, id) { return Math.max(m, info[id].w); }, 0); });
    var laneH = {}; lanes.forEach(function (l) { laneH[l] = 0; });
    cols.forEach(function (col) {
      var hs = {}; col.forEach(function (id) { var l = info[id].lane; hs[l] = (hs[l] || 0) + info[id].h + (hs[l] ? GAP_Y : 0); });
      Object.keys(hs).forEach(function (l) { laneH[l] = Math.max(laneH[l] || 0, hs[l]); });
    });
    var laneBox = [], y = TOP;
    lanes.forEach(function (l) { if (!laneH[l]) return; laneBox.push({ id: l, y: y, h: laneH[l] }); y += laneH[l] + LANE_GAP; });
    var laneAt = {}; laneBox.forEach(function (b) { laneAt[b.id] = b; });
    var x = LEFT, colX = [];
    colW.forEach(function (w) { colX.push(x); x += w + GAP_X; });
    cols.forEach(function (col, k) {
      var groups = {};
      col.forEach(function (id) { (groups[info[id].lane] = groups[info[id].lane] || []).push(id); });
      Object.keys(groups).forEach(function (l) {
        var g = groups[l], tot = g.reduce(function (t, id, i) { return t + info[id].h + (i ? GAP_Y : 0); }, 0), b = laneAt[l], yy = b.y + (b.h - tot) / 2;
        g.forEach(function (id) { var n = info[id]; n.x = colX[k]; n.y = Math.round(yy); yy += n.h + GAP_Y; });
      });
    });
    var pos = {}; Object.keys(info).forEach(function (id) { if (!info[id].mirror) pos[id] = info[id]; });
    mirrors.forEach(function (m) { var n = info[m.id]; m.x = n.x; m.y = n.y; m.w = n.w; m.h = n.h; });
    return { pos: pos, mirrors: mirrors, edges: out.map(function (e) { return { a: e.a, b: e.b, to: e.to, src: e.src }; }).concat(minor.map(function (e) { return { a: e.a, b: e.b, minor: true, src: e }; })),
      lanes: laneBox, w: x - GAP_X + LEFT, h: y - LANE_GAP + TOP, layers: nL };
  }
  root.MPFlow = { layout: layout, GAP_X: GAP_X };
})(typeof window !== "undefined" ? window : this);
