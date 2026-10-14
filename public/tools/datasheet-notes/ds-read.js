/* ============================================================
   Datasheet Notes - open a datasheet PDF in the browser.
   DSRead.file(file, onProgress)   -> Promise of [unit, ...]: one entry per unit in the PDF (DSParse.parseAll)
   DSRead.files(list, onProgress, productId, stopped)
                                   -> the same for several PDFs, units in the order of the files.
                                      A file that cannot be read (or is for another product) does not
                                      stop the others: the array carries .failed = [message, ...] and
                                      .names = [the files that were read]. Rejects only when no file
                                      could be read. stopped() true = the user pressed Cancel.
   onProgress(fileName, pageDone, pageCount) is called after every page, so the page can show
   where it is on a long PDF (an FCU schedule can hold more than a thousand units, one per page).
   Rejects with an Error whose message can be shown to the user as it is.
   Needs assets/vendor/pdfjs/pdf.min.js, ds-parse.js and the readers (ds-fcu.js) loaded first.
   ============================================================ */
(function () {
  'use strict';
  var MAX_MB = 60, CANCELLED = 'cancelled';
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../../assets/vendor/pdfjs/pdf.worker.min.js';

  function readerNames() {
    var r = window.DSParse.readers;
    return Object.keys(r).map(function (k) { return r[k].name; }).join(' or the ');
  }

  function file(f, onProgress) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return Promise.reject(new Error('"' + f.name + '" is not a PDF. Choose the datasheet PDF.'));
    if (f.size > MAX_MB * 1024 * 1024) return Promise.reject(new Error('"' + f.name + '" is larger than ' + MAX_MB + ' MB.'));
    if (!window.pdfjsLib) return Promise.reject(new Error('The PDF reader did not load. Refresh the page and try again.'));

    return f.arrayBuffer().then(function (buf) {
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (pdf) {
      var pages = [], chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) (function (n) {
        chain = chain.then(function () { return pdf.getPage(n); })
          .then(function (page) { return page.getTextContent().then(function (tc) { pages.push(window.DSParse.lines(tc.items, n)); page.cleanup(); }); })
          .then(function () { if (onProgress && onProgress(f.name, n, pdf.numPages) === false) throw new Error(CANCELLED); });
      })(n);
      return chain.then(function () { pdf.cleanup(); return pages; });
    }).then(function (pages) {
      if (!pages.reduce(function (s, p) { return s + p.length; }, 0)) {
        throw new Error('"' + f.name + '" has no text to read. It looks like a scan. Export the datasheet from the selection software as PDF.');
      }
      var units = window.DSParse.parseAll(pages).filter(function (d) { return d.unit.rows.length || d.sections.length; });
      if (!units.length) {
        throw new Error('No datasheet was found in "' + f.name + '". This tool reads the ' + readerNames() + '.');
      }
      return units;
    }, function (err) {
      var msg = (err && err.message) || '';
      throw new Error(err && err.name === 'PasswordException' ? '"' + f.name + '" is password protected. Remove the password and try again.'
        : err && err.name === 'InvalidPDFException' ? '"' + f.name + '" could not be opened as a PDF.'
        : msg === CANCELLED || msg.indexOf('"' + f.name + '"') >= 0 ? msg         // already names the file
        : '"' + f.name + '" could not be read' + (msg ? ': ' + msg : '.'));
    });
  }

  function files(list, onProgress, productId, stopped) {
    var all = [], failed = [], names = [], chain = Promise.resolve();
    function halt() { if (stopped && stopped()) throw new Error(CANCELLED); }
    [].forEach.call(list, function (f) {
      chain = chain.then(function () {
        halt();
        return file(f, onProgress).then(function (u) {
          if (productId) check(u, productId, f.name);
          all = all.concat(u); names.push(f.name);
        }, function (err) { halt(); if (err.message === CANCELLED) throw err; failed.push(err.message); })
          .then(null, function (err) { if (err.message === CANCELLED) throw err; failed.push(err.message); });
      });
    });
    return chain.then(function () {
      if (!all.length) throw new Error(failed.length === 1 ? failed[0] : 'None of the ' + failed.length + ' files could be read. ' + failed.join(' '));
      all.failed = failed; all.names = names;
      return all;
    });
  }

  /* "an AHU", "an FCU", "a CHILLER": the product ids are read letter by letter when they are short. */
  function withArticle(id) {
    var up = String(id).toUpperCase();
    return (up.length <= 4 ? /^[AEFHILMNORSX]/ : /^[AEIOU]/).test(up) ? 'an ' + up : 'a ' + up;
  }

  /* The datasheet must belong to the chosen product: an FCU report run as AHU would be mapped under
     the wrong product. Throws an Error with a message for the user. */
  function check(units, productId, fileName) {
    var id = String(productId || '').toLowerCase();
    var other = units.filter(function (u) { return u.type && u.type !== id; })[0];
    if (!other) return units;
    var r = window.DSParse.readers[other.type];
    throw new Error((fileName ? '"' + fileName + '" is ' : '"' + (other.hdr.unit || 'This unit') + '" is on ') + withArticle(other.type) + ' datasheet (' + (r ? r.name : other.type) +
                    '). Choose ' + other.type.toUpperCase() + ' as the product, or choose ' + withArticle(id) + ' datasheet.');
  }

  function progress(status, stopped) {       // returning false stops the reading (Cancel)
    return function (name, done, total) {
      if (stopped && stopped()) return false;
      if (total > 20 && (done === total || done % 10 === 0)) status('Reading ' + name + ': page ' + done + ' of ' + total + '\u2026');
    };
  }

  window.DSRead = { file: file, files: files, check: check, progress: progress, CANCELLED: CANCELLED };
})();
