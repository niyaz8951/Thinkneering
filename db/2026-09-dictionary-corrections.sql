-- =====================================================================
-- Dictionary: the reviewer's corrections become the model's notes.
--
-- When a reviewer edits a drafted entry before approving it, the change is
-- kept here — the field, what the model wrote, what the reviewer wrote — and
-- the most recent corrections are shown to the model on every later
-- generation as "how the reviewer wants this done". A standing note the
-- reviewer writes by hand lives in settings under 'dictionary_guidance'.
--
-- Re-runnable. No ALTER.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-dictionary-corrections.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS dictionary_corrections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    INTEGER NOT NULL,
  term        TEXT NOT NULL,
  domain      TEXT NOT NULL DEFAULT 'general',
  field       TEXT NOT NULL,          -- meaning | hindi | urdu | urdu_roman | origin | connection | memory_hook | term | pos
  ai_value    TEXT,                   -- what the model wrote
  human_value TEXT,                   -- what the reviewer changed it to
  reviewer    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dictionary_corrections_recent
  ON dictionary_corrections (domain, created_at DESC);

INSERT OR IGNORE INTO settings (key, value) VALUES ('dictionary_guidance', '');

INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-dictionary-corrections.sql', datetime('now'), 'reviewer corrections feed the model');
