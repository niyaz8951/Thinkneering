/* Every static import in functions/ and assets/ must resolve to a file on disk.
   An unresolved import fails the Cloudflare build silently from the browser's
   point of view, so this runs before every zip. */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SKIP = new Set(['node_modules', '.git', '_dev']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.js' || extname(p) === '.mjs') out.push(p);
  }
  return out;
}

let checked = 0, bad = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const re = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    checked++;
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) bad.push(`${file.slice(ROOT.length + 1)} -> ${m[1]}`);
  }
}

console.log(`${checked} relative imports checked`);
if (bad.length) {
  console.log('UNRESOLVED:');
  bad.forEach((b) => console.log('  ' + b));
  process.exit(1);
}
console.log('all resolve');
