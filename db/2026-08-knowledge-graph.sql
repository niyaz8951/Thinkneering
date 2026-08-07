-- =====================================================================
-- Thinkneering — Knowledge Graph platform
-- Run against thinkneering-db. "Retry deployment" does NOT run this.
--   npx wrangler d1 execute thinkneering-db --remote --file=./migrations/2026-08-knowledge-graph.sql
--
-- Design notes
-- ------------
-- 1. Nodes and edges are ROWS, not a JSON blob. The Process Map tool stores
--    a whole map as JSON because it is always read and written whole. This is
--    different: Compliance Maker needs to query individual facts across every
--    map, so the graph has to be queryable.
-- 2. knowledge_terms is the retrieval index and the thing that actually
--    replaces the knowledge-tree spreadsheet. It is rebuilt from nodes on
--    approval, never edited by hand.
-- 3. status on a node is the trust boundary. Only 'approved' rows are ever
--    returned to a downstream consumer. Draft knowledge is invisible to
--    Compliance Maker no matter who wrote it.
-- =====================================================================

-- ── Maps ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_maps (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  kind              TEXT NOT NULL,               -- 'system' | 'process'
  domain            TEXT NOT NULL,               -- 'hvac' | 'business' | future packs
  description       TEXT,
  owner_id          TEXT NOT NULL,
  visibility        TEXT NOT NULL DEFAULT 'restricted', -- 'restricted' | 'org'
  status            TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'archived'
  knowledge_score   INTEGER,                     -- 0-100, last computed
  node_count        INTEGER DEFAULT 0,
  approved_count    INTEGER DEFAULT 0,
  last_reviewed_at  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_km_domain ON knowledge_maps (domain, status);
CREATE INDEX IF NOT EXISTS idx_km_owner  ON knowledge_maps (owner_id);

-- ── Per-user access, granted by an admin ─────────────────────────────
-- Site middleware gates /tools/knowledge/* on the 'knowledge' group.
-- This table is the second gate: which maps that user may see, and at
-- what level. No row means no access, even for a signed-in user.

CREATE TABLE IF NOT EXISTS knowledge_map_access (
  map_id      TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,        -- 'viewer' | 'contributor' | 'reviewer' | 'owner'
  granted_by  TEXT,
  granted_at  TEXT NOT NULL,
  PRIMARY KEY (map_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_kma_user ON knowledge_map_access (user_id);

-- ── Nodes ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL,
  kind          TEXT NOT NULL,      -- domain node kind (equipment, component, parameter, standard, activity, decision...)
  title         TEXT NOT NULL,
  aliases       TEXT,               -- JSON array. The single most important field for Compliance Maker matching.
  summary       TEXT,               -- one or two sentences, human written
  body          TEXT,               -- markdown detail
  attributes    TEXT,               -- JSON array [{name, value, unit, basis, source}]
  tags          TEXT,               -- JSON array
  standards     TEXT,               -- JSON array of standard ids
  lane          TEXT,               -- subsystem (system maps) or department (process maps)
  x             REAL DEFAULT 0,
  y             REAL DEFAULT 0,

  status        TEXT NOT NULL DEFAULT 'draft',  -- draft | proposed | approved | rejected | archived
  confidence    INTEGER,            -- 0-100, AI assessed completeness
  ai_summary    TEXT,
  ai_gaps       TEXT,               -- JSON array of identified missing information
  version       INTEGER NOT NULL DEFAULT 1,

  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_by    TEXT,
  updated_at    TEXT NOT NULL,
  approved_by   TEXT,
  approved_at   TEXT,
  reject_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_kn_map    ON knowledge_nodes (map_id, status);
CREATE INDEX IF NOT EXISTS idx_kn_status ON knowledge_nodes (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kn_kind   ON knowledge_nodes (map_id, kind);

-- ── Edges ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id          TEXT PRIMARY KEY,
  map_id      TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  relation    TEXT NOT NULL,        -- contains | part_of | supplies | receives | controls |
                                    -- monitors | depends_on | produces | requires | connected_to |
                                    -- flows_to | approves | precedes
  medium      TEXT,                 -- air | chilled_water | refrigerant | electrical | signal | document | (null)
  label       TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ke_map  ON knowledge_edges (map_id, status);
CREATE INDEX IF NOT EXISTS idx_ke_from ON knowledge_edges (from_id);
CREATE INDEX IF NOT EXISTS idx_ke_to   ON knowledge_edges (to_id);

-- ── Retrieval index ──────────────────────────────────────────────────
-- Rebuilt from a node whenever it is approved. Never hand-edited.
-- Terms come from: title, each alias, each tag, each attribute name,
-- each standard label. Weight reflects how strong a match on that term is.

CREATE TABLE IF NOT EXISTS knowledge_terms (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id   TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  term     TEXT NOT NULL,           -- normalised: lowercase, punctuation stripped
  weight   REAL NOT NULL DEFAULT 1,
  source   TEXT NOT NULL            -- title | alias | tag | attribute | standard
);

CREATE INDEX IF NOT EXISTS idx_kt_term ON knowledge_terms (term);
CREATE INDEX IF NOT EXISTS idx_kt_node ON knowledge_terms (node_id);

-- ── Version history ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_revisions (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,
  map_id      TEXT NOT NULL,
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,        -- full node JSON as it was
  change_note TEXT,
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kr_node ON knowledge_revisions (node_id, version DESC);

-- ── Questions that become knowledge ──────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_questions (
  id            TEXT PRIMARY KEY,
  map_id        TEXT,
  node_id       TEXT,
  user_id       TEXT NOT NULL,
  question      TEXT NOT NULL,
  ai_answer     TEXT,
  human_answer  TEXT,
  answered_by   TEXT,
  status        TEXT NOT NULL DEFAULT 'open',  -- open | answered | approved | rejected | promoted
  promoted_node TEXT,                          -- node id created from this Q&A
  approved_by   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kq_status ON knowledge_questions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kq_map    ON knowledge_questions (map_id, status);

-- ── AI reviews ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_reviews (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL,
  scope         TEXT NOT NULL,      -- 'map' | 'node'
  scope_id      TEXT,
  summary       TEXT,
  detail_json   TEXT,               -- sections: understanding, gaps, conflicts, risks, faqs, suggestions
  score         INTEGER,
  model         TEXT,
  requested_by  TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_krv_map ON knowledge_reviews (map_id, created_at DESC);

-- ── Downstream usage feedback ────────────────────────────────────────
-- Compliance Maker writes here when it uses a node in an answer, and again
-- if the engineer corrects that answer. This is what makes the graph
-- improve rather than just grow.

CREATE TABLE IF NOT EXISTS knowledge_usage (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,
  consumer    TEXT NOT NULL,        -- 'compliance-maker' | 'process-map' | ...
  context     TEXT,                 -- the spec clause or query that matched
  outcome     TEXT,                 -- 'used' | 'corrected' | 'rejected'
  correction  TEXT,
  user_id     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ku_node     ON knowledge_usage (node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ku_outcome  ON knowledge_usage (consumer, outcome, created_at DESC);
