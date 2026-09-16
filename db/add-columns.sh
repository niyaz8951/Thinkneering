#!/usr/bin/env bash
# Add the columns the 2026-09 migrations need — one statement per call.
#
# Why this is not just lines in a .sql file: D1 runs a file as one unit, and
# the first failing statement aborts everything after it. SQLite has no
# "ADD COLUMN IF NOT EXISTS", so on a re-run the first ALTER raises
# "duplicate column name" and every CREATE, INSERT, TRIGGER and VIEW after it
# never runs. The migration then looks applied and is not — which is exactly
# the failure this script exists to prevent.
#
# Each column is its own wrangler call here, so one already-present column
# cannot stop the next one. "duplicate column name" is the expected, harmless
# result for anything already added.
#
# Usage:
#   ./db/add-columns.sh                    # remote, the usual case
#   ./db/add-columns.sh --local            # local dev database
#
# Safe to run as many times as you like.

set -u

DB="${DB_NAME:-thinkneering-db}"
TARGET="--remote"
[ "${1:-}" = "--local" ] && TARGET="--local"

# table | column definition
COLUMNS=(
  "knowledge_maps|lanes TEXT"
  "knowledge_nodes|scope TEXT NOT NULL DEFAULT 'project'"
  "knowledge_nodes|project_id TEXT"
  "knowledge_nodes|origin TEXT NOT NULL DEFAULT 'human'"
  "knowledge_nodes|source_ref TEXT"
  "knowledge_nodes|superseded_by TEXT"
  "knowledge_actions|assignee_id TEXT"
  "dictionary_entries|pos TEXT"
  "dictionary_entries|forms_json TEXT"
)

added=0
present=0
failed=0

echo "Adding columns to ${DB} (${TARGET#--})"
echo

for entry in "${COLUMNS[@]}"; do
  table="${entry%%|*}"
  column="${entry#*|}"
  name="${column%% *}"

  out=$(npx wrangler d1 execute "$DB" $TARGET --yes \
        --command "ALTER TABLE ${table} ADD COLUMN ${column};" 2>&1)

  if [ $? -eq 0 ]; then
    echo "  added    ${table}.${name}"
    added=$((added + 1))
  elif echo "$out" | grep -qi "duplicate column name"; then
    echo "  present  ${table}.${name}"
    present=$((present + 1))
  else
    # Anything else is a real problem — a missing table, bad credentials —
    # and is worth showing rather than counting.
    echo "  FAILED   ${table}.${name}"
    echo "$out" | sed 's/^/           /'
    failed=$((failed + 1))
  fi
done

echo
echo "${added} added, ${present} already present, ${failed} failed."

if [ "$failed" -gt 0 ]; then
  echo
  echo "Fix the failures above before running the migration files."
  exit 1
fi

echo
echo "Now run, in this order:"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-knowledge-typed.sql"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-signin-only.sql"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-education-tools.sql"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-actions.sql"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-sbu-map.sql"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-people.sql"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-dictionary-headword.sql"
echo "  npx wrangler d1 execute ${DB} ${TARGET} --file=./db/2026-09-outline.sql"
