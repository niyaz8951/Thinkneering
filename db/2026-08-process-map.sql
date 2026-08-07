-- Thinkneering — Process Map (HVAC equipment supply) schema
-- Run against thinkneering-db. "Retry deployment" in Cloudflare does NOT run this.
--   npx wrangler d1 execute thinkneering-db --remote --file=./migrations/2026-08-process-map.sql

CREATE TABLE IF NOT EXISTS process_maps (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled process',
  project_code  TEXT,
  product_line  TEXT,
  factory       TEXT,
  consultant    TEXT,
  contractor    TEXT,
  required_on_site TEXT,          -- ISO date, denormalised for "what is due next month"
  critical_path_days INTEGER,
  slack_days    INTEGER,
  health        INTEGER,          -- 0-100
  data          TEXT NOT NULL,    -- full map JSON: project, cards, connectors, positions
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_process_maps_user
  ON process_maps (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_process_maps_due
  ON process_maps (user_id, required_on_site);

CREATE INDEX IF NOT EXISTS idx_process_maps_project
  ON process_maps (project_code);

-- AI suggestion log. Same pattern as the Compliance Maker training ingest:
-- record what the model said at generation time, with the project context,
-- so a later human correction can be compared against it.
CREATE TABLE IF NOT EXISTS process_map_ai_log (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  action             TEXT NOT NULL,   -- submittal_readiness, delivery_risk, generate_itp, ...
  map_title          TEXT,
  project_code       TEXT,
  product_line       TEXT,
  factory            TEXT,
  node_count         INTEGER,
  edge_count         INTEGER,
  critical_path_days INTEGER,
  slack_days         INTEGER,
  request_json       TEXT,
  response_json      TEXT,
  model              TEXT,
  rating             TEXT,            -- filled in later: good | poor | corrected
  correction         TEXT,            -- human-corrected text, when supplied
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pm_ai_log_action
  ON process_map_ai_log (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pm_ai_log_product
  ON process_map_ai_log (product_line, factory, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pm_ai_log_user
  ON process_map_ai_log (user_id, created_at DESC);
