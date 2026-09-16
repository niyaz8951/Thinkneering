/* Cooling Load Estimator — Thinkneering HVAC calculators
   One project, one or many zones. A single-zone job never sees the multi-zone
   chrome; adding zone 2 reveals it without discarding anything. */
(function () {
  'use strict';
  var H = window.HVAC, U = H.units, ui = H.ui, D = H.data, S = H.solar;
  var store = ui.store('cooling-load');

  var MONTHS = [
    { id: 1, name: 'January' }, { id: 2, name: 'February' }, { id: 3, name: 'March' },
    { id: 4, name: 'April' }, { id: 5, name: 'May' }, { id: 6, name: 'June' },
    { id: 7, name: 'July' }, { id: 8, name: 'August' }, { id: 9, name: 'September' },
    { id: 10, name: 'October' }, { id: 11, name: 'November' }, { id: 12, name: 'December' }
  ];

  var FACES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  /* ------------------------------------------------------------- model */

  function newZone(name) {
    return {
      id: 'z' + Math.random().toString(36).slice(2, 8),
      name: name || 'Zone 1',
      multiplier: 1,
      area: 100,
      height: 3,
      indoorOverride: null,
      faces: { N: { wall: 0, glass: 0 }, NE: { wall: 0, glass: 0 }, E: { wall: 0, glass: 0 },
        SE: { wall: 0, glass: 0 }, S: { wall: 0, glass: 0 }, SW: { wall: 30, glass: 12 },
        W: { wall: 30, glass: 12 }, NW: { wall: 0, glass: 0 } },
      roofArea: 0,
      occupancyType: 'o-office',
      people: 10,
      lightingDensity: 6,
      equipmentDensity: 8,
      infiltrationACH: 0.3,
      ventType: 'v-office'
    };
  }

  function newProject() {
    return {
      name: 'Untitled project',
      locationId: 'dubai',
      location: Object.assign({}, D.LOCATIONS[0]),
      month: 7,
      indoorId: 'office',
      indoor: { db: 23, rh: 50 },
      supplyDT: 11,
      safety: 10,
      groundReflectance: 0.25,
      wallId: 'w-estidama', wallU: 0.32, wallAbs: 0.5,
      roofId: 'r-75', roofU: 0.38, roofAbs: 0.7,
      glassId: 'g-double-lowe', glassU: 1.8, glassSHGC: 0.35,
      shadingId: 's-blinds-light',
      zones: [newZone('Zone 1')],
      activeZone: 0
    };
  }

  var P = store.read(null) || newProject();
  if (!P.zones || !P.zones.length) P = newProject();
  if (P.activeZone >= P.zones.length) P.activeZone = 0;

  function save() { store.write(P); }
  function zone() { return P.zones[P.activeZone]; }
  function multi() { return P.zones.length > 1; }

  /* --------------------------------------------------------- compute */

  function toEngineZone(z) {
    var surfaces = [];
    FACES.forEach(function (f) {
      var face = z.faces[f] || { wall: 0, glass: 0 };
      if (face.wall > 0 || face.glass > 0) {
        surfaces.push({
          orientation: f,
          wallArea: face.wall, wallU: P.wallU, wallAbs: P.wallAbs,
          glassArea: face.glass, glassU: P.glassU, glassSHGC: P.glassSHGC,
          shadingFactor: D.find(D.SHADING, P.shadingId).factor
        });
      }
    });
    if (z.roofArea > 0) {
      surfaces.push({
        orientation: 'H', wallArea: z.roofArea, wallU: P.roofU, wallAbs: P.roofAbs,
        glassArea: 0, glassU: 0, glassSHGC: 0, shadingFactor: 1
      });
    }

    var occ = D.find(D.OCCUPANCY, z.occupancyType);
    var vent = D.find(D.VENTILATION, z.ventType);

    return {
      id: z.id, name: z.name, multiplier: z.multiplier, area: z.area, height: z.height,
      surfaces: surfaces,
      internals: {
        people: z.people, personSensible: occ.sensible, personLatent: occ.latent,
        lightingDensity: z.lightingDensity, equipmentDensity: z.equipmentDensity,
        infiltrationACH: z.infiltrationACH
      },
      ventilation: { perPerson: vent.perPerson, perArea: vent.perArea }
    };
  }

  function computeAll() {
    var proj = {
      location: P.location, month: Number(P.month), indoor: P.indoor,
      supplyDT: P.supplyDT, safety: P.safety, groundReflectance: P.groundReflectance
    };
    return P.zones.map(function (z) { return H.load.computeZone(proj, toEngineZone(z)); });
  }

  /* ------------------------------------------------------------ views */

  function projectPanel() {
    return '<div class="panel"><div class="panel__head"><div>' +
      '<span class="panel__title">Project</span>' +
      '<p class="panel__sub">Design conditions and construction, inherited by every zone.</p></div></div>' +

      '<fieldset class="fieldset"><legend>Design conditions</legend>' +
      ui.row([
        ui.select({ id: 'locationId', label: 'Location', options: D.LOCATIONS, value: P.locationId }),
        ui.select({ id: 'month', label: 'Design month', options: MONTHS, value: P.month })
      ]) +
      ui.row([
        ui.number({ id: 'odb', label: 'Outdoor dry bulb', unit: '°C', value: P.location.db, step: 0.5 }),
        ui.number({ id: 'owb', label: 'Outdoor wet bulb', unit: '°C', value: P.location.wb, step: 0.5 })
      ]) +
      ui.row([
        ui.number({ id: 'range', label: 'Daily range', unit: 'K', value: P.location.range, step: 0.5 }),
        ui.number({ id: 'lat', label: 'Latitude', unit: '°N', value: P.location.lat, step: 0.1 })
      ]) +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Indoor design</legend>' +
      ui.select({ id: 'indoorId', label: 'Space type', options: D.INDOOR, value: P.indoorId }) +
      ui.row([
        ui.number({ id: 'idb', label: 'Indoor dry bulb', unit: '°C', value: P.indoor.db, step: 0.5 }),
        ui.number({ id: 'irh', label: 'Indoor RH', unit: '%', value: P.indoor.rh, step: 1 })
      ]) +
      ui.row([
        ui.number({ id: 'supplyDT', label: 'Supply ΔT', unit: 'K', value: P.supplyDT, step: 0.5, min: 3,
          hint: 'Used for supply airflow. Applies to every zone.' }),
        ui.number({ id: 'safety', label: 'Safety factor', unit: '%', value: P.safety, step: 5, min: 0, max: 50 })
      ]) +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Construction</legend>' +
      ui.select({ id: 'wallId', label: 'External wall', options: D.WALLS, value: P.wallId }) +
      ui.row([
        ui.number({ id: 'wallU', label: 'Wall U-value', unit: 'W/m²K', value: P.wallU, step: 0.01 }),
        ui.number({ id: 'wallAbs', label: 'Wall absorptance', value: P.wallAbs, step: 0.05, min: 0.1, max: 1 })
      ]) +
      ui.select({ id: 'roofId', label: 'Roof', options: D.ROOFS, value: P.roofId }) +
      ui.row([
        ui.number({ id: 'roofU', label: 'Roof U-value', unit: 'W/m²K', value: P.roofU, step: 0.01 }),
        ui.number({ id: 'roofAbs', label: 'Roof absorptance', value: P.roofAbs, step: 0.05, min: 0.1, max: 1 })
      ]) +
      ui.select({ id: 'glassId', label: 'Glazing', options: D.GLAZING, value: P.glassId }) +
      ui.row([
        ui.number({ id: 'glassU', label: 'Glass U-value', unit: 'W/m²K', value: P.glassU, step: 0.05 }),
        ui.number({ id: 'glassSHGC', label: 'Glass SHGC', value: P.glassSHGC, step: 0.01, min: 0.05, max: 1 })
      ]) +
      ui.select({ id: 'shadingId', label: 'Internal shading', options: D.SHADING, value: P.shadingId }) +
      '</fieldset></div>';
  }

  function zonePanel() {
    var z = zone();
    var faceRows = FACES.map(function (f) {
      var face = z.faces[f] || { wall: 0, glass: 0 };
      return '<tr><td>' + S.orientation(f).name + '</td>' +
        '<td><input type="number" step="any" min="0" class="face-input" data-face="' + f + '" data-kind="wall" value="' + face.wall + '" aria-label="' + f + ' wall area"></td>' +
        '<td><input type="number" step="any" min="0" class="face-input" data-face="' + f + '" data-kind="glass" value="' + face.glass + '" aria-label="' + f + ' glass area"></td></tr>';
    }).join('');

    return '<div class="panel"><div class="panel__head"><div>' +
      '<span class="panel__title">Zone</span>' +
      '<p class="panel__sub">Geometry, envelope areas and internal gains for the selected zone.</p></div></div>' +

      '<div class="zone-bar">' +
      '<select id="zonePicker" aria-label="Selected zone">' +
        P.zones.map(function (zz, i) {
          return '<option value="' + i + '"' + (i === P.activeZone ? ' selected' : '') + '>' +
            ui.esc(zz.name) + (zz.multiplier > 1 ? ' ×' + zz.multiplier : '') + '</option>';
        }).join('') +
      '</select>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="addZone">' + TN.icon('plus', 16) + 'Add</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="dupZone">' + TN.icon('copy', 16) + 'Duplicate</button>' +
      (multi() ? '<button type="button" class="btn btn--danger btn--sm" id="delZone">' + TN.icon('trash', 16) + '</button>' : '') +
      '<span class="zone-tag">' + P.zones.length + ' zone' + (multi() ? 's' : '') + '</span>' +
      '</div>' +

      '<fieldset class="fieldset"><legend>Identity &amp; geometry</legend>' +
      ui.row([
        '<div class="field"><label for="zName">Zone name</label>' +
        '<input type="text" id="zName" value="' + ui.esc(z.name) + '"></div>',
        ui.number({ id: 'zMult', label: 'Identical rooms', value: z.multiplier, min: 1, step: 1,
          hint: 'Multiplies this zone rather than duplicating it.' })
      ]) +
      ui.row([
        ui.number({ id: 'zArea', label: 'Floor area', unit: 'm²', value: z.area, min: 1 }),
        ui.number({ id: 'zHeight', label: 'Ceiling height', unit: 'm', value: z.height, min: 1.5, step: 0.1 })
      ]) +
      ui.number({ id: 'zRoof', label: 'Exposed roof area', unit: 'm²', value: z.roofArea, min: 0,
        hint: 'Zero unless the zone is on the top floor.' }) +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Envelope by orientation (m²)</legend>' +
      '<div class="table-wrap"><table class="zone-table">' +
      '<thead><tr><th>Facing</th><th>Wall</th><th>Glass</th></tr></thead>' +
      '<tbody>' + faceRows + '</tbody></table></div>' +
      '<p class="hint">Wall area is the opaque area only — enter glass separately, not as part of the wall.</p>' +
      '</fieldset>' +

      '<fieldset class="fieldset"><legend>Internal gains</legend>' +
      ui.select({ id: 'zOcc', label: 'Occupancy type', options: D.OCCUPANCY, value: z.occupancyType }) +
      ui.row([
        ui.number({ id: 'zPeople', label: 'Occupants', value: z.people, min: 0, step: 1 }),
        ui.number({ id: 'zLight', label: 'Lighting', unit: 'W/m²', value: z.lightingDensity, min: 0, step: 0.5 })
      ]) +
      ui.row([
        ui.number({ id: 'zEquip', label: 'Equipment', unit: 'W/m²', value: z.equipmentDensity, min: 0, step: 1 }),
        ui.number({ id: 'zInfil', label: 'Infiltration', unit: 'ACH', value: z.infiltrationACH, min: 0, step: 0.1 })
      ]) +
      ui.select({ id: 'zVent', label: 'Fresh air basis', options: D.VENTILATION, value: z.ventType }) +
      '</fieldset></div>';
  }

  function shell() {
    return '<div class="calc-layout">' +
      '<div class="calc-col">' + projectPanel() + zonePanel() + '</div>' +
      '<div class="calc-col">' +
        '<div class="panel"><div id="results"></div></div>' +
        '<div class="panel"><div class="panel__head"><div><span class="panel__title">Load breakdown</span>' +
        '<p class="panel__sub" id="breakdown-sub"></p></div></div>' +
        '<div id="breakdown"></div></div>' +
        '<div class="panel"><div class="panel__head"><div><span class="panel__title">24-hour profile</span>' +
        '<p class="panel__sub">Total coil load across the design day. Where a zone peaks is why block load matters.</p></div></div>' +
        '<div id="profile"></div></div>' +
        '<div id="rollup"></div>' +
        '<div id="notes"></div>' +
      '</div></div>';
  }

  /* ---------------------------------------------------------- render */

  function render() {
    document.getElementById('app').innerHTML = shell();
    bind();
    calculate();
  }

  function calculate() {
    var results;
    try { results = computeAll(); }
    catch (e) { ui.html('results', ui.notice('Calculation failed: ' + e.message, 'danger')); return; }

    var z = results[P.activeZone];
    var total = H.load.rollup(results);

    ui.html('results',
      '<div class="result-primary-row">' +
        ui.primary(U.fmt(z.coilTotal, 1), 'kW', (multi() ? z.name + ' — ' : '') + 'peak coil load',
          U.fmt(z.coilTotal / 3.516853, 1) + ' TR  ·  peaks at ' +
          (z.peakHour < 10 ? '0' + z.peakHour : z.peakHour) + ':00') +
        ui.primary(U.fmt(z.supplyFlow, 0), 'L/s', 'Supply airflow',
          U.fmt(U.convert(z.supplyFlow, 'L/s', 'cfm'), 0) + ' cfm at ' + U.fmt(P.supplyDT, 1) + ' K ΔT') +
      '</div>' +
      ui.metrics([
        { label: 'Room sensible', value: U.fmt(z.roomSensible, 2), unit: 'kW', emphasis: true },
        { label: 'Room latent', value: U.fmt(z.roomLatent, 2), unit: 'kW', emphasis: true },
        { label: 'Room total', value: U.fmt(z.roomTotal, 2), unit: 'kW' },
        { label: 'Fresh air sensible', value: U.fmt(z.freshSensible, 2), unit: 'kW' },
        { label: 'Fresh air latent', value: U.fmt(z.freshLatent, 2), unit: 'kW' },
        { label: 'Fresh airflow', value: U.fmt(z.freshFlow, 0), unit: 'L/s' },
        { label: 'Sensible heat ratio', value: U.fmt(z.shr, 3) },
        { label: 'Supply temperature', value: U.fmt(z.supplyTemp, 1), unit: '°C' },
        { label: 'Load intensity', value: U.fmt(z.wPerM2, 0), unit: 'W/m²' },
        { label: 'Area per ton', value: U.fmt(z.m2PerTR, 1), unit: 'm²/TR' },
        { label: 'Outdoor at peak', value: U.fmt(z.outdoorAtPeak, 1), unit: '°C' },
        { label: 'Zone area', value: U.fmt(z.area, 0), unit: 'm²' }
      ]));

    var items = z.breakdown.map(function (b) { return { name: b.name, value: b.value }; });
    document.getElementById('breakdown-sub').textContent =
      'Components at the peak hour, ' + (z.peakHour < 10 ? '0' + z.peakHour : z.peakHour) + ':00.';
    ui.html('breakdown', H.charts.breakdown(items));

    ui.html('profile', H.charts.profile([
      { name: 'Coil total', values: z.profile, color: 'var(--chart-1)' },
      { name: 'Room load', values: z.roomProfile, color: 'var(--chart-2)' }
    ], { peakHour: z.peakHour }) +
      '<ul class="chart-legend">' +
      '<li><span class="chart-legend__dot" style="background:var(--chart-1)"></span>Coil total (incl. fresh air)</li>' +
      '<li><span class="chart-legend__dot" style="background:var(--chart-2)"></span>Room load only</li></ul>');

    ui.html('rollup', multi() ? rollupPanel(results, total) : '');
    ui.html('notes', notesBlock());
    save();
  }

  function rollupPanel(results, total) {
    var rows = results.map(function (r) {
      return '<tr><td>' + ui.esc(r.name) + (r.multiplier > 1 ? ' ×' + r.multiplier : '') + '</td>' +
        '<td class="num">' + U.fmt(r.area, 0) + '</td>' +
        '<td class="num">' + U.fmt(r.roomSensible, 1) + '</td>' +
        '<td class="num">' + U.fmt(r.roomLatent, 1) + '</td>' +
        '<td class="num">' + U.fmt(r.coilTotal, 1) + '</td>' +
        '<td class="num">' + U.fmt(r.wPerM2, 0) + '</td>' +
        '<td class="num">' + U.fmt(r.supplyFlow, 0) + '</td>' +
        '<td class="num">' + (r.peakHour < 10 ? '0' + r.peakHour : r.peakHour) + ':00</td></tr>';
    }).join('');

    return '<div class="panel">' +
      '<div class="panel__head"><div><span class="panel__title">Project rollup</span>' +
      '<p class="panel__sub">Zone peaks size the terminal units. The block load sizes central plant.</p></div>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="exportCsv">' + TN.icon('download', 16) + 'CSV</button></div>' +

      '<div class="result-primary-row" style="margin-bottom:var(--space-4)">' +
        ui.primary(U.fmt(total.blockPeak, 1), 'kW', 'Block (coincident) load',
          U.fmt(total.tons, 1) + ' TR at ' + (total.blockPeakHour < 10 ? '0' + total.blockPeakHour : total.blockPeakHour) + ':00') +
        ui.primary(U.fmt(total.sumOfPeaks, 1), 'kW', 'Sum of zone peaks',
          'Diversity ' + U.fmt(total.diversity, 3) + ' — using this to size plant oversizes it by ' +
          U.fmt((1 / total.diversity - 1) * 100, 0) + '%') +
      '</div>' +

      '<div class="table-wrap"><table class="zone-table">' +
      '<thead><tr><th>Zone</th><th class="num">m²</th><th class="num">Sens kW</th>' +
      '<th class="num">Lat kW</th><th class="num">Coil kW</th><th class="num">W/m²</th>' +
      '<th class="num">L/s</th><th class="num">Peak</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td>Block total</td><td class="num">' + U.fmt(total.area, 0) + '</td>' +
      '<td class="num">' + U.fmt(total.roomSensible, 1) + '</td>' +
      '<td class="num">' + U.fmt(total.roomLatent, 1) + '</td>' +
      '<td class="num">' + U.fmt(total.blockPeak, 1) + '</td>' +
      '<td class="num">' + U.fmt(total.wPerM2, 0) + '</td>' +
      '<td class="num">' + U.fmt(total.supplyFlow, 0) + '</td>' +
      '<td class="num">' + (total.blockPeakHour < 10 ? '0' + total.blockPeakHour : total.blockPeakHour) + ':00</td></tr></tfoot>' +
      '</table></div>' +

      '<div style="margin-top:var(--space-4)">' +
      H.charts.profile([{ name: 'Block load', values: total.block, color: 'var(--chart-1)' }],
        { peakHour: total.blockPeakHour }) + '</div></div>';
  }

  function notesBlock() {
    return ui.formulas('Method, formulas & limits', [
      { equation: 'Q_opaque = U × A × (T_sol-air − T_indoor)',
        note: 'Wall and roof conduction driven by sol-air temperature, computed for each of the 24 hours.' },
      { equation: 'T_sol-air = T_outdoor + (α × E_t / h_o) − ΔR / h_o',
        note: 'Sol-air temperature. α is surface absorptance, E_t the total irradiance on that surface, h_o the outdoor film coefficient taken as 17 W/m²K. The ΔR term (3.9 K) applies to surfaces facing the sky.' },
      { equation: 'Q_glass_solar = A × SHGC × F_shading × E_t',
        note: 'Solar gain through glazing. Internal shading enters only as a multiplier.' },
      { equation: 'E_dn = A / exp(B / sin β)',
        note: 'ASHRAE clear-sky direct normal irradiance, with monthly A and B coefficients. Solar altitude β comes from standard declination and hour-angle geometry.' },
      { equation: 'Q_fresh_sens = 1.2 × V × 1.006 × ΔT / 1000',
        note: 'Fresh air sensible load. Fresh air is charged to the coil, not the room — that separation is what lets terminal units be sized correctly.' },
      { equation: 'Block load = max over h of Σ_zones Q_zone(h)',
        note: 'Zone profiles are summed hour by hour before the maximum is taken. Adding zone peaks instead would oversize central plant, because zones do not peak together.' }
    ], [
      'NO THERMAL MASS. Conduction responds instantly to sol-air temperature, with no conduction time series lag. On heavy GCC construction this over-predicts the peak — conservative for sizing, but not equivalent to an RTS or heat-balance calculation.',
      'NO EXTERNAL SHADING GEOMETRY. Overhangs, fins and adjacent buildings are represented only through the shading factor. On a deeply recessed façade this over-predicts solar gain significantly.',
      'Clear-sky irradiance, not measured or TMY data.',
      'A single design month is calculated. The true peak month is not searched for — on a heavily south-glazed façade the peak may fall outside the month you selected.',
      'Design conditions, U-values and gain densities in the built-in library are starting points only. Confirm every one against the project basis of design before use.',
      'Fan heat gain, duct gain, duct leakage and plenum returns are not included.',
      'This is a sizing estimator for early design and equipment selection. It does not replace a full load model where one is contractually required.'
    ]);
  }

  /* ---------------------------------------------------------- events */

  function syncProjectFromInputs() {
    var loc = ui.val('locationId');
    if (loc !== P.locationId) {
      P.locationId = loc;
      var preset = D.find(D.LOCATIONS, loc);
      P.location = Object.assign({}, preset);
      render();
      return true;
    }
    P.location.db = ui.val('odb');
    P.location.wb = ui.val('owb');
    P.location.range = ui.val('range');
    P.location.lat = ui.val('lat');
    P.month = Number(ui.val('month'));

    var ind = ui.val('indoorId');
    if (ind !== P.indoorId) {
      P.indoorId = ind;
      var ip = D.find(D.INDOOR, ind);
      P.indoor = { db: ip.db, rh: ip.rh };
      render();
      return true;
    }
    P.indoor.db = ui.val('idb');
    P.indoor.rh = ui.val('irh');
    P.supplyDT = ui.val('supplyDT');
    P.safety = ui.val('safety');

    var pairs = [['wallId', D.WALLS, 'wallU', 'u', 'wallAbs', 'absorptance'],
      ['roofId', D.ROOFS, 'roofU', 'u', 'roofAbs', 'absorptance'],
      ['glassId', D.GLAZING, 'glassU', 'u', 'glassSHGC', 'shgc']];
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i], cur = ui.val(p[0]);
      if (cur !== P[p[0]]) {
        P[p[0]] = cur;
        var item = D.find(p[1], cur);
        P[p[2]] = item[p[3]];
        P[p[4]] = item[p[5]];
        render();
        return true;
      }
    }
    P.wallU = ui.val('wallU'); P.wallAbs = ui.val('wallAbs');
    P.roofU = ui.val('roofU'); P.roofAbs = ui.val('roofAbs');
    P.glassU = ui.val('glassU'); P.glassSHGC = ui.val('glassSHGC');
    P.shadingId = ui.val('shadingId');
    return false;
  }

  function syncZoneFromInputs() {
    var z = zone();
    z.name = ui.text('zName') || z.name;
    z.multiplier = Math.max(1, Math.round(ui.val('zMult', 1)));
    z.area = ui.val('zArea');
    z.height = ui.val('zHeight');
    z.roofArea = ui.val('zRoof');

    var occ = ui.val('zOcc');
    if (occ !== z.occupancyType) {
      z.occupancyType = occ;
      var o = D.find(D.OCCUPANCY, occ);
      z.people = Math.max(1, Math.round(z.area / o.density));
      render();
      return true;
    }
    z.people = ui.val('zPeople');
    z.lightingDensity = ui.val('zLight');
    z.equipmentDensity = ui.val('zEquip');
    z.infiltrationACH = ui.val('zInfil');
    z.ventType = ui.val('zVent');

    Array.prototype.forEach.call(document.querySelectorAll('.face-input'), function (el) {
      var f = el.dataset.face, k = el.dataset.kind;
      if (!z.faces[f]) z.faces[f] = { wall: 0, glass: 0 };
      z.faces[f][k] = U.num(el.value, 0);
    });
    return false;
  }

  function bind() {
    var app = document.getElementById('app');
    var timer = null;
    app.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (syncProjectFromInputs()) return;
        if (syncZoneFromInputs()) return;
        calculate();
      }, 90);
    });
    app.addEventListener('change', function () {
      if (syncProjectFromInputs()) return;
      if (syncZoneFromInputs()) return;
      calculate();
    });

    document.getElementById('zonePicker').addEventListener('change', function () {
      P.activeZone = Number(this.value);
      save(); render();
    });
    document.getElementById('addZone').addEventListener('click', function () {
      P.zones.push(newZone('Zone ' + (P.zones.length + 1)));
      P.activeZone = P.zones.length - 1;
      save(); render();
    });
    document.getElementById('dupZone').addEventListener('click', function () {
      var copy = JSON.parse(JSON.stringify(zone()));
      copy.id = 'z' + Math.random().toString(36).slice(2, 8);
      copy.name = zone().name + ' (copy)';
      P.zones.push(copy);
      P.activeZone = P.zones.length - 1;
      save(); render();
    });
    var del = document.getElementById('delZone');
    if (del) del.addEventListener('click', function () {
      if (P.zones.length <= 1) return;
      P.zones.splice(P.activeZone, 1);
      P.activeZone = Math.max(0, P.activeZone - 1);
      save(); render();
    });
    var exp = document.getElementById('exportCsv');
    if (exp) exp.addEventListener('click', exportCsv);
  }

  function exportCsv() {
    var results = computeAll();
    var total = H.load.rollup(results);
    var rows = [
      ['Thinkneering — Cooling Load Estimate'],
      ['Location', P.location.name || P.locationId, 'Design month', P.month],
      ['Outdoor DB/WB (C)', P.location.db, P.location.wb, 'Daily range (K)', P.location.range],
      ['Indoor DB/RH', P.indoor.db, P.indoor.rh, 'Safety factor (%)', P.safety],
      [],
      ['Zone', 'Mult', 'Area m2', 'Room sens kW', 'Room lat kW', 'FA sens kW', 'FA lat kW',
        'Coil kW', 'TR', 'W/m2', 'Supply L/s', 'FA L/s', 'SHR', 'Peak hour']
    ];
    results.forEach(function (r) {
      rows.push([r.name, r.multiplier, U.fmt(r.area, 0), U.fmt(r.roomSensible, 2),
        U.fmt(r.roomLatent, 2), U.fmt(r.freshSensible, 2), U.fmt(r.freshLatent, 2),
        U.fmt(r.coilTotal, 2), U.fmt(r.coilTotal / 3.516853, 2), U.fmt(r.wPerM2, 0),
        U.fmt(r.supplyFlow, 0), U.fmt(r.freshFlow, 0), U.fmt(r.shr, 3), r.peakHour + ':00']);
    });
    rows.push([]);
    rows.push(['Sum of zone peaks (kW)', U.fmt(total.sumOfPeaks, 2)]);
    rows.push(['Block coincident load (kW)', U.fmt(total.blockPeak, 2), 'at', total.blockPeakHour + ':00']);
    rows.push(['Diversity factor', U.fmt(total.diversity, 3)]);
    rows.push([]);
    rows.push(['Method: steady-state envelope conduction on sol-air temperature, hourly across a design day.']);
    rows.push(['No thermal mass, no external shading geometry, clear-sky irradiance, single design month.']);
    rows.push(['Sizing estimate for early design. Confirm all inputs against the project basis of design.']);
    ui.download('cooling-load-estimate.csv', ui.csv(rows));
  }

  render();
})();
