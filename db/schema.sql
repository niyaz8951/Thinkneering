-- Thinkneering — D1 schema (v2, fresh start)
-- Apply:  npx wrangler d1 execute thinkneering-db --file=db/schema.sql --remote
--
-- Re-runnable: drops everything first. Order matters — a table must go before
-- any table it points at, or SQLite raises FOREIGN KEY constraint failed.
-- items -> books and sections, so items goes first.
--
-- D1 runs the whole file in one transaction, where SQLite checks foreign keys
-- immediately. defer_foreign_keys holds those checks until commit, so drop and
-- create order stops mattering — and any legacy tables left over from an older
-- version of the site cannot block the reset.
PRAGMA defer_foreign_keys = true;

-- Legacy tables from v1. Harmless if they never existed.
DROP TABLE IF EXISTS tool_access;
DROP TABLE IF EXISTS user_tools;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS matrices;

DROP TABLE IF EXISTS compliance_terms;
DROP TABLE IF EXISTS compliance_options;
DROP TABLE IF EXISTS compliance_criteria;
DROP TABLE IF EXISTS compliance_tree;
DROP TABLE IF EXISTS compliance_unit_sections;
DROP TABLE IF EXISTS compliance_suggestions;
DROP TABLE IF EXISTS compliance_feedback;
DROP TABLE IF EXISTS compliance_facts;
DROP TABLE IF EXISTS compliance_sections;
DROP TABLE IF EXISTS answer_log_ahu_uae;
DROP TABLE IF EXISTS answer_log_ahu_ksa;
DROP TABLE IF EXISTS answer_log_fcu_china;
DROP TABLE IF EXISTS answer_log_chiller_italy;
DROP TABLE IF EXISTS answer_log_chiller_ksa;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS usage_events;
DROP TABLE IF EXISTS grants;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS chapters;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS settings;

-- ---------------------------------------------------------------- people
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',     -- user | editor | admin
  status        TEXT NOT NULL DEFAULT 'active',   -- pending | active | suspended
  plan          TEXT NOT NULL DEFAULT 'member',   -- free | member | pro
  notes         TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ------------------------------------------------------------- catalogue
