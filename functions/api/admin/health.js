/**
 * /api/admin/health — is this deployment actually assembled correctly?
 * =============================================================================
 * Deploying is three separate things that can each half-happen: the files ship
 * via git, the schema changes via wrangler, and the bindings live in
 * wrangler.toml. Nothing checked that all three agreed, so a missing migration
 * or an absent binding showed up later as a feature that quietly did nothing —
 * which is the worst way to find out, because the site looks fine.
 *
 * This is the one call to make after every deploy. It answers four questions:
 *
 *   1. Which migrations in db/ have not run?
 *   2. Which columns from add-columns are missing?
 *   3. Which bindings are absent, and what stops working without each?
 *   4. Is the knowledge actually reachable — approved, indexed, embedded?
 *
 * Read-only. Admin only.
 */

import { json, withJson, userOf, isAdmin } from '../../_lib/knowledge.js';
import { semanticEnabled } from '../../_lib/semantic.js';
import { TEXT_MODEL, EMBED_MODEL, EMBED_DIMENSIONS } from '../../_lib/models.js';

/* Kept in step with db/ by _dev/tests/engine.test.mjs, which reads the folder
   and fails if a migration exists that this list does not name. A stale list
   here would report healthy while something had never run. */
const EXPECTED_MIGRATIONS = [
  'schema.sql',
  'compliance.sql',
  '2026-08-09-dictionary.sql',
  '2026-08-09b-dictionary-graph.sql',
  '2026-08-10-dictionary-translit.sql',
  '2026-08-10b-dictionary-book.sql',
  '2026-08-13-dictionary-urdu-refresh.sql',
  '2026-08-catalog-knowledge.sql',
  '2026-08-education-portable.sql',
  '2026-08-knowledge-graph.sql',
  '2026-08-process-map.sql',
  '2026-08-signup-approval.sql',
  '2026-09-knowledge-lanes.sql',
  '2026-10-dictionary-english.sql',
  '2026-10-mindmap.sql',
  '2026-09-migration-ledger.sql',
  '2026-09-refocus.sql',
  '2026-09-knowledge-typed.sql',
  '2026-09-signin-only.sql',
  '2026-09-education-tools.sql',
  '2026-09-actions.sql',
  '2026-09-sbu-map.sql',
  '2026-09-people.sql',
  '2026-09-rename-sections.sql',
  '2026-09-domain-kinds.sql',
  '2026-09-approve-seed.sql'
];

/* The ALTERs cannot record themselves — each is its own wrangler call so that
   one failing does not stop the next. They are checked directly instead, which
   is a stronger guarantee than a ledger row: this asks the schema. */
const EXPECTED_COLUMNS = [
  ['knowledge_maps', 'lanes'],
  ['knowledge_nodes', 'scope'],
  ['knowledge_nodes', 'project_id'],
  ['knowledge_nodes', 'origin'],
  ['knowledge_nodes', 'source_ref'],
  ['knowledge_nodes', 'superseded_by'],
  ['knowledge_actions', 'assignee_id']
];

