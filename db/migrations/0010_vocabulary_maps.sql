-- 0010 (20 Oct 2026, owner): one vocabulary map per product (AHU, FCU, Chiller): what specifications ask, in their
-- own words, read by code to recognise every clause (ai/vocab.ts). mp_maps.kind keeps its two values (its CHECK cannot
-- change without rebuilding the table, which would cascade to the branches): a vocabulary map is kind 'knowledge'
-- with purpose 'vocabulary'. One link per product.
ALTER TABLE mp_maps ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
CREATE TABLE ai_vocab_links (
  product_id TEXT PRIMARY KEY REFERENCES cm_products(id) ON DELETE CASCADE,
  map_id     TEXT NOT NULL UNIQUE REFERENCES mp_maps(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
