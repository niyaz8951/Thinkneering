# Knowledge imports

CSV files for **Knowledge → Admin → Import CSV**. Everything lands as
**draft**; you approve one at a time in the queue, as always. An import
never deletes and never approves.

| File | Map | Table | Rows |
|---|---|---|---|
| `dictionary-ncert-words.csv` | Dictionary (English) | Nodes | 186 words, phrases and idioms |
| `hvac-gulf-nodes.csv` | your HVAC knowledge base map | Nodes | 109 |
| `hvac-gulf-edges.csv` | same map — import **after** the nodes | Edges | 211 |

If you already imported before this version: the nodes were placed at
0,0 (one point in the corner of the canvas) — open the map on the
Graph tab and press **Tidy by lane** once; it now saves every position,
approved nodes included. Future imports land in their lanes directly.

Order for the HVAC map: run `db/2026-09-outline.sql` first (the outline
`under` relation must be legal), then nodes, preview, apply; then edges,
preview, apply.

## Dictionary — NCERT English readers

Non-regular vocabulary from the eight NCERT readers on the site (Beehive,
Moments, First Flight, Footprints Without Feet, Hornbill, Snapshots,
Flamingo, Vistas), one node per headword in dictionary case, filed by
part of speech into Nouns / Verbs / Adjectives & adverbs / Phrases &
idioms. Each carries the inflected forms as aliases (so "fumbled" finds
Fumble), Hindi, Urdu and Roman Urdu, a sentence from the chapter, and
the chapter as `source_ref`.

**Read this before approving:** the NCERT epub is not in the repository
(only `books/library.json` is), so this list was written from knowledge
of the readers, not by reading your copy. It is a first pass of the
words most readers stop on, not every hard word in 1,000 pages. The
Hindi and Urdu are drafts for the reviewer — the review console lets
you correct them before approval, and every correction now teaches the
model. Once approved, a reader who taps any of these in the Library gets
the graph answer instantly (Tier 2), with no model call.

Regenerate after editing `ncert-words.txt`: `node _dev/build-imports.mjs`.

## HVAC — AHU, FCU and air-cooled chillers for UAE and KSA

Three products, each a top-level outline line with its components,
parameters, governing standards and the Daikin / York (JCI) / Systemair
ranges filed under it; then two market lines (UAE, KSA) with what changes
in each. Edges use `under` for the outline, plus `contains`,
`has_parameter`, `governed_by` and `connected_to` where the typed rules
allow — every edge in the file has been checked against
`knowledge_edge_rules`.

**Read this before approving:** the catalogue facts (ranges, sizes,
refrigerants, certifications) were written from the manufacturers'
public pages and general Gulf specification practice as of 2025–26, not
from the current PDF catalogues, which are behind manufacturer portals.
Every range node says so in its `source_ref`. Check model names, size
limits and Eurovent listing against the current edition before you
approve a range node — an approved node is what Compliance Maker will
quote to a consultant. Standards and market notes are stable and can be
approved with a lighter read.
