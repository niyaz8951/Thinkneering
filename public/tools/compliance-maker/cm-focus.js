/* ============================================================
   Compliance - focus mode: reading and filling one clause at a time.
   On a phone it fills the screen: big text, answer with one tap,
   swipe or tap to the next clause. On a computer it is a reading
   pane over the dimmed page (not the browser's full screen): one
   column, the clause before and after shown faintly for context,
   and a text-size control, in the manner of a reader view. Used by the project record page
   (tools/projects/record.html) and by Compliance review (library.html).

   CMFocus.open({
     title,                         name shown at the top
     items: [{ part, section, sr, spec, compliance, remarks,
               draft,               { reason, confidence } when the answer shown is an AI draft: the reason is a visible line
               comments,            undefined = no Internal Comments box
               info,                small line under the answer ("From the library")
               lib,                 true = the answer shown is the library's (green)
               others: [text] }],   read-only lines, e.g. what users filled
     start,                         index to open on
     editing,                       true = opens in Edit; false = Read (answers as text, nothing can change)
     onMode(editing),               the Read | Edit switch in the pane was used (keep the page in the same mode)
     choices: [text],               one-tap answers
     suggest(item) -> Promise of { compliance, remarks, reason, confidence, source } | { none, why } | null
                                    optional: a proposal for a clause with no answer (or with a library answer the
                                    project's datasheet contradicts); shown as "Proposed" with Keep / Keep & next / Not this
     save(item, { compliance, remarks, comments, review }) -> Promise of { info, lib }      review = the TL Review box (item.review, item.canReview)
                                    must update the item itself
     onClose()
   })
   Two views (owner, 22 Oct 2026), switched with Clause | Page in the top bar:
     Clause  one clause at a time, Read or Edit (as before; the default when opened in Edit)
     Page    a page of a book, read only: Sr, specification, compliance, remarks: what goes to the client
             (an AI draft nobody checked is left blank there, as in the consultant's Excel). A page holds as
             many clauses as fit (measured, so A- / A+ and the window size change it); every section (Part,
             section or sub-section heading) starts a new page; a click on a clause opens it in Clause view.
             Show: all clauses, those still to fill, or the deviations (Not Comply, Comply with Remarks).
   The view is remembered on the device (dame_cf_view).
   Colours come from the theme tokens. Text is written with textContent.
   ============================================================ */
