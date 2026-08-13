-- Thinkneering — Dictionary: clear stale AI entries so they regenerate.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-13-dictionary-urdu-refresh.sql
--
-- Why a delete and not an update: a pending row is served straight back by
-- tier 2b without the model being called, so blanking its urdu column would
-- leave the word with no Urdu forever. Removing the row is what makes the
-- next lookup generate it again, this time with Urdu on its own pass and
-- with synonyms and antonyms filled.
--
-- Only pending, AI-written rows are touched. Approved rows are human-checked
-- and are left exactly as they are — correcting one of those is a job for the
-- review console, not for a migration.
--
-- A pending row an admin had edited but not yet approved goes too. Check the
-- queue first if that matters:
--
--   SELECT id, term, domain, hindi, urdu, urdu_roman
--     FROM dictionary_entries
--    WHERE status = 'pending' AND source = 'ai'
--    ORDER BY term;

DELETE FROM dictionary_entries
 WHERE status = 'pending'
   AND source = 'ai';
