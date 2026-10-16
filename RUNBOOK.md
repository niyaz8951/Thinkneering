# RUNBOOK - Thinkneering Hub on Cloudflare

Everything the owner or the IT team needs to run, move, restore and inspect the site. One Cloudflare account,
one Worker project, one domain. No command here needs the code to change.

## 1. First set-up of an account (done 15 Oct 2026 for thinkneering.com; repeat on a new account)

There is one live environment (the top level of `wrangler.toml`) and the offline copy (`env.local`). No staging.

```
npm install
npx wrangler login
# the resources, with the names used in wrangler.toml
npx wrangler d1 create thinkneering-db             # paste the database_id into wrangler.toml (top level and env.local)
npx wrangler r2 bucket create hub-files
# Vectorize (off today; switch on by creating the index and un-commenting [[vectorize]] in wrangler.toml)
npx wrangler vectorize create hub-vectors --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index hub-vectors --property-name=factory_id --type=string
npx wrangler vectorize create-metadata-index hub-vectors --property-name=kind --type=string
# an AI Gateway named "hub" in the dashboard (AI > AI Gateway > Create), so every model call is logged
# secrets
npx wrangler secret put SESSION_SECRET                       # any long random string
npx wrangler secret put AI_GATEWAY_TOKEN                     # only when the gateway is set to authenticated
# tables, then the code
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

The domain `thinkneering.com` is attached in the dashboard: Workers > thinkneering-hub > Settings > Domains & Routes.
The `workers.dev` address works as well.

**The first super user** (no website path exists on purpose; `app_register` only makes pending users):

```
npx wrangler d1 execute DB --remote --command "SELECT count(*) AS n FROM app_users"
```
If it is 0, make the account through the website's "Request access", then promote it:
```
npx wrangler d1 execute DB --remote --command \
  "UPDATE app_users SET role = 'superuser', status = 'approved', approved_at = datetime('now') WHERE username = 'your.username'"
```
(With the import from the DAME site the super user comes across as he was; this step is for an empty database.)

## 2. Deploy

- From the laptop: `npm run deploy` (= `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`).
  Migrations run first, so a page never meets a table that is not there.
- Later, Workers Builds on the existing Worker (Settings > Build, repo `niyaz8951/Thinkneering`, branch `main`):
  build `npm ci`, deploy `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`.
- A new migration = a new file `db/migrations/000N_name.sql`; never edit an applied one. Update `scripts/dev-seed.mjs`
  and the Vitest fixtures when the data model changes.

## 3. Local

`npm run dev` (with `wrangler login`: AI review uses Workers AI) or `npm run dev:offline` (no login, stand-in model).
Local D1 and R2 live in `.wrangler/state/`; `npm run dev:fresh` wipes the database and re-seeds the demo users.
Never point a local command at production unless the command says `--remote`.

## 4. Data: export, import, backups, restore

- **From the DAME site (once, step 3 of the migration plan):** on the owner's laptop
  `SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/export-supabase.mjs export`, then
  `node scripts/import-d1.mjs export --local` first (compare the counts it prints with `export/_counts.json`),
  then `--remote` (the live D1) on cut-over night. Imported users keep their bcrypt password and are re-hashed at
  their first login. The import empties the data tables first, so it can be run again.
- **Nightly backup:** the cron at 02:30 UTC writes every table as JSON to R2 under `backups/YYYY-MM-DD/` and
  keeps 90 days. D1 Time Travel keeps 30 days of point-in-time history as well.
- **On-demand export of everything:** `node scripts/export-d1.mjs` -> `hub-db.sql`, one JSON per
  table, and the list of R2 keys. R2 objects: `npx wrangler r2 object get hub-files/<key> --remote`.
- **Restore a point in time (D1 Time Travel):**
  `npx wrangler d1 time-travel info DB` then
  `npx wrangler d1 time-travel restore DB --timestamp=2026-10-14T20:00:00Z`.
- **Restore from a backup folder:** `npx wrangler d1 execute DB --remote --file hub-db.sql`
  (from `export-d1`), or load the JSON files with `scripts/import-d1.mjs` after renaming the folder's files to the
  table names (they already are).
- **Vectorize** is never backed up: `node scripts/reindex.mjs` queues every clause and the cron
  rebuilds the index within the hour.

## 5. Move to another Cloudflare account or domain

1. `npx wrangler login` on the new account; create D1, R2, Vectorize, the AI Gateway "hub" with the same names (section 1).
2. Put the new `database_id`s in `wrangler.toml`; nothing else in the code names an account.
3. `npx wrangler d1 migrations apply DB --remote`, then load the latest export
   (`scripts/import-d1.mjs <folder>`) or `d1 execute --file hub-db.sql`.
4. R2: `npx wrangler r2 object put` for every key listed in `r2-keys.txt` (or an `rclone` sync between the two
   accounts' S3 endpoints).
5. Set the two secrets, `npx wrangler deploy`, attach the domain.
6. `node scripts/reindex.mjs`.
Another domain: change the `routes` pattern in `wrangler.toml` (and `SITE_NAME` in `public/assets/js/config.js` if wanted).

## 6. Secrets, users, audit

- Rotate: `npx wrangler secret put SESSION_SECRET` (every user signs in again), same for
  `AI_GATEWAY_TOKEN`.
- Make someone an admin from the command line (the website does it under Admin > Users; this is the fallback):
  `... --command "INSERT OR IGNORE INTO app_category_admins (user_id, category_id) SELECT id, 'general' FROM app_users WHERE username = 'x'; UPDATE app_users SET role = 'admin' WHERE username = 'x'"`.
- Reset a password from the command line: easiest through the website (Admin > Users > Reset password); otherwise
  hash locally with `node -e "const c=require('crypto');const s=c.randomBytes(16);console.log('pbkdf2$600000$'+s.toString('hex')+'$'+c.pbkdf2Sync('NEWPASS',s,600000,32,'sha256').toString('hex'))"`
  and `UPDATE app_users SET pass_hash = '...' WHERE username = 'x'`.
- Audit log: `SELECT created_at, user_id, action, target FROM app_audit ORDER BY id DESC LIMIT 50`. AI usage of a
  month: `SELECT count(*), sum(neurons) FROM app_audit WHERE action = 'ai_review_run' AND created_at LIKE '2026-10%'`
  (token counts are in the `after` JSON of each row; the gateway dashboard shows the same per model).
- Signed-in sessions: `SELECT count(*) FROM app_sessions WHERE expires_at > datetime('now')`.

## 7. Limits to know

Workers Free: 100 k requests a day, 10 ms CPU a request (enough for the site; the AI review waits on the model,
which is not CPU), 50 subrequests a request (the AI review drafts 10 clauses a request for that reason: the page
calls it again while there is work left). D1 Free: 5 GB, 100 k writes a day. Workers AI Free: 10 k neurons a day,
about one 300-clause review. Paid ($5 a month) lifts all of these; see AI-Roadmap.md for the expected cost.
