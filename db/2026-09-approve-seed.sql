-- =====================================================================
-- Approve the seeded structure.
--
-- The SBU seed arrived entirely as draft, on the rule that nothing reaches
-- Compliance Maker without a person looking at it. That rule is right for
-- *claims* — a face velocity, a lead time, what a factory can build. It
-- was wrong for *structure*.
--
-- "Technical review precedes Factory clarification" is not a claim about
-- the world; it is the shape of your own process. Making you click fifty
-- times to confirm your own org chart is ceremony, not rigour — and until
-- you finish clicking, the ask box returns nothing, Compliance Maker cites
-- nothing, and the whole system looks broken. That is exactly the point at
-- which people stop.
--
-- What makes this safe is narrow and checkable: the seed contains NO
-- facts. Every node written by db/2026-09-sbu-map.sql and
-- db/2026-09-people.sql is a title, a summary and some edges. Approving
-- them therefore asserts nothing factual — it publishes a vocabulary, not
-- an answer. The first fact anyone adds is still draft, still queued,
-- still needs a person.
--
-- Scoped to created_by = 'seed'. Anything you authored by hand keeps its
-- own status; this migration cannot approve your work by accident.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-approve-seed.sql
-- =====================================================================

-- Safety net rather than an assumption: if a fact ever did hang off a
-- seeded node, that node is left in the queue where it belongs.
UPDATE knowledge_nodes
   SET status      = 'approved',
       approved_by = 'seed',
       approved_at = datetime('now'),
       updated_at  = datetime('now')
 WHERE created_by = 'seed'
   AND status     = 'draft'
   AND NOT EXISTS (SELECT 1 FROM knowledge_facts f WHERE f.node_id = knowledge_nodes.id);

-- Edges between two approved nodes can be approved too. An edge into a
-- draft node stays draft: approving it would publish that node by the back
-- door, which is the rule the review queue already enforces.
-- knowledge_edges carries no approver columns — only nodes do. The edge's
-- provenance is its created_by and the approval of the two nodes it joins.
UPDATE knowledge_edges
   SET status = 'approved'
 WHERE created_by = 'seed'
   AND status     = 'draft'
   AND (SELECT status FROM knowledge_nodes WHERE id = knowledge_edges.from_id) = 'approved'
   AND (SELECT status FROM knowledge_nodes WHERE id = knowledge_edges.to_id)   = 'approved';

-- knowledge_terms is what retrieval actually reads, and it is written by
-- reindexNode() in the API, not by SQL. Seeded nodes have never been
-- indexed, so they would be approved and still unfindable.
--
-- Title and aliases, lowercased, punctuation stripped — the same
-- normalisation normaliseTerm() applies. Multi-word aliases are indexed
-- whole, which is how "air handling unit" matches as a phrase.
--
-- `id` is INTEGER AUTOINCREMENT and `source` is NOT NULL, so neither can be
-- supplied or omitted the way the other tables here allow.
DELETE FROM knowledge_terms
 WHERE node_id IN (SELECT id FROM knowledge_nodes WHERE created_by = 'seed');

INSERT INTO knowledge_terms (map_id, node_id, term, weight, source)
SELECT n.map_id, n.id,
       trim(replace(replace(replace(replace(lower(n.title), '.', ''), ',', ''), '(', ''), ')', '')),
       3.0, 'title'
  FROM knowledge_nodes n
 WHERE n.created_by = 'seed'
   AND n.status = 'approved'
   AND length(trim(n.title)) > 1;

-- Alias rows, one per entry in the JSON array. json_each is available in
-- D1's SQLite build; if this statement is the one that fails on your
-- instance, the titles above are still indexed and retrieval still works —
-- it simply will not match on synonyms until the nodes are re-saved
-- through the map, which reindexes them properly.
INSERT INTO knowledge_terms (map_id, node_id, term, weight, source)
SELECT n.map_id, n.id,
       trim(lower(a.value)),
       2.0, 'alias'
  FROM knowledge_nodes n, json_each(n.aliases) a
 WHERE n.created_by = 'seed'
   AND n.status = 'approved'
   AND length(trim(a.value)) > 1;

UPDATE knowledge_maps SET
  approved_count = (SELECT COUNT(*) FROM knowledge_nodes
                     WHERE map_id = knowledge_maps.id AND status = 'approved'),
  updated_at     = datetime('now');

-- ── Ledger ───────────────────────────────────────────────────────────
-- Last statement, so it records only if everything above it succeeded.
-- On D1 a file is one unit and aborts at the first failing statement, so a
-- row here means the whole file ran — which is exactly the guarantee the
-- ledger has to give.
INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-approve-seed.sql', datetime('now'), 'self-recorded');
