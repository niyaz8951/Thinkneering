# Rule test run - 22 Oct 2026

The hub's own code run on one spec and one datasheet, every clause checked by hand. Repo `niyaz8951/Thinkneering` at `e0ebeba`.
No library, no Product Options, no AI notes, no model: what a first project of a factory gets from rules alone.
Workbook: `Rule-Test-Run-2026-10-22.xlsx` (Summary, Clauses with pipeline vs expected answer, Datasheet as read).

Inputs
- Spec: Arcadis 237413 Large Outdoor Roof Top AHU, KSA Automotive Supplier Park (11 pages, 222 clause rows).
- Datasheet: ASTRAWEB report HILTOP FINAL_R1_COPY, 78 pages, 7 units (CTA AN/AR, FAHU-01, KMAU-RF-01/02, FAHU-RF-01/02/03), Material Name ...5 = Dubai.
- Not the same project (test pair). The datasheet is selected at **ROMA URBE, Italy**, summer 35 °C, **400 V / 50 Hz**: for a KSA job the
  tool should warn on location and frequency.

Run: `ds-parse.js` and `cm-engine.js` in Node on the PDFs; `lib/rows.ts match` with the starter keywords of a fresh AHU mapping;
`evidence.ts compareDatasheet`; the AHU rule book template (`seedTree`, 36 rules); the AHU vocabulary template (118 types);
draft order of `draft.ts` (datasheet, rule, else model / person).

## Result

| | Clauses |
|---|---|
| Answered by code from the datasheet | 11 (5 right, 1 right verdict with wrong reason, **5 wrong, 3 of them a false Comply / CwR**) |
| Answered by a scope rule | 34 (all right) |
| Sent to the model / left for a person | 83 / 94 |
| Expected answer comes from the datasheet | 67, of which code got **5 right (7 %)** |
| Part not in these units (heating coil, heat pipe) | 22, none recognised as Not Applicable |
| Needs a factory fact (AI note / library) | 56: correctly left open |

Extraction is good: 7 units, 131-239 rows each, Filter 1 / Filter 2 split, EN 1886 and EN 13053 classes read, options under
their section, factory and power supply read. Spec reading is good: Parts, headings, lettered items, class table rows.
The weak link is **clause to row to verdict**.

## Wrong answers (fix first: a false Comply is the worst failure)

| Row | Clause asks | Code compared | Code said | Right |
|---|---|---|---|---|
| 79 | C channel min 2.8 mm | AHU base **100 mm** (height) | Comply | open: not on datasheet |
| 212 | Heat pipe fins min 0.14 mm | DX coil **fin spacing 2.5 mm** | Comply | Not Applicable (no heat pipe) |
| 191 | View port 200 mm diameter | **panel 42 mm** ("double-walled" hit "double wall") | Comply with Remarks | Not Comply (no window option) |
| 144 | Fin 0.10 mm, spacing min 2.0 mm | fin **thickness 0.1 mm vs 2.0 mm spacing** | Not Comply | Comply (0.1 mm, 2.5 mm) |
| 214 | Heat pipe tube dia min 12.7 mm | DX coil **tube thickness 0.35 mm** | Not Comply | Not Applicable |
| 90 | "less than 60 mm will not be permitted" | read as *maximum* 60 | Not Comply because 62 mm > 60 | Not Comply because 42 < 60 (FAHU-RF-03 62 mm complies) |

Causes: (1) a figure is compared with any row whose keyword stands within 8 words and whose unit family matches;
(2) a heading naming a part the units do not have (heat pipe, heating coil) does not stop the comparison; (3) negated limits
("less than ... will not be permitted") flip to a maximum.

## Gaps and improvements, in order

