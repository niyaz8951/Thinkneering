/* =====================================================================
   Knowledge Repository — dashboard
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var maps = [];
  var isAdmin = false;


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

  function laneToken(index) { return '--kg-lane-' + ((index % 7) + 1); }

  function fmtDate(iso) {
    if (!iso) return 'never';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'never';
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ── Load ──────────────────────────────────────────────────────── */

  async function load() {
    var grid = $('map-grid');
    try {
      var res = await fetch('/api/knowledge/maps', { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        grid.innerHTML = '<p class="kg-muted">Sign in to see your knowledge maps.</p>';
        return;
      }
      var body = await readJson(res);
      maps = body.maps || [];
      isAdmin = !!body.isAdmin;
      $('admin-line').hidden = !isAdmin;
      fillChatMaps();
      renderChat();
      render();
    } catch (err) {
      grid.innerHTML = '<p class="kg-muted">Could not load your maps (' + esc(err.message) +
        '). If this is a fresh deployment, the database migration may not have run yet.</p>';
    }
  }

  function render() {
    var grid = $('map-grid');
    if (!maps.length) {
      grid.innerHTML = '<p class="kg-muted">No maps yet. Create one above, or ask an admin to give you ' +
        'access to an existing map — access is granted per map, not automatically.</p>';
      return;
    }

    grid.innerHTML = maps.map(function (m, i) {
      var total = m.node_count || 0;
      var approved = m.approved_count || 0;
      var pct = total ? Math.round(approved / total * 100) : 0;
      var score = m.knowledge_score;

      return '<article class="kg-card" style="border-left-color:var(' + laneToken(i) + ')">' +
        '<div class="kg-card-head"><div>' +
          '<h2>' + esc(m.title) + '</h2>' +
          '<p class="kg-card-meta">' + esc(m.kind === 'process' ? 'Process map' : 'System map') +
            ' · ' + esc(m.domain) + ' · your role: ' + esc(m.role || 'viewer') + '</p>' +
        '</div><div class="kg-score">' +
          '<span class="kg-score-value">' + (score == null ? '—' : score) + '</span>' +
          '<span class="kg-score-label">Knowledge score</span>' +
        '</div></div>' +

        (m.description ? '<p class="kg-muted">' + esc(m.description) + '</p>' : '') +

        '<div><div class="kg-bar"><span style="width:' + pct + '%"></span></div>' +
        '<p class="kg-card-meta" style="margin-top:var(--space-1)">' + approved + ' of ' + total +
          ' nodes approved · reviewed ' + esc(fmtDate(m.last_reviewed_at)) + '</p></div>' +

        '<div class="kg-btn-group kg-wrap">' +
          '<a class="kg-btn kg-btn-primary" href="/tools/knowledge/map.html?map=' + encodeURIComponent(m.id) + '">Open</a>' +
          '<button type="button" class="kg-btn" data-review="' + esc(m.id) + '">AI review</button>' +
          (m.role === 'owner'
            ? '<button type="button" class="kg-btn kg-btn-danger" data-delete="' + esc(m.id) + '">Delete</button>'
            : '') +
        '</div></article>';
    }).join('');
  }

  /* ── Ask a map ──────────────────────────────────────────────────────
     A conversation grounded in one map. History is kept client-side and
     sent with each turn so follow-ups like "and which of those are
     Greek?" resolve — the endpoint is stateless.
     ---------------------------------------------------------------- */

  var chat = { mapId: null, history: [] };

  var STARTERS = {
    english: ['Which words are built from the root spec-?',
              'What is the difference between affect and effect?',
              'Which prefixes does this map cover?'],
    hvac:    ['What does an AHU contain?',
              'Which parameters does a specification ask about a cooling coil?',
              'What flows between the compressor and the condenser?'],
    business:['What happens after the order is vetted?',
              'Which department owns quality checks?',
              'Where can this process stall?']
  };

  function fillChatMaps() {
    var sel = $('chat-map');
    if (!maps.length) {
      sel.innerHTML = '<option value="">No maps yet</option>';
      $('chat-input').disabled = true;
      $('chat-send').disabled = true;
      return;
    }
    var previous = chat.mapId;
    sel.innerHTML = maps.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.title) +
        ' (' + (m.approved_count || 0) + ' approved)</option>';
    }).join('');

    if (previous && maps.some(function (m) { return m.id === previous; })) sel.value = previous;
    chat.mapId = sel.value;
    $('chat-input').disabled = false;
    $('chat-send').disabled = false;
    renderChatChips();
    renderChatScope();
  }

  function currentChatMap() {
    return maps.filter(function (m) { return m.id === chat.mapId; })[0] || null;
  }

  function renderChatScope() {
    var m = currentChatMap();
    if (!m) return;
    var approved = m.approved_count || 0;
    var total = m.node_count || 0;
    var note = '';
    if (!total) {
      note = ' This map has no nodes yet, so there is nothing to answer from.';
    } else if (!approved) {
      // Worth saying plainly — an unapproved map answers nothing, and that
      // looks like a broken assistant rather than an empty one.
      note = ' None of its ' + total + ' nodes are approved yet, so answers will be thin until they are.';
    }
    $('chat-scope').textContent =
      'Answers come only from the nodes, lanes and connections in ' + m.title +
      ' — never from the internet or general knowledge. If the map does not cover something, it says so.' + note;
  }

  function renderChatChips() {
    var m = currentChatMap();
    var list = (m && STARTERS[m.domain]) || STARTERS.english;
    $('chat-chips').innerHTML = list.map(function (q) {
      return '<button type="button" class="kg-chip-q" data-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('');
  }

  function renderChat() {
    var log = $('chat-log');
    if (!chat.history.length) {
      log.innerHTML = '<p class="kg-muted">Ask something about this map. Try one of the suggestions below.</p>';
      return;
    }
    log.innerHTML = chat.history.map(function (turn) {
      if (turn.role === 'user') {
        return '<div class="kg-msg kg-msg-you"><p>' + esc(turn.text) + '</p></div>';
      }
      if (turn.pending) {
        return '<div class="kg-msg kg-msg-ai"><p class="kg-muted">Reading the map…</p></div>';
      }
      if (turn.error) {
        return '<div class="kg-msg kg-msg-ai"><p class="kg-muted">' + esc(turn.error) + '</p></div>';
      }
      return '<div class="kg-msg kg-msg-ai">' + renderAnswer(turn.result) + '</div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  /* Anything that is not a plain string is a parsing failure upstream, not
     content. Rendering it produced "[object Object]" on screen; this keeps
     that class of bug visible as a fault rather than dressed up as an answer. */
  function text(v) {
    return (typeof v === 'string' && v.trim()) ? v : '';
  }

  function renderAnswer(result) {
    if (!result || typeof result !== 'object') {
      return '<p class="kg-muted">The answer could not be read. Try asking again.</p>';
    }
    var html = '';
    if (text(result.summary)) html += '<p>' + esc(result.summary) + '</p>';

    (result.sections || []).forEach(function (sec) {
      if (!sec || typeof sec !== 'object') return;
      if (text(sec.heading)) html += '<h4>' + esc(sec.heading) + '</h4>';
      if (text(sec.text)) html += '<p>' + esc(sec.text) + '</p>';
      var items = (sec.items || []).map(text).filter(Boolean);
      if (items.length) {
        html += '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
      }
    });

    // Which nodes the answer leaned on. This is what separates a grounded
    // answer from a plausible one — you can go and check it.
    var sources = (result.usedNodes || []).map(text).filter(Boolean);
    if (sources.length) {
      html += '<p class="kg-msg-sources">From: ' +
        sources.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join(' ') + '</p>';
    }
    if (result.answered === false) {
      html += '<p class="kg-msg-gap">This map does not cover that yet.</p>';
    }
    return html || '<p class="kg-muted">The answer came back empty. Try asking again.</p>';
  }

  async function sendChat(text) {
    var q = (text || $('chat-input').value).trim();
    if (!q || !chat.mapId) return;

    $('chat-input').value = '';
    chat.history.push({ role: 'user', text: q });
    var pending = { role: 'ai', pending: true };
    chat.history.push(pending);
    renderChat();
    $('chat-send').disabled = true;

    try {
      // Only completed turns go back as history, and only the last few — a
      // long transcript would crowd out the map itself in the prompt.
      var priorTurns = chat.history.filter(function (t) {
        return t.role === 'user' || (t.role === 'ai' && t.result);
      }).slice(-7, -1).map(function (t) {
        return t.role === 'user'
          ? { role: 'user', text: t.text }
          : { role: 'assistant', text: (t.result && t.result.summary) || '' };
      });

      var body = await readJson(await fetch('/api/knowledge/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'answer_question',
          mapId: chat.mapId,
          question: q,
          history: priorTurns
        })
      }));
      pending.pending = false;
      pending.result = body.result;
    } catch (err) {
      pending.pending = false;
      pending.error = 'Could not answer: ' + err.message;
    } finally {
      $('chat-send').disabled = false;
      renderChat();
      $('chat-input').focus();
    }
  }

  /* ── Create ────────────────────────────────────────────────────── */

  async function createMap() {
    var title = $('new-title').value.trim();
    var seedKey = $('new-seed').value;
    var visibility = $('new-visibility').value;
    var btn = $('create-map');

    if (!title) { note('Give the map a name first.'); $('new-title').focus(); return; }

    var pack = seedKey === 'hvac' ? window.TN_KG_HVAC
             : seedKey === 'business' ? window.TN_KG_BUSINESS
             : seedKey === 'english' ? window.TN_KG_ENGLISH
             : null;

    btn.disabled = true;
    note(pack ? 'Creating and importing the starter graph…' : 'Creating…');

    try {
      var res = await fetch('/api/knowledge/maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          kind: pack ? pack.kind : 'system',
          domain: pack ? pack.id : 'hvac',
          description: pack ? pack.seed.description : '',
          visibility: visibility,
          seed: pack ? pack.seed : null,
          // Only a seeded map gets lanes. A blank map starts with none, so
          // the user names columns that suit their subject instead of
          // inheriting Refrigeration cycle / Air side / Water side.
          lanes: pack ? pack.lanes : []
        })
      });
      var body = await readJson(res);

      note(body.imported
        ? 'Created with ' + body.imported + ' nodes imported as drafts. Open it and approve what is right.'
        : 'Created with no lanes. Open it and add the columns your subject needs, or use "Suggest lanes" once you have a few nodes.');
      $('new-title').value = '';
      await load();
    } catch (err) {
      note('Could not create the map: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function note(text) { $('create-note').textContent = text; }

  /* ── Delete ────────────────────────────────────────────────────── */

  async function deleteMap(mapId) {
    var m = maps.filter(function (x) { return x.id === mapId; })[0];
    if (!m) return;

    var approved = m.approved_count || 0;
    var warning = 'Delete "' + m.title + '"?\n\n' +
      (m.node_count || 0) + ' nodes' +
      (approved ? ', ' + approved + ' of them approved and currently answering Compliance Maker queries' : '') +
      '.\n\nThe map is archived and stops answering immediately.';

    // A map with approved nodes is load-bearing: deleting it silently changes
    // what Compliance Maker can answer. Typing the name is the friction that
    // stops that happening by accident.
    if (approved > 0) {
      var typed = window.prompt(warning + '\n\nType the map name to confirm:');
      if (typed === null) return;
      if (typed.trim() !== m.title.trim()) {
        note('Name did not match — nothing was deleted.');
        return;
      }
    } else if (!window.confirm(warning)) {
      return;
    }

    note('Deleting…');
    try {
      var res = await fetch('/api/knowledge/maps?id=' + encodeURIComponent(mapId), { method: 'DELETE' });
      await readJson(res);
      note('"' + m.title + '" deleted.');
      await load();
    } catch (err) {
      note('Could not delete: ' + err.message);
    }
  }

  /* ── AI review ─────────────────────────────────────────────────── */

  /* Review runs as a dry run first. The model proposes lane moves, new
     connections and a per-node opinion; the user sees the counts and decides.
     Nothing is written until Apply, and even then locked nodes are untouched. */
  var pendingReview = null;

  async function runReview(mapId) {
    var m = maps.filter(function (x) { return x.id === mapId; })[0];
    pendingReview = null;
    $('review-title').textContent = 'AI review — ' + (m ? m.title : 'map');
    $('review-open').href = '/tools/knowledge/map.html?map=' + encodeURIComponent(mapId);
    $('review-output').innerHTML = '<p class="kg-muted">Reading the map…</p>';
    $('review-apply').hidden = true;
    $('review-dialog').showModal();

    try {
      var body = await readJson(await fetch('/api/knowledge/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review_and_align', mapId: mapId, apply: false })
      }));

      // The reviewId is what makes Apply replay this exact proposal rather
      // than asking the model again and getting a different answer.
      pendingReview = { mapId: mapId, reviewId: body.reviewId };
      $('review-output').innerHTML = renderAlignment(body.result, body.applied);
      $('review-apply').hidden = !hasChanges(body.applied) || !body.reviewId;

      if (hasChanges(body.applied) && !body.reviewId) {
        $('review-output').innerHTML +=
          '<p class="kg-muted">This proposal could not be saved, so it cannot be applied. ' +
          'Run the review again.</p>';
      }
      load();
    } catch (err) {
      $('review-output').innerHTML = '<p class="kg-muted">Review failed: ' + esc(err.message) + '</p>';
    }
  }

  function hasChanges(a) {
    if (!a) return false;
    return (a.movedNodes + a.addedEdges + a.notedNodes) > 0;
  }

  async function applyReview() {
    if (!pendingReview) return;
    var btn = $('review-apply');
    btn.disabled = true;
    btn.textContent = 'Applying…';

    try {
      var body = await readJson(await fetch('/api/knowledge/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review_and_align',
          mapId: pendingReview.mapId,
          reviewId: pendingReview.reviewId,
          apply: true
        })
      }));
      var a = body.applied || {};
      $('review-output').innerHTML =
        '<p><strong>Applied.</strong> ' + a.movedNodes + ' nodes moved lane, ' +
        a.addedEdges + ' connections added as drafts, ' + a.notedNodes + ' nodes given an AI note' +
        (a.skippedLocked ? ', ' + a.skippedLocked + ' suggestions skipped on nodes closed to AI' : '') +
        '.</p>' + notApplied(a) +
        '<p class="kg-ai-caveat">Open the map to see them. New connections are drafts until ' +
        'someone approves them.</p>';
      btn.hidden = true;
      load();
    } catch (err) {
      $('review-output').innerHTML += '<p class="kg-muted">Could not apply: ' + esc(err.message) + '</p>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Apply these changes';
    }
  }

  /* Anything the model proposed that could not be resolved. Without this a
     review can suggest a page of changes and apply none of them, with no
     explanation — which is indistinguishable from a broken button. */
  function notApplied(a) {
    if (!a) return '';
    var bits = [];
    if (a.unmatchedTitles) {
      bits.push(a.unmatchedTitles + ' suggestion' + (a.unmatchedTitles > 1 ? 's named nodes' : ' named a node') +
        ' that do not exist in this map');
    }
    if (a.unknownLanes && a.unknownLanes.length) {
      bits.push('lanes this map does not have: ' + a.unknownLanes.map(esc).join(', '));
    }
    if (a.unknownRelations && a.unknownRelations.length) {
      bits.push('relation types this map does not use: ' + a.unknownRelations.map(esc).join(', '));
    }
    if (!bits.length) return '';
    return '<p class="kg-muted"><strong>Skipped:</strong> ' + bits.join('; ') + '.</p>';
  }

  function renderAlignment(result, applied) {
    if (!result) return '<p class="kg-muted">Nothing usable came back.</p>';
    var html = '';
    if (result.summary) html += '<p>' + esc(result.summary) + '</p>';

    var a = applied || {};
    html += '<h3>What this would change</h3><ul>' +
      '<li><strong>' + (a.movedNodes || 0) + '</strong> nodes moved into a better lane</li>' +
      '<li><strong>' + (a.addedEdges || 0) + '</strong> missing connections added, as drafts</li>' +
      '<li><strong>' + (a.notedNodes || 0) + '</strong> nodes given an AI note in their Notes tab</li>' +
      (a.skippedLocked
        ? '<li><strong>' + a.skippedLocked + '</strong> suggestions skipped — those nodes are closed to AI</li>'
        : '') +
      '</ul>' + notApplied(a);

    if (result.lanes && result.lanes.length) {
      html += '<h3>Proposed lanes</h3><ol>' + result.lanes.map(function (l) {
        return '<li><strong>' + esc(l.label) + '</strong>' +
          (l.reason ? ' — ' + esc(l.reason) : '') + '</li>';
      }).join('') + '</ol>' +
      '<p class="kg-muted">Lane changes are not applied automatically — open the map and use ' +
      'Lanes if you want these.</p>';
    }

    if (result.moves && result.moves.length) {
      html += '<h3>Nodes in the wrong lane</h3><ul>' + result.moves.slice(0, 20).map(function (m) {
        return '<li>' + esc(m.node) + ' → <strong>' + esc(m.lane) + '</strong>' +
          (m.why ? ' — ' + esc(m.why) : '') + '</li>';
      }).join('') + '</ul>';
    }

    if (result.connections && result.connections.length) {
      html += '<h3>Missing connections</h3><ul>' + result.connections.slice(0, 20).map(function (c) {
        return '<li>' + esc(c.from) + ' <em>' + esc(c.relation) + '</em> ' + esc(c.to) +
          (c.why ? ' — ' + esc(c.why) : '') + '</li>';
      }).join('') + '</ul>';
    }

    (result.sections || []).forEach(function (sec) {
      if (sec.heading) html += '<h3>' + esc(sec.heading) + '</h3>';
      if (sec.text) html += '<p>' + esc(sec.text) + '</p>';
      if (sec.items && sec.items.length) {
        html += '<ul>' + sec.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
      }
    });

    return html + '<p class="kg-ai-caveat">Nothing has been written yet. Nodes with ' +
      '\u201cLet AI update this node\u201d switched off are read for context and left alone.</p>';
  }

  function renderResult(result) {
    if (!result) return '<p class="kg-muted">Nothing usable came back.</p>';
    var html = '';
    if (result.summary) html += '<p>' + esc(result.summary) + '</p>';
    (result.sections || []).forEach(function (sec) {
      if (sec.heading) html += '<h3>' + esc(sec.heading) + '</h3>';
      if (sec.text) html += '<p>' + esc(sec.text) + '</p>';
      if (sec.items && sec.items.length) {
        html += '<ul>' + sec.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
      }
    });
    if (!html) return '<p class="kg-muted">Nothing usable came back.</p>';
    return html + '<p class="kg-ai-caveat">This is the assistant reading what is written in the map. ' +
      'It cannot see knowledge that is not there, and it does not approve anything.</p>';
  }

  /* ── Wiring ────────────────────────────────────────────────────── */

  function init() {
    $('create-map').addEventListener('click', createMap);
    $('new-title').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') createMap();
    });
    $('map-grid').addEventListener('click', function (ev) {
      var review = ev.target.closest('[data-review]');
      if (review) { runReview(review.getAttribute('data-review')); return; }
      var del = ev.target.closest('[data-delete]');
      if (del) deleteMap(del.getAttribute('data-delete'));
    });
    $('chat-map').addEventListener('change', function (ev) {
      chat.mapId = ev.target.value;
      // A conversation is grounded in one map; carrying it across would
      // invite answers built from a map that was never asked.
      chat.history = [];
      renderChat();
      renderChatChips();
      renderChatScope();
    });
    $('chat-send').addEventListener('click', function () { sendChat(); });
    $('chat-input').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); sendChat(); }
    });
    $('chat-clear').addEventListener('click', function () {
      chat.history = [];
      renderChat();
    });
    $('chat-chips').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-q]');
      if (b) sendChat(b.getAttribute('data-q'));
    });

    $('review-close').addEventListener('click', function () { $('review-dialog').close(); });
    $('review-apply').addEventListener('click', applyReview);
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
