-- =====================================================================
-- Actions: what is outstanding, and what was actually done.
--
-- The graph holds what is true. It has no way to hold "chase the Jebel Ali
-- factory for the acoustic selection by Thursday", and no way to hold what
-- happened when you did. Those are different things and they need
-- different rows — bending `status` to carry workflow would break the one
-- meaning it has, which is whether Compliance Maker may quote a node.
--
-- The field that earns this table is `outcome`. An open action is a
-- reminder and expires. A closed action with an outcome written on it is a
-- precedent: what was asked, who answered, what they said, what it cost.
-- That is the part worth having a year later, and the part that is
-- normally lost in a mail thread.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-actions.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS knowledge_actions (
  id          TEXT PRIMARY KEY,
  map_id      TEXT NOT NULL,
  -- Nullable: an action can hang off the map rather than any one node.
  node_id     TEXT,
  title       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL DEFAULT 'open'
              CHECK (state IN ('open','doing','waiting','done','dropped')),
  -- 1 high, 2 normal, 3 low. An integer so ordering is a sort, not a CASE.
  priority    INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  due         TEXT,
  owner       TEXT NOT NULL DEFAULT '',
  -- Free text, deliberately: who you chased, what came back, what it cost.
  -- This is the reusable residue and the reason the table exists.
  outcome     TEXT NOT NULL DEFAULT '',
  -- Where the answer came from, when it came from outside: a mail, a
  -- quotation number, a factory reference.
  source_ref  TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  -- A closed action with nothing written on it teaches nobody anything.
  -- Not enforced for 'dropped': "we did not do this" is a complete outcome.
  CHECK (state <> 'done' OR outcome <> '')
);

CREATE INDEX IF NOT EXISTS idx_ka_map   ON knowledge_actions (map_id, state, priority);
CREATE INDEX IF NOT EXISTS idx_ka_node  ON knowledge_actions (node_id, state);
CREATE INDEX IF NOT EXISTS idx_ka_due   ON knowledge_actions (state, due);

-- closed_at is set by the row's own transition rather than by every caller
-- remembering to. A reopened action loses its closing date, which is right:
-- it is not closed.
DROP TRIGGER IF EXISTS trg_ka_close;
CREATE TRIGGER trg_ka_close
AFTER UPDATE OF state ON knowledge_actions
FOR EACH ROW
WHEN NEW.state IN ('done','dropped') AND OLD.state NOT IN ('done','dropped')
BEGIN
  UPDATE knowledge_actions SET closed_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_ka_reopen;
CREATE TRIGGER trg_ka_reopen
AFTER UPDATE OF state ON knowledge_actions
FOR EACH ROW
WHEN NEW.state NOT IN ('done','dropped') AND OLD.state IN ('done','dropped')
BEGIN
  UPDATE knowledge_actions SET closed_at = NULL WHERE id = NEW.id;
END;

-- ── What is outstanding ──────────────────────────────────────────────
-- Overdue first, then by priority, then by age. `overdue` is computed
-- here so every caller agrees on what late means.
DROP VIEW IF EXISTS knowledge_open_actions;
CREATE VIEW knowledge_open_actions AS
SELECT
  a.*,
  n.title AS node_title,
  n.kind  AS node_kind,
  CASE WHEN a.due IS NOT NULL AND a.due < date('now') THEN 1 ELSE 0 END AS overdue,
  CAST(julianday('now') - julianday(a.created_at) AS INTEGER) AS age_days
FROM knowledge_actions a
LEFT JOIN knowledge_nodes n ON n.id = a.node_id
WHERE a.state IN ('open','doing','waiting');

-- ── What was done ────────────────────────────────────────────────────
-- The searchable record. Most recent first, because the question is
-- almost always "have we hit this before, and what did we do".
DROP VIEW IF EXISTS knowledge_action_history;
CREATE VIEW knowledge_action_history AS
SELECT
  a.id, a.map_id, a.node_id, a.title, a.detail, a.outcome, a.source_ref,
  a.state, a.owner, a.created_at, a.closed_at,
  n.title AS node_title,
  n.kind  AS node_kind
FROM knowledge_actions a
LEFT JOIN knowledge_nodes n ON n.id = a.node_id
WHERE a.state IN ('done','dropped');
