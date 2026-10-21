# The compliance process, reimagined (21 Oct 2026)

One sentence: **recognise what each clause asks, look up what the factory offers, let code compare, let the AI write and
review, and let a person decide.** Like Shazam: a song is not searched for by its lyrics but recognised by a few
landmarks; a clause is not searched for by its sentence but recognised by its landmarks.

## 1. Where everything lives (one home per kind of knowledge)

| Knowledge | Home | Kept by | Example |
|---|---|---|---|
| What specifications **ask**, in their words | **Vocabulary map**, one per product (AHU, FCU, Chiller) | Admins (engineering language, same for every factory) | *Casing air leakage class*: Terms "air leakage, air tightness"; Anchors L1-L3; Scale L3 < L2 < L1; EN 1886; Row "mechanical characteristic (en1886)\|\|casing leakage" |
| What a factory **offers** | **Product Options** of that factory: approved datasheet values (grouped per filter, per profile), special options, notes, **AI notes** (admins) | Each factory's team | Riyadh, profile Aluminium Natural: L1(M); Filter 1 G4 Chevronet 592x592x48 |
| What **this project** selected | The project's **datasheet** (Datasheet Notes table, R2) | The engineer, per project | AHU-01: panel 62 mm, L1(M) |
| **How** to answer | **AI rule book**, one per factory | Each factory's team | Site works = In Contractor's Scope; Not Comply needs a source |
| How it was **answered before** | **Compliance library** per factory, project records, corrections | Reviewers | "Comply" with the standard remark |

Nothing is in two places. A map holds language and rules; Product Options holds the product; the datasheet holds the project.

## 2. A clause, step by step

```
"Casing air leakage shall be class L2 or better at -400 Pa to EN 1886."
   │
   1  RECOGNISE (code, vocabulary)        landmarks: casing · air leakage · L2 · EN 1886
   │                                       → type Casing air leakage class, asks L2 or better (high)
   2  FIND THE OFFER (code)               the type's Row → this project's datasheet: L1(M) on every unit
   │   no datasheet → Product Options of the factory: the exact value, else the closest HIGHER one
   │   (0.9 mm GI asked, 1.0 mm offered → Comply with Remarks "1.0 mm"); never a lower one
   3  COMPARE (code)                      L1 is better than L2 on the EN 1886 scale → Comply
   │   + the AI notes and notes of those rows (Eurovent certified ...) go with it as sources
   4  LIBRARY (code)                      the same clause answered before → its wording and remark style
   5  RULES (code, rule book)             scope clauses answer themselves (site works, coordination)
   6  WRITE AND REVIEW (AI)               only what code could not settle: descriptive clauses, the remark
   │                                       of a Comply with Remarks, a second opinion; every claim cites a source
   7  DECIDE (person, Focus mode)         keep, edit or replace; what is kept goes to the library (review path)
```

Code does steps 1 to 5 in milliseconds and for free; the model is called only for step 6.

## 3. Why this is better than searching for similar sentences

- **Wording does not matter.** "Air tightness class L2", "casing leakage L2 to BS EN 1886" and "leakage class L2 at
  -400 Pa" are the same type with the same level. A new consultant's wording adds a Term, not a library line.
- **The answer is a comparison, not a guess.** L2 asked, L1(M) offered, EN 1886 scale: the reason is written by code
  and can be checked by anyone.
- **Every factory answers from its own offer**, the same vocabulary for all.
- **Specs line up.** A new specification of a known template is mostly the same types at the same levels; only the
  types and levels that changed need a person (next step on the roadmap).

## 4. How the vocabulary grows

- Try a clause (Compliance review > AI rules) shows what the code recognises, with its landmarks. A clause that is
  not recognised gets its wording added as Terms of the right type (Maps > the vocabulary > Edit).
- Next: after every specification, the clauses no type recognised are grouped by their landmarks; the AI proposes "a
  new term of type X" or "a new type under component Y" as branches "to verify"; an admin verifies with one click.
  The AI never changes a scale, a direction or what a factory offers.
- Expect fast growth over the first 10 to 20 specifications, then a flat curve: consultants reuse a few hundred
  requirements in different words.

## 5. What is built today and what is next

| Step | State |
|---|---|
| Vocabulary maps per product, template AHU (118 types, 17 components, 30 standards), FCU, Chiller | Built 21 Oct 2026 |
| Recognition (landmarks, rare words weigh more, component + property pairs, figure in the right unit, Not words, equivalents MERV 14 = F8) | Built; 32 typical AHU clauses recognised right in the tests |
| Try a clause shows the types, levels and landmarks | Built |
| Datasheet and Product Options comparison, closest higher, grouped values, AI notes | Built 20 Oct 2026 |
| Type chips on the record and in Focus mode; linking a clause to its datasheet row by the type's Row (keywords as fallback) | Next |
| Unrecognised-clause queue with AI proposals | Next |
| Template matching of whole specifications ("85% same as Project X") | After |
