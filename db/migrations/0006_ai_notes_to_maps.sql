-- 0006 (19 Oct 2026): Product Options holds only datasheet values and the editors' special options and notes.
-- The AI notes (po_extras kind 'ai') move to Maps, as verified branches of a knowledge map linked for their factory:
--   - the factory's knowledge map when one is already linked for that factory; otherwise a new map
--     "<product> <factory> - product facts" (shared read-only with the team), linked as the factory's knowledge map
--   - under its root: "Product facts (from Product Options)" > one branch per section > one branch per note.
--     "Filters: Standard filters are ..." becomes the branch "Filters" with the rest as its notes.
--   - verified, as they were facts the AI already used; the author and dates are kept.
-- Then the AI notes are deleted from Product Options. A factory without AI notes is not touched.

CREATE TABLE _ain_target AS
  SELECT f.id AS factory_id, f.product_id, p.name || ' ' || f.name || ' - product facts' AS map_name,
         coalesce((SELECT l.map_id FROM ai_map_links l WHERE l.product_id = f.product_id AND l.factory_id = f.id AND l.role = 'knowledge'),
                  'ainotes-' || f.id) AS map_id,
         (SELECT e.created_by FROM po_extras e WHERE e.factory_id = f.id AND e.kind = 'ai' ORDER BY e.created_at LIMIT 1) AS who
    FROM cm_factories f JOIN cm_products p ON p.id = f.product_id
   WHERE EXISTS (SELECT 1 FROM po_extras e WHERE e.factory_id = f.id AND e.kind = 'ai');

-- a new map where the factory has no knowledge map yet
INSERT INTO mp_maps (id, name, share, kind, created_by, updated_by)
  SELECT t.map_id, t.map_name, 'team_read', 'knowledge', t.who, t.who FROM _ain_target t
   WHERE t.map_id = 'ainotes-' || t.factory_id AND NOT EXISTS (SELECT 1 FROM mp_maps m WHERE m.id = t.map_id);
INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, sort, verified, verified_by, verified_at, created_by, updated_by)
  SELECT t.map_id || '-root', t.map_id, NULL, t.map_name,
         'Facts about the product made in this factory, for the AI. A verified branch is a fact the AI may quote; one "to verify" is left out. Moved from the AI notes of Product Options on 19 Oct 2026.',
         0, 1, t.who, strftime('%Y-%m-%dT%H:%M:%fZ','now'), t.who, t.who
    FROM _ain_target t
   WHERE t.map_id = 'ainotes-' || t.factory_id AND NOT EXISTS (SELECT 1 FROM mp_nodes n WHERE n.map_id = t.map_id AND n.parent_id IS NULL);
INSERT INTO ai_map_links (product_id, factory_id, map_id, role, created_by)
  SELECT t.product_id, t.factory_id, t.map_id, 'knowledge', t.who FROM _ain_target t
   WHERE NOT EXISTS (SELECT 1 FROM ai_map_links l WHERE l.product_id = t.product_id AND l.factory_id = t.factory_id AND l.role = 'knowledge');

-- "Product facts (from Product Options)" under the root of the target map
INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, sort, verified, verified_by, verified_at, created_by, updated_by)
  SELECT 'ain-' || t.factory_id, t.map_id,
         (SELECT n.id FROM mp_nodes n WHERE n.map_id = t.map_id AND n.parent_id IS NULL ORDER BY n.created_at LIMIT 1),
         'Product facts (from Product Options)', '',
         coalesce((SELECT max(c.sort) + 1 FROM mp_nodes c WHERE c.parent_id = (SELECT n.id FROM mp_nodes n WHERE n.map_id = t.map_id AND n.parent_id IS NULL ORDER BY n.created_at LIMIT 1)), 0),
         1, t.who, strftime('%Y-%m-%dT%H:%M:%fZ','now'), t.who, t.who
    FROM _ain_target t;

-- one branch per section
INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, sort, verified, verified_by, verified_at, created_by, updated_by)
  SELECT 'ain-' || s.factory_id || '-' || lower(hex(s.section)), t.map_id, 'ain-' || s.factory_id, substr(s.section, 1, 120), '',
         s.k, 1, t.who, strftime('%Y-%m-%dT%H:%M:%fZ','now'), t.who, t.who
    FROM (SELECT factory_id, section, row_number() OVER (PARTITION BY factory_id ORDER BY min(created_at)) - 1 AS k
            FROM po_extras WHERE kind = 'ai' GROUP BY factory_id, section) s
    JOIN _ain_target t ON t.factory_id = s.factory_id;

-- one branch per note: the words before a colon (up to 60 characters) are its title, the rest its notes
INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
  SELECT 'ain-n-' || e.id, t.map_id, 'ain-' || e.factory_id || '-' || lower(hex(e.section)),
         CASE WHEN instr(e.body, ':') BETWEEN 2 AND 60 THEN trim(substr(e.body, 1, instr(e.body, ':') - 1))
              ELSE trim(substr(e.body, 1, 60)) || CASE WHEN length(e.body) > 60 THEN '...' ELSE '' END END,
         CASE WHEN instr(e.body, ':') BETWEEN 2 AND 60 THEN trim(substr(e.body, instr(e.body, ':') + 1)) ELSE e.body END,
         row_number() OVER (PARTITION BY e.factory_id, e.section ORDER BY e.created_at) - 1,
         1, e.created_by, e.updated_at, e.created_by, e.created_at, e.updated_by, e.updated_at
    FROM po_extras e JOIN _ain_target t ON t.factory_id = e.factory_id
   WHERE e.kind = 'ai';

UPDATE mp_maps SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (SELECT map_id FROM _ain_target);
DELETE FROM po_extras WHERE kind = 'ai';
DROP TABLE _ain_target;