export const onRequestGet = withJson(async (context) => {
  const { env } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!isAdmin(user)) return json({ error: 'Admins only' }, 403);

  const problems = [];

  /* ── Bindings ──────────────────────────────────────────────────────
     Each says what stops working, not just that it is absent. "VECTORIZE
     missing" means nothing at 2am in eighteen months; "semantic search
     falls back to keyword" means something. */
  const bindings = {
    DB:        { present: !!env.DB,        without: 'Nothing works. This is fatal.' },
    AI:        { present: !!env.AI,        without: 'No clause review, no ask, no gap proposals. Retrieval still works.' },
    BOOKS:     { present: !!env.BOOKS,     without: 'The Library cannot list or serve books.' },
    VECTORIZE: { present: !!env.VECTORIZE, without: 'Semantic search falls back to keyword only. Optional.' }
  };
  Object.keys(bindings).forEach((k) => {
    if (!bindings[k].present && k !== 'VECTORIZE') {
      problems.push('Binding ' + k + ' is missing — ' + bindings[k].without);
    }
  });

  if (!env.DB) {
    return json({ ok: false, fatal: 'No DB binding', bindings, problems });
  }

  /* ── Migrations ────────────────────────────────────────────────── */
  let applied = [];
  let ledgerExists = true;
  try {
    const rows = await env.DB.prepare(
      'SELECT name, applied_at FROM schema_migrations ORDER BY name'
    ).all();
    applied = (rows && rows.results) || [];
  } catch (err) {
    ledgerExists = false;
    problems.push('No schema_migrations table. Run db/2026-09-migration-ledger.sql first.');
  }

  const appliedNames = new Set(applied.map((r) => r.name));
  const pending = EXPECTED_MIGRATIONS.filter((m) => !appliedNames.has(m));
  if (ledgerExists && pending.length) {
    problems.push(pending.length + ' migration(s) have not run: ' + pending.join(', '));
  }

  /* ── Columns ───────────────────────────────────────────────────── */
  const missingColumns = [];
  for (const [table, column] of EXPECTED_COLUMNS) {
    try {
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?'
      ).bind(table, column).first();
      if (!row || !row.n) missingColumns.push(table + '.' + column);
    } catch (err) {
      missingColumns.push(table + '.' + column + ' (table missing)');
    }
  }
  if (missingColumns.length) {
    problems.push('Run db/add-columns — missing: ' + missingColumns.join(', '));
  }

  /* ── Is the knowledge reachable? ───────────────────────────────────
     Counts rather than a boolean, because the failures here are partial.
     Approved nodes with no index rows is the dangerous one: it looks like
     it works and answers nothing. */
  const counts = await one(env,
    "SELECT " +
    " (SELECT COUNT(*) FROM knowledge_nodes) AS nodes," +
    " (SELECT COUNT(*) FROM knowledge_nodes WHERE status='approved') AS approved," +
    " (SELECT COUNT(*) FROM knowledge_nodes WHERE status IN ('draft','proposed')) AS queue," +
    " (SELECT COUNT(*) FROM knowledge_facts) AS facts," +
    " (SELECT COUNT(*) FROM knowledge_facts WHERE status='approved') AS approved_facts," +
    " (SELECT COUNT(*) FROM knowledge_edges) AS edges," +
    " (SELECT COUNT(*) FROM knowledge_terms) AS terms," +
    " (SELECT COUNT(*) FROM knowledge_maps) AS maps," +
    " (SELECT COUNT(*) FROM knowledge_actions WHERE state IN ('open','doing','waiting')) AS open_actions"
  );

  const unindexed = await one(env,
    "SELECT COUNT(*) AS n FROM knowledge_nodes n WHERE n.status = 'approved' " +
    'AND NOT EXISTS (SELECT 1 FROM knowledge_terms t WHERE t.node_id = n.id)'
  );
  if (unindexed && unindexed.n) {
    problems.push(unindexed.n + ' approved node(s) have no search terms — they are ' +
      'approved and unfindable. Re-save them, or run db/2026-09-approve-seed.sql.');
  }

  if (counts && counts.approved === 0 && counts.nodes > 0) {
    problems.push('Nothing is approved, so the ask box and Compliance Maker will ' +
      'find nothing. Clear the review queue or run db/2026-09-approve-seed.sql.');
  }

  return json({
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    // The headline. If this is empty the deployment is assembled correctly.
    problems,
    migrations: {
      applied: applied.length,
      expected: EXPECTED_MIGRATIONS.length,
      pending
    },
    columns: { missing: missingColumns },
    bindings,
    models: {
      text: TEXT_MODEL,
      embed: EMBED_MODEL,
      embedDimensions: EMBED_DIMENSIONS,
      // A dimension mismatch is rejected at query time, not at deploy, which
      // is a confusing way to discover it.
      semanticActive: semanticEnabled(env)
    },
    knowledge: counts || {},
    unindexedApproved: (unindexed && unindexed.n) || 0
  });
});

async function one(env, sql) {
  try {
    return await env.DB.prepare(sql).first();
  } catch (err) {
    return null;
  }
}
