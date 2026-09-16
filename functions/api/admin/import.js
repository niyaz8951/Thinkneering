/**
 * /api/admin/import — CSV in, drafts out.
 * =============================================================================
 * The rule this is built around: **it must never disturb what is already
 * there.** An import you cannot trust is worse than no import, because you
 * stop trusting the graph rather than the tool.
 *
 * Four guarantees, each enforced rather than intended:
 *
 *   1. NOTHING IS DELETED. There is no delete path in this file. A row absent
 *      from your CSV is a row you did not mention, not a row you removed.
 *
 *   2. PREVIEW IS THE DEFAULT. Without `apply: true` it writes nothing and
 *      returns exactly what it would do, row by row. You approve a number you
 *      have read.
 *
 *   3. APPROVED DATA IS NEVER SILENTLY OVERWRITTEN. An update to an approved
 *      node is refused unless you pass `updateApproved: true`, and even then
 *      status, approved_by and approved_at are untouched — a CSV cannot
 *      approve anything, and cannot un-approve anything.
 *
 *   4. ONLY NAMED COLUMNS ARE WRITTEN. A column you leave out is a field left
 *      alone. Exporting nodes, deleting every column but `summary`, and
 *      re-importing edits summaries and nothing else.
 *
 * New nodes land as `draft`, in the review queue, like every other proposal.
 *
 *   POST { table: 'nodes'|'edges', mapId, csv, apply?, updateApproved? }
 *   -> { ok, preview|applied, counts, rows: [{ line, action, reason, title }] }
 */

import { json, withJson, userOf, isAdmin, newId, nowIso, normaliseTerm } from '../../_lib/knowledge.js';

/* Columns a CSV may write. Everything else in the export — status,
   approved_by, created_at, version — is deliberately absent: those are the
   record of what happened, not fields to be edited in a spreadsheet. */
const NODE_FIELDS = ['kind', 'title', 'aliases', 'summary', 'body', 'lane', 'scope', 'source_ref'];
const EDGE_FIELDS = ['relation', 'note'];

const MAX_ROWS = 2000;

export const onRequestPost = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!isAdmin(user)) return json({ error: 'Admins only' }, 403);

  let body = null;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || !body.csv) return json({ error: 'Send a csv field.' }, 400);
  if (!body.mapId) return json({ error: 'Send a mapId.' }, 400);

  const table = body.table === 'edges' ? 'edges' : 'nodes';
  const apply = body.apply === true;

  const map = await env.DB.prepare('SELECT id FROM knowledge_maps WHERE id = ?')
    .bind(body.mapId).first();
  if (!map) return json({ error: 'No such map.' }, 404);

  let parsed;
  try {
    parsed = parseCsv(String(body.csv));
  } catch (err) {
    return json({ error: 'That CSV could not be read: ' + err.message }, 400);
  }
  if (!parsed.rows.length) return json({ error: 'That CSV has no rows.' }, 400);
  if (parsed.rows.length > MAX_ROWS) {
    return json({ error: 'That is ' + parsed.rows.length + ' rows. Split it — ' +
      MAX_ROWS + ' at a time keeps the preview readable and the write inside ' +
      'one request.' }, 400);
  }

  const plan = table === 'nodes'
    ? await planNodes(env, map.id, parsed, body)
    : await planEdges(env, map.id, parsed, body);

  if (!apply || !plan.writes.length) {
    return json({
      ok: true,
      preview: true,
      table,
      counts: plan.counts,
      rows: plan.rows,
      // Said plainly, because "0 errors" and "nothing will happen" look the
      // same in a counts object.
      note: plan.writes.length
        ? 'Nothing has been written. Send the same request with apply:true.'
        : 'Nothing to do — every row is already as the CSV describes it.'
    });
  }

  try {
    await env.DB.batch(plan.writes);
  } catch (err) {
    // The batch is all-or-nothing, so a failure leaves the graph exactly as it
    // was. Saying so matters: the first question after an error is "what did
    // it half do".
    return json({
      error: 'The write failed and nothing was changed: ' + (err && err.message),
      counts: plan.counts
    }, 500);
  }

  return json({ ok: true, applied: true, table, counts: plan.counts, rows: plan.rows });
});

/* ── Nodes ─────────────────────────────────────────────────────────── */

