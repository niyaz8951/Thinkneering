-- 0003 (16 Oct 2026): the AI reads its rules from a map in Maps, product facts from AI notes in the Options tree,
-- and learns from what people do with its suggestions. Never edit after it has been applied; a correction is 0004.

-- Options tree: a third kind of extra, "ai" = an AI note (for the AI only; shown to editors in the tree).
-- SQLite cannot change a CHECK constraint, so the table is rebuilt with the same columns and rows.
PRAGMA defer_foreign_keys = true;
CREATE TABLE po_extras_new (
  id         TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL REFERENCES cm_factories(id) ON DELETE CASCADE,
  section    TEXT NOT NULL,
  row_key    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL CHECK (kind IN ('option','note','ai')),
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO po_extras_new (id, factory_id, section, row_key, kind, body, created_by, created_at, updated_by, updated_at)
  SELECT id, factory_id, section, row_key, kind, body, created_by, created_at, updated_by, updated_at FROM po_extras;
DROP TABLE po_extras;
ALTER TABLE po_extras_new RENAME TO po_extras;
CREATE INDEX po_extras_factory ON po_extras (factory_id);

-- The maps the AI reads: chosen by name in Compliance review > AI rules, one for every factory of a product
-- (factory_id NULL) and one per factory. A Riyadh record reads both, Riyadh's first. Deleting the map unlinks it.
CREATE TABLE ai_map_links (
  product_id TEXT NOT NULL REFERENCES cm_products(id) ON DELETE CASCADE,
  factory_id TEXT REFERENCES cm_factories(id) ON DELETE CASCADE,
  map_id     TEXT NOT NULL REFERENCES mp_maps(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ai_map_links_scope ON ai_map_links (product_id, ifnull(factory_id, ''));

-- Focus mode: the suggestion made for a clause, kept so that opening the clause again costs nothing.
-- spec_hash ties it to the clause text; a changed clause, rule or answer makes a new one (see ai/suggest.ts).
CREATE TABLE ai_suggestions (
  run_id     TEXT NOT NULL REFERENCES cm_runs(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  spec_hash  TEXT NOT NULL,
  basis      TEXT NOT NULL DEFAULT '',            -- what it was made from (answers / rules version): a change makes it stale
  payload    TEXT NOT NULL,                       -- JSON: { compliance, remarks, reason, confidence, source, sources }
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (run_id, seq)
);

-- What people did with a suggestion or a draft: the data the AI learns from (and the quality figures).
CREATE TABLE ai_feedback (
  id          TEXT PRIMARY KEY,
  run_id      TEXT REFERENCES cm_runs(id) ON DELETE SET NULL,
  seq         INTEGER,
  line_id     TEXT REFERENCES cm_lines(id) ON DELETE SET NULL,
  product_id  TEXT,
  factory_id  TEXT,
  part        INTEGER NOT NULL DEFAULT 0,
  section     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',            -- datasheet | options | library | record | project | rule | model
  suggested   TEXT NOT NULL DEFAULT '',            -- the proposed Compliance
  suggested_remarks TEXT NOT NULL DEFAULT '',
  final       TEXT NOT NULL DEFAULT '',            -- what the person kept
  final_remarks TEXT NOT NULL DEFAULT '',
  outcome     TEXT NOT NULL DEFAULT '',            -- kept | edited | replaced
  user_id     TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ai_feedback_at ON ai_feedback (factory_id, created_at);

-- The clause-to-datasheet-row match of a record (the blue chips), worked out once and kept: it is the most work
-- of a request, and a record's rows and the row mapping rarely change. stamp = hash of both; a change recomputes.
CREATE TABLE ai_match_cache (
  run_id     TEXT PRIMARY KEY REFERENCES cm_runs(id) ON DELETE CASCADE,
  stamp      TEXT NOT NULL,
  payload    TEXT NOT NULL,                       -- JSON: { "<row key>": [seq, ...] }
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
