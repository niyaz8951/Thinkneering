-- =====================================================================
-- Text Cleaner and Web Text Extractor come back, as Education tools.
--
-- They left in the refocus because they were general office utilities
-- bound for QuickTools. They return in a different role: both produce the
-- text a book is made of, and both can now write straight to the library
-- rather than making someone paste the result into the uploader — which
-- was the step that made people not bother.
--
-- They sit under Education, not Tools. There is no Tools section any
-- more, and filing them anywhere else would say they are general
-- utilities that happen to have a save button, which is backwards.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-education-tools.sql
-- =====================================================================

DELETE FROM sections WHERE id = 'sec_edu_tools';

INSERT INTO sections
  (id,parent_id,slug,title,tagline,description,icon,access_level,required_plan,sort_order,is_published,updated_at)
VALUES
  ('sec_edu_tools','sec_education','tools','Add to the library','Text in, book out',
   'Two ways to turn loose text into something the reader can open.',
   'file-plus','restricted','member',3,1,datetime('now'));

DELETE FROM items WHERE id IN ('itm_textclean','itm_webextract');

INSERT INTO items
  (id,section_id,slug,title,description,kind,href,icon,badge,
   access_level,required_plan,teaser,sort_order,is_published,updated_at)
VALUES
  ('itm_textclean','sec_edu_tools','text-cleaner','Text Cleaner',
   'Strip the artefacts out of a pasted manuscript — broken line breaks, stray hyphens, '
   || 'smart quotes — then save the result to the library.',
   'tool','/tools/text-cleaner/','type',NULL,'restricted','member',
   'Ask an admin for access to the library tools.',1,1,datetime('now')),

  ('itm_webextract','sec_edu_tools','web-text-extractor','Web Text Extractor',
   'An address in, the readable text out, with the navigation and adverts left behind. '
   || 'Save it to the library with the source kept alongside it.',
   'tool','/tools/web-text-extractor/','globe',NULL,'restricted','member',
   'Ask an admin for access to the library tools.',2,1,datetime('now'));

-- ── Ledger ───────────────────────────────────────────────────────────
-- Last statement, so it records only if everything above it succeeded.
-- On D1 a file is one unit and aborts at the first failing statement, so a
-- row here means the whole file ran — which is exactly the guarantee the
-- ledger has to give.
INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-education-tools.sql', datetime('now'), 'self-recorded');
