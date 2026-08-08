-- Register the Text Cleaner under Tools.
-- Public and free: it runs entirely in the browser and touches no account
-- data, so gating it would gain nothing.
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-text-cleaner.sql

DELETE FROM items WHERE id = 'itm_textclean';

INSERT INTO items
  (id,section_id,slug,title,description,kind,href,icon,badge,access_level,required_plan,teaser,sort_order,is_published,updated_at)
VALUES
  ('itm_textclean','sec_tools','text-cleaner','Text cleaner',
   'Straighten quotes, put speech on its own line, rewrap long paragraphs and space scene breaks.',
   'tool','/tools/text-cleaner/','wand',NULL,'public','free',NULL,3,1,datetime('now'));
