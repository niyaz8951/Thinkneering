/* Asset version guard.
   =============================================================================
   Every script and stylesheet is referenced with ?v=N, and /assets/* is served
   immutable for a year with a cache-first service worker in front of it. So a
   file that changes without its ?v changing is a file nobody ever receives —
   which is exactly what happened to assets/js/dictionary.js?v=1.

   This records, per versioned asset, the ?v the markup uses and a hash of the
   file. The test beside it fails when the hash moved but the ?v did not.

     node _dev/asset-versions.mjs          # report
     node _dev/asset-versions.mjs --update # accept the current state */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const LEDGER = resolve(ROOT, '_dev/asset-versions.json');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === '_dev' || name === 'functions') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

export function scan() {
  const refs = new Map();                       // path -> Set of versions used
  for (const html of walk(ROOT)) {
    const src = readFileSync(html, 'utf8');
    for (const m of src.matchAll(/(?:src|href)="(\/[^"?]+\.(?:js|css))\?v=(\d+)"/g)) {
      if (!refs.has(m[1])) refs.set(m[1], new Set());
      refs.get(m[1]).add(m[2]);
    }
  }
  const state = {};
  for (const [path, versions] of [...refs].sort()) {
    const file = resolve(ROOT, '.' + path);
    if (!existsSync(file)) { state[path] = { missing: true, versions: [...versions] }; continue; }
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
    state[path] = { versions: [...versions].sort((a, b) => a - b), sha };
  }
  return state;
}

export function check() {
  const now = scan();
  const then = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
  const problems = [];
  for (const [path, s] of Object.entries(now)) {
    if (s.missing) { problems.push(`${path} is referenced (?v=${s.versions}) but does not exist`); continue; }
    if (s.versions.length > 1) problems.push(`${path} is referenced with several versions: ${s.versions.join(', ')} — pages will disagree`);
    const prev = then[path];
    if (prev && prev.sha !== s.sha && prev.versions.join() === s.versions.join()) {
      problems.push(`${path} changed but is still ?v=${s.versions[0]} — bump it, or the immutable cache serves the old file`);
    }
  }
  return { now, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { now, problems } = check();
  if (process.argv.includes('--update')) {
    writeFileSync(LEDGER, JSON.stringify(now, null, 2) + '\n');
    console.log('asset-versions.json updated: ' + Object.keys(now).length + ' assets');
  } else {
    problems.forEach((p) => console.log('PROBLEM  ' + p));
    console.log(problems.length ? `${problems.length} problem(s)` : 'all versioned assets are current');
    process.exit(problems.length ? 1 : 0);
  }
}
