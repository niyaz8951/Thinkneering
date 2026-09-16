/* Psychrometrics & Coil — Thinkneering HVAC calculators */
(function () {
  'use strict';
  var H = window.HVAC, U = H.units, ui = H.ui;
  var store = ui.store('psychrometrics');
  var saved = store.read({});
  var tab = 'state';

  var INPUT_PAIRS = [
    { id: 'rh', name: 'Dry bulb + relative humidity' },
    { id: 'twb', name: 'Dry bulb + wet bulb' },
    { id: 'tdp', name: 'Dry bulb + dew point' },
    { id: 'w', name: 'Dry bulb + humidity ratio' }
  ];

  function shell() {
    return '' +
    '<div class="calc-col calc-col--sticky">' +
      '<div class="panel" id="inputs">' +
        '<div class="tab-bar" role="tablist">' +
          '<button type="button" role="tab" data-tab="state" aria-selected="true">Air state</button>' +
          '<button type="button" role="tab" data-tab="coil" aria-selected="false">Cooling coil</button>' +
        '</div>' +

        '<fieldset class="fieldset"><legend>Site</legend>' +
        ui.row([
          ui.number({ id: 'altitude', label: 'Altitude', unit: 'm', value: saved.altitude != null ? saved.altitude : 0, min: -500, max: 4000 }),
          ui.number({ id: 'pressure', label: 'Pressure', unit: 'Pa', value: '', disabled: true })
        ]) +
        '</fieldset>' +

        '<div id="state-fields">' +
          '<fieldset class="fieldset"><legend>Air state</legend>' +
          ui.select({ id: 'pair', label: 'Known properties', options: INPUT_PAIRS, value: saved.pair || 'rh' }) +
          ui.row([
            ui.number({ id: 'tdb', label: 'Dry bulb', unit: '°C', value: saved.tdb != null ? saved.tdb : 35, step: 0.1 }),
            ui.number({ id: 'second', label: 'Relative humidity', unit: '%', value: saved.second != null ? saved.second : 50, step: 0.1 })
          ]) +
          '</fieldset>' +
        '</div>' +

        '<div id="coil-fields" hidden>' +
          '<fieldset class="fieldset"><legend>Entering air (mixed)</legend>' +
          ui.row([
            ui.number({ id: 'eTdb', label: 'Entering dry bulb', unit: '°C', value: saved.eTdb != null ? saved.eTdb : 27, step: 0.1 }),
            ui.number({ id: 'eRh', label: 'Entering RH', unit: '%', value: saved.eRh != null ? saved.eRh : 55, step: 0.1 })
          ]) +
          '</fieldset>' +
          '<fieldset class="fieldset"><legend>Leaving air</legend>' +
          ui.row([
            ui.number({ id: 'lTdb', label: 'Leaving dry bulb', unit: '°C', value: saved.lTdb != null ? saved.lTdb : 13, step: 0.1 }),
            ui.number({ id: 'lRh', label: 'Leaving RH', unit: '%', value: saved.lRh != null ? saved.lRh : 92, step: 0.1 })
          ]) +
          '</fieldset>' +
          '<fieldset class="fieldset"><legend>Airflow</legend>' +
          ui.number({ id: 'flow', label: 'Supply airflow', unit: 'L/s', value: saved.flow != null ? saved.flow : 1000, min: 1 }) +
          '</fieldset>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="calc-col">' +
      '<div class="panel"><div id="results"></div></div>' +
      '<div class="panel">' +
        '<div class="panel__head"><div><span class="panel__title">Psychrometric chart</span>' +
        '<p class="panel__sub">Sea-level chart adjusted to your altitude. Hover a point for its full state.</p></div></div>' +
        '<div id="chart"></div>' +
      '</div>' +
      '<div id="notes"></div>' +
    '</div>';
  }

  function secondLabel(pair) {
    return { rh: ['Relative humidity', '%'], twb: ['Wet bulb', '°C'],
      tdp: ['Dew point', '°C'], w: ['Humidity ratio', 'g/kg'] }[pair];
  }

  function stateFromInputs() {
    var pair = ui.val('pair');
    var tdb = ui.val('tdb');
    var second = ui.val('second');
    var p = H.psy.pressureAt(ui.val('altitude'));
    var input = { tdb: tdb };
    if (pair === 'w') input.w = second / 1000; else input[pair] = second;
    return H.psy.state(input, p);
  }

  function stateMetrics(s) {
    return ui.metrics([
      { label: 'Dry bulb', value: U.fmt(s.tdb, 2), unit: '°C', emphasis: true },
      { label: 'Wet bulb', value: U.fmt(s.twb, 2), unit: '°C', emphasis: true },
      { label: 'Dew point', value: U.fmt(s.tdp, 2), unit: '°C' },
      { label: 'Relative humidity', value: U.fmt(s.rh, 1), unit: '%' },
      { label: 'Humidity ratio', value: U.fmt(s.w * 1000, 3), unit: 'g/kg' },
      { label: 'Enthalpy', value: U.fmt(s.h, 2), unit: 'kJ/kg' },
      { label: 'Specific volume', value: U.fmt(s.v, 4), unit: 'm³/kg' },
      { label: 'Density', value: U.fmt(s.rho, 4), unit: 'kg/m³' },
      { label: 'Vapour pressure', value: U.fmt(s.pv, 0), unit: 'Pa' },
      { label: 'Saturation pressure', value: U.fmt(s.pws, 0), unit: 'Pa' },
      { label: 'Degree of saturation', value: U.fmt(s.sat, 3) },
      { label: 'Barometric pressure', value: U.fmt(s.p, 0), unit: 'Pa' }
    ]);
  }

  function renderState() {
    var s;
    try { s = stateFromInputs(); }
    catch (e) { ui.html('results', ui.notice(e.message, 'danger')); return; }

    ui.set('pressure', Math.round(s.p));
    ui.html('results',
      '<div class="result-primary-row">' +
        ui.primary(U.fmt(s.h, 1), 'kJ/kg', 'Enthalpy', 'Per kilogram of dry air') +
        ui.primary(U.fmt(s.w * 1000, 2), 'g/kg', 'Humidity ratio', 'Dew point ' + U.fmt(s.tdp, 1) + ' °C') +
      '</div>' + stateMetrics(s));

    ui.html('chart', H.psyChart.build({
      pressure: s.p,
      points: [{ label: 'State', state: s, color: 'var(--chart-1)' }]
    }));

    ui.html('notes', ui.formulas('Formulas & assumptions', [
      { equation: 'W = 0.621945 · pw / (p − pw)',
        note: 'Humidity ratio from vapour pressure and barometric pressure.' },
      { equation: 'h = 1.006 t + W (2501 + 1.86 t)',
        note: 'Moist air enthalpy in kJ per kilogram of dry air, referenced to 0 °C.' },
      { equation: 'p = 101325 (1 − 2.25577×10⁻⁵ Z)^5.2559',
        note: 'Barometric pressure from altitude Z in metres — this is what shifts the chart away from sea level.' }
    ], [
      'All properties come from PsychroLib, which implements the 2017 ASHRAE Handbook — Fundamentals Chapter 1 formulations.',
      'Humidity inputs above saturation are clamped to the saturation line rather than returning an impossible state.',
      'The chart draws relative humidity, enthalpy and saturation families at your actual barometric pressure.'
    ]));

    store.write(Object.assign(store.read({}), {
      pair: ui.val('pair'), tdb: ui.val('tdb'), second: ui.val('second'),
      altitude: ui.val('altitude')
    }));
  }

  function renderCoil() {
    var p = H.psy.pressureAt(ui.val('altitude'));
    var flow = ui.val('flow');
    var entering, leaving;
    try {
      entering = H.psy.state({ tdb: ui.val('eTdb'), rh: ui.val('eRh') }, p);
      leaving = H.psy.state({ tdb: ui.val('lTdb'), rh: ui.val('lRh') }, p);
    } catch (e) { ui.html('results', ui.notice(e.message, 'danger')); return; }

    ui.set('pressure', Math.round(p));

    if (leaving.tdb >= entering.tdb) {
      ui.html('results', ui.notice('Leaving dry bulb must be below entering dry bulb for a cooling process.', 'warning'));
      ui.html('chart', H.psyChart.build({ pressure: p, points: [
        { label: 'Entering', state: entering }, { label: 'Leaving', state: leaving }] }));
      return;
    }

    var c = H.psy.coil(entering, leaving, flow);
    var adp = H.psy.adp(entering, leaving);
    var water = H.flow ? H.flow.waterFlow(c.total, 5.5, 9) : null;

    ui.html('results',
      '<div class="result-primary-row">' +
        ui.primary(U.fmt(c.total, 1), 'kW', 'Total coil duty',
          U.fmt(c.total / 3.516853, 1) + ' TR  ·  ' + U.fmt(c.total * 3412.14, 0) + ' BTU/h') +
        ui.primary(U.fmt(c.shr, 3), '', 'Sensible heat ratio',
          c.shr > 0.95 ? 'Nearly all sensible — check the latent assumption' : 'Sensible ÷ total') +
      '</div>' +
      ui.metrics([
        { label: 'Sensible duty', value: U.fmt(c.sensible, 2), unit: 'kW', emphasis: true },
        { label: 'Latent duty', value: U.fmt(c.latent, 2), unit: 'kW', emphasis: true },
        { label: 'Apparatus dew point', value: U.fmt(adp, 1), unit: '°C' },
        { label: 'Condensate rate', value: U.fmt(c.condensate, 2), unit: 'kg/h' },
        { label: 'Mass flow (dry air)', value: U.fmt(c.mDot, 3), unit: 'kg/s' },
        { label: 'Airflow', value: U.fmt(flow, 0), unit: 'L/s' },
        { label: 'Airflow', value: U.fmt(U.convert(flow, 'L/s', 'cfm'), 0), unit: 'cfm' },
        { label: 'Entering enthalpy', value: U.fmt(entering.h, 2), unit: 'kJ/kg' },
        { label: 'Leaving enthalpy', value: U.fmt(leaving.h, 2), unit: 'kJ/kg' },
        { label: 'Entering WB', value: U.fmt(entering.twb, 1), unit: '°C' },
        { label: 'Leaving WB', value: U.fmt(leaving.twb, 1), unit: '°C' },
        { label: 'Moisture removed', value: U.fmt((entering.w - leaving.w) * 1000, 2), unit: 'g/kg' }
      ]) +
      (water ? '<p class="hint" style="margin-top:var(--space-3)">At a 5.5 K chilled water ΔT this duty needs about ' +
        U.fmt(water.lps, 2) + ' L/s (' + U.fmt(water.m3h, 1) + ' m³/h) of chilled water.</p>' : ''));

    ui.html('chart', H.psyChart.build({
      pressure: p,
      points: [
        { label: 'Entering', state: entering, color: 'var(--chart-5)' },
        { label: 'Leaving', state: leaving, color: 'var(--chart-1)' }
      ],
      processes: [{ from: entering, to: leaving }]
    }));

    ui.html('notes', ui.formulas('Formulas & assumptions', [
      { equation: 'ṁ = V / v_entering        (kg/s dry air)',
        note: 'Mass flow of dry air from volumetric airflow and the entering specific volume. Using the entering state is the convention — coil ratings are quoted on entering conditions.' },
      { equation: 'Q_total = ṁ (h_entering − h_leaving)',
        note: 'Total coil duty from the enthalpy difference.' },
      { equation: 'Q_sensible = ṁ · cp · (t_entering − t_leaving)',
        note: 'Sensible duty. Latent is the remainder, Q_total − Q_sensible.' },
      { equation: 'SHR = Q_sensible / Q_total',
        note: 'Sensible heat ratio — the slope of the process line on the chart.' }
    ], [
      'The coil process is treated as a straight line between entering and leaving states. Real coils bypass some air, which is why the apparatus dew point is an extrapolation, not a measured surface temperature.',
      'No fan heat gain is added. If the fan is downstream of the coil, add its heat separately.',
      'Condensate is the moisture removed from the airstream, not accounting for drain pan carryover or re-evaporation.',
      'The chilled water note assumes a 5.5 K ΔT at 9 °C mean — change it in the Chilled Water calculator for a real selection.'
    ]));

    store.write(Object.assign(store.read({}), {
      eTdb: ui.val('eTdb'), eRh: ui.val('eRh'), lTdb: ui.val('lTdb'),
      lRh: ui.val('lRh'), flow: flow, altitude: ui.val('altitude')
    }));
  }

  function calculate() {
    if (!H.psy.available()) {
      ui.html('results', ui.notice('The psychrometric library failed to load. Reload the page — if it persists the vendor file at /assets/vendor/psychrolib/psychrolib.js is missing.', 'danger'));
      return;
    }
    if (tab === 'state') renderState(); else renderCoil();
  }

  function syncPair() {
    var pair = ui.val('pair');
    var meta = secondLabel(pair);
    var el = document.getElementById('second');
    if (!el) return;
    var label = el.closest('.field').querySelector('label');
    label.innerHTML = ui.esc(meta[0]) + ' <span class="unit">' + ui.esc(meta[1]) + '</span>';
  }

  document.getElementById('app').innerHTML = shell();

  document.querySelector('.tab-bar').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    tab = btn.dataset.tab;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    document.getElementById('state-fields').hidden = tab !== 'state';
    document.getElementById('coil-fields').hidden = tab !== 'coil';
    calculate();
  });

  document.getElementById('pair').addEventListener('change', syncPair);
  syncPair();
  ui.live('app', calculate);
})();
