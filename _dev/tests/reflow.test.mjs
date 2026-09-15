/* TN.reflow — the three operations the Text Cleaner refuses to start without. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '../..');
const src = readFileSync(resolve(ROOT, 'assets/js/reflow.js'), 'utf8');
const window = {};
new Function('window', src)(window);
const { joinLines, collapseWhitespace, trim } = window.TN.reflow;

let pass = 0, fail = 0;
const t = (name, got, want) => {
  if (got === want) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
};

t('wrapped lines join into one flow',
  joinLines('The quick brown\nfox jumps over\nthe lazy dog.'),
  'The quick brown fox jumps over the lazy dog.');
t('a blank line is a paragraph break and survives',
  joinLines('First para line one\nline two\n\nSecond para'),
  'First para line one line two\n\nSecond para');
t('several blank lines still make one break',
  joinLines('One\n\n\n\nTwo'), 'One\n\nTwo');
t('CRLF is handled', joinLines('a\r\nb'), 'a b');
t('indented wraps do not leave double spaces',
  joinLines('hello\n    world'), 'hello world');
t('empty input is safe', joinLines(''), '');

t('runs of spaces collapse', collapseWhitespace('a    b'), 'a b');
t('tabs collapse', collapseWhitespace('a\t\tb'), 'a b');
t('non-breaking spaces collapse', collapseWhitespace('a\u00A0\u00A0b'), 'a b');
t('paragraph breaks survive collapsing',
  collapseWhitespace('one\n\ntwo'), 'one\n\ntwo');
t('trailing space before a newline goes', collapseWhitespace('a   \nb'), 'a\nb');

t('trim removes both ends', trim('  hi  '), 'hi');
t('trim on empty is safe', trim(''), '');

// The pipeline order the Text Cleaner uses. These two are not commutative:
// collapsing first would destroy the paragraph breaks joinLines preserves.
const messy = 'Chapter one\nbegins here.\n\n\nIt   continues\nover a wrap.   ';
t('join then collapse then trim, as the cleaner runs them',
  trim(collapseWhitespace(joinLines(messy))),
  'Chapter one begins here.\n\nIt continues over a wrap.');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
