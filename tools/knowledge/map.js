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
                      'summarise_nodes'];

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
  // The legality matrix, fetched from the server. The database enforces it
  // with a trigger; this copy exists so the connect dialog can refuse an
  // illegal pairing before the user fills the rest of the form in.
  var graphTypes = { kinds: [], legal: {}, scopes: [] };

  /* node id -> number of open actions. Outline is where you scan for what
     needs doing, and a list that cannot show that is just the graph with the
     pictures removed. Loaded once per map; a failure leaves it empty and the
     counts simply do not appear. */
  var openActionsBy = {};

  /* Which of the three views is showing. Outline and Graph are two ways of
     working on the same graph, not a list and a picture of it, so several
     behaviours need to know which one you are in. */
  var currentView = 'map';

  function legalRelations(fromKind, toKind) {
    var byTo = graphTypes.legal[fromKind];
    return (byTo && byTo[toKind]) ? byTo[toKind] : [];
  }

  function packFor(domain) {
    if (domain === 'sbu') return window.TN_KG_SBU;
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

      // Types are a separate call so a graph that loads before the typed
      // migration has run still opens; the connect dialog falls back to the
      // pack's relation list and the server remains the real gate.
      try {
        var tRes = await fetch('/api/knowledge/types');
        var tBody = await readJson(tRes);
        if (tBody && tBody.ok) graphTypes = tBody;
      } catch (e) { /* leave graphTypes empty */ }

      await loadOpenActionCounts();

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
      // Needs pack and edges, so it cannot run from init().
      fillSpineOptions();
      renderHealth(body.score, body.findings);
      render();
      fit();
      // Open where the person last was on this map. First time, a phone
      // opens in the outline — it is the editing surface a thumb can use —
      // and a desktop opens on the canvas.
      var remembered = null;
      try { remembered = localStorage.getItem('tn-kg-view:' + mapId); } catch (e) {}
      var phone = window.matchMedia('(max-width: 700px)').matches;
      var first = remembered || (phone && nodes.length ? 'outline' : 'map');
      if (first !== 'map' && $('view-' + first)) switchView(first);
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

  /* ── Facet grid ────────────────────────────────────────────────────
     Lanes were one categorical attribute drawn as columns, with nodes
     stacked inside. That is a grouping, not a plot: swapping the vertical
     axis for "a different set of nodes" would change nothing, because the
     nodes were never the axis.

     A second axis has to be a second *attribute*. Pick one for columns and
     one for rows and every node lands in a cell. lane x kind is the one
     this is tuned for; stage x status and scope x kind fall out for free.

     Positions here are DERIVED. They are computed on every render and never
     written back, because a node that has four sets of coordinates — one
     per grid you last looked at — has none. The hand-placed layout is kept
     intact underneath and restored when you leave.
     ---------------------------------------------------------------- */

  var grid = { cols: 'lane', rows: null };   // rows: null = the classic lane view

  /* ── Hierarchy ─────────────────────────────────────────────────────
     A tree as a LAYOUT, never as the model. The graph is genuinely
     many-to-many — a cooling coil is contained by an AHU, governed by a
     clause, required by a requirement and specialised in by an engineer —
     and forcing that into one parent means demoting the other relations to
     cross-links nobody looks at. What happens next is that people duplicate
     nodes to keep the tree tidy, and two cooling coils end up carrying
     different U-values. The alias-uniqueness work exists to stop exactly
     that, so the model stays a graph.

     What a tree is very good at is reading: pick one relation as the spine,
     lay it out by depth, collapse what you are not looking at. Derived and
     thrown away, like the grid.
     ---------------------------------------------------------------- */

  var tree = { spine: null };
  var collapsed = {};          // node id -> true, while its children are folded

  function treeOn() { return !!tree.spine; }

  /* Either layout computes positions instead of reading the stored ones. */
  function derivedLayout() { return gridOn() || treeOn(); }

  /* Relations actually used by edges on this map, commonest first. Offering
     the pack's full list would put twenty relations in the picker, most of
     which would produce a forest of single nodes. */
  function spineCandidates() {
    var count = {};
    edges.forEach(function (e) { count[e.relation] = (count[e.relation] || 0) + 1; });
    return Object.keys(count)
      .filter(function (r) { return count[r] > 1; })
      .sort(function (a, b) { return count[b] - count[a]; });
  }

  /**
   * Build the forest.
   *
   * Parent is the `from` end of a spine edge. Three things a graph does that
   * a tree cannot, each handled rather than crashed on:
   *
   *   - A node with several parents is drawn under the first and marked. The
   *     alternative is drawing it once per parent, which is the duplication
   *     this whole design exists to avoid.
   *   - Cycles are real here: `feeds` loops when escalation feeds back into
   *     clarification, and `causes` and `supersedes` can too. A naive walk
   *     hangs. The walk carries its own path and stops at a repeat, leaving
   *     that node as a leaf marked as looping back.
   *   - Nodes with no spine edge at all are not roots of anything. They go in
   *     their own group at the end rather than making the forest look wider
   *     and shallower than it is.
   */
  function buildForest() {
    var spine = tree.spine;
    var childrenOf = {};
    var parentOf = {};
    var extraParents = {};
    var touched = {};

    edges.forEach(function (e) {
      if (e.relation !== spine) return;
      var from = nodeById(e.from), to = nodeById(e.to);
      if (!from || !to || !visibleByFilter(from) || !visibleByFilter(to)) return;
      touched[e.from] = true;
      touched[e.to] = true;
      if (parentOf[e.to] === undefined) {
        parentOf[e.to] = e.from;
        (childrenOf[e.from] = childrenOf[e.from] || []).push(e.to);
      } else {
        extraParents[e.to] = (extraParents[e.to] || 0) + 1;
      }
    });

    var roots = [];
    var loose = [];
    nodes.forEach(function (n) {
      if (!visibleByFilter(n)) return;
      if (!touched[n.id]) { loose.push(n.id); return; }
      if (parentOf[n.id] === undefined) roots.push(n.id);
    });

    // A cycle with no entry point leaves every node in it parented, so none
    // becomes a root and the whole ring would vanish. Adopt one.
    if (!roots.length && !loose.length) {
      var first = nodes.filter(function (n) { return touched[n.id]; })[0];
      if (first) roots.push(first.id);
    }

    return { childrenOf: childrenOf, parentOf: parentOf,
             extraParents: extraParents, roots: roots, loose: loose };
  }

  var forest = null;
  var treeMeta = {};           // node id -> { depth, extraParents, loops, kids }

  var TREE_COL_W = 268;
  var TREE_COL_GAP = 44;
  var TREE_ROW_H = 78;

  function applyTreeLayout() {
    forest = buildForest();
    treeMeta = {};

    nodes.forEach(function (n) {
      if (n._freeX === undefined) { n._freeX = n.x; n._freeY = n.y; }
    });

    var row = 0;

    function place(id, depth, path) {
      var n = nodeById(id);
      if (!n) return;

      var kids = (forest.childrenOf[id] || []);
      var loops = path[id] === true;

      treeMeta[id] = {
        depth: depth,
        extraParents: forest.extraParents[id] || 0,
        loops: loops,
        kids: kids.length
      };

      n.x = LANE_TOP + depth * (TREE_COL_W + TREE_COL_GAP) + TREE_COL_W / 2;
      n.y = LANE_TOP + 40 + row * TREE_ROW_H;
      row++;

      // Stop at a repeat rather than walking the cycle forever.
      if (loops || collapsed[id]) return;

      var next = Object.assign({}, path);
      next[id] = true;
      kids.forEach(function (kid) { place(kid, depth + 1, next); });
    }

    forest.roots.forEach(function (id) { place(id, 0, {}); });

    var looseTop = row;
    forest.loose.forEach(function (id) {
      var n = nodeById(id);
      if (!n) return;
      treeMeta[id] = { depth: 0, extraParents: 0, loops: false, kids: 0, loose: true };
      n.x = LANE_TOP + TREE_COL_W / 2;
      n.y = LANE_TOP + 40 + (row + 1) * TREE_ROW_H;
      row++;
    });

    return { rows: row, looseTop: looseTop, looseCount: forest.loose.length };
  }

  /* The status and search filters, without the collapse rule — the forest has
     to be built from everything the filters allow, or a collapsed parent would
     drop its children out of the tree entirely instead of folding them. */
  function visibleByFilter(node) {
    if (statusFilter === 'approved' && node.status !== 'approved') return false;
    if (statusFilter === 'pending' && node.status === 'approved') return false;
    return true;
  }

  /* Is this node inside something that is folded shut? */
  function hiddenByCollapse(id) {
    if (!treeOn() || !forest) return false;
    var guard = 0;
    var cur = forest.parentOf[id];
    while (cur !== undefined && guard++ < 200) {
      if (collapsed[cur]) return true;
      cur = forest.parentOf[cur];
    }
    return false;
  }


  var FACETS = {
    lane:   { label: 'Lane',   of: function (n) { return n.lane || ''; } },
    kind:   { label: 'Kind',   of: function (n) { return n.kind || ''; } },
    status: { label: 'Status', of: function (n) { return n.status || ''; } },
    scope:  { label: 'Scope',  of: function (n) { return n.scope || 'project'; } }
  };

  function gridOn() { return !!grid.rows; }

  function facetValue(n, facet) {
    var f = FACETS[facet];
    return f ? (f.of(n) || '\u2014') : '\u2014';
  }

  /* Values in a sensible order, not alphabetical. Lanes keep the order you
     arranged them in; kinds keep the order the palette lists them; status
     runs draft to approved because that is the direction work travels. */
  function facetValues(facet) {
    if (facet === 'lane') {
      var used = {};
      nodes.forEach(function (n) { used[n.lane || '\u2014'] = true; });
      var ordered = lanes.map(function (l) { return l.id; }).filter(function (id) { return used[id]; });
      if (used['\u2014']) ordered.push('\u2014');
      return ordered;
    }
    if (facet === 'status') {
      return ['draft', 'proposed', 'approved', 'rejected', 'superseded']
        .filter(function (v) { return nodes.some(function (n) { return n.status === v; }); });
    }
    if (facet === 'scope') {
      return ['project', 'family', 'general']
        .filter(function (v) { return nodes.some(function (n) { return (n.scope || 'project') === v; }); });
    }
    var order = Object.keys(pack.nodeKinds);
    var seen = {};
    nodes.forEach(function (n) { seen[n.kind] = true; });
    return order.filter(function (k) { return seen[k]; })
      .concat(Object.keys(seen).filter(function (k) { return order.indexOf(k) === -1; }));
  }

  function facetLabel(facet, value) {
    if (facet === 'lane') {
      var l = lanes.filter(function (x) { return x.id === value; })[0];
      return l ? l.label : value;
    }
    if (facet === 'kind') {
      var d = pack.nodeKinds[value];
      return d ? d.label : value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  var GRID_COL_W = 300;
  var GRID_COL_GAP = 28;
  var GRID_PAD = 20;

  /* Recomputed from scratch each time. Cheap at this size, and it means the
     grid can never drift out of step with the data behind it. */
  function applyGridLayout() {
    var cols = facetValues(grid.cols);
    var rows = facetValues(grid.rows);

    // Remember the authored layout once, on the way in.
    nodes.forEach(function (n) {
      if (n._freeX === undefined) { n._freeX = n.x; n._freeY = n.y; }
    });

    var cellCount = {};
    var rowHeights = {};

    // How tall each row band has to be: the fullest cell in it decides.
    rows.forEach(function (r) {
      var tallest = 1;
      cols.forEach(function (c) {
        var n = nodes.filter(function (node) {
          return facetValue(node, grid.cols) === c && facetValue(node, grid.rows) === r;
        }).length;
        if (n > tallest) tallest = n;
      });
      rowHeights[r] = tallest;
    });

    var rowTop = {};
    var y = LANE_TOP + 40;
    rows.forEach(function (r) {
      rowTop[r] = y;
      y += rowHeights[r] * ROW_H + GRID_PAD * 2;
    });

    nodes.forEach(function (n) {
      var c = cols.indexOf(facetValue(n, grid.cols));
      var r = facetValue(n, grid.rows);
      // A node whose column facet is unknown still has to go somewhere it can
      // be seen and fixed, rather than piling up under the first heading.
      if (c === -1) c = cols.length;
      var key = c + '|' + r;
      cellCount[key] = (cellCount[key] || 0);
      n.x = GRID_PAD + c * (GRID_COL_W + GRID_COL_GAP) + GRID_COL_W / 2;
      n.y = (rowTop[r] === undefined ? y : rowTop[r]) + GRID_PAD + cellCount[key] * ROW_H;
      cellCount[key]++;
    });

    return { cols: cols, rows: rows, rowTop: rowTop, rowHeights: rowHeights, bottom: y };
  }

  function restoreFreeLayout() {
    nodes.forEach(function (n) {
      if (n._freeX !== undefined) { n.x = n._freeX; n.y = n._freeY; }
      delete n._freeX; delete n._freeY;
    });
  }

  /* The coordinates a save must carry. In grid view n.x/n.y are derived, and
     writing those back would overwrite the layout you arranged by hand with
     whichever grid happened to be open. */
  function authoredPos(node) {
    return node._freeX === undefined
      ? { x: node.x, y: node.y }
      : { x: node._freeX, y: node._freeY };
  }

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
              // Authored, not derived: in grid view n.x/n.y belong to whichever
              // grid is open, and writing those back would flatten the layout
              // you arranged by hand.
              x: authoredPos(node).x, y: authoredPos(node).y
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
    // Recomputed before anything is drawn, so the bands and the nodes cannot
    // disagree about where a cell is.
    gridGeom = gridOn() ? applyGridLayout() : null;
    treeGeom = treeOn() ? applyTreeLayout() : null;
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

  var gridGeom = null;
  var treeGeom = null;

  /* Column headings across the top, row bands down the side. The bands are
     what make a grid readable: without them a sparse row reads as a gap
     rather than as "nothing here", which is usually the finding. */
  function renderGridBands() {
    var g = gridGeom;
    if (!g) { gLanes.innerHTML = ''; return; }

    var width = (g.cols.length + 1) * (GRID_COL_W + GRID_COL_GAP);
    var html = '';

    g.rows.forEach(function (r, i) {
      var top = g.rowTop[r];
      var h = g.rowHeights[r] * ROW_H + GRID_PAD * 2;
      // Alternating tint rather than a border: at this density lines add
      // noise, and the eye tracks a band better than a rule.
      if (i % 2 === 0) {
        html += '<rect x="0" y="' + (top - GRID_PAD) + '" width="' + width + '" height="' + h +
          '" style="fill:var(--color-text-muted);opacity:.04"></rect>';
      }
      html += '<text class="kg-lane-label" style="fill:var(--color-text-muted)" x="8" y="' +
        (top - GRID_PAD + 16) + '">' + esc(String(facetLabel(grid.rows, r)).toUpperCase()) + '</text>';
    });

    g.cols.forEach(function (c, i) {
      var left = GRID_PAD + i * (GRID_COL_W + GRID_COL_GAP) - GRID_COL_W / 2;
      var lane = grid.cols === 'lane'
        ? lanes.filter(function (l) { return l.id === c; })[0]
        : null;
      var token = lane ? lane.token : '--color-text-muted';
      html += '<rect x="' + left + '" y="' + (LANE_TOP - 46) + '" width="' + GRID_COL_W +
        '" height="30" rx="10" style="fill:var(' + token + ');opacity:.14"></rect>' +
        '<text class="kg-lane-label" style="fill:var(' + token + ')" x="' + (left + 14) + '" y="' +
        (LANE_TOP - 26) + '">' + esc(String(facetLabel(grid.cols, c)).toUpperCase()) + '</text>';
    });

    gLanes.innerHTML = html;
  }

  /* Depth rules and one divider. Deliberately sparse: the indentation is
     already doing the work, and a band per row would fight it. */
  function renderTreeBands() {
    if (!treeGeom || !treeGeom.rows) { gLanes.innerHTML = ''; return; }

    var maxDepth = 0;
    Object.keys(treeMeta).forEach(function (id) {
      if (treeMeta[id].depth > maxDepth) maxDepth = treeMeta[id].depth;
    });

    var bottom = LANE_TOP + 40 + treeGeom.rows * TREE_ROW_H;
    var html = '';

    for (var d = 0; d <= maxDepth; d++) {
      var x = LANE_TOP + d * (TREE_COL_W + TREE_COL_GAP) - TREE_COL_GAP / 2;
      if (d > 0) {
        html += '<line x1="' + x + '" y1="' + (LANE_TOP - 10) + '" x2="' + x + '" y2="' + bottom +
          '" style="stroke:var(--color-border);stroke-width:1;opacity:.5"></line>';
      }
      html += '<text class="kg-lane-label" style="fill:var(--color-text-muted)" x="' +
        (x + 14) + '" y="' + (LANE_TOP - 26) + '">' +
        (d === 0 ? 'ROOT' : 'LEVEL ' + d) + '</text>';
    }

    if (treeGeom.looseCount) {
      var y = LANE_TOP + 40 + treeGeom.looseTop * TREE_ROW_H + TREE_ROW_H / 2;
      html += '<line x1="0" y1="' + y + '" x2="' +
        (LANE_TOP + (maxDepth + 1) * (TREE_COL_W + TREE_COL_GAP)) + '" y2="' + y +
        '" style="stroke:var(--color-border);stroke-width:1;stroke-dasharray:6 5"></line>' +
        '<text class="kg-lane-label" style="fill:var(--color-text-muted)" x="8" y="' + (y + 20) +
        '">NOT ON THIS RELATION (' + treeGeom.looseCount + ')</text>';
    }

    gLanes.innerHTML = html;
  }

  function renderLanes() {
    if (treeOn()) { renderTreeBands(); return; }
    if (gridOn()) { renderGridBands(); return; }
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
    if (!visibleByFilter(node)) return false;
    // Folded away rather than filtered out. Everything else in the renderer
    // already respects visible(), so collapse costs one line here instead of
    // a special case in each of nodes, edges and fit.
    if (hiddenByCollapse(node.id)) return false;
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

      // A fold control on anything with children, and honest marks on the two
      // places a graph refuses to be a tree.
      var tm = treeOn() ? treeMeta[node.id] : null;
      if (tm) {
        if (tm.kids) {
          var cx = node.x - s.w / 2 - 12;
          html += '<circle class="kg-fold" data-collapse="' + node.id + '" r="9" cx="' + cx +
            '" cy="' + node.y + '"></circle>' +
            '<text class="kg-fold-mark" x="' + cx + '" y="' + (node.y + 4) +
            '" text-anchor="middle">' + (collapsed[node.id] ? '+' : '\u2212') + '</text>';
          if (collapsed[node.id]) {
            html += '<text class="kg-node-meta" x="' + (node.x + s.w / 2 + 14) + '" y="' +
              (node.y + 4) + '">' + tm.kids + ' folded</text>';
          }
        }
        var marks = [];
        // Drawn under its first parent only. Saying so beats drawing it twice,
        // which is the duplication the whole graph is built to avoid.
        if (tm.extraParents) marks.push('also under ' + tm.extraParents + ' more');
        // The spine loops back here. Walking on would never terminate.
        if (tm.loops) marks.push('loops back');
        if (marks.length) {
          html += '<text class="kg-node-meta kg-tree-mark" x="' + node.x + '" y="' +
            (node.y - s.h / 2 - 6) + '" text-anchor="middle">' + esc(marks.join(' \u00B7 ')) +
            '</text>';
        }
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

      /* In a grid, related nodes are no longer neighbours, so every edge
         crosses the canvas and 62 of them turn the picture to spaghetti.
         They drop to a hint, and the selected node's own edges come back to
         full strength — which is the moment you actually want to trace one. */
      var gridLinked = !derivedLayout() ||
        edge.relation === tree.spine ||      // the spine IS the picture in a tree
        edge.from === selectedId || edge.to === selectedId;

      var opacity = !lit ? 0.07
        : !gridLinked ? 0.1
        : (edge.status === 'approved' ? 1 : 0.5);

      var style = 'stroke:var(' + tok + ')' + (def.dash ? ';stroke-dasharray:' + def.dash : '') +
        ';opacity:' + opacity;

      var label = edge.label || def.label;
      var w = label.length * 5.6 + 12;

      var labelStyle = (derivedLayout() && !gridLinked) ? ' style="opacity:0"' : '';

      return '<path class="kg-edge-hit" data-edge-id="' + edge.id + '" d="' + d + '"></path>' +
        '<path class="kg-edge-path" style="' + style + '" d="' + d + '"' + marker + '></path>' +
        '<rect class="kg-edge-label-bg" x="' + (midX - w / 2) + '" y="' + (midY - 8) + '" width="' + w +
        '" height="16" rx="5"' + labelStyle + '></rect>' +
        '<text class="kg-edge-label" x="' + midX + '" y="' + (midY + 4) + '" text-anchor="middle"' +
        labelStyle + '>' + esc(label) + '</text>';
    }).join('');
  }

  async function loadOpenActionCounts() {
    openActionsBy = {};
    try {
      var res = await fetch('/api/knowledge/actions?mapId=' + encodeURIComponent(mapId),
                            { credentials: 'same-origin' });
      var body = await readJson(res);
      (body && body.actions ? body.actions : []).forEach(function (a) {
        if (!a.node_id) return;
        openActionsBy[a.node_id] = (openActionsBy[a.node_id] || 0) + 1;
      });
    } catch (e) {
      // The counts are a convenience. Losing them must not stop the map
      // loading, which is what it is actually for.
    }
  }

  /* ── Outline ───────────────────────────────────────────────────────
     One data model, two views. The outline is not a second store and it
     is not synced with the graph: it reads the same `nodes` and `edges`
     the canvas reads, and every edit goes through the same API the sheet
     uses, then reload() redraws both views from what D1 now holds.

       a line            = a node (its title, kind and status)
       a line under one  = a `contains` edge from the parent to the child
       line order        = the node's y, which is also its canvas position

     Typing edits the title in place. Enter adds a sibling, Shift+Enter a
     child, Tab and Shift+Tab reparent, Alt+Up/Down reorder. A rename or a
     change of kind is a change to what the node says, so it follows the
     usual rule: an approved node goes back to review. Reordering and
     reparenting change where the node sits and what it is under, not what
     it says, so they save through positionOnly and leave approval alone.

     Edges that are not the tree — synonyms, flows, "governed by" — cannot
     be drawn as indentation. They appear as read-only chips on the line
     and are edited on the canvas.
     ------------------------------------------------------------------ */

  var ol = {
    focusId: null,        // the line the keyboard is on
    collapsed: {},        // node id -> true while its branch is folded
    dirty: false,         // a title is being edited and not yet saved
    noteDirty: false,     // a note under a line is being edited
    wantFocus: false,     // put the caret on focusId after the next draw
    selectAfter: false,   // select the whole title when focus lands (new line)
    pendingDelete: null   // node id the delete dialog is asking about
  };

  /* The relations an indented line can stand for, most preferred first.
     `under` is the one the outline writes; `contains` is read too, so an
     HVAC map built system → equipment → component on the canvas reads as a
     tree here instead of as a flat list with chips. */
  function treeRelation() {
    return (pack && pack.outline && pack.outline.relation) || 'under';
  }
  function treeRelations() {
    var list = [treeRelation()];
    if (pack && pack.relations && pack.relations.contains && list.indexOf('contains') === -1) list.push('contains');
    return list;
  }
  function isTreeRelation(rel) { return treeRelations().indexOf(rel) !== -1; }

  /* The kind a line typed in the outline starts as: the pack's choice, or
     Note, or failing that whatever the pack lists first. Changed on the
     line's own kind tag. */
  function outlineKind() {
    var k = pack && pack.outline && pack.outline.defaultKind;
    if (k && pack.nodeKinds[k]) return k;
    if (pack.nodeKinds.note) return 'note';
    return Object.keys(pack.nodeKinds)[0];
  }

  function orderCmp(a, b) {
    return (authoredPos(a).y - authoredPos(b).y) || a.title.localeCompare(b.title);
  }

  /* Top-level order: lane, then column, then down the column. Lane-tidied
     and dictionary maps stack nodes column-major, so two nodes in different
     columns of one lane can share a y; ordering by y alone interleaved them
     and a new line "landed somewhere random". */
  function rootCmp(a, b) {
    var pa = authoredPos(a), pb = authoredPos(b);
    return (laneIndex(a.lane) - laneIndex(b.lane)) || (pa.x - pb.x) || (pa.y - pb.y) || a.title.localeCompare(b.title);
  }

  /* Reads the tree out of the edge list. A node's parent is the source of
     the first tree edge pointing at it; a node with two parents is placed
     under the first and gets a chip for the second. A cycle is cut at the
     node that closes it so the render can never loop. */
  function buildTree() {
    var rels = treeRelations();
    var byId = {}, parentOf = {}, parentEdge = {}, children = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    // Preferred relation first, so an `under` edge written from the outline
    // wins over an older `contains` edge to the same node.
    rels.forEach(function (rel) {
      edges.forEach(function (e) {
        if (e.relation !== rel || e.from === e.to) return;
        if (!byId[e.from] || !byId[e.to] || parentOf[e.to]) return;
        parentOf[e.to] = e.from;
        parentEdge[e.to] = e;
      });
    });

    Object.keys(parentOf).forEach(function (id) {
      var seen = {}, cur = id;
      while (cur && parentOf[cur]) {
        if (seen[cur]) { delete parentOf[id]; delete parentEdge[id]; break; }
        seen[cur] = true;
        cur = parentOf[cur];
      }
    });

    nodes.forEach(function (n) {
      var p = parentOf[n.id] || '';
      (children[p] = children[p] || []).push(n);
    });
    Object.keys(children).forEach(function (k) {
      children[k].sort(k === '' ? rootCmp : orderCmp);
    });

    return { parentOf: parentOf, parentEdge: parentEdge, children: children };
  }

  function siblingsOf(t, id) {
    return t.children[t.parentOf[id] || ''] || [];
  }

  /* Non-tree edges touching a node, for the chips. */
  function crossLinks(id) {
    return edges.filter(function (e) {
      return !isTreeRelation(e.relation) && (e.from === id || e.to === id);
    });
  }

  function renderOutline() {
    if (!pack) return;
    var box = $('outline');

    // Never redraw under a title or note that is mid-edit; the save that
    // follows the edit calls reload(), and that redraw carries the new text.
    if ((ol.dirty || ol.noteDirty) && box.contains(document.activeElement)) return;

    var t = buildTree();

    // Search and the status filter apply here as on the canvas, except that
    // a line stays if anything under it matches — a hit inside a folded
    // branch is still a hit.
    var shown = {};
    function show(n) {
      if (shown[n.id] !== undefined) return shown[n.id];
      var self = visible(n) && matches(n);
      var any = self;
      (t.children[n.id] || []).forEach(function (k) { if (show(k)) any = true; });
      shown[n.id] = any;
      return any;
    }
    nodes.forEach(show);

    var roots = (t.children[''] || []).filter(function (n) { return shown[n.id]; });
    box.innerHTML = roots.length
      ? roots.map(function (n) { return lineHTML(n, t, 1, shown); }).join('')
      : '<p class="kg-muted kg-ol-empty">' + (nodes.length
          ? 'Nothing matches the search or filter.'
          : 'No lines yet. Press <strong>+ Line</strong> and start typing.') + '</p>';

    // The toolbar acts on the focused line; without one, only "+ Line" makes sense.
    var has = !!nodeById(ol.focusId);
    ['ol-child', 'ol-indent', 'ol-outdent', 'ol-up', 'ol-down', 'ol-open', 'ol-delete'].forEach(function (id) {
      $(id).disabled = !has || (id !== 'ol-open' && !canEdit());
    });
    $('ol-add').disabled = !canEdit();

    // Only take the caret when the outline is what the person is looking at;
    // a redraw while the sheet is open or the graph is showing must not pull
    // focus out from under them.
    // And only when a keyboard action asked for it. A save triggered by
    // clicking away (into the search box, say) must not drag the caret back.
    if (ol.wantFocus && ol.focusId && currentView === 'outline' && !sheetOpen) focusLine(ol.focusId, ol.selectAfter);
    ol.wantFocus = false;
    ol.selectAfter = false;
  }

  function lineHTML(n, t, depth, shown) {
    var kids = (t.children[n.id] || []).filter(function (k) { return shown[k.id]; });
    var folded = !!ol.collapsed[n.id];
    var links = crossLinks(n.id);
    var openCount = openActionsBy[n.id] || 0;

    var chips = links.slice(0, 6).map(function (e) {
      var other = nodeById(e.from === n.id ? e.to : e.from);
      if (!other) return '';
      var rd = relDef(e.relation);
      var text = (e.from === n.id ? '' : '\u2190 ') + (e.label || rd.label) + ' ' + other.title;
      return '<button type="button" class="kg-ol-chip" data-ol-jump="' + other.id +
        '" title="Connections are edited on the graph">' + esc(text) + '</button>';
    }).join('') + (links.length > 6 ? '<span class="kg-ol-chip">+' + (links.length - 6) + '</span>' : '');

    var kindSel = '<select class="kg-ol-kind" data-ol-kind="' + n.id + '" aria-label="Kind"' +
      (canEdit() ? '' : ' disabled') + '>' +
      Object.keys(pack.nodeKinds).map(function (k) {
        return '<option value="' + k + '"' + (k === n.kind ? ' selected' : '') + '>' +
          esc(pack.nodeKinds[k].label) + '</option>';
      }).join('') + '</select>';

    // Approved is the quiet, ordinary case: a solid bullet. Anything else is
    // what needs noticing, so only those get a word.
    var statusPill = n.status === 'approved' ? ''
      : '<span class="kg-pill kg-pill-' + esc(n.status) + '">' + esc(n.status) + '</span>';

    return '<div class="kg-ol-item' + (n.id === ol.focusId ? ' is-focus' : '') +
      (n.id === selectedId ? ' is-selected' : '') +
      (n.status === 'approved' ? ' is-approved' : '') + '" role="treeitem" aria-level="' + depth +
      '" aria-expanded="' + (kids.length ? String(!folded) : 'undefined') + '" data-ol-id="' + n.id + '">' +
      '<div class="kg-ol-line">' +
        (kids.length
          ? '<button type="button" class="kg-ol-fold" data-ol-fold="' + n.id + '" aria-label="' +
            (folded ? 'Expand' : 'Collapse') + '">' + (folded ? '\u25B8' : '\u25BE') + '</button>'
          : '<span class="kg-ol-fold kg-ol-fold-none" aria-hidden="true"></span>') +
        '<span class="kg-ol-dot' + (folded && kids.length ? ' is-folded' : '') + '" style="background:' + colourOf(n) + '"' +
          (n.status !== 'approved' ? ' data-draft' : '') + ' title="' + esc(n.status) + '"></span>' +
        '<span class="kg-ol-title" data-ol-title="' + n.id + '" contenteditable="' +
          (canEdit() ? 'true' : 'false') + '" spellcheck="false" role="textbox" aria-label="Title">' +
          esc(n.title) + '</span>' +
        '<span class="kg-ol-meta">' +
          kindSel +
          statusPill +
          (folded && kids.length ? '<span class="kg-ol-count">' + kids.length + '</span>' : '') +
          (openCount ? '<span class="kg-pill kg-pill-open">' + openCount + ' open</span>' : '') +
          '<button type="button" class="kg-icon-btn kg-ol-openbtn" data-goto="' + n.id +
            '" aria-label="Open ' + esc(n.title) + '" title="Open in the sheet">' +
            '<svg class="kg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
          '<button type="button" class="kg-btn kg-btn-sm kg-list-reveal" data-reveal="' + n.id +
            '" aria-label="Show ' + esc(n.title) + ' on the map">Map</button>' +
        '</span>' +
      '</div>' +
      '<div class="kg-ol-sub">' +
        '<span class="kg-ol-summary" data-ol-note="' + n.id + '" contenteditable="' +
          (canEdit() ? 'true' : 'false') + '" spellcheck="true" role="textbox" aria-label="Note" ' +
          'data-placeholder="' + (canEdit() ? 'Add a note \u2014 what a downstream app reads first' : '') + '">' +
          esc(n.summary || '') + '</span>' +
        chips +
      '</div>' +
      (kids.length && !folded
        ? '<div class="kg-ol-children" role="group">' +
            kids.map(function (k) { return lineHTML(k, t, depth + 1, shown); }).join('') +
          '</div>'
        : '') +
    '</div>';
  }

  function lineEl(id) {
    return $('outline').querySelector('[data-ol-title="' + id + '"]');
  }

  function focusLine(id, selectAll) {
    var el = lineEl(id);
    if (!el) return;
    if (document.activeElement === el) return;
    el.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      if (!selectAll) range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* caret placement is a nicety */ }
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function setLineFocus(id) {
    if (ol.focusId === id) return;
    var prev = $('outline').querySelector('.kg-ol-item.is-focus');
    if (prev) prev.classList.remove('is-focus');
    ol.focusId = id;
    var item = $('outline').querySelector('.kg-ol-item[data-ol-id="' + id + '"]');
    if (item) item.classList.add('is-focus');
    var has = !!nodeById(id);
    ['ol-child', 'ol-indent', 'ol-outdent', 'ol-up', 'ol-down', 'ol-open', 'ol-delete'].forEach(function (bid) {
      $(bid).disabled = !has || (bid !== 'ol-open' && !canEdit());
    });
  }

  /* The lines in document order — what Up and Down move through. */
  function visibleLineIds() {
    return Array.prototype.map.call($('outline').querySelectorAll('[data-ol-title]'), function (el) {
      return el.getAttribute('data-ol-title');
    });
  }

  /* ── Outline writes ─────────────────────────────────────────────────
     Every one of these is the same API call the sheet and the canvas
     make; the outline owns no endpoint of its own.
     ------------------------------------------------------------------ */

  async function postNode(payload) {
    var res = await fetch('/api/knowledge/graph', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ type: 'node', mapId: mapId }, payload))
    });
    return readJson(res);
  }

  async function postEdge(from, to) {
    var res = await fetch('/api/knowledge/graph', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'edge', mapId: mapId, from: from, to: to, relation: treeRelation(), label: '' })
    });
    return readJson(res);
  }

  /* An edge the database refused. Almost always the outline migration not
     having run, so say so, rather than "illegal relation for these kinds". */
  function edgeHint(err) {
    if (/illegal relation/i.test(err.message || '')) {
      throw new Error('This map cannot nest lines yet — run db/2026-09-outline.sql (see /api/admin/health).');
    }
    throw err;
  }

  async function deleteEdge(id) {
    var res = await fetch('/api/knowledge/graph?type=edge&id=' + encodeURIComponent(id) +
      '&map=' + encodeURIComponent(mapId), { method: 'DELETE' });
    return readJson(res);
  }

  async function savePosition(n) {
    // Write the authored coordinates. Under a derived layout (grid or
    // hierarchy) n.x/n.y are computed, and saving those would overwrite the
    // hand-placed map with a picture of it.
    var p = authoredPos(n);
    return postNode({ id: n.id, positionOnly: true, x: p.x, y: p.y, lane: n.lane });
  }

  /* A y that puts the node between two siblings on the canvas as well as in
     the list. Siblings sit ROW_H apart when tidied; between them there is
     always room for a fraction. */
  function apos(n) { return n ? authoredPos(n) : null; }

  function yBetween(prev, next) {
    // Either end may be null.
    if (prev && next) return (prev.y + next.y) / 2;
    if (prev) return prev.y + ROW_H;
    if (next) return next.y - ROW_H;
    return LANE_TOP + 70;
  }

  /* Where a new or moved line goes so that it sorts right after `prev` and
     before `next`: halfway between them when they share a column, straight
     below prev when next starts a new column (or there is no next). */
  function slotAfter(prev, next) {
    var p = apos(prev), q = apos(next);
    if (!p && !q) return { x: laneX(0), y: LANE_TOP + 70 };
    if (!p) return { x: q.x, y: q.y - ROW_H };
    if (q && Math.abs(q.x - p.x) < 1) return { x: p.x, y: (p.y + q.y) / 2 };
    return { x: p.x, y: p.y + ROW_H };
  }

  /* Sets the stored coordinates and, when no derived layout is on, the
     displayed ones too. authoredPos() reads n._freeX/_freeY under a derived layout. */
  function setAuthored(n, x, y) {
    if (n._freeX === undefined) { n.x = x; n.y = y; } else { n._freeX = x; n._freeY = y; }
  }

  /* Rename in place. Empty keeps the old title — a node needs one. */
  async function commitTitle(id, text) {
    var n = nodeById(id);
    ol.dirty = false;
    if (!n) return;
    var title = String(text || '').replace(/\s+/g, ' ').trim();
    if (!title || title === n.title) {
      var el = lineEl(id);
      if (el) el.textContent = n.title;
      return;
    }
    setStatus('Saving…');
    try {
      var body = await postNode({
        id: n.id, kind: n.kind, scope: n.scope, title: title, lane: n.lane, summary: n.summary,
        aliases: n.aliases, body: n.body, attributes: n.attributes, tags: n.tags,
        standards: n.standards, x: authoredPos(n).x, y: authoredPos(n).y
      });
      setStatus(n.status === 'approved' && body.status === 'proposed'
        ? 'Renamed. An approved node goes back for review when its title changes.'
        : 'Renamed.');
      await reload();
    } catch (err) { setStatus('Rename failed: ' + err.message); }
  }

  /* The note under a line is the node's summary — the field a downstream
     app reads first. Saved through the full node save, so an approved
     node returns to review, as it does from the sheet. */
  async function commitNote(id, text) {
    var n = nodeById(id);
    ol.noteDirty = false;
    if (!n) return;
    var summary = String(text || '').replace(/\s+/g, ' ').trim();
    if (summary === (n.summary || '').trim()) return;
    setStatus('Saving note…');
    try {
      var body = await postNode({
        id: n.id, kind: n.kind, scope: n.scope, title: n.title, lane: n.lane, summary: summary,
        aliases: n.aliases, body: n.body, attributes: n.attributes, tags: n.tags,
        standards: n.standards, x: authoredPos(n).x, y: authoredPos(n).y
      });
      setStatus(n.status === 'approved' && body.status === 'proposed'
        ? 'Note saved. An approved node goes back for review when its summary changes.'
        : 'Note saved.');
      await reload();
    } catch (err) { setStatus('Could not save the note: ' + err.message); }
  }

  async function changeKind(id, kind) {
    var n = nodeById(id);
    if (!n || !pack.nodeKinds[kind] || kind === n.kind) return;
    setStatus('Saving…');
    try {
      var body = await postNode({
        id: n.id, kind: kind, scope: n.scope, title: n.title, lane: n.lane, summary: n.summary,
        aliases: n.aliases, body: n.body, attributes: n.attributes, tags: n.tags,
        standards: n.standards, x: authoredPos(n).x, y: authoredPos(n).y
      });
      setStatus(n.status === 'approved' && body.status === 'proposed'
        ? 'Kind changed. An approved node goes back for review when its kind changes.'
        : 'Kind changed.');
      await reload();
    } catch (err) { setStatus('Could not change kind: ' + err.message); }
  }

  /* New line. `asChild` puts it under the focused line; otherwise it goes
     right after the focused line as a sibling, or at the end of the roots. */
  async function outlineAdd(asChild) {
    if (!canEdit()) return;
    if (ol.dirty && ol.focusId) {
      var el = lineEl(ol.focusId);
      if (el) await commitTitle(ol.focusId, el.textContent);
    }
    var t = buildTree();
    var ref = nodeById(ol.focusId);
    var parentId = null, prev = null, next = null, lane = (lanes[0] || {}).id || '';
    var slot;

    if (ref && asChild) {
      parentId = ref.id;
      var kids = t.children[ref.id] || [];
      prev = kids[kids.length - 1] || null;
      lane = ref.lane;
      slot = prev ? slotAfter(prev, null)
                  : { x: authoredPos(ref).x + 40, y: authoredPos(ref).y + ROW_H / 2 };
    } else if (ref && (t.children[ref.id] || []).length && !ol.collapsed[ref.id]) {
      // Enter on a line whose branch is open: the new line is its first
      // child, the way an outliner reads it — not a sibling pushed below
      // the whole branch.
      parentId = ref.id;
      next = t.children[ref.id][0];
      lane = ref.lane;
      slot = slotAfter(null, next);
    } else if (ref) {
      parentId = t.parentOf[ref.id] || null;
      var sib = siblingsOf(t, ref.id);
      var i = sib.indexOf(ref);
      prev = ref; next = sib[i + 1] || null;
      lane = ref.lane;
      slot = slotAfter(prev, next);
    } else {
      var roots = t.children[''] || [];
      prev = roots[roots.length - 1] || null;
      if (prev) lane = prev.lane;
      slot = slotAfter(prev, null);
    }

    var x = slot.x, y = slot.y;
    var kind = outlineKind();
    var title = 'New ' + (pack.nodeKinds[kind].label || kind).toLowerCase();

    setStatus('Adding…');
    try {
      var body = await postNode({ kind: kind, title: title, lane: lane, x: Math.round(x), y: Math.round(y) });
      if (parentId) await postEdge(parentId, body.id).catch(edgeHint);
      if (parentId) delete ol.collapsed[parentId];
      ol.focusId = body.id;
      ol.selectAfter = true;
      await reload();
      setStatus('Added as a draft. Type its name.');
    } catch (err) { setStatus('Could not add: ' + err.message); }
  }

  /* Tab: become the last child of the line above. */
  async function outlineIndent() {
    var n = nodeById(ol.focusId);
    if (!n || !canEdit()) return;
    var t = buildTree();
    var sib = siblingsOf(t, n.id);
    var i = sib.indexOf(n);
    if (i < 1) { setStatus('Nothing above it to move under.'); return; }
    var newParent = sib[i - 1];
    await reparent(n, t, newParent.id);
  }

  /* Shift+Tab: leave the parent and sit right after it. */
  async function outlineOutdent() {
    var n = nodeById(ol.focusId);
    if (!n || !canEdit()) return;
    var t = buildTree();
    var parentId = t.parentOf[n.id];
    if (!parentId) { setStatus('Already at the top level.'); return; }
    var grand = t.parentOf[parentId] || null;
    await reparent(n, t, grand, parentId);
  }

  /* Moves a node under newParentId (null = top level). `afterId`, when
     given, is the sibling it should follow. The old tree edge is removed
     and a new one written; the node's own fields are untouched. */
  async function reparent(n, t, newParentId, afterId) {
    var old = t.parentEdge[n.id];
    setStatus('Moving…');
    try {
      // Only an outline edge is removed. A `contains` edge is an engineering
      // fact the canvas author wrote; re-filing a line must not delete it.
      // The new `under` edge takes precedence in the outline regardless.
      if (old && old.relation === treeRelation()) await deleteEdge(old.id);
      if (newParentId) {
        await postEdge(newParentId, n.id).catch(edgeHint);
        delete ol.collapsed[newParentId];
      }

      // Rebuild the list from the edges we just changed to place it.
      var newSibs = (newParentId ? (t.children[newParentId] || []) : (t.children[''] || []))
        .filter(function (s) { return s.id !== n.id; });
      var prev, next;
      if (afterId) {
        var a = nodeById(afterId);
        var ai = newSibs.indexOf(a);
        prev = a; next = newSibs[ai + 1] || null;
      } else {
        prev = newSibs[newSibs.length - 1] || null; next = null;
      }
      var slot = (prev || next)
        ? slotAfter(prev, next)
        : { x: authoredPos(nodeById(newParentId) || n).x + (newParentId ? 40 : 0),
            y: authoredPos(nodeById(newParentId) || n).y + ROW_H / 2 };
      setAuthored(n, slot.x, slot.y);
      if (newParentId) n.lane = nodeById(newParentId).lane;
      await savePosition(n);

      ol.focusId = n.id;
      await reload();
      setStatus(newParentId ? 'Moved under ' + nodeById(newParentId).title + '.' : 'Moved to the top level.');
    } catch (err) { setStatus('Could not move: ' + err.message); await reload(); }
  }

  /* Alt+Up / Alt+Down: swap y with the neighbouring sibling. */
  async function outlineMove(dir) {
    var n = nodeById(ol.focusId);
    if (!n || !canEdit()) return;
    var t = buildTree();
    var sib = siblingsOf(t, n.id);
    var i = sib.indexOf(n);
    var other = sib[i + dir];
    if (!other) return;
    // Swap the whole position: top-level order runs by column before row,
    // so swapping y alone changed nothing when the two sat in different
    // columns.
    var a = authoredPos(n), b = authoredPos(other);
    var nx = b.x, ny = b.y, ox = a.x, oy = a.y;
    if (nx === ox && ny === oy) ny += dir;   // two nodes on one spot: nudge so the order sticks
    setAuthored(n, nx, ny); setAuthored(other, ox, oy);
    setStatus('Reordering…');
    try {
      await savePosition(n);
      await savePosition(other);
      ol.focusId = n.id;
      await reload();
      setStatus('Reordered.');
    } catch (err) { setStatus('Could not reorder: ' + err.message); await reload(); }
  }

  /* Delete asks what to do with the branch. Keeping the children moves
     them up one level (under the grandparent, or to the top). Deleting the
     branch removes every node under it — the only destructive choice, and
     the one that has to be chosen by name. */
  function outlineDelete() {
    var n = nodeById(ol.focusId);
    if (!n || !canEdit()) return;
    var t = buildTree();
    var kids = t.children[n.id] || [];
    ol.pendingDelete = n.id;
    $('ol-delete-title').textContent = 'Delete \u201c' + n.title + '\u201d?';
    $('ol-delete-note').textContent = kids.length
      ? kids.length + (kids.length === 1 ? ' line sits' : ' lines sit') + ' under it. Keeping them moves them up to ' +
        (t.parentOf[n.id] ? '\u201c' + nodeById(t.parentOf[n.id]).title + '\u201d' : 'the top level') +
        '. Deleting the branch removes them all, including their own connections. Neither can be undone.'
      : 'Nothing sits under it. Its connections go with it. This cannot be undone.';
    $('ol-delete-branch').hidden = !kids.length;
    $('ol-delete-keep').textContent = kids.length ? 'Delete, keep what is under it' : 'Delete';
    $('ol-delete-dialog').showModal();
  }

  async function runDelete(mode) {
    var id = ol.pendingDelete;
    ol.pendingDelete = null;
    $('ol-delete-dialog').close();
    var n = nodeById(id);
    if (!n) return;
    var t = buildTree();
    var ids = visibleLineIds();
    var at = ids.indexOf(id);

    setStatus('Deleting…');
    try {
      if (mode === 'branch') {
        var doomed = [];
        (function walk(pid) {
          (t.children[pid] || []).forEach(function (k) { doomed.push(k.id); walk(k.id); });
        })(id);
        for (var d = doomed.length - 1; d >= 0; d--) await deleteNodeById(doomed[d]);
      } else {
        // The children step into the deleted line's place, in the order they
        // were in. Re-attached but left at their old coordinates they would
        // scatter among the grandparent's other children by position.
        var grand = t.parentOf[id] || null;
        var kids = t.children[id] || [];
        var around = siblingsOf(t, id);
        var here = around.indexOf(n);
        var cursor = around[here - 1] || null;
        var after = around[here + 1] || null;
        for (var k = 0; k < kids.length; k++) {
          if (grand) await postEdge(grand, kids[k].id);
          var slotK = slotAfter(cursor, after);
          setAuthored(kids[k], slotK.x, slotK.y);
          await savePosition(kids[k]);
          cursor = kids[k];
        }
      }
      await deleteNodeById(id);
      if (selectedId === id) selectedId = null;
      // Land on the line that was above, so the keyboard has somewhere to be.
      ol.focusId = ids[at - 1] || ids[at + 1] || null;
      if (ol.focusId === id) ol.focusId = null;
      await reload();
      setStatus('Deleted.');
    } catch (err) { setStatus('Delete failed: ' + err.message); await reload(); }
  }

  async function deleteNodeById(id) {
    var res = await fetch('/api/knowledge/graph?type=node&id=' + encodeURIComponent(id) +
      '&map=' + encodeURIComponent(mapId), { method: 'DELETE' });
    return readJson(res);
  }

  function outlineOpen(id) {
    var n = nodeById(id || ol.focusId);
    if (!n) return;
    selectedId = n.id;
    openSheet('details');
    render();
  }

  /* Keys on a title. The document-level handler stands down inside
     contenteditable, so this is the only listener that sees them. */
  async function onOutlineKey(ev) {
    var note = ev.target.closest ? ev.target.closest('[data-ol-note]') : null;
    if (note) {
      // A note is one paragraph: Enter finishes it, Escape drops the edit.
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); note.blur(); }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        var nn = nodeById(note.getAttribute('data-ol-note'));
        note.textContent = nn ? (nn.summary || '') : '';
        ol.noteDirty = false;
        note.blur();
      }
      return;
    }
    var el = ev.target.closest ? ev.target.closest('[data-ol-title]') : null;
    if (!el) return;
    var id = el.getAttribute('data-ol-title');
    ol.wantFocus = true;

    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) { outlineOpen(id); return; }
      if (!canEdit()) return;
      await commitTitle(id, el.textContent);
      ol.focusId = id;
      await outlineAdd(ev.shiftKey);
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      if (!canEdit()) return;
      await commitTitle(id, el.textContent);
      ol.focusId = id;
      if (ev.shiftKey) await outlineOutdent(); else await outlineIndent();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      var n = nodeById(id);
      if (n) el.textContent = n.title;
      ol.dirty = false;
      el.blur();
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      var dir = ev.key === 'ArrowUp' ? -1 : 1;
      if (ev.altKey) {
        ev.preventDefault();
        if (!canEdit()) return;
        await commitTitle(id, el.textContent);
        ol.focusId = id;
        await outlineMove(dir);
        return;
      }
      var ids = visibleLineIds();
      var at = ids.indexOf(id);
      var target = ids[at + dir];
      if (target) {
        ev.preventDefault();
        if (ol.dirty) await commitTitle(id, el.textContent);
        setLineFocus(target);
        focusLine(target, false);
      }
      return;
    }
    if (ev.key === 'Backspace' && !el.textContent.trim() && canEdit()) {
      // An empty draft line with nothing under it is nothing lost.
      var node = nodeById(id);
      var t = buildTree();
      if (node && node.status === 'draft' && !(t.children[id] || []).length) {
        ev.preventDefault();
        var all = visibleLineIds();
        var i = all.indexOf(id);
        ol.dirty = false;
        try {
          await deleteNodeById(id);
          ol.focusId = all[i - 1] || all[i + 1] || null;
          await reload();
          setStatus('Removed the empty line.');
        } catch (err) { setStatus('Could not remove: ' + err.message); }
      }
    }
  }

  function bindOutline() {
    var box = $('outline');

    box.addEventListener('focusin', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-ol-title], [data-ol-note]') : null;
      if (el) setLineFocus(el.getAttribute('data-ol-title') || el.getAttribute('data-ol-note'));
    });
    box.addEventListener('input', function (ev) {
      if (ev.target.closest && ev.target.closest('[data-ol-title]')) ol.dirty = true;
      if (ev.target.closest && ev.target.closest('[data-ol-note]')) ol.noteDirty = true;
    });
    box.addEventListener('focusout', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-ol-title]') : null;
      if (el && ol.dirty) { commitTitle(el.getAttribute('data-ol-title'), el.textContent); return; }
      var note = ev.target.closest ? ev.target.closest('[data-ol-note]') : null;
      if (note && ol.noteDirty) commitNote(note.getAttribute('data-ol-note'), note.textContent);
    });
    box.addEventListener('keydown', onOutlineKey);
    // Titles are one line. A paste that brings a newline is flattened.
    box.addEventListener('paste', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-ol-title], [data-ol-note]') : null;
      if (!el) return;
      ev.preventDefault();
      var text = (ev.clipboardData || window.clipboardData).getData('text').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    });

    box.addEventListener('click', function (ev) {
      var fold = ev.target.closest('[data-ol-fold]');
      if (fold) {
        var fid = fold.getAttribute('data-ol-fold');
        if (ol.collapsed[fid]) delete ol.collapsed[fid]; else ol.collapsed[fid] = true;
        renderOutline();
        return;
      }
      var reveal = ev.target.closest('[data-reveal]');
      if (reveal) {
        selectedId = reveal.getAttribute('data-reveal');
        switchView('map');
        render();
        // Centre it, or you arrive at a canvas with the node somewhere off
        // screen and are no better off than before.
        setTimeout(function () { centreOn(selectedId); }, 60);
        return;
      }
      var b = ev.target.closest('[data-goto]');
      if (b) {
        selectedId = b.getAttribute('data-goto');
        setLineFocus(selectedId);
        openSheet('details');
        return;
      }
      var jump = ev.target.closest('[data-ol-jump]');
      if (jump) {
        selectedId = jump.getAttribute('data-ol-jump');
        switchView('map');
        setFocus(selectedId);
        return;
      }
      var item = ev.target.closest('.kg-ol-line');
      if (item && !ev.target.closest('[data-ol-title]') && !ev.target.closest('select')) {
        ol.wantFocus = true;
        var id = item.parentNode.getAttribute('data-ol-id');
        setLineFocus(id);
        focusLine(id, false);
      }
    });

    box.addEventListener('change', function (ev) {
      var sel = ev.target.closest ? ev.target.closest('[data-ol-kind]') : null;
      if (sel) changeKind(sel.getAttribute('data-ol-kind'), sel.value);
    });

    function want(fn) { return function () { ol.wantFocus = true; fn(); }; }
    $('ol-add').addEventListener('click', want(function () { outlineAdd(false); }));
    $('ol-child').addEventListener('click', want(function () { outlineAdd(true); }));
    $('ol-indent').addEventListener('click', want(outlineIndent));
    $('ol-outdent').addEventListener('click', want(outlineOutdent));
    $('ol-up').addEventListener('click', want(function () { outlineMove(-1); }));
    $('ol-down').addEventListener('click', want(function () { outlineMove(1); }));
    $('ol-open').addEventListener('click', function () { outlineOpen(); });
    $('ol-delete').addEventListener('click', outlineDelete);
    $('ol-delete-keep').addEventListener('click', function () { runDelete('keep'); });
    $('ol-delete-branch').addEventListener('click', function () { runDelete('branch'); });
    $('ol-delete-cancel').addEventListener('click', function () {
      ol.pendingDelete = null; $('ol-delete-dialog').close();
    });
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

  /* ── Actions ───────────────────────────────────────────────────────
     What is owed on this node, and what was done about it. Kept separate
     from `status`, which means whether Compliance Maker may quote the node
     — one field carrying both would break the only meaning that has. */

  var actionsFor = null;      // node id the loaded lists belong to

  function actStatus(msg, kind) {
    var el = $('act-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'kg-muted' + (kind ? ' is-' + kind : '');
  }

  function loadActions(force) {
    var node = nodeById(selectedId);
    if (!node) return;
    if (!force && actionsFor === node.id) return;
    actionsFor = node.id;

    $('act-open').innerHTML = '<p class="kg-muted">Loading…</p>';
    $('act-history').innerHTML = '';

    // On an Engineer node the question is "what is on their plate", not
    // "what is filed against this node" — an engineer's work hangs off the
    // processes and projects they touch, never off themselves.
    var byPerson = node.kind === 'person';
    var q = '?mapId=' + encodeURIComponent(mapId) +
      (byPerson ? '&assignee=' : '&node=') + encodeURIComponent(node.id);

    var scopeNote = $('act-scope-note');
    if (scopeNote) {
      scopeNote.hidden = !byPerson;
      scopeNote.textContent = byPerson
        ? 'Everything assigned to ' + node.title + ', wherever it sits on the map.'
        : '';
    }

    refreshAssignees();

    Promise.all([
      fetch('/api/knowledge/actions' + q, { credentials: 'same-origin' }).then(readJson),
      fetch('/api/knowledge/actions' + q + '&history=1', { credentials: 'same-origin' }).then(readJson)
    ]).then(function (r) {
      renderOpenActions((r[0] && r[0].actions) || []);
      renderActionHistory((r[1] && r[1].history) || []);
    }).catch(function (err) {
      $('act-open').innerHTML = '<p class="kg-muted">' + esc(err.message || 'Could not load actions.') + '</p>';
    });
  }

  /* The assignee list is the person nodes on this map. Built from `nodes`
     rather than fetched: the map already holds them, and a second request
     would only be able to disagree with what is on screen. */
  function refreshAssignees() {
    var sel = $('act-assignee');
    if (!sel) return;
    var current = sel.value;

    var people = nodes.filter(function (n) { return n.kind === 'person'; })
      .sort(function (a, b) { return a.title.localeCompare(b.title); });

    sel.innerHTML = '<option value="">Unassigned</option>' +
      people.map(function (n) {
        return '<option value="' + esc(n.id) + '">' + esc(n.title) + '</option>';
      }).join('');

    if (current) sel.value = current;

    // Assigning to an engineer is the point, so say so when there are none
    // rather than leaving a dropdown with one empty entry.
    sel.title = people.length
      ? 'Assign this to an engineer'
      : 'No engineers on this map yet — add one from the palette.';
  }

  function renderOpenActions(list) {
    if (!list.length) {
      $('act-open').innerHTML = '<p class="kg-muted">Nothing outstanding on this node.</p>';
      return;
    }
    $('act-open').innerHTML = list.map(function (a) {
      var meta = [];
      if (a.due) meta.push((a.overdue ? 'overdue · ' : 'due ') + a.due);
      if (a.assignee_title) meta.push(a.assignee_title);
      if (a.owner) meta.push('waiting on ' + a.owner);
      // On an engineer's list, where it sits matters more than who owns it.
      if (a.node_title && nodeById(selectedId) &&
          nodeById(selectedId).kind === 'person') meta.push(a.node_title);
      if (a.age_days > 0) meta.push(a.age_days + 'd old');
      return '<div class="kg-act' + (a.overdue ? ' is-overdue' : '') +
        (a.priority === 1 ? ' is-high' : '') + '" data-act="' + esc(a.id) + '">' +
        '<div class="kg-act__head">' +
        '<span class="kg-act__title">' + esc(a.title) + '</span>' +
        '<span class="kg-pill kg-pill-' + esc(a.state) + '">' + esc(a.state) + '</span>' +
        '</div>' +
        (meta.length ? '<p class="kg-card-meta">' + esc(meta.join(' · ')) + '</p>' : '') +
        '<div class="kg-row kg-tight">' +
        '<input type="text" class="kg-input kg-act__outcome" maxlength="4000" ' +
        'placeholder="What happened? Required to close." aria-label="Outcome">' +
        '<button type="button" class="kg-btn kg-btn-sm" data-act-done="' + esc(a.id) + '">Done</button>' +
        '<button type="button" class="kg-btn kg-btn-sm" data-act-drop="' + esc(a.id) + '">Drop</button>' +
        '</div></div>';
    }).join('');
  }

  function renderActionHistory(list) {
    if (!list.length) {
      $('act-history').innerHTML = '<p class="kg-muted">Nothing closed yet.</p>';
      return;
    }
    $('act-history').innerHTML = list.map(function (a) {
      return '<div class="kg-act is-closed">' +
        '<div class="kg-act__head">' +
        '<span class="kg-act__title">' + esc(a.title) + '</span>' +
        '<span class="kg-card-meta">' + esc((a.closed_at || '').slice(0, 10)) + '</span>' +
        '</div>' +
        (a.outcome ? '<p class="kg-act__outcome-text">' + esc(a.outcome) + '</p>' : '') +
        (a.source_ref ? '<p class="kg-card-meta">' + esc(a.source_ref) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  function addAction() {
    var node = nodeById(selectedId);
    var title = $('act-title').value.trim();
    if (!node || !title) { actStatus('Give the action a title first.'); return; }

    // Raised while looking at an engineer: it is theirs, and it is not filed
    // against the person node — that would bury it away from the work.
    if (node.kind === 'person' && $('act-assignee') && !$('act-assignee').value) {
      $('act-assignee').value = node.id;
    }

    fetch('/api/knowledge/actions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapId: mapId,
        nodeId: node.kind === 'person' ? null : node.id,
        title: title,
        due: $('act-due').value || null,
        priority: Number($('act-priority').value) || 2,
        assigneeId: $('act-assignee') ? $('act-assignee').value || null : null,
        owner: $('act-owner').value.trim()
      })
    }).then(readJson).then(function () {
      $('act-title').value = '';
      $('act-due').value = '';
      $('act-owner').value = '';
      if ($('act-assignee')) $('act-assignee').value = '';
      actStatus('Added.');
      loadActions(true);
    }).catch(function (err) {
      actStatus(err.message || 'Could not add that.', 'error');
    });
  }

  function closeAction(id, state) {
    var row = document.querySelector('[data-act="' + id + '"]');
    var outcome = row ? row.querySelector('.kg-act__outcome').value.trim() : '';

    // The API refuses a 'done' with no outcome. Saying so here saves a round
    // trip and puts the message next to the box it is about.
    if (state === 'done' && !outcome) {
      actStatus('Write what happened before closing it — that is the part worth keeping.', 'error');
      return;
    }

    fetch('/api/knowledge/actions', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, state: state, outcome: outcome })
    }).then(readJson).then(function () {
      actStatus(state === 'done' ? 'Closed, and on the record.' : 'Dropped.');
      loadActions(true);
    }).catch(function (err) {
      actStatus(err.message || 'Could not close that.', 'error');
    });
  }

  /* ── Phone controls ────────────────────────────────────────────────
     The controls panel was taller than the canvas on a 400px screen, so
     the graph opened below the fold. Everything past the first row folds
     away behind More — still present, one tap off.

     Collapsed is the starting state on a phone only. On a wide screen the
     class is never applied, so the panel behaves exactly as it did. */

  function initGridControls() {
    var rowsSel = $('grid-rows');
    var colsSel = $('grid-cols');
    if (!rowsSel || !colsSel) return;

    function apply() {
      var wasOn = derivedLayout();
      grid.rows = rowsSel.value || null;
      grid.cols = colsSel.value || 'lane';

      // Two derived layouts cannot both own the coordinates. Choosing one
      // turns the other off rather than letting the last render win.
      if (grid.rows && tree.spine) {
        tree.spine = null;
        if ($('tree-spine')) $('tree-spine').value = '';
      }
      $('grid-rows-field').hidden = treeOn();

      // Columns are only a choice once there is something to cross them with.
      // Offering "Columns: Kind" while rows are off would produce a grid with
      // one row, which is the lane view with the lanes renamed.
      $('grid-cols-field').hidden = !gridOn();

      // Two facets that are the same facet make one column and one row per
      // value along a diagonal, with every other cell empty. Nudge rather
      // than forbid: the person is mid-thought.
      if (gridOn() && grid.cols === grid.rows) {
        grid.cols = grid.cols === 'lane' ? 'kind' : 'lane';
        colsSel.value = grid.cols;
        setStatus('Rows and columns need to be different things.');
      }

      if (wasOn && !derivedLayout()) restoreFreeLayout();

      // Dragging is off in a grid: positions are computed, so a node dragged
      // anywhere would snap back on the next render and look broken.
      svg.classList.toggle('is-grid', derivedLayout());
      svg.classList.toggle('is-tree', treeOn());

      render();
      fit();

      if (treeOn()) {
        var loose = treeGeom ? treeGeom.looseCount : 0;
        setStatus('Following "' + relLabel(tree.spine) + '". Fold a branch with the − beside it.' +
          (loose ? ' ' + loose + ' node' + (loose === 1 ? '' : 's') + ' sit outside this relation.' : ''));
      } else if (gridOn()) {
        setStatus(facetLabelFor(grid.cols) + ' across, ' + facetLabelFor(grid.rows) +
          ' down. Positions are worked out here, so nodes do not drag.');
      } else {
        setStatus('');
      }
    }

    rowsSel.addEventListener('change', apply);
    colsSel.addEventListener('change', apply);

    var spineSel = $('tree-spine');
    if (spineSel) {
      spineSel.addEventListener('change', function () {
        tree.spine = spineSel.value || null;
        collapsed = {};      // a fold belongs to the spine it was made on
        if (tree.spine) {
          grid.rows = null;
          rowsSel.value = '';
        }
        apply();
      });
    }
  }

  function relLabel(rel) {
    var d = pack.relations[rel];
    return d ? d.label : String(rel).replace(/_/g, ' ');
  }

  /* Populated after the graph loads: the options are the relations this map
     actually uses, commonest first. */
  function fillSpineOptions() {
    var sel = $('tree-spine');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">Off</option>' +
      spineCandidates().map(function (r) {
        return '<option value="' + esc(r) + '">' + esc(relLabel(r)) + '</option>';
      }).join('');
    if (current) sel.value = current;
  }

  function facetLabelFor(f) {
    return FACETS[f] ? FACETS[f].label.toLowerCase() : f;
  }

  function initPhoneControls() {
    var more = $('controls-more');
    var panel = $('map-controls');
    if (!more || !panel) return;

    var phone = window.matchMedia('(max-width: 700px)');

    function apply() {
      if (phone.matches) {
        panel.classList.add('is-collapsed');
        more.setAttribute('aria-expanded', 'false');
        more.textContent = 'More';
      } else {
        // Leaving the class on would hide half the controls the moment the
        // phone is turned sideways.
        panel.classList.remove('is-collapsed');
      }
    }

    apply();
    if (phone.addEventListener) phone.addEventListener('change', apply);

    more.addEventListener('click', function () {
      var open = panel.classList.toggle('is-collapsed') === false;
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.textContent = open ? 'Less' : 'More';
    });

    var full = $('go-full');
    if (full) {
      full.addEventListener('click', function () { toggleMapFull(true); });
    }
  }

  function initActions() {
    if (!$('act-add')) return;
    $('act-add').addEventListener('click', addAction);
    $('act-title').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); addAction(); }
    });
    $('act-open').addEventListener('click', function (ev) {
      var done = ev.target.closest('[data-act-done]');
      if (done) { closeAction(done.getAttribute('data-act-done'), 'done'); return; }
      var drop = ev.target.closest('[data-act-drop]');
      if (drop) closeAction(drop.getAttribute('data-act-drop'), 'dropped');
    });
  }

  /* Selecting in a grid changes which edges are lit, so the canvas has to be
     redrawn — in the lane view it does not, and re-rendering on every click
     there would be wasted work on a large map. */
  function afterSelectionChanged() {
    if (derivedLayout()) renderEdges();
  }

  function renderInspector() {
    var node = nodeById(selectedId);
    // Pane visibility lives in switchSheetTab so there is one place that
    // decides it; setting node-form.hidden here as well fought with it.
    switchSheetTab(sheetTab);
    if (!node) return;

    if (actionsFor && actionsFor !== node.id) actionsFor = null;

    $('node-status').textContent = node.status;
    $('node-status').className = 'kg-pill kg-pill-' + node.status;
    $('node-version').textContent = 'v' + (node.version || 1) +
      (node.approvedAt ? ' · approved ' + node.approvedAt.slice(0, 10) : '');

    $('f-title').value = node.title || '';
    $('f-kind').value = node.kind;
    if ($('f-scope')) {
      $('f-scope').value = node.scope || 'project';
      updateScopeHint();
    }
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
      scope: $('f-scope') ? $('f-scope').value : undefined,
      title: $('f-title').value.trim(),
      lane: $('f-lane').value,
      summary: $('f-summary').value.trim(),
      aliases: csvToList($('f-aliases').value),
      body: $('f-body').value,
      standards: csvToList($('f-standards').value),
      tags: csvToList($('f-tags').value),
      attributes: attrRows.filter(function (a) { return (a.name || '').trim(); }),
      // See authoredPos(): a save from grid view must not overwrite the
      // hand-placed layout with a derived one.
      x: authoredPos(node).x, y: authoredPos(node).y
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

  /**
   * Offer only the relations legal between these two kinds.
   *
   * Before this, every relation was offered for every pair, so a standard
   * could be made to "contain" a project. The graph accepted it, the map drew
   * it, and it stayed wrong until somebody noticed by eye.
   *
   * With no matrix loaded — an older database, or the types call failing — the
   * full pack list is offered and the server trigger stays the real gate. A
   * missing matrix must not leave the user unable to connect anything.
   */
  function refreshRelations() {
    var sel = $('c-relation');
    if (!sel) return;

    var from = nodeById(connectFrom);
    var to = nodeById($('c-target') ? $('c-target').value : null);
    var allowed = (from && to) ? legalRelations(from.kind, to.kind) : [];
    var hint = $('c-relation-hint');
    var current = sel.value;

    var list;
    if (!Object.keys(graphTypes.legal).length) {
      list = Object.keys(pack.relations);
      if (hint) hint.textContent = '';
    } else if (allowed.length) {
      list = allowed;
      if (hint) {
        hint.textContent = allowed.length + ' relation' + (allowed.length > 1 ? 's are' : ' is') +
          ' valid between ' + kindLabel(from.kind) + ' and ' + kindLabel(to.kind) + '.';
      }
    } else {
      list = [];
      if (hint && from && to) {
        hint.textContent = 'No relation is valid from ' + kindLabel(from.kind) + ' to ' +
          kindLabel(to.kind) + '. Change one of the kinds, or connect them the other way round.';
      }
    }

    sel.innerHTML = list.map(function (r) {
      var def = pack.relations[r];
      return '<option value="' + r + '">' + esc(def ? def.label : r.replace(/_/g, ' ')) + '</option>';
    }).join('');

    if (list.indexOf(current) !== -1) sel.value = current;
    var save = $('c-save');
    if (save) save.disabled = !list.length;
  }

  /**
   * Spell out what the chosen scope commits to.
   *
   * Scope is the one field on this form whose wrong answer is invisible later:
   * a value recorded once on one job reads exactly like a standing rule unless
   * something says otherwise at the moment of writing it.
   */
  function updateScopeHint() {
    var hint = $('f-scope-hint');
    if (!hint || !$('f-scope')) return;
    var v = $('f-scope').value;
    if (v === 'project') {
      hint.textContent = 'Recorded once, on one job. Compliance Maker will say so rather than quoting it as standard.';
    } else if (v === 'family') {
      hint.textContent = 'Holds across this product line, not only the job it came from.';
    } else {
      hint.textContent = 'True regardless of project or product line. Use this only for things that really are.';
    }
  }

  function kindLabel(kind) {
    var def = pack.nodeKinds[kind];
    if (def) return def.label.toLowerCase();
    for (var i = 0; i < graphTypes.kinds.length; i++) {
      if (graphTypes.kinds[i].kind === kind) return graphTypes.kinds[i].label.toLowerCase();
    }
    return kind;
  }

  function openConnect(fromId, toId) {
    connectFrom = fromId;
    editingEdgeId = null;
    $('c-target').innerHTML = nodes.filter(function (n) { return n.id !== fromId; })
      .map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + '</option>'; }).join('');
    if (toId) $('c-target').value = toId;
    refreshRelations();
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
    refreshRelations();
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
    // Coming back to the list with a stale title or a stale count is the kind
    // of small wrongness that makes a list view feel untrustworthy.
    if (currentView === 'outline') {
      loadOpenActionCounts().then(renderOutline);
    }
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
      if (paneName === 'actions' && name === 'actions' && hasNode) loadActions();
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
    // Before the node test: the control sits on top of the node group, and a
    // node-first test would swallow every tap on it.
    var fold = t.closest('[data-collapse]');
    if (fold) {
      var fid = fold.getAttribute('data-collapse');
      if (collapsed[fid]) delete collapsed[fid];
      else collapsed[fid] = true;
      render();
      return;
    }

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
      afterSelectionChanged();
      var p = toScene(ev.clientX, ev.clientY);
      // `moved` is what separates a tap from a drag. A tap focuses; a drag
      // repositions and must not also trigger focus on release.
      // canMove is false in a grid: the position is derived, so a dragged node
      // would snap back on the next render. Selecting still works.
      dragging = { id: id, dx: p.x - n.x, dy: p.y - n.y, moved: false,
                   canMove: canEdit() && !derivedLayout() };
      svg.setPointerCapture(ev.pointerId);
      renderNodes();
      renderInspector();
      return;
    }
    var e = t.closest('[data-edge-id]');
    if (e) { if (canEdit()) editEdge(e.getAttribute('data-edge-id')); return; }

    selectedId = null;
    // Focus is NOT cleared here. At pointerdown there is no way to tell a tap
    // on the background from the start of a pan, and clearing now meant that
    // dragging the canvas to see more of a focused node's neighbourhood threw
    // the focus away — exactly when you were using it. `moved` decides on
    // release, the same way it already does for nodes.
    panning = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y,
                moved: false, sx: ev.clientX, sy: ev.clientY };
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
      // 4px, not 0: a mouse rarely stays perfectly still between press and
      // release, and a thumb never does. Below this it is a tap.
      if (!panning.moved &&
          (Math.abs(ev.clientX - panning.sx) > 4 || Math.abs(ev.clientY - panning.sy) > 4)) {
        panning.moved = true;
      }
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
    // A tap on empty canvas still releases focus — that is how you get out of
    // it without hunting for the Show all button. A pan does not.
    if (panning && !panning.moved && focusId) clearFocus();

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

    // Populated per pair by refreshRelations(), not once at build time: which
    // relations are legal depends on what is being connected to what.
    refreshRelations();

    $('legend').innerHTML = lanes.map(function (l) {
      return '<span class="kg-legend-item"><span class="kg-legend-dot" style="background:var(' + l.token +
        ')"></span>' + esc(l.label) + '</span>';
    }).join('') + '<span class="kg-legend-item"><span class="kg-legend-dot" style="border:2px dashed var(--color-text-muted);background:none"></span>Dashed outline = not yet approved</span>';
  }

  function switchView(name) {
    currentView = name;
    try { localStorage.setItem('tn-kg-view:' + mapId, name); } catch (e) {}
    ['map', 'outline', 'health'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    // Scoped to the view switcher: the sheet has its own .kg-seg-btn tabs and
    // an unscoped query would clear their active state on every view change.
    document.querySelectorAll('#map-controls .kg-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('view-map').hidden = name !== 'map';
    // The Add palette and the lane legend describe the canvas. On the
    // outline they were a screen of chips above the first line.
    var palette = document.querySelector('.kg-palette');
    if (palette) palette.hidden = name !== 'map';
    if ($('legend')) $('legend').hidden = name !== 'map';
    if (name === 'map') fit();
    // The outline may have been skipped while a title was mid-edit or the
    // sheet was open; entering it draws it fresh from the current data.
    if (name === 'outline') { ol.dirty = false; renderOutline(); }
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

    /* Outline is a way of working, not a table of contents for the graph.
       Clicking a row used to throw you into the canvas and leave you to find
       the node you had just been looking at — which is the opposite of why
       anyone opens a list view. It opens the editor where you are.

       The sheet is the same editing surface the canvas uses, so there is one
       thing to keep working rather than two. "Show on map" is there for when
       the graph is what you actually wanted. */
    bindOutline();

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
    // Which relations are legal depends on the target, so the list is rebuilt
    // whenever the target changes rather than once when the dialog opens.
    if ($('c-target')) $('c-target').addEventListener('change', refreshRelations);
    if ($('f-scope')) $('f-scope').addEventListener('change', updateScopeHint);
    $('c-cancel').addEventListener('click', function () { $('connect-dialog').close(); });
    $('c-delete').addEventListener('click', async function () {
      if (!editingEdgeId) return;
      await fetch('/api/knowledge/graph?type=edge&id=' + encodeURIComponent(editingEdgeId) +
        '&map=' + encodeURIComponent(mapId), { method: 'DELETE' });
      $('connect-dialog').close();
      await reload();
    });

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

    $('tidy').addEventListener('click', function () {
      // Tidy writes positions. In a grid those positions are derived, so it
      // would either do nothing visible or quietly overwrite the layout you
      // arranged by hand — neither of which is what the button says.
      if (derivedLayout()) {
        setStatus('Tidy arranges the lane view. Turn Hierarchy off and set Rows to ' +
          '"Lanes only" first.');
        return;
      }
      layoutByLane(); render(); fit();
    });
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

  }

  function init() {
    svg = $('canvas'); scene = $('scene');
    gLanes = $('lanes'); gEdges = $('edges');
    gNodes = $('nodes'); gOverlay = $('overlay'); defs = $('defs');
    renderDefs();
    bind();
    initActions();
    initPhoneControls();
    initGridControls();
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
