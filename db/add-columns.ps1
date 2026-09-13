# Add the columns the 2026-09 migrations need — one statement per call.
#
# Why this is not just lines in a .sql file: D1 runs a file as one unit, and
# the first failing statement aborts everything after it. SQLite has no
# "ADD COLUMN IF NOT EXISTS", so on a re-run the first ALTER raises
# "duplicate column name" and every CREATE, INSERT, TRIGGER and VIEW after it
# never runs. The migration then looks applied and is not.
#
# Each column is its own wrangler call here, so an already-present column
# cannot stop the next one. "duplicate column name" is expected and harmless.
#
# Usage, from the repository root:
#   .\db\add-columns.ps1
#   .\db\add-columns.ps1 -Local
#
# If PowerShell refuses to run it:
#   powershell -ExecutionPolicy Bypass -File .\db\add-columns.ps1
#
# Safe to run as many times as you like.

param(
  [switch]$Local,
  [string]$DbName = "thinkneering-db"
)

$target = if ($Local) { "--local" } else { "--remote" }

$columns = @(
  @{ Table = "knowledge_maps";    Column = "lanes TEXT" },
  @{ Table = "knowledge_nodes";   Column = "scope TEXT NOT NULL DEFAULT 'project'" },
  @{ Table = "knowledge_nodes";   Column = "project_id TEXT" },
  @{ Table = "knowledge_nodes";   Column = "origin TEXT NOT NULL DEFAULT 'human'" },
  @{ Table = "knowledge_nodes";   Column = "source_ref TEXT" },
  @{ Table = "knowledge_nodes";   Column = "superseded_by TEXT" },
  @{ Table = "knowledge_actions"; Column = "assignee_id TEXT" }
)

$added = 0; $present = 0; $failed = 0

Write-Host "Adding columns to $DbName ($($target.TrimStart('-')))"
Write-Host ""

foreach ($c in $columns) {
  $name = ($c.Column -split ' ')[0]
  $sql  = "ALTER TABLE $($c.Table) ADD COLUMN $($c.Column);"

  $out = & npx wrangler d1 execute $DbName $target --yes --command $sql 2>&1 | Out-String

  if ($LASTEXITCODE -eq 0) {
    Write-Host "  added    $($c.Table).$name"
    $added++
  }
  elseif ($out -match "duplicate column name") {
    Write-Host "  present  $($c.Table).$name"
    $present++
  }
  else {
    # Anything else is a real problem — a missing table, bad credentials —
    # and is worth showing rather than counting.
    Write-Host "  FAILED   $($c.Table).$name" -ForegroundColor Red
    $out -split "`n" | ForEach-Object { Write-Host "           $_" }
    $failed++
  }
}

Write-Host ""
Write-Host "$added added, $present already present, $failed failed."

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Fix the failures above before running the migration files." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Now run, in this order:"
@(
  "2026-09-knowledge-typed.sql",
  "2026-09-signin-only.sql",
  "2026-09-education-tools.sql",
  "2026-09-actions.sql",
  "2026-09-sbu-map.sql",
  "2026-09-people.sql"
) | ForEach-Object {
  Write-Host "  npx wrangler d1 execute $DbName $target --file=./db/$_"
}
