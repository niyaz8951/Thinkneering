# AI on compliance records - how it decides, and how to steer it from the site

For the owner and the admins. Updated 16 Oct 2026 (night): rule book and knowledge maps. Code: `worker/src/ai/evidence.ts` (what is known about a
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
| 6 | **The AI model** | Only when nothing above settles it, within the daily budget. It reads the rule book's **Instructions**, then: the clause's own `#` rules, the map rules, the knowledge-map branches that match, the datasheet rows, **Product Options** (values seen, special options, notes, **AI notes**), the library's 3 most similar answers, the answers given earlier in this section, other projects' answers, the parent clause. It writes; code checks (section 3). | Yes |

A clause with its own `#` rules (Internal Comments) goes to the model with them in front, when the model may be used.

## 3. Checks on every model answer
One of the six answers (else one retry, then left empty); a number with a unit no source gives becomes `[value]` and
the confidence low; the answer is not repeated in the remark; hedging words make it low; **Not Comply** only with a
rule, datasheet row, library answer or Product Options entry behind it; "high" only when a source backs it directly.

## 4. Steering it from the site
**a. Two kinds of map** - chosen in Maps when the map is made (*What it is for*), changeable in the map's settings:
- **AI rule book**: what the AI follows. A new one starts from the template.
- **Knowledge** (process or product understanding): maps as people always used them. The AI reads their **verified**
  branches that share telling words with a clause, as facts it may quote. A branch "to verify" is not a fact yet.

Compliance review > **AI rules** has, for *All AHU factories* and for *Riyadh only* (read first), one picker for each
kind: **Open in Maps**, **Create from template** (rule book). An older rule book without Instructions gets
**Add the new parts** (Instructions, Decision steps, Learned) without touching its rules.

**The rule book, branch by branch**
- **Instructions**: the AI's brief. Every section (Role, Where values come from, Which answer, Equivalent standards,
  Scope of supply, Remark style, When something is not clear, ...) is read by the model, in order, before it answers.
  Edit the text and the AI follows it within a minute; mark a section "to verify" to leave it out; `{product}` and
  `{factory}` are filled in. A factory rule book's section with the same title replaces it; new titles are added.
  Fixed by the site (cannot be edited): the reply format, the six answers, and that no value is written without a source.
- **Decision steps**: the IF / THEN order the AI goes through (datasheet -> library copy -> earlier answers -> rules that
  answer by themselves -> other projects -> Product Options -> knowledge maps -> the model -> checks). Mark a step "to
  verify" to skip it; the order is fixed. Its special notes are its settings: `Copy from library at: 0.90`,
  `Datasheet wins over the library: yes`, `Use the AI model: yes`, `Daily AI budget: 9000 neurons`.
- **Settings**: `Suggest in focus mode: yes`, `Use answers from other projects: yes` (a factory rule book overrides).
- **Part 1 General / Part 2 Products / Part 3 Execution / Any Part**: the rules. Title = name, notes = what the AI
  should do; special notes one per line: `When: install, rigging` - `Section: references` - `Part: 2` -
  `Answer: Noted` - `Remark: Noted.` Answer + Remark = the rule answers by itself (no model). "To verify" = off.
- **Learned**: every night (and on *Write to the map*), what people changed the same way 3 times or more becomes a
  branch here: Section, Part, Answer and the remark they wrote, "to verify". Verify it to switch it on, edit it to
  narrow it, delete it if wrong (it is not written again).

**On the tab**: what the AI reads (instruction sections, settings, steps switched off); what in the maps it cannot
use; **Try a clause** with the steps, the rules, AI notes and knowledge branches that apply, and **What the AI reads for
this clause**: the exact brief and clause text the model would get; **How the AI did, last 30 days** with
**Write to the map**.

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
