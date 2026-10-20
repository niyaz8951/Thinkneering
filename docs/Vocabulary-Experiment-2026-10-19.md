# Vocabulary map - 10-line experiment and roadmap (19 Oct 2026)

Owner's direction (19 Oct 2026, night):
1. Datasheet values go to Product Options as now; a new value waits for an admin before users see it. **Built (migration 0007).**
2. Every project has a unique code that never repeats; Compliance review shows, filters and downloads the library by it, in the project's own section order. **Built (migration 0008).**
3. The rule book keeps rules as now and learns from admins' approvals and from Internal Comments after `#`.
4. A new map holds the Shazam-like vocabulary.
5. Two maps, two jobs: the **rule book** holds only instructions, prompts and if / then conditions (nothing about the product); the **vocabulary map** holds the product information and is what the AI refers to. Order of sources for an answer: project datasheet, then Product Options (what the factory offers), then the library (Compliance review), then the vocabulary map.

## 1. The experiment

Ten clauses of the Qiddiya AHU spec (23 73 13), chosen to cover every kind of requirement: material, standard, size, hours, a class on another scale, a percentage, a thickness, a filter class, a leakage rate. The datasheet was the Qiddiya Riyadh datasheet as the site reads it (15 units). The prototype is the fingerprint method of `Requirement-Fingerprints.md`: it reads landmarks (component, property words, standards, values with units, limit words, classes), pairs them, picks the requirement type by weighted vote, reads the level, finds the datasheet row of that type, and compares. It reuses the site's own unit and class code (`guard.ts`, `compare.ts`). A vocabulary of 10 types was written by hand, as the vocabulary map would hold it.

| Sr | Clause (short) | Type found | Required | Datasheet / fact | Verdict by code | Today's keyword chips |
|---|---|---|---|---|---|---|
| 2.1 A.2 | Casing: galvanised steel double skin insulated panels | casing.construction | galvanised, double skin | Inner skin galvanised 0.7, outer precoated 0.7 | open: material rule needed | Insulation only (wrong row) |
| 2.1 B.1 | Insulation materials: ASTM C 1071, Type II | insulation.material | ASTM C 1071 (glass fibre liner) | Foam | open: material vs standard | none |
| 2.1 C.c | Access door size: at least 600 mm wide, up to 1500 mm high | access_door.width | >= 600 mm (and <= 1500 mm height) | no row, no fact | open: capability needed | none |
| 2.2 F.1 | Bearings: rated life 120,000 h to ABMA 9 | fan.bearing_life | 120,000 h | no row, no fact | open: capability needed | none |
| 2.2 I.2 | NEMA Premium efficient motors (NEMA MG 1) | motor.efficiency_class | NEMA Premium = IE3 | IE5 | **Comply** (IE5 better than IE3) | IE5 (right row) |
| 2.2 J.c | VFD minimum efficiency 96 % at 60 Hz | vfd.efficiency | >= 96 % | fact: EC plug fans, no separate VFD | **Not Applicable** | none |
| 2.3 D.7 | Coils tested and rated to ASHRAE 33 and AHRI 410 | coil.rating_standard | ASHRAE 33 + AHRI 410 | no row, no fact | open: certification fact needed | none |
| 2.4 B.2 | Panel filters: thickness 50 mm | filter.thickness [pre-filter] | 50 mm | Filter 1: 48 mm | **Comply** (nominal 50, 4 % off) | both filters, no difference made |
| 2.4 C.5 | Bag filters: MERV (ASHRAE 52.2) 13 | filter.efficiency_class [final] | MERV 13 = F7 | Filter 2: ePM1 65 % (F7) | **Comply** | none |
| 2.5 A | Damper leakage to AMCA 500: not over 2 % at 1000 Pa | damper.leakage | <= 2 % at 1000 Pa | fact: class 2 to EN 1751 | open: equivalence needed | none |

**Results**
- Typed correctly: 10 of 10 (after the two fixes below; 8 of 10 before).
- Linked to the right datasheet row: 5 of 5 that have one (keyword chips today: 2 right, 1 wrong, 7 none).
- Decided by code with a checkable reason: 4 of 10 (2 Comply from the datasheet, 1 Comply across scales, 1 Not Applicable from a fact).
- Left open: 6 of 10. None of them for lack of identification: each needs one piece of product knowledge (a capability, a material rule or an equivalence) that is on no datasheet.

