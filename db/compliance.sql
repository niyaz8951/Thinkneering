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
  path        TEXT,                       -- hierarchy path, feeds section rollup
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
  path        TEXT,
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
  path        TEXT,
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
  path        TEXT,
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
  path        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_chiller_ksa_norm ON answer_log_chiller_ksa (norm_text);

-- ---------------------------------------------------- learned knowledge
-- Everything the AI knows about a product/factory lives HERE, not in code.
-- Both tables ship EMPTY: with nothing on file the model is told so plainly
-- and answers from the datasheet and library alone. Knowledge arrives by
-- being confirmed, never by being typed into a source file.

-- Reference data: the facts a clause gets checked against. Replaces the
-- FACTORY_CONFIG constant that used to sit in functions/api/compliance/
-- ai-suggest.js. status: draft (learned, not yet trusted) | trusted (used in
-- prompts) | blocked (admin says never use this).
CREATE TABLE IF NOT EXISTS compliance_facts (
  id            TEXT PRIMARY KEY,
  product       TEXT NOT NULL,
  factory       TEXT NOT NULL,
  topic         TEXT NOT NULL DEFAULT '',   -- e.g. Panel, Filter, Fan, Controls
  label         TEXT NOT NULL,              -- e.g. Insulation
  value         TEXT NOT NULL,              -- e.g. 42mm PU foam
  source        TEXT NOT NULL DEFAULT '',   -- where it came from
  status        TEXT NOT NULL DEFAULT 'draft',
  confirmations INTEGER NOT NULL DEFAULT 0, -- times a human answer agreed
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cfacts_pair ON compliance_facts (product, factory, status);

-- What a section IS. Keyed on the hierarchy path the parser already builds
-- ("PART 2 PRODUCTS > 2.02 CASING"), normalised. Rebuilt from confirmed
-- answers; AI-sourced rows are excluded from the rollup on purpose, so the
-- tool never learns from its own guesses.
-- summary_locked = an admin wrote this summary; a rebuild leaves it alone.
CREATE TABLE IF NOT EXISTS compliance_sections (
  id             TEXT PRIMARY KEY,
  product        TEXT NOT NULL,
  factory        TEXT NOT NULL,
  path_norm      TEXT NOT NULL,             -- lowercased, collapsed
  path_label     TEXT NOT NULL DEFAULT '',  -- as last seen, for display
  summary        TEXT NOT NULL DEFAULT '',  -- what this section is about
  summary_locked INTEGER NOT NULL DEFAULT 0,
  typical_status TEXT NOT NULL DEFAULT '',  -- most common confirmed status
  sample_clauses TEXT NOT NULL DEFAULT '',  -- JSON array, rollup input
  n_answers      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'draft',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_csections_path ON compliance_sections (product, factory, path_norm);

-- Every suggestion the AI has made, written at the moment it makes it. This
-- is the half of the comparison that would otherwise be lost: when a
-- completed matrix comes back, "what did we say about this clause" has to be
-- answerable, and the exported file only carries the FINAL text. Without this
-- table a correction is indistinguishable from an answer nobody touched.
CREATE TABLE IF NOT EXISTS compliance_suggestions (
  id          TEXT PRIMARY KEY,
  product     TEXT NOT NULL,
  factory     TEXT NOT NULL,
  norm_text   TEXT NOT NULL,
  spec_text   TEXT NOT NULL,
  path        TEXT,
  ai_status   TEXT NOT NULL DEFAULT '',
  ai_remarks  TEXT NOT NULL DEFAULT '',
  ai_verified INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_csug_lookup ON compliance_suggestions (product, factory, norm_text);

-- The training signal: what the AI proposed against what a human shipped.
-- verdict: accepted (unchanged) | corrected (edited) | new (no suggestion on
-- file — the human answered a clause the AI never saw).
CREATE TABLE IF NOT EXISTS compliance_feedback (
  id            TEXT PRIMARY KEY,
  product       TEXT NOT NULL,
  factory       TEXT NOT NULL,
  norm_text     TEXT NOT NULL,
  spec_text     TEXT NOT NULL,
  path          TEXT,
  ai_status     TEXT NOT NULL DEFAULT '',
  ai_remarks    TEXT NOT NULL DEFAULT '',
  final_status  TEXT NOT NULL DEFAULT '',
  final_remarks TEXT NOT NULL DEFAULT '',
  verdict       TEXT NOT NULL,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cfb_pair ON compliance_feedback (product, factory, verdict);

-- What sections a product can physically HAVE, learned from datasheets.
--
-- Distinct from compliance_sections, which is about the SPECIFICATION's
-- hierarchy ("PART 2 PRODUCTS > 2.02 CASING"). This is about the EQUIPMENT:
-- an AHU selection report lists its own sections — Mixing Box, Filter, Coil
-- Cooling DX, Fan, Empty Section — and that list tells the AI two things it
-- otherwise has to guess:
--   1. which datasheet values belong to which part of the unit, so a casing
--      clause is never answered with the coil's tube thickness;
--   2. whether a clause is even about something this unit has.
--
-- Rows arrive as 'draft' from real datasheets and an admin promotes them.
-- times_seen is how often a section has appeared, so the common ones sort to
-- the top of the review queue.
CREATE TABLE IF NOT EXISTS compliance_unit_sections (
  id          TEXT PRIMARY KEY,
  product     TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  name        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',   -- admin's description of the section
  times_seen  INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | trusted | blocked
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cus_name ON compliance_unit_sections (product, name_norm);

-- If your answer_log_* tables already exist from an earlier deploy, add the
-- path column by hand (it cannot go in this file — a second run would fail):
--   ALTER TABLE answer_log_ahu_uae ADD COLUMN path TEXT;   (and the other four)

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

-- The re-upload lives behind its own item, so "may teach the AI" is granted
-- per user in /admin/ exactly like AI review — and independently of it.
INSERT OR IGNORE INTO items
  (id,section_id,slug,title,description,kind,href,icon,badge,access_level,required_plan,teaser,sort_order,is_published,updated_at)
VALUES
  ('itm_cm_train','sec_compliance','training','Teach the AI',
   'Upload a completed matrix so corrections become the answers everyone gets next time.',
   'tool','/tools/compliance-maker/','upload','Pro','restricted','pro',
   'Ask an admin for access to submit completed matrices.',4,1,datetime('now'));