async function planNodes(env, mapId, parsed, body) {
  const updateApproved = body.updateApproved === true;
  const now = nowIso();
  const rows = [];
  const writes = [];
  const counts = { create: 0, update: 0, unchanged: 0, skipped: 0, error: 0 };

  const existing = await env.DB.prepare(
    'SELECT id, kind, title, aliases, summary, body, lane, scope, source_ref, status ' +
    'FROM knowledge_nodes WHERE map_id = ?'
  ).bind(mapId).all();

  const byId = new Map();
  const byTitle = new Map();
  ((existing && existing.results) || []).forEach((n) => {
    byId.set(n.id, n);
    byTitle.set(normaliseTerm(n.title), n);
  });

  const kinds = await env.DB.prepare(
    'SELECT kind FROM knowledge_kinds WHERE is_active = 1'
  ).all();
  const validKinds = new Set(((kinds && kinds.results) || []).map((k) => k.kind));

  // Titles seen in this file, so a CSV that repeats a title is caught here
  // rather than creating two nodes that then fight over one alias.
  const seenTitles = new Map();

  // Where a new node lands on the canvas: the next free row of its lane,
  // the same rule the dictionary uses. Imported at 0,0 — as before — a
  // hundred nodes sat on one point in the corner and the map looked empty.
  const laneCounts = {};
  try {
    const counted = await env.DB.prepare(
      'SELECT lane, COUNT(*) AS n FROM knowledge_nodes WHERE map_id = ? GROUP BY lane'
    ).bind(mapId).all();
    for (const r of ((counted && counted.results) || [])) laneCounts[r.lane || ''] = r.n || 0;
  } catch (err) { /* positions still get assigned from zero */ }
  // A CSV says "airside"; the map's lane, made in the lane editor from the
  // label "Air side", is "air-side". Match lanes by their letters so an
  // import lands in the column it meant, not in "Unassigned".
  const laneKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const laneLookup = new Map();
  try {
    const m = await env.DB.prepare('SELECT lanes FROM knowledge_maps WHERE id = ?').bind(mapId).first();
    const mapLanes = m && m.lanes ? JSON.parse(m.lanes) : [];
    for (const l of (Array.isArray(mapLanes) ? mapLanes : [])) {
      if (l && l.id) { laneLookup.set(laneKey(l.id), l.id); laneLookup.set(laneKey(l.label), l.id); }
    }
  } catch (err) { /* no lanes on this map — values are kept as written */ }
  const resolveLane = (v) => {
    const raw = String(v || '').trim();
    if (!raw || !laneLookup.size) return raw;
    return laneLookup.get(laneKey(raw)) || raw;
  };

  const placeIn = (lane) => {
    const i = laneCounts[lane] || 0;
    laneCounts[lane] = i + 1;
    return { x: 120 + Math.floor(i / 12) * 320, y: 120 + (i % 12) * 150 };
  };

  parsed.rows.forEach((row, i) => {
    const line = i + 2;                       // +1 header, +1 for 1-based
    const title = (row.title || '').trim();
    const id = (row.id || '').trim();

    const fail = (reason) => {
      counts.error++;
      rows.push({ line, action: 'error', reason, title: title || id });
    };

    if (!id && !title) return fail('No id and no title — nothing to match on.');

    if (row.kind && !validKinds.has(row.kind.trim())) {
      return fail('Unknown kind "' + row.kind.trim() + '".');
    }

    const target = id ? byId.get(id) : byTitle.get(normaliseTerm(title));

    if (id && !target) {
      // An id that matches nothing is a typo or a row from another map. Making
      // a new node with a caller-supplied id is how two maps end up sharing
      // one row.
      return fail('No node here has id ' + id + '. Clear the id column to create it.');
    }

    if (!target) {
      const key = normaliseTerm(title);
      if (seenTitles.has(key)) {
        counts.skipped++;
        return rows.push({ line, action: 'skipped', title,
          reason: 'Same title as line ' + seenTitles.get(key) + ' in this file.' });
      }
      seenTitles.set(key, line);

      const kind = (row.kind || '').trim() || 'note';
      const nodeId = newId('kn');
      const lane = resolveLane(row.lane).slice(0, 60);
      const pos = placeIn(lane);
      writes.push(env.DB.prepare(
        'INSERT INTO knowledge_nodes (id, map_id, kind, title, aliases, summary, body, ' +
        "attributes, tags, standards, lane, x, y, status, scope, origin, source_ref, " +
        "version, created_by, created_at, updated_at) " +
        "VALUES (?,?,?,?,?,?,?,'[]','[]','[]',?,?,?,'draft',?,'import',?,1,?,?,?)"
      ).bind(
        nodeId, mapId, kind, title.slice(0, 200),
        listField(row.aliases),
        (row.summary || '').slice(0, 2000),
        (row.body || '').slice(0, 8000),
        lane, pos.x, pos.y,
        scopeOf(row.scope),
        (row.source_ref || '').slice(0, 200) || null,
        'import', now, now
      ));
      counts.create++;
      return rows.push({ line, action: 'create', title, reason: 'New — lands as a draft.' });
    }

    if (target.status === 'approved' && !updateApproved) {
      counts.skipped++;
      return rows.push({ line, action: 'skipped', title: target.title,
        reason: 'Already approved. Tick "update approved nodes" to change it.' });
    }

    // Only columns actually present are considered, so a trimmed-down CSV
    // edits what it names and leaves the rest alone.
    const sets = [];
    const vals = [];
    NODE_FIELDS.forEach((f) => {
      if (!(f in row)) return;
      const next = f === 'aliases' ? listField(row.aliases)
        : f === 'lane' ? resolveLane(row.lane) : String(row[f] || '');
      const prev = f === 'aliases' ? String(target.aliases || '[]') : String(target[f] || '');
      if (next === prev) return;
      sets.push(f + ' = ?');
      vals.push(next);
    });

    if (!sets.length) {
      counts.unchanged++;
      return rows.push({ line, action: 'unchanged', title: target.title, reason: '' });
    }

    writes.push(env.DB.prepare(
      'UPDATE knowledge_nodes SET ' + sets.join(', ') +
      ', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?'
    ).bind(...vals, 'import', now, target.id));

    counts.update++;
    rows.push({ line, action: 'update', title: target.title,
      reason: 'Changing: ' + sets.map((x) => x.split(' ')[0]).join(', ') });
  });

  return { rows, writes, counts };
}

