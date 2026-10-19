# AI roadmap on Cloudflare


## Principles
1. AI never writes into the library; it writes drafts (`ai_drafts`) that a person accepts, edits or rejects. A human answer always beats a draft. Accepted drafts enter the library through the existing review path.
2. The model extracts and writes; code compares. Every Comply / Deviation proposed by AI carries a reason a reader can check ("62 mm >= 50 mm required").
3. Every AI answer cites its sources (project, clause number, datasheet row, library line).
4. The Worker calls the models with the user's session; search results are re-checked against D1 permissions; the chatbot can only read what the user can open.
5. Data stays in Cloudflare (Workers AI, Vectorize, D1, R2). A switch to another provider through AI Gateway is a decision for the owner and the company, not a default.
6. Nothing calls a model on page load. AI runs on an action (convert, Draft answers, Ask) or in a Cron job.

## Data the AI works on (all already collected by the site)
- Library clauses with answers, Internal Comments, Part / section / topic (`cm_lines`).
- Project records: clauses with the project's answers and review state (`cm_run_lines`).
- Row mapping: rows with Name in Excel, Response template, Spec keywords (`dn_map`).
- Datasheet tables per project and unit (`pr_notes` in R2), tied to mapping rows by `key`.
- Product Options: values seen per row, factory and model, special options and notes (`po_values`, `po_extras`).
- Maps: branches, notes, special notes (`mp_nodes`), verified or not.

## Feature A - spec answered from the datasheet
1. Vectorize holds one vector per mapping row (text = section + component + Name in Excel + keywords + 5 typical values) and one per clause.
2. On "Draft answers" for a record: each clause is matched to its nearest mapping rows (filter `kind = map_row`, `product_id`), reranked, kept above a threshold; keywords (`CMRows.match`) remain as fallback and as a second vote.
3. The 8B model extracts the requirement from the clause as JSON: `{ parameter, operator, value, unit, choice, confidence }`. A clause with no measurable requirement is marked `descriptive`.
4. Code compares the requirement with the units' values from the datasheet table (per unit, after the row's Remove text); units converted where known (mm / in, kW / kcal/h, m³/h / l/s / cfm).
5. Remarks: the row's Response template with `$` when set (`Panel thickness is $ Thermal break`), else one sentence from the 70B model given the row name and the values; several units written as "62 mm (FAHU-01, 02), 50 mm (FAHU-03)".
6. Compliance proposed only when a comparison happened; otherwise left to Feature B. Saved as a draft with the reason and the row key; shown on the record page and in focus mode with Accept / Edit / Reject.

## Feature B - library answers by near match
1. Vectorize holds one vector per library clause (`kind = clause`, `product_id`, `factory_id`).
2. On conversion and on "Draft answers": a clause with no exact match searches its product; same factory first; the other factory's answer is shown as a suggestion only (answers never cross factories by themselves).
3. Similarity >= 0.90 and an answered line: filled as "From library (similar)" draft. 0.75 to 0.90: the 70B model drafts from the top 3 library answers + the Feature A result + Internal Comments, with the sources listed. Below 0.75: empty.
4. Accept writes the project answer; the review path (`pr_review_decide`) carries it to the library as today. Every accept / reject is logged in `app_audit` and `cm_answer_log` and is the feedback that tunes the thresholds.

## Feature C - project chatbot
1. A panel on the Projects page and on a project page. Tool-calling loop in `worker/src/ai/chat.ts` with the 70B model; tools = the site's own routes called with the user's token: `search_clauses`, `get_project`, `list_projects`, `get_datasheet_rows`, `get_product_options`, `search_library`, `search_maps`. Users get their projects; admins all; "Can edit" users the library too.
2. Answers cite sources as chips that open the record, the row or the library line. The model is told to say "not in the data" rather than guess.
3. Chats are stored (`ai_chats`, `ai_chat_messages`) per user and project; admins can read them for the audit; a user can delete his own.
4. Limits: 20 tool calls per question, 30 s, streaming reply.

