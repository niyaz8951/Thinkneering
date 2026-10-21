-- Product Options redesign (owner, 21 Oct 2026): what a datasheet row is, as the editor sets it on the Row mapping
-- page. '' = decided by its name (worker/src/lib/po-kind.ts), 'option' = an option of the unit (waits for approval),
-- 'duty' = a figure of one selection (flow, pressure ...): shown as "seen from - to", never waits, never an option for the AI.
ALTER TABLE dn_map ADD COLUMN kind TEXT NOT NULL DEFAULT '' CHECK (kind IN ('', 'option', 'duty'));
