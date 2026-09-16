/* Thinkneering — HVAC engine: units & constants
   Pure functions. No DOM. SI is the internal working system throughout;
   IP appears only at the display edge. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});

  var C = {
    // Air at ~20 C, sea level. Used for the standard airflow shortcuts only;
    // anything precise goes through psychrolib instead.
    RHO_AIR: 1.2,          // kg/m3
    CP_AIR: 1.006,         // kJ/kg.K  (dry air)
    CP_VAPOUR: 1.86,       // kJ/kg.K
    H_FG: 2501,            // kJ/kg    latent heat of vaporisation at 0 C
    RHO_WATER: 997,        // kg/m3    at 25 C
    CP_WATER: 4.18,        // kJ/kg.K
    MU_WATER: 0.00089,     // Pa.s     at 25 C
    MU_AIR: 0.0000181,     // Pa.s
    G: 9.81,
    P_ATM: 101325          // Pa
  };

  // Sensible/latent shortcut factors for standard air (SI, flow in L/s):
  //   Qs (kW) = 1.2 * L/s * dT / 1000  -> 0.0012
  //   Ql (kW) = 3010 * m3/s * dW       -> per L/s: 3.010
  C.K_SENS = C.RHO_AIR * C.CP_AIR / 1000;   // kW per (L/s . K)
  C.K_LAT = C.RHO_AIR * C.H_FG / 1000;      // kW per (L/s . kg/kg)

  var factors = {
    // flow
    'L/s': 1, 'm3/h': 1 / 3.6, 'cfm': 0.4719474, 'm3/s': 1000,
    // power
    'kW': 1, 'W': 0.001, 'TR': 3.516853, 'BTU/h': 0.000293071,
    // length
    'm': 1, 'mm': 0.001, 'ft': 0.3048, 'in': 0.0254,
    // pressure
    'Pa': 1, 'kPa': 1000, 'inWG': 249.0889, 'bar': 100000,
    // velocity
    'm/s': 1, 'fpm': 0.00508,
    // area
    'm2': 1, 'ft2': 0.09290304
  };

  function convert(value, from, to) {
    if (from === to) return value;
    var a = factors[from], b = factors[to];
    if (a == null || b == null) throw new Error('Unknown unit: ' + from + ' -> ' + to);
    return value * a / b;
  }

  function cToF(t) { return t * 9 / 5 + 32; }
  function fToC(t) { return (t - 32) * 5 / 9; }
  function dK(d) { return d * 9 / 5; }   // temperature difference C -> F

  // Rounds for display without lying about precision: engineering values keep
  // 3 significant figures unless they are large enough to read as integers.
  function fmt(value, decimals) {
    if (value == null || !isFinite(value)) return '—';
    if (decimals != null) return value.toFixed(decimals);
    var a = Math.abs(value);
    if (a === 0) return '0';
    if (a >= 1000) return Math.round(value).toLocaleString('en-US');
    if (a >= 100) return value.toFixed(0);
    if (a >= 10) return value.toFixed(1);
    if (a >= 1) return value.toFixed(2);
    return value.toFixed(3);
  }

  function num(value, fallback) {
    var n = parseFloat(value);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  H.units = {
    C: C, convert: convert, cToF: cToF, fToC: fToC, dK: dK,
    fmt: fmt, num: num, clamp: clamp
  };
})();
