# Thinkneering Hub

The DAME Tools Hub on Cloudflare: one Worker serves the site (`public/`, the DAME pages unchanged) and its API
(`worker/src`, the old database functions as routes of the same name), D1 holds the data, R2 the files, Workers AI
the models. Address: `https://thinkneering.com` (no staging; `npm run dev:offline` is the place to try things).

Rules: `Thinkneering-Hub-Standards.md` in the Claude project (section A = this build, section B = the DAME page
rules, also in `docs/DAME-STANDARDS.md`). Progress: `Migration-Status.md`. AI: `AI-Roadmap.md`. Operations: `RUNBOOK.md`.

## Run it on a laptop

```
npm install
npm run dev            # migrations + demo users on a local D1, then wrangler dev on http://localhost:8787
                       # AI review calls Workers AI through your `wrangler login`
npm run dev:offline    # the same without a Cloudflare login: no model, the AI review uses a stand-in that marks
                       # every clause "Noted" and says so (env.local in wrangler.toml)
```

Demo users (local only): `admin` / `admin12345` (super user), `team.admin` / `admin12345` (admin of every tile),
`sales.user` / `sales12345` (Sales tile, "Can edit" for the Compliance Maker), `sbu.user` / `sbu12345` (SBU tile),
`new.joiner` (pending). `npm run dev:fresh` wipes the local database first.

## Tests

```
npm run typecheck      # tsc
npm test               # Vitest in the Workers runtime: every route, allowed and refused (tests/worker)
npm run test:e2e       # Playwright on wrangler dev --env local: sign in, project, conversion, record, AI review
```

## Layout

```
wrangler.toml          bindings: the live site at the top level, `env.local` offline; no secrets
public/                the site: DAME pages, assets, tools (only api.js and config.js changed in the move)
worker/src/index.ts    router: POST /api/rpc/<name>, GET /api/file/<key>, GET /api/ping, static assets
worker/src/auth.ts     sessions (PBKDF2, 12 h, one per user), roles, tile admins, "Can edit", audit
worker/src/api/        app.ts cm.ts dn.ts po.ts pr.ts mp.ts ai.ts files.ts - one file per old function family
worker/src/lib/        pure logic: cm.ts (norm, topic, order, structure), project.ts, factory.ts, password.ts, sql.ts
worker/src/ai/         models.ts (names, gateway), search.ts (Vectorize + lexical fallback), draft.ts, prompts/
worker/src/jobs.ts     cron: Vectorize indexing every 5 min, nightly backup of every table to R2
db/migrations/         0001_init.sql (never edited after production; a change is 0002_...)
scripts/               dev-seed, export-supabase, import-d1, reindex, export-d1
tests/worker/          Vitest; tests/e2e/ Playwright
```

## Deploy

From the laptop: `npm run deploy` (= `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`).
Workers Builds can be connected later with build `npm ci` and the same deploy command.
First-time set-up, moving to another account, restoring, secrets: `RUNBOOK.md`.
