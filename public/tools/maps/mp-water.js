/* ============================================================
   Thinkneering Tools - Maps: water in a piping map (23 Oct 2026).
   Pure calculation, no page: maps.js draws what this returns, scripts/mp-water-check.mjs checks it against the worked
   example (the Chilled water template) as part of `npm test`.

   What people type (special notes of the branches):
     Source: chiller       water starts here          Leaving: 6.7 °C     temperature leaving the branch (a source: its set point)
     Flow: 12 l/s          a unit's water flow        Load: 290 kW        instead of Leaving: the unit's load (kW, TR, Btu/h)
     Design flow: 30 l/s   a source's design flow     Valve: closed / Pump: standby / Status: off   passes no water
   Pipes are links of kind p-supply (away from the sources) and p-return (back to them); either end may hold the link.

   What it works out:
   - which sources and units have water: a source runs when it is not shut and reaches a unit with a flow both ways
     (through branches that are not shut); a unit has water when a running source reaches it both ways;
   - the flow in every pipe: each unit's flow goes towards the sources, by the shortest way; where it can go to several
     sources (a header fed by three chillers) it is shared in proportion to the sources' design flows (equally when a
     running source has none);
   - temperatures: the supply mixes the sources' leaving temperatures by flow; a unit leaves at its Leaving (or at
     entering + load / (4.19 × flow)); the return mixes what comes back by flow;
   - loads: 4.19 kW per l/s per K (water at about 10 °C: ρ ≈ 1000 kg/m³, cp ≈ 4.19 kJ/kg·K) × flow × (leaving − entering).
   ============================================================ */
