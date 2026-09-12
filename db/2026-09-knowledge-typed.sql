-- =====================================================================
-- The knowledge graph becomes typed, scoped and queryable.
--
-- Five things were missing, and each one was costing something real:
--
--   1. Node kinds lived in the client-side domain packs. A node created
--      through the API could carry any kind at all, so the graph drifted
--      as soon as anything but the map wrote to it.
--
--   2. Any relation was legal between any two kinds. Nothing stopped a
--      standard "containing" a project.
--
--   3. Aliases were a JSON array on the node with no uniqueness. "AHU",
--      "air handling unit" and "AHU-01" could each end up on a different
--      node, and nothing would ever notice. This is the failure that
--      quietly produces three contradictory answers to one clause.
--
--   4. Attributes were a JSON blob. A number and its unit could not be
--      queried, so "which projects specified 2.5 m/s face velocity" was
--      not answerable by the thing built to answer it.
--
--   5. Nothing recorded whether a fact was seen once on one job or holds
--      generally. A value observed on a single project therefore read
--      exactly like a rule, which is how a knowledge base turns into a
--      pile of assumptions.
--
-- Fully re-runnable: every statement here is IF NOT EXISTS, OR IGNORE, or a
-- DROP/CREATE pair. Run the column script FIRST — see below.
--
--   ./db/add-columns.sh                 (or db\add-columns.ps1 on Windows)
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-knowledge-typed.sql
-- =====================================================================

-- ── 1. Node kinds as data ────────────────────────────────────────────
-- Held in a table rather than a CHECK constraint so a new kind is one
-- INSERT, not a table rebuild. The trigger below makes it binding.

CREATE TABLE IF NOT EXISTS knowledge_kinds (
  kind        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  hint        TEXT NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 100
);

INSERT OR REPLACE INTO knowledge_kinds (kind,label,hint,sort_order) VALUES
  ('system',      'System',       'A complete system or subsystem, e.g. chilled water system.', 10),
  ('equipment',   'Equipment',    'A deliverable unit of plant: AHU, FCU, chiller, pump.', 20),
  ('component',   'Component',    'A part inside equipment: coil, fan, filter, compressor.', 30),
  ('parameter',   'Parameter',    'A measurable property a specification will call out.', 40),
  ('standard',    'Standard',     'A code, standard or certification scheme, as a whole.', 50),
  ('clause',      'Clause',       'One provision inside a standard. Cite these, not the standard.', 55),
  ('requirement', 'Requirement',  'One demand made by a project specification.', 58),
  ('project',     'Project',      'A job. Anchors project-scoped facts.', 60),
  ('control',     'Control',      'Sensing, control logic, BMS points.', 65),
  ('medium',      'Flow / medium','What moves through the system: air, chilled water, refrigerant.', 70),
  ('document',    'Document',     'A submittal, datasheet, certificate or manual.', 75),
  ('failure',     'Failure mode', 'A known way this fails, and how it presents.', 80),
  ('maintenance', 'Maintenance',  'A recurring service task.', 85),
  ('term',        'Term',         'Vocabulary and unit definitions.', 90),
  ('note',        'Note',         'Context that is not itself a concept.', 95);

-- ── 2. Edge legality ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_edge_rules (
  from_kind TEXT NOT NULL,
  to_kind   TEXT NOT NULL,
  relation  TEXT NOT NULL,
  PRIMARY KEY (from_kind, to_kind, relation)
);

-- Containment down the physical hierarchy.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('system','equipment','contains'),   ('system','system','contains'),
  ('equipment','component','contains'),('component','component','contains'),
  ('equipment','system','part_of'),    ('component','equipment','part_of'),
  ('component','component','part_of'), ('system','system','part_of');

-- Flow and service.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('equipment','medium','supplies'),   ('component','medium','supplies'),
  ('equipment','medium','receives'),   ('component','medium','receives'),
  ('medium','equipment','flows_to'),   ('medium','component','flows_to'),
  ('equipment','equipment','connected_to'), ('component','component','connected_to'),
  ('equipment','equipment','depends_on'),   ('component','component','depends_on'),
  ('equipment','medium','produces');

-- Control and monitoring.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('control','equipment','controls'), ('control','component','controls'),
  ('control','medium','controls'),
  ('control','parameter','monitors'), ('control','equipment','monitors');

-- Parameters describe things; they do not contain them.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('equipment','parameter','has_parameter'),
  ('component','parameter','has_parameter'),
  ('system','parameter','has_parameter'),
  ('medium','parameter','has_parameter');

-- Standards, clauses and what they govern.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('clause','standard','defined_in'),
  ('equipment','clause','governed_by'), ('component','clause','governed_by'),
  ('parameter','clause','governed_by'), ('system','clause','governed_by'),
  ('equipment','standard','governed_by'), ('component','standard','governed_by');

-- Projects and their requirements. This is the spine of the compliance loop.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('project','requirement','requires'),
  ('project','equipment','uses'), ('project','component','uses'),
  ('requirement','equipment','applies_to'), ('requirement','component','applies_to'),
  ('requirement','parameter','applies_to'), ('requirement','system','applies_to'),
  ('requirement','clause','cites'), ('requirement','standard','cites'),
  ('requirement','equipment','satisfied_by'), ('requirement','component','satisfied_by'),
  ('requirement','parameter','satisfied_by');

