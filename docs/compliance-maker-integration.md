# Wiring the knowledge graph into Compliance Maker

The goal is to retire the knowledge-tree spreadsheet without a big-bang cutover. This is the
staged path, and the order matters.

---

## The one thing to understand first

Compliance Maker currently answers a spec clause from a spreadsheet lookup plus AI. The graph
replaces the *lookup*, not the AI. The AI still writes the answer — it just gets fed approved
facts with provenance instead of a row from a sheet nobody has audited in two years.

```
Spec clause
   │
   ├─► POST /api/knowledge/search  ──► approved nodes + attributes + provenance
   │                                    (deterministic, no model, no guessing)
   │
   └─► existing AI answer step, now with those facts in the prompt
          │
          └─► POST /api/knowledge/usage  ──► 'used' | 'corrected' | 'unanswered'
```

That last arrow is what makes this different from a spreadsheet. Every clause the graph cannot
answer gets written down, and shows up in the admin console under **Gaps** as the list of what
to write next.

---

## Stage 1 — run it in shadow mode (do this first)

Do not change a single answer yet. Call the search endpoint alongside the existing lookup, log
both, change nothing.

In `functions/api/compliance-maker/ai.js`, before the model call:

```js
// Shadow mode: retrieve but do not use. Compare against the spreadsheet.
let knowledge = null;
try {
  const res = await fetch(new URL('/api/knowledge/search', request.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Forward the session so the endpoint sees the same user
      'Cookie': request.headers.get('Cookie') || ''
    },
    body: JSON.stringify({ query: clauseText, domain: 'hvac', limit: 6 })
  });
  if (res.ok) knowledge = await res.json();
} catch (err) {
  knowledge = null;   // never let retrieval break an answer
}

// Log the gap even in shadow mode — this is the whole point of stage 1
if (knowledge && !knowledge.matches.length) {
  context.waitUntil(reportUsage(request, { outcome: 'unanswered', context: clauseText }));
}
```

Run this for a few weeks of real submittals. When the Gaps list stops growing quickly, the graph
has enough coverage to be worth trusting.

**Do not skip this stage.** It is how you find out what the spreadsheet actually contains that
the graph does not.

---

## Stage 2 — feed the facts into the prompt

Once coverage looks reasonable, put the retrieved nodes in front of the model:

```js
function knowledgeBlock(knowledge) {
  if (!knowledge || !knowledge.matches.length) {
    return 'APPROVED KNOWLEDGE: none found for this clause. ' +
           'Answer TO VERIFY for anything that needs a specific value.';
  }

  return 'APPROVED KNOWLEDGE (from the organisation knowledge base — these facts have been ' +
         'reviewed and approved by an engineer, use them in preference to anything else):\n' +
    knowledge.matches.map(m => {
      const lines = ['- ' + m.title + ' [' + m.kind + ']'];
      if (m.summary) lines.push('  ' + m.summary);
      m.attributes.forEach(a => {
        lines.push('  ' + a.name + ': ' + (a.value || 'TO VERIFY') +
                   (a.unit ? ' ' + a.unit : '') +
                   (a.basis ? '  (basis: ' + a.basis + ')' : ''));
      });
      if (m.standards.length) lines.push('  standards: ' + m.standards.join(', '));
      m.related.slice(0, 4).forEach(r => {
        lines.push('  ' + r.relation + ' ' + r.title);
      });
      return lines.join('\n');
    }).join('\n');
}
```

Then add one line to the Compliance Maker system prompt:

> Where the APPROVED KNOWLEDGE block contains a fact, use it exactly. Where it does not, answer
> TO VERIFY rather than filling the gap from general knowledge. Never contradict the approved
> knowledge.

That rule is doing real work. Without it the model will happily blend an approved casing class
with a half-remembered one from training data, and you will not be able to tell which is which.

---

## Stage 3 — close the loop

Two calls, both cheap, both essential.

**When a node feeds an answer:**

```js
await fetch('/api/knowledge/usage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
  body: JSON.stringify({
    consumer: 'compliance-maker',
    outcome: 'used',
    nodeId: match.nodeId,
    context: clauseText
  })
});
```

**When the engineer edits that answer before submitting** — this is the valuable one:

