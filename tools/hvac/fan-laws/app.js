/* Fan Laws — Thinkneering HVAC calculators */
(function () {
  'use strict';
  var H = window.HVAC, U = H.units, ui = H.ui, F = H.flow;
  var store = ui.store('fan-laws');
  var saved = store.read({});

  function shell() {
    return '' +
    '<div class="calc-col calc-col--sticky"><div class="panel" id="inputs">' +
      '<div class="panel__head"><div><span class="panel__title">Duty point</span>' +
      '<p class="panel__sub">The known operating point the laws scale from.</p></div></div>' +

      '<fieldset class="fieldset"><legend>Known duty</legend>' +
      ui.row([
        ui.number({ id: 'flow1', label: 'Airflow', unit: 'L/s', value: saved.flow1 != null ? saved.flow1 : 2000, min: 1 }),
        ui.number({ id: 'pressure1', label: 'Total pressure', unit: 'Pa', value: saved.pressure1 != null ? saved.pressure1 : 500, min: 1 })
      ]) +
      ui.row([
        ui.number({ id: 'speed1', label: 'Fan speed', unit: 'rpm', value: saved.speed1 != null ? saved.speed1 : 1450, min: 1 }),
        ui.number({ id: 'efficiency', label: 'Fan efficiency', unit: '%', value: saved.efficiency != null ? saved.efficiency : 65, min: 5, max: 100 })
      ]) +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>New condition</legend>' +
      ui.segmented('driver', [
        { value: 'speed', label: 'New speed' },
        { value: 'flow', label: 'New airflow' },
        { value: 'ratio', label: 'Speed ratio' }
      ], saved.driver || 'flow', 'Scale by') +
      '<div id="d-speed" hidden>' +
      ui.number({ id: 'speed2', label: 'New fan speed', unit: 'rpm', value: saved.speed2 != null ? saved.speed2 : 1200, min: 1 }) + '</div>' +
      '<div id="d-flow">' +
      ui.number({ id: 'flow2', label: 'Required airflow', unit: 'L/s', value: saved.flow2 != null ? saved.flow2 : 1600, min: 1 }) + '</div>' +
      '<div id="d-ratio" hidden>' +
      ui.number({ id: 'ratio', label: 'Speed ratio N₂/N₁', value: saved.ratio != null ? saved.ratio : 0.8, min: 0.05, step: 0.05 }) + '</div>' +
      ui.number({ id: 'diaRatio', label: 'Impeller diameter ratio D₂/D₁', value: saved.diaRatio != null ? saved.diaRatio : 1, min: 0.1, step: 0.05, hint: 'Leave at 1 unless comparing geometrically similar fans of different size.' }) +
      '</fieldset>' +
    '</div></div>' +

    '<div class="calc-col">' +
      '<div class="panel"><div id="results"></div></div>' +
      '<div class="panel"><div class="panel__head"><div><span class="panel__title">System curve</span>' +
      '<p class="panel__sub">Pressure rises with the square of flow, so both duty points sit on the same parabola.</p></div></div>' +
      '<div id="chart"></div></div>' +
      '<div id="notes"></div>' +
    '</div>';
  }

  function calculate() {
    var driver = ui.segmentedValue('driver');
    var base = {
      flow: ui.val('flow1'), pressure: ui.val('pressure1'),
      speed: ui.val('speed1'), power: 0
    };
    var eta = ui.val('efficiency') / 100;
    base.power = F.fanPower(base.flow, base.pressure, eta);
    var dia = ui.val('diaRatio', 1) || 1;

    var ratio;
    if (driver === 'speed') ratio = ui.val('speed2') / Math.max(base.speed, 1);
    else if (driver === 'flow') ratio = ui.val('flow2') / Math.max(base.flow, 1) / Math.pow(dia, 3);
    else ratio = ui.val('ratio');

    var out = F.fanLaws(base, ratio, dia);
    var saving = base.power > 0 ? (1 - out.power / base.power) * 100 : 0;

    ui.html('results',
      '<div class="result-primary-row">' +
        ui.primary(U.fmt(out.flow, 0), 'L/s', 'New airflow',
          U.fmt(U.convert(out.flow, 'L/s', 'cfm'), 0) + ' cfm at ' + U.fmt(out.speed, 0) + ' rpm') +
        ui.primary(U.fmt(out.power, 2), 'kW', 'New shaft power',
          (saving >= 0 ? U.fmt(saving, 0) + '% less than' : U.fmt(-saving, 0) + '% more than') + ' the original duty') +
      '</div>' +
      ui.metrics([
        { label: 'Speed ratio', value: U.fmt(ratio, 3), emphasis: true },
        { label: 'New total pressure', value: U.fmt(out.pressure, 0), unit: 'Pa', emphasis: true },
        { label: 'New speed', value: U.fmt(out.speed, 0), unit: 'rpm' },
        { label: 'Original power', value: U.fmt(base.power, 2), unit: 'kW' },
        { label: 'Power change', value: U.fmt(out.power - base.power, 2), unit: 'kW' },
        { label: 'Original pressure', value: U.fmt(base.pressure, 0), unit: 'Pa' },
        { label: 'New pressure', value: U.fmt(U.convert(out.pressure, 'Pa', 'inWG'), 3), unit: 'in.WG' },
        { label: 'Diameter ratio', value: U.fmt(dia, 2) }
      ]));

    ui.html('chart', H.charts.fanCurve(
      F.systemCurve(base.flow, base.pressure),
      [{ name: 'Original', flow: base.flow, pressure: base.pressure },
       { name: 'New', flow: out.flow, pressure: out.pressure }]
    ));

    var notes = '';
    if (ratio > 1.3) notes += ui.notice('Speeding a fan up by more than about 30% roughly doubles its power draw and can exceed the motor rating and the impeller\u2019s maximum safe speed. Check both before committing.', 'warning');
    if (ratio < 0.4) notes += ui.notice('Below about 40% speed many centrifugal fans leave their stable operating region and belt-driven units may stall. Confirm the turndown against the fan curve.', 'warning');

    notes += ui.formulas('Fan laws & assumptions', [
      { equation: 'V₂ / V₁ = (N₂ / N₁) · (D₂ / D₁)³',
        note: 'Airflow scales linearly with speed, and with the cube of impeller diameter for geometrically similar fans.' },
      { equation: 'P₂ / P₁ = (N₂ / N₁)² · (D₂ / D₁)²',
        note: 'Pressure scales with the square of speed. This is why a small speed cut gives a large pressure drop.' },
      { equation: 'W₂ / W₁ = (N₂ / N₁)³ · (D₂ / D₁)⁵',
        note: 'Power scales with the cube of speed — a 20% speed reduction cuts power by roughly half. This is the whole argument for variable speed drives.' },
      { equation: 'W (kW) = V (m³/s) × ΔP (Pa) / (1000 × η)',
        note: 'Shaft power from airflow, total pressure and fan efficiency.' }
    ], [
      'The laws hold only while the system curve is unchanged. Opening a damper, changing a filter or altering the duct moves the system curve and the laws no longer apply.',
      'Air density is assumed constant between the two points. At different temperature or altitude, pressure and power scale with density as well.',
      'Fan efficiency is assumed unchanged. In reality it varies across the operating range, so treat the new power as an estimate until checked against the fan curve.',
      'Motor and drive losses are not included — this is shaft power, not absorbed electrical power.'
    ]);
    ui.html('notes', notes);

    store.write({
      driver: driver, flow1: base.flow, pressure1: base.pressure, speed1: base.speed,
      efficiency: ui.val('efficiency'), speed2: ui.val('speed2'), flow2: ui.val('flow2'),
      ratio: ui.val('ratio'), diaRatio: dia
    });
  }

  function syncDriver() {
    var d = ui.segmentedValue('driver');
    document.getElementById('d-speed').hidden = d !== 'speed';
    document.getElementById('d-flow').hidden = d !== 'flow';
    document.getElementById('d-ratio').hidden = d !== 'ratio';
  }

  document.getElementById('app').innerHTML = shell();
  ui.bindSegmented('driver', function () { syncDriver(); calculate(); });
  syncDriver();
  ui.live('app', calculate);
})();