-- Documents evidence things.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('document','equipment','documents'), ('document','component','documents'),
  ('document','project','documents'),   ('document','requirement','documents');

-- Failure and maintenance.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('failure','component','affects'), ('failure','equipment','affects'),
  ('failure','failure','causes'),    ('component','failure','causes'),
  ('maintenance','component','maintains'), ('maintenance','equipment','maintains');

-- Terms and notes explain anything, and explain nothing authoritative.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT 'term', k.kind, 'defines' FROM knowledge_kinds k;
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT 'note', k.kind, 'annotates' FROM knowledge_kinds k;

-- A node may supersede another of its own kind, always.
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT k.kind, k.kind, 'supersedes' FROM knowledge_kinds k;

-- ── 3. Scope, provenance and supersession on the node ────────────────

-- The five columns this section needs are NOT added here. They are added by
-- db/add-columns.sh (or .ps1), one statement per call.
--
-- The reason is how D1 runs a file: the whole file is one unit, and the first
-- failing statement aborts everything after it. SQLite has no
-- "ADD COLUMN IF NOT EXISTS", so on a second run the first ALTER raises
-- "duplicate column name" and every CREATE, INSERT, TRIGGER and VIEW below it
-- silently never runs. The migration then looks applied and is not.
--
-- Run the column script first. It is expected to report "duplicate column
-- name" for anything already present, and that message is genuinely harmless
-- there because each statement is its own call.

-- Everything that existed before this migration was authored by hand in
-- the map, so it is human-origin. Scope is the honest unknown: these
-- nodes were written as general knowledge, and calling them 'project'
-- retrospectively would be a guess in the other direction.
UPDATE knowledge_nodes SET scope = 'general' WHERE scope IS NULL OR scope = '';
UPDATE knowledge_nodes SET origin = 'human'  WHERE origin IS NULL OR origin = '';

CREATE INDEX IF NOT EXISTS idx_kn_scope   ON knowledge_nodes (scope, status);
CREATE INDEX IF NOT EXISTS idx_kn_project ON knowledge_nodes (project_id);

-- ── 4. Aliases as rows, unique across the graph ──────────────────────
-- alias_norm is produced by normaliseTerm() in functions/_lib/knowledge.js.
-- Writing it any other way breaks the uniqueness this table exists for.

CREATE TABLE IF NOT EXISTS knowledge_aliases (
  id         TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  alias      TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unique per map, not globally: the HVAC map and an English dictionary map
-- may both legitimately hold "duct". Within one map they may not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ka_norm ON knowledge_aliases (map_id, alias_norm);
CREATE INDEX        IF NOT EXISTS idx_ka_node ON knowledge_aliases (node_id);

-- ── 5. Facts: numbers with units, separately queryable ───────────────

CREATE TABLE IF NOT EXISTS knowledge_facts (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  value_type    TEXT NOT NULL DEFAULT 'text',   -- number | range | text | bool | enum
  value_num     REAL,
  value_num_max REAL,
  unit          TEXT NOT NULL DEFAULT '',
  value_text    TEXT NOT NULL DEFAULT '',
  basis         TEXT NOT NULL DEFAULT '',       -- how it was arrived at
  scope         TEXT NOT NULL DEFAULT 'project',
  project_id    TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',
  source_ref    TEXT,
  supersedes_id TEXT,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by   TEXT,
  approved_at   TEXT,
  -- A number without a unit is how wrong answers get built.
  CHECK (value_type <> 'number' OR (value_num IS NOT NULL AND unit <> '')),
  CHECK (value_type <> 'range'  OR (value_num IS NOT NULL AND value_num_max IS NOT NULL AND unit <> '')),
  CHECK (status <> 'approved' OR approved_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_kf_node    ON knowledge_facts (node_id, status);
CREATE INDEX IF NOT EXISTS idx_kf_name    ON knowledge_facts (name, status);
-- The index that makes "which projects specified 2.5 m/s" a query.
CREATE INDEX IF NOT EXISTS idx_kf_numeric ON knowledge_facts (name, unit, value_num);

-- ── 6. Answer traceability ───────────────────────────────────────────
-- Which facts a compliance answer was built from. Without this, a
-- disputed answer cannot be walked back to the clause that justified it,
-- and "cite the clause it came from" is a claim rather than a feature.

CREATE TABLE IF NOT EXISTS knowledge_answer_facts (
  answer_id  TEXT NOT NULL,
  fact_id    TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (answer_id, fact_id)
);

CREATE INDEX IF NOT EXISTS idx_kaf_fact ON knowledge_answer_facts (fact_id);
CREATE INDEX IF NOT EXISTS idx_kaf_node ON knowledge_answer_facts (node_id);

-- ── 7. Triggers: the rules the API cannot talk its way past ──────────

DROP TRIGGER IF EXISTS trg_kn_kind_insert;
CREATE TRIGGER trg_kn_kind_insert
BEFORE INSERT ON knowledge_nodes
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM knowledge_kinds WHERE kind = NEW.kind AND is_active = 1)
BEGIN
  SELECT RAISE(ABORT, 'unknown node kind');
END;

DROP TRIGGER IF EXISTS trg_kn_scope_insert;
CREATE TRIGGER trg_kn_scope_insert
BEFORE INSERT ON knowledge_nodes
FOR EACH ROW
WHEN NEW.scope NOT IN ('project','family','general')
BEGIN
  SELECT RAISE(ABORT, 'scope must be project, family or general');
END;

DROP TRIGGER IF EXISTS trg_ke_legal_insert;
CREATE TRIGGER trg_ke_legal_insert
BEFORE INSERT ON knowledge_edges
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM knowledge_edge_rules r
   WHERE r.relation  = NEW.relation
     AND r.from_kind = (SELECT kind FROM knowledge_nodes WHERE id = NEW.from_id)
     AND r.to_kind   = (SELECT kind FROM knowledge_nodes WHERE id = NEW.to_id)
)
BEGIN
  SELECT RAISE(ABORT, 'illegal relation for these node kinds');
END;

DROP TRIGGER IF EXISTS trg_ke_legal_update;
CREATE TRIGGER trg_ke_legal_update
BEFORE UPDATE OF relation, from_id, to_id ON knowledge_edges
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM knowledge_edge_rules r
   WHERE r.relation  = NEW.relation
     AND r.from_kind = (SELECT kind FROM knowledge_nodes WHERE id = NEW.from_id)
     AND r.to_kind   = (SELECT kind FROM knowledge_nodes WHERE id = NEW.to_id)
)
BEGIN
  SELECT RAISE(ABORT, 'illegal relation for these node kinds');
