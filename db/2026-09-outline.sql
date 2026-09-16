-- =====================================================================
-- Outline: one relation the outline view can always draw.
--
-- The Maps outline is a second view of the same nodes and edges as the
-- graph. A line indented under another IS an edge from the parent to the
-- child. But the graph is typed: `contains` is legal only down the physical
-- hierarchy (system → equipment → component), so a note under a clause, or
-- a requirement under a project heading, has no relation the trigger will
-- accept — and an outline that can only indent equipment is not an outline.
--
-- `under` is that relation: "filed beneath", an organising edge that says
-- nothing engineering about either end. It is legal between every pair of
-- kinds, drawn on the canvas like any edge, offered as a spine in the
-- hierarchy picker, and never used by Compliance Maker as a fact.
--
-- Runs AFTER 2026-09-domain-kinds.sql, so every registered kind — the
-- English word-map kinds included — is in the cross join. Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-outline.sql
-- =====================================================================

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind, to_kind, relation)
SELECT a.kind, b.kind, 'under'
  FROM knowledge_kinds a, knowledge_kinds b;

INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-outline.sql', datetime('now'), 'under: the outline relation, legal for every kind pair');
