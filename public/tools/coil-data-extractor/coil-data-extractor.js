/* Coil Data Extractor — UI.
 *
 * The reading and interpreting lives in coil-parse.js; this file collects the
 * files, feeds each one to the right reader, draws the result and hands back
 * the workbook. Nothing is read until Extract is pressed — the same rule the
 * Parts List Extractor follows.
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var PDFJS_WORKER = '../../assets/vendor/pdfjs/pdf.worker.min.js';
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  var PREVIEW_ROWS = 200;

  var dropzone = $('#dropzone');
  var fileInput = $('#file-input');
  var fileList = $('#file-list');
  var fileNote = $('#file-note');
  var runBtn = $('#run-btn');
  var runNote = $('#run-note');
  var optImperial = $('#opt-imperial');
  var resultPanel = $('#result-panel');
  var downloadBtn = $('#download-btn');
  var clearBtn = $('#clear-btn');

  var chosen = [];        // File objects
  var result = null;      // { table, log, name }
  var running = false;

  document.addEventListener('tn:ready', function () {
    var slot = document.querySelector('[data-icon="coil"]');
    if (slot) slot.innerHTML = TN.icon('coil', 36);
  });

  /* ---------------- files ---------------- */

  function kindOf(name) {
    if (/\.docx$/i.test(name)) return 'docx';
    if (/\.pdf$/i.test(name)) return 'pdf';
    if (/\.doc$/i.test(name)) return 'doc';
    return '';
  }

  function addFiles(list) {
    var skipped = 0, dupes = 0, added = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (/^~\$/.test(f.name)) continue;          // Word lock files
      if (!kindOf(f.name)) { skipped++; continue; }
      var dupe = chosen.some(function (c) { return c.name === f.name && c.size === f.size; });
      if (dupe) dupes++;
      else { chosen.push(f); added++; }
    }
    var said = [];
    if (skipped) said.push(skipped + ' file(s) skipped — only .docx and .pdf are read.');
    if (dupes) said.push(dupes + ' file(s) skipped — already in the list.');
    if (said.length) TN.toast(said.join(' '), skipped ? 'error' : undefined);
    if (added) dropResult();
    renderFiles();
  }

  /* A result belongs to the file list it was read from. When the list
     changes the old table is taken down, so it cannot be downloaded as if it
     covered the new list. */
  var listChanged = false;
  function dropResult() {
    if (!result) return;
    result = null;
    resultPanel.hidden = true;
    listChanged = true;
  }

  function renderFiles() {
    fileList.innerHTML = '';
    chosen.forEach(function (f, i) {
      var li = document.createElement('li');
      li.className = 'cd-file';
      var name = document.createElement('span');
      name.className = 'cd-file__name';
      name.textContent = f.name;
      var kind = document.createElement('span');
      kind.className = 'cd-file__kind';
      kind.textContent = kindOf(f.name).toUpperCase() + ' · ' + (f.size / 1024).toFixed(0) + ' KB';
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn btn--ghost btn--sm';
      rm.textContent = 'Remove';
      rm.setAttribute('aria-label', 'Remove ' + f.name);
      rm.addEventListener('click', function () {
        chosen.splice(i, 1);
        dropResult();
        renderFiles();
      });
      li.append(name, kind, rm);
      fileList.appendChild(li);
    });
    fileNote.textContent = chosen.length
      ? chosen.length + ' quotation' + (chosen.length === 1 ? '' : 's') + ' ready.'
      : 'No quotations chosen yet.';
    syncRun();
  }

  function syncRun() {
    runBtn.disabled = running || chosen.length === 0;
    runBtn.textContent = chosen.length
      ? 'Extract ' + chosen.length + ' file' + (chosen.length === 1 ? '' : 's')
      : 'Extract';
    if (!running) {
      runNote.textContent = !chosen.length ? 'Add at least one quotation.'
        : listChanged ? 'File list changed — press Extract again.' : '';
    }
  }

  /* Plain reasons for a file that cannot be read. The PDF engine and the
     browser's unzip report in their own terms ("Failed to fetch", "No
     password given"), which say nothing to the person holding the file. */
  function whyUnreadable(err, kind) {
    var name = err && err.name ? err.name : '';
    var msg = err && err.message ? err.message : String(err);
    if (name === 'PasswordException') return 'password-protected: save a copy without the password and add that';
    if (name === 'InvalidPDFException') return 'not a readable PDF: the file is damaged or is not a PDF';
    if (kind === 'docx' && /zip directory|word\/document\.xml/.test(msg)) return 'not a Word .docx file, or the file is damaged';
    if (kind === 'docx' && !/This browser/.test(msg)) return 'the file is damaged: open it in Word and save it again';
    return msg;
  }

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
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = '';       // so the same file can be re-picked after removal
  });

  /* ---------------- reading ---------------- */

  async function readPdf(buffer, onPage) {
    if (!window.pdfjsLib) throw new Error('the PDF engine did not load — check the connection and refresh');
    var pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    var rows = [];
    var empty = 0;
    for (var p = 1; p <= pdf.numPages; p++) {
      onPage(p, pdf.numPages);
      var tc = await (await pdf.getPage(p)).getTextContent();
      if (!tc.items.some(function (it) { return it.str && it.str.trim(); })) empty++;
      rows = rows.concat(coilParse.pdfRows(tc.items, 'page ' + p));
    }
    return { rows: rows, pages: pdf.numPages, emptyPages: empty };
  }

  async function run() {
    if (running || !chosen.length) return;
    running = true;
    syncRun();
    resultPanel.hidden = true;

    var records = [];
    var log = [];

    for (var i = 0; i < chosen.length; i++) {
      var f = chosen[i];
      var kind = kindOf(f.name);
      var entry = { file: f.name, coils: 0, status: '', bad: false };
      log.push(entry);
      runNote.textContent = 'Reading ' + f.name + ' (' + (i + 1) + ' of ' + chosen.length + ')…';

      if (kind === 'doc') {
        entry.status = 'old .doc format — open in Word and save as .docx';
        entry.bad = true;
        continue;
      }
      if (f.size === 0) {
        entry.status = 'could not be read — the file is empty (0 bytes)';
        entry.bad = true;
        continue;
      }
      try {
        var buffer = await f.arrayBuffer();
        var rows, extra = '';
        if (kind === 'docx') {
          rows = await coilParse.rowsFromDocx(buffer);
        } else {
          var pdf = await readPdf(buffer, function (p, n) {
            runNote.textContent = 'Reading ' + f.name + ' — page ' + p + ' of ' + n + '…';
          });
          rows = pdf.rows;
          if (pdf.emptyPages === pdf.pages) extra = 'no text at all — a scanned PDF?';
          else if (pdf.emptyPages) extra = pdf.emptyPages + ' page(s) had no text';
        }
        var got = coilParse.interpret(rows);
        got.items.forEach(function (item) { records.push({ file: f.name, item: item }); });
        entry.coils = got.items.length;
        if (!got.items.length) {
          entry.status = extra || 'no coil blocks found (no “Reference:” rows)';
          entry.bad = true;
        } else {
          entry.status = extra ? 'ok · ' + extra : 'ok';
          entry.warn = !!extra;
        }
      } catch (err) {
        entry.status = 'could not be read — ' + whyUnreadable(err, kind);
        entry.bad = true;
      }
      /* Let the note repaint between files. */
      await new Promise(function (r) { setTimeout(r, 0); });
    }

    var table = coilParse.buildTable(records, { imperial: optImperial.checked });
    var name = chosen.length === 1
      ? chosen[0].name.replace(/\.(docx|pdf)$/i, '') + ' - coil data.xlsx'
      : 'Coil data.xlsx';
    result = { table: table, log: log, name: name };

    running = false;
    listChanged = false;
    syncRun();
    render();
  }

  /* ---------------- result ---------------- */

  function stat(label, value) {
    var d = document.createElement('div');
    d.className = 'stat';
    var v = document.createElement('span');
    v.className = 'stat__value';
    v.textContent = value;
    var l = document.createElement('span');
    l.className = 'stat__label';
    l.textContent = label;
    d.append(v, l);
    return d;
  }

  function render() {
    var t = result.table;
    var fieldCount = t.columns.length - 13;          // 5 lead + 8 tail columns are fixed
    var statsEl = $('#result-stats');
    statsEl.innerHTML = '';
    statsEl.append(
      stat('coils', String(t.rows.length)),
      stat('files read', String(result.log.filter(function (e) { return e.coils; }).length) + ' / ' + result.log.length),
      stat('data fields', String(Math.max(0, fieldCount)))
    );

    /* Total capacity × quantity — the number a costing sheet starts from. */
    var capIdx = t.columns.indexOf('Total capacity (kW)');
    var qtyIdx = t.columns.indexOf('Quantity');
    if (capIdx >= 0 && t.rows.length) {
      var sum = t.rows.reduce(function (s, r) {
        var c = typeof r[capIdx] === 'number' ? r[capIdx] : 0;
        var q = typeof r[qtyIdx] === 'number' ? r[qtyIdx] : 1;
        return s + c * q;
      }, 0);
      statsEl.append(stat('kW total × qty', sum.toLocaleString(undefined, { maximumFractionDigits: 2 })));
    }

    var head = '<tr>' + t.columns.map(function (c, i) {
      return '<th scope="col"' + (t.numeric[i] ? ' class="num"' : '') + '>' + TN.esc(c) + '</th>';
    }).join('') + '</tr>';
    $('#preview-head').innerHTML = head;
    $('#preview-body').innerHTML = t.rows.slice(0, PREVIEW_ROWS).map(function (r) {
      return '<tr>' + r.map(function (v, i) {
        return '<td' + (typeof v === 'number' ? ' class="num"' : '') + '>' + TN.esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('#preview-note').textContent = t.rows.length > PREVIEW_ROWS
      ? 'Showing the first ' + PREVIEW_ROWS + ' of ' + t.rows.length + ' coils — the Excel file has them all.'
      : 'Scroll sideways for every column. The Excel file matches this table.';

    var logBody = $('#log-body');
    logBody.innerHTML = '';
    result.log.forEach(function (e) {
      var tr = document.createElement('tr');
      if (e.bad) tr.className = 'is-bad';
      else if (e.warn) tr.className = 'is-warn';
      [e.file, String(e.coils), e.status].forEach(function (v) {
        var td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
      logBody.appendChild(tr);
    });

    downloadBtn.disabled = t.rows.length === 0;
    runNote.textContent = t.rows.length
      ? t.rows.length + ' coil' + (t.rows.length === 1 ? '' : 's') + ' extracted.'
      : 'No coils were found. Check the file list in the result.';
    resultPanel.hidden = false;
  }

  function save(bytes, filename) {
    var blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  downloadBtn.addEventListener('click', async function () {
    if (!result || !result.table.rows.length) return;
    downloadBtn.disabled = true;
    try {
      var t = result.table;
      var bytes = await xlsxOut.build([
        { name: 'Coils', columns: t.columns, rows: t.rows },
        {
          name: 'Extraction_Log',
          columns: ['File', 'Coils', 'Status'],
          rows: result.log.map(function (e) { return [e.file, e.coils, e.status]; }),
          fills: result.log.map(function (e) { return e.bad || e.warn ? 1 : 0; }),
        },
      ]);
      save(bytes, result.name);
    } catch (err) {
      TN.toast('The Excel file could not be built: ' + (err && err.message ? err.message : err), 'error');
    }
    downloadBtn.disabled = false;
  });

  clearBtn.addEventListener('click', function () {
    chosen = [];
    result = null;
    listChanged = false;
    resultPanel.hidden = true;
    $('#preview-head').innerHTML = '';
    $('#preview-body').innerHTML = '';
    $('#log-body').innerHTML = '';
    renderFiles();
  });

  /* A result belongs to the options it was built with; changing one clears
     it rather than leaving a table that no longer matches the checkbox. */
  optImperial.addEventListener('change', function () {
    if (result) { result = null; resultPanel.hidden = true; syncRun(); }
  });

  runBtn.addEventListener('click', run);
  syncRun();
})();
