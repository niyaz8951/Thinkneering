/* Text Cleaner — a faithful port of the Python pipeline in app.py.
 *
 * Each step is the same transform in the same order, so output matches the
 * desktop script character for character. Where JavaScript regex differs
 * from Python's `re`, the difference is noted at the step.
 *
 * Built for repetition: paste anywhere on the page and the cleaned text is on
 * your clipboard before you have taken your hand off the keyboard.
 *
 * Static build. No server, no account, no upload — the file is read and the
 * text is transformed in the browser and nowhere else.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORE_KEY = 'tn.text-cleaner.settings';

  /* Filling a textarea with a megabyte of text costs far more than cleaning
     it does. Past this length the result is still copied and downloadable —
     only the on-screen preview waits until it is asked for. */
  var PREVIEW_LIMIT = 200000;

  /* Above this, re-cleaning on every keystroke would stutter, so typing stops
     re-running and the button takes over. */
  var LIVE_LIMIT = 120000;

  /* ------------------------------------------------------------------ steps
     Order matters and is not arbitrary — several steps depend on an earlier
     one having already run. Collapsing whitespace before the quote handling,
     for instance, is what makes the quote patterns predictable.

     Patterns are compiled once at load rather than rebuilt on every call.
     String.replace resets lastIndex on a /g pattern, so reuse is safe. */

  var RE_NL = /\n/g;
  var RE_CR = /\r/g;
  var RE_WS = /\s+/g;
  var RE_LDQUO = /\u201C/g;
  var RE_RDQUO = /\u201D/g;
  var RE_SPEECH = /(?:\s|^)([\u2018\u2019])|\.\s*\u2019|(?<!,)\s*\u2018.*?\u2019|\n\s*/g;
  var RE_COMMA_QUOTE = /,\s*\n\s*\u2018/g;
  var RE_PERIOD_QUOTE = /\.\s*(\u2019)\s*/g;
  var RE_TRAIL_WS = /\s+$/;
  var RE_TRAIL_NL = /\n+$/;
  var RE_SCENE = /\*{5,}/g;
  var RE_SEMI = /;\s/g;
  var RE_DOT = /\./g;

  /* These three are not prose-specific — the Compliance Maker needs the same
     three — so they live in TN.reflow now and are called from there. The
     implementations moved verbatim, so output is unchanged; the thin
     wrappers stay so STEPS and its per-step reporting are untouched.

     RE_NL, RE_CR and RE_WS above are kept because other steps read them.

     If reflow.js failed to load, falling back to a local copy would hide the
     fault and ship a page that half works. Better to fail where it broke. */
  var reflow = (window.TN && window.TN.reflow) || null;
  if (!reflow) throw new Error('TN.reflow is required — check assets/js/reflow.js is loaded');

  function removeLineBreaks(text) { return reflow.joinLines(text); }

  function removeDoubleSpaces(text) { return reflow.collapseWhitespace(text); }

  function trimText(text) { return reflow.trim(text); }

  function curlyDoubleToSingle(text) {
    return text.replace(RE_LDQUO, '\u2018').replace(RE_RDQUO, '\u2019');
  }

  /* Breaks a line before an opening single curly quote, so each speech turn
     starts on its own line. The Python original relies on group(1) being the
     quote character; the same grouping is preserved here. */
  function formatWithNewline(text) {
    return text.replace(RE_SPEECH, function (whole, g1) {
      if (g1 === '\u2018') return '\n' + g1;
      if (whole.charAt(0) === '\u2018' && whole.charAt(whole.length - 1) === '\u2019') {
        return whole.trim() + '\n';
      }
      return whole;
    }).trim();
  }

  function joinCommaBeforeQuote(text) {
    return text.replace(RE_COMMA_QUOTE, ', \u2018');
  }

  function breakAfterPeriodQuote(text) {
    return text.replace(RE_PERIOD_QUOTE, '.$1\n');
  }

  /* A line that opens with a quote, closes it, and then continues past a full
     stop is two sentences pretending to be one. Split at the space after that
     first full stop. */
  function processCurlyQuotes(text) {
    return text.split('\n').map(function (line) {
      if (line.charAt(0) === '\u2018' &&
          line.indexOf('\u2019') > -1 &&
          (line.match(RE_DOT) || []).length > 1) {
        var fullStop = line.indexOf('.');
        var closeQuote = line.indexOf('\u2019');
        var firstSpace = line.indexOf(' ');
        if (closeQuote > firstSpace && fullStop > closeQuote) {
          var space = line.indexOf(' ', fullStop);
          if (space > fullStop) {
            line = line.slice(0, space) + '\n' + line.slice(space + 1);
          }
        }
      }
      return line;
    }).join('\n').replace(RE_TRAIL_WS, '');
  }

  /* Wrap over-long paragraphs at a sentence boundary. This mirrors the Python
     loop exactly, including the case where no suitable full stop is found and
     the line is left long rather than cut mid-sentence. */
  function breakLongParagraphs(text, maxLen) {
    var out = [];
    text.split('\n').forEach(function (line) {
      while (line.length > maxLen) {
        var fullStop = line.lastIndexOf('.', maxLen);
        if (fullStop === -1) break;
        var space = line.indexOf(' ', fullStop);
        if (space === -1 || space <= fullStop) break;
        out.push(line.slice(0, space));
        line = line.slice(space + 1);
      }
      out.push(line);
    });
    return out.join('\n').replace(RE_TRAIL_NL, '');
  }

  function spaceSceneBreaks(text) {
    return text.replace(RE_SCENE, function (m) {
      return '\n\n\n\n\n\n\n\n' + m + '\n\n\n\n\n\n\n\n';
    });
  }

  function breakAtSemicolon(text) {
    return text.replace(RE_SEMI, ';\n').trim();
  }

  /* Steps are declared as data so the UI can list them, let you switch any one
     off, and show which ones actually changed anything on this run. */
  var STEPS = [
    { id: 'joinlines',  label: 'Join every line into one flow',        fn: removeLineBreaks },
    { id: 'spaces',     label: 'Collapse repeated whitespace',         fn: removeDoubleSpaces },
    { id: 'trim',       label: 'Trim leading and trailing space',      fn: trimText },
    { id: 'quotes',     label: 'Curly double quotes to single',        fn: curlyDoubleToSingle },
    { id: 'speech',     label: 'New line at each speech opening',      fn: formatWithNewline },
    { id: 'comma',      label: 'Rejoin “, ‘” split across lines',      fn: joinCommaBeforeQuote },
    { id: 'periodq',    label: 'Break after a closing quote',          fn: breakAfterPeriodQuote },
    { id: 'splitquote', label: 'Split narration off a speech line',    fn: processCurlyQuotes },
    { id: 'longpara',   label: 'Wrap long paragraphs at a sentence',   fn: null },
    { id: 'scenebreak', label: 'Space out ***** scene breaks',         fn: spaceSceneBreaks },
    { id: 'semicolon',  label: 'New line after each semicolon',        fn: breakAtSemicolon }
  ];

  function run(input, enabled, maxLen) {
    var text = input;
    var report = [];
    STEPS.forEach(function (step) {
      if (!enabled[step.id]) { report.push({ id: step.id, skipped: true }); return; }
      var before = text;
      text = step.id === 'longpara'
        ? breakLongParagraphs(text, maxLen)
        : step.fn(text);
      report.push({ id: step.id, changed: before !== text });
    });
    return { text: text, report: report };
  }

  /* ------------------------------------------------------------------- ui */

  var lastOutput = '';      // full result, even when the preview is held back
  var lastInput = null;     // for skipping identical re-runs
  var lastSig = '';
  var lastFlags = {};       // avoids rewriting step flags that have not moved
  var previewShown = true;
  var runCount = 0;
  var typeTimer = null;

  /* --- counting ---------------------------------------------------------
     One pass, no intermediate arrays. split(/\s+/) on a large paste allocates
     a word-sized array every time and was the slowest thing on the page. */
  function stats(text) {
    var chars = text.length, words = 0, lines = 0, inWord = false, i, c;
    for (i = 0; i < chars; i++) {
      c = text.charCodeAt(i);
      if (c === 10) lines++;
      if (c === 32 || c === 10 || c === 9 || c === 13) {
        inWord = false;
      } else if (!inWord) {
        inWord = true; words++;
      }
    }
    return { chars: chars, words: words, lines: chars ? lines + 1 : 0 };
  }

  function n(x) { return x.toLocaleString(); }

  function setStatus(msg, kind) {
    var el = $('status');
    if (el.textContent !== msg) el.textContent = msg || '';
    var cls = 'tc-status' + (kind ? ' is-' + kind : '');
    if (el.className !== cls) el.className = cls;
  }

  /* --- clipboard ---------------------------------------------------------
     Called inside the paste or click handler so the browser still counts it
     as a user action. The execCommand path is the fallback for browsers that
     refuse the async API. */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('copy blocked'));
  }

  /* --- collapsible panels ------------------------------------------------ */

  function initDisclosures() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-disclosure]'), function (btn) {
      var body = $(btn.getAttribute('aria-controls'));
      if (!body) return;
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        body.hidden = open;
      });
    });
    // Chevrons come from the shared icon registry rather than inline SVG.
    Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), function (span) {
      span.innerHTML = TN.icon(span.getAttribute('data-icon'), 20);
    });
  }

  /* --- settings ----------------------------------------------------------- */

  function renderSteps() {
    $('steps').innerHTML = STEPS.map(function (s) {
      return '<label class="tc-toggle">' +
        '<input type="checkbox" id="step-' + s.id + '" checked>' +
        '<span>' + TN.esc(s.label) + '</span>' +
        '<span class="tc-flag" id="flag-' + s.id + '"></span></label>';
    }).join('');
  }

  function enabledSteps() {
    var out = {};
    STEPS.forEach(function (s) { out[s.id] = $('step-' + s.id).checked; });
    return out;
  }

  function maxLen() {
    return Math.max(80, Math.min(5000, parseInt($('maxlen').value, 10) || 500));
  }

  function opt(id) { return $('opt-' + id).checked; }

  function settingsSignature() {
    return STEPS.map(function (s) { return $('step-' + s.id).checked ? '1' : '0'; }).join('') + ':' + maxLen();
  }

  function updateStepSummary() {
    var on = STEPS.filter(function (s) { return $('step-' + s.id).checked; }).length;
    $('meta-settings').textContent = on === STEPS.length
      ? 'all ' + STEPS.length + ' on'
      : on + ' of ' + STEPS.length + ' on';
  }

  /* Settings stay on this machine so a repeat user sets them once, not once an
     hour. Nothing leaves the browser. */
  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        steps: enabledSteps(),
        maxlen: maxLen(),
        autopaste: opt('autopaste'),
        autocopy: opt('autocopy'),
        reselect: opt('reselect')
      }));
    } catch (e) { /* private mode — carry on without saving */ }
  }

  function loadSettings() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return;
    if (saved.steps) {
      STEPS.forEach(function (s) {
        if (typeof saved.steps[s.id] === 'boolean') $('step-' + s.id).checked = saved.steps[s.id];
      });
    }
    if (saved.maxlen) $('maxlen').value = saved.maxlen;
    ['autopaste', 'autocopy', 'reselect'].forEach(function (k) {
      if (typeof saved[k] === 'boolean') $('opt-' + k).checked = saved[k];
    });
  }

  function resetSettings() {
    STEPS.forEach(function (s) { $('step-' + s.id).checked = true; });
    $('maxlen').value = 500;
    ['autopaste', 'autocopy', 'reselect'].forEach(function (k) { $('opt-' + k).checked = true; });
    updateStepSummary();
    saveSettings();
    lastInput = null;
    if (lastOutput) clean({ copy: false });
    setStatus('Defaults restored.', 'ok');
  }

  /* --- meta lines --------------------------------------------------------- */

  function updateInputMeta() {
    var s = stats($('input').value);
    $('meta-text').textContent = s.chars ? n(s.chars) + ' chars · ' + n(s.words) + ' words' : 'empty';
  }

  function updateResultMeta(ms) {
    var has = !!lastOutput;
    $('meta-result').textContent = has
      ? 'run ' + runCount + ' · ' + (ms != null ? Math.round(ms) + ' ms' : 'ready')
      : 'nothing yet';
    if ($('btn-copy').disabled === has) {
      $('btn-copy').disabled = !has;
      $('btn-download').disabled = !has;
      // lastOutput holds the whole result even when the preview is held back
      // for length, so this tracks the real thing rather than what is painted.
      $('btn-save-book').disabled = !has;
    }
  }

  function paintPreview() {
    var out = $('output');
    if (lastOutput.length > PREVIEW_LIMIT && !previewShown) {
      if (out.value) out.value = '';
      $('preview-note').hidden = false;
    } else {
      if (out.value !== lastOutput) out.value = lastOutput;
      $('preview-note').hidden = true;
    }
  }

  /* --- the run ------------------------------------------------------------- */

  function clean(options) {
    options = options || {};
    var input = $('input').value;

    if (!input.trim()) {
      if (!options.silent) { setStatus('Paste some text first.', 'error'); $('input').focus(); }
      return false;
    }

    var sig = settingsSignature();
    if (input === lastInput && sig === lastSig && lastOutput) {
      // Nothing has changed since the last run — copy and move on rather than
      // burning the work again.
      if (options.copy) copyAndReport(true, null);
      return true;
    }

    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var result = run(input, enabledSteps(), maxLen());
    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();

    lastOutput = result.text;
    lastInput = input;
    lastSig = sig;
    runCount++;
    previewShown = lastOutput.length <= PREVIEW_LIMIT;

    paintPreview();

    // Only touch the flags that actually moved.
    result.report.forEach(function (r) {
      var text = r.skipped ? 'off' : (r.changed ? 'applied' : 'no change');
      if (lastFlags[r.id] === text) return;
      lastFlags[r.id] = text;
      var flag = $('flag-' + r.id);
      flag.textContent = text;
      flag.className = 'tc-flag' + (r.skipped ? ' is-off' : (r.changed ? ' is-on' : ''));
    });

    var a = stats(input), b = stats(lastOutput);
    $('stats').textContent =
      n(a.chars) + ' chars, ' + n(a.lines) + ' lines  ->  ' +
      n(b.chars) + ' chars, ' + n(b.lines) + ' lines  (' + n(b.words) + ' words)';

    updateResultMeta(t1 - t0);

    if (options.copy) copyAndReport(false, t1 - t0);
    else setStatus('Cleaned in ' + Math.round(t1 - t0) + ' ms.', 'ok');

    if (options.reselect && opt('reselect')) {
      var box = $('input');
      box.focus();
      box.select();
    }
    return true;
  }

  function copyAndReport(unchanged, ms) {
    copyText(lastOutput).then(function () {
      setStatus(
        (unchanged
          ? 'Already clean — copied.'
          : 'Cleaned and copied' + (ms != null ? ' in ' + Math.round(ms) + ' ms' : '') + '.') +
        '  Run ' + runCount + ' this session.', 'ok');
    }).catch(function () {
      setStatus('Cleaned, but the browser blocked the copy — press Ctrl+Shift+C.', 'error');
    });
  }

  /* --- paste fast path -----------------------------------------------------
     The whole point of the tool for a repeat user: one keystroke in, cleaned
     text back on the clipboard. Handled synchronously inside the paste event
     so the clipboard write still counts as a user action. */
  function onPaste(ev) {
    var t = ev.target;
    // Leave the file-name and wrap-length fields alone.
    if (t && t !== $('input') && (t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (!opt('autopaste')) return;

    var data = ev.clipboardData || window.clipboardData;
    if (!data) return;
    var pasted = data.getData('text');
    if (!pasted) return;

    ev.preventDefault();
    var box = $('input');

    if (t === box) {
      // Respect the cursor, and keep the browser's own undo stack.
      box.focus();
      var inserted = false;
      try { inserted = document.execCommand('insertText', false, pasted); } catch (e) { inserted = false; }
      if (!inserted) {
        var s = box.selectionStart, e2 = box.selectionEnd;
        box.value = box.value.slice(0, s) + pasted + box.value.slice(e2);
        box.selectionStart = box.selectionEnd = s + pasted.length;
      }
    } else {
      box.value = pasted;   // pasted onto the page — treat it as a fresh job
    }

    updateInputMeta();
    clean({ copy: opt('autocopy'), reselect: true });
  }

  /* --- files ---------------------------------------------------------------- */

  function loadFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setStatus('That file is over 8 MB — paste the text instead.', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      $('input').value = String(reader.result || '');
      $('filename').value = file.name.replace(/\.txt$/i, '');
      updateInputMeta();
      clean({ copy: false });
      setStatus('Loaded and cleaned ' + file.name + '. Press Ctrl+Shift+C to copy.', 'ok');
    };
    reader.onerror = function () { setStatus('Could not read that file.', 'error'); };
    reader.readAsText(file, 'utf-8');
  }

  function download() {
    if (!lastOutput) { setStatus('Nothing to download yet.', 'error'); return; }
    var name = ($('filename').value || 'cleaned').replace(/[^\w.-]+/g, '-').replace(/\.txt$/i, '');
    var blob = new Blob([lastOutput], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name + '_UPDATED.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus('Saved ' + name + '_UPDATED.txt.', 'ok');
  }

  function clearAll() {
    $('input').value = '';
    $('output').value = '';
    $('stats').textContent = '';
    lastOutput = ''; lastInput = null; lastSig = ''; lastFlags = {};
    $('preview-note').hidden = true;
    STEPS.forEach(function (s) { $('flag-' + s.id).textContent = ''; });
    updateInputMeta();
    updateResultMeta();
    setStatus('Cleared. Paste the next one.');
    $('input').focus();
  }

  function copyNow() {
    if (!lastOutput) { setStatus('Nothing to copy yet.', 'error'); return; }
    copyText(lastOutput)
      .then(function () { setStatus('Copied to the clipboard.', 'ok'); })
      .catch(function () { setStatus('Copy blocked — select the text and copy manually.', 'error'); });
  }

  /* ------------------------------------------------------------------- init
     Runs on tn:ready so the shared header and footer are already mounted and
     TN.icon is available for the chevrons. */
  /* --- save to the Education library ---------------------------------------
     The flow lives in /assets/js/save-to-book.js, shared with the Web Text
     Extractor. A cleaned manuscript is the most common thing anyone wants on
     the shelf, and retyping it through the Education uploader was the step
     that made people not bother. */

  function initSaveBook() {
    if (!window.TNSaveBook) return;

    TNSaveBook.mount({
      panel: $('save-book'),
      trigger: $('btn-save-book'),
      titleInput: $('book-title'),
      status: $('book-status'),
      saveButton: $('btn-book-save'),
      cancelButton: $('btn-book-cancel'),
      getText: function () { return lastOutput; },
      // The file name field is already the closest thing to a title the page
      // has, so it seeds the book name rather than leaving it blank.
      getTitle: function () {
        var f = $('filename').value.trim();
        return (!f || f === 'cleaned') ? '' : f;
      },
      getCollection: function () { return $('book-collection').value.trim(); },
      getDescription: function () { return 'Cleaned in the Text Cleaner'; }
    });

    $('btn-book-cancel').addEventListener('click', function () { $('btn-save-book').focus(); });
    $('book-title').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); $('btn-book-save').click(); }
    });

    /* Only an admin can add a book, so nobody else is shown a button that
       would be refused. tn:ready may already have fired by the time this
       runs, so the loaded session is checked first rather than only
       listening — otherwise the button never appears on a warm cache. */
    function reveal(user) {
      if (!user || user.role !== 'admin') return;
      $('btn-save-book').hidden = false;
    }
    if (window.TN && TN.session && TN.session.loaded) reveal(TN.session.user);
    else document.addEventListener('tn:ready', function (ev) { reveal(ev.detail && ev.detail.user); });

    // Offer the shelves already in use, so "Standards" does not drift into
    // "standards" and then "Standard" across three uploads.
    fetch('/api/education/library', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var seen = {};
        (d && d.books ? d.books : []).forEach(function (b) {
          if (b.collection) seen[b.collection] = true;
        });
        $('tn-collections').innerHTML = Object.keys(seen).sort().map(function (c) {
          return '<option value="' + TN.esc(c) + '">';
        }).join('');
      })
      .catch(function () { /* the datalist is a convenience, not a requirement */ });
  }

  function init() {
    renderSteps();
    initSaveBook();
    loadSettings();
    updateStepSummary();
    initDisclosures();
    updateInputMeta();
    updateResultMeta();

    $('btn-clean').addEventListener('click', function () { clean({ copy: opt('autocopy'), reselect: true }); });
    $('btn-copy').addEventListener('click', copyNow);
    $('btn-download').addEventListener('click', download);
    $('btn-clear').addEventListener('click', clearAll);
    $('btn-reset-steps').addEventListener('click', resetSettings);
    $('btn-file').addEventListener('click', function () { $('file').click(); });
    $('btn-preview').addEventListener('click', function () { previewShown = true; paintPreview(); });

    // Paste anywhere on the page, not just in the box.
    document.addEventListener('paste', onPaste);

    // Typing keeps the result in step, but only while the text is small enough
    // that re-running is imperceptible.
    $('input').addEventListener('input', function () {
      updateInputMeta();
      if (typeTimer) clearTimeout(typeTimer);
      if (!lastOutput || $('input').value.length > LIVE_LIMIT) return;
      typeTimer = setTimeout(function () { clean({ copy: false, silent: true }); }, 400);
    });

    document.addEventListener('keydown', function (ev) {
      var t = ev.target;
      // Escape belongs to the tool everywhere except inside a field you might
      // be midway through typing into — the file name and the wrap length.
      // A checkbox is not one of those, so Escape still clears from there.
      var typingElsewhere = !!t && t !== $('input') &&
        (t.tagName === 'SELECT' ||
         (t.tagName === 'INPUT' && ['text', 'number', 'search', 'url', 'email'].indexOf(t.type) > -1));
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key === 'Enter') {
        ev.preventDefault(); clean({ copy: opt('autocopy'), reselect: true });
      } else if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === 'C' || ev.key === 'c')) {
        ev.preventDefault(); copyNow();
      } else if (ev.key === 'Escape' && !typingElsewhere) {
        ev.preventDefault(); clearAll();
      }
    });

    STEPS.forEach(function (s) {
      $('step-' + s.id).addEventListener('change', function () {
        updateStepSummary();
        saveSettings();
        if (lastOutput) clean({ copy: false });
      });
    });
    $('maxlen').addEventListener('change', function () {
      saveSettings();
      if (lastOutput) clean({ copy: false });
    });
    ['autopaste', 'autocopy', 'reselect'].forEach(function (k) {
      $('opt-' + k).addEventListener('change', saveSettings);
    });

    $('file').addEventListener('change', function (ev) { loadFile(ev.target.files[0]); });

    // The input box is its own drop target.
    var box = $('input');
    ['dragenter', 'dragover'].forEach(function (e) {
      box.addEventListener(e, function (ev) { ev.preventDefault(); box.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      box.addEventListener(e, function (ev) { ev.preventDefault(); box.classList.remove('is-dragover'); });
    });
    box.addEventListener('drop', function (ev) {
      loadFile(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]);
    });

    box.focus();
  }

  document.addEventListener('tn:ready', init);

  // Exposed so the port can be checked against the Python reference.
  window.TNTextCleaner = { run: run, STEPS: STEPS };
})();
