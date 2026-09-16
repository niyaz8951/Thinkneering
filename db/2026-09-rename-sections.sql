-- =====================================================================
-- Knowledge -> Maps, Education -> Library.
--
-- "Knowledge" and "Education" are near-synonyms in English, and the two
-- sections sat next to each other on the index reading as the same thing
-- twice. Nobody could tell from the names which one held the graph.
--
-- Maps and Library are obviously different objects. The slugs change with
-- the titles, so /s/knowledge and /s/education become /s/maps and
-- /s/library; _redirects keeps the old paths working for anything already
-- bookmarked.
--
-- Section IDs are NOT renamed. sec_knowledge and sec_education are
-- referenced by items, by db/2026-09-refocus.sql and by three other
-- migrations, and renaming a primary key to match a label is how a
-- migration chain quietly stops being re-runnable.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-rename-sections.sql
-- =====================================================================

UPDATE sections SET
  slug        = 'maps',
  title       = 'Maps',
  tagline     = 'Captured, reviewed, reusable',
  description = 'The typed engineering graphs Compliance Maker answers from. '
             || 'What is approved here is what gets said to a consultant.',
  updated_at  = datetime('now')
 WHERE id = 'sec_knowledge';

UPDATE sections SET
  slug        = 'library',
  title       = 'Library',
  tagline     = 'Read and learn',
  description = 'Books read straight from their own files, in a distraction-free reader.',
  updated_at  = datetime('now')
 WHERE id = 'sec_education';

-- Item copy that named the old sections.
UPDATE items SET
  title       = 'Knowledge Repository',
  description = 'Build the typed engineering graph. Nodes you approve are what Compliance Maker answers from.',
  updated_at  = datetime('now')
 WHERE id = 'itm_kg_repo';

-- The sub-sections under Library keep their own names; only the parent
-- changed. Nothing to do for sec_edu_humonks, sec_edu_ncert or
-- sec_edu_tools beyond leaving them alone.

-- ── Ledger ───────────────────────────────────────────────────────────
-- Last statement, so it records only if everything above it succeeded.
-- On D1 a file is one unit and aborts at the first failing statement, so a
-- row here means the whole file ran — which is exactly the guarantee the
-- ledger has to give.
INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-rename-sections.sql', datetime('now'), 'self-recorded');
