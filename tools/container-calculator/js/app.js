/*
 * app.js — Container & trailer calculator
 * Thinkneering
 */

import { packItems, compareFleet, VEHICLE_PRESETS } from './packer.js';
import { isoScene, planScene, elevationScene, sceneToSvg, tokenFor } from './draw.js';
import { readWorkbook, parseCsv, rowsToItems, templateWorkbook, buildWorkbook } from './xlsx-io.js';
import { PdfDoc } from './pdf.js';

const STORAGE_KEY = 'tn.container-calculator.v1';

const state = {
  project: '',
  vehicleId: 'tr12',
  custom: { length: 12, width: 2.4, height: 3.3, payload: 24000 },
  cost: 0,
  unit: 'm',
  options: { allowStacking: true, allowTilt: false, gap: 0 },
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
      cost: state.cost, unit: state.unit, options: state.options, items: state.items,
    }));
  } catch { /* storage unavailable — the tool still works */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(state, saved, { options: { ...state.options, ...(saved.options || {}) } });
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
  if (node && node !== document.activeElement) node.value = value;
}

function syncSetupPanel() {
  setValue('#project', state.project);
  setValue('#vehicle', state.vehicleId);
  setValue('#cost', state.cost || '');
  $('#opt-stack').checked = state.options.allowStacking;
  $('#opt-tilt').checked = state.options.allowTilt;
  setValue('#opt-gap', Math.round(state.options.gap * 1000));
  setValue('#c-length', state.custom.length);
  setValue('#c-width', state.custom.width);
  setValue('#c-height', state.custom.height);
  setValue('#c-payload', state.custom.payload);
  $('#custom-dims').hidden = state.vehicleId !== 'custom';
  for (const button of document.querySelectorAll('.segmented [data-unit]')) {
    button.setAttribute('aria-pressed', String(button.dataset.unit === state.unit));
  }

  const v = activeVehicle();
  $('#vehicle-hint').textContent =
    `Internal ${fmt(v.length)} × ${fmt(v.width)} × ${fmt(v.height)} m · payload ${Math.round(v.payload).toLocaleString()} kg`;
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

    const tagCell = el('td', 'col-tag');
    const swatch = el('span', 'cc-swatch');
    swatch.style.background = `var(--color-${tokenFor(i)})`;
    const tagInput = el('input');
    tagInput.type = 'text';
    tagInput.value = item.tag;
    tagInput.placeholder = `Item ${i + 1}`;
    tagInput.setAttribute('aria-label', `Tag for row ${i + 1}`);
    tagInput.addEventListener('input', () => { item.tag = tagInput.value; scheduleRun(); });
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
      input.addEventListener('input', () => { item[key] = fromDisplay(input.value) || 0; scheduleRun(); });
      td.appendChild(input);
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
    wInput.addEventListener('input', () => { item.weight = Number(wInput.value) || 0; scheduleRun(); });
    wTd.appendChild(wInput);
    tr.appendChild(wTd);

    const qTd = el('td', 'num');
    const qInput = el('input');
    qInput.type = 'number';
    qInput.min = '1';
    qInput.step = '1';
    qInput.inputMode = 'numeric';
    qInput.value = item.qty;
    qInput.setAttribute('aria-label', `Quantity for row ${i + 1}`);
    qInput.addEventListener('input', () => { item.qty = Math.max(1, Math.round(Number(qInput.value) || 1)); scheduleRun(); });
    qTd.appendChild(qInput);
    tr.appendChild(qTd);

    const sTd = el('td');
    const sInput = el('input');
    sInput.type = 'checkbox';
    sInput.checked = item.stackable;
    sInput.setAttribute('aria-label', `Other items may be stacked on row ${i + 1}`);
    sInput.addEventListener('change', () => { item.stackable = sInput.checked; scheduleRun(); });
    sTd.appendChild(sInput);
    tr.appendChild(sTd);

    const rTd = el('td');
    const remove = el('button', 'btn btn--quiet btn--sm');
    remove.type = 'button';
    remove.innerHTML = window.TN ? window.TN.icon('trash', 18) : '&times;';
    remove.setAttribute('aria-label', `Remove row ${i + 1}${item.tag ? `, ${item.tag}` : ''}`);
    remove.addEventListener('click', () => {
      state.items.splice(i, 1);
      renderCargo();
      scheduleRun();
    });
    rTd.appendChild(remove);
    tr.appendChild(rTd);

    body.appendChild(tr);
  });

  updateCounts();
}

function updateCounts() {
  const pieces = state.items.reduce((s, i) => s + (Number(i.qty) || 1), 0);
  $('#cargo-count').textContent = state.items.length
    ? `${state.items.length} row${state.items.length === 1 ? '' : 's'} · ${pieces} piece${pieces === 1 ? '' : 's'}`
    : 'No items yet';
  $('#empty-state').hidden = state.items.length > 0;
  $('#cargo-table-wrap').hidden = state.items.length === 0;
}

/* ------------------------------------------------------------------ *
 * Calculation
 * ------------------------------------------------------------------ */