```js
await fetch('/api/knowledge/usage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
  body: JSON.stringify({
    consumer: 'compliance-maker',
    outcome: 'corrected',
    nodeId: match.nodeId,
    context: clauseText,
    correction: editedAnswer
  })
});
```

A node with a high correction rate is worse than a missing node. It is confidently wrong and it
is quietly shaping every answer that touches it. The admin console surfaces these under
**Nodes that keep getting corrected**.

---

## Stage 4 — retire the spreadsheet, one product line at a time

Pick one product line. AHU is the obvious first, because the EN 1886 casing classes are the most
repeated matrix lines you have. Sequence:

1. Write and approve the AHU nodes properly — aliases, attributes with a basis for each.
2. Switch AHU clauses to graph-first, spreadsheet as fallback.
3. Watch the correction rate for a month.
4. When it is low, drop the AHU rows from the spreadsheet.
5. Repeat for FCU, then chillers.

Do not cut over everything at once. The spreadsheet is wrong in places you have not found yet,
and so is the graph. Running both against real submittals is what tells you which is which.

---

## The retrieval contract in full

```
POST /api/knowledge/search
{
  "query":  "AHU casing shall achieve mechanical strength class D1 to EN 1886",
  "domain": "hvac",              // optional
  "kinds":  ["equipment"],       // optional
  "limit":  8                    // default 8, max 25
}
```

```json
{
  "ok": true,
  "matches": [
    {
      "nodeId": "n-...", "mapId": "map-...", "mapTitle": "HVAC Knowledge Base",
      "kind": "equipment", "title": "Air handling unit (AHU)",
      "summary": "A packaged assembly of sections...",
      "attributes": [
        { "name": "Casing mechanical strength class", "value": "...", "basis": "EN 1886 D class" }
      ],
      "standards": ["EN 1886", "Eurovent"],
      "related": [{ "relation": "contains", "direction": "out", "title": "Cooling coil" }],
      "confidence": 82, "score": 8.5,
      "matchedTerms": ["ahu", "casing", "en 1886"],
      "approvedAt": "2026-08-07T...", "approvedBy": "niyaz"
    }
  ],
  "unmatchedTerms": ["mechanical strength class"]
}
```

**`unmatchedTerms` is not an error.** It is the most useful field in the response. Log it.

---

## How matching actually works

No embeddings, no vector database. The query is tokenised into words and two/three-word phrases,
matched against `knowledge_terms`, and scored by weight:

| Source | Weight | Why |
|---|---|---|
| Node title | 3.0 | A direct name match is the strongest signal |
| Alias | 2.5 | "air handler" must score nearly as well as "AHU" |
| Standard | 2.0 | A clause citing EN 1886 should find the casing node |
| Attribute name | 1.5 | "face velocity" finds the coil |
| Tag | 1.0 | Broad grouping, weakest signal |

This is deliberate, and it is worth understanding the trade-off. Keyword matching cannot handle
a paraphrase the way embeddings can. What it can do is show you *exactly why* a node matched —
`matchedTerms` is right there in the response. When an answer is wrong you can trace it in one
step instead of shrugging at a similarity score. For compliance work, where you may have to
defend an answer to a consultant, that is the better trade.

If recall becomes the limiting factor later, Cloudflare Vectorize can sit alongside this rather
than replacing it: keyword hits first, vector hits to fill in, both scored together. Worth doing
when the Gaps list is full of clauses that clearly *should* have matched. Not before.

**The one thing that determines whether retrieval works: aliases.** A node with three good
aliases will answer clauses that a node with none will miss entirely. When writing nodes, spend
the effort there.

---

## Things that will bite

- **Only `approved` nodes are returned.** If search comes back empty on a map full of content,
  check the status column before anything else. That is almost always the answer.
- **Editing an approved node un-approves it** and pulls it out of the index immediately. This is
  intentional — approved knowledge cannot change underneath Compliance Maker without someone
  looking. It does mean a small typo fix needs re-approval.
- **Access is per map.** Compliance Maker calls the endpoint as the signed-in user, so that user
  needs access to the map, or the map needs `visibility = 'org'`. For a shared HVAC knowledge
  base, `org` is usually right.
- **Never let retrieval failure break an answer.** Wrap it in try/catch and carry on without the
  knowledge block. A degraded answer beats a 500.
