# Runbook

Everything you need to deploy, verify, back up and recover. Two pages, because
a runbook nobody finishes reading is a runbook nobody follows.

---

## Deploy

```bash
npm test          # 19 suites. If this is red, stop.
git push          # Cloudflare Pages builds on push
```

Then, signed in as an admin, open **`/api/admin/health`**.

That one call is the whole verification step. It answers four questions that
used to be answerable only by noticing something broken later:

- which migrations in `db/` have not run
- which columns from `add-columns` are missing
- which bindings are absent, and what stops working without each
- whether the knowledge is actually reachable — approved, indexed, embedded

**If `problems` is empty, the deployment is assembled correctly.** If it is
not, each entry says what to run.

---

## Migrations

Which have run is a query now, not a memory:

```sql
SELECT name, applied_at FROM schema_migrations ORDER BY name;
```

Each migration records its own name as its **last** statement. On D1 a file is
one unit and aborts at the first failing statement, so a row in that table means
the whole file ran. That is the guarantee the ledger exists to give — and it is
the one the `duplicate column: scope` incident showed was missing, where a file
reported a warning, left every statement after it unrun, and looked applied.

It records itself whichever way you apply it: wrangler from a PC, the Cloudflare
console from a phone, or CI. A ledger that only stays correct with one tool is
not one you can trust.

### Running them

Columns first — one call each, so one already-present column cannot stop the
next:

```bash
./db/add-columns.sh          # or  .\db\add-columns.ps1
```

Then, in this order. `2026-09-migration-ledger.sql` must be first:

```
2026-09-migration-ledger.sql
2026-09-refocus.sql
2026-09-knowledge-typed.sql
2026-09-signin-only.sql          ← clears every session; you sign in again
2026-09-education-tools.sql
2026-09-actions.sql
2026-09-sbu-map.sql
2026-09-people.sql
2026-09-rename-sections.sql
2026-09-domain-kinds.sql
2026-09-approve-seed.sql
```

```bash
npx wrangler d1 execute thinkneering-db --remote --file=./db/<name>.sql
```

All are re-runnable. Re-applying one that already succeeded costs time and
nothing else.

### Adding a new one

1. Name it `YYYY-MM-<slug>.sql`.
2. End it with the ledger insert — copy the block from any recent migration.
3. Add its name to `EXPECTED_MIGRATIONS` in `functions/api/admin/health.js`.

`_dev/tests/engine.test.mjs` fails if you skip 2 or 3, which is the point: a
stale list reports healthy while something has never run.

---

## Backup and export

**Automatic:** `.github/workflows/backup.yml` dumps the database every Sunday
and keeps it as an artifact for 90 days. It needs two repo secrets —
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` — and it fails loudly on a
suspiciously small dump, because a zero-byte backup that uploads successfully is
worse than a failed job.

**Artifacts expire.** Download one every few months and keep it somewhere you
control. A backup that exists only inside the service you are backing up against
is not a backup.

**On demand:**

```
GET /api/admin/export                              everything, JSON
GET /api/admin/export?format=csv&table=nodes       one table, Excel-ready
GET /api/admin/export?map=<id>                     one map
```

The CSV carries a BOM, so Excel reads Urdu and Devanagari correctly, and uses
CRLF so it round-trips without a diff on every line. Cells starting `=`, `+` or
`-` are quoted, because Excel would otherwise treat them as formulas.

`knowledge_terms` and the vector index are **not** exported. Both are derived,
rebuilt by `reindexNode()` and `/api/knowledge/reindex`. Exporting a derived
index invites restoring a stale one.

---

## Recovery

**A migration half-applied.** Check `schema_migrations` for what is missing,
re-run those files. Everything is idempotent.

**A model retired.** Change it in `functions/_lib/models.js` — one line, nine
callers. Redeploy, then run `/api/knowledge/eval` and compare the headline with
the last one you recorded. That is what tells you whether the replacement is as
good, rather than merely working.

**The embedding model changed.** Not a one-line change: the dimensions must
match the Vectorize index. Create a new index, update `wrangler.toml`, re-run
`/api/knowledge/reindex`.

**Approved nodes returning nothing.** `/api/admin/health` reports
`unindexedApproved`. They are approved and unfindable, which looks like working
and is not. Re-save them through the map, or re-run
`db/2026-09-approve-seed.sql` for seeded ones.

**Full restore.** `wrangler d1 execute thinkneering-db --remote --file=<dump>.sql`
against an empty database, then `/api/knowledge/reindex` to rebuild the vectors.

---

## Measuring

`POST /api/knowledge/eval` — the only thing that tells you whether changes to
retrieval or prompts improved anything.

Record the headline after every such change:

```
9/11 found, 0/3 answered when they should not have
```

Both numbers, always together. Either improves easily by making the other worse:
drop `MIN_SCORE` and everything matches something. Add a case every time you
catch a bad answer — the set should grow from real failures, not imagined ones.
