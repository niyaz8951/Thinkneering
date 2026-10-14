/* Verification of the psychrometric engine against ASHRAE published values.
   Run with plain node:   node test-psychro.js
   Exits non-zero if anything is outside tolerance. Not loaded by the page. */

'use strict';
var P = require('./psychro.js');
var fails = 0;

function check(name, got, want, tol) {
  var ok = Math.abs(got - want) <= tol;
  if (!ok) { fails++; }
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ': got ' + got + ', ASHRAE ' + want);
}

/* ASHRAE Handbook — Fundamentals, Chapter 1, Table 2: thermodynamic
   properties of moist air at 101.325 kPa. Ws (kg/kg), hs (kJ/kg), vs (m3/kg). */
var TABLE2 = [
  [-20, 0.0006373, -18.542, 0.7180],
  [-10, 0.001606,  -6.072,  0.7469],
  [0,   0.003789,   9.473,  0.7781],
  [10,  0.007661,  29.352,  0.8116],
  [20,  0.014758,  57.555,  0.8497],
  [25,  0.020170,  76.504,  0.8718],
  [30,  0.027329, 100.006,  0.8962],
  [40,  0.049141, 166.687,  0.9568],
  [50,  0.086858, 275.345,  1.0430]
];
var p = P.P_STD;
console.log('--- Table 2, saturation at 101.325 kPa ---');
TABLE2.forEach(function (row) {
  var t = row[0];
  var W = P.satHumRatio(t, p);
  check('Ws  ' + t + ' C', +W.toFixed(6), row[1], row[1] * 0.0005 + 1e-6);   /* 0.05 % */
  check('hs  ' + t + ' C', +P.enthalpy(t, W).toFixed(3), row[2], Math.max(0.05, Math.abs(row[2]) * 0.001));
  check('vs  ' + t + ' C', +P.specificVolume(t, W, p).toFixed(4), row[3], 0.0006);
});

/* Chapter 1, Example 1 (SI): 40 C dry bulb, 20 C thermodynamic wet bulb,
   101.325 kPa. Handbook answers: W = 0.0065 kg/kg, RH = 14 %, v = 0.896 m3/kg.
   Enthalpy and dew point follow from W by Eq 30 and by inverting Eq 6. */
console.log('--- Chapter 1, Example 1 ---');
var s = P.state(40, 'wb', 20, p);
check('W',  +s.W.toFixed(4), 0.0065, 0.0001);
check('h',  +s.h.toFixed(1), +P.enthalpy(40, s.W).toFixed(1), 0.05);
check('td', +s.dp.toFixed(2), 7.53, 0.1);
check('RH', +s.rh.toFixed(0), 14, 1);
check('v',  +s.v.toFixed(3), 0.896, 0.001);

/* Round trips: every humidity input mode must reproduce the same state. */
console.log('--- round trips ---');
var base = P.state(30, 'rh', 60, p);
check('from wb', P.state(30, 'wb', base.wb, p).W, base.W, 1e-7);
check('from dp', P.state(30, 'dp', base.dp, p).W, base.W, 1e-7);
check('from h',  P.state(30, 'h', base.h, p).W, base.W, 1e-7);
check('from W',  P.state(30, 'w', base.W * 1000, p).W, base.W, 1e-9);
check('100 % RH sits on the saturation curve', P.state(35, 'rh', 100, p).W, P.satHumRatio(35, p), 1e-9);
/* Hyland–Wexler (ITS-68) gives 101.42 kPa at 100 C; the 0.09 % offset from
   101.325 is a known property of the correlation ASHRAE uses, not a typo. */
check('boiling point', +P.satPressure(100).toFixed(2), 101.42, 0.02);
check('f at 25 C', +P.enhancementFactor(25, p).toFixed(4), 1.0041, 0.0002);

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nAll checks passed');
process.exit(fails ? 1 : 0);
