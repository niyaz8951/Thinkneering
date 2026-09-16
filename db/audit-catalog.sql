-- =====================================================================
-- Catalogue audit — READ ONLY. Nothing here changes a single row.
--
-- Answers "why is the Access list so long, and what in it is dead?".
--
-- The Access modal lists every section, every item and every book, because
-- that is what admin.js asks for. But a grant only ever changes the answer
-- for a subset of them. canAccess() in functions/_lib.js reads:
--
--     if (level === 'public' && plan === 'free') return true;   <- never reaches the grant
--     if (!user || user.status !== 'active')     return false;
--     if (level === 'auth' && plan === 'free')   return true;   <- never reaches the grant
--     if (grantKeys.has(scopeKey))               return true;   <- the grant
--     return PLAN_RANK[user.plan] >= PLAN_RANK[plan];
--
-- So a grant is only reachable when the effective access_level is
-- 'restricted', or required_plan is above 'free'. Everything else in that
-- list is a button that does nothing.
--
-- Effective level matters, not the row's own: a public subsection under a
-- restricted parent is restricted in practice, which is what report 1
-- computes.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/audit-catalog.sql
--
-- Read the output, decide what is obsolete, then write the deletes by hand.
-- This file deliberately does not delete anything for you.
-- =====================================================================

-- ── 1 ── Everything the Access modal lists, and whether a grant does anything
--
-- Sort order puts the rows that matter at the top. 'grant does nothing'
-- rows are noise in that modal: the content is already open to the person,
-- or open to anyone.

WITH RECURSIVE tree AS (
  SELECT id, parent_id, title, access_level, required_plan, access_level AS eff_level,
         required_plan AS eff_plan
    FROM sections
   WHERE parent_id IS NULL
  UNION ALL
  SELECT s.id, s.parent_id, s.title, s.access_level, s.required_plan,
         CASE
           WHEN s.access_level = 'restricted' OR t.eff_level = 'restricted' THEN 'restricted'
           WHEN s.access_level = 'auth'       OR t.eff_level = 'auth'       THEN 'auth'
           ELSE 'public'
         END,
         CASE
           WHEN s.required_plan = 'pro'    OR t.eff_plan = 'pro'    THEN 'pro'
           WHEN s.required_plan = 'member' OR t.eff_plan = 'member' THEN 'member'
           ELSE 'free'
         END
    FROM sections s JOIN tree t ON s.parent_id = t.id
)
SELECT
  '1. ACCESS LIST'                                        AS report,
  kind, id, label, eff_level, eff_plan,
  CASE WHEN eff_level = 'restricted' OR eff_plan <> 'free'
       THEN 'grant works'
       ELSE 'grant does nothing — hide it' END            AS verdict
FROM (
  SELECT 'Section' AS kind, t.id AS id, t.title AS label,
         t.eff_level AS eff_level, t.eff_plan AS eff_plan
    FROM tree t
  UNION ALL
  SELECT 'Item', i.id, i.title,
         CASE
           WHEN i.access_level = 'restricted' OR t.eff_level = 'restricted' THEN 'restricted'
           WHEN i.access_level = 'auth'       OR t.eff_level = 'auth'       THEN 'auth'
           ELSE 'public'
         END,
         CASE
           WHEN i.required_plan = 'pro'    OR t.eff_plan = 'pro'    THEN 'pro'
           WHEN i.required_plan = 'member' OR t.eff_plan = 'member' THEN 'member'
           ELSE 'free'
         END
    FROM items i LEFT JOIN tree t ON t.id = i.section_id
  UNION ALL
  SELECT 'Book', b.id, b.title, b.access_level, b.required_plan
    FROM books b
)
ORDER BY verdict, kind, label;


-- ── 2 ── Items pointing at a tool that is not deployed
--
-- Keep the list on the right in step with the folders under /tools/.
-- An item here renders a card that 404s when someone taps it.

