-- =====================================================================
-- Repair existing Dictionary maps.
--
-- The bug: ensureDictionaryMap created dictionary maps with domain
-- 'general' and no lanes. map.js treats anything that is not 'business'
-- as HVAC, so opening "Dictionary — General" offered Equipment, Flow /
-- medium and Standard for the word "judgment", in a map with no columns.
--
-- New maps are fixed in functions/_lib/dictionary.js. This migration
-- fixes the ones already in the database.
--
-- Run AFTER 2026-10-mindmap.sql.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-10-dictionary-english.sql
-- =====================================================================

-- ── 1. Point word dictionaries at the English pack ───────────────────
-- Only the general and english dictionaries. An HVAC or business
-- dictionary keeps its own vocabulary and is left alone.

UPDATE knowledge_maps
   SET domain = 'english'
 WHERE slug LIKE 'dictionary-%'
   AND domain IN ('general', 'english');

-- ── 2. Give them the word-map lanes ──────────────────────────────────
-- Ids must match tools/knowledge/domain-english.js exactly, or seeded
-- nodes land in a lane the editor cannot name.

UPDATE knowledge_maps
   SET lanes = '[{"id":"wordparts","label":"Word parts","token":"--kg-lane-7"},'
            || '{"id":"nouns","label":"Nouns","token":"--kg-lane-1"},'
            || '{"id":"verbs","label":"Verbs","token":"--kg-lane-2"},'
            || '{"id":"describing","label":"Adjectives & adverbs","token":"--kg-lane-3"},'
            || '{"id":"phrases","label":"Phrases & idioms","token":"--kg-lane-4"},'
            || '{"id":"grammar","label":"Grammar & usage","token":"--kg-lane-5"},'
            || '{"id":"confusables","label":"Easily confused","token":"--kg-lane-6"}]'
 WHERE slug LIKE 'dictionary-%'
   AND domain = 'english';

-- ── 3. Move existing terms out of the old lane ───────────────────────
-- Words were written with lane = 'Dictionary', which is not a lane id in
-- any pack, so they rendered as unassigned. Part of speech is not known
-- here, so everything lands in Nouns and gets sorted by hand or by the
-- next AI review.

UPDATE knowledge_nodes
   SET lane = 'nouns'
 WHERE lane = 'Dictionary'
   AND map_id IN (SELECT id FROM knowledge_maps WHERE domain = 'english');

-- ── 4. Retype term nodes as word nodes ───────────────────────────────
-- 'term' exists in the HVAC pack meaning "vocabulary and unit
-- definitions". In a word map the right kind is 'word'.

UPDATE knowledge_nodes
   SET kind = 'word'
 WHERE kind = 'term'
   AND map_id IN (SELECT id FROM knowledge_maps
                   WHERE slug LIKE 'dictionary-%' AND domain = 'english');

-- ── 5. Refresh the description ───────────────────────────────────────

UPDATE knowledge_maps
   SET description = 'Words readers looked up, kept once reviewed. Roots and affixes sit in Word parts; each word connects to the parts it is built from.'
 WHERE slug LIKE 'dictionary-%'
   AND domain = 'english';

-- Check it worked:
--   SELECT slug, domain, lanes FROM knowledge_maps WHERE slug LIKE 'dictionary-%';
--   SELECT title, kind, lane FROM knowledge_nodes
--    WHERE map_id IN (SELECT id FROM knowledge_maps WHERE domain='english');
