# Knowledge Graph platform — setup

Vanilla HTML/CSS/JS plus Cloudflare Pages Functions. No build step, no npm packages.

---

## 1. Files

| Path | What it is |
|---|---|
| `tools/knowledge/index.html` + `dashboard.js` | Dashboard: your maps, knowledge scores, AI review |
| `tools/knowledge/map.html` + `map.js` | The graph editor |
| `tools/knowledge/admin.html` + `admin.js` | Access grants, approval queue, gap list |
| `tools/knowledge/knowledge.css` | Shared styles, tokens only |
| `tools/knowledge/domain-hvac.js` | HVAC node kinds, relations, standards + seeded starter graph |
| `tools/knowledge/domain-business.js` | Business process pack (department swim lanes) |
| `functions/_lib/knowledge.js` | Shared helpers: access, term indexing, scoring |
| `functions/api/knowledge/maps.js` | Map CRUD and seed import |
| `functions/api/knowledge/graph.js` | Node/edge CRUD, approval, reindex |
| `functions/api/knowledge/search.js` | **The Compliance Maker bridge** |
| `functions/api/knowledge/ai.js` | Authoring assistance + review engine |
| `functions/api/knowledge/admin.js` | Admin console backend |
| `functions/api/knowledge/usage.js` | Downstream feedback loop |
| `migrations/2026-08-knowledge-graph.sql` | D1 schema |

`functions/_lib/` starts with an underscore, so Cloudflare Pages treats it as a module folder
rather than a route. Don't rename it.

---

## 2. Database

```bash
npx wrangler d1 execute thinkneering-db --remote --file=./migrations/2026-08-knowledge-graph.sql
```

**`Retry deployment` in the Cloudflare dashboard does not run SQL.** Every time. Verify:

```bash
npx wrangler d1 execute thinkneering-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'knowledge%';"
```

You should see eight tables.

### Why nodes are rows, not a JSON blob

The Process Map tool stores a whole map as JSON in one column, because a canvas is always read
and written whole and has no useful query surface. This is the opposite case: Compliance Maker
needs to find one fact across every map. So nodes and edges are rows, and `knowledge_terms` is a
derived index rebuilt on approval.

That index is the thing that replaces the spreadsheet. It is never hand-edited — writing to it
directly would break the guarantee that everything in it came from an approved node.

---

## 3. Bindings

Cloudflare dashboard → Pages project → Settings → Functions → Bindings. Both environments:

| Name | Type | Value |
|---|---|---|
| `AI` | Workers AI | — |
| `DB` | D1 | `thinkneering-db` |

No new secrets. Nothing calls an external API.

---

## 4. Access control

Two gates, deliberately.

**Gate one — can they reach the tool at all.** Your middleware at `functions/_middleware.js`
gates on the `groups` column. Add `knowledge` as a section key and protect `/tools/knowledge/*`
the same way you protect the other sections. New signups should *not* get it by default.

**Gate two — which maps, and what they can do there.** Rows in `knowledge_map_access`, granted
by an admin in the console. No row means no access, even for a signed-in user with the group.

| Role | Can |
|---|---|
| `viewer` | Read the map |
| `contributor` | Add and edit nodes; edits land as draft or proposed |
| `reviewer` | Everything above, plus approve and reject |
| `owner` | Everything, plus map settings |

Only an **admin** grants access. A map owner cannot add other people — that is an
organisation-level decision, not a per-map one.

Admin status is read from `user.is_admin` or an `admin` entry in `groups`, matching your existing
pattern. Set it the same way you always have, with direct D1 SQL.

Make yourself an admin, then bootstrap from the console.

---

## 5. First run

1. Open `/tools/knowledge/`
2. Create a map, choose **HVAC knowledge base (seeded)**. About 50 nodes import as **drafts**.
3. Open it. Everything has a dashed outline — that means not approved, and invisible to
   Compliance Maker.
