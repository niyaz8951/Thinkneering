# Screen map

Every screen of the core path: its one job, its one primary action, and what it shows when there is nothing yet.
Check every change against this page. Written 16 Oct 2026 (Design brief, Phase 1). Other tools keep their
DAME screens until they are touched; when one is touched it gets a row here first.

Rules that apply to every row (Design brief section 3): sentence-case headers, small and in the secondary colour;
tabular figures; skeletons while loading, never a blank page or a spinner; every empty state says what to do next
with one button; a number always says what it counts; on a phone the primary action sits in the bottom half
(docked at the bottom of the screen), tap targets 44px, inputs 16px; reasons are a visible line, never a hover.

| Screen | Address | One job | Primary action | Secondary (in "More" on a phone) | Empty state |
|---|---|---|---|---|---|
| Top bar (shell) | every page | Where am I, how do I get back | Back to *place* | Theme, account menu | - |
| Sign in | `index.html` | Get in | Sign in | Request access | - |
| Dashboard | `dashboard.html` | Open the team that has the tool I need | Tap a team tile (or a tool tile with one team) | - | A team with no tools: "No tools in *team* yet." + **All teams** |
| Projects | `tools/projects/` | Find and open a project | **New project** (docked on a phone) | Compliance review, Product Options, Download list (admins) | "No projects yet. A project holds the specifications and datasheets of one job." + **New project**. Filters with no hit: "No project matches." + **Clear filters** |
| Project | `tools/projects/project.html?id=` | Know what to do next on this job, and do it | The Next step card's one button (docked on a phone) | Download project, Share, Edit details | Next step card "Add the specification" + **Add a specification**; compliance records: "No specification yet." + **Add a specification**; datasheets: "No datasheet yet." + **Read a datasheet** |
| Add a specification | `add-spec.html?project=` | Turn a PDF or text into clauses | Convert and start filling | Classic Compliance Maker | - (the form is the empty state) |
| Record | `record.html?run=` | Answer every clause of one specification | **Focus mode** (docked on a phone; a phone opens straight into it) | Read / Edit, show, find, Download Excel, AI review, Remove AI drafts | Filter with no hit: "No clause matches." + **Show all rows** |
| Focus mode | over the record or Compliance review | Answer one clause, then the next | The six answers (one tap), then **Next to fill** | Read / Edit, A− / A+, Part and section jump | "There is no clause to fill here." (toast; the pane does not open) |
| Compliance review | `tools/compliance-maker/library.html` | Give the company library its answers | **Focus mode** (docked on a phone) | Read / Edit, filters, Download library, Upload, Conversion history | No product chosen: the two pickers are the screen. No lines: says why (nothing converted yet / nothing left to answer / no hit) + the button that changes it (**Show all lines** / **Clear filters**) |

## What each screen shows first (top to bottom)

- **Projects** — title; one line of what a project is; the list (search when there are 2 or more); for admins, the
  "All projects at a glance" card comes *after* the list (it is reference, not work).
- **Project** — name and client; the **Next step** card (one headline, one meaning-ful progress line, one button);
  then what the project holds (compliance records, datasheets, side-by-side), then history.
  At most one Next step card. Quiet is a feature.
- **Record** — name and facts; one work bar (show, find, Read / Edit, Focus mode; the rest in More on a phone);
  one count line that says what the numbers mean: "22 of 38 clauses answered, 12 AI drafts to check, 16 open";
  a one-line legend (green = library, blue = AI draft); the specification.
- **Focus mode** — Part and section; the clause; the answer; for an AI draft, the reason as a visible line under
  the answer ("Why: …", with its confidence); the six answers; Remarks; notes; Previous / Next to fill / Next.

## Not on these screens (decided)
No push notifications, no stats screens per tool, no offline mode, no streaks. Attention comes from the project's
Next step card and, from Phase 2, the dashboard "Waiting for you" line.

## Phase 2 changes already planned for these rows
Record: the Next step button becomes "Check 41 AI drafts" / "Answer 12 open clauses"; focus mode gets Review
(keep / not this / skip, swipe and buttons); keep and reject offer Undo in the toast instead of asking.
Dashboard: one "Waiting for you" line with its one button.
