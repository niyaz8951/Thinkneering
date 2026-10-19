# Migration status - DAME Tools Hub to Thinkneering Hub

Kept by Claude. Read at the start of every THINK-HUB chat; update after every delivery.

Last updated: 19 Oct 2026 - base fixes from the Qiddiya test (11 items) and the essence of the team's master prompt v4.1; migration 0005 (standards A.13.8).

## Live set-up (15 Oct 2026)
- Worker `thinkneering-hub`, deployed from the laptop with `npm run deploy` (= `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`). Workers Builds not connected yet; it can be, with the same two commands.
- D1 `thinkneering-db` (id in `wrangler.toml`, binding `DB`), migration 0001 applied; R2 `hub-files`; `SESSION_SECRET` set; Workers AI; no Vectorize yet.
- Domain `thinkneering.com` attached in the Domains tab; `workers.dev` address also on. PBKDF2 is 100,000 iterations (the Workers maximum). **No staging.**
- Folder addresses (`tools/projects/`) are mapped to `index.html` by the Worker (`run_worker_first` includes `/tools/*`).
- First super user `ni8951` made through Request access + the RUNBOOK UPDATE; the empty-database state is normal until the Supabase import (plan step 3).

## Where things are

- **Old site (live, the team works here):** `https://github.com/niyaz8951/dame-tools-hub`, GitHub Pages + Supabase.
  Last delivery 14 Oct 2026 11:30 (commit `thinkOct14.9`). `DAME-Compliance-Handoff.md` describes it.
- **New repo:** `https://github.com/niyaz8951/Thinkneering`. Live on `https://thinkneering.com` since 15 Oct 2026.
- **Plan:** Workers Free until the AI review goes to the whole team; Paid when the daily neuron limit is reached.

## Port checklist (ticked = the route family passes its tests on `wrangler dev`)

| Family | Routes | Logic in `lib/` | Status |
|---|---|---|---|
| `app_*` | register, login, me, logout, change_password, update_profile, admin_overview, admin_set_user, admin_reset_password, admin_delete_user, admin_save_tool, admin_save_category | `auth.ts`, `lib/password.ts` | **done** |
| `cm_*` | options, save_run, admin_lines, admin_save_answer, admin_delete_line, admin_import, admin_runs, admin_export, reset_library | `lib/cm.ts` | **done** |
| `dn_*` | get_rules, add_rows, admin_save_rules | in `api/dn.ts` | **done** |
| `po_*` | collect, get_tree, admin_save_extra, admin_delete_extra, admin_set_hidden | in `api/po.ts` | **done** |
| `pr_*` | options, list, save, get (+ `drafts` per record, 16 Oct), export, note_save, note_get, run_get, run_save_line, run_fill_section, run_save_review, run_save_comment, run_split, run_join, delete_record, delete, share_get, share_set, submit_answers, review_list, review_decide, admin_summary | `lib/project.ts` | **done** |
| `mp_*` | list, create, get, map_save, delete, node_*, import, image_*, search | `mpRights` in `api/mp.ts` | **done** |
| `ai_*` | review_run, review_status, review_clear | `ai/search.ts`, `ai/draft.ts`, `ai/models.ts` | **done** |
| files | `GET /api/file/<key>` | `api/files.ts` | done |
| cron | Vectorize indexing (idle until VECTORS exists), nightly backup to R2 | `jobs.ts` | done, not yet run on a real account |

140 Vitest tests green (`npm test`), 9 Playwright flows green and 7 skipped by device (`npm run test:e2e`, desktop + phone), 16 Oct 2026 night.

## Design brief (16 Oct 2026) - where we are

| Phase | What | Status |
|---|---|---|
| 1 | Design pass and screen map (visual only) | **done 16 Oct**, branch `phase1-design-pass`: `docs/Screen-Map.md`; shell, dashboard, Projects, project page, record, focus mode, Compliance review; before / after in `docs/screens/` |
| 2 | Review mode: keep, change or skip | next |
| 3 | AI hardening | **first part done 16 Oct**: AI rules tab + `#` rules rebuilt + grounding / retry / Not Comply checks + prompt version (migration 0002). Left: golden set, eval:live, daily cap, 8 s timeout, quality card |
| 4 | Feature A (datasheet comparison) | after 3 |

