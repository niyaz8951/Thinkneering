# Migration status - DAME Tools Hub to Thinkneering Hub

Kept by Claude. Read at the start of every THINK-HUB chat; update after every delivery.

Last updated: 14 Oct 2026, evening - first delivery of the new repo (the whole port, plus AI review).

## Where things are

- **Old site (live, the team works here):** `https://github.com/niyaz8951/dame-tools-hub`, GitHub Pages + Supabase.
  Last delivery 14 Oct 2026 11:30 (commit `thinkOct14.9`). `DAME-Compliance-Handoff.md` describes it.
- **New repo:** this folder, to be pushed as `niyaz8951/thinkneering-hub` (GitHub Desktop), then connected to
  Workers Builds (RUNBOOK section 2). Workers Builds and the domain are not set up yet: RUNBOOK section 1.
- **Domain:** `tools.thinkneering.com` - DNS not set yet. Staging on `workers.dev` until the custom domain is attached.
- **Plan:** Workers Free until the AI review goes to the whole team; Paid when the daily neuron limit is reached.

## Port checklist (ticked = the route family passes its tests on `wrangler dev`)

| Family | Routes | Logic in `lib/` | Status |
|---|---|---|---|
| `app_*` | register, login, me, logout, change_password, update_profile, admin_overview, admin_set_user, admin_reset_password, admin_delete_user, admin_save_tool, admin_save_category | `auth.ts` (Session: tile admin, canOpen, canEdit, prAdmin, profile), `lib/password.ts` (PBKDF2, bcrypt import) | **done** (9 tests) |
| `cm_*` | options, save_run, admin_lines, admin_save_answer, admin_delete_line, admin_import, admin_runs, admin_export, reset_library | `lib/cm.ts`: cmNorm, cmPartNo, cmTopic, cmLibraryOrder, placeRows (= cm__fill_structure), rowKey | **done** (7 + 7 tests) |
| `dn_*` | get_rules, add_rows, admin_save_rules (starter AHU keywords seeded once) | in `api/dn.ts` | **done** |
| `po_*` | collect, get_tree, admin_save_extra, admin_delete_extra, admin_set_hidden | `poSkip`, `poModel`, `poSeries`, `poValue` in `api/po.ts` | **done** (15 tests dn+po) |
| `pr_*` | options, list, save, get, export, note_save, note_get, run_get, run_save_line, run_fill_section, run_save_review, run_save_comment, run_split, run_join, delete_record, delete, share_get, share_set, submit_answers, review_list, review_decide, admin_summary | `lib/project.ts` (prProject, prCanShare, prLog); `runLine`, `dropUnusedLine` in `api/cm.ts` | **done** (18 tests); `pr_notes` rows in R2 |
| `mp_*` | list, create, get, map_save, delete, node_add, node_save, node_verify, node_move, node_delete, import, node_images, image_get, image_add, image_save, image_delete, search | `mpRights` in `api/mp.ts` | **done** (9 tests); images in R2 |
| `ai_*` | review_run, review_status, review_clear (new) | `ai/search.ts`, `ai/draft.ts`, `ai/models.ts` | **done** (7 tests) |
| files | `GET /api/file/<key>` (notes, map images) with the area's permission | `api/files.ts` | done |
| cron | Vectorize indexing (ai_jobs, every 5 min), nightly backup to R2 | `jobs.ts` | done, not yet run on a real account |

72 Vitest tests green (`npm test`), 5 Playwright flows green (`npm run test:e2e`): sign in, create a project,
paste a specification and convert it, read and fill the record, AI review (stand-in model), draft edited by a person,
drafts removed, plain user refused, compliance review screen, phone focus mode.

What changed in `public/` against the DAME repo: `assets/js/api.js` (posts to `/api/rpc/<name>`, no demo back end,
three `ai*` methods), `assets/js/config.js` (name only), `tools/projects/record.html` (AI review button, blue drafts,
"AI drafts" filter, AI flag in the Excel). Everything else is byte for byte the DAME file. The stray copies at the
DAME root and `tools/datasheet-notes/mapping.*` were not copied.

## Migration plan (standards A.11) - where we are

1. Skeleton - **done** in this delivery (repo, wrangler.toml, Worker, migration 0001, auth, app routes, seed, dev, tests).
2. Port by family - **done** (all six families, see the table).
3. Export and import - **scripts written and tried on a fixture** (`scripts/export-supabase.mjs`, `scripts/import-d1.mjs`);
   not yet run on the real Supabase data. Next step for the owner: run the export with the service key, import to staging, compare counts.
4. Parallel week - not started (needs the Cloudflare account set up: RUNBOOK section 1).
5. Cut-over - not started.
6. AI roadmap - Phase 1 (Vectorize index + cron) and a first cut of Phase 3 (AI review drafting, Accept by editing)
   are in this delivery, see AI-Roadmap.md.

## Next pieces of work, in order

1. Owner: push the repo, create the Cloudflare resources (RUNBOOK 1), deploy staging, open it from an office laptop.
2. Owner: `export-supabase` + `import-d1 --env staging`; Claude: fix whatever the real data shows.
3. Playwright suites for the other tools (Datasheet Notes, Product Options, Maps) on `wrangler dev`.
4. AI roadmap Phase 2 (datasheet comparison) once staging has real datasheets.

## Open items carried from the DAME side (not blocking)

- Chiller datasheet reader (no sample PDF yet); FCU Riyadh factory name in `ds-fcu.js` only if ever needed.
- AHU and FCU readers not re-run on a real PDF after the 2 Oct 2026 changes.
- `pr_review_list` is ported but no page uses it.
- Rate limiting binding on `app_login` / `app_request_access` not added (the 5-attempt lock-out is); add
  `[[unsafe.bindings]]` ratelimit when the Paid plan is on.

## Decisions log

- 14 Oct 2026: move to Cloudflare, D1, Workers AI, Vectorize, R2; one Worker; same route names; D1 for data, R2 for
  blobs, Vectorize for vectors; Free plan until drafting; pages unchanged; theme unchanged; site name from `config.js`.
- 14 Oct 2026: repository on GitHub (`niyaz8951/thinkneering-hub`), Workers Builds deploys on push (`main` = production,
  `staging` = staging). Delivery from Claude = a branch, PR or zip, never a manual deploy.
- 14 Oct 2026 (this delivery): page addresses stay exactly as on the DAME site (`html_handling = "none"`, `/` serves
  `index.html` from the Worker). The match key `cm_lines.norm_hash` is sha-256 (first 32 hex) of the normalised text
  instead of md5; the import recomputes it. An `env.local` in `wrangler.toml` runs offline with a stand-in model
  (`AI_FAKE = "1"`), so the AI review flow can be tried and tested without a Cloudflare login.
- 14 Oct 2026 (this delivery): **AI review** (owner's request): admins of the Projects tile and the super user get an
  "AI review" button on a project record; it drafts an answer for every clause that shows none, in batches of 10,
  from the factory's library (near-identical clause >= 0.90 copied without the model, otherwise the 70B model with the
  three nearest library answers and the Internal Comments) and writes the drafts on the record (`cm_run_lines.ai_draft`,
  reason and sources in `ai_drafts`). Drafts are blue, carry "AI draft, check it" and the reason on hover, are not in
  the review queue and never in the library; a person who edits or keeps a draft turns it into his own answer (review
  pending as usual). "Remove AI drafts" takes them off. Every batch is audited with the token counts.
