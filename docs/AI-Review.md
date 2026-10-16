# AI review - what it does, step by step, and how to steer it

For the owner and the library admins. Plain words; the code is `worker/src/api/ai.ts` (the loop),
`worker/src/ai/search.ts` (similar clauses), `worker/src/ai/rules.ts` (rules, facts, datasheet rows),
`worker/src/ai/draft.ts` (one answer) and `worker/src/ai/guard.ts` (the checks). Updated 16 Oct 2026.

## 1. Where it is and who can use it

- **AI review** button on a compliance record inside a project. Admins of the Projects tile and the super user
  only; the server checks it on every call. Nothing runs by itself and nothing runs on page load.
- **Compliance review > AI rules**: the rules and facts the review uses, per product, for every factory or one.
  Admins of the Compliance Maker tile and the super user only (plain "Can edit" users answer the library but do
  not steer the AI for everyone).
- Model: Workers AI `llama-3.3-70b-instruct`, through the AI Gateway "hub". The specification never leaves Cloudflare.

## 2. What one click does

A window opens and holds the page until the review is over and you press **OK** (Esc, a click outside or leaving
the page do not close it; **Stop** ends it after the current batch). It first makes one tiny call to the AI
(`ai_check`, a few neurons): if the AI cannot be reached or today's allowance is used up, it says so in plain words
and nothing is tried. Then it drafts in batches of 10 and shows how many came from the library, from AI rules and
from the AI, and which could not be drafted (those stay empty and are not tried again in the same review).

**Allowance.** On the Workers Free plan Workers AI gives 10,000 neurons a day, about 140 clauses with the 70B model;
it resets at 04:00 Dubai time. When it runs out the review stops at once and says so. Whole specifications need
the Workers Paid plan (USD 5 a month; a 500-clause spec costs about USD 0.30).

**AI Gateway.** Calls go through the gateway named in `AI_GATEWAY_ID` ("hub") so they are logged there. If that
gateway does not exist or refuses the call, the Worker calls Workers AI directly instead (and says so in its log).
The calls show in the dashboard under AI > AI Gateway > default.

For each clause:

1. **Is it open?** Only clauses linked to a library line, with no person's answer and no library answer.
   A person's answer is never touched; the library is never written.
