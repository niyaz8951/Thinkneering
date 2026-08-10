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

  /* ── Create ────────────────────────────────────────────────────── */

  async function createMap() {
    var title = $('new-title').value.trim();
    var seedKey = $('new-seed').value;
    var visibility = $('new-visibility').value;
    var btn = $('create-map');

    if (!title) { note('Give the map a name first.'); $('new-title').focus(); return; }

    var pack = seedKey === 'hvac' ? window.TN_KG_HVAC
             : seedKey === 'business' ? window.TN_KG_BUSINESS
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

  async function runReview(mapId) {
    var m = maps.filter(function (x) { return x.id === mapId; })[0];
    $('review-title').textContent = 'AI review — ' + (m ? m.title : 'map');
    $('review-open').href = '/tools/knowledge/map.html?map=' + encodeURIComponent(mapId);
    $('review-output').innerHTML = '<p class="kg-muted">Reading the map…</p>';
    $('review-dialog').showModal();

    try {
      var res = await fetch('/api/knowledge/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review_map', mapId: mapId })
      });
      var body = await readJson(res);
      $('review-output').innerHTML = renderResult(body.result);
      load();
    } catch (err) {
      $('review-output').innerHTML = '<p class="kg-muted">Review failed: ' + esc(err.message) + '</p>';
    }
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
    $('review-close').addEventListener('click', function () { $('review-dialog').close(); });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
