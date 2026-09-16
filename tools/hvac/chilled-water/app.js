/* Chilled Water & Pipe Sizing — Thinkneering HVAC calculators */
(function () {
  'use strict';
  var H = window.HVAC, U = H.units, ui = H.ui, F = H.flow;
  var store = ui.store('chilled-water');
  var saved = store.read({});

  function shell() {
    return '' +
    '<div class="calc-col calc-col--sticky"><div class="panel" id="inputs">' +
      '<div class="panel__head"><div><span class="panel__title">Circuit</span>' +
      '<p class="panel__sub">Duty and ΔT set the flow; the limits below select the pipe.</p></div></div>' +

      '<fieldset class="fieldset"><legend>Duty</legend>' +
      ui.row([
        ui.number({ id: 'duty', label: 'Cooling duty', unit: 'kW', value: saved.duty != null ? saved.duty : 100, min: 0.1, step: 1 }),
        ui.number({ id: 'dT', label: 'Water ΔT', unit: 'K', value: saved.dT != null ? saved.dT : 5.5, min: 0.5, step: 0.5 })
      ]) +
      ui.row([
        ui.number({ id: 'tFlow', label: 'Flow temperature', unit: '°C', value: saved.tFlow != null ? saved.tFlow : 6, step: 0.5 }),
        ui.number({ id: 'glycol', label: 'Glycol', unit: '% vol', value: saved.glycol != null ? saved.glycol : 0, min: 0, max: 50, step: 5, hint: 'Ethylene glycol. Raises flow for the same duty.' })
      ]) +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Pipe selection limits</legend>' +
      ui.row([
        ui.number({ id: 'maxVel', label: 'Max velocity', unit: 'm/s', value: saved.maxVel != null ? saved.maxVel : 2.5, min: 0.3, step: 0.1 }),
        ui.number({ id: 'maxRate', label: 'Max friction rate', unit: 'Pa/m', value: saved.maxRate != null ? saved.maxRate : 250, min: 20, step: 10 })
      ]) +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Circuit length</legend>' +
      ui.row([
        ui.number({ id: 'length', label: 'Index run (flow + return)', unit: 'm', value: saved.length != null ? saved.length : 200, min: 0 }),
        ui.number({ id: 'fittingPct', label: 'Fitting allowance', unit: '%', value: saved.fittingPct != null ? saved.fittingPct : 30, min: 0, max: 200, step: 5 })
      ]) +
      ui.row([
        ui.number({ id: 'terminalKpa', label: 'Terminal + valve drop', unit: 'kPa', value: saved.terminalKpa != null ? saved.terminalKpa : 45, min: 0, step: 5 }),
        ui.number({ id: 'pumpEff', label: 'Pump efficiency', unit: '%', value: saved.pumpEff != null ? saved.pumpEff : 70, min: 10, max: 95 })
      ]) +
      '</fieldset>' +
    '</div></div>' +

    '<div class="calc-col">' +
      '<div class="panel"><div id="results"></div></div>' +
      '<div class="panel"><div class="panel__head"><div><span class="panel__title">Pipe options</span>' +
      '<p class="panel__sub">Every standard bore at this flow. The selected size is the smallest meeting both limits.</p></div></div>' +
      '<div class="table-wrap"><table class="zone-table" id="pipe-table"></table></div></div>' +
      '<div id="notes"></div>' +
    '</div>';
  }

  function calculate() {
    var duty = ui.val('duty');
    var dT = ui.val('dT');
    var tFlow = ui.val('tFlow');
    var tMean = tFlow + dT / 2;
    var glycol = ui.val('glycol');

    // Glycol reduces specific heat, so the same duty needs more flow.
    var glycolFactor = 1 + glycol * 0.0045;

    var w = F.waterFlow(duty, dT, tMean);
    var lps = w.lps * glycolFactor;

    var maxVel = ui.val('maxVel');
    var maxRate = ui.val('maxRate');
    var sel = F.selectPipe(lps, maxVel, maxRate, tMean);
    var pick = sel.pick;

    var length = ui.val('length');
    var fittingPct = ui.val('fittingPct');
    var effectiveLength = length * (1 + fittingPct / 100);
    var pipeDrop = pick.rate * effectiveLength / 1000;          // kPa
    var terminal = ui.val('terminalKpa');
    var totalKpa = pipeDrop + terminal;
    var head = F.headFromPressure(totalKpa * 1000, tMean);
    var power = F.pumpPower(lps, head, ui.val('pumpEff') / 100, tMean);

    ui.html('results',
      '<div class="result-primary-row">' +
        ui.primary(U.fmt(lps, 2), 'L/s', 'Water flow rate',
          U.fmt(lps * 3.6, 1) + ' m³/h  ·  ' + U.fmt(lps * 15.8503, 1) + ' US gpm') +
        ui.primary('DN ' + pick.nb, '', 'Selected pipe',
          U.fmt(pick.velocity, 2) + ' m/s at ' + U.fmt(pick.rate, 0) + ' Pa/m') +
      '</div>' +
      ui.metrics([
        { label: 'Mass flow', value: U.fmt(w.mDot * glycolFactor, 2), unit: 'kg/s' },
        { label: 'Internal bore', value: U.fmt(pick.id, 1), unit: 'mm' },
        { label: 'Velocity', value: U.fmt(pick.velocity, 2), unit: 'm/s', emphasis: true },
        { label: 'Friction rate', value: U.fmt(pick.rate, 0), unit: 'Pa/m' },
        { label: 'Per 100 m', value: U.fmt(pick.per100m, 1), unit: 'kPa' },
        { label: 'Effective length', value: U.fmt(effectiveLength, 0), unit: 'm' },
        { label: 'Pipe pressure drop', value: U.fmt(pipeDrop, 1), unit: 'kPa', emphasis: true },
        { label: 'Total circuit drop', value: U.fmt(totalKpa, 1), unit: 'kPa', emphasis: true },
        { label: 'Pump head', value: U.fmt(head, 1), unit: 'm' },
        { label: 'Pump shaft power', value: U.fmt(power, 2), unit: 'kW' },
        { label: 'Mean water temp', value: U.fmt(tMean, 1), unit: '°C' },
        { label: 'Duty', value: U.fmt(duty / 3.516853, 1), unit: 'TR' }
      ]));

    var rows = sel.rows.filter(function (r) { return r.velocity > 0.15 && r.velocity < 6; });
    var table = '<thead><tr><th>Nominal</th><th class="num">Bore</th><th class="num">Velocity</th>' +
      '<th class="num">Pa/m</th><th class="num">kPa/100m</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var status = r.nb === pick.nb
          ? '<span class="chip chip--restricted">Selected</span>'
          : (r.ok ? '<span class="chip chip--free">Acceptable</span>' : '<span class="chip chip--danger">Over limit</span>');
        return '<tr><td>DN ' + r.nb + '</td><td class="num">' + U.fmt(r.id, 1) + '</td>' +
          '<td class="num">' + U.fmt(r.velocity, 2) + '</td><td class="num">' + U.fmt(r.rate, 0) + '</td>' +
          '<td class="num">' + U.fmt(r.per100m, 1) + '</td><td>' + status + '</td></tr>';
      }).join('') + '</tbody>';
    document.getElementById('pipe-table').innerHTML = table;

    var notes = '';
    if (!pick.ok) notes += ui.notice('No standard bore meets both limits at this flow. The largest available size is shown — split the circuit or relax a limit.', 'warning');
    if (pick.velocity < 0.6) notes += ui.notice('Below about 0.6 m/s, air entrainment may not clear from high points. Check air venting on the index run.', 'warning');
    if (glycol > 0) notes += ui.notice('Glycol correction applied as an approximate flow increase of ' + U.fmt((glycolFactor - 1) * 100, 0) + '%. For a real selection, use the manufacturer\u2019s glycol property tables — viscosity also raises the pressure drop beyond what is shown here.', 'warning');

    notes += ui.formulas('Formulas & assumptions', [
      { equation: 'ṁ = Q / (cp × ΔT)      V = ṁ / ρ',
        note: 'Mass flow from duty and temperature difference, converted to volumetric flow through density at the mean water temperature.' },
      { equation: 'ΔP/L = f × (ρ v²) / (2 D)',
        note: 'Darcy-Weisbach with the Colebrook-White friction factor, using an absolute roughness of 0.045 mm for commercial steel.' },
      { equation: 'h = ΔP / (ρ g)',
        note: 'Pump head from total circuit pressure drop.' },
      { equation: 'W = V × ρ × g × h / (1000 × η)',
        note: 'Pump shaft power at the stated efficiency.' }
    ], [
      'Water properties are polynomial fits valid from 0 to 100 °C — accurate well inside what chilled water sizing needs.',
      'Fitting losses are a percentage allowance on straight length, not a fitting-by-fitting calculation. For a final design, build up equivalent lengths properly.',
      'Schedule 40 steel bores. Copper, PPR and HDPE have different internal diameters and will change both velocity and pressure drop.',
      'The glycol correction is a flow approximation only. It does not adjust viscosity, so the pressure drop shown is optimistic for glycol systems.',
      'Static lift and expansion vessel pressurisation are not included in the pump head.'
    ]);
    ui.html('notes', notes);

    store.write({
      duty: duty, dT: dT, tFlow: tFlow, glycol: glycol, maxVel: maxVel, maxRate: maxRate,
      length: length, fittingPct: fittingPct, terminalKpa: terminal, pumpEff: ui.val('pumpEff')
    });
  }

  document.getElementById('app').innerHTML = shell();
  ui.live('app', calculate);
})();
