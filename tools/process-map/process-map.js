/* =====================================================================
   Thinkneering — Process Map (HVAC equipment supply)
   Engine only. All field knowledge comes from domain-hvac.js via
   window.TN_PM_DOMAIN, so the engine can be pointed at another domain
   pack without changes.
   ===================================================================== */
(function () {
  'use strict';

  var D = window.TN_PM_DOMAIN;
  if (!D) { console.error('Process Map: domain pack not loaded'); return; }

  var CARD_TYPES = D.cardTypes;
  var STAGES = D.stages;

  var EDGE_KINDS = {
    flow:          { label: 'One-way flow',  token: '--color-text-muted', dash: '',    arrowEnd: true,  arrowStart: false, curve: false },
    conditional:   { label: 'Conditional',   token: '--color-primary',    dash: '',    arrowEnd: true,  arrowStart: false, curve: false },
    dependency:    { label: 'Dependency',    token: '--color-text-muted', dash: '6 5', arrowEnd: true,  arrowStart: false, curve: false },
    feedback:      { label: 'Feedback loop', token: '--color-accent',     dash: '',    arrowEnd: true,  arrowStart: false, curve: true  },
    bidirectional: { label: 'Two-way flow',  token: '--color-primary',    dash: '',    arrowEnd: true,  arrowStart: true,  curve: false },
    blocked:       { label: 'Blocked path',  token: '--color-danger',     dash: '3 4', arrowEnd: true,  arrowStart: false, curve: false }
  };

  var UNITS = {
    min:  { label: 'Minutes',       toDays: function (v) { return v / 1440; } },
    hour: { label: 'Hours',         toDays: function (v) { return v / 24; } },
    wd:   { label: 'Working days',  toDays: function (v, ww) { return v * (7 / (ww || 5)); } },
    cd:   { label: 'Calendar days', toDays: function (v) { return v; } }
  };

  var ICONS = {
    square:   'M5 5h14v14H5z',
    send:     'M22 2 11 13M22 2l-7 20-4-9-9-4z',
    file:     'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
    coin:     'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    check:    'M20 6 9 17l-5-5',
    truck:    'M1 3h15v13H1zM16 8h4l3 3v5h-7zM7.5 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20.5 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    pin:      'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    upload:   'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    bolt:     'M13 2 3 14h9l-1 8 10-12h-9z',
    split:    'M18 3h4v4M22 3l-7 7M3 21l7-7M6 21H3v-3',
    stamp:    'M5 22h14M6 18h12v-3H6zM9 15V9a3 3 0 1 1 6 0v6',
    flag:     'M4 22V4M4 4h13l-2 4 2 4H4',
    clock:    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    alert:    'M12 2 1 21h22zM12 9v5M12 18h.01',
    note:     'M4 4h16v12l-4 4H4zM16 20v-4h4'
  };

  var NODE_W = 214, NODE_H = 84, DIA_W = 200, DIA_H = 118;
  var LANE_W = 300, LANE_GAP = 40, ROW_H = 132, LANE_TOP = 90;
  var STORAGE_KEY = 'tn-process-map-hvac';
  var API_DATA = '/api/data/process-map';
  var API_AI = '/api/process-map/ai';

  /* ── State ─────────────────────────────────────────────────────── */

  var map = blankMap();
  var view = { x: 0, y: 0, k: 1 };
  var selectedId = null;
  var filterText = '';
  var showLanes = true;
  var linking = null, dragging = null, panning = null;
  var connectFrom = null, editingEdgeId = null;
  var dirty = false;

  var $ = function (id) { return document.getElementById(id); };
  var svg, scene, gLanes, gEdges, gNodes, gOverlay, defs, minimap;

  function blankMap() {
    return {
      id: uid('map'),
      title: '',
      project: {
        code: '', consultant: '', contractor: '', client: '',
        productLine: '', factory: '', workWeek: 5,
        startDate: '', requiredOnSite: ''
      },
      nodes: [], edges: [], updatedAt: null
    };
  }

  /* ── Utilities ─────────────────────────────────────────────────── */

  function uid(p) { return (p || 'id') + '-' + Math.random().toString(36).slice(2, 9); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function token(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  }

  function nodeById(id) {
    for (var i = 0; i < map.nodes.length; i++) if (map.nodes[i].id === id) return map.nodes[i];
    return null;
  }

  function stageById(id) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return STAGES[i];
    return null;
  }

  function typeDef(node) { return CARD_TYPES[node.type] || CARD_TYPES.step; }

  function colourOf(node) {
    var def = typeDef(node);
    if (def.colour !== 'stage') return 'var(' + def.colour + ')';
    var st = stageById(node.stage);
    return 'var(' + (st ? st.token : '--color-text-muted') + ')';
  }

  function workWeek() { return Number(map.project.workWeek) || 5; }

  function calendarDays(node) {
    if (!node.lead || !Number(node.lead.value)) return 0;
    var unit = UNITS[node.lead.unit] || UNITS.wd;
    return unit.toDays(Number(node.lead.value), workWeek());
  }

  function fmtDays(days) {
    if (!days) return '0 d';
    if (days < 1) return Math.round(days * 24) + ' h';
    var d = Math.round(days * 10) / 10;
    if (d >= 30) return Math.round(d) + ' d (' + (Math.round((d / 30.4) * 10) / 10) + ' mo)';
    return d + ' d';
  }

  function leadLabel(node) {
    if (!node.lead || !Number(node.lead.value)) return '';
    var u = node.lead.unit;
    var suffix = u === 'wd' ? ' wd' : u === 'cd' ? ' cd' : u === 'hour' ? ' h' : ' min';
    return Number(node.lead.value) + suffix;
  }

  function addDays(date, days) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + Math.round(days));
    return d;
  }

  function fmtDate(d) {
    if (!d || isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function wrapText(text, maxChars, maxLines) {
    var words = String(text || 'Untitled').split(/\s+/);
    var lines = [], cur = '';
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

  function outgoing(id) { return map.edges.filter(function (e) { return e.from === id; }); }
  function incoming(id) { return map.edges.filter(function (e) { return e.to === id; }); }

  /* ── Model ─────────────────────────────────────────────────────── */

  function makeNode(type, stage, x, y) {
    var def = CARD_TYPES[type] || CARD_TYPES.step;
    return {
      id: uid('n'), type: type || 'step', stage: stage || 'engineering',
      title: 'New ' + def.label.toLowerCase(),
      description: '', notes: '', tags: [], party: '', owner: '',
      docRef: '', standards: [],
      lead: { value: '', unit: 'wd' },
      aiSummary: '', x: x, y: y
    };
  }

  function addNode(type) {
    var c = centreOfView();
    var sel = selectedId ? nodeById(selectedId) : null;
    var node = makeNode(type, sel ? sel.stage : 'engineering', Math.round(c.x), Math.round(c.y));
    map.nodes.push(node);
    selectedId = node.id;
    touch(); render(); focusInspector();
  }

  function addNextStep(fromId) {
    var from = nodeById(fromId);
    if (!from) return;
    var node = makeNode('step', from.stage, from.x, from.y + ROW_H);
    var guard = 0;
    while (guard < 30 && map.nodes.some(function (n) {
      return Math.abs(n.x - node.x) < 80 && Math.abs(n.y - node.y) < 90;
    })) { node.y += ROW_H; guard++; }
    map.nodes.push(node);
    map.edges.push({ id: uid('e'), from: from.id, to: node.id, kind: 'flow', label: '' });
    selectedId = node.id;
    touch(); render(); focusInspector();
  }

  function connect(fromId, toId, kind, label) {
    if (!fromId || !toId || fromId === toId) return;
    if (map.edges.some(function (e) { return e.from === fromId && e.to === toId; })) return;
    map.edges.push({ id: uid('e'), from: fromId, to: toId, kind: kind || 'flow', label: label || '' });
    touch(); render();
  }

  function deleteNode(id) {
    map.nodes = map.nodes.filter(function (n) { return n.id !== id; });
    map.edges = map.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    if (selectedId === id) selectedId = null;
    touch(); render();
  }

  function touch() {
    dirty = true;
    map.updatedAt = new Date().toISOString();
    setStatus('Unsaved changes');
    saveLocal();
  }

  /* ── Templates ─────────────────────────────────────────────────── */

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  function loadTemplate(templateId) {
    var tpl = D.templates.filter(function (t) { return t.id === templateId; })[0];
    if (!tpl) return;

    var fresh = blankMap();
    fresh.title = tpl.name;
    Object.keys(tpl.project || {}).forEach(function (k) { fresh.project[k] = tpl.project[k]; });
    // Carry over anything the user already typed about this project.
    fresh.project.startDate = map.project.startDate || todayIso();
    fresh.project.requiredOnSite = map.project.requiredOnSite || '';
    fresh.project.consultant = map.project.consultant || '';
    fresh.project.contractor = map.project.contractor || '';
    fresh.project.code = map.project.code || '';

    var byRef = {};
    tpl.cards.forEach(function (c) {
      var node = makeNode(c.type, c.stage, 0, 0);
      node.title = c.title;
      node.description = c.desc || '';
      node.party = c.party || '';
      node.tags = (c.tags || []).slice();
      node.standards = (c.standards || []).slice();
      node.lead = { value: c.lead === undefined ? '' : c.lead, unit: c.unit || 'wd' };
      byRef[c.ref] = node;
      fresh.nodes.push(node);
    });

    (tpl.links || []).forEach(function (l) {
      var a = byRef[l[0]], b = byRef[l[1]];
      if (!a || !b) return;
      fresh.edges.push({ id: uid('e'), from: a.id, to: b.id, kind: l[2] || 'flow', label: l[3] || '' });
    });

    map = fresh;
    selectedId = null;
    layoutByStage();
    syncProjectFields();
    touch();
    setStatus('Template loaded — ' + tpl.name);
    render();
    fitToScreen();
  }

  /* ── Layout ────────────────────────────────────────────────────── */

  function laneLeft(index) { return LANE_TOP + index * (LANE_W + LANE_GAP); }
  function laneX(index) { return laneLeft(index) + LANE_W / 2; }

  function computeDepth() {
    var incomingCount = {}, out = {}, depth = {};
    map.nodes.forEach(function (n) { incomingCount[n.id] = 0; out[n.id] = []; });
    map.edges.forEach(function (e) {
      if (e.kind === 'feedback') return;
      if (out[e.from] && incomingCount[e.to] !== undefined) { out[e.from].push(e.to); incomingCount[e.to]++; }
    });
    var queue = [];
    map.nodes.forEach(function (n) { if (!incomingCount[n.id]) { depth[n.id] = 0; queue.push(n.id); } });
    if (!queue.length && map.nodes.length) { depth[map.nodes[0].id] = 0; queue.push(map.nodes[0].id); }
    var guard = 0;
    while (queue.length && guard < 8000) {
      guard++;
      var id = queue.shift();
      out[id].forEach(function (next) {
        var d = depth[id] + 1;
        if (depth[next] === undefined || depth[next] < d) { depth[next] = d; queue.push(next); }
      });
    }
    map.nodes.forEach(function (n) { if (depth[n.id] === undefined) depth[n.id] = 0; });
    return depth;
  }

  function layoutByStage() {
    var depth = computeDepth();
    STAGES.forEach(function (st, i) {
      map.nodes.filter(function (n) { return n.stage === st.id; })
        .sort(function (a, b) { return (depth[a.id] || 0) - (depth[b.id] || 0); })
        .forEach(function (n, row) {
          n.x = laneX(i);
          n.y = LANE_TOP + 70 + row * ROW_H;
        });
    });
    map.nodes.filter(function (n) { return !stageById(n.stage); })
      .forEach(function (n, row) {
        n.x = laneX(STAGES.length);
        n.y = LANE_TOP + 70 + row * ROW_H;
      });
  }

  /* ── Critical path and delivery forecast ───────────────────────── */

  function longestPathDays() {
    var memo = {}, visiting = {}, next = {};
    function walk(id) {
      if (visiting[id]) return 0;
      if (memo[id] !== undefined) return memo[id];
      visiting[id] = true;
      var best = 0, bestId = null;
      outgoing(id).forEach(function (e) {
        if (e.kind === 'feedback' || e.kind === 'blocked') return;
        var v = walk(e.to);
        if (v > best) { best = v; bestId = e.to; }
      });
      visiting[id] = false;
      next[id] = bestId;
      var node = nodeById(id);
      memo[id] = best + (node ? calendarDays(node) : 0);
      return memo[id];
    }
    var top = 0, startId = null;
    map.nodes.forEach(function (n) {
      var v = walk(n.id);
      if (v > top) { top = v; startId = n.id; }
    });
    var path = [], cursor = startId, guard = 0;
    while (cursor && guard < 500) { path.push(cursor); cursor = next[cursor]; guard++; }
    return { days: top, path: path };
  }

  function forecast() {
    var cp = longestPathDays();
    var start = map.project.startDate ? new Date(map.project.startDate) : null;
    var required = map.project.requiredOnSite ? new Date(map.project.requiredOnSite) : null;
    var finish = (start && !isNaN(start.getTime())) ? addDays(start, cp.days) : null;
    var slack = null;
    if (finish && required && !isNaN(required.getTime())) {
      slack = Math.round((required.getTime() - finish.getTime()) / 86400000);
    }
    return { days: cp.days, path: cp.path, start: start, finish: finish, required: required, slack: slack };
  }

  /* ── Health ────────────────────────────────────────────────────── */

  function ruleContext(f) {
    var byId = {};
    map.nodes.forEach(function (n) { byId[n.id] = n; });
    return {
      nodes: map.nodes, edges: map.edges, byId: byId,
      project: map.project, slackDays: f.slack,
      outgoing: outgoing, incoming: incoming, calendarDays: calendarDays
    };
  }

  function computeHealth(f) {
    if (!map.nodes.length) return { score: null, findings: [] };
    var score = 100, findings = [];

    var documented = map.nodes.filter(function (n) { return (n.description || '').trim().length > 15; }).length;
    var coverage = Math.round((documented / map.nodes.length) * 100);
    if (coverage < 60) {
      var pts = Math.min(12, Math.round((60 - coverage) / 4));
      if (pts > 0) {
        score -= pts;
        findings.push({ weight: pts, message: 'Only ' + coverage + '% of cards carry a real description',
          fix: 'A card nobody can act on from its description will not survive a handover.' });
      }
    }

    var deadEnds = map.nodes.filter(function (n) {
      return n.type !== 'output' && n.type !== 'milestone' && n.type !== 'note' &&
             n.type !== 'stopper' && !outgoing(n.id).length;
    });
    if (deadEnds.length) {
      var d = Math.min(12, deadEnds.length * 4);
      score -= d;
      findings.push({ weight: d, message: deadEnds.length + ' card' + (deadEnds.length > 1 ? 's lead' : ' leads') + ' nowhere',
        fix: 'Connect them, or mark them as a deliverable so the flow ends deliberately.' });
    }

    var stoppers = map.nodes.filter(function (n) { return n.type === 'stopper'; }).length;
    if (stoppers) {
      var s = Math.min(18, stoppers * 5);
      score -= s;
      findings.push({ weight: s, message: stoppers + ' stopper card' + (stoppers > 1 ? 's' : '') + ' in the flow',
        fix: 'Each one is a known way this order stalls. Worth a mitigation, not just a label.' });
    }

    var ctx = ruleContext(f);
    D.rules.forEach(function (rule) {
      var hit = null;
      try { hit = rule.test(ctx); } catch (err) { hit = null; }
      if (!hit) return;
      score -= hit.weight;
      findings.push(hit);
    });

    findings.sort(function (a, b) { return b.weight - a.weight; });
    return { score: Math.max(0, Math.min(100, Math.round(score))), findings: findings };
  }

  /* ── Rendering ─────────────────────────────────────────────────── */

  function renderDefs() {
    var html = '', used = {};
    Object.keys(EDGE_KINDS).forEach(function (k) {
      var tok = EDGE_KINDS[k].token;
      if (used[tok]) return;
      used[tok] = true;
      var key = tok.replace(/[^a-z]/g, '');
      html += '<marker id="pm-arrow-' + key + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
              '<path d="M0 0 L10 5 L0 10 z" style="fill:var(' + tok + ')"></path></marker>' +
              '<marker id="pm-arrow-start-' + key + '" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
              '<path d="M10 0 L0 5 L10 10 z" style="fill:var(' + tok + ')"></path></marker>';
    });
    defs.innerHTML = html;
  }

  function matchesFilter(node) {
    if (!filterText) return true;
    var hay = [node.title, node.description, node.notes, node.party, node.docRef,
               (node.tags || []).join(' '), (node.standards || []).join(' '),
               node.type, node.stage].join(' ').toLowerCase();
    return hay.indexOf(filterText) !== -1;
  }

  function render() {
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    renderLanes();
    renderEdges();
    renderNodes();
    renderMinimap();
    renderOutline();
    renderTimeline();
    renderResults();
    renderInspector();
    $('pm-empty').hidden = map.nodes.length > 0;
  }

  function renderLanes() {
    if (!showLanes || !map.nodes.length) { gLanes.innerHTML = ''; return; }
    var maxY = Math.max.apply(null, map.nodes.map(function (n) { return n.y; }).concat([400]));
    var height = maxY + 160;
    var html = '';
    STAGES.forEach(function (st, i) {
      var left = laneLeft(i);
      html += '<rect x="' + left + '" y="' + (LANE_TOP - 46) + '" width="' + LANE_W + '" height="' + height +
              '" rx="16" style="fill:var(' + st.token + ');opacity:.05"></rect>' +
              '<rect x="' + left + '" y="' + (LANE_TOP - 46) + '" width="' + LANE_W + '" height="30" rx="10" ' +
              'style="fill:var(' + st.token + ');opacity:.14"></rect>' +
              '<text class="pm-lane-label" style="fill:var(' + st.token + ')" x="' + (left + 14) + '" y="' +
              (LANE_TOP - 26) + '">' + esc(st.label.toUpperCase()) + '</text>';
    });
    gLanes.innerHTML = html;
  }

  function renderNodes() {
    var f = forecast();
    var onPath = {};
    f.path.forEach(function (id) { onPath[id] = true; });

    var html = '';
    map.nodes.forEach(function (node) {
      var def = typeDef(node);
      var diamond = def.shape === 'diamond';
      var s = diamond ? { w: DIA_W, h: DIA_H } : { w: NODE_W, h: NODE_H };
      var colour = colourOf(node);
      var cls = 'pm-node' + (node.id === selectedId ? ' is-selected' : '') +
                (matchesFilter(node) ? '' : ' is-dimmed') +
                (onPath[node.id] ? ' is-critical' : '');
      var titleLines = wrapText(node.title, diamond ? 17 : 25, 2);

      html += '<g class="' + cls + '" data-node-id="' + node.id + '" tabindex="0" role="button" aria-label="' +
              esc(def.label + ' in ' + (stageById(node.stage) ? stageById(node.stage).label : 'no stage') +
                  ': ' + node.title) + '">';

      if (diamond) {
        html += '<polygon class="pm-node-box" style="stroke:' + colour + '" points="' +
                [node.x + ',' + (node.y - s.h / 2), (node.x + s.w / 2) + ',' + node.y,
                 node.x + ',' + (node.y + s.h / 2), (node.x - s.w / 2) + ',' + node.y].join(' ') + '"></polygon>' +
                '<text class="pm-node-kind" style="fill:' + colour + '" x="' + node.x + '" y="' + (node.y - 26) +
                '" text-anchor="middle">' + esc(def.label) + '</text>';
      } else {
        html += '<rect class="pm-node-box" style="stroke:' + colour + '" rx="12" ry="12" x="' + (node.x - s.w / 2) +
                '" y="' + (node.y - s.h / 2) + '" width="' + s.w + '" height="' + s.h + '"></rect>' +
                '<rect x="' + (node.x - s.w / 2 + 1) + '" y="' + (node.y - s.h / 2 + 14) + '" width="5" height="' +
                (s.h - 28) + '" rx="2" style="fill:' + colour + '"></rect>';
        var ix = node.x - s.w / 2 + 18, iy = node.y - s.h / 2 + 12;
        html += '<g transform="translate(' + ix + ',' + iy + ') scale(0.5)" style="stroke:' + colour +
                ';stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round">' +
                '<path d="' + (ICONS[def.icon] || ICONS.square) + '"></path></g>' +
                '<text class="pm-node-kind" style="fill:' + colour + '" x="' + (ix + 20) + '" y="' + (iy + 10) +
                '">' + esc(def.label) + '</text>';
      }

      var titleTop = diamond ? node.y - 2 : node.y + 2;
      titleLines.forEach(function (line, i) {
        html += '<text class="pm-node-title" x="' + node.x + '" y="' + (titleTop + i * 17) +
                '" text-anchor="middle">' + esc(line) + '</text>';
      });

      if (!diamond) {
        var meta = [];
        if (node.party) meta.push(node.party.split(' — ')[0].split(' / ')[0]);
        var ll = leadLabel(node);
        if (ll) meta.push(ll);
        if (meta.length) {
          html += '<text class="pm-node-meta" x="' + node.x + '" y="' + (node.y + s.h / 2 - 9) +
                  '" text-anchor="middle">' + esc(meta.join('   ·   ')) + '</text>';
        }
        if (node.docRef) {
          html += '<text class="pm-node-meta" x="' + (node.x + s.w / 2 - 10) + '" y="' + (node.y - s.h / 2 + 20) +
                  '" text-anchor="end">' + esc(node.docRef) + '</text>';
        }
      }

      if (node.id === selectedId) {
        html += '<circle class="pm-handle" data-handle="' + node.id + '" r="7" cx="' + (node.x + s.w / 2 + 4) +
                '" cy="' + node.y + '"></circle>' +
                '<g data-add-next="' + node.id + '" style="cursor:pointer">' +
                '<circle r="10" cx="' + node.x + '" cy="' + (node.y + s.h / 2 + 16) +
                '" style="fill:var(--color-surface);stroke:var(--color-primary);stroke-width:2"></circle>' +
                '<path d="M' + (node.x - 5) + ' ' + (node.y + s.h / 2 + 16) + ' h10 M' + node.x + ' ' +
                (node.y + s.h / 2 + 11) + ' v10" style="stroke:var(--color-primary);stroke-width:2;' +
                'stroke-linecap:round;fill:none"></path></g>';
      }
      html += '</g>';
    });
    gNodes.innerHTML = html;
  }

  function borderPoint(node, tx, ty) {
    var def = typeDef(node);
    var s = def.shape === 'diamond' ? { w: DIA_W, h: DIA_H } : { w: NODE_W, h: NODE_H };
    var dx = tx - node.x, dy = ty - node.y;
    if (!dx && !dy) return { x: node.x, y: node.y };
    var hw = s.w / 2 + 4, hh = s.h / 2 + 4, t;
    if (def.shape === 'diamond') {
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    } else {
      var a = Math.abs(dx) > 0.0001 ? hw / Math.abs(dx) : Infinity;
      var b = Math.abs(dy) > 0.0001 ? hh / Math.abs(dy) : Infinity;
      t = Math.min(a, b);
    }
    return { x: node.x + dx * t, y: node.y + dy * t };
  }

  function renderEdges() {
    var html = '';
    map.edges.forEach(function (edge) {
      var a = nodeById(edge.from), b = nodeById(edge.to);
      if (!a || !b) return;
      var def = EDGE_KINDS[edge.kind] || EDGE_KINDS.flow;
      var key = def.token.replace(/[^a-z]/g, '');
      var p1 = borderPoint(a, b.x, b.y), p2 = borderPoint(b, a.x, a.y);
      var d, midX, midY;

      if (def.curve) {
        var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        var nx = -(p2.y - p1.y), ny = (p2.x - p1.x);
        var len = Math.hypot(nx, ny) || 1, off = 80;
        d = 'M' + p1.x + ' ' + p1.y + ' Q' + (mx + nx / len * off) + ' ' + (my + ny / len * off) +
            ' ' + p2.x + ' ' + p2.y;
        midX = mx + nx / len * off * 0.5;
        midY = my + ny / len * off * 0.5;
      } else {
        d = 'M' + p1.x + ' ' + p1.y + ' L' + p2.x + ' ' + p2.y;
        midX = (p1.x + p2.x) / 2;
        midY = (p1.y + p2.y) / 2;
      }

      var style = 'stroke:var(' + def.token + ')' + (def.dash ? ';stroke-dasharray:' + def.dash : '');
      var markers = (def.arrowEnd ? ' marker-end="url(#pm-arrow-' + key + ')"' : '') +
                    (def.arrowStart ? ' marker-start="url(#pm-arrow-start-' + key + ')"' : '');

      html += '<path class="pm-edge-hit" data-edge-id="' + edge.id + '" d="' + d + '"></path>' +
              '<path class="pm-edge-path" style="' + style + '" d="' + d + '"' + markers + '></path>';

      if (edge.kind === 'blocked') {
        html += '<circle cx="' + midX + '" cy="' + midY + '" r="8" style="fill:var(--color-surface);' +
                'stroke:var(--color-danger);stroke-width:2"></circle>' +
                '<path d="M' + (midX - 4) + ' ' + (midY - 4) + ' l8 8 M' + (midX + 4) + ' ' + (midY - 4) +
                ' l-8 8" style="stroke:var(--color-danger);stroke-width:2"></path>';
      }
      if (edge.label) {
        var w = edge.label.length * 6.2 + 14;
        html += '<rect class="pm-edge-label-bg" x="' + (midX - w / 2) + '" y="' + (midY - 9) + '" width="' + w +
                '" height="18" rx="6"></rect><text class="pm-edge-label" x="' + midX + '" y="' + (midY + 4) +
                '" text-anchor="middle">' + esc(edge.label) + '</text>';
      }
    });
    gEdges.innerHTML = html;
  }

  function renderMinimap() {
    if (!minimap) return;
    if (!map.nodes.length) { minimap.innerHTML = ''; return; }
    var xs = map.nodes.map(function (n) { return n.x; }), ys = map.nodes.map(function (n) { return n.y; });
    var pad = 220;
    var minX = Math.min.apply(null, xs) - pad, maxX = Math.max.apply(null, xs) + pad;
    var minY = Math.min.apply(null, ys) - pad, maxY = Math.max.apply(null, ys) + pad;
    minimap.setAttribute('viewBox', minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY));
    var html = '';
    map.nodes.forEach(function (n) {
      html += '<rect x="' + (n.x - 100) + '" y="' + (n.y - 40) + '" width="200" height="80" rx="14" style="fill:' +
              colourOf(n) + ';opacity:.75"></rect>';
    });
    var r = svg.getBoundingClientRect();
    html += '<rect x="' + (-view.x / view.k) + '" y="' + (-view.y / view.k) + '" width="' + (r.width / view.k) +
            '" height="' + (r.height / view.k) + '" style="fill:none;stroke:var(--color-primary);stroke-width:8"></rect>';
    minimap.innerHTML = html;
  }

  /* ── Results ───────────────────────────────────────────────────── */

  function renderResults() {
    var f = forecast();
    var health = computeHealth(f);

    var cls = 'is-neutral';
    var slackText = 'Set a start date and a required-on-site date to forecast delivery.';
    if (f.slack !== null) {
      if (f.slack >= 14) { cls = 'is-good'; slackText = f.slack + ' days of float against the required date'; }
      else if (f.slack >= 0) { cls = 'is-warn'; slackText = 'Only ' + f.slack + ' days of float — one resubmittal absorbs that'; }
      else { cls = 'is-bad'; slackText = Math.abs(f.slack) + ' days late against the required date'; }
    }
    $('pm-forecast').className = 'pm-forecast ' + cls;
    $('pm-forecast-lead').textContent = fmtDays(f.days);
    $('pm-forecast-date').textContent = fmtDate(f.finish);
    $('pm-forecast-required').textContent = fmtDate(f.required);
    $('pm-forecast-slack').textContent = slackText;

    $('pm-score').querySelector('.pm-score-value').textContent = health.score === null ? '—' : health.score;
    $('pm-score').setAttribute('aria-label', 'Process health ' +
      (health.score === null ? 'not available' : health.score + ' out of 100'));

    $('pm-findings').innerHTML = health.findings.length
      ? health.findings.map(function (fi) {
          return '<li class="pm-finding"><span class="pm-finding-weight">−' + fi.weight + '</span>' +
                 '<span class="pm-finding-body"><strong>' + esc(fi.message) + '</strong>' +
                 (fi.fix ? '<span class="pm-muted">' + esc(fi.fix) + '</span>' : '') + '</span></li>';
        }).join('')
      : '<li class="pm-muted">Nothing flagged — every check in the supply rule set passed.</li>';

    var byStage = STAGES.map(function (st) {
      var nodes = map.nodes.filter(function (n) { return n.stage === st.id; });
      return { st: st, count: nodes.length, days: nodes.reduce(function (s, n) { return s + calendarDays(n); }, 0) };
    }).filter(function (r) { return r.count; });

    if (byStage.length) {
      var maxDays = Math.max.apply(null, byStage.map(function (x) { return x.days; })) || 1;
      $('pm-stage-breakdown').innerHTML = byStage.map(function (r) {
        return '<div class="pm-tl-row"><span class="pm-tl-name">' + esc(r.st.label) +
          ' <span class="pm-muted">(' + r.count + ')</span></span>' +
          '<span class="pm-tl-track"><span class="pm-tl-fill" style="width:' +
          Math.max(3, Math.round(r.days / maxDays * 100)) + '%;background:var(' + r.st.token + ')"></span></span>' +
          '<span class="pm-tl-value">' + esc(fmtDays(r.days)) + '</span></div>';
      }).join('');
    } else {
      $('pm-stage-breakdown').innerHTML = '<p class="pm-muted">No cards yet.</p>';
    }

    var waitDays = map.nodes.filter(function (n) { return n.type === 'waiting' || n.type === 'approval'; })
      .reduce(function (s, n) { return s + calendarDays(n); }, 0);
    var totalDays = map.nodes.reduce(function (s, n) { return s + calendarDays(n); }, 0);
    var documented = map.nodes.filter(function (n) { return (n.description || '').trim().length > 15; }).length;

    var rows = [
      ['Cards', map.nodes.length],
      ['Connections', map.edges.length],
      ['Approval gates', map.nodes.filter(function (n) { return n.type === 'approval'; }).length],
      ['Stoppers', map.nodes.filter(function (n) { return n.type === 'stopper'; }).length],
      ['Critical path', fmtDays(f.days)],
      ['Waiting on others', fmtDays(waitDays)],
      ['Waiting share', totalDays ? Math.round(waitDays / totalDays * 100) + '%' : '—'],
      ['Documentation', map.nodes.length ? Math.round(documented / map.nodes.length * 100) + '%' : '—']
    ];
    $('pm-metrics').innerHTML = rows.map(function (r) {
      return '<div class="pm-metric"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('');
  }

  function standardLabel(id) {
    var s = D.standards.filter(function (x) { return x.id === id; })[0];
    return s ? s.label : id;
  }

  function renderOutline() {
    var host = $('pm-outline');
    if (!map.nodes.length) { host.innerHTML = '<p class="pm-muted">No cards yet.</p>'; return; }
    var html = '';
    STAGES.concat([{ id: null, label: 'Unassigned', token: '--color-text-muted' }]).forEach(function (st) {
      var nodes = map.nodes.filter(function (n) { return st.id ? n.stage === st.id : !stageById(n.stage); });
      if (!nodes.length) return;
      html += '<h3 class="pm-outline-stage" style="color:var(' + st.token + ')">' + esc(st.label) + '</h3>' +
              '<ol class="pm-outline-list">';
      nodes.forEach(function (n) {
        var meta = [typeDef(n).label];
        if (n.party) meta.push(n.party);
        if (leadLabel(n)) meta.push(leadLabel(n));
        if (n.docRef) meta.push(n.docRef);
        html += '<li><span class="pm-outline-bar" style="background:' + colourOf(n) + '" aria-hidden="true"></span>' +
          '<div class="pm-outline-body"><p class="pm-outline-title">' +
          '<button type="button" data-goto="' + n.id + '">' + esc(n.title) + '</button></p>' +
          '<p class="pm-outline-meta">' + esc(meta.join(' · ')) + '</p>' +
          (n.description ? '<p class="pm-muted">' + esc(n.description) + '</p>' : '') +
          ((n.standards || []).length ? '<p class="pm-outline-meta">Standards: ' +
            esc(n.standards.map(standardLabel).join(', ')) + '</p>' : '') +
          '</div></li>';
      });
      html += '</ol>';
    });
    host.innerHTML = html;
  }

  function renderTimeline() {
    var host = $('pm-timeline');
    var f = forecast();
    if (!f.path.length) { host.innerHTML = '<p class="pm-muted">Add lead times to build the critical path.</p>'; return; }

    var running = (f.start && !isNaN(f.start.getTime())) ? new Date(f.start.getTime()) : null;
    var html = '<p class="pm-muted">The longest chain through the process. Everything else has float; this does not.</p><ol class="pm-crit">';
    f.path.forEach(function (id) {
      var n = nodeById(id);
      if (!n) return;
      var days = calendarDays(n);
      var startTxt = running ? fmtDate(running) : '';
      if (running) running = addDays(running, days);
      var endTxt = running ? fmtDate(running) : '';
      html += '<li style="border-left-color:' + colourOf(n) + '"><strong>' + esc(n.title) + '</strong>' +
        '<span class="pm-outline-meta">' + esc(typeDef(n).label) + (n.party ? ' · ' + esc(n.party) : '') +
        ' · ' + esc(fmtDays(days)) + (startTxt ? ' · ' + esc(startTxt) + ' → ' + esc(endTxt) : '') + '</span></li>';
    });
    html += '</ol><p class="pm-tl-total">Critical path: ' + esc(fmtDays(f.days)) +
            (f.finish ? ' · forecast on site ' + esc(fmtDate(f.finish)) : '') + '</p>';
    host.innerHTML = html;
  }

  /* ── Inspector ─────────────────────────────────────────────────── */

  function renderInspector() {
    var node = nodeById(selectedId);
    $('pm-inspector-empty').hidden = !!node;
    $('pm-form').hidden = !node;
    if (!node) return;

    $('f-type').value = node.type;
    $('f-stage').value = node.stage || '';
    $('f-title').value = node.title || '';
    $('f-desc').value = node.description || '';
    $('f-party').value = node.party || '';
    $('f-owner').value = node.owner || '';
    $('f-docref').value = node.docRef || '';
    $('f-lead').value = node.lead ? node.lead.value : '';
    $('f-unit').value = node.lead ? node.lead.unit : 'wd';
    $('f-tags').value = (node.tags || []).join(', ');
    $('f-notes').value = node.notes || '';

    $('f-standards').innerHTML = D.standards.map(function (s) {
      var on = (node.standards || []).indexOf(s.id) !== -1;
      return '<label class="pm-check"><input type="checkbox" value="' + s.id + '"' + (on ? ' checked' : '') +
        '><span>' + esc(s.label) + '</span></label>';
    }).join('');

    $('pm-ai-summary').hidden = !node.aiSummary;
    $('pm-ai-summary-text').textContent = node.aiSummary || '';
  }

  function readInspector() {
    var node = nodeById(selectedId);
    if (!node) return;
    node.type = $('f-type').value;
    node.stage = $('f-stage').value;
    node.title = $('f-title').value.trim() || 'Untitled';
    node.description = $('f-desc').value;
    node.party = $('f-party').value;
    node.owner = $('f-owner').value.trim();
    node.docRef = $('f-docref').value.trim();
    node.lead = { value: $('f-lead').value, unit: $('f-unit').value };
    node.tags = $('f-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    node.notes = $('f-notes').value;
    node.standards = Array.prototype.slice
      .call($('f-standards').querySelectorAll('input:checked'))
      .map(function (i) { return i.value; });
    touch();
    renderLanes(); renderEdges(); renderNodes(); renderMinimap();
    renderOutline(); renderTimeline(); renderResults();
  }

  function focusInspector() {
    var t = $('f-title');
    if (t && !$('pm-form').hidden) { t.focus(); t.select(); }
  }

  function syncProjectFields() {
    $('pm-title').value = map.title || '';
    $('p-code').value = map.project.code || '';
    $('p-consultant').value = map.project.consultant || '';
    $('p-contractor').value = map.project.contractor || '';
    $('p-product').value = map.project.productLine || '';
    $('p-factory').value = map.project.factory || '';
    $('p-start').value = map.project.startDate || '';
    $('p-required').value = map.project.requiredOnSite || '';
    $('p-workweek').value = String(map.project.workWeek || 5);
  }

  function readProjectFields() {
    map.title = $('pm-title').value;
    map.project.code = $('p-code').value.trim();
    map.project.consultant = $('p-consultant').value.trim();
    map.project.contractor = $('p-contractor').value.trim();
    map.project.productLine = $('p-product').value;
    map.project.factory = $('p-factory').value;
    map.project.startDate = $('p-start').value;
    map.project.requiredOnSite = $('p-required').value;
    map.project.workWeek = Number($('p-workweek').value) || 5;
    touch();
    renderResults();
    renderTimeline();
  }

  /* ── Persistence ───────────────────────────────────────────────── */

  function setStatus(t) { $('pm-status').textContent = t; }

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (e) { /* private mode */ }
  }

  function normalise(m) {
    m.edges = m.edges || [];
    var base = blankMap().project;
    var proj = m.project || {};
    Object.keys(base).forEach(function (k) { if (proj[k] === undefined) proj[k] = base[k]; });
    m.project = proj;
    m.nodes.forEach(function (n) {
      n.lead = n.lead || { value: '', unit: 'wd' };
      n.tags = n.tags || [];
      n.standards = n.standards || [];
      if (!CARD_TYPES[n.type]) n.type = 'step';
      if (!stageById(n.stage)) n.stage = 'engineering';
    });
    return m;
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var p = JSON.parse(raw);
      if (!p || !Array.isArray(p.nodes) || !p.nodes.length) return false;
      map = normalise(p);
      return true;
    } catch (e) { return false; }
  }

  async function saveRemote() {
    setStatus('Saving…');
    var payload = JSON.parse(JSON.stringify(map));
    payload.health = computeHealth(forecast()).score;
    try {
      var res = await fetch(API_DATA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.status === 401) { setStatus('Saved on this device — sign in to sync'); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      dirty = false;
      setStatus('Saved ' + new Date().toLocaleTimeString());
    } catch (e) {
      setStatus('Saved on this device only');
    }
  }

  async function loadRemote() {
    try {
      var res = await fetch(API_DATA, { headers: { Accept: 'application/json' } });
      if (!res.ok) return false;
      var body = await res.json();
      var data = body && body.data ? body.data : body;
      if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return false;
      map = normalise(data);
      setStatus('Loaded from your account');
      return true;
    } catch (e) { return false; }
  }

  /* ── AI ────────────────────────────────────────────────────────── */

  function compactMap() {
    var f = forecast();
    return {
      title: map.title,
      domain: D.id,
      project: {
        code: map.project.code, consultant: map.project.consultant,
        contractor: map.project.contractor, client: map.project.client,
        productLine: map.project.productLine, factory: map.project.factory,
        workWeek: map.project.workWeek,
        startDate: map.project.startDate, requiredOnSite: map.project.requiredOnSite
      },
      computed: {
        criticalPathDays: Math.round(f.days),
        forecastOnSite: f.finish ? f.finish.toISOString().slice(0, 10) : null,
        slackDays: f.slack
      },
      nodes: map.nodes.map(function (n) {
        return {
          id: n.id, type: n.type, stage: n.stage, title: n.title,
          description: n.description, notes: n.notes, party: n.party,
          docRef: n.docRef, tags: n.tags,
          standards: (n.standards || []).map(standardLabel),
          leadCalendarDays: Math.round(calendarDays(n) * 10) / 10,
          onCriticalPath: f.path.indexOf(n.id) !== -1
        };
      }),
      edges: map.edges.map(function (e) {
        return { from: e.from, to: e.to, kind: e.kind, label: e.label };
      })
    };
  }

  function aiOut(html) { $('pm-ai-output').innerHTML = html; }

  function renderAiResult(result) {
    if (!result) { aiOut('<p class="pm-muted">Nothing usable came back. Try again.</p>'); return; }
    if (typeof result === 'string') {
      aiOut(result.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join(''));
      return;
    }
    var html = '';
    if (result.title) html += '<h3>' + esc(result.title) + '</h3>';
    if (result.summary) html += '<p>' + esc(result.summary) + '</p>';
    (result.sections || []).forEach(function (sec) {
      if (sec.heading) html += '<h3>' + esc(sec.heading) + '</h3>';
      if (sec.text) html += '<p>' + esc(sec.text) + '</p>';
      if (Array.isArray(sec.items) && sec.items.length) {
        html += '<ul>' + sec.items.map(function (i) {
          return '<li>' + esc(typeof i === 'string' ? i : (i.text || '')) + '</li>';
        }).join('') + '</ul>';
      }
    });
    if (!html) { aiOut('<p class="pm-muted">Nothing usable came back. Try again.</p>'); return; }
    aiOut(html + '<p class="pm-ai-caveat">Draft for review. Check every specific against the actual ' +
                 'submittal, order and shipping documents before it reaches a consultant or client.</p>');
  }

  async function callAi(action, extra) {
    if (!map.nodes.length) { aiOut('<p class="pm-muted">Load a template or add cards first.</p>'); return null; }
    aiOut('<p class="pm-muted">Working on it…</p>');
    try {
      var res = await fetch(API_AI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ action: action, selectedId: selectedId, map: compactMap() }, extra || {}))
      });
      if (res.status === 401) {
        aiOut('<p class="pm-muted">Sign in to use the AI assistant. The forecast, critical path and health checks work either way.</p>');
        return null;
      }
      if (res.status === 404) {
        aiOut('<p class="pm-muted">The AI endpoint is not deployed yet — see the setup notes.</p>');
        return null;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var body = await res.json();
      if (body.error) throw new Error(body.error);
      return body.result;
    } catch (e) {
      aiOut('<p class="pm-muted">The assistant could not be reached (' + esc(e.message) + ').</p>');
      return null;
    }
  }

  async function summariseCard() {
    var node = nodeById(selectedId);
    if (!node) return;
    var btn = $('pm-ai-card');
    btn.disabled = true; btn.textContent = 'Summarising…';
    var result = await callAi('summarise_card', { card: node });
    btn.disabled = false; btn.textContent = 'Summarise with AI';
    if (result && result.summary) {
      node.aiSummary = result.summary;
      touch(); renderInspector();
      aiOut('<h3>' + esc(node.title) + '</h3><p>' + esc(result.summary) +
            '</p><p class="pm-ai-caveat">Draft for review.</p>');
    } else if (result) renderAiResult(result);
  }

  /* ── Export ────────────────────────────────────────────────────── */

  function download(name, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function safeName() {
    return (map.project.code || map.title || 'process-map').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'process-map';
  }

  function exportMarkdown() {
    var f = forecast(), h = computeHealth(f);
    var L = ['# ' + (map.title || 'Process map'), ''];
    if (map.project.code) L.push('**Project:** ' + map.project.code);
    if (map.project.consultant) L.push('**Consultant:** ' + map.project.consultant);
    if (map.project.contractor) L.push('**Main contractor:** ' + map.project.contractor);
    if (map.project.productLine) L.push('**Product:** ' + map.project.productLine +
      (map.project.factory ? ' — factory: ' + map.project.factory : ''));
    L.push('', '**Critical path:** ' + fmtDays(f.days));
    if (f.finish) L.push('**Forecast on site:** ' + fmtDate(f.finish));
    if (f.required) L.push('**Required on site:** ' + fmtDate(f.required) +
      (f.slack !== null ? ' (' + (f.slack >= 0 ? f.slack + ' days float' : Math.abs(f.slack) + ' days late') + ')' : ''));
    L.push('**Process health:** ' + (h.score === null ? 'n/a' : h.score + '/100'), '');

    if (h.findings.length) {
      L.push('## Findings', '');
      h.findings.forEach(function (fi) { L.push('- **' + fi.message + '** — ' + (fi.fix || '')); });
      L.push('');
    }

    STAGES.forEach(function (st) {
      var nodes = map.nodes.filter(function (n) { return n.stage === st.id; });
      if (!nodes.length) return;
      L.push('## ' + st.label, '');
      nodes.forEach(function (n) {
        L.push('### ' + n.title + ' (' + typeDef(n).label + ')');
        if (n.party) L.push('- Responsible: ' + n.party);
        if (leadLabel(n)) L.push('- Lead time: ' + leadLabel(n) + ' (' + fmtDays(calendarDays(n)) + ' calendar)');
        if (n.docRef) L.push('- Reference: ' + n.docRef);
        if ((n.standards || []).length) L.push('- Standards: ' + n.standards.map(standardLabel).join(', '));
        if ((n.tags || []).length) L.push('- Tags: ' + n.tags.join(', '));
        if (n.description) L.push('', n.description);
        if (n.aiSummary) L.push('', '> AI summary: ' + n.aiSummary);
        L.push('');
      });
    });

    L.push('## Flow', '');
    map.edges.forEach(function (e) {
      var a = nodeById(e.from), b = nodeById(e.to);
      if (a && b) L.push('- ' + a.title + ' → ' + b.title + ' (' + EDGE_KINDS[e.kind].label +
        (e.label ? ', "' + e.label + '"' : '') + ')');
    });
    download(safeName() + '.md', L.join('\n'), 'text/markdown');
  }

  function exportCsv() {
    var cell = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var f = forecast();
    var rows = [['Stage', 'Card', 'Type', 'Responsible party', 'Lead time', 'Calendar days',
                 'On critical path', 'Reference', 'Standards', 'Tags', 'Description', 'Next cards']];
    STAGES.concat([{ id: null, label: 'Unassigned' }]).forEach(function (st) {
      map.nodes.filter(function (n) { return st.id ? n.stage === st.id : !stageById(n.stage); })
        .forEach(function (n) {
          var next = outgoing(n.id).map(function (e) {
            var b = nodeById(e.to);
            return b ? b.title + (e.label ? ' [' + e.label + ']' : '') : '';
          }).filter(Boolean).join('; ');
          rows.push([st.label, n.title, typeDef(n).label, n.party, leadLabel(n),
                     Math.round(calendarDays(n) * 10) / 10,
                     f.path.indexOf(n.id) !== -1 ? 'Yes' : '',
                     n.docRef, (n.standards || []).map(standardLabel).join('; '),
                     (n.tags || []).join('; '), n.description, next]);
        });
    });
    download(safeName() + '.csv',
      '\ufeff' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n'), 'text/csv');
  }

  function buildStandaloneSvg() {
    if (!map.nodes.length) return null;
    var xs = [], ys = [];
    map.nodes.forEach(function (n) { xs.push(n.x - 160, n.x + 160); ys.push(n.y - 100, n.y + 100); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys) - 80, maxY = Math.max.apply(null, ys);

    var names = ['--color-bg', '--color-surface', '--color-primary', '--color-accent', '--color-text',
                 '--color-text-muted', '--color-border', '--color-success', '--color-warning', '--color-danger',
                 '--color-orange', '--color-purple', '--color-success-dark', '--color-plum'];
    STAGES.forEach(function (s) { names.push(s.token); });
    var vars = names.map(function (n) { return n + ':' + token(n) + ';'; }).join('');

    var css = ':root{' + vars + '}svg{background:var(--color-bg)}' +
      '.pm-node-box{fill:var(--color-surface);stroke-width:2}' +
      '.pm-node-title{font-family:Sora,sans-serif;font-size:14px;font-weight:600;fill:var(--color-text)}' +
      '.pm-node-meta{font-family:monospace;font-size:10px;fill:var(--color-text-muted)}' +
      '.pm-node-kind{font-family:Inter,sans-serif;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}' +
      '.pm-lane-label{font-family:Inter,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em}' +
      '.pm-edge-path{fill:none;stroke-width:2}.pm-edge-hit{display:none}.pm-handle{display:none}' +
      '.pm-edge-label{font-family:Inter,sans-serif;font-size:11px;fill:var(--color-text-muted)}' +
      '.pm-edge-label-bg{fill:var(--color-bg)}';

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(maxX - minX) + '" height="' +
      Math.round(maxY - minY) + '" viewBox="' + minX + ' ' + minY + ' ' + (maxX - minX) + ' ' +
      (maxY - minY) + '"><style>' + css + '</style><defs>' + defs.innerHTML + '</defs><g>' +
      gLanes.innerHTML + gEdges.innerHTML + gNodes.innerHTML + '</g></svg>';
  }

  function exportPng() {
    var content = buildStandaloneSvg();
    if (!content) return;
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = img.width * 2; canvas.height = img.height * 2;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = token('--color-bg') || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (b) { download(safeName() + '.png', b); }, 'image/png');
    };
    img.onerror = function () { setStatus('PNG export failed — SVG export still works'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content);
  }

  /* ── Canvas interaction ────────────────────────────────────────── */

  function centreOfView() {
    var r = svg.getBoundingClientRect();
    return { x: (r.width / 2 - view.x) / view.k, y: (r.height / 2 - view.y) / view.k };
  }

  function toScene(cx, cy) {
    var r = svg.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }

  function onPointerDown(ev) {
    var t = ev.target;

    var addNext = t.closest('[data-add-next]');
    if (addNext) { addNextStep(addNext.getAttribute('data-add-next')); return; }

    var handle = t.closest('[data-handle]');
    if (handle) {
      linking = { fromId: handle.getAttribute('data-handle') };
      svg.setPointerCapture(ev.pointerId);
      return;
    }

    var group = t.closest('[data-node-id]');
    if (group) {
      var id = group.getAttribute('data-node-id'), n = nodeById(id);
      if (!n) return;
      selectedId = id;
      var pos = toScene(ev.clientX, ev.clientY);
      dragging = { id: id, dx: pos.x - n.x, dy: pos.y - n.y, moved: false };
      svg.setPointerCapture(ev.pointerId);
      render();
      return;
    }

    var edgeHit = t.closest('[data-edge-id]');
    if (edgeHit) { editEdge(edgeHit.getAttribute('data-edge-id')); return; }

    selectedId = null;
    panning = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    svg.classList.add('is-panning');
    svg.setPointerCapture(ev.pointerId);
    render();
  }

  function onPointerMove(ev) {
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
      renderMinimap();
    }
  }

  function onPointerUp(ev) {
    if (linking) {
      var el = document.elementFromPoint(ev.clientX, ev.clientY);
      var group = el && el.closest ? el.closest('[data-node-id]') : null;
      gOverlay.innerHTML = '';
      if (group) openConnectDialog(linking.fromId, group.getAttribute('data-node-id'));
      linking = null;
    }
    if (dragging && dragging.moved) touch();
    dragging = null; panning = null;
    svg.classList.remove('is-panning');
    render();
  }

  function zoomAt(mx, my, factor) {
    var k = Math.max(0.12, Math.min(2.5, view.k * factor));
    var real = k / view.k;
    view.x = mx - (mx - view.x) * real;
    view.y = my - (my - view.y) * real;
    view.k = k;
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    renderMinimap();
  }

  function onWheel(ev) {
    ev.preventDefault();
    var r = svg.getBoundingClientRect();
    zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  }

  function fitToScreen() {
    if (!map.nodes.length) { view = { x: 0, y: 0, k: 1 }; return; }
    var r = svg.getBoundingClientRect();
    var xs = [], ys = [];
    map.nodes.forEach(function (n) { xs.push(n.x - 130, n.x + 130); ys.push(n.y - 90, n.y + 90); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys) - 60, maxY = Math.max.apply(null, ys);
    var pad = 40;
    view.k = Math.max(0.12, Math.min((r.width - pad * 2) / (maxX - minX || 1),
                                     (r.height - pad * 2) / (maxY - minY || 1), 1.2));
    view.x = r.width / 2 - ((minX + maxX) / 2) * view.k;
    view.y = r.height / 2 - ((minY + maxY) / 2) * view.k;
    scene.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    renderMinimap();
  }

  function focusNode(id) {
    var n = nodeById(id);
    if (!n) return;
    var r = svg.getBoundingClientRect();
    view.k = Math.max(view.k, 0.8);
    view.x = r.width / 2 - n.x * view.k;
    view.y = r.height / 2 - n.y * view.k;
    selectedId = id;
    render();
  }

  /* ── Dialogs ───────────────────────────────────────────────────── */

  function targetOptions(excludeId) {
    return map.nodes.filter(function (n) { return n.id !== excludeId; })
      .map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + '</option>'; }).join('');
  }

  function openConnectDialog(fromId, toId) {
    connectFrom = fromId; editingEdgeId = null;
    var sel = $('pm-connect-target');
    sel.innerHTML = targetOptions(fromId);
    if (toId) sel.value = toId;
    $('pm-connect-kind').value = 'flow';
    $('pm-connect-label').value = '';
    $('pm-connect-delete').hidden = true;
    $('pm-connect-dialog').showModal();
  }

  function editEdge(edgeId) {
    var edge = map.edges.filter(function (e) { return e.id === edgeId; })[0];
    if (!edge) return;
    editingEdgeId = edgeId; connectFrom = edge.from;
    var sel = $('pm-connect-target');
    sel.innerHTML = targetOptions(edge.from);
    sel.value = edge.to;
    $('pm-connect-kind').value = edge.kind;
    $('pm-connect-label').value = edge.label || '';
    $('pm-connect-delete').hidden = false;
    $('pm-connect-dialog').showModal();
  }

  /* ── Setup ─────────────────────────────────────────────────────── */

  function buildControls() {
    $('pm-palette').innerHTML = Object.keys(CARD_TYPES).map(function (key) {
      var def = CARD_TYPES[key];
      var colour = def.colour === 'stage' ? '--color-text-muted' : def.colour;
      return '<button type="button" class="pm-chip" data-add-type="' + key + '">' +
        '<svg class="pm-ico" viewBox="0 0 24 24" style="color:var(' + colour + ')" aria-hidden="true">' +
        '<path d="' + (ICONS[def.icon] || ICONS.square) + '"/></svg>' + esc(def.label) + '</button>';
    }).join('');

    $('f-type').innerHTML = Object.keys(CARD_TYPES).map(function (k) {
      return '<option value="' + k + '">' + esc(CARD_TYPES[k].label) + '</option>';
    }).join('');

    $('f-stage').innerHTML = STAGES.map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.label) + '</option>';
    }).join('');

    $('f-party').innerHTML = '<option value="">Not assigned</option>' + D.parties.map(function (p) {
      return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
    }).join('');

    $('f-unit').innerHTML = Object.keys(UNITS).map(function (u) {
      return '<option value="' + u + '">' + esc(UNITS[u].label) + '</option>';
    }).join('');

    $('p-product').innerHTML = '<option value="">Not set</option>' + D.productLines.map(function (p) {
      return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
    }).join('');

    $('p-factory').innerHTML = '<option value="">Not set</option>' + D.factories.map(function (x) {
      return '<option value="' + esc(x) + '">' + esc(x) + '</option>';
    }).join('');

    $('pm-template').innerHTML = '<option value="">Load a template…</option>' + D.templates.map(function (t) {
      return '<option value="' + t.id + '">' + esc(t.name) + '</option>';
    }).join('');

    $('pm-connect-kind').innerHTML = Object.keys(EDGE_KINDS).map(function (k) {
      return '<option value="' + k + '">' + esc(EDGE_KINDS[k].label) + '</option>';
    }).join('');

    $('pm-legend').innerHTML = STAGES.map(function (s) {
      return '<span class="pm-legend-item"><span class="pm-legend-dot" style="background:var(' + s.token +
        ')"></span>' + esc(s.label) + '</span>';
    }).join('');
  }

  function switchView(name) {
    ['map', 'outline', 'timeline'].forEach(function (v) { $('pm-view-' + v).hidden = v !== name; });
    document.querySelectorAll('.pm-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'map') fitToScreen();
  }

  function onKeyDown(ev) {
    var tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable) return;
    if (!selectedId) return;
    var n = nodeById(selectedId);
    if (!n) return;
    var step = ev.shiftKey ? 40 : 10;

    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteNode(selectedId); }
    else if (ev.key === 'Enter') { ev.preventDefault(); focusInspector(); }
    else if (ev.key === 'n' || ev.key === 'N') { ev.preventDefault(); addNextStep(selectedId); }
    else if (ev.key === 'Escape') { selectedId = null; render(); }
    else if (ev.key.indexOf('Arrow') === 0) {
      ev.preventDefault();
      if (ev.key === 'ArrowUp') n.y -= step;
      if (ev.key === 'ArrowDown') n.y += step;
      if (ev.key === 'ArrowLeft') n.x -= step;
      if (ev.key === 'ArrowRight') n.x += step;
      touch(); renderEdges(); renderNodes();
    }
  }

  function bind() {
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', function (ev) {
      var g = ev.target.closest('[data-node-id]');
      if (g) { selectedId = g.getAttribute('data-node-id'); render(); focusInspector(); }
    });
    svg.addEventListener('contextmenu', function (ev) {
      var g = ev.target.closest('[data-node-id]');
      if (!g) return;
      ev.preventDefault();
      selectedId = g.getAttribute('data-node-id');
      render();
      openConnectDialog(selectedId, null);
    });
    document.addEventListener('keydown', onKeyDown);

    $('pm-palette').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-add-type]');
      if (b) addNode(b.getAttribute('data-add-type'));
    });

    $('pm-outline').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-goto]');
      if (!b) return;
      switchView('map');
      focusNode(b.getAttribute('data-goto'));
      focusInspector();
    });

    $('pm-add').addEventListener('click', function () { addNode('step'); });
    $('pm-layout').addEventListener('click', function () { layoutByStage(); touch(); render(); fitToScreen(); });
    $('pm-save').addEventListener('click', saveRemote);
    $('pm-zoom-in').addEventListener('click', function () {
      var r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2);
    });
    $('pm-zoom-out').addEventListener('click', function () {
      var r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2);
    });
    $('pm-zoom-fit').addEventListener('click', fitToScreen);

    $('pm-lanes').addEventListener('change', function (ev) {
      showLanes = ev.target.checked;
      renderLanes();
    });

    $('pm-template').addEventListener('change', function (ev) {
      var id = ev.target.value;
      ev.target.value = '';
      if (!id) return;
      if (map.nodes.length && !window.confirm('Loading a template replaces the current process. Continue?')) return;
      loadTemplate(id);
    });

    $('pm-new').addEventListener('click', function () {
      if (map.nodes.length && !window.confirm('Start an empty process? The current one will be replaced.')) return;
      map = blankMap();
      selectedId = null;
      syncProjectFields();
      touch(); render();
      setStatus('New process');
    });

    ['pm-title', 'p-code', 'p-consultant', 'p-contractor', 'p-product', 'p-factory',
     'p-start', 'p-required', 'p-workweek'].forEach(function (id) {
      $(id).addEventListener('input', readProjectFields);
      $(id).addEventListener('change', readProjectFields);
    });

    $('pm-search').addEventListener('input', function (ev) {
      filterText = ev.target.value.trim().toLowerCase();
      renderNodes();
    });

    document.querySelectorAll('.pm-seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });

    ['f-type', 'f-stage', 'f-title', 'f-desc', 'f-party', 'f-owner', 'f-docref',
     'f-lead', 'f-unit', 'f-tags', 'f-notes'].forEach(function (id) {
      $(id).addEventListener('input', readInspector);
      $(id).addEventListener('change', readInspector);
    });
    $('f-standards').addEventListener('change', readInspector);

    $('pm-delete').addEventListener('click', function () { if (selectedId) deleteNode(selectedId); });
    $('pm-connect').addEventListener('click', function () { if (selectedId) openConnectDialog(selectedId, null); });
    $('pm-ai-card').addEventListener('click', summariseCard);

    document.querySelectorAll('[data-ai]').forEach(function (b) {
      b.addEventListener('click', async function () {
        b.disabled = true;
        var r = await callAi(b.getAttribute('data-ai'));
        b.disabled = false;
        if (r) renderAiResult(r);
      });
    });

    $('pm-export-open').addEventListener('click', function () { $('pm-export').showModal(); });
    $('pm-export-close').addEventListener('click', function () { $('pm-export').close(); });
    document.querySelectorAll('[data-export]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-export');
        if (k === 'json') download(safeName() + '.json', JSON.stringify(map, null, 2), 'application/json');
        if (k === 'md') exportMarkdown();
        if (k === 'csv') exportCsv();
        if (k === 'svg') { var s = buildStandaloneSvg(); if (s) download(safeName() + '.svg', s, 'image/svg+xml'); }
        if (k === 'png') exportPng();
        $('pm-export').close();
      });
    });

    $('pm-connect-confirm').addEventListener('click', function () {
      var to = $('pm-connect-target').value, kind = $('pm-connect-kind').value;
      var label = $('pm-connect-label').value.trim();
      if (editingEdgeId) {
        map.edges.forEach(function (e) {
          if (e.id === editingEdgeId) { e.to = to; e.kind = kind; e.label = label; }
        });
        touch(); render();
      } else connect(connectFrom, to, kind, label);
      $('pm-connect-dialog').close();
    });
    $('pm-connect-delete').addEventListener('click', function () {
      if (!editingEdgeId) return;
      map.edges = map.edges.filter(function (e) { return e.id !== editingEdgeId; });
      editingEdgeId = null;
      touch(); render();
      $('pm-connect-dialog').close();
    });
    $('pm-connect-cancel').addEventListener('click', function () { $('pm-connect-dialog').close(); });

    window.addEventListener('resize', renderMinimap);
  }

  async function init() {
    svg = $('pm-canvas'); scene = $('pm-scene');
    gLanes = $('pm-lanes-layer'); gEdges = $('pm-edges');
    gNodes = $('pm-nodes'); gOverlay = $('pm-overlay');
    defs = $('pm-defs'); minimap = $('pm-minimap');

    buildControls();
    renderDefs();
    bind();

    var loaded = await loadRemote();
    if (!loaded) loaded = loadLocal();
    if (!loaded) {
      loadTemplate('full-lifecycle');
      dirty = false;
      setStatus('Example loaded — tender to site delivery');
    } else {
      setStatus('Loaded');
    }

    syncProjectFields();
    render();
    fitToScreen();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
