-- =====================================================================
-- The migration ledger.
--
-- Which migrations have run has lived in a doc and in your head. That
-- works for fifteen files and fails for fifty — and it already failed
-- once: the `duplicate column: scope` incident was a half-applied file
-- that reported a warning and left every statement after it unrun. The
-- schema looked applied and was not, and nothing could tell you that.
--
-- Each migration now records its own name as its last statement. That
-- matters more than a runner script would, because it works whichever way
-- you apply it — wrangler from a PC, the Cloudflare console from a phone,
-- or a CI job. A ledger that only stays correct when you use one specific
-- tool is a ledger you cannot trust.
--
-- To see where you stand:
--   SELECT name, applied_at FROM schema_migrations ORDER BY name;
--
-- Anything in db/ not listed there has not run.
--
-- Run this FIRST, before any other migration.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-migration-ledger.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Free text: how it was applied, or anything worth knowing in two years
  -- when a number looks wrong and you are working out when it changed.
  note       TEXT NOT NULL DEFAULT ''
);

-- ── Backfill ─────────────────────────────────────────────────────────
-- Everything below already ran on the live database before this table
-- existed. Recorded as 'backfilled' rather than pretending to know when:
-- a wrong date is worse than an honest absence.
--
-- INSERT OR IGNORE, so running this on a fresh database that has NOT had
-- these applied is still wrong — but running it twice on a live one is
-- harmless. On a fresh database, apply the files and let each record
-- itself; delete the rows below first if you want the dates real.

INSERT OR IGNORE INTO schema_migrations (name, applied_at, note) VALUES
  ('schema.sql',                        datetime('now'), 'backfilled'),
  ('compliance.sql',                    datetime('now'), 'backfilled'),
  ('2026-08-09-dictionary.sql',         datetime('now'), 'backfilled'),
  ('2026-08-09b-dictionary-graph.sql',  datetime('now'), 'backfilled'),
  ('2026-08-10-dictionary-translit.sql', datetime('now'), 'backfilled'),
  ('2026-08-10b-dictionary-book.sql',   datetime('now'), 'backfilled'),
  ('2026-08-13-dictionary-urdu-refresh.sql', datetime('now'), 'backfilled'),
  ('2026-08-catalog-knowledge.sql',     datetime('now'), 'backfilled'),
  ('2026-08-education-portable.sql',    datetime('now'), 'backfilled'),
  ('2026-08-knowledge-graph.sql',       datetime('now'), 'backfilled'),
  ('2026-08-process-map.sql',           datetime('now'), 'backfilled'),
  ('2026-08-signup-approval.sql',       datetime('now'), 'backfilled'),
  ('2026-09-knowledge-lanes.sql',       datetime('now'), 'backfilled'),
  ('2026-10-dictionary-english.sql',    datetime('now'), 'backfilled'),
  ('2026-10-mindmap.sql',               datetime('now'), 'backfilled');

-- ── Columns ──────────────────────────────────────────────────────────
-- The ALTERs in db/add-columns.sh cannot record themselves: each is its
-- own wrangler call precisely so one failing does not stop the next, and
-- a two-statement call would reintroduce that problem.
--
-- They are checkable directly instead, which is better than a ledger row:
--   SELECT COUNT(*) FROM pragma_table_info('knowledge_nodes') WHERE name='scope';
-- /api/admin/health does this for all seven and reports any that are
-- missing.

INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-migration-ledger.sql', datetime('now'), 'self-recorded');
