-- 0007 (19 Oct 2026): a value read from a datasheet is a fact for the factory only once an admin approves it.
-- New values (po_collect) arrive with approved = 0: shown to editors and approvers as "to approve", hidden from
-- other users, from the Excel download and from the AI. Approvers: the super user and the admins of the tile
-- Product Options sits on. Values already in the tree stay approved (they were in use before this rule).
ALTER TABLE po_values ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;
ALTER TABLE po_values ADD COLUMN approved_by TEXT REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE po_values ADD COLUMN approved_at TEXT;
CREATE INDEX po_values_waiting ON po_values (factory_id) WHERE approved = 0;
