/*
 * app.js — Container & trailer calculator
 * Thinkneering
 */

import { packItems, compareFleet, VEHICLE_PRESETS, PALLET_PRESETS, DEFAULT_PALLET_CLEARANCE } from './packer.js';
import { isoScene, planScene, elevationScene, sceneToSvg, tokenFor } from './draw.js';
import { readWorkbook, parseCsv, rowsToItems, templateWorkbook, cargoWorkbook, buildWorkbook } from './xlsx-io.js';
import { PdfDoc, pdfCanPrint, PDF_MARKER } from './pdf.js';

const STORAGE_KEY = 'tn.container-calculator.v1';

const state = {
  project: '',
  vehicleId: 'tr12',
  custom: { length: 12, width: 2.4, height: 3.3, payload: 24000 },
  cost: 0,              // empty unless the user types one; never pre-filled
  costTouched: false,   // true once the user edits the cost
  currency: '',         // free text, shown with the freight estimate
  unit: 'm',
  options: { allowStacking: true, allowTilt: false, gap: 0.1 },
  pallet: { on: false,
            types: ['eur1'],      // every pallet the user can source
            useCustom: false,
            fit: true,            // made-to-size skid for items no ticked pallet takes
            clearance: DEFAULT_PALLET_CLEARANCE,
            maxLoadHeight: 1.8,   // goods height above the deck
            maxLoad: 0,           // 0 = use each pallet's own safe working load
            custom: { length: 1.2, width: 0.8, deck: 0.144, weight: 25, swl: 1500 } },
  items: [],   // dimensions always stored in metres
};

let plan = null;
let fleet = [];

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const fmt = (n, d = 2) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => `${Math.round(n * 100)}%`;
const toDisplay = (metres) => (state.unit === 'mm' ? Math.round(metres * 1000) : Number(metres.toFixed(3)));
const fromDisplay = (value) => (state.unit === 'mm' ? Number(value) / 1000 : Number(value));
const piecesWord = (n) => `${n} piece${n === 1 ? '' : 's'}`;

/* The item itself, as entered. A placement's l and w also carry the
   clearance to the next item, which belongs in the positions, not in the
   size printed on a packing list. A loaded pallet reports its deck. */
function enteredSize(p) {
  if (p.pallet) return { l: p.pallet.deckL, w: p.pallet.deckW, h: p.rawH };
  return { l: p.rawL, w: p.rawW, h: p.rawH };
}

/* The loading rules in force. Palletised cargo stays upright, so turning on
   side is off whenever "Cargo is palletised" is ticked. */
function packOptions() {
  return { ...state.options, allowTilt: state.options.allowTilt && !state.pallet.on };
}

function clearanceLine() {
  const mm = Math.round(state.options.gap * 1000);
  return mm > 0
    ? `Clearance ${mm} mm is kept between items. Sizes are as entered; positions include the clearance.`
    : 'No clearance between items.';
}

function freightText(vehicles) {
  return `${state.currency.trim()} ${(state.cost * vehicles).toLocaleString()}`.trim();
}

/* ------------------------------------------------------------------ *
 * Input checks
 *
 * Nothing is corrected behind the user's back: a bad value gets a message
 * next to it and Calculate stays off until it is fixed.
 * ------------------------------------------------------------------ */

/* Messages for the setup fields, keyed by selector. */
const fieldErrors = {};

function setFieldError(selector, message) {
  if (message) fieldErrors[selector] = message; else delete fieldErrors[selector];
  const box = $(`${selector}-err`);
  if (box) { box.textContent = message || ''; box.hidden = !message; }
  const input = $(selector);
  if (input) { if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
}

const CUSTOM_FIELDS = ['#c-length', '#c-width', '#c-height', '#c-payload'];

/* Setup problems that stop a calculation. A custom-vehicle field only
   counts while the custom vehicle is the one selected. */
function setupBlocked() {
  if (fieldErrors['#opt-gap']) return true;
  return state.vehicleId === 'custom' && CUSTOM_FIELDS.some((f) => fieldErrors[f]);
}

/* Problems in one cargo row, keyed by field. A row with no dimensions at
   all is an unfinished row, not an error: it is left out as before. */
function rowErrors(item) {
  const out = {};
  const dims = ['length', 'width', 'height'];
  const started = dims.some((k) => Number.isNaN(item[k]) || item[k] !== 0);
  for (const k of dims) {
    if (Number.isNaN(item[k])) out[k] = 'Enter a number.';
    else if (item[k] < 0) out[k] = 'Must be above 0.';
    else if (started && item[k] === 0) out[k] = 'Needed.';
  }
  if (Number.isNaN(item.weight)) out.weight = 'Enter a number.';
  else if (item.weight < 0) out.weight = 'Cannot be negative.';
  if (!(Number.isInteger(item.qty) && item.qty >= 1)) out.qty = 'Whole number, 1 or more.';
  return out;
}

const hasRowErrors = () => state.items.some((i) => Object.keys(rowErrors(i)).length > 0);

function blankItem() {
  return { tag: '', length: 0, width: 0, height: 0, weight: 0, qty: 1, stackable: true };
}

function activeVehicle() {
  if (state.vehicleId === 'custom') {
    return { id: 'custom', name: 'Custom vehicle', ...state.custom };
  }
  return VEHICLE_PRESETS.find((v) => v.id === state.vehicleId) || VEHICLE_PRESETS[0];
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeFileName(name, fallback, ext) {
  const base = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  return `${base || fallback}.${ext}`;
}

function notify(message, isError = false) {
  const box = $('#import-notice');
  box.textContent = message;
  box.className = isError ? 'notice error' : 'notice';
  box.hidden = !message;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      project: state.project, vehicleId: state.vehicleId, custom: state.custom,
      cost: state.cost, costTouched: state.costTouched, currency: state.currency, unit: state.unit,
      options: state.options, pallet: state.pallet, items: state.items,
    }));
  } catch { /* storage unavailable — the tool still works */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(state, saved, {
      options: { ...state.options, ...(saved.options || {}) },
      pallet: { ...state.pallet, ...(saved.pallet || {}),
                custom: { ...state.pallet.custom, ...((saved.pallet || {}).custom || {}) } },
    });

    /* Saved state from before mix-and-match holds a single `type` string.
       Carry it into the new list rather than silently resetting the user's
       pallet choice to the default. */
    const savedPallet = saved.pallet || {};
    if (!Array.isArray(state.pallet.types)) state.pallet.types = [];
    if (savedPallet.type && !savedPallet.types) {
      if (savedPallet.type === 'custom') {
        state.pallet.useCustom = true;
        state.pallet.types = [];
      } else {
        state.pallet.types = [savedPallet.type];
      }
    }
    if (!state.pallet.types.length && !state.pallet.useCustom) state.pallet.types = ['eur1'];
    delete state.pallet.type;

    /* A cost the user never typed was the old pre-filled sample: drop it. */
    if (!state.costTouched) state.cost = 0;
    if (typeof state.currency !== 'string') state.currency = '';
    if (!(state.options.gap >= 0 && state.options.gap <= 0.5)) state.options.gap = 0.1;
    if (!Array.isArray(state.items)) state.items = [];
    /* JSON has no NaN, so a field that held unreadable text comes back null. */
    for (const item of state.items) {
      for (const k of ['length', 'width', 'height', 'weight']) if (typeof item[k] !== 'number') item[k] = 0;
      if (typeof item.qty !== 'number') item.qty = NaN;
    }
  } catch { /* ignore corrupt state */ }
}

/* ------------------------------------------------------------------ *
 * Setup panel
 * ------------------------------------------------------------------ */

function buildVehicleSelect() {
  const select = $('#vehicle');
  select.innerHTML = '';
  const groups = {};
  for (const v of VEHICLE_PRESETS) {
    (groups[v.group] ||= []).push(v);
  }
  for (const [label, list] of Object.entries(groups)) {
    const og = el('optgroup');
    og.label = label;
    for (const v of list) {
      const opt = el('option', null, v.name);
      opt.value = v.id;
      og.appendChild(opt);
    }
    select.appendChild(og);
  }
  const custom = el('option', null, 'Custom dimensions…');
  custom.value = 'custom';
  select.appendChild(custom);
  select.value = state.vehicleId;
}

/** Write a value into a control, unless the user is mid-keystroke in it. */
function setValue(selector, value) {
  const node = $(selector);
  /* A field showing an error keeps what the user typed, so the message
     still sits next to the value it is about. */
  if (fieldErrors[selector]) return;
  if (node && node !== document.activeElement) node.value = value;
}

