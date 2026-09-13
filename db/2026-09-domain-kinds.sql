-- =====================================================================
-- The other two domain packs.
--
-- db/2026-09-knowledge-typed.sql made node kinds a closed set enforced by
-- a trigger, and registered the HVAC vocabulary. The dictionary pack and
-- the business pack use entirely different kinds — word, sense, root,
-- prefix, activity, decision, approval — and none of them were
-- registered.
--
-- The result: every write to a dictionary or business map was rejected
-- with "unknown node kind: SQLITE_CONSTRAINT_TRIGGER". Approving a word
-- failed. Adding one failed. The trigger was doing exactly what it was
-- built to do, against a list that was only ever half written.
--
-- Their relations were missing from knowledge_edge_rules for the same
-- reason, so edges on those maps were refused too.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-domain-kinds.sql
-- =====================================================================

-- ── Dictionary ───────────────────────────────────────────────────────
-- INSERT OR IGNORE, not REPLACE: `note` already exists with a label set by
-- an earlier migration, and clobbering it here would change what the HVAC
-- and SBU maps show for the same kind.

INSERT OR IGNORE INTO knowledge_kinds (kind,label,hint,sort_order) VALUES
  ('word',       'Word',        'A single word a reader looked up or you added.', 210),
  ('sense',      'Sense',       'One specific meaning of a word that has several.', 215),
  ('root',       'Root',        'A Latin or Greek root that many words are built on.', 220),
  ('prefix',     'Prefix',      'A beginning that changes meaning: un-, re-, pre-.', 225),
  ('suffix',     'Suffix',      'An ending that changes the part of speech: -tion, -able.', 230),
  ('phrase',     'Phrase',      'A set expression: "in the long run", "bear in mind".', 235),
  ('idiom',      'Idiom',       'A phrase whose meaning is not its literal words.', 240),
  ('grammar',    'Grammar',     'A rule or pattern rather than a word.', 245),
  ('confusable', 'Confusable',  'A word people mix up with another.', 250),
  ('example',    'Example',     'A sentence showing a word in use.', 255),
  ('mnemonic',   'Mnemonic',    'A way of remembering which is which.', 260),
  ('topic',      'Topic',       'A subject area a word belongs to.', 265);

-- ── Business process ─────────────────────────────────────────────────

INSERT OR IGNORE INTO knowledge_kinds (kind,label,hint,sort_order) VALUES
  ('start',     'Start',     'Where a process begins.', 310),
  ('activity',  'Activity',  'A step someone performs.', 315),
  ('decision',  'Decision',  'A branch: the answer changes what happens next.', 320),
  ('approval',  'Approval',  'A step where someone must sign off.', 325),
  ('input',     'Input',     'Something the process needs before it can run.', 330),
  ('output',    'Output',    'Something the process produces.', 335),
  ('exception', 'Exception', 'What happens when it does not go to plan.', 340),
  ('role',      'Role',      'Who does it.', 345);

-- ── Dictionary relations ─────────────────────────────────────────────

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('word','sense','means'),
  ('phrase','sense','means'),
  ('idiom','sense','means'),
  ('sense','word','sense_of'),

  ('word','root','built_from'),
  ('word','prefix','built_from'),
  ('word','suffix','built_from'),
  ('root','word','builds'),
  ('prefix','word','builds'),
  ('suffix','word','builds'),

  ('word','word','synonym_of'),
  ('word','word','antonym_of'),
  ('word','word','confused_with'),
  ('word','word','stronger_than'),
  ('word','word','collocates'),
  ('confusable','word','confused_with'),
  ('word','confusable','confused_with'),
  ('phrase','phrase','synonym_of'),
  ('idiom','idiom','synonym_of'),

  ('word','topic','used_in'),
  ('phrase','topic','used_in'),
  ('idiom','topic','used_in'),
  ('word','example','used_in'),
  ('sense','example','used_in'),

  ('mnemonic','word','defines'),
  ('mnemonic','confusable','defines'),
  ('grammar','word','defines'),
  ('example','word','annotates'),
  ('example','sense','annotates');

-- ── Business relations ───────────────────────────────────────────────

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation) VALUES
  ('start','activity','precedes'),
  ('activity','activity','precedes'),
  ('activity','decision','precedes'),
  ('decision','activity','precedes'),
  ('activity','approval','precedes'),
  ('approval','activity','precedes'),
  ('activity','exception','precedes'),
  ('decision','exception','precedes'),

  ('activity','activity','contains'),
  ('activity','activity','part_of'),

  ('role','activity','responsible'),
  ('role','approval','responsible'),
  ('role','decision','responsible'),
  ('approval','activity','approves'),
  ('role','activity','approves'),

  ('activity','input','requires'),
  ('activity','document','requires'),
  ('approval','document','requires'),
  ('activity','output','produces'),
  ('activity','document','produces'),

  ('activity','activity','depends_on'),
  ('activity','system','depends_on'),
  ('activity','system','connected_to'),
  ('system','system','connected_to'),
  ('exception','risk','causes'),
  ('risk','exception','causes'),
  ('activity','risk','causes');

-- ── Generic rules, re-applied across every kind ──────────────────────
-- These were generated from knowledge_kinds at the time the typed
-- migration ran, so the twenty kinds added above have none of them. This
-- block is a SELECT over the table rather than a list, so it stays correct
-- the next time a pack arrives.

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT k.kind, k.kind, 'supersedes' FROM knowledge_kinds k;

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT 'note', k.kind, 'annotates' FROM knowledge_kinds k;

INSERT OR IGNORE INTO knowledge_edge_rules (from_kind,to_kind,relation)
SELECT 'term', k.kind, 'defines' FROM knowledge_kinds k;

-- ── Ledger ───────────────────────────────────────────────────────────
-- Last statement, so it records only if everything above it succeeded.
-- On D1 a file is one unit and aborts at the first failing statement, so a
-- row here means the whole file ran — which is exactly the guarantee the
-- ledger has to give.
INSERT OR IGNORE INTO schema_migrations (name, applied_at, note)
VALUES ('2026-09-domain-kinds.sql', datetime('now'), 'self-recorded');
