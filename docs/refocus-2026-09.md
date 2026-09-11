# Refocus — Thinkneering is Compliance, Knowledge, Education

Unzip over the repo root. No build step, no new dependencies.

---

## Deploy

Two migrations, **in this order**. `Retry deployment` in Cloudflare runs no SQL — these
have to be executed explicitly.

```bash
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-refocus.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-knowledge-typed.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-signin-only.sql
```

**The third migration deletes every session row.** Everyone signs in again once,
including you. That is deliberate: one-session-per-account is enforced at sign-in, so
sessions created before the rule existed would otherwise survive alongside each other
until they expired.

The second reports `duplicate column name: scope` if run twice. That is harmless and means
it is already applied. Everything else in both files is re-runnable.

Check both took:

```bash
npx wrangler d1 execute thinkneering-db --remote \
  --command="SELECT slug, sort_order FROM sections WHERE parent_id IS NULL ORDER BY sort_order;"
```

You want exactly `compliance-maker`, `knowledge`, `education`.

```bash
npx wrangler d1 execute thinkneering-db --remote \
  --command="SELECT COUNT(*) AS rules FROM knowledge_edge_rules;"
```

You want a number in the low hundreds. Zero means the typed migration did not run.

Then push and let Pages build. `global.css` and `global.js` are referenced as `?v=10`,
`knowledge.css` as `?v=4` and `map.js` as `?v=3`, so caches bust on their own.

---

## Run the tests

```bash
python3 _dev/tests/knowledge-typed.test.py   # 33 checks — schema and access rules
node _dev/tests/graph-retrieval.test.mjs     # 18 checks — retrieval logic
node _dev/tests/access-model.test.mjs        # 15 checks — the site stays account-only
node _dev/tests/imports.test.mjs             # every relative import resolves
node _dev/tests/assets.test.mjs              # every local link points at a real file
```

The last two are the ones to run before any future zip. An unresolved import fails a
Cloudflare build silently from the browser's point of view.

---

## Account-only

There is no free layer. `functions/_middleware.js` is now a **deny list**: everything
needs a session except `/login/`, `/signup/`, their auth endpoints and `/assets/`. A new
page is therefore private by default and nobody has to remember to add it to a
protected-pages array — which is the failure mode the old allow-list had built in.

An API call that fails the gate gets `401 {error, signedOut:true}`, not a redirect to an
HTML login page. A `fetch()` following a redirect to HTML is how a dead session surfaces
as `Unexpected token '<'` and hides its own cause.

`TN.api()` sees that flag and navigates to `/login/`, so a session ending mid-use lands on
a page that explains itself rather than a screen of failed buttons.

### One device at a time

Already enforced in `functions/api/auth/login.js`: signing in deletes every other session
row for that account, so the previous device's cookie points at nothing and reads as
signed out. Two things were missing and are now in:

- the displaced device is **told why**, instead of being bounced to a bare form;
- `db/2026-09-signin-only.sql` clears the table once, so sessions predating the rule
  don't outlive it.

### What changed on the pages

The signed-out hero, the free-versus-full comparison, the "Free" access chip, the guest
tier in Compliance Maker and its sign-up upsell panel are all gone — not hidden. Dead
branches that describe an access model the site no longer has are worse than no code:
they read as current to whoever opens the file next.

`login/index.html` and `signup/index.html` no longer mount the site header, which would
have called the now-gated `/api/catalog` and rendered an empty nav after a 401.

The `next` parameter is validated against `^/[^/\\]` before redirecting. Without that
check, a crafted link could send someone to another origin the instant after they typed
their password.

---

## If the commit fails on Windows

Two symptoms travel together: a wall of `LF will be replaced by CRLF` warnings, then
`open(...): Permission denied` on a file you never edited.

The warnings are the cause of the second one. With `core.autocrlf=true`, Git rewrites the
line endings of **every** text file in the tree on any operation that touches it — so a
four-line change to `.gitignore` makes Git open all 128 files, and it only takes one of
them being locked or flagged read-only for the whole commit to abort.

`.gitattributes` in this drop fixes it at the source by pinning the repo to LF. Apply it,
then clear whatever is holding the file:

