# Mind map rework — setup

Unzip over the repo root. No build step, no new dependencies.

---

## Files

**New**

| Path | What it is |
|---|---|
| `db/2026-10-mindmap.sql` | Adds `notes`, `ai_open`, `ai_note`, `ai_note_at` to nodes |
| `db/2026-10-dictionary-english.sql` | Repairs the Dictionary maps you already have |
| `tools/knowledge/domain-english.js` | The English word map pack — 31 seeded nodes |

**Changed**

| Path | Why |
|---|---|
| `tools/knowledge/map.html` | Node sheet, focus bar, full-screen button, add button |
| `tools/knowledge/map.js` | Focus mode, tap handling, notes editor, AI lock |
| `tools/knowledge/knowledge.css` | Styles for all of the above (appended, nothing removed) |
| `tools/knowledge/index.html` | English seed option, Apply button on the review dialog |
| `tools/knowledge/dashboard.js` | English pack, align-review with dry run |
| `functions/_lib/knowledge.js` | Exposes the new columns on the node payload |
| `functions/_lib/dictionary.js` | Dictionary maps are English word maps now |
| `functions/api/knowledge/graph.js` | `notesOnly` save path |
| `functions/api/knowledge/ai.js` | `review_and_align` action + `applyAlignment` |

---

## Deploy

Two migrations, **in this order**. `Retry deployment` in Cloudflare runs no SQL:

```bash
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-10-mindmap.sql
npx wrangler d1 execute thinkneering-db --remote --file=./db/2026-10-dictionary-english.sql
```

The first reports `duplicate column name` if run twice. That is harmless and means it is already
applied. The second is idempotent.

Then push and let Pages build. `knowledge.css` is referenced as `?v=2` and `map.js` as `?v=2`, so
the cache busts on its own.

Check it took:

```bash
npx wrangler d1 execute thinkneering-db --remote \
  --command="SELECT slug, domain, substr(lanes,1,60) FROM knowledge_maps WHERE slug LIKE 'dictionary-%';"
```

You want `domain = english` and a lanes array starting `[{"id":"wordparts"...`.

---

## The four problems, and what changed

### 1. Unusable on a phone, no full screen

Three things were wrong: a 380px inspector rail on a 390px screen, a fixed 440px canvas, and an
add-palette of small chips.

- **Full screen** — the button top-right of the canvas. It is a CSS class, not the Fullscreen API,
  because iOS Safari will not fullscreen a `div` and the phone is exactly the case that matters.
  Header, controls, palette and footer all hide; the canvas takes the viewport with safe-area
  insets respected.
- **The sheet** — the old right-hand inspector is now a sheet. Docked rail above 1040px, full
  cover below it. Same markup and the same field ids either way, so there is one editing surface
  to keep working rather than two that drift apart.
- **The + button** — a 56px circle bottom-left of the canvas, opening a grid of tappable kind
  cards with their descriptions. The palette row hides below 700px.
- Canvas height is `62dvh` on a phone rather than a fixed pixel count, so it uses the screen it
  is actually on.

### 1b. Touch gestures on the canvas

The canvas sets `touch-action: none`, which is what makes one-finger dragging
work at all — but it also switches off the browser's own pinch zoom, so the
gesture has to be implemented rather than inherited. That is why the map could
be dragged but not zoomed.

- **One finger** — drag a node, or pan the canvas. Unchanged.
- **Two fingers** — pinch to zoom *and* pan at the same time. The scene point
  under the midpoint of the two fingers stays under it, whether they spread
  apart or slide across, so two-finger panning comes free from the same maths.
- Zoom clamps to the same 0.12–2.5 range as the wheel and the buttons, so
  touch and mouse cannot end up in different states.

Three details that are easy to get wrong and are handled explicitly:

- **A pinch must not end in a tap.** Fingers lift one at a time, and without a
  suppression flag the last one to leave would register as a tap on whatever
  was underneath — spotlighting a random node every time you zoomed.
- **A node half-dragged into a pinch stays where it is.** The drag is abandoned
  when the second finger lands rather than continuing to follow finger one.
- **A dropped `pointerup` cannot jam the map.** Mobile browsers occasionally
  lose one — a system gesture takes over, or the app is backgrounded
  mid-pinch. A ghost pointer that never cleared would make every later single
  touch look like a pinch. Two defences: a `window`-level backstop so releases
  outside the canvas still deregister, and eviction of any pointer not heard
  from in five seconds. Worst case one gesture is swallowed and the next works.

Mouse and trackpad are untouched — wheel still zooms.

### 2 & 3. The dictionary was a blank HVAC map

The cause was one line in `map.js`:

```js
pack = mapInfo.domain === 'business' ? window.TN_KG_BUSINESS : window.TN_KG_HVAC;
```

Everything that was not `business` fell back to HVAC, and `ensureDictionaryMap` created dictionary
maps with `domain: 'general'` and no lanes at all. Hence *Equipment* and *Flow / medium* offered
for the word "judgment", in a map with no columns.

`domain-english.js` is now a first-class pack:

- **Lanes** — Word parts · Nouns · Verbs · Adjectives & adverbs · Phrases & idioms · Grammar &
  usage · Easily confused
- **Kinds** — word, sense, root, prefix, suffix, phrase, idiom, grammar, confusable, example,
  memory hook, topic, note
