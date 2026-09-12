-- =====================================================================
-- Sign-in only.
--
-- Thinkneering no longer has a free layer. The tools that served visitors
-- without an account have moved to QuickTools; what remains answers from a
-- knowledge graph that is per-account by definition, so a "public" row is
-- now a row nobody can reach anyway — the middleware redirects a signed-out
-- visitor before the catalogue is ever queried.
--
-- Leaving those rows at 'public' would be worse than useless: the access
-- chip would promise a free tier the site cannot honour, and the next
-- person reading the schema would reasonably conclude that anonymous
-- access is still supported somewhere.
--
-- 'auth' rather than 'restricted': signing in is enough. Content that
-- additionally needs an admin grant is already 'restricted' and is left
-- exactly as it is.
--
-- Re-runnable.
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-signin-only.sql
-- =====================================================================

UPDATE sections SET access_level = 'auth', updated_at = datetime('now')
 WHERE access_level = 'public';

UPDATE items SET access_level = 'auth', updated_at = datetime('now')
 WHERE access_level = 'public';

UPDATE books SET access_level = 'auth', updated_at = datetime('now')
 WHERE access_level = 'public';

-- Chapters inherit from their book unless they say otherwise. A 'public'
-- chapter inside an 'auth' book was already unreachable to a signed-out
-- visitor; this just stops the row claiming otherwise.
UPDATE chapters SET access_level = 'auth', updated_at = datetime('now')
 WHERE access_level = 'public';

-- ── Signups ──────────────────────────────────────────────────────────
-- An account-only site with open registration is an account-only site in
-- name. Every new account now waits for an admin, which is also what the
-- knowledge graph's per-map access model already assumed.
UPDATE settings SET value = 'approval' WHERE key = 'signup_mode' AND value = 'open';

-- ── Session hygiene ──────────────────────────────────────────────────
-- One live session per account is enforced on sign-in, which deletes the
-- account's other rows. Anything already in the table predates that rule,
-- so accounts holding several sessions right now would keep them until
-- each expired. Clear the lot: everyone signs in once more, and from then
-- on the invariant actually holds.
DELETE FROM sessions;