```powershell
cd path\to\Thinkneering
attrib -R /S /D                 # clear read-only on the whole tree
git config core.autocrlf false  # stop the rewriting for this repo
git add --renormalize .
git status
```

If `Permission denied` survives that, something has the file open. Close your editor, and
check whether the folder sits inside OneDrive or Dropbox — a sync client holding a handle
on a `.sql` file is the usual culprit, and moving the clone outside the synced folder is
the only reliable cure.

Nothing in the zip is read-only: every file ships `0644`. The flag is applied by Windows
on extraction, not by the archive.

---

## Deleted

Tools and HVAC calculators move to QuickTools. They are gone from this repo, so the
catalogue rows pointing at them had to go too, or the cards would 404.

```
tools/hvac/**                     assets/js/hvac/**
tools/word-counter/               assets/css/hvac-calc.css
tools/unit-converter/             assets/vendor/psychrolib/**
tools/text-cleaner/               functions/api/extract/
tools/container-calculator/       functions/_lib/extract/**
tools/web-text-extractor/
db/2026-08-container-calculator.sql
db/2026-08-text-cleaner.sql
db/2026-08-web-text-extractor.sql
_dev/ai-learning-sop.txt          (byte-identical to docs/compliance-maker/ copy)
_dev/ai-prompts.txt               (same)
_dev/architecture-review.txt      (same)
```

169 files down to 118. Recover any of them from git history when you build QuickTools.

**Process Map was kept.** It sits under Knowledge rather than Tools and you did not name
it. Say so and it goes the same way.

---

## The gap that was actually there

Compliance Maker never read the knowledge graph. Not partially — `ask.js` read
`compliance_facts`, `compliance_kb` and `compliance_options` and nothing else, while the
Knowledge section told every visitor that approved nodes are what it answers from.
`/api/knowledge/search` existed, was well built, and nothing called it.

That sentence is now true. `functions/_lib/graph-retrieval.js` is read in process by
`ask.js` — an answer endpoint should not make an HTTP round trip to its own origin to read
its own database — and:

- retrieved values join the fabrication guard's allow-list, so a correctly cited approved
  number is not flagged as invented and downgraded to `TO VERIFY`;
- the answer comes back with `citations` (node, scope, approval) and `gaps` (terms nothing
  approved could answer);
- `knowledge_usage` and `knowledge_answer_facts` record what was used, so a disputed answer
  walks back to the fact and its approval.

While extracting it: `search.js` carried its own `isAdmin` testing `user.is_admin` and
`user.groups`, neither of which the session user carries. The admin branch could never
fire, so an admin saw no maps at all. `_lib/knowledge.js` had already found and documented
this; the copy never got the fix. There is one implementation now.

---

## The typed graph

| Was | Is |
|---|---|
| Node kinds lived in client-side domain packs | `knowledge_kinds` table, enforced by trigger |
| Any relation legal between any two kinds | `knowledge_edge_rules` + trigger |
| Aliases a JSON array, no uniqueness | `knowledge_aliases`, unique per map |
| Attributes a JSON blob | `knowledge_facts`, number and unit stored apart |
| No record of how widely a fact holds | `scope`: project / family / general |
| No clause, requirement or project kind | All three added |

Three of these are worth spelling out.

**Scope** is the calibration rule made structural. A face velocity seen once on one job is
stored `scope='project'` and never restated as what we always offer — the prompt now has a
rule saying exactly that, and the retrieved block labels each project-scoped value inline.
Promotion to `general` needs an approver; a trigger refuses a silent one.

**Approved facts are immutable.** A correction inserts a new row carrying `supersedes_id`.
You lose the ability to quietly fix a typo in place and gain an audit trail that survives
the fix.

**Numeric facts cannot exist without a unit.** A `CHECK` rejects them. This is the single
most useful constraint in the file for HVAC work, and `propose.js` reports a skipped fact
rather than guessing `mm`.

---

## The loop

A clause arrives → terms resolve through the index → approved facts come back ranked
`project > family > general` → the model composes prose from those facts only → the answer
is logged against the exact fact IDs.

When nothing resolves, `/api/knowledge/propose` writes a **draft node carrying the clause
verbatim** into the review queue. The gap becomes a specific authoring task instead of a
`TO VERIFY` nobody revisits.

