# Deploy — September 2026: mobile sections, dictionary headwords, Outline ↔ Map

Unzip over the repo root, commit, push. Then the database — **"Retry deployment"
in Cloudflare runs no SQL.** Two new columns and two new migration files, on
top of the refocus set (which must already have run; `/api/admin/health` says).

```bash
# 1. Columns — one wrangler call each (two new ones: dictionary_entries.pos, .forms_json)
./db/add-columns.sh                  # or .\db\add-columns.ps1 on Windows

# 2. Migrations, in this order, AFTER 2026-09-domain-kinds.sql has run
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-dictionary-headword.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-outline.sql

# 3. As an admin open /api/admin/health — empty `problems` means done.
```

Both files are re-runnable. `npm test` → 22 suites, 608 checks, all passing.

## What changed and why

### Sections not opening on a phone
Every section link went through `/s/<slug>`: load `section.html`, run its
script, call `/api/catalog`, then `location.replace()` to the tool. Four steps
on a phone, and when any one stalled — a slow catalogue call, a page paused
in the background, a stale worker — the tap went nowhere. The three sections
are each one destination, so links now go straight there.
- `assets/js/global.js` — `TN.sectionHref(slug)` resolves compliance-maker /
  maps / library (and the old knowledge / education) to their homes; header
  nav, tab bar and footer use it; `inSection()` keeps the current-tab mark
  correct on pages under a section (a map, a book).
- `index.html` — index rows use it.
- `/s/<slug>` and `section.html` are untouched: bookmarks and old links land.

### Dictionary — headwords, casing, lanes
The regression: `defaultLane()` filed every approved word into Nouns, and the
selected text was stored verbatim.
- `functions/api/dictionary/lookup.js` — the model is asked for `headword`
  and `partOfSpeech` (schema-required). The entry is filed as the
  dictionary-cased headword (running → **Run**, went → **Go**); the selected
  form is kept in `forms_json` so "runs"/"ran" resolve from the same row with
  no second AI call; a headword already on file gets the new form attached
  instead of a duplicate row. A model headword that is not the same word (a
  synonym) is ignored in favour of the selection.
- `functions/_lib/dictionary.js` — approval places the node by part of
  speech: verb → Verbs, adjective/adverb → Adjectives & adverbs, phrase/idiom
  → Phrases & idioms (kind `phrase`/`idiom`), else Nouns. Selected forms
  become aliases so a graph search on "running" finds Run.
- `functions/api/dictionary/prefetch.js` — pre-warms by form as well.
- `functions/api/admin/dictionary.js`, `tools/knowledge/dictionary.js` —
  headword and part of speech editable in the review console before approval;
  a changed headword re-keys the row and refuses to collide.
- `assets/js/dictionary.js` — the panel heading shows the headword, with
  "verb · looked up as “running”" under it.
- `db/add-columns.sh/.ps1` — `dictionary_entries.pos`, `.forms_json`.
- `db/2026-09-dictionary-headword.sql` — capital first letter on existing
  terms and Dictionary-map titles; ledger row. No ALTER, per the rule.
- `_dev/tests/dictionary-headword.test.mjs` — 6 checks.

### Outline ↔ Map — two views of one data model
The graph is typed: `contains` is legal only down the physical hierarchy, so
an outline that indented by `contains` could indent equipment and nothing
else. The outline needed one relation the trigger always accepts.
- `db/2026-09-outline.sql` — `under`: "filed beneath", legal between every
  pair of kinds (cross join of `knowledge_kinds`), drawn dotted on the
  canvas, offered as a spine in the hierarchy picker, never quoted as a fact.
  Runs after `domain-kinds` so the word-map kinds are in the join.
- `tools/knowledge/domain-*.js` — every pack draws `under` and declares
  `outline: { relation: 'under', defaultKind }` (note / activity / word;
  the SBU pack takes its first kind).
- `tools/knowledge/map.js` — the Outline tab is a real outliner over the
  same `nodes`/`edges` as the canvas. A line is a node; a line under
  another is an `under` edge; order is the node's authored `y`. Enter =
  sibling, Shift+Enter = child, Tab / Shift+Tab = reparent (edge deleted and
  rewritten), Alt+↑↓ = reorder, Ctrl+Enter = open the sheet, Backspace on an
  empty draft line removes it. Kind is a tag on the line; draft vs approved is
  the dotted dot and the pill; edges the tree cannot show (governed by,
  supplies, synonym…) are read-only chips that jump to the node on the canvas.
  Search and the status filter apply. The existing "Open" and "Map" row
  actions are kept. Every write goes through the existing
  `/api/knowledge/graph` and `reload()` redraws both views.
- Approval rule preserved: a rename or change of kind is a change to what the
  node says and goes back to review exactly as from the sheet. Reordering and
  reparenting are layout, so they use the new `positionOnly` save and leave
  approval, version and revisions alone.
- `functions/api/knowledge/graph.js` — `positionOnly` mode on node POST.
- `tools/knowledge/map.html` — outline toolbar (the phone's Tab key) and the
  delete dialog: "Delete, keep what is under it" (children move up one level)
  or "Delete the whole branch" (explicit and destructive).
- `tools/knowledge/knowledge.css` — outline styles (`kg-ol-*`), phone rules.
- `_dev/tests/outline.test.mjs` — 42 checks; `knowledge-typed.test.py` gains
  3 (under legal everywhere, `contains` still refused, re-run safe).
- `functions/api/admin/health.js` — knows the two migrations and columns.

### Installable app
Already in place in this repo (manifest, worker, icons, tab bar); nothing
changed. The worker never caches pages or `/api/`, so the one-device rule
holds after install.

## Acceptance to try after deploy
Open any map → Outline → **+ Line**, type, Enter, type, Tab, type. Switch to
Graph: three nodes, two `under` edges. Rename one on the canvas, switch back:
renamed. In Library, select "running": the panel says **Run · verb · looked
up as "running"**; approve it and it lands in Verbs.