## Feature D - library hygiene (small, after A to C)
Duplicate and junk clause detection by vector distance, Part / topic suggestions, "this clause looks like a heading" flags; all as a list for an editor, never automatic.

## Roadmap

| Phase | Builds | Done when |
|---|---|---|
| 0 | Part 2, section 11 steps 1 to 5 (the port and cut-over) | Team works on `tools.thinkneering.com` for a week without going back |
| 1 (1 week) | Vectorize index, `ai_jobs` + Cron, `npm run reindex`, "Similar clauses" panel on the record page (search only, no generation) | Benchmark AHU spec: share of clauses with a usable near match, measured and written down |
| 2 (1 week) | Feature A | Benchmark spec + the 3-unit datasheet: every numeric clause drafted with a reason; golden set agreed with the owner |
| 3 (1 week) | Feature B, draft badges, Accept / Edit / Reject, audit | A fresh spec of a known product comes back mostly drafted; nothing overwritten |
| 4 (1 week) | Feature C | Scoped, cited answers for users and admins; chats stored |
| 5 | Feature D, prompt tuning against `golden.json` and Check the AI, cost report, decision on a stronger model via AI Gateway or a LoRA fine-tune of the 8B | Quality numbers agreed before rollout to the whole team |

## Suggestions for the owner (not decided)
- Keep the old GitHub Pages site alive for 30 days after cut-over with a one-page redirect, so bookmarks still work.
- Ask IT early for the office network check on `*.thinkneering.com` and `*.workers.dev` (staging uses the second until the custom domain is set).
- Plan: the Workers Free plan covers the port and Phase 1 for 15 users (100 k requests a day, D1 5 GB / 100 k writes a day, R2 10 GB, Vectorize 5 M stored dimensions, 5 Cron Triggers, Workers AI 10,000 neurons a day). Paid ($5 a month) becomes necessary when drafting goes live (one 500-clause spec is about 30,000 neurons, about $0.33 on Paid), for the 30 s CPU limit the drafting loop needs, and for very large datasheet runs (160 k option writes in one go). Expect $10 to 20 a month in total for 15 users. The audit log gives the monthly figure.
- Chiller datasheet reader and FCU Riyadh are still open on the DAME side; port as they are, build them after the cut-over.
- When the company agrees to a stronger model for drafting, route only `draft.ts` through AI Gateway to it; search, extraction and chat can stay on Workers AI.

## Progress (kept by Claude; newest first)

### 19 Oct 2026, late night - no datasheet: Product Options as the source
`optionPicks` / `compareOptions` (evidence.ts): with no datasheet in the project, approved Product Options values are compared with the clause one by one; a clause fully met gets Comply, medium, source `options` (AMBER). `pr_run_selection` feeds the record's dashed chips and the working Excel's Selection list. No model involved.

### 19 Oct 2026, night (later) - 10-line experiment; vocabulary map in Maps; rule book = instructions only
Fingerprints typed 10 of 10 Qiddiya lines (8 before two fixes), linked 5 of 5 datasheet rows right (keyword chips: 2), decided 4 by code; the 6 open ones each need one piece of product knowledge (capability, material rule, equivalence). The vocabulary lives in a Maps map of the new kind `vocabulary` (edited, verified, imported like other maps); the rule book loses its Facts. Report and roadmap (steps A to E): `docs/Vocabulary-Experiment-2026-10-19.md`.

### 19 Oct 2026, night - direction: requirement fingerprints and the capability matrix (planned, not built)
Owner's decision: identify the requirement behind each clause from its landmarks (component, property, standard, class, value, limit) and compare its level with the factory's capability by code; the AI answers descriptive clauses, writes remarks, reviews, and proposes types / synonyms / capabilities for approval. Whole specs matched to earlier ones as templates, so only the changes need review. Plan, phases and proofs: `docs/Requirement-Fingerprints.md` (project: `claude/Requirement-Fingerprints.md`). Next: phase 0 experiment (2 days).