## 2. Challenges found (each one met on these 10 lines)

1. **A standard's number read as a value.** "MERV (ASHRAE 52.2): 13" was first read as MERV 52 and gave a Comply for the wrong reason. Fix (done in the prototype): standard designations are removed before values and classes are read. Rule: landmarks are read in a fixed order, standards first.
2. **The subject is in the heading, not in the line.** "Size: at least 600 mm wide by full height of unit casing" names the casing in passing; the subject is the access door in the heading above. Fix (done): a "Label: value" line takes its component from the nearest heading. Same lesson as today's topic gate.
3. **Qualifiers decide the row.** Panel filters are the pre-filter (Filter 1), bag filters the final filter (Filter 2). Without the qualifier the 50 mm and MERV 13 lines compare with the wrong filter. Fix (done): the nearest heading gives the qualifier; the datasheet's Filter 1 / Filter 2 are told apart by their class. The vocabulary needs qualifiers per component.
4. **One clause, several requirements.** The access door line asks a minimum width and a maximum height. Each needs its own level; the answer is the conjunction (as the comparison already does since this morning).
5. **Cross-scale equivalences are the core knowledge.** NEMA Premium = IE3, MERV 13 = F7 / ePM1 50-65 %, AMCA 500 % leakage vs EN 1751 classes, ASTM C 1071 (glass fibre) vs PU foam. Code compares only when an approved equivalence exists; these belong in the vocabulary map, approved by an engineer.
6. **Capabilities not on any datasheet.** Bearing life, access door width, coil certification: 3 of 10 lines. They need the factory's capability (standard / option / not offered, with a source), the second half of the vocabulary map.
7. **Nominal vs actual sizes.** A 50 mm filter is 48 mm on the datasheet. Each value type needs a tolerance (proposed: 5 % for nominal sizes, 0 for limits).
8. **Material words need a small rule set.** "Galvanised double skin" vs "inner galvanised, outer precoated": Comply with Remarks, decided by a material hierarchy (precoated galvanised is galvanised with a coating) the vocabulary holds.
9. **Applicability.** The VFD clause is Not Applicable only because a fact says the fans are EC without a VFD. "Component not in the offer" is a capability ("not offered") like any other.

## 3. The two maps

### Rule book (kind `rulebook`) - instructions only
Keeps: Instructions (the brief), Decision steps, Settings, the Parts' if / then rules (When / Unless / Answer / Remark), Learned. Loses: the **Facts** branch and any product statement; those move to the vocabulary map. The template is changed accordingly; "Update from template" moves an unedited Facts branch over, an edited one is listed for the admin to move.

### Vocabulary map - the product

