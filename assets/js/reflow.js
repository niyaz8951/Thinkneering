/**
 * TN.reflow — the three text operations that are not prose-specific.
 * =============================================================================
 * The Text Cleaner refers to this module and refuses to start without it:
 *
 *   var reflow = (window.TN && window.TN.reflow) || null;
 *   if (!reflow) throw new Error('TN.reflow is required — ...');
 *
 * That guard is deliberate — falling back to a local copy would hide the fault
 * and ship a page that half works — but the file it names was never committed,
 * so the Text Cleaner threw on load for every visitor. This is that file.
 *
 * The three operations live here rather than in the cleaner because they are
 * about whitespace, not about prose: joining wrapped lines back into
 * paragraphs, collapsing runs of whitespace, and trimming the ends. Anything
 * that ingests text someone pasted out of a PDF needs the same three.
 *
 * Ordering note for callers: joinLines runs before collapseWhitespace in the
 * Text Cleaner's pipeline, and the two are not commutative. joinLines turns
 * single newlines into spaces while keeping blank-line paragraph breaks;
 * collapsing whitespace first would destroy those breaks and glue the whole
 * document into one paragraph.
 */
(function (global) {
  'use strict';

  var TN = global.TN = global.TN || {};

  // A blank line — one newline, optional spaces, another newline — is a
  // paragraph break and survives. A lone newline is a wrap artefact from the
  // PDF or the email client and becomes a space.
  var RE_CRLF = /\r\n?/g;
  var RE_PARA = /\n[ \t]*\n[\s\n]*/g;
  var RE_SINGLE_NL = /[ \t]*\n[ \t]*/g;
  var RE_HSPACE = /[ \t\u00A0]+/g;
  var RE_SPACE_BEFORE_NL = /[ \t]+\n/g;
  var RE_NL_RUN = /\n{3,}/g;

  var PARA_MARK = '\u0000TNPARA\u0000';

  /**
   * Join wrapped lines back into flowing paragraphs.
   *
   * Text copied out of a PDF arrives broken at the column the page happened to
   * be set in, which is meaningless once it is in a textarea. Single newlines
   * become spaces; blank lines stay, because those are the author's paragraphs
   * rather than the typesetter's line length.
   */
  function joinLines(text) {
    if (!text) return '';
    return String(text)
      .replace(RE_CRLF, '\n')
      // Park real paragraph breaks somewhere the newline rule cannot see them.
      .replace(RE_PARA, PARA_MARK)
      .replace(RE_SINGLE_NL, ' ')
      .split(PARA_MARK).join('\n\n');
  }

  /**
   * Collapse runs of whitespace.
   *
   * Horizontal runs — spaces, tabs, the non-breaking spaces a word processor
   * leaves behind — become one space. Newlines are left alone: by the time
   * this runs, the newlines still present are paragraph breaks that joinLines
   * deliberately kept, and flattening them here would undo that work.
   */
  function collapseWhitespace(text) {
    if (!text) return '';
    return String(text)
      .replace(RE_CRLF, '\n')
      .replace(RE_HSPACE, ' ')
      .replace(RE_SPACE_BEFORE_NL, '\n')
      .replace(RE_NL_RUN, '\n\n');
  }

  /** Trim the ends. Nothing clever: String.prototype.trim, named for the
      pipeline so a step list reads as a list of steps. */
  function trim(text) {
    return text ? String(text).trim() : '';
  }

  TN.reflow = {
    joinLines: joinLines,
    collapseWhitespace: collapseWhitespace,
    trim: trim
  };
})(window);