(function () {
  'use strict';
  var el = window.Hub.el, STYLE = 'cm-focus-style', open = null;

  var CSS = [
    '.cf { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }',
    '.cf-win { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }',
    '.cf-size { display: none; gap: 4px; align-items: center; } .cf-size .btn { min-width: 34px; padding: 0 8px; } .cf-size .btn:disabled { opacity: .4; cursor: default; }',
    '.cf-size output { min-width: 44px; text-align: center; font-size: 12px; font-weight: 600; color: var(--text-soft); font-variant-numeric: tabular-nums; }',
    '.cf-ctx { display: none; }',
    '.cf-mode { flex: 0 0 auto; margin: 0; } .cf-mode .tab { min-height: 32px; padding: 0 12px; font-size: 13px; }',
    '.cf-read .cf-label { margin-top: calc(12px * var(--cf-k, 1)); } .cf-read .cf-label:first-child { margin-top: 0; }',
    '.cf-val { font-size: calc(17px * var(--cf-k, 1)); line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; } .cf-val.none { color: var(--text-soft); font-size: calc(15px * var(--cf-k, 1)); } .cf-val.soft { color: var(--text-soft); font-style: italic; font-size: calc(15px * var(--cf-k, 1)); }',
    '.cf.lib .cf-read .cf-val:not(.soft):not(.none):not(.tl) { color: var(--ok); }',
    /* a computer: a reading pane over the dimmed page, not the whole window */
    '@media (min-width: 700px) {',
    '  .cf { align-items: center; justify-content: center; padding: 3vh 20px; background: var(--scrim); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); animation: hub-fade .16s ease-out; }',
    '  .cf-win { flex: 0 0 auto; width: 100%; max-width: 1040px; height: min(94vh, 880px); border-radius: 22px; box-shadow: var(--shadow-lift); overflow: hidden; animation: hub-rise .22s var(--ease); }',
    '  .cf-body { padding: calc(26px * var(--cf-k, 1)) calc(40px * var(--cf-k, 1)) calc(30px * var(--cf-k, 1)); } .cf-in { max-width: 820px; gap: calc(16px * var(--cf-k, 1)); }',
    '  .cf-size { display: flex; }',
    '  .cf-ctx { display: block; width: 100%; font: inherit; text-align: left; color: var(--text-soft); background: none; border: 0; padding: calc(2px * var(--cf-k, 1)) calc(4px * var(--cf-k, 1)); cursor: pointer; font-size: calc(14px * var(--cf-k, 1)); line-height: 1.45; opacity: .6;',
    '            overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; transition: opacity .2s var(--ease); }',
    '  .cf-ctx:hover, .cf-ctx:focus-visible { opacity: 1; } .cf-ctx b { font-weight: 650; margin-right: 8px; }',
    '  .cf-nav { grid-template-columns: 1fr 1.2fr 1fr; padding: 12px 40px 14px; }',
    '}',
    '.cf-top { display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px; background: var(--surface); border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }',
    '.cf-top h2 { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0; }',
    '.cf-count { font-size: 13px; color: var(--text-soft); font-variant-numeric: tabular-nums; white-space: nowrap; min-width: 21ch; text-align: right; }',      // fixed room: the buttons beside it never shift as the numbers change
    '@media (max-width: 560px) { .cf-count { min-width: 0; } .cf-count .cf-sum { display: none; } .cf-top { gap: 8px; padding-left: 10px; padding-right: 10px; } .cf-top h2 { display: none; } .cf-count { margin-left: auto; } .cf-top .btn, .cf-mode .tab { min-height: 44px; } }',
    /* an AI draft: the proposed answer is tinted, not solid, and its reason is a visible line */
    '.cf-why { display: grid; gap: calc(2px * var(--cf-k, 1)); padding: calc(10px * var(--cf-k, 1)) calc(12px * var(--cf-k, 1)); border-radius: calc(12px * var(--cf-k, 1)); background: color-mix(in srgb, var(--brand-sky) 16%, var(--surface)); border: 1px solid color-mix(in srgb, var(--brand-sky) 45%, transparent); font-size: calc(14px * var(--cf-k, 1)); line-height: 1.45; overflow-wrap: anywhere; }',
    '.cf-why b { font-weight: 650; color: var(--link); }',
    '.cf.ai .cf-chip[aria-pressed="true"] { background: color-mix(in srgb, var(--brand-sky) 24%, var(--surface)); border-color: var(--brand); color: var(--text); }',
    '.cf.ai .cf-read .cf-val:not(.soft):not(.none):not(.tl) { color: var(--link); }',
    /* a proposal for a clause nobody answered yet: dashed, so it never looks like an answer */
    '.cf-sug { display: grid; gap: calc(6px * var(--cf-k, 1)); padding: calc(12px * var(--cf-k, 1)) calc(14px * var(--cf-k, 1)); border-radius: calc(14px * var(--cf-k, 1)); border: 1.5px dashed color-mix(in srgb, var(--brand) 55%, transparent); background: color-mix(in srgb, var(--brand-sky) 9%, var(--surface)); font-size: calc(14px * var(--cf-k, 1)); line-height: 1.45; overflow-wrap: anywhere; }',
    '.cf-sug-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: calc(8px * var(--cf-k, 1)); } .cf-sug-head b { font-size: calc(16px * var(--cf-k, 1)); font-weight: 650; }',
    '.cf-sug-src { font-size: calc(12px * var(--cf-k, 1)); font-weight: 650; padding: 2px calc(8px * var(--cf-k, 1)); border-radius: 999px; background: var(--surface-2); color: var(--link); }',
    '.cf-sug-rem { font-size: calc(15px * var(--cf-k, 1)); } .cf-sug-why { color: var(--text-soft); font-size: calc(13px * var(--cf-k, 1)); } .cf-sug-wait { color: var(--text-soft); font-size: calc(13px * var(--cf-k, 1)); }',
    '.cf-sug-act { display: flex; flex-wrap: wrap; gap: calc(8px * var(--cf-k, 1)); margin-top: calc(2px * var(--cf-k, 1)); } .cf-sug-act .btn { min-height: calc(40px * var(--cf-k, 1)); }',
    '.cf-bar { height: 4px; background: var(--surface-2); } .cf-bar i { display: block; height: 100%; width: 0; background: var(--ok); transition: width .3s; }',
    '.cf-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px 16px 24px; }',
    '.cf-in { max-width: 760px; margin: 0 auto; display: grid; gap: calc(14px * var(--cf-k, 1)); }',
    '.cf-where { display: flex; gap: calc(6px * var(--cf-k, 1)); flex-wrap: wrap; }',
    '.cf-where span { font-size: calc(12px * var(--cf-k, 1)); font-weight: 650; padding: calc(3px * var(--cf-k, 1)) calc(10px * var(--cf-k, 1)); border-radius: 999px; }',
    '.cf-where .p { background: var(--text); color: var(--bg); } .cf-where .s { background: color-mix(in srgb, var(--brand-sky) 38%, var(--surface)); }',
    // the Part and the section are drop-downs: choosing one jumps to its first clause
    '.cf-val.tl { color: var(--warn); white-space: pre-line; }',
    '.cf-where { min-width: 0; } .cf-in { grid-template-columns: minmax(0, 1fr); }',
    '.cf-where .cf-pick { position: relative; display: inline-flex; max-width: 100%; min-width: 0; padding: 0; }',
    '.cf-where .cf-pick::after { content: ""; position: absolute; right: calc(11px * var(--cf-k, 1)); top: 50%; margin-top: -calc(2px * var(--cf-k, 1)); border: 4px solid transparent; border-top-color: currentColor; pointer-events: none; }',
    '.cf-where select { font: inherit; font-size: calc(12px * var(--cf-k, 1)); font-weight: 650; color: inherit; background: none; padding: calc(4px * var(--cf-k, 1)) calc(28px * var(--cf-k, 1)) calc(4px * var(--cf-k, 1)) calc(10px * var(--cf-k, 1)); border: 0; border-radius: 999px; max-width: 100%; min-width: 0; min-height: calc(28px * var(--cf-k, 1)); cursor: pointer; text-overflow: ellipsis; -webkit-appearance: none; appearance: none; }',
    '.cf-where select:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }',
    '.cf-where option { color: var(--text); background: var(--surface); font-weight: 400; }',
    '@media (max-width: 560px) { .cf-where select { min-height: 34px; font-size: 13px; } }',
    '.cf-card { background: var(--surface); border: 1px solid color-mix(in srgb, var(--border) 55%, transparent); border-radius: 18px; box-shadow: var(--shadow); padding: calc(20px * var(--cf-k, 1)); display: grid; grid-template-columns: auto 1fr; gap: calc(12px * var(--cf-k, 1)); }',
    '.cf-sr { min-width: calc(34px * var(--cf-k, 1)); height: calc(34px * var(--cf-k, 1)); padding: 0 calc(8px * var(--cf-k, 1)); border-radius: calc(10px * var(--cf-k, 1)); display: grid; place-items: center; background: var(--surface-2); color: var(--brand); font-weight: 700; }',
    '.cf-spec { font-size: calc(19px * var(--cf-k, 1)); line-height: 1.55; letter-spacing: -.01em; overflow-wrap: anywhere; }',
    '.cf-spec .hl-red { color: var(--danger); } .cf-spec .hl-redbold { color: var(--danger); font-weight: 700; } .cf-spec .hl-underline { text-decoration: underline; } .cf-spec .hl-colon { color: var(--warn); font-weight: 700; }',
    '.cf-label { font-size: calc(13px * var(--cf-k, 1)); font-weight: 650; margin-bottom: calc(6px * var(--cf-k, 1)); }',
    '.cf-chips { display: flex; flex-wrap: wrap; gap: calc(8px * var(--cf-k, 1)); }',
    '.cf-chip { font: inherit; font-size: calc(15px * var(--cf-k, 1)); font-weight: 600; min-height: calc(44px * var(--cf-k, 1)); padding: 0 calc(16px * var(--cf-k, 1)); border-radius: 999px; cursor: pointer; background: var(--surface); color: var(--text); border: 1.5px solid var(--border); transition: transform .1s, background .15s, border-color .15s; }',
    '.cf-chip:hover { border-color: var(--brand); } .cf-chip:active { transform: scale(.96); }',
    '.cf-chip[aria-pressed="true"] { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }',
    /* boxes follow the chosen size too (16px at the normal size: a phone does not zoom in on focus) */
    '.cf-body .input { font-size: calc(16px * var(--cf-k, 1)); min-height: calc(44px * var(--cf-k, 1)); padding: calc(9px * var(--cf-k, 1)) calc(12px * var(--cf-k, 1)); border-radius: calc(12px * var(--cf-k, 1)); }',
    '.cf textarea.input { min-height: calc(62px * var(--cf-k, 1)); resize: vertical; }',
    '.cf.lib .cf-answer .input { background: var(--ok-bg); }',
    '.cf-state { min-height: calc(20px * var(--cf-k, 1)); font-size: calc(13px * var(--cf-k, 1)); color: var(--text-soft); } .cf-state.ok { color: var(--ok); font-weight: 600; } .cf-state.err { color: var(--danger); font-weight: 600; }',
    '.cf-others { display: grid; gap: calc(6px * var(--cf-k, 1)); } .cf-others div { padding: calc(8px * var(--cf-k, 1)) calc(10px * var(--cf-k, 1)); border-radius: var(--radius-sm); background: var(--surface-2); font-size: calc(13px * var(--cf-k, 1)); overflow-wrap: anywhere; }',
    '.cf-nav { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 8px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); background: var(--surface); border-top: 1px solid var(--border); }',
    '.cf-nav .btn { min-height: calc(48px * var(--cf-k, 1)); font-size: calc(15px * var(--cf-k, 1)); justify-content: center; }',
    '.cf-done { text-align: center; padding: calc(14px * var(--cf-k, 1)); border-radius: var(--radius); background: var(--ok-bg); color: var(--ok); font-weight: 650; }',
    '.cf-slide { animation: cf-in .18s ease-out; } .cf-slide.back { animation-name: cf-back; }',
    '@keyframes cf-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }',
    '@keyframes cf-back { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }',
    '@media (prefers-reduced-motion: reduce) { .cf-slide { animation: none; } .cf-chip, .cf-bar i { transition: none; } }',
    '@media (max-width: 560px) { .cf-spec { font-size: 17px; } .cf-card { padding: 14px; } .cf-body { padding: 12px 12px 20px; } }',
    'body.cf-open { overflow: hidden; }',
    /* Page view: a page of a book (Sr | specification | compliance + remarks) */
    '.cf-views .tab { min-width: 0; }',
    '.cf-page { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; }',
    '.cf-ph { display: flex; align-items: center; flex-wrap: wrap; gap: calc(6px * var(--cf-k, 1)) calc(10px * var(--cf-k, 1)); padding-bottom: calc(8px * var(--cf-k, 1)); border-bottom: 2px solid var(--text); }',
    '.cf-ph .cf-where { flex: 1 1 auto; } .cf-cont { font-size: calc(12px * var(--cf-k, 1)); color: var(--text-soft); }',
    '.cf-ph-r { display: flex; align-items: center; gap: calc(10px * var(--cf-k, 1)); margin-left: auto; }',
    '.cf-show { font: inherit; font-size: calc(12.5px * var(--cf-k, 1)); color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: calc(3px * var(--cf-k, 1)) calc(10px * var(--cf-k, 1)); min-height: calc(28px * var(--cf-k, 1)); cursor: pointer; }',
    '.cf-row { display: grid; grid-template-columns: calc(38px * var(--cf-k, 1)) minmax(0, 1fr) minmax(0, 34%); gap: calc(16px * var(--cf-k, 1)); align-items: start; padding: calc(9px * var(--cf-k, 1)) calc(6px * var(--cf-k, 1)); border-bottom: 1px solid color-mix(in srgb, var(--border) 75%, transparent); cursor: pointer; }',
    '.cf-row:hover { background: color-mix(in srgb, var(--brand-sky) 9%, transparent); } .cf-row:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }',
    '.cf-row .sr { font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; font-size: calc(14.5px * var(--cf-k, 1)); line-height: 1.55; overflow-wrap: anywhere; } .cf-row .sr.letter { color: var(--warn); } .cf-row .sr.number { color: var(--ok); }',
    '.cf-row .spec { font-size: calc(15.5px * var(--cf-k, 1)); line-height: 1.55; overflow-wrap: anywhere; white-space: pre-line; }',
    '.cf-row .spec .hl-red { color: var(--danger); } .cf-row .spec .hl-redbold { color: var(--danger); font-weight: 700; } .cf-row .spec .hl-underline { text-decoration: underline; } .cf-row .spec .hl-colon { color: var(--warn); font-weight: 700; }',
    '.cf-row .ans { font-size: calc(14.5px * var(--cf-k, 1)); line-height: 1.5; overflow-wrap: anywhere; } .cf-row .ans b { display: block; font-weight: 650; } .cf-row .ans .rem { white-space: pre-line; }',
    '.cf-row .ans.dev b { color: var(--danger); } .cf-row .ans.cwr b { color: var(--warn); } .cf-row .ans .none { color: var(--text-soft); font-style: italic; }',
    '.cf-pempty { padding: calc(40px * var(--cf-k, 1)) 0; text-align: center; color: var(--text-soft); }',
    '.cf-pinfo { display: flex; align-items: center; justify-content: center; text-align: center; font-size: calc(13px * var(--cf-k, 1)); color: var(--text-soft); font-variant-numeric: tabular-nums; min-width: 0; overflow: hidden; }',
    '.cf-pinfo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.cf-measure { position: absolute; left: 0; right: 0; top: 0; visibility: hidden; pointer-events: none; }',
    '.cf.paged .cf-body { overflow-y: hidden; position: relative; } .cf.paged.tall .cf-body { overflow-y: auto; }',
    '@media (max-width: 699px) { .cf-row { grid-template-columns: calc(30px * var(--cf-k, 1)) minmax(0, 1fr); gap: calc(4px * var(--cf-k, 1)) calc(10px * var(--cf-k, 1)); } .cf-row .ans { grid-column: 2; } .cf-row .ans b { display: inline; margin-right: 6px; } .cf-row .spec { font-size: 15px; } }',
    '@media (max-width: 560px) { .cf-views .tab { padding: 0 10px; } }'
  ].join('\n');

  function filled(it) { return !!(it.compliance || it.remarks); }

  function start(o) {
    if (open) return;
    if (!document.getElementById(STYLE)) document.head.appendChild(el('style', { id: STYLE, text: CSS }));
    var items = o.items || [], i = Math.max(0, Math.min(o.start || 0, items.length - 1));
    if (!items.length) { window.Hub.toast('There is no clause to fill here.'); return; }

    var count = el('span', { 'class': 'cf-count' }), bar = el('i'), inner = el('div', { 'class': 'cf-in' });
    var body = el('div', { 'class': 'cf-body' }, [inner]);
    var prev = el('button', { type: 'button', 'class': 'btn ghost', text: 'Previous' });
    var next = el('button', { type: 'button', 'class': 'btn ghost', text: 'Next' });
    var todo = el('button', { type: 'button', 'class': 'btn', text: 'Next to fill' });
    /* Size, remembered on this device. A- and A+ scale the whole reading area together: clause, labels,
       answer buttons, boxes and the Previous / Next buttons (everything sized with --cf-k). The pane itself
       and its top bar keep their size, so the controls never move under the pointer. */
    var STEPS = [0.9, 1, 1.1, 1.2, 1.35, 1.5], SCALE = 'dame_cf_scale', step = 1;      // not below 90%: the boxes would drop under 14px
    try {
      var kept = parseFloat(localStorage.getItem(SCALE));
      if (!kept) { var old = parseInt(localStorage.getItem('dame_cf_size'), 10); if (old) kept = old / 19; }      // the earlier setting was the clause text in px
      if (kept) STEPS.forEach(function (v, n) { if (Math.abs(v - kept) < Math.abs(STEPS[step] - kept)) step = n; });
    } catch (e) { step = 1; }
    var pct = el('output', { 'aria-live': 'polite' });
    function setStep(n) {
      step = Math.max(0, Math.min(STEPS.length - 1, n));
      win.style.setProperty('--cf-k', String(STEPS[step]));
      pct.textContent = Math.round(STEPS[step] * 100) + '%';
      smaller.disabled = step === 0; larger.disabled = step === STEPS.length - 1;
      try { localStorage.setItem(SCALE, String(STEPS[step])); } catch (e) { /* not kept */ }
      if (view === 'page' && open) repage();
    }
    var smaller = el('button', { type: 'button', 'class': 'btn ghost sm', text: 'A\u2212', title: 'Smaller', 'aria-label': 'Smaller text and buttons', onclick: function () { setStep(step - 1); } });
    var larger = el('button', { type: 'button', 'class': 'btn ghost sm', text: 'A+', title: 'Larger', 'aria-label': 'Larger text and buttons', onclick: function () { setStep(step + 1); } });
    // Read | Edit, the same switch as on the page
    var edit = !!o.editing;
    function modeBtn(on, text) { return el('button', { type: 'button', 'class': 'tab', text: text, 'aria-selected': String(on === edit), onclick: function () {
      if (on === edit) return;
      leave(function () { edit = on; [].forEach.call(seg.children, function (b, k) { b.setAttribute('aria-selected', String((k === 1) === edit)); }); draw(false); if (o.onMode) o.onMode(edit); });
    } }); }
    var seg = el('div', { 'class': 'tabs cf-mode', role: 'group', 'aria-label': 'Read or edit' }, [modeBtn(false, 'Read'), modeBtn(true, 'Edit')]);
    // Clause | Page: one clause at a time, or a page of a book (read only). Opened in Edit, it starts on Clause.
    var VIEW = 'dame_cf_view', view = 'clause';
    try { if (!edit && localStorage.getItem(VIEW) === 'page') view = 'page'; } catch (e) { view = 'clause'; }
    function viewBtn(v, text) { return el('button', { type: 'button', 'class': 'tab', text: text, 'aria-selected': String(v === view), onclick: function () { setView(v); } }); }
    var views = el('div', { 'class': 'tabs cf-mode cf-views', role: 'group', 'aria-label': 'One clause or a page' }, [viewBtn('clause', 'Clause'), viewBtn('page', 'Page')]);
    var pinfo = el('div', { 'class': 'cf-pinfo', 'aria-live': 'polite' });
    var win = el('div', { 'class': 'cf-win' }, [
      el('div', { 'class': 'cf-top' }, [
        el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Done', onclick: function () { leave(close); } }),
        el('h2', { text: o.title }), views, seg,
        el('div', { 'class': 'cf-size' }, [smaller, pct, larger]),
        count]),
      el('div', { 'class': 'cf-bar' }, [bar]), body,
      el('div', { 'class': 'cf-nav' }, [prev, todo, pinfo, next])
    ]);
    setStep(window.matchMedia('(min-width: 700px)').matches ? step : 1);        // a phone keeps the normal size: its controls are hidden there
    var root = el('div', { 'class': 'cf', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, [win]);
    root.addEventListener('mousedown', function (e) { if (e.target === root) leave(close); });      // a click on the dimmed page closes

    var comp, rem, note, tl, state, saving = Promise.resolve();

    function progress() {
      var drafts = items.filter(function (it) { return it.draft; }).length, done = items.filter(filled).length - drafts;
      count.textContent = '';
      count.appendChild(document.createTextNode('Clause ' + (i + 1) + ' of ' + items.length));
      count.appendChild(el('span', { 'class': 'cf-sum', text: ' \u00b7 ' + done + ' answered' + (drafts ? ', ' + drafts + (drafts === 1 ? ' draft' : ' drafts') + ' to check' : '') }));
      bar.style.width = Math.round(100 * done / items.length) + '%';
      prev.disabled = i === 0; next.disabled = i === items.length - 1;
      var more = items.some(function (it, k) { return k !== i && !filled(it); });
      todo.disabled = !more; todo.textContent = more ? 'Next to fill' : filled(items[i]) ? 'All filled' : 'Last one to fill';
    }

    /* Save what is in the boxes if it differs from the item. Resolves when the save is over. */
    function commit() {
      if (!comp) return saving;                         // Read: nothing to save
      var it = items[i];
      var v = { compliance: comp.value.trim(), remarks: rem.value.trim(), comments: note ? note.value.trim() : undefined, review: tl ? tl.value.trim() : undefined };
      if (v.compliance === (it.compliance || '') && v.remarks === (it.remarks || '') && (!note || v.comments === (it.comments || '')) && (!tl || v.review === (it.review || ''))) return saving.then(function () { return true; });
      var st = state, at = i;
      st.className = 'cf-state'; st.textContent = 'Saving…';
      saving = saving.then(function () { return o.save(it, v); }).then(function (res) {
        if (at === i) {
          st.className = 'cf-state ok'; st.textContent = 'Saved' + (res && res.info ? ' · ' + res.info : '');
          root.classList.toggle('lib', !!(res && res.lib)); root.classList.toggle('ai', !!it.draft);
          if (!it.draft && whyBox) { whyBox.remove(); whyBox = null; }
          // show what was stored, but never over something typed while the save was on its way
          if (comp && comp.value.trim() === v.compliance) comp.value = it.compliance || '';
          if (rem && rem.value.trim() === v.remarks) rem.value = it.remarks || '';
          chips();
        }
        progress(); failed = '';
        return true;
      }, function (err) {
        if (at === i) { st.className = 'cf-state err'; st.textContent = 'Not saved: ' + ((err && err.message) || err); }
        return false;
      });
      return saving;
    }
    /* Leaving a clause (Next, Previous, a drop-down, Done) saves it first. When the save fails the pane
       stays on the clause and says so; a second try to leave with the same text goes ahead without saving. */
    var failed = '';
    function leave(then) {
      if (!comp) { then(); return; }
      var now = i + '|' + comp.value + '|' + rem.value + '|' + (note ? note.value : '') + '|' + (tl ? tl.value : '');
      commit().then(function (ok) {
        if (ok === false && failed !== now) {
          failed = now;
          if (window.Hub && window.Hub.toast) window.Hub.toast('This clause was not saved. Check the connection and try again, or press once more to leave without saving it.', true);
          return;
        }
        failed = ''; then();
      }, then);
    }

    var chipBox, whyBox;
    function why(it) {
      if (!it.draft) return null;
      var d = it.draft;
      return el('div', { 'class': 'cf-why', role: 'note' }, [el('b', { text: 'AI draft' + (d.confidence ? ', ' + d.confidence + ' confidence' : '') }),
        el('span', { text: d.reason || 'No reason was given. Check it against the specification.' })]);
    }
    /* The proposal for a clause with no answer of its own: asked when the clause is shown (the page asks for the
       next ones at the same time, so moving on is instant). Keeping it is an ordinary save. */
    var SRC = { datasheet: 'From the datasheet', options: 'From Product Options (no datasheet: select it in the software)', 'library-similar': 'From the library', record: 'Same as your earlier answer', project: 'From another project', rule: 'From an AI rule', model: 'AI draft' };
    function suggestion(it) {
      if (!o.suggest || it.draft || it._noSug || (filled(it) && !it.lib) || it.owner) return null;
      var box = el('div', { 'class': 'cf-sug', role: 'note', 'aria-live': 'polite' }, [el('span', { 'class': 'cf-sug-wait', text: 'Looking for a proposal\u2026' })]);
      var mine = it;
      o.suggest(it).then(function (sg) {
        if (items[i] !== mine || !box.isConnected) return;
        box.textContent = '';
        if (!sg || sg.none) {
          if (sg && sg.why && !filled(it)) box.appendChild(el('span', { 'class': 'cf-sug-wait', text: 'No proposal: ' + sg.why }));
          else box.remove();
          return;
        }
        var keep = function (andNext) {
          comp.value = sg.compliance; rem.value = sg.remarks || ''; chips();
          try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* no haptics */ }
          if (andNext) nextOpen(); else commit().then(function (ok) { if (ok !== false) box.remove(); });
        };
        box.appendChild(el('div', { 'class': 'cf-sug-head' }, [el('b', { text: 'Proposed: ' + sg.compliance }), el('span', { 'class': 'cf-sug-src', text: SRC[sg.source] || 'AI' })]));
        if (sg.remarks) box.appendChild(el('div', { 'class': 'cf-sug-rem', text: sg.remarks }));
        box.appendChild(el('div', { 'class': 'cf-sug-why', text: (sg.reason || '') + (sg.confidence ? ' (' + sg.confidence + ' confidence)' : '') }));
        box.appendChild(el('div', { 'class': 'cf-sug-act' }, [
          el('button', { type: 'button', 'class': 'btn', text: 'Keep & next', onclick: function () { keep(true); } }),
          el('button', { type: 'button', 'class': 'btn ghost', text: 'Keep', onclick: function () { keep(false); } }),
          el('button', { type: 'button', 'class': 'btn ghost', text: 'Not this', onclick: function () { it._noSug = true; box.remove(); comp.focus(); } })]));
      }, function () { box.remove(); });
      return box;
    }
    function chips() {
      if (chipBox) [].forEach.call(chipBox.children, function (b) { b.setAttribute('aria-pressed', b.textContent.toLowerCase() === comp.value.trim().toLowerCase() ? 'true' : 'false'); });
    }

    function draw(back) {
      var it = items[i];
      inner.textContent = '';
      inner.className = 'cf-in cf-slide' + (back ? ' back' : '');
      root.classList.toggle('lib', !!it.lib); root.classList.toggle('ai', !!it.draft);
      function ctx(k) {
        var x = items[k]; if (!x) return null;
        return el('button', { type: 'button', 'class': 'cf-ctx', title: k < i ? 'Previous clause' : 'Next clause', onclick: function () { go(k, k < i); } }, [el('b', { text: x.sr || '\u2022' }), x.spec]);
      }
      var before = ctx(i - 1); if (before) inner.appendChild(before);
      inner.appendChild(where(it));
      var runs = window.CMHighlight ? window.CMHighlight.runs(it.spec) : [{ text: it.spec, style: '' }];
      inner.appendChild(el('div', { 'class': 'cf-card' }, [
        el('div', { 'class': 'cf-sr', text: it.sr || '•' }),
        el('div', { 'class': 'cf-spec' }, runs.map(function (r) { return r.style ? el('span', { 'class': 'hl-' + r.style, text: r.text }) : r.text; }))]));

      if (!edit) {
        // Read: the answer as text, nothing to press by mistake
        comp = rem = note = tl = chipBox = null;
        state = el('div', { 'class': 'cf-state', role: 'status', text: it.info || '' });
        var has = it.compliance || it.remarks;
        whyBox = why(it);
        inner.appendChild(el('div', { 'class': 'cf-answer cf-read' }, [
          el('div', { 'class': 'cf-label', text: 'Compliance' }), el('div', { 'class': 'cf-val' + (it.compliance ? '' : ' none'), text: it.compliance || (has ? '-' : 'Not answered yet. Switch to Edit to answer.') }),
          it.remarks ? el('div', { 'class': 'cf-label', text: 'Remarks' }) : null, it.remarks ? el('div', { 'class': 'cf-val', text: it.remarks }) : null,
          it.review ? el('div', { 'class': 'cf-label', text: 'TL Review' }) : null, it.review ? el('div', { 'class': 'cf-val tl', text: it.review }) : null,
          it.comments ? el('div', { 'class': 'cf-label', text: 'Internal Comments' }) : null, it.comments ? el('div', { 'class': 'cf-val soft', text: it.comments }) : null,
          whyBox ? el('div', { style: 'height:10px' }) : null, whyBox, state]));
        if (it.others && it.others.length) inner.appendChild(el('div', { 'class': 'cf-others' }, it.others.map(function (t) { return el('div', { text: t }); })));
        var afterR = ctx(i + 1); if (afterR) inner.appendChild(afterR);
        body.scrollTop = 0; progress(); return;
      }
      comp = el('input', { 'class': 'input', maxlength: '200', placeholder: 'Or type another answer', 'aria-label': 'Compliance' }); comp.value = it.compliance || '';
      rem = el('textarea', { 'class': 'input', maxlength: '4000', placeholder: 'Remarks (optional)', 'aria-label': 'Remarks' }); rem.value = it.remarks || '';
      note = it.comments === undefined ? null : el('textarea', { 'class': 'input', maxlength: '4000', placeholder: 'Internal comments: users see them beside this clause', 'aria-label': 'Internal Comments' });
      if (note) note.value = it.comments || '';
      // TL Review: a box for the people who may write it (item.canReview), a line of text for the others
      tl = it.canReview ? el('textarea', { 'class': 'input', maxlength: '4000', placeholder: 'Review note for this clause in this project', 'aria-label': 'TL Review' }) : null;
      if (tl) tl.value = it.review || '';
      // the boxes grow with their text; the pane does not: its middle scrolls and the buttons below stay put
      if (window.Hub.autoGrow) [rem, note, tl].forEach(function (b) { if (b) window.Hub.autoGrow(b); });
      state = el('div', { 'class': 'cf-state', role: 'status', 'aria-live': 'polite', text: it.info || '' });
      chipBox = el('div', { 'class': 'cf-chips' }, (o.choices || []).map(function (c) {
        return el('button', { type: 'button', 'class': 'cf-chip', text: c, 'aria-pressed': 'false', onclick: function () {
          comp.value = comp.value.trim().toLowerCase() === c.toLowerCase() ? '' : c;      // a second tap takes the answer off
          try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* no haptics */ }
          chips(); commit();
        } });
      }));
      chips();
      comp.addEventListener('input', chips);
      [comp, rem, note, tl].forEach(function (b) { if (b) b.addEventListener('change', commit); });
      whyBox = why(it);
      var sugBox = suggestion(it);
      inner.appendChild(el('div', { 'class': 'cf-answer' }, [el('div', { 'class': 'cf-label', text: 'Compliance' }), whyBox, whyBox ? el('div', { style: 'height:8px' }) : null,
        sugBox, sugBox ? el('div', { style: 'height:8px' }) : null, chipBox,
        el('div', { style: 'height:8px' }), comp, el('div', { style: 'height:10px' }), el('div', { 'class': 'cf-label', text: 'Remarks' }), rem,
        tl || it.review ? el('div', { style: 'height:10px' }) : null, tl || it.review ? el('div', { 'class': 'cf-label', text: 'TL Review' }) : null, tl || (it.review ? el('div', { 'class': 'cf-val tl', text: it.review }) : null),
        note ? el('div', { style: 'height:10px' }) : null, note ? el('div', { 'class': 'cf-label', text: 'Internal Comments' }) : null, note, state]));
      if (it.others && it.others.length) inner.appendChild(el('div', { 'class': 'cf-others' }, it.others.map(function (t) { return el('div', { text: t }); })));
      var after = ctx(i + 1); if (after) inner.appendChild(after);
      if (items.every(filled)) inner.appendChild(el('div', { 'class': 'cf-done', text: 'All ' + items.length + ' clauses are filled. Press Done.' }));
      body.scrollTop = 0; progress();
    }

    /* Where the clause is: its Part and its section, as drop-downs when there is more than one to choose
       from. Choosing a Part or a section opens its first clause. */
    function where(it) {
      var parts = [], sects = [];
      items.forEach(function (x, k) {
        if (!parts.length || parts[parts.length - 1].name !== (x.part || '')) parts.push({ name: x.part || '', at: k });
        if ((x.part || '') === (it.part || '') && k >= partStart(it) && (!sects.length || sects[sects.length - 1].name !== (x.section || '')) && samePartRun(k)) sects.push({ name: x.section || '', at: k });
      });
      function partStart(t) { var k = items.indexOf(t); while (k > 0 && (items[k - 1].part || '') === (t.part || '')) k--; return k; }
      function samePartRun(k) { var a = partStart(it), b = a; while (b < items.length && (items[b].part || '') === (it.part || '')) b++; return k >= a && k < b; }
      function pick(list, cls, label, none) {
        var cur = items.indexOf(it), sel = 0;
        list.forEach(function (o, n) { if (o.at <= cur) sel = n; });
        if (list.length < 2) return list[0] && list[0].name ? el('span', { 'class': cls, text: list[0].name }) : null;
        var s = el('select', { 'aria-label': label, title: label }, list.map(function (o, n) { return el('option', { value: String(o.at), text: o.name || none }); }));
        s.selectedIndex = sel;
        s.addEventListener('change', function () { go(+s.value, +s.value < i); });
        return el('span', { 'class': cls + ' cf-pick' }, [s]);        // the pill, with the little arrow drawn on it
      }
      return el('div', { 'class': 'cf-where' }, [pick(parts, 'p', 'Go to a Part', 'Before the first Part'), pick(sects, 's', 'Go to a section of this Part', 'Before the first section')]);
    }

    /* ---------- Page view: a page of a book, read only ---------- */
    var pages = [], pg = 0, show = 'all', resizeT = 0;
    function deviation(it) { return !it.draft && /^(not comply|comply with remarks)$/i.test(String(it.compliance || '').trim()); }
    function keep(it) { return show === 'fill' ? (!filled(it) || !!it.draft) : show === 'dev' ? deviation(it) : true; }
    function sectionKey(it) { return (it.part || '') + '\u0001' + (it.section || ''); }
    function srClass(it) { var t = it.type || (it.line && it.line.type) || ''; return t === 'letter' || t === 'number' ? ' ' + t : ''; }
    /* one clause as the client reads it: Sr, specification, compliance, remarks */
    function row(k) {
      var it = items[k], runs = window.CMHighlight ? window.CMHighlight.runs(it.spec) : [{ text: it.spec, style: '' }];
      var c = String(it.compliance || '').trim(), ans;
      if (it.draft) ans = el('div', { 'class': 'ans' }, [el('span', { 'class': 'none', text: 'AI draft, not checked (blank for the client)' })]);
      else if (!c && !it.remarks) ans = el('div', { 'class': 'ans' }, [el('span', { 'class': 'none', text: '– not answered –' })]);
      else ans = el('div', { 'class': 'ans' + (/^not comply$/i.test(c) ? ' dev' : /^comply with remarks$/i.test(c) ? ' cwr' : '') }, [
        c ? el('b', { text: c }) : null, it.remarks ? el('span', { 'class': 'rem', text: it.remarks }) : null]);
      var r = el('div', { 'class': 'cf-row', role: 'button', tabindex: '0', title: 'Open this clause', 'aria-label': (it.sr || '') + ' ' + it.spec.slice(0, 80) }, [
        el('div', { 'class': 'sr' + srClass(it), text: it.sr || '•' }),
        el('div', { 'class': 'spec' }, runs.map(function (x) { return x.style ? el('span', { 'class': 'hl-' + x.style, text: x.text }) : x.text; })),
        ans]);
      r.addEventListener('click', function () { openClause(k); });
      r.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); openClause(k); } });
      return r;
    }
    function head(p) {
      var it = items[p.items[0]];
      var sel = el('select', { 'class': 'cf-show', 'aria-label': 'Show' }, [
        el('option', { value: 'all', text: 'All clauses' }), el('option', { value: 'fill', text: 'To fill' }), el('option', { value: 'dev', text: 'Deviations' })]);
      sel.value = show;
      sel.addEventListener('change', function () { show = sel.value; repage(); });
      return el('div', { 'class': 'cf-ph' }, [where(it), p.secPage > 1 ? el('span', { 'class': 'cf-cont', text: 'continued' }) : null,
        el('div', { 'class': 'cf-ph-r' }, [sel])]);                // the page number is in the top bar, as the clause number is
    }
    /* Pages are measured: every clause of the list is laid out once, hidden, at the page's width and the chosen size;
       a page takes clauses until the next one does not fit; a new section always starts a new page. */
    function paginate() {
      var list = []; items.forEach(function (it, k) { if (keep(it)) list.push(k); });
      pages = [];
      if (!list.length) return;
      var probe = el('div', { 'class': 'cf-page cf-measure' }), cs = getComputedStyle(body);
      body.appendChild(probe);
      var ph = head({ items: [list[0]], secPage: 2 }); probe.appendChild(ph);
      var avail = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - ph.offsetHeight - 6;
      var hs = {};
      list.forEach(function (k) { var r = row(k); probe.appendChild(r); hs[k] = r.offsetHeight; });
      probe.remove();
      var cur = null, h = 0;
      list.forEach(function (k) {
        var key = sectionKey(items[k]);
        if (!cur || cur.key !== key || (cur.items.length && h + hs[k] > avail)) {
          cur = { key: key, items: [], secPage: cur && cur.key === key ? cur.secPage + 1 : 1, tall: false };
          pages.push(cur); h = 0;
        }
        cur.items.push(k); h += hs[k];
        if (h > avail) cur.tall = true;            // one clause longer than a page: it scrolls inside its page
      });
      pages.forEach(function (p) { p.secPages = pages.filter(function (q) { return q.key === p.key; }).length; });
    }
    function pageOf(k) {
      for (var n = 0; n < pages.length; n++) if (pages[n].items.indexOf(k) >= 0) return n;
      for (n = 0; n < pages.length; n++) if (pages[n].items[0] > k) return n;          // filtered out: the next page after it
      return Math.max(0, pages.length - 1);
    }
    function drawPage(back) {
      inner.textContent = '';
      inner.className = 'cf-page cf-slide' + (back ? ' back' : '');
      root.classList.remove('lib', 'ai');
      var p = pages[pg];
      root.classList.toggle('tall', !!(p && p.tall));
      count.textContent = pages.length ? 'Page ' + (pg + 1) + ' of ' + pages.length : 'No page';
      bar.style.width = pages.length ? Math.round(100 * (pg + 1) / pages.length) + '%' : '0';
      prev.disabled = pg <= 0; next.disabled = pg >= pages.length - 1;
      pinfo.textContent = '';
      if (!p) {
        var sel = el('select', { 'class': 'cf-show', 'aria-label': 'Show' }, [el('option', { value: 'all', text: 'All clauses' }), el('option', { value: 'fill', text: 'To fill' }), el('option', { value: 'dev', text: 'Deviations' })]);
        sel.value = show; sel.addEventListener('change', function () { show = sel.value; repage(); });
        inner.appendChild(el('div', { 'class': 'cf-ph' }, [el('div', { 'class': 'cf-ph-r' }, [sel])]));
        inner.appendChild(el('div', { 'class': 'cf-pempty', text: show === 'dev' ? 'No deviations: no clause is answered Not Comply or Comply with Remarks.' : 'Every clause is filled.' }));
        return;
      }
      inner.appendChild(head(p));
      p.items.forEach(function (k) { inner.appendChild(row(k)); });
      var it = items[p.items[0]];
      pinfo.appendChild(el('span', { text: (it.section || it.part || o.title) + ' · page ' + p.secPage + ' of ' + p.secPages }));
      i = p.items[0];                              // Clause view opens here
      body.scrollTop = 0;
    }
    /* again after a change of size, window or filter, on the page that holds the same first clause */
    function repage() {
      var anchor = pages[pg] ? pages[pg].items[0] : i;
      paginate();
      pg = pageOf(anchor);                         // a filter keeps the reader where he was (the next page that is left)
      drawPage(false);
    }
    function turn(d) { var to = pg + d; if (to < 0 || to >= pages.length) return; pg = to; drawPage(d < 0); }
    function syncViews() {
      [].forEach.call(views.children, function (b, k) { b.setAttribute('aria-selected', String((k === 1) === (view === 'page'))); });
      seg.hidden = view === 'page'; todo.hidden = view === 'page'; pinfo.hidden = view !== 'page';
      root.classList.toggle('paged', view === 'page');
      if (view !== 'page') root.classList.remove('tall');
      try { localStorage.setItem(VIEW, view); } catch (e) { /* not kept */ }
    }
    function setView(v) {
      if (v === view) return;
      if (v === 'page') leave(function () { view = 'page'; syncViews(); paginate(); pg = pageOf(i); drawPage(false); });
      else { view = 'clause'; syncViews(); draw(false); }
    }
    function openClause(k) { i = k; view = 'clause'; syncViews(); draw(false); }
    function onResize() { if (view !== 'page') return; clearTimeout(resizeT); resizeT = setTimeout(repage, 150); }
    window.addEventListener('resize', onResize);
    function go(to, back) {
      if (to < 0 || to >= items.length) return;
      if (view === 'page') { var n = pageOf(to); if (n !== pg) { pg = n; drawPage(back); } return; }
      if (to === i) return;
      leave(function () { i = to; draw(back); });
    }
    function nextOpen() {
      leave(function () {
        for (var k = 1; k <= items.length; k++) { var j = (i + k) % items.length; if (j !== i && !filled(items[j])) { var back = j < i; i = j; draw(back); return; } }
        draw(false);
      });
    }
    prev.addEventListener('click', function () { if (view === 'page') turn(-1); else go(i - 1, true); });
    next.addEventListener('click', function () { if (view === 'page') turn(1); else go(i + 1, false); });
    todo.addEventListener('click', nextOpen);

    // swipe left = next, right = previous (not while selecting text in a box)
    var sx = 0, sy = 0, tracking = false;
    body.addEventListener('touchstart', function (e) { var t = e.touches[0]; tracking = e.touches.length === 1 && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName); sx = t.clientX; sy = t.clientY; }, { passive: true });
    body.addEventListener('touchend', function (e) {
      if (!tracking) return; tracking = false;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) { if (view === 'page') turn(dx < 0 ? 1 : -1); else if (dx < 0) go(i + 1, false); else go(i - 1, true); }
    }, { passive: true });

    function key(e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape') { e.preventDefault(); leave(close); }
      else if (view === 'page' && !typing && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); turn((e.key === 'Home' ? 0 : pages.length - 1) - pg); }
      else if (view === 'page' && !typing && /^(ArrowRight|PageDown)$/.test(e.key)) { e.preventDefault(); turn(1); }
      else if (view === 'page' && !typing && /^(ArrowLeft|PageUp)$/.test(e.key)) { e.preventDefault(); turn(-1); }
      else if (view === 'page' && !typing && e.key === ' ' && !/^(BUTTON|A)$/.test(e.target.tagName) && !(e.target.classList && e.target.classList.contains('cf-row'))) { e.preventDefault(); turn(e.shiftKey ? -1 : 1); }
      else if (view === 'page') return;
      else if (!typing && e.key === 'ArrowRight') go(i + 1, false);
      else if (!typing && e.key === 'ArrowLeft') go(i - 1, true);
      else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); nextOpen(); }
    }
    function close() {
      document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', commit); window.removeEventListener('resize', onResize);
      root.remove(); document.body.classList.remove('cf-open'); open = null;
      if (o.onClose) o.onClose();
    }
    // the phone is put down or another app comes up: what is typed is saved first
    function hide() { if (document.visibilityState === 'hidden') commit(); }
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', commit);
    document.addEventListener('keydown', key);
    document.body.appendChild(root); document.body.classList.add('cf-open'); open = root;
    syncViews();
    if (view === 'page') { paginate(); pg = pageOf(i); drawPage(false); } else draw(false);
  }

  window.CMFocus = { open: start, isOpen: function () { return !!open; } };
})();
