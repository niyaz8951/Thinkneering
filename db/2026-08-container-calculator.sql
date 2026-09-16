-- Register the Container & trailer calculator under Tools.
-- Public and free, matching its siblings: the whole tool runs in the browser,
-- reads and writes files locally, and touches no account data, so gating it
-- would gain nothing. If that ever changes, set access_level to 'auth' and
-- re-run this file — nothing else has to change.
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-container-calculator.sql

DELETE FROM items WHERE id = 'itm_container';

INSERT INTO items
  (id,section_id,slug,title,description,kind,href,icon,badge,access_level,required_plan,teaser,sort_order,is_published,updated_at)
VALUES
  ('itm_container','sec_tools','container-calculator','Container & trailer calculator',
   'Work out how many containers or trailers a shipment needs, with stowage drawings and a PDF report.',
   'tool','/tools/container-calculator/','container','New','public','free',NULL,5,1,datetime('now'));
