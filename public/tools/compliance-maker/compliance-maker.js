/* =====================================================================
   Compliance Maker — static build

   Specification PDF (or pasted text) -> numbered compliance matrix -> .xlsx.
   Everything runs in the browser: the PDF is read with pdf.js locally and the
   workbook is written by xlsx-writer.js, so no file ever leaves the machine.

   This is the conversion engine only. The parser, the highlighter and the
   preview renderer are carried over unchanged from the full tool so the rows
   and the exported formatting are identical; the library matching, answer log,
   conflict checks and AI review are absent because they need a database and a
   server, and this build has neither.

   One deliberate difference from the full tool: the highlight rules load from
   data/highlight-rules.json instead of an .xlsx. The full tool reads the
   workbook with SheetJS, and shipping a 900 KB spreadsheet parser to read one
   list of words is not a trade worth making on a static host.
   ===================================================================== */
(function () {
  'use strict';

  /* ---- PDF.js worker ---- */
  if (window['pdfjsLib']) {
    window['pdfjsLib'].GlobalWorkerOptions.workerSrc =
      '../../assets/vendor/pdfjs/pdf.worker.min.js';
  }

  /* ---- Element refs ---- */
  var dropzone   = document.getElementById('dropzone');
  var fileInput  = document.getElementById('file-input');
  var fileSlot   = document.getElementById('file-slot');
  var statusEl   = document.getElementById('status');
  var resultPanel= document.getElementById('result-panel');
  var previewBody= document.getElementById('preview-body');
  var countNote  = document.getElementById('count-note');
  var btnDownload= document.getElementById('btn-download');
  var btnClear   = document.getElementById('btn-clear');
  var dictEl     = document.getElementById('dict');
  var hlNumbers  = document.getElementById('hl-numbers');
  var hlCaps     = document.getElementById('hl-caps');
  var dbRulesOn  = document.getElementById('hl-db-rules');
  var tabPdf     = document.getElementById('tab-pdf');
  var tabText    = document.getElementById('tab-text');
  var panePdf    = document.getElementById('pane-pdf');
  var paneText   = document.getElementById('pane-text');
  var pasteInput = document.getElementById('paste-input');
  var keepBreaks = document.getElementById('keep-breaks');
  var tidyFirst  = document.getElementById('tidy-first');
  var skipFront  = document.getElementById('skip-front');
  var btnConvert = document.getElementById('btn-convert');
  var convertHint= document.getElementById('convert-hint');
  var pageLimitNote = document.getElementById('page-limit-note');

  var currentRows = null;
  var currentName = 'compliance-matrix';
  var pendingFile = null;          // chosen PDF, not yet processed
  var currentPartial = '';         // set when only part of the input was converted
  var trimNote = document.getElementById('trim-note');
  var resultHead = document.getElementById('step-result');
  var activeSource = 'pdf';        // 'pdf' | 'text'

  /* The parser and the PDF reader live in cm-engine.js (also used by the project page "Add a
     specification"). They are only given their old names here. */
  var E = window.CMEngine, MAX_PAGES = E.MAX_PAGES, CHARS_PER_PAGE = E.CHARS_PER_PAGE;
  var parseLines = E.parseLines;

  var RULES_URL = '../../data/highlight-rules.json';
  var rulesCache = null;   // { red:[], redbold:[], underline:[] } lowercased phrase lists

  function loadRules() {
    if (rulesCache) return Promise.resolve(rulesCache);
    return fetch(RULES_URL).then(function (r) {
      if (!r.ok) throw new Error('rules not found');
      return r.json();
    }).then(function (data) {
      rulesCache = {
        red: data.red || [],
        redbold: data.redbold || [],
        underline: data.underline || []
      };
      return rulesCache;
    }).catch(function () {
      // A missing rules file must not stop a conversion — the user's own
      // dictionary and the number/caps toggles still work.
      rulesCache = { red: [], redbold: [], underline: [] };
      return rulesCache;
    });
  }

  function getDictionary() {
    return dictEl.value
      .split(/[\n,]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Build the active highlighter from: rules file (if loaded) + user words +
  // the number/ALL-CAPS checkboxes. Every matchable item is tagged with the
  // style it should get. Longer phrases win over shorter, style precedence
  // redbold > underline > red for single tokens.
  function buildHighlighter() {
    var rules = rulesCache || { red: [], redbold: [], underline: [] };
    var useDb = dbRulesOn && dbRulesOn.checked;

    // Word -> style map (single tokens), and phrase list with styles.
    var wordStyle = {};
    var phrases = [];   // { re-safe text, style }

    function add(list, style) {
      list.forEach(function (item) {
        if (/\s/.test(item)) phrases.push({ text: item, style: style });
        else wordStyle[item.toLowerCase()] = wordStyle[item.toLowerCase()] || style;
      });
    }
    if (useDb) {
      // precedence: redbold first so it wins the word map
      add(rules.redbold, 'redbold');
      add(rules.underline, 'underline');
      add(rules.red, 'red');
    }
    // User-typed words are always red (simple), and always applied.
    add(getDictionary(), 'red');

    var doNumbers = hlNumbers.checked;
    var doCaps = hlCaps.checked;

    var hasAny = phrases.length || Object.keys(wordStyle).length || doNumbers || doCaps;
    if (!hasAny) return null;

    // Longest phrases first so multi-word locks beat their sub-words.
    phrases.sort(function (a, b) { return b.text.length - a.text.length; });
    return { wordStyle: wordStyle, phrases: phrases, doNumbers: doNumbers, doCaps: doCaps, hasRules: true };
  }

  function tokenStyle(tok, hl) {
    if (!hl) return '';
    var low = tok.toLowerCase();
    if (hl.wordStyle[low]) return hl.wordStyle[low];
    if (hl.doNumbers && /^\d+(?:\.\d+)?$/.test(tok)) return 'red';
    if (hl.doCaps && /^[A-Z][A-Z0-9&/-]*[A-Z0-9]$|^[A-Z]{2,}$/.test(tok)) return 'red';
    return '';
  }

  // Returns runs of { text, style } where style is
  // '' | 'red' | 'redbold' | 'underline' | 'colon' (brown bold prefix).
  function splitRuns(text, hl) {
    if (!text) return [{ text: text, style: '' }];

    // Colon-prefix rule (from the Excel tool): if the line contains ":" and
    // the part up to and including it is < 40 chars, that prefix is brown+bold.
    // This runs even when no other highlighter is active.
    var colonEnd = 0;
    var ci = text.indexOf(':');
    if (ci > 0 && ci < 40) colonEnd = ci + 1;

    if (!hl || !hl.hasRules) {
      if (!colonEnd) return [{ text: text, style: '' }];
      return [{ text: text.slice(0, colonEnd), style: 'colon' },
              { text: text.slice(colonEnd), style: '' }];
    }

    // Lock phrase spans with their style (longest-first already sorted).
    var locked = [];  // { a, b, style }
    hl.phrases.forEach(function (p) {
      var re = new RegExp('\\b' + escapeRegex(p.text) + '\\b', 'gi');
      var m;
      while ((m = re.exec(text)) !== null) {
        var a = m.index, b = m.index + m[0].length;
        var overlap = locked.some(function (L) { return a < L.b && b > L.a; });
        if (!overlap) locked.push({ a: a, b: b, style: p.style });
      }
    });
    function lockedAt(i) {
      // Colon prefix wins over other rules for its span.
      if (colonEnd && i < colonEnd) return 'colon';
      for (var k = 0; k < locked.length; k++) if (i >= locked[k].a && i < locked[k].b) return locked[k].style;
      return null;
    }

    var runs = [];
    var re = /[A-Za-z0-9][A-Za-z0-9&/.-]*|[^A-Za-z0-9]+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var tok = m[0];
      var lockStyle = lockedAt(m.index);
      var isWord = /[A-Za-z0-9]/.test(tok[0]);
      var style;
      if (lockStyle) style = lockStyle;
      else if (isWord) style = tokenStyle(tok.replace(/\.+$/, ''), hl);
      else style = '';
      if (runs.length && runs[runs.length - 1].style === style) runs[runs.length - 1].text += tok;
      else runs.push({ text: tok, style: style });
    }
    return runs.length ? runs : [{ text: text, style: '' }];
  }

  /* ======================================================================
     PREVIEW
     ====================================================================== */

  function rowsText(n) { return n + (n === 1 ? ' row' : ' rows'); }

  function renderPreview(rows) {
    var re = buildHighlighter();
    previewBody.innerHTML = '';
    var blanks = 0, filledRows = 0;

    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.type === 'part')    tr.className = 'row-part';
      if (r.type === 'section') tr.className = 'row-section';

      var srTd = document.createElement('td');
      srTd.className = 'sr';
      if (r.type === 'letter') srTd.classList.add('lvl-letter');
      if (r.type === 'number') srTd.classList.add('lvl-number');
      srTd.textContent = r.sr || '';
      tr.appendChild(srTd);

      var specTd = document.createElement('td');
      if (r.type === 'part' || r.type === 'section') {
        specTd.textContent = r.spec;
      } else {
        splitRuns(r.spec, re).forEach(function (run) {
          if (run.style) {
            var span = document.createElement('span');
            span.className = 'hl hl-' + run.style;
            span.textContent = run.text;
            specTd.appendChild(span);
          } else {
            specTd.appendChild(document.createTextNode(run.text));
          }
        });
      }
      tr.appendChild(specTd);

      // Compliance and Remarks are always the engineer's to fill in.
      var isBody = (r.type === 'letter' || r.type === 'number' || r.type === 'text');
      if (isBody && !(r.compliance || r.remarks)) blanks++;
      if (isBody && (r.compliance || r.remarks)) filledRows++;
      // Filled from the master library when this line was answered before.
      [r.compliance, r.remarks].forEach(function (val) {
        var td = document.createElement('td');
        td.className = val ? 'col-filled' : 'col-empty';
        if (val) td.textContent = val;
        tr.appendChild(td);
      });

      var cTd = document.createElement('td');
      cTd.className = 'comments';
      // same text as the Comments column of the Excel ("From library (exact match).")
      if (isBody && window.xlsxWriter && window.xlsxWriter.commentFor) cTd.textContent = window.xlsxWriter.commentFor(r);
      if (r.type === 'part') cTd.style.background = '#000';
      tr.appendChild(cTd);

      previewBody.appendChild(tr);
    });

    countNote.textContent = rowsText(rows.length) +
      (filledRows ? ' · ' + filledRows + ' filled from the library' : '') +
      (blanks ? ' · ' + blanks + ' to fill in' : '') + '.';
    resultPanel.hidden = false;
    btnDownload.disabled = rows.length === 0;
  }

  var extractLinesFromTextContent = E.extractLinesFromTextContent, dropPageFurniture = E.dropPageFurniture,
      skipFrontMatter = E.skipFrontMatter, frontNote = E.frontNote;


  function finishBuild(rows, baseMsg, partial) {
    currentRows = rows;
    currentPartial = partial || '';
    renderPreview(rows);
    setStatus(baseMsg + '.', 'ok');
    if (trimNote) {
      trimNote.textContent = currentPartial ? currentPartial + ' The rest is not in the preview or the Excel. Split the specification and convert the rest separately.' : '';
      trimNote.hidden = !currentPartial;
    }
    // Convert was disabled while working, which drops the keyboard focus: put it on the result.
    if (resultHead) resultHead.focus();
    saveToLibrary(rows);
    // second table: the datasheet rows with the clause found for each (cm-rows.js)
    var sel = window.CMLibrary && window.CMLibrary.selection();
    if (window.CMRows) window.CMRows.update(rows, sel ? { id: sel.productId, name: sel.productName } : null);
  }

  /* DAME Tools Hub: every conversion is saved to the master compliance
     library (cm-library.js), and lines the library already has an answer for
     come back filled in. The preview is shown first so a slow or failed save
     never blocks the user from their matrix. */
  var libNote = document.getElementById('lib-note');
  function setLibNote(msg, kind) {
    if (!libNote) return;
    libNote.textContent = msg || '';
    libNote.className = 'status' + (kind ? ' status--' + kind : '');
  }
  function saveToLibrary(rows) {
    var lib = window.CMLibrary;
    if (!lib) return;
    setLibNote('Saving to the compliance library…');
    lib.saveRun(rows, activeSource, activeSource === 'pdf' && pendingFile ? pendingFile.name : '')
      .then(function (res) {
        if (currentRows !== rows) return;          // cleared or converted again meanwhile
        (res.answers || []).forEach(function (a) {
          var r = rows[a.i];
          if (!r) return;
          r.internal = a.comments || '';              // the library team's Internal Comments for the clause
          if (a.answered === false) return;           // comments only, no answer yet
          r.compliance = a.compliance || '';
          r.remarks = a.remarks || '';
          r.auto = { type: 'exact' };
        });
        renderPreview(rows);
        if (res.unique_lines === 0) { setLibNote('No clause lines were found to add to the compliance library.'); return; }
        setLibNote('Saved to the compliance library. ' +
          (res.matched ? res.matched + ' of ' + rows.length + ' rows filled from earlier answers.'
                       : 'No earlier answers matched these lines yet.'), 'ok');
      }, function (err) {
        if (currentRows !== rows) return;
        setLibNote('Not saved to the compliance library: ' + (err && err.message ? err.message : err) +
          ' You can still download. Press Convert to try saving again.', 'error');
      });
  }

  // A file that cannot be used must not leave the earlier one armed behind the message.
  function dropFile() {
    pendingFile = null;
    fileInput.value = '';
    fileSlot.innerHTML = '';
    refreshConvertState();
  }

  /* The result on screen belongs to one conversion. When the next one fails, or the product
     or factory changes, it goes: preview, Datasheet rows and the saved note. The chosen PDF
     and the pasted text stay. */
  function dropResult() {
    currentRows = null;
    currentPartial = '';
    if (window.CMRows) window.CMRows.clear();
    previewBody.innerHTML = '';
    resultPanel.hidden = true;
    btnDownload.disabled = true;
    if (trimNote) { trimNote.hidden = true; trimNote.textContent = ''; }
    setLibNote('');
  }
  function failed(msg) {
    dropResult();
    setStatus(msg, 'error');
    setConverting(false);
    if (!btnConvert.disabled) btnConvert.focus();
  }

  // Selecting a file only STORES it. Nothing is parsed until Convert.
  function selectFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      dropFile();
      setStatus('That is not a PDF. Please choose a .pdf file.', 'error');
      return;
    }
    if (file.size === 0) {
      dropFile();
      setStatus('That file is empty (0 bytes). Choose another PDF.', 'error');
      return;
    }
    pendingFile = file;
    currentName = file.name.replace(/\.pdf$/i, '') || 'compliance-matrix';
    showFileTag(file.name);
    setStatus('');
    refreshConvertState();
  }

  // Convert-triggered: read the stored PDF, parse, then finishBuild.
  function processPdf() {
    var file = pendingFile;
    if (!window['pdfjsLib']) {
      setStatus('PDF engine failed to load. Check your connection and refresh.', 'error');
      return;
    }
    setStatus('Reading PDF…');
    btnDownload.disabled = true;
    setConverting(true);

    var reader = new FileReader();
    reader.onload = function () {
      var task = window['pdfjsLib'].getDocument({ data: new Uint8Array(reader.result) });
      task.promise.then(function (pdf) {
        var maxPages = Math.min(pdf.numPages, MAX_PAGES);
        var allLines = [], pageLines = [];

        function readPage(p) {
          if (p > maxPages) return Promise.resolve();
          setStatus('Reading page ' + p + ' of ' + maxPages + '…');
          return pdf.getPage(p)
            .then(function (page) { return page.getTextContent(); })
            .then(function (tc) {
              pageLines.push(extractLinesFromTextContent(tc));
              return new Promise(function (r) { setTimeout(r, 0); });
            })
            .then(function () { return readPage(p + 1); });
        }

        return readPage(1).then(function () {
          var dropped = dropPageFurniture(pageLines);
          pageLines.forEach(function (pl) { allLines = allLines.concat(pl); });
          var joined = allLines.join('').trim();
          if (!joined) {
            failed('No selectable text found. This looks like a scanned PDF — OCR is not supported.');
            return;
          }
          setStatus('Building matrix…');
          var front = skipFront && skipFront.checked ? skipFrontMatter(allLines) : { lines: allLines, skipped: 0 };
          var rows = parseLines(front.lines);
          var note = pdf.numPages > MAX_PAGES
            ? ' (first ' + MAX_PAGES + ' of ' + pdf.numPages + ' pages)'
            : '';
          var partial = note ? 'PARTIAL: only the first ' + MAX_PAGES + ' of ' + pdf.numPages + ' pages were converted.' : '';
          finishBuild(rows, 'Done — ' + rowsText(rows.length) + note +
            (dropped ? ' · ' + dropped + ' page header and footer lines removed' : '') + frontNote(front), partial);
          setConverting(false);
        });
      }).catch(function (err) {
        failed(err && err.name === 'PasswordException'
          ? 'That PDF is password-protected. Remove the password and try again.'
          : 'Could not read that PDF. It may be corrupted or not a real PDF file.');
      });
    };
    reader.onerror = function () { failed('Could not read the file.'); };
    reader.readAsArrayBuffer(file);
  }

  // THE single entry point. Nothing above runs until this is clicked.
  //
  // The rules file is warmed at startup, but a fast paste-and-click can still
  // beat the fetch. Converting then silently produces a matrix with no bold
  // and no underline — a wrong result that looks like a right one. So the
  // rules are awaited here; loadRules() resolves instantly once cached, and
  // resolves to empty lists if the file is missing, so this never hangs.
  function runConvert() {
    loadRules().then(doConvert);
  }

  function doConvert() {
    if (activeSource === 'pdf') {
      if (!pendingFile) { setStatus('Choose a PDF first.', 'error'); return; }
      processPdf();
    } else {
      var raw = pasteInput.value;
      if (!raw || !raw.trim()) { setStatus('Paste some specification text first.', 'error'); return; }
      // Pasted text has no pages to count, so the same ceiling is applied by
      // character budget instead — CHARS_PER_PAGE is a deliberate,
      // conservative stand-in for a spec page of body text.
      var cap = MAX_PAGES * CHARS_PER_PAGE;
      var trimmed = '', partial = '';
      if (raw.length > cap) {
        // cut at the end of a line, never inside a clause
        var totalLines = raw.split(/\r\n|\r|\n/).length;
        var cut = Math.max(raw.lastIndexOf('\n', cap), raw.lastIndexOf('\r', cap));
        raw = raw.slice(0, cut > 0 ? cut : cap);
        var keptLines = raw.split(/\r\n|\r|\n/).length;
        trimmed = ' (trimmed to the first ~' + MAX_PAGES + ' pages of text)';
        partial = 'PARTIAL: only the first ' + keptLines + ' of ' + totalLines + ' pasted lines were converted (about ' + MAX_PAGES + ' pages of text).';
      }
      currentName = 'compliance-matrix';
      setConverting(true);

      // Tidy runs on the pasted text only, and never joins lines — the parser
      // reads structure off them. What it removed is reported rather than done
      // quietly, because a step that silently drops lines is one you cannot
      // trust on a document you have not read.
      var tidyNote = '';
      if (tidyFirst && tidyFirst.checked && window.TN && window.TN.reflow) {
        var t = window.TN.reflow.tidyForParsing(raw);
        raw = t.text;
        var did = [];
        if (t.removed) did.push(t.removed + (t.removed === 1 ? ' page line' : ' page lines') + ' removed');
        if (t.joins) did.push(t.joins + (t.joins === 1 ? ' split word' : ' split words') + ' rejoined');
        if (t.punctuation) did.push('punctuation straightened');
        if (did.length) tidyNote = ' · tidy: ' + did.join(', ');
      }

      var rawLines = raw.split(/\r\n|\r|\n/);
      var front = skipFront && skipFront.checked ? skipFrontMatter(rawLines) : { lines: rawLines, skipped: 0 };
      var rows = parseLines(front.lines,
                            { keepBreaks: keepBreaks && keepBreaks.checked });
      finishBuild(rows, 'Done — ' + rowsText(rows.length) + trimmed + tidyNote + frontNote(front), partial);
      setConverting(false);
    }
  }

  /* ======================================================================
     UI GLUE
     ====================================================================== */

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (kind ? ' status--' + kind : '');
  }

  function showFileTag(name) {
    fileSlot.innerHTML = '';
    var tag = document.createElement('span');
    tag.className = 'file-tag';
    tag.appendChild(document.createTextNode(name));
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove file');
    x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    x.addEventListener('click', clearAll);
    tag.appendChild(x);
    fileSlot.appendChild(tag);
  }

  function clearAll() {
    dropResult();
    pendingFile = null;
    fileInput.value = '';
    fileSlot.innerHTML = '';
    pasteInput.value = '';
    remember();
    setStatus('');
    refreshConvertState();
  }

  // Convert is enabled when there is something to convert.
  function refreshConvertState() {
    var hasInput = activeSource === 'pdf' ? !!pendingFile : !!pasteInput.value.trim();
    btnConvert.disabled = !hasInput;
    convertHint.textContent = hasInput ? ''
      : (activeSource === 'pdf' ? 'Choose a PDF, then Convert.' : 'Paste text, then Convert.');
  }

  function setConverting(on) {
    btnConvert.disabled = on || btnConvert.disabled;
    btnConvert.textContent = '';
    var svg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l14 9-14 9V3z"/></svg>';
    btnConvert.innerHTML = svg + (on ? ' Converting…' : ' Convert');
    if (!on) refreshConvertState();
  }

  function selectSource(which) {
    activeSource = which === 'pdf' ? 'pdf' : 'text';
    var pdf = activeSource === 'pdf';
    // The site's .segmented component styles the active button off
    // aria-pressed; the tablist semantics this control was written with use
    // aria-selected. Both are set so the shared CSS and the assistive-tech
    // contract stay in agreement.
    tabPdf.setAttribute('aria-selected', pdf ? 'true' : 'false');
    tabText.setAttribute('aria-selected', pdf ? 'false' : 'true');
    tabPdf.setAttribute('aria-pressed', pdf ? 'true' : 'false');
    tabText.setAttribute('aria-pressed', pdf ? 'false' : 'true');
    // one tab stop for the pair; the arrow keys move between them
    tabPdf.tabIndex = pdf ? 0 : -1;
    tabText.tabIndex = pdf ? -1 : 0;
    panePdf.hidden = !pdf;
    paneText.hidden = pdf;
    // Switching source clears the staged PDF and the result. Pasted text stays in its box.
    pendingFile = null;
    fileInput.value = '';
    fileSlot.innerHTML = '';
    dropResult();
    setStatus('');
    remember();
    refreshConvertState();
  }

  tabPdf.addEventListener('click', function () { selectSource('pdf'); });
  tabText.addEventListener('click', function () { selectSource('text'); });
  [tabPdf, tabText].forEach(function (tab) {
    tab.addEventListener('keydown', function (e) {
      var to = e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? (tab === tabPdf ? tabText : tabPdf)
             : e.key === 'Home' ? tabPdf : e.key === 'End' ? tabText : null;
      if (!to) return;
      e.preventDefault();
      if (to !== tab) selectSource(to === tabPdf ? 'pdf' : 'text');
      to.focus();
    });
  });

  /* Pasted text and the chosen tab are kept for this browser tab (sessionStorage), so a
     reload does not lose them. A PDF cannot be kept: it has to be chosen again. */
  var KEEP = 'cm.keep';
  function who() { return window.Hub && window.Hub.token ? String(window.Hub.token() || '') : ''; }
  function remember() {
    try { sessionStorage.setItem(KEEP, JSON.stringify({ who: who(), source: activeSource, text: pasteInput.value })); } catch (e) { /* too large or blocked: not kept */ }
  }
  function restore() {
    var k = null;
    try { k = JSON.parse(sessionStorage.getItem(KEEP)); } catch (e) { k = null; }
    if (!k || k.who !== who()) return;          // kept by another sign-in: not shown
    if (k.text) pasteInput.value = k.text;
    if (k.source === 'text') selectSource('text');
  }

  // The preview follows the Formatting ticks at once. Nothing is converted or saved again.
  function reRender() { if (currentRows) renderPreview(currentRows); }
  [dbRulesOn, hlNumbers, hlCaps].forEach(function (box) { if (box) box.addEventListener('change', reRender); });
  var dictTimer;
  dictEl.addEventListener('input', function () { clearTimeout(dictTimer); dictTimer = setTimeout(reRender, 250); });

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault(); dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('is-dragover'); });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault(); dropzone.classList.remove('is-dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) selectFile(fileInput.files[0]);
  });
  pasteInput.addEventListener('input', function () { refreshConvertState(); remember(); });

  btnConvert.addEventListener('click', runConvert);
  btnClear.addEventListener('click', clearAll);

  btnDownload.addEventListener('click', function () {
    if (!currentRows) return;
    var re = buildHighlighter();
    var sel = window.CMLibrary && window.CMLibrary.selection();
    var band = sel ? 'Product : ' + sel.productName + '     Factory : ' + sel.factoryName : '';
    var blob = window.xlsxWriter.build(currentRows, re, splitRuns,
      { bandText: band, partial: currentPartial, projectName: window.PRPick && window.PRPick.current() ? window.PRPick.current().name : '', sheet2: window.CMRows ? window.CMRows.sheet() : null });
    downloadBlob(blob, currentName + '.xlsx');
  });

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---- Initial state ---- */
  pageLimitNote.textContent = 'Specifications up to ' + MAX_PAGES + ' pages.';
  restore();
  refreshConvertState();
  loadRules();   // warm the highlight rules in the background
  window.CMMaker = { dropResult: dropResult };
})();
