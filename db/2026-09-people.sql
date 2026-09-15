-- =====================================================================
-- Engineers, by region — and the work that hangs off them.
--
-- `owner` on an action was free text. It was enough to write "waiting on
-- the UAE team", and useless for the question that actually matters:
-- what is on one engineer's plate, and what have they already solved.
-- Free text cannot answer that, because "Ahmed", "ahmed" and "A. Hassan"
-- are three different people to a string comparison.
--
-- A person is therefore a node, with the same aliases, the same edges and
-- the same review discipline as anything else on the map. Actions point at
-- it. The free-text `owner` stays for genuinely external parties — a
-- consultant's engineer you will never model — but anyone inside the
-- process gets a node.
--
-- Requires: db/2026-09-actions.sql and db/2026-09-sbu-map.sql.
-- Fully re-runnable. Run ./db/add-columns.sh first.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-people.sql
-- =====================================================================

INSERT OR REPLACE INTO knowledge_kinds (kind,label,hint,sort_order) VALUES
  ('person', 'Engineer',
   'A named person you assign work to or depend on. Give them their region and their products.',
   105);

-- ── What a person may be connected to ────────────────────────────────
-- Tight on purpose. A person node that can relate to anything becomes a
-- second, worse address book within a month.

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  -- Where they work and who they sit with
  ('person','market','covers'),
  ('person','stakeholder','member_of'),
  ('person','factory','liaises_with'),
  ('person','person','reports_to'),
  ('person','person','backs_up'),

  -- What they work on
  ('person','project','works_on'),
  ('person','enquiry','owns'),
  ('person','process','owns'),
  ('person','process','involves'),
  ('person','equipment','specialises_in'),
  ('person','requirement','specialises_in'),
  ('person','capability','applies'),
  ('person','automation','maintains'),

  -- And the way back, so a project can name its people
  ('project','person','staffed_by'),
  ('enquiry','person','assigned_to'),
  ('market','person','covered_by'),
  ('factory','person','contact'),
  ('stakeholder','person','includes');

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
VALUES ('person','person','supersedes');
INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
VALUES ('note','person','annotates'), ('term','person','defines');

-- ── Actions point at a person ────────────────────────────────────────

-- assignee_id is added by db/add-columns.sh, not here: a failing ALTER aborts
-- the rest of a D1 file, which would leave the views below unbuilt while the
-- migration appeared to have run.

CREATE INDEX IF NOT EXISTS idx_ka_assignee ON knowledge_actions (assignee_id, state);

-- ── A People lane on the SBU map ─────────────────────────────────────
-- Inserted before Stakeholders, because in practice you look for a person
-- first and the team they belong to second.

UPDATE knowledge_maps
   SET lanes = '[{"id":"pipeline","label":"Pipeline","token":"--kg-lane-1"},'
            || '{"id":"people","label":"Stakeholders","token":"--kg-lane-2"},'
            || '{"id":"engineers","label":"Engineers","token":"--kg-lane-2"},'
            || '{"id":"supply","label":"Factories & markets","token":"--kg-lane-3"},'
            || '{"id":"scope","label":"Technical scope","token":"--kg-lane-4"},'
            || '{"id":"method","label":"Capabilities","token":"--kg-lane-5"},'
            || '{"id":"automation","label":"Automation","token":"--kg-lane-6"},'
            || '{"id":"outcome","label":"Metrics & risks","token":"--kg-lane-7"}]',
       updated_at = datetime('now')
 WHERE id = 'map_sbu';

-- ── Markets worth naming ─────────────────────────────────────────────
-- The region nodes an engineer gets attached to. MEA already exists; these
-- are the sub-markets the pipeline is actually split by. Draft like
-- everything else: correct the list to match how you really divide it.

INSERT OR IGNORE INTO knowledge_nodes
  (id, map_id, kind, title, aliases, summary, body, attributes, tags, standards,
   lane, x, y, status, scope, origin, version, created_by, created_at, updated_at)