> **Update, 20 Oct 2026:** the vocabulary lives in the factory's **knowledge map** (no third map, no new map kind): Compliance review > AI rules > Knowledge map > *Create from template* makes it with two branches, *Product facts* and *Vocabulary* (components > requirement types with Terms / Kind / Unit / Direction / Scale / Tolerance, and under each type "Offered (<factory>)" and "Equivalences", to verify). Templates exist for AHU, FCU and Chiller (`worker/src/ai/knowledge-template.ts`). The AI already quotes verified Offered and Equivalences branches; the fingerprint engine (step A) will read the vocabulary lines. The tree below is the idea; the template is the current form.
One per factory (owner, 20 Oct 2026: nothing shared between factories; each factory's team keeps its own), linked in Compliance review > AI rules like the others. Its tree, as Maps shows it (so it is edited, verified, imported and exported with the tools the team already uses):

```
AHU vocabulary
  Components
    Filter                         ! Terms: filter, filters, filtration, MERV, arrestance
      Qualifiers                   ! Pre: panel filter, prefilter, disposable panel   ! Final: bag, nonsupported media, final filter
      Efficiency class             ! Kind: class   ! Scale: G4, M5, M6, F7, F8, F9   ! Terms: MERV, ePM1, ISO Coarse, efficiency
        Equivalences               ! MERV 13 = F7   ! MERV 8 = G4   ! ePM1 50-65% = F7
      Thickness                    ! Kind: value   ! Unit: mm   ! Direction: equal   ! Tolerance: 5%
    Motor
      Efficiency class             ! Kind: class   ! Scale: IE1, IE2, IE3, IE4, IE5   ! NEMA Premium = IE3
  Materials                        ! Precoated galvanised steel includes galvanised steel ...
  Standards                        ! AMCA 500-D ~ EN 1751 (dampers): to verify per case ...
AHU Riyadh capabilities
  Fan                              ! Bearing life: ... h, standard, source ...
  Damper / Leakage                 ! Class 2 to EN 1751, standard, source: ...
  VFD                              ! Not offered: EC plug fans with integrated electronics
```

- Branch titles are the types; special notes hold the machine-readable lines (`Terms:`, `Kind:`, `Scale:`, `Unit:`, `Direction:`, `Tolerance:`, `X = Y`). A branch counts only when verified (super user or Maps admin), as for rule books.
- The site reads the map once a minute into a lookup table in memory (as `aiMapFor` does), so a lookup costs nothing per clause.
- The fingerprints of clauses and the template matching stay derived data in tables (rebuilt from the map and the library at any time).
- Size: Maps allows 2000 branches per map. 300-500 types per product fit; capabilities sit in the factory's own map, so they never crowd the vocabulary.
- Database change: one migration rebuilds `mp_maps.kind` to allow `vocabulary` (tested: no branch is touched) and `ai_map_links.role` likewise.

### Order of sources (owner's), and where the vocabulary acts
The vocabulary map is used **first to identify** (what the clause asks, which datasheet row and Product Options value apply, which filter) and **last to answer** (its capabilities and equivalences are consulted after the datasheet, Product Options and the library):

```
identify:  clause -> vocabulary map -> type, level, qualifier
answer:    1 project datasheet (row of that type) -> 2 Product Options (approved values of that type)
           -> 3 library (Compliance review: same type answered before, its wording)
           -> 4 vocabulary map (capability, equivalence, material rule)
           -> AI: remark, descriptive clauses, review; proposals to the maps (to verify)
rules:     the rule book's if / then rules and Instructions apply throughout (fixed answers, wording, scope)
```

## 4. Learning (item 3)

| What people do | What is learned | Where it goes | Status |
|---|---|---|---|
| Replace or edit the AI's answer, the same way 3+ times in a section | an if / then rule (Answer / Remark) | rule book > Learned | built (nightly), to verify |
| Write a `#` rule in Internal Comments, the same text on 2+ clauses of a section | a general rule for that section | rule book > Learned | to build, to verify |
| Approve a user's answer in Compliance review (review path) | the capability or equivalence it states ("IE5 motors"), the wording it uses | vocabulary map (capability, to verify) and the library (wording, as today) | to build |
| Give a clause a type by hand, or override a verdict | a term (synonym) or a qualifier | vocabulary map, to verify | to build |
| Run a spec with clauses no type fits | a proposed term, type or component (AI-made, with evidence) | vocabulary map, to verify (section 6a of the plan) | to build |

Nothing learned acts before a person verifies it.

## 5. Roadmap

| Step | Builds | Done when |
|---|---|---|
| A (3 days) | Migration 0009 (map kind `vocabulary`, link role), the vocabulary map template (the 10 types of this experiment plus the 25 properties already in code), its reader (terms, kinds, scales, equivalences, qualifiers, capabilities) with tests from these 10 lines | The 10 lines give the table above from the map, not from code |
| B (1 week) | Fingerprints on conversion (server only), type chips on the record page and in Focus mode, linking by type (keywords as fallback), project-code template matching ("same as P-2026-0001: n same, n changed, n new") | Qiddiya: every clause with a datasheet row linked by type; no wrong links |
| C (1 week) | Rule book split (Facts move to the vocabulary map; template and Update from template), the teach queue, learning from `#` rules, approvals and hand typing | An admin can grow the vocabulary from one spec in under an hour |
| D (1 week) | Decide by code in the owner's order; AI writes remarks, answers descriptive clauses, reviews; AI proposals for unplaced clauses (to verify) | Golden set of 50 clauses: no wrong Comply; agreement written down |
| E | Whole-record AI review back on (`AI_WHOLE_REVIEW`), only for clauses that changed vs the template; FCU and Chiller vocabularies | Review time per spec measured against today |

People's time: an engineer about 1 hour per 20 new types to verify, and the first equivalences (filters, motors, dampers, insulation) in one sitting.
