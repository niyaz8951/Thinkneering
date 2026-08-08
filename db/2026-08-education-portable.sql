-- =====================================================================
-- Education becomes a portable ebook reader.
--
-- Before: book content lived in D1 as books -> chapters -> blocks, seeded
--         from ~2.1 MB of generated SQL, one migration per book.
-- After:  the file in /books/ IS the book. Titles, chapters, headings,
--         tables and images are read out of the .docx or .epub in the
--         browser, so adding a book is a file plus a line of JSON.
--
-- Access changes too: the whole section is now one gate — signed in AND
-- approved by an admin — instead of a level per book and per chapter.
--
-- Re-runnable. Nothing here drops a table that other parts of the site
-- still use; see the very bottom for the optional clean-up.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-education-portable.sql
--
-- Reminder: Cloudflare's "Retry deployment" button only redeploys code.
-- It does NOT run this file. Run the command above separately.
-- =====================================================================

PRAGMA defer_foreign_keys = true;

-- 1 ── Gate the section ------------------------------------------------
--
-- 'restricted' + required_plan 'pro' is what makes an admin grant the only
-- ordinary way in: new accounts default to plan 'member', which does not
-- reach 'pro', so canAccess() falls through to the grant check. The card in
-- the navigation and the API therefore give the same answer, which is the
-- whole reason for setting it here rather than only in code.

UPDATE sections
   SET access_level  = 'restricted',
       required_plan = 'pro',
       description   = 'Books read straight from their own files, in a distraction-free reader. Access is approved per person.',
       updated_at    = datetime('now')
 WHERE id = 'sec_education';

-- The two sub-sections existed only to group database-backed books. The
-- library page lists every file in /books/ instead, so they are one hop
-- with nothing in it.
DELETE FROM items    WHERE section_id IN ('sec_edu_humonks','sec_edu_ncert');
DELETE FROM sections WHERE id         IN ('sec_edu_humonks','sec_edu_ncert');

-- 2 ── Retire the seeded book content ----------------------------------
--
-- Rows only. The books / chapters / blocks TABLES stay, because the admin
-- console still reads them; emptying them is what retires the content.

DELETE FROM blocks
 WHERE chapter_id IN (
   SELECT id FROM chapters
    WHERE book_id IN ('bk_humonks','bk_humonks_canon','bk_ncert','bk_ncert_english')
 );

DELETE FROM chapters
 WHERE book_id IN ('bk_humonks','bk_humonks_canon','bk_ncert','bk_ncert_english');

DELETE FROM items
 WHERE id IN ('itm_bk_humonks','itm_bk_ncert','itm_bk_ncert_en')
    OR book_id IN ('bk_humonks','bk_humonks_canon','bk_ncert','bk_ncert_english');

DELETE FROM books
 WHERE id IN ('bk_humonks','bk_humonks_canon','bk_ncert','bk_ncert_english');

-- Grants that pointed at those books can never match again.
DELETE FROM grants
 WHERE scope_type = 'book'
   AND scope_id IN ('bk_humonks','bk_humonks_canon','bk_ncert','bk_ncert_english');

-- 3 ── Reading position moves from book id to book slug ----------------
--
-- There is no books.id to point at any more. The column is renamed rather
-- than left holding a slug under a misleading name, and old rows go because
-- their chapter ids came from the deleted chapters table and would strand a
-- reader on a chapter that no longer exists.
--
-- Written so it survives a second run: if the table was never created, it is
-- created in its new shape; if it already has book_slug, the rename is
-- skipped by hand (SQLite has no "RENAME COLUMN IF EXISTS", so the ALTER
-- below is the one statement to delete if you re-run this file).

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id      TEXT NOT NULL,
  book_slug    TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  scroll_y     INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, book_slug)
);

-- FIRST RUN ONLY — delete this line if you run this file again.
ALTER TABLE reading_progress RENAME COLUMN book_id TO book_slug;

DELETE FROM reading_progress;

CREATE INDEX IF NOT EXISTS idx_reading_progress_user
  ON reading_progress (user_id, updated_at DESC);

-- 4 ── Approve the first reader ----------------------------------------
--
-- An admin already passes on role alone. Everyone else needs this row, which
-- is exactly what the admin console writes from Users -> Access ->
-- "Section — Education". Fill in the email and uncomment to approve someone
-- without opening the console.
--
-- INSERT OR REPLACE INTO grants (id,user_id,scope_type,scope_id,granted_by,granted_at,expires_at)
-- SELECT 'gr_edu_' || substr(id, 5), id, 'section', 'sec_education', 'migration', datetime('now'), NULL
--   FROM users WHERE email = 'you@example.com';

-- =====================================================================
-- OPTIONAL — do NOT run this yet.
--
-- Once the book editor is removed from the admin console, these three
-- tables have no reader left. Until then, dropping them breaks
-- functions/api/admin/[[path]].js and assets/js/admin.js.
--
-- DROP TABLE IF EXISTS blocks;
-- DROP TABLE IF EXISTS chapters;
-- DROP TABLE IF EXISTS books;      -- items.book_id references this
-- =====================================================================
