/* Thinkneering — AI Dictionary overlay (TN-11)
 *
 * Select up to four words inside any [data-dict-scope] container and a
 * "Define" chip appears. Nothing opens automatically, so copying text
 * still behaves normally.
 *
 * Markup contract:
 *   <article data-dict-scope data-dict-domain="english"> ... </article>
 *   Opt an element out with data-dict="off".
 */
(function () {
  'use strict';

  var MAX_WORDS = 4;
  var MAX_CHARS = 48;
  var SKIP_TAGS = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'CODE', 'PRE', 'SCRIPT', 'STYLE'];

  // A phone hands a long press to the operating system: the Copy / Share /
  // Select all bar opens over the text and any chip of ours is buried under
  // it. So touch gets a different gesture entirely — tap a word, get the
  // word — and the selection chip is left to mouse users.
  var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var WORD_CHAR = /[\p{L}\p{N}'\u2019-]/u;
  var TAP_SLOP = 12;      // px of drift still counted as a tap, not a scroll
  var TAP_TIME = 500;     // ms beyond which it is a long press, not a tap
  var touchStart = null;
  var openedAt = 0;

  var cache = new Map();
  var chip = null;
  var backdrop = null;
  var panel = null;
  var lastFocused = null;
  var current = null;
  var pending = 0;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    // No scope check here on purpose. The reader builds its chapter markup
    // after load, so a scope that is absent now may exist a second later.
    // Every selection is scope-checked at the moment it happens instead.
    buildChip();
    buildPanel();

    document.addEventListener('mouseup', onSelectionChange);

    if (isTouch) {
      document.addEventListener('touchstart', onTouchStart, { passive: true });
      // Not passive: a handled word tap calls preventDefault() to stop the
      // browser synthesising a click a moment later. That click would land on
      // the backdrop, which by then covers the screen, and shut the panel
      // instantly — the definition appearing and vanishing in one flash.
      document.addEventListener('touchend', onTouchEnd, { passive: false });
    } else {
      document.addEventListener('touchend', onSelectionChange);
    }
    document.addEventListener('keyup', function (event) {
      if (event.shiftKey || event.key === 'Escape') onSelectionChange();
    });
    document.addEventListener('scroll', hideChip, true);
    window.addEventListener('resize', hideChip);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && panel && !panel.hidden) closePanel();
    });
  }

  /* Tap to define (touch) ---------------------------------------- */

  function onTouchStart(event) {
    if (event.touches.length !== 1) return touchStart = null;
    var touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  }

  function onTouchEnd(event) {
    var start = touchStart;
    touchStart = null;
    if (!start || !panel || !panel.hidden) return;

    var touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;

    // Scrolling and long-pressing are not taps. A long press still belongs to
    // the system selection bar, so copying text keeps working as it always did.
    if (Date.now() - start.at > TAP_TIME) return;
    if (Math.abs(touch.clientX - start.x) > TAP_SLOP) return;
    if (Math.abs(touch.clientY - start.y) > TAP_SLOP) return;

    // Let a tap that dismisses an existing selection just dismiss it.
    var selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    var target = event.target;
    if (target && target.closest && target.closest('a, button, summary, [role="button"]')) return;

    var scope = target && target.closest ? target.closest('[data-dict-scope]') : null;
    if (!scope || isExcluded(target)) return;

    var range = wordRangeFromPoint(touch.clientX, touch.clientY);
    if (!range) return;

    var word = range.toString().trim();
    if (!isLookupable(word)) return;

    if (event.cancelable) event.preventDefault();

    highlight(range);
    openPanel(word, domainFor(scope), sentenceAroundNode(range.startContainer, word));
  }

  /**
   * Turns a screen coordinate into the word underneath it. Nothing in the
   * page is modified — the range is read from the caret position, so the
   * chapter markup the reader built is left exactly as it was.
   */
  function wordRangeFromPoint(x, y) {
    var node = null;
    var offset = 0;

    if (document.caretRangeFromPoint) {
      var caret = document.caretRangeFromPoint(x, y);
      if (!caret) return null;
      node = caret.startContainer;
      offset = caret.startOffset;
    } else if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(x, y);
      if (!position) return null;
      node = position.offsetNode;
      offset = position.offset;
    } else {
      return null;
    }

    if (!node || node.nodeType !== 3) return null;

    var text = node.textContent || '';
    var start = offset;

    // A tap landing in the space after a word still means that word.
    if (start >= text.length || !WORD_CHAR.test(text.charAt(start))) start--;
    if (start < 0 || !WORD_CHAR.test(text.charAt(start))) return null;

    var end = start;
    while (start > 0 && WORD_CHAR.test(text.charAt(start - 1))) start--;
    while (end < text.length && WORD_CHAR.test(text.charAt(end))) end++;
    if (end <= start) return null;

    var range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  }

  /* Marks the tapped word without touching the DOM. Where the Custom
     Highlight API is missing the lookup still works, just unmarked. */
  function highlight(range) {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    try {
      CSS.highlights.set('tn-dict-word', new Highlight(range));
    } catch (err) {
      /* not supported here */
    }
  }

  function clearHighlight() {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('tn-dict-word');
  }

  /* Selection ---------------------------------------------------- */

  function onSelectionChange() {
    window.setTimeout(function () {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed) return hideChip();

      var text = selection.toString().trim();
      if (!isLookupable(text)) return hideChip();

      var node = selection.anchorNode;
      var element = node && node.nodeType === 3 ? node.parentElement : node;
      var scope = element && element.closest ? element.closest('[data-dict-scope]') : null;
      if (!scope || isExcluded(element)) return hideChip();

      showChip(selection, text, domainFor(scope));
    }, 10);
  }

  function isLookupable(text) {
    if (!text || text.length > MAX_CHARS) return false;
    if (text.split(/\s+/).length > MAX_WORDS) return false;
    return /\p{L}/u.test(text);
  }

  function isExcluded(element) {
    if (!element || !element.closest) return true;
    if (element.closest('[data-dict="off"]')) return true;
    if (element.isContentEditable) return true;
    var node = element;
    while (node && node !== document.body) {
      if (SKIP_TAGS.indexOf(node.tagName) !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  function domainFor(scope) {
    var holder = scope.closest('[data-dict-domain]') || document.body;
    return holder.getAttribute('data-dict-domain') || 'general';
  }

  /* Chip --------------------------------------------------------- */

  function buildChip() {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tn-dict-chip';
    chip.hidden = true;
    chip.innerHTML = icon('M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z') + '<span>Define</span>';

    chip.addEventListener('mousedown', function (event) {
      event.preventDefault();
    });

    chip.addEventListener('click', function () {
      var term = chip.dataset.term;
      var domain = chip.dataset.domain;
      var sentence = chip.dataset.sentence;
      hideChip();
      openPanel(term, domain, sentence);
    });

    document.body.appendChild(chip);
  }

  function showChip(selection, text, domain) {
    var range = selection.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return hideChip();

    chip.dataset.term = text;
    chip.dataset.domain = domain;
    chip.dataset.sentence = sentenceAround(selection, text);
    chip.setAttribute('aria-label', 'Define ' + text);
    chip.hidden = false;

    var top = rect.top + window.scrollY - chip.offsetHeight - 8;
    if (top < window.scrollY + 4) top = rect.bottom + window.scrollY + 8;

    var left = rect.left + window.scrollX + (rect.width / 2) - (chip.offsetWidth / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - chip.offsetWidth - 8));

    chip.style.top = top + 'px';
    chip.style.left = left + 'px';
  }

  function hideChip() {
    if (chip) chip.hidden = true;
  }

  function sentenceAround(selection, term) {
    return sentenceAroundNode(selection.anchorNode, term);
  }

  function sentenceAroundNode(node, term) {
    var block = node && node.nodeType === 3 ? node.parentElement : node;
    if (!block) return '';

    var text = (block.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length <= 400) return text;

    var index = text.indexOf(term);
    if (index === -1) return text.slice(0, 400);
    return text.slice(Math.max(0, index - 180), index + 180);
  }

  /* Panel -------------------------------------------------------- */

  function buildPanel() {
    backdrop = document.createElement('div');
    backdrop.className = 'tn-dict-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', function () {
      // Where preventDefault is unavailable the emulated click still arrives.
      // Nothing a person does counts as opening and dismissing inside 600ms.
      if (Date.now() - openedAt < 600) return;
      closePanel();
    });

    panel = document.createElement('aside');
    panel.className = 'tn-dict-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'tn-dict-term');

    panel.innerHTML =
      '<div class="tn-dict-header">' +
        '<div>' +
          '<h2 class="tn-dict-term" id="tn-dict-term"></h2>' +
          '<p class="tn-dict-domain" id="tn-dict-domain"></p>' +
        '</div>' +
        '<button type="button" class="tn-dict-close" aria-label="Close dictionary">' +
          icon('M18 6L6 18M6 6l12 12') +
        '</button>' +
      '</div>' +
      '<div class="tn-dict-body" id="tn-dict-body" aria-live="polite"></div>' +
      '<div class="tn-dict-footer" id="tn-dict-footer" hidden>' +
        '<span class="tn-dict-feedback-label">Was this useful?</span>' +
        '<button type="button" class="tn-dict-feedback" data-outcome="used">Yes</button>' +
        '<button type="button" class="tn-dict-feedback" data-outcome="corrected">Not quite</button>' +
      '</div>';

    panel.querySelector('.tn-dict-close').addEventListener('click', closePanel);

    panel.querySelectorAll('.tn-dict-feedback').forEach(function (button) {
      button.addEventListener('click', function () {
        sendFeedback(button.dataset.outcome);
      });
    });

    panel.addEventListener('keydown', trapFocus);

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
  }

  function openPanel(term, domain, sentence) {
    lastFocused = document.activeElement;
    openedAt = Date.now();
    current = { term: term, domain: domain, entryId: null };

    panel.querySelector('#tn-dict-term').textContent = term;
    panel.querySelector('#tn-dict-domain').textContent = domainLabel(domain);
    panel.querySelector('#tn-dict-footer').hidden = true;

    backdrop.hidden = false;
    panel.hidden = false;
    document.body.classList.add('tn-dict-open');
    // The reader binds bare letter keys (n, p, f, t) to chapter and layout
    // actions. This flag is how it knows to stand down while the panel has
    // focus, instead of flipping chapters behind an open definition.
    document.documentElement.dataset.tnDict = 'open';
    window.requestAnimationFrame(function () {
      backdrop.classList.add('is-open');
      panel.classList.add('is-open');
    });

    panel.querySelector('.tn-dict-close').focus();
    renderLoading();
    lookup(term, domain, sentence);
  }

  function closePanel() {
    clearHighlight();
    document.body.classList.remove('tn-dict-open');
    delete document.documentElement.dataset.tnDict;
    backdrop.classList.remove('is-open');
    panel.classList.remove('is-open');
    window.setTimeout(function () {
      backdrop.hidden = true;
      panel.hidden = true;
    }, 200);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    current = null;
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    var focusable = panel.querySelectorAll('button:not([disabled])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* Data --------------------------------------------------------- */

  function lookup(term, domain, sentence) {
    var key = domain + '::' + term.toLowerCase();
    var ticket = ++pending;

    if (cache.has(key)) {
      renderEntry(cache.get(key));
      return;
    }

    fetch('/api/dictionary/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ term: term, domain: domain, sentence: sentence || '' })
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          return { ok: response.ok, payload: payload };
        });
      })
      .then(function (result) {
        if (ticket !== pending || !current) return;
        if (!result.ok) {
          renderError(result.payload.error || "That word couldn't be looked up.");
          return;
        }
        cache.set(key, result.payload);
        renderEntry(result.payload);
      })
      .catch(function () {
        if (ticket !== pending || !current) return;
        renderError('No connection. Check your network and try again.');
      });
  }

  function sendFeedback(outcome) {
    if (!current) return;

    panel.querySelectorAll('.tn-dict-feedback').forEach(function (button) {
      button.disabled = true;
    });
    panel.querySelector('.tn-dict-feedback-label').textContent = 'Thanks — noted.';

    fetch('/api/dictionary/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        term: current.term,
        domain: current.domain,
        entryId: current.entryId,
        outcome: outcome,
        pagePath: window.location.pathname
      })
    }).catch(function () { /* feedback is best-effort */ });
  }

  /* Rendering ---------------------------------------------------- */

  function renderLoading() {
    panel.querySelector('#tn-dict-body').innerHTML =
      '<div class="tn-dict-skeleton"></div>' +
      '<div class="tn-dict-skeleton"></div>' +
      '<div class="tn-dict-skeleton"></div>';
  }

  function renderError(message) {
    panel.querySelector('#tn-dict-body').innerHTML =
      '<p class="tn-dict-status tn-dict-status--error"></p>';
    panel.querySelector('.tn-dict-status').textContent = message;
  }

  function renderEntry(entry) {
    if (current) current.entryId = entry.entryId || null;

    var parts = [];
    var verified = entry.status === 'approved';

    parts.push(
      '<div class="tn-dict-flag' + (verified ? ' tn-dict-flag--verified' : '') + '">' +
        icon(verified ? 'M20 6L9 17l-5-5' : 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z') +
        '<span>' + (verified
          ? 'Reviewed and approved. This term lives in the Knowledge Repository.'
          : 'Generated just now and not yet reviewed. Check it before relying on it.') +
        '</span>' +
      '</div>'
    );

    parts.push('<p class="tn-dict-meaning">' + escape(entry.meaning) + '</p>');

    if (entry.usage && entry.usage.length) {
      parts.push(section('In use', '<ul class="tn-dict-examples">' +
        entry.usage.map(function (line) {
          return '<li>' + escape(line) + '</li>';
        }).join('') + '</ul>'));
    }

    if (entry.senses && entry.senses.length) {
      parts.push(section('Depends on context', entry.senses.map(function (sense) {
        return '<p class="tn-dict-sense"><strong>' + escape(sense.field) + '</strong>' +
          escape(sense.sense) + '</p>';
      }).join('')));
    }

    if (entry.related) {
      var groups = [];
      ['synonyms', 'antonyms', 'concepts'].forEach(function (kind) {
        var items = entry.related[kind];
        if (!items || !items.length) return;
        groups.push('<ul class="tn-dict-tags">' + items.map(function (item) {
          return '<li>' + escape(item) + '</li>';
        }).join('') + '</ul>');
      });
      if (groups.length) parts.push(section('Related words', groups.join('')));
    }

    if (entry.origin) {
      parts.push(section('Where it comes from', '<p class="tn-dict-status">' + escape(entry.origin) + '</p>'));
    }

    if (entry.connection) {
      parts.push(section('Worth knowing', '<p class="tn-dict-status">' + escape(entry.connection) + '</p>'));
    }

    if (entry.memoryHook) {
      parts.push(section('Remember it', '<p class="tn-dict-hook">' + escape(entry.memoryHook) + '</p>'));
    }

    // An approved term is a node on a map. Give the reader the way through.
    if (entry.mapId) {
      parts.push(
        '<section class="tn-dict-section">' +
          '<a class="tn-dict-link" href="/tools/knowledge/map.html?map=' +
            encodeURIComponent(entry.mapId) + '">' +
            'Open in ' + escape(entry.mapTitle || 'the Knowledge Repository') +
          '</a>' +
        '</section>'
      );
    }

    panel.querySelector('#tn-dict-body').innerHTML = parts.join('');

    var footer = panel.querySelector('#tn-dict-footer');
    footer.hidden = false;
    footer.querySelector('.tn-dict-feedback-label').textContent = 'Was this useful?';
    footer.querySelectorAll('.tn-dict-feedback').forEach(function (button) {
      button.disabled = false;
    });
  }

  function section(label, html) {
    return '<section class="tn-dict-section"><h3 class="tn-dict-label">' +
      label + '</h3>' + html + '</section>';
  }

  function domainLabel(domain) {
    return {
      english: 'English reading',
      hvac: 'HVAC and MEP',
      business: 'Business process',
      general: 'General'
    }[domain] || 'General';
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="' + path + '"/></svg>';
  }

  // Defers to global.js so escaping stays consistent site-wide.
  function escape(value) {
    if (window.TN && typeof TN.esc === 'function') return TN.esc(value == null ? '' : value);
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }
})();
