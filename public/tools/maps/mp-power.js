/* ============================================================
   Thinkneering Tools - Maps: what a wiring map's current does (owner, 23 Oct 2026: "the flow of current", "just do
   BMS for now", "signals must be interconnected"; then "can a branch show the sum of energy consumption, 5 AHUs of
   30 kW = 150 kW on the board; I must be allowed to give a max power and once the limit is reached show a warning and
   show the supply in another colour, greyed out, to keep the max value in limit").
   Pure: compute(nodes, sim) from the map's branches and the browser-only simulation; maps.js draws what it returns,
   scripts/mp-power-check.mjs checks it.

   Special notes it reads (any branch):
     Source: utility | standby        power starts here (standby ones count only for what the others do not reach)
     Switch: open                     passes no power until closed (sim.iso changes it)
     Control: BMS | fire alarm        commands / stops the branches its control wires reach
     Schedule: occupied               stops at night (sim.night)
     Power: 30 kW                     what a load absorbs when it runs (kW, W, MW, kVA x PF, hp, or A at its Voltage)
     Max power: 150 kW                the most a board, transformer, generator or feeder may carry (same units)
     Diversity: 0.8                   a board's demand = the sum of what it feeds x this (0.1 to 1, or %)
     Priority: 1                      load shedding order: 1 is kept longest; a load without one goes first
     PF: 0.9  Voltage: 400 V          to turn kVA and A into kW (0.9 and 400 V three-phase when not given)

   What it works out:
   - the flow: from the sources along Power wires, whichever end a wire was added from, through every branch that is
     not open (a tree: from[] and kids[]);
   - the BMS, the fire alarm and interlocks: which loads run (state), and the path current is drawn along (draw);
   - demand: every running load's Power summed up the tree to the source, each board's sum times its Diversity
     (a unit with its own diagram counts its parts' Power when they have one, else its own); connected = the same with
     every load running and every switch as drawn (the design figure);
   - load shedding (keeps every Max power): while a branch carries more than its Max power, the deepest such branch
     sheds one of the running loads it feeds (the highest Priority number, then the highest up, then the last in the
     map): the shed load's supply opens, so it and what it feeds have no power, its interlocked pump stops, and the
     sums are worked out again. A branch that cannot get under its Max power (nothing left to shed) stays over.
   ============================================================ */
