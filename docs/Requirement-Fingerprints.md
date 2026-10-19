# Requirement fingerprints and the capability matrix - plan

Owner's decision, 19 Oct 2026: move the compliance tool from "search for a similar sentence" to "identify the requirement, then compare it with what the factory offers", the way Shazam identifies a song from a few landmarks. The AI stays for reviewing and answering; code identifies and compares.

## 1. The idea in one paragraph

A clause is noise (wording, numbering, boilerplate) around a few landmarks: component, property, standard, class, value with unit, limit word. Pairs of landmarks form fingerprints; fingerprints name a **requirement type** (`casing.air_leakage_class`) and the clause's **level** (L2, 50 mm, 2.5 m/s). The factory's **capability** for that type (L1(M), certified, source: Eurovent certificate) is stored once. The answer is a comparison, not a lookup. A whole spec is identified by its clauses lining up, in order, with an earlier spec of the same template: only the differences need a person.

```
clause text ──landmarks──> fingerprints ──> requirement type + level
                                                   │
datasheet row ──────────── mapped to ──────────────┤
                                                   ▼
                          capability (factory, type) ──> code compares ──> answer + reason + source
                                                   │
                         AI: remarks, descriptive clauses, review, proposals for new types and synonyms
```

## 2. What exists already (the seed)

| Today | Where | Becomes |
|---|---|---|
| ~25 properties with direction, unit family and class scales (EN 1886 D/L/T/TB, filter classes) | `worker/src/ai/compare.ts` PROPERTIES | Seed rows of `rq_types` |
| Synonym groups | `worker/src/ai/rules.ts` TERM_GROUPS | Seed rows of `rq_terms` |
| Topics (filters, coils, fans, heat wheels, VFD...) | `worker/src/lib/rows.ts` TOPICS | The component of a type |
| Units, conversion, measurements | `guard.ts`, `compare.ts` | The level extractor (unchanged) |
| Row mapping keywords | `dn_map.keywords` | Kept as fallback; rows get a type |
| Library keyed on exact normalised text | `cm_lines.norm_hash` | Kept for wording and descriptive clauses; lines get a type |
| Product Options approved values, knowledge-map facts, rule-book facts | `po_values`, `mp_nodes` | Sources of capabilities |

Today these live in three code files and two tables. The plan puts them in one place, editable by admins, instead of in code.

## 3. Changes

