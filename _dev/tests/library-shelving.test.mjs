/* Books could only be given a shelf at upload time, so anything already in the
   library was stuck under Unsorted permanently. These pin the move path and the
   things that make it safe. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

const api = readFileSync(resolve(ROOT, 'functions/api/education/[[path]].js'), 'utf8');
const page = readFileSync(resolve(ROOT, 'education/index.html'), 'utf8');

t('a PATCH route exists', api.includes('export const onRequestPatch'));
t('only a manager may move a book', /onRequestPatch[\s\S]{0,800}educationCanManage/.test(api));
t('the slug is validated', /onRequestPatch[\s\S]{0,1200}SLUG\.test/.test(api));

// R2 cannot edit metadata in place, so the object is re-put. The bytes must be
// read before anything is written, or a failed read leaves a book with half its
// metadata rewritten.
t('the object is read before it is written',
  api.indexOf('await obj.arrayBuffer()') < api.indexOf('meta.collection = encodeMeta'));
t('existing metadata is carried across, not rebuilt',
  api.includes('Object.assign({}, obj.customMetadata || {})'));
t('the original content type survives', api.includes('httpMetadata: obj.httpMetadata'));
t('a no-op move does no write',
  /collection === \(book\.collection \|\| ''\)[\s\S]{0,120}changed: false/.test(api));
t('the move is audited', api.includes("'book.shelve'"));
t('an empty shelf is a real value, not a missing one',
  api.includes('An empty shelf is a real value'));

t('every card offers a shelf control', page.includes('data-shelf='));
t('the control shows the current shelf', page.includes("'Shelf: '"));
t('the picker offers shelves already in use', page.includes('function shelvesInUse'));
t('the shelf reloads after a move', page.includes('await loadShelf()'));
t('the control is admin-only', /canManageBooks[\s\S]{0,260}data-shelf/.test(page));

// prompt() is suppressed outright in an installed PWA, so the button did
// nothing at all once the site was on a home screen.
t('prompt() is not used for this', !/=\s*prompt\(/.test(page));
t('a native <dialog> is used instead', page.includes('<dialog id="shelf-dialog"'));
t('the dialog is labelled for screen readers',
  page.includes('aria-labelledby="shelf-dialog-title"'));
t('it opens modally, so focus is trapped and Escape closes it',
  page.includes('showModal()'));
t('Unsorted is an explicit choice, not the absence of one',
  page.includes('<option value="">Unsorted</option>'));
t('a new shelf can be typed', page.includes('id="shelf-new"'));
t('the new-shelf field only appears when it is wanted',
  page.includes("this.value === '__new'"));
t('choosing New and typing nothing does not silently file it under Unsorted',
  page.includes("pick === '__new' && !choice"));
t('cancelling makes no request', page.includes("returnValue !== 'save'"));
t('the shelf list is rebuilt each time the dialog opens',
  /openShelfDialog[\s\S]{0,600}pick\.innerHTML/.test(page));

const css = readFileSync(resolve(ROOT, 'assets/css/global.css'), 'utf8');
t('the dialog is themed rather than left as the browser default',
  /^dialog\s*{[^}]*--color-surface/m.test(css));
t('the backdrop does not rely on a token it cannot see',
  /dialog::backdrop\s*{[^}]*rgba\(/.test(css));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
