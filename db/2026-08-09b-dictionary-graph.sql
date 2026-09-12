-- Thinkneering — Dictionary: link entries to their knowledge graph node.
--
-- ONLY run this if you already ran 2026-08-09-dictionary.sql before these
-- two columns were added to it. On a fresh database the base migration
-- already creates them and this file will fail with "duplicate column name",
-- which is harmless — nothing else in the file depends on it.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-09b-dictionary-graph.sql

ALTER TABLE dictionary_entries ADD COLUMN map_id  TEXT;
ALTER TABLE dictionary_entries ADD COLUMN node_id TEXT;
