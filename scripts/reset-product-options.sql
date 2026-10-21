-- Reset Product Options (owner, 21 Oct 2026). Paste into Cloudflare > D1 > thinkneering-db > Console.
-- The same is on the site: Admin > Products > "Reset product options" (super user). This script is the fallback.
-- D1 Time Travel can bring the database back to any minute of the last 30 days if needed.
-- The compliance library is reset on the site instead: Admin > Compliance Library > "Reset a compliance library".

-- 1. The factory ids:
SELECT id, name, product_id FROM cm_factories ORDER BY product_id, sort;

-- 2. One factory (change 'ahu-riyadh'): the values read from datasheets. The next datasheet read brings them back,
--    grouped, waiting for approval.
DELETE FROM po_values WHERE factory_id = 'ahu-riyadh';

-- 3. Optional, same factory: the special options and notes written by editors (AI notes are kept).
-- DELETE FROM po_extras WHERE factory_id = 'ahu-riyadh' AND kind IN ('option', 'note');

-- 4. Optional, same factory: the AI notes too.
-- DELETE FROM po_extras WHERE factory_id = 'ahu-riyadh' AND kind = 'ai';

-- Every factory at once: the same lines without "WHERE factory_id = ..." (keep the "kind" part in 3 and 4).
