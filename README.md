# Thinkneering — v2

Two access layers on one site:

- **Free layer** — no account. Anything marked `public`.
- **Full layer** — signed in. `auth` content, plus `restricted` content that the
  person's plan or an admin grant opens.

Sections, subsections, tools and books all live in D1. Adding one is a row in the
database, not a new HTML file.

## Deploy

1. `wrangler.toml` already points at `thinkneering-db`.
2. `wrangler d1 execute thinkneering-db --file=db/schema.sql --remote`
3. Push to GitHub; Cloudflare Pages builds with no build command.
4. Sign up on the live site, then promote yourself:
   `wrangler d1 execute thinkneering-db --remote --command "UPDATE users SET role='admin', plan='pro' WHERE email='you@example.com'"`
5. Open `/admin/`.

## Layout

```
assets/css/global.css     design tokens + every shared component
assets/js/global.js       header, footer, session, cards, icons
assets/js/blocks.js       book block renderer (shared by reader and editor)
assets/js/markdown.js     markdown <-> blocks, the writing surface
assets/js/admin.js        admin portal
functions/_lib.js         auth, hashing, access rules
functions/api/…           catalog, auth, content, admin
section.html              every section and subsection (served at /s/…)
reader.html               every book (served at /read/…)
_redirects                maps /s/* and /read/* onto those two files
tools/<name>/index.html   real tool code
db/schema.sql             schema + seed
db/compliance.sql         Compliance Maker tables, additive (safe on a live db)
```

## Compliance Maker

The flagship tool, at `/tools/compliance-maker/`. Its section, `/s/compliance-maker`,
is catalogue data like any other. Three tiers, resolved once on load from
`GET /api/compliance/access`:

| | guest (signed out) | member (signed in) | pro (+ `ai-review` access) |
|---|---|---|---|
| Convert, highlight, preview, Excel download | yes | yes | yes |
| Pages per spec (pasted text: 3,000 chars = 1 page) | 10 | 50 | 50 |
| Product + Factory step | hidden | required | required |
| Library pre-fill, conflict checks, answer log | no | yes | yes |
| Selection datasheet, AI clause review | no | no | yes |

Guests make **no network calls at all** — conversion is pure browser. Nothing
pre-fills Compliance or Remarks for them either, including the local
By Contractor scope rule: a filled cell in library yellow is a claim the free
tier does not make.

Who gets AI is not a private column: it is the `ai-review` item in the section,
so it follows the normal access rules and is granted in `/admin/` by plan or by
a per-user grant. The AI button also stays disabled until a selection datasheet
is uploaded, and `/api/compliance/ai-suggest` refuses the request without one —
the datasheet is authorized source #1, not a nice-to-have.

Server code lives in `functions/_compliance.js` (auth adapter, product/factory
map, answer-log table names) and `functions/api/compliance/*`. The library
workbooks in `data/compliance-library/` are login-gated by a Function;
`data/rules/highlight-rules.xlsx` is deliberately public, because it drives the
free conversion.

### What the AI knows

Nothing about a product or a factory is written in code. Two D1 tables hold it,
and both ship **empty** — with nothing on file the prompt says so and the model
works from the selection datasheet and past verified answers alone. An empty
knowledge base makes it more cautious, not more inventive.

- `compliance_facts` — the reference data a clause gets checked against
  (panel construction, filter class, fan type…). Retrieved per batch and scored
  against the clauses actually being answered, so a casing clause doesn't drag
  the filter facts along with it. Only `trusted` rows reach a prompt.
- `compliance_sections` — what a section *is*, keyed on the hierarchy path the
  parser already builds (`PART 2 PRODUCTS > 2.02 CASING`). Exact match first,
  then the longest stored path that is a prefix, so a brand new subsection
  inherits what is known about its parent.

Both are managed in **/admin/ → Compliance**. Section profiles are rebuilt from
the answer log with **Rebuild sections**, and **Write missing summaries** has the
model describe each section from its own clauses. An admin edit locks a summary
so a later rebuild cannot overwrite it.

**The rollup excludes AI-sourced rows.** Learning from unconfirmed AI output is
how a tool like this drifts steadily wrong while looking more and more
confident, so only library- and rule-sourced answers feed it. That is also why
answers now carry their `path` into the answer log — without it a logged answer
has no idea which part of the specification it came from.

Retrieval is token overlap, not embeddings: crude, but honest about being crude,
and swappable for `@cf/baai/bge-base-en-v1.5` later without changing a caller.

### Teaching it (the re-upload loop)

Accounts granted the **`training`** item get a "Teach the AI" panel: upload a
matrix the team has finished and checked, and every row is compared with what
the AI proposed for that clause.

- **accepted** — shipped unchanged; the AI was right
- **corrected** — shipped differently; the human answer wins permanently
- **new** — no suggestion on file; a clause the AI never saw

Every confirmed row lands in the answer log with `source='confirmed'`, so it
immediately drives library pre-fill, the conflict check and the section rollup
for **all** signed-in users. One person's correction becomes everyone's
starting answer, which is exactly why `training` is a **separate grant** from
`ai-review`: running AI on your own work and rewriting what everyone else sees
are different levels of trust.

This is what `compliance_suggestions` is for. The exported matrix only carries
the final text, so without recording each suggestion when it is made, a
correction is indistinguishable from an answer nobody touched.

/admin/ → Compliance shows the running tally and the last 40 corrections. A
clause corrected again and again usually means a missing or wrong fact.

### When the model returns nothing

An 8B model under a JSON grammar will sometimes satisfy the schema with an
empty array. That is not a refusal — it is the model running out of room while
the grammar still forces well-formed output, and it gets likelier the longer
the prompt is. So `ai-suggest` treats it as retryable: full prompt, then a
stripped prompt with the same clauses, then one clause at a time. `minItems`
in the schema makes the empty array invalid outright. The response reports
`passes` so you can see which one landed.

Set up: run `db/compliance.sql` once, and add a Workers AI binding named `AI`
to the Pages project for the AI features. Everything else works without it.
`docs/compliance-maker/` holds the engine prompts — documentation, not
deployed code.

## Writing

Books are written in `/admin/` → Books → open a book → **Write** on a chapter.

Two surfaces on the same chapter, toggled by the segmented control:

- **Write** — markdown in one textarea, reader preview beside it. Autosaves four
  seconds after you stop typing; Ctrl/Cmd+S saves now.
- **Blocks** — the structured editor, for tables and charts.

Switching carries the work across in either direction. The markdown you type is
stored in `chapters.source_md` and the parsed blocks in `blocks`, so opening the
editor shows your keystrokes, not text regenerated from storage.

Syntax: `##` heading, `>` quote (`> — name` becomes the citation), `-` / `1.`
list, `---` divider, `*italic*`, `**bold**`, `` `code` ``,
`![alt](url "caption")`, pipe tables (a `Table: caption` line above becomes the
caption), ```` ```chart ```` with JSON, and `:::warning Title … :::` callouts.

Bulk import is still possible — see `db/humonks.sql` — but it is for content
that already exists elsewhere, not for day-to-day writing.

## Access rules (server-side, in `functions/_lib.js`)

`public < auth < restricted`. A child never gets looser than its parent: a
`restricted` section keeps its `public` items locked. `restricted` opens when the
user's plan reaches `required_plan`, or when an admin grants that exact section,
item or book to that person. Admins pass everything.

Client code only *labels* the lock. The server decides.