function buildPalletSelect() {
  const list = $('#pallet-list');
  list.innerHTML = '';

  const groups = {};
  for (const p of PALLET_PRESETS) (groups[p.region] ||= []).push(p);

  const addCheck = (id, label, sub) => {
    const wrap = el('label', 'cc-pallet-opt');
    const box = el('input');
    box.type = 'checkbox';
    box.value = id;
    box.dataset.pallet = id;
    const text = el('span');
    text.appendChild(document.createTextNode(label));
    if (sub) {
      const em = el('em');
      em.textContent = sub;
      text.appendChild(em);
    }
    wrap.append(box, text);
    return wrap;
  };

  const mm = (m) => Math.round(m * 1000);
  for (const [region, items] of Object.entries(groups)) {
    const head = el('p', 'cc-pallet-group');
    head.textContent = region;
    list.appendChild(head);
    for (const p of items) {
      list.appendChild(addCheck(p.id, p.name, `${p.weight} kg · SWL ${p.swl} kg`));
    }
  }
  const head = el('p', 'cc-pallet-group');
  head.textContent = 'Your own';
  list.appendChild(head);
  list.appendChild(addCheck('custom', 'Custom pallet', 'dimensions below'));
  list.appendChild(addCheck('fit', 'Made-to-size skid', `for items too large for the ticked pallets · deck ${Math.round(FIT_SKID.deck * 1000)} mm, about ${FIT_SKID.kgPerM2} kg per m² (estimate)`));

  list.addEventListener('change', (e) => {
    const id = e.target.dataset && e.target.dataset.pallet;
    if (!id) return;
    if (id === 'custom') {
      state.pallet.useCustom = e.target.checked;
    } else if (id === 'fit') {
      state.pallet.fit = e.target.checked;
    } else {
      const set = new Set(state.pallet.types);
      if (e.target.checked) set.add(id); else set.delete(id);
      state.pallet.types = [...set];
    }
    syncSetupPanel();
    markStale();
  });
}

function syncPalletPanel() {
  $('#pallet-fields').hidden = !state.pallet.on;
  for (const box of $('#pallet-list').querySelectorAll('input[data-pallet]')) {
    box.checked = box.dataset.pallet === 'custom'
      ? state.pallet.useCustom
      : box.dataset.pallet === 'fit'
        ? state.pallet.fit !== false
        : state.pallet.types.includes(box.dataset.pallet);
  }
  setValue('#pallet-clearance', Math.round(state.pallet.clearance * 1000));
  $('#pallet-custom').hidden = !state.pallet.useCustom;
  setValue('#pallet-l', Math.round(state.pallet.custom.length * 1000));
  setValue('#pallet-w', Math.round(state.pallet.custom.width * 1000));
  setValue('#pallet-h', Math.round(state.pallet.custom.deck * 1000));
  setValue('#pallet-kg', state.pallet.custom.weight);

  setValue('#pallet-load-h', Math.round(state.pallet.maxLoadHeight * 1000));
  setValue('#pallet-load-kg', state.pallet.maxLoad);
  setValue('#pallet-swl', state.pallet.custom.swl);

  if (!state.pallet.on) return;
  const mm = (m) => Math.round(m * 1000);
  const chosen = candidatePallets();
  $('#pallet-hint').textContent = chosen.length === 1
    ? `Using ${chosen[0].name} — deck ${mm(chosen[0].length)} × ${mm(chosen[0].width)} mm, ${mm(chosen[0].deck)} mm high.`
    : `${chosen.length} pallets available, tried smallest first: ${chosen.map((p) => `${mm(p.length)}×${mm(p.width)}`).join(', ')}.`;
  syncPalletNote();
}

/* The tiling summary depends on the CARGO as much as on the pallet, so it is
   refreshed on every cargo edit too — not only when a pallet control changes.
   Kept separate from syncPalletPanel so a keystroke in the cargo table does
   not rewrite every field in the panel. */
function syncPalletNote() {
  if (!state.pallet.on) return;

  /* Show the tiling result per row. This is the number an engineer actually
     checks against the shop floor, so it is on screen before Calculate rather
     than buried in the results. */
  const { report, loose } = palletise(usableItems());
  const note = $('#pallet-note');
  const packed = report.filter((r) => !r.loose);
  const totalPallets = packed.reduce((s, r) => s + r.pallets, 0);

  if (!report.length) {
    note.textContent = 'Add cargo to see how it tiles onto the pallet.';
    note.classList.remove('is-warn');
    return;
  }

  const lines = packed.slice(0, 4).map((r) =>
    `${r.tag} → ${r.pallet}: ${r.perLayer} per layer × ${r.layers} layer${r.layers === 1 ? '' : 's'} = ${r.perPallet} per pallet → ${r.pallets} pallet${r.pallets === 1 ? '' : 's'} (limited by ${r.limitedBy})`);
  if (packed.length > 4) lines.push(`…and ${packed.length - 4} more row(s).`);

  let text = `${totalPallets} pallet${totalPallets === 1 ? '' : 's'} in total. ` + lines.join(' · ');
  if (loose.length) {
    text += ` — ${loose.length} row(s) are larger than the deck and ship loose, not palletised.`;
  }
  note.textContent = text;
  note.classList.toggle('is-warn', loose.length > 0);
}

function syncSetupPanel() {
  setValue('#project', state.project);
  setValue('#vehicle', state.vehicleId);
  setValue('#cost', state.cost || '');
  setValue('#currency', state.currency);
  $('#opt-stack').checked = state.options.allowStacking;
  $('#opt-tilt').checked = state.options.allowTilt && !state.pallet.on;
  $('#opt-tilt').disabled = state.pallet.on;
  $('#opt-tilt-note').textContent = state.pallet.on
    ? 'Not used: palletised cargo stays upright'
    : 'Lets the packer rotate items in all axes';
  $('#opt-pallet').checked = state.pallet.on;
  setValue('#opt-gap', Math.round(state.options.gap * 1000));
  setValue('#c-length', state.custom.length);
  setValue('#c-width', state.custom.width);
  setValue('#c-height', state.custom.height);
  setValue('#c-payload', state.custom.payload);
  $('#custom-dims').hidden = state.vehicleId !== 'custom';
  for (const button of document.querySelectorAll('.segmented [data-unit]')) {
    button.setAttribute('aria-pressed', String(button.dataset.unit === state.unit));
  }

  syncPalletPanel();

  const v = activeVehicle();
  $('#vehicle-hint').textContent =
    `Internal ${fmt(v.length)} × ${fmt(v.width)} × ${fmt(v.height)} m · payload ${Math.round(v.payload).toLocaleString()} kg`;
  $('#cost').placeholder = v.cost ? `e.g. ${v.cost}` : 'e.g. 2800';
}

/* ------------------------------------------------------------------ *
 * Cargo table
 * ------------------------------------------------------------------ */

