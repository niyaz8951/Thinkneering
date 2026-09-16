/* Semantic retrieval. The merge maths and, more importantly, the promises:
   it degrades to nothing, and it cannot get a draft node into an answer. */
import { mergeHits, embedText, semanticEnabled } from '../../functions/_lib/semantic.js';
import { CASES } from '../../functions/_lib/eval-cases.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

// --- degradation
t('no bindings means no semantics', semanticEnabled({}) === false);
t('AI without an index is not enough', semanticEnabled({ AI: {} }) === false);
t('an index without AI is not enough', semanticEnabled({ VECTORIZE: {} }) === false);
t('both means on', semanticEnabled({ AI: {}, VECTORIZE: {} }) === true);

// --- what gets embedded
const node = { title: 'ATEX', aliases: '["hazardous area","explosion proof"]',
               summary: 'Explosive atmosphere scope.', kind: 'requirement',
               body: 'x'.repeat(5000) };
const text = embedText(node);
t('title and aliases are embedded', text.includes('ATEX') && text.includes('explosion proof'));
t('the kind is included', text.includes('requirement'));
// The body is often a pasted clause; embedding it drowns the subject.
t('the body is not embedded', !text.includes('xxxxx'));
t('the text is capped', text.length <= 1200);
t('a node with no aliases still embeds',
  embedText({ title: 'Coil', aliases: null, kind: 'component' }).includes('Coil'));
t('malformed aliases do not throw',
  embedText({ title: 'Coil', aliases: 'not json', kind: 'component' }).includes('Coil'));

// --- the merge
const kw = [{ node_id: 'a', score: 12, matched: 'atex' }, { node_id: 'b', score: 3, matched: 'area' }];
const sem = [{ nodeId: 'b', score: 0.9 }, { nodeId: 'c', score: 0.7 }];
const merged = mergeHits(kw, sem, 10);
const by = (id) => merged.find((m) => m.node_id === id);

t('every source is represented', merged.length === 3);
t('a node found by both is labelled so', by('b').via === 'both');
t('keyword-only is labelled', by('a').via === 'keyword');
t('semantic-only is labelled', by('c').via === 'meaning');
// Agreement between two methods that fail differently is the strongest signal
// available, so it has to beat a strong score from one of them alone.
t('agreement outranks a strong single-method hit', by('b').score > by('a').score);
t('results are sorted', merged[0].score >= merged[1].score);
t('the limit is honoured', mergeHits(kw, sem, 2).length === 2);

// Keyword scores run to double figures, cosine sits in 0..1. Without
// normalising, one keyword hit would outrank every semantic result forever.
const lopsided = mergeHits([{ node_id: 'x', score: 999 }], [{ nodeId: 'y', score: 0.95 }], 10);
t('a huge keyword score does not bury a strong semantic one',
  lopsided.find((m) => m.node_id === 'y').score > 0.4);
t('empty inputs do not divide by zero', mergeHits([], [], 5).length === 0);
t('semantic-only still returns results', mergeHits([], sem, 5).length === 2);

// --- the approved-only boundary must hold on the new path
const retrieval = readFileSync(resolve(ROOT, 'functions/_lib/graph-retrieval.js'), 'utf8');
t('vector ids are filtered to approved nodes',
  /semanticRows[\s\S]{0,400}status = 'approved'/.test(retrieval));
t('and to maps this person may read',
  /semanticRows[\s\S]{0,500}map_id IN/.test(retrieval));
t('the two searches run in parallel, not in sequence',
  retrieval.includes('Promise.all([') && retrieval.includes('semanticIds(env'));

const semantic = readFileSync(resolve(ROOT, 'functions/_lib/semantic.js'), 'utf8');
t('only approved nodes are indexed', semantic.includes("node.status !== 'approved'"));
t('a demoted node is removed from the index', semantic.includes('deleteByIds'));
t('a low-confidence vector match is rejected', semantic.includes('MIN_SCORE'));
t('every failure path returns empty rather than throwing',
  (semantic.match(/catch \(err\)/g) || []).length >= 4);

// --- the eval set
t('there are cases', CASES.length >= 10);
t('every case has a question', CASES.every((c) => typeof c.q === 'string' && c.q.length));
t('every case says why it exists', CASES.every((c) => typeof c.why === 'string' && c.why.length));
t('positive cases name what must be found',
  CASES.filter((c) => !c.expectNone).every((c) => Array.isArray(c.expect) && c.expect.length));
// These matter more than the hits: a system that confidently answers what it
// does not know is worse than one that answers less.
t('there are should-not-answer cases', CASES.filter((c) => c.expectNone).length >= 3);

const evalSrc = readFileSync(resolve(ROOT, 'functions/api/knowledge/eval.js'), 'utf8');
t('the eval is admin only', evalSrc.includes('Admins only'));
t('it reports both numbers together', evalSrc.includes('headline'));
t('it records where each expected node ranked', evalSrc.includes('ranks'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
