-- Thinkneering — Dictionary: Hindi and Urdu forms.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-10-dictionary-translit.sql
--
-- ALTER TABLE has no IF NOT EXISTS in SQLite. If a column already exists the
-- statement fails with "duplicate column name", which is harmless — nothing
-- else in this file depends on it.

ALTER TABLE dictionary_entries ADD COLUMN hindi       TEXT;
ALTER TABLE dictionary_entries ADD COLUMN urdu        TEXT;
ALTER TABLE dictionary_entries ADD COLUMN urdu_roman  TEXT;
