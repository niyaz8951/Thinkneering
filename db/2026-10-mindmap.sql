-- =====================================================================
-- Mind map rework: reading notes, per-node AI lock, AI opinion.
--
-- Three columns, each earning its place:
--
--   notes     Rich HTML the user writes and reads on their phone. Kept
--             SEPARATE from `body` on purpose. `body` is knowledge the
--             graph publishes downstream — editing it un-approves the
--             node. `notes` is the user's own reading material and never
--             touches the retrieval index or the approval state, so
--             jotting something on the train does not pull a node out of
--             Compliance Maker.
--
--   ai_open   1 = AI review may rewrite this node. 0 = the human has
--             said this is final and AI must leave it alone. Defaults to
--             1 so existing nodes keep behaving as they do today; the
--             user closes the ones they have finished with.
--
--   ai_note   What the last AI review thought about this node. Shown
--             inside the notes panel, never merged into the node's own
--             fields. The user reads it and decides.
--
-- Re-runnable. SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run
-- reports "duplicate column name" on each ALTER — harmless, and it means
-- the column is already there.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-10-mindmap.sql
-- =====================================================================

ALTER TABLE knowledge_nodes ADD COLUMN notes TEXT;
ALTER TABLE knowledge_nodes ADD COLUMN ai_open INTEGER DEFAULT 1;
ALTER TABLE knowledge_nodes ADD COLUMN ai_note TEXT;
ALTER TABLE knowledge_nodes ADD COLUMN ai_note_at TEXT;

-- Anything already approved by a human is treated as settled: AI review
-- will not touch it until the user reopens it. New and draft nodes stay
-- open, which is where AI help is actually wanted.
UPDATE knowledge_nodes SET ai_open = 0 WHERE status = 'approved' AND ai_open IS NULL;
UPDATE knowledge_nodes SET ai_open = 1 WHERE ai_open IS NULL;

CREATE INDEX IF NOT EXISTS idx_kn_ai_open ON knowledge_nodes (map_id, ai_open);
