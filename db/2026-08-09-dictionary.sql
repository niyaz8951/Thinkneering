-- Thinkneering — AI Dictionary (TN-11)
-- Re-runnable. No DROP statements. Safe against the live database.

CREATE TABLE IF NOT EXISTS dictionary_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  term          TEXT NOT NULL,
  term_key      TEXT NOT NULL,
  domain        TEXT NOT NULL DEFAULT 'general',

  -- Core payload. NULL means "not worth showing" and is respected by the UI.
  meaning       TEXT,
  usage_json    TEXT,   -- JSON array of example sentences
  senses_json   TEXT,   -- JSON array of { field, sense }
  related_json  TEXT,   -- JSON { synonyms:[], antonyms:[], concepts:[] }
  memory_hook   TEXT,

  -- Gated blocks. Generated but NEVER served until a human approves the row.
  connection    TEXT,
  origin        TEXT,

  source        TEXT NOT NULL DEFAULT 'ai',      -- ai | kg | human
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  model         TEXT,
  context_seen  TEXT,   -- sentence that triggered the first generation
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by   TEXT,
  approved_at   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_entries_key
  ON dictionary_entries (term_key, domain);

CREATE INDEX IF NOT EXISTS idx_dictionary_entries_status
  ON dictionary_entries (status, domain);

-- Feedback loop, mirroring /api/knowledge/usage outcomes.
CREATE TABLE IF NOT EXISTS dictionary_lookups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  term_key    TEXT NOT NULL,
  domain      TEXT NOT NULL DEFAULT 'general',
  entry_id    INTEGER,
  outcome     TEXT NOT NULL DEFAULT 'used',  -- used | corrected | unanswered
  note        TEXT,
  page_path   TEXT,
  user_email  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dictionary_lookups_term
  ON dictionary_lookups (term_key, domain, outcome);

CREATE INDEX IF NOT EXISTS idx_dictionary_lookups_created
  ON dictionary_lookups (created_at);
