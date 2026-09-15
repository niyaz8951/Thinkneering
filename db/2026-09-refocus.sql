-- =====================================================================
-- Refocus: Thinkneering is Compliance Maker, Knowledge and Education.
--
-- The office tools and the HVAC calculators move to QuickTools, the
-- static no-account site. They are deleted from this repo, so leaving
-- their catalogue rows behind would render cards that 404.
--
-- Section copy is rewritten here too. The old descriptions explained the
-- billing model in the same sentence as the purpose; the access chip
-- beside each row already says who may open it, so the description now
-- says only what the thing is.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-refocus.sql
-- =====================================================================

-- ── Remove the departing sections ────────────────────────────────────
-- Items first: there is no FK cascade on this schema, and an orphaned
-- item row still answers on /api/catalog for an admin.

DELETE FROM items
 WHERE section_id IN (
   SELECT id FROM sections
    WHERE id IN ('sec_tools','sec_hvac','sec_hvac_std','sec_hvac_calc')
       OR parent_id IN ('sec_tools','sec_hvac')
 );

-- Items registered by the individual tool migrations, which pointed at
-- folders that no longer exist.
DELETE FROM items WHERE id IN ('itm_container','itm_textclean','itm_webextract');

-- Anything else still pointing at a deleted folder, however it got there.
DELETE FROM items
 WHERE kind = 'tool'
   AND href IS NOT NULL
   AND (href LIKE '/tools/hvac/%'
     OR href LIKE '/tools/word-counter%'
     OR href LIKE '/tools/unit-converter%'
     OR href LIKE '/tools/text-cleaner%'
     OR href LIKE '/tools/container-calculator%'
     OR href LIKE '/tools/web-text-extractor%'
     OR href LIKE '/tools/load-estimator%');

DELETE FROM sections WHERE parent_id IN ('sec_tools','sec_hvac');
DELETE FROM sections WHERE id IN ('sec_tools','sec_hvac');

-- The seeded HVAC standards book belonged to the section that just left.
DELETE FROM blocks   WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = 'bk_hvac');
DELETE FROM chapters WHERE book_id = 'bk_hvac';
DELETE FROM items    WHERE book_id = 'bk_hvac';
DELETE FROM books    WHERE id = 'bk_hvac';

-- ── Rewrite the three that remain ────────────────────────────────────

UPDATE sections SET
  tagline     = 'Specs in, matrix out',
  description = 'Turn a specification into a numbered compliance matrix. '
             || 'Answers come from knowledge you have approved, and cite the clause they came from.',
  sort_order  = 1,
  updated_at  = datetime('now')
 WHERE id = 'sec_compliance';

UPDATE sections SET
  title       = 'Knowledge',
  tagline     = 'Captured, reviewed, reusable',
  description = 'The typed engineering graph Compliance Maker answers from. '
             || 'What is approved here is what gets said to a consultant.',
  icon        = 'share-2',
  sort_order  = 2,
  updated_at  = datetime('now')
 WHERE id = 'sec_knowledge';

UPDATE sections SET
  tagline     = 'Read and learn',
  description = 'Books read straight from their own files, in a distraction-free reader.',
  sort_order  = 3,
  updated_at  = datetime('now')
 WHERE id = 'sec_education';

-- ── Register the review queue ────────────────────────────────────────
-- Draft nodes raised from spec clauses are the whole feedback loop. Until
-- now there was nowhere in the catalogue that led to them.

DELETE FROM items WHERE id = 'itm_kg_review';

INSERT INTO items
  (id,section_id,slug,title,description,kind,href,icon,badge,
   access_level,required_plan,teaser,sort_order,is_published,updated_at)
VALUES
  ('itm_kg_review','sec_knowledge','review','Review queue',
   'Draft nodes raised from specification clauses, waiting on your decision, one at a time.',
   'tool','/tools/knowledge/review.html','check','Review','restricted','member',
   'Ask an admin for access to the review queue.',2,1,datetime('now'));

UPDATE items SET sort_order = 3, updated_at = datetime('now') WHERE id = 'itm_kg_process';

UPDATE items SET
  description = 'Build the typed engineering graph. Nodes you approve are what Compliance Maker answers from.',
  sort_order  = 1,
  updated_at  = datetime('now')
 WHERE id = 'itm_kg_repo';

-- ── Ledger ───────────────────────────────────────────────────────────
-- Last statement, so it records only if everything above it succeeded.
-- On D1 a file is one unit and aborts at the first failing statement, so a
-- row here means the whole file ran — which is exactly the guarantee the
-- ledger has to give.
INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-refocus.sql', datetime('now'), 'self-recorded');
