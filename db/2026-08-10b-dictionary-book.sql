-- Thinkneering — Dictionary: which book a lookup happened in.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-10b-dictionary-book.sql
--
-- ALTER TABLE has no IF NOT EXISTS in SQLite. "duplicate column name" here is
-- harmless and means the column is already present.

ALTER TABLE dictionary_lookups ADD COLUMN book_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_dictionary_lookups_reader
  ON dictionary_lookups (user_email, book_slug, created_at);