function renderCargo() {
  const body = $('#cargo-body');
  body.innerHTML = '';
  const unitLabel = state.unit === 'mm' ? 'mm' : 'm';
  $('#th-l').textContent = `Length (${unitLabel})`;
  $('#th-w').textContent = `Width (${unitLabel})`;
  $('#th-h').textContent = `Height (${unitLabel})`;

  state.items.forEach((item, i) => {
    const tr = el('tr');

    /* One message slot under each input; showErrors fills them in place so a
       keystroke never rebuilds the row and loses the caret. */
    const slots = {};
    const slot = (td, key) => { slots[key] = el('span', 'cc-err'); slots[key].hidden = true; td.appendChild(slots[key]); };
    const inputs = {};
    const showErrors = () => {
      const errs = rowErrors(item);
      for (const key of Object.keys(slots)) {
        slots[key].textContent = errs[key] || '';
        slots[key].hidden = !errs[key];
        if (errs[key]) inputs[key].setAttribute('aria-invalid', 'true'); else inputs[key].removeAttribute('aria-invalid');
      }
    };
    /* '' is "not filled in"; text a number field cannot read is NaN. */
    const readNumber = (input, blank) => (input.validity.badInput ? NaN : input.value === '' ? blank : Number(input.value));

    const tagCell = el('td', 'col-tag');
    const swatch = el('span', 'cc-swatch');
    swatch.style.background = `var(--color-${tokenFor(i)})`;
    const tagInput = el('input');
    tagInput.type = 'text';
    tagInput.value = item.tag;
    tagInput.placeholder = `Item ${i + 1}`;
    tagInput.setAttribute('aria-label', `Tag for row ${i + 1}`);
    tagInput.addEventListener('input', () => { item.tag = tagInput.value; markStale(); });
    tagCell.append(swatch, tagInput);
    tr.appendChild(tagCell);

    for (const key of ['length', 'width', 'height']) {
      const td = el('td', 'num');
      const input = el('input');
      input.type = 'number';
      input.min = '0';
      input.step = state.unit === 'mm' ? '1' : '0.001';
      input.inputMode = 'decimal';
      input.value = item[key] ? toDisplay(item[key]) : '';
      input.setAttribute('aria-label', `${key} for row ${i + 1} in ${unitLabel}`);
      input.addEventListener('input', () => {
        const n = readNumber(input, 0);
        item[key] = state.unit === 'mm' ? n / 1000 : n;
        showErrors();
        markStale();
      });
      inputs[key] = input;
      td.appendChild(input);
      slot(td, key);
      tr.appendChild(td);
    }

    const wTd = el('td', 'num');
    const wInput = el('input');
    wInput.type = 'number';
    wInput.min = '0';
    wInput.step = '1';
    wInput.inputMode = 'decimal';
    wInput.value = item.weight || '';
    wInput.setAttribute('aria-label', `Gross weight for row ${i + 1} in kilograms`);
    wInput.addEventListener('input', () => { item.weight = readNumber(wInput, 0); showErrors(); markStale(); });
    inputs.weight = wInput;
    wTd.appendChild(wInput);
    slot(wTd, 'weight');
    tr.appendChild(wTd);

    const qTd = el('td', 'num');
    const qInput = el('input');
    qInput.type = 'number';
    qInput.min = '1';
    qInput.step = '1';
    qInput.inputMode = 'numeric';
    qInput.value = Number.isNaN(item.qty) ? '' : item.qty;
    qInput.setAttribute('aria-label', `Quantity for row ${i + 1}`);
    qInput.addEventListener('input', () => { item.qty = readNumber(qInput, NaN); showErrors(); markStale(); });
    inputs.qty = qInput;
    qTd.appendChild(qInput);
    slot(qTd, 'qty');
    tr.appendChild(qTd);

    const sTd = el('td', 'cc-stack');
    const sLabel = el('label', 'cc-tick');
    const sInput = el('input');
    sInput.type = 'checkbox';
    sInput.checked = item.stackable;
    sInput.setAttribute('aria-label', `Other items may be stacked on row ${i + 1}`);
    sInput.addEventListener('change', () => { item.stackable = sInput.checked; markStale(); });
    sLabel.appendChild(sInput);
    sTd.appendChild(sLabel);
    tr.appendChild(sTd);

    const rTd = el('td');
    const remove = el('button', 'btn btn--quiet btn--sm cc-remove');
    remove.type = 'button';
    remove.innerHTML = window.TN ? window.TN.icon('trash', 18) : '&times;';
    remove.setAttribute('aria-label', `Remove row ${i + 1}${item.tag ? `, ${item.tag}` : ''}`);
    remove.addEventListener('click', () => {
      state.items.splice(i, 1);
      renderCargo();
      markStale();
    });
    rTd.appendChild(remove);
    tr.appendChild(rTd);

    /* Enter in any cell of the row starts the calculation, as it would in a form. */
    tr.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox') return;
      e.preventDefault();
      if (!$('#run-btn').disabled && !$('#run-btn').hidden) run();
    });

    showErrors();
    body.appendChild(tr);
  });

  updateCounts();
}

function updateCounts() {
  const pieces = state.items.reduce((s, i) => s + (Number.isInteger(i.qty) && i.qty >= 1 ? i.qty : 0), 0);
  $('#cargo-count').textContent = state.items.length
    ? `${state.items.length} row${state.items.length === 1 ? '' : 's'} · ${piecesWord(pieces)}`
    : 'No items yet';
  $('#cargo-xlsx-btn').disabled = usableItems().length === 0 || hasRowErrors();
  $('#empty-state').hidden = state.items.length > 0;
  $('#cargo-table-wrap').hidden = state.items.length === 0;
}

/* ------------------------------------------------------------------ *
 * Calculation
 * ------------------------------------------------------------------ */

/* Editing the cargo list or the options does NOT recalculate. The packing
   search is synchronous and its cost grows with the piece count, so running
   it on every keystroke is what made a large list lock the tab — and, because
   the list is saved, lock it again on every reload until browser data was
   cleared. Edits now only record the change and mark the shown results out of
   date; pressing Calculate is the one thing that packs. */
let stale = false;

function markStale() {
  updateCounts();
  syncPalletNote();   // the tiling depends on the cargo that just changed
  save();
  stale = true;
  /* A run in flight is now computing the wrong answer, so drop it rather
     than let it finish and overwrite the panel with stale numbers. */
  if (worker) stopWorker();
  syncRunButton();
}

/* The button states the work it is about to do, so a large list announces
   itself before it is run rather than after. */
function syncRunButton() {
  const items = usableItems();
  const pieces = items.reduce((sum, i) => sum + Math.max(1, Math.round(Number(i.qty) || 1)), 0);
  const btn = $('#run-btn');
  const note = $('#run-note');
  const rowsBad = hasRowErrors();
  const setupBad = setupBlocked();
  const tooMany = pieces > MAX_PIECES;
  const blocked = pieces === 0 || rowsBad || setupBad || tooMany;
  btn.disabled = blocked;
  btn.textContent = blocked ? 'Calculate' : `Calculate ${piecesWord(pieces)}`;
  if (setupBad) note.textContent = 'Fix the fields marked above first.';
  else if (rowsBad) note.textContent = 'Fix the values marked in the cargo list first.';
  else if (!pieces) note.textContent = 'Add at least one row with length, width and height.';
  else if (tooMany) note.textContent = `${pieces.toLocaleString()} pieces is over the limit of ${MAX_PIECES.toLocaleString()}. Split the list into shipments.`;
  else {
    const bits = [];
    if (stale && plan) bits.push('Cargo or settings changed — results below are out of date.');
    if (stale && pieces > HEAVY_PIECES) bits.push(`Large list — expect roughly ${roughDuration(pieces)}. Cancel stops it at any time.`);
    note.textContent = bits.join(' ');
  }
  $('#results').classList.toggle('is-stale', stale && !!plan);
  syncDownloads();
}

/* Above this, the run is slow enough to say so first. */
const HEAVY_PIECES = 400;

/* The search time grows with the square of the piece count: measured at about
   6 s for 1,000 pieces, 22 s for 2,000, 45 s for 3,000 and 2 minutes for
   5,000. Past that the wait is long enough that a list is better split into
   shipments, so 5,000 is the limit. */
const MAX_PIECES = 5000;

