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
| 5 | Feature D, prompt tuning against `golden.json`, cost report, decision on a stronger model via AI Gateway | Quality numbers agreed before rollout to the whole team |

## Suggestions for the owner (not decided)
- Keep the old GitHub Pages site alive for 30 days after cut-over with a one-page redirect, so bookmarks still work.
- Ask IT early for the office network check on `*.thinkneering.com` and `*.workers.dev` (staging uses the second until the custom domain is set).
- Plan: the Workers Free plan covers the port and Phase 1 for 15 users (100 k requests a day, D1 5 GB / 100 k writes a day, R2 10 GB, Vectorize 5 M stored dimensions, 5 Cron Triggers, Workers AI 10,000 neurons a day). Paid ($5 a month) becomes necessary when drafting goes live (one 500-clause spec is about 30,000 neurons, about $0.33 on Paid), for the 30 s CPU limit the drafting loop needs, and for very large datasheet runs (160 k option writes in one go). Expect $10 to 20 a month in total for 15 users. The audit log gives the monthly figure.
- Chiller datasheet reader and FCU Riyadh are still open on the DAME side; port as they are, build them after the cut-over.
- When the company agrees to a stronger model for drafting, route only `draft.ts` through AI Gateway to it; search, extraction and chat can stay on Workers AI.

## Progress (kept by Claude; newest first)

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
