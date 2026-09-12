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
t('cancelling is distinguished from clearing', page.includes('answer === null'));
t('only an exact in-range number picks from the list',
  page.includes("/^\\d+$/.test(choice)") && page.includes('n <= existing.length'));
t('the shelf reloads after a move', page.includes('await loadShelf()'));
t('the control is admin-only', /canManageBooks[\s\S]{0,200}data-shelf/.test(page));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
