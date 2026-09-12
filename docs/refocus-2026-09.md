# Refocus — Thinkneering is Compliance, Knowledge, Education

Unzip over the repo root. No build step, no new dependencies.

---

## Deploy

Two migrations, **in this order**. `Retry deployment` in Cloudflare runs no SQL — these
have to be executed explicitly.

```bash
# 1. Columns first. One wrangler call per column — see the note below.
./db/add-columns.sh                  # macOS / Linux / Git Bash
.\db\add-columns.ps1                 # Windows PowerShell, from the repo root

# 2. Then the migration files, in this order.
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-refocus.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-knowledge-typed.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-signin-only.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-education-tools.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-actions.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-sbu-map.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-people.sql
```

### Why columns are added separately

**D1 runs a file as one unit: the first failing statement aborts everything after it.**
SQLite has no `ADD COLUMN IF NOT EXISTS`, so an `ALTER` inside a migration file raises
`duplicate column name` on any re-run — and every `CREATE`, `INSERT`, `TRIGGER` and `VIEW`
below it silently never runs. The migration then looks applied and is not.

Earlier versions of these files carried their `ALTER`s inline with a comment calling the
second-run failure harmless. That was wrong, and it is the failure mode most likely to
leave a half-built schema that reports success.

Every column now lives in `db/add-columns.sh` / `.ps1`, one wrangler call each, so an
already-present column cannot stop the next one. `duplicate column name` there prints
`present` and moves on; anything else prints `FAILED` with the real error and stops.
`_dev/tests/migrations.test.mjs` asserts no `2026-09-*` migration contains an `ALTER`.

**If you already hit `duplicate column name: scope`:** nothing is broken. Run the column
script, then re-run every file above from the top. All of them are now fully re-runnable,
so re-applying one that already succeeded costs nothing.
bash
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-refocus.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-knowledge-typed.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-signin-only.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-education-tools.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-actions.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-sbu-map.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-09-people.sql
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
python3 _dev/tests/knowledge-typed.test.py   # 58 checks — schema, access, SBU map, actions
node _dev/tests/graph-retrieval.test.mjs     # 30 checks — retrieval and conflicts
node _dev/tests/gap-proposer.test.mjs        # 14 checks — the AI judgment gate
node _dev/tests/access-model.test.mjs        # 29 checks — account-only, and the worker keeps it that way
node _dev/tests/reflow.test.mjs              # 14 checks — the shared text-reflow module
node _dev/tests/migrations.test.mjs          # 34 checks — no ALTER hides in a migration
node _dev/tests/entities.test.mjs            # 21 checks — extracted text decodes correctly
node _dev/tests/icons.test.mjs               # 24 checks — every icon name the app asks for exists
node _dev/tests/app-shell.test.mjs           # 26 checks — full-screen modes, phone map, outline view
node _dev/tests/library-shelving.test.mjs    # 16 checks — moving a book to a shelf
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
have called the now-gated `/api/catalog` and rendered an empty nav after a 401. They keep
the home page's hero treatment instead — same type scale, same accented headline, brand
row and theme toggle — because this is now the whole first impression of the site rather
than a utility form somebody reaches after browsing.

What they deliberately do not carry is a nav or any link into a tool or section. There is
nothing a signed-out visitor may open, and offering doors that all redirect back to the
form is worse than offering none. `_dev/tests/access-model.test.mjs` asserts it.

The `next` parameter is validated against `^/[^/\\]` before redirecting. Without that
check, a crafted link could send someone to another origin the instant after they typed
their password.

---

## Extracted articles showed raw character references

`&#8220;` and `&#8221;` were appearing in the reader instead of quote marks.

**HTMLRewriter does not decode character references in text nodes.** Attribute values from
`getAttribute()` come back decoded; text chunks do not. So every article written with
typographic punctuation — which is most of them — arrived with the literal characters in
it, and the page title did too, because `meta.title` is accumulated from `<title>` text
chunks the same way.

`functions/_lib/extract/entities.js` decodes them. Three things about it worth knowing:

- **Decode first, collapse second.** The order is load-bearing: `&nbsp;` becomes a space
  the collapse can fold away. The other way round leaves a non-breaking space mid-sentence
  that survives every later cleanup, because it is not whitespace to anything that trims.
