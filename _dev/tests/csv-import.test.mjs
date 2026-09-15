/* The CSV parser, and the safety rules the import is built around.

   The bar here is different from the rest of the codebase: an import that
   damages existing data is worse than no import, because you stop trusting the
   graph rather than the tool. These check the parser against what Excel
   actually writes, and check the source for the four guarantees. */
import { parseCsv } from '../../functions/api/admin/import.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  cond ? (pass++, console.log('PASS  ' + name))
       : (fail++, console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')));
};

// --- what Excel actually writes
let r = parseCsv('id,title\r\n1,Coil\r\n2,Fan\r\n');
t('CRLF rows parse', r.rows.length === 2);
t('columns map by header', r.rows[0].title === 'Coil' && r.rows[1].id === '2');

r = parseCsv('\uFEFFid,title\r\n1,Coil\r\n');
t('the BOM is stripped', r.rows[0].id === '1');

// The common case, and the one a naive comma-split corrupts silently.
r = parseCsv('title,summary\r\n"Coil","Copper tube, aluminium fin"\r\n');
t('a comma inside a quoted cell survives',
  r.rows[0].summary === 'Copper tube, aluminium fin');

r = parseCsv('title,summary\r\n"Coil","He said ""no"" twice"\r\n');
t('doubled quotes unescape', r.rows[0].summary === 'He said "no" twice');

r = parseCsv('title,body\r\n"Coil","line one\nline two"\r\n');
t('a newline inside a quoted cell survives', r.rows[0].body === 'line one\nline two');

r = parseCsv('title,summary\r\nCoil,\r\n');
t('an empty cell is an empty string', r.rows[0].summary === '');

r = parseCsv('id,title\r\n\r\n1,Coil\r\n\r\n');
t('blank lines are ignored', r.rows.length === 1);

r = parseCsv('ID , Title \r\n1,Coil\r\n');
t('headers are trimmed and lowercased', r.rows[0].title === 'Coil');

// Our own export guards cells starting = + - @ with a leading quote.
r = parseCsv("title,summary\r\nCoil,'=SUM(A1)\r\n");
t('the formula guard is removed on the way back in', r.rows[0].summary === '=SUM(A1)');

let threw = false;
try { parseCsv('title\r\n"never closed\r\n'); } catch (e) { threw = true; }
t('an unclosed quote is an error, not silent corruption', threw);

t('an empty file yields no rows', parseCsv('').rows.length === 0);
t('a header with no rows yields no rows', parseCsv('id,title\r\n').rows.length === 0);

// --- the four guarantees, in the source
const src = readFileSync(resolve(ROOT, 'functions/api/admin/import.js'), 'utf8');

t('nothing is deleted — there is no delete statement at all',
  !/DELETE\s+FROM/i.test(src));
t('preview is the default', src.includes('const apply = body.apply === true;'));
t('a preview writes nothing', /if \(!apply[\s\S]{0,200}preview: true/.test(src));
t('approved nodes are not overwritten without asking',
  src.includes("target.status === 'approved' && !updateApproved"));
t('a CSV cannot set status', !src.includes('status = ?'));
t('a CSV cannot approve anything', !/approved_by\s*=/.test(src));
t('new rows land as drafts', src.includes("'draft'"));
t('only listed fields are written', src.includes('NODE_FIELDS.forEach'));
t('an absent column leaves the field alone', src.includes("if (!(f in row)) return;"));
t('an unknown id is refused rather than creating a node with it',
  src.includes('Clear the id column to create it'));
t('a repeated title inside one file is caught', src.includes('seenTitles'));
t('edges accept titles, not just ids', src.includes('byTitle.get(normaliseTerm(s))'));
t('a failed write says nothing changed', src.includes('nothing was changed'));
t('the row limit keeps the write inside one request', src.includes('MAX_ROWS'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