-- Sections are self-referencing: parent_id NULL = top-level section,
-- otherwise it is a subsection. Adding a section never needs new HTML.
CREATE TABLE sections (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES sections(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  tagline       TEXT,
  description   TEXT,
  icon          TEXT DEFAULT 'grid',
  access_level  TEXT NOT NULL DEFAULT 'public',   -- public | auth | restricted
  required_plan TEXT NOT NULL DEFAULT 'free',     -- free | member | pro
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT
);
CREATE UNIQUE INDEX idx_sections_path ON sections(IFNULL(parent_id,'~'), slug);

CREATE TABLE items (
  id            TEXT PRIMARY KEY,
  section_id    TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  kind          TEXT NOT NULL DEFAULT 'tool',     -- tool | book | link | page
  href          TEXT,                             -- for tool/link/page
  book_id       TEXT REFERENCES books(id) ON DELETE SET NULL,
  icon          TEXT DEFAULT 'square',
  badge         TEXT,                             -- e.g. New, Beta
  access_level  TEXT NOT NULL DEFAULT 'public',
  required_plan TEXT NOT NULL DEFAULT 'free',
  teaser        TEXT,                             -- shown on locked cards
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT
);
CREATE INDEX idx_items_section ON items(section_id);

-- ----------------------------------------------------------------- books
CREATE TABLE books (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  subtitle      TEXT,
  author        TEXT,
  cover_url     TEXT,
  description   TEXT,
  access_level  TEXT NOT NULL DEFAULT 'public',
  required_plan TEXT NOT NULL DEFAULT 'free',
  status        TEXT NOT NULL DEFAULT 'draft',    -- draft | published
  updated_at    TEXT
);

CREATE TABLE chapters (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,
  access_level  TEXT NOT NULL DEFAULT 'inherit',  -- inherit | public | auth | restricted
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  INTEGER NOT NULL DEFAULT 1,
  source_md     TEXT,                             -- what the writer typed
  updated_at    TEXT
);
CREATE INDEX idx_chapters_book ON chapters(book_id);

-- One row per content block. type drives the renderer in assets/js/blocks.js
CREATE TABLE blocks (
  id         TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- heading|text|image|table|chart|callout|quote|list|code|divider
  data       TEXT NOT NULL,   -- JSON payload
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_blocks_chapter ON blocks(chapter_id);

-- ------------------------------------------------------------ permissions
-- Explicit per-user unlock. Overrides required_plan for restricted content.
CREATE TABLE grants (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,   -- section | item | book
  scope_id   TEXT NOT NULL,
  granted_by TEXT,
  granted_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE UNIQUE INDEX idx_grants_unique ON grants(user_id, scope_type, scope_id);

-- ------------------------------------------------------------- operations
CREATE TABLE usage_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  anon_id    TEXT,
  action     TEXT NOT NULL,   -- view | open | export | denied
  target     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_usage_created ON usage_events(created_at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT,
  actor_email TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ------------------------------------------------- compliance answer log
-- One table per (product, factory) PAIR, not one table with a product
-- column: the pairs are not a grid (AHU -> UAE, KSA; FCU -> China;
-- Air Cooled Chiller -> Italy, KSA), and the same clause can have a
-- different correct answer per factory. Separate tables make a
-- cross-factory comparison impossible by construction. Identical
-- statements live in db/compliance.sql for adding these to a live
-- database, since this file drops everything first.
CREATE TABLE answer_log_ahu_uae (
  id INTEGER PRIMARY KEY AUTOINCREMENT, norm_text TEXT NOT NULL, spec_text TEXT NOT NULL,
  compliance TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', path TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_al_ahu_uae_norm ON answer_log_ahu_uae (norm_text);

CREATE TABLE answer_log_ahu_ksa (
  id INTEGER PRIMARY KEY AUTOINCREMENT, norm_text TEXT NOT NULL, spec_text TEXT NOT NULL,
  compliance TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', path TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_al_ahu_ksa_norm ON answer_log_ahu_ksa (norm_text);

CREATE TABLE answer_log_fcu_china (
  id INTEGER PRIMARY KEY AUTOINCREMENT, norm_text TEXT NOT NULL, spec_text TEXT NOT NULL,
  compliance TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', path TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_al_fcu_china_norm ON answer_log_fcu_china (norm_text);

CREATE TABLE answer_log_chiller_italy (
  id INTEGER PRIMARY KEY AUTOINCREMENT, norm_text TEXT NOT NULL, spec_text TEXT NOT NULL,
  compliance TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', path TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_al_chiller_italy_norm ON answer_log_chiller_italy (norm_text);

CREATE TABLE answer_log_chiller_ksa (
  id INTEGER PRIMARY KEY AUTOINCREMENT, norm_text TEXT NOT NULL, spec_text TEXT NOT NULL,
  compliance TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', path TEXT, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_al_chiller_ksa_norm ON answer_log_chiller_ksa (norm_text);

-- ---------------------------------------------------- learned knowledge
-- Everything the AI knows about a product/factory lives HERE, not in code.
-- Both tables ship EMPTY: with nothing on file the model is told so plainly
-- and answers from the datasheet and library alone. Knowledge arrives by
-- being confirmed, never by being typed into a source file.

-- Reference data: the facts a clause gets checked against. Replaces the
-- FACTORY_CONFIG constant that used to sit in functions/api/compliance/
-- ai-suggest.js. status: draft (learned, not yet trusted) | trusted (used in
-- prompts) | blocked (admin says never use this).
CREATE TABLE compliance_facts (
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
CREATE INDEX idx_cfacts_pair ON compliance_facts (product, factory, status);

-- What a section IS. Keyed on the hierarchy path the parser already builds
-- ("PART 2 PRODUCTS > 2.02 CASING"), normalised. Rebuilt from confirmed
-- answers; AI-sourced rows are excluded from the rollup on purpose, so the
-- tool never learns from its own guesses.
-- summary_locked = an admin wrote this summary; a rebuild leaves it alone.
CREATE TABLE compliance_sections (
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
CREATE UNIQUE INDEX idx_csections_path ON compliance_sections (product, factory, path_norm);

-- Every suggestion the AI has made, written at the moment it makes it. This
-- is the half of the comparison that would otherwise be lost: when a
-- completed matrix comes back, "what did we say about this clause" has to be
-- answerable, and the exported file only carries the FINAL text. Without this
-- table a correction is indistinguishable from an answer nobody touched.
CREATE TABLE compliance_suggestions (
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
CREATE INDEX idx_csug_lookup ON compliance_suggestions (product, factory, norm_text);

-- The training signal: what the AI proposed against what a human shipped.
-- verdict: accepted (unchanged) | corrected (edited) | new (no suggestion on
-- file — the human answered a clause the AI never saw).
CREATE TABLE compliance_feedback (
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
CREATE INDEX idx_cfb_pair ON compliance_feedback (product, factory, verdict);

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
CREATE TABLE compliance_unit_sections (
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
CREATE UNIQUE INDEX idx_cus_name ON compliance_unit_sections (product, name_norm);

-- Vocabulary. Terms the tool has met, what they mean, what they are called
-- elsewhere, and what range is normal in the market.
--
-- THE BOUNDARY THAT MATTERS: nothing in this table is ever a SOURCE for an
-- answer. It feeds three things only —
--   1. aliases, so "thermal break profile" reaches a field labelled "Profile"
--   2. the section taxonomy, so a clause about a heat recovery wheel is
--      recognised as being about a section an AHU can have
--   3. plausibility warnings, shown to a human, never written into a remark
-- A consultant is told what THIS unit is, from the datasheet and the library.
-- General market knowledge does not get a vote in that.
--
-- kind:   section | component | property | standard
-- status: new (seen, undescribed) | draft (described, unreviewed)
--         | trusted (admin confirmed) | blocked (ignore)
-- source: where the description came from — 'model' for the AI's own general
--         knowledge, a URL if it was looked up, 'admin' if typed by a person.
CREATE TABLE compliance_terms (
  id            TEXT PRIMARY KEY,
  product       TEXT NOT NULL,
  term          TEXT NOT NULL,
  term_norm     TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'component',
  definition    TEXT NOT NULL DEFAULT '',
  aliases       TEXT NOT NULL DEFAULT '',   -- comma separated
  typical_range TEXT NOT NULL DEFAULT '',   -- free text, e.g. "25-75 mm"
  range_min     REAL,                       -- parsed, for plausibility checks
  range_max     REAL,
  range_unit    TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new',
  times_seen    INTEGER NOT NULL DEFAULT 1,
  first_seen    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_cterms_name ON compliance_terms (product, term_norm);

-- ------------------------------------------------------ the knowledge tree
-- One tree per product, holding the two vocabularies a compliance job draws
-- on, because they are learned from different documents and answered in
-- different ways:
--
--   THE DATASHEET SIDE  — what the machine IS.
--     kind='unit-section'  Mixing Box Supply, Filter Supply, Fan Supply
--     kind='component'       (child) Filter Class, Tube Material, Damper
--     Learned from uploaded selection reports.
--
--   THE SPECIFICATION SIDE — what a clause is ASKING.
--     kind='spec-topic'    a section of the specification, classified by
--                          what kind of question it asks
--     Learned from confirmed answers, never from AI guesses.
--
-- `scope` is the useful part, and only applies to spec-topics:
--   product     — answerable from the datasheet and the library
--   contractor  — site execution: installation, rigging, commissioning.
--                 Not a technical question at all; it is a scope-of-supply
--                 answer with fixed wording.
--   reference   — standards, certification, submittals. Answered from the
--                 library and facts, NEVER from a datasheet measurement.
--   unknown     — not enough confirmed answers to say yet.
--
-- The distinction matters because the same phrasing means different things in
-- each: "shall be 50 mm" in a product topic is a value to check against the
-- unit, and in a contractor topic is somebody else's problem entirely.
CREATE TABLE compliance_tree (
  id          TEXT PRIMARY KEY,
  product     TEXT NOT NULL,
  parent_id   TEXT,
  kind        TEXT NOT NULL,               -- unit-section | component | spec-topic
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'unknown',
  notes       TEXT NOT NULL DEFAULT '',
  times_seen  INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft',   -- draft | trusted | blocked
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_ctree_node ON compliance_tree (product, kind, name_norm);
CREATE INDEX idx_ctree_parent ON compliance_tree (product, parent_id);

-- How to COMPARE a value against a requirement.
--
-- The tool could already read "clause wants 50 mm, unit has 62 mm" and could
-- not tell whether that was good news. It answered Not Comply, because the
-- numbers differed. For panel thickness, more is better; for pressure drop,
-- less is better; for a thermal-bridging class, TB2 beats TB3 and the
-- numbers run backwards. None of that is derivable from the values.
--
--   direction: higher | lower | exact | unknown
--     higher  more is better  (thickness, efficiency, filter class)
--     lower   less is better  (pressure drop, leakage, sound power)
--     exact   must match      (voltage, connection size)
--     unknown do not conclude anything from the number alone
--
--   scale_order: for classed values, WORST to BEST, comma separated.
--     EN1886 thermal bridging runs TB5 (worst) .. TB1 (best), so the order
--     is stored explicitly rather than inferred from the digit.
--
-- match_terms decides which criterion a clause and a field are about.
CREATE TABLE compliance_criteria (
  id           TEXT PRIMARY KEY,
  product      TEXT NOT NULL,
  name         TEXT NOT NULL,
  name_norm    TEXT NOT NULL,
  match_terms  TEXT NOT NULL DEFAULT '',   -- comma separated
  direction    TEXT NOT NULL DEFAULT 'unknown',
  unit         TEXT NOT NULL DEFAULT '',   -- mm, Pa, %, or blank for classed
  scale_order  TEXT NOT NULL DEFAULT '',   -- worst,...,best
  notes        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'trusted',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_ccrit_name ON compliance_criteria (product, name_norm);

-- What the factory actually OFFERS, accumulated from every datasheet ever
-- uploaded. One row per (field, value) pair seen.
--
-- The point: a selection report describes ONE unit, and once it has been read
-- the knowledge in it is thrown away. Over a few dozen reports the same
-- fields recur with a small set of values — panel insulation is 62 mm here
-- and 42 mm there — and that set IS the product range. Recording it means
-- the tool can still answer a casing clause when no datasheet is attached,
-- from the standard offering instead of from nothing.
--
-- is_default marks the value quoted when there is no datasheet. It is set
-- automatically from whichever value has been seen most, and overridden by
-- re-uploading the exported sheet with the columns reordered.
--
-- NOT every field belongs here. Serial numbers, air flow, project weights are
-- specific to one job and will accumulate one row each, seen once. That is
-- what times_seen is for: a genuine option recurs, a project value does not.
CREATE TABLE compliance_options (
  id          TEXT PRIMARY KEY,
  product     TEXT NOT NULL,
  field       TEXT NOT NULL,              -- section-qualified label
  field_norm  TEXT NOT NULL,
  value       TEXT NOT NULL,
  value_norm  TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  times_seen  INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft',   -- draft | trusted | blocked
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_copt_val ON compliance_options (product, field_norm, value_norm);
CREATE INDEX idx_copt_field ON compliance_options (product, field_norm);

-- ------------------------------------------------------------------ seed
INSERT INTO settings (key, value) VALUES
  ('site_name',        'Thinkneering'),
  ('signup_mode',      'open'),          -- open | approval | closed
  ('maintenance',      'off'),
  ('announcement',     ''),
  ('default_plan',     'member'),
  ('ai_features',      'on');

INSERT INTO sections (id,parent_id,slug,title,tagline,description,icon,access_level,required_plan,sort_order,is_published,updated_at) VALUES
 ('sec_compliance', NULL, 'compliance-maker','Compliance Maker','Specs in, matrix out','Turn specification documents into a formatted compliance matrix. Conversion and formatting are free, up to ten pages. An account raises that to fifty and pre-fills from your library; AI clause review is granted per user.','file-check','public','free',1,1,datetime('now')),
 ('sec_tools',      NULL, 'tools','Tools','Small utilities, no setup','Single-purpose office tools that run entirely in your browser.','tool','public','free',2,1,datetime('now')),
 ('sec_hvac',       NULL, 'hvac','HVAC','Reference and calculation','Standards references and engineering calculators for HVAC work.','wind','public','free',3,1,datetime('now')),
 ('sec_education',  NULL, 'education','Education','Read and learn','Long-form books and study material, published in a distraction-free reader.','book-open','public','free',4,1,datetime('now'));

INSERT INTO sections (id,parent_id,slug,title,tagline,description,icon,access_level,required_plan,sort_order,is_published,updated_at) VALUES
 ('sec_hvac_std',   'sec_hvac','standards','Standards','Free reference','Summaries and lookup tables for common HVAC standards.','list','public','free',1,1,datetime('now')),
 ('sec_hvac_calc',  'sec_hvac','calculators','Calculators','Account required','Load, duct and psychrometric calculators.','calculator','auth','member',2,1,datetime('now')),
 ('sec_edu_humonks','sec_education','humonks','Humonks','Original titles','Books written and published by Thinkneering.','feather','public','free',1,1,datetime('now')),
 ('sec_edu_ncert',  'sec_education','ncert','NCERT','Curriculum notes','Chapter notes and worked examples aligned to NCERT.','graduation-cap','public','free',2,1,datetime('now'));

INSERT INTO items (id,section_id,slug,title,description,kind,href,icon,badge,access_level,required_plan,teaser,sort_order,is_published,updated_at) VALUES
 ('itm_cm_free','sec_compliance','converter','PDF to compliance matrix','Extract clauses from a specification PDF and export a formatted Excel matrix.','tool','/tools/compliance-maker/','file-check',NULL,'public','free',NULL,1,1,datetime('now')),
 ('itm_cm_ai','sec_compliance','ai-review','AI clause review','Classify clauses against your selection datasheet and library, and draft compliance statements.','tool','/tools/compliance-maker/','sparkles','Pro','restricted','member','Ask an admin for access to run AI clause review on your specification.',2,1,datetime('now')),
 ('itm_cm_train','sec_compliance','training','Teach the AI','Upload a completed matrix so corrections become the answers everyone gets next time.','tool','/tools/compliance-maker/','upload','Pro','restricted','pro','Ask an admin for access to submit completed matrices.',4,1,datetime('now')),
  ('itm_cm_db','sec_compliance','projects','Library pre-fill','Answers you have given before fill themselves in, and anything that contradicts one is flagged.','tool','/tools/compliance-maker/','database',NULL,'auth','free','Create an account to pre-fill from your library and keep an answer log.',3,1,datetime('now')),
 ('itm_word','sec_tools','word-counter','Word counter','Live word, character, sentence and reading-time counts.','tool','/tools/word-counter/','type',NULL,'public','free',NULL,1,1,datetime('now')),
 ('itm_unit','sec_tools','unit-converter','Unit converter','Convert length, mass, temperature, pressure, area and volume.','tool','/tools/unit-converter/','repeat',NULL,'public','free',NULL,2,1,datetime('now')),
 ('itm_hvac_ashrae','sec_hvac_std','ashrae-basics','Standards handbook','A reader-friendly reference to the standards that come up most often.','book',NULL,'book-open',NULL,'public','free',NULL,1,1,datetime('now')),
 ('itm_hvac_load','sec_hvac_calc','load-estimator','Cooling load estimator','Room-by-room sensible and latent load estimate.','tool','/tools/load-estimator/','calculator','Soon','auth','member','Sign in to use the load estimator.',1,1,datetime('now'));

INSERT INTO books (id,slug,title,subtitle,author,description,access_level,required_plan,status,updated_at) VALUES
 ('bk_hvac','hvac-standards','HVAC Standards, in plain language','What each standard actually asks you to do','Thinkneering','A working reference: scope, key clauses and the numbers you look up most.','public','free','published',datetime('now')),
 ('bk_humonks','humonks-first','Humonks','Book one','Thinkneering','The first Humonks title.','auth','free','published',datetime('now')),
 ('bk_ncert','ncert-science-8','NCERT Science — Class 8','Chapter notes and worked examples','Thinkneering','Notes, tables and figures for each chapter.','public','free','published',datetime('now'));

UPDATE items SET book_id='bk_hvac' WHERE id='itm_hvac_ashrae';

INSERT INTO items (id,section_id,slug,title,description,kind,book_id,icon,access_level,required_plan,teaser,sort_order,is_published,updated_at) VALUES
 ('itm_bk_humonks','sec_edu_humonks','humonks-first','Humonks — Book one','The first title in the series.','book','bk_humonks','book-open','auth','free','Sign in to read Humonks.',1,1,datetime('now')),
 ('itm_bk_ncert','sec_edu_ncert','ncert-science-8','NCERT Science — Class 8','Chapter notes, tables and figures.','book','bk_ncert','book-open','public','free',NULL,1,1,datetime('now'));

INSERT INTO chapters (id,book_id,slug,title,summary,access_level,sort_order,is_published,updated_at) VALUES
 ('ch_hvac_1','bk_hvac','how-to-use','How to use this book','What is covered and what is not.','public',1,1,datetime('now')),
 ('ch_hvac_2','bk_hvac','ventilation-rates','Ventilation rates','Outdoor air rates by occupancy type.','public',2,1,datetime('now')),
 ('ch_hvac_3','bk_hvac','commissioning','Commissioning checks','Field checks before handover.','auth',3,1,datetime('now')),
 ('ch_ncert_1','bk_ncert','crop-production','Crop production and management','Agricultural practices, tools and cycles.','public',1,1,datetime('now')),
 ('ch_hum_1','bk_humonks','opening','Opening','Where it starts.','inherit',1,1,datetime('now'));

INSERT INTO blocks (id,chapter_id,type,data,sort_order) VALUES
 ('blk1','ch_hvac_1','heading','{"level":2,"text":"What this book covers"}',1),
 ('blk2','ch_hvac_1','text','{"text":"Each chapter takes one standard and answers three questions: what it applies to, what it requires, and which numbers you will actually look up on a working day. Clause numbers are given so you can go back to the source."}',2),
 ('blk3','ch_hvac_1','callout','{"tone":"warning","title":"Not a substitute for the standard","text":"Summaries lose nuance. For submittals and approvals, cite the published standard."}',3),
 ('blk4','ch_hvac_2','heading','{"level":2,"text":"Outdoor air rates"}',1),
 ('blk5','ch_hvac_2','table','{"caption":"Indicative outdoor air rates by space type","headers":["Space type","Per person (L/s)","Per area (L/s·m²)"],"rows":[["Office","2.5","0.3"],["Classroom","3.8","0.6"],["Conference room","2.5","0.3"],["Retail","3.8","0.6"]]}',2),
 ('blk6','ch_hvac_2','chart','{"chartType":"bar","title":"Per-person rate by space type","labels":["Office","Classroom","Conference","Retail"],"values":[2.5,3.8,2.5,3.8],"unit":"L/s"}',3),
 ('blk7','ch_ncert_1','heading','{"level":2,"text":"Agricultural practices"}',1),
 ('blk8','ch_ncert_1','list','{"ordered":true,"items":["Preparation of soil","Sowing","Adding manure and fertilisers","Irrigation","Protection from weeds","Harvesting","Storage"]}',2),
 ('blk9','ch_hum_1','text','{"text":"This chapter is available to signed-in readers."}',1);
