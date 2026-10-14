/* =====================================================================
   TN.reflow — text de-wrapping primitives shared by the Text Cleaner and
   the Compliance Maker.

   Both tools answer the same question in different words: is this line
   break the author's intent, or is it where the page ran out of width?
   The Text Cleaner asks it of a manuscript and the Compliance Maker of a
   specification, and until now each carried its own answer.

   What lives here is only the part that is genuinely common. The Text
   Cleaner's prose steps — speech turns, curly quote handling, scene
   breaks — stay in that tool, because running them over a specification
   would corrupt it. joinLines, collapseWhitespace and trim are moved
   verbatim from textcleaner.js so its output stays character-for-
   character identical to the desktop script it was ported from.

   Loaded by the two tools that use it, not by global.js, so the pages
   that do not need it do not pay for it.
   ===================================================================== */
(function () {
  'use strict';

  var RE_NL = /\n/g;
  var RE_CR = /\r/g;
  var RE_WS = /\s+/g;

  /* ---- primitives moved verbatim from the Text Cleaner ---------------- */

  function joinLines(text) {
    return text.replace(RE_NL, ' ').replace(RE_CR, ' ');
  }

  function collapseWhitespace(text) {
    // Python \s and JS \s differ on a few exotic characters. For prose out of
    // Word the practical difference is nil, and this keeps behaviour aligned.
    return text.replace(RE_WS, ' ');
  }

  function trim(text) { return text.trim(); }

  /* ---- line-structure preserving transforms --------------------------- */

  // Everything below keeps one line per line. The Compliance Maker's parser
  // reads structure off the line breaks, so a tidy step that joined them
  // would destroy the thing it is meant to help.

  function normaliseNewlines(text) {
    return text.replace(/\r\n?/g, '\n');
  }

  function trimLineEnds(text) {
    return text.split('\n').map(function (l) {
      return l.replace(/[ \t]+$/, '');
    }).join('\n');
  }

  /* Characters that arrive from a PDF text layer and mean nothing different
     from their ASCII equivalent, but do break a string comparison, a search
     in Excel, and the parser's own patterns. Ligatures are the ones people
     never think of: pdf.js hands back a single "ﬁ" glyph, so "specified"
     does not match a search for "specified". */
  var PUNCT = [
    [/[\u2018\u2019\u201A\u201B]/g, "'"],
    [/[\u201C\u201D\u201E\u201F]/g, '"'],
    [/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-'],
    [/\u2026/g, '...'],
    [/[\u00A0\u2007\u202F\u2009\u200A]/g, ' '],
    [/[\u200B\u200C\u200D\uFEFF]/g, ''],
    [/\uFB01/g, 'fi'], [/\uFB02/g, 'fl'],
    [/\uFB00/g, 'ff'], [/\uFB03/g, 'ffi'], [/\uFB04/g, 'ffl']
  ];

  function normalisePunctuation(text) {
    var out = text;
    for (var i = 0; i < PUNCT.length; i++) out = out.replace(PUNCT[i][0], PUNCT[i][1]);
    return out;
  }

  /* A word split across a line break — "corro-\nsion" — should be closed up.
     A word that is genuinely hyphenated and merely happened to land at the
     end of a line — "cross-\nleakage" — must keep its hyphen, and there is
     no way to tell the two apart without a dictionary.

     So the common hyphenated prefixes of this trade are listed instead.
     When the fragment before the break is one of them the hyphen survives
     and only the line break closes; otherwise the hyphen goes too. Erring
     toward keeping the hyphen is the safer direction: "cross-leakage" read
     as "crossleakage" is a silent corruption of a term an engineer will
     search for, while a stray hyphen is visible on sight. */
  var KEEP_HYPHEN = ('cross non self pre post sub semi multi anti re co ' +
    'high low single double triple air water factory site on off built in ' +
    'out heavy light long short close open fire smoke dust anti counter ' +
    'over under inter intra micro mini max min two three four five').split(' ');

  var RE_HYPHEN_BREAK = /([A-Za-z]{2,})-\n[ \t]*([a-z])/g;

  function dehyphenate(text) {
    return text.replace(RE_HYPHEN_BREAK, function (whole, head, next) {
      var tail = head.split(/[^A-Za-z]/).pop().toLowerCase();
      return KEEP_HYPHEN.indexOf(tail) > -1 ? head + '-' + next : head + next;
    });
  }

  /* Page furniture: the running header, the footer and the page number that
     a PDF repeats on every page and that mean nothing once the text is one
     stream. Three tests have to agree before a line is dropped, because
     dropping a real clause is far worse than keeping a stray header.

     A bare number, or "Page 4 of 71", goes on sight. Anything else must be
     short, must repeat three times or more, and must not end in a full stop
     or a colon — a repeated sentence is content, a repeated title is not.
     Even then the first occurrence is kept, on the grounds that it is
     probably the real section heading and the rest are its echoes. */
  var RE_BARE_PAGE = /^\s*\d{1,4}\s*$/;
  var RE_PAGE_OF   = /^\s*(?:page\s*)?\d{1,4}\s*(?:of|\/)\s*\d{1,4}\s*$/i;
  var RE_PAGE_WORD = /^\s*page\s*[-\u2013]?\s*\d{1,4}\s*$/i;

  function stripPageFurniture(text) {
    var lines = text.split('\n');
    var counts = {}, i, key;

    for (i = 0; i < lines.length; i++) {
      key = lines[i].trim();
      if (key) counts[key] = (counts[key] || 0) + 1;
    }

    var seen = {}, kept = [], removed = 0;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      var t = line.trim();

      if (t && (RE_BARE_PAGE.test(t) || RE_PAGE_OF.test(t) || RE_PAGE_WORD.test(t))) {
        removed++;
        continue;
      }

      if (t && counts[t] >= 3 && t.length <= 80 && !/[.:]$/.test(t)) {
        if (seen[t]) { removed++; continue; }
        seen[t] = true;
      }
      kept.push(line);
    }
    return { text: kept.join('\n'), removed: removed };
  }

  /* The composite the Compliance Maker runs before parsing. Deliberately
     does NOT join lines: the parser needs them. Returns a small report so
     the tool can say what it did rather than changing the text silently. */
  function tidyForParsing(text) {
    var before = text;
    var out = normaliseNewlines(text);

    var furniture = stripPageFurniture(out);
    out = furniture.text;

    var beforeHyphen = out;
    out = dehyphenate(out);
    var joins = countMatches(beforeHyphen, RE_HYPHEN_BREAK);

    var beforePunct = out;
    out = normalisePunctuation(out);
    var punct = beforePunct !== out;

    out = trimLineEnds(out);

    return {
      text: out,
      changed: out !== before,
      removed: furniture.removed,
      joins: joins,
      punctuation: punct
    };
  }

  function countMatches(text, re) {
    var n = 0;
    var r = new RegExp(re.source, re.flags);
    while (r.exec(text) !== null) { n++; if (!r.global) break; }
    return n;
  }

  window.TN = window.TN || {};
  window.TN.reflow = {
    joinLines: joinLines,
    collapseWhitespace: collapseWhitespace,
    trim: trim,
    normaliseNewlines: normaliseNewlines,
    trimLineEnds: trimLineEnds,
    normalisePunctuation: normalisePunctuation,
    dehyphenate: dehyphenate,
    stripPageFurniture: stripPageFurniture,
    tidyForParsing: tidyForParsing
  };
})();
