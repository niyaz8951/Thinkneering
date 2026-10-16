-- 0004 (16 Oct 2026): a map is either "knowledge" (process or product understanding, as Maps always was) or
-- "rulebook" (an AI rule book: Instructions, Decision steps, rules, Learned). Compliance review > AI rules links one
-- of each per product (every factory) and per factory. Never edit after it has been applied; a correction is 0005.
ALTER TABLE mp_maps ADD COLUMN kind TEXT NOT NULL DEFAULT 'knowledge' CHECK (kind IN ('knowledge', 'rulebook'));
-- the maps already linked for the AI are rule books
UPDATE mp_maps SET kind = 'rulebook' WHERE id IN (SELECT map_id FROM ai_map_links);
ALTER TABLE ai_map_links ADD COLUMN role TEXT NOT NULL DEFAULT 'rulebook' CHECK (role IN ('knowledge', 'rulebook'));
DROP INDEX ai_map_links_scope;
CREATE UNIQUE INDEX ai_map_links_scope ON ai_map_links (product_id, ifnull(factory_id, ''), role);
