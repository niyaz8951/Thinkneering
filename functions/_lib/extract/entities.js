/**
 * HTML character reference decoding.
 * =============================================================================
 * HTMLRewriter does not decode character references in text nodes. Attribute
 * values from getAttribute() come back decoded; text chunks do not. So an
 * article written with typographic quotes — which is most of them — arrives as
 * the literal characters `&#8220;` and lands in the reader looking like markup
 * that leaked.
 *
 * This is applied to text nodes only. Running it over attribute values as well
 * would decode them twice, and double-decoding is its own bug class: `&amp;lt;`
 * means the literal text `&lt;`, and a second pass turns that into `<`.
 *
 * Unknown references are left exactly as they are. A page containing the
 * literal string `&foo;` should still contain it afterwards.
 */

/* The references that actually show up in prose. Not the full HTML5 table —
   that is 2,000 entries for a handful of real hits, and anything missing is
   caught by the numeric forms below, which is how most publishers emit
   punctuation anyway. */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ',          // a normal space: the whole point here is collapsible text
  ensp: ' ', emsp: ' ', thinsp: ' ', hairsp: ' ', numsp: ' ', puncsp: ' ',
  shy: '',            // soft hyphen — invisible, and breaks search if kept

  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201A',
  ldquo: '\u201C', rdquo: '\u201D', bdquo: '\u201E',
  ndash: '\u2013', mdash: '\u2014', horbar: '\u2015',
  hellip: '\u2026', bull: '\u2022', middot: '\u00B7', sdot: '\u22C5',
  prime: '\u2032', Prime: '\u2033',
  lsaquo: '\u2039', rsaquo: '\u203A', laquo: '\u00AB', raquo: '\u00BB',

  copy: '\u00A9', reg: '\u00AE', trade: '\u2122', sect: '\u00A7', para: '\u00B6',
  deg: '\u00B0', plusmn: '\u00B1', times: '\u00D7', divide: '\u00F7',
  minus: '\u2212', frac12: '\u00BD', frac14: '\u00BC', frac34: '\u00BE',
  sup1: '\u00B9', sup2: '\u00B2', sup3: '\u00B3',
  micro: '\u00B5', permil: '\u2030', infin: '\u221E', ne: '\u2260',
  le: '\u2264', ge: '\u2265', asymp: '\u2248', radic: '\u221A',

  euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', cent: '\u00A2', curren: '\u00A4',
  dagger: '\u2020', Dagger: '\u2021',
  larr: '\u2190', rarr: '\u2192', harr: '\u2194', darr: '\u2193', uarr: '\u2191',

  agrave: '\u00E0', aacute: '\u00E1', acirc: '\u00E2', atilde: '\u00E3',
  auml: '\u00E4', aring: '\u00E5', aelig: '\u00E6', ccedil: '\u00E7',
  egrave: '\u00E8', eacute: '\u00E9', ecirc: '\u00EA', euml: '\u00EB',
  igrave: '\u00EC', iacute: '\u00ED', icirc: '\u00EE', iuml: '\u00EF',
  ntilde: '\u00F1', ograve: '\u00F2', oacute: '\u00F3', ocirc: '\u00F4',
  otilde: '\u00F5', ouml: '\u00F6', oslash: '\u00F8',
  ugrave: '\u00F9', uacute: '\u00FA', ucirc: '\u00FB', uuml: '\u00FC',
  yacute: '\u00FD', yuml: '\u00FF', szlig: '\u00DF',
  Agrave: '\u00C0', Aacute: '\u00C1', Acirc: '\u00C2', Auml: '\u00C4',
  Ccedil: '\u00C7', Egrave: '\u00C8', Eacute: '\u00C9', Ecirc: '\u00CA',
  Ntilde: '\u00D1', Ouml: '\u00D6', Uuml: '\u00DC'
};

/* Windows-1252 bytes emitted as if they were code points. Publishers do this
   constantly: `&#147;` is not a valid character reference for a quote mark,
   but it is what a CMS writes when its editor pasted from Word. Left
   untranslated they render as invisible C1 controls, which looks like the text
   simply lost its punctuation. */
const CP1252 = {
  128: '\u20AC', 130: '\u201A', 131: '\u0192', 132: '\u201E', 133: '\u2026',
  134: '\u2020', 135: '\u2021', 136: '\u02C6', 137: '\u2030', 138: '\u0160',
  139: '\u2039', 140: '\u0152', 142: '\u017D', 145: '\u2018', 146: '\u2019',
  147: '\u201C', 148: '\u201D', 149: '\u2022', 150: '\u2013', 151: '\u2014',
  152: '\u02DC', 153: '\u2122', 154: '\u0161', 155: '\u203A', 156: '\u0153',
  158: '\u017E', 159: '\u0178'
};

function fromCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0) return null;
  if (CP1252[cp]) return CP1252[cp];
  // Surrogate halves and anything past the Unicode range are not characters;
  // U+FFFD is the honest rendering of "this was broken in the source".
  if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
  try {
    return String.fromCodePoint(cp);
  } catch (err) {
    return '\uFFFD';
  }
}

export function decodeEntities(text) {
  if (!text || text.indexOf('&') === -1) return text || '';

  return String(text).replace(
    /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, body) => {
      if (body.charAt(0) === '#') {
        const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        const cp = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        const ch = fromCodePoint(cp);
        return ch === null ? match : ch;
      }
      // Case matters: &Eacute; and &eacute; are different letters. Only fall
      // back to a lowercase lookup for references that have no uppercase form.
      if (Object.prototype.hasOwnProperty.call(NAMED, body)) return NAMED[body];
      const lower = body.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(NAMED, lower) && lower === body) {
        return NAMED[lower];
      }
      return match;
    }
  );
}