### 19 Oct 2026, evening - Product Options values approved by an admin
The AI reads only approved Product Options values (`evidence.ts`: `approved = 1`), so a wrong datasheet cannot teach it a false option.

### 19 Oct 2026, evening - AI notes moved from Product Options to Maps
Migration 0006 moves every AI note into the factory's knowledge map (verified branches); the AI reads them there as [K] knowledge. Product Options: datasheet values, special options and notes only.

### 19 Oct 2026, afternoon - whole-record AI review off, Focus mode only
The AI review button shows "coming soon"; `ai_review_run` refuses unless `AI_WHOLE_REVIEW = "1"` ([vars]). Focus-mode proposals (`ai_suggest`) stay on for every user. To switch the whole review back on: add the var and deploy.

### 19 Oct 2026 - base fixes and the master prompt's essence (built, branch `fixes-2026-10-19`)
Reports: `Base-Flow-Test-2026-10-19.md`, `Master-Prompt-Integration.md`, `Rollout-Plan-2026-10-19.md`. Rules: standards A.13.8.
- Datasheet evidence: every row of a key is an entry with its qualifier (Filter 1 / Filter 2, Supply / Return); newest table per unit; tables of another factory are skipped with a warning on the review.
- Matching: topic gate in both copies of the matcher (parity script in `npm test`); `MATCH_VERSION` "2026-10-19 topics" clears the match cache; 0005 also empties it.
- Comparison by code: conjunction (every part must pass), ranges, percentage only on the same metric, disagreeing groups settle nothing; a clean datasheet Comply has no remark.
- Every draft passes `lockRemarks` (blank confirming remarks, scope line, needed remarks, banned wording -> low) and gets a priority GREEN / AMBER / RED; precedent of the same factory on the record; RED when a draft differs from it.
- Library / project copies whose remark states a figure the datasheet does not show go low confidence.
- Brief rewritten to 5 sections (~330 words); `PROMPT_VERSION` "draft-2026-10-19a". Two Excel downloads (consultant / working).
- Acceptance on the Qiddiya pair (stand-in model): no false Comply from the datasheet, wrong VFD / filter links gone, both filters shown. Real-model agreement still to be measured with Check the AI after deploy.

