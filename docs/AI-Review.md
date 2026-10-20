# AI on compliance records - how it decides, and how to steer it from the site

For the owner and the admins. Updated 16 Oct 2026 (night): rule book and knowledge maps. Code: `worker/src/ai/evidence.ts` (what is known about a
clause), `worker/src/ai/draft.ts` (the order and the model), `worker/src/ai/guard.ts` (checks), `worker/src/ai/map.ts`
(the AI maps), `worker/src/api/ai.ts` (routes). Everything below can be changed in the site; nothing needs code.

> **20 Oct 2026 (afternoon):** maps hold the AI's rules only. Knowledge maps and the rule book's Facts branch are no
> longer read; facts about the product are **AI notes in Product Options** (admins only, cited as `[N]`). Source
> order: datasheet with its Product Options notes; without a datasheet the closest higher approved Product Options
> value; then the library. Where this page mentions knowledge maps, `[K]` or `[F]`, read AI notes.

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
| 1 | **Project datasheet** (Datasheet Notes saved in the project) | The same rows as the blue chips. A number in the clause ("minimum 50 mm", "not exceeding 2.5 m/s") is compared by code with the chip next to it, converted to the clause's unit (l/s and cfm, Pa and in. wg, kW and TR ...): met = **Comply**; asked without min/max and different = **Comply with Remarks**, and the reason says whether the offer is better or worse for that property (a worse one is low confidence); a min/max not met = **Not Comply**. A class (EN 1886 TB / T / D / L, filter class) is a minimum on its scale: TB1 is best, F9 is better than F7. The remark is the datasheet value (the row's Response template filled in). Not used in a section people answer as site works or as standards (learned from the library, 5 answers or more). | No |
| 2 | **Library** (Compliance review) | A clause at or above the copy threshold (Settings, default 90% similar) is copied. A library answer this project's datasheet contradicts is **reopened**: the datasheet wins, as a blue draft that names both values. | No |
| 3 | **Same clause earlier in this record** | Proposed again: "Same clause as your answer to 1.04 H". | No |
| 4 | **AI rule with Answer + Remark** (the AI maps) | Applied as written. | No |
| 5 | **Other projects of the same factory** | A same-clause answer is proposed, ranked below the library, marked "not yet approved". | No |
| 6 | **The AI model** | Only when nothing above settles it, within the daily budget. It reads the rule book's **Instructions**, then: the clause's own `#` rules, the map rules, the knowledge-map branches that match, the datasheet rows, **Product Options** (values seen, special options, notes, **AI notes**), the library's 3 most similar answers, the answers given earlier in this section, other projects' answers, the parent clause. It writes; code checks (section 3). | Yes |

A clause with its own `#` rules (Internal Comments) goes to the model with them in front, when the model may be used.

## 3. Checks on every model answer (strict directions, 16 Oct 2026 night)
Every source in the message has an id: `[D1]` datasheet row, `[L1]` library answer, `[O1]` Product Options, `[N1]` AI
note, `[K1]` knowledge branch, `[R1]` rule, `[C1]` the clause's own `#` rule, `[F1]` fact, `[M1]` a correction people
made, `[E1]` an earlier answer in this spec, `[P1]` another project. The model must say which ids it used.

- **Comply, Comply with Remarks, Not Comply, Not Applicable** must cite a source that is in the message. No cite = one
  retry, then the clause is **left for a person** (not written, not guessed). Noted and In Contractor's Scope may cite
  the instructions.
- The model may say "no source supports an answer": the clause is left for a person. That is a correct answer.
- **Part 2 clauses with nothing on file** do not go to the model at all (strict mode). To let the model answer them
  anyway (always low confidence, "no source cited"), add the special note `Answer without a source: yes` to
  Decision steps > 8. AI model in the rule book.
- A number with a unit must be in a source the model **cited**, else `[value]` and low confidence.
- **Not Comply** needs a cited datasheet row or Product Options entry, a cited answer of Not Comply, or a cited
  rule / note / fact saying it is not offered.
- **High** confidence needs a cited library answer, rule, correction or datasheet row. The reason ends with
  "Used: ..." so a reviewer sees what it rests on.
- One of the six answers; the answer is not repeated in the remark; hedging words make it low.
- In the Excel, an AI draft's Comments say "AI draft (low confidence): <reason>"; low confidence has its own fill.

## 4. Steering it from the site
**a. Two kinds of map** - chosen in Maps when the map is made (*What it is for*), changeable in the map's settings:
- **AI rule book**: what the AI follows. A new one starts from the template.
- **Knowledge** (process or product understanding): maps as people always used them. The AI reads their **verified**
  branches that share telling words with a clause, as facts it may quote. A branch "to verify" is not a fact yet.