let runTimer = null;
function scheduleRun() {
  updateCounts();
  clearTimeout(runTimer);
  runTimer = setTimeout(() => { save(); run(); }, 250);
}

function usableItems() {
  return state.items.filter((i) => i.length > 0 && i.width > 0 && i.height > 0);
}

function run() {
  const items = usableItems();
  const vehicle = activeVehicle();
  syncSetupPanel();

  if (!items.length) {
    plan = null;
    fleet = [];
    $('#results').innerHTML = '<p class="empty">Results appear here as soon as there is cargo to load.</p>';
    $('#pdf-btn').disabled = true;
    $('#xlsx-btn').disabled = true;
    return;
  }

  plan = packItems(items, vehicle, state.options);
  numberPieces(plan);
  fleet = compareFleet(items, state.options);
  renderResults();
  $('#pdf-btn').disabled = false;
  $('#xlsx-btn').disabled = false;
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
  const bar = el('div', 'cc-bar');
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
  if (state.cost > 0) {
    cards[3] = [`${(state.cost * s.vehicles).toLocaleString()}`, 'Estimated freight cost'];
  }
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

  /* Balance warnings */
  const unbalanced = plan.loads.filter((l) => cgTone(l.cgPercent).tone !== 'good');
  if (unbalanced.length) {
    const alert = el('div', 'notice notice--warning');
    const body = el('div');
    body.appendChild(el('h3', null, `Centre of gravity to review on ${unbalanced.length} vehicle${unbalanced.length === 1 ? '' : 's'}`));
    body.appendChild(el('p', null,
      `Vehicle ${unbalanced.map((l) => l.index).join(', ')} — the load sits outside the 45–55% band. Redistribute pieces or add lashing before dispatch.`));
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

function loadCard(load, v) {
  const card = el('article', 'cc-load');

  const head = el('header');
  head.appendChild(el('h4', null, `Vehicle ${load.index} — ${v.name}`));
  const stats = el('div', 'cc-load-stats');
  stats.append(
    el('span', null, `${load.pieces} pieces`),
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
  isoFig.innerHTML += sceneToSvg(isoScene(load, v), `Isometric stowage view of vehicle ${load.index}`);
  const isoWrap = el('div', stacked ? 'cc-view' : 'cc-view cc-view--full');
  isoWrap.appendChild(isoFig);
  views.appendChild(isoWrap);

  const planFig = el('figure');
  planFig.appendChild(el('figcaption', null, 'Plan view'));
  planFig.innerHTML += sceneToSvg(planScene(load, v), `Plan view of vehicle ${load.index}`);
  const planWrap = el('div', 'cc-view');
  planWrap.appendChild(planFig);
  views.appendChild(planWrap);

  if (stacked) {
    const elevFig = el('figure');
    elevFig.appendChild(el('figcaption', null, 'Side elevation'));
    elevFig.innerHTML += sceneToSvg(elevationScene(load, v), `Side elevation of vehicle ${load.index}`);
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
    '<thead><tr><th class="num">#</th><th>Tag</th><th class="num">L×W×H (m)</th><th class="num">Weight</th>' +
    '<th class="num">Position x, y, z</th><th>Notes</th></tr></thead>';
  const tbody = el('tbody');
  for (const p of load.placements) {
    const notes = [];
    if (p.tilted) notes.push('turned on side');
    if (p.z > 1e-6) notes.push(`stacked at ${fmt(p.z)} m`);
    if (!p.stackable) notes.push('do not stack on top');
    const tr = el('tr');
    tr.innerHTML =
      `<td class="num">${p.no}</td><td>${escapeHtml(p.tag)}</td>` +
      `<td class="num">${fmt(p.l)} × ${fmt(p.w)} × ${fmt(p.h)}</td>` +
      `<td class="num">${Math.round(p.weight).toLocaleString()} kg</td>` +
      `<td class="num">${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}</td>` +
      `<td>${notes.join(' · ') || '—'}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  const scroll = el('div', 'table-wrap');
  scroll.appendChild(table);
  details.appendChild(scroll);
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
    if (!result.items.length) throw new Error('No usable rows were found below the header.');
    state.items = result.items;
    state.unit = 'm';
    renderCargo();
    syncSetupPanel();
    save();
    run();
    const bits = [`Loaded ${result.items.length} rows from ${file.name}.`];
    if (result.unit === 'mm') bits.push('Dimensions looked like millimetres, so they were converted to metres.');
    if (result.skipped) bits.push(`${result.skipped} row(s) without a full set of dimensions were skipped.`);
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
  const cs = getComputedStyle(document.documentElement);
  const colors = {};
  for (const [token, fallback] of Object.entries(PRINT_FALLBACK)) {
    colors[token] = parseColor(cs.getPropertyValue(`--color-${token}`), fallback);
  }
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
    doc.text(`Thinkneering · Container & trailer calculator · ${stamp}`, M, doc.pageHeight - 22, { size: 7.5, color: 'text-muted' });
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
    `turning on side ${state.options.allowTilt ? 'allowed' : 'not allowed'}; clearance ${Math.round(state.options.gap * 1000)} mm per item. ` +
    `Loading order: ${s.strategyLabel}${s.strategiesTried > 1 ? `, the best of ${s.strategiesTried} tried` : ''}.`,
    M, y, W, { size: 9, leading: 12 });
  y += 10;

  const boxW = (W - 30) / 4;
  const kpi = [
    [String(s.vehicles), 'vehicles required'],
    [`${fmt(s.totalCbm)} m3`, 'total cargo volume'],
    [`${Math.round(s.totalWeight).toLocaleString()} kg`, 'total gross weight'],
    [pct(s.avgVolumeUse), 'average space used'],
  ];
  if (state.cost > 0) kpi[3] = [(state.cost * s.vehicles).toLocaleString(), 'estimated freight cost'];
  kpi.forEach(([value, label], i) => {
    const x = M + i * (boxW + 10);
    doc.rect(x, y, boxW, 54, { fill: 'bg', stroke: 'border' });
    doc.text(value, x + 10, y + 26, { size: 17, bold: true, color: i === 0 ? 'primary' : 'text' });
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
  y = doc.table(rows.slice(0, 22), M, y, widths, { align });

  if (plan.rejected.length) {
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
  }

  if (fleet.length) {
    y += 16;
    if (y < doc.pageHeight - 140) {
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
      `${load.pieces} pieces · ${fmt(load.cbm)} m3 · ${Math.round(load.weight).toLocaleString()} kg · ` +
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
    const pieceRows = [['#', 'Tag', 'L m', 'W m', 'H m', 'kg', 'x', 'y', 'z', 'Notes']];
    for (const p of load.placements) {
      const notes = [];
      if (p.tilted) notes.push('turned on side');
      if (p.z > 1e-6) notes.push('stacked');
      if (!p.stackable) notes.push('no stacking on top');
      pieceRows.push([
        String(p.no), p.tag, fmt(p.l), fmt(p.w), fmt(p.h), String(Math.round(p.weight)),
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

function buildPackingList() {
  const v = plan.vehicle;
  const rows = [
    ['Project', state.project || 'Untitled project'],
    ['Vehicle', v.name],
    ['Internal size (m)', v.length, v.width, v.height],
    ['Max payload (kg)', v.payload],
    ['Vehicles required', plan.summary.vehicles],
    [],
    ['Vehicle', 'Piece', 'Tag', 'Length m', 'Width m', 'Height m', 'Gross kg', 'x m', 'y m', 'z m', 'Notes'],
  ];
  for (const load of plan.loads) {
    for (const p of load.placements) {
      const notes = [];
      if (p.tilted) notes.push('turned on side');
      if (p.z > 1e-6) notes.push('stacked');
      if (!p.stackable) notes.push('no stacking on top');
      rows.push([load.index, p.no, p.tag, p.l, p.w, p.h, p.weight, p.x, p.y, p.z, notes.join(', ')]);
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
  syncSetupPanel();
  renderCargo();

  $('#project').addEventListener('input', (e) => { state.project = e.target.value; save(); });

  $('#vehicle').addEventListener('change', (e) => {
    state.vehicleId = e.target.value;
    $('#custom-dims').hidden = state.vehicleId !== 'custom';
    scheduleRun();
  });

  for (const [id, key] of [['#c-length', 'length'], ['#c-width', 'width'], ['#c-height', 'height'], ['#c-payload', 'payload']]) {
    $(id).addEventListener('input', (e) => {
      const value = Number(e.target.value);
      if (value > 0) { state.custom[key] = value; scheduleRun(); }
    });
  }

  $('#cost').addEventListener('input', (e) => { state.cost = Number(e.target.value) || 0; scheduleRun(); });
  $('#opt-stack').addEventListener('change', (e) => { state.options.allowStacking = e.target.checked; scheduleRun(); });
  $('#opt-tilt').addEventListener('change', (e) => { state.options.allowTilt = e.target.checked; scheduleRun(); });
  $('#opt-gap').addEventListener('input', (e) => {
    state.options.gap = Math.max(0, Number(e.target.value) || 0) / 1000;
    scheduleRun();
  });

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
    save();
  });

  $('#clear-btn').addEventListener('click', () => {
    if (state.items.length && !confirm('Remove every row from the cargo list?')) return;
    state.items = [];
    renderCargo();
    notify('');
    run();
    save();
  });

  $('#sample-btn').addEventListener('click', () => {
    state.items = EXAMPLE.map(([tag, l, w, h, kg, qty]) => ({
      tag, length: l, width: w, height: h, weight: kg, qty, stackable: true,
    }));
    state.unit = 'm';
    if (!state.project) state.project = 'Example AHU shipment';
    renderCargo();
    syncSetupPanel();
    save();
    run();
    const pieces = state.items.reduce((s, i) => s + i.qty, 0);
    notify(`Loaded the example AHU shipment — ${pieces} pieces across ${state.items.length} rows.`);
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

  run();
}

document.addEventListener('DOMContentLoaded', init);