- **Text nodes only, never attributes.** Attributes are already decoded, and decoding
  twice is its own bug class — `&amp;lt;` means the literal text `&lt;`, and a second pass
  turns it into `<`. A test pins that.
- **Windows-1252 code points are translated.** `&#147;` is not a valid reference for a
  quote mark, but it is what a CMS writes when its editor pasted from Word. Left alone
  they render as invisible C1 controls, so the text looks like it simply lost its
  punctuation.

Unknown references are left exactly as they are: a page containing the literal `&foo;`
still contains it afterwards.

Existing books keep the raw entities — they were saved as text. Re-extract anything that
matters.

## Six icons were silently missing

`share-2`, `user`, `circle`, `globe`, `git-branch` and `file-plus` were being asked for by
the catalogue and the tab bar, and none existed in the icon set. `icon()` falls back to
`square`, so they rendered as blank boxes rather than erroring — invisible until someone
looked at a phone screenshot.

Added, and `_dev/tests/icons.test.mjs` now cross-checks every name the chrome hardcodes
and every name the database seeds against the set, so the next missing one fails a test
instead of shipping.

Tab labels also got a short form: "Compliance Maker" ellipsises to "Compliance Mak…" in a
fifth of a 375px screen. The header nav and the index keep the real title.

---

## It installs, and behaves like an app

`manifest.webmanifest`, `sw.js` and `assets/js/pwa.js`. Installed from the browser menu
(or the **Install** button that appears in the header on Chrome and Edge) it launches
without browser chrome, with its own icon and three shortcuts: convert a spec, the review
queue, the knowledge maps.

### What the service worker refuses to cache

This is the part that matters. An account-only site with one live session per account
cannot cache pages or API responses:

- a cached page renders for someone since signed out, or taken over on another device;
- a cached API response shows one account's data inside another's on a shared phone;
- **a cached response survives sign-out** — clearing a cookie does not clear the Cache API.

So the rule is narrow and absolute: **same-origin static assets only.** Nothing under
`/api/`, no HTML except `offline.html`, which deliberately contains nothing and loads no
script. Documents always hit the network. Sign-out posts `TN_SIGNED_OUT` to the worker,
which empties every cache. Eight checks in `_dev/tests/access-model.test.mjs` hold this
line, including one asserting the offline page holds nothing account-specific.

This is not an offline app. It starts instantly, survives a lift or a basement without
losing your place, and cannot leak one person's work to another.

`/manifest.webmanifest`, `/sw.js` and `/offline.html` had to be added to the middleware's
public list: the browser fetches the manifest and registers the worker from the sign-in
page, where there is no session, and gating them would have made the site simply never
installable.

### What changed on the phone

- **A bottom tab bar** under 640px, built from the same catalogue the header nav uses. A
  top nav that wraps to a second row costs vertical space on every screen and puts the
  targets where a thumb cannot reach. The header nav is hidden there — two navs on a 375px
  screen is one too many.
- **`viewport-fit=cover` plus safe-area insets**, so the page paints behind the notch
  without sliding under it.
- **`input { font-size: max(16px, 1rem) }`.** iOS zooms the whole page when a focused
  input is under 16px and never zooms back out. This is the fix.
- **`overscroll-behavior-y: none`** kills the rubber-band bounce that reveals the page
  background behind a fixed header — the clearest tell that something is a web page.
- **Tap highlight removed, focus rings kept.** The grey flash is a browser habit; the
  focus ring is an accessibility requirement.
- **44px minimum targets under `pointer: coarse`**, 56px on the tab bar. The Remove button
  on a book card got special attention: it sat close to the open link, and it deletes a
  book.
- **Text selection off in standalone mode**, with inputs, prose, code and action outcomes
  exempt. Accidentally selecting text while scrolling reads as broken in an app.

`_headers` sets `no-cache` on `/sw.js` — a broken worker that can pin itself in place via
the cache it manages is the one PWA failure that is genuinely hard to recover from.

### Full-screen modes had to learn about the tab bar

The reader's `is-reading` mode and the map's `kg-map-full` mode both predate the tab bar,
so both left it on screen — and both left the body padding that reserves its height, which
is a dead strip across the bottom of a page that just claimed the whole screen.

Both now hide the bar and release the padding. The `!important` on the padding override is
deliberate: `.has-tab-bar` sits on the same element, so specificity alone cannot settle it.
`_dev/tests/app-shell.test.mjs` asserts both halves of both fixes, because removing the
`!important` during a tidy-up would bring the strip back silently.