Compliance review > **AI rules** has, for *All AHU factories* and for *Riyadh only* (read first), one picker for each
kind: **Open in Maps**, **Create from template** (rule book). An older rule book without Instructions gets
**Add the new parts** (Instructions, Decision steps, Learned) without touching its rules. A rule book that has them
gets **Update from template**: missing parts and rules are added, and every template rule nobody has edited is brought
up to date (and moved to its template branch). A rule you edited is never touched.

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
  `Answer: Noted` - `Remark: Noted.` - `Unless: shall, provide` (the rule stops when the clause has any of these
  words; also inherited by the branches below). Answer + Remark = the rule answers by itself (no model). "To verify" = off.
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
- **The model is the small one** (Llama 3.1 8B, fast): about 8 neurons a clause, so the free 10,000 a day cover about
  1,000 clauses. The large one (Llama 3.3 70B) costs about 80 a clause; a rule book can ask for it with
  `AI model: large` under Decision steps > 8. AI model. Check the AI shows whether it is worth it.
- The model is used only in step 6. Steps 1-5 cost nothing. A 486-clause spec with a datasheet, a filled library and the
  starter rules typically needs the model for well under half its clauses.
- Daily budget (Settings) protects the free 10,000 neurons a day; when it is used up, proposals and the review continue
  from the free sources and say so.
- The Free plan allows about 10 ms of work per request. The heavy parts (chip match, library index) are kept between
  requests; if the site ever shows "Worker exceeded resource limits" (error 1102) on large records, the Workers Paid
  plan (USD 5 a month) lifts it.

## 6. Learned without being told (16 Oct 2026, from Thinkneering v3)
- **What kind of section a clause is in**: from the answers people gave in the library, per section title. Mostly
  "In Contractor's Scope" = site works; a standards / quality / submittals section citing standards = reference; the
  rest = product. Needs 5 answered clauses; the AI is told the kind, and a site-works or reference section is never
  answered from a datasheet figure.
- **What this unit does not have**: when a clause is about a section the project's datasheet does not contain (a heat
  wheel on a unit without one), the AI is told so and a Comply is shown as low confidence for a person to decide.

## 7. Learning from mistakes (16 Oct 2026 night)
Three ways, all from what people do in the record:
1. **Corrections become sources, at once.** When a person changes or replaces an AI draft, both are kept. The next
   clause that is similar (55% or more, same factory) shows the model the 3 closest corrections as `[M]` sources:
   "the AI answered X, a person answered Y instead", with the rule to follow the person. Citing one can give high
   confidence. Nothing to press.
2. **Repeated corrections become rules, after a person verifies them.** Every night (and on *Write to the map*), a
   change people made the same way 3 times or more becomes a branch under **Learned**, "to verify". Verify it to switch
   it on.
3. **Accepted answers become the library** through the review path, and a library answer at 90% similar is copied
   without the model.

So: always correct a wrong draft in the record (do not just delete it), and verify the Learned branches now and then.

## 8. Check the AI (how you see it learning)
Compliance review > AI rules > **Check the AI**: choose 10, 20 or 40 clauses and press **Run the check**. The site takes
clauses people answered in the library of that factory, hides each answer (and any correction on that same clause),
and lets the AI answer it as if it came in a new specification. Then it compares:
- **agrees**: the AI chose the same answer as people;
- **differs**: listed with the clause, both answers and the AI's reason. Each one is a lesson: write it as a rule in
  the rule book, an AI note in Product Options, or a branch in the knowledge map;
- **left for a person**: nothing on file supports an answer. Each one is a gap in what the AI knows.

Every check is kept (Earlier checks: date, model, prompt version, agreement). Run it after each change: the
agreement going up is the AI learning. 20 clauses cost about 200 neurons with the small model.

A fine-tune of the small model (a LoRA adapter) is the step after this, when rules and notes stop raising the
agreement and there are several hundred corrected or approved answers to train on. Training runs outside Cloudflare,
so it is a decision for the owner and the company.

## 9. Facts, and the AHU rule book
A rule book now has a **Facts** branch next to the Parts. A fact is something true about the units, written as it may
be quoted ("Daikin AHUs are Eurovent certified ..."), with a When line naming the clauses it is about. The AI cites
facts ([F1]) for Comply, Comply with Remarks, Not Comply and Not Applicable. A rule under a Part is an instruction
("state the offered insulation rather than Not Comply"): it tells the AI how to answer, but is never enough on its own
for an answer about the product. A Part 2 clause with only instructions on file waits for a person.

**Update from template** gives an AHU rule book:
- 27 AHU rules from the Riyadh Metro walkthrough and the v3 AHU library. Fixed answers only for scope (seismic and
  vibration-isolation design, contractor's documents, site storage, controls specified elsewhere, field tests); the
  others say how to answer fans, motors, casing and EN 1886 classes, insulation, coils, filters, dampers, drain pans,
  options, factory tests, submittals, warranty, spare parts, manufacturer's service and training.
- 13 facts: Eurovent certification (ranges and classes), AHU datasheet contents and IOM manuals are on; AHRI coils,
  AMCA, warranty period, factory acceptance test, spare parts, supervision, delivery and packing, insulation fire
  rating, motor standards and manufacturing come in **to verify**: open the rule book in Maps, check each one, edit
  it if needed and mark it verified. Until then the AI does not use it.
- A Riyadh-only rule book gets the KSA defaults (Besta panels, AAF filters, ebm-papst / Yilida EC fans, controls,
  filter bypass F9 / F7), to verify.

Values that change per project or factory stay in the datasheet and Product Options: the rules tell the AI how to use
them, the facts what is always true.

