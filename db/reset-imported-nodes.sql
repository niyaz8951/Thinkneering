-- =====================================================================
-- Reset: remove every node that arrived through Import CSV, with its
-- edges and index rows, so the CSVs can be imported again cleanly.
--
-- Scope is ONLY rows with origin = 'import'. Nodes you made by hand, by
-- AI proposal, from the dictionary, or from a seed are untouched — they
-- carry a different origin. Re-runnable; the second run deletes nothing.
--
-- Everything that hangs off an imported node goes with it: edges to or
-- from it, its search terms, aliases, facts, revisions and usage. Edges
-- created by an edge import between two hand-made nodes are also
-- 'import' and are removed.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/reset-imported-nodes.sql
--
-- To limit it to one map, add   AND map_id = 'map_xxx'   to each DELETE
-- (the map id is in the map page URL).
-- =====================================================================

DELETE FROM knowledge_terms        WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import');
DELETE FROM knowledge_aliases      WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import');
DELETE FROM knowledge_facts        WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import');
DELETE FROM knowledge_answer_facts WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import');
DELETE FROM knowledge_revisions    WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import');
DELETE FROM knowledge_usage        WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import');
UPDATE knowledge_actions SET node_id = NULL
                                   WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import');

DELETE FROM knowledge_edges
 WHERE from_id IN (SELECT id FROM knowledge_nodes WHERE origin = 'import')
    OR to_id   IN (SELECT id FROM knowledge_nodes WHERE origin = 'import')
    OR created_by = 'import';

DELETE FROM knowledge_nodes WHERE origin = 'import';

-- Map counters back in step with what is left.
UPDATE knowledge_maps
   SET node_count     = (SELECT COUNT(*) FROM knowledge_nodes n WHERE n.map_id = knowledge_maps.id),
       approved_count = (SELECT COUNT(*) FROM knowledge_nodes n WHERE n.map_id = knowledge_maps.id AND n.status = 'approved'),
       updated_at     = datetime('now');
