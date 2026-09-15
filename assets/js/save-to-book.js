/**
 * Save text to the Education library.
 * =============================================================================
 * The Web Text Extractor grew this flow first. The Text Cleaner needs exactly
 * the same thing, and the same thing is worth writing once: the slug rules, the
 * Latin-1 header encoding, the parse-before-upload check and the replace
 * warning are each a detail that is wrong in a subtly different way when a
 * second copy drifts from the first.
 *
 * Usage:
 *
 *   TNSaveBook.mount({
 *     panel:    document.getElementById('save-book'),
 *     trigger:  document.getElementById('btn-save-book'),
 *     titleInput: document.getElementById('book-title'),
 *     status:   document.getElementById('book-status'),
 *     saveButton: document.getElementById('btn-book-save'),
 *     getText:  function () { return currentText(); },
 *     getTitle: function () { return suggestedTitle; },
 *     getDescription: function () { return 'Cleaned from a pasted document'; },
 *   });
 *
 * Only an admin can add a book, so the caller decides whether to reveal the
 * trigger at all — this module does not guess at permissions.
 */
(function (global) {
  'use strict';

  var ebookPromise = null;
  var shelfSlugs = null;

  /* The reader's own parser, loaded on demand. A file is parsed here, before
     it is sent, so text the reader could not open is caught now rather than
     after it is sitting in the bucket. */
  function loadEbook() {
    if (global.TNEbook) return Promise.resolve(global.TNEbook);
    if (ebookPromise) return ebookPromise;
    ebookPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/js/ebook.js?v=2';
      s.onload = function () {
        global.TNEbook ? resolve(global.TNEbook) : reject(new Error('The book reader did not load.'));
      };
      s.onerror = function () {
        ebookPromise = null;
        reject(new Error('Could not load the book reader. Check your connection.'));
      };
      document.head.appendChild(s);
    });
    return ebookPromise;
  }

  /* Loaded once, and only to warn before replacing a book of the same name.
     A failure here is silent on purpose: the warning is a courtesy, and losing
     it must not stop someone saving. */
  function loadShelf() {
    if (shelfSlugs !== null) return;
    shelfSlugs = [];
    fetch('/api/education/library', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        shelfSlugs = (d && d.books ? d.books : []).map(function (b) { return b.slug; });
      })
      .catch(function () { /* courtesy only */ });
  }

  function mount(cfg) {
    var panel = cfg.panel;
    var trigger = cfg.trigger;
    var titleInput = cfg.titleInput;
    var saveButton = cfg.saveButton;
    var cancelButton = cfg.cancelButton;

    function status(msg, kind, html) {
      if (!cfg.status) return;
      cfg.status.className = 'status' + (kind ? ' status--' + kind : '');
      if (html) cfg.status.innerHTML = html;
      else cfg.status.textContent = msg || '';
    }

    function toggle(open) {
      panel.hidden = !open;
      if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) return;

      if (!titleInput.value.trim() && cfg.getTitle) titleInput.value = cfg.getTitle() || '';
      status('');
      titleInput.focus();
      titleInput.select();
      loadShelf();
    }

    function open() {
      if (!String(cfg.getText() || '').trim()) {
        status('There is nothing to save yet.', 'error');
        return;
      }
      toggle(panel.hidden);
    }

    function save() {
      var body = String(cfg.getText() || '');
      if (!body.trim()) { status('Nothing to save yet.', 'error'); return; }

      var title = titleInput.value.trim();
      if (!title) {
        status('Give it a name first.', 'error');
        titleInput.focus();
        return;
      }

      saveButton.disabled = true;
      var label = saveButton.textContent;
      saveButton.textContent = 'Saving\u2026';
      status('Preparing the file\u2026');

      loadEbook().then(function (TNEbook) {
        var slug = TNEbook.slugify(title);
        if (!slug) throw new Error('That name makes no usable web address. Use some letters or numbers.');

        // Without a "# " line the reader titles the chapter with the opening
        // sentence, so the name typed above goes in as the heading instead.
        var text = body;
        if (!/^\s*#\s+\S/.test(text)) text = '# ' + title + '\n\n' + text;

        var footer = cfg.getFooter ? cfg.getFooter() : '';
        if (footer) text += '\n\n' + footer;

        var bytes = new TextEncoder().encode(text);

        return TNEbook.read(bytes.buffer, slug + '.txt').then(function (book) {
          if (!book.chapters.length) throw new Error('That text had nothing the reader could open.');

          if (shelfSlugs && shelfSlugs.indexOf(slug) > -1 &&
              !confirm('A book called "' + title + '" is already on the shelf. Replace it?')) {
            var stop = new Error('Cancelled.');
            stop.quiet = true;
            throw stop;
          }

          status('Saving \u201C' + title + '\u201D\u2026');
          return fetch('/api/education/upload', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/octet-stream',
              // R2 metadata travels in HTTP headers, which are Latin-1 only.
              // A title with an em dash is not. Both sides encode.
              'X-Book-Filename': slug + '.txt',
              'X-Book-Slug': slug,
              'X-Book-Title': encodeURIComponent(title),
              'X-Book-Description': encodeURIComponent(cfg.getDescription ? (cfg.getDescription() || '') : ''),
              'X-Book-Author': encodeURIComponent(cfg.getAuthor ? (cfg.getAuthor() || '') : ''),
              'X-Book-Collection': encodeURIComponent(cfg.getCollection ? (cfg.getCollection() || '') : ''),
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
        status('', 'ok',
          (done.out.replaced ? 'Replaced' : 'Saved') + ' \u201C' + esc(done.title) + '\u201D. ' +
          '<a href="/read/' + encodeURIComponent(done.slug) + '">Open it in the reader</a>');
        if (global.TN && global.TN.toast) {
          global.TN.toast(done.out.replaced ? 'Book replaced' : 'Book saved', 'success');
        }
        if (cfg.onSaved) cfg.onSaved(done);
      }).catch(function (err) {
        if (err && err.quiet) status('Left as it was.');
        else status(err && err.message ? err.message : 'That could not be saved.', 'error');
      }).then(function () {
        saveButton.disabled = false;
        saveButton.textContent = label;
      });
    }

    if (trigger) trigger.addEventListener('click', open);
    if (saveButton) saveButton.addEventListener('click', save);
    if (cancelButton) cancelButton.addEventListener('click', function () { toggle(false); });

    return { open: open, close: function () { toggle(false); }, save: save };
  }

  function esc(s) {
    if (global.TN && global.TN.esc) return global.TN.esc(s);
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  global.TNSaveBook = { mount: mount, loadEbook: loadEbook };
})(window);
