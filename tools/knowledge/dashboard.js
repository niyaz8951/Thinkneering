/* =====================================================================
   Knowledge Repository — dashboard
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var maps = [];
  var isAdmin = false;

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
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var body = await res.json();
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
          seed: pack ? pack.seed : null
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);

      note(body.imported
        ? 'Created with ' + body.imported + ' nodes imported as drafts. Open it and approve what is right.'
        : 'Created.');
      $('new-title').value = '';
      await load();
    } catch (err) {
      note('Could not create the map: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function note(text) { $('create-note').textContent = text; }

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
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
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
      var b = ev.target.closest('[data-review]');
      if (b) runReview(b.getAttribute('data-review'));
    });
    $('review-close').addEventListener('click', function () { $('review-dialog').close(); });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
