-- Reset the site's DATA to test from scratch (owner, 19 Oct 2026). Paste into Cloudflare > D1 > thinkneering-db > Console.
--
-- BEFORE: note the time. D1 Time Travel can bring the whole database back to any minute of the last 30 days
--         (Cloudflare dashboard > D1 > thinkneering-db > Time Travel, or `wrangler d1 time-travel restore`).
--
-- KEPT:    users, their tiles, admin and "Can edit" rights; tiles and tools; products and factories; the project lists
--          (client types, regions); the starter keywords; the project-code counter (codes never repeat, even after a
--          reset); the audit log (never deleted); the migrations table.
-- DELETED: projects (and their records, datasheet tables, members, history), the compliance library and its answer
--          history, Product Options values and special options / notes, every map (rule books, knowledge maps),
--          the row mapping, every AI table, everyone's sessions (everyone signs in again).
-- AFTER:   in Cloudflare > R2 > hub-files, delete the folders notes/ and maps/ (the datasheet tables and map images of
--          the deleted rows; nothing points to them any more). Then sign in again.

-- AI
DELETE FROM ai_suggestions;
DELETE FROM ai_feedback;
DELETE FROM ai_drafts;
DELETE FROM ai_match_cache;
DELETE FROM ai_chat_messages;
DELETE FROM ai_chats;
DELETE FROM ai_jobs;
DELETE FROM ai_rules;
DELETE FROM ai_map_links;
-- projects and their records
DELETE FROM cm_answer_log;
DELETE FROM cm_run_lines;
DELETE FROM pr_notes;
DELETE FROM pr_log;
DELETE FROM pr_members;
DELETE FROM cm_runs;
DELETE FROM pr_projects;
-- the compliance library
DELETE FROM cm_lines;
-- Product Options
DELETE FROM po_values;
DELETE FROM po_extras;
-- Maps (rule books and knowledge maps included)
DELETE FROM mp_images;
DELETE FROM mp_nodes;
DELETE FROM mp_maps;
-- the row mapping (the first datasheet of each product builds it again, with the starter keywords and Remove text)
DELETE FROM dn_map_settings;
DELETE FROM dn_map;
-- sessions
DELETE FROM app_sessions;

-- check: every count below should be 0
SELECT (SELECT count(*) FROM pr_projects) AS projects, (SELECT count(*) FROM cm_lines) AS library, (SELECT count(*) FROM po_values) AS options,
       (SELECT count(*) FROM mp_maps) AS maps, (SELECT count(*) FROM dn_map) AS mapping, (SELECT count(*) FROM ai_drafts) AS drafts;
