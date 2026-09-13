/* The judgment that gates automatic proposals. Everything the model returns is
   untrusted, so these check the rejections rather than the happy path. */
import { judgeGap } from '../../functions/_lib/gap-proposer.js';

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

const envWith = (response) => ({ AI: { run: async () => ({ response }) } });
const clause = { clause: 'Coils shall be of the plate fin type.', unmatchedTerms: ['plate fin'] };

t('no AI binding proposes nothing', await judgeGap({}, clause) === null);

t('a refusal proposes nothing',
  await judgeGap(envWith('{"propose": false}'), clause) === null);

t('a thrown AI call proposes nothing rather than failing the answer',
  await judgeGap({ AI: { run: async () => { throw new Error('down'); } } }, clause) === null);

t('unparseable output proposes nothing',
  await judgeGap(envWith('I think maybe yes?'), clause) === null);

t('empty output proposes nothing', await judgeGap(envWith(''), clause) === null);

const good = await judgeGap(envWith(
  '{"propose": true, "title": "Plate fin coil", "kind": "component", "aliases": ["plate-fin"], "reason": "reusable component"}'
), clause);
t('a clean verdict comes back', good && good.title === 'Plate fin coil' && good.kind === 'component');
t('aliases survive', good && good.aliases.length === 1);

const fenced = await judgeGap(envWith(
  'Sure:\n```json\n{"propose": true, "title": "Eurovent 4/11", "kind": "standard"}\n```'
), clause);
t('a fenced reply is still read', fenced && fenced.title === 'Eurovent 4/11');
t('missing aliases default to empty', fenced && Array.isArray(fenced.aliases) && !fenced.aliases.length);

t('a title that is only digits is refused — that is a quantity, not a subject',
  await judgeGap(envWith('{"propose": true, "title": "2.5 / 3.0", "kind": "parameter"}'), clause) === null);

t('a one-character title is refused',
  await judgeGap(envWith('{"propose": true, "title": "A", "kind": "component"}'), clause) === null);

t('propose true with no title is refused',
  await judgeGap(envWith('{"propose": true, "kind": "component"}'), clause) === null);

t('a truthy-but-not-true propose flag is refused',
  await judgeGap(envWith('{"propose": "yes", "title": "Coil", "kind": "component"}'), clause) === null);

// An unknown kind is not rejected here — proposeNode() maps it to 'note'
// against knowledge_kinds, which is the only place that knows what exists.
const oddKind = await judgeGap(envWith('{"propose": true, "title": "Coil", "kind": "gizmo"}'), clause);
t('an unknown kind is left for proposeNode to resolve against the database',
  oddKind && oddKind.kind === 'gizmo');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
