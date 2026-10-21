-- Product Options (owner, 21 Oct 2026, later):
-- 1. where an option row is shown, as the editor moves it on the page: '' = by the card's rule, 'general' = one list for
--    the card (unique values), 'model' = one column per model (fan model, filter class, model box ...).
ALTER TABLE dn_map ADD COLUMN place TEXT NOT NULL DEFAULT '' CHECK (place IN ('', 'general', 'model'));

-- 2. a fourth kind of extra, "make" = a manufacturer the factory buys the component from (filters, fans, coils ...).
-- SQLite cannot change a CHECK constraint, so the table is rebuilt with the same columns and rows (as in 0003).
PRAGMA defer_foreign_keys = true;
CREATE TABLE po_extras_new (
  id         TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL REFERENCES cm_factories(id) ON DELETE CASCADE,
  section    TEXT NOT NULL,
  row_key    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL CHECK (kind IN ('option','note','ai','make')),
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