### A. Stop false verdicts (code, small)
1. **Pair each figure with its own requirement type.** A number is compared only with the row of the vocabulary type it belongs to
   (the type's Row), never with any nearby row. No type, no verdict. Fixes 79, 144, 191, 212, 214.
2. **Part-not-in-unit gate.** Give every datasheet section a component (coil CHW / DX / heating, heat wheel, heat pipe, attenuator,
   louver ...). A clause under a heading of a component the datasheet lacks gets no rows; "wherever applicable", "as per equipment
   schedule", "as indicated on schedules" then make it Not Applicable by rule (22 clauses here). Add `heat pipe` to the recovery topic.
3. **Negated limits:** "less than / smaller than / below X ... will not be permitted / not accepted / not allowed" = minimum X.
4. **Test conditions are not requirements:** "-400 Pa / +700 Pa" beside a class, "at 24 bar", "at 2.50 m/s" in a condition.
   Today "-400 Pa" left the L1 rows without a verdict.

### B. Answer what the datasheet already says (the 59 missed)
5. **Link by the vocabulary Row** (the planned "Next" step), keywords as fallback. Today Part 2 is searched first, so the Part 1
   Eurovent class table lost its rows: casing leakage went to the heat-wheel purge clause, thermal bridging to a profile clause.
   The trial link by type (rows 37-41) gave D1 Comply and TB4 vs TB2 Not Comply correctly.
6. **Fix the vocabulary Row keys:** coil types point only at `coil cooling water supply|...` (this datasheet is DX: nothing links);
   fan type and motor class point only at the return fan; pre-filter and final filter both at `filter supply||filter class`
   without Filter 1 / Filter 2; damper blades at `mixing box supply|damper one supply|material` (this sheet has `damper supply||material`).
   Allow a Row pattern (`coil cooling *|geometry|tube thickness`) and a qualifier (`#1` pre, `#2` final).
7. **Compare choice and presence types by code**, not only figures and classes. Each would have been right here:
   Roof No vs roof required (all 7 units, Not Comply); single centrifugal fan vs EC fan array; IE3 vs IE4; profile without thermal
   break vs polyamide thermal break (FAHU-01 has it); inner skin galvanized vs stainless; coil frame galvanized vs SS304; fin "Al Pr"
   vs Heresite; insulation foam vs PIR (CwR); drain pan option SS304 (Comply); viewing window, lamps, attenuators, sand trap louver
   not in the Options List (Not Comply until selected). Needs per type a short value map (`Aluminium Natural` = no thermal break).
8. **Composite cells:** `Precoated 0.7 mm`, `Galvanized 0.5 mm`, `Al Pr 0.1 mm`, `100mm Galvanized` hold a material and a figure:
   the type takes its part (skin thickness 0.7 < 1.2 mm; fin thickness 0.1 mm; base height 100 < 150 mm).
9. **Derived checks:** SH/TH from Sensible / Total capacity: 0.37-0.61 on every unit, so moisture eliminators are required on all;
   the datasheet has them on 4 units, missing on CTA, FAHU-01, FAHU-RF-03. Face velocity 2.64 / 2.59 m/s on FAHU-RF-02 / 01 > 2.5.
10. **Per-unit verdicts:** units differ (T2 / TB2 / thermal break only FAHU-01; 62 mm only FAHU-RF-03; glass fibre F7 only CTA and
    FAHU-01). The answer should name the units, e.g. "Not Comply: T3(M) on 6 units; T2(M) FAHU-01".

### C. Datasheet extraction
11. Read the **NRVU block** (EATR 2.23-2.69 %, OACF 1.06 / 1.29, external leakage L2(R), SFP int, drive "inverter not included"):
    the spec asks OACF < 1.1 and EATR = 0 (CTA fails OACF; EATR fails everywhere).
12. Read the **Sound Report** (Lw per band, LwA), **Electrical Power Inputs** (kW - A per motor) and **Section List**
    (section weights, "Special Truck" on FAHU-RF sections) as rows.
13. **Option over unit data:** Unit Data says Drain Pan Precoated, the Options List says DrainPan SS304. The option wins.
14. **Header warnings:** selection location and frequency against the project country; spec asks chilled-water coils, datasheet
    has DX (flag the section, then answer the coil clauses on the DX coil with a remark).

### D. Vocabulary hygiene (false types seen)
15. Generic words recognise the wrong type: "RATING" (filter table "EN779 RATING G4") -> Coil rating, never Pre-filter G4;
    bare "stainless steel" (exposed screws) -> Drain pan material; "diameter" (view port, heat-pipe tube) -> Wheel size; "length"
    (damper blade 1.2 m) -> Attenuator length; "lock" (locked-rotor) -> Door latches; "capacity" -> Humidifier capacity.
    Rule: a generic property word counts only with its component in the clause or heading.
16. Missing types met in this spec: base frame height, base channel thickness, fin thickness, profile rounding radius, screw
    material, view-port diameter, lamp IP, damper blade length, drain-pan extension, service-section length, wheel speed (rpm),
    wheel pressure drop per face velocity, EC fan array (type EC + quantity), panel sound reduction per band.

### E. Spec reader and rules
17. Table rows ("EN779 RATING | G4") have no parent: attach them to the nearest heading (PRE-FILTER / BAG FILTER), else the
    pre and final filter tables cannot be told apart. Merged cells in rows 133-134.
18. "Refer to CEER Vendor list 1) CONSTRUCTION": a heading glued to the item above.
19. References listed as item B under "Section includes": AMCA 99 went to "Fan selection", SMACNA to the model ("standards"
    is an Unless word of Scope statements). Let "Reference standards" also match on the parent heading "REFERENCES".

Estimate (not measured) after A + B: of the 67 datasheet-answerable clauses, roughly 50-55 decided by code with a checkable reason; the 22
Not Applicable by rule; zero false Comply on this pair. That is the next golden-set check.

## Repeated clauses across projects: choosing one answer (proposal, not decided)

The same requirement comes back in every project with a different sentence and a different answer. Picking "the most similar
sentence" gives a random one of them. The answer is a function of **what is asked and what is offered**, not of the wording.

1. **Key every answer by fingerprint + offer:** vocabulary type, level asked (band: >= 50 mm), the offer on that project's
   datasheet for that type (42 mm foam), factory. Two projects asking "panel >= 50 mm" with a 42 mm offer share one key; with a
   62 mm offer it is another key.
2. **Store answer patterns, not answers:** verdict + remark template with slots (`Panel thickness is $ ($units).`), figures
   removed, plus the conditions it relies on (EC fans, thermal break profile, option selected). Built nightly from approved record
   lines and accepted / edited AI drafts; no model.
3. **Code decides the verdict** (comparison with this datasheet); history only gives the wording, and only patterns whose
   conditions hold on this datasheet are eligible ("EC plug fans are provided" never lands on a centrifugal unit).
4. **Rank** the eligible patterns: approved library 3, accepted by a reviewer 2, accepted AI draft 1, edited -1, rejected -2;
   x recency (half-life about 12 months); x 1.5 same consultant or same spec template. Show the winner and "2 other ways (7x, 2x)".
5. **Consolidate:** a pattern with 70 % or more of the last 10 uses of its key becomes the canonical library answer for that
   key (one line instead of fifty near-duplicates); when the last 3 uses disagree with it, the library team gets a drift flag.
6. **Consultant memory:** a consultant who wants "Complied" or a fixed remark style gets his accepted wording first.

Data: `cm_answer_patterns` (factory, type, verdict, offer class, template, conditions, uses, wins, last used), derived from
`cm_run_lines`, `ai_feedback` and the requirement fingerprints (Requirement-Fingerprints.md). It slots between steps 2 and 5 of
`draft.ts` and replaces "same clause in another project" ranking.

## Status, 22 Oct 2026 (later)
Items 1-4 of "Gaps and improvements" (A. Stop false verdicts) are built: PR #11, branch `fix/comparison-gates`. On this pair: wrong code verdicts 5 -> 0; datasheet-answerable clauses decided right 5 -> 9 (L1 at -400 / +700 Pa, fin 0.1 / 2.5 mm, panel reason); 20 clauses marked "not in this unit" (heating coil, heat pipe, attenuator). Not Applicable by rule (item 9) is still to do.

## Status, 22 Oct 2026 (last)
Items 6-10 of the improvement list are built too (PR #11): vocabulary Row keys, generic words with their component, table
rows under their heading, Reference list rule, Not Applicable for an absent part asked "where applicable / as scheduled",
NRVU and Electrical Power Inputs rows, location / frequency warning against the project's region. On this pair: decided
right 42 -> 51 (of 222), Not Applicable by code 9 (heat pipe 211-217, heating coil 155, attenuator heading 195), 19 false
vocabulary types gone, the datasheet now carries EATR 2.23-2.69 % and OACF 1.06-1.29 (the purge clause can be compared once
it is linked), and the record warns "selected at ROMA URBE, Italy ... Saudi Arabia uses 60 Hz". Left: item 5 (starter
keywords), linking by vocabulary Row, choice / presence comparison (items 7-10 of the report's list B).