### The map on a phone

The controls panel was taller than the canvas at 400px, so the graph opened below the fold
and the first thing you did on every visit was scroll past the controls to find it.

- The panel folds to one row — view switch, search, **More**, **Full map**. Everything
  else moves behind More. Nothing is removed: a compact layout is not an amputated one,
  and every control is one tap away.
- Collapsing happens on phones only, and is undone when the phone is turned sideways —
  leaving the class on would hide half the controls the moment the width changes.
- The map's own title and description are hidden below 700px. They repeat what the card
  you tapped already said and cost a third of the screen before the graph.
- The canvas gets `calc(100dvh - 250px)` with a 320px floor. `dvh` rather than `vh` so a
  collapsing address bar does not clip the graph; the floor because a canvas shorter than
  the node sheet's handle makes dragging a node impossible.
- **Full map** is now reachable from the controls row. That mode already existed and was
  already tested — it simply had no obvious way in from a touch screen, which is exactly
  where a full-bleed canvas matters most.

### Books can be moved to a shelf after upload

`collection` could only be set during upload, so everything already in the library was
stuck under Unsorted for good.

`PATCH /api/education/book/<slug>` moves one. R2 has no way to edit an object's metadata
in place — the only way to change `customMetadata` is to write the object again — so this
reads the bytes back and re-puts them with one field changed. Three consequences worth
knowing:

- The operation costs as much as the file is large. That is why it is its own endpoint
  rather than folded into upload.
- The object is read **before** anything is decided, so a failed read cannot leave a book
  with half its metadata rewritten.
- Existing metadata is carried across with `Object.assign`, not rebuilt from the listing.
  Rebuilding would silently drop every field `listBooks` does not surface — `uploadedBy`
  and `uploadedAt` among them.

The picker offers the shelves already in use, numbered, plus free text for a new one.
Free-typing every time is how "Standards" becomes "standards" and then "Standard" across
three books, and the grouping then shows three shelves where there is one. An empty answer
files the book under Unsorted, which is how you take something off a shelf without
inventing an unfile verb; cancelling is distinguished from clearing.

### Outline is a working view now, not a table of contents

Clicking a row used to set the selection and throw you onto the canvas, leaving you to
find the node you had just been looking at — the opposite of why anyone opens a list view.

A row now opens the node sheet where you are. That sheet is the same editing surface the
canvas uses, so there is one thing to keep working rather than two, and Graph and Outline
become two ways of working on the same graph rather than a picture and an index of it.

- The open row is marked, so you keep your place when the sheet covers half the screen.
- Each row shows its count of open actions. A list you scan for what needs doing is worth
  little if it cannot show where the work is.
- A **Map** button on each row is the explicit way out to the canvas, and it centres the
  node rather than dropping you somewhere it might be off screen. Quiet until hover, and
  always visible on touch, where there is no hover.
- Closing the sheet refreshes the list it was opened from. Returning to a stale title or a
  stale count is the small wrongness that makes a list view feel untrustworthy.

### What it is not

iOS gives an installed PWA no push notifications worth relying on, and evicts storage from
sites that go unused for weeks. Nothing here depends on either. If you later want
notifications on iPhone, that is a native wrapper, not a setting.

---

## SBU — the project development map

A second map, `map_sbu`, seeded by `db/2026-09-sbu-map.sql`. The HVAC map answers "what is
this equipment and what governs it". This one answers "where is this enquiry, who owes me
something, and have we solved this before" — 50 nodes and 62 edges across eight lanes:
Pipeline, Stakeholders, Engineers, Factories & markets, Technical scope, Capabilities,
Automation, Metrics & risks.

Nine new kinds, with a tight edge matrix. A risk may *block* a process; a factory may not
*mitigate* a metric. Every seeded edge passed the legality trigger, which is a real check
on whether the model holds together rather than a formality.

**Everything seeds as draft.** It was written from a role description, not from the
record. The approved tier only means something if somebody looked.

### Actions: what is owed, and what was done

A graph holds what is true. It has no way to hold "chase Jebel Ali for the acoustic
selection by Thursday", and no way to hold what happened when you did. `status` could not
carry that without breaking the one meaning it has — whether Compliance Maker may quote a
node — so actions are their own table.