END;

-- An approved fact is immutable except to be superseded. A correction
-- inserts a new row carrying supersedes_id, so the trail survives the fix.
DROP TRIGGER IF EXISTS trg_kf_approved_immutable;
CREATE TRIGGER trg_kf_approved_immutable
BEFORE UPDATE ON knowledge_facts
FOR EACH ROW
WHEN OLD.status = 'approved'
 AND NOT (NEW.status = 'superseded'
          AND NEW.value_num IS OLD.value_num
          AND NEW.value_text IS OLD.value_text
          AND NEW.unit IS OLD.unit)
BEGIN
  SELECT RAISE(ABORT, 'approved fact is immutable: supersede it with a new row');
END;

-- Nothing automated may raise a fact's scope. Promotion from a single
-- sighting to a general rule is a decision, and decisions are made by
-- people; the API has no statement that can do it silently.
DROP TRIGGER IF EXISTS trg_kf_scope_promotion;
CREATE TRIGGER trg_kf_scope_promotion
BEFORE UPDATE OF scope ON knowledge_facts
FOR EACH ROW
WHEN NEW.scope <> OLD.scope AND NEW.approved_by IS NULL
BEGIN
  SELECT RAISE(ABORT, 'changing scope requires an approver');
END;

-- ── 8. Backfill aliases out of the JSON column ───────────────────────
-- The JSON `aliases` column stays as the node's own field; this table is
-- the index built from it. Rows that collide are dropped by the unique
-- index, which is the point — a collision is a duplicate worth seeing.
-- Run db/backfill-aliases.sql after this file to populate it from the
-- existing JSON, which SQLite cannot parse without json_each in D1.

-- ── 9. Review queue ──────────────────────────────────────────────────
-- Oldest first, one at a time, each row carrying enough to decide with.

DROP VIEW IF EXISTS knowledge_review_queue;
CREATE VIEW knowledge_review_queue AS
SELECT
  n.id, n.map_id, n.kind, n.title, n.summary, n.scope, n.origin,
  n.project_id, n.source_ref, n.created_by, n.created_at,
  m.title AS map_title,
  (SELECT COUNT(*) FROM knowledge_facts f
    WHERE f.node_id = n.id AND f.status = 'draft') AS draft_facts,
  (SELECT COUNT(*) FROM knowledge_edges e
    WHERE (e.from_id = n.id OR e.to_id = n.id) AND e.status = 'draft') AS draft_edges
FROM knowledge_nodes n
LEFT JOIN knowledge_maps m ON m.id = n.map_id
WHERE n.status IN ('draft','proposed');

-- ── 10. What Compliance Maker is allowed to see ──────────────────────
-- Approved node AND approved fact. The trust boundary is a join, not a
-- filter the calling code has to remember to apply.

DROP VIEW IF EXISTS knowledge_approved_facts;
CREATE VIEW knowledge_approved_facts AS
SELECT
  f.id, f.map_id, f.node_id, f.name, f.value_type, f.value_num,
  f.value_num_max, f.unit, f.value_text, f.basis, f.scope, f.project_id,
  f.source_ref, f.approved_at,
  n.title AS node_title,
  n.kind  AS node_kind,
  CASE f.scope WHEN 'project' THEN 0 WHEN 'family' THEN 1 ELSE 2 END AS scope_rank
FROM knowledge_facts f
JOIN knowledge_nodes n ON n.id = f.node_id
WHERE f.status = 'approved' AND n.status = 'approved';
