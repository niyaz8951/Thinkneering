-- =====================================================================
-- Dictionary: headwords, parts of speech, remembered forms.
--
-- A looked-up word is now filed under its dictionary form ("running" is
-- kept as "Run"), in dictionary case, and the lookup records the part of
-- speech so an approved word lands in the lane for its part of speech on
-- the Dictionary map instead of always in Nouns.
--
-- The two columns this needs (dictionary_entries.pos, .forms_json) are
-- NOT added here — they are added by db/add-columns.sh (or .ps1), one
-- statement per call, for the reason given at the top of that script.
-- Run the column script first.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-dictionary-headword.sql
-- =====================================================================

-- Existing rows were saved exactly as selected, usually lower case. Give
-- each a capital first letter. Nothing else about the word is touched: a
-- row that was "running" stays keyed as "running" and keeps answering
-- that selection; only words looked up from now on are filed by headword.
UPDATE dictionary_entries
   SET term = upper(substr(term, 1, 1)) || substr(term, 2)
 WHERE term IS NOT NULL AND term <> ''
   AND term <> upper(substr(term, 1, 1)) || substr(term, 2);

-- The same for words already on a Dictionary map.
UPDATE knowledge_nodes
   SET title = upper(substr(title, 1, 1)) || substr(title, 2)
 WHERE map_id IN (SELECT id FROM knowledge_maps WHERE slug LIKE 'dictionary-%')
   AND title IS NOT NULL AND title <> ''
   AND title <> upper(substr(title, 1, 1)) || substr(title, 2);

INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-dictionary-headword.sql', datetime('now'), 'headwords, pos, forms');
