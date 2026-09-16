/* The outline view: one data model, two views.
   =============================================================================
   The outline is a second renderer of the same nodes and edges the canvas
   draws — a line is a node, an indented line is an `under` edge — and every
   edit goes through /api/knowledge/graph. What is pinned here is exactly the
   set of things that would quietly turn it back into a separate list. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const js = read('tools/knowledge/map.js');
const html = read('tools/knowledge/map.html');
const css = read('tools/knowledge/knowledge.css');
const api = read('functions/api/knowledge/graph.js');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

// --- one store
t('the outline reads the same node list the canvas reads', /function buildTree\(\)[\s\S]{0,400}nodes\.forEach/.test(js));
t('and the same edge list', /function buildTree\(\)[\s\S]{0,600}edges\.forEach/.test(js));
// The only thing the page keeps in the browser is which view you were on.
const stored = (js.match(/localStorage\.setItem\('([^']+)/g) || []).map((m) => m.slice(22));
t('it keeps no store of its own — only the view preference is remembered locally',
  stored.length > 0 && stored.every((k) => k.indexOf('tn-kg-view:') === 0));
t('every outline write is the graph endpoint', /async function postNode[\s\S]{0,200}\/api\/knowledge\/graph/.test(js) &&
  /async function postEdge[\s\S]{0,200}\/api\/knowledge\/graph/.test(js));
t('a write is followed by a reload of both views', /async function commitTitle[\s\S]{0,900}await reload\(\)/.test(js) &&
  /async function reparent[\s\S]{0,2200}await reload\(\)/.test(js));

// --- the tree is an edge
t('indentation is a relation the pack names', js.includes('pack.outline.relation'));
t('an existing containment hierarchy also reads as a tree', /function treeRelations[\s\S]{0,300}contains/.test(js));
t('the note under a line is the summary, editable in place', js.includes('data-ol-note') && /async function commitNote/.test(js));
t('a note change goes through the full save, so approval is honest', /async function commitNote[\s\S]{0,900}proposed/.test(js));
t('Enter on an open branch adds the first child', /Enter on a line whose branch is open/.test(js));
t('the caret is only moved when a keyboard action asked', js.includes('ol.wantFocus = false'));
t('children of a deleted line keep their order', /var cursor = around\[here - 1\][\s\S]{0,400}cursor = kids\[k\]/.test(js));
t('a refused edge names the migration', js.includes('2026-09-outline.sql'));
t('Tab creates that edge from the new parent', /async function reparent[\s\S]{0,800}postEdge\(newParentId, n\.id\)/.test(js));
t('and removes the old outline edge first', /async function reparent[\s\S]{0,600}old\.relation === treeRelation\(\)\) await deleteEdge\(old\.id\)/.test(js));
t('but never a containment fact written on the canvas', /re-filing a line must not delete it/.test(js));
for (const pack of ['domain-hvac', 'domain-business', 'domain-english', 'domain-sbu']) {
  const p = read('tools/knowledge/' + pack + '.js');
  t(`${pack} declares the outline relation`, /outline:\s*\{\s*relation:\s*'under'/.test(p));
  t(`${pack} can draw under`, /under:\s*\{/.test(p));
}
t('under is legal for every kind pair by migration', existsSync(resolve(ROOT, 'db/2026-09-outline.sql')) &&
  /SELECT a\.kind, b\.kind, 'under'/.test(read('db/2026-09-outline.sql')));

// --- approval is untouched by layout, touched by content
t('the API has a position-only save', api.includes('body.positionOnly'));
t('which does not bump the version', /if \(body\.positionOnly\)[\s\S]{0,700}position-saved/.test(api) &&
  !/if \(body\.positionOnly\)[\s\S]{0,700}version=version\+1/.test(api));
t('reordering uses it', /async function outlineMove[\s\S]{0,900}savePosition/.test(js));
t('reparenting uses it', /async function reparent[\s\S]{0,2000}savePosition\(n\)/.test(js));
t('a rename goes through the full save, so an approved node returns to review',
  /async function commitTitle[\s\S]{0,900}proposed/.test(js));
t('a typed line is a draft', /async function outlineAdd[\s\S]{0,2200}Added as a draft/.test(js));
t('draft and approved read differently', css.includes('.kg-ol-dot[data-draft]'));

// --- Workflowy keys
t('Enter adds a line', /ev\.key === 'Enter'[\s\S]{0,400}outlineAdd\(ev\.shiftKey\)/.test(js));
t('Tab and Shift+Tab reparent', /ev\.key === 'Tab'[\s\S]{0,300}outlineOutdent\(\); else await outlineIndent\(\)/.test(js));
t('arrows move between lines', /ev\.key === 'ArrowUp' \|\| ev\.key === 'ArrowDown'/.test(js));
t('branches fold', js.includes('data-ol-fold'));
t('the kind is a tag on the line', js.includes('data-ol-kind'));
t('cross-links are read-only chips', js.includes('kg-ol-chip') && js.includes('data-ol-jump'));

// --- delete
t('delete asks', html.includes('id="ol-delete-dialog"'));
t('keeping the children moves them up', /mode === 'branch'[\s\S]{0,1200}postEdge\(grand, kids\[k\]\.id\)/.test(js));
t('the whole branch is a separate, named choice', html.includes('id="ol-delete-branch"'));

// --- phone
for (const id of ['ol-add', 'ol-child', 'ol-indent', 'ol-outdent', 'ol-up', 'ol-down']) {
  t(`${id} exists for thumbs`, html.includes('id="' + id + '"'));
}
t('the toolbar is the Tab key on a phone', /max-width: 700px[\s\S]{0,600}\.kg-ol-bar \.kg-btn \{ flex: 1 1 auto/.test(css));

// --- the pinned outline hooks still hold
t('a row still opens the sheet', js.includes('data-goto'));
t('and can still reveal on the map', js.includes('data-reveal'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