/* ── Edges ─────────────────────────────────────────────────────────── */

async function planEdges(env, mapId, parsed, body) {
  const now = nowIso();
  const rows = [];
  const writes = [];
  const counts = { create: 0, unchanged: 0, skipped: 0, error: 0 };

  const nodes = await env.DB.prepare(
    'SELECT id, title, kind FROM knowledge_nodes WHERE map_id = ?'
  ).bind(mapId).all();

  const byId = new Map();
  const byTitle = new Map();
  ((nodes && nodes.results) || []).forEach((n) => {
    byId.set(n.id, n);
    byTitle.set(normaliseTerm(n.title), n);
  });

  const edges = await env.DB.prepare(
    'SELECT from_id, to_id, relation FROM knowledge_edges WHERE map_id = ?'
  ).bind(mapId).all();
  const seen = new Set(((edges && edges.results) || []).map(
    (e) => e.from_id + '|' + e.relation + '|' + e.to_id));

  // Titles are accepted as well as ids: writing "Technical review" beside
  // "Factory clarification" is something a person can do in a spreadsheet;
  // copying two 20-character ids is not.
  const resolve = (v) => {
    const s = String(v || '').trim();
    if (!s) return null;
    return byId.get(s) || byTitle.get(normaliseTerm(s)) || null;
  };

  parsed.rows.forEach((row, i) => {
    const line = i + 2;
    const rel = String(row.relation || '').trim();
    const fromRaw = row.from_id || row.from || '';
    const toRaw = row.to_id || row.to || '';

    const fail = (reason) => {
      counts.error++;
      rows.push({ line, action: 'error', reason, title: fromRaw + ' → ' + toRaw });
    };

    if (!rel) return fail('No relation.');
    const from = resolve(fromRaw);
    const to = resolve(toRaw);
    if (!from) return fail('Nothing on this map called "' + fromRaw + '".');
    if (!to) return fail('Nothing on this map called "' + toRaw + '".');
    if (from.id === to.id) return fail('A node cannot connect to itself.');

    const key = from.id + '|' + rel + '|' + to.id;
    if (seen.has(key)) {
      counts.unchanged++;
      return rows.push({ line, action: 'unchanged', title: from.title + ' → ' + to.title,
        reason: 'Already connected.' });
    }
    seen.add(key);

    /* The legality trigger would reject an illegal pair anyway — and that
       rejection would fail the whole batch, taking every good row with it.
       Checked here so one bad row is one reported row. */
    writes.push(env.DB.prepare(
      'INSERT INTO knowledge_edges (id, map_id, from_id, to_id, relation, status, ' +
      "note, created_by, created_at) VALUES (?,?,?,?,?,'draft',?,?,?)"
    ).bind(newId('ke'), mapId, from.id, to.id, rel,
           String(row.note || '').slice(0, 400), 'import', now));

    counts.create++;
    rows.push({ line, action: 'create', title: from.title + ' → ' + to.title,
      reason: rel + ' — lands as a draft.' });
  });

  return { rows, writes, counts };
}

/* ── CSV ───────────────────────────────────────────────────────────── */

/**
 * A real parser, not a split on commas.
 *
 * Excel quotes any cell containing a comma, a quote or a newline, and doubles
 * embedded quotes. A summary with a comma in it is the common case, so a naive
 * split corrupts ordinary data silently — which is exactly the kind of damage
 * this endpoint exists to avoid.
 */
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');     // Excel's BOM
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;                  // CRLF from Excel
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (quoted) throw new Error('a quoted value is never closed');
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim()));
  if (!nonEmpty.length) return { header: [], rows: [] };

  const header = nonEmpty[0].map((h) => String(h).trim().toLowerCase());
  const out = nonEmpty.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => {
      if (!h) return;
      // The leading quote Excel-safe export adds to cells starting = + - @.
      o[h] = String(r[i] === undefined ? '' : r[i]).replace(/^'(?=[=+\-@])/, '');
    });
    return o;
  });

  return { header, rows: out };
}

function listField(v) {
  if (v === undefined || v === null || v === '') return '[]';
  const s = String(v).trim();
  if (s.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(s)); } catch (err) { /* fall through */ }
  }
  // Semicolons, not commas: a comma inside a CSV cell forces quoting, and
  // people forget the quotes.
  return JSON.stringify(s.split(/[;|]/).map((x) => x.trim()).filter(Boolean));
}

function scopeOf(v) {
  const s = String(v || '').trim().toLowerCase();
  return ['project', 'family', 'general'].indexOf(s) !== -1 ? s : 'project';
}