`/tools/knowledge/review.html` serves them **one at a time**, oldest first, each with its
proposed facts, its proposed connections, and any approved node with a similar name beside
it. Batch approval is faster and is how a review queue stops being a review.

---

## New and changed files

**New**

| Path | What it is |
|---|---|
| `db/2026-09-refocus.sql` | Narrows the catalogue to three sections |
| `db/2026-09-knowledge-typed.sql` | Kinds, edge rules, scope, aliases, facts, views, triggers |
| `db/2026-09-signin-only.sql` | Raises every `public` row to `auth`; clears sessions |
| `_dev/tests/access-model.test.mjs` | 15 checks that the site stays account-only |
| `functions/_lib/graph-retrieval.js` | Retrieval, prompt block, allow-list, usage logging |
| `functions/api/knowledge/types.js` | Serves the legality matrix to the UI |
| `functions/api/knowledge/review.js` | Review queue: read, approve, reject |
| `functions/api/knowledge/propose.js` | Clause gap → draft node |
| `tools/knowledge/review.html` | The queue, one node at a time |
| `_dev/tests/knowledge-typed.test.py` | 27 schema checks |
| `_dev/tests/graph-retrieval.test.mjs` | 18 retrieval checks |
| `_dev/tests/imports.test.mjs` | Import resolution |
| `_dev/tests/assets.test.mjs` | Local link resolution |

**Changed**

| Path | Why |
|---|---|
| `db/schema.sql` | Seeds rewritten so a fresh database comes up refocused |
| `db/audit-catalog.sql` | Dead-link list no longer names deleted tools |
| `functions/api/compliance/ask.js` | Reads the graph; cites it; logs it; respects scope |
| `functions/api/knowledge/search.js` | Rewritten on the shared module; stale isAdmin gone |
| `functions/api/knowledge/graph.js` | Persists `scope` |
| `functions/_lib/knowledge.js` | `rowToNode` exposes scope, origin, sourceRef |
| `assets/js/global.js` | Footer nav; 401 handling; access chip; no signed-out header |
| `functions/_middleware.js` | Deny-by-default gate; JSON 401 for API callers |
| `functions/_compliance.js` | Guest tier removed |
| `login/index.html` | No chrome; takeover notice; `next` validated |
| `signup/index.html` | No chrome |
| `tools/compliance-maker/index.html` | Sign-up upsell panel and guest CSS removed |
| `tools/compliance-maker/compliancemaker.js` | Member floor instead of a guest fallback |
| `assets/js/admin.js` | Placeholder pointed at a deleted tool |
| `index.html` | Copy rewritten; review queue in the signed-in actions |
| `section.html` | Dropped the `hvac/calculators` route |
| `tools/knowledge/map.html` | Scope field; connect dialog reordered |
| `tools/knowledge/map.js` | Legality-aware relation picker; scope |
| `tools/knowledge/knowledge.css` | One new class for the raised clause |

---

## Still open

**Aliases are not backfilled.** `knowledge_aliases` starts empty and fills as nodes are
approved through the review queue, because D1 has no `json_each` to parse the existing
JSON `aliases` column in SQL. Existing approved nodes keep matching through
`knowledge_terms` exactly as before — retrieval is unaffected — but the duplicate-catching
unique index only covers nodes that have passed through approval since the migration. A
one-off script over `/api/knowledge/graph` would close it if you want it closed now.

**`ai-suggest.js` does not read the graph yet.** `ask.js` does. The clause-review pipeline
is a larger surface and wiring it blind was the wrong risk to take in the same drop; it is
the obvious next one.

**Compliance Maker's `basic` layout mode is now unreachable.** It existed for signed-out
visitors and every caller resolves to `full`. The dead branches are left in place rather
than torn out in the same drop as the access change; removing them is a separate pass with
its own testing, across a 112 KB file.

**Nothing calls `/api/knowledge/propose` automatically yet.** The endpoint is built and
tested. Deciding what triggers it — every `TO VERIFY`, or an explicit "raise this" button
in Compliance Maker — is a judgement about how fast you want the queue to fill, and that
is yours rather than mine.
