/* Airflow & Air Changes — Thinkneering HVAC calculators */
(function () {
  'use strict';
  var H = window.HVAC, U = H.units, ui = H.ui, F = H.flow;
  var store = ui.store('airflow');
  var saved = store.read({});

  var FLOW_UNITS = [
    { id: 'L/s', name: 'L/s' }, { id: 'm3/h', name: 'm³/h' },
    { id: 'cfm', name: 'cfm' }, { id: 'm3/s', name: 'm³/s' }
  ];

  function shell() {
    return '' +
    '<div class="calc-col calc-col--sticky"><div class="panel" id="inputs">' +
      '<div class="panel__head"><div><span class="panel__title">Inputs</span>' +
      '<p class="panel__sub">Enter what you know — everything else is derived.</p></div></div>' +

      '<fieldset class="fieldset"><legend>Airflow</legend>' +
      ui.segmented('driver', [
        { value: 'flow', label: 'Known airflow' },
        { value: 'load', label: 'From a load' },
        { value: 'ach', label: 'From air changes' }
      ], saved.driver || 'flow', 'Start from') +
      '<div id="driver-flow">' +
      ui.row([
        ui.number({ id: 'flow', label: 'Airflow', value: saved.flow != null ? saved.flow : 500, min: 0 }),
        ui.select({ id: 'flowUnit', label: 'Unit', options: FLOW_UNITS, value: saved.flowUnit || 'L/s' })
      ]) + '</div>' +
      '<div id="driver-load" hidden>' +
      ui.row([
        ui.number({ id: 'load', label: 'Sensible load', unit: 'kW', value: saved.load != null ? saved.load : 5, min: 0, step: 0.1 }),
        ui.number({ id: 'dT', label: 'Supply ΔT', unit: 'K', value: saved.dT != null ? saved.dT : 11, min: 1, step: 0.5 })
      ]) + '</div>' +
      '<div id="driver-ach" hidden>' +
      ui.number({ id: 'achTarget', label: 'Target air changes', unit: 'ACH', value: saved.achTarget != null ? saved.achTarget : 6, min: 0, step: 0.5 }) +
      '</div>' +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Room</legend>' +
      ui.row([
        ui.number({ id: 'area', label: 'Floor area', unit: 'm²', value: saved.area != null ? saved.area : 50, min: 0 }),
        ui.number({ id: 'height', label: 'Ceiling height', unit: 'm', value: saved.height != null ? saved.height : 3, min: 0.5, step: 0.1 })
      ]) +
      ui.row([
        ui.number({ id: 'roomT', label: 'Room setpoint', unit: '°C', value: saved.roomT != null ? saved.roomT : 23, step: 0.5 }),
        ui.number({ id: 'people', label: 'Occupants', value: saved.people != null ? saved.people : 5, min: 0, step: 1 })
      ]) +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Diffuser check</legend>' +
      ui.row([
        ui.number({ id: 'diffusers', label: 'Number of outlets', value: saved.diffusers != null ? saved.diffusers : 2, min: 1, step: 1 }),
        ui.number({ id: 'neckVel', label: 'Target neck velocity', unit: 'm/s', value: saved.neckVel != null ? saved.neckVel : 3, min: 0.5, step: 0.25 })
      ]) +
      '</fieldset>' +
    '</div></div>' +

    '<div class="calc-col">' +
      '<div class="panel"><div id="results"></div></div>' +
      '<div id="notes"></div>' +
    '</div>';
  }

  function calculate() {
    var driver = ui.segmentedValue('driver');
    var area = ui.val('area'), height = ui.val('height');
    var volume = area * height;
    var roomT = ui.val('roomT');
    var dT = ui.val('dT', 11);
    var flowLs;

    if (driver === 'load') {
      flowLs = F.airflowForSensible(ui.val('load'), dT);
    } else if (driver === 'ach') {
      flowLs = F.achToFlow(ui.val('achTarget'), volume);
    } else {
      flowLs = U.convert(ui.val('flow'), ui.val('flowUnit'), 'L/s');
    }

    var ach = F.flowToAch(flowLs, volume);
    var sensible = F.sensibleFromAirflow(flowLs, dT);
    var perPerson = ui.val('people') > 0 ? flowLs / ui.val('people') : 0;
    var perArea = area > 0 ? flowLs / area : 0;
    var diffusers = Math.max(1, ui.val('diffusers', 1));
    var perDiffuser = flowLs / diffusers;
    var neckArea = perDiffuser / 1000 / Math.max(ui.val('neckVel'), 0.1);
    var neckDia = Math.sqrt(4 * neckArea / Math.PI) * 1000;

    ui.html('results',
      '<div class="result-primary-row">' +
        ui.primary(U.fmt(flowLs, 1), 'L/s', 'Airflow',
          U.fmt(U.convert(flowLs, 'L/s', 'cfm'), 0) + ' cfm  ·  ' + U.fmt(U.convert(flowLs, 'L/s', 'm3/h'), 0) + ' m³/h') +
        ui.primary(U.fmt(ach, 1), 'ACH', 'Air changes per hour',
          'Room volume ' + U.fmt(volume, 1) + ' m³') +
      '</div>' +
      ui.metrics([
        { label: 'L/s', value: U.fmt(flowLs, 1), emphasis: true },
        { label: 'm³/h', value: U.fmt(U.convert(flowLs, 'L/s', 'm3/h'), 1) },
        { label: 'cfm', value: U.fmt(U.convert(flowLs, 'L/s', 'cfm'), 1) },
        { label: 'm³/s', value: U.fmt(U.convert(flowLs, 'L/s', 'm3/s'), 4) },
        { label: 'Sensible capacity', value: U.fmt(sensible, 2), unit: 'kW', emphasis: true },
        { label: 'Supply temperature', value: U.fmt(F.supplyTemp(roomT, dT), 1), unit: '°C' },
        { label: 'Per person', value: U.fmt(perPerson, 1), unit: 'L/s·p' },
        { label: 'Per floor area', value: U.fmt(perArea, 2), unit: 'L/s·m²' },
        { label: 'Per outlet', value: U.fmt(perDiffuser, 1), unit: 'L/s' },
        { label: 'Neck size at target', value: U.fmt(neckDia, 0), unit: 'mm Ø' },
        { label: 'Room volume', value: U.fmt(volume, 1), unit: 'm³' },
        { label: 'Cooling capacity', value: U.fmt(sensible / 3.516853, 2), unit: 'TR' }
      ]));

    var notes = '';
    if (ach > 0 && ach < 4) notes += ui.notice('Under 4 ACH the room may feel stagnant for a comfort application. Check the air distribution rather than only the load.', 'warning');
    if (ach > 20) notes += ui.notice('Above 20 ACH — verify this is intended. Rates this high normally belong to clean rooms, kitchens or high-density equipment spaces.', 'warning');

    notes += ui.formulas('Formulas & assumptions', [
      { equation: 'Q_sensible (kW) = 1.2 × V (L/s) × 1.006 × ΔT / 1000',
        note: 'Sensible capacity of an airstream. The 1.2 is standard air density in kg/m³ and 1.006 is the specific heat of dry air in kJ/kg·K.' },
      { equation: 'V (L/s) = Q / (0.0012 × ΔT)',
        note: 'The same relation rearranged to give the airflow a load needs at a chosen supply ΔT.' },
      { equation: 'ACH = V (L/s) × 3600 / (Volume (m³) × 1000)',
        note: 'Air changes per hour from volumetric flow and room volume.' },
      { equation: 'A_neck = V_outlet / v_target',
        note: 'Neck area for a target face velocity, converted to an equivalent round diameter.' }
    ], [
      'Standard air at 1.2 kg/m³. At high altitude or high supply temperature the density correction matters — use the Psychrometrics calculator for the actual density.',
      'Air changes per hour says nothing about air distribution effectiveness. A room can meet its ACH target and still have dead zones.',
      'Neck sizing here is a first-pass geometric check, not a diffuser selection. Throw, noise and coanda effect come from the manufacturer data.'
    ]);
    ui.html('notes', notes);

    store.write({
      driver: driver, flow: ui.val('flow'), flowUnit: ui.val('flowUnit'),
      load: ui.val('load'), dT: dT, achTarget: ui.val('achTarget'),
      area: area, height: height, roomT: roomT, people: ui.val('people'),
      diffusers: ui.val('diffusers'), neckVel: ui.val('neckVel')
    });
  }

  function syncDriver() {
    var d = ui.segmentedValue('driver');
    document.getElementById('driver-flow').hidden = d !== 'flow';
    document.getElementById('driver-load').hidden = d !== 'load';
    document.getElementById('driver-ach').hidden = d !== 'ach';
  }

  document.getElementById('app').innerHTML = shell();
  ui.bindSegmented('driver', function () { syncDriver(); calculate(); });
  syncDriver();
  ui.live('app', calculate);
})();
