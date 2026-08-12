-- Register the Web Text Extractor under Tools.
-- Public and free, matching its siblings in the section. The extraction runs
-- server-side rather than in the browser, so if it ever needs to be limited to
-- signed-in accounts, change access_level to 'auth' and re-run this file —
-- nothing else has to change.
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-web-text-extractor.sql

DELETE FROM items WHERE id = 'itm_webextract';

INSERT INTO items
  (id,section_id,slug,title,description,kind,href,icon,badge,access_level,required_plan,teaser,sort_order,is_published,updated_at)
VALUES
  ('itm_webextract','sec_tools','web-text-extractor','Web text extractor',
   'Turn a web page into clean readable text, without the navigation, banners, adverts or footers.',
   'tool','/tools/web-text-extractor/','download','New','public','free',NULL,4,1,datetime('now'));
