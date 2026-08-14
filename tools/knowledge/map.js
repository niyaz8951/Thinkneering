/* =====================================================================
   Knowledge map editor
   Nodes and edges live in D1, not in a local blob. Every save is a round
   trip, because approval status has to be authoritative — a node that
   looks approved here is a node Compliance Maker is quoting.
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var ICONS = {
    layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    box: 'M21 16V8l-9-5-9 5v8l9 5z M3 8l9 5 9-5M12 13v9',
    puzzle: 'M4 7h4V5a2 2 0 1 1 4 0v2h4v4h2a2 2 0 1 1 0 4h-2v4H4z',
    gauge: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 12l4-4',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    wind: 'M3 8h10a3 3 0 1 0-3-3M3 16h13a3 3 0 1 1-3 3M3 12h17',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
    alert: 'M12 2 1 21h22zM12 9v5M12 18h.01',
    wrench: 'M14 7a5 5 0 0 1-6.6 6.6L3 18l3 3 4.4-4.4A5 5 0 0 0 17 10z',
    book: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3zM18 7h2v16H7',
    note: 'M4 4h16v12l-4 4H4zM16 20v-4h4',
    play: 'M6 3l14 9-14 9z',
    split: 'M18 3h4v4M22 3l-7 7M3 21l7-7M6 21H3v-3',
    stamp: 'M5 22h14M6 18h12v-3H6zM9 15V9a3 3 0 1 1 6 0v6',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
  };

  var NODE_W = 210, NODE_H = 80, DIA_W = 196, DIA_H = 112;
  var LANE_W = 300, LANE_GAP = 40, ROW_H = 130, LANE_TOP = 90;

  var mapId = new URLSearchParams(location.search).get('map');
  var pack = null;
  // Lanes belong to the map, not the domain pack. `pack` still supplies node
  // kinds and relation types (the taxonomy); the columns are the user's.
  var lanes = [];
  var mapInfo = null;
  var role = 'viewer';
  var nodes = [], edges = [];
  var selectedId = null, editingEdgeId = null, connectFrom = null;
  var filterText = '', statusFilter = 'all';
  var view = { x: 0, y: 0, k: 1 };
  var dragging = null, panning = null, linking = null;

  /* Multi-touch. Every live pointer is tracked by id so a second finger can
     be recognised the moment it lands. `pinch` holds the anchor state for the
     current two-finger gesture; `suppressTap` stops the release of a pinch
     being read as a tap on whatever was underneath. */
  /* Actions that read the whole map and need no node selected. Kept in one
     place because both the runAi guard and the button-disabling in
     switchSheetTab have to agree on it. */
  var MAP_LEVEL_AI = ['review_map', 'find_duplicates', 'suggest_lanes',
                      'summarise_nodes', 'answer_question'];

  var pointers = new Map();
  var pinch = null;
  var suppressTap = false;
  var attrRows = [];

  /* Focus mode. `focusId` is the spotlit node; everything not adjacent to it
     fades right back. This is what a single click does now — the map stops
     being a wall of boxes and becomes one idea and its neighbours. */
  var focusId = null;
  var focusRing = null;      // Set of ids kept visible while focused

  /* The node sheet replaces the old right-hand inspector. Same fields, same
     ids, same save path — it just knows how to cover a phone screen. */
  var sheetOpen = false, sheetTab = 'details';
  var noteDirty = false, noteTimer = null, noteReading = false;
  var lastTap = { id: null, at: 0 };

  var svg, scene, gLanes, gEdges, gNodes, gOverlay, defs;

  /* ── Helpers ───────────────────────────────────────────────────── */


  /* Read a response that is supposed to be JSON but might not be.
     A crashed Function returns Cloudflare's HTML error page; a bare
     res.json() on that throws "Unexpected token '<'", which tells the user
     nothing. Surface the status and a readable message instead. */
  async function readJson(res) {
    var text = await res.text();
    var body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }

    if (body === null) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('You are signed out, or do not have access. Reload and sign in.');
      }
      if (res.status === 404) throw new Error('That endpoint is not deployed (404).');
      throw new Error('The server returned an error page (HTTP ' + res.status +
        '), not JSON. Check the Functions log in the Cloudflare dashboard.');
    }
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(t) { $('status').textContent = t; }

  function nodeById(id) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
    return null;
  }

  function laneById(id) {
    if (!pack) return null;
    for (var i = 0; i < lanes.length; i++) if (lanes[i].id === id) return lanes[i];
    return null;
  }

  function laneIndex(id) {
    if (!pack) return 0;
    for (var i = 0; i < lanes.length; i++) if (lanes[i].id === id) return i;
    return lanes.length;
  }

  function kindDef(node) {
    return (pack && pack.nodeKinds[node.kind]) || { label: node.kind, token: '--kg-note', icon: 'note' };
  }

  function colourOf(node) {
    var def = kindDef(node);
    // A handful of kinds carry their own colour because risk and branching
    // must read at a glance regardless of which lane they sit in.
    var overrides = ['decision', 'approval', 'exception', 'failure', 'risk', 'note', 'standard', 'start'];
    if (overrides.indexOf(node.kind) !== -1) return 'var(--kg-' + node.kind + ')';
    var lane = laneById(node.lane);
    return 'var(' + (lane ? lane.token : '--color-text-muted') + ')';
  }

  function isDiamond(node) {
    return node.kind === 'decision' || node.kind === 'approval';
  }

  function sizeOf(node) {
    return isDiamond(node) ? { w: DIA_W, h: DIA_H } : { w: NODE_W, h: NODE_H };
  }

  function csvToList(text) {
    return String(text || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function wrap(text, maxChars, maxLines) {
    var words = String(text || 'Untitled').split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var cand = cur ? cur + ' ' + words[i] : words[i];
      if (cand.length > maxChars && cur) { lines.push(cur); cur = words[i]; }
      else cur = cand;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…';
    }
    return lines;
  }

  /* A dictionary of words is a word map, not an equipment map. Falling back
     to HVAC is what put "Flow / medium" in front of a reader looking up
     "judgment"; english is now a first-class pack. */
  function packFor(domain) {
    if (domain === 'business') return window.TN_KG_BUSINESS;
    if (domain === 'english' || domain === 'general') return window.TN_KG_ENGLISH || window.TN_KG_HVAC;
    return window.TN_KG_HVAC;
  }

  function canEdit() { return role === 'contributor' || role === 'reviewer' || role === 'owner'; }
  function canApprove() { return role === 'reviewer' || role === 'owner'; }

  /* ── Load ──────────────────────────────────────────────────────── */

  async function load() {
    if (!mapId) {
      $('map-title').textContent = 'No map selected';
      $('map-desc').textContent = 'Go back to the repository and open a map.';
      return;
    }
    try {
      var res = await fetch('/api/knowledge/graph?map=' + encodeURIComponent(mapId));
      var body = await readJson(res);

      mapInfo = body.map;
      role = body.role;
      nodes = body.nodes;
      edges = body.edges;

      pack = packFor(mapInfo.domain);
      lanes = Array.isArray(mapInfo.lanes) ? mapInfo.lanes : [];

      $('map-title').textContent = mapInfo.title;
      $('map-desc').textContent = mapInfo.description || '';
      document.title = mapInfo.title + ' — Thinkneering';

      buildControls();
      renderHealth(body.score, body.findings);
      render();
      fit();
      setStatus(nodes.length + ' nodes · your role: ' + role);

      if (!canEdit()) {
        ['save-node', 'connect-node', 'delete-node', 'add-attr'].forEach(function (id) {
          if ($(id)) $(id).disabled = true;
        });
      }
      if (!canApprove()) {
        $('approve-node').disabled = true;
        $('reject-node').disabled = true;
      }
    } catch (err) {
      $('map-title').textContent = 'Could not open this map';
      $('map-desc').textContent = err.message;
    }
  }

  /* ── Layout ────────────────────────────────────────────────────── */

  function laneLeft(i) { return LANE_TOP + i * (LANE_W + LANE_GAP); }
  function laneX(i) { return laneLeft(i) + LANE_W / 2; }

  function layoutByLane() {
    var rows = {};
    nodes.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (n) {
      var i = laneIndex(n.lane);
      rows[i] = (rows[i] || 0);
      n.x = laneX(i);
      n.y = LANE_TOP + 70 + rows[i] * ROW_H;
      rows[i]++;
    });
    render();
    fit();
    setStatus('Tidied. Positions save when you save a node.');
  }


  /* ── Lane editor ───────────────────────────────────────────────────
     Lanes are the map's own columns. Renaming one is safe at any time —
     nodes reference the lane id, not the label. Removing one is not: its
     nodes would be orphaned, so that is blocked while the lane is occupied.
     ------------------------------------------------------------------ */

  var laneDraft = [];

  function laneId(label, taken) {
    var base = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'lane';
    var id = base, n = 2;
    while (taken.indexOf(id) !== -1) { id = base + '-' + n; n++; }
    return id;
  }

  function laneNodeCount(id) {
    return nodes.filter(function (n) { return n.lane === id; }).length;
  }

  function renderLaneEditor() {
    if (!laneDraft.length) {
      $('lane-list').innerHTML = '<p class="kg-muted">No lanes yet. Add one below, or close this and ' +
        'use <strong>Suggest lanes</strong> in the assistant once you have a few nodes.</p>';
      return;
    }
    $('lane-list').innerHTML = laneDraft.map(function (l, i) {
      var count = laneNodeCount(l.id);
      return '<div class="kg-lane-row">' +
        '<span class="kg-legend-dot" style="background:var(--kg-lane-' + ((i % 7) + 1) + ')"></span>' +
        '<input class="kg-input" data-lane-label="' + i + '" value="' + esc(l.label) + '">' +
        '<span class="kg-lane-count">' + count + '</span>' +
        '<button type="button" class="kg-icon-btn" data-lane-up="' + i + '" aria-label="Move up"' +
          (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
        '<button type="button" class="kg-icon-btn" data-lane-down="' + i + '" aria-label="Move down"' +
          (i === laneDraft.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
        '<button type="button" class="kg-icon-btn" data-lane-del="' + i + '" aria-label="Remove"' +
          (count ? ' disabled title="Move its ' + count + ' nodes out first"' : '') + '>&times;</button>' +
        '</div>';
    }).join('');
  }

  function openLaneEditor() {
    laneDraft = lanes.map(function (l) { return { id: l.id, label: l.label }; });
    $('lane-new').value = '';
    $('lane-note').textContent = '';
    renderLaneEditor();
    $('lanes-dialog').showModal();
  }

  function addLane(label) {
    label = String(label || '').trim();
    if (!label) return;
    if (laneDraft.length >= 24) { $('lane-note').textContent = 'That is as many lanes as a map can carry.'; return; }
    laneDraft.push({ id: laneId(label, laneDraft.map(function (l) { return l.id; })), label: label });
    $('lane-new').value = '';
    $('lane-note').textContent = '';
    renderLaneEditor();
  }

  async function saveLanes() {
    var labels = laneDraft.map(function (l) { return l.label.trim(); });
    if (labels.some(function (l) { return !l; })) {
      $('lane-note').textContent = 'Every lane needs a name.';
      return;
    }
    $('lane-note').textContent = 'Saving…';
    try {
      var res = await fetch('/api/knowledge/maps?id=' + encodeURIComponent(mapId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lanes: laneDraft })
      });
      var body = await readJson(res);
      lanes = laneDraft.map(function (l, i) {
        return { id: l.id, label: l.label, token: '--kg-lane-' + ((i % 7) + 1) };
      });
      $('lanes-dialog').close();
      buildControls();
      layoutByLane();
      render();
      fit();
      setStatus('Lanes saved.');
    } catch (err) {
      $('lane-note').textContent = 'Could not save: ' + err.message;
    }
  }

  /* Apply lanes the assistant proposed. Nodes are moved by title match, and
     an APPROVED node is never moved — it has been checked by a person and
     its placement is part of what was checked. */
  async function applySuggestedLanes(suggested) {
    if (!suggested || !suggested.length) return;

    var taken = [];
    var newLanes = suggested.map(function (l) {
      var existing = lanes.filter(function (e) {
        return e.label.toLowerCase() === String(l.label).toLowerCase();
      })[0];
      var id = existing ? existing.id : laneId(l.label, taken);
      taken.push(id);
      return { id: id, label: String(l.label).slice(0, 60) };
    });

    setStatus('Applying lanes…');
    try {
      var res = await fetch('/api/knowledge/maps?id=' + encodeURIComponent(mapId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lanes: newLanes })
      });
      await readJson(res);

      lanes = newLanes.map(function (l, i) {
        return { id: l.id, label: l.label, token: '--kg-lane-' + ((i % 7) + 1) };
      });

      var moved = 0, skipped = 0;
      for (var i = 0; i < suggested.length; i++) {
        var titles = suggested[i].nodes || [];
        for (var j = 0; j < titles.length; j++) {
          var node = nodes.filter(function (n) {
            return n.title.toLowerCase() === String(titles[j]).toLowerCase();
          })[0];
          if (!node) continue;
          if (node.status === 'approved') { skipped++; continue; }
          if (node.lane === newLanes[i].id) continue;
          node.lane = newLanes[i].id;
          await fetch('/api/knowledge/graph', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'node', mapId: mapId, id: node.id, kind: node.kind, title: node.title,
              lane: node.lane, summary: node.summary, aliases: node.aliases, body: node.body,
              attributes: node.attributes, tags: node.tags, standards: node.standards,
              x: node.x, y: node.y
            })
          });
          moved++;
        }
      }

      await reload();
      buildControls();
      layoutByLane();
      render();
      fit();
      setStatus('Lanes applied. ' + moved + ' nodes moved' +
        (skipped ? ', ' + skipped + ' approved nodes left where they were' : '') + '.');
    } catch (err) {
      setStatus('Could not apply lanes: ' + err.message);
    }
  }

  /* ── Render ────────────────────────────────────────────────────── */

  function render() {
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    renderLanes();
    renderEdges();
    renderNodes();
    renderOutline();
    renderInspector();
    $('empty').hidden = nodes.length > 0;
  }

  function renderDefs() {
    var tokens = ['--color-text-muted', '--color-primary', '--color-accent', '--color-danger'];
    defs.innerHTML = tokens.map(function (tok) {
      var key = tok.replace(/[^a-z]/g, '');
      return '<marker id="kg-arrow-' + key + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" ' +
        'markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(' + tok + ')"></path></marker>' +
        '<marker id="kg-diamond-' + key + '" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="8" ' +
        'markerHeight="8" orient="auto"><path d="M0 6 L6 2 L12 6 L6 10 z" style="fill:var(' + tok + ')"></path></marker>';
    }).join('');
  }

  function renderLanes() {
    if (!lanes.length || !nodes.length) { gLanes.innerHTML = ''; return; }
    var maxY = Math.max.apply(null, nodes.map(function (n) { return n.y; }).concat([400]));
    gLanes.innerHTML = lanes.map(function (lane, i) {
      var left = laneLeft(i);
      return '<rect x="' + left + '" y="' + (LANE_TOP - 46) + '" width="' + LANE_W + '" height="' +
        (maxY + 160) + '" rx="16" style="fill:var(' + lane.token + ');opacity:.05"></rect>' +
        '<rect x="' + left + '" y="' + (LANE_TOP - 46) + '" width="' + LANE_W + '" height="30" rx="10" ' +
        'style="fill:var(' + lane.token + ');opacity:.14"></rect>' +
        '<text class="kg-lane-label" style="fill:var(' + lane.token + ')" x="' + (left + 14) + '" y="' +
        (LANE_TOP - 26) + '">' + esc(lane.label.toUpperCase()) + '</text>';
    }).join('');
  }

  /* ── Focus mode ────────────────────────────────────────────────────
     One click spotlights. The node and anything directly connected to it
     stay lit; the rest drops to a whisper so the eye has somewhere to go.
     Neighbours are kept rather than hiding everything else outright,
     because a node with no visible context is not much use either.
     ---------------------------------------------------------------- */

  function setFocus(id) {
    focusId = id;
    if (!id) { focusRing = null; renderFocusBar(); render(); return; }

    focusRing = new Set([id]);
    edges.forEach(function (e) {
      if (e.from === id) focusRing.add(e.to);
      if (e.to === id) focusRing.add(e.from);
    });

    renderFocusBar();
    render();
    centreOn(id);
  }

  function clearFocus() { setFocus(null); }

  function renderFocusBar() {
    var bar = $('focusbar');
    var node = focusId ? nodeById(focusId) : null;
    if (!node) { bar.hidden = true; return; }
    bar.hidden = false;
    $('focus-dot').style.background = colourOf(node);
    $('focus-title').textContent = node.title;
    var ring = focusRing ? focusRing.size - 1 : 0;
    $('focus-title').title = node.title + ' — ' + ring + ' connected';
  }

  /* Slides the view so a node sits in the middle, without changing zoom. */
  function centreOn(id) {
    var n = nodeById(id);
    if (!n) return;
    var r = svg.getBoundingClientRect();
    if (!r.width) return;
    view.x = r.width / 2 - n.x * view.k;
    view.y = r.height / 2 - n.y * view.k;
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
  }

  function inFocus(node) {
    return !focusRing || focusRing.has(node.id);
  }

  function visible(node) {
    if (statusFilter === 'approved' && node.status !== 'approved') return false;
    if (statusFilter === 'pending' && node.status === 'approved') return false;
    return true;
  }

  function matches(node) {
    if (!filterText) return true;
    var hay = [node.title, node.summary, node.body, (node.aliases || []).join(' '),
               (node.tags || []).join(' '), (node.standards || []).join(' '),
               (node.attributes || []).map(function (a) { return a.name; }).join(' ')]
      .join(' ').toLowerCase();
    return hay.indexOf(filterText) !== -1;
  }

  function renderNodes() {
    gNodes.innerHTML = nodes.filter(visible).map(function (node) {
      var def = kindDef(node);
      var s = sizeOf(node);
      var colour = colourOf(node);
      var cls = 'kg-node' +
        (node.id === selectedId ? ' is-selected' : '') +
        (node.id === focusId ? ' is-focused' : '') +
        (matches(node) && inFocus(node) ? '' : ' is-dimmed') +
        (node.status === 'approved' ? '' : ' is-unapproved');

      var lines = wrap(node.title, isDiamond(node) ? 17 : 24, 2);
      var html = '<g class="' + cls + '" data-node-id="' + node.id + '" tabindex="0" role="button" aria-label="' +
        esc(def.label + ', ' + node.status + ': ' + node.title) + '">';

      if (isDiamond(node)) {
        html += '<polygon class="kg-node-box" style="stroke:' + colour + '" points="' +
          [node.x + ',' + (node.y - s.h / 2), (node.x + s.w / 2) + ',' + node.y,
           node.x + ',' + (node.y + s.h / 2), (node.x - s.w / 2) + ',' + node.y].join(' ') + '"></polygon>' +
          '<text class="kg-node-kind" style="fill:' + colour + '" x="' + node.x + '" y="' + (node.y - 24) +
          '" text-anchor="middle">' + esc(def.label) + '</text>';
      } else {
        html += '<rect class="kg-node-box" style="stroke:' + colour + '" rx="12" x="' + (node.x - s.w / 2) +
          '" y="' + (node.y - s.h / 2) + '" width="' + s.w + '" height="' + s.h + '"></rect>' +
          '<rect x="' + (node.x - s.w / 2 + 1) + '" y="' + (node.y - s.h / 2 + 13) + '" width="5" height="' +
          (s.h - 26) + '" rx="2" style="fill:' + colour + '"></rect>';
        var ix = node.x - s.w / 2 + 18, iy = node.y - s.h / 2 + 11;
        html += '<g transform="translate(' + ix + ',' + iy + ') scale(0.48)" style="stroke:' + colour +
          ';stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round"><path d="' +
          (ICONS[def.icon] || ICONS.note) + '"></path></g>' +
          '<text class="kg-node-kind" style="fill:' + colour + '" x="' + (ix + 19) + '" y="' + (iy + 9) +
          '">' + esc(def.label) + '</text>';
      }

      var top = isDiamond(node) ? node.y - 2 : node.y + 4;
      lines.forEach(function (line, i) {
        html += '<text class="kg-node-title" x="' + node.x + '" y="' + (top + i * 16) +
          '" text-anchor="middle">' + esc(line) + '</text>';
      });

      if (!isDiamond(node)) {
        var meta = [];
        if (node.status !== 'approved') meta.push(node.status);
        if ((node.attributes || []).length) meta.push((node.attributes || []).length + ' params');
        if ((node.aliases || []).length) meta.push((node.aliases || []).length + ' aliases');
        // A node carrying notes, or closed to AI, should say so on the map —
        // otherwise you have to open each one to find out.
        if (node.notes) meta.push('notes');
        if (Number(node.aiOpen) === 0) meta.push('final');
        if (meta.length) {
          html += '<text class="kg-node-meta" x="' + node.x + '" y="' + (node.y + s.h / 2 - 8) +
            '" text-anchor="middle">' + esc(meta.join('  ·  ')) + '</text>';
        }
      }

      if (node.id === selectedId) {
        html += '<circle class="kg-handle" data-handle="' + node.id + '" r="7" cx="' +
          (node.x + s.w / 2 + 4) + '" cy="' + node.y + '"></circle>';
      }

      return html + '</g>';
    }).join('');
  }

  function borderPoint(node, tx, ty) {
    var s = sizeOf(node);
    var dx = tx - node.x, dy = ty - node.y;
    if (!dx && !dy) return { x: node.x, y: node.y };
    var hw = s.w / 2 + 4, hh = s.h / 2 + 4, t;
    if (isDiamond(node)) t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    else {
      var a = Math.abs(dx) > 0.0001 ? hw / Math.abs(dx) : Infinity;
      var b = Math.abs(dy) > 0.0001 ? hh / Math.abs(dy) : Infinity;
      t = Math.min(a, b);
    }
    return { x: node.x + dx * t, y: node.y + dy * t };
  }

  function relDef(relation) {
    return (pack && pack.relations[relation]) || { label: relation, arrow: 'plain', dash: '' };
  }

  function edgeToken(edge) {
    if (edge.medium === 'chilled_water') return '--color-primary';
    if (edge.medium === 'refrigerant') return '--color-danger';
    if (edge.medium === 'air') return '--color-accent';
    if (edge.relation === 'contains' || edge.relation === 'part_of') return '--color-text-muted';
    return '--color-text-muted';
  }

  function renderEdges() {
    gEdges.innerHTML = edges.map(function (edge) {
      var a = nodeById(edge.from), b = nodeById(edge.to);
      if (!a || !b || !visible(a) || !visible(b)) return '';

      var def = relDef(edge.relation);
      var tok = edgeToken(edge);
      var key = tok.replace(/[^a-z]/g, '');
      var p1 = borderPoint(a, b.x, b.y), p2 = borderPoint(b, a.x, a.y);
      var d = 'M' + p1.x + ' ' + p1.y + ' L' + p2.x + ' ' + p2.y;
      var midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;

      var marker = def.arrow === 'diamond'
        ? ' marker-end="url(#kg-diamond-' + key + ')"'
        : ' marker-end="url(#kg-arrow-' + key + ')"';
      if (def.arrow === 'both') marker += ' marker-start="url(#kg-arrow-' + key + ')"';

      // While focused, only edges touching the focused node stay lit.
      var lit = !focusRing || (edge.from === focusId || edge.to === focusId);
      var style = 'stroke:var(' + tok + ')' + (def.dash ? ';stroke-dasharray:' + def.dash : '') +
        ';opacity:' + (lit ? (edge.status === 'approved' ? 1 : 0.5) : 0.07);

      var label = edge.label || def.label;
      var w = label.length * 5.6 + 12;

      return '<path class="kg-edge-hit" data-edge-id="' + edge.id + '" d="' + d + '"></path>' +
        '<path class="kg-edge-path" style="' + style + '" d="' + d + '"' + marker + '></path>' +
        '<rect class="kg-edge-label-bg" x="' + (midX - w / 2) + '" y="' + (midY - 8) + '" width="' + w +
        '" height="16" rx="5"></rect>' +
        '<text class="kg-edge-label" x="' + midX + '" y="' + (midY + 4) + '" text-anchor="middle">' +
        esc(label) + '</text>';
    }).join('');
  }

  function renderOutline() {
    if (!pack) return;
    var html = '';
    lanes.concat([{ id: '', label: 'Unassigned', token: '--color-text-muted' }]).forEach(function (lane) {
      var group = nodes.filter(function (n) {
        return lane.id ? n.lane === lane.id : !laneById(n.lane);
      });
      if (!group.length) return;
      html += '<h3 class="kg-subhead" style="color:var(' + lane.token + ')">' + esc(lane.label) + '</h3><ul class="kg-list">';
      group.forEach(function (n) {
        var meta = [kindDef(n).label];
        if ((n.aliases || []).length) meta.push('aka ' + n.aliases.slice(0, 3).join(', '));
        if ((n.standards || []).length) meta.push(n.standards.join(', '));
        html += '<li><span class="kg-list-bar" style="background:' + colourOf(n) + '"></span>' +
          '<div class="kg-list-body"><p class="kg-list-title"><button type="button" class="kg-linkish" data-goto="' +
          n.id + '">' + esc(n.title) + '</button> <span class="kg-pill kg-pill-' + esc(n.status) + '">' +
          esc(n.status) + '</span></p>' +
          '<p class="kg-list-meta">' + esc(meta.join(' · ')) + '</p>' +
          (n.summary ? '<p class="kg-muted">' + esc(n.summary) + '</p>' : '') +
          '</div></li>';
      });
      html += '</ul>';
    });
    $('outline').innerHTML = html || '<p class="kg-muted">No nodes yet.</p>';
  }

  function renderHealth(score, findings) {
    $('health-score').textContent = score == null ? '—' : score;
    $('findings').innerHTML = (findings && findings.length)
      ? findings.map(function (f) {
          return '<li><span class="kg-finding-weight">−' + f.weight + '</span><div class="kg-list-body">' +
            '<p class="kg-list-title">' + esc(f.message) + '</p>' +
            (f.fix ? '<p class="kg-muted">' + esc(f.fix) + '</p>' : '') + '</div></li>';
        }).join('')
      : '<li class="kg-muted">Nothing flagged.</li>';
  }

  /* ── Inspector ─────────────────────────────────────────────────── */

  function renderInspector() {
    var node = nodeById(selectedId);
    // Pane visibility lives in switchSheetTab so there is one place that
    // decides it; setting node-form.hidden here as well fought with it.
    switchSheetTab(sheetTab);
    if (!node) return;

    $('node-status').textContent = node.status;
    $('node-status').className = 'kg-pill kg-pill-' + node.status;
    $('node-version').textContent = 'v' + (node.version || 1) +
      (node.approvedAt ? ' · approved ' + node.approvedAt.slice(0, 10) : '');

    $('f-title').value = node.title || '';
    $('f-kind').value = node.kind;
    $('f-lane').value = node.lane || '';
    $('f-summary').value = node.summary || '';
    $('f-aliases').value = (node.aliases || []).join(', ');
    $('f-body').value = node.body || '';
    $('f-standards').value = (node.standards || []).join(', ');
    $('f-tags').value = (node.tags || []).join(', ');

    attrRows = (node.attributes || []).slice();
    renderAttrs();

    /* Sheet header */
    $('sheet-dot').style.background = colourOf(node);
    $('sheet-kind').textContent = kindDef(node).label;
    $('sheet-title').textContent = node.title || 'Untitled';

    /* Notes — only reload the editor when a different node is open, or the
       user's in-progress typing would be wiped by any incidental re-render. */
    var editor = $('note-editor');
    if (editor.getAttribute('data-node') !== node.id) {
      editor.setAttribute('data-node', node.id);
      editor.innerHTML = node.notes || '';
      noteDirty = false;
      $('note-saved').textContent = '';
      setReading(false);
    }
    updateNoteCount();

    /* AI pane */
    $('ai-open').checked = Number(node.aiOpen) === 1;
    updateAiOpenHint();

    var hasNote = !!(node.aiNote || '').trim();
    $('ai-note-box').hidden = !hasNote;
    if (hasNote) {
      $('ai-note-text').textContent = node.aiNote;
      $('ai-note-when').textContent = node.aiNoteAt
        ? 'From the map review on ' + node.aiNoteAt.slice(0, 10)
        : '';
    }
  }

  function updateAiOpenHint() {
    var on = $('ai-open').checked;
    $('ai-open-hint').textContent = on
      ? 'Map review may rewrite the lane, add connections and leave an opinion here.'
      : 'This node is settled. Map review will read it for context but change nothing.';
  }

  function renderAttrs() {
    $('f-attributes').innerHTML = attrRows.map(function (a, i) {
      return '<div class="kg-attr-row">' +
        '<input class="kg-input" data-attr="name" data-i="' + i + '" placeholder="Parameter" value="' + esc(a.name || '') + '">' +
        '<input class="kg-input" data-attr="value" data-i="' + i + '" placeholder="Value or TO VERIFY" value="' + esc(a.value || '') + '">' +
        '<input class="kg-input" data-attr="unit" data-i="' + i + '" placeholder="Unit" style="max-width:80px" value="' + esc(a.unit || '') + '">' +
        '<button type="button" class="kg-icon-btn" data-remove-attr="' + i + '" aria-label="Remove parameter">' +
        '<svg class="kg-ico" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button></div>' +
        '<input class="kg-input" data-attr="basis" data-i="' + i + '" placeholder="Basis — which standard or document establishes this" value="' + esc(a.basis || '') + '" style="font-size:13px;min-height:34px">';
    }).join('') || '<p class="kg-muted">No parameters yet. These are what answer a compliance line.</p>';
  }

  async function saveNode() {
    var node = nodeById(selectedId);
    if (!node) return;

    var payload = {
      type: 'node', mapId: mapId, id: node.id,
      kind: $('f-kind').value,
      title: $('f-title').value.trim(),
      lane: $('f-lane').value,
      summary: $('f-summary').value.trim(),
      aliases: csvToList($('f-aliases').value),
      body: $('f-body').value,
      standards: csvToList($('f-standards').value),
      tags: csvToList($('f-tags').value),
      attributes: attrRows.filter(function (a) { return (a.name || '').trim(); }),
      x: node.x, y: node.y
    };

    if (!payload.title) { setStatus('A node needs a title.'); return; }

    setStatus('Saving…');
    try {
      var res = await fetch('/api/knowledge/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var body = await readJson(res);

      if (node.status === 'approved' && body.status === 'proposed') {
        setStatus('Saved. Editing an approved node sends it back for review, so Compliance Maker is not quoting a version nobody checked.');
      } else {
        setStatus('Saved.');
      }
      await reload();
    } catch (err) {
      setStatus('Save failed: ' + err.message);
    }
  }

  async function setNodeStatus(status) {
    if (!selectedId) return;
    var reason = '';
    if (status === 'rejected') {
      reason = window.prompt('Why is this being rejected? The contributor will see it.') || '';
      if (!reason) return;
    }
    setStatus(status === 'approved' ? 'Approving and indexing…' : 'Updating…');
    try {
      var res = await fetch('/api/knowledge/graph', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'node', mapId: mapId, id: selectedId, status: status, reason: reason })
      });
      var body = await readJson(res);
      setStatus(status === 'approved'
        ? 'Approved. ' + (body.indexedTerms || 0) + ' search terms indexed — this node can now answer a Compliance Maker query.'
        : 'Status set to ' + status + '.');
      await reload();
    } catch (err) {
      setStatus('Failed: ' + err.message);
    }
  }

  async function addNode(kind) {
    var c = centre();
    var lane = selectedId && nodeById(selectedId) ? nodeById(selectedId).lane : ((lanes[0] || {}).id || '');
    try {
      var res = await fetch('/api/knowledge/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'node', mapId: mapId, kind: kind, lane: lane,
          title: 'New ' + (pack.nodeKinds[kind] ? pack.nodeKinds[kind].label.toLowerCase() : kind),
          x: Math.round(c.x), y: Math.round(c.y)
        })
      });
      var body = await readJson(res);
      await reload();
      selectedId = body.id;
      clearFocus();
      openSheet('details');
      render();
      $('f-title').focus();
      $('f-title').select();
    } catch (err) { setStatus('Could not add: ' + err.message); }
  }

  async function deleteNode() {
    if (!selectedId) return;
    if (!window.confirm('Delete this node and its connections? This cannot be undone.')) return;
    try {
      await fetch('/api/knowledge/graph?type=node&id=' + encodeURIComponent(selectedId) +
        '&map=' + encodeURIComponent(mapId), { method: 'DELETE' });
      selectedId = null;
      await reload();
      setStatus('Deleted.');
    } catch (err) { setStatus('Delete failed: ' + err.message); }
  }

  async function reload() {
    var res = await fetch('/api/knowledge/graph?map=' + encodeURIComponent(mapId));
    var body;
    // reload() runs after most writes. If it fails silently the canvas shows
    // stale data and the next save conflicts, so surface it rather than
    // returning quietly.
    try { body = await readJson(res); }
    catch (err) { setStatus('Could not refresh the map: ' + err.message); return; }
    nodes = body.nodes;
    edges = body.edges;
    renderHealth(body.score, body.findings);
    render();
  }

  /* ── Connections ───────────────────────────────────────────────── */

  function openConnect(fromId, toId) {
    connectFrom = fromId;
    editingEdgeId = null;
    $('c-target').innerHTML = nodes.filter(function (n) { return n.id !== fromId; })
      .map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + '</option>'; }).join('');
    if (toId) $('c-target').value = toId;
    $('c-medium').value = '';
    $('c-label').value = '';
    $('c-delete').hidden = true;
    $('connect-dialog').showModal();
  }

  function editEdge(edgeId) {
    var edge = edges.filter(function (e) { return e.id === edgeId; })[0];
    if (!edge) return;
    editingEdgeId = edgeId;
    connectFrom = edge.from;
    $('c-target').innerHTML = nodes.filter(function (n) { return n.id !== edge.from; })
      .map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + '</option>'; }).join('');
    $('c-target').value = edge.to;
    $('c-relation').value = edge.relation;
    $('c-medium').value = edge.medium || '';
    $('c-label').value = edge.label || '';
    $('c-delete').hidden = false;
    $('connect-dialog').showModal();
  }

  async function saveEdge() {
    try {
      var res = await fetch('/api/knowledge/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'edge', mapId: mapId, id: editingEdgeId,
          from: connectFrom, to: $('c-target').value,
          relation: $('c-relation').value,
          medium: $('c-medium').value || null,
          label: $('c-label').value.trim()
        })
      });
      var body = await readJson(res);
      $('connect-dialog').close();
      await reload();
      setStatus('Connection saved.');
    } catch (err) { setStatus('Failed: ' + err.message); }
  }

  /* ── AI ────────────────────────────────────────────────────────── */

  function aiOut(html) { $('ai-output').innerHTML = html; }

  async function runAi(action, question) {
    if (MAP_LEVEL_AI.indexOf(action) === -1 && !selectedId) {
      aiOut('<p class="kg-muted">Select a node first.</p>');
      return;
    }
    aiOut('<p class="kg-muted">Working…</p>');
    try {
      var res = await fetch('/api/knowledge/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, mapId: mapId, nodeId: selectedId, question: question })
      });
      var body = await readJson(res);
      renderAi(body.result, action);
    } catch (err) {
      aiOut('<p class="kg-muted">Assistant unavailable: ' + esc(err.message) + '</p>');
    }
  }

  function renderAi(result, action) {
    if (!result) { aiOut('<p class="kg-muted">Nothing usable came back.</p>'); return; }
    var html = '';
    if (result.title) html += '<h3>' + esc(result.title) + '</h3>';
    if (result.summary) html += '<p>' + esc(result.summary) + '</p>';

    if (action === 'draft_summary') {
      if (result.aliases && result.aliases.length) {
        html += '<h3>Suggested aliases</h3><ul>' +
          result.aliases.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' +
          '<button type="button" class="kg-btn kg-btn-sm" id="apply-suggestion">Apply to the form</button>';
      }
      if (result.gaps && result.gaps.length) {
        html += '<h3>Missing before this is useful</h3><ul>' +
          result.gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>';
      }
    }

    (result.sections || []).forEach(function (sec) {
      if (sec.heading) html += '<h3>' + esc(sec.heading) + '</h3>';
      if (sec.text) html += '<p>' + esc(sec.text) + '</p>';
      if (sec.items && sec.items.length) {
        html += '<ul>' + sec.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
      }
    });

    if (action === 'suggest_lanes' && result.lanes && result.lanes.length) {
      html += '<h3>Proposed lanes</h3><ol>' + result.lanes.map(function (l) {
        return '<li><strong>' + esc(l.label) + '</strong>' +
          (l.reason ? ' — ' + esc(l.reason) : '') +
          ((l.nodes || []).length
            ? '<br><span class="kg-muted">' + esc(l.nodes.join(', ')) + '</span>'
            : '<br><span class="kg-muted">No existing nodes placed here.</span>') + '</li>';
      }).join('') + '</ol>' +
      '<button type="button" class="kg-btn kg-btn-primary kg-btn-sm" id="apply-lanes">Apply these lanes</button>' +
      '<p class="kg-muted" style="margin-top:var(--space-2)">Replaces the current lanes and moves ' +
      'unapproved nodes into them. Approved nodes stay where they are.</p>';
    }

    aiOut(html + '<p class="kg-ai-caveat">A draft. It is not saved to the node and it is not approved ' +
      'until you edit, save and approve it yourself.</p>');

    var applyLanes = $('apply-lanes');
    if (applyLanes) {
      applyLanes.addEventListener('click', function () {
        applyLanes.disabled = true;
        applySuggestedLanes(result.lanes);
      });
    }

    var apply = $('apply-suggestion');
    if (apply) {
      apply.addEventListener('click', function () {
        if (result.summary && !$('f-summary').value.trim()) $('f-summary').value = result.summary;
        if (result.aliases && result.aliases.length) {
          var existing = csvToList($('f-aliases').value);
          result.aliases.forEach(function (a) {
            if (existing.map(function (e) { return e.toLowerCase(); }).indexOf(a.toLowerCase()) === -1) {
              existing.push(a);
            }
          });
          $('f-aliases').value = existing.join(', ');
        }
        setStatus('Applied to the form — review it, then Save.');
      });
    }
  }

  /* ── Node sheet ────────────────────────────────────────────────────
     Docked rail on a wide screen, full cover on a phone. Same DOM either
     way — the difference is entirely CSS, so there is one editing
     surface to keep working rather than two.
     ---------------------------------------------------------------- */

  function openSheet(tab) {
    sheetOpen = true;
    document.body.classList.add('kg-sheet-open');
    $('node-sheet').classList.add('is-open');
    $('scrim').hidden = false;
    if (tab) switchSheetTab(tab);
    renderInspector();
  }

  function closeSheet() {
    if (noteDirty) saveNotes();
    sheetOpen = false;
    document.body.classList.remove('kg-sheet-open');
    $('node-sheet').classList.remove('is-open', 'is-full');
    $('sheet-full').setAttribute('aria-pressed', 'false');
    $('scrim').hidden = true;
  }

  function switchSheetTab(name) {
    sheetTab = name;
    var hasNode = !!nodeById(selectedId);

    // Details and Notes describe a node, so they need one. The AI tab is
    // where you ask about the map as a whole — making it wait for a node
    // selection is what put the question box out of reach.
    document.querySelectorAll('.kg-tabpane').forEach(function (pane) {
      var paneName = pane.getAttribute('data-pane');
      var needsNode = paneName !== 'ai';
      pane.hidden = !(paneName === name && (hasNode || !needsNode));
    });
    $('inspector-empty').hidden = hasNode || name === 'ai';

    // Node-specific assistant buttons go quiet when nothing is selected,
    // rather than the whole pane disappearing.
    document.querySelectorAll('[data-ai]').forEach(function (b) {
      var mapLevel = MAP_LEVEL_AI.indexOf(b.getAttribute('data-ai')) !== -1;
      b.disabled = !mapLevel && !hasNode;
    });
    var nodeHint = $('ai-node-hint');
    if (nodeHint) nodeHint.hidden = hasNode;

    // Header reads sensibly with nothing selected.
    if (!hasNode) {
      $('sheet-dot').style.background = 'var(--color-text-muted)';
      $('sheet-kind').textContent = 'Whole map';
      $('sheet-title').textContent = mapInfo ? mapInfo.title : 'Map';
    }

    document.querySelectorAll('.kg-sheet-tabs .kg-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  /* ── Notes ─────────────────────────────────────────────────────────
     Rich text the user reads on their phone. Saved on its own endpoint
     path (notesOnly) so it never bumps the node version or drops the
     node out of the retrieval index.
     ---------------------------------------------------------------- */

  function setReading(on) {
    noteReading = on;
    var pane = $('node-sheet');
    pane.classList.toggle('is-reading', on);
    $('note-editor').contentEditable = on ? 'false' : 'true';
    $('note-read').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('note-read').textContent = on ? 'Edit notes' : 'Reading mode';
  }

  function updateNoteCount() {
    var text = ($('note-editor').innerText || '').trim();
    var words = text ? text.split(/\s+/).length : 0;
    $('note-count').textContent = words + (words === 1 ? ' word' : ' words');
  }

  function scheduleNoteSave() {
    noteDirty = true;
    $('note-saved').textContent = 'unsaved';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNotes, 1200);
  }

  async function saveNotes() {
    var node = nodeById(selectedId);
    if (!node || !noteDirty) return;
    if (!canEdit()) { $('note-saved').textContent = 'read only'; noteDirty = false; return; }

    var html = $('note-editor').innerHTML;
    node.notes = html;
    noteDirty = false;
    $('note-saved').textContent = 'saving…';

    try {
      await readJson(await fetch('/api/knowledge/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'node', mapId: mapId, id: node.id,
          notesOnly: true, notes: html, aiOpen: $('ai-open').checked ? 1 : 0
        })
      }));
      $('note-saved').textContent = 'saved';
      renderNodes();
    } catch (err) {
      noteDirty = true;
      $('note-saved').textContent = 'not saved — ' + err.message;
    }
  }

  function noteCmd(cmd, value) {
    if (noteReading) return;
    $('note-editor').focus();
    document.execCommand(cmd, false, value || null);
    scheduleNoteSave();
  }

  function noteBlock(tag) {
    if (noteReading) return;
    $('note-editor').focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var el = document.createElement(tag);
    if (tag === 'pre') el.textContent = 'code';
    else if (tag === 'blockquote') el.textContent = 'Quote';
    else el.innerHTML = '<br>';
    var range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(el);
    var after = document.createRange();
    after.selectNodeContents(el);
    after.collapse(false);
    sel.removeAllRanges();
    sel.addRange(after);
    scheduleNoteSave();
  }

  /* ── Full screen ───────────────────────────────────────────────────
     A CSS class rather than the Fullscreen API. iOS Safari will not put
     a div into real fullscreen, and this is the case that matters most —
     a phone is exactly where the canvas is too small.
     ---------------------------------------------------------------- */

  function toggleMapFull(force) {
    var on = force === undefined ? !document.body.classList.contains('kg-map-full') : force;
    document.body.classList.toggle('kg-map-full', on);
    $('full-toggle').setAttribute('aria-pressed', on ? 'true' : 'false');
    // The canvas box changes size, so the view has to be re-derived.
    setTimeout(function () { fit(); renderNodes(); }, 60);
  }

  /* ── Canvas interaction ────────────────────────────────────────── */

  function centre() {
    var r = svg.getBoundingClientRect();
    return { x: (r.width / 2 - view.x) / view.k, y: (r.height / 2 - view.y) / view.k };
  }

  function toScene(cx, cy) {
    var r = svg.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }

  function fit() {
    if (!nodes.length) { view = { x: 0, y: 0, k: 1 }; return; }
    var r = svg.getBoundingClientRect();
    var xs = [], ys = [];
    nodes.forEach(function (n) { xs.push(n.x - 130, n.x + 130); ys.push(n.y - 90, n.y + 90); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys) - 60, maxY = Math.max.apply(null, ys);
    view.k = Math.max(0.12, Math.min((r.width - 80) / (maxX - minX || 1), (r.height - 80) / (maxY - minY || 1), 1.2));
    view.x = r.width / 2 - ((minX + maxX) / 2) * view.k;
    view.y = r.height / 2 - ((minY + maxY) / 2) * view.k;
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
  }

  function zoomAt(mx, my, factor) {
    var k = Math.max(0.12, Math.min(2.5, view.k * factor));
    var real = k / view.k;
    view.x = mx - (mx - view.x) * real;
    view.y = my - (my - view.y) * real;
    view.k = k;
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
  }

  /* ── Pinch to zoom ─────────────────────────────────────────────────
     The canvas sets `touch-action: none`, which is what makes one-finger
     dragging work — but it also switches off the browser's own pinch
     zoom, so the gesture has to be implemented rather than inherited.

     Two fingers do zoom and pan together, which is what the hand expects:
     the scene point under the midpoint of the two fingers stays under it,
     whether they spread apart or slide across.
     ---------------------------------------------------------------- */

  function twoPointers() {
    var it = pointers.values();
    return [it.next().value, it.next().value];
  }

  function pinchGeometry() {
    var p = twoPointers();
    var r = svg.getBoundingClientRect();
    return {
      dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
      // Midpoint in canvas-local coordinates, matching what zoomAt expects.
      mx: (p[0].x + p[1].x) / 2 - r.left,
      my: (p[0].y + p[1].y) / 2 - r.top
    };
  }

  function startPinch() {
    var g = pinchGeometry();
    if (!g.dist) return;

    // Whatever one finger had started is abandoned: a node half-dragged into
    // a pinch should stay where it is, not keep following finger one.
    if (dragging && dragging.moved) setStatus('Moved. Press Save to keep the position.');
    dragging = null;
    panning = null;
    linking = null;
    gOverlay.innerHTML = '';
    svg.classList.remove('is-panning');

    pinch = {
      dist: g.dist,
      k: view.k,
      // The scene coordinate sitting under the midpoint when the gesture began.
      // Holding this still is what makes the zoom feel anchored to the fingers.
      sx: (g.mx - view.x) / view.k,
      sy: (g.my - view.y) / view.k
    };
    suppressTap = true;
  }

  function movePinch() {
    if (!pinch || pointers.size < 2) return;
    var g = pinchGeometry();
    if (!g.dist) return;

    var k = Math.max(0.12, Math.min(2.5, pinch.k * (g.dist / pinch.dist)));
    view.k = k;
    view.x = g.mx - pinch.sx * k;
    view.y = g.my - pinch.sy * k;
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
  }

  function endPinch() {
    pinch = null;
    // Lifting one finger of a pinch leaves the other one down. Without this,
    // that leftover finger would immediately start panning from a stale
    // origin and the map would jump.
    pointers.forEach(function (p) { p.stale = true; });
  }

  /* Mobile browsers do occasionally drop a pointerup — a finger leaves during
     a scroll takeover, or the app is backgrounded mid-gesture. A ghost pointer
     that never clears would make every later single touch look like a pinch,
     and the map would stay jammed until reload. Anything that has not been
     heard from in five seconds is treated as gone. */
  function evictGhostPointers() {
    var now = Date.now();
    pointers.forEach(function (p, id) {
      if (now - p.at > 5000) pointers.delete(id);
    });
    if (pointers.size < 2 && pinch) endPinch();
  }

  function onDown(ev) {
    var t = ev.target;
    evictGhostPointers();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, at: Date.now() });

    // A fresh single-finger gesture resets anything left over.
    if (pointers.size === 1) { suppressTap = false; pinch = null; }

    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;   // a third finger is noise; ignore it
    var handle = t.closest('[data-handle]');
    if (handle && canEdit()) {
      linking = { fromId: handle.getAttribute('data-handle') };
      svg.setPointerCapture(ev.pointerId);
      return;
    }
    var g = t.closest('[data-node-id]');
    if (g) {
      var id = g.getAttribute('data-node-id'), n = nodeById(id);
      if (!n) return;
      selectedId = id;
      var p = toScene(ev.clientX, ev.clientY);
      // `moved` is what separates a tap from a drag. A tap focuses; a drag
      // repositions and must not also trigger focus on release.
      dragging = { id: id, dx: p.x - n.x, dy: p.y - n.y, moved: false, canMove: canEdit() };
      svg.setPointerCapture(ev.pointerId);
      renderNodes();
      renderInspector();
      return;
    }
    var e = t.closest('[data-edge-id]');
    if (e) { if (canEdit()) editEdge(e.getAttribute('data-edge-id')); return; }

    selectedId = null;
    if (focusId) clearFocus();
    panning = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    svg.classList.add('is-panning');
    svg.setPointerCapture(ev.pointerId);
    render();
  }

  function onMove(ev) {
    var tracked = pointers.get(ev.pointerId);
    if (tracked) { tracked.x = ev.clientX; tracked.y = ev.clientY; tracked.at = Date.now(); }

    if (pinch) { movePinch(); return; }
    if (tracked && tracked.stale) return;   // leftover finger from a pinch

    if (dragging) {
      var n = nodeById(dragging.id);
      if (!n) return;
      var p = toScene(ev.clientX, ev.clientY);
      var dx = Math.abs((p.x - dragging.dx) - n.x);
      var dy = Math.abs((p.y - dragging.dy) - n.y);
      // A few pixels of thumb wobble is still a tap, not a drag.
      if (!dragging.moved && dx < 4 && dy < 4) return;
      if (!dragging.canMove) return;
      n.x = Math.round(p.x - dragging.dx);
      n.y = Math.round(p.y - dragging.dy);
      dragging.moved = true;
      renderEdges(); renderNodes();
      return;
    }
    if (linking) {
      var q = toScene(ev.clientX, ev.clientY);
      var from = nodeById(linking.fromId);
      if (!from) return;
      var s = borderPoint(from, q.x, q.y);
      gOverlay.innerHTML = '<path d="M' + s.x + ' ' + s.y + ' L' + q.x + ' ' + q.y +
        '" style="stroke:var(--color-primary);stroke-width:2;stroke-dasharray:5 4;fill:none"></path>';
      return;
    }
    if (panning) {
      view.x = panning.vx + (ev.clientX - panning.x);
      view.y = panning.vy + (ev.clientY - panning.y);
      scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    }
  }

  function onUp(ev) {
    pointers.delete(ev.pointerId);

    if (pinch) {
      if (pointers.size < 2) endPinch();
      return;
    }

    // The tail of a pinch: fingers lifting one by one must not register as
    // taps. The flag clears once the last one is off the glass.
    if (suppressTap) {
      if (pointers.size === 0) suppressTap = false;
      dragging = null; panning = null;
      svg.classList.remove('is-panning');
      return;
    }

    if (linking) {
      var el = document.elementFromPoint(ev.clientX, ev.clientY);
      var g = el && el.closest ? el.closest('[data-node-id]') : null;
      gOverlay.innerHTML = '';
      if (g) openConnect(linking.fromId, g.getAttribute('data-node-id'));
      linking = null;
    }
    if (dragging) {
      if (dragging.moved) {
        setStatus('Moved. Press Save to keep the position.');
      } else {
        // A clean tap. Second tap on the same node within 400ms opens it;
        // one tap spotlights it. Handled here rather than with a dblclick
        // listener because touch browsers do not fire dblclick reliably.
        var now = Date.now();
        var isDouble = lastTap.id === dragging.id && (now - lastTap.at) < 400;
        lastTap = { id: dragging.id, at: now };

        if (isDouble) {
          lastTap = { id: null, at: 0 };
          openSheet('details');
        } else if (focusId === dragging.id) {
          clearFocus();          // tapping the focused node again releases it
        } else {
          setFocus(dragging.id);
        }
      }
    }
    dragging = null; panning = null;
    svg.classList.remove('is-panning');
    render();
  }

  /* ── Controls ──────────────────────────────────────────────────── */

  function buildControls() {
    $('palette').innerHTML = Object.keys(pack.nodeKinds).map(function (k) {
      var def = pack.nodeKinds[k];
      return '<button type="button" class="kg-chip" data-add="' + k + '" title="' + esc(def.hint || '') + '">' +
        '<svg class="kg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' +
        (ICONS[def.icon] || ICONS.note) + '"/></svg>' + esc(def.label) + '</button>';
    }).join('');

    // Same kinds as the palette, laid out as big tap targets for the
    // + button. The palette row is fine with a mouse and hopeless with a thumb.
    $('kind-grid').innerHTML = Object.keys(pack.nodeKinds).map(function (k) {
      var def = pack.nodeKinds[k];
      return '<button type="button" class="kg-kind-card" data-add="' + k + '">' +
        '<svg class="kg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' +
        (ICONS[def.icon] || ICONS.note) + '"/></svg>' +
        '<span class="kg-kind-name">' + esc(def.label) + '</span>' +
        '<span class="kg-kind-hint">' + esc(def.hint || '') + '</span></button>';
    }).join('');

    $('f-kind').innerHTML = Object.keys(pack.nodeKinds).map(function (k) {
      return '<option value="' + k + '">' + esc(pack.nodeKinds[k].label) + '</option>';
    }).join('');

    $('f-lane').innerHTML = '<option value="">No lane</option>' + lanes.map(function (l) {
      return '<option value="' + l.id + '">' + esc(l.label) + '</option>';
    }).join('');

    $('c-relation').innerHTML = Object.keys(pack.relations).map(function (r) {
      return '<option value="' + r + '">' + esc(pack.relations[r].label) + '</option>';
    }).join('');

    $('legend').innerHTML = lanes.map(function (l) {
      return '<span class="kg-legend-item"><span class="kg-legend-dot" style="background:var(' + l.token +
        ')"></span>' + esc(l.label) + '</span>';
    }).join('') + '<span class="kg-legend-item"><span class="kg-legend-dot" style="border:2px dashed var(--color-text-muted);background:none"></span>Dashed outline = not yet approved</span>';
  }

  function switchView(name) {
    ['map', 'outline', 'health'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    // Scoped to the view switcher: the sheet has its own .kg-seg-btn tabs and
    // an unscoped query would clear their active state on every view change.
    document.querySelectorAll('#map-controls .kg-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('view-map').hidden = name !== 'map';
    if (name === 'map') fit();
  }

  function bind() {
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);

    // Backstop. If a finger lifts somewhere the SVG never hears about — over
    // the sheet, off the edge of the screen, during a system gesture — the
    // pointer still has to come out of the tracker.
    window.addEventListener('pointerup', function (ev) {
      if (pointers.has(ev.pointerId)) onUp(ev);
    });
    window.addEventListener('pointercancel', function (ev) {
      if (pointers.has(ev.pointerId)) onUp(ev);
    });
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var r = svg.getBoundingClientRect();
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (ev.target.isContentEditable) return;

      // Works with nothing selected — asking about the map is not a
      // node-level action.
      if (ev.key === '/' || ev.key === '?') {
        ev.preventDefault();
        openSheet('ai');
        $('question').focus();
        return;
      }
      if (!selectedId) return;
      var n = nodeById(selectedId);
      if (!n) return;
      var step = ev.shiftKey ? 40 : 10;
      if (ev.key === 'Enter') { ev.preventDefault(); openSheet('details'); $('f-title').focus(); }
      else if (ev.key === 'n' || ev.key === 'N') { ev.preventDefault(); openSheet('notes'); }
      else if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); setFocus(selectedId); }
      else if (ev.key === 'Escape') { selectedId = null; render(); }
      else if (ev.key.indexOf('Arrow') === 0 && canEdit()) {
        ev.preventDefault();
        if (ev.key === 'ArrowUp') n.y -= step;
        if (ev.key === 'ArrowDown') n.y += step;
        if (ev.key === 'ArrowLeft') n.x -= step;
        if (ev.key === 'ArrowRight') n.x += step;
        renderEdges(); renderNodes();
      }
    });

    $('palette').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-add]');
      if (b && canEdit()) addNode(b.getAttribute('data-add'));
    });

    $('outline').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-goto]');
      if (!b) return;
      selectedId = b.getAttribute('data-goto');
      switchView('map');
      render();
    });

    $('f-attributes').addEventListener('input', function (ev) {
      var i = ev.target.getAttribute('data-i');
      var field = ev.target.getAttribute('data-attr');
      if (i === null || !field) return;
      attrRows[Number(i)] = attrRows[Number(i)] || {};
      attrRows[Number(i)][field] = ev.target.value;
    });

    $('f-attributes').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-remove-attr]');
      if (!b) return;
      attrRows.splice(Number(b.getAttribute('data-remove-attr')), 1);
      renderAttrs();
    });

    $('add-attr').addEventListener('click', function () {
      attrRows.push({ name: '', value: '', unit: '', basis: '' });
      renderAttrs();
    });

    $('save-node').addEventListener('click', saveNode);
    $('approve-node').addEventListener('click', function () { setNodeStatus('approved'); });
    $('reject-node').addEventListener('click', function () { setNodeStatus('rejected'); });
    $('delete-node').addEventListener('click', deleteNode);
    $('connect-node').addEventListener('click', function () { if (selectedId) openConnect(selectedId, null); });

    $('c-save').addEventListener('click', saveEdge);
    $('c-cancel').addEventListener('click', function () { $('connect-dialog').close(); });
    $('c-delete').addEventListener('click', async function () {
      if (!editingEdgeId) return;
      await fetch('/api/knowledge/graph?type=edge&id=' + encodeURIComponent(editingEdgeId) +
        '&map=' + encodeURIComponent(mapId), { method: 'DELETE' });
      $('connect-dialog').close();
      await reload();
    });

    /* Ask AI. Two entry points because the controls bar is hidden in full
       screen, which is exactly where someone is most likely to want to ask
       something about what they are looking at. */
    function openAssistant() { openSheet('ai'); $('question').focus(); }
    $('ask-ai-open').addEventListener('click', openAssistant);
    $('ask-ai-canvas').addEventListener('click', openAssistant);

    /* Focus bar */
    $('focus-exit').addEventListener('click', clearFocus);
    $('focus-open').addEventListener('click', function () {
      if (focusId) { selectedId = focusId; openSheet('details'); }
    });

    /* Sheet */
    $('sheet-close').addEventListener('click', closeSheet);
    $('scrim').addEventListener('click', closeSheet);
    $('sheet-full').addEventListener('click', function () {
      var on = !$('node-sheet').classList.contains('is-full');
      $('node-sheet').classList.toggle('is-full', on);
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('.kg-sheet-tabs .kg-seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchSheetTab(b.getAttribute('data-tab')); });
    });

    /* Notes */
    var editor = $('note-editor');
    editor.addEventListener('input', function () { updateNoteCount(); scheduleNoteSave(); });
    editor.addEventListener('blur', function () { if (noteDirty) saveNotes(); });
    $('note-read').addEventListener('click', function () { setReading(!noteReading); });
    $('note-toolbar').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cmd],[data-blk]');
      if (!b) return;
      ev.preventDefault();
      if (b.getAttribute('data-blk')) noteBlock(b.getAttribute('data-blk'));
      else noteCmd(b.getAttribute('data-cmd'));
    });
    $('note-hl').addEventListener('click', function () { noteCmd('hiliteColor', '#ffe89b'); });

    /* Paste as plain text. Pasting a styled block from a web page otherwise
       drags its whole stylesheet in and the note stops matching the site. */
    editor.addEventListener('paste', function (ev) {
      ev.preventDefault();
      var text = (ev.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    /* AI lock */
    $('ai-open').addEventListener('change', function () {
      updateAiOpenHint();
      noteDirty = true;
      saveNotes();
    });

    /* Full screen map */
    $('full-toggle').addEventListener('click', function () { toggleMapFull(); });
    $('fit-full').addEventListener('click', fit);

    /* Add button — the primary path on a phone */
    $('fab-add').addEventListener('click', function () {
      if (!canEdit()) { setStatus('You have read-only access to this map.'); return; }
      $('kind-dialog').showModal();
    });
    $('kind-cancel').addEventListener('click', function () { $('kind-dialog').close(); });
    $('kind-grid').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-add]');
      if (!b) return;
      $('kind-dialog').close();
      addNode(b.getAttribute('data-add'));
    });

    $('tidy').addEventListener('click', function () { layoutByLane(); render(); fit(); });
    $('fit').addEventListener('click', fit);

    $('lanes-edit').addEventListener('click', function () {
      if (!canEdit()) { setStatus('You need contributor access to change lanes.'); return; }
      openLaneEditor();
    });
    $('lane-add').addEventListener('click', function () { addLane($('lane-new').value); });
    $('lane-new').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); addLane(ev.target.value); }
    });
    $('lanes-save').addEventListener('click', saveLanes);
    $('lanes-cancel').addEventListener('click', function () { $('lanes-dialog').close(); });

    $('lane-list').addEventListener('input', function (ev) {
      var i = ev.target.getAttribute('data-lane-label');
      if (i !== null) laneDraft[Number(i)].label = ev.target.value;
    });
    $('lane-list').addEventListener('click', function (ev) {
      var up = ev.target.closest('[data-lane-up]');
      var down = ev.target.closest('[data-lane-down]');
      var del = ev.target.closest('[data-lane-del]');
      var i;
      if (up) { i = Number(up.getAttribute('data-lane-up'));
        laneDraft.splice(i - 1, 0, laneDraft.splice(i, 1)[0]); renderLaneEditor(); }
      else if (down) { i = Number(down.getAttribute('data-lane-down'));
        laneDraft.splice(i + 1, 0, laneDraft.splice(i, 1)[0]); renderLaneEditor(); }
      else if (del) { i = Number(del.getAttribute('data-lane-del'));
        if (laneNodeCount(laneDraft[i].id)) {
          $('lane-note').textContent = 'That lane still holds nodes. Move them out first.';
          return;
        }
        laneDraft.splice(i, 1); renderLaneEditor(); }
    });
    $('zoom-in').addEventListener('click', function () {
      var r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2);
    });
    $('zoom-out').addEventListener('click', function () {
      var r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2);
    });

    $('search').addEventListener('input', function (ev) {
      filterText = ev.target.value.trim().toLowerCase();
      renderNodes();
    });

    $('status-filter').addEventListener('change', function (ev) {
      statusFilter = ev.target.value;
      render();
    });

    // Scoped to the controls bar. Unscoped, the sheet's Details/Notes/AI tabs
    // would also call switchView(null) and hide every view.
    document.querySelectorAll('#map-controls .kg-seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });

    document.querySelectorAll('[data-ai]').forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true;
        await runAi(b.getAttribute('data-ai'));
        b.disabled = false;
      });
    });

    $('ask').addEventListener('click', function () {
      var q = $('question').value.trim();
      if (q) runAi('answer_question', q);
    });
    $('question').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); $('ask').click(); }
    });
  }

  function init() {
    svg = $('canvas'); scene = $('scene');
    gLanes = $('lanes'); gEdges = $('edges');
    gNodes = $('nodes'); gOverlay = $('overlay'); defs = $('defs');
    renderDefs();
    bind();
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
