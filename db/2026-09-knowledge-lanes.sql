-- =====================================================================
-- Lanes belong to the map, not to the domain pack.
--
-- Until now the lane list came from domain-hvac.js / domain-business.js and
-- was chosen by the map's `domain` column. A blank map defaulted to domain
-- 'hvac', so it silently inherited Refrigeration cycle / Air side / Water
-- side — lanes that mean nothing for a dictionary or a new subject.
--
-- Lanes now live on the map as JSON: [{id,label,token}]. A seeded map gets
-- its pack's lanes copied in at creation; a blank map starts with none and
-- the user names their own.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-knowledge-lanes.sql
-- =====================================================================

-- SQLite has no "ADD COLUMN IF NOT EXISTS". Running this twice will report
-- "duplicate column name: lanes" on this one statement — that is harmless
-- and means it is already applied.
ALTER TABLE knowledge_maps ADD COLUMN lanes TEXT;

-- Backfill existing maps from the pack they were built against, so nothing
-- that already has nodes loses its columns.
UPDATE knowledge_maps
   SET lanes = '[{"id":"refrigeration","label":"Refrigeration cycle","token":"--kg-lane-1"},'
            || '{"id":"airside","label":"Air side","token":"--kg-lane-2"},'
            || '{"id":"waterside","label":"Water side","token":"--kg-lane-3"},'
            || '{"id":"equipment","label":"Equipment","token":"--kg-lane-4"},'
            || '{"id":"distribution","label":"Air distribution","token":"--kg-lane-5"},'
            || '{"id":"controls","label":"Controls & BMS","token":"--kg-lane-6"},'
            || '{"id":"reference","label":"Standards & terms","token":"--kg-lane-7"}]'
 WHERE lanes IS NULL AND domain = 'hvac'
   AND EXISTS (SELECT 1 FROM knowledge_nodes n WHERE n.map_id = knowledge_maps.id AND n.lane <> '');

UPDATE knowledge_maps
   SET lanes = '[{"id":"sales","label":"Sales department","token":"--kg-lane-1"},'
            || '{"id":"rnd","label":"R & D","token":"--kg-lane-2"},'
            || '{"id":"planning","label":"Production planning","token":"--kg-lane-3"},'
            || '{"id":"workshop","label":"Workshop","token":"--kg-lane-4"},'
            || '{"id":"purchasing","label":"Purchasing department","token":"--kg-lane-5"},'
            || '{"id":"quality","label":"Quality","token":"--kg-lane-6"},'
            || '{"id":"logistics","label":"Logistics & dispatch","token":"--kg-lane-7"}]'
 WHERE lanes IS NULL AND domain = 'business';

-- Any map with no nodes carrying a lane starts clean, whatever its domain.
UPDATE knowledge_maps SET lanes = '[]' WHERE lanes IS NULL;