### 3.1 Data (one migration, 0008)
- `rq_types` - id (`casing.air_leakage_class`), product_id, component, property, kind (`value` | `class` | `standard` | `choice` | `presence`), unit family, direction (higher / lower / equal), scale (JSON, worst to best), status (to verify / verified), who, when.
- `rq_terms` - type_id or component, term, role (component / property / synonym). "air tightness" = "air leakage" = "casing leakage".
- `rq_prints` - one row per clause (library line or record line): type_id, level (JSON: op, value, unit, class, standard), landmarks (JSON), confidence, how (code / AI proposal / person). Index on type_id.
- `rq_hashes` - fingerprint hash -> clause (the inverted index; Shazam's lookup table). Index on hash.
- `rq_capabilities` - factory_id, type_id, offer (`standard` | `option` | `range` | `not offered`), value or class or standard, numeric value + unit, condition, source (certificate / datasheet / map fact / person) with reference, valid_to, status (to verify / verified), approved_by. One row per factory, type and offer.
- `dn_map.type_id` - a datasheet row's type (plus its qualifier: Supply / Return, Filter 1 / Filter 2).
- `cm_lines.type_id`, `cm_run_lines.print_hash` - the library line's type; the clause's fingerprint for template matching.
- `cm_runs.template_run`, `cm_runs.template_share` - the earlier record this spec follows, and how much of it.

### 3.2 Code (server only)
- `worker/src/rq/landmarks.ts` - landmarks from text with the vocabulary (terms, standards, classes, measurements, limit words); boilerplate dropped.
- `worker/src/rq/print.ts` - pairs -> hashes -> type by weighted vote (rare pairs weigh more); level from the landmarks.
- `worker/src/rq/capability.ts` - level vs capability: Comply / Not Comply / open, with the reason ("L2 required, L1(M) offered, EN 1886, Eurovent cert. ...").
- `worker/src/rq/template.ts` - aligns a new record with earlier records of the same product by fingerprints in order (offset agreement); returns same / changed level / new per clause.
- Clause-to-datasheet linking becomes "same type (and qualifier)"; the keyword match stays as fallback until every row has a type.
- **One copy, on the server.** The browser asks the server for the match (as the AI review does) instead of running `cm-rows.js`. This retires the duplicated matcher and the parity script.

### 3.3 The AI's job (kept, and easier)
1. **Answer** what code cannot decide: descriptive clauses (no landmarks), from the library wording and the maps.
2. **Write the remark** for Comply with Remarks and Not Comply from the comparison, under the remark lock.
3. **Review**: a second opinion on code's verdicts; flags a clause whose type looks wrong, or two clauses of one spec that contradict.
4. **Propose, never decide**: a type for a clause the extractor could not place, a new synonym, a new type, a capability read from a document. Each lands "to verify" for an admin, like map branches and Product Options values.

The model then sees "Type: casing.air_leakage_class, required L2, offered L1(M) [certificate]" instead of ten loosely similar sentences: shorter prompts, fewer tokens, the small model is enough.

### 3.4 Pages
- **Requirements** (new tool, admins): the vocabulary (types, terms), the queue of clauses with no type ("teach": pick or create the type, the AI proposes), the **capability matrix** (types x factories) with sources, validity and approval.
- **Record page and Focus mode**: per clause, a chip "Casing air leakage · required L2 · offered L1(M) · Comply"; a banner "85% same as <Project X> (reviewed): 312 same, 38 changed, 54 new" with a filter "Changed and new only".
- **Row mapping**: a Type column per row.

### 3.5 What becomes simpler
- Keyword lists, the topic gate and lexical similarity matter only for clauses without a type.
- Facts with a number or class move from knowledge maps into capabilities (one place, compared by code). Maps keep the narrative knowledge.
- The library stops growing with every spec: new wording of a known type adds nothing to review.

## 4. Data migration (existing library and facts)
1. Run the extractor over every `cm_lines` row: typed where confident, the rest into the teach queue.
2. Seed capabilities from approved Product Options values (as "seen on datasheet", to verify as standard / option), verified rule-book and map facts with a number or class, and library answers that state an offered value (to verify).
3. Type the AHU row mapping (about 300 rows) once, by hand with AI proposals.
Nothing is deleted; the old paths stay until the new one measures better.

## 5. Phases, each with a proof

| Phase | Builds | Done when (measured) |
|---|---|---|
| 0 - experiment (2 days) | Extractor for ~30 AHU properties over the existing library and the Qiddiya spec, no tables, a report | Share of clauses typed; how many types the library lines collapse into; whether earlier specs line up as templates. Go / no-go. |
| 1 (1 week) | Migration 0008, vocabulary seeded from code, prints for library and records, type chips read-only | 60%+ of Part 2 AHU clauses typed correctly on the Qiddiya spec (checked by the owner) |
| 2 (1 week) | Row mapping types, capability matrix with approval, linking by type | Every datasheet row of the Qiddiya sheet linked by type; no wrong links |
| 3 (1 week) | Decide by code from capabilities; AI writes remarks and reviews; Focus mode chips | On the golden set: no wrong Comply; agreement figure written down |
| 4 (1 week) | Template matching and "changed and new only" | A second spec from a known consultant: reviewed clauses cut by half or more |
| 5 | Teach queue with AI proposals; documents (certificates first) as capability sources; Vectorize only for descriptive clauses | Vocabulary growth per week; queue under control |

People's time: about 2 weeks of an engineer over phases 1 to 3 to verify the vocabulary (300-500 AHU types) and the first capabilities. That work is the asset.

## 6. Decisions for the owner
1. Who maintains the vocabulary and capabilities: the super user and the admins of the tile (as for Product Options and Maps)?
2. Granularity: one type = one property of one component (`filter_final.efficiency_class`), qualifiers (Supply / Return, Filter 1 / 2) as a separate field. Proposed.
3. Capability vs project selection: a datasheet value says what was selected for one project, not what the factory offers. Proposed: datasheet values seed capabilities as "seen", an admin decides "standard" or "option".
4. Order: AHU first, FCU and Chiller after phase 3.

## 7. Limits
- Clauses with no landmarks ("designed for easy maintenance") stay with the library and the AI.
- A missed landmark means a missed match, not a wrong answer: it fails safe.
- The vocabulary is work. Without it, this is a nicer search; with it, the tool knows the product.