The field that earns the table is `outcome`. **An action cannot be closed as `done`
without one**, enforced both in the API and by a CHECK on the table. An open action is a
reminder and expires; a closed one with an outcome is a precedent — what was asked, who
answered, how long, what it cost — and that is the part normally lost in a mail thread.
`dropped` is exempt: "we decided not to" is a complete outcome.

Deleting a **closed** action needs reviewer rights rather than contributor. The record of
what was done is the asset; dropping it with a reason keeps it, deleting destroys it.

### Engineers are nodes, not strings

`owner` was free text, which is enough to write "the UAE team" and useless for "what is on
one engineer's plate". To a string comparison, "Ahmed", "ahmed" and "A. Hassan" are three
people.

`db/2026-09-people.sql` makes a person a node with the same aliases, edges and review
discipline as anything else. Actions carry `assignee_id`, validated to be a `person` node
**on that map** — pointing an action at a factory would make `knowledge_person_load`
quietly wrong, and a workload view that is quietly wrong is worse than none. The free-text
`owner` survives for genuinely external parties you will never model.

Opening an Engineer's Actions tab shows everything assigned to them wherever it sits, not
what is filed against the person node — an engineer's work hangs off the processes and
projects they touch, never off themselves.

**No engineers are seeded.** Inventing names would put people who do not exist into a
graph you are meant to trust, and a placeholder called "Engineer — UAE" is a row somebody
eventually treats as real. Add them from the palette and connect them to a market with
`covers`. Nine MEA markets are seeded to connect them to.

### A bug the tests caught

The SBU seed began as DELETE-then-INSERT, the obvious way to make a seed re-runnable. It
was quietly destructive: by the time you re-run it, the map also holds the engineers you
added, the markets from the people migration, and every action hanging off them — and all
of it went.

It is `INSERT OR IGNORE` throughout now, so a second run adds what is missing and touches
nothing else. Three tests pin it. The cost: editing the seed text no longer updates a row
that already exists. Delete that row first, or edit it in the map, which is where it
should be edited anyway.

---

## The AI judges which gaps are worth a node

`proposeFromGap()` now runs after any answer that came back **TO VERIFY** with unrecognised
terms. A model is asked one narrow question — is this a reusable engineering subject, or
something specific to this job — and answers in JSON.

Everything it returns is treated as untrusted:

- the kind must exist in `knowledge_kinds`, or the node becomes a `note`;
- the title must not already resolve through `knowledge_aliases`, and must not already be
  sitting in the queue;
- a title that is only digits is refused, because that is a quantity wearing a name;
- **no numbers are accepted from the model at all.** A proposal carries the clause verbatim
  and nothing else. A fabricated value in the queue is one click from being approved.

It runs in `waitUntil`, after the engineer already has their reply, and returns `null` on
any failure. A judgment that cannot be made is a judgment of no: failing to propose costs a
queue entry, failing the answer costs someone their work.

`/api/knowledge/propose` and the automatic path now share one writer
(`proposeNode` in `functions/_lib/gap-proposer.js`), so the two cannot drift on what a
proposal is allowed to be.

---

## Conflicting approved values are flagged, never resolved

Two approved values for one parameter is usually two real jobs specified differently, and
the engineer is the only one who knows which applies. Picking the higher-ranked one and
saying nothing was the failure worth avoiding — the answer looked exactly as confident as
an uncontested one.

`detectConflicts()` groups facts by node, parameter and scope tier, and reports any tier
holding more than one distinct value. Three things it deliberately does not call a
conflict: the same value recorded twice from two documents, the same value with different
unit casing, and a project value differing from a general one — that last is precedence
working as designed.

A conflict appears in three places: a `CONFLICTING APPROVED VALUES` block in the prompt
instructing the model to give both values and pick neither, a `conflicts` array on the
response for the UI, and **a forced downgrade to TO VERIFY in code**. The downgrade is not
left to the prompt: an instruction is a request, and the whole point of flagging a conflict
is that the reader cannot miss it.

---

## Two tools come back, as Education tools

Text Cleaner and Web Text Extractor left in the refocus as general office
utilities bound for QuickTools. They return in a different role: both produce the text a
book is made of, and both now write straight to the library instead of making someone
paste the result into the uploader — which was the step that made people not bother.