The 15 Oct `#` rules (never pushed) were rebuilt on 16 Oct with the AI rules tab; the owner asked for the rules tab ahead of
Phase 2, so Phase 3's first part came first. `docs/AI-Review.md` explains the review in plain words.

## Migration plan (standards A.11) - where we are

1. Skeleton - **done**.
2. Port by family - **done**.
3. Export and import - scripts written and tried on a fixture; `import-d1.mjs` now takes `--local` or `--remote` (no staging). Real run pending.
4. Parallel week - not started.
5. Cut-over - not started.

## Next pieces of work, in order

00. Owner (19 Oct push, branch `fixes-2026-10-19`): `npm install`, then `npm run deploy` (applies migration **0005**
   then deploys). Then Compliance review > AI rules > **Update from template** once per rule book (the new 5-part brief).
   Re-read one datasheet per open project to save its factory and the EN 1886 / EN 13053 rows (the old table is replaced).
   Heat-wheel rows read before 19 Oct have the old keys ("WINTER|Supply Air ..."); their Product Options values stay under
   the old names until the next read of those datasheets.
   Next phase, on hold (owner, 19 Oct): Corrections Log import, filter conversion table, standard build / register facts.
0. Owner (16 Oct night push): `npm run deploy` (no migration, no secret), then Compliance review > AI rules > **Update from
   template** once per product rule book (the AHU one also gets the AHU rules and Facts), verify the facts marked "to
   verify" in Maps that hold for your units, then **Check the AI** with 20 clauses to get the first agreement figure.
   For Riyadh-only facts: Create from template under "Riyadh only" (or Update it) to get the KSA defaults to verify. Put factory capabilities in Product Options AI notes and verified knowledge-map
   branches: with strict mode on, a product clause is drafted only when something on file supports it.
1. Owner: upload the 16 Oct AI rules files, `npx wrangler d1 migrations apply DB --remote`, `npx wrangler deploy`; upload
   `compliance-library-ahu-riyadh.xlsx` into AHU / Riyadh; load `starter-rules-ahu-riyadh.sql`; run AI review on one known spec.
2. Claude: Design brief Phase 2 (Review mode), then the rest of Phase 3 (golden set from the reviewed records).
3. Owner: `export-supabase` + `import-d1 --local`, then `--remote`; Claude fixes what the real data shows.
4. Playwright suites for Datasheet Notes, Product Options, Maps.

## Open items carried from the DAME side (not blocking)

- Chiller datasheet reader (no sample PDF yet); FCU Riyadh factory name in `ds-fcu.js` only if ever needed.
- AHU and FCU readers not re-run on a real PDF after the 2 Oct 2026 changes.
- `pr_review_list` is ported but no page uses it.
- Rate limiting binding on `app_login` / `app_register` not added (the 5-attempt lock-out is).
- Uppercase letter-spaced headers remain in Product Options, Maps and Container Calculator (fixed when those tools are touched).

## Decisions log

