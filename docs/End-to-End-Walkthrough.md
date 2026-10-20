# End-to-end walkthrough: one datasheet, one specification, from an empty database to the final Excel

Version: 19 Oct 2026 (night), `main` after migration 0008 and the "no datasheet" path. Live at https://thinkneering.com.

Use it to reset the site, run the whole flow by hand, and read the code behind every step. The example is the pair used for every test so far: the **Qiddiya Tennis Center MEP2 R9 datasheet** (15 AHU units, Riyadh factory) and the **AHU specification 23 73 13** (437 rows, 404 clauses to answer). Section 9 repeats the flow **without** a datasheet.

---

## 0. The stack in one page

| Layer | What | Where |
|---|---|---|
| Hosting | One Cloudflare Worker `thinkneering-hub`: the static site and the API. Pushing to `main` on GitHub builds and deploys it (Workers Builds), applying new database migrations first | `wrangler.toml` |
| Pages | Plain HTML, CSS, JavaScript. No framework, no build step, no outside scripts or fonts. PDF reading uses a pinned copy of pdf.js in `public/assets/vendor/pdfjs/` | `public/` |
| Shared page code | `config.js` (site name), `api.js` (the **only** file that talks to the server: one function per route), `hub.js` (sign-in guard, top bar, sheets, toasts, dates) | `public/assets/js/` |
| API | TypeScript, compiled by wrangler. `POST /api/rpc/<name>`, JSON body, `p_token` first. One file per area | `worker/src/index.ts` (router), `worker/src/api/*.ts` |
| Rights | One module: session, super user, tile admin, "Can edit", project membership, map rights. **Every route checks on the server**; pages only show or hide | `worker/src/auth.ts`, `worker/src/lib/project.ts`, `canVerify` in `api/mp.ts`, `poApprover` in `api/po.ts` |
| Database | Cloudflare D1 (SQLite) `thinkneering-db`, binding `DB`. Schema only through numbered migrations, never edited after they ran | `db/migrations/0001` to `0008` |
| Files | Cloudflare R2 `hub-files`: datasheet tables (`notes/<project>/<note>.json`), map images. Never public; read through `/api/file` | `worker/src/api/files.ts` |
| AI | Workers AI (Llama 3.1 8B by default), called only from the Worker, within a daily budget. Offline copies use a stand-in (`AI_FAKE`) | `worker/src/ai/models.ts` |
| Tests | Vitest on the Worker routes (157 tests: allowed and refused for every route), a parity check that the two copies of the clause-to-row matcher agree, Playwright for the pages | `tests/worker`, `scripts/rows-parity.mjs`, `tests/e2e` |

Rule of the house (standards A.13.8): **the model writes, code compares.** Every AI answer is a proposal with a source and a reason; a person accepts it.

---

## 1. Reset to an empty site

1. **Note the time.** D1 Time Travel can bring the whole database back to any minute of the last 30 days (Cloudflare > D1 > thinkneering-db > Time Travel).
2. **Cloudflare > D1 > thinkneering-db > Console:** paste `scripts/reset-test-data.sql` and run it. The last line should show six zeros.
   - Kept: users and their rights, tiles and tools, products and factories, client types and regions, starter keywords, the project-code counter (codes never repeat), the audit log.
   - Deleted: projects and records, datasheet tables, the compliance library, Product Options values and notes, all maps (rule books and knowledge maps), the row mapping, AI tables, sessions.
3. **Cloudflare > R2 > hub-files:** delete the folders `notes/` and `maps/`.
4. Sign in again as the super user.
5. **Compliance review > AI rules:** choose AHU and **the factory** (e.g. Riyadh), *Create from template*. Every factory has its own rule book and knowledge map, kept by its own team; the AI never reads another factory's (20 Oct 2026). Verify the branches you want switched on (only the super user and Maps admins can). Repeat for each factory. Then, under *Knowledge map*, *Create from template*: the factory's knowledge map with **Product facts** (for AHU Riyadh, your former AI notes, to verify) and the **Vocabulary** of requirement types (AHU, FCU or Chiller) with an "Offered (<factory>)" branch under each. Open it in Maps, fill in and verify what the factory offers; only verified facts and offers are quoted by the AI.

Check that the database is up to date: `SELECT name FROM d1_migrations ORDER BY id;` ends with `0008_project_codes.sql`.

