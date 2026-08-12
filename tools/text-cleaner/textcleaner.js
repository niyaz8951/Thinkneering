/* Text Cleaner — a faithful port of the Python pipeline in app.py.
 *
 * Each step is the same transform in the same order, so output matches the
 * desktop script character for character. Where JavaScript regex differs
 * from Python's `re`, the difference is noted at the step.
 *
 * Built for repetition: paste anywhere, and the cleaned text is on your
 * clipboard before you have taken your hand off the keyboard. Everything
 * runs in the browser. Nothing is uploaded.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORE_KEY = 'tn.text-cleaner.settings';

  /* Filling a textarea with a megabyte of text costs far more than cleaning
     it does. Past this length the result is still copied and downloadable —
     only the on-screen preview waits until asked for. */
  var PREVIEW_LIMIT = 200000;

  /* Above this, cleaning on every keystroke would stutter, so typing stops
     re-running and the button takes over. */
  var LIVE_LIMIT = 120000;

  /* ------------------------------------------------------------------ steps
     Order matters and is not arbitrary — several steps depend on an earlier
     one having already run. Collapsing whitespace before the quote handling,
     for instance, is what makes the quote patterns predictable.

     Patterns are compiled once at load rather than rebuilt on every call;
     String.replace resets lastIndex on a /g pattern, so reuse is safe.
     The transforms themselves are unchanged and verified against the Python
     reference. */

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

  function removeLineBreaks(text) {
    return text.replace(RE_NL, ' ').replace(RE_CR, ' ');
  }

  function removeDoubleSpaces(text) {
    // Python \s and JS \s differ on a few exotic characters. For prose out of
    // Word the practical difference is nil, and this keeps behaviour aligned.
    return text.replace(RE_WS, ' ');
  }

  function trimText(text) { return text.trim(); }

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

  /* Wrap over-long paragraphs at a sentence boundary. This mirrors the
     Python loop exactly, including the case where no suitable full stop is
     found and the line is left long rather than cut mid-sentence. */
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

  /* Steps are declared as data so the UI can list them, let you switch any
     one off, and show which ones actually changed anything on this run. */
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
     a word-sized array every time and is the slowest thing on the page. */
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
    var cls = 'status' + (kind ? ' status--' + kind : '');
    if (el.className !== cls) el.className = cls;
  }

  /* --- clipboard ---------------------------------------------------------
     Called inside the paste/click handler so the browser still counts it as
     a user action. The execCommand path is the fallback for browsers that
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
    var buttons = document.querySelectorAll('[data-disclosure]');
    Array.prototype.forEach.call(buttons, function (btn) {
      var body = $(btn.getAttribute('aria-controls'));
      if (!body) return;
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        body.hidden = open;
      });
    });
  }

  /* --- settings ----------------------------------------------------------- */

  function renderSteps() {
    $('steps').innerHTML = STEPS.map(function (s) {
      return '<label class="toggle-row">' +
        '<input type="checkbox" id="step-' + s.id + '" checked>' +
        '<span>' + s.label + '</span>' +
        '<span class="step-flag" id="flag-' + s.id + '"></span></label>';
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

  /* Settings stay on this machine so a repeat user sets them once, not once
     an hour. Nothing leaves the browser. */
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
    if (lastOutput) clean({ copy: false, reason: 'settings' });
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
      flag.className = 'step-flag' + (r.skipped ? ' is-off' : (r.changed ? ' is-on' : ''));
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
        (unchanged ? 'Already clean — copied.' : 'Cleaned and copied' + (ms != null ? ' in ' + Math.round(ms) + ' ms' : '') + '.') +
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
    if (t && t !== $('input') && (t.tagName === 'INPUT' || t.isContentEditable)) return; // file name, wrap length
    if (!opt('autopaste')) return;

    var data = ev.clipboardData || window.clipboardData;
    if (!data) return;
    var pasted = data.getData('text');
    if (!pasted) return;

    ev.preventDefault();
    var box = $('input');

    if (t === box) {
      // Respect the cursor: insertText keeps the browser's own undo stack.
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

  /* --- file loading --------------------------------------------------------- */

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

  /* --- save to Books --------------------------------------------------------
     The Education library is an R2 bucket behind /api/education/upload, which
     is the same endpoint the Education page posts to. Nothing new is added
     here: the cleaned text is turned into the .txt the reader already knows
     how to open, and sent with the title you type.

     Only an admin can add a book, so the button stays hidden for everyone
     else rather than offering an action the server will refuse. */

  var ebookPromise = null;    // parser, fetched on first save, not on page load
  var shelfSlugs = null;      // existing slugs, for the overwrite warning

  function loadEbook() {
    if (window.TNEbook) return Promise.resolve(window.TNEbook);
    if (ebookPromise) return ebookPromise;
    ebookPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/js/ebook.js?v=2';
      s.onload = function () {
        window.TNEbook ? resolve(window.TNEbook) : reject(new Error('The book reader did not load.'));
      };
      s.onerror = function () {
        ebookPromise = null;
        reject(new Error('Could not load the book reader. Check your connection.'));
      };
      document.head.appendChild(s);
    });
    return ebookPromise;
  }

  function bookStatus(msg, kind, html) {
    var el = $('book-status');
    el.className = 'status' + (kind ? ' status--' + kind : '');
    if (html) el.innerHTML = html;
    else el.textContent = msg || '';
  }

  /* A book needs a name before anything else. The file name field is the
     closest thing already on the page; failing that, the first line of the
     result is what a person would have typed anyway. */
  function guessTitle() {
    var name = ($('filename').value || '').trim();
    if (name && name.toLowerCase() !== 'cleaned') {
      return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    var lines = lastOutput.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^#+\s*/, '').trim();
      if (line) return line.slice(0, 80);
    }
    return '';
  }

  function toggleSaveBook(open) {
    var box = $('save-book');
    var btn = $('btn-save-book');
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(!!open));
    if (!open) return;

    if (!$('book-title').value.trim()) $('book-title').value = guessTitle();
    bookStatus('');
    $('book-title').focus();
    $('book-title').select();

    // Loaded once, only to warn before replacing a book of the same name.
    // If it fails the save still works — the server reports a replacement.
    if (shelfSlugs === null) {
      shelfSlugs = [];
      fetch('/api/education/library', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          shelfSlugs = (d && d.books ? d.books : []).map(function (b) { return b.slug; });
        })
        .catch(function () { /* warning is a courtesy, not a gate */ });
    }
  }

  function openSaveBook() {
    if (!lastOutput) { setStatus('Clean something first.', 'error'); return; }
    toggleSaveBook($('save-book').hidden);
  }

  function saveBook() {
    if (!lastOutput) { bookStatus('Nothing to save yet.', 'error'); return; }

    var title = $('book-title').value.trim();
    if (!title) { bookStatus('Give it a name first.', 'error'); $('book-title').focus(); return; }

    var btn = $('btn-book-save');
    btn.disabled = true;
    btn.textContent = 'Saving\u2026';
    bookStatus('Preparing the file\u2026');

    loadEbook().then(function (TNEbook) {
      var slug = TNEbook.slugify(title);
      if (!slug) throw new Error('That name makes no usable web address. Use some letters or numbers.');

      // The reader reads a .txt by convention: a "# " line starts a chapter.
      // Without one the chapter would be titled with the opening sentence, so
      // the name you typed goes in as the heading unless the text has its own.
      var body = /^\s*#\s+\S/.test(lastOutput) ? lastOutput : '# ' + title + '\n\n' + lastOutput;
      var bytes = new TextEncoder().encode(body);

      // Parsed with the reader's own parser before sending, so a file that
      // would not open is caught here rather than after it is stored.
      return TNEbook.read(bytes.buffer, slug + '.txt').then(function (book) {
        if (!book.chapters.length) throw new Error('That text had nothing the reader could open.');

        if (shelfSlugs && shelfSlugs.indexOf(slug) > -1 &&
            !confirm('A book called "' + title + '" is already on the shelf. Replace it?')) {
          var stop = new Error('Cancelled.');
          stop.quiet = true;
          throw stop;
        }

        bookStatus('Saving \u201C' + title + '\u201D\u2026');
        return fetch('/api/education/upload', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/octet-stream',
            // Headers are Latin-1; a title with an em dash is not. Both
            // sides encode, the same way the Education page does it.
            'X-Book-Filename': slug + '.txt',
            'X-Book-Slug': slug,
            'X-Book-Title': encodeURIComponent(title),
            'X-Book-Chapters': String(book.chapters.length)
          },
          body: bytes.buffer
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (out) {
          if (!res.ok) throw new Error(out.error || 'That could not be saved (' + res.status + ').');
          return { out: out, slug: slug, title: title };
        });
      });
    }).then(function (done) {
      if (shelfSlugs && shelfSlugs.indexOf(done.slug) === -1) shelfSlugs.push(done.slug);
      bookStatus('', 'ok',
        (done.out.replaced ? 'Replaced' : 'Saved') + ' \u201C' + TN.esc(done.title) + '\u201D. ' +
        '<a href="/read/' + encodeURIComponent(done.slug) + '">Open it in the reader</a>');
      if (window.TN && TN.toast) TN.toast(done.out.replaced ? 'Book replaced' : 'Book saved', 'success');
    }).catch(function (err) {
      if (err && err.quiet) bookStatus('Left as it was.');
      else bookStatus(err && err.message ? err.message : 'That could not be saved.', 'error');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Save to Books';
    });
  }

  /* The button exists only for an account that can actually add a book.
     Same rule the API enforces, so the page never offers a refused action. */
  function initSaveBook() {
    function reveal(user) {
      if (!user || user.role !== 'admin') return;
      $('btn-save-book').hidden = false;
    }
    if (window.TN && TN.session && TN.session.loaded) reveal(TN.session.user);
    else document.addEventListener('tn:ready', function (ev) { reveal(ev.detail && ev.detail.user); });

    $('btn-save-book').addEventListener('click', openSaveBook);
    $('btn-book-save').addEventListener('click', saveBook);
    $('btn-book-cancel').addEventListener('click', function () {
      toggleSaveBook(false);
      $('btn-save-book').focus();
    });
    $('book-title').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveBook(); }
    });
  }

  function clearAll() {
    $('input').value = '';
    $('output').value = '';
    $('stats').textContent = '';
    lastOutput = ''; lastInput = null; lastSig = ''; lastFlags = {};
    $('preview-note').hidden = true;
    $('book-title').value = '';
    bookStatus('');
    toggleSaveBook(false);
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

  function init() {
    renderSteps();
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
    initSaveBook();
    $('btn-preview').addEventListener('click', function () { previewShown = true; paintPreview(); });

    // Paste anywhere on the page, not just in the box.
    document.addEventListener('paste', onPaste);

    // Typing keeps the result in step, but only while the text is small
    // enough that re-running is imperceptible.
    $('input').addEventListener('input', function () {
      updateInputMeta();
      if (typeTimer) clearTimeout(typeTimer);
      if (!lastOutput || $('input').value.length > LIVE_LIMIT) return;
      typeTimer = setTimeout(function () { clean({ copy: false, silent: true }); }, 400);
    });

    document.addEventListener('keydown', function (ev) {
      var t = ev.target;
      var typingElsewhere = t && t !== $('input') && (t.tagName === 'INPUT' || t.tagName === 'SELECT');
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

    $('input').focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed so the port can be checked against the Python reference.
  window.TNTextCleaner = { run: run, STEPS: STEPS };
})();
