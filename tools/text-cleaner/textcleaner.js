/* Text Cleaner — a faithful port of the Python pipeline in app.py.
 *
 * Each step is the same transform in the same order, so output matches the
 * desktop script character for character. Where JavaScript regex differs
 * from Python's `re`, the difference is noted at the step.
 *
 * Everything runs in the browser. Nothing is uploaded.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------ steps
     Order matters and is not arbitrary — several steps depend on an earlier
     one having already run. Collapsing whitespace before the quote handling,
     for instance, is what makes the quote patterns predictable. */

  function removeLineBreaks(text) {
    return text.replace(/\n/g, ' ').replace(/\r/g, ' ');
  }

  function removeDoubleSpaces(text) {
    // Python \s and JS \s differ on a few exotic characters. For prose out of
    // Word the practical difference is nil, and this keeps behaviour aligned.
    return text.replace(/\s+/g, ' ');
  }

  function trimText(text) { return text.trim(); }

  function curlyDoubleToSingle(text) {
    return text.replace(/\u201C/g, '\u2018').replace(/\u201D/g, '\u2019');
  }

  /* Breaks a line before an opening single curly quote, so each speech turn
     starts on its own line. The Python original relies on group(1) being the
     quote character; the same grouping is preserved here. */
  function formatWithNewline(text) {
    var pattern = /(?:\s|^)([\u2018\u2019])|\.\s*\u2019|(?<!,)\s*\u2018.*?\u2019|\n\s*/g;
    return text.replace(pattern, function (whole, g1) {
      if (g1 === '\u2018') return '\n' + g1;
      if (whole.charAt(0) === '\u2018' && whole.charAt(whole.length - 1) === '\u2019') {
        return whole.trim() + '\n';
      }
      return whole;
    }).trim();
  }

  function joinCommaBeforeQuote(text) {
    return text.replace(/,\s*\n\s*\u2018/g, ', \u2018');
  }

  function breakAfterPeriodQuote(text) {
    return text.replace(/\.\s*(\u2019)\s*/g, '.$1\n');
  }

  /* A line that opens with a quote, closes it, and then continues past a full
     stop is two sentences pretending to be one. Split at the space after that
     first full stop. */
  function processCurlyQuotes(text) {
    return text.split('\n').map(function (line) {
      if (line.charAt(0) === '\u2018' &&
          line.indexOf('\u2019') > -1 &&
          (line.match(/\./g) || []).length > 1) {
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
    }).join('\n').replace(/\s+$/, '');
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
    return out.join('\n').replace(/\n+$/, '');
  }

  function spaceSceneBreaks(text) {
    return text.replace(/\*{5,}/g, function (m) {
      return '\n\n\n\n\n\n\n\n' + m + '\n\n\n\n\n\n\n\n';
    });
  }

  function breakAtSemicolon(text) {
    return text.replace(/;\s/g, ';\n').trim();
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

  function stats(text) {
    var trimmed = text.trim();
    var words = trimmed ? trimmed.split(/\s+/).length : 0;
    var lines = trimmed ? trimmed.split('\n').length : 0;
    return { chars: text.length, words: words, lines: lines };
  }

  function setStatus(msg, kind) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' status--' + kind : '');
  }

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

  function clean() {
    var input = $('input').value;
    if (!input.trim()) { setStatus('Paste some text first.', 'error'); return; }

    var maxLen = Math.max(80, Math.min(5000, parseInt($('maxlen').value, 10) || 500));
    var result = run(input, enabledSteps(), maxLen);

    $('output').value = result.text;

    // Show which steps actually did something. A step that never fires on
    // your material is one you can switch off.
    result.report.forEach(function (r) {
      var flag = $('flag-' + r.id);
      flag.textContent = r.skipped ? 'off' : (r.changed ? 'applied' : 'no change');
      flag.className = 'step-flag' + (r.skipped ? ' is-off' : (r.changed ? ' is-on' : ''));
    });

    var a = stats(input), b = stats(result.text);
    $('stats').textContent =
      a.chars.toLocaleString() + ' chars, ' + a.lines.toLocaleString() + ' lines  ->  ' +
      b.chars.toLocaleString() + ' chars, ' + b.lines.toLocaleString() + ' lines  (' +
      b.words.toLocaleString() + ' words)';
    setStatus('Cleaned.', 'ok');
  }

  function download() {
    var text = $('output').value;
    if (!text) { setStatus('Nothing to download yet.', 'error'); return; }
    var name = ($('filename').value || 'cleaned').replace(/[^\w.-]+/g, '-').replace(/\.txt$/i, '');
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name + '_UPDATED.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

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
      setStatus('Loaded ' + file.name + '.', 'ok');
    };
    reader.onerror = function () { setStatus('Could not read that file.', 'error'); };
    reader.readAsText(file, 'utf-8');
  }

  function init() {
    renderSteps();

    $('btn-clean').addEventListener('click', clean);
    $('btn-download').addEventListener('click', download);
    $('btn-copy').addEventListener('click', function () {
      var text = $('output').value;
      if (!text) { setStatus('Nothing to copy yet.', 'error'); return; }
      navigator.clipboard.writeText(text)
        .then(function () { setStatus('Copied to the clipboard.', 'ok'); })
        .catch(function () { setStatus('Copy failed — select the text and copy manually.', 'error'); });
    });
    $('btn-clear').addEventListener('click', function () {
      $('input').value = ''; $('output').value = '';
      $('stats').textContent = '';
      STEPS.forEach(function (s) { $('flag-' + s.id).textContent = ''; });
      setStatus('');
    });

    $('file').addEventListener('change', function (ev) { loadFile(ev.target.files[0]); });

    var drop = $('dropzone');
    drop.addEventListener('click', function () { $('file').click(); });
    drop.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('file').click(); }
    });
    ['dragenter', 'dragover'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('is-dragover'); });
    });
    drop.addEventListener('drop', function (ev) {
      loadFile(ev.dataTransfer.files && ev.dataTransfer.files[0]);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed so the port can be checked against the Python reference.
  window.TNTextCleaner = { run: run, STEPS: STEPS };
})();
