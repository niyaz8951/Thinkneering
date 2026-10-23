/* ============================================================
   Thinkneering Tools - Maps.
   Product knowledge as a tree: a map (Chiller) grows into branches (Components > Compressor ...).
   Every branch has notes, special notes and links (images are not used since 20 Oct 2026: text first).
     index.html            every map the user can open, search across them, Add map
     index.html?map=<id>   one map. #<branch id> shows that branch alone, #at-<branch id> selects it.
   Data only through Api.mp* (db/schema.sql, part "MAPS"). No AI in the tool: knowledge is typed,
   or pasted as an outline with Import. A branch is a fact for the AI only when verified, and only the super
   user or an admin of the Maps tile verifies (19 Oct 2026); anyone else's new or changed branch is "to verify".
   Wiring maps (electricity: current flows along power wires) and piping maps (water: flows and temperatures worked out
   by mp-water.js from the special notes) draw their lines as wires or pipes and simulate the flow (23 Oct 2026).
   ============================================================ */
(function () {
  "use strict";
  var TOOL = "maps", el = Hub.el, T = null, profile = null;
  function $(id) { return document.getElementById(id); }
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SHARE = { "private": "Only me", team_read: "Team can read", team_edit: "Team can edit" };
  var SHARE_HINT = "Team = everyone who has Maps on the dashboard.";
  var ICON = {
    note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 2.5h9v11h-9zM6 6h4M6 8.5h4M6 11h2.5"/></svg>',
    link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.8 9.2l2.4-2.4M7 4.6l1-1a2.6 2.6 0 013.7 3.7l-1 1M9 11.4l-1 1a2.6 2.6 0 01-3.7-3.7l1-1"/></svg>',
    warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M8 1.8 15 14.2H1z"/><path d="M8 6v4M8 12.2v.1"/></svg>',
    focus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"/></svg>'
  };
  function ico(name) { return el("span", { "class": "mp-ico", "aria-hidden": "true", html: ICON[name] }); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function store(kind, k, v) {            // storage can be blocked; nothing here is needed to work
    try { var s = window[kind]; if (v === undefined) return s.getItem(k); if (v === null) s.removeItem(k); else s.setItem(k, v); } catch (e) { /* ignore */ }
    return null;
  }
  function userKey(name) { return "dame.maps." + name + ":" + profile.user.username; }
  function tools() {                       // the tools this account can open
    var out = [];
    profile.categories.forEach(function (c) { c.tools.forEach(function (t) { if (t.status === "live" && t.path) out.push(t); }); });
    return out;
  }
  function tool(id) { return tools().filter(function (t) { return t.id === id; })[0] || null; }

  /* A sheet of this tool (the hub's own look). build(close) returns the content.
     Esc and a click outside close it. */
  function sheet(title, build) {
    var last = document.activeElement, downOn = null, back, box;
    function close() { document.removeEventListener("keydown", key, true); back.remove(); if (last && last.focus) last.focus(); }
    function key(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }
    box = el("div", { "class": "hub-sheet mp-sheet", role: "dialog", "aria-modal": "true", "aria-label": title }, [el("h2", { text: title })].concat(build(close)));
    back = el("div", { "class": "hub-sheet-back", onmousedown: function (e) { downOn = e.target; }, onclick: function (e) { if (e.target === back && downOn === back) close(); } }, [box]);
    document.body.appendChild(back);
    document.addEventListener("keydown", key, true);
    var first = box.querySelector("input, textarea, select, button");
    if (first) first.focus();
    return close;
  }
  // what a map is for: knowledge (process or product understanding) or an AI rule book (Compliance review > AI rules)
  var KIND = { knowledge: "Knowledge: process or product understanding", rulebook: "AI rule book: how the AI thinks and answers", vocabulary: "Vocabulary: what specifications ask (one per product)",
    wiring: "Wiring: electrical connections of a unit", piping: "Piping: water flowing between equipment, with flows and temperatures" };
  var KIND_NAME = { rulebook: "AI rule book", vocabulary: "Vocabulary", wiring: "Wiring", piping: "Piping" };
  var TEMPLATES = {
    wiring: [["", "Blank"], ["electricity", "Electricity: a building's supply to its chillers, AHUs and FCUs"]],
    piping: [["", "Blank"], ["chilled-water", "Chilled water: chillers to AHUs and FCUs and back"]] };
  var TEMPLATE_HINT = {
    wiring: "A typical example (a mall) to rename as the project's single-line diagram; every branch comes in \"to verify\". Current flows along the power lines.",
    piping: "A typical example (a mall: three chillers, AHUs, FCU groups) to rename as the project's schematic; every branch comes in \"to verify\" and its flows and temperatures are examples to replace. Water flows along the pipes with its flow and temperature." };
  var TEMPLATE_NAME = { electricity: "Electricity", "chilled-water": "Chilled water" };
  var KIND_HINT = "Knowledge maps are for people. An AI rule book holds the AI's instructions, decision steps and rules (one per factory); a Vocabulary holds the requirement types specifications ask, their words, units and scales (one per product). Both are linked in Compliance review > AI rules and start from a template there. Facts about a product are AI notes in Product Options. A Wiring map shows the electrical connections of a unit: equipment as branches, wires as lines with their terminals and cables. A Piping map shows water flowing between equipment: pipes as lines, with the flows and temperatures worked out from what you type.";
  function kindSelect(id, value) {
    var s = el("select", { "class": "input", id: id }, Object.keys(KIND).map(function (k) { return el("option", { value: k, text: KIND[k] }); }));
    s.value = value || "knowledge";
    return s;
  }
  function shareSelect(id, value) {
    var s = el("select", { "class": "input", id: id }, Object.keys(SHARE).map(function (k) { return el("option", { value: k, text: SHARE[k] }); }));
    s.value = value || "private";
    return s;
  }

  // ======================================================================
  // All maps
  // ======================================================================
  function showList() {
    var cat = profile.categories.filter(function (c) { return c.tools.some(function (t) { return t.id === TOOL; }); })[0];
    Hub.setBack(cat ? cat.name : "Dashboard", Hub.url("dashboard.html" + (cat ? "#" + encodeURIComponent(cat.id) : "")));
    $("mpNew").addEventListener("click", newMap);
    var timer, box = $("mpFind");
    box.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { findAll(box.value); }, 300); });
    loadList();
  }
  function listState(node) { var s = $("mpListState"); s.textContent = ""; s.hidden = !node; if (node) s.appendChild(node); }
  function loadList() {
    listState(document.createTextNode("Loading maps…")); $("mpListState").className = "empty";
    Api.mpList(T).then(function (r) {
      var grid = $("mpGrid"); grid.textContent = "";
      if (!r.maps.length) { listState(document.createTextNode("No maps yet. Press Add map and name it after a product, for example Chiller.")); return; }
      listState(null);
      r.maps.forEach(function (m) {
        var parts = [plural(m.branches, "branch", "branches"), plural(m.special, "special note")];
        grid.appendChild(el("a", { "class": "tile mp-tile", href: "?map=" + m.id }, [
          el("span", { "class": "tile-icon", "aria-hidden": "true", html: Hub.ICON.tree }),
          el("span", { "class": "badge", text: SHARE[m.share] || m.share }),
          KIND_NAME[m.kind] ? el("span", { "class": "badge mp-kind", text: KIND_NAME[m.kind] }) : null,
          el("h3", { text: m.name }),
          el("p", { text: parts.join(" · ") }),
          el("span", { "class": "meta", text: (m.mine ? "Yours" : "By " + m.owner) + " · changed " + Hub.date(m.updated_at) + (m.to_verify ? " · " + m.to_verify + " to verify" : "") })
        ]));
      });
    }, function (err) {
      $("mpGrid").textContent = ""; $("mpListState").className = "notice error";
      listState(el("div", { "class": "mp-rowwrap" }, [el("span", { text: "The maps could not be loaded. " + err.message }), el("button", { type: "button", "class": "btn ghost sm", text: "Try again", onclick: loadList })]));
    });
  }
  var findSeq = 0;
  function findAll(text) {
    var host = $("mpHits"), q = text.replace(/\s+/g, " ").trim(), seq = ++findSeq;
    if (q.length < 2) { host.hidden = true; host.textContent = ""; return; }
    Api.mpSearch(T, q).then(function (r) {
      if (seq !== findSeq) return;
      host.textContent = ""; host.hidden = false;
      if (!r.hits.length) { host.appendChild(el("div", { "class": "notice", text: "Nothing found for \"" + q + "\" in the maps you can open." })); return; }
      r.hits.forEach(function (h) {
        host.appendChild(el("a", { "class": "mp-hit", href: "?map=" + h.map_id + "#at-" + h.node_id }, [
          el("b", { text: h.title }), " ", el("span", { text: h.map + (h["in"] === "name" ? "" : " · found in " + h["in"]) }),
          h.text ? el("p", { text: h.text }) : null
        ]));
      });
      if (r.hits.length >= 60) host.appendChild(el("p", { "class": "small muted", text: "The first 60 branches are shown. Type more to narrow it." }));
    }, function (err) {
      if (seq !== findSeq) return;
      host.textContent = ""; host.hidden = false; host.appendChild(el("div", { "class": "notice error", text: "The search did not work. " + err.message }));
    });
  }
  function newMap() {
    sheet("Add a map", function (close) {
      var err = el("p", { "class": "mp-err", role: "alert" });
      var name = el("input", { "class": "input", type: "text", id: "mpNewName", maxlength: "80", placeholder: "e.g. Chiller", autocomplete: "off" });
      var share = shareSelect("mpNewShare", "private"), kind = kindSelect("mpNewKind", "knowledge"), busy = false;
      // a wiring map may start from a typical template (all of it "to verify" against the factory drawing)
      // a wiring or piping map may start from a typical template
      var tpl = el("select", { "class": "input", id: "mpNewTpl" }), tplHint = el("p", { "class": "hint" });
      var tplField = el("label", { "class": "field" }, [el("span", { text: "Start from" }), tpl, tplHint]);
      tplField.hidden = true;
      kind.addEventListener("change", function () {
        var list = TEMPLATES[kind.value];
        tplField.hidden = !list; tpl.textContent = "";
        if (list) { list.forEach(function (t) { tpl.appendChild(el("option", { value: t[0], text: t[1] })); }); tplHint.textContent = TEMPLATE_HINT[kind.value]; }
      });
      tpl.addEventListener("change", function () { if (TEMPLATE_NAME[tpl.value] && !name.value.trim()) name.value = TEMPLATE_NAME[tpl.value]; });
      var ok = el("button", { type: "button", "class": "btn", text: "Add map", onclick: go });
      function go() {
        var v = name.value.replace(/\s+/g, " ").trim();
        if (!v) { err.textContent = "Give the map a name, usually the product."; name.focus(); return; }
        if (busy) return;
        busy = true; ok.disabled = true; err.textContent = "";
        Api.mpCreate(T, { name: v, share: share.value, kind: kind.value, template: TEMPLATES[kind.value] ? tpl.value : "" }).then(function (r) {
          store("sessionStorage", userKey("edit"), r.id);            // a new map opens in Edit
          window.location.href = "?map=" + r.id;
        }, function (e) { busy = false; ok.disabled = false; err.textContent = e.message; });
      }
      name.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      return [
        el("label", { "class": "field" }, [el("span", { text: "Map name" }), name]),
        el("label", { "class": "field" }, [el("span", { text: "What it is for" }), kind, el("p", { "class": "hint", text: KIND_HINT })]),
        tplField,
        el("label", { "class": "field" }, [el("span", { text: "Shared with" }), share, el("p", { "class": "hint", text: SHARE_HINT + " You can change this later." })]),
        err,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: close }), ok])
      ];
    });
  }

  // ======================================================================
  // One map (20 Oct 2026, owner: "a complete free-flow page"). The map is text on lines, not boxes: every
  // branch is its name on a line of its branch colour, and the lines flow from the branch it grows from.
  // The page scrolls both ways; press and hold (drag) moves it; Ctrl + wheel zooms; Full screen fills the
  // screen. A branch opens in the note (focus mode): double-click it, press Enter, or click its notes icon.
  // The note is where it is read and written; reading goes branch by branch with Previous / Next.
  // One click on a branch (21 Oct 2026, owner: "like Power BI, double-click is ours"): it shows the branches
  // that grow from it and closes every other one, so only the way to it and its next level stay open.
  // Clicking it again closes it; Ctrl + click opens or closes one branch and leaves the others as they are.
  // ======================================================================
  var M = null;                                    // { map, nodes: {id: node}, root }
  var st = { fire: false, sxLabels: "chosen", focus: null, sel: null, view: "map", edit: false, q: "", note: null, zoom: 1, special: false, peek: null, xlinks: "chosen", flow: true, iso: {}, cmd: {}, night: false };
  // peek (23 Oct 2026, owner): a click on a branch with nothing under it opens its notes on the map itself, as the
  // next level would grow (map view only, not focus mode): read, or Edit / Done for those who may change the map
  var seen = {}, wantScroll = false, firstDraw = true, GX = 44, GY = 8, GTOP = 18, PAD = 60, IND = 18, GCOL = 70;
  var COARSE = window.matchMedia ? window.matchMedia("(pointer: coarse)") : { matches: false };
  function N(id) { return M.nodes[id]; }
  // ---------- what a link between two branches means (23 Oct 2026) ----------
  // One fixed list for every map (the server keeps the same ids, api/mp.ts MP_RELS): each kind has its own line,
  // colour and words, so a line reads the same on every map; the words are on the line too (never colour alone).
  // "back" is how the other end reads it. A link saved before 23 Oct 2026 has no kind: See also.
  var RELS = [
    { id: "requires", label: "Requires", back: "Required by", ends: "end", hint: "One needs the other: a VFD requires a motor of a certain insulation class." },
    { id: "equivalent", label: "Equivalent to", back: "Equivalent to", ends: "both", hint: "The same requirement in other words or another standard: MERV 14 and F8." },
    { id: "excludes", label: "Excludes", back: "Excludes", ends: "none", hint: "Cannot go together: EC plug fans exclude belt drives." },
    { id: "replaced", label: "Replaced by", back: "Replaces", ends: "end", hint: "One took the place of the other: EN 779 was replaced by ISO 16890." },
    { id: "part", label: "Part of", back: "Has part", ends: "end", hint: "Belongs to the other: a filter gauge is part of the filter section." },
    { id: "see", label: "See also", back: "See also", ends: "none", hint: "Related, read them together." },
    // wires of a wiring map (23 Oct 2026): the arrow of a signal points where the signal goes
    { id: "w-power", wire: true, label: "Power", back: "Power", ends: "none", hint: "Mains or motor supply: phases, neutral as the terminals say." },
    { id: "w-control", wire: true, label: "Control supply", back: "Control supply", ends: "none", hint: "Supply of the controls and actuators, e.g. 24 V AC." },
    { id: "w-analog", wire: true, label: "Analog signal", back: "Analog signal", ends: "end", hint: "0–10 V, 4–20 mA, a sensor input: a value, in the arrow's direction." },
    { id: "w-digital", wire: true, label: "Digital / contact", back: "Digital / contact", ends: "end", hint: "On / off command, alarm or status, volt-free contact: in the arrow's direction." },
    { id: "w-bus", wire: true, label: "Communication bus", back: "Communication bus", ends: "none", hint: "Modbus RTU, BACnet MS/TP, RS-485: data both ways." },
    { id: "w-earth", wire: true, label: "Earth", back: "Earth", ends: "none", hint: "Protective earth (PE)." },
    // pipes of a piping map (23 Oct 2026): the map works out which way the water goes, so no arrow
    { id: "p-supply", wire: true, pipe: true, label: "CHW supply", back: "CHW supply", ends: "none", hint: "Chilled water supply (CHWS): from the chillers towards the units. The map works out its flow, temperature and pressure drop." },
    { id: "p-return", wire: true, pipe: true, label: "CHW return", back: "CHW return", ends: "none", hint: "Chilled water return (CHWR): from the units back to the pumps and chillers." },
    { id: "p-cw-supply", wire: true, pipe: true, label: "CW supply", back: "CW supply", ends: "none", hint: "Condenser water supply (CWS): from the cooling towers through the pumps to the chillers' condensers." },
    { id: "p-cw-return", wire: true, pipe: true, label: "CW return", back: "CW return", ends: "none", hint: "Condenser water return (CWR): from the condensers back up to the cooling towers." }
  ];
  function isWiring() { return !!M && M.map.kind === "wiring"; }
  function isWater() { return !!M && M.map.kind === "piping"; }
  function isNet() { return isWiring() || isWater(); }                // wires or pipes: drawn as a diagram, every line shown
  // a pipe's pressure drop and velocity, as worked out (key "a>b" in the way the water goes)
  function pipeFig(k) { var c = lastWater && lastWater.edge[k], r = c && lastWater.circuits[c]; return r && r.hyd && r.hyd.ok ? r.hyd.pipe[k] : null; }
  // the words of a wire: its signal (or kind), terminals and cable; "site" when others wire it.
  // A pipe (from = the branch holding it): its label, the flow and temperature the map works out, connections and size.
  function wireText(l, rel, from) {
    var t = [l.signal || rel.label];
    if (rel.pipe && lastWater && from) {
      var fw = lastWater.dir[from + ">" + l.node], bw = lastWater.dir[l.node + ">" + from], k = fw ? from + ">" + l.node : l.node + ">" + from;
      if (fw || bw) {
        t.push(W().fmtFlow(fw || bw, lastWater.unit.flow)); if (lastWater.tEdge[k] != null) t.push(W().fmtTemp(lastWater.tEdge[k], lastWater.unit.temp));
        var pr = pipeFig(k); if (pr && !pr.missing) t.push("Δp " + W().fmtKpa(pr.dp) + (pr.v ? ", " + pr.v.toFixed(1) + " m/s" : ""));
      }
      else t.push("no flow");
    }
    if (l.from_t && l.to_t) t.push(l.from_t + " → " + l.to_t); else if (l.to_t) t.push("to " + l.to_t); else if (l.from_t) t.push("from " + l.from_t);
    if (l.cable) t.push(l.cable);
    if (l.len) t.push(l.len);
    if (l.by === "others") t.push("site");
    return t.join(" · ");
  }
  // ---------- the flow of current (wiring maps, 23 Oct 2026) ----------
  // Power flows along Power wires, whichever end a wire was added from (a user wires a new unit from its own note), from
  // branches with the special note "Source: ..." outwards, through every branch that is not open: "Switch: open" starts
  // open; Isolate / Reconnect on a card changes it for this browser only (st.iso, never saved). The flow kinds are a
  // list, so a water map later only adds its pipe kinds here.
  var FLOW_KINDS = ["w-power"], CTL_KINDS = ["w-digital", "w-bus", "w-analog"];
  var PRODUCTS = [["ahu-ec", "AHU with EC fans"], ["ahu-dc", "AHU with DC motors and drives"], ["fcu-ec", "FCU with EC motor"], ["fcu-dc", "FCU with DC motor"], ["chiller", "Chiller field connections"]];
  function W() { return window.MPWater; }
  function noteVal(n, name) { var re = new RegExp("^\\s*" + name + "\\s*:\\s*(.+)$", "i"); for (var i = 0; i < n.special.length; i++) { var m = re.exec(n.special[i]); if (m) return m[1].trim(); } return ""; }
  function isOpen(id) { var n = N(id); if (st.iso[id] != null) return st.iso[id]; return /^open/i.test(noteVal(n, "switch")); }
  function isBms(id) { return /bms/i.test(noteVal(N(id), "control")); }
  function isFire(id) { return /fire/i.test(noteVal(N(id), "control")); }
  // the flow of current, the commands and the load (mp-power.js): the simulation (isolated branches, BMS commands, night,
  // fire alarm) is this browser's only
  function power() { return window.MPPower ? window.MPPower.compute(M.nodes, { iso: st.iso, cmd: st.cmd, night: st.night, fire: st.fire }) : null; }
  // ---------- the load of a wiring map (owner, 23 Oct 2026; mp-power.js works it out) ----------
  function fmtKw(v) { return window.MPPower.fmtKw(v); }
  // a line under a branch: what it carries now, of its Max power; a warning sign when it is over or sheds; a shed load says so
  function powerLine(n) {
    var pw = lastPower; if (!pw || n.id === st.focus || !pw.part[n.id]) return null;
    var id = n.id, by = pw.shed[id], d = pw.dem[id] || 0, mx = pw.max[id], own = pw.power[id], feeds = (pw.kids[id] || []).length, t = "", warn = false;
    if (by) { t = "shed" + (own != null ? " (" + fmtKw(own) + ")" : "") + ": over the max of " + N(by).title; warn = true; }
    else if (mx != null) {
      var over = pw.over.indexOf(id) >= 0, sheds = pw.sheds[id] || 0;
      t = !pw.on[id] ? "no supply · max " + fmtKw(mx) : fmtKw(d) + " of " + fmtKw(mx) + " (" + Math.round(d / mx * 100) + " %)" + (sheds ? " · " + sheds + " shed" : "") + (over ? " · over its max" : "");
      warn = over || sheds > 0;
    }
    else if (feeds && d > 0) t = fmtKw(d);
    else if (own != null) { var s = pw.state[id]; t = fmtKw(own) + (s && s !== "running" ? " · off" : !pw.on[id] && pw.known ? " · no supply" : ""); }
    if (!t) return null;
    return el("span", { "class": "mp-wq pw" + (warn ? " warn" : ""), title: warn ? "Over its Max power: loads are shed to stay within it" : "" }, [warn ? ico("warn") : null, document.createTextNode(t)]);
  }
  // the card: what it absorbs or carries, and the boxes for its figures
  function powerCard(n, pw) {
    var id = n.id, by = pw.shed[id], d = pw.dem[id] || 0, c = pw.cdem[id], mx = pw.max[id], own = pw.power[id], feeds = (pw.kids[id] || []).length || (pw.cdem[id] && own == null);
    var says = [], pri = pw.priority[id], div = pw.diversity[id];
    if (by) says.push("Shed to keep " + N(by).title + " within its max of " + fmtKw(pw.max[by]) + (pri != null ? " (Priority " + pri + ")." : " (no Priority: shed first).") + " Lower the load there, raise its max, or give this load a lower Priority number.");
    else if (feeds || mx != null) {
      says.push("Carries " + fmtKw(d) + " now" + (c != null && c > d + 0.05 ? " (connected " + fmtKw(c) + ")" : "") + (div ? ", diversity " + div : "") + ".");
      if (mx != null) {
        var over = pw.over.indexOf(id) >= 0, sheds = pw.sheds[id] || 0;
        says.push("Max power " + fmtKw(mx) + ": " + Math.round(d / mx * 100) + " %" + (over ? ", over it with nothing left to shed." : sheds ? ", kept by shedding " + plural(sheds, "load") + " (greyed out)." : ", spare " + fmtKw(mx - d) + "."));
      }
    } else if (own != null) says.push("Absorbs " + fmtKw(own) + " when it runs" + (pri != null ? ", Priority " + pri : ", no Priority (shed first)") + ".");
    else says.push("Give it its Power (what it absorbs running) to see the loads summed up to the supply.");
    var box = el("div", { "class": "mp-power" + (by || (pw.sheds[id] || pw.over.indexOf(id) >= 0) ? " alarm" : " on") }, [el("p", { text: says.join(" ") })]);
    if (canEdit() && !st.note) {
      var fields = feeds || mx != null
        ? [{ note: "Max power", label: "Max power", unit: "kW", kind: "kw", value: mx }, { note: "Diversity", label: "Diversity", unit: "", kind: "div", value: div }]
        : [{ note: "Power", label: "Power", unit: "kW", kind: "kw", value: own }, { note: "Priority", label: "Priority", unit: "", kind: "pri", value: pri }];
      figureForm(n, fields).forEach(function (x) { box.appendChild(x); });
    }
    return box;
  }
  // ---------- water (piping maps, 23 Oct 2026) ----------
  // mp-water.js works it out from the special notes and the Close valve / Stop pump simulation (st.iso: true = shut,
  // false = opened or started here), per circuit (chilled water, condenser water), with the pressures when the pumps
  // have their head and flow; maps.js shows it: lines of figures under each branch, its card, the pipes' dots, the 2D view.
  function wFlow(q) { return W().fmtFlow(q, lastWater.unit.flow); }
  function wTemp(t) { return W().fmtTemp(t, lastWater.unit.temp); }
  function wRange(a, b) { return W().fmtTemp(a, lastWater.unit.temp).replace(/ °[CF]$/, "") + " → " + wTemp(b); }
  function wDelta(k) { return (lastWater.unit.temp === "F" ? (k * 1.8).toFixed(1) + " °F" : k.toFixed(1) + " K"); }
  function wKpa(v) { return W().fmtKpa(v); }
  function wBar(v) { return W().fmtBar(v); }
  function isPumpLike(n) { return !!noteVal(n, "pump") || !!noteVal(n, "pump head"); }
  // the circuits a branch is on (chilled water first), and its flow on any of them
  function circuitsOf(id) {
    var w = lastWater, out = []; if (!w) return out;
    ["chw", "cw"].forEach(function (c) { if (w.circuits[c] && w.circuits[c].part[id]) out.push(w.circuits[c]); });
    return out;
  }
  function anyFlow(id) { return circuitsOf(id).some(function (r) { return r.flow[id] > 0; }); }
  function isTank(id) { return circuitsOf(id).some(function (r) { return r.input.fill[id] != null; }); }
  function pressAt(r, id) { var h = r.hyd; return h && h.ok && h.abs && h.abs[id] != null ? h.abs[id] : null; }
  // one line of figures per circuit
  function waterFigures(n, compact) {
    var w = lastWater, cs = circuitsOf(n.id), lines = [];
    if (!w || !cs.length || n.id === st.focus) return lines;
    cs.forEach(function (r) {
      var id = n.id, side = r.side[id], q = r.flow[id], t = [], warn = false, h = r.hyd && r.hyd.ok ? r.hyd : null;
      var cls = side === "source" || side === "supply" ? "sup" : side === "return" ? "ret" : "unit";
      if (r.input.fill[id] != null) { t.push("fill " + wBar(r.input.fill[id])); cls = "unit"; }
      else if (side === "source") {
        var s = r.source[id];
        if (!q) t.push(r.shut[id] ? "Stopped" : "No flow");
        else {
          t.push(s.out != null && s.back != null ? wRange(s.out, s.back) : s.out != null ? "out " + wTemp(s.out) : "leaving not given");
          t.push(wFlow(q) + (s.pct != null ? " (" + Math.round(s.pct) + " %" + (s.over ? ", above design)" : ")") : ""));
          warn = !!s.over;
          if (s.kw != null && (!compact || s.capacity)) t.push(s.capacity ? kwShort(s.kw) + " of " + kwShort(s.capacity) + (s.atCap ? " (at capacity" + (s.short ? ", " + kwShort(s.short) + " short)" : ")") : "") : W().fmtKw(s.kw));
          if (s.atCap) warn = true;
        }
        if (w.noCondenser.indexOf(id) >= 0 && r.C.id === "chw") { t.push("no condenser water"); warn = true; }
      } else if (side === "unit") {
        var f = r.input.flow[id], part = r.starved[id], lim = r.limited[id];
        if (!q) { t.push(r.shut[id] ? "Valve closed" : f > 0 ? "No flow: not reached both ways" : "Flow not given"); warn = !r.shut[id] && !(f > 0); }
        else {
          t.push(part || lim ? wFlow(q) + " of " + wFlow(f) : wFlow(q));
          if (lim) { t.push("limited by " + N(lim.by).title); warn = true; }
          var ti = r.tIn[id], to = r.tOut[id];
          if (ti != null && to != null) t.push(wRange(ti, to)); else if (to != null) t.push("leaving " + wTemp(to)); else { t.push("leaving not given"); warn = true; }
          var kw = r.kw[id];
          if (kw != null) { if (!compact) t.push(W().fmtKw(kw)); if (kw <= 0) { t.push("leaving not above entering"); warn = true; } }
          if (h && h.avail[id] != null) {
            if (h.need[id] != null) { t.push("has " + wKpa(h.avail[id]) + " of " + wKpa(h.need[id]) + (part ? ": short of pressure" : "")); if (part) warn = true; }
            else t.push("has " + wKpa(h.avail[id]));
          }
          if (h && h.low.indexOf(id) >= 0) { t.push("low pressure"); warn = true; }
        }
      } else {
        if (!q) t.push(r.shut[id] ? (isPumpLike(n) ? "Stopped" : "Valve closed") : "No flow");
        else {
          var mf = r.input.maxFlow[id], at = r.limitAt[id];
          t.push(mf ? wFlow(q) + " of " + wFlow(mf) + " max" + (at ? " (wants " + wFlow(at.want) + ")" : "") : wFlow(q));
          if (at) warn = true;
          var tt = side === "supply" ? r.tSupply[id] : r.tReturn[id]; if (tt != null) t.push(wTemp(tt));
          if (r.carried[id] > 0) t.push(kwShort(r.carried[id]));
          if (h && h.pump[id]) { t.push(W().fmtHead(h.pump[id].h) + " head"); if (h.pump[id].beyond) { t.push("off its curve"); warn = true; } }
          var p = pressAt(r, id); if (p != null && !h.pump[id]) t.push(wBar(p));
          if (h && h.low.indexOf(id) >= 0) { t.push("low pressure"); warn = true; }
        }
      }
      lines.push(el("span", { "class": "mp-wq " + cls + (warn ? " warn" : "") }, [warn ? ico("warn") : null, cs.length > 1 ? el("b", { text: r.C.short + " " }) : null, document.createTextNode(t.join(" · "))]));
    });
    return lines;
  }
  // a pipe a limit shows on: "lim" downstream of a branch at its max flow, "warm" supply above the set point (a chiller at capacity)
  function waterLimit(a, b) {
    var w = lastWater; if (!w) return "";
    if (w.limEdge[a + ">" + b] || w.limEdge[b + ">" + a]) return "lim";
    var k = w.dir[a + ">" + b] ? a + ">" + b : b + ">" + a, c = w.circuits[w.edge[k]];
    if (c && c.setpoint < Infinity && w.tEdge[k] != null && c.side[a] !== "return" && c.side[b] !== "return" && w.tEdge[k] > c.setpoint + 0.3 && !(c.isUnit[a] && c.isUnit[b])) {
      var pr = N(a).links.concat(N(b).links).some(function (l) { return (l.node === a || l.node === b) && /supply$/.test(l.rel); });
      if (pr) return "warm";
    }
    return "";
  }
  function kwShort(kw) { return Math.round(kw).toLocaleString("en-US") + " kW"; }
  function waterLine(n) { var l = waterFigures(n); return l.length ? (l.length === 1 ? l[0] : el("span", { "class": "mp-wqs" }, l)) : null; }
  // where the water of a branch comes from and goes to, on one circuit
  function waterWays(r, id) {
    var from = [], to = [];
    Object.keys(r.dir).forEach(function (k) { var ab = k.split(">"); if (ab[1] === id && N(ab[0])) from.push(N(ab[0]).title); if (ab[0] === id && N(ab[1])) to.push(N(ab[1]).title); });
    return { from: from, to: to };
  }
  function names(list) { return list.length <= 3 ? list.join(", ") : list.slice(0, 3).join(", ") + " and " + (list.length - 3) + " more"; }
  function waterSays(n) {
    return circuitsOf(n.id).map(function (r) { return (circuitsOf(n.id).length > 1 ? r.C.name + ": " : "") + saysOn(r, n); }).join("\n\n");
  }
  function saysOn(r, n) {
    var w = lastWater, id = n.id, side = r.side[id], q = r.flow[id], ways = waterWays(r, id), out = [], h = r.hyd && r.hyd.ok ? r.hyd : null;
    if (r.input.fill[id] != null) {
      var at = h && h.tank && h.tank.id === id ? N(h.tank.at) : null;
      return "Expansion tank: sets " + wBar(r.input.fill[id]) + (at ? " where it joins " + at.title : "") + ", the pressure the whole circuit is counted from. It needs the static height of the highest point plus about 0.5 bar.";
    }
    if (side === "source") {
      var s = r.source[id];
      if (!q) return r.shut[id] ? "Stopped: sends no water. Start it to share the flow." : "No flow: it reaches no unit both ways (supply and return), or its pump is stopped.";
      out.push("Sends " + wFlow(q) + (s.out != null ? " at " + wTemp(s.out) : "") + (ways.to.length ? " to " + names(ways.to) : "") + ".");
      if (s.back != null) out.push("The water comes back at " + wTemp(s.back) + (s.out != null ? " (ΔT " + wDelta(s.back - s.out) + ")" : "") + ".");
      if (s.kw != null) out.push((r.C.id === "cw" ? "Rejects " : "Load ") + W().fmtKw(s.kw) + ".");
      if (s.design) out.push("Design flow " + wFlow(s.design) + ": " + Math.round(s.pct) + " %" + (s.over ? ", above its design flow." : "."));
      if (s.capacity) out.push(s.atCap ? "At its capacity of " + W().fmtKw(s.capacity) + ": it cannot hold " + wTemp(s.set) + ", so its water leaves at " + wTemp(s.out) + (s.short ? "; the units given by their load are " + W().fmtKw(s.short) + " short" : "") + ". Start another chiller, or lower the load."
        : "Capacity " + W().fmtKw(s.capacity) + ": " + Math.round((s.kw || 0) / s.capacity * 100) + " % used.");
      else if (!r.byDesign && r.sources > 1) out.push("No design flow given: the flow is shared equally between the running sources.");
      if (r.C.id === "chw" && w.reject[id] != null) out.push("Rejects " + W().fmtKw(w.reject[id]) + " to the condenser water" + (w.copAssumed.indexOf(id) >= 0 ? " (COP not given: 5.0 taken)." : "."));
      if (r.C.id === "chw" && w.noCondenser.indexOf(id) >= 0) out.push("No condenser water reaches it: start its condenser water pump, or it trips on high pressure.");
      if (h && r.input.dp[id] != null) out.push("Evaporator drop " + wKpa(r.input.dp[id] * Math.pow(q / (r.input.design[id] || q), 2)) + ".");
      return out.join(" ");
    }
    if (side === "unit") {
      var f = r.input.flow[id], part = r.starved[id];
      if (!q) return r.shut[id] ? "Valve closed: no water through it." : f > 0 ? "No flow: no running source reaches it both ways (supply and return)." : "No flow given. Give it its design water flow (Flow below, or a special note \"Flow: 12 l/s\").";
      var ti = r.tIn[id], to = r.tOut[id], kw = r.kw[id];
      out.push("Takes " + wFlow(q) + (part || r.limited[id] ? " of its " + wFlow(f) : "") + (ti != null ? " at " + wTemp(ti) : "") + (ways.from.length ? " from " + names(ways.from) : "") + ".");
      if (r.limited[id]) out.push("Limited by the max flow of " + N(r.limited[id].by).title + " (" + wFlow(r.input.maxFlow[r.limited[id].by]) + "): the units on it share it, each " + Math.round(r.limited[id].f * 100) + " % of its design flow.");
      if (to != null) out.push("Sends it back at " + wTemp(to) + (ways.to.length ? " to " + names(ways.to) : "") + (r.input.leaving[id] == null ? " (worked out from its load)" : "") + ".");
      else out.push("No leaving temperature given: it is left out of the mixed return.");
      if (kw != null) out.push((r.C.id === "cw" ? "Heat " : "Load ") + W().fmtKw(kw) + " = 4.19 × flow in l/s × ΔT" + (ti != null && to != null ? " " + wDelta(to - ti) : "") + ".");
      if (h && h.avail[id] != null) {
        var pin = h.abs ? h.abs[id] : null, pout = h.absOut ? h.absOut[id] : null;
        if (pin != null && pout != null) out.push("Pressure in " + wBar(pin) + ", out " + wBar(pout) + ".");
        if (h.need[id] == null) out.push("It has " + wKpa(h.avail[id]) + " between supply and return. Give it its pressure drop (coil and control valve at design flow) to check it is enough.");
        else if (part) out.push("It needs " + wKpa(h.need[id]) + " at its design flow but has only " + wKpa(h.avail[id]) + " (fully open): it gets " + Math.round(part * 100) + " % of its water and less cooling. Raise the pump head or speed, size the pipes up, or lower its pressure drop.");
        else out.push("It has " + wKpa(h.avail[id]) + " between supply and return and needs " + wKpa(h.need[id]) + ": its control valve takes the other " + wKpa(h.avail[id] - h.need[id]) + ".");
        if (h.index && h.index.id === id) out.push("This is the unit with the least spare pressure (the index unit).");
        if (h.low.indexOf(id) >= 0) out.push("Under 0.3 bar here: air gets in at high points. Raise the expansion tank's fill pressure.");
      } else if (r.hyd && !r.hyd.ok) out.push(r.hyd.why === "pumpdata" ? "Give every running pump its head and flow to see the pressures." : "");
      return out.join(" ");
    }
    if (!q) return r.shut[id] ? (isPumpLike(n) ? "Stopped: no water through it." : "Valve closed: no water through it.") : "No flow through it.";
    var temp = side === "supply" ? r.tSupply[id] : r.tReturn[id];
    out.push((side === "supply" ? "Carries " : "Collects ") + wFlow(q) + (temp != null ? " at " + wTemp(temp) : "") +
      (ways.from.length ? " from " + names(ways.from) : "") + (ways.to.length ? " to " + names(ways.to) : "") + ".");
    if (r.carried[id] > 0) out.push("Load " + W().fmtKw(r.carried[id]) + ": the units it " + (side === "supply" ? "feeds" : "collects from") + ".");
    if (r.input.maxFlow[id]) out.push(r.limitAt[id] ? "Max flow " + wFlow(r.input.maxFlow[id]) + ": its units want " + wFlow(r.limitAt[id].want) + ", so each gets less (amber pipes). Raise it, or size up." : "Max flow " + wFlow(r.input.maxFlow[id]) + ": " + Math.round(q / r.input.maxFlow[id] * 100) + " % used.");
    if (h && h.pump[id]) {
      var pp = h.pump[id];
      out.push("Runs at " + wFlow(pp.q) + " and " + W().fmtHead(pp.h) + " (" + wKpa(pp.h) + ") on its curve: design " + wFlow(pp.design.q) + " at " + W().fmtHead(pp.design.h) +
        (pp.speed !== 1 ? ", speed " + Math.round(pp.speed * 100) + " %" : "") + "; shut-off head about " + W().fmtHead(1.2 * pp.design.h * pp.speed * pp.speed) + "." +
        (pp.own ? " Its strainer and valves take " + wKpa(pp.own) + "." : "") + (pp.beyond ? " It runs off the end of its curve: add a pump or reduce the flow." : ""));
      if (h.abs && h.abs[id] != null) out.push("Suction " + wBar(h.abs[id]) + ", discharge " + wBar(h.absOut[id]) + ".");
    } else if (h) {
      var pa = pressAt(r, id); if (pa != null) out.push("Pressure " + wBar(pa) + ".");
      if (r.input.lift[id]) out.push("Static lift " + wKpa(r.input.lift[id]) + " (basin to nozzles, open circuit).");
      if (h.low.indexOf(id) >= 0) out.push("Under 0.3 bar here: air gets in at high points.");
    }
    return out.join(" ");
  }
  // a special note "Name: value" set (or removed when empty)
  function withNote(list, name, value) {
    var re = new RegExp("^\\s*" + name + "\\s*:", "i"), out = list.filter(function (x) { return !re.test(x); });
    if (value) out.push(name + ": " + value);
    return out;
  }
  // the figures a person types in a card, by what the branch is
  function waterFields(n) {
    var w = lastWater, cs = circuitsOf(n.id); if (!cs.length) return [];
    var r = cs[0], id = n.id, fu = w.unit.flow, fw = W().FLOW_WORD[fu], tu = w.unit.temp, tw = tu === "F" ? "°F" : "°C";
    var tOf = function (c) { return c == null ? null : tu === "F" ? c * 1.8 + 32 : c; }, qOf = function (q) { return q == null ? null : W().toUnit(q, fu); };
    if (r.input.fill[id] != null) return [{ note: "Fill pressure", label: "Fill pressure", unit: "bar", kind: "bar", value: r.input.fill[id] / 100 }];
    if (r.isPump[id]) return [{ note: "Pump head", label: "Head", unit: "m", kind: "head", value: r.input.pumpHead[id] != null ? r.input.pumpHead[id] / W().G : null },
      { note: "Pump flow", label: "Pump flow", unit: fw, kind: "flow", value: qOf(r.input.pumpFlow[id]) },
      { note: "Speed", label: "Speed", unit: "%", kind: "pct", value: noteVal(n, "speed") ? r.input.speed[id] * 100 : null }];
    if (r.isSrc[id] && r.C.id === "chw") return [{ note: "Leaving", label: "Leaving", unit: tw, kind: "temp", value: tOf(r.input.out[id]) },
      { note: "Design flow", label: "Design flow", unit: fw, kind: "flow", value: qOf(r.input.design[id]) },
      { note: "COP", label: "COP", unit: "", kind: "num", value: W().num(noteVal(n, "cop")) || null },
      { note: "Capacity", label: "Capacity", unit: "kW", kind: "kw", value: r.input.capacity[id] }];
    if (r.isSrc[id]) return [{ note: "Leaving", label: "Leaving", unit: tw, kind: "temp", value: tOf(r.input.out[id]) },
      { note: "Design flow", label: "Design flow", unit: fw, kind: "flow", value: qOf(r.input.design[id]) },
      { note: "Capacity", label: "Capacity", unit: "kW", kind: "kw", value: r.input.capacity[id] }];
    if (r.isUnit[id]) {
      var useLoad = r.input.leaving[id] == null && r.input.load[id] != null && r.C.id === "chw";
      var flowNote = cs.length > 1 && r.C.id === "cw" ? "Condenser flow" : "Flow";
      return [{ note: flowNote, label: "Flow", unit: fw, kind: "flow", value: qOf(r.input.flow[id]) },
        useLoad ? { note: "Load", label: "Load", unit: "kW", kind: "kw", value: r.input.load[id] } : { note: "Leaving", label: "Leaving", unit: tw, kind: "temp", value: tOf(r.input.leaving[id]) },
        { note: "Pressure drop", label: "Pressure drop", unit: "kPa", kind: "kpa", value: r.input.dp[id] }];
    }
    // a header, riser or pipe run: its max flow (balancing valve)
    if (!r.isSrc[id] && cs.length === 1) return [{ note: "Max flow", label: "Max flow", unit: fw, kind: "flow", value: qOf(r.input.maxFlow[id]) }];
    return [];
  }
  function waterCard(n) {
    var id = n.id, cs = circuitsOf(id), r = cs[0], q = anyFlow(id), shut = !!lastWater.shut[id], tank = isTank(id);
    var label = r.isSrc[id] ? (shut ? "Start" : "Stop") : isPumpLike(n) ? (shut ? "Start pump" : "Stop pump") : (shut ? "Open valve" : "Close valve");
    var box = el("div", { "class": "mp-power mp-water" + (q || tank ? " on" : "") }, [el("p", { "class": "mp-wsays", text: waterSays(n) }),
      tank ? null : el("button", { type: "button", "class": "btn ghost sm", text: label + " (simulation)", title: "Tries it in this browser only: nothing is saved, a reload starts again.",
        onclick: function () { st.iso[id] = !shut; peekEl = null; renderView(); } })]);
    var fields = canEdit() && !st.note ? waterFields(n) : [];
    if (fields.length) figureForm(n, fields).forEach(function (x) { box.appendChild(x); });
    return box;
  }
  // boxes for the figures of a card (water or power): each saves its special note "Name: value unit" (empty removes it)
  function figureForm(n, fields) {
    var err = el("p", { "class": "mp-err", role: "alert" }), tu = lastWater ? lastWater.unit.temp : "C";
    var inputs = fields.map(function (f) {
      var i = el("input", { "class": "input", type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": f.label, value: f.value == null || isNaN(f.value) ? "" : String(+(+f.value).toFixed(3)) });
      f.i = i; return el("label", { "class": "field mp-wfield" }, [el("span", { text: f.label + (f.unit ? " (" + f.unit + ")" : "") }), i]);
    });
    var save = el("button", { type: "button", "class": "btn sm", text: "Save", onclick: function () {
      err.textContent = "";
      var list = n.special.slice(), bad = "";
      fields.forEach(function (f) {
        if (bad) return;
        var raw = f.i.value.trim(), x = parseFloat(raw.replace(",", "."));
        if (!raw) { list = withNote(list, f.note, ""); return; }
        if (isNaN(x) || !/^-?\d+(?:[.,]\d+)?$/.test(raw)) { bad = f.label + ": type a number, for example 12.5."; return; }
        if (f.kind === "temp") { var c = tu === "F" ? (x - 32) / 1.8 : x; if (c < -20 || c > 100) { bad = "A water temperature between -20 and 100 °C."; return; } }
        else if (f.kind === "pct") { if (x < 20 || x > 110) { bad = "Speed between 20 and 110 %."; return; } }
        else if (f.kind === "num") { if (!(x > 0.5) || x > 20) { bad = "A COP between 0.5 and 20."; return; } }
        else if (f.kind === "bar") { if (!(x > 0) || x > 25) { bad = "A fill pressure between 0 and 25 bar."; return; } }
        else if (f.kind === "div") { if (!(x >= 0.1 && x <= 1)) { bad = "Diversity between 0.1 and 1 (1 = everything at once)."; return; } }
        else if (f.kind === "pri") { if (!(x >= 1 && x <= 9) || x % 1) { bad = "Priority: a whole number from 1 (kept longest) to 9."; return; } }
        else if (!(x > 0) || x > 100000) { bad = f.label + ": a value above zero."; return; }
        list = withNote(list, f.note, String(+x.toFixed(3)) + (f.unit ? " " + f.unit : ""));
      });
      if (bad) { err.textContent = bad; return; }
      if (list.length > 20) { err.textContent = "A branch holds up to 20 special notes."; return; }
      if (list.join("\n") === n.special.join("\n")) return;
      peekEl = null; setList(n, "special", list);
    } });
    fields.forEach(function (f) { f.i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); save.click(); } }); });
    return [el("div", { "class": "mp-wform" }, inputs.concat([save])), err];
  }
  // ---------- the 2D view of a piping map (owner, 23 Oct 2026; mp-schematic.js draws it) ----------
  // Every branch with a special note "Place: x, y" (headers "x, y, w, h") or on a pipe is drawn as its symbol; the pipes
  // carry their flow (dots and arrows) and words; a click shows a branch's card beside it, a double-click reads it.
  // In Edit a symbol is dragged to its place (saved as its "Place:" note, on a 10 px grid).
  var sxDrag = null, sxMoved = false, lastSx = null;
  function placeOf(n) {
    var v = noteVal(n, "place"); if (!v) return null;
    var m = v.match(/-?\d+(?:\.\d+)?/g); if (!m || m.length < 2) return null;
    return { x: +m[0], y: +m[1], w: m[2] ? +m[2] : 0, h: m[3] ? +m[3] : 0 };
  }
  // the 2D view of a wiring map: a single-line diagram of what is at the centre (the whole building, or a unit opened
  // alone with what it joins outside). A unit with its own diagram is one symbol in the building's drawing; the wires to
  // its parts end on it. Branches without a place are set out by MPSchematic.layout from the power wires.
  function wiringParts() {
    var pw = power(), S = window.MPSigns, items = [], drawn = {}, path = pathOf(st.focus), onPath = {}, inScope = {};
    lastPower = pw;
    path.forEach(function (id) { onPath[id] = 1; });
    var wired = {};
    Object.keys(M.nodes).forEach(function (id) {
      (N(id).links || []).forEach(function (l) { if (l.kind === "node" && N(l.node) && /^w-/.test(relOf(l).id)) { wired[id] = 1; wired[l.node] = 1; } });
    });
    // what stands for a branch in the drawing: itself, or the unit (a branch with its own diagram) it is part of
    function rep(id) {
      var p = pathOf(id), r = id;
      for (var i = 0; i < p.length - 1; i++) { var a = p[i]; if (!onPath[a] && colsOf(N(a))) { r = a; break; } }
      return r;
    }
    function hasWires(id) { var x = false; each(id, function (n) { if (wired[n.id]) x = true; }); return x; }
    (function walk(id, top) {
      var n = N(id);
      if (!top) {
        if (wired[id] || placeOf(n) || (colsOf(n) && hasWires(id))) inScope[id] = 1;
        if (colsOf(n)) return;                     // a unit's own diagram: one symbol here
      }
      n.kids.forEach(function (k) { walk(k, false); });
    })(st.focus, true);
    // in the order of the names, not of the tree: arranging the map's branches never changes the 2D view
    var byName = Object.keys(M.nodes).sort(function (a, b) { return N(a).title.localeCompare(N(b).title, undefined, { numeric: true }) || (a < b ? -1 : 1); });
    var pairs = {}, pipes = [], outside = {};
    byName.forEach(function (id) {
      (N(id).links || []).forEach(function (l) {
        var rel = relOf(l); if (l.kind !== "node" || !N(l.node) || !/^w-/.test(rel.id)) return;
        var a = rep(id), b = rep(l.node);
        if (a === b || (!inScope[a] && !inScope[b])) return;
        [a, b].forEach(function (x) { if (!inScope[x]) outside[x] = 1; });
        var power = FLOW_KINDS.indexOf(rel.id) >= 0, key = (a < b ? a + b : b + a) + rel.id;
        var live = power && pw && pw.known ? !!pw.on[id] && !!pw.on[l.node] : !power;
        var child = power && pw ? (!pw.known ? l.node : pw.from[l.node] === id ? l.node : pw.from[id] === l.node ? id : null) : null;
        var flowing = !!child && (!pw.known || !!pw.draw[child]);
        var pulse = !power && pw ? (pw.commands(id, l.node) ? 1 : pw.commands(l.node, id) ? -1 : 0) : 0;
        var q = flowing ? (child === l.node ? 1 : -1) : 0;
        if (pairs[key]) { var o = pairs[key]; if (!o.q && q) o.q = (o.a === a) === (q > 0) ? 1 : -1; o.live = o.live || live; if (!o.pulse && pulse) o.pulse = (o.a === a) === (pulse > 0) ? 1 : -1; return; }
        var chosen = st.sel === id || st.sel === l.node || st.sel === a || st.sel === b, full = wireText(l, rel, id), other = b;
        pipes.push(pairs[key] = { a: a, b: b, rel: rel.id, q: q, live: live, pulse: pulse, minor: !power, shed: power && !!(pw && (pw.shed[id] || pw.shed[l.node])), speed: "0.9", chosen: chosen,
          label: chosen ? full : [l.signal || rel.label, l.cable || ""].filter(Boolean).join(" · "), title: full,
          go: function () { flush(); st.sel = other; st.peek = other; renderView(); } });
      });
    });
    byName.filter(function (id) { return inScope[id] || outside[id]; }).forEach(function (id) {
      if (drawn[id]) return; drawn[id] = 1;
      var n = N(id), pl = placeOf(n);
      if (sxDrag && sxDrag.id === id && sxDrag.moved) pl = { x: sxDrag.x, y: sxDrag.y, w: sxDrag.w, h: sxDrag.h };
      var kind = S ? S.of(n) : "";
      items.push({ id: id, kind: kind, place: pl, sign: kind && S ? S.svg(kind) : "", title: n.title, sel: st.sel === id, outside: !!outside[id],
        dead: !!(pw && pw.known && pw.part[id] && !pw.on[id]), warn: !!(pw && (pw.sheds[id] || pw.over.indexOf(id) >= 0 || pw.shed[id])) });
    });
    // how far from a source along the power wires (switches as drawn, not as tried): the order of the rows
    var adj = {}, far = {}, q = [];
    byName.forEach(function (id) {
      (N(id).links || []).forEach(function (l) { if (l.kind === "node" && N(l.node) && FLOW_KINDS.indexOf(l.rel) >= 0) { var a = rep(id), b = rep(l.node); (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); } });
    });
    byName.forEach(function (id) { var v = noteVal(N(id), "source"); if (v) { var r = rep(id); if (far[r] == null) { far[r] = /standby|generator/i.test(v) ? 0.5 : 0; q.push(r); } } });
    q.sort(function (a, b) { return far[a] - far[b]; });
    while (q.length) { var x = q.shift(); (adj[x] || []).forEach(function (y) { if (far[y] == null) { far[y] = Math.floor(far[x]) + 1; q.push(y); } }); }
    window.MPSchematic.layout(items, pipes.map(function (p) { return { a: p.a, b: p.b, power: !p.minor }; }), function (id) { return far[id] == null ? 1e6 : far[id]; });
    return { items: items, pipes: pipes, pw: pw };
  }
  function wireState(pw, id) {
    if (!pw) return null;
    var s = pw.cmd[id] ? pw.state[id] : pw.known && pw.part[id] && !pw.on[id] ? "nopower" : "";
    var txt = { running: "running", stopped: "stopped by the BMS", night: "off at night", nopower: "no supply", fire: "stopped by the fire alarm", interlock: "stopped: interlock" }[s];
    if (pw.fires.indexOf(id) >= 0 && st.fire) { s = "alarm"; txt = "FIRE ALARM"; }
    return txt ? el("span", { "class": "mp-wq sx-st " + (s === "running" ? "run" : "stop"), text: txt }) : null;
  }
  function renderSchematic() {
    var stage = $("mpStage"), canvas = $("mpCanvas"), w = lastWater, items = [], drawn = {}, S = window.MPSigns;
    stage.textContent = ""; stage.classList.add("mp-pipes");
    if (isWiring()) {
      var wp = wiringParts();
      lastSx = window.MPSchematic.draw(stage, { items: wp.items, pipes: wp.pipes, pipeLabels: st.sxLabels, flowOn: st.flow, edit: st.edit && canEdit(), el: el,
        habit: { chiller: "tb", ahu: "tb", fcu: "tb", breaker: "tb", transformer: "tb", generator: "tb", utility: "tb" },
        label: function (id) { var n = N(id); return [el("b", { text: n.title }), powerLine(n), wireState(wp.pw, id)]; } });
      return schematicFrame(lastSx);
    }
    each(M.root, function (n) {
      if (n.id === M.root) return;
      var pl = placeOf(n);
      if (!pl && !(w && w.part[n.id])) return;
      if (sxDrag && sxDrag.id === n.id && sxDrag.moved) pl = { x: sxDrag.x, y: sxDrag.y, w: pl ? pl.w : 0, h: pl ? pl.h : 0 };
      var kind = S ? S.of(n) : "";
      items.push({ id: n.id, kind: kind, place: pl, sign: kind && S ? S.svg(kind) : "", title: n.title, sel: st.sel === n.id,
        dead: !!(w && w.part[n.id] && !anyFlow(n.id) && !isTank(n.id)),
        warn: circuitsOf(n.id).some(function (r) { return (r.source[n.id] && r.source[n.id].atCap) || r.limitAt[n.id] || r.limited[n.id]; }) });
      drawn[n.id] = 1;
    });
    var pipes = [], qMax = 1e-9, chw = w && w.circuits.chw;
    if (w) Object.keys(w.dir).forEach(function (k) { qMax = Math.max(qMax, w.dir[k]); });
    var mode = st.sxLabels;
    each(M.root, function (n) {
      (n.links || []).forEach(function (l) {
        var rel = relOf(l); if (l.kind !== "node" || !rel.pipe || !drawn[n.id] || !drawn[l.node]) return;
        var fw = w ? w.dir[n.id + ">" + l.node] : 0, bw = w ? w.dir[l.node + ">" + n.id] : 0, q = fw || (bw ? -bw : 0);
        var chosen = st.sel === n.id || st.sel === l.node, full = wireText(l, rel, n.id);
        var short = [l.signal || rel.label, q ? W().fmtFlow(Math.abs(q), w.unit.flow) : "no flow", l.cable || ""].filter(Boolean).join(" · ");
        // a unit's 2-way control valve sits on its chilled water return
        var valveAt = rel.id === "p-return" && chw ? (chw.isUnit[n.id] ? "a" : chw.isUnit[l.node] ? "b" : null) : null;
        var other = l.node;
        pipes.push({ a: n.id, b: l.node, rel: rel.id, q: q, speed: (1.9 - 1.3 * Math.min(1, Math.abs(q) / qMax)).toFixed(2), chosen: chosen,
          label: chosen ? full : short, title: full, valveAt: valveAt, lim: q && waterLimit(n.id, l.node) === "lim", warm: q && waterLimit(n.id, l.node) === "warm", go: function () { flush(); st.sel = other; st.peek = other; renderView(); } });
      });
    });
    var res = window.MPSchematic.draw(stage, { items: items, pipes: pipes, pipeLabels: mode, flowOn: st.flow, edit: st.edit && canEdit(), el: el,
      label: function (id) { var n = N(id); return [el("b", { text: n.title })].concat(waterFigures(n, true)); } });
    lastSx = res;
    schematicFrame(res);
  }
  // ---------- add equipment from what feeds it (Flow and 2D views, map editors; owner, 23 Oct 2026: the Flow replaces
  // the Tree on water and electrical maps, so equipment is added where it is fed) ----------
  // The new branch goes under the board, riser or branch pipe that feeds it (the feed tree), made like the last one there:
  // its special notes (but its place), its feeder or supply pipe and return pipe of the same size, its control wires (BMS,
  // fire alarm). All its links are kept on the new branch (a board or riser may hold 12 already).
  function nextName(t) {
    var m = /^(.*?)(\d{2,})(.*)$/.exec(t || ""); if (!m) return "";
    var v = String(+m[2] + 1); while (v.length < m[2].length) v = "0" + v;
    return m[1] + v + m[3];
  }
  function linksBetween(a, b) {
    var out = [];
    (N(a).links || []).forEach(function (l) { if (l.kind === "node" && l.node === b) out.push(l); });
    (N(b).links || []).forEach(function (l) { if (l.kind === "node" && l.node === a) out.push(l); });
    return out;
  }
  function feedForm(n, pw) {
    if (!canEdit() || st.note || (st.view !== "flow" && st.view !== "schematic")) return null;
    var water = isWater(), c = null;
    if (water) { c = circuitsOf(n.id).filter(function (r) { return r.side[n.id] === "supply" && !r.isPump[n.id]; })[0]; if (!c) return null; }
    else if (!(pw && pw.part[n.id] && !noteVal(n, "source") && ((pw.kids[n.id] || []).length || pw.max[n.id] != null || /panel|breaker/.test(signOf(n))))) return null;
    var like = null;
    n.kids.slice().reverse().some(function (k) { var ok = water ? c.isUnit[k] : pw.part[k] && pw.from[k] === n.id; if (ok) like = N(k); return ok; });
    var fu = lastWater ? lastWater.unit.flow : "lps", fw = water ? W().FLOW_WORD[fu] : "", tu = lastWater && lastWater.unit.temp === "F" ? "°F" : "°C";
    var name = el("input", { "class": "input", type: "text", maxlength: "120", autocomplete: "off", "aria-label": "Name", placeholder: water ? "e.g. AHU-05, Level 3" : "e.g. AHU-05, Level 3", value: like ? nextName(like.title) : "" });
    var f1 = el("input", { "class": "input", type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": water ? "Flow" : "Power" });
    var f2 = water ? el("input", { "class": "input", type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": "Leaving" }) : null;
    if (like) {
      if (water) { var lf = c.input.flow[like.id], ll = c.input.leaving[like.id]; if (lf != null) f1.value = String(+W().toUnit(lf, fu).toFixed(2)); if (ll != null) f2.value = String(+(tu === "°F" ? ll * 1.8 + 32 : ll).toFixed(1)); }
      else if (pw.power[like.id] != null) f1.value = String(+pw.power[like.id].toFixed(2));
    }
    // water: the return it joins (that of the last unit here, else a choice of the return branches)
    var retSel = null, retOf = null, retRel = c ? c.C.ret : null;
    if (water) {
      if (like) Object.keys(c.part).some(function (id) { var x = linksBetween(like.id, id).filter(function (l) { return l.rel === retRel; })[0]; if (x) retOf = id; return !!x; });
      if (!retOf) {
        var rets = Object.keys(c.part).filter(function (id) { return c.side[id] === "return" && !c.isPump[id]; });
        if (!rets.length) return null;
        retSel = el("select", { "class": "input", "aria-label": "Return to" }, rets.map(function (id) { return el("option", { value: id, text: N(id).title }); }));
      }
    }
    var err = el("p", { "class": "mp-err", role: "alert" });
    var add = el("button", { type: "button", "class": "btn sm", text: "Add", onclick: function () {
      err.textContent = "";
      var title = name.value.replace(/\s+/g, " ").trim(), v1 = parseFloat(f1.value.replace(",", ".")), v2 = f2 ? parseFloat(f2.value.replace(",", ".")) : NaN;
      if (!title) { err.textContent = "Give it a name."; name.focus(); return; }
      if (N(n.id).kids.some(function (k) { return N(k).title.toLowerCase() === title.toLowerCase(); })) { err.textContent = "There is one with that name here already."; return; }
      if (f1.value.trim() && !(v1 > 0)) { err.textContent = (water ? "Flow" : "Power") + ": a number above zero."; return; }
      if (f2 && f2.value.trim() && isNaN(v2)) { err.textContent = "Leaving: a temperature, for example 13."; return; }
      var special = like ? like.special.filter(function (x) { return !/^\s*(place|icon)\s*:/i.test(x); }) : [];
      if (water) {
        if (f1.value.trim()) special = withNote(special, "Flow", +v1.toFixed(3) + " " + fw);
        if (f2 && f2.value.trim()) special = withNote(withNote(special, "Load", ""), "Leaving", +v2.toFixed(2) + " " + tu);
      } else if (f1.value.trim()) special = withNote(special, "Power", +v1.toFixed(3) + " kW");
      var links = [], copy = function (l, other) { var x = { kind: "node", node: other, rel: l.rel }; ["from_t", "to_t", "cable", "signal", "len", "by"].forEach(function (k) { if (l[k] && k !== "from_t" && k !== "to_t") x[k] = l[k]; }); return x; };
      if (water) {
        var sp = like ? linksBetween(like.id, n.id).filter(function (l) { return l.rel === c.C.sup; })[0] : null;
        links.push(sp ? copy(sp, n.id) : { kind: "node", node: n.id, rel: c.C.sup, signal: c.C.id === "cw" ? "CWS" : "CHWS", by: "others" });
        var ret = retOf || retSel.value, rp = like && retOf ? linksBetween(like.id, retOf).filter(function (l) { return l.rel === retRel; })[0] : null;
        links.push(rp ? copy(rp, ret) : { kind: "node", node: ret, rel: retRel, signal: c.C.id === "cw" ? "CWR" : "CHWR", by: "others" });
      } else {
        var fp2 = like ? linksBetween(like.id, n.id).filter(function (l) { return l.rel === "w-power"; })[0] : null;
        links.push(fp2 ? copy(fp2, n.id) : { kind: "node", node: n.id, rel: "w-power", by: "others" });
        if (like) Object.keys(M.nodes).forEach(function (id) {
          if (id === like.id || id === n.id) return;
          linksBetween(like.id, id).forEach(function (l) { if (CTL_KINDS.indexOf(l.rel) >= 0 && links.length < 12) links.push(copy(l, id)); });
        });
      }
      add.disabled = true;
      settled().then(function () { return Api.mpNodeAdd(T, n.id, title); }).then(function (r) {
        return Api.mpNodeSave(T, r.node.id, { special: special, links: links }).then(function () { return r.node; });
      }).then(function (made) {
        return reload(function () { st.sel = made.id; st.peek = made.id; }).then(function () {
          Hub.toast(title + " added, fed from " + n.title + (like ? ", like " + like.title : "") + ". To verify." + (water && isWater() && st.view === "schematic" ? " Drag it to its place in Edit." : ""));
        });
      }, function (e2) { add.disabled = false; err.textContent = e2.message; });
    } });
    var inputs = [el("label", { "class": "field mp-wfield" }, [el("span", { text: "Name" }), name]),
      el("label", { "class": "field mp-wfield" }, [el("span", { text: water ? "Flow (" + fw + ")" : "Power (kW)" }), f1])];
    if (f2) inputs.push(el("label", { "class": "field mp-wfield" }, [el("span", { text: "Leaving (" + tu + ")" }), f2]));
    if (retSel) inputs.push(el("label", { "class": "field mp-wfield" }, [el("span", { text: "Returns to" }), retSel]));
    [name, f1, f2].forEach(function (i) { if (i) i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add.click(); } }); });
    return el("div", { "class": "mp-power mp-feed" }, [
      el("p", { text: (water ? "Add a unit fed from here" : "Add equipment fed from here") + (like ? ": made like " + like.title + (water ? " (same pipes, returning to " + (retOf ? N(retOf).title : "") + ")" : " (same feeder, its BMS and fire alarm wires)") + "." : ".") }),
      el("div", { "class": "mp-wform" }, inputs.concat([add])), err]);
  }
  // ---------- the Flow view of a water or electrical map (owner, 23 Oct 2026: "imagine you are a drop of water or an
  // electron: every place you stop on the way should be in the map, always going forward; an incredible way to close a
  // loop"; mp-flow.js lays it out). The equipment the 2D view draws, as the map's branches, in the order the water or
  // the current reaches them: each line as thick as what it carries, water coloured by its temperature (cold supply to
  // warm return), each loop closing round its lane back into its source, with what the source does to the water on it.
  // Click a branch: its whole way lights up and the strip above follows one drop (or the current) stop by stop.
  // Nothing here moves or changes the 2D view: it reads the same pipes, wires and figures and saves nothing.
  var lastFlow = null;
  function flowParts() {
    var nodes = [], edges = [];
    if (isWiring()) {
      var wp = wiringParts(), inPower = {};
      wp.pipes.forEach(function (p) { if (!p.minor) inPower[p.a] = inPower[p.b] = 1; });
      wp.items.forEach(function (it) { nodes.push({ id: it.id, lane: inPower[it.id] ? "power" : "controls", source: noteVal(N(it.id), "source") ? { power: true } : null, outside: it.outside }); });
      wp.pipes.forEach(function (p) {
        var back = p.q < 0;
        edges.push({ a: back ? p.b : p.a, b: back ? p.a : p.b, minor: p.minor, circuit: "power", p: p, pulse: back ? -p.pulse : p.pulse });
      });
      return { nodes: nodes, edges: edges, lanes: ["power", "controls"], pw: wp.pw };
    }
    var w = lastWater; if (!w) return null;
    var inFocus = {}, drawn = {}, outside = {};
    each(st.focus, function (n) { if (n.id !== st.focus || st.focus !== M.root) inFocus[n.id] = 1; });
    Object.keys(w.part).forEach(function (id) { if (N(id) && inFocus[id]) drawn[id] = 1; });
    var seenPipe = {};
    Object.keys(M.nodes).forEach(function (id) {
      (N(id).links || []).forEach(function (l) {
        var rel = relOf(l); if (l.kind !== "node" || !rel.pipe || !N(l.node) || (!drawn[id] && !drawn[l.node])) return;
        var key = [id, l.node].sort().join("|") + rel.id; if (seenPipe[key]) return; seenPipe[key] = 1;
        [id, l.node].forEach(function (x) { if (!drawn[x]) outside[x] = 1; });
        var fw = w.dir[id + ">" + l.node], bw = w.dir[l.node + ">" + id], a = bw && !fw ? l.node : id, b = a === id ? l.node : id;
        edges.push({ a: a, b: b, circuit: /^p-cw-/.test(rel.id) ? "cw" : "chw", rel: rel, l: l, q: fw || bw || 0, owner: id });
      });
    });
    var chw = w.circuits.chw, cw = w.circuits.cw;
    Object.keys(drawn).concat(Object.keys(outside)).forEach(function (id) {
      var src = chw && chw.isSrc[id] ? { chw: true } : cw && cw.isSrc[id] ? { cw: true } : null;
      nodes.push({ id: id, source: src, outside: !!outside[id], lane: src ? Object.keys(src)[0] : chw && chw.part[id] ? "chw" : "cw" });
    });
    return { nodes: nodes, edges: edges, lanes: ["cw", "chw"] };
  }
  // the time a drop takes along one pipe: its water volume over the flow (pipe bore and length; nothing for coils)
  function pipeSeconds(l, q) {
    var d = W().dnOf(l && l.cable), len = W().lengthOf(l && l.len);
    if (!d || !d.d || len == null || !(q > 0)) return null;
    return Math.PI * d.d * d.d / 4 * len / (q / 1000);
  }
  function fmtTime(sec) { if (sec == null) return ""; if (sec < 60) return Math.round(sec) + " s"; var m = Math.floor(sec / 60), r = Math.round(sec - m * 60); return m + " min" + (r ? " " + r + " s" : ""); }
  function renderFlow() {
    var stage = $("mpStage"), fp = flowParts(), svg = svgEl("svg", { "class": "mp-fsvg" });
    stage.textContent = ""; stage.classList.toggle("mp-pipes", isWater()); stage.appendChild(svg);
    var journeyBox = $("mpJourney"); journeyBox.textContent = ""; journeyBox.hidden = true;
    if (!fp || !fp.nodes.length) {
      stage.appendChild(el("p", { "class": "mp-fempty", text: isWater() ? "Nothing flows here yet: join the equipment with pipes (a branch's note, Add link > Another branch)." : "Nothing is wired here yet: join the equipment with Power wires (a branch's note, Add link > Another branch)." }));
      lastFlow = null; return schematicFrame({ w: 640, h: 160, box: {} }, true);
    }
    var pw = fp.pw || null, els = {};
    fp.nodes.forEach(function (x) {
      var n = N(x.id), e = nodeEl(n, "mp-n mp-fn" + (x.outside ? " mp-fout" : ""));
      if (pw) {
        if (pw.part[x.id] && pw.known && !pw.on[x.id]) e.classList.add("mp-dead");
        if (pw.shed[x.id]) e.classList.add("mp-shed");
        if (pw.sheds[x.id] || pw.over.indexOf(x.id) >= 0) e.classList.add("mp-over");
        if (pw.cmd[x.id] && pw.state[x.id]) e.classList.add(pw.state[x.id] === "running" ? "mp-run" : "mp-stop");
      } else if (lastWater) {
        if (!anyFlow(x.id) && !isTank(x.id)) e.classList.add("mp-dead");
        if (circuitsOf(x.id).some(function (r) { return (r.source[x.id] && r.source[x.id].atCap) || r.limitAt[x.id]; })) e.classList.add("mp-over");
      }
      if (x.id === st.sel) e.classList.add("mp-sel");
      stage.appendChild(e); els[x.id] = e;
    });
    fp.nodes.forEach(function (x) { x.w = els[x.id].offsetWidth; x.h = els[x.id].offsetHeight; });
    var L = window.MPFlow.layout(fp.nodes, fp.edges, fp.lanes, [150, 30]);
    // room for the loops: those of the first lane run above it (with two lanes), the others below theirs
    var side = function (lane) { return L.lanes.length > 1 && L.lanes[0].id === lane ? "top" : "bottom"; };
    var count = {}; L.mirrors.forEach(function (m) { var k = m.lane + side(m.lane); count[k] = (count[k] || 0) + 1; });
    var shift = 34 + (L.lanes.length > 1 && count[L.lanes[0].id + "top"] ? 26 + count[L.lanes[0].id + "top"] * 26 : 0);
    var mirAt = {};
    Object.keys(L.pos).forEach(function (id) { L.pos[id].y += shift; L.pos[id].x += 30; });
    L.mirrors.forEach(function (m) { m.y += shift; m.x += 30; mirAt[m.id] = m; });
    L.lanes.forEach(function (b) { b.y += shift; });
    var W2 = L.w + 110, H2 = L.h + shift;
    Object.keys(els).forEach(function (id) { var p = L.pos[id]; if (!p) { els[id].remove(); delete els[id]; return; } els[id].style.left = p.x + "px"; els[id].style.top = p.y + "px"; });
    // what each line carries, for its width; water's temperatures for its colour
    var qMax = 1e-9, tRange = {};
    fp.edges.forEach(function (e) {
      if (pw) { if (!e.minor) qMax = Math.max(qMax, pw.dem[e.b] || 0); return; }
      qMax = Math.max(qMax, e.q || 0);
      var t = lastWater.tEdge[e.a + ">" + e.b]; if (t == null) return;
      var r = tRange[e.circuit] = tRange[e.circuit] || { lo: t, hi: t }; r.lo = Math.min(r.lo, t); r.hi = Math.max(r.hi, t);
    });
    function weight(e) { return pw ? (e.minor ? 0 : pw.dem[e.b] || 0) : e.q || 0; }
    var sel = st.sel && (L.pos[st.sel]) ? st.sel : null, down = {}, up = {};
    L.edges.forEach(function (le) { if (le.minor) return; var t = le.to || le.b; (down[le.a] = down[le.a] || []).push({ to: t, e: le }); (up[t] = up[t] || []).push({ from: le.a, e: le }); });
    // the way of the chosen branch: everything that reaches it, everything it reaches (to the loop's end)
    var lit = null;
    if (sel) {
      // (water: within the circuit the chosen branch belongs to; a chiller lights its chilled water, a cooling tower its condenser water)
      var cc = null;
      if (!pw) { var cs0 = circuitsOf(sel), s0 = cs0.filter(function (r) { return r.isSrc[sel]; })[0]; cc = s0 ? s0.C.id : cs0.length === 1 ? cs0[0].C.id : null; }
      var okE = function (x) { return !cc || !x.e.src || x.e.src.circuit === cc; };
      lit = {}; lit[sel] = 1;
      var q1 = [sel, sel + "~loop"]; lit[sel + "~loop"] = !!mirAt[sel + "~loop"];
      while (q1.length) { var a1 = q1.shift(); (up[a1] || []).forEach(function (x) { if (okE(x) && !lit[x.from]) { lit[x.from] = 1; q1.push(x.from); } }); }
      var q2 = [sel];
      while (q2.length) { var a2 = q2.shift(); (down[a2] || []).forEach(function (x) { if (okE(x) && !lit[x.to]) { lit[x.to] = 1; if (!mirAt[x.to]) q2.push(x.to); } }); }
      Object.keys(els).forEach(function (id) { if (!lit[id]) els[id].classList.add("mp-fdim"); });
    }
    var layer = { pipes: svgEl("g", {}), dots: svgEl("g", {}), ctl: svgEl("g", {}) };
    svg.appendChild(layer.ctl); svg.appendChild(layer.pipes); svg.appendChild(layer.dots);
    var chips = [];
    L.edges.forEach(function (le) {
      var e = le.src, A = L.pos[le.a], B = le.to ? mirAt[le.to] : L.pos[le.b];
      if (!A || !B || !e) return;
      var mine = sel && (le.a === sel || le.b === sel);
      if (le.minor) {                                   // a control line: from below, only for the chosen branch or with Wires: all
        if (!mine) return;
        var cx1 = A.x + A.w / 2, cy1 = A.y, cx2 = B.x + B.w / 2, cy2 = B.y + B.h;
        if (A.y < B.y) { cx1 = A.x + A.w / 2; cy1 = A.y + A.h; cx2 = B.x + B.w / 2; cy2 = B.y; }
        var dm = "M" + cx1 + " " + cy1 + "C" + cx1 + " " + (cy1 + cy2) / 2 + "," + cx2 + " " + (cy1 + cy2) / 2 + "," + cx2 + " " + cy2;
        var pc = svgEl("path", { d: dm, "class": "fx ctl x-" + e.p.rel + (lit && !mine ? " fdim" : "") }); layer.ctl.appendChild(pc);
        if (e.pulse && st.flow) layer.dots.appendChild(svgEl("path", { d: dm, "class": "mpx-pulse" + (e.pulse < 0 ? " rev" : "") }));
        return;
      }
      var x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, dx = Math.max(30, (x2 - x1) / 2);
      var d = "M" + x1 + " " + y1 + "C" + (x1 + dx) + " " + y1 + "," + (x2 - dx) + " " + y2 + "," + x2 + " " + y2;
      var wgt = weight(e), on = lit ? (lit[le.a] && lit[le.to || le.b]) : true;
      var cls = "fx", style = "";
      if (pw) {
        cls += " pow" + (e.p.shed ? " shed" : e.p.q || e.p.live ? "" : " off");
      } else {
        cls += e.rel.id === "p-return" || e.rel.id === "p-cw-return" ? " ret" : "";
        if (!e.q) cls += " off";
        else {
          var lim = waterLimit(e.a, e.b); if (lim === "lim") cls += " lim";
          var t = lastWater.tEdge[e.a + ">" + e.b], r = tRange[e.circuit];
          if (t != null && r && lim !== "lim") {
            var pct = r.hi - r.lo > 0.05 ? Math.round((t - r.lo) / (r.hi - r.lo) * 100) : 0;
            style = "stroke: color-mix(in srgb, " + (e.circuit === "cw" ? "var(--danger) " + pct + "%, var(--warn)" : "var(--brand-sky) " + pct + "%, var(--brand)") + ");";
          }
        }
      }
      var sw = (wgt > 0 ? 2 + 7 * Math.min(1, wgt / qMax) : 1.6).toFixed(1);
      var path = svgEl("path", { d: d, "class": cls + (lit && !on ? " fdim" : ""), style: style + "stroke-width:" + sw + "px" });
      layer.pipes.appendChild(path);
      var flowing = pw ? !!e.p.q : !!e.q;
      if (flowing && st.flow) {
        var dots = svgEl("path", { d: d, "class": "mpx-flow" + (lit && !on ? " fdim" : "") });
        dots.style.animationDuration = pw ? "0.9s" : (1.9 - 1.3 * Math.min(1, wgt / qMax)).toFixed(2) + "s";
        layer.dots.appendChild(dots);
      }
      if (mine && st.xlinks !== "off") {                // the words of the chosen branch's lines, half way
        var txt = pw ? (e.p.title || e.p.label) : wireText(e.l, e.rel, e.owner);
        chips.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, text: txt, rel: pw ? e.p.rel : e.rel.id, go: e.a === sel ? (le.to ? le.to.replace(/~loop$/, "") : le.b) : le.a });
      }
    });
    // the loops close: out of the mirror, round the lane, back into the source
    var k0 = {};
    L.mirrors.forEach(function (m) {
      var S = L.pos[m.of]; if (!S) return;
      var lb = L.lanes.filter(function (b) { return b.id === m.lane; })[0], sd = side(m.lane), key = m.lane + sd, k = k0[key] = (k0[key] || 0) + 1;
      var yr = sd === "bottom" ? lb.y + lb.h + 6 + k * 26 : lb.y - 6 - k * 26;
      var xr = m.x + m.w + 10 + k * 8, xl = S.x - 10 - k * 8, ym = m.y + m.h / 2, ys = S.y + S.h / 2;
      var d = "M" + (m.x + m.w) + " " + ym + "H" + xr + "V" + yr + "H" + xl + "V" + ys + "H" + S.x;
      var src = circuitsOf(m.of).filter(function (r) { return r.source[m.of]; })[0], x = src ? src.source[m.of] : null, on2 = lit ? lit[m.of] && lit[m.id] : true;
      var cls2 = "fx loop " + (src && src.C.id === "cw" ? "cw" : pw ? "pow" : "chw") + (x && x.q > 0 ? "" : " off") + (lit && !on2 ? " fdim" : "");
      svg.appendChild(svgEl("path", { d: d, "class": cls2 }));
      if (x && x.q > 0 && st.flow) { var dd = svgEl("path", { d: d, "class": "mpx-flow slow" + (lit && !on2 ? " fdim" : "") }); svg.appendChild(dd); }
      var words = "↺ back into " + N(m.of).title + (x && x.q > 0 && x.back != null && x.out != null ? ": " + (src.C.id === "cw" ? "cooled " : "chilled ") + wRange(x.back, x.out) + (x.kw != null ? " · " + kwShort(x.kw) : "") + (x.atCap ? " · at capacity" : "") : x && !(x.q > 0) ? " (stopped)" : "");
      var lab = el("button", { type: "button", "class": "mp-xl mp-looplab" + (x && x.atCap ? " warn" : "") + (lit && !on2 ? " mp-fdim" : ""), text: words, title: "The loop closes here: the water goes back into " + N(m.of).title + " and round again",
        onclick: function () { flush(); st.sel = m.of; st.peek = m.of; renderView(); } });
      stage.appendChild(lab);
      lab.style.left = Math.max(xl + 10, (xl + xr) / 2 - lab.offsetWidth / 2) + "px"; lab.style.top = (yr - 11) + "px";
      W2 = Math.max(W2, xr + 30); H2 = Math.max(H2, yr + 40);
      // the mirror: where the loop ends, the same branch as where it starts
      var me = el("div", { "class": "mp-mirror" + (lit && !on2 ? " mp-fdim" : "") + (src && src.C.id === "cw" ? " cw" : ""), "data-node": m.of, title: "Back into " + N(m.of).title + ": the loop closes" }, [el("span", { text: "↺ " + N(m.of).title })]);
      me.style.left = m.x + "px"; me.style.top = m.y + "px"; me.style.width = m.w + "px";
      stage.appendChild(me);
    });
    // the lanes: what runs in them, all of it at once
    L.lanes.forEach(function (b) {
      var sd = side(b.id), n2 = count[b.id + sd] || 0, ty = sd === "top" && n2 ? b.y - 34 - n2 * 26 : b.y - 30;
      var t = laneWords(b.id, fp);
      var le2 = el("div", { "class": "mp-lane " + b.id }, [el("b", { text: t[0] }), t[1] ? document.createTextNode(" · " + t[1]) : null]);
      le2.style.left = "30px"; le2.style.top = Math.max(2, ty) + "px";
      stage.appendChild(le2);
    });
    chips.forEach(function (c, i) {
      var b2 = el("button", { type: "button", "class": "mp-xl x-" + c.rel, text: c.text, title: c.text, onclick: function () { flush(); st.sel = c.go; st.peek = null; renderView(); } });
      b2.style.left = c.x + "px"; b2.style.top = (c.y - 10 + (i % 2 ? 14 : -14)) + "px"; stage.appendChild(b2);
    });
    var box = {}; Object.keys(L.pos).forEach(function (id) { box[id] = L.pos[id]; });
    // not connected yet: equipment under the centre on no pipe or wire (a branch just added), so nothing goes missing
    var loose = [];
    each(st.focus, function (n) { if (n.id !== st.focus && !n.kids.length && !L.pos[n.id] && !els[n.id] && (signOf(n) || !n.notes)) loose.push(n); });
    if (loose.length) {
      var ty0 = H2 + 20;
      var tl = el("div", { "class": "mp-lane loose" }, [el("b", { text: "Not connected yet" }), document.createTextNode(" · " + (isWater() ? "give each its supply and return pipes" : "give each its Power wire") + " (its note: Add link > Another branch), or add equipment from the card of what feeds it")]);
      tl.style.left = "30px"; tl.style.top = ty0 + "px"; stage.appendChild(tl);
      var tx = 30, ty = ty0 + 30, rowH = 0, maxW = Math.max(W2 - 60, 900);
      loose.forEach(function (n) {
        var e = nodeEl(n, "mp-n mp-fn mp-loose" + (n.id === st.sel ? " mp-sel" : "")); stage.appendChild(e);
        var w = e.offsetWidth, h = e.offsetHeight;
        if (tx + w > maxW && tx > 30) { tx = 30; ty += rowH + 16; rowH = 0; }
        e.style.left = tx + "px"; e.style.top = ty + "px"; box[n.id] = { x: tx, y: ty, w: w, h: h };
        tx += w + 40; rowH = Math.max(rowH, h); W2 = Math.max(W2, tx + 20);
      });
      H2 = ty + rowH + 30;
    }
    svg.setAttribute("width", W2); svg.setAttribute("height", H2);
    lastFlow = { L: L, fp: fp, up: up, down: down, mirAt: mirAt };
    if (sel) journey(sel);
    schematicFrame({ w: W2, h: H2, box: box }, true);
  }
  // a lane's name and what flows in it now
  function laneWords(lane, fp) {
    if (lane === "controls") return ["Controls", "click one to see what it commands, or a unit to see what commands it"];
    if (lane === "power") {
      var pw = fp.pw, tot = 0; if (pw) Object.keys(pw.dem).forEach(function (k) { if (pw.on[k] && !pw.from[k]) tot += pw.dem[k]; });
      return ["Power", tot > 0 ? fmtKw(tot) + " flowing from the supply to the loads" : "no current flowing"];
    }
    var r = lastWater && lastWater.circuits[lane]; if (!r) return [lane === "cw" ? "Condenser water" : "Chilled water", ""];
    var t = r.total, vol = 0;
    fp.edges.forEach(function (e) { if (e.circuit !== lane) return; var d = W().dnOf(e.l.cable), len = W().lengthOf(e.l.len); if (d && d.d && len != null) vol += Math.PI * d.d * d.d / 4 * len; });
    var lap = t.q > 0 && vol > 0 ? vol / (t.q / 1000) : null;
    return [r.C.name, t.q > 0 ? [wFlow(t.q), t.out != null && t.back != null ? wRange(t.out, t.back) : "", t.kw != null ? kwShort(t.kw) : "", lap ? "a drop goes round in about " + fmtTime(lap) + " (" + Math.round(vol * 1000).toLocaleString("en-US") + " l in the pipes)" : ""].filter(Boolean).join(" · ") : "no water flowing"];
  }
  // follow one drop (or the current) through the chosen branch: the biggest way in, the biggest way on, stop by stop
  function journey(sel) {
    var F2 = lastFlow; if (!F2) return;
    var box = $("mpJourney"), pw = F2.fp.pw, wgt = function (e) { var s = e.src; return pw ? (s && !s.minor && s.p.q ? 1 + (pw.dem[s.b] || 0) : 0) : s ? s.q || 0 : 0; };
    // one circuit: the one the chosen branch is the source of, else its own (a chiller's chilled water, a pump's condenser water)
    var circ = "power";
    if (!pw) { var cs = circuitsOf(sel), srcC = cs.filter(function (r) { return r.isSrc[sel]; })[0]; circ = srcC ? srcC.C.id : cs.length ? cs[0].C.id : "chw"; }
    var inC = function (x) { return !x.e.src || x.e.src.circuit === circ; };
    var isSrcC = function (id) { return pw ? !!noteVal(N(id), "source") : !!(lastWater.circuits[circ] && lastWater.circuits[circ].isSrc[id]); };
    var back = [], at = sel, guard = 0;
    while (guard++ < 60) {
      if (at !== sel && isSrcC(at)) break;                                // the journey starts at the source of this circuit
      var ins = (F2.up[at] || []).filter(function (x) { return inC(x) && back.indexOf(x.from) < 0 && x.from !== sel; });
      if (at === sel && F2.mirAt[sel + "~loop"]) break;              // a source: the journey starts here and ends at its mirror
      if (!ins.length) break;
      ins.sort(function (a, b) { return wgt(b.e) - wgt(a.e); });
      back.unshift({ id: ins[0].from, e: ins[0].e }); at = ins[0].from;
    }
    var stops = back.map(function (x) { return x.id; }).concat([sel]), edgesOn = back.map(function (x) { return x.e; }).concat([null]);
    at = sel; guard = 0;
    while (guard++ < 60) {
      var outs = (F2.down[at] || []).filter(function (x) { return inC(x) && stops.indexOf(x.to) < 0; });
      if (!outs.length) break;
      outs.sort(function (a, b) { return wgt(b.e) - wgt(a.e); });
      edgesOn[edgesOn.length - 1] = outs[0].e; stops.push(outs[0].to); edgesOn.push(null); at = outs[0].to;
      if (F2.mirAt[at]) break;
    }
    var secs = 0, timeKnown = !pw, items = [];
    stops.forEach(function (id, i) {
      var mirror = /~loop$/.test(id), real = mirror ? id.replace(/~loop$/, "") : id, n = N(real); if (!n) return;
      var fig = "";
      if (pw) {
        var d = pw.dem[real], mx = pw.max[real], stt = pw.state[real];
        fig = mirror ? "" : pw.shed[real] ? "shed" : mx != null ? fmtKw(d || 0) + " of " + fmtKw(mx) : d ? fmtKw(d) : stt && stt !== "running" ? "off" : "";
      } else {
        var c = circuitsOf(real)[0], side2 = c && c.side[real];
        if (c && mirror) fig = c.source[real] && c.source[real].back != null ? "in at " + wTemp(c.source[real].back) : "";
        else if (c && side2 === "source") fig = c.source[real] && c.source[real].out != null ? "out at " + wTemp(c.source[real].out) : "";
        else if (c && side2 === "unit") fig = c.tIn[real] != null && c.tOut[real] != null ? wRange(c.tIn[real], c.tOut[real]) : "";
        else if (c) { var tt = side2 === "supply" ? c.tSupply[real] : c.tReturn[real]; fig = tt != null ? wTemp(tt) : ""; }
        var pa = c && !mirror ? pressAt(c, real) : null; if (pa != null) fig += (fig ? " · " : "") + wBar(pa);
        if (timeKnown && i > 0) { var e = edgesOn[i - 1], s2 = e && e.src ? pipeSeconds(e.src.l, e.src.q) : null; if (s2 == null) timeKnown = false; else secs += s2; }
        if (timeKnown && i > 0) fig += (fig ? " · " : "") + fmtTime(secs);
      }
      if (i) items.push(el("span", { "class": "mp-jar", "aria-hidden": "true", text: "→" }));
      items.push(el("button", { type: "button", "class": "mp-jstop" + (real === sel && !mirror ? " here" : "") + (mirror ? " loop" : ""), title: n.title,
        onclick: function () { flush(); st.sel = real; st.peek = real; wantScroll = true; renderView(); } }, [el("b", { text: (mirror ? "↺ " : "") + n.title }), fig ? el("small", { text: fig }) : null]));
    });
    var head = pw ? "Follow the current" : "Follow a drop";
    box.appendChild(el("span", { "class": "mp-jhead", text: head + (pw ? "" : timeKnown && secs ? " · " + fmtTime(secs) + " in the pipes" : "") }));
    items.forEach(function (x) { box.appendChild(x); });
    box.appendChild(el("button", { type: "button", "class": "mp-jx", text: "×", title: "Close", "aria-label": "Stop following", onclick: function () { st.sel = null; st.peek = null; renderView(); } }));
    box.hidden = false;
  }
  function schematicFrame(res, left) {
    var stage = $("mpStage"), canvas = $("mpCanvas"), W2 = res.w, H2 = res.h;
    // the card of the chosen branch, beside its symbol
    var pk = st.peek && res.box[st.peek] ? N(st.peek) : null;
    if (!pk) { st.peek = null; peekEl = null; peekEdit = false; }
    else {
      var card = peekCard(pk), b = res.box[pk.id];
      stage.appendChild(card);
      var cx = b.x + b.w + 24, cy = Math.max(10, b.y - 10);
      if (cx + card.offsetWidth > W2 && b.x - card.offsetWidth - 24 > 0) cx = b.x - card.offsetWidth - 24;
      card.style.left = cx + "px"; card.style.top = cy + "px";
      W2 = Math.max(W2, cx + card.offsetWidth + 20); H2 = Math.max(H2, cy + card.offsetHeight + 20);
    }
    stage.style.width = W2 + "px"; stage.style.height = H2 + "px"; stage.style.transform = "scale(" + st.zoom + ")";
    var sizer = $("mpSizer"); sizer.style.width = Math.ceil(W2 * st.zoom) + "px"; sizer.style.height = Math.ceil(H2 * st.zoom) + "px";
    if (firstDraw) {                              // a single-line diagram opens on its source (top centre), a schematic on its top left
      var top = null; if (isWiring() && !left) Object.keys(res.box).forEach(function (k) { var x = res.box[k]; if (!x.tray && (!top || x.y < top.y)) top = x; });
      canvas.scrollLeft = top ? Math.max(0, (top.x + top.w / 2) * st.zoom - canvas.clientWidth / 2) : 0; canvas.scrollTop = 0; firstDraw = false;
    }
    $("mpZoomPct").textContent = Math.round(st.zoom * 100) + "%";
    seen = {};
  }
  function sxClick(e) {
    var nodeE = e.target.closest ? e.target.closest("[data-node]") : null;
    if (sxMoved) { sxMoved = false; return; }
    if (!nodeE) { if (st.sel || st.peek) { st.sel = null; closePeek(true); renderView(); } return; }
    var id = nodeE.getAttribute("data-node"); if (!N(id)) return;
    lastClick = { id: id, t: Date.now(), closed: false };
    if (st.peek === id) { closePeek(true); st.sel = id; } else { if (st.peek !== id) peekEdit = false; st.sel = id; st.peek = id; }
    renderView(); refocus(id);
  }
  // Edit: press on a symbol and move it; let go and its place is saved
  function sxPointerDown(e) {
    var c = $("mpCanvas"), g = e.target.closest("[data-sx]"), id = g.getAttribute("data-node"), b = lastSx && lastSx.box[id];
    if (!b || !N(id)) return;
    var pl = placeOf(N(id)) || (b.sized ? { w: b.w, h: b.h } : { w: 0, h: 0 });
    sxDrag = { id: id, px: e.clientX, py: e.clientY, bx: b.x, by: b.y, x: b.x, y: b.y, w: pl.w, h: pl.h, moved: false, pid: e.pointerId };
    var queued = false;
    function move(ev) {
      if (!sxDrag || ev.pointerId !== sxDrag.pid) return;
      var dx = (ev.clientX - sxDrag.px) / st.zoom, dy = (ev.clientY - sxDrag.py) / st.zoom;
      if (!sxDrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      // captured only once it moves: a click that does not move stays a click on the symbol
      if (!sxDrag.moved) { try { c.setPointerCapture(sxDrag.pid); } catch (x) { /* ignore */ } }
      sxDrag.moved = true;
      sxDrag.x = Math.max(0, Math.round((sxDrag.bx + dx) / 10) * 10); sxDrag.y = Math.max(0, Math.round((sxDrag.by + dy) / 10) * 10);
      if (!queued) { queued = true; window.requestAnimationFrame(function () { queued = false; if (sxDrag) renderView(); }); }
    }
    function up(ev) {
      if (!sxDrag || ev.pointerId !== sxDrag.pid) return;
      c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up);
      var d = sxDrag; sxDrag = null;
      if (!d.moved) return;
      sxMoved = true; setTimeout(function () { sxMoved = false; }, 400);
      var n = N(d.id), list = withNote(n.special, "Place", d.x + ", " + d.y + (d.w ? ", " + d.w + ", " + (d.h || 14) : ""));
      if (list.length > 20) { Hub.toast("A branch holds up to 20 special notes.", true); renderView(); return; }
      st.sel = d.id; setList(n, "special", list);
    }
    c.addEventListener("pointermove", move); c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
  }
  function downstream(pw, id) { var c = 0, q = [id]; while (q.length) (pw.kids[q.shift()] || []).forEach(function (b) { c++; q.push(b); }); return c; }
  // a branch with its own diagram (Layout: columns) inside another diagram's column: it opens alone, as its own diagram
  // (on a wiring or piping map a unit with its own diagram always opens alone: the free-flow tree keeps it one line)
  function opensDiagram(n) { return st.view === "map" && n.id !== st.focus && colsOf(n) && (!!n._inCol || isNet()); }
  function colsOf(n) { return n.kids.length > 0 && n.special.some(function (x) { return /^\s*layout\s*:\s*columns?\s*$/i.test(x); }); }
  function relOf(l) { var id = l && l.rel; for (var i = 0; i < RELS.length; i++) if (RELS[i].id === id) return RELS[i]; return RELS[RELS.length - 1]; }
  // every link to a branch of this map: from -> to, with its kind; links to other maps are kept apart (out)
  function linkIndex() {
    var list = [], out = [];
    Object.keys(M.nodes).forEach(function (id) {
      (N(id).links || []).forEach(function (l) {
        if (l.kind !== "node" || !l.node || l.node === id) return;
        if (N(l.node)) list.push({ from: id, to: l.node, l: l, rel: relOf(l) });
        else if (l.map && l.map !== M.map.id) out.push({ from: id, l: l, rel: relOf(l) });
      });
    });
    return { list: list, out: out };
  }
  function hasLines(id) {
    if (!id || !N(id)) return false;
    if ((N(id).links || []).some(function (l) { return l.kind === "node"; })) return true;
    return Object.keys(M.nodes).some(function (k) { return (N(k).links || []).some(function (l) { return l.kind === "node" && l.node === id; }); });
  }
  function canEdit() { return M && (M.map.rights === "edit" || M.map.rights === "own"); }
  function isOwn() { return M && M.map.rights === "own"; }
  function pathOf(id) { var p = []; while (id && N(id)) { p.unshift(id); id = N(id).parent; } return p; }
  function each(id, fn) { var n = N(id); fn(n); n.kids.forEach(function (k) { each(k, fn); }); }
  function under(id) { var c = 0; each(id, function () { c++; }); return c - 1; }
  function order() { var out = []; each(st.focus, function (n) { out.push(n.id); }); return out; }         // reading order
  function visible() { var out = []; (function w(id) { out.push(id); if (N(id).open) N(id).kids.forEach(w); })(st.focus); return out; }

  function mapState(node, cls) {
    var s = $("mpMapState"); s.textContent = ""; s.hidden = !node; s.className = cls || "empty";
    if (node) s.appendChild(node);
    $("mpWork").hidden = !!node; document.querySelector(".mp-meta").hidden = !!node; document.querySelector(".mp-bar").hidden = !!node;
  }
  function openMap(id) {
    $("mpList").hidden = true; $("mpMap").hidden = false; $("mpLead").hidden = true;
    Hub.setBack("Maps", Hub.url("tools/maps/"));
    if (!UUID.test(id)) { notAvailable("That map is not available. The link is not complete."); return; }
    mapState(document.createTextNode("Loading the map…"));
    Api.mpGet(T, id).then(function (r) {
      build(r);
      mapState(null);
      wire();
      applyHash(true);
      render();
    }, function (err) { notAvailable(err.message); });
  }
  function notAvailable(msg) {
    mapState(el("div", { "class": "mp-rowwrap" }, [el("span", { text: msg }), el("a", { "class": "btn ghost sm", href: Hub.url("tools/maps/"), text: "All maps" })]), "notice error");
  }
  function build(r) {
    var old = M ? M.nodes : null, open = {};
    try { (JSON.parse(store("sessionStorage", userKey("open") + ":" + r.map.id) || "[]") || []).forEach(function (i) { open[i] = 1; }); } catch (e) { /* ignore */ }
    M = { map: r.map, nodes: {}, root: null };
    r.nodes.forEach(function (n) { n.kids = []; n.open = old && old[n.id] ? old[n.id].open : !!open[n.id]; M.nodes[n.id] = n; });
    r.nodes.forEach(function (n) { if (n.parent && M.nodes[n.parent]) M.nodes[n.parent].kids.push(n.id); else if (!n.parent) M.root = n.id; });
    if (!old) N(M.root).open = true;
    // a wiring or piping map opens on its diagram the first time: the "Layout: columns" branches under the centre open
    if (!old && !Object.keys(open).length && (r.map.kind === "wiring" || r.map.kind === "piping")) N(M.root).kids.forEach(function (k) { if (colsOf(N(k))) N(k).open = true; });
    if (!st.focus || !N(st.focus)) st.focus = M.root;
    if (st.sel && !N(st.sel)) st.sel = null;
    if (st.note && !N(st.note)) st.note = null;
    head();
  }
  function head() {
    var m = M.map;
    $("mpTitle").textContent = m.name; document.title = m.name + " - Maps - Thinkneering Tools";
    var sub = $("mpSub"); sub.hidden = false;
    sub.textContent = (KIND_NAME[m.kind] ? KIND_NAME[m.kind] + " · " : "") + (m.mine ? "Your map" : "By " + m.owner) + " · " + (SHARE[m.share] || m.share) + (m.rights === "read" ? " · you can read it" : "") + " · changed " + Hub.date(m.updated_at);
    $("mpMode").hidden = !canEdit(); $("mpImport").hidden = !(canEdit() && st.edit); $("mpSettings").hidden = !isOwn();
    $("mpArrange").hidden = !(canEdit() && st.edit && isNet());
    $("mpCables").hidden = !isNet();
    $("mpCables").textContent = isWater() ? "Pipe schedule" : "Cable schedule";
    $("mpCables").title = isWater() ? "Every pipe of this map, with its flow and temperature, as an Excel list" : "Every wire of this map as an Excel list";
  }
  function reload(after) {
    return Api.mpGet(T, M.map.id).then(function (r) { build(r); if (after) after(); render(); }, function (err) { notAvailable(err.message); });
  }

  var wired = false;
  function wire() {
    if (wired) return; wired = true;
    var v = store("localStorage", userKey("view"));
    // (a water or electrical map opens on its Flow; its own choice is kept apart from the other maps')
    if (isNet()) { var vn = store("localStorage", userKey("view-net")); st.view = vn === "outline" || vn === "schematic" ? vn : "flow"; }
    else st.view = v === "map" || v === "outline" ? v : (window.matchMedia && matchMedia("(max-width: 640px)").matches ? "outline" : "map");
    var z = parseFloat(store("localStorage", userKey("zoom") + ":" + M.map.id));
    if (z >= 0.3 && z <= 2) st.zoom = z;
    st.special = store("localStorage", userKey("special")) === "1";
    // a wiring map shows all its wires by default (the wires are the point); kept apart from the other maps' choice
    st.xlinks = isNet() ? "all" : "chosen";
    var xl = store("localStorage", userKey(isNet() ? "xlinks-w" : "xlinks")); if (xl === "all" || xl === "off" || xl === "chosen") st.xlinks = xl;
    $("mpCables").addEventListener("click", cableSchedule);
    st.flow = store("localStorage", userKey("flow")) !== "0";
    var sxl = store("localStorage", userKey("sxlabels")); if (sxl === "all" || sxl === "off" || sxl === "chosen") st.sxLabels = sxl;
    $("mpReset").addEventListener("click", function () { st.iso = {}; st.cmd = {}; st.night = false; st.fire = false; peekEl = null; renderView(); Hub.toast(isWater() ? "Simulation reset: every valve, pump and chiller as the map says." : "Simulation reset: every branch as the map says, BMS on day."); });
    $("mpFlow").addEventListener("click", function () { st.flow = !st.flow; store("localStorage", userKey("flow"), st.flow ? "1" : "0"); renderView(); });
    if (canEdit() && store("sessionStorage", userKey("edit")) === M.map.id) { st.edit = true; st.sel = M.root; }
    store("sessionStorage", userKey("edit"), null);
    $("mpViewMap").addEventListener("click", function () { setView("map"); });
    $("mpViewOut").addEventListener("click", function () { setView("outline"); });
    $("mpView2d").addEventListener("click", function () { firstDraw = true; setView("schematic"); });
    $("mpViewFlow").addEventListener("click", function () { firstDraw = true; setView("flow"); });
    $("mpRead").addEventListener("click", function () { setEdit(false); });
    $("mpEdit").addEventListener("click", function () { setEdit(true); });
    $("mpImport").addEventListener("click", importSheet);
    $("mpArrange").addEventListener("click", arrange);
    $("mpExport").addEventListener("click", exportSheet);
    $("mpSettings").addEventListener("click", settingsSheet);
    $("mpZoomIn").addEventListener("click", function () { zoomBy(1.2); });
    $("mpZoomOut").addEventListener("click", function () { zoomBy(1 / 1.2); });
    $("mpZoomPct").addEventListener("click", function () { setZoom(1); });
    $("mpFit").addEventListener("click", fit);
    $("mpFull").addEventListener("click", function () { full(!st.full); });
    $("mpSpecial").addEventListener("click", function () { st.special = !st.special; store("localStorage", userKey("special"), st.special ? "1" : "0"); renderView(); });
    $("mpXlinks").addEventListener("click", function () {
      if (st.view === "schematic") {
        st.sxLabels = st.sxLabels === "chosen" ? "all" : st.sxLabels === "all" ? "off" : "chosen";
        store("localStorage", userKey("sxlabels"), st.sxLabels); renderView();
        var wd2 = isWiring() ? "wire" : "pipe";
        Hub.toast(st.sxLabels === "all" ? "Words on every " + wd2 + "." : st.sxLabels === "off" ? "No words on the " + wd2 + "s." : "Words on the " + wd2 + "s of the chosen symbol.");
        return;
      }
      st.xlinks = st.xlinks === "chosen" ? "all" : st.xlinks === "all" ? "off" : "chosen";
      store("localStorage", userKey(isNet() ? "xlinks-w" : "xlinks"), st.xlinks); renderView();
      var what = isWiring() ? "wire" : isWater() ? "pipe" : "link";
      Hub.toast(st.xlinks === "all" ? "Showing every " + what + "." : st.xlinks === "off" ? (isWiring() ? "Wires" : isWater() ? "Pipes" : "Links between branches") + " hidden." : "Showing the " + what + "s of the chosen branch.");
    });
    var timer, q = $("mpQ");
    q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { search(q.value); }, 150); });
    window.addEventListener("hashchange", function () { applyHash(false); render(); });
    document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && st.full) full(false, true); });
    document.addEventListener("keydown", pageKeys);
    noteWire();
    canvasMouse();
    head();
  }
  function setView(v) { st.view = v; seen = {}; store("localStorage", userKey(isNet() ? "view-net" : "view"), v); wantScroll = true; renderView(); }
  function setEdit(on, quiet) {
    if (!canEdit()) return;
    flush();
    st.edit = on; head(); render();
    if (on && !quiet) Hub.toast(COARSE.matches ? "Edit is on. Tap a branch to change it." : "Edit is on. Double-click a branch to write in it; Tab adds a branch under the chosen one.");
  }
  function hashOf() { var h = ""; try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { h = ""; } return h; }
  function applyHash(first) {
    var h = hashOf(), at = /^at-/.test(h) ? h.slice(3) : "";
    if (at) {
      if (N(at)) reveal(at, true); else if (first) Hub.toast("The branch you followed no longer exists.", true);
      return;
    }
    var id = h && N(h) ? h : M.root;
    if (id !== st.focus) { st.focus = id; N(id).open = true; seen = {}; if (st.sel && pathOf(st.sel).indexOf(id) < 0) st.sel = null; wantScroll = true; firstDraw = true; }
  }
  function setHash(h) {
    try { if (hashOf() !== h) { if (h) location.hash = h; else history.pushState(null, "", location.pathname + location.search); } } catch (e) { /* ignore */ }
  }
  function focusOn(id) {
    flush();
    st.focus = id; N(id).open = true; seen = {}; firstDraw = true;
    if (st.sel && pathOf(st.sel).indexOf(id) < 0) st.sel = null;
    setHash(id === M.root ? "" : id);
    render();
  }
  // show a branch wherever it is: open what leads to it and select it
  function reveal(id, quiet) {
    var p = pathOf(id);
    p.forEach(function (a) { if (a !== id) N(a).open = true; });
    if (p.indexOf(st.focus) < 0) { st.focus = M.root; seen = {}; }
    st.sel = id; wantScroll = true;
    if (!quiet) { setHash(st.focus === M.root ? "" : st.focus); render(); }
  }
  // choosing a branch only moves the highlight (the page is not redrawn, so a double-click lands on the same branch)
  function pick(n) {
    if (st.sel !== n.id) flush();
    var was = st.sel;
    st.sel = n.id;
    if (st.view === "map" && st.xlinks !== "off" && was !== n.id && (hasLines(was) || hasLines(n.id))) { renderView(); refocus(n.id); return; }
    [].forEach.call(document.querySelectorAll("[data-node].mp-sel"), function (x) { x.classList.remove("mp-sel"); x.setAttribute("aria-selected", "false"); });
    var x = document.querySelector('[data-node="' + n.id + '"]');
    if (!x) { wantScroll = true; renderView(); x = document.querySelector('[data-node="' + n.id + '"]'); }
    if (x) {
      x.classList.add("mp-sel"); x.setAttribute("aria-selected", "true");
      if (x.scrollIntoView) x.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    refocus(n.id);
  }
  function toggle(n) { if (!n.kids.length) return; n.open = !n.open; if (n.open) { st.sel = n.id; wantScroll = true; } renderView(); refocus(n.id); }
  // one click: open the way to the branch and its next level, close everything else under the centre
  function drill(n) {
    if (opensDiagram(n)) { focusOn(n.id); return false; }
    if (st.sel !== n.id) flush();
    var closing = st.sel === n.id && n.open && n.id !== st.focus && n.kids.length > 0, keep = {};
    pathOf(n.id).forEach(function (a) { keep[a] = 1; });
    each(st.focus, function (x) { if (!keep[x.id]) x.open = false; });
    pathOf(n.id).forEach(function (a) { if (a !== n.id) N(a).open = true; });
    n.open = n.id === st.focus || (!closing && n.kids.length > 0);
    var leaf = st.view === "map" && !n.kids.length && n.id !== st.focus;
    if (leaf && st.peek === n.id && st.sel === n.id) { closing = true; closePeek(true); }
    else { if (st.peek !== (leaf ? n.id : null)) peekEdit = false; st.peek = leaf ? n.id : null; }
    st.sel = n.id;
    redrawAt(n.id);
    return closing;
  }
  // Ctrl + click and the count button: one branch opens or closes, the others stay as they are
  function toggleOne(n) {
    if (opensDiagram(n)) { focusOn(n.id); return; }
    if (!n.kids.length || n.id === st.focus) { pick(n); return; }
    if (st.sel !== n.id) flush();
    n.open = !n.open; st.sel = n.id;
    redrawAt(n.id);
  }
  // redraw with the clicked branch staying where it was on the screen (so a second click lands on it),
  // then bring the branches it just grew into view
  function redrawAt(id) {
    var map = st.view === "map", box = map ? $("mpCanvas") : $("mpOutline");
    var x0 = box.querySelector('[data-node="' + id + '"]'), r0 = x0 ? x0.getBoundingClientRect() : null;
    wantScroll = false;
    renderView();
    var x1 = box.querySelector('[data-node="' + id + '"]');
    if (r0 && x1) { var r1 = x1.getBoundingClientRect(); box.scrollLeft += r1.left - r0.left; box.scrollTop += r1.top - r0.top; }
    if (map) keepInView(N(id), st.zoom);
    else if (x1 && N(id).open) { var last = box.querySelector('[data-node="' + N(id).kids[N(id).kids.length - 1] + '"]'); if (last && last.scrollIntoView) last.scrollIntoView({ block: "nearest" }); if (x1.scrollIntoView) x1.scrollIntoView({ block: "nearest" }); }
    refocus(id);
  }
  function matches(n) { return !!st.q && (n.title + "\n" + n.notes + "\n" + n.special.join("\n")).toLowerCase().indexOf(st.q) >= 0; }
  function search(text) {
    st.q = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (st.q) each(st.focus, function (n) { if (matches(n)) pathOf(n.id).forEach(function (a) { if (a !== n.id) N(a).open = true; }); });
    renderView();
  }

  // ---------- drawing ----------
  // the colour of a branch: the top branch it grows from (four hub colours in turn); the focus is the centre
  function hue(id) { var p = pathOf(id), i = p.indexOf(st.focus); if (i < 0 || i === p.length - 1) return -1; var top = p[i + 1]; return N(st.focus).kids.indexOf(top) % 4; }
  function cls(base, n) {
    var c = base, h = hue(n.id);
    if (n.id === st.focus) c += " mp-root"; else c += " b" + h;
    if (!n.verified && n.id !== st.focus) c += " mp-unv";
    if (n.id === st.sel) c += " mp-sel";
    if (st.q) c += matches(n) ? " mp-hitn" : " mp-dim";
    return c;
  }
  function marks(n) {
    var out = [];
    if (n.notes) out.push(el("button", { type: "button", "class": "mp-nb", title: "Read the notes", "aria-label": "Read the notes of " + n.title, "data-act": "note" }, [ico("note")]));
    if (n.special.length && !st.special) out.push(el("span", { "class": "mp-sp", title: n.special.join("\n") }, [el("i", { text: "!" }), String(n.special.length)]));
    if (n.links.length) out.push(el("span", { "class": "mp-lk", title: plural(n.links.length, "link") }, [ico("link")]));
    if (!n.verified && n.id !== st.focus) out.push(el("span", { "class": "mp-tv", title: "To verify: not yet checked by an admin" }, [document.createTextNode("to verify")]));
    if (n.id !== st.focus && n.kids.length && colsOf(n) && (isNet() || pathOf(n.id).some(function (a) { return a !== n.id && N(a) && colsOf(N(a)); })))
      out.push(el("span", { "class": "mp-diag", title: "Has its own wiring diagram: click to open it" }, [document.createTextNode("diagram ›")]));
    // show this branch alone (shown on the chosen branch and under the mouse; the crumbs lead back)
    if (n.id !== st.focus && n.kids.length && st.view !== "schematic")
      out.push(el("button", { type: "button", "class": "mp-al", title: "Show this branch alone", "aria-label": "Show " + n.title + " alone", "data-act": "alone" }, [ico("focus")]));
    return out;
  }
  // the sign of a component (mp-signs.js): from "Icon: ..." or the branch name; its name is the tooltip
  function signOf(n) { return window.MPSigns ? window.MPSigns.of(n) : ""; }
  function signEl(n, big) {
    var id = signOf(n); if (!id) return null;
    return el("span", { "class": "mp-ic" + (big ? " big" : ""), title: window.MPSigns.name(id), "aria-hidden": "true", html: window.MPSigns.svg(id) });
  }
  function nodeEl(n, base) {
    var kids = n.kids.length;
    var e = el("div", { "class": cls(base, n), tabindex: "0", role: "treeitem", "data-node": n.id, "aria-level": String(pathOf(n.id).length - pathOf(st.focus).length + 1),
      "aria-expanded": kids ? (n.open ? "true" : "false") : null, "aria-selected": n.id === st.sel ? "true" : "false",
      "aria-label": n.title + (n.notes ? ", has notes" : "") + (n.verified ? "" : ", to verify") + (kids ? ", " + plural(kids, "branch", "branches") : "") }, [
      n.id !== st.focus ? signEl(n) : null,
      el("span", { "class": "mp-t", text: n.title })
    ].concat(marks(n)));
    if (st.special && n.special.length) e.appendChild(el("span", { "class": "mp-sps" }, n.special.slice(0, 6).map(function (s) { return el("span", { text: s }); })));
    var wl = waterLine(n); if (wl) e.appendChild(wl);
    var pl = powerLine(n); if (pl) e.appendChild(pl);
    if (kids) e.appendChild(el("button", { type: "button", "class": "mp-tg", tabindex: "-1", "data-act": "toggle", "aria-hidden": "true",
      title: n.open ? "Close" : "Open " + plural(kids, "branch", "branches"), text: n.open ? "−" : String(kids) }));
    return e;
  }
  function renderMap() {
    var stage = $("mpStage"), canvas = $("mpCanvas"), els = {}, now = {}, first = !Object.keys(seen).length, maxX = 0;
    var act = document.activeElement, keepFocus = peekEl && act && peekEl.contains(act) ? { el: act, a: act.selectionStart, b: act.selectionEnd } : null;
    stage.textContent = "";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); stage.appendChild(svg);
    stage.classList.toggle("mp-pipes", isWater());
    (function walk(id) {
      var n = N(id); now[id] = 1; n._inCol = false; n._colHead = false; n._flat = false; n._aside = false;
      if (isNet() && id !== st.focus && colsOf(n)) n.open = false;             // a unit's own diagram opens alone
      var e = nodeEl(n, "mp-n" + (!first && !seen[id] ? " mp-grow" : ""));
      stage.appendChild(e); els[id] = e;
      // a branch laid out in columns (wiring maps): its columns always show what is in them
      // a branch laid out in columns is a diagram, not a tree to fold: everything in its columns stays open
      // (a unit with its own diagram inside a column stays one line here: clicking it opens its diagram alone)
      if (n.open && colsOf(n)) n.kids.forEach(function openAll(k) { var c = N(k); if (!c.kids.length) return; if (colsOf(c)) { c.open = false; return; } c.open = true; c.kids.forEach(openAll); });
      if (n.open) n.kids.forEach(walk);
    })(st.focus);
    var pw = lastPower;
    if (lastWater) Object.keys(els).forEach(function (id) {
      if (lastWater.part[id] && !anyFlow(id) && !isTank(id)) els[id].classList.add("mp-dead");
      if (circuitsOf(id).some(function (r) { return (r.source[id] && r.source[id].atCap) || r.limitAt[id]; })) els[id].classList.add("mp-over");
    });
    if (pw && pw.known) Object.keys(els).forEach(function (id) {
      if (pw.part[id] && !pw.on[id]) els[id].classList.add("mp-dead");
      if (pw.shed[id]) els[id].classList.add("mp-shed");
      if (pw.sheds[id] || pw.over.indexOf(id) >= 0) els[id].classList.add("mp-over");
      if (pw.cmd[id] && pw.state[id]) els[id].classList.add(pw.state[id] === "running" ? "mp-run" : "mp-stop");
      if (st.fire && pw.fires.indexOf(id) >= 0) els[id].classList.add("mp-alarm");
    });
    Object.keys(els).forEach(function (id) { var n = N(id); n._w = els[id].offsetWidth; n._h = els[id].offsetHeight; });
    // the notes card of a branch with nothing under it (peek), drawn where its next level would grow
    var pk = st.peek && els[st.peek] && st.peek !== st.focus && !N(st.peek).kids.length ? N(st.peek) : null, card = null;
    if (!pk) { st.peek = null; peekEdit = false; peekEl = null; }
    else { card = peekCard(pk); stage.appendChild(card); pk._pw = card.offsetWidth; pk._ph = card.offsetHeight; }
    // across: a branch starts right after the text it grows from (free flow, no columns)
    // columns: the branches of a "Layout: columns" branch side by side, each with what is under it as an indented list
    function colAcross(id, x0, depth) {
      var n = N(id), right; n._inCol = true; n._x = x0 + depth * IND; right = n._x + n._w;
      if (pk && pk.id === id) right = Math.max(right, n._x + pk._pw);        // its notes card opens below it: the column makes room
      if (n.open) n.kids.forEach(function (k) { right = Math.max(right, colAcross(k, x0, depth + 1)); });
      return right;
    }
    // a diagram shown at the centre (the map itself or a unit opened alone) starts straight away: the centre top left,
    // its leading notes-only branches (the guide) listed under it, the columns beside it from the same top, no rail
    function asidesOf(n) { var out = []; for (var i = 0; i < n.kids.length && !N(n.kids[i]).kids.length; i++) out.push(n.kids[i]); return out.length < n.kids.length ? out : []; }
    (function across(id, x) {
      var n = N(id); n._x = x; maxX = Math.max(maxX, x + n._w);
      if (n.open && colsOf(n) && id === st.focus) {
        var side = asidesOf(n), right = x + n._w; n._flat = true;
        side.forEach(function (k) { N(k)._aside = true; right = Math.max(right, colAcross(k, x, 1)); });
        var fx = right + GCOL;
        n.kids.forEach(function (k) { if (N(k)._aside) return; var r = colAcross(k, fx, 0); N(k)._colHead = true; maxX = Math.max(maxX, r); fx = r + GCOL; });
        maxX = Math.max(maxX, right);
        return;
      }
      if (n.open && colsOf(n)) {
        var cx = x + n._w + GX + 24;
        n.kids.forEach(function (k) { var r = colAcross(k, cx, 0); N(k)._colHead = true; maxX = Math.max(maxX, r); cx = r + GCOL; });
        return;
      }
      if (n.open) n.kids.forEach(function (k) { across(k, x + n._w + GX); });
    })(st.focus, PAD);
    if (pk && !pk._inCol) maxX = Math.max(maxX, pk._x + pk._w + GX + pk._pw);
    // down: every branch takes the height of what grows from it; a branch sits in the middle of its own
    function shift(id, dy) { var n = N(id); n._y += dy; if (n.open) n.kids.forEach(function (k) { shift(k, dy); }); }
    var total = (function lay(id, top) {
      var n = N(id), kh = 0, gap = id === st.focus ? GTOP : GY;
      if (n === pk && !n._inCol) { var ps = Math.max(n._h, n._ph); n._y = top + (ps - n._h) / 2; return ps; }   // the card takes its room
      function colLay(cid, yy) { var c = N(cid); c._y = yy; yy += c._h + (c._colHead ? 10 : GY); if (c === pk) yy += pk._ph + 12; if (c.open) c.kids.forEach(function (g) { yy = colLay(g, yy); }); return yy; }
      if (n._flat) {                              // the centre top left, the guide under it, the columns from the same top
        n._y = top;
        var fy = top + n._h + 12, fb = top + n._h;
        n.kids.forEach(function (k) { if (N(k)._aside) fy = colLay(k, fy); else fb = Math.max(fb, colLay(k, top)); });
        return Math.max(fy, fb) - top;
      }
      if (n.open && colsOf(n)) {                  // columns: each one a list from the top; the branch in the middle of them
        var bh = 0;
        n.kids.forEach(function (k) { var y = colLay(k, 0); bh = Math.max(bh, y); });
        var cs = Math.max(n._h, bh), y0 = top + (cs - bh) / 2;
        n.kids.forEach(function (k) { shift(k, y0); });
        n._y = top + (cs - n._h) / 2;
        return cs;
      }
      if (!n.open || !n.kids.length) { n._y = top; return n._h; }
      n.kids.forEach(function (k, i) { N(k)._sub = lay(k, 0); kh += N(k)._sub + (i ? gap : 0); });
      var sub = Math.max(kh, n._h), y = top + (sub - kh) / 2;
      n.kids.forEach(function (k) { shift(k, y); y += N(k)._sub + gap; });
      n._y = top + (sub - n._h) / 2;
      return sub;
    })(st.focus, 0);
    var paths = {};
    Object.keys(els).forEach(function (id) {
      var n = N(id); n._y += PAD;
      els[id].style.left = n._x + "px"; els[id].style.top = n._y + "px";
    });
    Object.keys(els).forEach(function (id) {
      var n = N(id), root = id === st.focus;
      if (!n.open) return;
      if (n._flat) {                               // the guide hangs under the centre; the columns need no line to it
        n.kids.forEach(function (k) {
          var c = N(k); if (!c._aside) return;
          var h = "b" + hue(k) + (c.verified ? "" : " u");
          paths[h] = (paths[h] || "") + "M" + (n._x + 7) + " " + (n._y + n._h) + "V" + (c._y + c._h - 1) + "H" + c._x;
        });
        return;
      }
      if (colsOf(n) && n.kids.length && N(n.kids[0])._colHead) {      // a rail over the column heads, a drop to each
        var heads = n.kids.map(N), ry = Math.min.apply(null, heads.map(function (h) { return h._y; })) - 12, hb = "b" + hue(n.kids[0]);
        var d = "M" + (n._x + n._w) + " " + (n._y + n._h / 2) + "H" + (heads[0]._x - 14) + "V" + ry + "H" + (heads[heads.length - 1]._x + 6);
        heads.forEach(function (h) { d += "M" + (h._x + 6) + " " + ry + "V" + h._y; });
        paths[hb] = (paths[hb] || "") + d;
        return;
      }
      if (n._inCol) {                              // inside a column: an elbow down the left of the list
        n.kids.forEach(function (k) {
          var c = N(k), h = "b" + hue(k) + (c.verified ? "" : " u");
          paths[h] = (paths[h] || "") + "M" + (n._x + 7) + " " + (n._y + n._h) + "V" + (c._y + c._h - 1) + "H" + c._x;
        });
        return;
      }
      n.kids.forEach(function (k) {
        var c = N(k), x1 = n._x + n._w, y1 = root ? n._y + n._h / 2 : n._y + n._h - 1, x2 = c._x, y2 = c._y + c._h - 1, mx = x1 + (x2 - x1) * 0.55;
        var h = "b" + hue(k) + (c.verified ? "" : " u");
        paths[h] = (paths[h] || "") + "M" + x1 + " " + y1 + "C" + mx + " " + y1 + "," + (x1 + (x2 - x1) * 0.45) + " " + y2 + "," + x2 + " " + y2;
      });
    });
    if (pk) {
      var hp = "b" + hue(pk.id) + (pk.verified ? "" : " u");
      if (pk._inCol) {                            // in a column: below the branch, in the room the column made
        pk._px = pk._x; pk._py = pk._y + pk._h + 6;
        paths[hp] = (paths[hp] || "") + "M" + (pk._x + 7) + " " + (pk._y + pk._h) + "V" + pk._py;
      } else {
        pk._px = pk._x + pk._w + GX; pk._py = Math.max(PAD, pk._y + pk._h / 2 - pk._ph / 2);
        var x1 = pk._x + pk._w, y1 = pk._y + pk._h - 1, x2 = pk._px, y2 = pk._py + 18;
        paths[hp] = (paths[hp] || "") + "M" + x1 + " " + y1 + "C" + (x1 + GX * 0.55) + " " + y1 + "," + (x1 + GX * 0.45) + " " + y2 + "," + x2 + " " + y2;
      }
      card.style.left = pk._px + "px"; card.style.top = pk._py + "px";
      if (keepFocus && card.contains(keepFocus.el)) {
        keepFocus.el.focus({ preventScroll: true });
        try { if (keepFocus.a != null) keepFocus.el.setSelectionRange(keepFocus.a, keepFocus.b); } catch (x) { /* ignore */ }
      }
    }
    Object.keys(paths).forEach(function (h) {
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", paths[h]); p.setAttribute("class", h); svg.appendChild(p);
    });
    maxX = Math.max(maxX, drawLinks(stage, svg, els));    // on top of the tree's lines
    var w = maxX + PAD, ht = total + PAD * 2;
    stage.style.width = w + "px"; stage.style.height = ht + "px";
    stage.style.transform = "scale(" + st.zoom + ")";
    var sizer = $("mpSizer"); sizer.style.width = Math.ceil(w * st.zoom) + "px"; sizer.style.height = Math.ceil(ht * st.zoom) + "px";
    seen = now;
    var z = st.zoom, s = st.sel && els[st.sel] ? N(st.sel) : null;
    if (firstDraw) {                              // the centre of the map in the middle of the screen, on the left
      var r = N(st.focus);
      canvas.scrollLeft = 0;
      canvas.scrollTop = Math.max(0, (r._y + r._h / 2) * z - canvas.clientHeight / 2);
      firstDraw = false;
    }
    if (s && wantScroll) keepInView(s, z);
    wantScroll = false;
    $("mpZoomPct").textContent = Math.round(z * 100) + "%";
  }
  // ---------- links between branches, drawn on the map ----------
  // Links: chosen (default) = the lines of the chosen branch, with their words; all = every line of the branches in
  // view (words only on the chosen branch's); off. A line ends at the branch, or at the nearest branch in view
  // that holds it when it is folded away ("folded" in the words). A link to another map ends in a chip at the side.
  var SVGNS = "http://www.w3.org/2000/svg", lastPower = null, lastWater = null;
  function svgEl(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function shownAs(id, els) { while (id && N(id)) { if (els[id]) return id; id = N(id).parent; } return null; }
  function drawLinks(stage, svg, els) {
    if (st.xlinks === "off" || st.view !== "map") return 0;
    var xi = linkIndex(), sel = st.sel && els[st.sel] ? st.sel : null, right = 0, done = {}, chips = {};
    if (st.xlinks === "chosen" && !sel) return 0;
    var defs = svgEl("defs", {});
    RELS.forEach(function (r) {
      if (r.ends === "none") return;
      var m = svgEl("marker", { id: "mpx-" + r.id, "class": "mpx-m x-" + r.id, viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "9", markerHeight: "9", orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" });
      m.appendChild(svgEl("path", { d: r.id === "replaced" ? "M1,1 L9,5 L1,9" : "M0,0 L10,5 L0,10 z" }));
      defs.appendChild(m);
    });
    svg.appendChild(defs);
    var placed = [], qMax = 1e-9;
    if (lastWater) Object.keys(lastWater.dir).forEach(function (k) { qMax = Math.max(qMax, lastWater.dir[k]); });
    function label(x, y, text, rel, go, side) {
      // a line's words step down until they no longer sit on another line's words
      for (var tries = 0; tries < 12 && placed.some(function (q) { return Math.abs(q.y - y) < 22 && Math.abs(q.x - x) < 200; }); tries++) y += 22;
      placed.push({ x: x, y: y });
      var c = el("button", { type: "button", "class": "mp-xl " + (side || "") + " x-" + rel.id, title: text + "\n" + rel.hint, text: text, onclick: go });
      c.style.left = x + "px"; c.style.top = y + "px";
      stage.appendChild(c);
    }
    xi.list.forEach(function (e) {
      if (st.xlinks === "chosen" && e.from !== sel && e.to !== sel) return;
      var a = shownAs(e.from, els), b = shownAs(e.to, els);
      // one end outside this view (a branch shown alone, e.g. a unit's diagram): a chip under the end in view leads there
      if ((a && !b) || (b && !a)) {
        var at = a || b, far = a ? e.to : e.from;
        if (st.xlinks === "chosen" && sel !== at) return;
        var ck = at + ">" + far + e.rel.id; if (done[ck]) return; done[ck] = 1;
        var A0 = N(at), k0 = chips[at] = (chips[at] || 0) + 1;
        var cy = A0._y + A0._h + 4 + k0 * 24;
        var cp = svgEl("path", { d: "M" + (A0._x + 7) + " " + (A0._y + A0._h) + "V" + cy + "H" + (A0._x + 22), "class": "mpx x-" + e.rel.id });
        svg.appendChild(cp);
        var cc = el("button", { type: "button", "class": "mp-xl mp-xout x-" + e.rel.id, title: "Outside this view: " + e.rel.hint, onclick: function () { flush(); reveal(far); } },
          [el("span", { text: (e.rel.wire ? (e.l.signal || e.rel.label) : (a ? e.rel.label : e.rel.back)) + " · " }), el("b", { text: N(far).title }), el("small", { text: " (outside this view) ›" })]);
        cc.style.left = (A0._x + 24) + "px"; cc.style.top = cy + "px";
        // under a diagram's own centre, the chip stops short of its first column (the full text is in its tooltip)
        if (colsOf(A0) && A0.open && N(A0.kids[0])._x !== undefined) cc.style.maxWidth = Math.max(140, N(A0.kids[0])._x - (A0._x + 24) - 14) + "px";
        cc.title = cc.textContent + "\n" + cc.title;
        stage.appendChild(cc);
        right = Math.max(right, A0._x + 360);
        return;
      }
      if (!a || !b || a === b) return;
      var key = e.rel.ends === "end" ? a + ">" + b + e.rel.id : [a, b].sort().join("|") + e.rel.id;
      if (done[key]) return; done[key] = 1;
      var A = N(a), B = N(b), ay = A._y + A._h / 2, by = B._y + B._h / 2, x1, x2, c1, c2;
      // a feeder or supply pipe between a branch and the one under it runs on the branch line itself (the tree is the feed)
      var P = a === e.from && b === e.to || a === e.to && b === e.from ? (B.parent === a ? A : A.parent === b ? B : null) : null;
      var onTree = P && !P._inCol && !P._flat && (FLOW_KINDS.indexOf(e.rel.id) >= 0 || /^p-(cw-)?supply$/.test(e.rel.id));
      if (onTree) {
        var C = P === A ? B : A, px = P._x + P._w, py = P.id === st.focus ? P._y + P._h / 2 : P._y + P._h - 1, qx = C._x, qy = C._y + C._h - 1;
        if (P === A) { x1 = px; ay = py; x2 = qx; by = qy; c1 = x1 + (x2 - x1) * 0.55; c2 = x1 + (x2 - x1) * 0.45; }
        else { x1 = qx; ay = qy; x2 = px; by = py; c1 = x1 + (x2 - x1) * 0.45; c2 = x1 + (x2 - x1) * 0.55; }
      }
      else if (B._x >= A._x + A._w + 10) { x1 = A._x + A._w; x2 = B._x; var d = Math.max(40, (x2 - x1) / 2); c1 = x1 + d; c2 = x2 - d; }
      else if (A._x >= B._x + B._w + 10) { x1 = A._x; x2 = B._x + B._w; var d2 = Math.max(40, (x1 - x2) / 2); c1 = x1 - d2; c2 = x2 + d2; }
      else { x1 = A._x + A._w; x2 = B._x + B._w; c1 = c2 = Math.max(x1, x2) + 50 + Math.min(140, Math.abs(by - ay) * 0.25); }
      right = Math.max(right, c1 + 20, c2 + 20);
      var p = svgEl("path", { d: "M" + x1 + " " + ay + "C" + c1 + " " + ay + "," + c2 + " " + by + "," + x2 + " " + by, "class": "mpx x-" + e.rel.id + (onTree ? " tree" : "") });
      if (e.rel.ends !== "none") p.setAttribute("marker-end", "url(#mpx-" + e.rel.id + ")");
      if (e.rel.ends === "both") p.setAttribute("marker-start", "url(#mpx-" + e.rel.id + ")");
      svg.appendChild(p);
      // current: moving dots on a live power line, from where it is drawn from to the other end; a dead one goes grey
      var pw = lastPower;
      if (pw && FLOW_KINDS.indexOf(e.rel.id) >= 0) {
        var live = pw.known ? !!pw.on[e.from] && !!pw.on[e.to] : true;
        if (!live) p.classList.add(pw.shed[e.from] || pw.shed[e.to] ? "shed" : "off");
        else if (st.flow) {
          // the dots run the way the current goes (away from the source), whichever end the wire was added from;
          // energized but nothing it feeds runs: no current, so no dots (the line stays solid)
          var child = !pw.known ? e.to : pw.from[e.to] === e.from ? e.to : pw.from[e.from] === e.to ? e.from : null;
          if (child && (!pw.known || pw.draw[child])) svg.appendChild(svgEl("path", { d: p.getAttribute("d"), "class": "mpx-flow" + (child === e.from ? " rev" : "") }));
        }
      }
      // water: moving dots the way the water goes, faster where more flows; a pipe without flow goes grey
      var wf = lastWater;
      if (wf && e.rel.pipe) {
        var fw = wf.dir[e.from + ">" + e.to], bw = wf.dir[e.to + ">" + e.from];
        if (!fw && !bw) p.classList.add("off");
        else { var wc = waterLimit(e.from, e.to); if (wc) p.classList.add(wc); }
        if ((fw || bw) && st.flow) {
          var dots = svgEl("path", { d: p.getAttribute("d"), "class": "mpx-flow" + (bw && !fw ? " rev" : "") });
          dots.style.animationDuration = (1.9 - 1.3 * Math.min(1, (fw || bw) / qMax)).toFixed(2) + "s";
          svg.appendChild(dots);
        }
      }
      // a BMS command: a slow pulse towards the unit while it runs
      var unit = pw ? (pw.commands(e.from, e.to) ? e.to : pw.commands(e.to, e.from) ? e.from : null) : null;
      if (unit && st.flow) svg.appendChild(svgEl("path", { d: p.getAttribute("d"), "class": "mpx-pulse" + (unit === e.from ? " rev" : "") + (pw.fire[unit] && st.fire ? " alarm" : "") }));
      // (a feeder on a branch line carries no words on the map: they would cover the branch; its card, the cable schedule and the 2D view have them)
      if (sel && (e.from === sel || e.to === sel) && !onTree) {
        var mine = e.from === sel, other = mine ? e.to : e.from, proxy = mine ? b !== e.to : a !== e.from;
        // the words sit near the other end, where the lines of a busy branch fan out (B(t) of the curve)
        var tt = mine ? 0.93 : 0.07, u = 1 - tt;
        var mx = u * u * u * x1 + 3 * u * u * tt * c1 + 3 * u * tt * tt * c2 + tt * tt * tt * x2;
        var my = u * u * u * ay + 3 * u * u * tt * ay + 3 * u * tt * tt * by + tt * tt * tt * by;
        // at the other end, on its row; the words stand on the side the line comes from, so they never cover that branch
        var ex = mine ? x2 : x1;
        label(mx, my, (e.rel.wire ? wireText(e.l, e.rel, e.from) : mine ? e.rel.label : e.rel.back) + (proxy ? " · " + N(other).title + " (folded)" : ""), e.rel, function () { flush(); reveal(other); }, ex >= mx ? "ra" : "la");
      }
    });
    // links to other maps: a short line to a chip beside the chosen branch
    if (sel) xi.out.forEach(function (e) {
      if (e.from !== sel) return;
      var A = N(sel), k = chips[sel] = (chips[sel] || 0) + 1;
      var x1 = A._x + A._w, y1 = A._y + A._h / 2, x2 = x1 + 70, y2 = y1 + (k - 1) * 30 - 34;
      if (st.peek === sel && A._px !== undefined) y2 = A._py + A._ph + 22 + (k - 1) * 30;   // below the notes card, not on it
      var p = svgEl("path", { d: "M" + x1 + " " + y1 + "C" + (x1 + 35) + " " + y1 + "," + (x2 - 35) + " " + y2 + "," + x2 + " " + y2, "class": "mpx x-" + e.rel.id });
      if (e.rel.ends !== "none") p.setAttribute("marker-end", "url(#mpx-" + e.rel.id + ")");
      svg.appendChild(p);
      var c = el("button", { type: "button", "class": "mp-xl mp-xout x-" + e.rel.id, title: "Opens the other map: " + e.rel.hint, onclick: function () { followBranch(e.l); } },
        [el("span", { text: e.rel.label + " · " }), el("b", { text: e.l.label }), el("small", { text: " (other map) ›" })]);
      c.style.left = x2 + "px"; c.style.top = y2 + "px";
      stage.appendChild(c);
      right = Math.max(right, x2 + 320);
    });
    return right;
  }
  // the kinds used on this map, each with a sample of its line
  function legend(xi) {
    var box = $("mpLegend"); box.textContent = ""; box.hidden = !xi;
    // a wiring or piping map: the signs used on it, with their names (a schematic's legend)
    if (isNet() && st.view === "flow") {
      var guideId = (N(M.root).kids || []).filter(function (k) { return /how this map works/i.test(N(k).title); })[0];
      if (guideId) { box.appendChild(el("button", { type: "button", "class": "mp-guidebtn", text: "How this map works", onclick: function () { openNote(guideId); } })); box.hidden = false; }
    }
    if (isNet() && st.view !== "outline" && window.MPSigns) {
      var seenS = {}, signs = [];
      each(st.focus, function (n) { var id = n.id === st.focus ? "" : signOf(n); if (id && !seenS[id]) { seenS[id] = 1; signs.push(id); } });
      signs.sort(function (a, b) { return window.MPSigns.ids.indexOf(a) - window.MPSigns.ids.indexOf(b); });
      signs.forEach(function (id) { box.appendChild(el("span", { "class": "mp-lg" }, [el("span", { "class": "mp-ic", "aria-hidden": "true", html: window.MPSigns.svg(id) }), document.createTextNode(window.MPSigns.name(id))])); });
      if (signs.length && xi) box.appendChild(el("span", { "class": "mp-lg-sep", "aria-hidden": "true" }));
      box.hidden = !signs.length && !xi;
    }
    if (!xi) return;
    var used = {}; xi.list.concat(xi.out).forEach(function (e) { used[e.rel.id] = 1; });
    RELS.forEach(function (r) {
      if (!used[r.id]) return;
      var s = svgEl("svg", { viewBox: "0 0 34 10", width: "34", height: "10", "aria-hidden": "true" });
      s.appendChild(svgEl("path", { d: "M2 5 L32 5", "class": "mpx x-" + r.id }));
      box.appendChild(el("span", { "class": "mp-lg", title: r.hint }, [s, document.createTextNode(r.label)]));
    });
    if (isWater() && RELS.some(function (r) { return r.pipe && used[r.id]; })) {
      var s3 = svgEl("svg", { viewBox: "0 0 34 10", width: "34", height: "10", "aria-hidden": "true" });
      s3.appendChild(svgEl("path", { d: "M2 5 L32 5", "class": "mpx off x-p-supply" }));
      box.appendChild(el("span", { "class": "mp-lg", title: "Moving dots: water flowing, faster where more flows. Grey: no flow (a valve closed, a pump or chiller stopped, or nothing open behind it)." }, [s3, document.createTextNode("No flow")]));
    }
    if (isWiring() && used["w-power"]) {
      var s2 = svgEl("svg", { viewBox: "0 0 34 10", width: "34", height: "10", "aria-hidden": "true" });
      s2.appendChild(svgEl("path", { d: "M2 5 L32 5", "class": "mpx off x-w-power" }));
      box.appendChild(el("span", { "class": "mp-lg", title: "Moving dots: current flowing. Grey: no flow (an end has no supply, or is open or isolated)." }, [s2, document.createTextNode("No flow")]));
      if (Object.keys(lastPower && lastPower.ctl || {}).length) {
        box.appendChild(el("span", { "class": "mp-lg" }, [el("i", { "class": "mp-dot run", "aria-hidden": "true" }), document.createTextNode("Running")]));
        box.appendChild(el("span", { "class": "mp-lg" }, [el("i", { "class": "mp-dot", "aria-hidden": "true" }), document.createTextNode("Stopped")]));
      }
    }
  }

  // ---------- the notes card on the map (peek) ----------
  var peekEl = null, peekEdit = false;
  function peekCard(n) {
    if (peekEdit && peekEl && peekEl._for === n.id) return peekEl;        // kept while writing: the text box keeps its place
    var may = canEdit() && !st.note, E = peekEdit && may;
    var box = el("div", { "class": "mp-peek b" + hue(n.id), role: "region", "aria-label": "Notes of " + n.title });
    box._for = n.id;
    box.appendChild(el("div", { "class": "mp-peek-top" }, [
      E ? el("span", { "class": "mp-status", id: "mpStatus", role: "status" }) : el("span", { "class": "mp-peek-h", text: "Notes" }),
      may ? el("button", { type: "button", "class": "btn " + (E ? "" : "ghost ") + "sm", text: E ? "Done" : "Edit", title: E ? "Stop editing" : "Write in the notes",
        onclick: function () { peekEdit = !E; if (!peekEdit) flush(); peekEl = null; renderView(); if (peekEdit && $("mpPeekText")) $("mpPeekText").focus({ preventScroll: true }); } }) : null,
      n.kids.length && n.id !== st.focus ? el("button", { type: "button", "class": "btn ghost sm", title: "Show this branch alone" + (colsOf(n) ? ": its own diagram" : ""),
        onclick: function () { var id = n.id; closePeek(true); focusOn(id); } }, [ico("focus"), document.createTextNode(" Alone")]) : null,
      el("button", { type: "button", "class": "mp-peek-x", text: "×", title: "Close", "aria-label": "Close the notes", onclick: function () { closePeek(); } })
    ]));
    if (E) {
      var ta = el("textarea", { "class": "mp-peek-in", id: "mpPeekText", maxlength: "8000", placeholder: "What to know about " + n.title + "…", "aria-label": "Notes of " + n.title, text: n.notes });
      ta.addEventListener("input", function () { typed(n.id, "notes", ta.value); });
      ta.addEventListener("blur", flush);
      ta.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); peekEdit = false; flush(); peekEl = null; renderView(); refocus(n.id); } });
      box.appendChild(ta);
    } else box.appendChild(n.notes ? el("div", { "class": "mp-peek-text", text: n.notes }) : el("p", { "class": "mp-peek-none", text: "No notes on this branch." + (may ? " Press Edit to write some." : "") }));
    // the card shows the special notes that say something (a 2D place and a chosen sign are kept out of it)
    var said = n.special.filter(function (x) { return !/^\s*(place|icon|sign)\s*:/i.test(x); });
    if (said.length) box.appendChild(el("div", { "class": "mp-chips mp-peek-sp" }, said.map(function (x) { return el("span", { "class": "mp-chip" }, [el("b", { text: "!" }), x]); })));
    if (lastWater && lastWater.part[n.id]) box.appendChild(waterCard(n));
    var pw = isWiring() ? power() : null;
    if (pw && pw.known && pw.part[n.id]) {
      var path = [], at = n.id; while (pw.from[at]) { at = pw.from[at]; path.push(N(at).title); }
      var open = isOpen(n.id), live = !!pw.on[n.id], feeds = downstream(pw, n.id), sw = /./.test(noteVal(n, "switch")) || st.iso[n.id] != null;
      // where its power comes from: the branch that feeds it and the source behind (the whole path is the line on the map)
      var says = live ? (noteVal(n, "source") ? "Source of power." : "Fed by " + path[0] + (path.length > 1 ? ", from " + path[path.length - 1] : "") + ".")
        : open ? (sw && !st.iso[n.id] ? "Open: passes no power until it is closed." : "Isolated: no power here or downstream.")
        : pw.shed[n.id] ? "Shed: its supply is opened to keep " + N(pw.shed[n.id]).title + " within its max." : "No supply: something upstream is open, isolated or shed.";
      box.appendChild(el("div", { "class": "mp-power" + (live ? " on" : "") }, [
        el("p", { text: says + (feeds ? " Feeds " + feeds + (feeds === 1 ? " branch." : " branches.") : "") }),
        el("button", { type: "button", "class": "btn ghost sm", text: open ? (noteVal(n, "switch") && st.iso[n.id] == null ? "Close (simulation)" : "Reconnect (simulation)") : "Isolate (simulation)",
          title: "Tries it in this browser only: nothing is saved, a reload starts again.",
          onclick: function () { st.iso[n.id] = !open; peekEl = null; renderView(); } })]));
    }
    if (pw && pw.part[n.id]) box.appendChild(powerCard(n, pw));
    var ff = feedForm(n, pw); if (ff) box.appendChild(ff);
    // a unit the BMS commands: its state and Start / Stop
    if (pw && pw.cmd && pw.cmd[n.id]) {
      var stt = pw.state[n.id] || "running", stopped = st.cmd[n.id] === false, master = pw.follow[n.id] ? N(pw.follow[n.id]).title : "";
      var ctlSays = { running: master ? "Running: started by " + master + " (interlock)." : "Running: the BMS command is on, the run status goes back to the BMS.",
        stopped: "Stopped by the BMS.", night: "Stopped: unoccupied (night) schedule of the BMS.",
        nopower: "No power: " + (pw.ctl[n.id] ? "the BMS command cannot start it." : "it cannot run."),
        fire: "Stopped by the fire alarm (" + (pw.fire[n.id] ? N(pw.fire[n.id]).title : "shutdown contact") + ").",
        interlock: "Stopped: interlock" + (master ? " with " + master + ", which is not running." : ".") }[stt];
      box.appendChild(el("div", { "class": "mp-power mp-ctl" + (stt === "running" ? " on" : "") }, [el("p", { text: ctlSays }),
        pw.ctl[n.id] ? el("button", { type: "button", "class": "btn ghost sm", text: stopped ? "BMS: start (simulation)" : "BMS: stop (simulation)", title: "Tries it in this browser only: nothing is saved.",
          onclick: function () { if (stopped) delete st.cmd[n.id]; else st.cmd[n.id] = false; peekEl = null; renderView(); } }) : null]));
    }
    // a fire alarm panel: sound the alarm (simulation) and see what it stops
    if (pw && pw.fires && pw.fires.indexOf(n.id) >= 0) {
      var stops = Object.keys(pw.fire).filter(function (k) { return pw.fire[k] === n.id; });
      box.appendChild(el("div", { "class": "mp-power mp-ctl" + (st.fire ? " alarm" : " on") }, [
        el("p", { text: (st.fire ? "Fire alarm: " + plural(stops.length, "unit") + " stopped by its shutdown contacts." : "Normal: its shutdown contacts reach " + plural(stops.length, "unit") + ".") }),
        el("button", { type: "button", "class": "btn " + (st.fire ? "" : "danger ") + "sm", text: st.fire ? "Reset the fire alarm" : "Fire alarm (simulation)", title: "Tries it in this browser only: nothing is saved.",
          onclick: function () { st.fire = !st.fire; peekEl = null; renderView(); } })]));
    }
    // a piece of equipment with nothing under it: add its product's wiring diagram (map editors)
    if (pw && canEdit() && !st.note && !n.kids.length && (pw.part[n.id] || (pw.ctl && pw.ctl[n.id])) && !noteVal(n, "source") && !isBms(n.id) && ["", "chiller", "ahu", "fcu"].indexOf(signOf(n)) >= 0) {
      var tSel = el("select", { "class": "input mp-relsel", "aria-label": "Which unit" }, PRODUCTS.map(function (x) { return el("option", { value: x[0], text: x[1] }); }));
      tSel.value = /fcu/i.test(n.title) ? "fcu-ec" : /chiller/i.test(n.title) ? "chiller" : "ahu-ec";
      var addB = el("button", { type: "button", "class": "btn sm", text: "Add", onclick: function () {
        addB.disabled = true;
        Api.mpWiringAdd(T, n.id, tSel.value).then(function (r) {
          st.peek = null; peekEl = null;
          return reload().then(function () { focusOn(n.id); Hub.toast("Wiring diagram added: " + r.added + " branches, all to verify against the factory drawing."); });
        }, function (e) { addB.disabled = false; Hub.toast(e.message, true); });
      } });
      box.appendChild(el("div", { "class": "mp-power" }, [el("p", { text: "Add its wiring diagram: the unit's panel, parts and wires, joined to this feeder and to the BMS." }),
        el("div", { "class": "mp-rowwrap" }, [tSel, addB])]));
    }
    // the BMS itself: the schedule and every unit at once
    if (pw && pw.bms && pw.bms.indexOf(n.id) >= 0) {
      var mine = Object.keys(pw.ctl).filter(function (k) { return pw.ctl[k] === n.id; });
      var run = mine.filter(function (k) { return pw.state[k] === "running"; }).length;
      box.appendChild(el("div", { "class": "mp-power mp-ctl on" }, [
        el("p", { text: (st.night ? "Night: unoccupied schedule. " : "Day: occupied schedule. ") + "Commands " + mine.length + " units, " + run + " running." }),
        el("div", { "class": "mp-rowwrap" }, [
          el("button", { type: "button", "class": "btn ghost sm", text: st.night ? "Switch to day" : "Switch to night", onclick: function () { st.night = !st.night; peekEl = null; renderView(); } }),
          el("button", { type: "button", "class": "btn ghost sm", text: "Stop all", onclick: function () { mine.forEach(function (k) { st.cmd[k] = false; }); peekEl = null; renderView(); } }),
          el("button", { type: "button", "class": "btn ghost sm", text: "Start all", onclick: function () { mine.forEach(function (k) { delete st.cmd[k]; }); peekEl = null; renderView(); } })]),
        el("p", { "class": "small muted", text: "A simulation in this browser only: nothing is saved." })]));
    }
    peekEl = box;
    if (E) { if (retry && retry.id === n.id) status("Not saved yet.", true, true); }
    return box;
  }
  function closePeek(quiet) {
    var id = st.peek;
    flush(); st.peek = null; peekEdit = false; peekEl = null;
    if (!quiet) { renderView(); if (id && N(id)) refocus(id); }
  }
  function keepInView(s, z) {                     // keep the chosen branch, and the branches it just grew, in view
    var canvas = $("mpCanvas");
    if (!s || s._x === undefined) return;
    {
      var pv = st.peek === s.id && s._px !== undefined;
      var right = ((pv ? s._px + s._pw : s._x + s._w + (s.open && s.kids.length ? 260 : 0)) + 30) * z, left = (s._x - 30) * z;
      if (right > canvas.scrollLeft + canvas.clientWidth) canvas.scrollLeft = Math.min(left, right - canvas.clientWidth);
      if (left < canvas.scrollLeft) canvas.scrollLeft = Math.max(0, left);
      var top = (s._y - 30) * z, bottom = (s._y + s._h + 30) * z;
      if (s.open && s.kids.length) { top = Math.min(top, (N(s.kids[0])._y - 20) * z); bottom = Math.max(bottom, (N(s.kids[s.kids.length - 1])._y + 50) * z); }
      if (pv) { top = Math.min(top, (s._py - 20) * z); bottom = Math.max(bottom, (s._py + s._ph + 20) * z); }
      if (bottom - top > canvas.clientHeight) bottom = top + canvas.clientHeight;
      if (top < canvas.scrollTop) canvas.scrollTop = Math.max(0, top);
      else if (bottom > canvas.scrollTop + canvas.clientHeight) canvas.scrollTop = bottom - canvas.clientHeight;
    }
  }

  // ---------- zoom, fit, full screen ----------
  function setZoom(z, cx, cy) {
    var c = $("mpCanvas"), old = st.zoom;
    z = Math.max(0.3, Math.min(2, Math.round(z * 100) / 100));
    if (z === old) return;
    if (cx === undefined) { cx = c.clientWidth / 2; cy = c.clientHeight / 2; }
    var px = (c.scrollLeft + cx) / old, py = (c.scrollTop + cy) / old;
    st.zoom = z; store("localStorage", userKey("zoom") + ":" + M.map.id, String(z));
    var stage = $("mpStage"), sizer = $("mpSizer");
    stage.style.transform = "scale(" + z + ")";
    sizer.style.width = Math.ceil(stage.offsetWidth * z) + "px"; sizer.style.height = Math.ceil(stage.offsetHeight * z) + "px";
    c.scrollLeft = px * z - cx; c.scrollTop = py * z - cy;
    $("mpZoomPct").textContent = Math.round(z * 100) + "%";
  }
  function zoomBy(k, cx, cy) { setZoom(st.zoom * k, cx, cy); }
  function fit() {
    var c = $("mpCanvas"), stage = $("mpStage");
    var z = Math.min(1, (c.clientWidth - 10) / stage.offsetWidth, (c.clientHeight - 10) / stage.offsetHeight);
    setZoom(Math.max(0.3, z)); c.scrollLeft = 0; c.scrollTop = 0;
  }
  // Full screen: the map fills the screen (the browser's full screen when it allows it); Esc leaves it
  function full(on, fromBrowser) {
    st.full = on;
    $("mpMap").classList.toggle("mp-fullscreen", on);
    document.documentElement.classList.toggle("mp-noscroll", on);
    $("mpFull").setAttribute("aria-pressed", on ? "true" : "false");
    $("mpFull").title = on ? "Leave full screen (Esc)" : "Full screen";
    $("mpFullTxt").textContent = on ? "Exit full screen" : "Full screen";
    if (!fromBrowser) {
      try {
        if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () { /* the page alone is enough */ });
        if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* ignore */ });
      } catch (e) { /* ignore */ }
    }
    if (on && st.view === "outline") setView("map"); else renderView();
  }

  // ---------- the mouse and the keys on the map ----------
  // Press and hold, then move: the map moves with it (a click that did not move picks the branch). The wheel
  // scrolls up and down, Shift + wheel (or a touchpad) sideways, Ctrl + wheel zooms where the pointer is.
  function canvasMouse() {
    var c = $("mpCanvas"), drag = null;
    c.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.pointerType === "touch") return;                 // a finger scrolls the page natively
      if (e.target.closest && e.target.closest(".mp-peek, .mp-xl")) return;    // selecting text in the notes card, a line's words
      if (st.view === "schematic" && st.edit && canEdit() && e.target.closest && e.target.closest("[data-sx]")) { sxPointerDown(e); return; }
      drag = { x: e.clientX, y: e.clientY, sl: c.scrollLeft, st: c.scrollTop, moved: false, id: e.pointerId };
    });
    c.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!drag.moved) { drag.moved = true; c.classList.add("mp-panning"); try { c.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
      c.scrollLeft = drag.sl - dx; c.scrollTop = drag.st - dy;
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      if (drag.moved) { c.classList.remove("mp-panning"); c.addEventListener("click", swallow, true); }
      drag = null;
    }
    function swallow(e) { e.stopPropagation(); e.preventDefault(); c.removeEventListener("click", swallow, true); }
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    c.addEventListener("wheel", function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;                                   // plain wheel: the browser scrolls
      e.preventDefault();
      var r = c.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener("click", function (e) { branchClick(e, true); });
    c.addEventListener("dblclick", branchDblClick);
    c.addEventListener("keydown", function (e) {
      var nodeE = e.target.closest ? e.target.closest("[data-node]") : null;
      if (!nodeE || e.target !== nodeE) return;
      nodeKey(e, N(nodeE.getAttribute("data-node")));
    });
  }
  // a click on a branch, on the map or in the outline. The second click of a double-click does nothing here:
  // the double-click opens the branch that the first click chose (the drawing may have moved under the mouse).
  var lastClick = { id: null, t: 0, closed: false };
  function branchClick(e, onMap) {
    if (e.detail > 1) return;
    if (e.target.closest && e.target.closest(".mp-peek, .mp-xl")) return;
    if (onMap && (st.view === "schematic" || st.view === "flow")) { sxClick(e); return; }
    var nodeE = e.target.closest ? e.target.closest("[data-node]") : null;
    if (!nodeE) { if (onMap && (st.sel || st.peek)) { st.sel = null; if (st.peek) closePeek(true); renderView(); } return; }
    var n = N(nodeE.getAttribute("data-node")), act = e.target.closest("[data-act]");
    if (!n) return;
    lastClick = { id: null, t: 0, closed: false };
    if (act && act.getAttribute("data-act") === "toggle") { toggleOne(n); return; }
    if (act && act.getAttribute("data-act") === "note") { openNote(n.id); return; }
    if (act && act.getAttribute("data-act") === "alone") { focusOn(n.id); return; }
    // a finger has no double-click: a tap on the chosen branch reads it, as a second click would
    if ((COARSE.matches || e.pointerType === "touch") && st.sel === n.id) { openNote(n.id); return; }
    if (e.ctrlKey || e.metaKey) { toggleOne(n); return; }
    lastClick = { id: n.id, t: Date.now(), closed: false };
    lastClick.closed = drill(n);
  }
  function branchDblClick(e) {
    var nodeE = e.target.closest ? e.target.closest("[data-node]") : null;
    var recent = lastClick.id && Date.now() - lastClick.t < 900 && N(lastClick.id) ? lastClick.id : null;
    if (e.target.closest && e.target.closest("[data-act]")) return;
    // the first click may have opened the notes card and scrolled it into view, so the second one lands on the card:
    // the double-click still belongs to the branch the first click chose (a double-click inside the card alone selects a word)
    if (!recent && e.target.closest && e.target.closest(".mp-peek, .mp-xl")) return;
    var id = recent || (nodeE ? nodeE.getAttribute("data-node") : null);
    if (!id) return;
    e.preventDefault();
    if (lastClick.id === id && lastClick.closed) { N(id).open = true; if (!N(id).kids.length && st.view === "map") st.peek = id; }   // the first click closed it: reading does not close it
    lastClick = { id: null, t: 0, closed: false };
    if (window.getSelection) { try { window.getSelection().removeAllRanges(); } catch (x) { /* ignore */ } }
    openNote(id);
  }
  function nodeKey(e, n) {
    if (!n) return;
    var vis = visible(), i = vis.indexOf(n.id), go = null;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNote(n.id); return; }
    if (e.key === "ArrowDown") go = vis[i + 1];
    else if (e.key === "ArrowUp") go = vis[i - 1];
    else if (e.key === "ArrowRight") { if (n.kids.length && !n.open) { e.preventDefault(); toggle(n); return; } go = n.open ? n.kids[0] : null; }
    else if (e.key === "ArrowLeft") { if (n.open && n.kids.length) { e.preventDefault(); toggle(n); return; } go = n.id !== st.focus ? n.parent : null; }
    else if (e.key === "Home") go = st.focus;
    else if (e.key === "Tab" && st.edit && canEdit() && !e.shiftKey) { e.preventDefault(); addBranch(n, "New branch", true); return; }
    else if ((e.key === "Delete" || e.key === "Backspace") && st.edit && canEdit() && n.id !== M.root) { e.preventDefault(); removeBranch(n); return; }
    else if (e.key === "F2" && st.edit && canEdit()) { e.preventDefault(); openNote(n.id, "name"); return; }
    if (go !== null) e.preventDefault();
    if (go && N(go)) pick(N(go));
  }
  function pageKeys(e) {
    if (!M || st.note || document.querySelector(".hub-sheet-back")) return;
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
    if (typing) return;
    if ((e.key === "+" || e.key === "=") && st.view !== "outline") { e.preventDefault(); zoomBy(1.2); }
    else if ((e.key === "-" || e.key === "_") && st.view !== "outline") { e.preventDefault(); zoomBy(1 / 1.2); }
    else if (e.key === "0" && st.view !== "outline") { e.preventDefault(); setZoom(1); }
    else if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); full(!st.full); }
    else if (e.key === "Escape" && st.full) { e.preventDefault(); full(false); }
  }
  function refocus(id) { var x = document.querySelector('[data-node="' + id + '"]'); if (x && document.activeElement !== x) x.focus({ preventScroll: true }); }

  // ---------- the outline ----------
  function renderOutline() {
    var host = $("mpOutline");
    host.textContent = "";
    host.appendChild(el("ul", { role: "tree" }, [(function li(id) {
      var n = N(id);
      return el("li", {}, [nodeEl(n, "mp-orow"), n.open && n.kids.length ? el("ul", { role: "group" }, n.kids.map(li)) : null]);
    })(st.focus)]));
    if (wantScroll && st.sel) { var x = host.querySelector('[data-node="' + st.sel + '"]'); if (x && x.scrollIntoView) x.scrollIntoView({ block: "nearest" }); }
    wantScroll = false;
  }
  function outlineMouse() {
    var o = $("mpOutline");
    o.addEventListener("click", function (e) { branchClick(e, false); });
    o.addEventListener("dblclick", branchDblClick);
    o.addEventListener("keydown", function (e) {
      var nodeE = e.target.closest ? e.target.closest("[data-node]") : null;
      if (nodeE && e.target === nodeE) nodeKey(e, N(nodeE.getAttribute("data-node")));
    });
  }
  function renderCrumbs() {
    var c = $("mpCrumbs"), p = pathOf(st.focus); c.textContent = "";
    p.forEach(function (id, i) {
      if (i) c.appendChild(el("span", { "class": "sep", text: "›" }));
      if (i === p.length - 1) c.appendChild(el("span", { "class": "here", text: N(id).title }));
      else c.appendChild(el("button", { type: "button", text: N(id).title, onclick: function () { focusOn(id); } }));
    });
    if (p.length > 1) c.appendChild(el("button", { type: "button", "class": "btn ghost sm", text: "Whole map", onclick: function () { focusOn(M.root); } }));
  }
  function renderPills() {
    var b = 0, s = 0, v = 0, hits = 0;
    each(M.root, function (n) { b++; s += n.special.length; if (!n.verified) v++; });
    if (st.q) each(st.focus, function (n) { if (matches(n)) hits++; });
    var p = $("mpPills"); p.textContent = "";
    if (st.q) p.appendChild(el("span", { "class": "badge brand", text: hits + " found" }));
    p.appendChild(el("span", { "class": "badge", text: plural(b - 1, "branch", "branches") }));
    p.appendChild(el("span", { "class": "badge", text: plural(s, "special note") }));
    p.appendChild(el("span", { "class": "badge " + (v ? "warn" : "ok"), text: v ? v + " to verify" : "All verified" }));
    // a piping map: what each circuit does now (with the simulation), and what to look at
    var w = lastWater;
    if (w) {
      var badge = function (cls, text, title, go) { var x = el(go ? "button" : "span", { "class": "badge " + cls + (go ? " mp-badgebtn" : ""), text: text, title: title || null, type: go ? "button" : null, onclick: go || null }); p.appendChild(x); };
      var who = function (ids) { return ids.map(function (k) { return N(k) ? N(k).title : k; }).join("\n"); };
      ["chw", "cw"].forEach(function (c) {
        var r = w.circuits[c]; if (!r) return;
        var t = r.total;
        if (t.q > 0) badge("brand", r.C.name + " " + [wFlow(t.q), t.out != null && t.back != null ? wRange(t.out, t.back) : t.out != null ? wTemp(t.out) : "", t.kw != null ? W().fmtKw(t.kw) : ""].filter(Boolean).join(" · "),
          "Every running source together: flow, supply and mixed return temperatures, load (4.19 kW per l/s per K)");
        else badge("warn", r.C.name + ": no water flowing");
        var over = Object.keys(r.source).filter(function (k) { return r.source[k].over; });
        if (over.length) badge("warn", plural(over.length, "source") + " above design flow", who(over));
        var atCap = Object.keys(r.source).filter(function (k) { return r.source[k].atCap; });
        if (atCap.length) badge("warn", plural(atCap.length, r.C.id === "cw" ? "tower" : "chiller") + " at capacity: supply " + wTemp(Math.max.apply(null, atCap.map(function (k) { return r.source[k].out; }))),
          who(atCap) + "\nOver its Capacity: it runs at it and its leaving water rises (amber supply pipes).", function () { flush(); reveal(atCap[0]); });
        var lims = Object.keys(r.limitAt);
        if (lims.length) badge("warn", plural(Object.keys(r.limited).length, "unit") + " limited by a max flow", who(lims), function () { flush(); reveal(lims[0]); });
        if (r.missing.length) badge("warn", plural(r.missing.length, "unit") + " without a leaving temperature", who(r.missing));
        var h = r.hyd;
        if (h && h.ok) {
          if (h.index) {
            var ix = h.index.id, m = h.index.margin;
            badge(m < 0 ? "warn" : "ok", (r.C.id === "cw" ? "Last condenser: " : "Last unit: ") + N(ix).title + " has " + wKpa(h.avail[ix]) + " of " + wKpa(h.need[ix]) + (m >= 0 ? " (+" + wKpa(m) + ")" : ""),
              "The unit with the least spare pressure between its supply and return (the index unit). Click to show it.", function () { flush(); reveal(ix); });
          }
          var sv = Object.keys(r.starved);
          if (sv.length) badge("warn", plural(sv.length, "unit") + " short of pressure", who(sv));
          if (h.low.length) badge("warn", plural(h.low.length, "branch", "branches") + " under 0.3 bar", who(h.low));
          var fast = Object.keys(h.pipe).filter(function (k) { return h.pipe[k].fast; });
          if (fast.length) badge("warn", plural(fast.length, "pipe") + " over 400 Pa/m or 3 m/s", fast.map(function (k) { return k.split(">").map(function (x) { return N(x).title; }).join(" → "); }).join("\n"));
          var nos = Object.keys(h.pipe).filter(function (k) { return h.pipe[k].missing; });
          if (nos.length) badge("", plural(nos.length, "pipe") + " without size or length (no friction counted)", nos.map(function (k) { return k.split(">").map(function (x) { return N(x).title; }).join(" → "); }).join("\n"));
        } else if (h && h.why === "pumpdata") badge("", "Pressures: give " + plural(h.pumps.length, "running pump") + " a head and flow", who(h.pumps));
      });
      if (w.noCondenser.length) badge("warn", plural(w.noCondenser.length, "chiller") + " without condenser water", who(w.noCondenser));
      if (w.copAssumed.length) badge("", "COP 5.0 taken for " + plural(w.copAssumed.length, "chiller"), who(w.copAssumed));
    }
    // a wiring map: the load now, what is shed, what is over its max
    var pw = lastPower;
    if (pw && pw.known) {
      var pb = function (cls, text, title, go) { p.appendChild(el(go ? "button" : "span", { "class": "badge " + cls + (go ? " mp-badgebtn" : ""), text: text, title: title || null, type: go ? "button" : null, onclick: go || null })); };
      var srcs = Object.keys(pw.dem).filter(function (k) { return pw.on[k] && !pw.from[k] && pw.dem[k] > 0; });
      var total = srcs.reduce(function (t, k) { return t + pw.dem[k]; }, 0);
      if (total > 0) pb("brand", "Load " + fmtKw(total) + " from " + srcs.map(function (k) { return N(k).title; }).join(", "), "What the running loads draw now (each board's Diversity applied)");
      var shed = Object.keys(pw.shed);
      if (shed.length) pb("warn", plural(shed.length, "load") + " shed to keep a max power", shed.map(function (k) { return N(k).title + " (by " + N(pw.shed[k]).title + ")"; }).join("\n"), function () { flush(); reveal(shed[0]); });
      if (pw.over.length) pb("warn", plural(pw.over.length, "branch", "branches") + " over max power", pw.over.map(function (k) { return N(k).title; }).join("\n"), function () { flush(); reveal(pw.over[0]); });
    }
  }
  var viewQueued = false, outlineWired = false;
  function renderView() {
    if (!outlineWired) { outlineWired = true; outlineMouse(); }
    lastWater = isWater() && W() ? W().compute(M.nodes, st.iso) : null;
    lastPower = isWiring() ? power() : null;
    renderCrumbs(); renderPills();
    if ((st.view === "schematic" || st.view === "flow") && !isNet()) st.view = "map";
    if (st.view === "map" && isNet()) st.view = "flow";
    var map = st.view === "map", canv = st.view !== "outline";
    $("mpCanvas").hidden = !canv; $("mpOutline").hidden = canv; $("mpTools").hidden = !canv;
    $("mpViewMap").setAttribute("aria-selected", map ? "true" : "false"); $("mpViewOut").setAttribute("aria-selected", st.view === "outline" ? "true" : "false");
    $("mpView2d").hidden = !isNet(); $("mpView2d").setAttribute("aria-selected", st.view === "schematic" ? "true" : "false");
    $("mpViewFlow").hidden = !isNet(); $("mpViewFlow").setAttribute("aria-selected", st.view === "flow" ? "true" : "false");
    $("mpViewMap").hidden = isNet();                    // water and electrical maps: Flow | Outline | 2D view (the Outline keeps the tree)
    if (st.view !== "flow") { $("mpJourney").hidden = true; $("mpJourney").textContent = ""; }
    $("mpRead").setAttribute("aria-selected", st.edit ? "false" : "true"); $("mpEdit").setAttribute("aria-selected", st.edit ? "true" : "false");
    $("mpSpecial").setAttribute("aria-pressed", st.special ? "true" : "false");
    var xi = linkIndex(), anyX = xi.list.length + xi.out.length > 0;
    $("mpXlinks").hidden = !anyX;
    $("mpXlinks").setAttribute("aria-pressed", anyX && st.xlinks !== "off" ? "true" : "false");
    var wd = isWiring() ? "Wires" : isWater() ? "Pipes" : "Links";
    var xm = st.view === "schematic" ? st.sxLabels : st.xlinks;    // (the Flow view uses the map's Wires / Pipes choice)
    $("mpXlinksTxt").textContent = (st.view === "schematic" ? (isWiring() ? "Wire words" : "Pipe words") : wd) + (xm === "all" ? ": all" : xm === "off" ? ": off" : ": chosen");
    legend(canv && anyX && (st.xlinks !== "off" || st.view === "schematic") ? xi : null);
    var hasFlow = (isWiring() && xi.list.some(function (e) { return FLOW_KINDS.indexOf(e.rel.id) >= 0; })) || !!lastWater;
    $("mpFlow").hidden = !hasFlow || !canv; $("mpFlow").setAttribute("aria-pressed", st.flow ? "true" : "false");
    $("mpFlow").title = isWater() ? "Moving dots along the pipes that have flow" : "Moving dots along the power lines that have supply";
    var anyIso = Object.keys(st.iso).length > 0 || Object.keys(st.cmd).length > 0 || st.night || st.fire;
    $("mpReset").hidden = !anyIso || !canv;
    $("mpHint").textContent = st.view === "flow" ? (COARSE.matches ? "Tap a branch to follow its way · two fingers to scroll" : "Click a branch to follow its way · double-click to read it · drag to move · Ctrl + wheel to zoom")
      : st.view === "schematic" ? (COARSE.matches ? "Tap a symbol for its figures · two fingers to scroll" : "Click a symbol for its figures · double-click to read it · drag to move · Ctrl + wheel to zoom" + (st.edit ? " · Edit: drag a symbol to place it" : ""))
      : COARSE.matches ? "Tap a branch to open it, tap it again to read it" + (map ? " · two fingers to scroll" : "")
      : "Click a branch to open it · double-click to read it" + (map ? " · drag to move · Ctrl + wheel to zoom" : "") + (st.edit ? " · Tab adds a branch" : "");
    if (st.view === "schematic") renderSchematic(); else if (st.view === "flow") renderFlow(); else if (map) renderMap(); else renderOutline();
    var open = []; Object.keys(M.nodes).forEach(function (id) { if (N(id).open) open.push(id); });
    store("sessionStorage", userKey("open") + ":" + M.map.id, JSON.stringify(open.slice(0, 600)));
  }
  function viewSoon() {                       // while typing a name: one redraw per frame
    if (viewQueued) return; viewQueued = true;
    window.requestAnimationFrame(function () { viewQueued = false; renderView(); });
  }
  function render() { renderView(); renderNote(); }

  // ---------- saving ----------
  // Text typed in the note is saved by itself, shortly after the typing stops and when the branch is left.
  // One request at a time; a failed save is shown and can be sent again.
  var draft = null, retry = null, chain = Promise.resolve(), waiting = 0;
  var lastMsg = { id: null, text: "", bad: false };       // the last save message of the open branch, kept when the note is redrawn
  function status(text, bad, again) {
    lastMsg = { id: st.note, text: again ? "" : text, bad: !!bad && !again };
    var s = $("mpStatus"); if (!s) return;
    s.textContent = text; s.className = "mp-status" + (bad ? " bad" : "");
    if (again) s.appendChild(el("button", { type: "button", "class": "btn ghost sm", style: "margin-left:8px", text: "Save again", onclick: function () { var r = retry; retry = null; if (r) send(r.id, r.patch); } }));
  }
  function typed(id, field, value) {
    N(id)[field] = value;
    if (draft && draft.id !== id) flush();
    if (!draft) draft = { id: id, patch: {} };
    if (retry && retry.id === id) { for (var k in retry.patch) if (!(k in draft.patch)) draft.patch[k] = retry.patch[k]; retry = null; }
    draft.patch[field] = value;
    clearTimeout(draft.timer); draft.timer = setTimeout(flush, 800);
    status("Saving…");
  }
  function flush() {
    if (!draft) return chain;
    var d = draft; draft = null; clearTimeout(d.timer);
    return send(d.id, d.patch);
  }
  function send(id, patch, undo) {
    waiting++; status("Saving…");
    chain = chain.then(function () { return Api.mpNodeSave(T, id, patch); }).then(function (r) {
      waiting--;
      var n = N(id);
      if (n) {
        ["title", "notes", "special", "links"].forEach(function (k) { if (k in patch && !(draft && draft.id === id && k in draft.patch)) n[k] = r.node[k]; });
        n.updated_by = r.node.updated_by; n.updated_at = r.node.updated_at;
        // an edit by someone who may not verify puts a verified branch back to "to verify"
        if (n.verified && !r.node.verified) { n.verified = false; n.verified_by = null; n.verified_at = null; viewSoon(); }
        if (id === M.root && "title" in patch) { M.map.name = n.title; head(); }
      }
      if (!waiting && !draft) { status("Saved"); viewSoon(); foot(); }
    }, function (err) {
      waiting--;
      if (undo) { undo(); render(); Hub.toast("Not saved. " + err.message, true); return; }
      if (!N(id)) return;
      retry = { id: id, patch: patch };
      status("Not saved. " + err.message, true, true);
      Hub.toast("Not saved. " + err.message, true);
    });
    return chain;
  }
  function settled() { flush(); return chain; }       // everything typed has reached the database (or failed and said so)
  function act(promise, done) {                        // one structure change: say when it fails
    return promise.then(done, function (err) { Hub.toast(err.message, true); });
  }

  // ---------- the note: one branch, read or written (focus mode) ----------
  var noteLast = null, noteWant = "";
  function openNote(id, want) {
    if (!N(id)) return;
    if (peekEdit) { peekEdit = false; peekEl = null; }
    if (st.note !== id) flush();
    if (!st.note) noteLast = document.activeElement;
    st.note = id; st.sel = id; noteWant = want || "";
    renderNote(); renderView();
  }
  function closeNote() {
    flush();
    var id = st.note; st.note = null; renderNote();
    wantScroll = true; renderView();
    refocus(id);
  }
  function stepNote(dir) {
    var o = order(), i = o.indexOf(st.note);
    if (i < 0) { reveal(st.note, true); o = order(); i = o.indexOf(st.note); }
    var to = o[i + dir]; if (!to) return;
    pathOf(to).forEach(function (a) { if (a !== to) N(a).open = true; });
    openNote(to);
  }
  function foot() {
    var f = $("mpFoot"), n = st.note && N(st.note); if (!f || !n) return;
    f.textContent = n.updated_at ? "Last changed" + (n.updated_by ? " by " + n.updated_by : "") + ", " + Hub.date(n.updated_at, true) : "";
  }
  function adder(id, placeholder, label, max, fn) {
    var inp = el("input", { "class": "input", type: "text", id: id, placeholder: placeholder, maxlength: String(max), autocomplete: "off" });
    function go() { var v = inp.value.replace(/\s+/g, " ").trim(); if (!v) { inp.focus(); return; } fn(v); }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    return el("div", { "class": "mp-add" }, [inp, el("button", { type: "button", "class": "btn ghost", text: label, onclick: go })]);
  }
  var noteFor = null;
  function renderNote() {
    var back = $("mpNoteBack"), box = $("mpNote"), n = st.note && N(st.note);
    if (!n) { back.hidden = true; box.textContent = ""; noteFor = null; document.documentElement.classList.toggle("mp-noscroll", !!st.full); return; }
    back.hidden = false; document.documentElement.classList.add("mp-noscroll");
    var keep = noteFor === n.id ? box.scrollTop : 0, had = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : "";
    noteFor = n.id;
    box.textContent = "";
    var E = st.edit && canEdit(), isRoot = n.id === M.root, o = order(), at = o.indexOf(n.id);
    var trail = pathOf(n.id).slice(0, -1);
    // top: where it is, place in the reading order, close
    box.appendChild(el("div", { "class": "mp-ntop" }, [
      el("nav", { "class": "mp-ntrail", "aria-label": "Where this branch is" }, trail.map(function (id, i) {
        return el("span", {}, [i ? el("span", { "class": "sep", text: "›" }) : null, el("button", { type: "button", text: N(id).title, onclick: function () { openNote(id); } })]);
      })),
      el("div", { "class": "mp-nnav" }, [
        at >= 0 ? el("span", { "class": "small muted", text: (at + 1) + " of " + o.length }) : null,
        el("button", { type: "button", "class": "btn ghost sm", text: "‹ Previous", title: "Previous branch (Alt + ←)", disabled: at <= 0, onclick: function () { stepNote(-1); } }),
        el("button", { type: "button", "class": "btn ghost sm", text: "Next ›", title: "Next branch (Alt + →)", disabled: at < 0 || at >= o.length - 1, onclick: function () { stepNote(1); } }),
        canEdit() ? el("button", { type: "button", "class": "btn " + (E ? "" : "ghost ") + "sm", id: "mpNoteEdit", "aria-pressed": E ? "true" : "false",
          text: E ? "Done" : "Edit", title: E ? "Stop editing (E)" : "Edit this branch (E)", onclick: noteEdit }) : null,
        el("button", { type: "button", "class": "btn " + (E ? "ghost " : "") + "sm", text: "Close", title: "Close (Esc)", onclick: closeNote })
      ])
    ]));
    // the name
    if (E) {
      var name = el("input", { "class": "mp-ntitle-in", type: "text", id: "mpName", value: n.title, maxlength: isRoot ? "80" : "120", autocomplete: "off", disabled: isRoot && !isOwn(), "aria-label": isRoot ? "Map name" : "Branch name" });
      name.addEventListener("input", function () {
        var v = name.value.replace(/\s+/g, " ").trim();
        if (!v) { status("Give the branch a name.", true); return; }
        typed(n.id, "title", v); viewSoon();
      });
      name.addEventListener("blur", function () { if (!name.value.trim()) { name.value = n.title; status(""); } flush(); });
      name.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if ($("mpNotes")) $("mpNotes").focus(); } });
      box.appendChild(name);
    } else box.appendChild(el("h2", { "class": "mp-ntitle", id: "mpNTitle" }, [isRoot ? null : signEl(n, true), document.createTextNode(n.title)]));
    box.appendChild(el("div", { "class": "mp-rowwrap" }, [
      el("span", { "class": "badge " + (n.verified ? "ok" : "warn"), text: n.verified ? "Verified" : "To verify" }),
      n.verified && n.verified_by ? el("span", { "class": "small muted", text: "by " + n.verified_by + (n.verified_at ? ", " + Hub.date(n.verified_at) : "") }) : null,
      E ? el("span", { "class": "mp-status", id: "mpStatus", role: "status" }) : null
    ]));
    if (E) {
      if (retry && retry.id === n.id) status("Not saved yet.", true, true);
      else if (lastMsg.id === n.id && lastMsg.text) status(lastMsg.text, lastMsg.bad);
    }
    // notes: the heart of it
    var notes;
    if (E) {
      notes = el("textarea", { "class": "mp-ntext-in", id: "mpNotes", maxlength: "8000", placeholder: "What to know about " + n.title + "…", "aria-label": "Notes", text: n.notes });
      notes.addEventListener("input", function () { typed(n.id, "notes", notes.value); grow(notes); });
      notes.addEventListener("blur", flush);
    } else notes = n.notes ? el("div", { "class": "mp-ntext", text: n.notes }) : n.special.length ? null : el("p", { "class": "muted", text: "No notes on this branch." });
    if (notes) box.appendChild(notes);
    // special notes
    if (n.special.length || E) {
      var sp = el("section", { "class": "mp-nsec" }, [el("h3", { text: "Special notes" })]);
      // reading: "Name: value" lines (rule books, vocabularies) as a list of fields, the others as chips
      var FIELD = /^\s*([A-Za-z][A-Za-z ]{1,20}):\s*(.+)$/;
      var fieldsOf = E ? [] : n.special.filter(function (s) { return FIELD.test(s); });
      if (fieldsOf.length) sp.appendChild(el("dl", { "class": "mp-fields" }, [].concat.apply([], fieldsOf.map(function (s) {
        var m = FIELD.exec(s); return [el("dt", { text: m[1] }), el("dd", { text: m[2] })];
      }))));
      var chipsOf = E ? n.special : n.special.filter(function (s) { return !FIELD.test(s); });
      if (chipsOf.length) sp.appendChild(el("div", { "class": "mp-chips" }, n.special.map(function (s, i) {
        if (chipsOf.indexOf(s) < 0) return null;
        return el("span", { "class": "mp-chip" }, [el("b", { text: "!" }), s,
          E ? el("button", { type: "button", "aria-label": "Remove special note: " + s, text: "×", onclick: function () { setList(n, "special", n.special.filter(function (x, j) { return j !== i; })); } }) : null]);
      })));
      if (E) sp.appendChild(adder("mpSpecialIn", "e.g. 50Hz for Egypt, or Terms: air tightness, casing leakage", "Add", 200, function (v) {
        if (n.special.length >= 20) { Hub.toast("A branch holds up to 20 special notes.", true); return; }
        setList(n, "special", n.special.concat([v]), "mpSpecialIn");
      }));
      box.appendChild(sp);
    }
    // the sign: Auto (from the name), None, or one chosen; kept as the special note "Icon: <id>"
    if (E && !isRoot && window.MPSigns) {
      var ch = window.MPSigns.chosen(n.special), auto = window.MPSigns.guess(n.title), cur = ch.set ? (ch.id || "none") : "auto";
      var pickSign = function (v) {
        var list = n.special.filter(function (x) { return !/^\s*(?:icon|sign)\s*:/i.test(x); });
        if (v !== "auto") list.push("Icon: " + v);
        if (list.length > 20) { Hub.toast("A branch holds up to 20 special notes.", true); return; }
        setList(n, "special", list);
      };
      var chip = function (v, label, svg) {
        return el("button", { type: "button", "class": "mp-sgn" + (cur === v ? " on" : ""), "aria-pressed": cur === v ? "true" : "false", title: label, "aria-label": "Sign: " + label,
          onclick: function () { if (cur !== v) pickSign(v); } }, [svg ? el("span", { "class": "mp-ic", "aria-hidden": "true", html: svg }) : null, el("span", { text: label })]);
      };
      var signs = [chip("auto", "Auto" + (auto ? ": " + window.MPSigns.name(auto) : ": none"), auto ? window.MPSigns.svg(auto) : ""), chip("none", "None", "")]
        .concat(window.MPSigns.ids.map(function (id) { return chip(id, window.MPSigns.name(id), window.MPSigns.svg(id)); }));
      box.appendChild(el("section", { "class": "mp-nsec" }, [el("h3", { text: "Sign" }),
        el("p", { "class": "small muted", text: "Auto takes the sign from the branch name. A chosen sign is kept as the special note \"Icon: ...\"." }),
        el("div", { "class": "mp-sgns" }, signs)]));
    }
    // a piping map: the water through this branch, as worked out now
    if (lastWater && lastWater.part[n.id]) box.appendChild(el("section", { "class": "mp-nsec" }, [el("h3", { text: "Water" }), el("p", { "class": "mp-wsays", text: waterSays(n) }),
      E ? el("p", { "class": "small muted", text: "Typed as special notes: Flow, Leaving (or Load), Source, Design flow, Valve: closed, Pump: standby." }) : null]));
    // links
    var shown = [];
    n.links.forEach(function (l, i) {
      var a = linkNode(l, n.id); if (!a) return;
      var kindSel = null;
      if (E && l.kind === "node") {
        kindSel = el("select", { "class": "input mp-relsel", "aria-label": "What the link to " + l.label + " means" }, relOptions());
        kindSel.value = relOf(l).id;
        kindSel.addEventListener("change", function () { var v = kindSel.value; setList(n, "links", n.links.map(function (x, j) { if (j !== i) return x; var y = {}; for (var k in x) y[k] = x[k]; y.rel = v; return y; })); });
      }
      var change = E && l.kind === "node" ? el("button", { type: "button", "class": "btn ghost sm", text: "Change", "aria-label": "Change the link to " + l.label, onclick: function () { linkSheet(n, i); } }) : null;
      shown.push(E ? el("div", { "class": "mp-linkrow" }, [a, kindSel, change, el("button", { type: "button", "class": "btn ghost sm", text: "Remove", "aria-label": "Remove link " + l.label,
        onclick: function () { setList(n, "links", n.links.filter(function (x, j) { return j !== i; })); } })]) : a);
    });
    if (shown.length || E) box.appendChild(el("section", { "class": "mp-nsec" }, [el("h3", { text: "Links" })].concat(shown,
      E ? [el("div", {}, [el("button", { type: "button", "class": "btn ghost sm", text: "Add link", onclick: function () { linkSheet(n); } })])] : [])));
    // the other end: branches of this map that link here
    var inbound = linkIndex().list.filter(function (e) { return e.to === n.id; });
    if (inbound.length) box.appendChild(el("section", { "class": "mp-nsec" }, [el("h3", { text: "Linked from" })].concat(inbound.map(function (e) {
      return el("button", { type: "button", "class": "mp-link", onclick: function () { openNote(e.from); } }, [el("i", { "class": "mp-relsw x-" + e.rel.id, "aria-hidden": "true" }),
        el("span", { "class": "t", text: N(e.from).title }), el("small", { text: e.rel.wire ? wireText(e.l, e.rel, e.from) : e.rel.back })]);
    }))));
    // what grows from it
    if (n.kids.length || E) {
      var kids = el("section", { "class": "mp-nsec" }, [el("h3", { text: n.kids.length ? plural(n.kids.length, "branch", "branches") + " under it" : "Branches under it" })]);
      if (n.kids.length) kids.appendChild(el("ul", { "class": "mp-nkids" }, n.kids.map(function (k) {
        var c = N(k);
        return el("li", {}, [el("button", { type: "button", "class": c.verified ? "" : "unv", onclick: function () { N(n.id).open = true; openNote(k); } }, [
          el("span", { text: c.title }), c.notes ? ico("note") : null, c.kids.length ? el("small", { text: String(c.kids.length) }) : null])]);
      })));
      if (E) kids.appendChild(adder("mpChild", "Name of a new branch under " + n.title, "Add", 120, function (v) { addBranch(n, v); }));
      box.appendChild(kids);
    }
    // this branch: verify, move, show alone, delete
    var tools2 = [];
    if (n.id !== st.focus) tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Show this branch alone", onclick: function () { var id = n.id; closeNote(); focusOn(id); } }));
    if (E) {
      var sibs = isRoot ? [] : N(n.parent).kids, pos = sibs.indexOf(n.id), mayVerify = !!M.map.can_verify, below = 0;
      each(n.id, function (x) { if (!x.verified && x.id !== n.id) below++; });
      // only the super user and the admins of the Maps tile verify (a verified branch is what the AI reads)
      if (!n.verified && mayVerify) tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Mark as verified", onclick: function () { verify(n, true, false); } }));
      if (below && mayVerify) tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Verify it and the " + (below === 1 ? "1 branch" : below + " branches") + " under it", onclick: function () { verify(n, true, true); } }));
      if (n.verified) tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Mark to verify", onclick: function () { verify(n, false, false); } }));
      if (!isRoot) {
        tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Move up", disabled: pos <= 0, onclick: function () { move(n, -1); } }));
        tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Move down", disabled: pos < 0 || pos >= sibs.length - 1, onclick: function () { move(n, 1); } }));
        tools2.push(el("button", { type: "button", "class": "btn danger sm", text: "Delete branch", onclick: function () { removeBranch(n); } }));
      }
    }
    if (tools2.length) box.appendChild(el("section", { "class": "mp-nsec" }, [el("h3", { text: "This branch" }), el("div", { "class": "mp-rowwrap" }, tools2)]));
    box.appendChild(el("p", { "class": "mp-foot", id: "mpFoot" }));
    foot();
    box.scrollTop = keep;
    if (notes && notes.tagName === "TEXTAREA") grow(notes);
    var f = had && $(had) ? $(had) : noteWant === "name" && $("mpName") ? $("mpName") : null;
    if (f) { f.focus(); if (noteWant === "name" && f.select) f.select(); }
    else if (noteFor && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    noteWant = "";
  }
  // Edit / Done in the note: the same switch as Read / Edit above the map, without leaving the branch
  function noteEdit() {
    var on = !st.edit;
    setEdit(on, true);
    var f = on ? $("mpNotes") || $("mpName") : $("mpNoteEdit");
    if (f) { f.focus({ preventScroll: true }); if (on && f.tagName === "TEXTAREA") { try { f.setSelectionRange(f.value.length, f.value.length); } catch (x) { /* ignore */ } } }
  }
  function grow(t) { t.style.height = "auto"; t.style.height = Math.max(160, t.scrollHeight + 2) + "px"; }
  function noteWire() {
    var back = $("mpNoteBack"), downOn = null;
    back.addEventListener("mousedown", function (e) { downOn = e.target; });
    back.addEventListener("click", function (e) { if (e.target === back && downOn === back) closeNote(); });
    document.addEventListener("keydown", function (e) {
      if (!st.note || document.querySelector(".hub-sheet-back")) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
      if (e.key === "Escape") { e.preventDefault(); closeNote(); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); stepNote(1); }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); stepNote(-1); }
      else if (!typing && (e.key === "ArrowRight" || e.key === "j")) { e.preventDefault(); stepNote(1); }
      else if (!typing && (e.key === "ArrowLeft" || e.key === "k")) { e.preventDefault(); stepNote(-1); }
      else if (!typing && (e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey && canEdit()) { e.preventDefault(); noteEdit(); }
    });
  }
  // special notes and links: the whole list is saved at once; a refusal puts the list back
  function setList(n, field, list, refocusId) {
    var before = n[field];
    n[field] = list; render();
    if (refocusId && $(refocusId)) $(refocusId).focus();
    flush();
    send(n.id, (function () { var p = {}; p[field] = list; return p; })(), function () { n[field] = before; }).then(function () { if (st.note === n.id && field === "links") renderNote(); });
  }
  function addBranch(n, title, open) {
    settled().then(function () {
      return act(Api.mpNodeAdd(T, n.id, title), function (r) {
        var c = r.node; c.kids = []; c.open = false; M.nodes[c.id] = c; n.kids.push(c.id); n.open = true;
        wantScroll = true;
        if (open) { openNote(c.id, "name"); return; }            // Tab on the map: name it at once
        render();
        if ($("mpChild")) $("mpChild").focus();
      });
    });
  }
  function removeBranch(n) {
    var c = under(n.id);
    Hub.confirm(c ? "The branch and the " + plural(c, "branch", "branches") + " under it are deleted. This cannot be undone."
                  : "The branch is deleted. This cannot be undone.",
      { title: "Delete " + n.title + "?", ok: "Delete branch", danger: true }).then(function (yes) {
      if (!yes) return;
      settled().then(function () {
        return act(Api.mpNodeDelete(T, n.id), function () {
          var par = N(n.parent), gone = [];
          each(n.id, function (x) { gone.push(x.id); });
          par.kids.splice(par.kids.indexOf(n.id), 1);
          if (gone.indexOf(st.focus) >= 0) { st.focus = M.root; setHash(""); }
          gone.forEach(function (id) { delete M.nodes[id]; });
          if (draft && gone.indexOf(draft.id) >= 0) { clearTimeout(draft.timer); draft = null; }
          if (st.note && gone.indexOf(st.note) >= 0) st.note = null;
          st.sel = par.id; render(); refocus(par.id); Hub.toast("Deleted " + n.title + ".");
        });
      });
    });
  }
  function move(n, dir) {
    settled().then(function () {
      return act(Api.mpNodeMove(T, n.id, dir), function (r) {
        N(n.parent).kids = r.order.filter(function (id) { return !!N(id); });
        wantScroll = true; render();
      });
    });
  }
  function verify(n, on, deep) {
    settled().then(function () {
      return act(Api.mpNodeVerify(T, { id: n.id, verified: on, deep: deep }), function () {
        var now = new Date().toISOString();
        (deep ? each : function (id, fn) { fn(N(id)); })(n.id, function (x) {
          if (x.verified === on) return;
          x.verified = on; x.verified_by = on ? profile.user.full_name : null; x.verified_at = on ? now : null;
        });
        render();
      });
    });
  }

  // ---------- links ----------
  function linkNode(l, from) {
    var t;
    if (l.kind === "node") return el("button", { type: "button", "class": "mp-link", onclick: function () { followBranch(l); } }, [el("i", { "class": "mp-relsw x-" + relOf(l).id, "aria-hidden": "true" }), el("span", { "class": "t", text: l.label }),
      el("small", { text: (relOf(l).wire ? wireText(l, relOf(l), from) : relOf(l).label) + (N(l.node) ? "" : " · other map") })]);
    if (l.kind === "standard") {
      if (!tool("standards")) return null;                                   // never point at a tool the account does not have
      return el("a", { "class": "mp-link", href: Hub.url("tools/standards/standard.html#" + encodeURIComponent(l.id)) }, [ico("link"), el("span", { "class": "t", text: l.label }), el("small", { text: "Standard" })]);
    }
    if (l.kind === "tool") {
      t = tool(l.id); if (!t) return null;
      return el("a", { "class": "mp-link", href: Hub.url(t.path) }, [ico("link"), el("span", { "class": "t", text: l.label }), el("small", { text: "Tool" })]);
    }
    if (l.kind === "web" && /^https?:\/\//i.test(l.url || "")) {
      var host = ""; try { host = new URL(l.url).hostname.replace(/^www\./, ""); } catch (e) { host = "Web"; }
      return el("a", { "class": "mp-link", href: l.url, target: "_blank", rel: "noopener noreferrer" }, [ico("link"), el("span", { "class": "t", text: l.label }), el("small", { text: host })]);
    }
    return null;
  }
  function followBranch(l) {
    if (N(l.node)) { flush(); reveal(l.node); return; }
    if (l.map && l.map !== M.map.id) { settled().then(function () { window.location.href = "?map=" + l.map + "#at-" + l.node; }); return; }
    Hub.toast("That branch no longer exists.", true);
  }
  function loadStandards() {
    return new Promise(function (resolve, reject) {
      if (window.STD && window.STD.ITEMS) return resolve(window.STD.ITEMS);
      var s = document.createElement("script"); s.src = Hub.url("tools/standards/standards-data.js");
      s.onload = function () { if (window.STD && window.STD.ITEMS) resolve(window.STD.ITEMS); else reject(new Error("The list of standards could not be read.")); };
      s.onerror = function () { reject(new Error("The list of standards could not be loaded.")); };
      document.head.appendChild(s);
    });
  }
  function branchOptions(nodes, rootId, skip) {          // every branch of a map, indented, for a select
    var out = [];
    (function walk(id, d) {
      var n = nodes[id]; if (!n) return;
      if (id !== skip) out.push(el("option", { value: id, text: new Array(d + 1).join("   ") + n.title }));
      n.kids.forEach(function (k) { walk(k, d + 1); });
    })(rootId, 0);
    return out;
  }
  // the kinds to choose from: a wiring map offers the wires first, a piping map the pipes, then the meanings
  function relOptions() {
    var opt = function (r) { return el("option", { value: r.id, text: r.label }); };
    var wires = RELS.filter(function (r) { return r.wire && !r.pipe; }), pipes = RELS.filter(function (r) { return r.pipe; }), means = RELS.filter(function (r) { return !r.wire; });
    if (isWater()) return [el("optgroup", { label: "Pipes" }, pipes.map(opt)), el("optgroup", { label: "Meaning" }, means.map(opt))];
    if (!isWiring()) return means.map(opt);
    return [el("optgroup", { label: "Wires" }, wires.map(opt)), el("optgroup", { label: "Meaning" }, means.map(opt))];
  }
  function linkSheet(n, editAt) {
    var was = editAt != null ? n.links[editAt] : null;
    if (!was && n.links.length >= 12) { Hub.toast("A branch holds up to 12 links. Remove one first.", true); return; }
    sheet((was ? "Change the link from " : "Add a link to ") + n.title, function (close) {
      var err = el("p", { "class": "mp-err", role: "alert" }), area = el("div", { "class": "stack" });
      var kinds = [["node", "Another branch"]];
      if (tool("standards")) kinds.push(["standard", "A standard (Standards tool)"]);
      if (tools().some(function (t) { return t.id !== TOOL; })) kinds.push(["tool", "A tool of this site"]);
      kinds.push(["web", "A web address"]);
      var kind = el("select", { "class": "input", id: "mpLinkKind" }, kinds.map(function (k) { return el("option", { value: k[0], text: k[1] }); }));
      if (was) { kind.value = "node"; kind.disabled = true; }
      var label = el("input", { "class": "input", type: "text", id: "mpLinkLabel", maxlength: "120", placeholder: "Leave empty to use the name of what it leads to", autocomplete: "off" });
      var get = function () { return null; };          // returns the link, or a message when something is missing
      function field(text, control, hint) { return el("label", { "class": "field" }, [el("span", { text: text }), control, hint ? el("p", { "class": "hint", text: hint }) : null]); }
      function draw() {
        area.textContent = ""; err.textContent = "";
        if (kind.value === "node") {
          var mapSel = el("select", { "class": "input", id: "mpLinkMap" }, [el("option", { value: M.map.id, text: M.map.name + " (this map)" })]);
          var brSel = el("select", { "class": "input", id: "mpLinkBranch" }, branchOptions(M.nodes, M.root, n.id));
          area.appendChild(field("Map", mapSel)); area.appendChild(field("Branch", brSel));
          Api.mpList(T).then(function (r) { r.maps.forEach(function (m) { if (m.id !== M.map.id) mapSel.appendChild(el("option", { value: m.id, text: m.name })); }); }, function () { /* this map is enough */ });
          mapSel.addEventListener("change", function () {
            brSel.textContent = ""; err.textContent = "";
            if (mapSel.value === M.map.id) { branchOptions(M.nodes, M.root, n.id).forEach(function (o) { brSel.appendChild(o); }); return; }
            brSel.appendChild(el("option", { value: "", text: "Loading…" }));
            Api.mpGet(T, mapSel.value).then(function (r) {
              var nodes = {}, root = null;
              r.nodes.forEach(function (x) { x.kids = []; nodes[x.id] = x; });
              r.nodes.forEach(function (x) { if (x.parent && nodes[x.parent]) nodes[x.parent].kids.push(x.id); else if (!x.parent) root = x.id; });
              brSel.textContent = ""; branchOptions(nodes, root, null).forEach(function (o) { brSel.appendChild(o); });
            }, function (e) { brSel.textContent = ""; err.textContent = e.message; });
          });
          var relSel = el("select", { "class": "input", id: "mpLinkRel" }, relOptions());
          relSel.value = was ? relOf(was).id : isWiring() ? "w-power" : isWater() ? "p-supply" : "see";
          // what a wire carries (shown for wires): terminals at each end, signal, cable, who wires it
          var wf = function (id, ph) { return el("input", { "class": "input", type: "text", id: id, maxlength: "80", placeholder: ph, autocomplete: "off" }); };
          var fromT = wf("mpWFrom", "e.g. X1:1, AO1"), toT = wf("mpWTo", "e.g. L1, L2, L3"), sig = wf("mpWSig", "e.g. 0–10 V DC speed, 24 V AC"), cab = wf("mpWCab", "e.g. 4C × 2.5 mm², screened twisted pair");
          var byS = el("select", { "class": "input", id: "mpWBy" }, [el("option", { value: "", text: "Not said" }), el("option", { value: "daikin", text: "Daikin (factory wiring)" }), el("option", { value: "others", text: "Others (site wiring)" })]);
          // a pipe has the same details in its own words: connections, label, size, who installs it
          var lenI = wf("mpWLen", "e.g. 40 m"), lbL = el("span", { text: "Length" }), lenF = el("label", { "class": "field" }, [lbL, lenI]);
          var lbF = el("span", { text: "Terminal at " + n.title }), lbT = el("span", { text: "Terminal at the other end" }), lbS = el("span", { text: "Signal" }), lbC = el("span", { text: "Cable" }), lbB = el("span", { text: "Wired by" });
          var wl = function (span, control) { return el("label", { "class": "field" }, [span, control]); };
          var words = function (pipe) {
            lbF.textContent = (pipe ? "Connection at " : "Terminal at ") + n.title; lbT.textContent = pipe ? "Connection at the other end" : "Terminal at the other end";
            lbS.textContent = pipe ? "Label" : "Signal"; lbC.textContent = pipe ? "Pipe size" : "Cable"; lbB.textContent = pipe ? "Installed by" : "Wired by";
            fromT.placeholder = pipe ? "e.g. Coil inlet, DN 65 flange" : "e.g. X1:1, AO1"; toT.placeholder = pipe ? "e.g. Header branch" : "e.g. L1, L2, L3";
            sig.placeholder = pipe ? "e.g. CHWS, CHWR" : "e.g. 0–10 V DC speed, 24 V AC"; cab.placeholder = pipe ? "e.g. DN 150, 6 in" : "e.g. 4C × 2.5 mm², screened twisted pair";
            byS.options[1].text = pipe ? "Daikin (factory piping)" : "Daikin (factory wiring)"; byS.options[2].text = pipe ? "Others (site piping)" : "Others (site wiring)";
            lenF.hidden = !pipe;
          };
          if (was) { fromT.value = was.from_t || ""; toT.value = was.to_t || ""; sig.value = was.signal || ""; cab.value = was.cable || ""; byS.value = was.by || ""; lenI.value = was.len || ""; label.value = was.label && N(was.node) && was.label === N(was.node).title ? "" : (was.label || ""); }
          var wireBox = el("div", { "class": "mp-wirebox" }, [
            el("div", { "class": "mp-wire2" }, [wl(lbF, fromT), wl(lbT, toT)]),
            el("div", { "class": "mp-wire2" }, [wl(lbS, sig), wl(lbC, cab)]),
            el("div", { "class": "mp-wire2" }, [lenF, wl(lbB, byS)])]);
          var relHint = el("p", { "class": "hint" });
          var showHint = function () {                // the link read as a sentence: "Drive provided requires Insulation class."
            var r = relOf({ rel: relSel.value }), o = brSel.options[brSel.selectedIndex], to = o && o.value ? o.text.trim() : "the branch";
            relHint.textContent = r.pipe ? r.label + " between " + n.title + " and " + to + ". " + r.hint
              : r.wire ? r.label + " wire from " + n.title + " to " + to + ". " + r.hint : n.title + " " + r.label.toLowerCase() + " " + to + ". " + r.hint;
            wireBox.hidden = !r.wire; words(!!r.pipe);
          };
          relSel.addEventListener("change", showHint); brSel.addEventListener("change", showHint); showHint();
          area.appendChild(el("label", { "class": "field" }, [el("span", { text: isWiring() ? "Wire or meaning" : isWater() ? "Pipe or meaning" : "What the link means" }), relSel, relHint]));
          area.appendChild(wireBox); showHint();
          // changing a link: its branch chosen again (another map's branches load first)
          if (was) {
            if (was.map && was.map !== M.map.id) {
              var pickIt = function () { if ([].some.call(mapSel.options, function (o) { return o.value === was.map; })) { mapSel.value = was.map; mapSel.dispatchEvent(new Event("change")); var t0 = setInterval(function () { if ([].some.call(brSel.options, function (o) { return o.value === was.node; })) { brSel.value = was.node; showHint(); clearInterval(t0); } }, 100); setTimeout(function () { clearInterval(t0); }, 5000); } else setTimeout(pickIt, 150); };
              pickIt();
            } else { brSel.value = was.node; showHint(); }
          }
          get = function () {
            if (!brSel.value) return "Choose the branch to link to.";
            var l = { kind: "node", node: brSel.value, rel: relSel.value };
            if (relOf({ rel: relSel.value }).wire) {
              var put = function (k, inp) { var v = inp.value.replace(/\s+/g, " ").trim(); if (v) l[k] = v; };
              put("from_t", fromT); put("to_t", toT); put("signal", sig); put("cable", cab); if (byS.value) l.by = byS.value;
              if (relOf({ rel: relSel.value }).pipe) put("len", lenI);
            }
            return l;
          };
        } else if (kind.value === "standard") {
          var stSel = el("select", { "class": "input", id: "mpLinkStd" }, [el("option", { value: "", text: "Loading…" })]);
          area.appendChild(field("Standard", stSel));
          loadStandards().then(function (items) {
            stSel.textContent = "";
            items.forEach(function (s) { stSel.appendChild(el("option", { value: s.id, text: s.code + " – " + s.title })); });
          }, function (e) { stSel.textContent = ""; err.textContent = e.message; });
          get = function () {
            var o = stSel.options[stSel.selectedIndex];
            return stSel.value ? { kind: "standard", id: stSel.value, label: (window.STD.ITEMS.filter(function (s) { return s.id === stSel.value; })[0] || {}).code || o.text } : "Choose the standard to link to.";
          };
        } else if (kind.value === "tool") {
          var tSel = el("select", { "class": "input", id: "mpLinkTool" }, tools().filter(function (t) { return t.id !== TOOL; }).map(function (t) { return el("option", { value: t.id, text: t.name }); }));
          area.appendChild(field("Tool", tSel));
          get = function () { return tSel.value ? { kind: "tool", id: tSel.value } : "Choose the tool to link to."; };
        } else {
          var url = el("input", { "class": "input", type: "url", id: "mpLinkUrl", maxlength: "500", placeholder: "https://", autocomplete: "off" });
          area.appendChild(field("Web address", url, "It opens in a new tab."));
          get = function () {
            var v = url.value.trim();
            return /^https?:\/\/[^\s<>"]+$/i.test(v) && v.length >= 11 ? { kind: "web", url: v } : "A web link starts with https:// and has no spaces.";
          };
        }
      }
      kind.addEventListener("change", draw); draw();
      function go() {
        var l = get();
        if (typeof l === "string" || !l) { err.textContent = l || "Choose what the link leads to."; return; }
        var text = label.value.replace(/\s+/g, " ").trim();
        if (text) l.label = text; else if (!l.label) l.label = "";
        close();
        var before = n.links, shown1 = {}, k;
        for (k in l) shown1[k] = l[k];
        shown1.label = l.label || (N(l.node) ? N(l.node).title : "…");
        var next = was ? before.map(function (x, j) { return j === editAt ? l : x; }) : before.concat([l]);
        n.links = was ? before.map(function (x, j) { return j === editAt ? shown1 : x; }) : before.concat([shown1]);
        render(); flush();
        send(n.id, { links: next }, function () { n.links = before; }).then(function () { if (st.sel === n.id) render(); });
      }
      return [field("Leads to", kind), area, field("Text shown", label), err,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: close }), el("button", { type: "button", "class": "btn", text: was ? "Save link" : "Add link", onclick: go })])];
    });
  }

  // ---------- cable schedule (wiring maps) and pipe schedule (piping maps): every wire or pipe as a row, for submittals ----------
  // the load a pipe carries: the smaller of its ends' (a unit's own, a run's carried, a source's)
  function pipeKw(a, b, rel) {
    var r = lastWater && lastWater.circuits[/^p-cw-/.test(rel) ? "cw" : "chw"]; if (!r) return "";
    var v = [a, b].map(function (id) { return r.source[id] ? r.source[id].kw : r.isUnit[id] ? r.kw[id] : r.carried[id]; }).filter(function (x) { return x != null; });
    return v.length ? Math.round(Math.min.apply(null, v)) : "";
  }
  function cableSchedule() {
    flush();
    var pipes = isWater(), w = lastWater, fu = w ? W().FLOW_WORD[w.unit.flow] : "l/s", tu = w && w.unit.temp === "F" ? "°F" : "°C";
    var head = pipes ? ["System", "From", "Connection (from)", "To", "Connection (to)", "Pipe", "Label", "Pipe size", "Length (m)", "Installed by", "Water flows", "Flow (" + fu + ")", "Temperature (" + tu + ")",
        "Velocity (m/s)", "Friction (Pa/m)", "Pressure drop incl. 30 % fittings (kPa)", "Load carried (kW)", "Check", "Checked"]
      : ["Variant", "From", "Terminal (from)", "To", "Terminal (to)", "Wire", "Signal", "Cable", "Wired by", "Load now (kW)", "Connected load (kW)", "Checked"];
    var pw = isWiring() ? lastPower || power() : null;
    var rows = [head], round = function (x, d) { return Math.round(x * Math.pow(10, d)) / Math.pow(10, d); };
    each(M.root, function (n) {
      (n.links || []).forEach(function (l) {
        var r = relOf(l); if (l.kind !== "node" || !r.wire || !!r.pipe !== pipes) return;
        var p = pathOf(n.id), to = N(l.node), by = l.by === "daikin" ? "Daikin (factory)" : l.by === "others" ? "Others (site)" : "";
        var row = [p.length > 1 ? N(p[1]).title : "", n.title, l.from_t || "", to ? to.title : l.label, l.to_t || "", r.label, l.signal || "", l.cable || "", by];
        if (pipes) {
          var fw = w && w.dir[n.id + ">" + l.node], bw = w && w.dir[l.node + ">" + n.id], k = fw ? n.id + ">" + l.node : l.node + ">" + n.id, q = fw || bw, t = w && q ? w.tEdge[k] : null;
          var pf = q ? pipeFig(k) : null, len = W().lengthOf(l.len);
          row.splice(8, 0, len != null ? round(len, 1) : "");
          row.push(q ? (fw ? n.title + " → " + (to ? to.title : l.label) : (to ? to.title : l.label) + " → " + n.title) : "No flow",
            q ? round(W().toUnit(q, w.unit.flow), 2) : 0, t != null ? round(w.unit.temp === "F" ? t * 1.8 + 32 : t, 1) : "",
            pf && !pf.missing ? round(pf.v, 2) : "", pf && !pf.missing ? round(pf.pam, 0) : "", pf && !pf.missing ? round(pf.dp, 2) : "", q ? pipeKw(n.id, l.node, l.rel) : "",
            !W().dnOf(l.cable) || len == null ? "Size or length missing" : pf && pf.fast ? "Over 400 Pa/m or 3 m/s" : "");
        } else {
          // a feeder carries what the end it feeds draws (for the cable's size); a signal wire carries no load
          var child = pw && l.rel === "w-power" ? (pw.from[l.node] === n.id ? l.node : pw.from[n.id] === l.node ? n.id : null) : null;
          var conn = pw && l.rel === "w-power" && pw.cdem[n.id] != null && pw.cdem[l.node] != null ? Math.min(pw.cdem[n.id], pw.cdem[l.node]) : null;
          row.push(l.rel === "w-power" && pw ? round(child ? pw.dem[child] || 0 : 0, 1) : "", conn != null ? round(conn, 1) : "");
        }
        row.push(n.verified && to && to.verified ? "Verified" : "To verify");
        rows.push(row);
      });
    });
    if (rows.length === 1) { Hub.toast(pipes ? "This map has no pipes yet. Add one with Add link in a branch's note." : "This map has no wires yet. Add one with Add link in a branch's note.", true); return; }
    if (!window.HubXlsx) { Hub.toast("The Excel writer did not load. Reload the page.", true); return; }
    var what = pipes ? "pipe schedule" : "cable schedule";
    var blob = window.HubXlsx.build(rows, pipes ? "Pipe schedule" : "Cable schedule", pipes ? [24, 30, 14, 30, 14, 12, 10, 10, 10, 14, 44, 10, 12, 12, 12, 16, 14, 22, 12] : [26, 30, 16, 30, 16, 18, 34, 26, 18, 14, 16, 12]);
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: (M.map.name.replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim() || "map") + " - " + what + ".xlsx" });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    Hub.toast((pipes ? "Pipe schedule downloaded: " : "Cable schedule downloaded: ") + (rows.length - 1) + (pipes ? " pipes" : " wires") + (pipes && Object.keys(st.iso).length ? ", as simulated now." : "."));
  }

  // ---------- import and export: a plain outline ----------
  // One branch per line, deeper = further in. "> text" is a note of the branch above, "! text" a special note.
  function outlineOf(id, d) {
    var n = N(id), pad = new Array(d + 1).join("  "), out = pad + n.title + "\n";
    if (n.notes) n.notes.split("\n").forEach(function (l) { if (l.trim()) out += pad + "  > " + l.trim() + "\n"; });
    n.special.forEach(function (s) { out += pad + "  ! " + s + "\n"; });
    n.kids.forEach(function (k) { out += outlineOf(k, d + 1); });
    return out;
  }
  function parseOutline(text) {
    var items = [], last = null, stack = [], cut = 0;
    String(text || "").replace(/\r/g, "").split("\n").forEach(function (line) {
      var raw = line.replace(/\t/g, "    "), t = raw.trim(); if (!t) return;
      if (/^>/.test(t)) { if (last) last.notes.push(t.replace(/^>\s?/, "")); return; }
      if (/^!/.test(t)) { t = t.replace(/^!\s?/, "").replace(/\s+/g, " ").trim(); if (last && t) { if (t.length > 200) { t = t.slice(0, 200); cut++; } last.special.push(t); } return; }
      var w = raw.match(/^ */)[0].length;
      t = t.replace(/^([-*•]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim(); if (!t) return;
      while (stack.length > 1 && w < stack[stack.length - 1]) stack.pop();
      if (!stack.length || (stack.length === 1 && w < stack[0])) stack = [w];
      else if (w > stack[stack.length - 1]) stack.push(w);
      if (t.length > 120) { t = t.slice(0, 120); cut++; }
      last = { depth: stack.length - 1, title: t, notes: [], special: [] }; items.push(last);
    });
    items.forEach(function (it) { it.notes = it.notes.join("\n"); if (it.notes.length > 8000) { it.notes = it.notes.slice(0, 8000); cut++; } if (it.special.length > 20) { it.special = it.special.slice(0, 20); cut++; } });
    return { items: items, cut: cut };
  }
  function importSheet() {
    var target = N(st.sel || st.focus);
    sheet("Import under " + target.title, function (close) {
      var info = el("p", { "class": "small muted" }), err = el("p", { "class": "mp-err", role: "alert" }), busy = false;
      var ta = el("textarea", { "class": "input", id: "mpImportText", spellcheck: "false",
        placeholder: "Components\n  Compressor\n    > Raises the refrigerant pressure.\n    ! Check the starting current\n  Evaporator\nStandards\n  AHRI 550/590" });
      var ok = el("button", { type: "button", "class": "btn", text: "Add to map", onclick: go });
      function count() {
        var p = parseOutline(ta.value), s = 0; p.items.forEach(function (i) { s += i.special.length; });
        err.textContent = "";
        info.textContent = !p.items.length ? "Paste an outline to see what it adds."
          : "Adds " + plural(p.items.length, "branch", "branches") + " and " + plural(s, "special note") + " under " + target.title + ", all marked to verify."
            + (p.cut ? " " + plural(p.cut, "text") + " longer than the limit will be cut." : "");
        return p;
      }
      function go() {
        var p = count();
        if (!p.items.length) { err.textContent = "Nothing to add. Paste an outline with one branch name per line."; ta.focus(); return; }
        if (p.items.length > 500) { err.textContent = "One import holds up to 500 branches. This outline has " + p.items.length + ". Import it in parts."; return; }
        if (busy) return; busy = true; ok.disabled = true;
        settled().then(function () { return Api.mpImport(T, target.id, p.items); }).then(function (r) {
          close();
          reload(function () { if (N(target.id)) N(target.id).open = true; if (r.first && N(r.first)) reveal(r.first, true); });
          Hub.toast("Added " + plural(r.added, "branch", "branches") + " under " + target.title + ".");
        }, function (e) { busy = false; ok.disabled = false; err.textContent = e.message; });
      }
      ta.addEventListener("input", count); count();
      return [
        el("p", { "class": "small muted", text: "Paste an outline: one branch per line, two spaces deeper for a branch under it. A line starting with > is a note, with ! a special note. To import somewhere else, close this and select that branch first." }),
        ta, info, err,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: close }), ok])
      ];
    });
  }
  function exportSheet() {
    var n = N(st.focus);
    flush();
    sheet("Export " + n.title, function (close) {
      var text = outlineOf(n.id, 0);
      var ta = el("textarea", { "class": "input", id: "mpExportText", readonly: true, spellcheck: "false", text: text });
      function copy() {
        var done = function () { Hub.toast("Copied."); }, select = function () { ta.focus(); ta.select(); Hub.toast("Press Ctrl+C to copy the selected text."); };
        try { navigator.clipboard.writeText(text).then(done, select); } catch (e) { select(); }
      }
      function download() {
        var url = URL.createObjectURL(new Blob(["﻿" + text.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }));
        var a = el("a", { href: url, download: (n.title.replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim() || "map") + " - outline.txt" });
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }
      return [
        el("p", { "class": "small muted", text: (n.id === M.root ? "The whole map" : "This branch and everything under it") + " as a plain outline: names, notes (>) and special notes (!). Links stay on the map. To export one branch only, show it alone first." }),
        ta,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Close", onclick: close }),
          el("button", { type: "button", "class": "btn ghost", text: "Download .txt", onclick: download }), el("button", { type: "button", "class": "btn", text: "Copy", onclick: copy })])
      ];
    });
  }

  // ---------- arrange a wiring or piping map by what feeds what (mp_rearrange) ----------
  function arrange() {
    Hub.confirm("Each piece of equipment moves under the board, riser or branch pipe that feeds it; groups left empty (such as HVAC equipment, Chillers, Units) " +
      "are removed and their notes go to the branch above. Wires, pipes, the cable schedule and the 2D view stay as they are.",
      { title: "Arrange " + M.map.name + " by feed?", ok: "Arrange" }).then(function (yes) {
      if (!yes) return;
      settled().then(function () { return Api.mpRearrange(T, M.map.id); }).then(function (r) {
        return reload().then(function () {
          Hub.toast(r.moved || r.removed ? plural(r.moved, "branch", "branches") + " moved under what feeds them" + (r.removed ? ", " + plural(r.removed, "empty group") + " removed." : ".") : "Already arranged by feed: nothing to move.");
        });
      }, function (e) { Hub.toast(e.message, true); });
    });
  }

  // ---------- map settings (owner) ----------
  function settingsSheet() {
    sheet("Map settings", function (close) {
      var err = el("p", { "class": "mp-err", role: "alert" }), busy = false;
      var name = el("input", { "class": "input", type: "text", id: "mpSetName", value: M.map.name, maxlength: "80", autocomplete: "off" });
      var share = shareSelect("mpSetShare", M.map.share), kind = kindSelect("mpSetKind", M.map.kind);
      var ok = el("button", { type: "button", "class": "btn", text: "Save", disabled: true, onclick: go });
      function changed() { ok.disabled = busy || (name.value.replace(/\s+/g, " ").trim() === M.map.name && share.value === M.map.share && kind.value === (M.map.kind || "knowledge")); }
      name.addEventListener("input", changed); share.addEventListener("change", changed); kind.addEventListener("change", changed);
      function go() {
        var v = name.value.replace(/\s+/g, " ").trim();
        if (!v) { err.textContent = "Give the map a name, usually the product."; name.focus(); return; }
        busy = true; changed(); err.textContent = "";
        settled().then(function () { return Api.mpMapSave(T, { id: M.map.id, name: v === M.map.name ? null : v, share: share.value === M.map.share ? null : share.value, kind: kind.value === (M.map.kind || "knowledge") ? null : kind.value }); }).then(function () {
          close(); Hub.toast("Map settings saved.");
          reload();
        }, function (e) { busy = false; changed(); err.textContent = e.message; });
      }
      function del() {
        var b = under(M.root);
        close();
        Hub.confirm("The map and its " + plural(b, "branch", "branches") + " are deleted for everyone. This cannot be undone.",
          { title: "Delete the map " + M.map.name + "?", ok: "Delete map", danger: true }).then(function (yes) {
          if (!yes) return;
          act(Api.mpDelete(T, M.map.id), function () { window.location.href = Hub.url("tools/maps/"); });
        });
      }
      return [
        el("label", { "class": "field" }, [el("span", { text: "Map name" }), name]),
        el("label", { "class": "field" }, [el("span", { text: "What it is for" }), kind, el("p", { "class": "hint", text: "Changing it takes the map off the AI links of its old type in Compliance review." })]),
        el("label", { "class": "field" }, [el("span", { text: "Shared with" }), share, el("p", { "class": "hint", text: SHARE_HINT })]),
        err,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn danger", text: "Delete map", onclick: del }),
          el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: close }), ok])
      ];
    });
  }

  // ======================================================================
  Hub.requireLogin({ tool: TOOL }).then(function (p) {
    profile = p; T = Hub.token();
    var id = Hub.param("map");
    if (id) openMap(id); else showList();
  });
})();
