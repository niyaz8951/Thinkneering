/* Thinkneering — HVAC engine: duct sizing & pressure drop
   Darcy-Weisbach with Colebrook-White friction factor, seeded by Swamee-Jain.
   Rectangular ducts convert through the Huebscher equivalent diameter. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;

  // Absolute roughness, metres. Values are the ones commonly tabulated for
  // duct materials; the engineer can override in the calculator.
  var MATERIALS = [
    { id: 'gi', name: 'Galvanised steel (spiral)', e: 0.00009 },
    { id: 'gi-seam', name: 'Galvanised steel (longitudinal seam)', e: 0.00015 },
    { id: 'ss', name: 'Stainless steel', e: 0.00005 },
    { id: 'alu', name: 'Aluminium', e: 0.00005 },
    { id: 'preinsulated', name: 'Pre-insulated panel (PIR)', e: 0.0003 },
    { id: 'fibreglass', name: 'Fibrous glass board', e: 0.0009 },
    { id: 'flex-ext', name: 'Flexible duct (fully extended)', e: 0.003 },
    { id: 'concrete', name: 'Concrete', e: 0.003 }
  ];

  // Preferred circular duct diameters, mm (common GCC / EN supply range).
  var STD_ROUND = [80, 100, 125, 150, 160, 200, 250, 315, 355, 400, 450, 500,
    560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600];

  // Rectangular duct side increments, mm.
  var STD_SIDE = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650,
    700, 750, 800, 900, 1000, 1100, 1200, 1400, 1600, 1800, 2000];

  function material(id) {
    for (var i = 0; i < MATERIALS.length; i++) if (MATERIALS[i].id === id) return MATERIALS[i];
    return MATERIALS[0];
  }

  /* Huebscher equivalent diameter for a rectangular duct, metres.
     De = 1.30 (ab)^0.625 / (a+b)^0.25 */
  function equivDiameter(a, b) {
    return 1.30 * Math.pow(a * b, 0.625) / Math.pow(a + b, 0.25);
  }

  /* Hydraulic diameter, metres — used for the Reynolds number. */
  function hydraulicDiameter(a, b) { return 2 * a * b / (a + b); }

  function reynolds(velocity, diameter, rho, mu) {
    return (rho || U.C.RHO_AIR) * velocity * diameter / (mu || U.C.MU_AIR);
  }

  /* Swamee-Jain: explicit, within ~1% of Colebrook over duct Reynolds numbers.
     Used directly for laminar/seed and as the starting guess below. */
  function swameeJain(re, relRough) {
    var t = Math.log10(relRough / 3.7 + 5.74 / Math.pow(re, 0.9));
    return 0.25 / (t * t);
  }

  /* Colebrook-White solved by fixed-point iteration. Converges in a handful
     of passes for every case a duct will ever present. */
  function frictionFactor(re, relRough) {
    if (re < 1) return 0;
    if (re < 2300) return 64 / re;                 // laminar
    var f = swameeJain(Math.max(re, 4000), relRough);
    for (var i = 0; i < 20; i++) {
      var inv = -2 * Math.log10(relRough / 3.7 + 2.51 / (re * Math.sqrt(f)));
      var next = 1 / (inv * inv);
      if (Math.abs(next - f) < 1e-8) { f = next; break; }
      f = next;
    }
    return f;
  }

  /* Core solver.
     opts: { flow (L/s), shape 'round'|'rect', d (mm) | w,h (mm),
             length (m), roughness (m), fittingK, rho }
     returns velocity, Re, f, friction rate (Pa/m), straight loss, fitting loss. */
  function analyse(opts) {
    var rho = opts.rho || U.C.RHO_AIR;
    var flow = opts.flow / 1000;                    // m3/s
    var area, De, Dh, dims;

    if (opts.shape === 'round') {
      var d = opts.d / 1000;
      area = Math.PI * d * d / 4;
      De = Dh = d;
      dims = { d: opts.d };
    } else {
      var a = opts.w / 1000, b = opts.h / 1000;
      area = a * b;
      De = equivDiameter(a, b);
      Dh = hydraulicDiameter(a, b);
      dims = { w: opts.w, h: opts.h, aspect: Math.max(a, b) / Math.min(a, b) };
    }

    var velocity = area > 0 ? flow / area : 0;
    var vp = 0.5 * rho * velocity * velocity;        // velocity pressure, Pa
    var re = reynolds(velocity, Dh, rho, U.C.MU_AIR);
    var rel = (opts.roughness || 0.00009) / De;
    var f = frictionFactor(re, rel);
    var rate = De > 0 ? f * vp / De : 0;             // Pa per metre
    var straight = rate * (opts.length || 0);
    var fittings = (opts.fittingK || 0) * vp;

    return {
      area: area, velocity: velocity, vp: vp, re: re, f: f,
      De: De, Dh: Dh, dims: dims,
      rate: rate, straight: straight, fittings: fittings,
      total: straight + fittings,
      regime: re < 2300 ? 'laminar' : (re < 4000 ? 'transitional' : 'turbulent')
    };
  }

  /* Size a round duct for a target friction rate (equal-friction method).
     Returns the exact diameter and the next standard size up. */
  function sizeRound(flowLs, targetRate, roughness, rho) {
    var lo = 50, hi = 2500, d = 300;
    for (var i = 0; i < 60; i++) {
      d = (lo + hi) / 2;
      var r = analyse({ flow: flowLs, shape: 'round', d: d, length: 1, roughness: roughness, rho: rho }).rate;
      if (r > targetRate) lo = d; else hi = d;
    }
    var std = STD_ROUND.find(function (s) { return s >= d; }) || STD_ROUND[STD_ROUND.length - 1];
    return { exact: d, standard: std };
  }

  /* Size a round duct for a target velocity (velocity method). */
  function sizeRoundByVelocity(flowLs, targetVel) {
    var area = (flowLs / 1000) / targetVel;
    var d = Math.sqrt(4 * area / Math.PI) * 1000;
    var std = STD_ROUND.find(function (s) { return s >= d; }) || STD_ROUND[STD_ROUND.length - 1];
    return { exact: d, standard: std };
  }

  /* Rectangular duct matching an equivalent diameter at a fixed height.
     Walks the standard width increments so the answer is buildable. */
  function rectForEquiv(De_mm, height) {
    var b = height / 1000, target = De_mm / 1000;
    for (var i = 0; i < STD_SIDE.length; i++) {
      var a = STD_SIDE[i] / 1000;
      if (equivDiameter(a, b) >= target) return { w: STD_SIDE[i], h: height };
    }
    return { w: STD_SIDE[STD_SIDE.length - 1], h: height };
  }

  /* Velocity guidance. Not a code limit — a sanity band so an obviously
     noisy or oversized duct gets flagged before it reaches a drawing. */
  function velocityCheck(velocity, service) {
    var bands = {
      'main': [5, 10], 'branch': [3, 6], 'terminal': [2, 4],
      'return': [3, 7], 'exhaust': [5, 12]
    };
    var b = bands[service] || bands.main;
    if (velocity < b[0]) return { level: 'low', message: 'Below typical ' + service + ' range (' + b[0] + '–' + b[1] + ' m/s) — duct may be oversized.' };
    if (velocity > b[1]) return { level: 'high', message: 'Above typical ' + service + ' range (' + b[0] + '–' + b[1] + ' m/s) — check noise and pressure drop.' };
    return { level: 'ok', message: 'Within the typical ' + service + ' range (' + b[0] + '–' + b[1] + ' m/s).' };
  }

  H.duct = {
    MATERIALS: MATERIALS, STD_ROUND: STD_ROUND, STD_SIDE: STD_SIDE,
    material: material, equivDiameter: equivDiameter, hydraulicDiameter: hydraulicDiameter,
    reynolds: reynolds, frictionFactor: frictionFactor, analyse: analyse,
    sizeRound: sizeRound, sizeRoundByVelocity: sizeRoundByVelocity,
    rectForEquiv: rectForEquiv, velocityCheck: velocityCheck
  };
})();
