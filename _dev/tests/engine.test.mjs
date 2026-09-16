/* The engine: the parts that make this changeable in five years rather than
   abandonable in two. Mostly these check that hand-maintained lists still
   match reality — a stale list reports healthy while something has never run,
   which is the failure mode that costs the most to diagnose. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  cond ? (pass++, console.log('PASS  ' + name))
       : (fail++, console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')));
};

const dbFiles = readdirSync(join(ROOT, 'db')).filter((f) => f.endsWith('.sql'));

/* Helpers, not migrations: run by hand, or not against the schema at all. */
const HELPERS = new Set(['add-columns.sql', 'audit-catalog.sql', 'migrate-source-md.sql',
                         'drop_recall_layer.sql', 'reset-imported-nodes.sql']);
const migrations = dbFiles.filter((f) => !HELPERS.has(f));

// --- the ledger
const ledger = readFileSync(join(ROOT, 'db/2026-09-migration-ledger.sql'), 'utf8');
t('there is a ledger', ledger.includes('CREATE TABLE IF NOT EXISTS schema_migrations'));

// A migration that does not record itself is one the ledger cannot see, and
// the ledger is only worth having if it is complete.
const recent = migrations.filter((f) => f.startsWith('2026-09-') && f !== '2026-09-migration-ledger.sql');
for (const f of recent) {
  const sql = readFileSync(join(ROOT, 'db', f), 'utf8');
  t(`${f} records itself`, sql.includes("VALUES ('" + f + "'"), 'no schema_migrations insert');
  // Last statement: on D1 a file aborts at the first failure, so a row can
  // only mean the whole file ran.
  const idx = sql.lastIndexOf('INSERT OR IGNORE INTO schema_migrations');
  t(`${f} records itself last`, idx > sql.length - 400, 'the insert is not at the end');
}

// --- health knows about every migration
const health = readFileSync(join(ROOT, 'functions/api/admin/health.js'), 'utf8');
for (const f of migrations) {
  t(`health knows about ${f}`, health.includes("'" + f + "'"), 'add it to EXPECTED_MIGRATIONS');
}

// --- health knows about every column add-columns adds
const sh = readFileSync(join(ROOT, 'db/add-columns.sh'), 'utf8');
const cols = [...sh.matchAll(/"([a-z_]+)\|([a-z_]+)\s/g)].map((m) => [m[1], m[2]]);
t('the column list was read', cols.length >= 7, `(${cols.length})`);
for (const [table, col] of cols) {
  t(`health checks ${table}.${col}`,
    new RegExp(`'${table}',\\s*'${col}'`).test(health), 'add it to EXPECTED_COLUMNS');
}

// --- models are named once
const fnFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) fnFiles.push(p);
  }
})(join(ROOT, 'functions'));

const stray = fnFiles.filter((f) => {
  if (f.endsWith('models.js')) return false;
  const src = readFileSync(f, 'utf8');
  // Ignore mentions inside comments recording a past deprecation.
  return /['"]@cf\//.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, ''));
});
t('no model name is hardcoded outside models.js', stray.length === 0,
  stray.map((f) => f.slice(ROOT.length + 1)).join(', '));

const models = readFileSync(join(ROOT, 'functions/_lib/models.js'), 'utf8');
t('the embedding dimensions are recorded beside the model', models.includes('EMBED_DIMENSIONS'));

/* --- nothing under functions/ may import from outside functions/
   Cloudflare Pages bundles that directory. An import reaching outside it
   cannot be resolved at build time, and ONE unresolvable import fails the
   whole Functions build — every /api/ route errors at once, including
   /api/catalog, so the header renders empty and the site looks broken for
   reasons unrelated to the page you are on.

   This shipped once. It is the single most expensive class of mistake in
   this codebase because the symptom points nowhere near the cause. */
const escaping = [];
for (const f of fnFiles) {
  const src = readFileSync(f, 'utf8');
  const dir = f.slice(0, f.lastIndexOf('/'));
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dir, m[1]);
    if (!target.startsWith(join(ROOT, 'functions'))) {
      escaping.push(f.slice(ROOT.length + 1) + ' -> ' + m[1]);
    }
  }
}
t('no function imports from outside functions/', escaping.length === 0, escaping.join(', '));

/* --- a binding that names a resource which may not exist must ship inert.
   Cloudflare validates bindings at publish time. A missing Vectorize index
   fails the Function publish while the static assets publish anyway, so the
   site serves HTML with every API dead — no sign-in, and no auth gate,
   because _middleware.js is part of the same bundle.

   The failure is worse than "feature off": the site looks up and is wide
   open. Optional bindings therefore ship commented out. */
const wrangler = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const activeVectorize = wrangler.split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .some((l) => l.includes('[[vectorize]]'));
t('the Vectorize binding ships commented out', !activeVectorize,
  'uncommenting it before the index exists breaks the whole deployment');
t('and says how to turn it on', wrangler.includes('vectorize create thinkneering-kb'));

/* --- routing: two mistakes that cost a full day between them.

   1. A _redirects destination carrying .html. Pages strips .html with its own
      301, so the rewrite fires that redirect, the address bar loses /s/<slug>,
      and the page parses the wrong URL.
   2. An unanchored prefix regex. /^\/s\/?/ also matches /section and leaves
      "ection" — a wrong answer rather than an error, which sends you hunting
      in the data instead of in the routing. */
const redirects = readFileSync(join(ROOT, '_redirects'), 'utf8');
const destinations = redirects.split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'))
  .map((l) => l.trim().split(/\s+/)[1] || '');
t('no rewrite destination carries .html',
  destinations.every((d) => !d.endsWith('.html')),
  destinations.filter((d) => d.endsWith('.html')).join(', '));

for (const [file, seg] of [['section.html', 's'], ['reader.html', 'read']]) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  t(`${file} anchors its path match`,
    src.includes(`/^\\/${seg}(?:\\/(.*))?$/`),
    'an unanchored prefix strip will mis-parse a neighbouring path');
  t(`${file} no longer uses the loose strip`,
    !src.includes(`replace(/^\\/${seg}\\/?/, '')`));
}

// --- export
const exp = readFileSync(join(ROOT, 'functions/api/admin/export.js'), 'utf8');
t('export is admin only', exp.includes('Admins only'));
t('export stamps a schema version', exp.includes('schema: 1'));
// Excel mangles Urdu and Devanagari without a BOM, which is most of the
// dictionary.
t('CSV carries a BOM so Excel reads the scripts', exp.includes('\\uFEFF'));
t('CSV uses CRLF, which is what Excel writes back', exp.includes("'\\r\\n'"));
// A cell starting = or + is a formula to Excel, and a pasted one can run.
t('formula injection is defended against', exp.includes('/^[=+\\-@]/'));
t('derived indexes are not exported', exp.includes('Not exported: knowledge_terms'));
t('nodes are exported before edges and facts',
  exp.indexOf('nodes:') < exp.indexOf('edges:'));

// --- the runner
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
t('npm test runs everything', pkg.scripts && pkg.scripts.test === 'node _dev/run-tests.mjs');
const runner = readFileSync(join(ROOT, '_dev/run-tests.mjs'), 'utf8');
t('suites are discovered, not listed', runner.includes('readdirSync'));
t('a failing suite exits non-zero, so CI can catch it', runner.includes('process.exit(1)'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