VALUES
 ('sbu_mkt_uae','map_sbu','market','UAE','["United Arab Emirates","Dubai","Abu Dhabi"]',
  'UAE market.','','[]','[]','[]','supply',760,900,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_ksa','map_sbu','market','Saudi Arabia','["KSA","Kingdom of Saudi Arabia"]',
  'Saudi market.','','[]','[]','[]','supply',760,1020,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_qatar','map_sbu','market','Qatar','["Doha"]',
  'Qatar market.','','[]','[]','[]','supply',760,1140,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_kuwait','map_sbu','market','Kuwait','[]',
  'Kuwait market.','','[]','[]','[]','supply',760,1260,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_oman','map_sbu','market','Oman','["Muscat"]',
  'Oman market.','','[]','[]','[]','supply',760,1380,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_bahrain','map_sbu','market','Bahrain','[]',
  'Bahrain market.','','[]','[]','[]','supply',760,1500,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_egypt','map_sbu','market','Egypt','["Cairo"]',
  'Egypt market.','','[]','[]','[]','supply',760,1620,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_africa','map_sbu','market','Africa','["Sub-Saharan Africa","East Africa","West Africa"]',
  'African markets outside North Africa.','','[]','[]','[]','supply',760,1740,'draft','general','human',1,'seed',datetime('now'),datetime('now')),
 ('sbu_mkt_levant','map_sbu','market','Levant','["Jordan","Lebanon","Iraq"]',
  'Levant markets.','','[]','[]','[]','supply',760,1860,'draft','general','human',1,'seed',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO knowledge_edges (id, map_id, from_id, to_id, relation, status, created_by, created_at)
VALUES
 ('sbue70','map_sbu','sbu_mkt_uae','sbu_fac_uae','served_by','draft','seed',datetime('now')),
 ('sbue71','map_sbu','sbu_mkt_ksa','sbu_fac_ksa','served_by','draft','seed',datetime('now')),
 ('sbue72','map_sbu','sbu_mkt_qatar','sbu_fac_uae','served_by','draft','seed',datetime('now')),
 ('sbue73','map_sbu','sbu_mkt_kuwait','sbu_fac_uae','served_by','draft','seed',datetime('now')),
 ('sbue74','map_sbu','sbu_mkt_oman','sbu_fac_uae','served_by','draft','seed',datetime('now')),
 ('sbue75','map_sbu','sbu_mkt_bahrain','sbu_fac_ksa','served_by','draft','seed',datetime('now')),
 ('sbue76','map_sbu','sbu_mkt_egypt','sbu_fac_eu','served_by','draft','seed',datetime('now')),
 ('sbue77','map_sbu','sbu_mkt_africa','sbu_fac_in','served_by','draft','seed',datetime('now')),
 ('sbue78','map_sbu','sbu_mkt_levant','sbu_fac_eu','served_by','draft','seed',datetime('now'));

-- No engineers are seeded. Inventing names would put people who do not
-- exist into a graph you are meant to trust, and a placeholder called
-- "Engineer — UAE" is a row someone eventually treats as real. Add them
-- from the map: pick Engineer in the palette, name them, and connect them
-- to their market with `covers`.

-- ── Views, rebuilt to carry the assignee ─────────────────────────────

DROP VIEW IF EXISTS knowledge_open_actions;
CREATE VIEW knowledge_open_actions AS
SELECT
  a.*,
  n.title  AS node_title,
  n.kind   AS node_kind,
  p.title  AS assignee_title,
  CASE WHEN a.due IS NOT NULL AND a.due < date('now') THEN 1 ELSE 0 END AS overdue,
  CAST(julianday('now') - julianday(a.created_at) AS INTEGER) AS age_days
FROM knowledge_actions a
LEFT JOIN knowledge_nodes n ON n.id = a.node_id
LEFT JOIN knowledge_nodes p ON p.id = a.assignee_id
WHERE a.state IN ('open','doing','waiting');

DROP VIEW IF EXISTS knowledge_action_history;
CREATE VIEW knowledge_action_history AS
SELECT
  a.id, a.map_id, a.node_id, a.assignee_id, a.title, a.detail, a.outcome,
  a.source_ref, a.state, a.owner, a.created_at, a.closed_at,
  n.title AS node_title,
  n.kind  AS node_kind,
  p.title AS assignee_title
FROM knowledge_actions a
LEFT JOIN knowledge_nodes n ON n.id = a.node_id
LEFT JOIN knowledge_nodes p ON p.id = a.assignee_id
WHERE a.state IN ('done','dropped');

-- ── Who is carrying what ─────────────────────────────────────────────
-- One row per engineer. `overdue` is the number to look at; `closed` is
-- the one that says whether the load is moving or just accumulating.
DROP VIEW IF EXISTS knowledge_person_load;
CREATE VIEW knowledge_person_load AS
SELECT
  p.id        AS person_id,
  p.map_id,
  p.title     AS person,
  p.status,
  (SELECT GROUP_CONCAT(m.title, ', ')
     FROM knowledge_edges e JOIN knowledge_nodes m ON m.id = e.to_id
    WHERE e.from_id = p.id AND e.relation = 'covers' AND m.kind = 'market') AS markets,
  (SELECT COUNT(*) FROM knowledge_actions a
    WHERE a.assignee_id = p.id AND a.state IN ('open','doing','waiting')) AS open_actions,
  (SELECT COUNT(*) FROM knowledge_actions a
    WHERE a.assignee_id = p.id AND a.state IN ('open','doing','waiting')
      AND a.due IS NOT NULL AND a.due < date('now')) AS overdue_actions,
  (SELECT COUNT(*) FROM knowledge_actions a
    WHERE a.assignee_id = p.id AND a.state = 'done') AS closed_actions,
  (SELECT MAX(a.closed_at) FROM knowledge_actions a
    WHERE a.assignee_id = p.id AND a.state = 'done') AS last_closed_at
FROM knowledge_nodes p
WHERE p.kind = 'person';

-- ── Ledger ───────────────────────────────────────────────────────────
-- Last statement, so it records only if everything above it succeeded.
-- On D1 a file is one unit and aborts at the first failing statement, so a
-- row here means the whole file ran — which is exactly the guarantee the
-- ledger has to give.
INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-people.sql', datetime('now'), 'self-recorded');
