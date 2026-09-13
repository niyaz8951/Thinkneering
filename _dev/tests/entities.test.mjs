/* HTMLRewriter does not decode character references in text nodes, so an
   article written with typographic quotes arrives with the literal characters
   `&#8220;` in it. These pin the decoding and, just as importantly, the things
   it must leave alone. */
import { decodeEntities } from '../../functions/_lib/extract/entities.js';

let pass = 0, fail = 0;
const t = (name, got, want) => {
  if (got === want) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
};

// The exact string from the James Clear article.
t('the reported bug',
  decodeEntities('saying, &#8220;Remember that there is no code faster than no code.&#8221;'),
  'saying, \u201CRemember that there is no code faster than no code.\u201D');

t('decimal references', decodeEntities('&#8212;&#8230;'), '\u2014\u2026');
t('hex references, lower and upper x',
  decodeEntities('&#x201C;a&#X2019;b'), '\u201Ca\u2019b');
t('named punctuation',
  decodeEntities('&ldquo;x&rdquo; &mdash; &hellip;'), '\u201Cx\u201D \u2014 \u2026');
t('the basics', decodeEntities('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'');
t('nbsp becomes a collapsible space', decodeEntities('a&nbsp;b'), 'a b');
t('soft hyphen disappears rather than breaking search',
  decodeEntities('com&shy;pliance'), 'compliance');
t('accented letters', decodeEntities('caf&eacute; na&iuml;ve'), 'café naïve');
t('case is respected — these are different letters',
  decodeEntities('&Eacute;&eacute;'), '\u00C9\u00E9');

// CP1252 mislabelled as code points. Publishers emit these constantly; left
// alone they render as invisible C1 controls, so the text looks like it simply
// lost its punctuation.
t('windows-1252 smart quotes', decodeEntities('&#147;hi&#148;'), '\u201Chi\u201D');
t('windows-1252 apostrophe', decodeEntities('it&#146;s'), 'it\u2019s');

// What it must not touch.
t('unknown named references are left exactly as they are',
  decodeEntities('&foo; &notreal;'), '&foo; &notreal;');
t('a bare ampersand is not a reference', decodeEntities('Tom & Jerry'), 'Tom & Jerry');
t('an unterminated reference is left alone', decodeEntities('&amp no semicolon'), '&amp no semicolon');
t('it does not decode twice — &amp;lt; means the literal text &lt;',
  decodeEntities('&amp;lt;'), '&lt;');
t('text with no ampersand is returned untouched', decodeEntities('plain text'), 'plain text');
t('empty input is safe', decodeEntities(''), '');
t('null is safe', decodeEntities(null), '');

// Malformed input should degrade, not throw.
t('a surrogate half becomes the replacement character',
  decodeEntities('&#xD800;'), '\uFFFD');
t('a code point past Unicode becomes the replacement character',
  decodeEntities('&#x110000;'), '\uFFFD');
t('emoji survive', decodeEntities('&#128512;'), '\u{1F600}');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