### 16 Oct 2026, night (last) - the AHU rule book, and Facts (built)
Owner: "upgrade the AHU AI rule book with the logic and rules of the walkthrough, based on Product Options and the specs."
- `ai/template-ahu.ts`: 27 AHU rules (Part 1: fan selection, seismic design by others, submittals, contractor's
  documents, QA and listings, delivery and site storage, extra materials, warranty; Part 2: manufacturer, casing and
  panels with the EN 1886 scales, insulation, drain pans, doors and lights, fans (EC plug versus belt), motors, coils,
  dampers, filters (MERV versus ISO 16890), energy recovery, controls, factory tests, options; Part 3: field tests,
  manufacturer's service, training) and 13 facts (3 on, 10 to verify), plus the KSA defaults for a Riyadh rule book.
- Facts are a new branch kind; an instruction rule no longer backs a product answer by itself.
- Next: the owner verifies the facts in Maps; Check the AI before and after, on the Riyadh library.

### 16 Oct 2026, night (later) - the small model, and Check the AI (built)
Owner: "8B should be more than enough for this simple task; focus on making it learn patterns." The neuron limit was
hit because drafting ran on the 70B (about 80 neurons a clause, about 120 clauses a day free); v3 ran on the 8B.
- Drafting on `@cf/meta/llama-3.1-8b-instruct-fast` (about 8 neurons a clause, about 1,000 a day free), JSON mode
  with the six answers as an enum and the sources first, empty blocks left out of the prompt. `AI model: large` in
  the rule book switches a product back. Neurons counted per model.
- **Check the AI**: people's library answers replayed with the answer hidden; agreement, differences and clauses left
  for a person, kept per check with model and prompt version. This is the learning curve.
- How the small model learns, in order of effort: (1) corrections shown as `[M]` sources on similar clauses (at once);
  (2) the differences Check the AI lists, fixed as a rule, an AI note in Product Options or a knowledge branch;
  (3) Learned branches from repeated corrections (nightly, to verify); (4) later, a LoRA fine-tune of the 8B when (1)-(3)
  stop raising the agreement and there are several hundred corrected or approved answers. Training would run outside
  Cloudflare (Workers AI only serves adapters): the owner's decision.

### 16 Oct 2026, night - strict directions and learning from corrections (built)
From the AHU_Specs walkthrough (`Compliance-AI-Walkthrough.md`, gaps G1-G16). Owner's aim: answers only from the
factory's capabilities, the product datasheet and the maps; the AI follows strict directions and learns from mistakes.
- **Citation contract**: every source has an id; a product answer (Comply, Comply with Remarks, Not Comply, Not
  Applicable) must cite one or the clause is left for a person. Code checks the cites, the numbers against cited
  sources only, the Not Comply backing and the high-confidence backing (standards A.13.5).
- **Strict by default**: Part 2 clauses with nothing on file skip the model. `Answer without a source: yes` relaxes it.
  This closes G5 (175 of 248 drafts were unsourced "Comply, low") and saves neurons (G7).
- **Corrections as sources** `[M]`: people's edits to AI drafts, retrieved by similarity for the next clause.
- **Rule exceptions** (`Unless:`), template rules corrected (G3, G8), **Update from template** button.
- Fixed G1, G2, G4, G6, G9, G10, G11, G13. Open: G12 (section title row), G14 (library key with the parent),
  G7 per-clause budget check. 18 new tests (`tests/worker/ai-strict.test.ts`).
- Next: a "recheck past corrections" run (replay every corrected clause through the current rules and prompt and
  count how many now come out as the person answered) as the measure of learning; then the golden set.

### 16 Oct 2026, late - Thinkneering v3 Compliance AI carried over (built)
The owner supplied the discarded v3 site (Thinkneering_Final.zip); its design and its Compliance Maker AI are kept,
nothing else. Most of v3's checks were already here (number grounding, echo trim, Not Comply needs a source, parent
clause, synonym groups, section gate). Added now:
- **compare.ts**: unit conversion before comparing; property directions (thicker panel = better, higher pressure drop
  = worse; a worse offer asked "as is" stays Comply with Remarks but is low confidence); EN 1886 / filter class
  scales (a class asked is a minimum; TB1 best, F9 above F7). Fixes "1,200 l/s" read as 1.2.
- **sections.ts**: contractor / reference / product per section, learned from people's library answers (5 or more);
  no datasheet figure answers a site-works or standards section; the model is told the kind.
- **Missing unit sections**: a clause about a section this project's datasheet does not have is never a confident
  Comply.
- Not taken from v3: a seventh answer TO VERIFY and [GUESS] prefixes (low confidence + `[value]` do that job), batches
  of 3 clauses with a three-pass retry, the 8B model, AI-written section summaries, the Ask chat box.
