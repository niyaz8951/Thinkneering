/* =====================================================================
   Knowledge admin console
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var maps = [];
  var queue = [];
  var selected = new Set();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(t) { $('status').textContent = t; }

  function fmt(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  async function api(url, options) {
    var res = await fetch(url, options);
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
    return body;
  }

  /* ── Queue ─────────────────────────────────────────────────────── */

  async function loadQueue() {
    try {
      var body = await api('/api/knowledge/admin?view=queue');
      queue = body.queue || [];
      renderQueue();
      setStatus(queue.length + ' nodes waiting');
    } catch (err) {
      $('queue-table').innerHTML = '<tr><td>' + esc(err.message) + '</td></tr>';
    }
  }

  function renderQueue() {
    if (!queue.length) {
      $('queue-table').innerHTML = '<tr><td class="kg-muted">Nothing waiting. Every node has been reviewed.</td></tr>';
      return;
    }
    $('queue-table').innerHTML =
      '<thead><tr><th></th><th>Node</th><th>Map</th><th>Kind</th><th>Status</th><th>Author</th><th>Updated</th></tr></thead><tbody>' +
      queue.map(function (n) {
        return '<tr><td><input type="checkbox" data-pick="' + esc(n.id) + '" data-map="' + esc(n.map_id) + '"' +
          (selected.has(n.id) ? ' checked' : '') + '></td>' +
          '<td><strong>' + esc(n.title) + '</strong>' +
          (n.summary ? '<br><span class="kg-muted">' + esc(n.summary) + '</span>' :
            '<br><span class="kg-muted">No summary — this will not answer anything useful.</span>') + '</td>' +
          '<td>' + esc(n.map_title) + '</td>' +
          '<td>' + esc(n.kind) + '</td>' +
          '<td><span class="kg-pill kg-pill-' + esc(n.status) + '">' + esc(n.status) + '</span></td>' +
          '<td class="kg-muted">' + esc(n.created_by) + '</td>' +
          '<td class="kg-muted">' + esc(fmt(n.updated_at)) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  async function approveSelected() {
    if (!selected.size) { setStatus('Nothing selected.'); return; }

    // Approvals are per map, so group before sending.
    var byMap = {};
    queue.forEach(function (n) {
      if (selected.has(n.id)) (byMap[n.map_id] = byMap[n.map_id] || []).push(n.id);
    });

    setStatus('Approving and indexing…');
    var total = 0, terms = 0;
    try {
      for (var mapId of Object.keys(byMap)) {
        var body = await api('/api/knowledge/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'bulk-approve', mapId: mapId, ids: byMap[mapId] })
        });
        total += body.approved || 0;
        terms += body.indexedTerms || 0;
      }
      selected.clear();
      setStatus(total + ' nodes approved, ' + terms + ' search terms indexed. They can answer Compliance Maker queries now.');
      loadQueue();
    } catch (err) {
      setStatus('Failed: ' + err.message);
    }
  }

  /* ── Access ────────────────────────────────────────────────────── */

  async function loadMaps() {
    try {
      var body = await api('/api/knowledge/maps');
      maps = body.maps || [];
      $('access-map').innerHTML = maps.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.title) + '</option>';
      }).join('');
      if (maps.length) loadAccess();
    } catch (err) { setStatus(err.message); }
  }

  async function loadAccess() {
    var mapId = $('access-map').value;
    if (!mapId) return;
    try {
      var body = await api('/api/knowledge/admin?view=access&map=' + encodeURIComponent(mapId));

      if (body.usersReadable) {
        $('grant-user').innerHTML = body.users.map(function (u) {
          return '<option value="' + esc(u.id || u.username) + '">' +
            esc(u.username || u.email || u.id) + '</option>';
        }).join('');
        $('user-note').textContent = body.users.length + ' users available.';
      } else {
        // The users table shape varies between installs, so fall back to typing
        // an id rather than guessing at column names and showing nothing.
        $('grant-user').outerHTML =
          '<input class="kg-input" id="grant-user" placeholder="user id or username" autocomplete="off">';
        $('user-note').textContent =
          'Could not read the users table — enter the user id or username directly. ' +
          'If your users table uses different column names, adjust the query in functions/api/knowledge/admin.js.';
      }

      $('access-table').innerHTML = (body.access || []).length
        ? '<thead><tr><th>User</th><th>Role</th><th>Granted by</th><th>When</th><th></th></tr></thead><tbody>' +
          body.access.map(function (a) {
            return '<tr><td>' + esc(a.user_id) + '</td><td>' + esc(a.role) + '</td>' +
              '<td class="kg-muted">' + esc(a.granted_by || '—') + '</td>' +
              '<td class="kg-muted">' + esc(fmt(a.granted_at)) + '</td>' +
              '<td><button type="button" class="kg-btn kg-btn-sm kg-btn-danger" data-revoke="' +
              esc(a.user_id) + '">Revoke</button></td></tr>';
          }).join('') + '</tbody>'
        : '<tr><td class="kg-muted">Nobody has been granted access to this map yet.</td></tr>';
    } catch (err) {
      $('access-table').innerHTML = '<tr><td>' + esc(err.message) + '</td></tr>';
    }
  }

  async function grant() {
    var mapId = $('access-map').value;
    var user = $('grant-user').value;
    if (!mapId || !user) { setStatus('Pick a map and a user.'); return; }
    try {
      await api('/api/knowledge/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'grant', mapId: mapId, userId: user, role: $('grant-role').value })
      });
      setStatus('Access granted.');
      loadAccess();
    } catch (err) { setStatus('Failed: ' + err.message); }
  }

  async function revoke(userId) {
    try {
      await api('/api/knowledge/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', mapId: $('access-map').value, userId: userId })
      });
      setStatus('Access revoked.');
      loadAccess();
    } catch (err) { setStatus('Failed: ' + err.message); }
  }

  /* ── Gaps ──────────────────────────────────────────────────────── */

  async function loadGaps() {
    try {
      var body = await api('/api/knowledge/admin?view=gaps');

      $('gaps-table').innerHTML = (body.gaps || []).length
        ? '<thead><tr><th>Query that returned nothing</th><th>Times</th><th>Last seen</th></tr></thead><tbody>' +
          body.gaps.map(function (g) {
            return '<tr><td>' + esc(g.context) + '</td><td>' + g.hits + '</td>' +
              '<td class="kg-muted">' + esc(fmt(g.last_seen)) + '</td></tr>';
          }).join('') + '</tbody>'
        : '<tr><td class="kg-muted">No gaps recorded yet. This fills up once Compliance Maker starts calling ' +
          '/api/knowledge/usage with unanswered queries.</td></tr>';

      $('corrected-table').innerHTML = (body.corrected || []).length
        ? '<thead><tr><th>Node</th><th>Corrections</th><th>Last</th></tr></thead><tbody>' +
          body.corrected.map(function (c) {
            return '<tr><td>' + esc(c.title || c.node_id) + '</td><td>' + c.corrections + '</td>' +
              '<td class="kg-muted">' + esc(fmt(c.last_seen)) + '</td></tr>';
          }).join('') + '</tbody>'
        : '<tr><td class="kg-muted">No corrections recorded.</td></tr>';
    } catch (err) {
      $('gaps-table').innerHTML = '<tr><td>' + esc(err.message) + '</td></tr>';
    }
  }

  /* ── Questions ─────────────────────────────────────────────────── */

  async function loadQuestions() {
    try {
      var body = await api('/api/knowledge/admin?view=questions');
      $('questions-table').innerHTML = (body.questions || []).length
        ? '<thead><tr><th>Question</th><th>Map</th><th>Asked by</th><th>When</th></tr></thead><tbody>' +
          body.questions.map(function (q) {
            return '<tr><td>' + esc(q.question) + '</td><td>' + esc(q.map_title || '—') + '</td>' +
              '<td class="kg-muted">' + esc(q.user_id) + '</td>' +
              '<td class="kg-muted">' + esc(fmt(q.created_at)) + '</td></tr>';
          }).join('') + '</tbody>'
        : '<tr><td class="kg-muted">No questions asked yet.</td></tr>';
    } catch (err) {
      $('questions-table').innerHTML = '<tr><td>' + esc(err.message) + '</td></tr>';
    }
  }

  /* ── Wiring ────────────────────────────────────────────────────── */

  function switchTab(name) {
    ['queue', 'access', 'gaps', 'questions'].forEach(function (t) { $('tab-' + t).hidden = t !== name; });
    document.querySelectorAll('.kg-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'access') loadMaps();
    if (name === 'gaps') loadGaps();
    if (name === 'questions') loadQuestions();
  }

  function init() {
    document.querySelectorAll('.kg-seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });

    $('queue-table').addEventListener('change', function (ev) {
      var cb = ev.target.closest('[data-pick]');
      if (!cb) return;
      var id = cb.getAttribute('data-pick');
      if (cb.checked) selected.add(id); else selected.delete(id);
      setStatus(selected.size + ' selected');
    });

    $('select-all').addEventListener('click', function () {
      queue.forEach(function (n) { selected.add(n.id); });
      renderQueue();
      setStatus(selected.size + ' selected');
    });

    $('approve-selected').addEventListener('click', approveSelected);
    $('access-map').addEventListener('change', loadAccess);
    $('grant').addEventListener('click', grant);
    $('access-table').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-revoke]');
      if (b) revoke(b.getAttribute('data-revoke'));
    });

    loadQueue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
