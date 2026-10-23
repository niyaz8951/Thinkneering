/* ============================================================
   Thinkneering Tools - Maps: water in a piping map (23 Oct 2026; circuits and pressures the same afternoon).
   Pure calculation, no page: maps.js draws what this returns, scripts/mp-water-check.mjs checks it against the worked
   example (the Chilled water template) as part of `npm test`.

   Circuits. Pipes are links of one of two circuits, each a supply and a return kind:
     chilled water    p-supply (CHWS) / p-return (CHWR)        sources: chillers ("Source: chiller")
     condenser water  p-cw-supply (CWS) / p-cw-return (CWR)    sources: cooling towers ("Source: cooling tower")
   A branch on both pipes of a circuit that is not its source is a unit of it (AHU, FCU; a chiller's condenser is a
   unit of the condenser water). A chiller is the source of the chilled water and a unit of the condenser water: the
   heat it rejects is its cooling load × (1 + 1 / COP).

   What people type (special notes). A note names its circuit when the branch is on two ("Condenser flow" on a chiller);
   a branch on one circuit may use the plain name.
     Source: chiller | cooling tower          water of that circuit starts here
     Leaving: 6.7 °C                          temperature leaving the branch (a source: its set point; a unit: off its coil)
     Flow: 12 l/s, Condenser flow: 38 l/s     a unit's design flow (l/s, m³/h, US gpm)
     Load: 290 kW                             instead of Leaving: the unit's load (kW, TR, Btu/h)
     Design flow: 30 l/s                      a source's design flow (shares the flow, checks the source)
     COP: 5.5                                 a chiller's COP (heat rejected); 5.0 when not given, and said so
     Pressure drop: 45 kPa                    a unit: coil + control valve at its design flow; a chiller: evaporator;
                                              a pump: its strainer, check and isolating valves; a cooling tower: nozzles
     Condenser pressure drop: 55 kPa          a chiller's condenser at its condenser flow
     Static lift: 4 m                         an open cooling tower: basin water level to the spray nozzles (constant)
     Pump head: 18 m, Pump flow: 30 l/s       a pump's design point (m, kPa, bar); Speed: 90 % (affinity laws)
     Fill pressure: 2 bar                     an expansion tank: the pressure where it joins the circuit
     Height: 12 m                             a branch's height above the plant room (absolute pressures)
     Valve: closed / Pump: standby / Status: off   passes no water
     Capacity: 750 kW                         a chiller's cooling capacity (a tower's heat rejection): more than that and
                                              it cannot hold its set point, its leaving water rises (owner, 23 Oct 2026:
                                              "a max ... once the limit is reached show a warning ... to keep max in limit")
     Max flow: 40 l/s                         a header, riser or pipe run limited to that flow (a flow limiting / balancing
                                              valve): the units it feeds share it, each in proportion to its design flow
   A pipe's size (DN 150, 6 in) and length (40 m) give its friction (Darcy-Weisbach, Swamee-Jain, steel 0.045 mm,
   water at 10 °C) plus 30 % for fittings.

   What it works out, per circuit:
   - which sources run and which units have water (reached both ways through branches that are not shut);
   - the flow in every pipe: each unit's flow back to the sources by the shortest way, shared in proportion to the
     sources' design flows (equally when a running source has none);
   - temperatures: supply mixed by flow; a unit leaves at its Leaving (or entering + load / (4.19 × flow)); return mixed;
   - loads: 4.19 kW per l/s per K × flow × ΔT (water at about 10 °C); every header, riser and pipe run carries the sum of
     the loads of the units it feeds (supply) or collects from (return), shared as their water is;
   - limits: a source over its Capacity runs at it, so its leaving water = return − Capacity / (4.19 × flow) (with the
     units' Leaving given; units given by Load cannot be met and the shortfall is said); a branch over its Max flow
     passes only that, and each unit it feeds or collects from gets the same share less (flow limiting valve);
   - pressures (when every running pump has its head and flow): each pump on its curve H = n²·Hd·(1.2 − 0.2·(Q/(n·Qd))²)
     (shut-off 120 % of the design head), pressures forward from each pump's discharge to the units' inlets and back
     from its suction to the units' outlets, so a unit has (inlet − outlet) available; its 2-way control valve takes
     what it does not need; a unit with less than it needs gets Qd·√(available / needed) (worked out again until it
     settles). Where a header is fed by several branches the lower pressure is kept (on the safe side).
   ============================================================ */