(function (root) {
  "use strict";
  var CP = 4.19, TR = 3.517, SUP = "p-supply", RET = "p-return";

  function note(n, name) {
    var re = new RegExp("^\\s*" + name + "\\s*:\\s*(.+)$", "i"), sp = n.special || [];
    for (var i = 0; i < sp.length; i++) { var m = re.exec(sp[i]); if (m) return m[1].trim(); }
    return "";
  }
  // the first number of a text: "1,207" is a thousand and more, "12,5" twelve and a half
  function num(s) {
    var m = /-?\d+(?:[.,]\d+)?/.exec(String(s || "").replace(/(\d),(\d{3})(?!\d)/g, "$1$2"));
    return m ? parseFloat(m[0].replace(",", ".")) : NaN;
  }
  // a flow in l/s; m³/h and US gpm are converted
  function flowOf(s) {
    if (!s) return null;
    var v = num(s); if (!(v >= 0)) return null;
    if (/m\s*(3|³)\s*\/\s*h|m3h|cmh/i.test(s)) return { v: v / 3.6, unit: "m3h" };
    if (/gpm|gal/i.test(s)) return { v: v * 0.0630902, unit: "gpm" };
    return { v: v, unit: "lps" };
  }
  // a temperature in °C; °F is converted
  function tempOf(s) {
    if (!s) return null;
    var v = num(s); if (isNaN(v)) return null;
    if (/(?:°|º|deg\s*|\d\s*)F\b/i.test(s)) return { v: (v - 32) / 1.8, unit: "F" };
    return { v: v, unit: "C" };
  }
  // a load in kW; TR, Btu/h and MW are converted
  function loadOf(s) {
    if (!s) return null;
    var v = num(s); if (!(v >= 0)) return null;
    if (/\bTR\b|ton/i.test(s)) return v * TR;
    if (/btu/i.test(s)) return v * 0.000293071;
    if (/\bMW\b/.test(s)) return v * 1000;
    return v;
  }
  function shutBy(n) {
    return /^clos/i.test(note(n, "valve")) || /^(standby|off|stop)/i.test(note(n, "pump")) || /^(standby|off|stop)/i.test(note(n, "status"));
  }

  /* nodes: { id: { id, title, special: [...], links: [...] } }; shutNow: { id: true (shut) | false (open, running) } overrides
     the map for a simulation. Returns null when the map has no pipes. */
  function compute(nodes, shutNow) {
    shutNow = shutNow || {};
    var sup = {}, ret = {}, any = false;
    function link(adj, a, b) { (adj[a] = adj[a] || []); (adj[b] = adj[b] || []); if (adj[a].indexOf(b) < 0) adj[a].push(b); if (adj[b].indexOf(a) < 0) adj[b].push(a); }
    Object.keys(nodes).forEach(function (id) {
      (nodes[id].links || []).forEach(function (l) {
        if (l.kind !== "node" || !nodes[l.node] || l.node === id) return;
        if (l.rel === SUP) { link(sup, id, l.node); any = true; } else if (l.rel === RET) { link(ret, id, l.node); any = true; }
      });
    });
    if (!any) return null;
    var part = {}, isSrc = {}, shut = {}, F = {}, LV = {}, LD = {}, OUT = {}, DF = {}, units = { lps: 0, m3h: 0, gpm: 0, C: 0, F: 0 };
    Object.keys(sup).concat(Object.keys(ret)).forEach(function (id) { part[id] = 1; });
    var ids = Object.keys(part);
    ids.forEach(function (id) {
      var n = nodes[id];
      if (note(n, "source")) isSrc[id] = 1;
      shut[id] = shutNow[id] != null ? !!shutNow[id] : shutBy(n);
      var f = flowOf(note(n, "flow")), d = flowOf(note(n, "design flow")), t = tempOf(note(n, "leaving"));
      if (f) { F[id] = f.v; units[f.unit]++; }
      if (d) { DF[id] = d.v; units[d.unit]++; }
      if (t) { units[t.unit]++; if (isSrc[id]) OUT[id] = t.v; else LV[id] = t.v; }
      var ld = loadOf(note(n, "load")); if (ld != null) LD[id] = ld;
    });
    var srcs = ids.filter(function (id) { return isSrc[id]; });
    var loads = ids.filter(function (id) { return !isSrc[id] && sup[id] && ret[id]; });

    // which sources run and which units have water
    function reach(adj, s) {
      var seen = {}, q = [s]; seen[s] = 1;
      while (q.length) { var a = q.shift(); (adj[a] || []).forEach(function (b) { if (seen[b] || shut[b] || isSrc[b]) return; seen[b] = 1; q.push(b); }); }
      return seen;
    }
    var active = {}, flowing = {};
    srcs.forEach(function (s) {
      if (shut[s]) return;
      var rs = reach(sup, s), rr = reach(ret, s);
      loads.forEach(function (L) { if (!shut[L] && F[L] > 0 && rs[L] && rr[L]) { active[s] = 1; flowing[L] = 1; } });
    });
    var S = srcs.filter(function (s) { return active[s]; });
    var byDesign = S.length > 0 && S.every(function (s) { return DF[s] > 0; });
    function weight(s) { return byDesign ? DF[s] : 1; }

    // the flow in a network (supply or return): from the running sources outwards, each unit's flow back by the shortest way
    function spread(adj) {
      var dist = {}, order = [], q = [], par = {}, cap = {}, acc = {}, through = {}, edge = {};
      S.forEach(function (s) { dist[s] = 0; q.push(s); });
      while (q.length) {
        var a = q.shift(); order.push(a);
        (adj[a] || []).forEach(function (b) { if (dist[b] != null || shut[b] || isSrc[b]) return; dist[b] = dist[a] + 1; q.push(b); });
      }
      order.forEach(function (b) {
        if (!dist[b]) { cap[b] = weight(b); return; }
        par[b] = (adj[b] || []).filter(function (a) { return dist[a] === dist[b] - 1; });
        cap[b] = par[b].reduce(function (t, a) { return t + cap[a]; }, 0);
      });
      for (var i = order.length - 1; i >= 0; i--) {
        var b = order[i], out = (flowing[b] ? F[b] : 0) + (acc[b] || 0);
        through[b] = out;
        if (!dist[b]) continue;
        par[b].forEach(function (p) {
          var share = cap[b] > 0 ? out * cap[p] / cap[b] : out / par[b].length;
          edge[p + ">" + b] = (edge[p + ">" + b] || 0) + share;
          acc[p] = (acc[p] || 0) + share;
        });
      }
      return { dist: dist, order: order, par: par, edge: edge, through: through };
    }
    var sp = spread(sup), rp = spread(ret);

    // supply temperatures: the sources' leaving temperatures, mixed by flow
    var TS = {};
    sp.order.forEach(function (b) {
      if (!sp.dist[b]) { if (OUT[b] != null) TS[b] = OUT[b]; return; }
      var t = 0, q = 0, tk = 0, k = 0;
      sp.par[b].forEach(function (a) { if (TS[a] == null) return; var f = sp.edge[a + ">" + b] || 0; t += f * TS[a]; q += f; tk += TS[a]; k++; });
      if (q > 0) TS[b] = t / q; else if (k) TS[b] = tk / k;
    });
    // units: entering, leaving, load
    var TIN = {}, TOUT = {}, KW = {};
    loads.forEach(function (L) {
      var tin = TS[L], f = flowing[L] ? F[L] : 0, tout = LV[L], kw;
      if (tout != null) { if (tin != null && f > 0) kw = CP * f * (tout - tin); }
      else if (LD[L] != null && tin != null && f > 0) { tout = tin + LD[L] / (CP * f); kw = LD[L]; }
      if (tin != null) TIN[L] = tin;
      if (tout != null) TOUT[L] = tout;
      if (kw != null) KW[L] = kw;
    });
    // return temperatures: what comes back, mixed by flow (units without a leaving temperature are left out, and listed)
    var TRT = {}, wq = {}, wt = {}, missing = [];
    for (var j = rp.order.length - 1; j >= 0; j--) {
      var b = rp.order[j], q0 = wq[b] || 0, t0 = wt[b] || 0;
      if (flowing[b] && F[b] > 0) { if (TOUT[b] != null) { q0 += F[b]; t0 += F[b] * TOUT[b]; } else missing.push(b); }
      if (q0 > 0) TRT[b] = t0 / q0;
      if (!rp.dist[b]) continue;
      rp.par[b].forEach(function (a) { var f = rp.edge[a + ">" + b] || 0; if (f > 0 && TRT[b] != null) { wq[a] = (wq[a] || 0) + f; wt[a] = (wt[a] || 0) + f * TRT[b]; } });
    }
    // the sources
    var src = {}, tot = { q: 0, kw: 0, kwKnown: true, tq: 0, ts: 0, rq: 0, rt: 0 };
    srcs.forEach(function (s) {
      var q = active[s] ? sp.through[s] || 0 : 0, out = OUT[s], back = active[s] ? TRT[s] : undefined, kw;
      if (q > 0 && out != null && back != null) kw = CP * q * (back - out);
      src[s] = { q: q, out: out, back: back, kw: kw, design: DF[s], pct: DF[s] > 0 ? q / DF[s] * 100 : undefined, over: DF[s] > 0 && q > DF[s] * 1.0001 };
      if (q > 0) {
        tot.q += q;
        if (kw != null) tot.kw += kw; else tot.kwKnown = false;
        if (out != null) { tot.tq += q; tot.ts += q * out; }
        if (back != null) { tot.rq += q; tot.rt += q * back; }
      }
    });
    // every pipe: the way the water goes, how much, how warm
    var dir = {}, tEdge = {};
    Object.keys(sp.edge).forEach(function (k) { var ab = k.split(">"); if (sp.edge[k] > 1e-9) { dir[k] = sp.edge[k]; if (TS[ab[0]] != null) tEdge[k] = TS[ab[0]]; } });
    Object.keys(rp.edge).forEach(function (k) {
      var ab = k.split(">"), back = ab[1] + ">" + ab[0];
      if (rp.edge[k] > 1e-9) { dir[back] = (dir[back] || 0) + rp.edge[k]; if (TRT[ab[1]] != null) tEdge[back] = TRT[ab[1]]; }
    });
    // what each branch shows
    var flow = {}, side = {};
    ids.forEach(function (id) {
      side[id] = isSrc[id] ? "source" : sup[id] && ret[id] ? "unit" : sup[id] ? "supply" : "return";
      var v = isSrc[id] ? (src[id].q) : side[id] === "unit" ? (sp.through[id] != null ? sp.through[id] : 0) : side[id] === "supply" ? sp.through[id] : rp.through[id];
      flow[id] = v > 1e-9 ? v : 0;
    });
    var fu = "lps"; ["m3h", "gpm"].forEach(function (u) { if (units[u] > units[fu]) fu = u; });     // the unit most inputs use
    return {
      part: part, side: side, shut: shut, active: active, flowing: flowing, flow: flow, input: { flow: F, leaving: LV, load: LD, out: OUT, design: DF },
      tSupply: TS, tReturn: TRT, tIn: TIN, tOut: TOUT, kw: KW, source: src, dir: dir, tEdge: tEdge, missing: missing,
      total: { q: tot.q, kw: tot.kwKnown ? tot.kw : undefined, out: tot.tq > 0 ? tot.ts / tot.tq : undefined, back: tot.rq > 0 ? tot.rt / tot.rq : undefined, sources: S.length },
      unit: { flow: fu, temp: units.F > units.C ? "F" : "C" },
      byDesign: byDesign
    };
  }

  // ---------- words ----------
  function fix(v, d) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtFlow(lps, unit) {
    if (lps == null || isNaN(lps)) return "";
    if (unit === "m3h") { var m = lps * 3.6; return fix(m, m >= 1000 ? 0 : 1) + " m³/h"; }
    if (unit === "gpm") return fix(lps / 0.0630902, 0) + " gpm";
    return fix(lps, lps >= 1000 ? 0 : lps >= 1 ? 1 : 2) + " l/s";
  }
  function fmtTemp(c, unit) {
    if (c == null || isNaN(c)) return "";
    return unit === "F" ? fix(c * 1.8 + 32, 1) + " °F" : fix(c, 1) + " °C";
  }
  function fmtKw(kw) {
    if (kw == null || isNaN(kw)) return "";
    var tr = kw / TR;
    return fix(kw, Math.abs(kw) >= 100 ? 0 : 1) + " kW (" + fix(tr, Math.abs(tr) >= 100 ? 0 : 1) + " TR)";
  }
  // the flow unit as people type it, and back: for the quick inputs of a unit's card
  var FLOW_WORD = { lps: "l/s", m3h: "m³/h", gpm: "gpm" };
  function toUnit(lps, unit) { return unit === "m3h" ? lps * 3.6 : unit === "gpm" ? lps / 0.0630902 : lps; }

  root.MPWater = { compute: compute, note: note, num: num, flowOf: flowOf, tempOf: tempOf, loadOf: loadOf, shutBy: shutBy,
    fmtFlow: fmtFlow, fmtTemp: fmtTemp, fmtKw: fmtKw, FLOW_WORD: FLOW_WORD, toUnit: toUnit, CP: CP, TR: TR, SUP: SUP, RET: RET };
})(typeof window !== "undefined" ? window : this);
