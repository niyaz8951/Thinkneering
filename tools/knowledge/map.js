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
  var mapInfo = null;
  var role = 'viewer';
  var nodes = [], edges = [];
  var selectedId = null, editingEdgeId = null, connectFrom = null;
  var filterText = '', statusFilter = 'all';
  var view = { x: 0, y: 0, k: 1 };
  var dragging = null, panning = null, linking = null;
  var attrRows = [];

  var svg, scene, gLanes, gEdges, gNodes, gOverlay, defs;

  /* ── Helpers ───────────────────────────────────────────────────── */

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
    for (var i = 0; i < pack.lanes.length; i++) if (pack.lanes[i].id === id) return pack.lanes[i];
    return null;
  }

  function laneIndex(id) {
    if (!pack) return 0;
    for (var i = 0; i < pack.lanes.length; i++) if (pack.lanes[i].id === id) return i;
    return pack.lanes.length;
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
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);

      mapInfo = body.map;
      role = body.role;
      nodes = body.nodes;
      edges = body.edges;

      pack = mapInfo.domain === 'business' ? window.TN_KG_BUSINESS : window.TN_KG_HVAC;

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

  function tidy() {
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
    if (!pack || !nodes.length) { gLanes.innerHTML = ''; return; }
    var maxY = Math.max.apply(null, nodes.map(function (n) { return n.y; }).concat([400]));
    gLanes.innerHTML = pack.lanes.map(function (lane, i) {
      var left = laneLeft(i);
      return '<rect x="' + left + '" y="' + (LANE_TOP - 46) + '" width="' + LANE_W + '" height="' +
        (maxY + 160) + '" rx="16" style="fill:var(' + lane.token + ');opacity:.05"></rect>' +
        '<rect x="' + left + '" y="' + (LANE_TOP - 46) + '" width="' + LANE_W + '" height="30" rx="10" ' +
        'style="fill:var(' + lane.token + ');opacity:.14"></rect>' +
        '<text class="kg-lane-label" style="fill:var(' + lane.token + ')" x="' + (left + 14) + '" y="' +
        (LANE_TOP - 26) + '">' + esc(lane.label.toUpperCase()) + '</text>';
    }).join('');
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
        (matches(node) ? '' : ' is-dimmed') +
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

      var style = 'stroke:var(' + tok + ')' + (def.dash ? ';stroke-dasharray:' + def.dash : '') +
        (edge.status === 'approved' ? '' : ';opacity:.5');

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
    pack.lanes.concat([{ id: '', label: 'Unassigned', token: '--color-text-muted' }]).forEach(function (lane) {
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
    $('inspector-empty').hidden = !!node;
    $('node-form').hidden = !node;
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
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);

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
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
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
    var lane = selectedId && nodeById(selectedId) ? nodeById(selectedId).lane : (pack.lanes[0] || {}).id;
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
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      await reload();
      selectedId = body.id;
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
    var body = await res.json();
    if (!res.ok) return;
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
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      $('connect-dialog').close();
      await reload();
      setStatus('Connection saved.');
    } catch (err) { setStatus('Failed: ' + err.message); }
  }

  /* ── AI ────────────────────────────────────────────────────────── */

  function aiOut(html) { $('ai-output').innerHTML = html; }

  async function runAi(action, question) {
    if (action !== 'review_map' && action !== 'find_duplicates' && !selectedId) {
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
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
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

    aiOut(html + '<p class="kg-ai-caveat">A draft. It is not saved to the node and it is not approved ' +
      'until you edit, save and approve it yourself.</p>');

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

  function onDown(ev) {
    var t = ev.target;
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
      if (canEdit()) dragging = { id: id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
      svg.setPointerCapture(ev.pointerId);
      render();
      return;
    }
    var e = t.closest('[data-edge-id]');
    if (e) { if (canEdit()) editEdge(e.getAttribute('data-edge-id')); return; }

    selectedId = null;
    panning = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    svg.classList.add('is-panning');
    svg.setPointerCapture(ev.pointerId);
    render();
  }

  function onMove(ev) {
    if (dragging) {
      var n = nodeById(dragging.id);
      if (!n) return;
      var p = toScene(ev.clientX, ev.clientY);
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
    if (linking) {
      var el = document.elementFromPoint(ev.clientX, ev.clientY);
      var g = el && el.closest ? el.closest('[data-node-id]') : null;
      gOverlay.innerHTML = '';
      if (g) openConnect(linking.fromId, g.getAttribute('data-node-id'));
      linking = null;
    }
    if (dragging && dragging.moved) setStatus('Moved. Press Save to keep the position.');
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

    $('f-kind').innerHTML = Object.keys(pack.nodeKinds).map(function (k) {
      return '<option value="' + k + '">' + esc(pack.nodeKinds[k].label) + '</option>';
    }).join('');

    $('f-lane').innerHTML = pack.lanes.map(function (l) {
      return '<option value="' + l.id + '">' + esc(l.label) + '</option>';
    }).join('');

    $('c-relation').innerHTML = Object.keys(pack.relations).map(function (r) {
      return '<option value="' + r + '">' + esc(pack.relations[r].label) + '</option>';
    }).join('');

    $('legend').innerHTML = pack.lanes.map(function (l) {
      return '<span class="kg-legend-item"><span class="kg-legend-dot" style="background:var(' + l.token +
        ')"></span>' + esc(l.label) + '</span>';
    }).join('') + '<span class="kg-legend-item"><span class="kg-legend-dot" style="border:2px dashed var(--color-text-muted);background:none"></span>Dashed outline = not yet approved</span>';
  }

  function switchView(name) {
    ['map', 'outline', 'health'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.kg-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'map') fit();
  }

  function bind() {
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var r = svg.getBoundingClientRect();
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (!selectedId) return;
      var n = nodeById(selectedId);
      if (!n) return;
      var step = ev.shiftKey ? 40 : 10;
      if (ev.key === 'Enter') { ev.preventDefault(); $('f-title').focus(); }
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

    $('tidy').addEventListener('click', tidy);
    $('fit').addEventListener('click', fit);
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

    document.querySelectorAll('.kg-seg-btn').forEach(function (b) {
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