4. Go through the nodes. The seed deliberately says `Per selection — verify against datasheet`
   wherever a value depends on the product. Fill those in from real datasheets, or leave them
   and approve the node for its structure and aliases alone.
5. Approve what is right. Watch the status line — it tells you how many search terms got indexed.
6. Test retrieval:

```bash
curl -s 'https://thinkneering.com/api/knowledge/search?q=AHU%20casing%20EN%201886%20D1' \
  -H 'Cookie: session=<your session cookie>' | head -c 2000
```

If that returns matches, Compliance Maker can be pointed at it. See
`docs/compliance-maker-integration.md`.

---

## 6. What makes a node useful

Most of the value is in two fields, and it is worth being blunt about which:

- **Aliases.** A node with no aliases will only ever be found by its exact title. Specifications
  say "air handler", "AHU", "air handling unit", "AHU-01" — all of them need to land on the same
  node. This is the single highest-leverage thing to spend time on.
- **Attributes with a `basis`.** The parameter *name* is the knowledge. The *value* is usually
  per-selection. What makes an attribute answer a compliance line is the basis — which standard
  or document establishes it. "Casing air leakage class / EN 1886 L class" is useful even with
  no value; "L1" with no basis is not.

A beautifully written `body` with no aliases and no attributes will never be retrieved. Prose is
for humans reading the map; aliases and attributes are what the machine can use.

---

## 7. New design tokens

`knowledge.css` declares five new base colours, with dark-mode variants:

```css
--color-orange:       #e07b1f;
--color-purple:       #7c5cff;
--color-success-dark: #15784f;
--color-plum:         #b0388a;
--color-slate:        #566072;
```

The first four are the same ones the Process Map tool proposes — declare them **once** in
`global.css` and delete them from both tool stylesheets. Everything else maps to existing tokens.

The dark-mode block uses `[data-theme="dark"]`. One selector to change if yours differs.

---

## 8. Register the tool

`assets/js/tools.js` isn't in the drop because I don't have your current copy. Add:

```js
{
  id: 'knowledge',
  name: 'Knowledge Repository',
  href: '/tools/knowledge/',
  description: 'Capture engineering and business knowledge as a connected graph. Approved knowledge feeds Compliance Maker.',
  category: 'Knowledge',
  section: 'knowledge'
}
```

---

## 9. What is built, and what is not

**Built and working:** dashboard, graph editor with lanes and typed relationships, node
inspector with structured attributes, draft → proposed → approved workflow with version history,
deterministic knowledge score, AI authoring assistance and map review, admin console with access
grants and bulk approval, the retrieval endpoint, the usage feedback loop, and two seeded domain
packs.

**Not built, and why:**

- **Attachments — images, drawings, documents on a node.** Needs R2 plus an upload endpoint plus
  a virus-scanning decision. Real work, and it should be its own conversation. The schema has
  room for it; the UI does not yet.
- **Merging duplicate nodes.** The AI can *find* duplicates; merging them means deciding what
  happens to edges, revisions and the term index on both sides. Getting that wrong silently
  corrupts the graph, so I have not guessed at it.
- **Promoting a question into a node.** The questions are captured and shown in the console. The
  one-click promotion is a small addition once you have seen what real questions look like.
- **Vector search.** Covered in the integration doc — worth adding when the gap list shows
  clauses that clearly should have matched, and not before.
- **The central cross-map knowledge network.** Right now retrieval already spans every map the
  caller can see, which is most of the practical benefit. A genuine merged graph with cross-map
  concept resolution needs the duplicate-merge problem solved first.

One honest caution on scope: the brief describes an enterprise knowledge operating system. What
is here is a solid foundation for one — the schema, the trust boundary and the retrieval contract
are the parts that are expensive to change later, and those are done properly. The collaboration
surface is thinner than the brief asks for. That is the right order to build it in, but it is
worth naming rather than letting the file count imply otherwise.