function roughDuration(pieces) {
  const secs = 6 * (pieces / 1000) ** 2;
  if (secs < 10) return 'a few seconds';
  if (secs < 50) return `${Math.round(secs / 10) * 10} seconds`;
  const mins = Math.max(1, Math.round(secs / 60));
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

/* The downloads carry the plan on screen. While that plan is out of date they
   are switched off, with the reason next to them, so an old plan cannot go
   out under new cargo. The same line says what the PDF cannot print. */
function syncDownloads() {
  const off = !plan || stale;
  $('#pdf-btn').disabled = off;
  $('#xlsx-btn').disabled = off;
  const bits = [];
  if (plan && stale) bits.push('Downloads are off: the results are out of date. Press Calculate first.');
  const tags = state.items.filter((i) => !pdfCanPrint(i.tag || '')).length;
  if (tags) bits.push(`${tags} tag${tags === 1 ? ' has' : 's have'} characters the PDF cannot print; they show as ${PDF_MARKER} there. The Excel files keep them as typed.`);
  const note = $('#download-note');
  note.textContent = bits.join(' ');
  note.hidden = bits.length === 0;

  const warn = $('#project-warn');
  const projectOk = pdfCanPrint(state.project);
  warn.textContent = projectOk ? '' : `The PDF prints Latin letters only; the other characters show as ${PDF_MARKER} there.`;
  warn.hidden = projectOk;
}

/* Rows with a full set of dimensions. Rows with a bad value never get this
   far: Calculate is off while any row shows a message. */
function usableItems() {
  /* srcRow = the row's place in the cargo list. The drawings colour by it, so a
     piece keeps its row's legend colour when rows are skipped or palletised. */
  return state.items
    .map((item, i) => ({ ...item, srcRow: i }))
    .filter((i) => i.length > 0 && i.width > 0 && i.height > 0);
}

/* The pallet spec currently in force, in metres and kg. */
function customPallet() {
  return { id: 'custom', name: 'Custom pallet', ...state.pallet.custom };
}

/* Every pallet the user has ticked, smallest deck first.
 *
 * The ordering is the whole point of the mix-and-match: a small deck tiles a
 * container floor far better than a large one — two EUR pallets fit across a
 * 40 ft container where a 2000 mm skid fits one and wastes the rest of the
 * width — so the smallest deck that can carry an item is the one that should.
 * Larger pallets earn their place only by carrying what the smaller ones
 * physically cannot. */
function candidatePallets() {
  const chosen = PALLET_PRESETS.filter((p) => state.pallet.types.includes(p.id));
  if (state.pallet.useCustom) chosen.push(customPallet());
  if (!chosen.length) chosen.push(PALLET_PRESETS[0]);   // never leave the set empty
  return chosen.sort((a, b) => (a.length * a.width) - (b.length * b.width));
}

/* A skid built to the item's own footprint, for cargo no ticked pallet takes
   (long FCU cartons, AHU sections). Deck height, weight per square metre and
   safe working load are estimates in line with the China skids in the preset
   list (60 kg for 2000 x 1500, 80 kg for 2000 x 2000 = 20 kg per m²); the
   page says so. */
const FIT_SKID = { deck: 0.150, kgPerM2: 20, swl: 2000 };
function fitSkid(item) {
  const mm = (m) => Math.round(m * 1000);
  return {
    id: 'fit',
    name: `made-to-size skid (${mm(item.length)} × ${mm(item.width)})`,
    length: item.length, width: item.width, deck: FIT_SKID.deck,
    weight: Math.round(FIT_SKID.kgPerM2 * item.length * item.width), swl: FIT_SKID.swl,
  };
}

/* The load ceiling for one pallet: the override if set, otherwise that
   pallet's own rating. */
function loadLimitFor(pal) {
  return state.pallet.maxLoad > 0 ? state.pallet.maxLoad : (pal.swl || 1500);
}

/* Build loaded pallets, then hand those to the container packer.
 *
 * This is a two-stage calculation and the stages are genuinely different:
 *
 *   1. TILE  — how many units sit on one deck. Units are laid out in a grid,
 *              trying the deck both ways round and keeping whichever fits
 *              more. Layers are added while the item is stackable and the
 *              load height and safe working load both allow it.
 *   2. PACK  — each loaded pallet becomes one solid box (deck footprint +
 *              handling clearance, deck height + load height, pallet weight +
 *              contents) and those boxes go to the vehicle packer.
 *
 * Two limits worth knowing, because they are standard practice rather than
 * shortcuts:
 *
 *   - ONE ITEM TYPE PER PALLET. Mixed pallets are built to a packing list, not
 *     to a formula, and guessing at them would be worse than not offering it.
 *     An uneven quantity produces one part-filled pallet at the end.
 *   - GRID PATTERNS ONLY. Interlocked layouts (pinwheel, brick) can gain a
 *     unit or two on some footprints. They are not computed here, so a real
 *     pallet may hold slightly more than this says. It will not hold less.
 *
 * Anything too large for the deck is not palletised at all — it is packed
 * loose, which is what actually happens to an AHU section on a job site.
 */
/* Returns the winning grid, not just the count. The drawing renders this
   exact arrangement, so if only the total came back the picture would show a
   layout the calculation never chose. */
function tileLayout(item, pal) {
  const straight = {
    cols: Math.floor(pal.length / item.length),
    rows: Math.floor(pal.width / item.width),
    l: item.length, w: item.width, rotated: false,
  };
  const turned = {
    cols: Math.floor(pal.length / item.width),
    rows: Math.floor(pal.width / item.length),
    l: item.width, w: item.length, rotated: true,
  };
  straight.perLayer = straight.cols * straight.rows;
  turned.perLayer = turned.cols * turned.rows;
  return turned.perLayer > straight.perLayer ? turned : straight;
}

function tilePerLayer(item, pal) {
  return tileLayout(item, pal).perLayer;
}

function palletise(items) {
  const pallets = candidatePallets();
  const clear = Math.max(0, state.pallet.clearance || 0);
  const maxLoadH = Math.max(0.01, state.pallet.maxLoadHeight || 1.8);

  const units = [];
  const loose = [];
  const report = [];

  for (const item of items) {
    const qty = Math.max(1, Math.round(Number(item.qty) || 1));
    const each = Number(item.weight) || 0;

    /* Smallest deck that physically takes the item wins. The list is already
       sorted small-to-large, so the first hit is the answer. */
    const pal = pallets.find((p) => tilePerLayer(item, p) >= 1) || (state.pallet.fit !== false ? fitSkid(item) : null);
    if (!pal) {
      loose.push(item);
      report.push({ tag: item.tag || 'untitled', loose: true });
      continue;
    }

    const layout = tileLayout(item, pal);
    const perLayer = layout.perLayer;
    const layersByHeight = item.stackable ? Math.max(1, Math.floor(maxLoadH / item.height)) : 1;
    const byHeight = perLayer * layersByHeight;
    const limitKg = loadLimitFor(pal);
    const byWeight = each > 0 ? Math.max(1, Math.floor(limitKg / each)) : Infinity;
    const perPallet = Math.max(1, Math.min(byHeight, byWeight, qty));

    const full = Math.floor(qty / perPallet);
    const remainder = qty % perPallet;

    /* `pallet` rides along with the unit so the drawings can open the box up
       again: deck outline, then the individual units in their real grid. It
       is carried through the packer untouched and lands on the placement. */
    const makeUnit = (count, palletQty, partial) => ({
      ...item,
      tag: `${item.tag || 'Item'} on ${pal.name}${partial ? ' (part)' : ''}`,
      length: pal.length + clear,
      width: pal.width + clear,
      height: pal.deck + Math.ceil(count / perLayer) * item.height,
      weight: pal.weight + count * each,
      qty: palletQty,
      pallet: {
        name: pal.name,
        deckL: pal.length,
        deckW: pal.width,
        deck: pal.deck,
        count,
        perLayer,
        cols: layout.cols,
        rows: layout.rows,
        itemL: layout.l,
        itemW: layout.w,
        itemH: item.height,
      },
    });

    if (full > 0) units.push(makeUnit(perPallet, full, false));
    if (remainder > 0) units.push(makeUnit(remainder, 1, true));

    report.push({
      tag: item.tag || 'untitled',
      pallet: pal.name,
      perLayer,
      layers: Math.ceil(perPallet / perLayer),
      perPallet,
      pallets: full + (remainder > 0 ? 1 : 0),
      limitedBy: byWeight < byHeight ? 'weight' : (item.stackable ? 'height' : 'not stackable'),
    });
  }

  return { items: units.concat(loose), report, loose, pallets, clearance: clear };
}

/* What actually goes to the packer. */
function itemsForPacking() {
  const items = usableItems();
  return state.pallet.on ? palletise(items).items : items;
}

let worker = null;
let startedAt = 0;

function showProgress(on) {
  $('#progress').hidden = !on;
  $('#run-btn').hidden = on;
  if (on) setProgress(0, 'Starting…');
}

function setProgress(fraction, label) {
  const pct = Math.round(fraction * 100);
  $('#progress-fill').style.width = `${pct}%`;
  $('#progress-bar').setAttribute('aria-valuenow', String(pct));
  $('#progress-pct').textContent = `${pct}%`;
  if (label) {
    const elapsed = (Date.now() - startedAt) / 1000;
    const secs = Math.round(elapsed);
    /* Time left is the elapsed time scaled by the work still to do. It is an
       estimate, so it is rounded and says "about". */
    let text = label;
    if (secs > 3) {
      text += ` — ${secs} s so far`;
      if (fraction > 0.05 && fraction < 1) {
        const left = elapsed * (1 - fraction) / fraction;
        text += left >= 90 ? `, about ${Math.round(left / 60)} min left`
          : left >= 5 ? `, about ${Math.round(left / 5) * 5} s left` : ', nearly done';
      }
    }
    $('#progress-text').textContent = text;
  }
}

function stopWorker() {
  if (worker) { worker.terminate(); worker = null; }
  showProgress(false);
  syncRunButton();
}

/* Results arrive either from the worker or from the synchronous fallback;
   both land here so there is one place that renders. */
function applyResult(nextPlan, nextFleet) {
  plan = nextPlan;
  numberPieces(plan);
  fleet = nextFleet;
  renderResults();
  stale = false;
  syncDownloads();
}

/* Which rows went loose in the last palletised run, for the notice in the results. */
let looseRun = null;

function run() {
  const items = itemsForPacking();
  looseRun = null;
  if (state.pallet.on) {
    const pz = palletise(usableItems());
    looseRun = { tags: pz.loose.map((r) => r.tag || 'untitled'), rows: pz.report.length };
  }
  const vehicle = activeVehicle();
  syncSetupPanel();

  if (!items.length) {
    plan = null;
    fleet = [];
    $('#results').innerHTML = '<p class="empty">Add cargo, then press Calculate.</p>';
    stale = false;
    stopWorker();
    return;
  }

  if (worker) worker.terminate();
  startedAt = Date.now();

  /* Module workers need an http(s) origin and a reasonably current browser.
     If either is missing, fall back to packing on the main thread — the tab
     freezes as it used to, but the answer is still correct. */
  try {
    worker = new Worker(new URL('./packer-worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }

  if (!worker) {
    setStatusFallback();
    applyResult(packItems(items, vehicle, packOptions()), compareFleet(items, packOptions()));
    syncRunButton();
    return;
  }

  showProgress(true);

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      setProgress(msg.fraction, msg.phase);
    } else if (msg.type === 'done') {
      applyResult(msg.plan, msg.fleet);
      stopWorker();
      notify(`Packed in ${(msg.ms / 1000).toFixed(1)}s.`);
    } else if (msg.type === 'error') {
      stopWorker();
      notify(`The calculation failed: ${msg.message}`, true);
    }
  };

  worker.onerror = (err) => {
    stopWorker();
    notify(`The calculation failed: ${err.message || 'worker error'}`, true);
  };

  worker.postMessage({ items, vehicle, options: packOptions() });
}

/* The fallback path cannot report progress — it blocks the thread it would
   paint on — so it at least says so before it starts. */
function setStatusFallback() {
  notify('Calculating… the page will not respond until this finishes.');
}

/** Give every piece a stable number used by the drawings and the tables. */
function numberPieces(p) {
  for (const load of p.loads) {
    load.placements.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
    load.placements.forEach((piece, i) => { piece.no = i + 1; });
  }
}

/* ------------------------------------------------------------------ *
 * Results rendering
 * ------------------------------------------------------------------ */

function meterRow(label, ratio, value, tone) {
  const row = el('div', 'cc-meter');
  row.appendChild(el('span', null, label));
  const bar = el('div', 'meter');
  const fill = el('span');
  if (tone) fill.className = `is-${tone}`;
  fill.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
  bar.appendChild(fill);
  row.appendChild(bar);
  row.appendChild(el('span', 'cc-val', value));
  return row;
}

function cgTone(percent) {
  if (percent >= 45 && percent <= 55) return { tone: 'good', label: 'balanced' };
  if (percent >= 35 && percent <= 65) return { tone: 'warn', label: 'check lashing' };
  return { tone: 'bad', label: 'reposition load' };
}

function renderResults() {
  const box = $('#results');
  box.innerHTML = '';
  const v = plan.vehicle;
  const s = plan.summary;

  /* KPIs */
  const kpis = el('div', 'stat-grid');
  const cards = [
    [String(s.vehicles), `${v.name}${s.vehicles === 1 ? '' : 's'} required`, true],
    [`${fmt(s.totalCbm)} m³`, 'Total cargo volume'],
    [`${Math.round(s.totalWeight).toLocaleString()} kg`, 'Total gross weight'],
    [pct(s.avgVolumeUse), 'Average space used'],
  ];
  if (state.cost > 0) cards.push([freightText(s.vehicles), 'Estimated freight cost']);
  for (const [value, label, accent] of cards) {
    const card = el('div', 'stat');
    const val = el('div', accent ? 'stat__value cc-headline' : 'stat__value', value);
    card.append(val, el('div', 'stat__label', label));
    kpis.appendChild(card);
  }
  box.appendChild(kpis);

  if (s.strategy) {
    const note = el('p', 'muted cc-strategy');
    note.style.fontSize = '0.8125rem';
    note.textContent = s.strategiesTried > 1
      ? `Best of ${s.strategiesTried} loading orders tried — ${s.strategyLabel} won.`
      : `Loading order: ${s.strategyLabel}.`;
    note.textContent += ` ${clearanceLine()}`;
    box.appendChild(note);
  }

  /* Exceptions first — they change the answer */
  if (plan.rejected.length) {
    const alert = el('div', 'notice notice--danger');
    const body = el('div');
    body.appendChild(el('h3', null, `${plan.rejected.length} piece${plan.rejected.length === 1 ? '' : 's'} cannot ship on this vehicle`));
    const list = el('ul');
    const grouped = new Map();
    for (const r of plan.rejected) {
      const key = `${r.tag} — ${r.reason}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    for (const [key, n] of grouped) list.appendChild(el('li', null, n > 1 ? `${key} (×${n})` : key));
    body.appendChild(list);
    body.appendChild(el('p', null, 'Try a larger vehicle, allow turning on side, or ship these as breakbulk / out-of-gauge.'));
    alert.appendChild(body);
    box.appendChild(alert);
  }

  /* Rows too large for the chosen pallet are packed loose; say so beside the drawings */
  if (looseRun && looseRun.tags.length) {
    const all = looseRun.tags.length === looseRun.rows;
    const alert = el('div', 'notice notice--warning');
    const body = el('div');
    body.appendChild(el('h3', null, all
      ? 'No row fits the chosen pallet'
      : `${looseRun.tags.length} of ${looseRun.rows} rows do not fit the chosen pallet`));
    const shown = looseRun.tags.slice(0, 8).join(', ') + (looseRun.tags.length > 8 ? ` and ${looseRun.tags.length - 8} more` : '');
    body.appendChild(el('p', null, all
      ? 'Every item is larger than the ticked pallets, so all are packed loose. Tick "Made-to-size skid", a larger pallet or a custom pallet to palletise them.'
      : `Packed loose, without a pallet: ${shown}. Tick "Made-to-size skid", a larger pallet or a custom pallet to palletise them.`));
    alert.appendChild(body);
    box.appendChild(alert);
  }

  /* Balance warnings */
  const unbalanced = plan.loads.filter((l) => cgTone(l.cgPercent).tone !== 'good');
  if (unbalanced.length) {
    const alert = el('div', 'notice notice--warning');
    const body = el('div');
    body.appendChild(el('h3', null, `Centre of gravity to review on ${unbalanced.length} vehicle${unbalanced.length === 1 ? '' : 's'}`));
    body.appendChild(el('p', null,
      `Vehicle ${unbalanced.map((l) => l.index).join(', ')} — the load sits outside the 45–55% band (a rule of thumb, not a standard). Redistribute pieces or add lashing before dispatch.`));
    alert.appendChild(body);
    box.appendChild(alert);
  }

  /* Fleet comparison */
  const best = fleet[0];
  if (best) {
    const section = el('section', 'cc-section');
    section.appendChild(el('h3', null, 'Would another vehicle do better?'));
    const table = el('table', 'data');
    table.innerHTML =
      '<thead><tr><th>Vehicle</th><th class="num">Required</th><th class="num">Space used</th><th class="num">Payload used</th><th class="num">Cannot ship</th></tr></thead>';
    const tbody = el('tbody');
    for (const row of fleet.slice(0, 6)) {
      const tr = el('tr');
      if (row.id === v.id) tr.className = 'cc-current';
      tr.innerHTML =
        `<td>${row.name}</td><td class="num">${row.vehicles}</td><td class="num">${pct(row.volumeUse)}</td>` +
        `<td class="num">${pct(row.weightUse)}</td><td class="num">${row.rejectedPieces || '—'}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const scroll = el('div', 'table-wrap');
    scroll.appendChild(table);
    section.appendChild(scroll);
    if (best.id !== v.id && best.vehicles < s.vehicles) {
      section.appendChild(el('p', 'muted',
        `Switching to ${best.name} would bring this down to ${best.vehicles} vehicle${best.vehicles === 1 ? '' : 's'}.`));
    }
    box.appendChild(section);
  }

  /* Per-vehicle cards */
  const section = el('section', 'cc-section');
  section.appendChild(el('h3', null, 'Stowage plan'));
  plan.loads.forEach((load) => section.appendChild(loadCard(load, v)));
  box.appendChild(section);

  /* Colour legend */
  const legend = el('div', 'cc-legend');
  state.items.forEach((item, i) => {
    const entry = el('span');
    const dot = el('i');
    dot.style.background = `var(--color-${tokenFor(i)})`;
    entry.append(dot, document.createTextNode(item.tag || `Item ${i + 1}`));
    legend.appendChild(entry);
  });
  box.appendChild(legend);
}

/* Drawing sizes. Label sizes are in drawing units, so a drawing made 520
   wide and shown 280 wide on a phone would halve them. On a narrow screen
   the drawing is made narrow instead, and labels get a larger minimum. */
const narrowScreen = window.matchMedia('(max-width: 560px)');

function viewOptions() {
  return narrowScreen.matches
    ? { iso: { width: 320, height: 230, pad: 12 }, flat: { width: 320, height: 150, pad: 30 }, minFont: 10 }
    : { iso: {}, flat: {}, minFont: 8 };
}

function loadCard(load, v) {
  const card = el('article', 'cc-load');
  const view = viewOptions();

  const head = el('header');
  head.appendChild(el('h4', null, `Vehicle ${load.index} — ${v.name}`));
  const stats = el('div', 'cc-load-stats');
  stats.append(
    el('span', null, piecesWord(load.pieces)),
    el('span', null, `${fmt(load.cbm)} m³`),
    el('span', null, `${Math.round(load.weight).toLocaleString()} kg`),
    el('span', null, `${fmt(load.usedLength)} m of ${fmt(v.length)} m used`),
  );
  head.appendChild(stats);
  card.appendChild(head);

  const views = el('div', 'cc-views');
  const stacked = load.placements.some((p) => p.z > 1e-6);

  const isoFig = el('figure');
  isoFig.appendChild(el('figcaption', null, '3D view'));
  isoFig.innerHTML += sceneToSvg(isoScene(load, v, view.iso), `Isometric stowage view of vehicle ${load.index}`, view.minFont);
  const isoWrap = el('div', stacked ? 'cc-view' : 'cc-view cc-view--full');
  isoWrap.appendChild(isoFig);
  views.appendChild(isoWrap);

  const planFig = el('figure');
  planFig.appendChild(el('figcaption', null, 'Plan view'));
  planFig.innerHTML += sceneToSvg(planScene(load, v, view.flat), `Plan view of vehicle ${load.index}`, view.minFont);
  const planWrap = el('div', 'cc-view');
  planWrap.appendChild(planFig);
  views.appendChild(planWrap);

  if (stacked) {
    const elevFig = el('figure');
    elevFig.appendChild(el('figcaption', null, 'Side elevation'));
    elevFig.innerHTML += sceneToSvg(elevationScene(load, v, view.flat), `Side elevation of vehicle ${load.index}`, view.minFont);
    const elevWrap = el('div', 'cc-view cc-view--full');
    elevWrap.appendChild(elevFig);
    views.appendChild(elevWrap);
  }
  card.appendChild(views);

  const meters = el('div', 'cc-meters');
  meters.appendChild(meterRow('Space used', load.volumeUse, pct(load.volumeUse),
    load.volumeUse > 0.75 ? 'good' : load.volumeUse < 0.4 ? 'warn' : ''));
  meters.appendChild(meterRow('Payload used', load.weightUse, `${Math.round(load.weight).toLocaleString()} kg`,
    load.weightUse > 0.95 ? 'bad' : load.weightUse > 0.8 ? 'warn' : 'good'));
  const cg = cgTone(load.cgPercent);
  meters.appendChild(meterRow('Centre of gravity', load.cgPercent / 100, `${load.cgPercent}% · ${cg.label}`, cg.tone));
  card.appendChild(meters);

  const details = el('details', 'cc-pieces');
  details.appendChild(el('summary', null, `Piece list for vehicle ${load.index}`));
  const table = el('table', 'data');
  table.innerHTML =
    '<thead><tr><th class="num">#</th><th>Tag</th><th class="num">L×W×H (m)</th><th class="num">Weight (kg)</th>' +
    '<th class="num">Position x, y, z (m)</th><th>Notes</th></tr></thead>';
  const tbody = el('tbody');
  for (const p of load.placements) {
    const notes = [];
    if (p.tilted) notes.push('turned on side');
    if (p.z > 1e-6) notes.push(`stacked at ${fmt(p.z)} m`);
    if (!p.stackable) notes.push('do not stack on top');
    const tr = el('tr');
    const size = enteredSize(p);
    if (Math.abs(p.il - p.rawL) > 1e-6 && !p.tilted) notes.unshift('turned 90°');
    tr.innerHTML =
      `<td class="num">${p.no}</td><td>${escapeHtml(p.tag)}</td>` +
      `<td class="num">${fmt(size.l)} × ${fmt(size.w)} × ${fmt(size.h)}</td>` +
      `<td class="num">${Math.round(p.weight).toLocaleString()}</td>` +
      `<td class="num">${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}</td>` +
      `<td>${notes.join(' · ') || '—'}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  const scroll = el('div', 'table-wrap');
  scroll.appendChild(table);
  details.appendChild(scroll);
  details.appendChild(el('p', 'hint', `${clearanceLine()} Position is the corner nearest the nose, measured from the nose, the near side and the floor.`));
  card.appendChild(details);

  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ------------------------------------------------------------------ *
 * Import / export
 * ------------------------------------------------------------------ */

async function handleFile(file) {
  notify('');
  try {
    let rows;
    if (/\.xlsx$/i.test(file.name)) {
      rows = await readWorkbook(file);
    } else {
      rows = parseCsv(await file.text());
    }
    const result = rowsToItems(rows);
    const shown = result.bad.slice(0, 5).map((b) => `row ${b.row}${b.tag ? ` (${b.tag})` : ''}: ${b.why}`);
    if (result.bad.length > 5) shown.push(`and ${result.bad.length - 5} more`);
    const badText = result.bad.length
      ? `${result.bad.length} row(s) left out — ${shown.join('; ')}.`
      : '';
    if (!result.items.length) throw new Error(`No usable rows were found below the header. ${badText}`.trim());
    const have = state.items.length;
    if (have && !confirm(`Replace the ${have} row${have === 1 ? '' : 's'} in the cargo list with ${file.name}?`)) return;
    state.items = result.items;
    state.unit = 'm';
    renderCargo();
    syncSetupPanel();
    markStale();
    const bits = [`Loaded ${result.items.length} row${result.items.length === 1 ? '' : 's'} from ${file.name}.`];
    if (result.unit === 'mm') bits.push('Dimensions looked like millimetres, so they were converted to metres.');
    if (result.skipped) bits.push(`${result.skipped} row(s) without a full set of dimensions were skipped.`);
    if (badText) bits.push(badText);
    bits.push('Press Calculate to pack it.');
    notify(bits.join(' '));
  } catch (err) {
    notify(err.message || 'That file could not be read.', true);
  }
}

/* --- PDF ---------------------------------------------------------- */

/* The PDF needs numeric colours. They are read from the live design
   tokens; the fallbacks below mirror global.css so a report printed from
   a dark theme still comes out on white paper. If you would rather these
   lived in CSS, add a --print-* token set and I'll read those instead. */
const PRINT_FALLBACK = {
  bg: '#f7f8fa', surface: '#ffffff', primary: '#2f5fff', 'primary-dark': '#1e3fcc',
  accent: '#00c2a8', text: '#14161a', 'text-muted': '#5c6270', border: '#e3e5ea',
  success: '#1fa971', warning: '#e0a100', danger: '#e0432f',
};

function parseColor(value, fallbackHex) {
  const source = String(value || '').trim() || fallbackHex;
  const hex = source.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  const rgb = source.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).map(Number);
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  return parseColor(null, fallbackHex);
}

function printPalette() {
  /* Paper is white, so the report always takes the day colours: the night
     palette is pale and its white piece numbers could not be read on it. The
     theme is switched and put back within this one call, before the browser
     paints, so nothing shows on screen. */
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  const cs = getComputedStyle(root);
  const colors = {};
  for (const [token, fallback] of Object.entries(PRINT_FALLBACK)) {
    colors[token] = parseColor(cs.getPropertyValue(`--color-${token}`), fallback);
  }
  if (theme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  // Keep paper white and ink dark whatever the on-screen theme is.
  const luminance = colors.surface.reduce((a, b) => a + b, 0) / 3;
  if (luminance < 0.5) {
    for (const token of ['bg', 'surface', 'text', 'text-muted', 'border']) {
      colors[token] = parseColor(null, PRINT_FALLBACK[token]);
    }
  }
  return colors;
}

function buildPdf() {
  const v = plan.vehicle;
  const s = plan.summary;
  const doc = new PdfDoc({ colors: printPalette() });
  const M = 40;
  const W = doc.pageWidth - M * 2;
  const title = state.project.trim() || 'Untitled project';
  const stamp = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  let pageNo = 0;

  const startPage = (heading) => {
    doc.addPage();
    pageNo++;
    doc.rect(0, 0, doc.pageWidth, 6, { fill: 'primary' });
    doc.text(title, M, 34, { size: 15, bold: true });
    doc.text(heading, doc.pageWidth - M, 34, { size: 9, color: 'text-muted', align: 'right' });
    doc.line(M, 46, doc.pageWidth - M, 46, { stroke: 'border' });
    doc.text(`DAME Tools Hub · Container & trailer calculator · ${stamp}`, M, doc.pageHeight - 22, { size: 7.5, color: 'text-muted' });
    doc.text(`Page ${pageNo}`, doc.pageWidth - M, doc.pageHeight - 22, { size: 7.5, color: 'text-muted', align: 'right' });
  };

  /* --- summary page --- */
  startPage('Loading summary');
  let y = 74;
  doc.text('Loading summary', M, y, { size: 12, bold: true });
  y += 18;
  y = doc.paragraph(
    `${v.name} · internal ${fmt(v.length)} × ${fmt(v.width)} × ${fmt(v.height)} m · max payload ` +
    `${Math.round(v.payload).toLocaleString()} kg. Stacking ${state.options.allowStacking ? 'allowed' : 'not allowed'}; ` +
    `turning on side ${packOptions().allowTilt ? 'allowed' : 'not allowed'}${state.pallet.on ? ' (cargo is palletised)' : ''}. ${clearanceLine()} ` +
    `Loading order: ${s.strategyLabel}${s.strategiesTried > 1 ? `, the best of ${s.strategiesTried} tried` : ''}.`,
    M, y, W, { size: 9, leading: 12 });
  y += 10;

  const kpi = [
    [String(s.vehicles), 'vehicles required'],
    [`${fmt(s.totalCbm)} m3`, 'total cargo volume'],
    [`${Math.round(s.totalWeight).toLocaleString()} kg`, 'total gross weight'],
    [pct(s.avgVolumeUse), 'average space used'],
  ];
  if (state.cost > 0) kpi.push([freightText(s.vehicles), 'estimated freight cost']);
  const boxW = (W - 10 * (kpi.length - 1)) / kpi.length;
  kpi.forEach(([value, label], i) => {
    const x = M + i * (boxW + 10);
    doc.rect(x, y, boxW, 54, { fill: 'bg', stroke: 'border' });
    doc.text(value, x + 10, y + 26, { size: kpi.length > 4 ? 14 : 17, bold: true, color: i === 0 ? 'primary' : 'text' });
    doc.text(label, x + 10, y + 42, { size: 8, color: 'text-muted' });
  });
  y += 74;

  const rows = [['Vehicle', 'Pieces', 'Volume m3', 'Weight kg', 'Length used m', 'Space used', 'Payload used', 'CG %']];
  for (const l of plan.loads) {
    rows.push([
      `#${l.index}`, String(l.pieces), fmt(l.cbm), Math.round(l.weight).toLocaleString(),
      fmt(l.usedLength), pct(l.volumeUse), pct(l.weightUse), `${l.cgPercent}%`,
    ]);
  }
  const widths = [70, 60, 90, 95, 105, 95, 105, 65];
  const align = ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'];
  /* Every vehicle is listed: the table runs on over as many pages as it needs. */
  const head = rows[0];
  let next = 1;
  while (next < rows.length) {
    const room = Math.max(1, Math.floor((doc.pageHeight - 50 - y) / 15) - 1);
    y = doc.table([head].concat(rows.slice(next, next + room)), M, y, widths, { align });
    next += room;
    if (next < rows.length) { startPage('Loading summary, continued'); y = 70; }
  }
  const roomFor = (height) => { if (y + height > doc.pageHeight - 40) { startPage('Loading summary, continued'); y = 60; } };

  if (plan.rejected.length) {
    roomFor(16 + 14 + Math.min(8, plan.rejected.length) * 11 + 11);
    y += 16;
    doc.text('Pieces that cannot ship on this vehicle', M, y, { size: 10, bold: true, color: 'danger' });
    y += 14;
    const grouped = new Map();
    for (const r of plan.rejected) {
      const key = `${r.tag} — ${r.reason} (${fmt(r.rawL)} × ${fmt(r.rawW)} × ${fmt(r.rawH)} m, ${Math.round(r.weight)} kg)`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    for (const [key, n] of [...grouped].slice(0, 8)) {
      y = doc.paragraph(n > 1 ? `${key} ×${n}` : key, M, y, W, { size: 8.5, leading: 11, color: 'text' });
    }
    if (grouped.size > 8) y = doc.paragraph(`…and ${grouped.size - 8} more lines; the packing list has them all.`, M, y, W, { size: 8.5, leading: 11, color: 'text' });
  }

  if (fleet.length) {
    roomFor(16 + 12 + 6 * 15);
    y += 16;
    {
      doc.text('Alternative vehicles', M, y, { size: 10, bold: true });
      y += 12;
      const cmp = [['Vehicle', 'Required', 'Space used', 'Payload used', 'Cannot ship']];
      for (const row of fleet.slice(0, 5)) {
        cmp.push([row.name, String(row.vehicles), pct(row.volumeUse), pct(row.weightUse), String(row.rejectedPieces || 0)]);
      }
      doc.table(cmp, M, y, [230, 90, 110, 120, 110], { align: ['left', 'right', 'right', 'right', 'right'] });
    }
  }

  /* --- one page per vehicle --- */
  for (const load of plan.loads) {
    startPage(`Vehicle ${load.index} of ${plan.loads.length}`);
    let py = 70;
    doc.text(`Vehicle ${load.index} — ${v.name}`, M, py, { size: 12, bold: true });
    py += 16;
    doc.text(
      `${piecesWord(load.pieces)} · ${fmt(load.cbm)} m3 · ${Math.round(load.weight).toLocaleString()} kg · ` +
      `${pct(load.volumeUse)} space · ${pct(load.weightUse)} payload · CG ${load.cgPercent}%`,
      M, py, { size: 9, color: 'text-muted' });
    py += 16;

    const leftW = 430;
    const rightX = M + leftW + 20;
    const rightW = W - leftW - 20;
    doc.text('3D VIEW', M, py, { size: 7, color: 'text-muted' });
    doc.text('PLAN VIEW', rightX, py, { size: 7, color: 'text-muted' });
    const isoBottom = doc.scene(isoScene(load, v), M, py + 6, leftW);
    const planBottom = doc.scene(planScene(load, v), rightX, py + 6, rightW);
    doc.text('SIDE ELEVATION', rightX, planBottom + 16, { size: 7, color: 'text-muted' });
    doc.scene(elevationScene(load, v), rightX, planBottom + 22, rightW);

    let ty = Math.max(isoBottom, planBottom) + 40;
    const pieceRows = [['#', 'Tag', 'L m', 'W m', 'H m', 'kg', 'x m', 'y m', 'z m', 'Notes']];
    for (const p of load.placements) {
      const notes = [];
      const size = enteredSize(p);
      if (p.tilted) notes.push('turned on side');
      else if (Math.abs(p.il - p.rawL) > 1e-6) notes.push('turned 90°');
      if (p.z > 1e-6) notes.push('stacked');
      if (!p.stackable) notes.push('no stacking on top');
      pieceRows.push([
        String(p.no), p.tag, fmt(size.l), fmt(size.w), fmt(size.h), String(Math.round(p.weight)),
        fmt(p.x), fmt(p.y), fmt(p.z), notes.join(', ') || '',
      ]);
    }
    const pw = [30, 200, 55, 55, 55, 60, 50, 50, 50, 157];
    const pa = ['right', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left'];

    const capacity = Math.max(4, Math.floor((doc.pageHeight - 50 - ty) / 14));
    let cursor = 1;
    let chunk = pieceRows.slice(0, 1).concat(pieceRows.slice(cursor, cursor + capacity));
    doc.table(chunk, M, ty, pw, { align: pa, rowHeight: 14, size: 7.5 });
    cursor += capacity;
    while (cursor < pieceRows.length) {
      startPage(`Vehicle ${load.index} — piece list continued`);
      ty = 70;
      const perPage = Math.floor((doc.pageHeight - 60 - ty) / 14);
      chunk = pieceRows.slice(0, 1).concat(pieceRows.slice(cursor, cursor + perPage));
      doc.table(chunk, M, ty, pw, { align: pa, rowHeight: 14, size: 7.5 });
      cursor += perPage;
    }
  }

  return doc.build();
}

const r3 = (n) => Math.round(n * 1000) / 1000;

function buildPackingList() {
  const v = plan.vehicle;
  const rows = [
    ['Project', state.project || 'Untitled project'],
    ['Vehicle', v.name],
    ['Internal size (m)', v.length, v.width, v.height],
    ['Max payload (kg)', v.payload],
    ['Vehicles required', plan.summary.vehicles],
    ['Clearance between items (mm)', Math.round(state.options.gap * 1000)],
    ['Sizes are as entered. Positions x, y, z include the clearance.'],
    [],
    ['Vehicle', 'Piece', 'Tag', 'Length m', 'Width m', 'Height m', 'Gross kg', 'x m', 'y m', 'z m', 'Notes'],
  ];
  for (const load of plan.loads) {
    for (const p of load.placements) {
      const notes = [];
      const size = enteredSize(p);
      if (p.tilted) notes.push('turned on side');
      else if (Math.abs(p.il - p.rawL) > 1e-6) notes.push('turned 90°');
      if (p.z > 1e-6) notes.push('stacked');
      if (!p.stackable) notes.push('no stacking on top');
      rows.push([load.index, p.no, p.tag, size.l, size.w, size.h, p.weight, r3(p.x), r3(p.y), r3(p.z), notes.join(', ')]);
    }
  }
  if (plan.rejected.length) {
    rows.push([], ['Cannot ship', 'Tag', 'Length m', 'Width m', 'Height m', 'Gross kg', 'Reason']);
    for (const r of plan.rejected) rows.push(['', r.tag, r.rawL, r.rawW, r.rawH, r.weight, r.reason]);
  }
  return buildWorkbook(rows, 'Packing list', [12, 10, 32, 12, 12, 12, 12, 10, 10, 10, 26]);
}

/* ------------------------------------------------------------------ *
 * Example data — the AHU shipment from the original spreadsheet
 * ------------------------------------------------------------------ */

const EXAMPLE = [
  ['FAHU-1 (SECTION 1/6)', 3.9, 1.8, 2.5, 648, 1],
  ['FAHU-1 (SECTION 2/6)', 3.9, 1.0, 2.2, 148, 1],
  ['FAHU-1 (SECTION 3/6)', 3.9, 1.8, 2.5, 1540, 1],
  ['FAHU-1 (SECTION 4/6)', 3.9, 1.3, 2.5, 884, 1],
  ['FAHU-1 (SECTION 5+6/6)', 3.9, 2.3, 2.4, 981, 1],
  ['HRW-3200-EZ-200-1.70', 3.9, 1.0, 2.4, 720, 2],
  ['FAHU-2 (SECTION 1/6)', 3.9, 1.8, 2.5, 574, 1],
  ['FAHU-2 (SECTION 2/6)', 3.9, 1.0, 2.2, 205, 1],
  ['FAHU-2 (SECTION 3/6)', 3.9, 1.8, 2.5, 1436, 1],
  ['FAHU-2 (SECTION 4/6)', 3.9, 1.3, 2.5, 864, 1],
  ['FAHU-2 (SECTION 5+6/6)', 3.9, 2.3, 2.4, 912, 1],
  ['HRW-3200-EZ-200-1.65', 3.9, 1.0, 2.4, 670, 2],
  ['FAHU-3 (SECTION 1/6)', 3.9, 1.8, 2.5, 648, 1],
  ['FAHU-3 (SECTION 2/6)', 3.9, 1.0, 2.2, 148, 1],
  ['FAHU-3 (SECTION 3/6)', 3.9, 1.8, 2.5, 1540, 1],
  ['FAHU-3 (SECTION 4/6)', 3.9, 1.3, 2.5, 884, 8],
  ['FAHU-3 (SECTION 5+6/6)', 3.9, 2.3, 2.4, 981, 1],
  ['HRW-3200-EZ-200-1.70 (FAHU-3)', 3.9, 1.0, 2.4, 720, 2],
];

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function init() {
  restore();
  buildVehicleSelect();
  buildPalletSelect();
  syncSetupPanel();
  renderCargo();

  $('#project').addEventListener('input', (e) => { state.project = e.target.value; save(); syncDownloads(); });

  $('#vehicle').addEventListener('change', (e) => {
    state.vehicleId = e.target.value;
    $('#custom-dims').hidden = state.vehicleId !== 'custom';
    syncSetupPanel();
    markStale();
  });

  for (const [id, key] of [['#c-length', 'length'], ['#c-width', 'width'], ['#c-height', 'height'], ['#c-payload', 'payload']]) {
    $(id).addEventListener('input', (e) => {
      const value = Number(e.target.value);
      const ok = e.target.value !== '' && value > 0;
      if (ok) state.custom[key] = value;
      setFieldError(id, ok ? '' : `Enter a number above 0 (${key === 'payload' ? 'kg' : 'm'}).`);
      syncSetupPanel();
      markStale();
    });
  }

  /* Cost and currency only label the answer, they do not change the packing,
     so results on screen are redrawn rather than marked out of date. */
  const relabel = () => { save(); if (plan && !stale) renderResults(); };
  $('#cost').addEventListener('input', (e) => {
    const value = Number(e.target.value);
    const bad = e.target.validity.badInput || value < 0;
    state.cost = bad ? 0 : value || 0;
    state.costTouched = true;
    setFieldError('#cost', bad ? 'Enter 0 or more. A negative cost is not used.' : '');
    relabel();
  });
  $('#currency').addEventListener('input', (e) => { state.currency = e.target.value; relabel(); });
  $('#opt-stack').addEventListener('change', (e) => { state.options.allowStacking = e.target.checked; markStale(); });
  $('#opt-tilt').addEventListener('change', (e) => { state.options.allowTilt = e.target.checked; markStale(); });
  $('#opt-gap').addEventListener('input', (e) => {
    const value = Number(e.target.value);
    const ok = e.target.value !== '' && value >= 0 && value <= 500;
    if (ok) state.options.gap = value / 1000;
    setFieldError('#opt-gap', ok ? '' : 'Enter 0 to 500 mm.');
    markStale();
  });

  $('#opt-pallet').addEventListener('change', (e) => {
    state.pallet.on = e.target.checked;
    syncSetupPanel();
    markStale();
  });

  $('#pallet-load-h').addEventListener('input', (e) => {
    state.pallet.maxLoadHeight = Math.max(0.01, (Number(e.target.value) || 0) / 1000);
    syncSetupPanel();
    markStale();
  });

  $('#pallet-load-kg').addEventListener('input', (e) => {
    state.pallet.maxLoad = Math.max(0, Number(e.target.value) || 0);
    syncSetupPanel();
    markStale();
  });

  $('#pallet-clearance').addEventListener('input', (e) => {
    state.pallet.clearance = Math.max(0, Number(e.target.value) || 0) / 1000;
    syncSetupPanel();
    markStale();
  });

  for (const [id, key, scale] of [['#pallet-l', 'length', 1000], ['#pallet-w', 'width', 1000],
                                  ['#pallet-h', 'deck', 1000], ['#pallet-kg', 'weight', 1],
                                  ['#pallet-swl', 'swl', 1]]) {
    $(id).addEventListener('input', (e) => {
      const value = Number(e.target.value);
      if (value >= 0) { state.pallet.custom[key] = value / scale; syncSetupPanel(); markStale(); }
    });
  }

  for (const button of document.querySelectorAll('.segmented [data-unit]')) {
    button.addEventListener('click', () => {
      state.unit = button.dataset.unit;
      syncSetupPanel();
      renderCargo();
      save();
    });
  }

  $('#add-row').addEventListener('click', () => {
    state.items.push(blankItem());
    renderCargo();
    const inputs = $('#cargo-body').querySelectorAll('tr:last-child input');
    if (inputs.length) inputs[0].focus();
    markStale();
  });

  $('#clear-btn').addEventListener('click', () => {
    if (state.items.length && !confirm('Remove every row from the cargo list?')) return;
    state.items = [];
    renderCargo();
    notify('');
    save();
    run();          // no items: clears the results panel, packs nothing
  });

  $('#sample-btn').addEventListener('click', () => {
    state.items = EXAMPLE.map(([tag, l, w, h, kg, qty]) => ({
      tag, length: l, width: w, height: h, weight: kg, qty, stackable: true,
    }));
    state.unit = 'm';
    if (!state.project) state.project = 'Example AHU shipment';
    renderCargo();
    syncSetupPanel();
    markStale();
    const pieces = state.items.reduce((s, i) => s + i.qty, 0);
    notify(`Loaded the example AHU shipment — ${pieces} pieces across ${state.items.length} rows. Press Calculate to pack it.`);
  });

  $('#cargo-xlsx-btn').addEventListener('click', () => {
    download(cargoWorkbook(usableItems()), safeFileName(state.project.trim() ? `${state.project} - cargo list` : 'Cargo list', 'Cargo list', 'xlsx'));
  });

  $('#template-btn').addEventListener('click', () => {
    download(templateWorkbook(), 'Container calculator - input sheet.xlsx');
  });

  $('#upload-btn').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = '';
  });

  $('#pdf-btn').addEventListener('click', () => {
    if (!plan) return;
    try {
      download(buildPdf(), safeFileName(state.project, 'Loading report', 'pdf'));
    } catch (err) {
      notify(`The PDF could not be built: ${err.message}`, true);
    }
  });

  $('#xlsx-btn').addEventListener('click', () => {
    if (!plan) return;
    download(buildPackingList(), safeFileName(`${state.project || 'Loading plan'} - packing list`, 'Packing list', 'xlsx'));
  });

  // Drop a sheet anywhere on the page. Text drags are left alone.
  const carriesFile = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  document.addEventListener('dragover', (e) => { if (carriesFile(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!carriesFile(e)) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  $('#run-btn').addEventListener('click', run);

  /* Drawings are sized for the screen they were made on; remake them when
     the page crosses the phone width. */
  narrowScreen.addEventListener('change', () => { if (plan) renderResults(); });

  $('#cancel-btn').addEventListener('click', () => {
    stopWorker();
    notify('Calculation cancelled.');
  });

  /* A restored cargo list is restored as DATA, never as a calculation. This
     is the line that makes a heavy list survivable: reopening the page brings
     the rows back and stops, so the tab is always usable and the previous
     list can be edited or cleared. */
  stale = state.items.length > 0;
  updateCounts();
  syncRunButton();
}

document.addEventListener('DOMContentLoaded', init);