2. **Gathers what is known**, all scoped to the record's product and factory:
   - the 5 most similar library clauses (words and word pairs; Vectorize when switched on);
   - the clause's own **AI rules** (`#` in its Internal Comments, section 4);
   - the **site rules and facts** whose keywords the clause mentions (section 5);
   - the **project's datasheet rows** that concern the clause: the newest Datasheet Notes table of the same
     product saved in the project; only rows of the section the clause is about (a casing clause never gets the
     coil's tube thickness), values per unit ("62 mm (FAHU-01, FAHU-02), 50 mm (FAHU-03)");
   - the **parent clause** when it is a list item ("1. Cooling coil section." is read with "B. The unit shall
     include the following:").
3. **Answers in this order, stopping at the first that applies:**
   1. a library clause at **>= 0.90** similarity, answered in one of the six words, with no `#` rules on either
      side -> **copied**, no model. Confidence high.
   2. a **site rule with a fixed answer and remark** whose keywords the clause mentions -> **applied**, no model.
      Confidence high. Reason: `Site rule "Unloading at site" (clause mentions unloading).`
   3. otherwise **the model**, given everything above, strongest first: the clause's own rules, the site rules,
      the datasheet rows, the library answers, the factory facts, general knowledge (low confidence only).
4. **Code checks the model's answer** before anything is written:
   - the answer must be one of the six words; a reply that is not JSON or not one of them is **asked once more**
     with the reason; a second failure leaves the clause empty and reports it;
   - **every number with a unit** (mm, kW, Pa, m/s, %, hours ...) in the remark must appear in a source it was
     given (library answer, rule, fact, datasheet row, note). The clause itself is not a source: it says what is
     required, not what the product is. An unsupported number becomes `[value]`, confidence low, and the reason
     says `Check: no source gives 42 kg/m3, check the value.`;
   - a remark that repeats the answer ("In Contractor's Scope. In contractor's scope ...") is trimmed;
   - hedging words (should, typically, approximately, likely) -> confidence low;
   - **Not Comply** is only kept when a rule, a datasheet row or a library answer backs it; a guessed Not Comply
     is dropped and the clause reported ("answer this clause yourself");
   - confidence "high" only when a library answer, a rule or the clause's own rule backs the answer.
5. **Writes a draft on the record**: blue row, "AI draft, check it", the reason as a visible line, the sources
   (library clauses, rules, facts, datasheet rows), the model and the prompt version (`draft-2026-10-16`, or
   `rule-2026-10-16` for rule answers). The project log gets one line per hour; `app_audit` one row per batch with
   counts (drafted, copied, by rule, failed) and tokens.

## 3. What happens to a draft
Keep it (or edit it) and save: it becomes that person's answer. Clear it, or "Remove AI drafts": rejected.
Accepted answers reach the library only through the existing review path (`pr_review_decide`).

## 4. Rules for one clause: `#` in Internal Comments

```
Check the coil schedule.  # value is in the datasheet next to Cooling coil load kW  # answer Comply with Remarks
```
- Before the first `#`: the **note**. Users see it beside the clause, as before.
- Each `#` starts an **AI rule** for that clause. Only the library's editors see it; users get the note only
  (the server strips it). The model is told a clause rule wins over everything else.
- A clause with its own rule is never copied blindly; the reason starts with "Followed the clause's AI rule."
- `#` rules on a **similar** library clause are shown to the model as hints, and stop a blind copy of that line:
  write `# project-specific, do not reuse` on an answer that only fits one project ("as per IFC schedule").
- With the datasheet rows now given to the model, `# value is in the datasheet next to Cooling coil load kW`
  works when the project has a saved datasheet; without one the model leaves `[value]`.

## 5. Rules for many clauses: Compliance review > AI rules

Choose the product and factory, open **AI rules**, press **Add a rule**.

| Field | What it does |
|---|---|
| Rule / Fact | A **rule** says how to answer clauses like these. A **fact** says what the factory offers; the model may quote it, numbers included. |
| Applies to | Every factory of the product, or this factory only. A factory's own rule comes before the product's. |
| Part | Any, or Part 1 / 2 / 3. A Part rule waits when the clause's Part is not known. |
| When the clause mentions | Words or phrases, commas between; any one is enough. `install` also finds installation and installed; `casing` also finds panel, skin, enclosure. Empty = every clause of the Part. |
| What the AI should do / The fact | A plain sentence. |
| Answer + Remark | Optional. **Both** set = matching clauses get exactly this answer without the model. Keep these for narrow, unambiguous phrases. |
| On | Switch a rule off instead of deleting it. |

**Try a clause** (same tab) pastes a clause and shows which rules and facts apply and whether a rule answers it
by itself. No AI is called. Use it to tune keywords before relying on a rule.

Good habits (learnt on the AHU Riyadh library):
- Broad verbs make bad fixed answers. "install" appears in "Install filter gauges" (factory-supplied, Comply);
  "rigging" in "lifting lugs for field rigging" (Comply). Give broad words an instruction only, and keep fixed
  answers for phrases like "unloading", "concrete base", "level and plumb".
- One subject per fact, with the numbers you stand behind ("62 mm panels, PU foam, 1.0 mm precoated skins").
- After adding rules, run a review on a known spec and read the reasons: they name the rule used.

## 6. Starter rules for AHU Riyadh
`starter-rules-ahu-riyadh.sql` (delivered with this version, not in the repo) holds 10 rules and 12 facts written
from the answers in the Riyadh library. Checked against its 3,694 clauses: the four fixed-answer rules fire on
46 clauses and agree with the person's answer wherever there was one, except two nuances (training: Comply vs
Comply with Remarks; "Flexible Duct Connections": Not Applicable because of EC plug fans). Edit them freely.

## 7. Uploading a library
Answers are put in the six standard words on upload ("By contractor" -> In Contractor's Scope, "Complied" ->
Comply, "Comply as noted" -> Comply with Remarks when there is a remark, "-" -> empty). Other text in the
Compliance column stays as written; the AI does not copy such a line blindly. The upload result says how many
were changed (231 of 516 in the Riyadh file).

## 8. Quality and cost
- `app_audit` action `ai_review_run`: drafted, copied, by rule, failed, rules, datasheet rows, tokens per batch.
- `ai_drafts.prompt_version` + `status` (accepted / edited / rejected): acceptance per prompt and per source.
- Tests: `tests/worker/ai.test.ts`, `tests/worker/ai-rules.test.ts`, `tests/e2e/ai-rules.spec.ts`.
- Next (Design brief Phase 3): a golden set from reviewed records and `npm run eval:live`.