- 19 Oct 2026 (afternoon): the AI review of a whole record is switched off ("coming soon" pop-up; server refuses unless `AI_WHOLE_REVIEW = "1"`); the AI proposes answers in Focus mode only, for every user, so people read the specification clause by clause.
- 19 Oct 2026: datasheet rows with one name are all kept and told apart by sub-heading / section; a datasheet read again replaces the earlier table of the same units; the datasheet's factory is saved and checked; EN 1886 / EN 13053 classes are read; heat-wheel Supply / Return are sub-headings; starter keywords and Remove text go to every new mapping row ("+ PE" removed); a topic gate stops rows linking to clauses of another part; a rule book is linked once, a knowledge map once per product; only the super user and Maps tile admins verify branches; reference lists split one standard per row. From the master prompt (owner): the six answers stay; no Consultant field; the consultant's Excel keeps the four columns, the working Excel carries priority and reasons; Corrections Log and filter table on hold. Code does the remark lock, conjunction, ranges, metric match and review priority; the model's brief is 330 words.
- 16 Oct 2026 (night, last): rule books have a Facts branch; an instruction rule is not a fact. The AHU rule book template holds the walkthrough's logic as rules and the v3 library's certifications and practice as facts (commercial ones to verify).
- 16 Oct 2026 (night, later): drafting runs on the small model (`llama-3.1-8b-instruct-fast`), not the 70B: code compares and checks, the model only chooses from cited sources. A rule book can ask for `AI model: large`. Learning is measured with **Check the AI** (people's library answers replayed with the answer hidden). A LoRA fine-tune is a later decision.
- 16 Oct 2026 (night): the AI answers about the product only from a source it cites (datasheet, Product Options, AI notes, knowledge maps, rules, library, corrections, earlier answers); otherwise the clause is left for a person. Strict is the default; the rule-book setting `Answer without a source: yes` relaxes it. People's corrections to AI drafts are shown to the model as sources for similar clauses. Template rules nobody edited are updated by **Update from template**; edited rules are never touched. No migration.

- 16 Oct 2026 (late): the site is **Thinkneering Tools**, with the "layers" mark of the Thinkneering v3 site on the Daikin blue; DAME is removed from the site; theme unchanged. From v3 only the design and the Compliance Maker AI are carried over (`docs/Thinkneering-v3-Lessons.md`); the rest of v3 is not ported.

- 16 Oct 2026 (night): a map is knowledge or an AI rule book, chosen when it is made; one of each is linked per product / factory. The rule book holds the AI's brief (Instructions), the step switches, the rules and what it learned (to verify until a person verifies it). Knowledge maps are facts for the model, verified branches only.
- 16 Oct 2026 (evening): three levels of knowledge in a fixed order - project datasheet (code compares), Product Options (incl. AI notes), library; the model only writes. AI rules live in maps in Maps, linked per product and per factory in Compliance review > AI rules (no change to Maps itself); users of the AI need no Maps access. Settings are special notes of the map's Settings branch. Focus-mode proposals for everyone; the model within a daily budget (Free plan). The datasheet wins over a contradicting library answer.
- 16 Oct 2026 (AI rules): AI rules per product, for every factory or one, written only by tile admins and the super user; facts may be quoted, numbers included; fixed-answer rules answer without the model; users never see `#` rules; uploads standardise the six answers; a library line with `#` rules is not copied blindly. From `ai-suggest.js` taken: datasheet rows with a section gate, parent clause, number grounding, echo trim, Not Comply needs a source, one retry. Not taken: a seventh answer TO VERIFY, the 8B model, batched calls.
- 16 Oct 2026 (Phase 1): live facts win over older doc lines (thinkneering.com, D1 `thinkneering-db` / `DB`, no staging, Vectorize off, PBKDF2 100k); `npm run deploy` no longer passes `--env production` (that environment does not exist); the dev seed hashes at 100k. Design rules in standards A.13.1. The top-bar Back button is tinted, not solid, so each page has one solid blue primary action. On a phone the primary action is docked at the bottom and the secondary ones are behind More. "Answered" never counts AI drafts; `pr_get` gives `drafts` per record (read-only). Screenshots by `scripts/screens.mjs`; full sets stay out of git.
- 15 Oct 2026: live on thinkneering.com (root domain); D1 `thinkneering-db`; no staging for now; Vectorize off until the index is created.
- 14 Oct 2026: move to Cloudflare, D1, Workers AI, Vectorize, R2; one Worker; same route names; pages unchanged; theme unchanged; site name from `config.js`.
- 14 Oct 2026: page addresses stay exactly as on the DAME site; `cm_lines.norm_hash` is sha-256; `env.local` runs offline with a stand-in model (`AI_FAKE = "1"`).
- 14 Oct 2026: AI review on project records for admins of the Projects tile and the super user; drafts are blue, never in the library or the review queue; a person who edits or keeps a draft makes it his own answer.
