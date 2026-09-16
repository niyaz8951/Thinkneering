/* Web Text Extractor — page logic.
   The extraction itself lives in /functions/_lib/extract/, behind /api/extract,
   so this file only asks for a result and shows it. Same shape as the Text
   Cleaner: plain functions, no framework, no build step. */

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var last = null;         // the last successful API result
  var view = 'text';       // 'text' | 'markdown'
  var method = 'auto';
  var busy = false;

  // ------------------------------------------------------------ disclosures
  /* Copied from the Text Cleaner. Second use of the pattern — worth promoting
     into global.js rather than a third copy. */
  function initDisclosures() {
    var buttons = document.querySelectorAll('[data-disclosure]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        var body = document.getElementById(btn.getAttribute('aria-controls'));
        if (body) body.hidden = open;
      });
    });
  }

  function openPanel(controls) {
    var btn = document.querySelector('[aria-controls="' + controls + '"]');
    if (!btn || btn.getAttribute('aria-expanded') === 'true') return;
    btn.click();
  }

  // ------------------------------------------------------------ status lines
  function setStatus(msg, kind) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' status--' + kind : '');
  }

  function bookStatus(msg, kind, html) {
    var el = $('book-status');
    el.className = 'status' + (kind ? ' status--' + kind : '');
    if (html) el.innerHTML = html; else el.textContent = msg || '';
  }

  // ------------------------------------------------------------ segmented sets
  function initSegmented(groupId, onPick) {
    var group = $(groupId);
    group.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn || !group.contains(btn)) return;
      Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      onPick(btn);
    });
  }

  var METHOD_HINTS = {
    auto: 'Automatic reads the plain HTML and only reaches for a browser if the page comes back empty.',
    static: 'Plain HTML is fastest and works for most articles, documentation and news pages.',
    render: 'Browser render is for pages that build themselves with JavaScript. It needs a renderer to be connected.'
  };

  // ------------------------------------------------------------ extraction
  function currentText() {
    return $('output').value;
  }

  function extract(forcedMethod) {
    if (busy) return;

    var url = $('url').value.trim();
    if (!url) { setStatus('Put a web address in first.', 'error'); $('url').focus(); return; }
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      $('url').value = url;
    }

    var use = forcedMethod || method;
    busy = true;
    $('btn-extract').disabled = true;
    $('btn-extract').textContent = 'Reading\u2026';
    setStatus('Fetching the page\u2026', 'busy');
    $('meta-source').textContent = '';

    fetch('/api/extract', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, method: use })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (out) {
        if (!res.ok || !out.ok) {
          throw new Error(out.error || 'That page could not be read (' + res.status + ').');
        }
        return out;
      });
    }).then(function (out) {
      last = out;
      render(out);
      setStatus('Read ' + out.counts.words.toLocaleString() + ' words from ' +
                hostOf(out.finalUrl) + '.', 'ok');
    }).catch(function (err) {
      last = null;
      resetResult();
      setStatus(err && err.message ? err.message : 'That page could not be read.', 'error');
    }).then(function () {
      busy = false;
      $('btn-extract').disabled = false;
      $('btn-extract').textContent = 'Extract text';
    });
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return 'the page'; }
  }

  // ------------------------------------------------------------ rendering
  function resetResult() {
    $('summary').hidden = true;
    $('warnings').innerHTML = '';
    $('output').value = '';
    $('meta-result').textContent = '';
    $('meta-details').textContent = '';
    $('btn-copy').disabled = true;
    $('btn-download').disabled = true;
    $('btn-save-book').disabled = true;
    $('btn-original').hidden = true;
    $('details-body').hidden = true;
    $('details-empty').hidden = false;
    toggleSaveBook(false);
  }

  function render(out) {
    $('output').value = view === 'markdown' ? out.markdown : out.text;

    // --- summary + confidence meter
    var pct = Math.round(out.extraction.confidence * 100);
    var fill = $('meter-fill');
    fill.style.width = pct + '%';
    fill.className = 'meter__fill' + (pct < 45 ? ' is-low' : pct < 70 ? ' is-mid' : '');
    $('summary-text').textContent =
      pct + '% confidence \u00B7 ' + out.counts.words.toLocaleString() + ' words \u00B7 ' +
      out.counts.paragraphs + ' paragraphs \u00B7 ' + out.counts.headings + ' headings \u00B7 ' +
      out.counts.tables + ' tables';
    $('summary').hidden = false;

    // --- warnings
    var box = $('warnings');
    box.innerHTML = '';
    (out.warnings || []).forEach(function (w) {
      var cls = w.level === 'error' ? 'notice notice--danger'
              : w.level === 'warning' ? 'notice notice--warning' : 'notice';
      var el = document.createElement('div');
      el.className = cls;
      el.innerHTML = TN.icon(w.level === 'info' ? 'activity' : 'eye', 18) +
                     '<div>' + TN.esc(w.message) + '</div>';
      box.appendChild(el);
    });

    // --- headers on the collapsed panels
    $('meta-source').textContent = hostOf(out.finalUrl);
    $('meta-result').textContent = out.counts.words.toLocaleString() + ' words';
    $('meta-details').textContent = out.extraction.renderer === 'browser-render' ? 'rendered' : 'plain HTML';

    // --- buttons
    var has = !!currentText().trim();
    $('btn-copy').disabled = !has;
    $('btn-download').disabled = !has;
    $('btn-save-book').disabled = !has;
    var link = $('btn-original');
    link.href = out.finalUrl;
    link.hidden = false;

    renderDetails(out);
    openPanel('panel-result');
  }

  function renderDetails(out) {
    $('details-empty').hidden = true;
    $('details-body').hidden = false;

    var facts = [
      ['Title', out.title],
      ['Author', out.author],
      ['Published', out.publishedAt ? out.publishedAt.slice(0, 10) : ''],
      ['Updated', out.modifiedAt ? out.modifiedAt.slice(0, 10) : ''],
      ['Language', out.language],
      ['Site', out.siteName],
      ['Source', out.finalUrl],
      ['Read as', out.extraction.renderer === 'browser-render' ? 'Browser render' : 'Plain HTML'],
      ['Content found in', out.extraction.container],
      ['Method', out.extraction.method],
      ['Link density', out.extraction.linkDensity === null ? '' : Math.round(out.extraction.linkDensity * 100) + '%'],
      ['Lists / tables', out.counts.lists + ' / ' + out.counts.tables]
    ];

    $('facts').innerHTML = facts.filter(function (f) { return f[1]; }).map(function (f) {
      return '<dt>' + TN.esc(f[0]) + '</dt><dd>' + TN.esc(String(f[1])) + '</dd>';
    }).join('');

    var outline = out.headings || [];
    $('outline').innerHTML = outline.map(function (h) {
      return '<li><span class="lvl">H' + h.level + '</span>' + TN.esc(h.text) + '</li>';
    }).join('');
    $('outline-empty').hidden = outline.length > 0;

    var images = out.images || [];
    $('images').innerHTML = images.map(function (im) {
      return '<li>' + TN.esc(im.caption || im.alt) + '</li>';
    }).join('');
    $('images-empty').hidden = images.length > 0;
  }

  // ------------------------------------------------------------ output actions
  function copyOut() {
    var text = currentText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      TN.toast('Copied', 'success');
    }).catch(function () {
      setStatus('The browser refused clipboard access. Select the text and copy it by hand.', 'error');
    });
  }

  function fileBase() {
    if (last && last.title) {
      var slug = last.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (slug) return slug.slice(0, 60);
    }
    return last ? hostOf(last.finalUrl).replace(/\./g, '-') : 'extracted';
  }

  function download() {
    var text = currentText();
    if (!text) return;
    var ext = view === 'markdown' ? '.md' : '.txt';
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileBase() + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ------------------------------------------------------------ save to books
  /* Books live in the R2 bucket behind /api/education/upload. A .txt body is
     accepted and the reader treats a "# " line as the start of a chapter,
     which is exactly what the Markdown view already produces. */

  var ebookPromise = null;
  var shelfSlugs = null;

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

  function toggleSaveBook(open) {
    var boxEl = $('save-book');
    var btn = $('btn-save-book');
    boxEl.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;

    if (!$('book-title').value.trim()) {
      $('book-title').value = (last && last.title) ? last.title : '';
    }
    bookStatus('');
    $('book-title').focus();
    $('book-title').select();

    // Loaded once, only to warn before replacing a book of the same name.
    if (shelfSlugs === null) {
      shelfSlugs = [];
      fetch('/api/education/library', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          shelfSlugs = (d && d.books ? d.books : []).map(function (b) { return b.slug; });
        })
        .catch(function () { /* the warning is a nicety, not a requirement */ });
    }
  }

  function openSaveBook() {
    if (!currentText().trim()) { setStatus('Extract something first.', 'error'); return; }
    toggleSaveBook($('save-book').hidden);
  }

  function saveBook() {
    var body = currentText();
    if (!body.trim()) { bookStatus('Nothing to save yet.', 'error'); return; }

    var title = $('book-title').value.trim();
    if (!title) { bookStatus('Give it a name first.', 'error'); $('book-title').focus(); return; }

    var btn = $('btn-book-save');
    btn.disabled = true;
    btn.textContent = 'Saving\u2026';
    bookStatus('Preparing the file\u2026');

    loadEbook().then(function (TNEbook) {
      var slug = TNEbook.slugify(title);
      if (!slug) throw new Error('That name makes no usable web address. Use some letters or numbers.');

      // Without a "# " line the chapter would be titled with the opening
      // sentence, so the name you typed goes in as the heading. The source
      // address is kept with the text: an extract is worth nothing if you
      // cannot get back to where it came from.
      var text = body;
      if (!/^\s*#\s+\S/.test(text)) text = '# ' + title + '\n\n' + text;
      if (last && last.finalUrl) text += '\n\nSource: ' + last.finalUrl;

      var bytes = new TextEncoder().encode(text);

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
            // Headers are Latin-1; a title with an em dash is not. Both sides
            // encode, the same way the Education page does it.
            'X-Book-Filename': slug + '.txt',
            'X-Book-Slug': slug,
            'X-Book-Title': encodeURIComponent(title),
            'X-Book-Description': encodeURIComponent(last && last.finalUrl ? 'Extracted from ' + last.finalUrl : ''),
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

  // ------------------------------------------------------------ wiring
  function clearAll() {
    $('url').value = '';
    last = null;
    resetResult();
    setStatus('');
    $('meta-source').textContent = '';
    $('url').focus();
  }

  function init() {
    initDisclosures();
    initSaveBook();

    initSegmented('methods', function (btn) {
      method = btn.getAttribute('data-method');
      $('method-hint').textContent = METHOD_HINTS[method];
    });

    initSegmented('views', function (btn) {
      view = btn.getAttribute('data-view');
      if (last) $('output').value = view === 'markdown' ? last.markdown : last.text;
    });

    $('btn-extract').addEventListener('click', function () { extract(); });
    $('btn-clear').addEventListener('click', clearAll);
    $('btn-copy').addEventListener('click', copyOut);
    $('btn-download').addEventListener('click', download);

    $('url').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); extract(); }
    });

    $('output').addEventListener('input', function () {
      var has = !!currentText().trim();
      $('btn-copy').disabled = !has;
      $('btn-download').disabled = !has;
      $('btn-save-book').disabled = !has;
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-rerun]'), function (btn) {
      btn.addEventListener('click', function () {
        extract(btn.getAttribute('data-rerun'));
      });
    });

    // A page can be opened straight into the tool: /tools/web-text-extractor/?url=…
    var preset = new URL(location.href).searchParams.get('url');
    if (preset) {
      $('url').value = preset;
      extract();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
