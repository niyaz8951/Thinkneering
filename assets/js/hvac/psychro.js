/* Thinkneering — HVAC engine: psychrometrics
   Thin wrapper over PsychroLib (MIT, ASHRAE Handbook Fundamentals Ch.1).
   Everything above this layer asks for a *state* and gets every property back,
   so no calculator has to remember which PsychroLib call it needs. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;

  var lib = window.psychrolib;
  if (lib) lib.SetUnitSystem(lib.SI);

  function available() { return !!lib; }

  /* Solve a full moist-air state from dry bulb + any one humidity parameter.
     input: { tdb, rh (0-100) | twb | tdp | w }, pressure in Pa
     returns: { tdb, twb, tdp, rh, w, h, v, rho, pv, pws, sat } */
  function state(input, pressure) {
    if (!lib) throw new Error('PsychroLib not loaded');
    var p = pressure || U.C.P_ATM;
    var tdb = input.tdb;
    var w;

    if (input.w != null) w = input.w;
    else if (input.rh != null) w = lib.GetHumRatioFromRelHum(tdb, U.clamp(input.rh, 0.01, 100) / 100, p);
    else if (input.twb != null) w = lib.GetHumRatioFromTWetBulb(tdb, Math.min(input.twb, tdb), p);
    else if (input.tdp != null) w = lib.GetHumRatioFromTDewPoint(Math.min(input.tdp, tdb), p);
    else throw new Error('Need one of rh, twb, tdp or w');

    w = Math.max(w, 1e-6);
    var wsat = lib.GetSatHumRatio(tdb, p);
    if (w > wsat) w = wsat;   // clamp to saturation rather than return nonsense

    return {
      tdb: tdb,
      w: w,
      rh: lib.GetRelHumFromHumRatio(tdb, w, p) * 100,
      twb: lib.GetTWetBulbFromHumRatio(tdb, w, p),
      tdp: lib.GetTDewPointFromHumRatio(tdb, w, p),
      h: lib.GetMoistAirEnthalpy(tdb, w) / 1000,          // kJ/kg dry air
      v: lib.GetMoistAirVolume(tdb, w, p),                 // m3/kg dry air
      rho: lib.GetMoistAirDensity(tdb, w, p),              // kg/m3
      pv: lib.GetVapPresFromHumRatio(w, p),                // Pa
      pws: lib.GetSatVapPres(tdb),                         // Pa
      sat: lib.GetDegreeOfSaturation(tdb, w, p),
      p: p
    };
  }

  /* Saturation humidity ratio — used by the chart to draw the 100% RH curve. */
  function satW(tdb, pressure) {
    return lib.GetSatHumRatio(tdb, pressure || U.C.P_ATM);
  }

  /* Humidity ratio at a given dry bulb and RH — chart curve helper. */
  function wAt(tdb, rhPct, pressure) {
    return lib.GetHumRatioFromRelHum(tdb, rhPct / 100, pressure || U.C.P_ATM);
  }

  /* Dry bulb for a given enthalpy and humidity ratio — chart enthalpy lines. */
  function tdbFromHW(hkJ, w) {
    return lib.GetTDryBulbFromEnthalpyAndHumRatio(hkJ * 1000, w);
  }

  /* Atmospheric pressure from altitude (m). */
  function pressureAt(altitude) {
    return lib.GetStandardAtmPressure(altitude || 0);
  }

  /* Mix two air streams by mass. Returns the mixed state.
     Used for the fresh-air / return-air mixing point on the coil. */
  function mix(a, flowA, b, flowB, pressure) {
    var p = pressure || U.C.P_ATM;
    var mA = flowA / (a.v * 1000);   // kg/s dry air, flow in L/s
    var mB = flowB / (b.v * 1000);
    var m = mA + mB;
    if (m <= 0) return a;
    var w = (mA * a.w + mB * b.w) / m;
    var h = (mA * a.h + mB * b.h) / m;
    return state({ tdb: tdbFromHW(h, w), w: w }, p);
  }

  /* Cooling coil process: entering state + leaving state + airflow (L/s).
     Returns total / sensible / latent duty in kW, SHR and condensate rate. */
  function coil(entering, leaving, flowLs) {
    var mDot = flowLs / (entering.v * 1000);           // kg/s dry air
    var total = mDot * (entering.h - leaving.h);        // kW
    var sensible = mDot * U.C.CP_AIR * (entering.tdb - leaving.tdb);
    var latent = total - sensible;
    return {
      total: total,
      sensible: sensible,
      latent: latent,
      shr: total > 0 ? sensible / total : 1,
      condensate: mDot * (entering.w - leaving.w) * 3600,  // kg/h
      mDot: mDot
    };
  }

  /* Apparatus dew point: where the coil process line, extended, meets
     saturation. Iterative walk down the line — cheap and stable. */
  function adp(entering, leaving) {
    var dT = entering.tdb - leaving.tdb;
    if (dT <= 0.01) return leaving.tdb;
    var slope = (entering.w - leaving.w) / dT;
    for (var t = leaving.tdb; t > -5; t -= 0.05) {
      var w = leaving.w - slope * (leaving.tdb - t);
      if (w <= satW(t)) return t;
    }
    return leaving.tdb;
  }

  H.psy = {
    available: available, state: state, satW: satW, wAt: wAt,
    tdbFromHW: tdbFromHW, pressureAt: pressureAt, mix: mix, coil: coil, adp: adp
  };
})();
