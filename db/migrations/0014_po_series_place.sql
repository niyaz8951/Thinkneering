-- FCU Product Options per series (owner, 22 Oct 2026): every series (FWWBA, FWWVA, FWWTA ...) has its own General and
-- its own model columns, and a row moved to General moves for that series only, so series never mix.
-- One row per product, series and mapping row the editor moved: 'general' = in the series' General, 'model' = in its
-- model columns. No row = the product's own choice (dn_map.place), else decided by the values.
CREATE TABLE po_series_place (
  product_id TEXT NOT NULL REFERENCES cm_products(id) ON DELETE CASCADE,
  series     TEXT NOT NULL,
  row_key    TEXT NOT NULL,
  place      TEXT NOT NULL CHECK (place IN ('general', 'model')),
  PRIMARY KEY (product_id, series, row_key)
);
