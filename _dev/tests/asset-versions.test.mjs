/* A changed file must carry a new ?v, or the year-long immutable cache and the
   cache-first worker keep serving the old one. See _dev/asset-versions.mjs.
   After a deliberate change: bump the ?v in the markup, then
   `node _dev/asset-versions.mjs --update`. */
import { check } from '../asset-versions.mjs';

let pass = 0, fail = 0;
const t = (name, cond, detail) => { cond ? (pass++, console.log('PASS  ' + name))
                                         : (fail++, console.log('FAIL  ' + name + (detail ? ' — ' + detail : ''))); };

const { now, problems } = check();
t('every versioned asset exists', !problems.some((p) => p.includes('does not exist')), problems.find((p) => p.includes('does not exist')));
t('no asset is referenced with two different versions', !problems.some((p) => p.includes('several versions')), problems.find((p) => p.includes('several versions')));
t('no asset changed under an unchanged ?v', !problems.some((p) => p.includes('changed but is still')), problems.find((p) => p.includes('changed but is still')));
t('the ledger covers the assets in use', Object.keys(now).length > 5);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