---

## 2. Create the project

**You:** Projects > New project: name "Qiddiya Tennis Center MEP2 R9", client type Contractor, client "MEP2 Contractor", region Saudi Arabia.

**What happens:**
- `pr_save` (`worker/src/api/pr.ts`) checks the name, the client type and the region against `pr_lists`, refuses a duplicate name of yours.
- In **one batch** (one transaction) it raises the counter `app_counters('project')` and inserts the project with its code `P-2026-0001`. The counter only goes up: a deleted project's code is never used again.
- History: "Project created" (`pr_log`).

**You see:** the project page with the code, and the next step **"Step 1 of 2 (optional): Read the datasheet first"** with two buttons: *Read a datasheet* and *Add a specification without a datasheet*. The tiles are numbered 1 (datasheet) and 2 (specification).

Code: `public/tools/projects/index.html` (list, new project), `project.html` (`nextStep()`, tiles), `pr.ts` (`pr_save`, `pr_get`, `projectDetail`).

---

## 3. Read the datasheet (step 1, optional but first)

**You:** *Read a datasheet*, product AHU, drop the PDF.

**What happens, in the browser:**
1. `ds-read.js` (`DSRead.file`) opens the PDF with pdf.js and keeps every text item with its position.
2. `ds-parse.js` (`DSParse.parse`) rebuilds the table: one column per unit (unit tags such as `HPTC-RF-AHU-N01`), sections and rows. Highlights of what it handles (19 Oct):
   - rows with the same name are kept apart by their sub-heading or section (Filter 1 / Filter 2, a second "Empty Section");
   - EN 1886 (`Mechanical Characteristic`: Casing Strength D1(M), Casing Leakage L1(M), Thermal Transmit, Thermal bridging) and EN 13053 (power, velocity, heat recovery classes) are read as rows (`CLASSES`, `classLine`);
   - heat-wheel Supply / Return values become sub-headings ("WINTER · Supply");
   - "Standard • Actual Pressure Drop" reads as "Standard Pressure Drop".
