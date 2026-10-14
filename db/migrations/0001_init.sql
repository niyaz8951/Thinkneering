-- Migration number: 0001 	 2026-10-14
-- Thinkneering Hub - every table of the DAME Tools Hub in SQLite form, plus the new AI and audit tables.
-- Never edit this file once it has been applied to production: a change is a new migration.
--
-- SQLite rules (standards A.2): TEXT ids (UUID v4 made in the Worker), TEXT ISO timestamps (UTC),
-- booleans as INTEGER 0/1, JSON in TEXT columns. Big values (datasheet tables, map images) are in R2;
-- the rows here keep their keys.

-- ============================================================
-- Users, sessions, tiles, tools (app_*)
-- ============================================================

CREATE TABLE app_users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  team_note       TEXT NOT NULL DEFAULT '',
  pass_hash       TEXT NOT NULL,                  -- pbkdf2$<iter>$<salt>$<hash>  or  bcrypt$<hash> (imported, re-hashed at next login)
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','superuser')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','disabled')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_by     TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at     TEXT,
  last_login_at   TEXT,
  avatar          TEXT
);
CREATE UNIQUE INDEX app_users_username_key ON app_users (lower(username));

CREATE TABLE app_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX app_sessions_user_idx ON app_sessions (user_id);

CREATE TABLE app_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 100,
  is_default  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE app_user_categories (
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES app_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE app_tools (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES app_categories(id),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  path         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'soon' CHECK (status IN ('live','soon','hidden')),
  sort         INTEGER NOT NULL DEFAULT 100,
  editable     INTEGER NOT NULL DEFAULT 0,
  project_tool INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE app_tool_editors (
  user_id    TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tool_id    TEXT NOT NULL REFERENCES app_tools(id) ON DELETE CASCADE,
  granted_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, tool_id)
);

CREATE TABLE app_category_admins (
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES app_categories(id) ON DELETE CASCADE,
  granted_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  granted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, category_id)
);

-- Every admin action and every AI accept / reject / draft, with usage. Never deleted.
CREATE TABLE app_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  before     TEXT NOT NULL DEFAULT '',
  after      TEXT NOT NULL DEFAULT '',
  neurons    REAL NOT NULL DEFAULT 0,           -- Workers AI usage of the call, when known
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX app_audit_at_idx ON app_audit (created_at);

INSERT INTO app_categories (id, name, description, sort, is_default) VALUES
  ('general', 'General', 'Everyday productivity tools',            10, 1),
  ('sales',   'Sales',   'Costing, selection and quotation tools', 20, 0),
  ('sbu',     'SBU',     'Specialised SBU tools',                  30, 0);

INSERT INTO app_tools (id, category_id, name, description, path, status, sort, editable, project_tool) VALUES
  ('projects',             'general', 'Projects',             'Open a project to convert specifications and read datasheets. Everything is saved under it.', 'tools/projects/', 'live', 5, 0, 0),
  ('compliance-maker',     'general', 'Compliance Maker',     'Turn a specification PDF into a ready-to-fill compliance matrix in Excel.', 'tools/compliance-maker/', 'live', 10, 1, 1),
  ('datasheet-notes',      'general', 'Datasheet Notes',      'Turn a product datasheet PDF into an Excel table of unit data, sections and options.', 'tools/datasheet-notes/', 'live', 15, 0, 1),
  ('product-options',      'general', 'Product Options',      'See the sections, options and notes each factory offers, built from the datasheets run so far.', 'tools/product-options/', 'live', 17, 1, 1),
  ('coil-data-extractor',  'general', 'Coil Data Extractor',  'Turn coil selection quotations in Word or PDF into one Excel table, one row per coil.', 'tools/coil-data-extractor/', 'live', 20, 0, 0),
  ('container-calculator', 'general', 'Container Calculator', 'Work out how many containers or trailers a shipment needs, with a load plan and PDF report.', 'tools/container-calculator/', 'live', 30, 0, 0),
  ('centre-of-gravity',    'general', 'Centre of Gravity',    'Build a unit from blocks, find its centre of gravity and the load on every mounting foot.', 'tools/centre-of-gravity/', 'live', 40, 0, 0),
  ('psychrometric-chart',  'general', 'Psychrometric Chart',  'Plot air states on an ASHRAE-style chart and read coil loads, SHR and mixing.', 'tools/psychrometric-chart/', 'live', 50, 0, 0),
  ('standards',            'general', 'Standards',            'Short summaries of the standards named in AHU, FCU and chiller specifications.', 'tools/standards/', 'live', 60, 0, 0),
  ('maps',                 'sbu',     'Maps',                 'Product knowledge as a growing tree: branches with notes, special notes, links and images.', 'tools/maps/', 'live', 10, 1, 0);

