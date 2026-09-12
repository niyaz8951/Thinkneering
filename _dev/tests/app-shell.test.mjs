/* The tab bar is position:fixed and reserves its height with body padding.
   Every mode that claims the whole screen has to hide the bar AND release the
   padding — hiding only the bar leaves a dead strip where it used to be, which
   is most of what "full screen" was meant to remove. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

const g = readFileSync(resolve(ROOT, 'assets/css/global.css'), 'utf8');
const k = readFileSync(resolve(ROOT, 'tools/knowledge/knowledge.css'), 'utf8');

t('reading mode hides the tab bar', /body\.is-reading[^{]*\.tab-bar/.test(g));
t('reading mode releases the reserved height',
  /body\.is-reading\.has-tab-bar\s*{[^}]*padding-bottom:\s*0/.test(g));
t('full-map mode hides the tab bar', /body\.kg-map-full[^{]*\.tab-bar/.test(k));
t('full-map mode releases the reserved height',
  /body\.kg-map-full\.has-tab-bar\s*{[^}]*padding-bottom:\s*0/.test(k));

// Both use !important deliberately: .has-tab-bar sits on the same element, so
// specificity alone cannot settle it. If someone "cleans up" the !important,
// the dead strip comes back silently.
t('the reading override is strong enough to win',
  /body\.is-reading\.has-tab-bar\s*{[^}]*!important/.test(g));
t('the full-map override is strong enough to win',
  /body\.kg-map-full\.has-tab-bar\s*{[^}]*!important/.test(k));

// The map's phone layout: collapsed by default, but nothing removed.
const html = readFileSync(resolve(ROOT, 'tools/knowledge/map.html'), 'utf8');
const js = readFileSync(resolve(ROOT, 'tools/knowledge/map.js'), 'utf8');

t('the foldable controls exist', html.includes('id="controls-rest"'));
t('the More button is wired to them', html.includes('aria-controls="controls-rest"'));
t('a way into full-map mode exists on a phone', html.includes('id="go-full"'));

for (const id of ['status-filter', 'lanes-edit', 'tidy', 'fit']) {
  t(`${id} still exists — folded, not removed`, html.includes('id="' + id + '"'));
}

t('collapsing only ever happens on a phone', js.includes("matchMedia('(max-width: 700px)')"));
t('turning the phone sideways un-collapses it',
  /if \(phone\.matches\)[\s\S]{0,400}else \{[\s\S]{0,300}classList\.remove\('is-collapsed'\)/.test(js));
t('and the layout is re-applied when the width changes',
  js.includes("phone.addEventListener('change', apply)"));
t('the canvas keeps a floor height so nodes stay draggable',
  /\.kg-canvas-wrap\s*{[^}]*min-height/.test(k));
t('canvas height uses dvh, not vh',
  /--kg-canvas-h:\s*calc\(100dvh/.test(k));

// --- Outline is a working view, not a table of contents
t('an outline row opens the editor rather than the canvas',
  /data-goto[\s\S]{0,300}openSheet\('details'\)/.test(js));
t('there is still an explicit way to the map', js.includes("data-reveal"));
t('revealing centres the node rather than dumping you on the canvas',
  /data-reveal[\s\S]{0,400}centreOn\(selectedId\)/.test(js));
t('the open row is marked so you keep your place',
  js.includes("is-selected") && k.includes('.kg-list-row.is-selected'));
t('the list shows where the work is', js.includes('openActionsBy'));
t('closing the sheet refreshes the list it was opened from',
  /closeSheet[\s\S]{0,300}currentView === 'outline'/.test(js));
t('a failed action-count fetch cannot stop the map loading',
  /loadOpenActionCounts[\s\S]{0,600}catch/.test(js));
t('the Map button is always visible on touch, where there is no hover',
  /pointer: coarse[\s\S]{0,120}\.kg-list-reveal/.test(k));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
