# AI on compliance records - how it decides, and how to steer it from the site

For the owner and the admins. Updated 16 Oct 2026 (evening). Code: `worker/src/ai/evidence.ts` (what is known about a
clause), `worker/src/ai/draft.ts` (the order and the model), `worker/src/ai/guard.ts` (checks), `worker/src/ai/map.ts`
(the AI maps), `worker/src/api/ai.ts` (routes). Everything below can be changed in the site; nothing needs code.

## 1. Where the AI works
- **Focus mode, for everyone who fills a record.** A clause with no answer shows a dashed **Proposed** card: the
  answer, the remark, where it came from and why. **Keep & next** saves it and moves on; **Keep** saves it; **Not this**
  hides it. The next two clauses are prepared while you read, so moving on is instant. Saving is what the AI learns from.
- **AI review button** (admins of the Projects tile, super user): drafts every open clause of a record in batches, in a
  window that holds the page until **OK**. It checks the model first; if the model cannot be used, it still drafts from
  the datasheet, the library, earlier answers and the AI rules.
- Nothing runs on page load. People who use these need no access to Maps.

## 2. The order of evidence (the same for both)
For each clause, the first step that settles it wins:

| # | Source | What happens | Model? |
|---|---|---|---|
| 1 | **Project datasheet** (Datasheet Notes saved in the project) | The same rows as the blue chips. A number in the clause ("minimum 50 mm", "not exceeding 2.5 m/s") is compared by code with the chip next to it in the same unit: met = **Comply**; asked without min/max and different = **Comply with Remarks**; a min/max not met = **Not Comply**. The remark is the datasheet value (the row's Response template filled in). | No |
| 2 | **Library** (Compliance review) | A clause at or above the copy threshold (Settings, default 90% similar) is copied. A library answer this project's datasheet contradicts is **reopened**: the datasheet wins, as a blue draft that names both values. | No |
| 3 | **Same clause earlier in this record** | Proposed again: "Same clause as your answer to 1.04 H". | No |
| 4 | **AI rule with Answer + Remark** (the AI maps) | Applied as written. | No |
| 5 | **Other projects of the same factory** | A same-clause answer is proposed, ranked below the library, marked "not yet approved". | No |
| 6 | **The AI model** | Only when nothing above settles it, within the daily budget. It gets: the clause's own `#` rules, the map rules, the datasheet rows, **Product Options** (values seen, special options, notes, **AI notes**), the library's 3 most similar answers, the answers given earlier in this section, other projects' answers, the parent clause. It writes; code checks (section 3). | Yes |

A clause with its own `#` rules (Internal Comments) goes to the model with them in front, when the model may be used.

## 3. Checks on every model answer
One of the six answers (else one retry, then left empty); a number with a unit no source gives becomes `[value]` and
the confidence low; the answer is not repeated in the remark; hedging words make it low; **Not Comply** only with a
rule, datasheet row, library answer or Product Options entry behind it; "high" only when a source backs it directly.

## 4. Steering it from the site
**a. AI maps (rules and settings)** - Compliance review > **AI rules**, per product and factory:
- *Map for all AHU factories* and *Map for Riyadh only*: choose any map you can see in Maps (e.g. "AHU-Riyadh-AI notes"),
  **Open in Maps**, or **Create from template** (decision tree, settings, starter rules; private to you, share it in Maps).
  A Riyadh record reads the Riyadh map first, then the map for all factories.
- In a linked map: top branches **Part 1 General / Part 2 Products / Part 3 Execution / Any Part** (other names count as
  Any Part), **Settings**, and optional **How the AI decides** (documentation). Every branch under a Part is a rule:
  title = name, notes = what the AI should do, special notes one per line:
  `When: install, rigging` (the clause mentions one; "install" also finds installation) -
  `Section: references` (the section title mentions one) - `Answer: Noted` - `Remark: Noted.`
  Answer + Remark = the rule answers by itself. When / Section pass to the branches under it. **"To verify" = off.**
- **Settings** (special notes in the Settings branch; a factory map overrides the product map):
  `Copy from library at: 0.90` - `Use the AI model: yes` - `Daily AI budget: 9000 neurons` - `Suggest in focus mode: yes` -
  `Datasheet wins over the library: yes` - `Use answers from other projects: yes`
- The tab lists **what the AI cannot use** in the maps (an Answer that is not one of the six, an unknown setting, a rule
  that would answer everything) and the settings in use.
- **Try a clause**: paste a clause (and its section and Part): the 5 steps the AI would take and the rules that apply.
- **How the AI did, last 30 days**: per source, how many proposals were kept, kept with another remark, or replaced; and
  the answers people changed the same way 3 times or more, with the rule to write for it.

**b. Product Options > + AI note** (on any section or row of the Options tree, per factory; editors of Product Options):
facts about the product for the AI ("Panels are 62 mm double wall, PU foam; 50 mm on request"). Used for the clauses
whose chips point at that row or section, and for clauses that share telling words with the note. Readers of the tree
do not see AI notes. `starter-ai-notes-ahu-riyadh.sql` loads 12 from the Riyadh library onto its General section.

**c. Row mapping** (Product Options > Row mapping): the Spec keywords decide which chips a clause gets, so they decide
what step 1 compares. A chip that keeps landing on the wrong clause is fixed there.

**d. `#` in Internal Comments**: rules for one clause; users see only the text before the first `#`.
`# project-specific, do not reuse` stops a library answer from being copied into other projects.

## 5. Cost and limits (Workers Free plan)
- The model is used only in step 6. Steps 1-5 cost nothing. A 486-clause spec with a datasheet, a filled library and the
  starter rules typically needs the model for well under half its clauses.
- Daily budget (Settings) protects the free 10,000 neurons a day; when it is used up, proposals and the review continue
  from the free sources and say so.
- The Free plan allows about 10 ms of work per request. The heavy parts (chip match, library index) are kept between
  requests; if the site ever shows "Worker exceeded resource limits" (error 1102) on large records, the Workers Paid
  plan (USD 5 a month) lifts it.