SELECT '2. DEAD LINKS' AS report,
       i.id, i.title, i.href, i.badge, i.is_published
  FROM items i
 WHERE i.kind = 'tool'
   AND (i.href IS NULL
        OR i.href NOT IN ('/tools/compliance-maker/', '/tools/knowledge/',
                          '/tools/process-map/', '/tools/text-cleaner/',
                          '/tools/unit-converter/', '/tools/word-counter/'))
 ORDER BY i.title;


-- ── 3 ── Sections with nothing in them
--
-- An empty section is a card that opens onto "Nothing published here yet."
--
-- Education is excluded on purpose: it is empty by design now. Its books
-- are files in /books/ listed by /education/, not items rows, and /s/education
-- redirects to that page before this would ever matter.

SELECT '3. EMPTY SECTIONS' AS report,
       s.id, s.title, s.access_level, s.is_published
  FROM sections s
 WHERE s.id <> 'sec_education'
   AND NOT EXISTS (SELECT 1 FROM items    i WHERE i.section_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM sections c WHERE c.parent_id  = s.id)
 ORDER BY s.title;


-- ── 4 ── Book rows and what is actually left inside them
--
-- After the Education migration the portable reader owns the books, so a
-- row here with chapters is leftover seed content rather than live content.

SELECT '4. BOOKS' AS report,
       b.id, b.title, b.status, b.access_level,
       (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapters,
       (SELECT COUNT(*) FROM blocks bl
          WHERE bl.chapter_id IN (SELECT id FROM chapters c WHERE c.book_id = b.id)) AS blocks,
       (SELECT COUNT(*) FROM items i WHERE i.book_id = b.id) AS linked_items
  FROM books b
 ORDER BY b.title;


-- ── 5 ── Broken links between rows
--
-- A book item whose book is gone renders a card that leads nowhere.

SELECT '5. ORPHANS' AS report, 'item -> missing book' AS problem, i.id, i.title
  FROM items i
 WHERE i.kind = 'book'
   AND (i.book_id IS NULL OR i.book_id NOT IN (SELECT id FROM books))
UNION ALL
SELECT '5. ORPHANS', 'item -> missing section', i.id, i.title
  FROM items i
 WHERE i.section_id NOT IN (SELECT id FROM sections)
UNION ALL
SELECT '5. ORPHANS', 'grant -> target no longer exists', g.id, g.scope_type || ':' || g.scope_id
  FROM grants g
 WHERE (g.scope_type = 'section' AND g.scope_id NOT IN (SELECT id FROM sections))
    OR (g.scope_type = 'item'    AND g.scope_id NOT IN (SELECT id FROM items))
    OR (g.scope_type = 'book'    AND g.scope_id NOT IN (SELECT id FROM books));


-- ── 6 ── Book items the portable reader can no longer open
--
-- IMPORTANT. /read/ used to serve books out of D1. It now serves the file
-- reader, which only knows the slugs in /books/library.json. Any item of
-- kind 'book' whose slug is not in that manifest is a card that leads to
-- "No such book".
--
-- Three ways out, per row: export the book to .docx or .epub and add it to
-- the manifest; repoint the item at a page that still exists; or delete the
-- item and the book. Nothing here decides for you.

SELECT '6. BOOK LINKS TO CHECK' AS report,
       i.id AS item_id, i.title AS item_title,
       b.slug AS reader_url_slug,
       '/read/' || b.slug AS lands_on,
       'must appear in /books/library.json' AS requirement
  FROM items i JOIN books b ON b.id = i.book_id
 WHERE i.kind = 'book'
 ORDER BY i.title;


-- ── 7 ── Who is approved for what right now

SELECT '7. LIVE GRANTS' AS report,
       u.email, u.status, u.plan, g.scope_type, g.scope_id, g.granted_at, g.expires_at
  FROM grants g JOIN users u ON u.id = g.user_id
 ORDER BY u.email, g.scope_type, g.scope_id;
