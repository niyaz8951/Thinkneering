/* Duct Sizer — Thinkneering HVAC calculators */
(function () {
  'use strict';
  var H = window.HVAC, U = H.units, ui = H.ui, D = H.duct;
  var store = ui.store('duct-sizer');

  var SERVICES = [
    { id: 'main', name: 'Main duct' }, { id: 'branch', name: 'Branch duct' },
    { id: 'terminal', name: 'Terminal / runout' }, { id: 'return', name: 'Return air' },
    { id: 'exhaust', name: 'Exhaust' }
  ];

  var saved = store.read({});

  function shell() {
    return '' +
    '<div class="calc-col calc-col--sticky">' +
      '<div class="panel" id="inputs">' +
        '<div class="panel__head"><div><span class="panel__title">Duct</span>' +
        '<p class="panel__sub">Sizing method, geometry and run length.</p></div></div>' +

        ui.segmented('mode', [
          { value: 'size', label: 'Size a duct' },
          { value: 'check', label: 'Check a size' }
        ], saved.mode || 'size', 'Mode') +

        '<fieldset class="fieldset"><legend>Airflow</legend>' +
        ui.row([
          ui.number({ id: 'flow', label: 'Airflow', unit: 'L/s', value: saved.flow != null ? saved.flow : 500, min: 0 }),
          ui.select({ id: 'service', label: 'Service', options: SERVICES, value: saved.service || 'main' })
        ]) +
        '</fieldset>' +

        '<fieldset class="fieldset" id="size-fields"><legend>Sizing criterion</legend>' +
        ui.segmented('criterion', [
          { value: 'friction', label: 'Equal friction' },
          { value: 'velocity', label: 'Velocity' }
        ], saved.criterion || 'friction') +
        ui.row([
          ui.number({ id: 'rate', label: 'Target friction rate', unit: 'Pa/m', value: saved.rate != null ? saved.rate : 1.0, step: 0.1, min: 0.05 }),
          ui.number({ id: 'targetVel', label: 'Target velocity', unit: 'm/s', value: saved.targetVel != null ? saved.targetVel : 6, step: 0.5, min: 0.5 })
        ]) +
        '</fieldset>' +

        '<fieldset class="fieldset"><legend>Geometry</legend>' +
        ui.segmented('shape', [
          { value: 'round', label: 'Round' },
          { value: 'rect', label: 'Rectangular' }
        ], saved.shape || 'round') +
        '<div id="dims"></div>' +
        '</fieldset>' +

        '<fieldset class="fieldset"><legend>Run &amp; material</legend>' +
        ui.row([
          ui.number({ id: 'length', label: 'Straight length', unit: 'm', value: saved.length != null ? saved.length : 20, min: 0 }),
          ui.number({ id: 'fittingK', label: 'Total fitting K', value: saved.fittingK != null ? saved.fittingK : 2.0, step: 0.1, min: 0, hint: 'Sum of loss coefficients for bends, tees, transitions.' })
        ]) +
        ui.select({ id: 'material', label: 'Duct material', options: D.MATERIALS, value: saved.material || 'gi' }) +
        '</fieldset>' +
      '</div>' +
    '</div>' +

    '<div class="calc-col">' +
      '<div class="panel"><div id="results"></div></div>' +
      '<div class="panel"><div class="panel__head"><div><span class="panel__title">Cross-section</span>' +
      '<p class="panel__sub">Duct shown to scale, arrows scaled to air velocity.</p></div></div>' +
      '<div id="viz"></div></div>' +
      '<div id="notes"></div>' +
    '</div>';
  }

  function dimFields(shape) {
    if (shape === 'round') {
      return ui.number({ id: 'd', label: 'Diameter', unit: 'mm', value: saved.d != null ? saved.d : 315, min: 20 });
    }
    return ui.row([
      ui.number({ id: 'w', label: 'Width', unit: 'mm', value: saved.w != null ? saved.w : 400, min: 50 }),
      ui.number({ id: 'h', label: 'Height', unit: 'mm', value: saved.h != null ? saved.h : 250, min: 50 })
    ]);
  }

  function calculate() {
    var mode = ui.segmentedValue('mode');
    var shape = ui.segmentedValue('shape');
    var criterion = ui.segmentedValue('criterion');
    var flow = ui.val('flow');
    var mat = D.material(ui.val('material'));
    var service = ui.val('service');
    var length = ui.val('length');
    var fittingK = ui.val('fittingK');

    var opts = {
      flow: flow, shape: shape, length: length,
      fittingK: fittingK, roughness: mat.e
    };

    var sized = null;
    if (mode === 'size') {
      if (criterion === 'friction') sized = D.sizeRound(flow, ui.val('rate'), mat.e);
      else sized = D.sizeRoundByVelocity(flow, ui.val('targetVel'));

      if (shape === 'round') {
        opts.d = sized.standard;
        ui.set('d', sized.standard);
      } else {
        var height = ui.val('h', 250);
        var rect = D.rectForEquiv(sized.standard, height);
        opts.w = rect.w; opts.h = rect.h;
        ui.set('w', rect.w);
      }
    } else {
      if (shape === 'round') opts.d = ui.val('d');
      else { opts.w = ui.val('w'); opts.h = ui.val('h'); }
    }

    var r = D.analyse(opts);
    var check = D.velocityCheck(r.velocity, service);

    var dimText = shape === 'round'
      ? 'Ø' + U.fmt(r.dims.d, 0) + ' mm'
      : U.fmt(r.dims.w, 0) + ' × ' + U.fmt(r.dims.h, 0) + ' mm';

    var results =
      '<div class="result-primary-row">' +
        ui.primary(dimText, '', mode === 'size' ? 'Selected duct size' : 'Duct size',
          mode === 'size' ? 'Next standard size at or above the calculated requirement' : null) +
        ui.primary(U.fmt(r.total, 1), 'Pa', 'Total pressure drop',
          U.fmt(r.straight, 1) + ' Pa friction + ' + U.fmt(r.fittings, 1) + ' Pa fittings') +
      '</div>' +
      ui.metrics([
        { label: 'Velocity', value: U.fmt(r.velocity), unit: 'm/s', emphasis: true },
        { label: 'Velocity', value: U.fmt(U.convert(r.velocity, 'm/s', 'fpm'), 0), unit: 'fpm' },
        { label: 'Friction rate', value: U.fmt(r.rate, 2), unit: 'Pa/m' },
        { label: 'Velocity pressure', value: U.fmt(r.vp, 1), unit: 'Pa' },
        { label: 'Equivalent diameter', value: U.fmt(r.De * 1000, 0), unit: 'mm' },
        { label: 'Hydraulic diameter', value: U.fmt(r.Dh * 1000, 0), unit: 'mm' },
        { label: 'Reynolds number', value: U.fmt(r.re, 0), unit: r.regime },
        { label: 'Friction factor', value: U.fmt(r.f, 4) },
        { label: 'Cross-section', value: U.fmt(r.area, 3), unit: 'm²' },
        { label: 'Airflow', value: U.fmt(U.convert(ui.val('flow'), 'L/s', 'cfm'), 0), unit: 'cfm' }
      ]);

    ui.html('results', results);
    ui.html('viz', H.charts.ductViz(r, shape));

    var notes = ui.notice(check.message, check.level === 'ok' ? 'success' : 'warning');
    if (shape === 'rect' && r.dims.aspect > 4) {
      notes += ui.notice('Aspect ratio is ' + U.fmt(r.dims.aspect, 1) + ':1. Above about 4:1 the ' +
        'equivalent-diameter method loses accuracy and the duct costs more to make. Consider a deeper section.', 'warning');
    }
    notes += ui.formulas('Formulas & assumptions', [
      { equation: 'ΔP = f · (L / De) · (ρ V² / 2)',
        note: 'Darcy-Weisbach. De is the equivalent diameter, ρ is air density taken as 1.2 kg/m³, V is the mean velocity.' },
      { equation: '1/√f = −2 log₁₀( ε / 3.7De + 2.51 / Re√f )',
        note: 'Colebrook-White, solved iteratively and seeded with the Swamee-Jain explicit approximation. Below Re 2300 the laminar relation f = 64/Re is used instead.' },
      { equation: 'De = 1.30 (a b)^0.625 / (a + b)^0.25',
        note: 'Huebscher equivalent diameter — the round duct with the same friction rate at the same airflow.' },
      { equation: 'ΔP_fitting = K · (ρ V² / 2)',
        note: 'Fitting losses from the summed loss coefficient K applied to the velocity pressure.' }
    ], [
      'Standard air density of 1.2 kg/m³ at sea level, roughly 20 °C. No altitude or temperature correction is applied.',
      'Straight-duct friction only, plus whatever K you enter. This is not a fitting-by-fitting analysis.',
      'Duct leakage, acoustic lining thickness and terminal device losses are not included.',
      'Equivalent diameter is unreliable above about a 4:1 aspect ratio.'
    ]);
    ui.html('notes', notes);

    store.write({
      mode: mode, shape: shape, criterion: criterion, flow: ui.val('flow'),
      service: ui.val('service'), rate: ui.val('rate'), targetVel: ui.val('targetVel'),
      d: ui.val('d', 315), w: ui.val('w', 400), h: ui.val('h', 250),
      length: length, fittingK: fittingK, material: ui.val('material')
    });
  }

  function syncMode() {
    var sizing = ui.segmentedValue('mode') === 'size';
    var crit = ui.segmentedValue('criterion');
    document.getElementById('size-fields').hidden = !sizing;
    var rate = document.getElementById('rate');
    var vel = document.getElementById('targetVel');
    if (rate) rate.closest('.field').hidden = crit !== 'friction';
    if (vel) vel.closest('.field').hidden = crit !== 'velocity';
  }

  document.getElementById('app').innerHTML = shell();
  ui.html('dims', dimFields(saved.shape || 'round'));

  ui.bindSegmented('mode', function () { syncMode(); calculate(); });
  ui.bindSegmented('criterion', function () { syncMode(); calculate(); });
  ui.bindSegmented('shape', function (v) { ui.html('dims', dimFields(v)); calculate(); });

  syncMode();
  ui.live('app', calculate);
})();
