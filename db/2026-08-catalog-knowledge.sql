-- =====================================================================
-- Register the Knowledge Repository and Process Map in the catalog.
--
-- After the merge these two tools existed on disk and answered on their
-- URLs, but no section or item pointed at them, so they never appeared in
-- the nav or on any section page. Reachable only by typing the address is
-- not shipped.
--
-- Both are restricted: signed in AND granted by an admin. That matches how
-- the knowledge APIs already behave, so the card now tells the same story
-- the endpoints do instead of leading to a wall.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-catalog-knowledge.sql
-- =====================================================================

DELETE FROM items    WHERE id IN ('itm_kg_repo','itm_kg_process');
DELETE FROM sections WHERE id = 'sec_knowledge';

INSERT INTO sections
  (id,parent_id,slug,title,tagline,description,icon,access_level,required_plan,sort_order,is_published,updated_at)
VALUES
  ('sec_knowledge', NULL, 'knowledge', 'Knowledge',
   'Captured, reviewed, reusable',
   'Engineering and business knowledge held as a connected graph. Approved nodes become the reference material Compliance Maker answers from, so what is approved here is what gets said to a consultant.',
   'share-2', 'restricted', 'member', 5, 1, datetime('now'));

INSERT INTO items
  (id,section_id,slug,title,description,kind,href,icon,badge,access_level,required_plan,teaser,sort_order,is_published,updated_at)
VALUES
  ('itm_kg_repo','sec_knowledge','repository','Knowledge Repository',
   'Build the HVAC and business knowledge graph. Nodes you approve feed Compliance Maker.',
   'tool','/tools/knowledge/','share-2',NULL,'restricted','member',
   'Ask an admin for access to the knowledge repository.',1,1,datetime('now')),

  ('itm_kg_process','sec_knowledge','process-map','Process Map',
   'Map a supply process from tender to site delivery. Forecasts the delivery date from lead times and flags where orders stall.',
   'tool','/tools/process-map/','git-branch',NULL,'restricted','member',
   'Ask an admin for access to the process map.',2,1,datetime('now'));