- **Relations** — `built_from`, `synonym_of`, `antonym_of`, `confused_with`, `collocates`,
  `stronger_than`, `governed_by`
- **Seed** — 31 nodes, weighted deliberately towards Word parts. Ten Latin/Greek roots
  (`spec-`, `dict-`, `ject-`, `port-`, `scrib-`, `graph-`, `log-`, `tract-`, `mit-`, `vid-`),
  six prefixes, five suffixes, then a few worked example words showing the connections, three
  confusable pairs and two grammar rules.

The weighting is the point. One root node connects to dozens of words a reader will meet later,
so the map starts useful rather than starting empty. A vocabulary list would not do that.

New dictionary maps get this automatically. The migration converts existing ones, moving words
out of the old `lane = 'Dictionary'` (which was not a lane id in any pack, so they rendered
unassigned) into Nouns, and retyping `term` nodes as `word`.

**One thing to know:** lane ids are duplicated in three places — the pack, `functions/_lib/dictionary.js`,
and the migration. Pages Functions cannot import a browser global, so this is unavoidable. If you
add a lane, add it in all three or seeded words land in a lane the editor cannot name. I checked
all three agree in this drop.

### 4. Click behaviour

- **Single tap** — spotlights. The node and anything directly connected stay lit; everything else
  drops to 7% opacity and stops taking pointer events. A bar appears naming the focused node with
  **Open** and **Show all**. Tapping the focused node again, or empty canvas, releases it.
  Neighbours are kept rather than hiding everything, because a node with no visible context is
  not much use either.
- **Double tap** — opens the sheet.
- Tap and drag are separated by a 4px threshold, so thumb wobble does not misfire. Double tap is
  detected in `pointerup` rather than with a `dblclick` listener, because touch browsers do not
  fire `dblclick` reliably.
- Keyboard: `Enter` opens, `N` opens straight to Notes, `F` focuses, `Escape` clears, arrows nudge.

---

## 5. Notes and reading mode

From the old mindmap, kept close to what you had: a contenteditable editor with bold/italic/
underline, H2/H3, lists, quote, code, highlight, clear formatting, and a word count.

**Reading mode** hides the toolbar, drops the border, widens the line height and caps the measure
at 68ch — the state to be in on a phone on a train.

Two deliberate decisions:

- **Notes are a separate column from `body`.** Editing `body` un-approves a node and pulls it out
  of the retrieval index. If notes shared that column, jotting a line on the train would silently
  break a Compliance Maker answer. They save through a `notesOnly` path that touches neither
  version nor approval status.
- **Paste is forced to plain text.** Pasting a styled block from a web page otherwise drags its
  whole stylesheet in and the note stops looking like the site.

Autosave fires 1.2s after you stop typing, and on blur and on close.

---

## 6. AI review that aligns, and the per-node switch

**On each node**, an AI tab with a switch: *Let AI update this node*. Off means map review reads
it for context but changes nothing about it. Existing approved nodes default to **off** — already
reviewed by a human means settled. New and draft nodes default to on.

**From the dashboard**, *AI review* now runs `review_and_align`, which returns lane assignments,
nodes in the wrong lane, missing connections, and a per-node opinion.

It runs as a **dry run first**. You see the counts — how many nodes would move, how many
connections would be added, how many notes written, how many suggestions were skipped because
their node is closed to AI — and then decide. Nothing is written until you press **Apply**.

The lock is enforced in `applyAlignment()` in `ai.js`, not in the prompt. A prompt instruction is
a request; a filter is a guarantee. Locked nodes are still shown to the model because it needs
them to reason about the rest of the map, but nothing it says about them is written anywhere.

New connections arrive as **draft**, never approved. An AI suggestion is not approved knowledge
and the graph must not start publishing a relationship nobody has looked at.

Per-node opinions land in `ai_note` and show in that node's AI tab. They are never merged into the
node's own fields.

**Lane changes are deliberately not auto-applied.** Renaming a lane rewrites the map's columns
for everyone with access, and that felt like more than an Apply button should do quietly. The
proposal shows in the dialog; use Lanes in the map editor if you want it.

---

## What I did not do

- **Attachments on a node.** Your point 7 mentioned uploading notes. Rich text is in; file and
  image upload is not — it needs R2, an upload endpoint and a size/type policy. Worth its own
  pass rather than a guess.
- **Cross-links between nodes from inside the notes panel.** The old mindmap had this. The graph
  already has typed edges doing that job through Connect, so adding a second, untyped linking
  mechanism seemed more likely to muddle the model than help.
- **Deleting the old dictionary lane label from any HVAC/business dictionary.** Those keep their
  own vocabulary and the migration leaves them alone on purpose.

## Worth testing first

The tap/drag/double-tap split is the change most likely to feel wrong in the hand rather than on
paper. The 4px threshold and 400ms window are my starting guesses, both single constants near the
top of the pointer handlers in `map.js`. If double-tap feels fussy on your phone, widen the window
to 500ms before changing anything else.

Pinch sensitivity is a straight ratio of finger distance with no smoothing, which is what most
map interfaces do and generally feels right. If it reads as twitchy on your device, damping it is
one line in `movePinch()` — interpolate towards the new `k` instead of assigning it.
