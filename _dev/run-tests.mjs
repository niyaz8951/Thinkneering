#!/usr/bin/env node
/**
 * Every suite, one command.
 *
 *   npm test
 *
 * The suites are the reason this codebase can be changed safely a year from
 * now by someone — including a future chat session — with no memory of why any
 * of it is the way it is. That value is zero if running them means remembering
 * seventeen commands, so it is one.
 *
 * Discovers *.test.mjs and *.test.py under _dev/tests rather than listing
 * them, so a new suite is picked up by existing.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, '_dev/tests');

const suites = readdirSync(DIR)
  .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.py'))
  .sort();

let failed = [];
let totalPass = 0;

for (const file of suites) {
  const py = file.endsWith('.py');
  const res = spawnSync(py ? 'python3' : 'node', [join(DIR, file)], {
    encoding: 'utf8', cwd: ROOT
  });

  const out = (res.stdout || '') + (res.stderr || '');
  const m = out.match(/(\d+)\/(\d+) passed/);
  const label = file.padEnd(34);

  if (res.status === 0) {
    totalPass += m ? Number(m[1]) : 0;
    console.log('  ok    ' + label + (m ? m[0] : out.trim().split('\n').pop()));
  } else {
    failed.push(file);
    console.log('  FAIL  ' + label + (m ? m[0] : ''));
    // Only the failing lines. A wall of passes above the one failure is how
    // a red run gets skimmed and misread as green.
    out.split('\n').filter((l) => l.startsWith('FAIL') || l.includes('Error'))
      .slice(0, 12).forEach((l) => console.log('        ' + l));
  }
}

console.log('');
if (failed.length) {
  console.log(failed.length + ' of ' + suites.length + ' suites failed: ' + failed.join(', '));
  process.exit(1);
}
console.log(suites.length + ' suites, ' + totalPass + ' checks, all passing.');
