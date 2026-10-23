-- Maps (owner, 23 Oct 2026: "the map shows a continuous line at the top, Chilled water system, which is not needed:
-- the map to directly start from the first node; same in electrical"). The Electricity and Chilled water templates
-- put one branch between the map's centre and its columns ("Power distribution to HVAC equipment", "Chilled water
-- system", special note "Layout: columns"). From now on the centre itself is laid out in columns. This moves the
-- columns of the maps made before up to the centre, gives the centre the layout note and the branch's notes, and
-- deletes the branch in between (nothing else links to it; its pictures, if any, move to the centre).
CREATE TABLE mp_flat AS
  SELECT x.id AS mid, x.map_id AS map_id, x.parent_id AS root_id, x.sort AS xsort, x.notes AS xnotes
  FROM mp_nodes x
  JOIN mp_nodes r ON r.id = x.parent_id AND r.parent_id IS NULL
  JOIN mp_maps m ON m.id = x.map_id AND m.purpose IN ('wiring', 'piping')
  WHERE x.title IN ('Power distribution to HVAC equipment', 'Chilled water system')
    AND EXISTS (SELECT 1 FROM json_each(x.special) WHERE lower(trim(value)) IN ('layout: columns', 'layout: column'))
    AND (SELECT count(*) FROM mp_nodes c WHERE c.parent_id = x.id) > 0
    AND x.id = (SELECT y.id FROM mp_nodes y WHERE y.parent_id = r.id AND y.title IN ('Power distribution to HVAC equipment', 'Chilled water system') ORDER BY y.sort, y.created_at LIMIT 1);

-- the centre's other branches after the one in between make room for its columns
UPDATE mp_nodes SET sort = sort + 1000
  WHERE parent_id IN (SELECT root_id FROM mp_flat) AND sort > (SELECT xsort FROM mp_flat WHERE root_id = mp_nodes.parent_id);
UPDATE mp_nodes SET sort = (SELECT xsort FROM mp_flat WHERE mid = mp_nodes.parent_id) + sort,
                    parent_id = (SELECT root_id FROM mp_flat WHERE mid = mp_nodes.parent_id)
  WHERE parent_id IN (SELECT mid FROM mp_flat);
UPDATE mp_nodes SET
    special = CASE WHEN EXISTS (SELECT 1 FROM json_each(mp_nodes.special) WHERE lower(trim(value)) IN ('layout: columns', 'layout: column'))
                   THEN special ELSE json_insert(special, '$[#]', 'Layout: columns') END,
    notes = CASE WHEN (SELECT xnotes FROM mp_flat WHERE root_id = mp_nodes.id) = '' THEN notes
                 WHEN notes = '' THEN (SELECT xnotes FROM mp_flat WHERE root_id = mp_nodes.id)
                 ELSE notes || char(10) || char(10) || (SELECT xnotes FROM mp_flat WHERE root_id = mp_nodes.id) END
  WHERE id IN (SELECT root_id FROM mp_flat);
UPDATE mp_images SET node_id = (SELECT root_id FROM mp_flat WHERE mid = mp_images.node_id) WHERE node_id IN (SELECT mid FROM mp_flat);
DELETE FROM mp_nodes WHERE id IN (SELECT mid FROM mp_flat);
DROP TABLE mp_flat;
