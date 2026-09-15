/**
 * /api/admin/export — the whole graph, out.
 * =============================================================================
 * D1, Workers AI and Vectorize will not exist in this form in 2031. Six years
 * of curated project knowledge trapped inside a discontinued service is the
 * worst outcome available here, and it is entirely preventable.
 *
 * This is not primarily an escape hatch, though it is one. It is what makes
 * committing to the system reasonable: a store you could walk away from
 * tomorrow is one you can put six years into without anxiety.
 *
 * It is also the working format. CSV round-trips through Excel, which is where
 * you would actually maintain a hundred rows, and through a Claude session,
 * which is where consolidation is easiest to do well.
 *
 *   GET /api/admin/export                    everything, JSON
 *   GET /api/admin/export?format=csv&table=nodes|facts|edges|actions|aliases
 *   GET /api/admin/export?map=<id>           one map only
 *
 * Admin only. Read-only.
 */

import { json, withJson, userOf, isAdmin } from '../../_lib/knowledge.js';

/* What gets exported, and in what order. Nodes before edges and facts so the
   files can be read back in sequence without dangling references — the export
   is only useful if it can also be an import. */
const TABLES = {
  maps:    'SELECT * FROM knowledge_maps',
  nodes:   'SELECT * FROM knowledge_nodes',
  facts:   'SELECT * FROM knowledge_facts',
  edges:   'SELECT * FROM knowledge_edges',
  aliases: 'SELECT * FROM knowledge_aliases',
  actions: 'SELECT * FROM knowledge_actions',
  kinds:   'SELECT * FROM knowledge_kinds',
  rules:   'SELECT * FROM knowledge_edge_rules'
};

/* Not exported: knowledge_terms and the vector index. Both are derived —
   rebuilt from nodes by reindexNode() and /api/knowledge/reindex. Exporting a
   derived index invites someone to restore a stale one. */

export const onRequestGet = withJson(async (context) => {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!isAdmin(user)) return json({ error: 'Admins only' }, 403);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const mapId = url.searchParams.get('map');
  const table = url.searchParams.get('table');
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const name = table && TABLES[table] ? table : 'nodes';
    const rows = await read(env, name, mapId);
    return new Response(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="thinkneering-' + name + '-' + stamp + '.csv"'
      }
    });
  }

  const out = {
    exportedAt: new Date().toISOString(),
    // Stamped so a file found in two years can be matched to the schema that
    // wrote it. An export with no version is an export you have to guess at.
    schema: 1,
    map: mapId || 'all',
    tables: {}
  };

  for (const name of Object.keys(TABLES)) {
    out.tables[name] = await read(env, name, mapId);
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="thinkneering-graph-' + stamp + '.json"'
    }
  });
});

async function read(env, name, mapId) {
  let sql = TABLES[name];
  const binds = [];

  // kinds and rules are global; everything else can be scoped to one map.
  if (mapId && name !== 'kinds' && name !== 'rules') {
    sql += name === 'maps' ? ' WHERE id = ?' : ' WHERE map_id = ?';
    binds.push(mapId);
  }

  try {
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return (res && res.results) || [];
  } catch (err) {
    // A table that does not exist yet is an empty section, not a failed
    // export. Losing the other seven because one migration has not run would
    // be the wrong trade.
    console.log('export skipped ' + name + ':', err && err.message);
    return [];
  }
}

/**
 * CSV that Excel opens correctly.
 *
 * Two details that are easy to get wrong and painful afterwards: a BOM, or
 * Excel mangles every Urdu and Devanagari character in the dictionary export;
 * and CRLF, which is what Excel writes and therefore what round-trips without
 * a diff on every line.
 */
function toCsv(rows) {
  if (!rows.length) return '\uFEFF';

  const cols = Object.keys(rows[0]);
  const head = cols.map(cell).join(',');
  const body = rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\r\n');
  return '\uFEFF' + head + '\r\n' + body + '\r\n';
}

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // A leading =, + or - makes Excel treat the cell as a formula. Prefixing a
  // quote is the standard defence and survives the round trip.
  const guarded = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\r\n]/.test(guarded) ? '"' + guarded.replace(/"/g, '""') + '"' : guarded;
}
