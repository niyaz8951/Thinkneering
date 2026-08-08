-- =====================================================================
-- Education: one Humonks book, one hop from the Education section.
--
-- Before: /s/education -> /s/education/humonks -> /read/humonks -> chapter
--         with the Canon Bible as a separate book alongside the novel.
--
-- After:  /s/education -> /read/humonks/<where you left off>
--         with the Canon sections as restricted chapters of the same book.
--
-- Re-runnable. Run after schema.sql and humonks.sql.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-education-merge.sql
-- =====================================================================

PRAGMA defer_foreign_keys = true;

-- 1 ── Fold the Canon Bible into the novel -----------------------------
--
-- The two were separate books only because they were imported from two
-- .docx files. They are one work: the novel is what you read, the canon is
-- the reference behind it. Chapter access_level already carries the
-- restriction, so merging does not widen access — the canon chapters stay
-- 'restricted' and remain locked for anyone without a grant.
--
-- sort_order is offset by 100 so canon sections always sort after the last
-- narrative chapter, however many more chapters the novel gains.

UPDATE chapters
   SET book_id    = 'bk_humonks',
       sort_order = sort_order + 100
 WHERE book_id = 'bk_humonks_canon';

-- Prefix the canon titles so the contents list reads unambiguously. The
-- source titles are bare numbers ("1. THESIS") which, sitting under
-- "Chapter Three", would look like part of the novel.
UPDATE chapters
   SET title = 'Canon — ' || title
 WHERE book_id = 'bk_humonks'
   AND sort_order > 100
   AND title NOT LIKE 'Canon —%';

DELETE FROM items WHERE book_id = 'bk_humonks_canon';
DELETE FROM books WHERE id = 'bk_humonks_canon';

-- 2 ── Remove the Humonks sub-section hop ------------------------------
--
-- The book item moves up to Education itself, so the card on /s/education
-- is the book rather than a folder containing one book.

UPDATE items
   SET section_id = 'sec_education',
       sort_order = 1
 WHERE id = 'itm_bk_humonks';

-- Anything else that was parked under the sub-section moves up with it
-- rather than being orphaned by the delete below.
UPDATE items
   SET section_id = 'sec_education'
 WHERE section_id = 'sec_edu_humonks';

DELETE FROM sections WHERE id = 'sec_edu_humonks';

-- NCERT keeps its sub-section: it is a real grouping that will hold many
-- books. Humonks had exactly one.
UPDATE sections SET sort_order = 2 WHERE id = 'sec_edu_ncert';

-- 3 ── Reading position, stored per user -------------------------------
--
-- Progress lived only in localStorage, so "continue where I left off" did
-- not survive a different browser or device. This table is the durable
-- copy; localStorage stays as the instant, offline-capable one, and the
-- reader prefers whichever was written most recently.

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id      TEXT NOT NULL,
  book_id      TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  scroll_y     INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_progress_user
  ON reading_progress (user_id, updated_at DESC);
