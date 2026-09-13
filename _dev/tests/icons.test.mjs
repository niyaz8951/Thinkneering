/* Every icon name the catalogue or the chrome asks for must exist. A missing
   name falls back to `square`, which is why two tabs on the phone rendered as
   blank boxes — silent, and invisible until someone looks at a screenshot. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

const global_ = readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8');
const start = global_.indexOf('var P =');
const block = global_.slice(start, global_.indexOf('\n  };', start));
const have = new Set([...block.matchAll(/^\s{4}'?([a-zA-Z0-9-]+)'?:/gm)].map((m) => m[1]));

t('the icon set was found', have.size > 20);
t('square exists as the fallback', have.has('square'));

// Names the chrome hardcodes.
for (const n of ['home', 'user', 'layers', 'moon', 'log-out', 'file-check', 'share-2', 'book-open']) {
  t(`chrome icon "${n}" exists`, have.has(n));
}

// Names the database asks for, on sections and items.
const wanted = new Set();
for (const f of readdirSync(join(ROOT, 'db')).filter((f) => f.endsWith('.sql'))) {
  const sql = readFileSync(join(ROOT, 'db', f), 'utf8');
  // icon column in the sections/items seeds: 'slug','Title',...,'icon',...
  for (const m of sql.matchAll(/'(file-check|share-2|book-open|feather|graduation-cap|tool|wind|list|calculator|type|repeat|globe|check|git-branch|file-plus|user|circle)'/g)) {
    wanted.add(m[1]);
  }
}
t('the database names some icons', wanted.size > 4);
for (const n of wanted) {
  t(`catalogue icon "${n}" exists`, have.has(n));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
