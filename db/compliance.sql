-- Thinkneering — Compliance Maker tables (additive, safe to re-run)
--
--   npx wrangler d1 execute thinkneering-db --file=db/compliance.sql --remote
--
-- Use this on a database that already has data. db/schema.sql contains the
-- same statements for a fresh install, but that file DROPS everything first,
-- so never run it against a live site to get these tables.
--
-- One table per (product, factory) PAIR rather than one table with a product
-- column. The pairs are not a grid: AHU is built in UAE and KSA, FCU only in
-- China, Air Cooled Chiller in Italy and KSA. The same clause can have a
-- different correct answer per factory, so separating them at the table level
-- makes a cross-factory comparison impossible by construction rather than by
-- remembering a WHERE clause. functions/_compliance.js answerLogTable() is
-- the only place a table name is built, and only from validated values.

CREATE TABLE IF NOT EXISTS answer_log_ahu_uae (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  norm_text   TEXT NOT NULL,
  spec_text   TEXT NOT NULL,
  compliance  TEXT NOT NULL DEFAULT '',
  remarks     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',   -- library-exact | library-fuzzy | rule | ai
  created_by  TEXT,                       -- users.id (TEXT on this site)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_ahu_uae_norm ON answer_log_ahu_uae (norm_text);

CREATE TABLE IF NOT EXISTS answer_log_ahu_ksa (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  norm_text   TEXT NOT NULL,
  spec_text   TEXT NOT NULL,
  compliance  TEXT NOT NULL DEFAULT '',
  remarks     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_ahu_ksa_norm ON answer_log_ahu_ksa (norm_text);

CREATE TABLE IF NOT EXISTS answer_log_fcu_china (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  norm_text   TEXT NOT NULL,
  spec_text   TEXT NOT NULL,
  compliance  TEXT NOT NULL DEFAULT '',
  remarks     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_fcu_china_norm ON answer_log_fcu_china (norm_text);

CREATE TABLE IF NOT EXISTS answer_log_chiller_italy (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  norm_text   TEXT NOT NULL,
  spec_text   TEXT NOT NULL,
  compliance  TEXT NOT NULL DEFAULT '',
  remarks     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_chiller_italy_norm ON answer_log_chiller_italy (norm_text);

CREATE TABLE IF NOT EXISTS answer_log_chiller_ksa (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  norm_text   TEXT NOT NULL,
  spec_text   TEXT NOT NULL,
  compliance  TEXT NOT NULL DEFAULT '',
  remarks     TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_chiller_ksa_norm ON answer_log_chiller_ksa (norm_text);

-- The three cards in the Compliance Maker section all open the same page —
-- the tool decides what to show from the visitor's tier, so the ?mode=
-- parameters the seed carried are no longer read by anything.
UPDATE items SET href = '/tools/compliance-maker/', updated_at = datetime('now')
 WHERE section_id = (SELECT id FROM sections WHERE slug = 'compliance-maker' AND parent_id IS NULL)
   AND kind = 'tool';

UPDATE items SET
  description = 'Classify clauses against your selection datasheet and library, and draft compliance statements.',
  teaser      = 'Ask an admin for access to run AI clause review on your specification.',
  updated_at  = datetime('now')
 WHERE slug = 'ai-review'
   AND section_id = (SELECT id FROM sections WHERE slug = 'compliance-maker' AND parent_id IS NULL);

UPDATE items SET
  title       = 'Library pre-fill',
  description = 'Answers you have given before fill themselves in, and anything that contradicts one is flagged.',
  teaser      = 'Create an account to pre-fill from your library and keep an answer log.',
  updated_at  = datetime('now')
 WHERE slug = 'projects'
   AND section_id = (SELECT id FROM sections WHERE slug = 'compliance-maker' AND parent_id IS NULL);