- **Open for the owner** (v3's architecture review, real 585-row matrix): people answered 21% of rows and left 79%
  blank on purpose; v3 proposed recording blanks as decisions and measuring row-selection F1, status accuracy and
  remark kept / edited / replaced. This repo drafts every open clause (Design brief: "the site assumes, the user
  corrects"). Whether a library "leave blank" decision should exist is the owner's call; the golden set should
  measure the three numbers either way.

### 16 Oct 2026, night - AI rule book and knowledge maps (built)
- Maps have a type (mp_maps.kind, migration 0004): **knowledge** (as before) or **AI rule book** (made from the template).
  Compliance review > AI rules links one of each per product and per factory (ai_map_links.role).
- Rule book: **Instructions** (the owner's prompt, polished for this tool, one section per branch; the model's brief is
  built from them; fixed frame in code: reply format, six answers, no value without a source), **Decision steps**
  (real switches: "to verify" = skipped; thresholds as special notes), Settings, Part rules (now also `Part:`),
  **Learned** (ai/learn.ts: patterns of 3+ same changes written nightly / on demand as "to verify" branches, once each).
- Knowledge maps: verified branches matched by telling words go to the model as facts (and count as sources for numbers).
- Try a clause shows the exact prompt; drafts made from a map's brief carry prompt version "map-<hash>".
- Not ported from the owner's prompt: Mode 2 (replies to consultant comments: a later tool), Excel styling (export has
  its own), "TO VERIFY" = `[value]` + low confidence, Flagged items = low confidence + reason, Deviation = Comply with
  Remarks (or Not Comply when a stated limit is broken), By Contractor = In Contractor's Scope.

### 16 Oct 2026, evening - datasheet-first answers, AI maps, AI notes, focus-mode proposals and feedback (built)
- **Order of evidence** (evidence.ts, draft.ts): datasheet compared by code (same rows as the chips: lib/rows.ts is a
  line-for-line port of CMRows.match, parity-tested) -> library copy (threshold from Settings; a library answer the
  datasheet contradicts is reopened, the datasheet wins) -> same clause earlier in the record -> AI rule with Answer +
  Remark -> other projects (below the library) -> the model with everything (Product Options values / specials / notes /
  AI notes, section answers, project answers, parent clause). Sources named on every proposal.
- **AI maps** (map.ts, ai_map_links): any map in Maps, linked per product (all factories) and per factory in
  Compliance review > AI rules; Part branches; When / Section / Answer / Remark special notes; "to verify" = off;
  Settings branch (copy threshold, model on/off, daily budget, suggestions, datasheet wins, project answers); the tab
  lists what the AI cannot use, Try a clause shows the 5 steps, quality figures from ai_feedback. The AI rules table
  (ai_rules, 0002) is no longer read; its rules move into a map created from the template.
- **AI notes** in the Options tree (po_extras kind 'ai', migration 0003), hidden from readers.
- **Focus mode proposals** for everyone (ai_suggest, 3 clauses a call, model answers kept 12 h in ai_suggestions);
  Keep & next / Keep / Not this; every save after a proposal or a draft writes ai_feedback (kept / edited / replaced).
- **Speed** (Free plan, ~10 ms CPU a request): matcher indexed (93 -> ~18 ms) and cached per record (ai_match_cache +
  memory); library and answer search indexed (95 -> ~5 ms per batch) and kept in memory; 4 model calls side by side.
- **Old site cache**: the Worker answers /sw.js and similar with a script that clears and removes the old service worker.
- Open: golden set + eval:live; rule suggestions as one-tap branches in the map; the AI review on a phone at scale.

### 16 Oct 2026, 14:30 - agreed design for the next deliveries (owner's decisions, not built yet)
**Three levels, one order of evidence per clause.** 1. the project's datasheet (what this unit IS) -> 2. Product
Options of the factory (what it CAN offer: values seen, special options, AI notes) -> 3. the library (how the clause
was answered, the wording). AI rules = answering policy. The model only writes the sentence; it is not a source of
facts. Every blue answer names its level ("From the datasheet: Panel 62 mm").
Decisions:
- Datasheet wins over a library answer when a value conflicts: the green answer becomes a blue datasheet draft with
  the reason "library says 62 mm, this project's datasheet 50 mm".
- A number with no minimum / maximum that differs from the datasheet: Comply with Remarks, stating the offer.
  Not Comply only when an explicit limit is broken ("not less than", "maximum", "at least" ...). Code decides.
- Product facts live in the Options tree only, as AI notes per section and per row (po_extras kind 'ai'), written by
  the people who edit Product Options; the AI rules tab keeps answering rules; the 12 starter facts move to the tree.
- Free plan stays: the model only where datasheet, options, rules, library and earlier answers cannot settle it;
  focus mode gets a ready suggestion for everyone (next 2 prepared ahead), Keep / change / skip; project answers of
  other projects are a source ranked below the library; corrections become rule suggestions for admins.
Build order:
1. Service-worker kill switch (old thinkneering.com cache served stale hub.js: "Hub.more is not a function");
   datasheet-first answers: the server uses the same clause-to-row matching as the blue chips (port CMRows.match),
   code comparison with operators and units, the row's Response template ($) as the remark (no model call), several
   units grouped, source on every blue answer.
2. AI notes in the Options tree; Product Options as level 2; starter facts moved.
3. Focus mode suggestions and learning (prepared ahead, same-record / same-section answers, project answers, rule
   suggestions from corrections, daily neuron budget).
4. Golden set and the quality line for admins.

### 16 Oct 2026 - AI rules per product / factory, datasheet grounding, code checks (Design brief Phase 3, first part)
- **AI rules tab** in Compliance review (admins of the Compliance Maker tile + super user; routes `ai_rules_list /
  save / delete / test`, migration `0002_ai_rules.sql`, table `ai_rules` with a `tool` column so other tools can
  have rules later). Rules (instructions) and facts (what the factory offers), per product for every factory or
  one, keywords + Part. A rule with a fixed answer and remark answers matching clauses without the model
  (source `rule`). "Try a clause" shows what would apply, no model.
- **`#` clause rules** rebuilt (the 15 Oct code never reached GitHub): note before the first `#`, rules after;
  users get the note only (stripped on the server in `pr_run_get`, `pr_export`, `cm_save_run`); a library line
  with `#` rules is never copied blindly.
- **From the first AI tool (ai-suggest.js)**: project datasheet rows matched per clause with the section gate and
  subject words (casing ~ panel); parent clause for list items; number grounding (a measurement no source gives
  becomes `[value]`, low); answer-echo trim; hedging -> low; Not Comply needs a rule / datasheet row / library
  answer; one retry with the error on an unusable reply. Not taken: the 8B model, 3-clauses-per-call batching,
  JSON-schema mode (per-clause calls on the 70B are simpler and each failure stays local), TO VERIFY as a 7th
  answer (low confidence + `[value]` does that job inside the six standard answers), learned section profiles and
  glossary tables (later, from accepted drafts).
- **Prompt version** stored on every draft (`ai_drafts.prompt_version`: `draft-2026-10-16`, `rule-2026-10-16`).
- **Library upload** writes the six standard answers ("By contractor" -> In Contractor's Scope ...); the AHU
  Riyadh file: 516 answered rows, 508 clauses, 231 answers standardised, 15 odd values left as written.
- **Starter rules for AHU Riyadh** (10 rules, 12 facts) delivered as SQL, checked against the 3,694 clauses of
  that library (fixed-answer rules fire on 46 and agree with people except two nuances).
- Library hygiene found (for Feature D): datasheet lines that became section names ("kW - 6.8 A Power - Nominal
  Current"), project-specific answers ("as per IFC schedule") in the company library, Internal Comments pasted on
  the wrong clause (AMCA 301 with the crating note).
- Same day, after the first live try (no drafts, 0 neurons used): the review now runs in a window that holds the page
  until OK, checks the AI first (`ai_check`), stops at once on a used-up allowance or a refused call with the reason
  in words (`aiErrorText`), falls back from a missing AI Gateway to Workers AI directly, and skips clauses that failed
  earlier in the same review (`p_skip`), so it always ends.
- Open: golden set + `npm run eval:live`, the per-user daily cap, the 8 s timeout, the quality card (rest of Phase 3).

### 16 Oct 2026 - Design brief Phase 1 (no AI logic change)
- Every AI draft now shows its reason and confidence as a visible line: under the clause on the record page (`.why`)
  and as a box above the answers in focus mode (`.cf-why`); the proposed answer is tinted until a person owns it.
- Counts never call a draft "answered": "10 of 38 clauses answered, 12 AI drafts to check". `pr_get` gives `drafts` per record.
- The 15 Oct `#` rules were rebuilt on 16 Oct (entry above).

### 15 Oct 2026 - live on thinkneering.com; AI rules in Internal Comments (code not in the repo, see above)
- The site is live (D1 `thinkneering-db`, R2 `hub-files`, Workers AI; Vectorize still off, lexical search in use).
- AI rules: in a library clause's Internal Comments, text before the first `#` is the note for users; every `#` starts an
  AI rule that wins over the library answers for that clause; rules of similar clauses are hints; a clause with its own
  rule is never copied blindly from a >= 0.90 match. Open: hide the `#` part from users (brief Phase 3 decides: users see
  the note, editors see both).

### 14 Oct 2026 - first delivery of the new repo: AI review on project records (Phase 1 plumbing + a first cut of Phase 3)

What is built (`worker/src/ai/*`, `worker/src/api/ai.ts`, `tools/projects/record.html`):
- **AI review button** on a project record, for admins of the Projects tile and the super user only (`pr_run_get`
  returns `can_ai`; the route checks `prAdmin` again). It drafts an answer for every clause that shows no answer
  (no person's answer, no library answer), in batches of 10 per request (`ai_review_run`, the page loops while
  `remaining > 0`, passing `since` back so a "draft again" never loops), and audits every batch with the token counts.
- **How a draft is made** (`ai/search.ts`, `ai/draft.ts`): the factory's answered clauses are searched - through
  Vectorize when the index has vectors (bge-m3, metadata filter `kind = clause, factory_id`), otherwise by word and
  word-pair overlap (the lexical fallback, deterministic, used locally and in tests). A near-identical answered clause
  (>= 0.90) is copied without the model ("library-similar", confidence high). Otherwise the 70B model gets the three
  nearest library answers, their Internal Comments and the clause's Part / section (`ai/prompts/draft.md`) and answers
  in JSON; code maps the wording onto the six standard answers; confidence is capped at medium unless a library
  answer >= 0.6 backs it; a reply without JSON or without a standard answer fails that clause only.
- **Where a draft lives**: on the record row (`cm_run_lines.compliance / remarks`, `ai_draft = 1`, review `''`) with
  reason, sources, confidence, model and status in `ai_drafts`. Drafts are blue on the page and in focus mode, say
  "AI draft, check it (low confidence)" with the reason on hover, have their own filter, and are flagged in the Excel.
  They never enter `cm_lines`, never appear in the review queue or in the editor's "project answers", and never
  overwrite a person's or the library's answer (the write is guarded against changes made while the model worked).
  A person who edits or keeps a draft makes it his own answer (review pending as always; the draft is marked
  accepted / edited / rejected and audited). "Remove AI drafts" takes them all off. Split / Join move drafts with their rows.
- **Vectorize plumbing** (Phase 1): `ai_jobs` rows on every new clause, cron every 5 minutes embeds 90 at a time,
  `npm run reindex` queues everything (also the way to rebuild on a new account). Not yet exercised on a real account.
- **Offline stand-in** (`env.local`, `AI_FAKE = "1"`): no model, every draft is "Noted, low confidence" with a reason
  that says so, so the flow can be tried and tested without a Cloudflare login. Tests: `tests/worker/ai.test.ts` (7),
  Playwright flow in `tests/e2e/compliance.spec.ts`.

Not yet: Feature A (datasheet comparison), the "Similar clauses" panel, golden set, chat (C), hygiene (D). Thresholds
(0.90 copy, 0.30 show) are first guesses to be tuned on the benchmark spec once staging has the real library.

Decision for the owner: the roadmap's "draft on conversion" (Feature B step 2) is not done; the AI runs only on the
button, which keeps the Free plan's daily neurons for admins' reviews. Say the word and `cm_save_run` can queue a
review automatically for every conversion.
