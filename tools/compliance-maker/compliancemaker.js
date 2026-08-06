/* ==========================================================================
   Compliance Maker — tool logic (v6)

   1. Extract text from a PDF with PDF.js (no OCR), or take pasted text.
   2. Parse lines into { sr, spec, type } rows, detecting labels and merging
      wrapped continuation lines.
   3. Library: three Excel files in the repo (/data/compliance-library/) —
      one per product section (AHU / FCU / Air Cooled Chiller). The selected
      product's file is fetched (login-gated) and matched ENTIRELY in the
      browser: exact on normalized text, then Jaccard fuzzy at >= 0.85.
      Confident matches pre-fill Compliance/Remarks (yellow); everything
      else stays blank.
   4. AI (optional, per click): rows still blank after library matching can
      be sent to /api/compliance/ai-suggest (Cloudflare Workers AI). Each clause carries
      its nearest library answers as examples. AI fills are ORANGE — always
      distinguishable from library fills, always to be verified.
   5. Live preview + styled .xlsx export (custom writer; SheetJS free build
      is used for READING library files only).

   Growing the library: "Merge completed matrix" reads the current library
   file + a finished matrix, dedupes (newest wins), and downloads an updated
   library .xlsx to commit back to the repo. No backend writes anywhere.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- PDF.js worker ---- */
  if (window['pdfjsLib']) {
    window['pdfjsLib'].GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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
  var inputRegion= document.getElementById('input-region');
  var btnConvert = document.getElementById('btn-convert');
  var convertHint= document.getElementById('convert-hint');

  /* Product + AI refs. The Compliance-library PANEL is gone from the UI —
     library matching still runs silently inside Convert. Whether a user
     also gets AI follows the `ai-review` item in the catalogue, granted in
     /admin/ by plan or per user; the AI block only appears for those
     accounts, and only with a datasheet loaded. Provenance stays: yellow =
     library, orange = AI, red = conflict, Comments column explains each. */
  var productInput = document.getElementById('product-input');
  var factoryInput = document.getElementById('factory-input');
  var btnAi        = document.getElementById('btn-ai');
  var btnExportLog = document.getElementById('btn-export-log');
  var exportLogStatusEl = document.getElementById('export-log-status');
  var aiBlock      = document.getElementById('panel-ai');
  var aiStatus     = document.getElementById('ai-status');
  var selInput     = document.getElementById('selection-input');
  var btnSelPick   = document.getElementById('btn-selection');
  var selSlot      = document.getElementById('selection-slot');

  // Library pre-fill always ON now (no user-facing toggle). Users without
  // auto-fill access simply have an empty/irrelevant library; the match
  // just yields nothing and every cell stays blank.
  var useLibrary = { checked: true };

  var currentRows = null;
  var currentName = 'compliance-matrix';
  var selectionText = '';          // extracted selection datasheet text (fallback)
  var selectionFields = [];        // structured {label, value} pairs — primary source
  var unitSections = [];           // sections the selected unit actually has
  var selectionName = '';
  var pendingFile = null;          // chosen PDF, not yet processed
  var activeSource = 'pdf';        // 'pdf' | 'text'

  /* ======================================================================
     LIBRARY SECTIONS — one Excel file per (product, factory) pair, fetched
     once per pair and cached. UAE and KSA factories can legitimately have
     different correct answers for the same clause (different suppliers/
     configurations), so they are ENTIRELY SEPARATE files, never merged.
     ====================================================================== */

  var LIB_BASE = '/data/compliance-library/';

  // Mirrors PRODUCT_FACTORIES in functions/_auth.js exactly — factory is NOT
  // a fixed set shared by every product. Drives the Factory dropdown's
  // options (populated dynamically once a product is chosen) and is the
  // client-side half of the same validation the server enforces.
  var PRODUCT_FACTORIES = {
    'AHU': ['UAE', 'KSA'],
    'FCU': ['China'],
    'Air Cooled Chiller': ['Italy', 'KSA']
  };
  var LIB_FILES = {
    'AHU': { 'UAE': 'AHU-UAE.xlsx', 'KSA': 'AHU-KSA.xlsx' },
    'FCU': { 'China': 'FCU-China.xlsx' },
    'Air Cooled Chiller': { 'Italy': 'Air-Cooled-Chiller-Italy.xlsx', 'KSA': 'Air-Cooled-Chiller-KSA.xlsx' }
  };
  function libFileName(product, factory) {
    return LIB_FILES[product] && LIB_FILES[product][factory];
  }

  // Rebuilds the Factory <select> options for the given product. Called on
  // every product change so a stale factory value (valid for the PREVIOUS
  // product) can never linger — e.g. picking FCU after AHU must not leave
  // "KSA" selected when FCU only has "China".
  function populateFactoryOptions(product) {
    if (!factoryInput) return;
    var list = PRODUCT_FACTORIES[product] || [];
    factoryInput.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = list.length ? 'Select a factory\u2026' : 'Select a product first\u2026';
    factoryInput.appendChild(placeholder);
    list.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f; opt.textContent = f;
      factoryInput.appendChild(opt);
    });
    factoryInput.disabled = list.length === 0;
  }
  var libCache = {}; // "product|factory" -> { entries: [{spec, compliance, remarks, norm, tokens}] }
  function libCacheKey(product, factory) { return product + '|' + factory; }

  // Product AND factory must both be selected before conversion, autofill,
  // export, or merge — the selected (product, factory) file is the only
  // data ever consulted. Returns {product, factory} or null.
  function requireProduct(statusFn) {
    var p = productInput.value;
    var f = factoryInput ? factoryInput.value : '';
    if (!p) {
      statusFn('Select a product first (AHU, FCU or Air Cooled Chiller) — it decides which library file is used.', 'error');
      productInput.focus();
      return null;
    }
    if (!f) {
      statusFn('Select a factory — it decides which library file is used.', 'error');
      if (factoryInput) factoryInput.focus();
      return null;
    }
    return { product: p, factory: f };
  }

  // Library panel is gone; any library-related status now shows on the
  // main status line so nothing silently disappears.
  function setLibStatus(msg, kind) {
    setStatus(msg, kind);
  }
  function setAiStatus(msg, kind) {
    aiStatus.textContent = msg;
    aiStatus.className = 'status' + (kind ? ' status--' + kind : '');
  }
  // Own status element — the export button lives in step 1, not inside the
  // AI panel, and shouldn't write into a status line that may be hidden.
  function setExportLogStatus(msg, kind) {
    if (!exportLogStatusEl) return;
    exportLogStatusEl.textContent = msg;
    exportLogStatusEl.className = 'status' + (kind ? ' status--' + kind : '');
  }

  function loadLibrary(product, factory) {
    var key = libCacheKey(product, factory);
    if (libCache[key]) return Promise.resolve(libCache[key]);
    if (!window.XLSX) return Promise.reject(new Error('Spreadsheet reader failed to load'));

    var fname = libFileName(product, factory);
    if (!fname) return Promise.reject(new Error('No library file mapped for ' + product + ' / ' + factory));

    setLibStatus('Loading ' + fname + '…');
    return fetch(LIB_BASE + fname).then(function (r) {
      if (r.status === 401) throw new Error('Sign in to use the library');
      if (!r.ok) throw new Error(fname + ' not found on the server');
      return r.arrayBuffer();
    }).then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' });
      var entries = [];
      wb.SheetNames.forEach(function (name) {
        var aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false });
        entries = entries.concat(extractEntriesFromSheet(aoa).entries);
      });
      entries.forEach(function (e) {
        e.norm = normSpec(e.spec);
        e.tokens = tokenSet(e.norm);
      });
      entries = entries.filter(function (e) { return e.norm.length >= 8; });
      libCache[key] = { entries: entries };
      setLibStatus(product + ' (' + factory + ') library loaded — ' + entries.length + ' answered clauses (' + fname + ').', 'ok');
      return libCache[key];
    });
  }

  // Reads answered rows out of any of our layouts: library template
  // (Specifications/Compliance/Remarks), the exported matrix, the Python
  // tool's output, and the original xlsm. Finds the header row and reads
  // column positions from it.
  function extractEntriesFromSheet(aoa) {
    var headerRow = -1, cols = {};
    for (var r = 0; r < Math.min(aoa.length, 15); r++) {
      var row = aoa[r] || [];
      var idx = {};
      for (var c = 0; c < row.length; c++) {
        var v = String(row[c] == null ? '' : row[c]).trim().toLowerCase();
        if (v === 'sr') idx.sr = c;
        else if (v === 'specifications') idx.spec = c;
        else if (v === 'compliance') idx.comp = c;
        else if (v === 'remarks') idx.rem = c;
      }
      if (idx.spec != null && idx.comp != null) { headerRow = r; cols = idx; break; }
    }
    if (headerRow < 0) return { entries: [] };

    var entries = [];
    for (var dr = headerRow + 1; dr < aoa.length; dr++) {
      var row2 = aoa[dr] || [];
      var spec = String(row2[cols.spec] == null ? '' : row2[cols.spec]).trim();
      var comp = String(row2[cols.comp] == null ? '' : row2[cols.comp]).trim();
      var rem  = cols.rem != null ? String(row2[cols.rem] == null ? '' : row2[cols.rem]).trim() : '';
      if (spec && (comp || rem)) entries.push({ spec: spec, compliance: comp, remarks: rem });
    }
    return { entries: entries };
  }

  /* ======================================================================
     MATCHING — all in the browser. Mirrors the retired D1 logic.
     ====================================================================== */

  // Order matters: trim FIRST, then strip trailing punctuation.
  function normSpec(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.,;:]+$/, '');
  }

  // Plural folding ("requirements" -> "requirement") stops harmless
  // singular/plural edits from sinking the similarity score.
  function tokenSet(norm) {
    var set = {};
    norm.split(/[^a-z0-9]+/).forEach(function (t) {
      if (t.length < 2) return;
      if (t.length > 3 && t.slice(-1) === 's' && t.slice(-2) !== 'ss') t = t.slice(0, -1);
      set[t] = true;
    });
    return set;
  }

  function jaccard(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (!ka.length || !kb.length) return 0;
    var inter = 0;
    ka.forEach(function (t) { if (b[t]) inter++; });
    return inter / (ka.length + kb.length - inter);
  }

  var FUZZY_THRESHOLD = 0.85;

  // Annotates body rows (letter/number/text) from the loaded library.
  // Confident matches fill; the rest stay blank but remember their nearest
  // library answers as _aiContext, which the AI step reuses as examples.
  function matchRows(rows, lib) {
    var exact = {};
    lib.entries.forEach(function (e) { exact[e.norm] = e; });
    var filled = 0;

    rows.forEach(function (r) {
      if (r.type !== 'letter' && r.type !== 'number' && r.type !== 'text') return;
      var norm = normSpec(r.spec);
      if (norm.length < 8) return;

      var hit = exact[norm];
      if (hit) {
        r.compliance = hit.compliance;
        r.remarks = hit.remarks;
        r.auto = { type: 'exact', score: 1, from: hit.spec };
        filled++;
        return;
      }

      var tokens = tokenSet(norm);
      var scored = lib.entries.map(function (e) {
        return { e: e, s: jaccard(tokens, e.tokens) };
      }).sort(function (a, b) { return b.s - a.s; });

      if (scored.length && scored[0].s >= FUZZY_THRESHOLD) {
        var best = scored[0];
        r.compliance = best.e.compliance;
        r.remarks = best.e.remarks;
        r.auto = { type: 'fuzzy', score: Math.round(best.s * 100) / 100, from: best.e.spec };
        filled++;
      } else {
        // Blank — keep the nearest library answers as inspiration for the
        // AI step. Content-similarity alone can fail completely for a
        // topically unrelated clause (e.g. a structural/deflection clause
        // has near-zero word overlap with casing/fan/filter answers, no
        // matter how low the threshold goes) — so rather than filtering
        // by score and risking an EMPTY list, always take the nearest few
        // entries the library has. Even a topically distant example still
        // shows the model Daikin's general answering pattern and style,
        // which is what "construct a best-guess answer" draws on when
        // nothing is a close match. Only a genuinely empty library
        // produces an empty _aiContext.
        r._aiContext = scored.slice(0, 5)
          .map(function (x) { return { spec: x.e.spec, compliance: x.e.compliance, remarks: x.e.remarks }; });
      }
    });
    return filled;
  }

  /* ------------------------------------------------------------------
     BY CONTRACTOR scope rule (deterministic, from the compliance engine
     prompt): site-execution clauses are marked "By Contractor" by code,
     not AI — zero hallucination risk for a rule this mechanical.
     Runs AFTER library matching (a verified past answer always wins) and
     BEFORE AI (these rows are no longer blank, so AI never touches them).
     ------------------------------------------------------------------ */
  var BY_CONTRACTOR_RE = new RegExp(
    '\\b(install(?:ation|ed|ing)?|erect(?:ion|ed)|rigging|lifting|unloading|' +
    'positioning|alignment|anchor(?:ing|age|ed)|duct connection|piping connection|' +
    'electrical connection|touch-?up paint(?:ing)?|site test(?:ing)?|commissioning)\\b', 'i');
  var BY_CONTRACTOR_REMARK = 'By Contractor / Others. Daikin scope is equipment supply only.';

  // Under a "PART n ... PRODUCTS" heading, a clause describes the EQUIPMENT
  // ITSELF — that is Daikin's scope by default, even if a stray word like
  // "install" appears in generic wording. Only genuine site/construction
  // work (something that plainly can't be manufactured in the AHU/FCU/
  // Chiller factory — foundations, on-site maintenance) is By Contractor
  // there. The broader keyword rule above still applies everywhere ELSE
  // (PART 1 GENERAL, PART 3 EXECUTION, or no PART context at all).
  var SITE_WORK_UNDER_PRODUCTS_RE = /\b(plinth|foundation|civil work|builder'?s?\s*work|site maintenance|maintenance at site|maintenance at (?:the )?location)\b/i;

  // Factory-side wording that must NOT trigger the site-execution rule
  // (e.g. "factory-installed by manufacturer" is a supply clause).
  var FACTORY_SIDE_RE = /\b(?:factory|pre|shop)[- ]?(?:install(?:ation|ed|ing)?|assembl(?:ed|y)|test(?:ed|ing)?|wir(?:ed|ing)|paint(?:ed|ing)?)\b/gi;

  function applyScopeRules(rows) {
    var marked = 0;
    rows.forEach(function (r) {
      if (r.type !== 'letter' && r.type !== 'number' && r.type !== 'text') return;
      if (r.compliance || r.remarks) return; // library answer wins
      var scopeText = r.spec.replace(FACTORY_SIDE_RE, '');
      // r.path (set by annotateHierarchy, which always runs before this)
      // looks like "AHU > PART 2 PRODUCTS > 2.02 CASING" — check the PART
      // segment specifically for "PRODUCT".
      var underProducts = /\bPART\s+[0-9IVX]+[^>]*PRODUCT/i.test(r.path || '');
      var isByContractor = underProducts
        ? SITE_WORK_UNDER_PRODUCTS_RE.test(scopeText)
        : BY_CONTRACTOR_RE.test(scopeText);
      if (isByContractor) {
        r.compliance = 'By Contractor';
        r.remarks = BY_CONTRACTOR_REMARK;
        r.auto = { type: 'rule', score: 1, from: 'Scope rule: site execution' };
        marked++;
      }
    });
    return marked;
  }

  function prefillFromLibrary(rows, product, factory) {
    if (!useLibrary.checked) return Promise.resolve(0);
    return loadLibrary(product, factory).then(function (lib) {
      if (!lib.entries.length) return 0;
      return matchRows(rows, lib);
    });
  }

  /* ======================================================================
     LIBRARY GROWTH — merge a completed matrix, download the updated file
     ====================================================================== */

  function mergeIntoLibrary(file) {
    var pf = requireProduct(setLibStatus);
    if (!pf || !file) return;
    var product = pf.product, factory = pf.factory;
    if (!window.XLSX) {
      setLibStatus('Spreadsheet reader failed to load. Refresh and try again.', 'error');
      return;
    }
    setLibStatus('Merging ' + file.name + ' into the ' + product + ' (' + factory + ') library…');

    Promise.all([loadLibrary(product, factory), file.arrayBuffer()]).then(function (res) {
      var lib = res[0];
      var wb = window.XLSX.read(res[1], { type: 'array' });
      var incoming = [];
      wb.SheetNames.forEach(function (name) {
        var aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false });
        incoming = incoming.concat(extractEntriesFromSheet(aoa).entries);
      });
      if (!incoming.length) {
        setLibStatus('No answered rows found in ' + file.name + ' (Compliance/Remarks are empty?).', 'error');
        return;
      }

      // Dedupe by normalized text; the completed matrix (newest) wins.
      var byNorm = {};
      lib.entries.forEach(function (e) { byNorm[e.norm] = e; });
      var added = 0, updated = 0;
      incoming.forEach(function (e) {
        var norm = normSpec(e.spec);
        if (norm.length < 8) return;
        if (byNorm[norm]) updated++; else added++;
        byNorm[norm] = { spec: e.spec, compliance: e.compliance, remarks: e.remarks, norm: norm };
      });

      var merged = Object.keys(byNorm).map(function (k) { return byNorm[k]; });
      // Plain unstyled data file — SheetJS free writes these fine.
      var out = window.XLSX.utils.book_new();
      var aoa = [['Specifications', 'Compliance', 'Remarks']].concat(
        merged.map(function (e) { return [e.spec, e.compliance, e.remarks]; }));
      window.XLSX.utils.book_append_sheet(out, window.XLSX.utils.aoa_to_sheet(aoa), 'Library');
      window.XLSX.writeFile(out, libFileName(product, factory));

      // Refresh in-memory cache so this session matches against the merge.
      merged.forEach(function (e) { e.tokens = tokenSet(e.norm); });
      libCache[libCacheKey(product, factory)] = { entries: merged };

      setLibStatus('Downloaded updated ' + libFileName(product, factory) + ' — ' + added + ' new, ' +
        updated + ' updated, ' + merged.length + ' total. Upload it to the repo at ' +
        LIB_BASE + ' to make it live for everyone.', 'ok');
    }).catch(function (err) {
      console.error(err);
      setLibStatus('Merge failed — ' + (err.message || 'could not read files'), 'error');
    });
  }

  /* ======================================================================
     AI SUGGESTIONS — only for rows the library left blank, always orange
     ====================================================================== */

  // A letter row like "D. Corrosion Prevention" is a sub-header (short
  // title, no sentence-ending punctuation); "A. All goods shall be…" is a
  // clause. Sub-headers join the path of the rows beneath them.
  function isSubheader(text) {
    return text.length <= 50 && !/[.:;]\s*$/.test(text);
  }

  function annotatePaths(rows) {
    var part = '', section = '', sub = '';
    rows.forEach(function (r) {
      if (r.type === 'part') { part = r.spec; section = ''; sub = ''; r._path = ''; return; }
      if (r.type === 'section') {
        section = (r.sr ? r.sr + ' ' : '') + r.spec;
        sub = '';
        r._path = part;
        return;
      }
      if (r.type === 'letter') {
        // Lowercase letters (a) b) c)) are nested list items — they inherit
        // the current sub-section instead of resetting it.
        if (/^[a-z]$/.test(r.sr)) {
          r._path = [part, section, sub].filter(Boolean).join(' \u2192 ');
          return;
        }
        if (isSubheader(r.spec)) {
          sub = r.sr + '. ' + r.spec;
          r._path = [part, section].filter(Boolean).join(' \u2192 ');
        } else {
          sub = 'item ' + r.sr;   // children of a clause letter: "… → item A"
          r._path = [part, section].filter(Boolean).join(' \u2192 ');
        }
        return;
      }
      r._path = [part, section, sub].filter(Boolean).join(' \u2192 ');
    });
  }

  function blankBodyRows(rows) {
    return rows.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) {
      return (x.r.type === 'letter' || x.r.type === 'number' || x.r.type === 'text') &&
             !x.r.isHeading &&
             !x.r.compliance && !x.r.remarks && normSpec(x.r.spec).length >= 8;
    });
  }

  function runAiSuggest() {
    if (!currentRows || !aiEnabled) return;
    var pf = requireProduct(setAiStatus);
    if (!pf) return;
    var product = pf.product, factory = pf.factory;
    annotatePaths(currentRows);
    var blanks = blankBodyRows(currentRows);
    if (!blanks.length) {
      setAiStatus('No blank rows left to suggest for.', 'ok');
      return;
    }

    // Snapshot the array reference AI is working against. If Convert runs
    // again (or Clear, or switching source) while a request is still in
    // flight, currentRows gets reassigned to a NEW array — the in-flight
    // batches would otherwise mutate now-orphaned row objects that never
    // reach the screen, which looks exactly like "AI ran but nothing
    // updated". Checked before every render below.
    var targetRows = currentRows;

    btnAi.disabled = true;
    // Hide Preview & Export while AI is working — it reappears automatically
    // once done, since every completion path below (success, error, or
    // interrupted) already calls renderPreview(), which unhides it.
    resultPanel.hidden = true;
    var batches = [];
    // Smaller batches finish faster and reduce the chance of a platform-level
    // timeout on Workers AI (which would surface as an HTML error page).
    // Kept small deliberately now that a real selection datasheet adds to
    // the prompt size on every batch.
    for (var i = 0; i < blanks.length; i += 3) batches.push(blanks.slice(i, i + 3));
    var suggested = 0;
    var batchesWithNoUsableAnswers = 0;
    var lastDebugSnippet = '';
    var guardedCount = 0;

    function stillCurrent() { return currentRows === targetRows; }

    function next(bi) {
      if (bi >= batches.length) {
        if (!stillCurrent()) {
          setAiStatus('AI finished, but the specification changed while it was running — ' +
            'those answers were discarded. Run Suggest again on the current result.', 'error');
          return;
        }
        checkConflicts(targetRows, product, factory).then(function (conf) {
          if (!stillCurrent()) return; // changed again during the conflict check
          renderPreview(targetRows);
          // Blaming the datasheet here was wrong — an empty array is the
          // model running out of room, not a refusal, and the server now
          // retries twice before reporting it. Say what actually happened
          // and what to do, which is: answer those rows by hand.
          var extra = batchesWithNoUsableAnswers
            ? ' ' + batchesWithNoUsableAnswers + ' batch(es) came back empty after retries — ' +
              'those rows are left blank for you to fill in.'
            : '';
          // Worth saying out loud: these are answers that were withdrawn
          // because they quoted the specification's own number back as the
          // product's value. Silently downgrading them would hide a real
          // signal about how well the datasheet is being read.
          if (guardedCount) {
            extra += ' ' + guardedCount + ' answer(s) were withdrawn for restating a required value ' +
              'as the actual value — set to TO VERIFY.';
          }
          setAiStatus('AI suggested statuses for ' + suggested + ' of ' + blanks.length +
            ' blank rows — orange = verified source, amber = unverified GUESS (see the row count below; verify every filled row before sending).' +
            (conf ? ' ' + conf + ' answer(s) CONFLICT with the log (red).' : '') + extra,
            suggested ? 'ok' : 'error');
        });
        return;
      }
      var batch = batches[bi];
      setAiStatus('Asking AI — batch ' + (bi + 1) + ' of ' + batches.length + '…');

      // A hard client-side timeout on top of the server's own limits: if
      // Workers AI is slow, WE cut the request off with a readable message
      // instead of letting Cloudflare's edge kill the connection and hand
      // back an HTML page (the "Unexpected token '<'" failure). Whichever
      // side gives up first, the person always sees plain English.
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, 25000);

      fetch('/api/compliance/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          product: product,
          factory: factory,
          selection: selectionText,        // fallback raw text (may be empty)
          selectionFields: selectionFields, // primary structured source (may be empty)
          unitSections: unitSections,       // the sections this unit has

          items: batch.map(function (x) {
            return { spec: x.r.spec, path: x.r._path || '', context: x.r._aiContext || [] };
          })
        })
      }).then(function (r) { clearTimeout(timeoutId); return safeJson(r); }).then(function (d) {
        if (d.error) throw new Error(d.error);
        if (!stillCurrent()) { next(bi + 1); return; } // don't mutate orphaned rows
        var gotAny = false;
        (d.suggestions || []).forEach(function (s, k) {
          if (!s || (!s.status && !s.remarks)) return;
          gotAny = true;
          var row = batch[k].r;
          var isGuess = s.verified === false;
          // Durable signal #1: the Compliance cell itself carries a "[GUESS]"
          // prefix — survives even if someone deletes the Comments column
          // or misses the color, since it's baked into the primary data.
          row.compliance = (isGuess ? '[GUESS] ' : '') + s.status;
          row.remarks = s.remarks;
          // Durable signal #2: distinct auto.type drives a different color
          // (see renderPreview/.hl-guess) — regular AI orange vs. guess
          // amber — so guesses stay visually distinguishable at a glance.
          row.auto = { type: isGuess ? 'ai-guess' : 'ai', score: 0, from: '', comments: s.comments || '' };
          suggested++;
        });
        guardedCount += (d.guarded || 0);
        if (!gotAny) {
          batchesWithNoUsableAnswers++;
          // Still captured for the console — useful when diagnosing, but no
          // longer shown in the status line, where it read as gibberish.
          if (d.debug) { lastDebugSnippet = String(d.debug).slice(0, 180); console.warn('[ai] empty batch:', lastDebugSnippet); }
        }
        next(bi + 1);
      }).catch(function (err) {
        clearTimeout(timeoutId);
        console.error(err);
        if (stillCurrent()) renderPreview(targetRows);
        var msg = err.name === 'AbortError'
          ? 'AI took too long to respond (over 25s) — try again with fewer blank rows, or without the datasheet attached.'
          : (err.message || 'request failed');
        setAiStatus('AI unavailable — ' + msg +
          (suggested ? '. Kept ' + suggested + ' suggestions from earlier batches.' : ''), 'error');
      });
    }
    next(0);
  }

  /* ======================================================================
     PARSING (unchanged)
     ====================================================================== */

  var RE = {
    part:    /^(PART\s+[0-9IVX]+)\b\s*(.*)$/i,
    section: /^(\d{1,2}\.\d{1,2})\s+(.*)$/,        // 1.01, 1.1, 2.1, 1.3
    number:  /^(\d{1,2})\.\s+(.*)$/,               // 1.
    letter:  /^([A-Z])\.\s+(.*)$/,                 // A.
    letterLoose: /^([a-zA-Z])[.)]\s+(.*)$/
  };

  // Mirrors the Excel tool's section test: a numbered heading is a blue
  // SECTION when its text is short and heading-shaped (Proper Case, ALL CAPS,
  // "CAPS-word + Proper rest", or ends with ":"). Otherwise it's a body row
  // (e.g. "1.1 The unit shall...") so it doesn't wrongly turn blue.
  function isSectionHeading(text) {
    if (!text) return true;                 // bare "1.3" with title on next line
    var words = text.split(/\s+/);
    if (words.length > 6) return false;      // long sentence -> not a heading
    if (/[.]/.test(text.replace(/:$/, ''))) return false; // decimals/periods inside -> not heading
    var stripped = text.replace(/:$/, '');
    var isCaps = stripped === stripped.toUpperCase();
    var isProper = words.every(function (w) {
      return !w || w[0] === w[0].toUpperCase();
    });
    var endsColon = /:$/.test(text);
    return isCaps || isProper || endsColon;
  }

  function startsNewItem(line) {
    return RE.part.test(line) || RE.section.test(line) ||
           RE.number.test(line) || RE.letter.test(line) ||
           RE.letterLoose.test(line);
  }

  function classify(line) {
    var m;
    if ((m = line.match(RE.part)))    return { type: 'part',    sr: m[1].toUpperCase(), spec: (m[2] || '').trim() };
    if ((m = line.match(RE.section))) {
      var stext = m[2].trim();
      // x.xx (two-decimal) is always a section (classic spec numbering).
      // x.x (one-decimal) is a section only if it reads like a heading.
      var twoDecimal = /^\d{1,2}\.\d{2}$/.test(m[1]);
      if (twoDecimal || isSectionHeading(stext)) {
        return { type: 'section', sr: m[1], spec: stext };
      }
      // Otherwise treat as a normal numbered body clause.
      return { type: 'number', sr: m[1], spec: stext };
    }
    if ((m = line.match(RE.number)))  return { type: 'number',  sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.letter)))  return { type: 'letter',  sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.letterLoose))) return { type: 'letter', sr: m[1], spec: m[2].trim() };
    return { type: 'text', sr: '', spec: line.trim() };
  }

  // "END OF SECTION" closes a specification section. It is a divider, not a
  // clause — but it arrives at the tail of the last clause's line, where the
  // continuation rule would silently glue it onto that clause's text. So it
  // is split off first and emitted as its own black band row, the same
  // treatment a PART header gets.
  var END_OF_SECTION_RE = /\bend\s+of\s+section\b[.:\s]*$/i;

  function parseLines(rawLines) {
    var rows = [];
    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i].replace(/\s+/g, ' ').trim();
      if (!line) continue;

      var endMatch = line.match(END_OF_SECTION_RE);
      if (endMatch) {
        // Whatever came before it on the same line is still a real clause,
        // so process that remainder first and let the divider follow.
        var before = line.slice(0, endMatch.index).trim();
        if (before) {
          rawLines.splice(i + 1, 0, 'END OF SECTION');
          line = before;
        } else {
          rows.push({ type: 'part', sr: '', spec: 'END OF SECTION' });
          continue;
        }
      }

      if (startsNewItem(line)) {
        rows.push(classify(line));
      } else if (rows.length &&
                 rows[rows.length - 1].type !== 'part' &&
                 rows[rows.length - 1].type !== 'section') {
        // Wrapped continuation of the previous clause — append.
        rows[rows.length - 1].spec =
          (rows[rows.length - 1].spec + ' ' + line).trim();
      } else {
        // Unlabeled paragraph directly after a PART/section header (or at
        // the start) is its own body row — headers never absorb body text.
        rows.push({ type: 'text', sr: '', spec: line });
      }
    }
    rows.forEach(function (r) {
      if (r.type === 'part') {
        r.spec = (r.sr + (r.spec ? ' ' + r.spec : '')).trim();
        r.sr = '';
      }
    });
    return rows;
  }

  /* ======================================================================
     HIGHLIGHTING — three styles (red, red+bold, underline) driven by a
     shared rules file (/data/rules/highlight-rules.xlsx) PLUS user words.
     The rules file mirrors the original Excel tool's columns; users can
     add extra red words in the Keyword dictionary box.
     ====================================================================== */

  var RULES_URL = '/data/rules/highlight-rules.xlsx';
  var rulesCache = null;   // { red:[], redbold:[], underline:[] } lowercased phrase lists

  // Column header (lowercased, trimmed) -> which style bucket it feeds.
  var RULE_COLMAP = {
    'highlight (red)': 'red',
    'red words/phrases': 'red',
    'red bold words': 'redbold',
    'underline words': 'underline'
    // 'sub-headings...' and 'not a label...' are read by the parser side,
    // not the highlighter; ignored here.
  };

  function loadRules() {
    if (rulesCache) return Promise.resolve(rulesCache);
    if (!window.XLSX) return Promise.resolve({ red: [], redbold: [], underline: [] });
    return fetch(RULES_URL).then(function (r) {
      if (!r.ok) throw new Error('rules not found');
      return r.arrayBuffer();
    }).then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' });
      var out = { red: [], redbold: [], underline: [] };
      wb.SheetNames.forEach(function (name) {
        var aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false });
        if (!aoa.length) return;
        var header = aoa[0].map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
        var colBucket = header.map(function (h) { return RULE_COLMAP[h] || null; });
        for (var r = 1; r < aoa.length; r++) {
          (aoa[r] || []).forEach(function (cell, c) {
            var bucket = colBucket[c];
            if (!bucket) return;
            var v = String(cell == null ? '' : cell).trim();
            if (v) out[bucket].push(v.toLowerCase());
          });
        }
      });
      rulesCache = out;
      return out;
    }).catch(function () {
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

  // Mirrors commentFor() in xlsx-writer.js so preview and export agree.
  function previewComment(r) {
    if (r.conflict && (r.compliance || r.remarks)) {
      return 'CONFLICT — previously: "' + (r.conflict.compliance || '(blank)') + '" / "' +
        (r.conflict.remarks || '(blank)') + '"' +
        (r.conflict.at ? ' (' + String(r.conflict.at).slice(0, 10) + ')' : '') + '. Resolve.';
    }
    if (!r.auto || (!r.compliance && !r.remarks)) return '';
    if (r.auto.type === 'exact') return 'From library (exact match).';
    if (r.auto.type === 'fuzzy') return 'From library (' + Math.round((r.auto.score || 0) * 100) + '% similar).';
    if (r.auto.type === 'rule')  return 'Scope rule: site-execution clause.';
    if (r.auto.type === 'ai')    return 'AI suggestion — verify against the selection.';
    if (r.auto.type === 'ai-guess') return r.auto.comments || 'WILD GUESS — NOT VERIFIED. CONFIRM BEFORE SENDING.';
    return '';
  }

  function renderPreview(rows) {
    var re = buildHighlighter();
    previewBody.innerHTML = '';
    var libFilled = 0, aiFilled = 0, guessFilled = 0, blanks = 0;

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

      // Compliance + Remarks. Yellow = your past answers (library).
      // Orange = AI suggestion (verified source). Amber = AI GUESS
      // (unverified — construct-your-best-answer fallback). Blank = engineer fills it.
      var isBody = (r.type === 'letter' || r.type === 'number' || r.type === 'text');
      var kind = '';
      if (r.auto && (r.compliance || r.remarks)) {
        kind = r.auto.type === 'ai-guess' ? 'guess' : (r.auto.type === 'ai' ? 'ai' : 'lib');
        if (kind === 'guess') guessFilled++;
        else if (kind === 'ai') aiFilled++;
        else libFilled++;
      } else if (isBody) {
        blanks++;
      }
      var isRule = kind === 'lib' && r.auto && r.auto.type === 'rule';
      [r.compliance || '', r.remarks || ''].forEach(function (val) {
        var td = document.createElement('td');
        td.className = r.conflict ? 'col-conflict'
          : (kind === 'guess' ? 'col-guess' : (kind === 'ai' ? 'col-ai' : (kind === 'lib' ? 'col-auto' : 'col-empty')));
        td.textContent = val;
        if (r.conflict) {
          td.title = 'CONFLICT — previously logged answer (' + (r.conflict.at || '') + '):\n' +
            'Compliance: ' + (r.conflict.compliance || '(blank)') + '\n' +
            'Remarks: ' + (r.conflict.remarks || '(blank)') +
            '\n\nCurrent answer differs. Resolve, then correct the Excel master.';
        } else if (isRule) {
          td.title = 'Scope rule (compliance engine): site-execution clause → By Contractor';
        } else if (kind === 'lib') {
          td.title = 'From library (' + r.auto.type +
            (r.auto.type === 'fuzzy' ? ', ' + Math.round(r.auto.score * 100) + '% similar' : '') +
            ')\nMatched clause: ' + (r.auto.from || '');
        } else if (kind === 'ai') {
          td.title = 'AI suggestion — verify before sending';
        } else if (kind === 'guess') {
          td.title = 'AI could not verify this against the datasheet or library — it constructed ' +
            'a best-guess answer instead. Treat this as a starting point only; confirm before sending.';
        }
        tr.appendChild(td);
      });

      var cTd = document.createElement('td');
      cTd.className = 'comments';
      cTd.textContent = (r.type === 'part' || r.type === 'section') ? '' : previewComment(r);
      if (r.type === 'part') cTd.style.background = '#000';
      tr.appendChild(cTd);

      previewBody.appendChild(tr);
    });

    var conflicts = rows.filter(function (r) { return r.conflict; }).length;
    countNote.textContent = rows.length + ' rows' +
      (conflicts ? ' · ' + conflicts + ' CONFLICT (red — resolve)' : '') +
      (libFilled ? ' · ' + libFilled + ' from library (yellow)' : '') +
      (aiFilled ? ' · ' + aiFilled + ' AI-suggested (orange — verify)' : '') +
      (guessFilled ? ' · ' + guessFilled + ' AI GUESS (amber — unverified, confirm before sending)' : '') +
      (blanks ? ' · ' + blanks + ' blank' : '') + '.';
    resultPanel.hidden = false;
    updateAiVisibility();
    btnDownload.disabled = rows.length === 0;
    refreshAiButton();
  }

  // AI panel shows only when BOTH are true: the account has autofill access
  // (appMode === 'full') AND a Convert has actually produced rows to
  // suggest answers for. Centralized so every place that changes either
  // condition stays consistent — see applyMode(), renderPreview(), clearAll().
  function updateAiVisibility() {
    if (!aiBlock) return;
    aiBlock.hidden = !(appTier === 'pro' && !!currentRows);
  }

  // The datasheet is OPTIONAL. It is the strongest source when present —
  // project-specific, overrides everything — but the library and past
  // verified answers can carry a clause on their own, so its absence must
  // not block the run. Button state is decided in exactly one place so the
  // datasheet handler, renderPreview and clearAll can never disagree.
  function datasheetLoaded() {
    return !!(selectionFields.length || selectionText);
  }

  function refreshAiButton() {
    if (!btnAi) return;
    var blanks = currentRows ? blankBodyRows(currentRows).length : 0;
    btnAi.disabled = !aiEnabled || extractingDatasheet || blanks === 0;
    var hint = document.getElementById('ai-gate-hint');
    if (!hint) return;
    if (!aiEnabled) hint.textContent = '';
    else if (!currentRows) hint.textContent = 'Convert a specification first.';
    else if (blanks === 0) hint.textContent = 'No blank rows left to suggest for.';
    else if (!datasheetLoaded()) hint.textContent =
      'No datasheet — answers will come from the library and past answers only.';
    else hint.textContent = '';
  }

  /* ======================================================================
     EXTRACTION (unchanged)
     ====================================================================== */

  function extractLinesFromTextContent(tc) {
    var items = tc.items.filter(function (it) { return it.str !== undefined; });
    var lines = [];
    var currentY = null, buf = [];
    items.forEach(function (it) {
      var y = it.transform[5];
      if (currentY === null || Math.abs(y - currentY) <= 2) {
        buf.push(it.str);
        currentY = currentY === null ? y : currentY;
      } else {
        lines.push(buf.join(''));
        buf = [it.str];
        currentY = y;
      }
    });
    if (buf.length) lines.push(buf.join(''));
    return lines;
  }

  /* ------------------------------------------------------------------
     HIERARCHY — give every clause its place in the document so the AI
     answers in context (e.g. AHU > PART 2 PRODUCTS > 2.02 CASING), and
     list items carry their parent clause ("...including:" -> "Cooling
     coil section."). Walks the rows once, tracking the current PART,
     x.xx section, and letter sub-heading.
     A letter row counts as a sub-heading (like "C. Electrical Work")
     when it is short; long letter rows are body clauses.
     ------------------------------------------------------------------ */
  function isHeadingText(spec) {
    return spec.length <= 48 && spec.split(/\s+/).length <= 5 && !/[.:]$/.test(spec);
  }

  function annotateHierarchy(rows, product) {
    var part = '', section = '', letterHead = '';
    var lastLetterBody = '', lastNumberBody = '';
    rows.forEach(function (r) {
      if (r.type === 'part') {
        part = r.spec; section = ''; letterHead = '';
        lastLetterBody = ''; lastNumberBody = '';
        return;
      }
      if (r.type === 'section') {
        section = (r.sr + ' ' + r.spec).trim(); letterHead = '';
        lastLetterBody = ''; lastNumberBody = '';
        return;
      }
      // Body rows: path = Product > PART > Section (> letter heading)
      var path = [product];
      if (part) path.push(part);
      if (section) path.push(section);

      if (r.type === 'letter') {
        // Lowercase a) b) items are SUB-ITEMS of the preceding numbered/letter
        // clause, not new letter clauses — they carry a parent, and they must
        // not overwrite the parent trackers.
        var isLoose = r.sr && r.sr !== r.sr.toUpperCase();
        if (isLoose) {
          if (letterHead) path.push(letterHead);
          r.path = path.join(' > ');
          r.parentText = lastNumberBody || lastLetterBody || '';
          return;
        }
        if (isHeadingText(r.spec)) {
          letterHead = r.spec;
          lastLetterBody = ''; lastNumberBody = '';
          r.isHeading = true;          // heading rows need no AI answer
        } else {
          lastLetterBody = r.spec; lastNumberBody = '';
        }
        if (letterHead && !r.isHeading) path.push(letterHead);
        r.path = path.join(' > ');
        r.parentText = '';
        return;
      }
      if (letterHead) path.push(letterHead);
      r.path = path.join(' > ');
      if (r.type === 'number') {
        r.parentText = lastLetterBody || '';
        lastNumberBody = r.spec;
      } else { // 'text' rows (incl. a) items via letterLoose become 'letter'…
        r.parentText = lastNumberBody || lastLetterBody || '';
      }
    });
  }

  // Extract plain text from any PDF file (selection datasheet).
  function extractPdfText(file, maxPages) {
    return new Promise(function (resolve, reject) {
      if (!window['pdfjsLib']) return reject(new Error('PDF engine failed to load'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the file')); };
      reader.onload = function () {
        window['pdfjsLib'].getDocument({ data: new Uint8Array(reader.result) }).promise
          .then(function (pdf) {
            var pages = Math.min(pdf.numPages, maxPages || 15);
            var all = [];
            function readPage(p) {
              if (p > pages) return Promise.resolve();
              return pdf.getPage(p)
                .then(function (page) { return page.getTextContent(); })
                .then(function (tc) {
                  all = all.concat(extractLinesFromTextContent(tc));
                  return readPage(p + 1);
                });
            }
            // Keep as an ARRAY of lines — line breaks are the only signal
            // that separates "Label" from "Value" on selection datasheets.
            // Collapsing to one flat string (as before) destroyed that
            // structure and made field lookup unreliable.
            return readPage(1).then(function () { resolve(all); });
          }).catch(reject);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ------------------------------------------------------------------
     SELECTION DATASHEET — field extraction.
     Selection reports (Daikin/ASTRAWEB and similar) are dense "Label
     Value" tables: "Panel • Insulation  42 mm • Foam", "Weight  1061 kg".
     A known-label dictionary is used rather than generic parsing — a
     generic "guess the boundary" parser is fragile across vendors and
     risks silently mangling values; matching against known field names
     is safe and directly serves lookups like "casing thickness" against
     a "Panel • Insulation" or "Panel Inner/Outer Skin" field.
     Not exhaustive by design — the raw text is still sent as a fallback
     for anything outside this dictionary.
     ------------------------------------------------------------------ */
  var DATASHEET_FIELD_LABELS = [
    // Casing / panel / structure — the exact area the user's example targets
    'Panel • Insulation', 'Panel Inner Skin', 'Panel Outer Skin', 'Internal Parts',
    'Drain Pan', 'Profile', 'AHU Base', 'Roof', 'Connection Side • Door',
    'Model Box Ref.', 'Range / Series', 'Model',
    // Airflow / pressure
    'Supply Air Flow', 'Return Air Flow', 'External Pressure Drop', 'Internal Static Pressure',
    'Total Static Pressure', 'Air Density • Altitude', 'Supply Width • Height', 'Length Overall', 'Weight',
    // Filters
    'Filter Class', 'Filter Energy Classification', 'Filter Name', 'Total Supply Filters Eff.',
    'Clean Pressure Drop', 'Medium Pressure Drop', 'Dirty Pressure Drop', 'Mounting', 'Air Velocity',
    // Fan
    'Fan Model', 'Type', 'Flexible', 'Quantity', 'Discharge Velocity', 'Rotation Speed Work • Max',
    'Efficiency (Reg327/2011)', 'Efficiency', 'Shaft Power', 'Electrical Power Input',
    'Power Class • PMREF  (EN13053)', 'SFPv Class • SFPv (EN13053)', 'Antivibration Mount',
    // Motor
    'Efficiency Class', 'Power • Nominal Current', 'Electrical Connection', 'Poles Number',
    'Thermal Protection', 'Brand',
    // Coil
    'Geometry • Rows', 'Frame', 'Tube Material • Thickness', 'Fin Material • Space', 'Header Material',
    'Connection Diam • Type • Side', 'Sensible Capacity', 'Total Capacity',
    'Temp. Dry Bulb In • Out', 'Temp. Wet Bulb In • Out', 'Relative Humidity In • Out',
    'Flow', 'Temperature In • Out', 'Fluid Velocity • Volume', 'Pressure Drop',
    // Damper
    'Pressure Drop', 'Material', 'Dimensions (HxW)', 'Torque',
    // Regulatory / sound
    'Sound Power Level (LWA)', 'Serial Number', 'Typology (NRVU, UVU or BVU)', 'Drive Type',
    'SFP Internal', 'Face Velocity at Flow Rate Design', 'Nominal Internal Pressure Drop',
    'Nominal External Pressure Drop', 'Summer Outdoor Conditions', 'Winter Outdoor Conditions',
    'Manufacturer\'s Name'
  ].sort(function (a, b) { return b.length - a.length; }); // longest label first: avoid "Panel" matching inside "Panel • Insulation"

  // escapeRegex() is defined earlier in this file (highlighting section) —
  // reused here for the same purpose: safely embedding literal text in a regex.

  // Whitespace-flexible label regexes, built once. PDF text extraction is
  // inconsistent about spacing around bullets/separators (e.g. "Panel  •
  // Insulation" vs "Panel • Insulation") — matching space-for-space missed
  // real fields, so each space in a label becomes \s+ in its regex.
  var DATASHEET_FIELD_RE = DATASHEET_FIELD_LABELS.map(function (label) {
    return { label: label, re: new RegExp('^' + escapeRegex(label).replace(/ /g, '\\s+') + '\\s+(.+)$', 'i') };
  });

  // A selection report is organised into the unit's own sections, numbered
  // like "1) Mixing Box Supply", "4) Coil Cooling DX Supply". Those headings
  // are the most valuable thing in the document and the extractor used to
  // throw them away.
  var UNIT_SECTION_RE = /^(\d{1,2})\)\s*([A-Z][A-Za-z0-9 ./&+-]{3,60})$/;
  // Sub-blocks inside a section ("Geometry", "Cooling", "Motor Data"). Worth
  // keeping distinct from the section itself but not worth listing as a
  // section of the unit.
  var SUB_BLOCK_RE = /^(Unit Data|Geometry|Cooling|Heating|Motor Data|Sound Report|Options List|Section List|Electrical Power Inputs Data)$/i;

  function normSection(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // The sections THIS unit actually has, in document order.
  function extractUnitSections(lines) {
    var out = [], seen = {};
    lines.forEach(function (raw) {
      var m = String(raw).trim().replace(/\s+/g, ' ').match(UNIT_SECTION_RE);
      if (!m) return;
      var name = m[2].trim();
      var key = normSection(name);
      if (!seen[key]) { seen[key] = true; out.push(name); }
    });
    return out.slice(0, 30);
  }

  // Fields, each tagged with the section of the unit it was found under.
  //
  // THE REASON THIS MATTERS: this datasheet contains "Tube Material •
  // Thickness: Copper • 0.4 mm" under the cooling coil. Without the section
  // prefix, a clause about CASING thickness can match that field on the word
  // "thickness" and be answered with the coil's tube gauge. The prefix makes
  // the two impossible to confuse — for the matcher and for the model.
  //
  // Deduplication is per section+label rather than per label, because the
  // same label legitimately recurs: nine sections here each have their own
  // Pressure Drop, and keeping only the first would silently discard eight.
  function extractSelectionFields(lines) {
    var fields = [];
    var seen = {};
    var section = '';
    lines.forEach(function (raw) {
      var line = raw.trim().replace(/\s+/g, ' ');
      if (!line || line.length > 160) return;

      var sec = line.match(UNIT_SECTION_RE);
      if (sec) { section = sec[2].trim(); return; }
      if (SUB_BLOCK_RE.test(line)) {
        // "Unit Data" is the whole machine, not a section of it.
        if (/^unit data$/i.test(line)) section = 'Unit';
        return;
      }

      for (var i = 0; i < DATASHEET_FIELD_RE.length; i++) {
        var m = line.match(DATASHEET_FIELD_RE[i].re);
        if (!m) continue;
        var label = DATASHEET_FIELD_RE[i].label;
        var value = m[1].trim();
        if (!value || DATASHEET_FIELD_LABELS.some(function (l) { return value.toLowerCase() === l.toLowerCase(); })) break;
        var full = section ? section + ' \u2022 ' + label : label;
        var key = full.toLowerCase();
        if (!seen[key]) { seen[key] = true; fields.push({ label: full, value: value }); }
        break;
      }
    });
    return fields.slice(0, 80); // bounded — keeps the AI payload small and fast
  }

  function handleSelectionFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setAiStatus('Selection datasheet must be a PDF.', 'error');
      return;
    }
    var product = productInput.value; // may be '' if not yet selected — AI extraction needs it
    setAiStatus('Reading selection datasheet…');
    extractPdfText(file, 15).then(function (lines) {
      var joined = lines.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length < 40) {
        setAiStatus('No selectable text in that PDF (scanned image?). Skip it, or try a text-based export.', 'error');
        return;
      }
      // Pass 1 (instant, free, client-side): the known-label dictionary.
      // Shown immediately so the datasheet isn't sitting blank while the
      // AI call runs.
      var patternFields = extractSelectionFields(lines);
      selectionFields = patternFields;
      // The unit's own section list travels with every AI request: it tells
      // the model which parts this machine actually has, and it is learned
      // into the product's section catalogue server-side.
      unitSections = extractUnitSections(lines);
      selectionText = joined.slice(0, 6000); // fallback for anything neither pass caught
      selectionName = file.name;
      selSlot.textContent = file.name + ' (' + patternFields.length + ' fields' +
        (unitSections.length ? ', ' + unitSections.length + ' unit sections' : '') + ')';
      setAiStatus('Selection datasheet loaded — checked first for matching values (e.g. panel thickness, filter class).', 'ok');
      // The datasheet is what unlocks AI, so the button state is re-evaluated
      // the moment Pass 1 lands — the user doesn't wait for the AI extraction.
      refreshAiButton();
      recordOffering();

      // Pass 2 (AI, one dedicated call): reads the whole datasheet with a
      // product-specific extraction prompt — far more general than the
      // fixed dictionary, since it isn't limited to labels anticipated in
      // advance. Only runs if a product is selected (needed to pick the
      // right prompt) and the account has AI access; degrades gracefully
      // to the Pass 1 result if it fails for any reason.
      if (!product || !aiEnabled) return;
      setAiStatus('Selection datasheet loaded — extracting fields with AI\u2026', 'ok');
      extractingDatasheet = true;
      refreshAiButton();
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, 25000);
      fetch('/api/compliance/extract-datasheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ product: product, text: joined.slice(0, 12000) })
      }).then(function (r) { clearTimeout(timeoutId); return safeJson(r); })
        .then(function (d) {
          if (d.error) throw new Error(d.error);
          var aiFields = Array.isArray(d.fields) ? d.fields : [];
          if (!aiFields.length) {
            setAiStatus('AI found no additional fields — using ' + patternFields.length +
              ' pattern-recognized field(s).', 'ok');
            return;
          }
          // Merge: AI fields take priority (more general/robust); pattern
          // fields fill in anything the AI didn't return, de-duplicated by
          // normalized label so the same field never appears twice.
          var seen = {};
          var merged = [];
          aiFields.forEach(function (f) {
            var key = String(f.label || '').trim().toLowerCase();
            if (!key || seen[key]) return;
            seen[key] = true;
            merged.push(f);
          });
          patternFields.forEach(function (f) {
            var key = String(f.label || '').trim().toLowerCase();
            if (!key || seen[key]) return;
            seen[key] = true;
            merged.push(f);
          });
          selectionFields = merged;
          selSlot.textContent = file.name + ' (' + merged.length + ' fields — ' +
            aiFields.length + ' from AI, ' + (merged.length - aiFields.length) + ' from patterns)';
          setAiStatus('Selection datasheet fully extracted — ' + merged.length +
            ' fields checked first for matching values.', 'ok');
        }).catch(function (err) {
          clearTimeout(timeoutId);
          console.error(err);
          // Pass 1 result already loaded above — AI failure just means we
          // keep the dictionary-extracted fields instead of the richer set.
          var msg = err.name === 'AbortError' ? 'AI extraction took too long (over 25s)' : (err.message || 'AI extraction failed');
          recordOffering();
          setAiStatus('Selection datasheet loaded — ' + patternFields.length + ' pattern-recognized field(s). ' +
            '(' + msg + ' — continuing with pattern matching only.)', 'ok');
        }).finally(function () {
          extractingDatasheet = false;
          // Restore the button to whatever state it would normally be in
          // (access + datasheet + blank rows) rather than blindly
          // re-enabling it. Single source of truth, so this and
          // renderPreview() can never disagree.
          refreshAiButton();
        });
    }).catch(function (err) {
      setAiStatus('Could not read the selection datasheet — ' + (err.message || 'error'), 'error');
    });
  }

  /* ------------------------------------------------------------------
     ANSWER LOG + CONFLICTS
     Every filled row is logged on download (fire-and-forget). Before
     that, the current answers are checked against the latest logged
     answers: a clause answered DIFFERENTLY before turns red so the
     ambiguity gets resolved and the Excel masters corrected.
     ------------------------------------------------------------------ */

  function answeredBodyRows(rows) {
    return rows.filter(function (r) {
      return (r.type === 'letter' || r.type === 'number' || r.type === 'text') &&
             !r.isHeading && (r.compliance || r.remarks);
    });
  }

  function checkConflicts(rows, product, factory) {
    var answered = answeredBodyRows(rows);
    if (!answered.length) return Promise.resolve(0);
    return fetch('/api/compliance/answer-log/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: product,
        factory: factory,
        items: answered.map(function (r) {
          return { spec: r.spec, compliance: r.compliance || '', remarks: r.remarks || '' };
        })
      })
    }).then(safeJson).then(function (d) {
      var n = 0;
      answered.forEach(function (r) { delete r.conflict; });
      Object.keys(d.conflicts || {}).forEach(function (k) {
        var row = answered[+k];
        if (row) { row.conflict = d.conflicts[k]; n++; }
      });
      return n;
    }).catch(function () { return 0; }); // log unavailable -> no conflicts shown
  }

  function logAnswers(rows, product, factory) {
    var answered = answeredBodyRows(rows);
    if (!answered.length) return;
    var payload = answered.map(function (r) {
      return {
        spec: r.spec, compliance: r.compliance || '', remarks: r.remarks || '',
        // The hierarchy path travels with the answer. The section rollup
        // groups on it, so an answer logged without one teaches nothing.
        path: r._path || r.path || '',
        source: r.auto ? (r.auto.type === 'exact' ? 'library-exact' :
                          r.auto.type === 'fuzzy' ? 'library-fuzzy' : r.auto.type) : ''
      };
    });
    for (var i = 0; i < payload.length; i += 400) {
      fetch('/api/compliance/answer-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: product, factory: factory, rows: payload.slice(i, i + 400) })
      }).catch(function () {});
    }
  }

  function exportAnswerLog() {
    var pf = requireProduct(setExportLogStatus);
    if (!pf || !window.XLSX) return;
    var product = pf.product, factory = pf.factory;
    setExportLogStatus('Exporting ' + product + ' (' + factory + ') answer log…');
    fetch('/api/compliance/answer-log?product=' + encodeURIComponent(product) + '&factory=' + encodeURIComponent(factory))
      .then(safeJson).then(function (d) {
        if (d.error) throw new Error(d.error);
        var rows = d.rows || [];
        if (!rows.length) { setExportLogStatus('Answer log is empty for ' + product + ' (' + factory + ') — nothing has been downloaded yet.', 'error'); return; }
        // Library-file column layout first, so a corrected export can BE the
        // new library file; extra columns are ignored by the library parser.
        var aoa = [['Specifications', 'Compliance', 'Remarks', 'Source', 'Last answered']]
          .concat(rows.map(function (r) {
            return [r.spec_text, r.compliance, r.remarks, r.source, r.created_at];
          }));
        var out = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(out, window.XLSX.utils.aoa_to_sheet(aoa), 'AnswerLog');
        window.XLSX.writeFile(out, product.replace(/ /g, '-') + '-' + factory + '-answer-log.xlsx');
        setExportLogStatus('Exported ' + rows.length + ' latest answers. Correct them offline, then ' +
          'upload the file above to make the corrections live.', 'ok');
      }).catch(function (err) {
        setExportLogStatus('Export failed — ' + (err.message || 'error'), 'error');
      });
  }

  function finishBuild(rows, product, factory, baseMsg) {
    currentRows = rows;
    annotateHierarchy(rows, product || '');

    // Signed out: parse + highlighting, and NOTHING ELSE. The By Contractor
    // scope rule is skipped deliberately even though it is pure local code
    // with no library behind it — it writes an ANSWER into Compliance and
    // Remarks, in the same yellow the library uses. A signed-out visitor was
    // told conversion and formatting only, so a filled cell here reads as a
    // pre-filled answer they cannot account for. Compliance stays empty.
    if (basicMode) {
      renderPreview(rows);
      setStatus(baseMsg + '.', 'ok');
      return;
    }

    setStatus('Matching against ' + product + ' (' + factory + ') library…');
    prefillFromLibrary(rows, product, factory).then(function (filled) {
      var ruled = applyScopeRules(rows);
      return checkConflicts(rows, product, factory).then(function (conf) {
        renderPreview(rows);
        setStatus(baseMsg + (filled ? ' · ' + filled + ' from library' : '') +
          (ruled ? ' · ' + ruled + ' By Contractor (scope rule)' : '') +
          (conf ? ' · ' + conf + ' CONFLICT with logged answers (red)' : '') + '.', 'ok');
      });
    }).catch(function (err) {
      console.error(err);
      var ruled = applyScopeRules(rows);
      renderPreview(rows);
      setStatus(baseMsg + '. Library unavailable (' + (err.message || 'load failed') +
        ') — ' + (ruled ? ruled + ' By Contractor rows marked by scope rule, rest blank.' : 'all cells left blank.'), 'ok');
    });
  }

  // Selecting a file only STORES it. Nothing is parsed until Convert.
  function selectFile(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setStatus('That is not a PDF. Please choose a .pdf file.', 'error');
      return;
    }
    pendingFile = file;
    currentName = file.name.replace(/\.pdf$/i, '') || 'compliance-matrix';
    showFileTag(file.name);
    setStatus('');
    refreshConvertState();
  }

  // Convert-triggered: read the stored PDF, parse, then finishBuild.
  function processPdf(product, factory) {
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
        var maxPages = Math.min(pdf.numPages, maxSpecPages);
        var allLines = [];

        function readPage(p) {
          if (p > maxPages) return Promise.resolve();
          setStatus('Reading page ' + p + ' of ' + maxPages + '…');
          return pdf.getPage(p)
            .then(function (page) { return page.getTextContent(); })
            .then(function (tc) {
              allLines = allLines.concat(extractLinesFromTextContent(tc));
              return new Promise(function (r) { setTimeout(r, 0); });
            })
            .then(function () { return readPage(p + 1); });
        }

        return readPage(1).then(function () {
          var joined = allLines.join('').trim();
          if (!joined) {
            setStatus('No selectable text found. This looks like a scanned PDF — OCR is not supported.', 'error');
            resultPanel.hidden = true;
            updateAiVisibility();
            setConverting(false);
            return;
          }
          setStatus('Building matrix…');
          var rows = parseLines(allLines);
          var note = pdf.numPages > maxSpecPages
            ? ' (first ' + maxSpecPages + ' of ' + pdf.numPages + ' pages' +
              (signedIn ? '' : ' — sign in for 50') + ')'
            : '';
          finishBuild(rows, product, factory, 'Done — ' + rows.length + ' rows' + note);
          setConverting(false);
        });
      }).catch(function (err) {
        console.error(err);
        setStatus('Could not read that PDF. It may be corrupted or password-protected.', 'error');
        setConverting(false);
      });
    };
    reader.onerror = function () { setStatus('Could not read the file.', 'error'); setConverting(false); };
    reader.readAsArrayBuffer(file);
  }

  // THE single entry point. Nothing above runs until this is clicked.
  function runConvert() {
    var product = '', factory = '';
    if (!basicMode) {
      var pf = requireProduct(setStatus);
      if (!pf) return;
      product = pf.product;
      factory = pf.factory;
    }
    if (activeSource === 'pdf') {
      if (!pendingFile) { setStatus('Choose a PDF first.', 'error'); return; }
      processPdf(product, factory);
    } else {
      var raw = pasteInput.value;
      if (!raw || !raw.trim()) { setStatus('Paste some specification text first.', 'error'); return; }
      // Pasted text has no pages to count, so the same limit is applied by
      // character budget instead — CHARS_PER_PAGE is a deliberate,
      // conservative stand-in for a spec page of body text.
      var cap = maxSpecPages * CHARS_PER_PAGE;
      var trimmed = '';
      if (raw.length > cap) {
        raw = raw.slice(0, cap);
        trimmed = ' (trimmed to the first ~' + maxSpecPages + ' pages of text' +
                  (signedIn ? '' : ' — sign in for 50') + ')';
      }
      currentName = 'compliance-matrix';
      setConverting(true);
      var rows = parseLines(raw.split(/\r\n|\r|\n/));
      finishBuild(rows, product, factory, 'Done — ' + rows.length + ' rows' + trimmed);
      setConverting(false);
    }
  }

  /* ======================================================================
     UI GLUE
     ====================================================================== */

  // Parses a fetch Response as JSON, but if the server returned something
  // else (an HTML error/timeout page — the classic "Unexpected token '<'"),
  // surfaces a message that names the actual HTTP status instead of a raw
  // JSON-parse error. Used everywhere a fetch response is read as JSON.
  function safeJson(r) {
    return r.text().then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('Server returned a non-JSON response (HTTP ' + r.status +
          '). This usually means a timeout or server error rather than a real answer — try again, or with fewer rows at once.');
      }
    });
  }

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
    currentRows = null;
    pendingFile = null;
    fileInput.value = '';
    fileSlot.innerHTML = '';
    previewBody.innerHTML = '';
    resultPanel.hidden = true;
    updateAiVisibility();
    btnDownload.disabled = true;
    setStatus('');
    setAiStatus('');
    refreshAiButton();
    refreshConvertState();
  }

  /* ---- Gating: product unlocks input; input enables Convert ---- */

  var basicMode = false;  // set true for convert-only users (no autofill)

  // Convert-only users have no product/factory step, so treat as "satisfied".
  // Full-mode users need BOTH selected — the pair together decides which
  // library file is used.
  function productChosen() {
    return basicMode || (!!productInput.value && !!(factoryInput && factoryInput.value));
  }

  function lockInput(locked) {
    if (basicMode) locked = false;  // never lock for convert-only users
    if (locked) inputRegion.setAttribute('data-locked', 'true');
    else inputRegion.removeAttribute('data-locked');
  }

  // Convert is enabled when there's something to convert (and, for autofill
  // users, a product is chosen).
  function refreshConvertState() {
    var hasInput = activeSource === 'pdf' ? !!pendingFile : !!pasteInput.value.trim();
    var ready = productChosen() && hasInput;
    btnConvert.disabled = !ready;
    if (!productChosen()) convertHint.textContent = 'Select a product and factory first.';
    else if (!ready) convertHint.textContent =
      activeSource === 'pdf' ? 'Choose a PDF, then Convert.' : 'Paste text, then Convert.';
    else convertHint.textContent = '';
  }

  var converting = false;
  function setConverting(on) {
    converting = on;
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
    panePdf.hidden = !pdf;
    paneText.hidden = pdf;
    // Switching source clears any staged input/results.
    pendingFile = null;
    fileInput.value = '';
    fileSlot.innerHTML = '';
    currentRows = null;
    resultPanel.hidden = true;
    updateAiVisibility();
    btnDownload.disabled = true;
    setStatus('');
    refreshConvertState();
  }
  tabPdf.addEventListener('click', function () { selectSource('pdf'); });
  tabText.addEventListener('click', function () { selectSource('text'); });

  dropzone.addEventListener('click', function () { if (inputAllowed()) fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && inputAllowed()) { e.preventDefault(); fileInput.click(); }
  });
  dropzone.addEventListener('dragover', function (e) {
    if (!inputAllowed()) return;
    e.preventDefault(); dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('is-dragover'); });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault(); dropzone.classList.remove('is-dragover');
    if (!inputAllowed()) return;
    if (e.dataTransfer.files && e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) selectFile(fileInput.files[0]);
  });
  pasteInput.addEventListener('input', refreshConvertState);

  // The Convert button — the ONLY thing that starts processing.
  btnConvert.addEventListener('click', runConvert);

  /* Product AND factory selection together unlock input + warm the library
     cache in the background (so Convert is instant later). */
  function onReadyStateChange() {
    lockInput(!productChosen());
    refreshConvertState();
    refreshDownloadButtons();
    if (productChosen()) {
      loadLibrary(productInput.value, factoryInput.value)
        .catch(function () { /* silent — Convert will surface issues */ });
    }
  }
  productInput.addEventListener('change', function () {
    // Repopulate Factory's options for the new product FIRST — a factory
    // valid for the previous product (e.g. "KSA" under AHU) must never
    // linger as a selectable/selected option under FCU, which only has
    // "China". This always clears any prior factory selection.
    populateFactoryOptions(productInput.value);
    onReadyStateChange();
  });
  if (factoryInput) factoryInput.addEventListener('change', onReadyStateChange);
  if (btnExportLog) btnExportLog.addEventListener('click', exportAnswerLog);
  refreshDownloadButtons();
  populateFactoryOptions(productInput.value); // initial state (empty until a product is picked)
  lockInput(!productChosen());   // initial state
  loadRules();                    // warm the highlight rules in the background

  /* Selection datasheet UI (only present for AI-enabled users) */
  if (btnSelPick) btnSelPick.addEventListener('click', function () { selInput.click(); });
  if (selInput) selInput.addEventListener('change', function () {
    if (selInput.files && selInput.files[0]) { handleSelectionFile(selInput.files[0]); selInput.value = ''; }
  });

  /* ------------------------------------------------------------------
     ADAPTIVE LAYOUT — two experiences from one page:
       'basic' (default): no product select, panels fused into one
         continuous card, input unlocked immediately. Pure conversion.
       'full' (admin-granted autofill access): product select shown and
         required, library/scope-rule/conflict pre-fill on Convert, and
         the selection-datasheet + AI extras.
     The tier comes from GET /api/compliance/access; the server independently
     enforces the same rule, so this is presentation, not permission.
     CSS keyed on body[data-mode] does the visual merging (see index.html).
     ------------------------------------------------------------------ */
  var appMode = '';           // '' until resolved, then 'basic' | 'full' (layout)
  var appTier = '';           // '' until resolved, then 'guest' | 'member' | 'pro'
  var signedIn = false;
  var maxSpecPages = 10;      // raised to 50 once the tier probe confirms sign-in
  var CHARS_PER_PAGE = 3000;  // paste-text equivalent of one specification page
  var aiEnabled = false;
  // True only while the Pass 2 (AI) datasheet extraction request is in
  // flight — disables the Suggest button so it can't be clicked against
  // incomplete/pattern-only fields, or race the two AI calls against
  // each other.
  var extractingDatasheet = false;
  if (btnAi) btnAi.addEventListener('click', runAiSuggest);

  function inputAllowed() { return productChosen(); }  // basic-aware via productChosen

  // info = { signedIn, tier, maxPages } from GET /api/compliance/access.
  // Two things are derived from it and they are NOT the same thing:
  //   appMode ('basic' | 'full')  — LAYOUT. Signed out means no product,
  //     no factory, panels fused. Any signed-in user gets the stepped one.
  //   appTier ('guest'|'member'|'pro') — CAPABILITY. Library and answer log
  //     need sign-in; the datasheet + AI extras need admin-granted access
  //     on top of it.
  /* ======================================================================
     TRAINING — submit a completed matrix
     ----------------------------------------------------------------------
     The re-upload path. The sheet parser here is extractEntriesFromSheet(),
     the same one the library loader uses, so any of our layouts is accepted:
     the exported matrix, the library template, or a hand-built sheet with
     Specifications / Compliance / Remarks columns.
     ====================================================================== */
  var canTrain = false;
  var trainPanel = document.getElementById('panel-train');
  var btnTrain = document.getElementById('btn-train');
  var trainInput = document.getElementById('train-input');
  var trainResult = document.getElementById('train-result');

  // Every datasheet read teaches the standard offering. Fire and forget:
  // this must never delay or block the person's actual work, and a failure
  // here costs nothing they can see.
  var offeringSent = '';
  function recordOffering() {
    var product = productInput.value;
    if (!product || !aiEnabled || !selectionFields.length) return;
    var sig = product + '|' + selectionFields.length + '|' + (selectionName || '');
    if (sig === offeringSent) return;   // don't record the same upload twice
    offeringSent = sig;
    fetch('/api/compliance/options', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'observe', product: product, fields: selectionFields })
    }).catch(function () { /* silent by design */ });
  }

  function setTrainStatus(msg, kind) {
    var el = document.getElementById('train-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' status--' + kind : '');
  }

  var btnExportLib = document.getElementById('btn-export-lib');
  var btnExportFb  = document.getElementById('btn-export-fb');
  var btnExportTree = document.getElementById('btn-export-tree');
  var btnExportOpts = document.getElementById('btn-export-opts');
  var btnImportOpts = document.getElementById('btn-import-opts');
  var optsInput = document.getElementById('opts-input');

  // All three downloads need a product AND factory, since each one is scoped
  // to that pair. Called whenever either selector changes.
  function refreshDownloadButtons() {
    var ok = canTrain && productChosen();
    if (btnExportLog) btnExportLog.disabled = !ok;
    if (btnExportLib) btnExportLib.disabled = !ok;
    if (btnExportFb) btnExportFb.disabled = !ok;
    // The tree is per product, so it needs no factory.
    if (btnExportTree) btnExportTree.disabled = !(canTrain && productInput.value);
    if (btnExportOpts) btnExportOpts.disabled = !(canTrain && productInput.value);
    if (btnImportOpts) btnImportOpts.disabled = !(canTrain && productInput.value);
  }

  // The library workbook, straight from the gated static path — no
  // rebuilding it client-side when the file itself is what's wanted.
  function downloadLibraryFile() {
    var pf = requireProduct(setExportLogStatus);
    if (!pf) return;
    var name = libFileName(pf.product, pf.factory);
    setExportLogStatus('Fetching ' + name + '…');
    fetch('/data/compliance-library/' + encodeURIComponent(name)).then(function (r) {
      if (!r.ok) throw new Error(r.status === 401 ? 'Sign in required.' :
        'No library file on the server for ' + pf.product + ' (' + pf.factory + ') yet.');
      return r.blob();
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      setExportLogStatus('Downloaded ' + name + '.', 'ok');
    }).catch(function (err) {
      setExportLogStatus('Download failed — ' + (err.message || 'error'), 'error');
    });
  }

  // What the AI proposed against what was shipped — the correction matrix,
  // as a plain data sheet.
  function exportCorrections() {
    var pf = requireProduct(setExportLogStatus);
    if (!pf || !window.XLSX) return;
    setExportLogStatus('Exporting corrections for ' + pf.product + ' (' + pf.factory + ')…');
    fetch('/api/compliance/ingest?product=' + encodeURIComponent(pf.product) +
          '&factory=' + encodeURIComponent(pf.factory))
      .then(safeJson).then(function (d) {
        if (d.error) throw new Error(d.error);
        var rows = d.rows || [];
        if (!rows.length) {
          setExportLogStatus('No corrections logged yet for ' + pf.product + ' (' + pf.factory + ').', 'error');
          return;
        }
        var aoa = [['Specifications', 'Section', 'AI status', 'AI remarks',
                    'Final status', 'Final remarks', 'Verdict', 'When']]
          .concat(rows.map(function (r) {
            return [r.spec_text, r.path, r.ai_status, r.ai_remarks,
                    r.final_status, r.final_remarks, r.verdict, r.created_at];
          }));
        var out = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(out, window.XLSX.utils.aoa_to_sheet(aoa), 'Corrections');
        window.XLSX.writeFile(out, pf.product.replace(/ /g, '-') + '-' + pf.factory + '-corrections.xlsx');
        setExportLogStatus('Exported ' + rows.length + ' row(s).', 'ok');
      }).catch(function (err) {
        setExportLogStatus('Export failed — ' + (err.message || 'error'), 'error');
      });
  }

  // Two sheets, because the tree has two sides that are read differently:
  // what a specification section is ASKING, and what the product HAS.
  function exportTree() {
    var product = productInput.value;
    if (!product) { setExportLogStatus('Select a product first.', 'error'); return; }
    if (!window.XLSX) return;
    setExportLogStatus('Exporting the ' + product + ' knowledge tree…');
    fetch('/api/compliance/tree?product=' + encodeURIComponent(product))
      .then(safeJson).then(function (d) {
        if (d.error) throw new Error(d.error);
        var topics = d.specTopics || [], sections = d.unitSections || [];
        if (!topics.length && !sections.length && !(d.criteria || []).length) {
          setExportLogStatus('Nothing learned for ' + product + ' yet — the tree fills in as ' +
            'completed matrices and datasheets come in.', 'error');
          return;
        }
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(
          [['Specification section', 'Kind', 'Notes', 'Confirmed answers', 'Status', 'Updated']]
            .concat(topics.map(function (t) {
              return [t.name, t.scope, t.notes, t.times_seen, t.status, t.updated_at];
            }))), 'Specification topics');
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(
          [['Unit section', 'Notes', 'Times seen', 'Status', 'Updated']]
            .concat(sections.map(function (u) {
              return [u.name, u.notes, u.times_seen, u.status, u.updated_at];
            }))), 'Unit sections');
        // How values are compared. Worth reviewing separately: a wrong
        // direction here turns a better unit into a Not Comply.
        var crit = d.criteria || [];
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(
          [['Criterion', 'Matches these words', 'Better when', 'Unit', 'Class scale (worst to best)', 'Notes', 'Source']]
            .concat(crit.map(function (c) {
              return [c.name, c.terms,
                c.direction === 'higher' ? 'higher' : c.direction === 'lower' ? 'lower' :
                c.direction === 'exact' ? 'must match exactly' : 'not established',
                c.unit, c.scale, c.notes, c.source];
            }))), 'Comparison rules');
        window.XLSX.writeFile(wb, product.replace(/ /g, '-') + '-knowledge-tree.xlsx');
        setExportLogStatus('Exported ' + topics.length + ' specification topic(s), ' +
          sections.length + ' unit section(s) and ' + crit.length + ' comparison rule(s). ' +
          'Edit anything wrong in the admin panel.', 'ok');
      }).catch(function (err) {
        setExportLogStatus('Export failed — ' + (err.message || 'error'), 'error');
      });
  }
  if (btnExportTree) btnExportTree.addEventListener('click', exportTree);

  /* ---- standard offering: export, edit in Excel, upload back -----------
     The sheet is deliberately shaped so the editing gesture is obvious:
     one row per field, the first value column is the default, the rest are
     options. Moving a value into the Default column is the whole edit — no
     status column to interpret, no flag to tick.                        */
  function exportOffering() {
    var product = productInput.value;
    if (!product || !window.XLSX) { setExportLogStatus('Select a product first.', 'error'); return; }
    setExportLogStatus('Exporting the ' + product + ' standard offering…');
    fetch('/api/compliance/options?product=' + encodeURIComponent(product))
      .then(safeJson).then(function (d) {
        if (d.error) throw new Error(d.error);
        var groups = d.fields || [];
        if (!groups.length) {
          setExportLogStatus('Nothing recorded for ' + product + ' yet — upload a datasheet and run ' +
            'AI review, and the values are collected automatically.', 'error');
          return;
        }
        var widest = groups.reduce(function (m, g) { return Math.max(m, g.values.length); }, 0);
        var head = ['Field', 'Default'];
        for (var i = 1; i < widest; i++) head.push('Option ' + i);
        head.push('Times seen');
        var aoa = [head].concat(groups.map(function (g) {
          var row = [g.field];
          g.values.forEach(function (v) { row.push(v.value); });
          while (row.length < widest + 1) row.push('');
          row.push(g.values.map(function (v) { return v.times_seen; }).join(' / '));
          return row;
        }));
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aoa), 'Standard offering');
        window.XLSX.writeFile(wb, product.replace(/ /g, '-') + '-standard-offering.xlsx');
        setExportLogStatus('Exported ' + groups.length + ' field(s). Move a value into the Default ' +
          'column and upload it back to change what the AI quotes.', 'ok');
      }).catch(function (err) {
        setExportLogStatus('Export failed — ' + (err.message || 'error'), 'error');
      });
  }

  function importOffering(file) {
    var product = productInput.value;
    if (!product || !window.XLSX) return;
    setExportLogStatus('Reading ' + file.name + '…');
    file.arrayBuffer().then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' });
      var aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
      var rows = [];
      aoa.forEach(function (r, i) {
        if (i === 0 || !r || !r[0]) return;                    // header
        if (/^field$/i.test(String(r[0]).trim())) return;
        var values = [];
        for (var c = 1; c < r.length; c++) {
          var cell = String(r[c] == null ? '' : r[c]).trim();
          // "Times seen" is informational and comes back as "3 / 1"; it is
          // not a value and must not become one.
          if (!cell || /^\d+(\s*\/\s*\d+)+$/.test(cell)) continue;
          values.push(cell);
        }
        if (values.length) rows.push({ field: String(r[0]).trim(), values: values });
      });
      if (!rows.length) throw new Error('No rows found — the first column must be the field name.');
      setExportLogStatus('Saving ' + rows.length + ' field(s)…');
      return fetch('/api/compliance/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'import', product: product, rows: rows })
      }).then(safeJson);
    }).then(function (d) {
      if (!d) return;
      if (d.error) throw new Error(d.error);
      setExportLogStatus('Saved — ' + d.defaults + ' default(s) and ' + d.options +
        ' option(s). These are what the AI quotes when no datasheet is attached.', 'ok');
    }).catch(function (err) {
      setExportLogStatus('Upload failed — ' + (err.message || 'could not read that file'), 'error');
    });
  }

  if (btnExportOpts) btnExportOpts.addEventListener('click', exportOffering);
  if (btnImportOpts && optsInput) {
    btnImportOpts.addEventListener('click', function () { optsInput.click(); });
    optsInput.addEventListener('change', function () {
      var f = optsInput.files && optsInput.files[0];
      if (f) importOffering(f);
      optsInput.value = '';
    });
  }


  if (btnExportLib) btnExportLib.addEventListener('click', downloadLibraryFile);
  if (btnExportFb) btnExportFb.addEventListener('click', exportCorrections);

  if (btnTrain && trainInput) {
    btnTrain.addEventListener('click', function () { trainInput.click(); });
    trainInput.addEventListener('change', function () {
      var f = trainInput.files && trainInput.files[0];
      if (f) submitCompleted(f);
      trainInput.value = '';
    });
  }

  function submitCompleted(file) {
    var pf = requireProduct(setTrainStatus);
    if (!pf) return;
    if (!window.XLSX) {
      setTrainStatus('Spreadsheet reader failed to load. Refresh and try again.', 'error');
      return;
    }
    if (trainResult) trainResult.hidden = true;
    setTrainStatus('Reading ' + file.name + '…');
    btnTrain.disabled = true;

    file.arrayBuffer().then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' });
      var entries = [];
      wb.SheetNames.forEach(function (name) {
        var aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false });
        entries = entries.concat(extractEntriesFromSheet(aoa).entries);
      });
      if (!entries.length) {
        throw new Error('No answered rows found in ' + file.name +
          ' — the sheet needs Specifications, Compliance and Remarks columns with answers filled in.');
      }
      setTrainStatus('Submitting ' + entries.length + ' answered row(s)…');
      return fetch('/api/compliance/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: pf.product, factory: pf.factory, rows: entries })
      }).then(safeJson);
    }).then(function (d) {
      if (d.error) throw new Error(d.error);
      setTrainStatus('Saved — these answers now pre-fill for everyone.', 'ok');
      if (trainResult) {
        trainResult.hidden = false;
        // Corrections are the interesting number, so they lead. Accepted
        // rows confirm the AI; new rows are clauses it never saw.
        trainResult.innerHTML =
          '<div class="legend">' +
          '<span class="chip">' + d.corrected + ' corrected</span>' +
          '<span class="chip">' + d.accepted + ' kept as suggested</span>' +
          '<span class="chip">' + d['new'] + ' new clause(s)</span>' +
          (d.sections ? '<span class="chip">' + d.sections + ' section profile(s) updated</span>' : '') +
          '</div>';
      }
    }).catch(function (err) {
      setTrainStatus(err.message || 'Could not read that file.', 'error');
    }).then(function () { btnTrain.disabled = false; });
  }

  function applyTier(info) {
    signedIn = !!(info && info.signedIn);
    appTier = (info && info.tier) || 'guest';
    maxSpecPages = (info && info.maxPages) || (signedIn ? 50 : 10);
    appMode = signedIn ? 'full' : 'basic';
    basicMode = !signedIn;      // library / conflicts / answer log are sign-in gated
    aiEnabled = (appTier === 'pro');

    document.body.setAttribute('data-mode', appMode);
    document.body.setAttribute('data-tier', appTier);
    // Teaching is its own grant, checked independently of the AI tier — an
    // account can have one without the other.
    canTrain = !!(info && info.canTrain);
    if (trainPanel) trainPanel.hidden = !canTrain;
    refreshDownloadButtons();
    updateAiVisibility();

    if (signedIn) {
      lockInput(!productChosen());
    } else {
      var t = document.getElementById('title-input');
      if (t) t.textContent = 'Add your specification';
      lockInput(false);
    }
    setPageLimitNote();
    refreshConvertState();
  }

  // One line of copy, driven by the tier rather than hardcoded per state,
  // so the number shown can never drift from the number enforced above.
  function setPageLimitNote() {
    var el = document.getElementById('page-limit-note');
    if (!el) return;
    el.textContent = signedIn
      ? 'Signed in — up to ' + maxSpecPages + ' pages per specification.'
      : 'Free — up to ' + maxSpecPages + ' pages per specification. Sign in for ' +
        '50 pages, library pre-fill and your answer log.';
  }

  fetch('/api/compliance/access').then(safeJson).then(function (d) {
    applyTier(d && d.tier ? d : { signedIn: false, tier: 'guest', maxPages: 10 });
  }).catch(function () {
    // Probe failed (offline, function error). Fall back to the free tier —
    // conversion still works entirely in the browser.
    applyTier({ signedIn: false, tier: 'guest', maxPages: 10 });
  });

  [dictEl, hlNumbers, hlCaps, dbRulesOn].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', function () { if (currentRows) renderPreview(currentRows); });
    el.addEventListener('change', function () { if (currentRows) renderPreview(currentRows); });
  });

  btnClear.addEventListener('click', clearAll);
  btnDownload.addEventListener('click', function () {
    if (!currentRows) return;
    var re = buildHighlighter();
    var blob = window.xlsxWriter.build(currentRows, re, splitRuns, {
      bandText: productInput.value ? 'Product : ' + productInput.value : ''
    });
    downloadBlob(blob, currentName + '.xlsx');
    // Feedback loop: record what was answered (non-blocking).
    var p = productInput.value;
    var f = factoryInput ? factoryInput.value : '';
    if (p && f) logAnswers(currentRows, p, f);
  });

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
})();
