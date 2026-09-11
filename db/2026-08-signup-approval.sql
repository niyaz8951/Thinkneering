-- =====================================================================
-- Signups require admin approval.
--
-- The approval flow was already built and working — signup.js creates the
-- account as 'pending' and skips the session, login.js refuses a 'pending'
-- account with 403, and the admin Users list already shows an Approve
-- button on those rows. The only thing wrong was the setting: schema.sql
-- seeds signup_mode as 'open', so signup.js took the other branch and made
-- every new account active immediately.
--
-- Re-runnable.
--
--   npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-08-signup-approval.sql
--
-- Reminder: Cloudflare's "Retry deployment" button only redeploys code.
-- It does NOT run this file.
-- =====================================================================

-- 1 ── The switch ------------------------------------------------------
--
-- INSERT OR REPLACE rather than UPDATE, so this still works if the row was
-- never seeded. Same three values the admin Settings dropdown writes:
-- open | approval | closed.

INSERT OR REPLACE INTO settings (key, value) VALUES ('signup_mode', 'approval');


-- 2 ── Who is already inside -------------------------------------------
--
-- Read this before running step 3. Accounts created while the door was open
-- are active right now and step 1 does nothing to them. Admins are excluded
-- because demoting the only admin locks you out of the console that undoes
-- it.

SELECT 'ACTIVE NON-ADMIN ACCOUNTS' AS report,
       id, email, name, status, plan, created_at, last_login_at
  FROM users
 WHERE role <> 'admin'
   AND status = 'active'
 ORDER BY created_at DESC;


-- 3 ── Send an account back for approval -------------------------------
--
-- Fill in the email and uncomment both statements. Changing the status is
-- not enough on its own: an existing session cookie keeps working, because
-- currentUser() looks the session up and only treats 'suspended' specially.
-- The delete is what actually puts them back outside.
--
-- Repeat the pair per account, or widen the WHERE clause once you have read
-- the list from step 2 and know exactly who it will catch.

-- UPDATE users
--    SET status = 'pending'
--  WHERE role <> 'admin'
--    AND email = 'testuser1@gmail.com';

-- DELETE FROM sessions
--  WHERE user_id IN (SELECT id FROM users WHERE status = 'pending');


-- 4 ── Confirm --------------------------------------------------------

SELECT 'SIGNUP MODE' AS report, value FROM settings WHERE key = 'signup_mode';

SELECT 'ACCOUNTS BY STATUS' AS report, status, role, COUNT(*) AS people
  FROM users GROUP BY status, role ORDER BY status, role;