(function (root) {
  "use strict";
  var CP = 4.19, TR = 3.517, G = 9.807, NU = 1.307e-6, ROUGH = 0.045e-3, FITTINGS = 0.3, LOW = 30;
  var CIRCUITS = [
    { id: "chw", name: "Chilled water", short: "CHW", sup: "p-supply", ret: "p-return", flow: "flow", dp: "pressure drop", leaving: "leaving" },
    { id: "cw", name: "Condenser water", short: "CW", sup: "p-cw-supply", ret: "p-cw-return", flow: "condenser flow", dp: "condenser pressure drop", leaving: "condenser leaving" }
  ];
  var COND = /tower|cooler|condenser|heat rejection|\bcw\b/i;

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
  function flowOf(s) {                          // l/s; m³/h and US gpm converted
    if (!s) return null;
    var v = num(s); if (!(v >= 0)) return null;
    if (/m\s*(3|³)\s*\/\s*h|m3h|cmh/i.test(s)) return { v: v / 3.6, unit: "m3h" };
    if (/gpm|gal/i.test(s)) return { v: v * 0.0630902, unit: "gpm" };
    return { v: v, unit: "lps" };
  }
  function tempOf(s) {                          // °C; °F converted
    if (!s) return null;
    var v = num(s); if (isNaN(v)) return null;
    if (/(?:°|º|deg\s*|\d\s*)F\b/i.test(s)) return { v: (v - 32) / 1.8, unit: "F" };
    return { v: v, unit: "C" };
  }
  function loadOf(s) {                          // kW; TR, Btu/h, MW converted
    if (!s) return null;
    var v = num(s); if (!(v >= 0)) return null;
    if (/\bTR\b|ton/i.test(s)) return v * TR;
    if (/btu/i.test(s)) return v * 0.000293071;
    if (/\bMW\b/.test(s)) return v * 1000;
    return v;
  }
  function pressOf(s) {                         // kPa; bar, m (water), psi, ft, Pa converted
    if (!s) return null;
    var v = num(s); if (!(v >= 0)) return null;
    if (/kpa/i.test(s)) return v;
    if (/bar/i.test(s)) return v * 100;
    if (/psi/i.test(s)) return v * 6.89476;
    if (/\bft\b|feet|foot/i.test(s)) return v * 2.98907;
    if (/\bm\b|mwc|mwg|m\s*w|metre|meter/i.test(s)) return v * G;
    if (/\bpa\b/i.test(s)) return v / 1000;
    return v;
  }
  function lengthOf(s) {                        // m; ft converted
    if (!s) return null;
    var v = num(s); if (!(v >= 0)) return null;
    return /\bft\b|feet|foot|'/i.test(s) ? v * 0.3048 : v;
  }
  // inside diameter of steel pipe, schedule 40 (STD above DN 250), from "DN 150", "150 mm", "6 in", '6"'
  var ID = { 15: 15.8, 20: 20.9, 25: 26.6, 32: 35.1, 40: 40.9, 50: 52.5, 65: 62.7, 80: 77.9, 100: 102.3, 125: 128.2, 150: 154.1, 200: 202.7,
    250: 254.5, 300: 304.8, 350: 336.6, 400: 387.4, 450: 438.2, 500: 489.0, 600: 590.6 };
  var INCH = { "0.5": 15, "0.75": 20, "1": 25, "1.25": 32, "1.5": 40, "2": 50, "2.5": 65, "3": 80, "4": 100, "5": 125, "6": 150, "8": 200, "10": 250, "12": 300, "14": 350, "16": 400, "18": 450, "20": 500, "24": 600 };
  function dnOf(s) {
    if (!s) return null;
    var t = String(s), v = num(t); if (!(v > 0)) return null;
    if (/in\b|inch|"|”/i.test(t) && !/dn/i.test(t)) { var dn = INCH[String(v)]; return dn ? { dn: dn, d: ID[dn] / 1000 } : null; }
    if (ID[v]) return { dn: v, d: ID[v] / 1000 };
    return null;
  }
  // pressure drop of a pipe run (kPa) with its velocity and friction gradient
  function pipeDp(lps, size, len) {
    var p = dnOf(size), L = lengthOf(len);
    if (!p || L == null) return { dp: 0, missing: true, dn: p ? p.dn : null };
    var q = lps / 1000, a = Math.PI * p.d * p.d / 4, v = q / a;
    if (!(v > 0)) return { dp: 0, v: 0, pam: 0, dn: p.dn, len: L };
    var re = v * p.d / NU, f = re < 2300 ? 64 / re : 0.25 / Math.pow(Math.log10(ROUGH / (3.7 * p.d) + 5.74 / Math.pow(re, 0.9)), 2);
    var pam = f / p.d * 1000 * v * v / 2;                                 // Pa per m of straight pipe
    return { dp: pam * L * (1 + FITTINGS) / 1000, v: v, pam: pam, re: re, f: f, dn: p.dn, len: L };
  }
  function shutBy(n) {
    return /^clos/i.test(note(n, "valve")) || /^(standby|off|stop)/i.test(note(n, "pump")) || /^(standby|off|stop)/i.test(note(n, "status"));
  }

  /* nodes: { id: { id, title, special: [...], links: [...] } }; shutNow: { id: true (shut) | false (open, running) }
     overrides the map for a simulation. Returns null when the map has no pipes. */
  function compute(nodes, shutNow) {
    shutNow = shutNow || {};
    var A = {}, pipes = {}, on = {}, any = false, units = { lps: 0, m3h: 0, gpm: 0, C: 0, F: 0 };
    CIRCUITS.forEach(function (c) { A[c.id] = { sup: {}, ret: {} }; pipes[c.id] = {}; });
    function link(adj, a, b) { (adj[a] = adj[a] || []); (adj[b] = adj[b] || []); if (adj[a].indexOf(b) < 0) adj[a].push(b); if (adj[b].indexOf(a) < 0) adj[b].push(a); }
    Object.keys(nodes).forEach(function (id) {
      (nodes[id].links || []).forEach(function (l) {
        if (l.kind !== "node" || !nodes[l.node] || l.node === id) return;
        CIRCUITS.forEach(function (c) {
          var side = l.rel === c.sup ? "sup" : l.rel === c.ret ? "ret" : null;
          if (!side) return;
          any = true; link(A[c.id][side], id, l.node);
          pipes[c.id][[id, l.node].sort().join("|")] = l;
          [id, l.node].forEach(function (x) { on[x] = on[x] || []; if (on[x].indexOf(c.id) < 0) on[x].push(c.id); });
        });
      });
    });
    if (!any) return null;
    var shut = {};
    Object.keys(on).forEach(function (id) {
      var n = nodes[id];
      shut[id] = shutNow[id] != null ? !!shutNow[id] : shutBy(n);
      ["flow", "design flow", "condenser flow", "pump flow"].forEach(function (k) { var f = flowOf(note(n, k)); if (f) units[f.unit]++; });
      ["leaving", "condenser leaving"].forEach(function (k) { var t = tempOf(note(n, k)); if (t) units[t.unit]++; });
    });
    var ctx = { nodes: nodes, on: on, shut: shut, pipes: pipes, reject: {}, copAssumed: [] };
    var out = { circuits: {}, part: {}, on: on, shut: shut, dir: {}, tEdge: {}, edge: {}, limEdge: {}, unit: null };
    CIRCUITS.forEach(function (c) {
      var r = circuit(c, A[c.id], ctx);
      if (!r) return;
      out.circuits[c.id] = r;
      Object.keys(r.part).forEach(function (id) { out.part[id] = 1; });
      Object.keys(r.dir).forEach(function (k) { out.dir[k] = r.dir[k]; if (r.tEdge[k] != null) out.tEdge[k] = r.tEdge[k]; out.edge[k] = c.id; });
      Object.keys(r.limEdge).forEach(function (k) { out.limEdge[k] = r.limEdge[k]; });
      // what the running chillers reject goes on to the condenser water
      if (c.id === "chw") Object.keys(r.source).forEach(function (s) {
        var src = r.source[s]; if (!(src.kw > 0)) return;
        var cop = num(note(nodes[s], "cop")); if (!(cop > 0)) { cop = 5; ctx.copAssumed.push(s); }
        ctx.reject[s] = src.kw * (1 + 1 / cop);
      });
    });
    out.reject = ctx.reject; out.copAssumed = ctx.copAssumed;
    var fu = "lps"; ["m3h", "gpm"].forEach(function (u) { if (units[u] > units[fu]) fu = u; });     // the unit most inputs use
    out.unit = { flow: fu, temp: units.F > units.C ? "F" : "C" };
    // a chiller that runs on chilled water but has no condenser water
    out.noCondenser = [];
    if (out.circuits.chw && out.circuits.cw) Object.keys(out.circuits.chw.active).forEach(function (s) {
      if ((on[s] || []).indexOf("cw") >= 0 && !(out.circuits.cw.flow[s] > 0)) out.noCondenser.push(s);
    });
    return out;
  }

  function circuit(C, A, ctx) {
    var nodes = ctx.nodes, shut = ctx.shut, sup = A.sup, ret = A.ret, part = {};
    Object.keys(sup).concat(Object.keys(ret)).forEach(function (id) { part[id] = 1; });
    var ids = Object.keys(part);
    if (!ids.length) return null;
    // a note of this circuit: its own name, or the plain one when the branch is on this circuit only
    function nv(id, own, plain) {
      var n = nodes[id], v = note(n, own);
      if (!v && plain && plain !== own && ctx.on[id].length === 1) v = note(n, plain);
      return v;
    }
    var LIFT = {}, isSrc = {}, isPump = {}, F = {}, LV = {}, LD = {}, OUT = {}, DF = {}, DP = {}, QD = {}, PH = {}, PQ = {}, SPD = {}, FILL = {}, Z = {}, CAP = {}, MAXF = {};
    ids.forEach(function (id) {
      var n = nodes[id], s = note(n, "source");
      if (s && (ctx.on[id].length === 1 || (C.id === "cw") === COND.test(s))) isSrc[id] = 1;
      if (note(n, "pump") || note(n, "pump head")) isPump[id] = 1;
      var f = flowOf(nv(id, C.flow, "flow")), d = flowOf(note(n, "design flow")), t = tempOf(nv(id, C.leaving, "leaving"));
      if (f && !isSrc[id]) F[id] = f.v;
      if (d && (isSrc[id] || ctx.on[id].length === 1)) DF[id] = d.v;
      if (t) { if (isSrc[id]) OUT[id] = t.v; else LV[id] = t.v; }
      var ld = C.id === "cw" ? (ctx.reject[id] != null ? ctx.reject[id] : loadOf(nv(id, "heat rejected", "load"))) : loadOf(note(n, "load"));
      if (ld != null) LD[id] = ld;
      var dp = pressOf(nv(id, C.dp, "pressure drop")); if (dp != null) DP[id] = dp;
      if (isPump[id]) {
        var ph = pressOf(note(n, "pump head")), pq = flowOf(note(n, "pump flow")) || flowOf(note(n, "design flow")), sp = num(note(n, "speed"));
        if (ph != null) PH[id] = ph; if (pq) PQ[id] = pq.v; SPD[id] = sp > 0 ? sp / 100 : 1;
      }
      var fp = pressOf(note(n, "fill pressure")); if (fp != null) FILL[id] = fp;
      var hz = note(n, "height"), z = num(hz); Z[id] = isNaN(z) ? 0 : /\bft\b|feet|foot/i.test(hz) ? z * 0.3048 : z;
      var lift = pressOf(note(n, "static lift")); if (lift != null) LIFT[id] = lift;
      var cap = loadOf(nv(id, C.id === "cw" ? "condenser capacity" : "capacity", "capacity")); if (cap > 0 && isSrc[id]) CAP[id] = cap;
      var mf = flowOf(nv(id, C.id === "cw" ? "condenser max flow" : "max flow", "max flow")); if (mf && mf.v > 0 && !isSrc[id]) MAXF[id] = mf.v;
    });
    ids.forEach(function (id) { QD[id] = isPump[id] ? PQ[id] : isSrc[id] ? DF[id] : F[id] || DF[id]; });
    var srcs = ids.filter(function (id) { return isSrc[id]; });
    var loads = ids.filter(function (id) { return !isSrc[id] && sup[id] && ret[id]; });
    var isUnit = {}; loads.forEach(function (id) { isUnit[id] = 1; });

    function reach(adj, s) {
      var seen = {}, q = [s]; seen[s] = 1;
      while (q.length) { var a = q.shift(); (adj[a] || []).forEach(function (b) { if (seen[b] || shut[b] || isSrc[b]) return; seen[b] = 1; q.push(b); }); }
      return seen;
    }
    var rs = {}, rr = {};
    srcs.forEach(function (s) { if (!shut[s]) { rs[s] = reach(sup, s); rr[s] = reach(ret, s); } });

    // flows and temperatures for the units' flows Fx
    function solve(Fx, OV) {
      OV = OV || {};
      var active = {}, flowing = {};
      srcs.forEach(function (s) {
        if (shut[s]) return;
        loads.forEach(function (L) { if (!shut[L] && Fx[L] > 0 && rs[s][L] && rr[s][L]) { active[s] = 1; flowing[L] = 1; } });
      });
      var S = srcs.filter(function (s) { return active[s]; });
      var byDesign = S.length > 0 && S.every(function (s) { return DF[s] > 0; });
      function weight(s) { return byDesign ? DF[s] : 1; }
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
          var b = order[i], o = (flowing[b] ? Fx[b] : 0) + (acc[b] || 0);
          through[b] = o;
          if (!dist[b]) continue;
          par[b].forEach(function (p) {
            var share = cap[b] > 0 ? o * cap[p] / cap[b] : o / par[b].length;
            edge[p + ">" + b] = (edge[p + ">" + b] || 0) + share;
            acc[p] = (acc[p] || 0) + share;
          });
        }
        return { dist: dist, order: order, par: par, edge: edge, through: through, cap: cap };
      }
      var sp = spread(sup), rp = spread(ret);
      var TS = {};
      sp.order.forEach(function (b) {
        if (!sp.dist[b]) { var o0 = OV[b] != null ? OV[b] : OUT[b]; if (o0 != null) TS[b] = o0; return; }
        var t = 0, q = 0, tk = 0, k = 0;
        sp.par[b].forEach(function (a) { if (TS[a] == null) return; var f = sp.edge[a + ">" + b] || 0; t += f * TS[a]; q += f; tk += TS[a]; k++; });
        if (q > 0) TS[b] = t / q; else if (k) TS[b] = tk / k;
      });
      var TIN = {}, TOUT = {}, KW = {};
      loads.forEach(function (L) {
        var tin = TS[L], f = flowing[L] ? Fx[L] : 0, tout = LV[L], kw;
        if (tout != null) { if (tin != null && f > 0) kw = CP * f * (tout - tin); }
        else if (LD[L] != null && tin != null && f > 0) { tout = tin + LD[L] / (CP * f); kw = LD[L]; }
        if (tin != null) TIN[L] = tin;
        if (tout != null) TOUT[L] = tout;
        if (kw != null) KW[L] = kw;
      });
      var TRT = {}, wq = {}, wt = {}, missing = [];
      for (var j = rp.order.length - 1; j >= 0; j--) {
        var b = rp.order[j], q0 = wq[b] || 0, t0 = wt[b] || 0;
        if (flowing[b] && Fx[b] > 0) { if (TOUT[b] != null) { q0 += Fx[b]; t0 += Fx[b] * TOUT[b]; } else missing.push(b); }
        if (q0 > 0) TRT[b] = t0 / q0;
        if (!rp.dist[b]) continue;
        rp.par[b].forEach(function (a) { var f = rp.edge[a + ">" + b] || 0; if (f > 0 && TRT[b] != null) { wq[a] = (wq[a] || 0) + f; wt[a] = (wt[a] || 0) + f * TRT[b]; } });
      }
      var src = {}, tot = { q: 0, kw: 0, kwKnown: true, tq: 0, ts: 0, rq: 0, rt: 0 };
      srcs.forEach(function (s) {
        var q = active[s] ? sp.through[s] || 0 : 0, o = OV[s] != null ? OV[s] : OUT[s], back = active[s] ? TRT[s] : undefined, kw;
        if (q > 0 && o != null && back != null) kw = CP * q * (back - o);
        src[s] = { q: q, out: o, set: OUT[s], back: back, kw: kw, design: DF[s], pct: DF[s] > 0 ? q / DF[s] * 100 : undefined, over: DF[s] > 0 && q > DF[s] * 1.0001, capacity: CAP[s] };
        if (q > 0) {
          tot.q += q;
          if (kw != null) tot.kw += kw; else tot.kwKnown = false;
          if (o != null) { tot.tq += q; tot.ts += q * o; }
          if (back != null) { tot.rq += q; tot.rt += q * back; }
        }
      });
      var dir = {}, tEdge = {};
      Object.keys(sp.edge).forEach(function (k) { var ab = k.split(">"); if (sp.edge[k] > 1e-9) { dir[k] = sp.edge[k]; if (TS[ab[0]] != null) tEdge[k] = TS[ab[0]]; } });
      Object.keys(rp.edge).forEach(function (k) {
        var ab = k.split(">"), back = ab[1] + ">" + ab[0];
        if (rp.edge[k] > 1e-9) { dir[back] = (dir[back] || 0) + rp.edge[k]; if (TRT[ab[1]] != null) tEdge[back] = TRT[ab[1]]; }
      });
      // the load each header, riser and pipe run carries: the units' loads shared back as their water is
      function carry(spr, val) {
        var acc = {}, thr = {};
        for (var i = spr.order.length - 1; i >= 0; i--) {
          var b = spr.order[i], o = (val[b] || 0) + (acc[b] || 0);
          thr[b] = o;
          if (!spr.dist[b]) continue;
          spr.par[b].forEach(function (p) { var share = spr.cap[b] > 0 ? o * spr.cap[p] / spr.cap[b] : o / spr.par[b].length; acc[p] = (acc[p] || 0) + share; });
        }
        return thr;
      }
      var kwOn = {}; loads.forEach(function (L) { if (flowing[L] && KW[L] != null) kwOn[L] = KW[L]; });
      var carS = carry(sp, kwOn), carR = carry(rp, kwOn), carried = {};
      var flow = {}, side = {};
      ids.forEach(function (id) {
        side[id] = isSrc[id] ? "source" : isUnit[id] ? "unit" : sup[id] ? "supply" : "return";
        var v = isSrc[id] ? src[id].q : side[id] === "unit" ? (sp.through[id] || 0) : side[id] === "supply" ? sp.through[id] : rp.through[id];
        flow[id] = v > 1e-9 ? v : 0;
        if (side[id] === "supply" && flow[id] > 0) carried[id] = carS[id]; else if (side[id] === "return" && flow[id] > 0) carried[id] = carR[id];
      });
      return { carried: carried, active: active, flowing: flowing, flow: flow, side: side, tSupply: TS, tReturn: TRT, tIn: TIN, tOut: TOUT, kw: KW, source: src, dir: dir, tEdge: tEdge,
        missing: missing, byDesign: byDesign, sources: S.length,
        total: { q: tot.q, kw: tot.kwKnown ? tot.kw : undefined, out: tot.tq > 0 ? tot.ts / tot.tq : undefined, back: tot.rq > 0 ? tot.rt / tot.rq : undefined, sources: S.length } };
    }

    // ---------- pressures ----------
    function pipeOf(a, b) { return ctx.pipes[C.id][[a, b].sort().join("|")] || {}; }
    function pumpHead(p, q) {
      var n = SPD[p], hd = PH[p], qd = PQ[p], x = q / (n * qd);
      return { h: n * n * hd * (1.2 - 0.2 * x * x), beyond: x * x > 6 };
    }
    // pressure lost through a branch that is not a unit (kPa): its drop at design flow, as the square of the flow,
    // plus a static lift that does not change with flow (an open cooling tower: basin to spray nozzles)
    function through(id, q) {
      var d = DP[id] > 0 ? (QD[id] > 0 ? DP[id] * (q / QD[id]) * (q / QD[id]) : DP[id]) : 0;
      return d + (LIFT[id] || 0);
    }
    function hydraulics(r) {
      var running = ids.filter(function (id) { return isPump[id] && r.flow[id] > 0; });
      if (!running.length) return { ok: false, why: ids.some(function (id) { return isPump[id]; }) ? "stopped" : "nopump" };
      var lacking = running.filter(function (p) { return !(PH[p] > 0 && PQ[p] > 0); });
      if (lacking.length) return { ok: false, why: "pumpdata", pumps: lacking };
      var isRun = {}; running.forEach(function (p) { isRun[p] = 1; });
      var edges = Object.keys(r.dir).map(function (k) {
        var ab = k.split(">"), l = pipeOf(ab[0], ab[1]), pd = pipeDp(r.dir[k], l.cable, l.len);
        pd.a = ab[0]; pd.b = ab[1]; pd.q = r.dir[k]; pd.k = k; return pd;
      });
      var pump = {}, fIn = {}, fOut = {}, bIn = {}, bOut = {}, uIn = {}, uOut = {};
      running.forEach(function (p) {
        var ph = pumpHead(p, r.flow[p]), own = through(p, r.flow[p]);
        pump[p] = { q: r.flow[p], h: ph.h, beyond: ph.beyond, own: own, design: { q: PQ[p], h: PH[p] }, speed: SPD[p] };
        fIn[p] = 0; fOut[p] = Math.max(0, ph.h) - own; bIn[p] = 0;
      });
      for (var pass = 0; pass < ids.length + 2; pass++) {
        var changed = false;
        edges.forEach(function (e) {
          // forward: from the pumps' discharge, losing pressure, to the units' inlets
          if (fOut[e.a] != null && !isRun[e.b]) {
            var c = fOut[e.a] - e.dp;
            if (isUnit[e.b]) { if (uIn[e.b] == null || c < uIn[e.b] - 1e-9) { uIn[e.b] = c; changed = true; } }
            else if (fIn[e.b] == null || c < fIn[e.b] - 1e-9) { fIn[e.b] = c; fOut[e.b] = c - through(e.b, r.flow[e.b]); changed = true; }
          }
          // backward: from the pumps' suction, against the flow, gaining pressure, to the units' outlets
          var down = isRun[e.b] ? 0 : isUnit[e.b] ? null : bIn[e.b];
          if (down != null && !isRun[e.a]) {
            var u = down + e.dp;
            if (isUnit[e.a]) { if (uOut[e.a] == null || u > uOut[e.a] + 1e-9) { uOut[e.a] = u; changed = true; } }
            else if (bOut[e.a] == null || u > bOut[e.a] + 1e-9) { bOut[e.a] = u; bIn[e.a] = u + through(e.a, r.flow[e.a]); changed = true; }
          }
        });
        if (!changed) break;
      }
      var avail = {}, need = {}, idx = null;
      loads.forEach(function (L) {
        if (!r.flowing[L] || uIn[L] == null || uOut[L] == null) return;
        avail[L] = uIn[L] - uOut[L];
        if (DP[L] > 0) {
          need[L] = DP[L];
          var m = avail[L] - DP[L];
          if (!idx || m < idx.margin) idx = { id: L, margin: m };
        }
      });
      // relative pressure of every branch (inlet), and absolute (gauge) from an expansion tank
      var rel = {};
      Object.keys(fIn).forEach(function (id) { rel[id] = fIn[id]; });
      Object.keys(bIn).forEach(function (id) { if (rel[id] == null) rel[id] = bIn[id]; });
      running.forEach(function (p) { rel[p] = 0; });
      // the reference: an expansion tank (closed circuit: its fill pressure where it joins), or else an open cooling
      // tower (open circuit: its basin is at atmospheric pressure, 0 bar gauge, at the tower's height)
      var tank = null;
      Object.keys(FILL).forEach(function (t) {
        if (tank) return;
        var nb = (sup[t] || []).concat(ret[t] || []).filter(function (x) { return rel[x] != null || uIn[x] != null; })[0];
        if (nb) tank = { id: t, at: nb, fill: FILL[t], r0: rel[nb] != null ? rel[nb] : uIn[nb] };
      });
      if (!tank) srcs.forEach(function (s) {
        if (tank || !(LIFT[s] > 0) || !r.active[s]) return;
        var o = bOut[s] != null ? bOut[s] : fOut[s];
        if (o != null) tank = { id: s, at: s, fill: 0, r0: o, open: true };
      });
      var abs = null, absOut = null, low = [];
      if (tank) {
        var r0 = tank.r0, shift = tank.fill - r0, z0 = Z[tank.at] || 0;
        abs = {}; absOut = {};
        var put = function (id, v) { return v + shift - G * ((Z[id] || 0) - z0); };
        Object.keys(rel).forEach(function (id) { abs[id] = put(id, rel[id]); });
        Object.keys(uIn).forEach(function (id) { abs[id] = put(id, uIn[id]); });
        Object.keys(uOut).forEach(function (id) { absOut[id] = put(id, uOut[id]); });
        running.forEach(function (p) { absOut[p] = put(p, fOut[p]); });                          // discharge
        Object.keys(abs).forEach(function (id) { if (abs[id] < LOW) low.push(id); });
        Object.keys(absOut).forEach(function (id) { if (absOut[id] < LOW && low.indexOf(id) < 0) low.push(id); });
      }
      var pipe = {};
      edges.forEach(function (e) { pipe[e.k] = { dp: e.dp, v: e.v, pam: e.pam, dn: e.dn, len: e.len, missing: !!e.missing, fast: e.pam > 400 || e.v > 3 }; });
      return { ok: true, pump: pump, avail: avail, need: need, index: idx, rel: rel, uIn: uIn, uOut: uOut, abs: abs, absOut: absOut, tank: tank, low: low, pipe: pipe };
    }

    // a source over its Capacity runs at it: its leaving water rises to return − Capacity / (4.19 × flow)
    // (units given by their Leaving keep the return as it was, so one step settles it; units given by Load cannot be met:
    // the leaving water is set by the first step and the shortfall is said)
    function solveCap(Fx) {
      var r0 = solve(Fx), OV = {}, any = false;
      srcs.forEach(function (s) {
        var x = r0.source[s];
        if (CAP[s] > 0 && x.q > 0 && x.back != null && x.kw > CAP[s] * 1.0001) { OV[s] = x.back - CAP[s] / (CP * x.q); any = true; }
      });
      if (!any) return r0;
      var r1 = solve(Fx, OV);
      Object.keys(OV).forEach(function (s) {
        var x = r1.source[s]; x.atCap = true;
        if (x.kw > CAP[s] * 1.01) { x.short = x.kw - CAP[s]; x.kw = CAP[s]; }
      });
      return r1;
    }
    // Max flow: a branch passes no more; the units it feeds (supply) or collects from (return) share it in proportion to
    // their flows (worked out from the design flows, a few passes for limits one under another)
    var lim = {}, limBy = {}, limAt = {}, limEdge = {};
    loads.forEach(function (L) { lim[L] = 1; });
    var limited = Object.keys(MAXF);
    function feeds(r, id) {                     // the units whose water passes through id, and the pipes on the way
      var units = {}, edges = {}, q = [id], seen = {}; seen[id] = 1;
      var down = sup[id] && !ret[id] || r.side[id] === "supply";
      while (q.length) {
        var a = q.shift();
        if (isUnit[a] && a !== id) { units[a] = 1; continue; }
        Object.keys(r.dir).forEach(function (k) {
          var ab = k.split(">"), nb = down ? (ab[0] === a ? ab[1] : null) : (ab[1] === a ? ab[0] : null);
          if (!nb || seen[nb] || !(r.dir[k] > 1e-9) || !(down ? sup : ret)[a] || (down ? sup : ret)[a].indexOf(nb) < 0) return;
          seen[nb] = 1; edges[down ? a + ">" + nb : nb + ">" + a] = 1; q.push(nb);
        });
      }
      return { units: units, edges: edges };
    }
    if (limited.length) {
      for (var pass = 0; pass < 6; pass++) {
        var F0 = {}; loads.forEach(function (L) { if (F[L] != null) F0[L] = F[L] * lim[L]; });
        var r0 = solve(F0), moved0 = false;
        limited.forEach(function (b) {
          var t = r0.flow[b] || 0;
          if (!(t > MAXF[b] * 1.0001)) return;
          var f = MAXF[b] / t, fd = feeds(r0, b);
          if (!limAt[b]) limAt[b] = { max: MAXF[b], want: t };
          Object.keys(fd.units).forEach(function (L) { lim[L] *= f; limBy[L] = b; });
          Object.keys(fd.edges).forEach(function (k) { limEdge[k] = b; });
          moved0 = true;
        });
        if (!moved0) break;
      }
    }
    // a unit gets its design flow when it has the pressure for it; less when it has not (worked out until it settles)
    // (more flow leaves less pressure, so the step is made smaller whenever the units' flows swing back and forth)
    var scale = {}; loads.forEach(function (L) { scale[L] = 1; });
    var r, h, it, w = 0.5, last = Infinity;
    for (it = 0; it < 400; it++) {
      var Fx = {}; loads.forEach(function (L) { if (F[L] != null) Fx[L] = F[L] * Math.min(scale[L], lim[L]); });
      r = solveCap(Fx); h = hydraulics(r);
      if (!h.ok) break;
      var moved = 0;
      loads.forEach(function (L) {
        if (!(DP[L] > 0) || h.avail[L] == null || !(F[L] > 0)) return;
        // fully open, the unit passes the flow at which its own drop equals what it has: Qd·√(available / needed)
        var want = Math.min(1, Math.sqrt(Math.max(0, h.avail[L]) / DP[L]));
        var ns = (1 - w) * scale[L] + w * want;
        moved = Math.max(moved, Math.abs(ns - scale[L])); scale[L] = ns;
      });
      if (moved < 1e-6) break;
      if (moved > last * 0.98) w = Math.max(0.02, w * 0.6);
      last = moved;
    }
    var starved = {};
    loads.forEach(function (L) { if (scale[L] < 0.995 && scale[L] < lim[L] && F[L] > 0 && r.flowing[L]) starved[L] = scale[L]; });
    var limits = {}; loads.forEach(function (L) { if (lim[L] < 0.995 && lim[L] <= scale[L] && r.flowing[L]) limits[L] = { by: limBy[L], f: lim[L] }; });
    r.limited = limits; r.limitAt = limAt; r.limEdge = limEdge;
    r.setpoint = srcs.reduce(function (m, s) { return r.active[s] && OUT[s] != null ? Math.min(m, OUT[s]) : m; }, Infinity);
    r.C = C; r.part = part; r.shut = shut; r.isPump = isPump; r.isUnit = isUnit; r.isSrc = isSrc; r.hyd = h; r.starved = starved; r.iterations = it;
    r.input = { flow: F, leaving: LV, load: LD, out: OUT, design: DF, dp: DP, lift: LIFT, height: Z, fill: FILL, pumpHead: PH, pumpFlow: PQ, speed: SPD, capacity: CAP, maxFlow: MAXF };
    return r;
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
  function fmtKpa(kpa) { return kpa == null || isNaN(kpa) ? "" : fix(kpa, Math.abs(kpa) >= 100 ? 0 : 1) + " kPa"; }
  function fmtBar(kpa) { return kpa == null || isNaN(kpa) ? "" : fix(kpa / 100, 2) + " bar"; }
  function fmtHead(kpa) { return kpa == null || isNaN(kpa) ? "" : fix(kpa / G, 1) + " m"; }
  var FLOW_WORD = { lps: "l/s", m3h: "m³/h", gpm: "gpm" };
  function toUnit(lps, unit) { return unit === "m3h" ? lps * 3.6 : unit === "gpm" ? lps / 0.0630902 : lps; }

  root.MPWater = { compute: compute, CIRCUITS: CIRCUITS, note: note, num: num, flowOf: flowOf, tempOf: tempOf, loadOf: loadOf, pressOf: pressOf, lengthOf: lengthOf,
    dnOf: dnOf, pipeDp: pipeDp, shutBy: shutBy, fmtFlow: fmtFlow, fmtTemp: fmtTemp, fmtKw: fmtKw, fmtKpa: fmtKpa, fmtBar: fmtBar, fmtHead: fmtHead,
    FLOW_WORD: FLOW_WORD, toUnit: toUnit, CP: CP, TR: TR, G: G, FITTINGS: FITTINGS, LOW: LOW };
})(typeof window !== "undefined" ? window : this);