-- ============================================================
-- Compliance Maker library (cm_*)
-- ============================================================

CREATE TABLE cm_products (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cm_factories (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES cm_products(id),
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 100,
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, name)
);

CREATE TABLE cm_runs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'conversion' CHECK (kind IN ('conversion','library-upload')),
  user_id       TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  product_id    TEXT NOT NULL REFERENCES cm_products(id),
  factory_id    TEXT NOT NULL REFERENCES cm_factories(id),
  source        TEXT NOT NULL DEFAULT '',
  file_name     TEXT NOT NULL DEFAULT '',
  line_count    INTEGER NOT NULL DEFAULT 0,
  unique_count  INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  project_id    TEXT,                             -- pr_projects.id; a record leaves its project by setting this null
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX cm_runs_created_idx ON cm_runs (created_at);
CREATE INDEX cm_runs_project_idx ON cm_runs (project_id, created_at);

CREATE TABLE cm_lines (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES cm_products(id),
  factory_id    TEXT NOT NULL REFERENCES cm_factories(id),
  norm_hash     TEXT NOT NULL,                   -- sha-256 (hex, first 32) of norm_text: the match key
  norm_text     TEXT NOT NULL,
  spec_text     TEXT NOT NULL,
  compliance    TEXT NOT NULL DEFAULT '',
  remarks       TEXT NOT NULL DEFAULT '',
  comments      TEXT NOT NULL DEFAULT '',        -- Internal Comments
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
  times_seen    INTEGER NOT NULL DEFAULT 0,
  first_run_id  TEXT REFERENCES cm_runs(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  answered_by   TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  answered_at   TEXT,
  answer_source TEXT NOT NULL DEFAULT '',        -- admin | upload | approved
  part          INTEGER NOT NULL DEFAULT 0,
  section       TEXT NOT NULL DEFAULT '',
  home_run      TEXT REFERENCES cm_runs(id) ON DELETE SET NULL,
  home_seq      INTEGER,
  sr            TEXT NOT NULL DEFAULT '',
  row_type      TEXT NOT NULL DEFAULT '',
  section_sr    TEXT NOT NULL DEFAULT '',
  UNIQUE (factory_id, norm_hash)
);
CREATE INDEX cm_lines_list_idx ON cm_lines (factory_id, status);
CREATE INDEX cm_lines_part_idx ON cm_lines (factory_id, part);

CREATE TABLE cm_run_lines (
  run_id        TEXT NOT NULL REFERENCES cm_runs(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL DEFAULT '',
  sr            TEXT NOT NULL DEFAULT '',
  spec_text     TEXT NOT NULL DEFAULT '',
  line_id       TEXT REFERENCES cm_lines(id) ON DELETE SET NULL,
  -- the project's own answer on this row (standards B.2i)
  compliance    TEXT NOT NULL DEFAULT '',
  remarks       TEXT NOT NULL DEFAULT '',
  answered_by   TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  answered_at   TEXT,
  review        TEXT NOT NULL DEFAULT '',        -- '' | pending | approved | rejected
  reviewed_by   TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  tl_review     TEXT NOT NULL DEFAULT '',
  -- AI review: 1 = the answer on this row is an AI draft nobody has accepted yet (ai_drafts holds the reason)
  ai_draft      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX cm_run_lines_line_idx ON cm_run_lines (line_id);
CREATE INDEX cm_run_lines_review_idx ON cm_run_lines (review);

CREATE TABLE cm_answer_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id    TEXT NOT NULL REFERENCES cm_lines(id) ON DELETE CASCADE,
  compliance TEXT NOT NULL DEFAULT '',
  remarks    TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT '',           -- admin | upload | approved | ai
  run_id     TEXT REFERENCES cm_runs(id) ON DELETE SET NULL,
  user_id    TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX cm_answer_log_line_idx ON cm_answer_log (line_id, created_at);

INSERT INTO cm_products (id, name, sort) VALUES ('ahu', 'AHU', 10), ('fcu', 'FCU', 20), ('chiller', 'Chiller', 30);
INSERT INTO cm_factories (id, product_id, name, sort) VALUES
  ('ahu-dubai', 'ahu', 'Dubai', 10), ('ahu-riyadh', 'ahu', 'Riyadh', 20),
  ('fcu-shenzhen', 'fcu', 'Shenzhen', 10), ('fcu-riyadh', 'fcu', 'Riyadh', 20),
  ('chiller-italy', 'chiller', 'Italy', 10), ('chiller-jeddah', 'chiller', 'Jeddah', 20);

-- ============================================================
-- Row mapping (dn_*), kept per product, edited in Product Options
-- ============================================================

CREATE TABLE dn_map (
  product_id TEXT NOT NULL REFERENCES cm_products(id) ON DELETE CASCADE,
  row_key    TEXT NOT NULL,
  section    TEXT NOT NULL DEFAULT '',
  sub        TEXT NOT NULL DEFAULT '',
  component  TEXT NOT NULL DEFAULT '',
  show       INTEGER NOT NULL DEFAULT 1,
  label      TEXT NOT NULL DEFAULT '',
  strip      TEXT NOT NULL DEFAULT '',
  response   TEXT NOT NULL DEFAULT '',
  keywords   TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  reviewed   INTEGER NOT NULL DEFAULT 1,
  in_tree    INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (product_id, row_key)
);

CREATE TABLE dn_map_settings (
  product_id    TEXT PRIMARY KEY REFERENCES cm_products(id) ON DELETE CASCADE,
  show_unmapped INTEGER NOT NULL DEFAULT 1,
  updated_by    TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Starter keywords for the AHU rows (standards B.2e-2). The rows themselves arrive with the first
-- datasheet run; the import from the old site brings the real mapping.
CREATE TABLE dn_starter_keywords (row_key TEXT PRIMARY KEY, keywords TEXT NOT NULL);
INSERT INTO dn_starter_keywords (row_key, keywords) VALUES
  ('general||power supply', 'power supply; electrical characteristic; volt phase'),
  ('unit data||panel', 'double wall; double skin; panel thick; casing thick; wall thick'),
  ('unit data||insulation', 'insulation; glass fiber; mineral wool; rockwool; polyurethane; injected foam; thermal conductance'),
  ('unit data||panel inner skin', 'inner panel; inside casing; inner skin; inner sheet; interior panel'),
  ('unit data||panel outer skin', 'outer panel; outside casing; outer skin; outer sheet; exterior panel'),
  ('unit data||profile', 'thermal break; frame profile; aluminium profile; aluminum profile; support channel'),
  ('unit data||ahu base', 'base rail; base frame; steel base; channel base'),
  ('unit data||roof', 'roof; outdoor install; weatherproof; weather resistant; canopy'),
  ('unit data||door', 'access door; inspection door; hinge'),
  ('unit data||supply air flow', 'airflow rate; air quantity; design air flow'),
  ('unit data||external pressure drop', 'external static'),
  ('unit data||sfpv (clean filters)', 'specific fan power; sfp'),
  ('unit data||erp compliant', 'erp; ecodesign'),
  ('mixing box supply||drain pan', 'drain pan'),
  ('mixing box supply|damper one supply|material', 'damper blade; damper galvan; damper alumin; blade damper'),
  ('filter supply||filter class', 'filter efficien; filter class; panel filter; bag filter; hepa; extended surface; dust spot'),
  ('filter supply||material', 'filter media'),
  ('filter supply||dirty pressure drop', 'final resistance; dirty filter; filter pressure drop'),
  ('coil cooling dx supply|geometry|rows', 'rows deep; coil rows; row coil'),
  ('coil cooling dx supply|geometry|frame', 'coil frame; coil casing; channel frame'),
  ('coil cooling dx supply|geometry|tube material', 'copper tube; tube material; seamless copper'),
  ('coil cooling dx supply|geometry|tube thickness', 'tube wall thick; tube thick'),
  ('coil cooling dx supply|geometry|fin material', 'fin alumin; fin copper; fin material; fin coated'),
  ('coil cooling dx supply|geometry|fin space', 'fins per; fin spac; fpi'),
  ('coil cooling dx supply|geometry|air velocity', 'face velocity'),
  ('coil cooling dx supply|geometry|drain pan', 'drain pan'),
  ('coil cooling dx supply|cooling|total capacity', 'cooling capacity; total capacity'),
  ('fan supply||type', 'centrifugal fan; plug fan; plenum fan; ec fan; backward curved; forward curved; fan type'),
  ('fan supply||efficiency', 'fan efficien; static efficien'),
  ('fan supply|motor data|efficiency class', 'motor efficien; ie2; ie3; ie4; ie5; premium efficien'),
  ('fan supply|motor data|electrical connection', 'motor volt; motor phase');

-- ============================================================
-- Product Options (po_*)
-- ============================================================

CREATE TABLE po_values (
  factory_id TEXT NOT NULL REFERENCES cm_factories(id) ON DELETE CASCADE,
  row_key    TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  value_key  TEXT NOT NULL,
  value      TEXT NOT NULL,
  times      INTEGER NOT NULL DEFAULT 1,
  hidden     INTEGER NOT NULL DEFAULT 0,
  first_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (factory_id, row_key, model, value_key)
);

CREATE TABLE po_extras (
  id         TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL REFERENCES cm_factories(id) ON DELETE CASCADE,
  section    TEXT NOT NULL,
  row_key    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL CHECK (kind IN ('option','note')),
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX po_extras_factory ON po_extras (factory_id);

-- ============================================================
-- Projects (pr_*)
-- ============================================================

CREATE TABLE pr_lists (
  kind  TEXT NOT NULL CHECK (kind IN ('client_type','region')),
  value TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (kind, value)
);

CREATE TABLE pr_projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  client_type TEXT NOT NULL,
  client_name TEXT NOT NULL,
  region      TEXT NOT NULL,
  created_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX pr_projects_owner_idx ON pr_projects (created_by, created_at);

-- A saved datasheet table. The unit tags stay here (small); the rows live in R2 at file_key.
CREATE TABLE pr_notes (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL REFERENCES cm_products(id),
  file_names TEXT NOT NULL DEFAULT '',
  units      INTEGER NOT NULL DEFAULT 0,
  row_count  INTEGER NOT NULL DEFAULT 0,
  columns    TEXT NOT NULL DEFAULT '[]',          -- JSON: unit tags
  file_key   TEXT NOT NULL DEFAULT '',            -- R2: notes/<project>/<note>.json holding { rows }
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX pr_notes_project_idx ON pr_notes (project_id, created_at);

CREATE TABLE pr_members (
  project_id TEXT NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  added_by   TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX pr_members_user_idx ON pr_members (user_id);

CREATE TABLE pr_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES pr_projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX pr_log_project_idx ON pr_log (project_id, id);

INSERT INTO pr_lists (kind, value, sort) VALUES
  ('client_type', 'Consultant', 10), ('client_type', 'Contractor', 20), ('client_type', 'Developer / Owner', 30),
  ('client_type', 'Distributor / Dealer', 40), ('client_type', 'Government', 50), ('client_type', 'Other', 90),
  ('region', 'UAE', 10), ('region', 'Saudi Arabia', 20), ('region', 'Qatar', 30), ('region', 'Kuwait', 40),
  ('region', 'Bahrain', 50), ('region', 'Oman', 60), ('region', 'Egypt', 70), ('region', 'Other Middle East', 80),
  ('region', 'Africa', 85), ('region', 'Other', 90);

-- ============================================================
-- Maps (mp_*)
-- ============================================================

CREATE TABLE mp_maps (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  share      TEXT NOT NULL DEFAULT 'private' CHECK (share IN ('private','team_read','team_edit')),
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE mp_nodes (
  id          TEXT PRIMARY KEY,
  map_id      TEXT NOT NULL REFERENCES mp_maps(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES mp_nodes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  special     TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  links       TEXT NOT NULL DEFAULT '[]',          -- JSON array of { kind, label, ... }
  sort        INTEGER NOT NULL DEFAULT 0,
  verified    INTEGER NOT NULL DEFAULT 1,
  verified_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  verified_at TEXT,
  created_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX mp_nodes_map ON mp_nodes (map_id);
CREATE INDEX mp_nodes_parent ON mp_nodes (parent_id);
CREATE UNIQUE INDEX mp_nodes_root ON mp_nodes (map_id) WHERE parent_id IS NULL;

-- The picture and its thumbnail live in R2 (maps/<map>/<image>.jpg, -thumb.jpg); the row keeps the keys.
CREATE TABLE mp_images (
  id         TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES mp_maps(id) ON DELETE CASCADE,
  node_id    TEXT NOT NULL REFERENCES mp_nodes(id) ON DELETE CASCADE,
  caption    TEXT NOT NULL DEFAULT '',
  file_key   TEXT NOT NULL,
  thumb_key  TEXT NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX mp_images_node ON mp_images (node_id);
CREATE INDEX mp_images_map ON mp_images (map_id);

-- ============================================================
-- AI (ai_*): drafts, jobs, chats. AI never writes into cm_lines.
-- ============================================================

-- One row per AI draft on a project record row (the latest one is what the row shows).
CREATE TABLE ai_drafts (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES cm_runs(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  line_id     TEXT REFERENCES cm_lines(id) ON DELETE SET NULL,
  compliance  TEXT NOT NULL DEFAULT '',
  remarks     TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL DEFAULT '',          -- a sentence a reader can check
  source      TEXT NOT NULL DEFAULT '',          -- library-similar | model | datasheet
  sources     TEXT NOT NULL DEFAULT '[]',        -- JSON: [{ kind, id, text, score }]
  confidence  TEXT NOT NULL DEFAULT 'low',       -- high | medium | low
  model       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',     -- draft | accepted | edited | rejected | replaced
  created_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at  TEXT
);
CREATE INDEX ai_drafts_run_idx ON ai_drafts (run_id, seq, created_at);

-- Rows waiting to be embedded into Vectorize (worked off by the 5-minute cron).
CREATE TABLE ai_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                      -- clause | map_row | option
  ref_id     TEXT NOT NULL,
  action     TEXT NOT NULL DEFAULT 'upsert',     -- upsert | delete
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  done_at    TEXT,
  error      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ai_jobs_pending_idx ON ai_jobs (done_at, id);

CREATE TABLE ai_chats (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES pr_projects(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE ai_chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,                      -- user | assistant | tool
  content    TEXT NOT NULL,
  sources    TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ai_chat_messages_chat_idx ON ai_chat_messages (chat_id, id);
