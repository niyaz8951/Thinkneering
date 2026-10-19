-- 0008 (19 Oct 2026): every project has a unique code that is never used again, even after the project is deleted:
-- P-<year it was created>-<number>, the number from one counter that only goes up (app_counters 'project').
-- Existing projects get theirs in the order they were created. The code is shown with the project, on its records,
-- and in Compliance review, where admins filter and download the library by it.
CREATE TABLE app_counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
ALTER TABLE pr_projects ADD COLUMN code TEXT;
UPDATE pr_projects SET code = 'P-' || substr(created_at, 1, 4) || '-' || printf('%04d',
  (SELECT count(*) FROM pr_projects p2 WHERE p2.created_at < pr_projects.created_at OR (p2.created_at = pr_projects.created_at AND p2.id <= pr_projects.id)));
INSERT INTO app_counters (name, value) VALUES ('project', (SELECT count(*) FROM pr_projects));
CREATE UNIQUE INDEX pr_projects_code ON pr_projects (code);
