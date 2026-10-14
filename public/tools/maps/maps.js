/* ============================================================
   DAME Tools Hub - Maps.
   Product knowledge as a tree: a map (Chiller) grows into branches (Components > Compressor ...).
   Every branch has notes, special notes, links and images.
     index.html            every map the user can open, search across them, Add map
     index.html?map=<id>   one map. #<branch id> shows that branch alone, #at-<branch id> selects it.
   Data only through Api.mp* (db/schema.sql, part "MAPS"). No AI in the tool: knowledge is typed,
   or pasted as an outline with Import (those branches start as "to verify").
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
    img: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11v9h-11zM2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5"/></svg>',
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
        if (m.images) parts.push(plural(m.images, "image"));
        grid.appendChild(el("a", { "class": "tile mp-tile", href: "?map=" + m.id }, [
          el("span", { "class": "tile-icon", "aria-hidden": "true", html: Hub.ICON.tree }),
          el("span", { "class": "badge", text: SHARE[m.share] || m.share }),
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
      var share = shareSelect("mpNewShare", "private"), busy = false;
      var ok = el("button", { type: "button", "class": "btn", text: "Add map", onclick: go });
      function go() {
        var v = name.value.replace(/\s+/g, " ").trim();
        if (!v) { err.textContent = "Give the map a name, usually the product."; name.focus(); return; }
        if (busy) return;
        busy = true; ok.disabled = true; err.textContent = "";
        Api.mpCreate(T, { name: v, share: share.value }).then(function (r) {
          store("sessionStorage", userKey("edit"), r.id);            // a new map opens in Edit
          window.location.href = "?map=" + r.id;
        }, function (e) { busy = false; ok.disabled = false; err.textContent = e.message; });
      }
      name.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      return [
        el("label", { "class": "field" }, [el("span", { text: "Map name" }), name]),
        el("label", { "class": "field" }, [el("span", { text: "Shared with" }), share, el("p", { "class": "hint", text: SHARE_HINT + " You can change this later." })]),
        err,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: close }), ok])
      ];
    });
  }

  // ======================================================================
  // One map
  // ======================================================================
  var M = null;                                    // { map, nodes: {id: node}, root }
  var st = { focus: null, sel: null, view: "map", edit: false, q: "" };
  var seen = {}, wantScroll = false, W = 232, GX = 56, GY = 10, COL = W + GX;
  var imgCache = {}, fullCache = {};
  function N(id) { return M.nodes[id]; }
  function canEdit() { return M && (M.map.rights === "edit" || M.map.rights === "own"); }
  function isOwn() { return M && M.map.rights === "own"; }
  function pathOf(id) { var p = []; while (id && N(id)) { p.unshift(id); id = N(id).parent; } return p; }
  function each(id, fn) { var n = N(id); fn(n); n.kids.forEach(function (k) { each(k, fn); }); }
  function under(id) { var c = 0; each(id, function () { c++; }); return c - 1; }

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
    if (!st.focus || !N(st.focus)) st.focus = M.root;
    if (st.sel && !N(st.sel)) st.sel = null;
    head();
  }
  function head() {
    var m = M.map;
    $("mpTitle").textContent = m.name; document.title = m.name + " - Maps - DAME Tools Hub";
    var sub = $("mpSub"); sub.hidden = false;
    sub.textContent = (m.mine ? "Your map" : "By " + m.owner) + " · " + (SHARE[m.share] || m.share) + (m.rights === "read" ? " · you can read it" : "") + " · changed " + Hub.date(m.updated_at);
    $("mpMode").hidden = !canEdit(); $("mpImport").hidden = !(canEdit() && st.edit); $("mpSettings").hidden = !isOwn();
  }
  function reload(after) {
    return Api.mpGet(T, M.map.id).then(function (r) { build(r); if (after) after(); render(); }, function (err) { notAvailable(err.message); });
  }

  var wired = false;
  function wire() {
    if (wired) return; wired = true;
    var v = store("localStorage", userKey("view"));
    st.view = v === "map" || v === "outline" ? v : (window.matchMedia && matchMedia("(max-width: 640px)").matches ? "outline" : "map");
    if (canEdit() && store("sessionStorage", userKey("edit")) === M.map.id) { st.edit = true; st.sel = M.root; }
    store("sessionStorage", userKey("edit"), null);
    $("mpViewMap").addEventListener("click", function () { setView("map"); });
    $("mpViewOut").addEventListener("click", function () { setView("outline"); });
    $("mpRead").addEventListener("click", function () { setEdit(false); });
    $("mpEdit").addEventListener("click", function () { setEdit(true); });
    $("mpImport").addEventListener("click", importSheet);
    $("mpExport").addEventListener("click", exportSheet);
    $("mpSettings").addEventListener("click", settingsSheet);
    var timer, q = $("mpQ");
    q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { search(q.value); }, 150); });
    window.addEventListener("hashchange", function () { applyHash(false); render(); });
    var onNarrow = function () { if (M) { flush(); render(); } };
    if (NARROW.addEventListener) NARROW.addEventListener("change", onNarrow); else if (NARROW.addListener) NARROW.addListener(onNarrow);
    document.addEventListener("paste", function (e) {
      if (!st.edit || !st.sel || !canEdit() || !e.clipboardData || document.querySelector(".hub-sheet-back")) return;
      var files = [].filter.call(e.clipboardData.files || [], function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault(); addImages(st.sel, files);
    });
    head();
  }
  function setView(v) { st.view = v; seen = {}; store("localStorage", userKey("view"), v); wantScroll = true; renderView(); }
  function setEdit(on) {
    if (!canEdit()) return;
    flush();
    st.edit = on; head(); renderView(); renderPanel();
    if (on && !st.sel) Hub.toast("Edit is on. Click a branch to change it.");
  }
  function hashOf() { var h = ""; try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) { h = ""; } return h; }
  function applyHash(first) {
    var h = hashOf(), at = /^at-/.test(h) ? h.slice(3) : "";
    if (at) {
      if (N(at)) reveal(at, true); else if (first) Hub.toast("The branch you followed no longer exists.", true);
      return;
    }
    var id = h && N(h) ? h : M.root;
    if (id !== st.focus) { st.focus = id; N(id).open = true; seen = {}; if (st.sel && pathOf(st.sel).indexOf(id) < 0) st.sel = null; wantScroll = true; }
  }
  function setHash(h) {
    try { if (hashOf() !== h) { if (h) location.hash = h; else history.pushState(null, "", location.pathname + location.search); } } catch (e) { /* ignore */ }
  }
  function focusOn(id) {
    flush();
    st.focus = id; N(id).open = true; seen = {};
    if (st.sel && pathOf(st.sel).indexOf(id) < 0) st.sel = null;
    $("mpCanvas").scrollLeft = 0; $("mpCanvas").scrollTop = 0;
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
  function pick(n) {
    if (st.sel !== n.id) flush();
    st.sel = n.id; if (n.kids.length && !n.open) n.open = true;
    wantScroll = true; render();
  }
  function matches(n) { return !!st.q && (n.title + "\n" + n.notes + "\n" + n.special.join("\n")).toLowerCase().indexOf(st.q) >= 0; }
  function search(text) {
    st.q = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (st.q) each(st.focus, function (n) { if (matches(n)) pathOf(n.id).forEach(function (a) { if (a !== n.id) N(a).open = true; }); });
    renderView();
  }

  // ---------- drawing ----------
  function inner(n) {
    var isRoot = n.id === st.focus;
    var marks = el("span", { "class": "mp-marks" }, [
      n.notes ? el("span", { title: "Has notes" }, [ico("note")]) : null,
      n.images ? el("span", { title: plural(n.images, "image") }, [ico("img"), String(n.images)]) : null,
      n.links.length ? el("span", { title: plural(n.links.length, "link") }, [ico("link"), String(n.links.length)]) : null
    ]);
    var head = el("div", { "class": "mp-head" }, [
      el("span", { "class": "mp-ttl", text: n.title }), marks,
      isRoot ? null : el("button", { type: "button", "class": "mp-ibtn", title: "Show this branch alone", "aria-label": "Show " + n.title + " alone",
        onclick: function (e) { e.stopPropagation(); focusOn(n.id); } }, [ico("focus")]),
      n.kids.length ? el("button", { type: "button", "class": "mp-tog", "aria-expanded": n.open ? "true" : "false",
        "aria-label": (n.open ? "Close " : "Open ") + n.title + ", " + plural(n.kids.length, "branch", "branches"),
        onclick: function (e) { e.stopPropagation(); n.open = !n.open; renderView(); }, text: n.open ? "−" : "+" + n.kids.length }) : null
    ]);
    var out = [head];
    if (n.special.length) out.push(el("div", { "class": "mp-chips" }, n.special.map(function (s) { return el("span", { "class": "mp-chip" }, [el("b", { text: "SPECIAL" }), s]); })));
    return out;
  }
  function cls(base, n) {
    var c = base;
    if (n.id === st.focus) c += " mp-root"; else if (!n.verified) c += " mp-unv";
    if (n.id === st.sel) c += " mp-sel";
    if (st.q) c += matches(n) ? " mp-hitn" : " mp-dim";
    return c;
  }
  function keys(n) {
    return function (e) {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(n); }
      else if (e.key === "ArrowRight" && n.kids.length && !n.open) { e.preventDefault(); n.open = true; renderView(); refocus(n.id); }
      else if (e.key === "ArrowLeft" && n.open && n.kids.length) { e.preventDefault(); n.open = false; renderView(); refocus(n.id); }
    };
  }
  function refocus(id) { var x = document.querySelector('[data-node="' + id + '"]'); if (x) x.focus(); }
  function box(base, n, grow) {
    return el("div", { "class": cls(base, n) + (grow ? " mp-grow" : ""), tabindex: "0", role: "button", "data-node": n.id,
      "aria-label": n.title + (n.verified ? "" : ", to verify"), onclick: function () { pick(n); }, onkeydown: keys(n) }, inner(n));
  }
  function renderMap() {
    var stage = $("mpStage"), canvas = $("mpCanvas"), els = {}, maxD = 0, now = {}, first = !Object.keys(seen).length;
    stage.textContent = "";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); stage.appendChild(svg);
    (function walk(id, d) {
      var n = N(id); maxD = Math.max(maxD, d); now[id] = 1;
      var e = box("mp-node", n, !first && !seen[id]);
      e.style.left = d * COL + "px"; stage.appendChild(e); els[id] = e; n._x = d * COL;
      if (n.open) n.kids.forEach(function (k) { walk(k, d + 1); });
    })(st.focus, 0);
    Object.keys(els).forEach(function (id) { N(id)._h = els[id].offsetHeight; });
    function shift(id, dy) { var n = N(id); n._y += dy; if (n.open) n.kids.forEach(function (k) { shift(k, dy); }); }
    var total = (function lay(id, top) {
      var n = N(id), kh = 0;
      if (!n.open || !n.kids.length) { n._y = top; return n._h; }
      n.kids.forEach(function (k, i) { N(k)._sub = lay(k, 0); kh += N(k)._sub + (i ? GY : 0); });
      var sub = Math.max(kh, n._h), y = top + (sub - kh) / 2;
      n.kids.forEach(function (k) { shift(k, y); y += N(k)._sub + GY; });
      n._y = top + (sub - n._h) / 2;
      return sub;
    })(st.focus, 0);
    var d = "";
    Object.keys(els).forEach(function (id) {
      var n = N(id); els[id].style.top = n._y + "px";
      if (n.open) n.kids.forEach(function (k) {
        var c = N(k), x1 = n._x + W, y1 = n._y + n._h / 2, x2 = c._x, y2 = c._y + c._h / 2, mx = (x1 + x2) / 2;
        d += "M" + x1 + " " + y1 + "C" + mx + " " + y1 + "," + mx + " " + y2 + "," + x2 + " " + y2;
      });
    });
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); svg.appendChild(p);
    stage.style.width = (maxD * COL + W) + "px"; stage.style.height = total + "px";
    seen = now;
    var s = st.sel && els[st.sel] ? N(st.sel) : null;
    if (s && wantScroll) {                       // keep the chosen branch, and the branches it just grew, in view
      var right = s._x + W + (s.open && s.kids.length ? COL : 0) + 40;
      if (right > canvas.scrollLeft + canvas.clientWidth) canvas.scrollLeft = right - canvas.clientWidth;
      if (s._x < canvas.scrollLeft) canvas.scrollLeft = s._x;
      if (s._y < canvas.scrollTop) canvas.scrollTop = Math.max(s._y - 10, 0);
      else if (s._y + s._h + 40 > canvas.scrollTop + canvas.clientHeight) canvas.scrollTop = s._y + s._h + 40 - canvas.clientHeight;
    }
    wantScroll = false;
  }
  // On a narrow screen the outline shows the notes of the chosen branch right under it, not in a
  // sheet that would cover the branches. Anywhere else the panel sits beside the tree (or is a
  // bottom sheet over the map view on a narrow screen).
  var NARROW = window.matchMedia ? window.matchMedia("(max-width: 980px)") : { matches: false };
  function inlinePanel() { return st.view === "outline" && NARROW.matches; }
  function placePanel() {
    var panel = $("mpPanel"), row = inlinePanel() && st.sel ? $("mpOutline").querySelector('[data-node="' + st.sel + '"]') : null;
    if (row) { if (row.nextSibling !== panel) row.parentNode.insertBefore(panel, row.nextSibling); }
    else if (panel.parentNode !== $("mpWork")) $("mpWork").appendChild(panel);
    panel.classList.toggle("mp-inline", !!row);
    $("mpPage").classList.toggle("mp-padsheet", !panel.hidden && !row);
  }
  function renderOutline() {
    var host = $("mpOutline");
    $("mpWork").appendChild($("mpPanel"));           // keep the panel out of what is redrawn
    host.textContent = "";
    host.appendChild(el("ul", {}, [(function li(id) {
      var n = N(id);
      return el("li", {}, [box("mp-orow", n, false), n.open && n.kids.length ? el("ul", {}, n.kids.map(li)) : null]);
    })(st.focus)]));
    placePanel();
    if (wantScroll && st.sel) { var x = host.querySelector('[data-node="' + st.sel + '"]'); if (x && x.scrollIntoView) x.scrollIntoView({ block: "nearest" }); }
    wantScroll = false;
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
    var b = 0, s = 0, v = 0, im = 0, hits = 0;
    each(M.root, function (n) { b++; s += n.special.length; im += n.images; if (!n.verified) v++; });
    if (st.q) each(st.focus, function (n) { if (matches(n)) hits++; });
    var p = $("mpPills"); p.textContent = "";
    if (st.q) p.appendChild(el("span", { "class": "badge brand", text: hits + " found" }));
    p.appendChild(el("span", { "class": "badge", text: plural(b - 1, "branch", "branches") }));
    p.appendChild(el("span", { "class": "badge", text: plural(s, "special note") }));
    if (im) p.appendChild(el("span", { "class": "badge", text: plural(im, "image") }));
    p.appendChild(el("span", { "class": "badge " + (v ? "warn" : "ok"), text: v ? v + " to verify" : "All verified" }));
  }
  var viewQueued = false;
  function renderView() {
    renderCrumbs(); renderPills();
    var map = st.view === "map";
    $("mpCanvas").hidden = !map; $("mpOutline").hidden = map;
    $("mpViewMap").setAttribute("aria-selected", map ? "true" : "false"); $("mpViewOut").setAttribute("aria-selected", map ? "false" : "true");
    $("mpRead").setAttribute("aria-selected", st.edit ? "false" : "true"); $("mpEdit").setAttribute("aria-selected", st.edit ? "true" : "false");
    if (map) { placePanel(); renderMap(); } else renderOutline();
    var open = []; Object.keys(M.nodes).forEach(function (id) { if (N(id).open) open.push(id); });
    store("sessionStorage", userKey("open") + ":" + M.map.id, JSON.stringify(open.slice(0, 600)));
  }
  function viewSoon() {                       // while typing a name: one redraw per frame
    if (viewQueued) return; viewQueued = true;
    window.requestAnimationFrame(function () {
      viewQueued = false;
      if (!inlinePanel()) return renderView();
      // the panel sits inside the outline: redrawing it would take the cursor out of the box being typed in
      renderCrumbs(); renderPills();
      [].forEach.call($("mpOutline").querySelectorAll("[data-node]"), function (row) {
        var n = N(row.getAttribute("data-node")), t = row.querySelector(".mp-ttl");
        if (n && t && t.textContent !== n.title) t.textContent = n.title;
      });
    });
  }
  function render() { renderView(); renderPanel(); }

  // ---------- saving ----------
  // Text typed in the panel is saved by itself, shortly after the typing stops and when the branch
  // is left. One request at a time; a failed save is shown and can be sent again.
  var draft = null, retry = null, chain = Promise.resolve(), waiting = 0;
  var lastMsg = { id: null, text: "", bad: false };       // the last save message of the open branch, kept when the panel is redrawn
  function status(text, bad, again) {
    lastMsg = { id: st.sel, text: again ? "" : text, bad: !!bad && !again };
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

  // ---------- the notes panel ----------
  function foot() {
    var f = $("mpFoot"), n = st.sel && N(st.sel); if (!f || !n) return;
    f.textContent = n.updated_at ? "Last changed" + (n.updated_by ? " by " + n.updated_by : "") + ", " + Hub.date(n.updated_at, true) : "";
  }
  function adder(id, placeholder, label, max, fn) {
    var inp = el("input", { "class": "input", type: "text", id: id, placeholder: placeholder, maxlength: String(max), autocomplete: "off" });
    function go() { var v = inp.value.replace(/\s+/g, " ").trim(); if (!v) { inp.focus(); return; } fn(v); }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
    return el("div", { "class": "mp-add" }, [inp, el("button", { type: "button", "class": "btn ghost", text: label, onclick: go })]);
  }
  var panelFor = null;
  function renderPanel() {
    var panel = $("mpPanel"), n = st.sel && N(st.sel);
    panel.hidden = !n; $("mpWork").className = "mp-work" + (n ? " haspanel" : "");
    panel.textContent = ""; placePanel(); if (!n) { panelFor = null; return; }
    if (panelFor !== n.id) { panelFor = n.id; panel.scrollTop = 0; }       // another branch: start at its top
    var E = st.edit && canEdit(), isRoot = n.id === M.root;
    var trail = pathOf(n.id).slice(0, -1).map(function (i) { return N(i).title; }).join(" › ");
    panel.appendChild(el("div", { "class": "mp-phead" }, [
      el("div", { style: "min-width:0" }, [el("h2", { id: "mpPTitle", text: n.title }), trail ? el("p", { "class": "mp-path", text: trail }) : null]),
      el("button", { type: "button", "class": "btn ghost sm", text: "Close", onclick: function () { flush(); st.sel = null; render(); } })
    ]));
    var below = 0; each(n.id, function (x) { if (!x.verified && x.id !== n.id) below++; });
    panel.appendChild(el("div", { "class": "mp-rowwrap" }, [
      el("span", { "class": "badge " + (n.verified ? "ok" : "warn"), text: n.verified ? "Verified" : "To verify" }),
      n.verified && n.verified_by ? el("span", { "class": "small muted", text: "by " + n.verified_by + (n.verified_at ? ", " + Hub.date(n.verified_at) : "") }) : null,
      n.id !== st.focus ? el("button", { type: "button", "class": "btn ghost sm", text: "Show this branch alone", onclick: function () { focusOn(n.id); } }) : null
    ]));
    if (E) {
      panel.appendChild(el("div", { "class": "mp-status", id: "mpStatus", role: "status" }));
      if (retry && retry.id === n.id) status("Not saved yet.", true, true);
      else if (lastMsg.id === n.id && lastMsg.text) status(lastMsg.text, lastMsg.bad);
    }

    // name
    if (E) {
      var name = el("input", { "class": "input", type: "text", id: "mpName", value: n.title, maxlength: isRoot ? "80" : "120", autocomplete: "off", disabled: isRoot && !isOwn() });
      name.addEventListener("input", function () {
        var v = name.value.replace(/\s+/g, " ").trim();
        if (!v) { status("Give the branch a name.", true); return; }
        typed(n.id, "title", v); $("mpPTitle").textContent = v; viewSoon();
      });
      name.addEventListener("blur", function () { if (!name.value.trim()) { name.value = n.title; status(""); } flush(); });
      name.addEventListener("keydown", function (e) { if (e.key === "Enter") name.blur(); });
      panel.appendChild(el("section", {}, [el("h3", {}, [el("label", { "for": "mpName", text: isRoot ? "Map name" : "Name" })]), name,
        isRoot && !isOwn() ? el("p", { "class": "hint", text: "Only the owner renames the map." }) : null]));
    }

    // notes
    var notes;
    if (E) {
      notes = el("textarea", { "class": "input", id: "mpNotes", maxlength: "8000", placeholder: "What to know about " + n.title, text: n.notes });
      notes.addEventListener("input", function () { typed(n.id, "notes", notes.value); });
      notes.addEventListener("blur", flush);
      Hub.autoGrow(notes);
    } else notes = n.notes ? el("p", { "class": "mp-notes", text: n.notes }) : el("p", { "class": "muted small", text: "No notes yet." });
    panel.appendChild(el("section", {}, [el("h3", {}, [E ? el("label", { "for": "mpNotes", text: "Notes" }) : "Notes"]), notes]));

    // special notes
    var sp = el("section", {}, [el("h3", { text: "Special notes" })]);
    if (n.special.length) sp.appendChild(el("div", { "class": "mp-chips", style: "margin:0" }, n.special.map(function (s, i) {
      return el("span", { "class": "mp-chip" }, [el("b", { text: "SPECIAL" }), s,
        E ? el("button", { type: "button", "aria-label": "Remove special note: " + s, text: "×", onclick: function () { setList(n, "special", n.special.filter(function (x, j) { return j !== i; })); } }) : null]);
    })));
    else if (!E) sp.appendChild(el("p", { "class": "muted small", text: "None. They are for what must not be missed." }));
    if (E) sp.appendChild(adder("mpSpecial", "e.g. 50Hz for Egypt", "Add", 200, function (v) {
      if (n.special.length >= 20) { Hub.toast("A branch holds up to 20 special notes.", true); return; }
      setList(n, "special", n.special.concat([v]), "mpSpecial");
    }));
    panel.appendChild(sp);

    // images
    panel.appendChild(el("section", { id: "mpImages" }));
    drawImages();

    // links
    var lk = el("section", {}, [el("h3", { text: "Links" })]), shown = 0;
    n.links.forEach(function (l, i) {
      var a = linkNode(l); if (!a) return; shown++;
      lk.appendChild(E ? el("div", { "class": "mp-linkrow" }, [a, el("button", { type: "button", "class": "btn ghost sm", text: "Remove", "aria-label": "Remove link " + l.label,
        onclick: function () { setList(n, "links", n.links.filter(function (x, j) { return j !== i; })); } })]) : a);
    });
    if (!shown && !E) lk.appendChild(el("p", { "class": "muted small", text: "No links." }));
    if (E) lk.appendChild(el("div", {}, [el("button", { type: "button", "class": "btn ghost sm", text: "Add link", onclick: function () { linkSheet(n); } })]));
    panel.appendChild(lk);

    if (E) {
      panel.appendChild(el("section", {}, [el("h3", {}, [el("label", { "for": "mpChild", text: "Add a branch under this one" })]),
        adder("mpChild", "Branch name", "Add", 120, function (v) { addBranch(n, v); })]));
      var sibs = isRoot ? [] : N(n.parent).kids, at = sibs.indexOf(n.id), tools2 = [];
      if (!n.verified) tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Mark as verified", onclick: function () { verify(n, true, false); } }));
      if (below) tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Verify this branch and " + (below === 1 ? "the 1" : "the " + below) + " under it", onclick: function () { verify(n, true, true); } }));
      if (n.verified) tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Mark to verify", onclick: function () { verify(n, false, false); } }));
      if (!isRoot) {
        tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Move up", disabled: at <= 0, onclick: function () { move(n, -1); } }));
        tools2.push(el("button", { type: "button", "class": "btn ghost sm", text: "Move down", disabled: at < 0 || at >= sibs.length - 1, onclick: function () { move(n, 1); } }));
        tools2.push(el("button", { type: "button", "class": "btn danger sm", text: "Delete branch", onclick: function () { removeBranch(n); } }));
      }
      panel.appendChild(el("section", {}, [el("h3", { text: "This branch" }), el("div", { "class": "mp-rowwrap" }, tools2)]));
    }
    panel.appendChild(el("p", { "class": "mp-foot", id: "mpFoot" }));
    foot();
  }
  // special notes and links: the whole list is saved at once; a refusal puts the list back
  function setList(n, field, list, refocusId) {
    var before = n[field];
    n[field] = list; render();
    if (refocusId && $(refocusId)) $(refocusId).focus();
    flush();
    send(n.id, (function () { var p = {}; p[field] = list; return p; })(), function () { n[field] = before; }).then(function () { if (st.sel === n.id && field === "links") renderPanel(); });
  }
  function addBranch(n, title) {
    settled().then(function () {
      return act(Api.mpNodeAdd(T, n.id, title), function (r) {
        var c = r.node; c.kids = []; c.open = false; M.nodes[c.id] = c; n.kids.push(c.id); n.open = true;
        wantScroll = true; render();
        if ($("mpChild")) $("mpChild").focus();
      });
    });
  }
  function removeBranch(n) {
    var c = under(n.id);
    Hub.confirm(c ? "The branch, the " + plural(c, "branch", "branches") + " under it and their images are deleted. This cannot be undone."
                  : "The branch and its images are deleted. This cannot be undone.",
      { title: "Delete " + n.title + "?", ok: "Delete branch", danger: true }).then(function (yes) {
      if (!yes) return;
      settled().then(function () {
        return act(Api.mpNodeDelete(T, n.id), function () {
          var par = N(n.parent), gone = [];
          each(n.id, function (x) { gone.push(x.id); });
          par.kids.splice(par.kids.indexOf(n.id), 1);
          if (gone.indexOf(st.focus) >= 0) { st.focus = M.root; setHash(""); }
          gone.forEach(function (id) { delete M.nodes[id]; delete imgCache[id]; });
          if (draft && gone.indexOf(draft.id) >= 0) { clearTimeout(draft.timer); draft = null; }
          st.sel = par.id; render(); Hub.toast("Deleted " + n.title + ".");
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
  function linkNode(l) {
    var t;
    if (l.kind === "node") return el("button", { type: "button", "class": "mp-link", onclick: function () { followBranch(l); } }, [ico("link"), el("span", { "class": "t", text: l.label }), el("small", { text: "Branch" })]);
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
  function linkSheet(n) {
    if (n.links.length >= 12) { Hub.toast("A branch holds up to 12 links. Remove one first.", true); return; }
    sheet("Add a link to " + n.title, function (close) {
      var err = el("p", { "class": "mp-err", role: "alert" }), area = el("div", { "class": "stack" });
      var kinds = [["node", "Another branch"]];
      if (tool("standards")) kinds.push(["standard", "A standard (Standards tool)"]);
      if (tools().some(function (t) { return t.id !== TOOL; })) kinds.push(["tool", "A tool of this site"]);
      kinds.push(["web", "A web address"]);
      var kind = el("select", { "class": "input", id: "mpLinkKind" }, kinds.map(function (k) { return el("option", { value: k[0], text: k[1] }); }));
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
          get = function () { return brSel.value ? { kind: "node", node: brSel.value } : "Choose the branch to link to."; };
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
        var before = n.links;
        n.links = n.links.concat([{ kind: l.kind, label: l.label || "…", node: l.node, id: l.id, url: l.url }]);
        render(); flush();
        send(n.id, { links: before.concat([l]) }, function () { n.links = before; }).then(function () { if (st.sel === n.id) render(); });
      }
      return [field("Leads to", kind), area, field("Text shown", label), err,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Cancel", onclick: close }), el("button", { type: "button", "class": "btn", text: "Add link", onclick: go })])];
    });
  }

  // ---------- images ----------
  // Shrunk in the browser before they are saved: 1600 px on the long side at most, JPEG, about 450 KB at most.
  var MAX_IMAGES = 8, MAX_CHARS = 600000, imgBusy = "";
  function loadImages(id) {
    imgCache[id] = { state: "loading", list: [] };
    Api.mpNodeImages(T, id).then(function (r) { imgCache[id] = { state: "ok", list: r.images }; if (N(id)) N(id).images = r.images.length; if (st.sel === id) { drawImages(); viewSoon(); } },
      function (err) { imgCache[id] = { state: "error", list: [], error: err.message }; if (st.sel === id) drawImages(); });
  }
  function drawImages() {
    var host = $("mpImages"), n = st.sel && N(st.sel); if (!host || !n) return;
    var E = st.edit && canEdit(), c = imgCache[n.id];
    host.textContent = "";
    host.appendChild(el("h3", {}, [E ? el("label", { "for": "mpFile", text: "Images" }) : "Images"]));
    if (!c && n.images) { loadImages(n.id); c = imgCache[n.id]; }
    if (c && c.state === "loading") host.appendChild(el("p", { "class": "muted small", text: "Loading images…" }));
    else if (c && c.state === "error") host.appendChild(el("div", { "class": "mp-rowwrap" }, [el("span", { "class": "mp-err", text: "The images could not be loaded. " + c.error }),
      el("button", { type: "button", "class": "btn ghost sm", text: "Try again", onclick: function () { loadImages(n.id); drawImages(); } })]));
    else if (c && c.list.length) host.appendChild(el("div", { "class": "mp-thumbs" }, c.list.map(function (g) {
      var cap = null;
      if (E) {
        cap = el("input", { "class": "input", type: "text", value: g.caption, maxlength: "120", placeholder: "Caption", "aria-label": "Caption", autocomplete: "off" });
        cap.addEventListener("change", function () {
          var v = cap.value.replace(/\s+/g, " ").trim();
          act(Api.mpImageSave(T, g.id, v), function () { g.caption = v; });
        });
      } else if (g.caption) cap = el("figcaption", { text: g.caption });
      return el("figure", { "class": "mp-thumb" }, [
        el("button", { type: "button", "class": "pic", "aria-label": "Enlarge " + (g.caption || "image"), onclick: function () { viewImage(g, n); } }, [el("img", { src: g.thumb, alt: g.caption || "" })]),
        cap,
        E ? el("button", { type: "button", "class": "btn ghost sm", text: "Remove", onclick: function () { removeImage(n, g); } }) : null
      ]);
    })));
    else if (!E) host.appendChild(el("p", { "class": "muted small", text: "No images." }));
    if (E) {
      var file = el("input", { type: "file", id: "mpFile", accept: "image/*", multiple: true });
      file.addEventListener("change", function () { addImages(n.id, file.files); });
      host.appendChild(file);
      host.appendChild(el("p", { "class": "hint", text: imgBusy || "Photos, nameplates, drawings or screenshots, up to " + MAX_IMAGES + " on a branch. You can also paste a screenshot (Ctrl+V). Images are shrunk before they are saved." }));
    }
  }
  function readPicture(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { resolve({ im: im, done: function () { URL.revokeObjectURL(url); } }); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("read")); };
      im.src = url;
    });
  }
  function jpeg(im, max, q) {
    var w = im.naturalWidth || 1200, h = im.naturalHeight || 900, k = Math.min(1, max / Math.max(w, h)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext("2d");
    x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, c.width, c.height);          // paper white behind a transparent drawing: this is image data, not page colour
    x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  }
  function shrink(file) {
    return readPicture(file).then(function (p) {
      var steps = [[1600, 0.82], [1600, 0.7], [1280, 0.7], [1024, 0.7], [1024, 0.55], [800, 0.5]], data = "", thumb, i;
      try {
        for (i = 0; i < steps.length; i++) { data = jpeg(p.im, steps[i][0], steps[i][1]); if (data.length <= MAX_CHARS) break; }
        thumb = jpeg(p.im, 360, 0.7); if (thumb.length > 55000) thumb = jpeg(p.im, 240, 0.6);
      } finally { p.done(); }
      if (data.indexOf("data:image/jpeg;base64,") !== 0 || thumb.indexOf("data:image/jpeg;base64,") !== 0) throw new Error("read");
      if (data.length > MAX_CHARS) throw new Error("large");
      return { data: data, thumb: thumb };
    });
  }
  function addImages(id, fileList) {
    var files = [].slice.call(fileList || []), total = files.length, added = 0, kb = 0, problems = [], n = N(id);
    if (!n || !total) return;
    if (imgBusy) { Hub.toast("Wait until the images being added are saved.", true); return; }
    var have = imgCache[id] && imgCache[id].state === "ok" ? imgCache[id].list.length : n.images;
    function say(i) { imgBusy = "Adding image " + i + " of " + total + "…"; if (st.sel === id) drawImages(); }
    function finish() {
      imgBusy = ""; if (st.sel === id) drawImages(); viewSoon();
      if (!problems.length) Hub.toast((added === 1 ? "Image added" : added + " images added") + ", " + kb + " KB after shrinking.");
      else if (problems.length === 1 && !added) Hub.toast(problems[0], true);
      else Hub.tell(problems.join("\n"), { title: added ? plural(added, "image") + " added, " + problems.length + " not added" : "No image was added" });
    }
    (function next(i) {
      var f = files[i]; if (!f) return finish();
      var name = f.name || "The pasted image";
      if (!/^image\//.test(f.type)) { problems.push(name + " is not an image. Use JPG, PNG or a screenshot."); return next(i + 1); }
      if (f.size > 25 * 1024 * 1024) { problems.push(name + " is over 25 MB. Use a smaller one."); return next(i + 1); }
      if (have + added >= MAX_IMAGES) { problems.push("A branch holds up to " + MAX_IMAGES + " images. " + plural(total - i, "image") + " not added."); return finish(); }
      say(i + 1);
      shrink(f).then(function (s) {
        return Api.mpImageAdd(T, { nodeId: id, data: s.data, thumb: s.thumb, caption: "" }).then(function (r) {
          var c = imgCache[id] && imgCache[id].state === "ok" ? imgCache[id] : (imgCache[id] = { state: "ok", list: [] });
          if (c.list.length < n.images) { delete imgCache[id]; }            // the list was never loaded: read it again
          else c.list.push({ id: r.id, caption: "", thumb: s.thumb });
          fullCache[r.id] = s.data; n.images++; added++; kb += Math.round(s.data.length * 0.75 / 1024);
        });
      }).then(function () { next(i + 1); }, function (err) {
        problems.push(err.message === "read" ? name + " could not be read. Try saving it as JPG or PNG."
                    : err.message === "large" ? name + " is still too large after shrinking. Crop it or use a smaller one."
                    : name + ": " + err.message);
        next(i + 1);
      });
    })(0);
  }
  function removeImage(n, g) {
    Hub.confirm("The image is deleted from this branch. This cannot be undone.", { title: "Remove " + (g.caption ? "\"" + g.caption + "\"" : "this image") + "?", ok: "Remove image", danger: true }).then(function (yes) {
      if (!yes) return;
      act(Api.mpImageDelete(T, g.id), function () {
        var c = imgCache[n.id]; if (c) c.list = c.list.filter(function (x) { return x.id !== g.id; });
        n.images = Math.max(0, n.images - 1); delete fullCache[g.id];
        if (st.sel === n.id) drawImages(); viewSoon();
      });
    });
  }
  function viewImage(g, n) {
    sheet(g.caption || n.title, function (close) {
      var host = el("div", {}, [el("p", { "class": "muted", text: "Loading the image…" })]);
      function show(data) { host.textContent = ""; host.appendChild(el("img", { "class": "mp-full", src: data, alt: g.caption || "" })); }
      if (fullCache[g.id]) show(fullCache[g.id]);
      else Api.mpImageGet(T, g.id).then(function (r) { fullCache[g.id] = r.data; show(r.data); },
        function (err) { host.textContent = ""; host.appendChild(el("p", { "class": "mp-err", text: "The image could not be loaded. " + err.message })); });
      return [host, el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Close", onclick: close })])];
    });
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
        el("p", { "class": "small muted", text: "Paste an outline: one branch per line, two spaces deeper for a branch under it. A line starting with > is a note, with ! a special note. Images are added by hand. To import somewhere else, close this and select that branch first." }),
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
        el("p", { "class": "small muted", text: (n.id === M.root ? "The whole map" : "This branch and everything under it") + " as a plain outline: names, notes (>) and special notes (!). Images and links stay on the map. To export one branch only, show it alone first." }),
        ta,
        el("div", { "class": "hub-sheet-actions" }, [el("button", { type: "button", "class": "btn ghost", text: "Close", onclick: close }),
          el("button", { type: "button", "class": "btn ghost", text: "Download .txt", onclick: download }), el("button", { type: "button", "class": "btn", text: "Copy", onclick: copy })])
      ];
    });
  }

  // ---------- map settings (owner) ----------
  function settingsSheet() {
    sheet("Map settings", function (close) {
      var err = el("p", { "class": "mp-err", role: "alert" }), busy = false;
      var name = el("input", { "class": "input", type: "text", id: "mpSetName", value: M.map.name, maxlength: "80", autocomplete: "off" });
      var share = shareSelect("mpSetShare", M.map.share);
      var ok = el("button", { type: "button", "class": "btn", text: "Save", disabled: true, onclick: go });
      function changed() { ok.disabled = busy || (name.value.replace(/\s+/g, " ").trim() === M.map.name && share.value === M.map.share); }
      name.addEventListener("input", changed); share.addEventListener("change", changed);
      function go() {
        var v = name.value.replace(/\s+/g, " ").trim();
        if (!v) { err.textContent = "Give the map a name, usually the product."; name.focus(); return; }
        busy = true; changed(); err.textContent = "";
        settled().then(function () { return Api.mpMapSave(T, { id: M.map.id, name: v === M.map.name ? null : v, share: share.value === M.map.share ? null : share.value }); }).then(function () {
          close(); Hub.toast("Map settings saved.");
          reload();
        }, function (e) { busy = false; changed(); err.textContent = e.message; });
      }
      function del() {
        var b = under(M.root);
        close();
        Hub.confirm("The map, its " + plural(b, "branch", "branches") + " and every image on it are deleted for everyone. This cannot be undone.",
          { title: "Delete the map " + M.map.name + "?", ok: "Delete map", danger: true }).then(function (yes) {
          if (!yes) return;
          act(Api.mpDelete(T, M.map.id), function () { window.location.href = Hub.url("tools/maps/"); });
        });
      }
      return [
        el("label", { "class": "field" }, [el("span", { text: "Map name" }), name]),
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
