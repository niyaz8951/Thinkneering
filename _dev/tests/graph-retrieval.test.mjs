/* The pure parts of graph retrieval: tokenising, prompt assembly and the
   allow-list that stops the fabrication guard flagging a correctly retrieved
   value as invented. */
import { tokenise, knowledgeBlock, allowedText, citations, detectConflicts } from '../../functions/_lib/graph-retrieval.js';

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

const clause = 'AHU casing shall achieve mechanical strength class D1 to EN 1886.';
const terms = tokenise(clause);
t('clause yields terms', terms.length > 3);
t('standard survives as a phrase', terms.includes('en 1886'));
t('trailing full stop stripped from the standard', !terms.some((x) => x.endsWith('.')));
t('stopwords dropped', !terms.includes('shall') && !terms.includes('the'));
t('phrases built', terms.includes('mechanical strength'));
t('singular form indexed', tokenise('air filters shall be').includes('filter'));

const result = {
  matches: [{
    nodeId: 'n1', mapId: 'm1', title: 'AHU casing', kind: 'component',
    summary: 'Double skin panel casing.', scope: 'general', sourceRef: 'EN 1886 §5.2',
    standards: ['EN 1886'], attributes: [], related: [], approvedAt: '2026-01-01',
    facts: [
      { id: 'f1', node_id: 'n1', name: 'panel thickness', value_type: 'number',
        value_num: 62, unit: 'mm', scope: 'general', source_ref: 'datasheet' },
      { id: 'f2', node_id: 'n1', name: 'face velocity', value_type: 'number',
        value_num: 2.5, unit: 'm/s', scope: 'project', source_ref: 'Aramco' }
    ]
  }],
  unmatchedTerms: ['thermal bridging'],
  facts: []
};

const block = knowledgeBlock(result);
t('block names the node', block.includes('AHU casing'));
t('block carries the number with its unit', block.includes('62 mm'));
t('project-scoped fact is labelled as such',
  /2\.5 m\/s.*recorded on one project/.test(block));
t('general fact is not labelled project-scoped',
  !/62 mm \[recorded on one project/.test(block));
t('block states the quoting rule', block.includes('nothing outside this block may be'));

const allowed = allowedText(result);
t('allow-list contains retrieved numbers', allowed.includes('62') && allowed.includes('2.5'));
t('allow-list contains units', allowed.includes('m/s'));
t('allow-list contains standards', allowed.includes('EN 1886'));

t('empty result yields empty block', knowledgeBlock(null) === '' && knowledgeBlock({ matches: [] }) === '');
t('empty result yields empty allow-list', allowedText(null) === '');

const cited = citations(result);
t('citation carries node, scope and fact count',
  cited[0].nodeId === 'n1' && cited[0].scope === 'general' && cited[0].factCount === 2);
t('no citations without matches', citations({ matches: [] }).length === 0);

// --- conflicting approved values
const f = (id, name, num, unit, scope, extra) => Object.assign({
  id, node_id: 'n1', node_title: 'Cooling coil', name,
  value_type: 'number', value_num: num, value_num_max: null, unit,
  scope, project_id: null, source_ref: ''
}, extra || {});

t('two different approved values on one parameter is a conflict',
  detectConflicts({ facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                            f('b', 'face velocity', 2.8, 'm/s', 'general')] }).length === 1);

t('the same value recorded twice is not a conflict',
  detectConflicts({ facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                            f('b', 'face velocity', 2.5, 'm/s', 'general')] }).length === 0);

t('unit casing and padding do not create a phantom conflict',
  detectConflicts({ facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                            f('b', 'face velocity', 2.5, ' M/S ', 'general')] }).length === 0);

t('project value differing from general is precedence, not conflict',
  detectConflicts({ facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                            f('b', 'face velocity', 2.8, 'm/s', 'project')] }).length === 0);

t('different parameters never collide',
  detectConflicts({ facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                            f('b', 'panel thickness', 50, 'mm', 'general')] }).length === 0);

t('facts on different nodes never collide',
  detectConflicts({ facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                            f('b', 'face velocity', 2.8, 'm/s', 'general', { node_id: 'n2' })] }).length === 0);

t('name matching ignores case and punctuation',
  detectConflicts({ facts: [f('a', 'Face Velocity', 2.5, 'm/s', 'general'),
                            f('b', 'face velocity', 2.8, 'm/s', 'general')] }).length === 1);

const conflicted = detectConflicts({ facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                                             f('b', 'face velocity', 2.8, 'm/s', 'general')] })[0];
t('a conflict carries both values for the reader',
  conflicted.values.length === 2 && conflicted.values.some((v) => v.display.startsWith('2.8')));

const withConflict = {
  matches: [{ nodeId: 'n1', title: 'Cooling coil', kind: 'component', summary: '', scope: 'general',
              standards: [], attributes: [], facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'),
                                                     f('b', 'face velocity', 2.8, 'm/s', 'general')] }],
  unmatchedTerms: [],
  facts: [f('a', 'face velocity', 2.5, 'm/s', 'general'), f('b', 'face velocity', 2.8, 'm/s', 'general')]
};
const cb = knowledgeBlock(withConflict);
t('the prompt block names the conflict', cb.includes('CONFLICTING APPROVED VALUES'));
t('the prompt block forbids silently choosing', cb.includes('Do not silently choose one'));
t('the prompt block shows both values', cb.includes('2.5 m/s') && cb.includes('2.8 m/s'));
t('an uncontested block carries no conflict section', !block.includes('CONFLICTING'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
