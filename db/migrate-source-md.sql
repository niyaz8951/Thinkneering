-- Migration: chapters remember the markdown the writer typed, so opening the
-- editor shows your keystrokes rather than text regenerated from blocks.
-- Safe to run once on an existing database. If schema.sql was applied after
-- this change, the column is already there and this will error harmlessly.
ALTER TABLE chapters ADD COLUMN source_md TEXT;
