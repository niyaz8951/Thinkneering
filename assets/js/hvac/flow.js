/* Thinkneering — HVAC engine: airflow, fan laws, hydronics
   Three small closed-form domains that share the same fluid helpers, kept in
   one file rather than three ~40-line ones. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;

  /* ------------------------------------------------------------- airflow */

  /* Airflow required to carry a sensible load at a given supply dT.
     Q(kW) = 1.2 * V(L/s) * cp * dT / 1000  ->  V = Q / (K_SENS * dT) */
  function airflowForSensible(kW, dT) {
    if (dT <= 0) return 0;
    return kW / (U.C.K_SENS * dT);
  }

  function sensibleFromAirflow(flowLs, dT) { return U.C.K_SENS * flowLs * dT; }

  /* Latent load from airflow and humidity ratio difference (kg/kg). */
  function latentFromAirflow(flowLs, dW) { return U.C.K_LAT * flowLs * dW; }

  /* Air changes per hour <-> airflow. Volume in m3, flow in L/s. */
  function achToFlow(ach, volume) { return ach * volume * 1000 / 3600; }
  function flowToAch(flowLs, volume) { return volume > 0 ? flowLs * 3600 / (volume * 1000) : 0; }

  /* Supply temperature implied by a room setpoint and a supply dT. */
  function supplyTemp(roomT, dT) { return roomT - dT; }

  /* --------------------------------------------------------- fan laws */

  /* Affinity laws for a fixed fan in a fixed system:
       V2/V1 = N2/N1        P2/P1 = (N2/N1)^2      W2/W1 = (N2/N1)^3
     Diameter ratio included for completeness (geometrically similar fans). */
  function fanLaws(base, ratio, diameterRatio) {
    var n = ratio, d = diameterRatio == null ? 1 : diameterRatio;
    return {
      flow: base.flow * n * Math.pow(d, 3),
      pressure: base.pressure * n * n * Math.pow(d, 2),
      power: base.power * Math.pow(n, 3) * Math.pow(d, 5),
      speed: base.speed * n
    };
  }

  /* Fan shaft power from airflow and total pressure at a given efficiency.
     W(kW) = V(m3/s) * dP(Pa) / (1000 * eta) */
  function fanPower(flowLs, pressurePa, efficiency) {
    var eta = U.clamp(efficiency || 0.65, 0.05, 1);
    return (flowLs / 1000) * pressurePa / (1000 * eta);
  }

  /* System curve: pressure varies with the square of flow. */
  function systemCurve(designFlow, designPressure, points) {
    var out = [], n = points || 24;
    for (var i = 0; i <= n; i++) {
      var f = designFlow * (i / n) * 1.3;
      out.push({ flow: f, pressure: designPressure * Math.pow(f / designFlow, 2) });
    }
    return out;
  }

  /* ------------------------------------------------------- hydronics */

  /* Water properties, polynomial fits over 0–100 C. Good to well within the
     accuracy any chilled-water sizing needs. */
  function waterProps(tC) {
    var t = U.clamp(tC, 0, 100);
    return {
      rho: 1000.6 - 0.0128 * t * t / 1.8 - 0.0641 * t,     // kg/m3
      cp: 4.2174 - 0.0022 * t + 0.00005 * t * t / 1.8,      // kJ/kg.K
      mu: 0.00002414 * Math.pow(10, 247.8 / (t + 133.15))   // Pa.s (Vogel)
    };
  }

  /* Flow rate for a duty and dT.  m(kg/s) = Q / (cp * dT); V = m / rho */
  function waterFlow(kW, dT, tMean) {
    if (dT <= 0) return { mDot: 0, lps: 0, m3h: 0, gpm: 0 };
    var p = waterProps(tMean == null ? 10 : tMean);
    var mDot = kW / (p.cp * dT);
    var lps = mDot / p.rho * 1000;
    return { mDot: mDot, lps: lps, m3h: lps * 3.6, gpm: lps * 15.8503, props: p };
  }

  /* Standard pipe bores, mm (nominal -> internal, schedule 40 steel). */
  var PIPES = [
    { nb: 15, id: 15.8 }, { nb: 20, id: 20.9 }, { nb: 25, id: 26.6 },
    { nb: 32, id: 35.1 }, { nb: 40, id: 40.9 }, { nb: 50, id: 52.5 },
    { nb: 65, id: 62.7 }, { nb: 80, id: 77.9 }, { nb: 100, id: 102.3 },
    { nb: 125, id: 128.2 }, { nb: 150, id: 154.1 }, { nb: 200, id: 202.7 },
    { nb: 250, id: 254.5 }, { nb: 300, id: 303.2 }, { nb: 350, id: 333.4 },
    { nb: 400, id: 381.0 }, { nb: 450, id: 428.6 }, { nb: 500, id: 477.8 }
  ];

  /* Pipe hydraulics: velocity, Reynolds, friction rate (Pa/m and kPa/100m). */
  function pipeAnalyse(lps, idMm, tMean, roughness) {
    var p = waterProps(tMean == null ? 10 : tMean);
    var d = idMm / 1000;
    var area = Math.PI * d * d / 4;
    var v = area > 0 ? (lps / 1000) / area : 0;
    var re = p.rho * v * d / p.mu;
    var f = H.duct.frictionFactor(re, (roughness || 0.000045) / d);
    var rate = d > 0 ? f * (0.5 * p.rho * v * v) / d : 0;   // Pa/m
    return {
      velocity: v, re: re, f: f, rate: rate,
      per100m: rate * 100 / 1000,                            // kPa per 100 m
      props: p, regime: re < 2300 ? 'laminar' : (re < 4000 ? 'transitional' : 'turbulent')
    };
  }

  /* Select the smallest standard pipe meeting both a velocity ceiling and a
     friction-rate ceiling. Returns the pick plus every candidate for a table. */
  function selectPipe(lps, maxVelocity, maxRate, tMean) {
    var rows = PIPES.map(function (p) {
      var a = pipeAnalyse(lps, p.id, tMean);
      return {
        nb: p.nb, id: p.id, velocity: a.velocity, rate: a.rate,
        per100m: a.per100m,
        ok: a.velocity <= maxVelocity && a.rate <= maxRate
      };
    });
    var pick = rows.find(function (r) { return r.ok; }) || rows[rows.length - 1];
    return { pick: pick, rows: rows };
  }

  /* Pump head from a pressure drop. h(m) = dP / (rho * g) */
  function headFromPressure(pa, tMean) {
    var p = waterProps(tMean == null ? 10 : tMean);
    return pa / (p.rho * U.C.G);
  }

  function pumpPower(lps, headM, efficiency, tMean) {
    var p = waterProps(tMean == null ? 10 : tMean);
    var eta = U.clamp(efficiency || 0.7, 0.05, 1);
    return (lps / 1000) * p.rho * U.C.G * headM / (1000 * eta);
  }

  H.flow = {
    airflowForSensible: airflowForSensible, sensibleFromAirflow: sensibleFromAirflow,
    latentFromAirflow: latentFromAirflow, achToFlow: achToFlow, flowToAch: flowToAch,
    supplyTemp: supplyTemp,
    fanLaws: fanLaws, fanPower: fanPower, systemCurve: systemCurve,
    waterProps: waterProps, waterFlow: waterFlow, PIPES: PIPES,
    pipeAnalyse: pipeAnalyse, selectPipe: selectPipe,
    headFromPressure: headFromPressure, pumpPower: pumpPower
  };
})();
