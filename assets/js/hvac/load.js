/* Thinkneering — HVAC engine: cooling load
   Steady-state envelope conduction on sol-air temperature, computed hourly
   across a design day, plus solar, internal and ventilation gains.

   METHOD AND ITS LIMITS — state these on every output:
   - No thermal mass. Conduction responds instantly to sol-air temperature,
     with no conduction time series lag. On heavy GCC construction this runs
     CONSERVATIVE (over-predicts the peak), which is the safe direction for
     equipment sizing but is not a substitute for an RTS or heat-balance run.
   - No external shading geometry. Overhangs and fins are represented only
     through the shading factor.
   - Clear-sky irradiance, not measured or TMY data.
   - Single design month. Peak-month search is not performed.
   This is a sizing estimator for early design and equipment selection.
   It does not replace a full load model where one is contractually required. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;
  var S = H.solar;

  var COMPONENTS = [
    { id: 'walls', name: 'Walls', kind: 'sensible' },
    { id: 'roof', name: 'Roof', kind: 'sensible' },
    { id: 'glassCond', name: 'Glass conduction', kind: 'sensible' },
    { id: 'glassSolar', name: 'Glass solar', kind: 'sensible' },
    { id: 'people', name: 'People (sensible)', kind: 'sensible' },
    { id: 'lighting', name: 'Lighting', kind: 'sensible' },
    { id: 'equipment', name: 'Equipment', kind: 'sensible' },
    { id: 'infilSens', name: 'Infiltration (sensible)', kind: 'sensible' },
    { id: 'peopleLat', name: 'People (latent)', kind: 'latent' },
    { id: 'infilLat', name: 'Infiltration (latent)', kind: 'latent' }
  ];

  var COIL_COMPONENTS = [
    { id: 'freshSens', name: 'Fresh air (sensible)', kind: 'sensible' },
    { id: 'freshLat', name: 'Fresh air (latent)', kind: 'latent' }
  ];

  function zeros() { var a = []; for (var i = 0; i < 24; i++) a.push(0); return a; }

  /* Compute one zone across 24 hours.
     project: { location{lat,db,wb,range,alt}, month, indoor{db,rh}, supplyDT, safety }
     zone:    { name, multiplier, area, height, surfaces[], internals{}, ventilation{} }

     surfaces[] entries:
       { orientation:'N'|'NE'|...|'H', wallArea, wallU, wallAbs,
         glassArea, glassU, glassSHGC, shadingFactor }
     A roof is a surface with orientation 'H'; its wallArea is the roof area
     and it uses the roof U-value and absorptance. */
  function computeZone(project, zone) {
    var lat = project.location.lat;
    var month = project.month;
    var outdoor = S.outdoorProfile(project.location.db, project.location.range);

    var Ti = project.indoor.db;
    var indoorState = H.psy.state({ tdb: Ti, rh: project.indoor.rh }, H.psy.pressureAt(project.location.alt));
    var outdoorState = H.psy.state(
      { tdb: project.location.db, twb: project.location.wb },
      H.psy.pressureAt(project.location.alt)
    );
    var Wo = outdoorState.w, Wi = indoorState.w;

    var area = zone.area || 0;
    var volume = area * (zone.height || 3);

    var hourly = {};
    COMPONENTS.concat(COIL_COMPONENTS).forEach(function (c) { hourly[c.id] = zeros(); });

    // --- envelope, hour by hour -------------------------------------------
    (zone.surfaces || []).forEach(function (sf) {
      var o = S.orientation(sf.orientation);
      var isRoof = sf.orientation === 'H';
      var tilt = isRoof ? 0 : 90;
      var bucket = isRoof ? 'roof' : 'walls';

      for (var h = 0; h < 24; h++) {
        var To = outdoor[h];
        var irr = S.surfaceIrradiance(lat, month, h, o.azimuth, tilt, project.groundReflectance);

        // Opaque conduction on sol-air temperature.
        if (sf.wallArea > 0 && sf.wallU > 0) {
          var tsa = S.solAir(To, irr.total, sf.wallAbs, 17.0, isRoof);
          hourly[bucket][h] += sf.wallU * sf.wallArea * (tsa - Ti) / 1000;   // kW
        }

        // Glass conduction on air temperature, and solar through the glass.
        if (sf.glassArea > 0) {
          if (sf.glassU > 0) {
            hourly.glassCond[h] += sf.glassU * sf.glassArea * (To - Ti) / 1000;
          }
          var sc = sf.shadingFactor == null ? 1 : sf.shadingFactor;
          hourly.glassSolar[h] += sf.glassArea * sf.glassSHGC * sc * irr.total / 1000;
        }
      }
    });

    // --- internal gains ----------------------------------------------------
    var inn = zone.internals || {};
    var people = inn.people || 0;
    var peopleSens = people * (inn.personSensible || 70) / 1000;
    var peopleLat = people * (inn.personLatent || 45) / 1000;
    var lighting = area * (inn.lightingDensity || 0) / 1000;
    var equipment = area * (inn.equipmentDensity || 0) / 1000;

    var schedule = zone.schedule || defaultSchedule();
    for (var h = 0; h < 24; h++) {
      var f = schedule[h];
      hourly.people[h] = peopleSens * f;
      hourly.peopleLat[h] = peopleLat * f;
      hourly.lighting[h] = lighting * f;
      hourly.equipment[h] = equipment * f;
    }

    // --- infiltration (room load) -----------------------------------------
    var ach = inn.infiltrationACH || 0;
    var infilFlow = H.flow.achToFlow(ach, volume);      // L/s
    for (h = 0; h < 24; h++) {
      var dT = outdoor[h] - Ti;
      hourly.infilSens[h] = U.C.K_SENS * infilFlow * dT;
      hourly.infilLat[h] = U.C.K_LAT * infilFlow * Math.max(Wo - Wi, 0);
    }

    // --- fresh air (coil load, not room load) ------------------------------
    var vent = zone.ventilation || {};
    var freshFlow = vent.flow != null
      ? vent.flow
      : (people * (vent.perPerson || 0) + area * (vent.perArea || 0));
    for (h = 0; h < 24; h++) {
      var dTo = outdoor[h] - Ti;
      hourly.freshSens[h] = U.C.K_SENS * freshFlow * dTo;
      hourly.freshLat[h] = U.C.K_LAT * freshFlow * Math.max(Wo - Wi, 0);
    }

    // --- totals ------------------------------------------------------------
    var safety = 1 + (project.safety || 0) / 100;
    var roomSens = zeros(), roomLat = zeros(), coilTotal = zeros();

    for (h = 0; h < 24; h++) {
      COMPONENTS.forEach(function (c) {
        hourly[c.id][h] *= safety;
        if (c.kind === 'sensible') roomSens[h] += hourly[c.id][h];
        else roomLat[h] += hourly[c.id][h];
      });
      COIL_COMPONENTS.forEach(function (c) { hourly[c.id][h] *= safety; });
      coilTotal[h] = roomSens[h] + roomLat[h] + hourly.freshSens[h] + hourly.freshLat[h];
    }

    // Peak hour is driven by the coil total — that is what sizes equipment.
    var peakHour = 0;
    for (h = 1; h < 24; h++) if (coilTotal[h] > coilTotal[peakHour]) peakHour = h;

    var mult = zone.multiplier || 1;
    var breakdown = COMPONENTS.concat(COIL_COMPONENTS).map(function (c) {
      return {
        id: c.id, name: c.name, kind: c.kind,
        value: hourly[c.id][peakHour] * mult,
        profile: hourly[c.id].map(function (v) { return v * mult; })
      };
    }).filter(function (c) { return Math.abs(c.value) > 0.0001; });

    var rs = roomSens[peakHour] * mult;
    var rl = roomLat[peakHour] * mult;
    var fs = hourly.freshSens[peakHour] * mult;
    var fl = hourly.freshLat[peakHour] * mult;

    var supplyFlow = H.flow.airflowForSensible(rs, project.supplyDT || 11);

    return {
      zoneId: zone.id,
      name: zone.name,
      multiplier: mult,
      area: area * mult,
      peakHour: peakHour,
      outdoorAtPeak: outdoor[peakHour],
      roomSensible: rs,
      roomLatent: rl,
      roomTotal: rs + rl,
      freshSensible: fs,
      freshLatent: fl,
      freshFlow: freshFlow * mult,
      coilTotal: (rs + rl + fs + fl),
      shr: (rs + fs) / Math.max(rs + rl + fs + fl, 1e-6),
      profile: coilTotal.map(function (v) { return v * mult; }),
      roomProfile: roomSens.map(function (v, i) { return (v + roomLat[i]) * mult; }),
      breakdown: breakdown,
      supplyFlow: supplyFlow,
      supplyTemp: Ti - (project.supplyDT || 11),
      wPerM2: area > 0 ? (rs + rl + fs + fl) * 1000 / (area * mult) : 0,
      m2PerTR: (rs + rl + fs + fl) > 0 ? (area * mult) / ((rs + rl + fs + fl) / 3.516853) : 0,
      hourly: hourly,
      outdoorProfile: outdoor
    };
  }

  /* Occupancy / usage schedule. Flat 07:00–19:00 by default — deliberately
     blunt, because a wrong schedule is worse than an obvious one. */
  function defaultSchedule() {
    var s = [];
    for (var h = 0; h < 24; h++) s.push(h >= 7 && h < 19 ? 1 : 0);
    return s;
  }

  /* Roll up a set of computed zones.
     The distinction that matters: the sum of zone peaks oversizes central
     plant, because zones peak at different hours. Block load sums the hourly
     profiles first, then takes the maximum. */
  function rollup(zoneResults) {
    var block = zeros();
    var sumOfPeaks = 0, area = 0, freshFlow = 0, supplyFlow = 0;
    var roomSens = 0, roomLat = 0;

    zoneResults.forEach(function (z) {
      for (var h = 0; h < 24; h++) block[h] += z.profile[h];
      sumOfPeaks += z.coilTotal;
      area += z.area;
      freshFlow += z.freshFlow;
      supplyFlow += z.supplyFlow;
      roomSens += z.roomSensible;
      roomLat += z.roomLatent;
    });

    var peakHour = 0;
    for (var h = 1; h < 24; h++) if (block[h] > block[peakHour]) peakHour = h;
    var blockPeak = block[peakHour];

    return {
      block: block,
      blockPeak: blockPeak,
      blockPeakHour: peakHour,
      sumOfPeaks: sumOfPeaks,
      diversity: sumOfPeaks > 0 ? blockPeak / sumOfPeaks : 1,
      area: area,
      freshFlow: freshFlow,
      supplyFlow: supplyFlow,
      roomSensible: roomSens,
      roomLatent: roomLat,
      tons: blockPeak / 3.516853,
      wPerM2: area > 0 ? blockPeak * 1000 / area : 0,
      m2PerTR: blockPeak > 0 ? area / (blockPeak / 3.516853) : 0
    };
  }

  H.load = {
    COMPONENTS: COMPONENTS, COIL_COMPONENTS: COIL_COMPONENTS,
    computeZone: computeZone, rollup: rollup, defaultSchedule: defaultSchedule
  };
})();
