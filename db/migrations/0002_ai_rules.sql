-- 0002 (16 Oct 2026): AI rules per product / factory, and the prompt version on every AI draft.
-- Never edit after it has been applied to production; a correction is 0003.

-- Rules and facts the AI review uses, kept per product (factory_id NULL = every factory of the product).
-- tool says which app a rule belongs to, so other tools can have their own rules later ('compliance' today).
--   kind 'rule'  an instruction ("Installation and rigging clauses are In Contractor's Scope")
--   kind 'fact'  what the factory offers ("Fans: direct-driven EC plug fans"); an approved source the model may quote
-- keywords: comma separated words or phrases; the rule applies to a clause that mentions any of them
--   (empty = every clause of that Part). part: 0 = any Part, 1 / 2 / 3.
-- answer + remark both set on a rule = applied by code without the model.
CREATE TABLE ai_rules (
  id          TEXT PRIMARY KEY,
  tool        TEXT NOT NULL DEFAULT 'compliance',
  product_id  TEXT NOT NULL REFERENCES cm_products(id) ON DELETE CASCADE,
  factory_id  TEXT REFERENCES cm_factories(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'rule' CHECK (kind IN ('rule', 'fact')),
  title       TEXT NOT NULL DEFAULT '',
  keywords    TEXT NOT NULL DEFAULT '',
  part        INTEGER NOT NULL DEFAULT 0 CHECK (part BETWEEN 0 AND 3),
  instruction TEXT NOT NULL DEFAULT '',
  answer      TEXT NOT NULL DEFAULT '',
  remark      TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ai_rules_scope_idx ON ai_rules (tool, product_id, factory_id, active);

-- Which prompt (worker/src/ai/prompts/draft.md, PROMPT_VERSION in draft.ts) or rule made each draft.
ALTER TABLE ai_drafts ADD COLUMN prompt_version TEXT NOT NULL DEFAULT '';