3. Each row gets its **key** (`group|sub|component`, e.g. `unit data||panel`) used everywhere after this.
4. The row mapping (`dn_rules` / `dn_add_rows`, `worker/src/api/dn.ts`): rows new to the product are added to the mapping with the **starter keywords and Remove text** (`dn_starter_keywords`; e.g. the power supply's "+ PE" is removed).
5. **Saved in the project:** `pr_note_save` stores the table in R2 (`notes/<project>/<note>.json`) and a row in `pr_notes` with the columns and the **factory** read from the datasheet (Material Name ...9 = Riyadh). A table read again **replaces** the earlier table of the same units.
6. **Product Options:** `po_collect` (`worker/src/api/po.ts`) records every value per factory and row. A value the factory has not shown before is saved as **"to approve"** (`approved = 0`): users, the Excel and the AI do not see it until the super user or a General-tile admin approves it (`po_admin_approve`).

**Example result:** 15 units, 313 mapped rows. *Panel 62 mm*, *Insulation Foam*, *Casing Leakage L1(M)/L1(M)*, *Filter 1: ISO Coarse 60% (G4)*, *Filter 2: ePM1 65% (F7)*, *Motor Efficiency Class IE5* ... Reading the same PDF again shows "in place of the earlier table of the same units".

**Check:** Datasheet Notes shows 15 columns; Download Excel opens; the project shows the table under "1. Datasheet notes"; Product Options > AHU > Riyadh shows the new values marked *to approve* (approve them: *Approve all*).

Code: `public/tools/datasheet-notes/` (`ds-read.js`, `ds-parse.js`, `datasheet-notes.js` `keep()`, `ds-xlsx.js`), `worker/src/api/pr.ts` (`pr_note_save`), `dn.ts`, `po.ts`, migrations 0005 and 0007.

---

## 4. Add the specification (step 2)

**You:** *Add a specification*, product AHU. The factory is **pre-selected from the datasheet** (Riyadh); choosing Dubai shows a warning. Drop the spec PDF, *Convert*.

**What happens:**
1. In the browser, `cm-engine.js` (`CMEngine.fromPdf`) reads the PDF and splits it into rows: Part, section (`2.1 UNIT CASINGS`), lettered and numbered items, with their Sr. Front matter and page headers / footers are dropped; a list of reference standards is split one standard per row (`AMCA 500-D | ...`).
2. `cm_save_run` (`worker/src/api/cm.ts`) saves the record (`cm_runs`, every row in `cm_run_lines`) and puts each **clause** into the factory's compliance library once (`cm_lines`, matched on the normalised text `norm_hash`, with its Part, section and place). A clause the library already answered comes back answered.
3. The page opens the record.

**Example:** 437 rows, 404 clauses, Part 1 / 2 / 3, sections 2.1 to 2.6 ...

Code: `public/tools/projects/add-spec.html` (`checkFactory`, `datasheetFactory`), `compliance-maker/cm-engine.js`, `worker/src/api/cm.ts` (`cm_save_run`, `runLine`), `worker/src/lib/cm.ts` (`cmNorm`, `placeRows`, `libraryKey`).

---

## 5. The record: clauses beside the datasheet

**You see:** the specification as a document (Read) or with boxes (Edit), the code and project at the top, and **blue chips** under clauses that ask about a datasheet row: *Casing Leakage: L1(M)/L1(M)*, *Filter Class · Filter 2: ePM1 65%(F7)* ...

**What happens:**
- `pr_run_get` returns the rows with the project's own answers, the library's answers and Internal Comments (the `#` part only for editors), and the **precedent** (the earlier record of the same factory that shares the most identical clauses).
- `pr-match.js` (`PRMatch.load`) and `cm-rows.js` (`CMRows.match`) link clauses to datasheet rows by the row keywords, with the **topic gate** (a filter row never links to a casing clause; a heading that names a part holds for the items under it). The server has the same matcher (`worker/src/lib/rows.ts`); `npm test` fails if the two disagree.
- Rows with the same key show each entry (Filter 1 and Filter 2), the newest table wins per unit.

**Example:** 42 clauses with chips; no VFD or wrong filter links.

Code: `public/tools/projects/record.html`, `pr-match.js`, `pr-options.js`, `compliance-maker/cm-rows.js`, `worker/src/lib/rows.ts`, `worker/src/api/pr.ts` (`pr_run_get`).

---

## 6. Answer the clauses: Focus mode, line by line

The whole-specification AI review is **switched off** (button says "coming soon"; the server refuses `ai_review_run` unless `AI_WHOLE_REVIEW = "1"`). People read clause by clause in **Focus mode**, for every user who can open the record.

**You:** *Focus mode*. One clause on screen, with the proposal for it.

**What happens for the clause on screen and the next two** (`ai_suggest`, `worker/src/api/ai.ts`; decision in `ai/decide.ts`, evidence in `ai/evidence.ts`, drafting in `ai/draft.ts`):

| Order | Source | Example |
|---|---|---|
| 1 | **Project datasheet, compared by code** (`compareDatasheet`): every figure and class the clause asks must be met on every unit (conjunction); ranges; % only against the same metric; Filter 1 and 2 that disagree settle nothing | "Casing leakage class L2 or better to EN 1886" -> L1(M) on all units -> **Comply**, no remark, reason "L1 better than L2 ..." |
| 2 | **Library answer** of a near-identical clause (same factory), unless the datasheet contradicts it or its remark states a figure this datasheet does not show | "Comply" copied, reason "Same requirement as a library clause (0.96)" |
| 3 | The same clause answered earlier **in this record** | |
| 4 | A **rule** of the rule book that answers by itself (site works -> In Contractor's Scope, "By Contractor / others. Daikin scope is supply of equipment.") | Part 3 "Rigging and hoisting ..." |
| 5 | The same clause answered in **another project** (not yet approved) | |
| 6 | The **model**, with the sources it may cite: datasheet rows [D], Product Options [O], knowledge maps [K], rules [R], corrections people made [M], library answers [L] ... Without a source on file, a Part 2 clause is left for a person | |

Then **code checks every draft** (`ai/guard.ts`, `lockRemarks`): a clean Comply has no remark; Comply with Remarks needs one; Not Comply / Not Applicable need a reason; banned wording (an internal source named, "please verify", TBC, a promise of a later document, hedging) makes it low confidence. Each draft gets a **priority**: GREEN (rule, earlier answer, datasheet Comply, identical library answer), AMBER (check), RED (low confidence, Not Comply, contradicts the datasheet or the precedent).

**You:** *Accept* (keep), or edit and save. Nothing is written until you save. Your save is also the feedback the AI learns from (`ai_feedback`).

Code: `compliance-maker/cm-focus.js` (the pane), `record.html` (`proposal()`), `worker/src/api/ai.ts` (`ai_suggest`), `ai/decide.ts`, `ai/evidence.ts`, `ai/draft.ts`, `ai/guard.ts`, `ai/compare.ts` (units, scales, metrics), `ai/rules.ts`, `ai/map.ts` (rule book, Instructions, settings), `ai/search.ts` (similar library clauses).

---

## 7. Where answers go: the review path and the library

- Your answer is the **project's** answer at once (`pr_run_save_line`). If the library had no answer, or another one, yours goes to **review** (pending).
- **Compliance review** (`compliance-maker/library.html`, `cm_admin_lines`): editors see every clause of the factory, in reading order, with the **project codes** whose specs hold it, the users' answers, and *Use this answer* / *Do not take* (`pr_review_decide`). An approved answer becomes the library's (`cm_lines`, logged in `cm_answer_log`).
- **Project filter:** choose `P-2026-0001`: only that project's clauses, in its own section order. *Download library* then downloads just those, with a *Project codes* column.
- Internal Comments: the note shows to users; text after `#` is an AI rule for that clause only.

---

## 8. The final Excel downloads

From the record page:

| Button | File | Contents |
|---|---|---|
| **Download Excel** | `spec - compliance.xlsx` (`_DRAFT` in the name while any clause is open) | For the consultant: Sr, Specifications, Compliance, Remarks. No internal comments, no colours, no sources. AI drafts nobody checked are left blank |
| **Download working Excel** | `spec - compliance (working).xlsx` | For the team: the same plus colours, priority / confidence / reason in comments, and sheet 2 **Datasheet rows** (each datasheet row, the clause that asks, the value per unit) |

Also: Project > *Download project (Excel)* (everything of the project), Compliance review > *Download library* (whole factory or one project code).

Code: `compliance-maker/xlsx-writer.js` (`build`, `buildSheet2`, `buildLibrary`), `record.html` (`excelRows`, `sheet2`, `selectionSheet`), `projects/pr-xlsx.js`.

---

## 9. The same flow without a datasheet

Skip step 3: *Add a specification without a datasheet*. The add-spec page says what that means.

**What changes:**
- **Record page:** under the clauses about a datasheet row, **dashed chips** say what to select in the selection software, from the factory's **approved** Product Options values:
  - one value seen: *Panel: select 62 mm*;
  - the clause asks a figure and a value meets it: the closest one (an exact match first, then the nearest figure, then the most seen): *Panel: select 50 mm*;
  - several values, nothing to compare: *Insulation: choose: Foam (60×), Mineral wool (1×)*;
  - values seen but none meets: *none seen meets it: ask the factory*.
- **Focus mode:** a clause whose figures are all met by Product Options values gets **Comply, medium confidence, AMBER** (never green: the units are not selected yet), reason "No datasheet in this project. From the approved Product Options of Riyadh: Panel: 50 mm (seen 3×) meets 50 mm. Select it in the selection software."
- **Working Excel, sheet 2 = Selection list:** Section | Component | what the spec asks (with the Sr and the clause) | **Select in the software** | Options seen (Riyadh) with how often. This is the list the engineer selects from.
- Once the units are selected, read the datasheet into the project: everything switches to the datasheet (step 5 on).

**Example (Qiddiya spec, Riyadh, no datasheet):** 42 clauses with dashed chips, 26 rows on the Selection list: Panel 62 mm, Panel Inner Skin Galvanized 0.7 mm, Casing Strength D1(M), Filter Class "Choose: ePM1 65%(F7) / ISO Coarse 60%(G4)" ...

Code: `worker/src/ai/evidence.ts` (`optionPicks`, `compareOptions`, `picksFor`), `worker/src/api/ai.ts` (`pr_run_selection`), `ai/decide.ts` / `ai/draft.ts` (source `options`), `record.html` (`optChips`, `loadSelection`, `selectionSheet`).

---

## 10. Test checklist (tick as you go)

- [ ] Reset ran; six zeros; R2 folders emptied; signed in again; AHU rule book created from the template
- [ ] Project created with code `P-<year>-0001`-style; renaming keeps the code; the list search finds it by code
- [ ] Project page leads with "Step 1 of 2 (optional): Read the datasheet first"
- [ ] Datasheet: 15 units, rows as expected; read again replaces; factory Riyadh; Product Options shows new values *to approve*; approve them
- [ ] Spec: factory pre-selected; warning on Dubai; 404 clauses
- [ ] Record: code at the top; blue chips on the right clauses (Filter 1 / Filter 2 both shown)
- [ ] AI review button: "coming soon" sheet
- [ ] Focus mode: proposals with reasons; a datasheet Comply has no remark; accept and edit work
- [ ] Compliance review: project filter by code, in spec order; *Use this answer* moves a user answer into the library; download by code
- [ ] Downloads: consultant Excel has four columns and `_DRAFT` while open; working Excel has the Datasheet rows sheet
- [ ] Second project without a datasheet: dashed chips; Focus proposal from Product Options is AMBER; working Excel has the Selection list
- [ ] Maps: a plain user's new branch is *to verify*; only the super user / Maps admin verifies
- [ ] Day and night themes, phone width (390 px) on the project, record and Focus pages

For developers (laptop): `npm install`, `npm test` (Vitest + parity), `npm run typecheck`, `npm run dev:offline` (local copy with a stand-in model, demo users `admin` / `admin12345`).

---

## 11. Known limits (honest list)

- Clause-to-row linking is by keywords plus the topic gate; good but not by meaning. A cross-scale clause (NEMA Premium vs IE5, MERV 13 vs F7) is not compared by code yet: it goes to the model. The vocabulary map (`docs/Vocabulary-Experiment-2026-10-19.md`, steps A to E) is the fix.
- Product facts that are on no datasheet (bearing life, access door width, coil certification) are answered only when a knowledge-map branch or the library says so.
- The datasheet reader is proven on AHU (Riyadh / Dubai format). FCU works; Chiller is not built.
- The AI's agreement with people has not been measured on real data yet (Compliance review > AI rules > *Check the AI*).

## 12. Code map

```
public/
  assets/js/api.js              every server call (one function per route)
  assets/js/hub.js              sign-in guard, top bar, sheets, toasts, dates
  tools/projects/               index.html (list), project.html (steps, tiles), add-spec.html, record.html,
                                compare.html, note.html, pr-match.js (chips), pr-options.js, pr-xlsx.js
  tools/datasheet-notes/        ds-read.js (PDF), ds-parse.js (table), datasheet-notes.js (save), ds-xlsx.js
  tools/compliance-maker/       cm-engine.js (spec PDF -> rows), cm-rows.js (matcher, browser copy),
                                cm-focus.js (Focus mode), library.html (Compliance review, AI rules),
                                xlsx-writer.js (all compliance Excels)
  tools/product-options/        product-options.js (tree, approval), mapping.html / mapping.js (row mapping)
  tools/maps/                   maps.js (maps, verify, import / export outline)
worker/src/
  index.ts                      router: /api/rpc/<name>, /api/file, /api/ping
  auth.ts                       sessions, roles, rights, audit
  api/app.ts                    sign-in, users, tiles, tools
  api/cm.ts                     conversion, library, Compliance review, export
  api/dn.ts                     row mapping, starter keywords
  api/po.ts                     Product Options, approval
  api/pr.ts                     projects, records, datasheet tables, review path, codes
  api/mp.ts                     maps, branches, verification
  api/ai.ts                     Focus proposals, selection list, AI rules page, Check the AI
  ai/evidence.ts                everything a clause's answer may rest on; datasheet and Product Options comparisons
  ai/decide.ts, draft.ts        the order of sources and the draft
  ai/guard.ts                   remark lock, banned wording, priority, measurements
  ai/compare.ts                 units, conversions, class scales, metrics
  ai/map.ts, rules.ts           rule books, Instructions, rules and facts
  ai/search.ts, sections.ts     similar library clauses, section kinds
  ai/learn.ts, eval.ts          learning into Learned, Check the AI
  lib/rows.ts                   matcher (server copy), unit lookup
  lib/cm.ts, project.ts, sql.ts library keys and order, project rights, SQL helpers
db/migrations/0001..0008        the schema, in order
scripts/reset-test-data.sql     section 1
scripts/rows-parity.mjs         the two matchers must agree
tests/worker/*.test.ts          157 route and logic tests
```
