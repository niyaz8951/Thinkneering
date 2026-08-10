/* =====================================================================
   Dictionary review console

   Approving here is not a status flag. It calls /api/admin/dictionary,
   which writes the term into the Dictionary map as a node and reindexes
   it, so the next reader who looks the word up is served from the graph
   rather than the model. Editing the meaning before approving is the
   point of the page — what you save is what gets kept.
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var entries = [];
  var status = 'pending';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(text) { $('status').textContent = text; }

  function fmt(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined,
      { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function parseOr(value, fallback) {
    if (!value) return fallback;
    try { return JSON.parse(value); } catch (e) { return fallback; }
  }

  async function api(url, options) {
    var res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
    return body;
  }

  /* ── Load ──────────────────────────────────────────────────────── */

  async function load() {
    $('list').innerHTML = '<p class="kg-muted">Loading…</p>';
    var domain = $('domain').value;

    try {
      var body = await api('/api/admin/dictionary?status=' + encodeURIComponent(status) +
        (domain ? '&domain=' + encodeURIComponent(domain) : ''));
      entries = body.entries || [];
      render();
      setStatus(entries.length + (entries.length === 1 ? ' word' : ' words') + ' ' +
        (status === 'pending' ? 'waiting' : status));
    } catch (err) {
      $('list').innerHTML = '<p class="kg-muted">' + esc(err.message) + '</p>';
      setStatus('');
    }
  }

  /* ── Render ────────────────────────────────────────────────────── */

  function render() {
    if (!entries.length) {
      $('list').innerHTML = '<p class="kg-empty">' + (status === 'pending'
        ? 'Nothing waiting. Every word readers looked up has been reviewed.'
        : 'No words with that status yet.') + '</p>';
      return;
    }
    $('list').innerHTML = entries.map(card).join('');
  }

  // A queue is for scanning. Each word is one line until it is opened, so a
  // hundred pending terms stay a hundred readable lines rather than a hundred
  // full forms. <details> gives the open/close behaviour, keyboard operation
  // and the disclosure marker without any script or new CSS.
  function card(e) {
    var corrected = Number(e.corrected_count || 0);

    var meta = [
      e.domain,
      (e.lookup_count || 0) + '×',
      corrected ? corrected + ' flagged' : null,
      fmt(e.created_at)
    ].filter(Boolean).join(' · ');

    return '<details class="kg-card" data-id="' + esc(e.id) + '" style="margin-bottom:var(--space-2)">' +
      // The flex lives on an inner span, not on the summary. A summary set to
      // display:flex loses its ::marker in Chrome and Safari, which on a phone
      // leaves a row with no sign that it opens at all.
      '<summary style="cursor:pointer;padding:var(--space-1) 0;min-height:44px">' +
        '<span style="display:inline-flex;align-items:baseline;gap:var(--space-2);' +
          'flex-wrap:wrap;vertical-align:middle">' +
          '<span class="kg-list-title" style="margin:0">' + esc(e.term) + '</span>' +
          '<span class="kg-pill kg-pill-' + esc(e.status === 'approved' ? 'approved' : 'draft') + '">' +
            esc(e.status) + '</span>' +
          '<span class="kg-list-meta" style="margin:0">' + esc(meta) + '</span>' +
        '</span>' +
      '</summary>' +
      '<div style="margin-top:var(--space-3)">' + body(e) + '</div>' +
    '</details>';
  }

  function body(e) {
    var usage = parseOr(e.usage_json, []);
    var senses = parseOr(e.senses_json, []);
    var related = parseOr(e.related_json, null);
    var blocks = [];

    if (usage.length) {
      blocks.push(detail('In use', '<ul class="kg-list">' + usage.map(function (u) {
        return '<li>' + esc(u) + '</li>';
      }).join('') + '</ul>'));
    }

    if (senses.length) {
      blocks.push(detail('Depends on context', senses.map(function (s) {
        return '<p><strong>' + esc(s.field) + '</strong> — ' + esc(s.sense) + '</p>';
      }).join('')));
    }

    if (related) {
      var groups = [['Synonyms', related.synonyms], ['Antonyms', related.antonyms],
        ['Related', related.concepts]].filter(function (g) { return g[1] && g[1].length; });
      if (groups.length) {
        blocks.push(detail('Related words', groups.map(function (g) {
          return '<p><span class="kg-muted">' + g[0] + ':</span> ' + esc(g[1].join(', ')) + '</p>';
        }).join('')));
      }
    }

    return (e.context_seen
        ? '<p class="kg-muted kg-note">Seen in: “' + esc(e.context_seen) + '”</p>'
        : '') +

      field(e.id, 'meaning', 'Meaning', e.meaning, 3) +
      field(e.id, 'hindi', 'Hindi (Devanagari)', e.hindi, 1) +
      field(e.id, 'urdu', 'Urdu', e.urdu, 1) +
      field(e.id, 'urdu_roman', 'Urdu in roman letters', e.urdu_roman, 1) +
      blocks.join('') +

      // Withheld from readers until this row is approved, so this is the only
      // place either has ever been seen. Read them before trusting them.
      '<p class="kg-muted kg-note" style="margin-top:var(--space-3)">' +
        'The two fields below are hidden from readers until you approve this word. ' +
        'The model invents origins and connections more readily than it invents meanings — ' +
        'clear either one you cannot vouch for.</p>' +
      field(e.id, 'origin', 'Where it comes from', e.origin, 2) +
      field(e.id, 'connection', 'Worth knowing', e.connection, 2) +
      field(e.id, 'memory_hook', 'Remember it', e.memory_hook, 2) +

      '<div class="kg-btn-group kg-wrap" style="margin-top:var(--space-3)">' +
        (e.status === 'approved'
          ? '<button type="button" class="kg-btn" data-act="save">Save changes</button>'
          : '<button type="button" class="kg-btn kg-btn-primary" data-act="approve">Approve</button>' +
            '<button type="button" class="kg-btn" data-act="save">Save without approving</button>' +
            '<button type="button" class="kg-btn kg-btn-danger" data-act="reject">Reject</button>') +
        (e.map_id
          ? '<a class="kg-btn" href="/tools/knowledge/map.html?map=' + esc(e.map_id) + '">Open in map</a>'
          : '') +
      '</div>' +
      '<p class="kg-status" data-row-status></p>';
  }

  // kg-field-grow is for a kg-row of side-by-side controls. Inside a card it
  // stretched each textarea's box and left a screen of dead space under it.
  function field(id, name, label, value, rows) {
    var domId = 'f-' + id + '-' + name;
    return '<label class="kg-field" style="margin-top:var(--space-3)">' +
      '<span class="kg-label" for="' + domId + '">' + esc(label) + '</span>' +
      '<textarea class="kg-input" id="' + domId + '" data-field="' + name + '" rows="' + rows + '">' +
        esc(value || '') + '</textarea>' +
    '</label>';
  }

  function detail(label, html) {
    return '<div style="margin-top:var(--space-3)">' +
      '<p class="kg-label">' + esc(label) + '</p>' + html + '</div>';
  }

  /* ── Act ───────────────────────────────────────────────────────── */

  async function act(card, action) {
    var id = Number(card.dataset.id);
    var note = card.querySelector('[data-row-status]');
    var fields = {};

    card.querySelectorAll('[data-field]').forEach(function (input) {
      var text = input.value.trim();
      fields[input.dataset.field] = text === '' ? null : text;
    });

    if (action === 'approve' && !fields.meaning) {
      note.textContent = 'A word needs a meaning before it can be approved.';
      return;
    }

    if (action === 'reject' && !window.confirm('Reject “' + card.querySelector('.kg-list-title').textContent +
      '”? It stays in the queue as rejected and will not be shown to readers.')) return;

    card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    note.textContent = action === 'approve' ? 'Approving and writing to the map…' : 'Saving…';

    try {
      var body = { id: id, fields: fields };
      if (action !== 'save') body.action = action;

      var result = await api('/api/admin/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (action === 'save') {
        note.textContent = 'Saved.';
        card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
        return;
      }

      // Approving moves the row out of the queue this tab is showing.
      note.textContent = action === 'approve'
        ? 'Approved. It is now a node in the Dictionary map.'
        : 'Rejected.';

      if (result.entry && result.entry.status !== status) {
        window.setTimeout(function () {
          card.remove();
          entries = entries.filter(function (e) { return e.id !== id; });
          if (!entries.length) render();
          setStatus(entries.length + (entries.length === 1 ? ' word' : ' words') + ' waiting');
        }, 900);
      }
    } catch (err) {
      note.textContent = err.message;
      card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    }
  }

  /* ── Wire ──────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.kg-seg-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        document.querySelectorAll('.kg-seg-btn').forEach(function (b) {
          b.classList.toggle('is-active', b === button);
          b.setAttribute('aria-selected', String(b === button));
        });
        status = button.dataset.status;
        load();
      });
    });

    $('domain').addEventListener('change', load);
    $('reload').addEventListener('click', load);

    $('list').addEventListener('click', function (ev) {
      var button = ev.target.closest('[data-act]');
      if (!button) return;
      act(button.closest('.kg-card'), button.dataset.act);
    });

    load();
  });
})();
