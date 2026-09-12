/* The hierarchy layout. A tree is a way of READING the graph, never the model:
   the domain is many-to-many, and forcing one parent is how people end up
   duplicating nodes to keep the picture tidy.

   The forest walk is re-implemented here in the same shape as map.js, which is
   a browser IIFE with no exports. What is pinned is the behaviour a graph
   forces on a tree walk: cycles, multiple parents, and nodes off the spine. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const js = readFileSync(resolve(ROOT, 'tools/knowledge/map.js'), 'utf8');
const css = readFileSync(resolve(ROOT, 'tools/knowledge/knowledge.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'tools/knowledge/map.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

// ---- the walk, same shape as applyTreeLayout()
function build(nodes, edges, spine, collapsed = {}) {
  const childrenOf = {}, parentOf = {}, extra = {}, touched = {};
  for (const e of edges) {
    if (e.relation !== spine) continue;
    touched[e.from] = touched[e.to] = true;
    if (parentOf[e.to] === undefined) {
      parentOf[e.to] = e.from;
      (childrenOf[e.from] = childrenOf[e.from] || []).push(e.to);
    } else extra[e.to] = (extra[e.to] || 0) + 1;
  }
  const roots = [], loose = [];
  for (const n of nodes) {
    if (!touched[n]) { loose.push(n); continue; }
    if (parentOf[n] === undefined) roots.push(n);
  }
  if (!roots.length && !loose.length && nodes.length) roots.push(nodes[0]);

  const meta = {};
  let row = 0, guard = 0;
  function place(id, depth, path) {
    if (guard++ > 500) throw new Error('runaway walk');
    const kids = childrenOf[id] || [];
    const loops = path.has(id);
    meta[id] = { depth, row: row++, extra: extra[id] || 0, loops, kids: kids.length };
    if (loops || collapsed[id]) return;
    const next = new Set(path); next.add(id);
    for (const k of kids) place(k, depth + 1, next);
  }
  for (const r of roots) place(r, 0, new Set());
  for (const l of loose) meta[l] = { depth: 0, row: row++, loose: true, kids: 0, extra: 0 };
  return { meta, roots, loose };
}

// A straight chain.
let r = build(['a','b','c'], [
  { from:'a', to:'b', relation:'feeds' }, { from:'b', to:'c', relation:'feeds' }], 'feeds');
t('the chain has one root', r.roots.length === 1 && r.roots[0] === 'a');
t('depth increases down the chain',
  r.meta.a.depth === 0 && r.meta.b.depth === 1 && r.meta.c.depth === 2);

// A cycle. This is the one that hangs a naive walk.
r = build(['a','b','c'], [
  { from:'a', to:'b', relation:'feeds' },
  { from:'b', to:'c', relation:'feeds' },
  { from:'c', to:'a', relation:'feeds' }], 'feeds');
t('a cycle terminates instead of hanging', true);
t('a cycle with no entry point still gets adopted as a root', r.roots.length === 1);
t('the repeat is marked as looping back',
  Object.values(r.meta).some((m) => m.loops));
t('every node in the cycle is still placed once', Object.keys(r.meta).length === 3);

// Two parents.
r = build(['a','b','coil'], [
  { from:'a', to:'coil', relation:'contains' },
  { from:'b', to:'coil', relation:'contains' }], 'contains');
t('a node with two parents is placed once, not twice',
  Object.keys(r.meta).filter((k) => k === 'coil').length === 1);
t('and the extra parent is counted so it can be admitted', r.meta.coil.extra === 1);
t('both parents are still roots', r.roots.length === 2);

// Off the spine.
r = build(['a','b','x'], [{ from:'a', to:'b', relation:'contains' }], 'contains');
t('a node with no spine edge is not a root', r.roots.indexOf('x') === -1);
t('it goes in the loose group instead', r.loose.length === 1 && r.loose[0] === 'x');
t('and is still placed', r.meta.x && r.meta.x.loose === true);

// Collapse.
r = build(['a','b','c'], [
  { from:'a', to:'b', relation:'feeds' }, { from:'b', to:'c', relation:'feeds' }],
  'feeds', { b: true });
t('a folded branch stops the walk there', r.meta.c === undefined);
t('but the folded node itself is still drawn', r.meta.b !== undefined);
t('and reports how many it is hiding', r.meta.b.kids === 1);

// ---- the rules, in the source
t('the model stays a graph — this is a layout only',
  js.includes('A tree as a LAYOUT, never as the model'));
t('the spine picker offers only relations the map actually uses',
  js.includes('function spineCandidates'));
t('relations used once are not offered — they make a forest of singletons',
  js.includes('count[r] > 1'));
t('the walk carries its own path, so a cycle is detectable',
  js.includes('var next = Object.assign({}, path);'));
t('a collapse is dropped when the spine changes',
  /spineSel[\s\S]{0,300}collapsed = \{\}/.test(js));
t('the forest is built from filtered nodes, not collapsed ones',
  js.includes('function visibleByFilter'));
t('collapse rides on visible(), so edges and fit respect it without a special case',
  /function visible\(node\)[\s\S]{0,400}hiddenByCollapse/.test(js));
t('the collapse ancestry walk is guarded against a cycle too',
  /hiddenByCollapse[\s\S]{0,260}guard\+\+ < 200/.test(js));

// ---- it cannot fight the grid
t('choosing a hierarchy turns the grid off', /grid\.rows && tree\.spine[\s\S]{0,160}tree\.spine = null/.test(js));
t('choosing a grid turns the hierarchy off', /tree\.spine\)[\s\S]{0,200}grid\.rows = null/.test(js));
t('both are treated as one derived-layout state', js.includes('function derivedLayout'));
t('dragging is off for either', js.includes('canMove: canEdit() && !derivedLayout()'));
t('Tidy refuses for either', /if \(derivedLayout\(\)\)[\s\S]{0,200}Tidy arranges the lane view/.test(js));
t('saves still carry authored coordinates',
  (js.match(/authoredPos\(node\)\.x/g) || []).length === 2);

// ---- readable
t('spine edges stay lit — they are the picture',
  js.includes("edge.relation === tree.spine"));
t('the fold control is hit-tested before the node body',
  js.indexOf("closest('[data-collapse]')") < js.indexOf("closest('[data-node-id]')"));
t('the fold glyph does not steal the click', css.includes('pointer-events: none;   /* the circle behind it takes the click */'));
t('the picker exists', html.includes('id="tree-spine"'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