They sit under Education (`sec_edu_tools`), not in a Tools section. There is no Tools
section, and filing them elsewhere would say they are general utilities that happen to
have a save button, which is backwards.

`functions/api/extract/` and `functions/_lib/extract/` are restored, since the extractor
cannot work without them.

### One save flow, not two

The extractor had a good 130-line save-to-library flow. Rather than copy it into the
cleaner, it now lives in `assets/js/save-to-book.js` and both call it. The slug rules, the
Latin-1 header encoding, the parse-before-upload check and the replace warning are each
wrong in a different subtle way once a second copy drifts from the first.

Both reveal the save button only for an admin, matching what the API enforces, so neither
page offers an action that would be refused.

### reflow.js was missing from the repo

`tools/text-cleaner/textcleaner.js` opens with:

```js
var reflow = (window.TN && window.TN.reflow) || null;
if (!reflow) throw new Error('TN.reflow is required — check assets/js/reflow.js is loaded');
```

That guard is right — falling back to a local copy would hide the fault and ship a page
that half works — but `assets/js/reflow.js` was never committed. The Text Cleaner threw on
load for every visitor who opened it.

It is written and tested now (`_dev/tests/reflow.test.mjs`, 14 checks). The one thing to
know if you touch it: `joinLines` and `collapseWhitespace` are **not commutative**.
`joinLines` turns single newlines into spaces while keeping blank-line paragraph breaks;
collapsing whitespace first destroys those breaks and glues the document into one
paragraph. The cleaner's step order already runs them the right way round, and the test
pins it.

---

## The library groups

A shelf of six books needs no grouping; the screenshot showed enough to need it.

`/education/` now groups into collapsible `<details>` sections with a **Group by**
control: Shelf, Author, Format, Subject, or nothing. Built on `<details>` so the
open/closed state is the browser's job and the keyboard works with no script at all. Which
groups are open is remembered per grouping key, so collapsing eleven NCERT shelves once
does not have to be repeated every visit.

**Shelf is a new field.** `collection` is free text, set when a book is saved, carried
through `X-Book-Collection` into R2 metadata and back out of `listBooks`. Both tools offer
a datalist of the shelves already in use, so "Standards" does not drift into "standards"
and then "Standard" across three uploads. Books uploaded before the field existed group
under **Unsorted** — a real state, not a missing one to paper over.

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
| `db/2026-09-education-tools.sql` | Registers the two tools under Education |
| `assets/js/reflow.js` | The missing module the Text Cleaner requires |
| `assets/js/save-to-book.js` | One save-to-library flow, shared by both tools |
| `_dev/tests/reflow.test.mjs` | 14 checks on the reflow module |
| `functions/_lib/gap-proposer.js` | AI judgment, and the one proposal writer |
| `_dev/tests/gap-proposer.test.mjs` | 14 checks on the judgment gate |
| `db/2026-09-actions.sql` | Actions and history, with their views |
| `db/2026-09-sbu-map.sql` | The SBU map: kinds, edge rules, lanes, seed |
| `db/2026-09-people.sql` | Engineers as nodes; assignable actions; workload view |
| `functions/api/knowledge/actions.js` | Actions API, including the people roll-up |
| `tools/knowledge/domain-sbu.js` | Presentation pack for the SBU map |
| `docs/role-executive-summary.md` | Executive summary of the role |
| `db/add-columns.sh`, `db/add-columns.ps1` | Every ALTER, one call each |
| `_dev/tests/migrations.test.mjs` | 34 checks that no migration hides an ALTER |
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
| `login/index.html` | Landing layout; no chrome; takeover notice; `next` validated |
| `signup/index.html` | Matching landing layout; no chrome |
| `assets/css/global.css` | `.auth-landing` and `.auth-bar` |
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

**The map is unchanged at scale.** It gets dense around thirty nodes and will get worse.
Collapsing lanes, filtering by kind and status, and saved views are all plausible; which
one matters depends on how it actually fails in use, so it waits for that.

**Watch the queue's first week.** The judgment prompt is tuned conservatively, but
"reusable engineering subject" is a line a model draws imperfectly. If the queue fills with
noise, tighten `JUDGE_PROMPT`; if real gaps are being dropped, loosen it. The `body` of
every auto-proposed node records the clause and the model's stated reason, so the rejects
tell you which way to move.
