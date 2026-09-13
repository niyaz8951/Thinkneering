/* The facet grid. Lanes were one categorical attribute drawn as columns with
   nodes stacked inside — a grouping, not a plot. A second axis has to be a
   second attribute, which is what these check.

   The layout maths is lifted out of map.js and re-implemented here in the same
   shape, because map.js is a browser IIFE with no exports. The value is in
   pinning the *rules*: one cell per node, derived positions never saved, and
   an unknown facet value never silently piling up under the first heading. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const js = readFileSync(resolve(ROOT, 'tools/knowledge/map.js'), 'utf8');
const css = readFileSync(resolve(ROOT, 'tools/knowledge/knowledge.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'tools/knowledge/map.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

// --- the model
t('four facets are offered', /FACETS = \{[\s\S]{0,400}lane:[\s\S]{0,400}kind:[\s\S]{0,400}status:[\s\S]{0,400}scope:/.test(js));
t('rows off means the classic lane view', js.includes('rows: null = the classic lane view'));
t('the grid is only on when rows are chosen', js.includes('function gridOn() { return !!grid.rows; }'));

// --- the promise that matters most
t('positions are derived, never written back',
  js.includes('Positions here are DERIVED'));
t('the authored layout is remembered on the way in',
  js.includes('if (n._freeX === undefined) { n._freeX = n.x; n._freeY = n.y; }'));
t('and restored on the way out', js.includes('function restoreFreeLayout'));
t('saves carry authored coordinates, not derived ones',
  (js.match(/authoredPos\(node\)\.x/g) || []).length === 2);
t('no save path still sends raw node.x', !/\n\s+x: node\.x, y: node\.y\n/.test(js));

// --- things that would be wrong but quiet
// Both guards were generalised when the hierarchy layout landed: grid and
// tree are one derived-layout state, so neither can be dragged or tidied.
t('dragging is off in a derived layout, since a dragged node would snap back',
  js.includes('canMove: canEdit() && !derivedLayout()'));
t('Tidy refuses in a derived layout rather than overwriting the hand-placed one',
  /\$\('tidy'\)[\s\S]{0,400}if \(derivedLayout\(\)\)[\s\S]{0,260}return;/.test(js));
t('the same facet on both axes is corrected, not accepted',
  js.includes("grid.cols === grid.rows"));
t('a node with an unknown column value gets its own column',
  js.includes('if (c === -1) c = cols.length;'));

// --- ordering is meaningful, not alphabetical
t('lanes keep the order they were arranged in', /facet === 'lane'[\s\S]{0,300}lanes\.map/.test(js));
t('status runs draft to approved, the direction work travels',
  /\['draft', 'proposed', 'approved'/.test(js));
t('kinds follow the palette order', /Object\.keys\(pack\.nodeKinds\)/.test(js));

// --- readability
t('row bands are drawn, so a sparse row reads as empty rather than as a gap',
  js.includes('function renderGridBands'));
t('edges dim in a grid', js.includes('var gridLinked'));
t('the selected node\'s edges come back up', js.includes('edge.from === selectedId'));
t('selecting redraws so the lit edges change', js.includes('afterSelectionChanged'));
t('edge dimming lives in the renderer, not in CSS fighting an inline style',
  css.includes('Edge dimming in a grid is done in renderEdges()'));

// --- controls
t('rows and columns are both pickable', html.includes('id="grid-rows"') && html.includes('id="grid-cols"'));
t('columns stay hidden until there is something to cross them with',
  html.includes('id="grid-cols-field"') && html.includes('hidden'));

// --- the layout maths, in the same shape as the implementation
const ROW_H = 92, GRID_COL_W = 300, GRID_COL_GAP = 28, GRID_PAD = 20, LANE_TOP = 40;
function layout(nodes, colOf, rowOf) {
  const cols = [...new Set(nodes.map(colOf))];
  const rows = [...new Set(nodes.map(rowOf))];
  const rowHeights = {}, rowTop = {};
  for (const r of rows) {
    let tallest = 1;
    for (const c of cols) {
      const n = nodes.filter((x) => colOf(x) === c && rowOf(x) === r).length;
      if (n > tallest) tallest = n;
    }
    rowHeights[r] = tallest;
  }
  let y = LANE_TOP + 40;
  for (const r of rows) { rowTop[r] = y; y += rowHeights[r] * ROW_H + GRID_PAD * 2; }
  const count = {}, out = new Map();
  for (const n of nodes) {
    const c = cols.indexOf(colOf(n)), r = rowOf(n);
    const key = c + '|' + r;
    count[key] = count[key] || 0;
    out.set(n, {
      x: GRID_PAD + c * (GRID_COL_W + GRID_COL_GAP) + GRID_COL_W / 2,
      y: rowTop[r] + GRID_PAD + count[key] * ROW_H
    });
    count[key]++;
  }
  return { out, rows, rowTop, rowHeights };
}

const sample = [
  { id: 'a', lane: 'pipeline', kind: 'process' },
  { id: 'b', lane: 'pipeline', kind: 'process' },
  { id: 'c', lane: 'pipeline', kind: 'risk' },
  { id: 'd', lane: 'people', kind: 'person' }
];
const L = layout(sample, (n) => n.lane, (n) => n.kind);
const pos = (id) => L.out.get(sample.find((n) => n.id === id));

t('every node gets exactly one position', L.out.size === sample.length);
t('same lane, same column', pos('a').x === pos('b').x);
t('different lane, different column', pos('a').x !== pos('d').x);
t('same cell stacks without overlapping', pos('a').y !== pos('b').y);
t('a different kind is a different row band', pos('a').y !== pos('c').y);
t('row height follows the fullest cell in that row', L.rowHeights.process === 2);
t('a one-node row stays one row tall', L.rowHeights.risk === 1);
t('rows do not overlap',
  L.rowTop.risk >= L.rowTop.process + L.rowHeights.process * ROW_H);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
