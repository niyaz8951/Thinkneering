/* A migration file containing ALTER TABLE is a trap on D1: the whole file is
   one unit, so the first failing statement aborts everything after it. SQLite
   has no ADD COLUMN IF NOT EXISTS, so on a re-run the ALTER raises "duplicate
   column name" and every CREATE, INSERT, TRIGGER and VIEW below it silently
   never runs — leaving a migration that looks applied and is not.

   Columns therefore live in db/add-columns.sh, one statement per call. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DB = join(ROOT, 'db');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

// Files written in this refocus. Older migrations predate the rule and are
// already applied; rewriting them would change history for no gain.
const CURRENT = readdirSync(DB).filter((f) => f.startsWith('2026-09-') && f.endsWith('.sql'));

t('there are migrations to check', CURRENT.length >= 6);

for (const f of CURRENT) {
  const sql = readFileSync(join(DB, f), 'utf8');
  const alters = sql.split('\n').filter((l) => /^\s*ALTER TABLE/i.test(l));
  t(`${f} contains no ALTER TABLE`, alters.length === 0);
}

const sh = readFileSync(join(DB, 'add-columns.sh'), 'utf8');
const ps = readFileSync(join(DB, 'add-columns.ps1'), 'utf8');

const COLUMNS = ['lanes', 'scope', 'project_id', 'origin', 'source_ref', 'superseded_by', 'assignee_id'];
for (const c of COLUMNS) {
  t(`add-columns.sh adds ${c}`, sh.includes(c));
  t(`add-columns.ps1 adds ${c}`, ps.includes(c));
}

t('the shell script tolerates an already-present column',
  /duplicate column name/i.test(sh));
t('the PowerShell script tolerates an already-present column',
  /duplicate column name/i.test(ps));
t('a real failure is not swallowed by the shell script', sh.includes('FAILED'));
t('a real failure is not swallowed by the PowerShell script', ps.includes('FAILED'));

// The harness has to build the same schema the deploy does, or it tests
// something nobody runs.
const harness = readFileSync(join(ROOT, '_dev/tests/knowledge-typed.test.py'), 'utf8');
for (const c of COLUMNS) {
  t(`the test harness also adds ${c}`, harness.includes(c));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
