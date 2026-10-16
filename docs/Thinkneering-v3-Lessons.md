# Thinkneering v3 - what is kept (design and Compliance Maker AI only)

The owner supplied the discarded v3 site (`Thinkneering_Final.zip`, Cloudflare Pages + D1) on 16 Oct 2026. Only two
things from it are kept: **its design** and **its Compliance Maker AI**. Everything else in v3 (the knowledge graph,
Education, the reader, the dictionary, accounts and plans) is not ported and should not be read as a plan.

## 1. Design
- Name **Thinkneering**, mark = the "layers" mark (three stacked layers), white on a blue rounded tile.
- On this site: "Thinkneering Tools", the mark on the Daikin blue (`--brand`), the theme unchanged (standards A.7 and
  A.13.4). v3's own palette (#2f5fff, Sora / Inter web fonts) is **not** used: the theme stays, and no web fonts.

## 2. Compliance Maker AI - the principles
1. **A false "Comply" is the worst failure; an empty field beats a wrong value.** Priority: accuracy, traceability,
   completeness, speed. (Already the first section of the AI brief, `map.ts DEFAULT_INSTRUCTIONS`.)
2. **Sources in a fixed order, strongest first**: the project's selection datasheet, then what the factory offers,
   then past confirmed answers; never memory, general knowledge, estimation or interpolation. (Here: `evidence.ts`.)
3. **Code compares, the model writes.** Every comparison is computed before the model sees the clause, including
   which way is better. (Here: `compare.ts`, built 16 Oct 2026.)
4. **It never learns from its own unconfirmed output.** Only a person's decision counts. (Here: the library holds no
   AI draft; `ai_feedback` records what people kept, edited or replaced.)
5. **Instructions are requests, checks are guarantees.** Every model answer is checked by code. (Here: `guard.ts`.)
6. **Retrieval first, generation last.** On a real 585-row matrix, 53% of human answers needed no model at all.

## 3. What was carried over, and where it lives

| v3 | Here | Status |
|---|---|---|
| Direction per property (higher / lower / exact / unknown never fails a unit) | `compare.ts PROPERTIES`, `judge` | built 16 Oct |
| Class scales EN 1886 TB / T / D / L and filters G..H (worst -> best) | `compare.ts`, `compareClass` | built 16 Oct (+ E10-E12, U15-U17) |
| Compare after converting to the consultant's units | `compare.ts convert` | built 16 Oct |
| Section kind (contractor / reference / product) learned from confirmed answers, trusted at 5 | `sections.ts` | built 16 Oct (reference made stricter) |
| Sections the selected unit does not have: never Comply on configuration grounds | `evidence.ts absent`, `draft.ts` | built 16 Oct |
| Datasheet values tagged by unit section; a clause sees only its own section | `lib/rows.ts` match + section gate | already here |
| Number grounding: a measurement no source gives is withdrawn | `guard.ts groundRemarks` -> `[value]`, low | already here |
| Remark continues the answer, never repeats it | `guard.ts trimAnswerEcho` | already here |
| Banned hedging words | `guard.ts hedges` -> low | already here |
| Not Comply / Deviation only with a real source | `draft.ts` | already here |
| Internal Comments guide but are never quoted | `rules.ts splitComments`, brief | already here |
| Parent clause read with its list items | `rules.ts parentOf` | already here |
| Synonym groups (casing = panel = skin) | `rules.ts TERM_GROUPS` | already here |
| Equivalent standard: "Comply as equivalent." only when a source names it | brief section "Equivalent standards" | already here |
| Scope: site works = In Contractor's Scope with fixed wording; factory-fitted is supply | brief section "Scope of supply" | already here |
| Corrections read for patterns (same correction repeated = missing fact; verified answers corrected = most serious) | `learn.ts` (Learned branch), quality card | already here |

## 4. Deliberately not taken
- **A seventh answer "TO VERIFY" and the "[GUESS]" prefix**: the six standard answers stay; low confidence plus
  `[value]` carries "to verify" (decided 16 Oct 2026).
- **Batches of 3 clauses with a three-pass retry, and the 8B model**: one clause per call on the 70B model with one
  retry; each failure stays local.
- **Worked examples with real values in the prompt**: v3 found a small model copies them onto other clauses; the
  brief here has no concrete example values, which removes the need for v3's "repeated example" check.
- **AI-written section summaries** and the **Ask** chat box: not part of the Compliance Maker flow here.

## 5. Open for the owner
v3's architecture review measured a completed 585-row matrix: people answered 21% of the rows and left 79% blank on
purpose, and no rule on the clause text could predict which (precision 22%). v3 began recording **blank as a
decision**. This site's Design brief instead has the site propose an answer for every clause and the person keep,
change or skip it. Two things follow either way:
- the golden set (Design brief Phase 3) should measure v3's three numbers: **row selection** (did we answer the rows
  a person answered), **status accuracy**, and **remark kept / edited / replaced**;
- if reviewers find too many unwanted proposals, a library "leave blank" answer (a person's decision to skip a clause,
  reused next time) is the v3 way to learn it. Not built until the owner decides.