(function (root) {
  "use strict";
  var FLOW_KINDS = ["w-power"], CTL_KINDS = ["w-digital", "w-bus", "w-analog"];
  function note(n, name) { var re = new RegExp("^\\s*" + name + "\\s*:\\s*(.+)$", "i"); for (var i = 0; i < (n.special || []).length; i++) { var m = re.exec(n.special[i]); if (m) return m[1].trim(); } return ""; }
  function num(s) { var m = /-?\d+(?:[.,]\d+)?/.exec(String(s || "").replace(/(\d),(\d{3})\b/g, "$1$2")); return m ? parseFloat(m[0].replace(",", ".")) : NaN; }
  // a power in kW; kVA by the power factor, A by the voltage (three-phase unless single-phase or under 250 V)
  function kwOf(s, pf, volts) {
    var v = num(s); if (isNaN(v) || v < 0) return null;
    var t = String(s).toLowerCase(), p = pf > 0 && pf <= 1 ? pf : 0.9;
    if (/\bmva\b/.test(t)) return v * 1000 * p;
    if (/\bkva\b/.test(t)) return v * p;
    if (/\bmw\b/.test(t)) return v * 1000;
    if (/\bkw\b/.test(t)) return v;
    if (/\bhp\b/.test(t)) return v * 0.7457;
    if (/\bw\b/.test(t)) return v / 1000;
    if (/\ba\b|amps?\b/.test(t)) {
      var one = /1\s*ph|single/.test(t) || (volts > 0 && volts < 250), u = volts > 0 ? volts : one ? 230 : 400;
      return (one ? u * v : Math.sqrt(3) * u * v) * p / 1000;
    }
    return v;                                                     // a bare number: kW
  }
  function fraction(s) { var v = num(s); if (isNaN(v) || v <= 0) return null; if (v > 1) v = v / 100; return v > 0 && v <= 1 ? v : null; }

  function compute(nodes, sim) {
    sim = sim || {};
    var iso = sim.iso || {}, cmdOff = sim.cmd || {}, ids = Object.keys(nodes);
    var N = function (id) { return nodes[id]; };
    var isBms = function (id) { return /bms/i.test(note(N(id), "control")); }, isFire = function (id) { return /fire/i.test(note(N(id), "control")); };
    var adj = {}, inFlow = {}, any = false, sources = [];
    ids.forEach(function (id) {
      (N(id).links || []).forEach(function (l) {
        if (l.kind !== "node" || !N(l.node) || l.node === id || FLOW_KINDS.indexOf(l.rel) < 0) return;
        any = true; (adj[id] = adj[id] || []).push(l.node); (adj[l.node] = adj[l.node] || []).push(id); inFlow[id] = inFlow[l.node] = 1;
      });
      if (note(N(id), "source")) sources.push(id);
    });
    if (!any) return null;
    var standby = function (id) { return /standby|generator/i.test(note(N(id), "source")); };
    sources.sort(function (a, b) { return (standby(a) ? 1 : 0) - (standby(b) ? 1 : 0); });
    // the figures
    var PWR = {}, MAX = {}, DIV = {}, PRI = {}, order = {};
    ids.forEach(function (id, i) {
      var n = N(id), pf = num(note(n, "pf")), volts = num(note(n, "voltage"));
      order[id] = i;
      var p = kwOf(note(n, "power"), pf, volts); if (p != null && note(n, "power")) PWR[id] = p;
      var m = kwOf(note(n, "max power"), pf, volts); if (m != null && m > 0) MAX[id] = m;
      var d = fraction(note(n, "diversity")); if (d != null) DIV[id] = d;
      var r = num(note(n, "priority")); if (!isNaN(r)) PRI[id] = r;
    });
    // the commands (static: the wires do not change in a simulation)
    var ctl = {}, bms = [], follow = {}, fire = {}, fires = [], pairs = [];
    ids.forEach(function (id) { if (isBms(id)) bms.push(id); if (isFire(id)) fires.push(id); });
    ids.forEach(function (id) {
      (N(id).links || []).forEach(function (l) {
        if (l.kind !== "node" || !N(l.node) || CTL_KINDS.indexOf(l.rel) < 0) return;
        if (isFire(id) && !isFire(l.node)) fire[l.node] = id; else if (isFire(l.node) && !isFire(id)) fire[id] = l.node;
        else if (isBms(id) && !isBms(l.node)) ctl[l.node] = id; else if (isBms(l.node) && !isBms(id)) ctl[id] = l.node;
        else if (!isBms(id) && !isBms(l.node)) pairs.push([id, l.node]);
      });
    });
    pairs.forEach(function (p) { if (ctl[p[0]] && !ctl[p[1]]) follow[p[1]] = p[0]; else if (ctl[p[1]] && !ctl[p[0]]) follow[p[0]] = p[1]; });
    var cmd = {};
    [ctl, follow, fire].forEach(function (m) { Object.keys(m).forEach(function (id) { cmd[id] = 1; }); });
    function isOpen(id) { if (iso[id] != null) return iso[id]; return /^open/i.test(note(N(id), "switch")); }
    // the tree from the sources (open: a switch, an isolated branch, a shed load)
    function tree(openAt) {
      var on = {}, from = {}, kids = {}, seq = [], q = [];
      sources.forEach(function (id) { if (!openAt(id) && !on[id]) { on[id] = 1; q.push(id); } });
      while (q.length) { var a = q.shift(); seq.push(a); (adj[a] || []).forEach(function (b) { if (on[b] || openAt(b)) return; on[b] = 1; from[b] = a; (kids[a] = kids[a] || []).push(b); q.push(b); }); }
      return { on: on, from: from, kids: kids, seq: seq };
    }
    // a load: a branch on a power wire that feeds nothing further (or, unpowered, an end of a wire)
    function sums(t, running) {
      var dem = {};
      for (var i = t.seq.length - 1; i >= 0; i--) {
        var id = t.seq[i], s = 0;
        (t.kids[id] || []).forEach(function (k) { s += dem[k] || 0; });
        if (!s && PWR[id] != null && running(id)) s = PWR[id];
        dem[id] = s * (DIV[id] || 1);
      }
      return dem;
    }
    function evaluate(shed) {
      var t = tree(function (id) { return isOpen(id) || !!shed[id]; }), on = t.on, from = t.from, kids = t.kids;
      var state = {}, draw = {}, asking = {};
      function own(id) { if (cmdOff[id] === false) return "stopped"; if (sim.night && /occupied/i.test(note(N(id), "schedule"))) return "night"; return ""; }
      function why(id) { if (sources.length && inFlow[id] && !on[id]) return shed[id] ? "shed" : "nopower"; return blocked(id); }
      function blocked(id) {
        for (var x = id; x; x = from[x]) {
          if (ctl[x]) { var o = own(x); if (o) return o; }
          if (sim.fire && fire[x]) return "fire";
          if (follow[x] && !asking[x]) { asking[x] = 1; var w = why(follow[x]); delete asking[x]; if (w) return "interlock"; }
        }
        return "";
      }
      var loads = Object.keys(inFlow).filter(function (id) { return sources.indexOf(id) < 0 && (on[id] ? !(kids[id] || []).length : (adj[id] || []).length <= 1); });
      loads.forEach(function (id) {
        if (sources.length && !on[id]) { state[id] = shed[id] ? "shed" : "nopower"; return; }
        var b = blocked(id); if (b) { state[id] = b; return; }
        state[id] = "running";
        for (var x = id; x && !draw[x]; x = from[x]) draw[x] = 1;          // a running load draws current all the way up
      });
      Object.keys(cmd).forEach(function (id) { if (state[id]) return; state[id] = sources.length && inFlow[id] && !on[id] ? (shed[id] ? "shed" : "nopower") : blocked(id) || "running"; });
      var dem = sums(t, function (id) { return !!draw[id] && (state[id] == null || state[id] === "running"); });
      return { t: t, on: on, from: from, kids: kids, state: state, draw: draw, loads: loads, dem: dem };
    }
    // load shedding: the deepest branch over its Max power sheds one load at a time
    var shed = {}, shedBy = {}, ev = evaluate(shed), stuck = {};
    function depth(e, id) { var d = 0; for (var x = id; e.from[x]; x = e.from[x]) d++; return d; }
    function under(e, top) { var out = [], q = (e.kids[top] || []).slice(); while (q.length) { var x = q.shift(); out.push(x); (e.kids[x] || []).forEach(function (k) { q.push(k); }); } return out; }
    function rank(id) {                                              // its Priority, or the nearest one above it in the map
      for (var x = id; x && N(x); x = N(x).parent) if (PRI[x] != null) return PRI[x];
      return Infinity;
    }
    for (var guard = 0; guard < 400; guard++) {
      var over = Object.keys(MAX).filter(function (id) { return ev.on[id] && !stuck[id] && (ev.dem[id] || 0) > MAX[id] * 1.0001; });
      if (!over.length) break;
      var e0 = ev, b = over.sort(function (x, y) { return depth(e0, y) - depth(e0, x); })[0];
      // (an interlocked pump goes with the unit that starts it, never on its own)
      var cand = under(ev, b).filter(function (c) { return (ev.dem[c] || 0) > 0 && PWR[c] != null && !follow[c]; });
      if (!cand.length) { stuck[b] = 1; continue; }
      cand.sort(function (x, y) { return (rank(y) - rank(x)) || (depth(e0, x) - depth(e0, y)) || (order[y] - order[x]); });
      var c = cand[0]; shed[c] = 1; shedBy[c] = b;
      ev = evaluate(shed);
    }
    var overNow = Object.keys(MAX).filter(function (id) { return ev.on[id] && (ev.dem[id] || 0) > MAX[id] * 1.0001; });
    var sheds = {}; Object.keys(shedBy).forEach(function (c) { sheds[shedBy[c]] = (sheds[shedBy[c]] || 0) + 1; });
    // connected (design): every load running, every switch as drawn, the main sources before the standby ones
    var cdem = sums(tree(function (id) { return /^open/i.test(note(N(id), "switch")); }), function () { return true; });
    var state = ev.state;
    // does a command b (BMS, interlock or fire alarm)? its wire pulses towards b while b runs (the fire alarm's while it sounds)
    function commands(a, b2) { return fire[b2] === a ? (sim.fire ? "fire" : "") : (ctl[b2] === a || follow[b2] === a) && state[b2] === "running" ? "run" : ""; }
    return { on: ev.on, from: ev.from, kids: ev.kids, part: inFlow, adj: adj, known: sources.length > 0, ctl: ctl, bms: bms, state: state, draw: ev.draw, loads: ev.loads,
      follow: follow, fire: fire, fires: fires, cmd: cmd, commands: commands,
      dem: ev.dem, cdem: cdem, power: PWR, max: MAX, diversity: DIV, priority: PRI, shed: shedBy, sheds: sheds, over: overNow };
  }
  function fmtKw(kw) {
    if (kw == null || isNaN(kw)) return "";
    if (kw >= 10000) return (kw / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + " MW";
    return kw.toLocaleString("en-US", { minimumFractionDigits: kw < 10 && kw % 1 ? 1 : 0, maximumFractionDigits: kw < 10 ? 2 : kw < 100 ? 1 : 0 }) + " kW";
  }
  root.MPPower = { compute: compute, kwOf: kwOf, fraction: fraction, note: note, num: num, fmtKw: fmtKw, FLOW_KINDS: FLOW_KINDS, CTL_KINDS: CTL_KINDS };
})(typeof window !== "undefined" ? window : this);
