# Deploy — September 2026 drop 1 (R1–R4)

Unzip over your repo root, commit, push. Then run the one migration by hand —
**"Retry deployment" in Cloudflare never runs SQL.**

```bash
git add -A
git commit -m "Mobile nav fix, dictionary headwords, outline<->map, installable app"
git push
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-dictionary-headword.sql
```

The migration is re-runnable; a second run reports "duplicate column name"
on the two ALTERs, which is harmless.

> Before unzipping: this drop was built on the zip you supplied, which looks
> older than the live site (the live index shows "OPEN" chips and Maps /
> Library naming that this code does not contain). Diff `assets/js/global.js`,
> `assets/css/global.css`, `index.html` and `section.html` against your clone
> first and keep any newer lines of yours. Every other file in the drop is a
> tool-local file that is unlikely to have diverged.

## What changed and why

### R1 — Sections did not open on a phone
**Cause:** `.site-header__inner` is a fixed 60px flex row that never wraps and
the section nav sits in it with `flex: 1`. On a 375px screen the brand plus
the account buttons already fill the row, so the nav — the only route to the
three sections from any inner page — was squeezed to zero width and its links
were never on screen to tap.
- `assets/css/global.css` — below 560px the header row wraps; the nav takes
  its own full-width line with 40px tap targets; a long display name is
  clipped with an ellipsis instead of pushing the row off screen; the reader
  progress bar rides the top edge on a phone rather than sitting under a
  header that is no longer 60px.
- `section.html` — `/s/maps` and `/s/library` route straight to the tools,
  alongside the older `knowledge` / `education` slugs.

### R2 — Dictionary: headwords, casing, lanes
**Cause of the regression:** `defaultLane()` in `functions/_lib/dictionary.js`
filed every approved word into Nouns ("part of speech is not known at
approval time"), and the lookup stored the selected text verbatim.
- `functions/api/dictionary/lookup.js` — the model is now asked for
  `headword` and `partOfSpeech` (JSON-schema required). The entry is filed as
  the dictionary-cased headword (running → **Run**, went → **Go**); the form
  the reader selected is remembered in `forms_json` so the next "runs" or
  "ran" resolves from the same row without another AI call; a headword
  already on file gets the new form attached instead of a duplicate row.
  Response now carries `pos` and `lookedUp`. A model headword that is not
  plausibly the same word (a synonym) is ignored in favour of the selection.
- `functions/_lib/dictionary.js` — approval places the node by part of
  speech: noun → Nouns, verb → Verbs, adjective/adverb → Adjectives &
  adverbs, phrase/idiom → Phrases & idioms (and kind `phrase`/`idiom`).
  Selected forms become aliases so graph search on "running" finds Run.
- `functions/api/dictionary/prefetch.js` — a chapter's "running" pre-warms
  the Run row.
- `functions/api/admin/dictionary.js` + `tools/knowledge/dictionary.js` —
  headword and part of speech are editable in the review console before
  approval; changing the headword re-keys the row and refuses to collide.
- `assets/js/dictionary.js` — the panel heading shows the headword, with
  "verb · looked up as “running”" beneath it.
- `db/2026-09-dictionary-headword.sql` — adds `pos`, `forms_json`; gives
  existing terms and Dictionary-map node titles a capital first letter.
- `_dev/tests/dictionary-headword.test.mjs` — 6 tests; run with
  `node --test _dev/tests/dictionary-headword.test.mjs _dev/tests/dictionary-urdu.test.mjs`
  (17 pass).

### R3 — Outline ↔ Map: two views of one data model
- `tools/knowledge/map.js` — the Outline tab is a real outliner over the same
  `nodes`/`edges` the canvas draws. A line is a node; a line under another is
  a `contains` edge; order is the node's `y` (so it is also its canvas order).
  Enter = sibling, Shift+Enter = child, Tab / Shift+Tab = reparent (edge
  rewritten), Alt+↑↓ = reorder, Ctrl+Enter = open the sheet, Backspace on an
  empty draft line removes it. Kind is a tag on each line. Draft vs approved
  is shown by the dashed dot and pill. Edges the tree cannot show
  (synonym, flows to, governed by…) appear as read-only chips that jump to
  the node on the canvas. Search and the status filter apply to the outline.
  Every write goes through the existing `/api/knowledge/graph` endpoints and
  `reload()` redraws both views — nothing is stored twice and nothing syncs.
- Approval rule preserved: a rename or change of kind is a change to what the
  node says, so an approved node goes back to review exactly as it does from
  the sheet. Reordering and reparenting change only where a node sits, so
  they use the new `positionOnly` save and leave approval alone.
- `functions/api/knowledge/graph.js` — `positionOnly` mode on node POST:
  updates x/y/lane only, no version bump, no revision, no status change.
- `tools/knowledge/map.html` — outline toolbar (the phone's Tab key) and the
  delete dialog: "Delete, keep what is under it" (children move up one level)
  or "Delete the whole branch" (explicit, destructive).
- `tools/knowledge/knowledge.css` — outline styles (`kg-ol-*`), phone rules.
- `tools/knowledge/domain-english.js` — gains `contains` / `part_of` so a
  word map has the same tree relation as the other packs.
- `domain-hvac.js`, `domain-business.js`, `domain-english.js` — each declares
  `outline: { relation, defaultKind }` (note / activity / word).

### R4 — Installable as a phone app
- `manifest.webmanifest`, `assets/icons/*` (brand mark, incl. maskable),
  `sw.js` — shell-only worker: static files cached with a versioned cache
  name, old caches removed on activate; `/api/`, `/data/`, `/books/` and any
  redirected page are never handled or cached, so sign-in state, the
  one-device rule and D1 data always come from the network.
- `assets/js/global.js` — adds the manifest link, apple-touch-icon and
  theme-color to every page and registers the worker (https only).
- `index.html` — static manifest link on the start page.

### Not done (flagged)
- Tool folders that the three-section decision says should leave the repo
  (`tools/hvac`, `tools/container-calculator`, `tools/word-counter`, …) are
  untouched: deleting them is out of this drop's scope. Say the word.
- `index.html` hero copy still describes "two layers" and links to
  `/s/tools`; left as-is because the live file may already differ.
- Whether a node created by typing an outline line should inherit the
  parent's summary/aliases: it does not; it starts blank as a draft.
