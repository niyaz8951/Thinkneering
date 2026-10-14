/* ==========================================================================
   DAME Tools Hub — psychrometric engine

   Equations are from the ASHRAE Handbook — Fundamentals, Chapter 1,
   "Psychrometrics" (2017/2021 editions carry the same equation numbers).
   Equation numbers are cited against each function so the source of every
   constant can be checked. Nothing here is approximated from a chart or
   lifted from a spreadsheet.

   Everything works in SI internally: temperatures in °C, pressures in kPa,
   humidity ratio in kg/kg dry air, enthalpy in kJ/kg dry air, specific volume
   in m3/kg dry air. Imperial figures are produced by converting at the display
   edge (see the `ip` object), never by carrying a second set of constants —
   two parallel equation sets drift apart the first time one is corrected.

   WATER-VAPOUR ENHANCEMENT FACTOR. ASHRAE Table 2 and ASHRAE Chart No. 1 are
   computed from the Hyland–Wexler real-gas formulation, in which the
   saturation vapour pressure of water in moist AIR is f × pws, with f the
   enhancement factor (about 1.004 at sea level). The plain perfect-gas
   equations of Chapter 1 leave f out and read 0.4–0.6 % LOW on humidity
   ratio at every temperature — which is exactly the gap users saw between
   the earlier version of this tool and the printed ASHRAE chart. f is now
   applied everywhere a saturation pressure is used (Ws, RH, dew point, wet
   bulb), using the Greenspan (1976) closed-form fit of the Hyland–Wexler
   factor. Checked against ASHRAE Table 2 at -20…50 °C: humidity ratio agrees
   to within 0.03 %, i.e. to the table's own rounding. See test-psychro.js.

   Pure functions only — no DOM, no globals beyond the export. This file is
   loaded by the page and by test-psychro.js under plain node.
   ========================================================================== */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;                     /* node, for the test harness */
  } else {
    root.TN = root.TN || {};
    root.TN.psychro = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------ constants */

  var P_STD = 101.325;        /* standard sea-level pressure, kPa            */
  var R_DA = 0.287042;        /* gas constant, dry air, kJ/(kg·K)   — Eq 26  */
  var MW_RATIO = 0.621945;    /* Mw/Mda, water vapour to dry air    — Eq 20  */
  var V_RATIO = 1.607858;     /* 1/MW_RATIO, used in the volume relation     */
  var C_PA = 1.006;           /* specific heat, dry air, kJ/(kg·K)  — Eq 30  */
  var C_PV = 1.86;            /* specific heat, water vapour, kJ/(kg·K)      */
  var H_FG0 = 2501;           /* latent heat of vaporisation at 0°C, kJ/kg   */
  var T_ABS = 273.15;         /* 0°C in kelvin                               */

  /* Working limits. The Hyland-Wexler correlations are stated for -100 to
     200°C; the tighter band here is what a moist-air chart is meaningful
     over, and keeps the bisection brackets honest. */
  var T_MIN = -60;
  var T_MAX = 120;

  /* ------------------------------------------------- saturation pressure */

  /* Saturation pressure of water vapour, kPa, over ice below 0°C (Eq 5) and
     over liquid water at and above 0°C (Eq 6). The correlations return Pa,
     hence the division. Hyland and Wexler (1983).

     Check: satPressure(100) returns 101.42 kPa. The correlation is on the
     ITS-68 scale and sits 0.09 % above the 101.325 kPa normal boiling point;
     that offset is a known property of the ASHRAE correlation, and the value
     is still the cheapest test that the constants are typed correctly. */
  function satPressure(tC) {
    var T = tC + T_ABS;
    var lnP;
    if (tC < 0) {
      /* Eq 5 — over ice, -100 to 0°C */
      lnP = -5.6745359e3 / T
          + 6.3925247
          - 9.677843e-3 * T
          + 6.2215701e-7 * T * T
          + 2.0747825e-9 * T * T * T
          - 9.484024e-13 * T * T * T * T
          + 4.1635019 * Math.log(T);
    } else {
      /* Eq 6 — over liquid water, 0 to 200°C */
      lnP = -5.8002206e3 / T
          + 1.3914993
          - 4.8640239e-2 * T
          + 4.1764768e-5 * T * T
          - 1.4452093e-8 * T * T * T
          + 6.5459673 * Math.log(T);
    }
    return Math.exp(lnP) / 1000;
  }

  /* Enhancement factor f — the ratio of the saturation vapour pressure of
     water in moist air to that of pure water vapour, at the same temperature
     and total pressure. Greenspan, L. (1976) "Functional equations for the
     enhancement factors for CO2-free moist air", J. Res. NBS 80A(1), which is
     a fit of the Hyland–Wexler virial formulation ASHRAE uses for Table 2 and
     Chart No. 1:

        f = exp[ α (1 − pws/p) + β (p/pws − 1) ]
        α = Σ A_i t^i,   ln β = Σ B_i t^i          (t in °C, pressures in Pa)

     One set of coefficients over ice below 0 °C and one over water above.
     Typical values at 101.325 kPa: 1.0039 at 0 °C, 1.0041 at 25 °C, 1.0052
     at 50 °C. At Riyadh's 94 kPa it is about 0.0003 smaller. */
  var ENH_WATER = {
    A: [3.53624e-4, 2.93228e-5, 2.61474e-7, 8.57538e-9],
    B: [-10.7588, 6.32529e-2, -2.53591e-4, 6.33784e-7]
  };
  var ENH_ICE = {
    A: [3.64449e-4, 2.93631e-5, 4.88635e-7, 4.36543e-9],
    B: [-10.7271, 7.61989e-2, -1.74771e-4, 2.46721e-6]
  };

  function enhancementFactor(tC, p) {
    var c = tC < 0 ? ENH_ICE : ENH_WATER;
    var pws = satPressure(tC) * 1000;            /* Pa */
    var pPa = p * 1000;
    if (!(pws > 0) || !(pPa > pws)) { return 1; }
    var t2 = tC * tC;
    var t3 = t2 * tC;
    var alpha = c.A[0] + c.A[1] * tC + c.A[2] * t2 + c.A[3] * t3;
    var beta = Math.exp(c.B[0] + c.B[1] * tC + c.B[2] * t2 + c.B[3] * t3);
    return Math.exp(alpha * (1 - pws / pPa) + beta * (pPa / pws - 1));
  }

  /* Saturation vapour pressure of water IN MOIST AIR, kPa — f × pws. This is
     the quantity every humidity relation below is built on, and the one that
     makes the results line up with ASHRAE Table 2 and the printed chart. */
  function satPressureMoist(tC, p) {
    return enhancementFactor(tC, p) * satPressure(tC);
  }

  /* ------------------------------------------------------ site pressure */

  /* Standard atmosphere pressure at altitude, kPa — Eq 3. Valid to 11 000 m.
     Altitude matters more than it looks: Riyadh at 612 m sits near 94.3 kPa,
     which moves saturation humidity ratio about 7% against a sea-level chart. */
  function pressureAtAltitude(metres) {
    return P_STD * Math.pow(1 - 2.25577e-5 * metres, 5.2559);
  }

  /* Inverse of the above — the altitude a given pressure corresponds to. */
  function altitudeAtPressure(kPa) {
    return (1 - Math.pow(kPa / P_STD, 1 / 5.2559)) / 2.25577e-5;
  }

  /* --------------------------------------------------- humidity ratio in */

  /* Humidity ratio from vapour pressure — Eq 20. */
  function humRatioFromVapPressure(pw, p) {
    if (pw >= p) { return Infinity; }
    return MW_RATIO * pw / (p - pw);
  }

  /* Vapour pressure from humidity ratio — Eq 20 rearranged. */
  function vapPressureFromHumRatio(W, p) {
    return p * W / (MW_RATIO + W);
  }

  /* Saturation humidity ratio at a temperature — Eq 20 at pw = f·pws. */
  function satHumRatio(tC, p) {
    return humRatioFromVapPressure(satPressureMoist(tC, p), p);
  }

  /* Humidity ratio from relative humidity. RH is a percentage. ASHRAE Eq 24
     defines RH as xw/xws at the same t and p, and xws = f·pws/p, so the
     enhancement factor belongs here too; that is what keeps 100 % RH exactly
     on the saturation curve. */
  function humRatioFromRH(tC, rhPct, p) {
    return humRatioFromVapPressure((rhPct / 100) * satPressureMoist(tC, p), p);
  }

  /* Humidity ratio from dew-point temperature: by definition the vapour
     pressure equals the (enhanced) saturation pressure at the dew point. */
  function humRatioFromDewPoint(tdC, p) {
    return humRatioFromVapPressure(satPressureMoist(tdC, p), p);
  }

  /* Humidity ratio from dry-bulb and thermodynamic wet-bulb temperature —
     Eq 33 for a wet bulb at or above freezing, Eq 35 below it. This is the
     Handbook relation, not the Sprung/Carrier psychrometer approximation that
     most quick tools carry: below about 30% RH the two part company by more
     than a gram per kilogram.

     Returns a negative number when the pair is physically impossible (a wet
     bulb too far below the dry bulb for the air to hold), which the caller
     treats as an input error rather than clamping to zero. */
  function humRatioFromWetBulb(tC, twbC, p) {
    var Wsstar = satHumRatio(twbC, p);
    if (!isFinite(Wsstar)) { return NaN; }
    if (twbC >= 0) {
      /* Eq 33 */
      return ((H_FG0 - 2.326 * twbC) * Wsstar - C_PA * (tC - twbC))
           / (H_FG0 + C_PV * tC - 4.186 * twbC);
    }
    /* Eq 35 — sublimation from an ice-covered wick */
    return ((2830 - 0.24 * twbC) * Wsstar - C_PA * (tC - twbC))
         / (2830 + C_PV * tC - 2.1 * twbC);
  }

  /* Humidity ratio from dry bulb and enthalpy — Eq 30 rearranged. Useful
     because a coil is often specified by leaving enthalpy. */
  function humRatioFromEnthalpy(tC, h) {
    return (h - C_PA * tC) / (H_FG0 + C_PV * tC);
  }

  /* -------------------------------------------------- derived properties */

  /* Relative humidity, percent — Eq 12/24 by way of vapour pressure. Above
     the saturation temperature this exceeds 100, which is what tells the
     caller the state is impossible; it is deliberately not clamped here. */
  function rhFromHumRatio(tC, W, p) {
    return 100 * vapPressureFromHumRatio(W, p) / satPressureMoist(tC, p);
  }

  /* Dew point, °C. The Handbook offers a polynomial fit (Eq 37/38), but the
     exact inverse is available for free: pws is strictly increasing, so a
     bisection on it converges to machine precision in about fifty steps and
     carries no fit error at all. Bisection is used rather than Newton because
     it cannot diverge, and this runs once per state, not in a loop. */
  function dewPoint(W, p) {
    var pw = vapPressureFromHumRatio(W, p);
    if (!(pw > 0)) { return NaN; }
    if (pw >= satPressureMoist(T_MAX, p)) { return NaN; }
    var lo = T_MIN;
    var hi = T_MAX;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (satPressureMoist(mid, p) < pw) { lo = mid; } else { hi = mid; }
      if (hi - lo < 1e-10) { break; }
    }
    return (lo + hi) / 2;
  }

  /* Thermodynamic wet bulb, °C, by bisection on Eq 33/35.

     For a fixed dry bulb, humidity ratio rises monotonically with wet bulb,
     so the root is bracketed by the dew point below (where t* would equal td
     only at saturation) and the dry bulb above. Bisection over that bracket
     always converges. The original tool iterated with a fixed gain of 50 on
     the residual, which is not a convergent scheme and oscillates at low
     humidity ratios and at altitude. */
  function wetBulb(tC, W, p) {
    if (!(W >= 0)) { return NaN; }
    var hi = tC;
    /* The dew point is the natural lower bound, but perfectly dry air has no
       dew point while it does have a wet bulb, so fall back to the working
       floor rather than giving up. */
    var dp = W > 0 ? dewPoint(W, p) : NaN;
    var lo = isFinite(dp) ? Math.min(dp, hi) - 0.5 : T_MIN;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (humRatioFromWetBulb(tC, mid, p) < W) { lo = mid; } else { hi = mid; }
      if (hi - lo < 1e-8) { break; }
    }
    return (lo + hi) / 2;
  }

  /* Specific enthalpy, kJ/kg dry air — Eq 30. Datum is 0 for dry air at 0°C. */
  function enthalpy(tC, W) {
    return C_PA * tC + W * (H_FG0 + C_PV * tC);
  }

  /* Specific volume, m3/kg dry air — Eq 26. Note "per kg of dry air", not per
     kg of the mixture: this is what makes the moist-air density below (1+W)/v
     and not 1/v. */
  function specificVolume(tC, W, p) {
    return R_DA * (tC + T_ABS) * (1 + V_RATIO * W) / p;
  }

  /* Density of the moist air mixture, kg/m3 — Eq 11. The mixture carries
     (1 + W) kg of mass for every kg of dry air, and v is stated per kg of dry
     air, so the moisture has to be added back. Reporting 1/v as "density" is
     a common slip and reads about 2% low at 35°C and 60% RH. */
  function density(tC, W, p) {
    return (1 + W) / specificVolume(tC, W, p);
  }

  /* Degree of saturation — the ratio of humidity ratio to its saturated value
     at the same temperature and pressure (Eq 12). Distinct from RH, and the
     quantity a chart's curved lines are actually spaced on. */
  function degreeOfSaturation(tC, W, p) {
    return W / satHumRatio(tC, p);
  }

  /* Moist-air specific heat at constant pressure, kJ/(kg dry air·K).
     Sensible heat calculations that use a flat 1.006 ignore the vapour term
     and read about 2.5% low at 14 g/kg. */
  function specificHeat(W) {
    return C_PA + C_PV * W;
  }

  /* ------------------------------------------------------- state builder */

  /* Build a complete state from a dry-bulb temperature and any one of the
     humidity measures. `mode` is one of rh | wb | dp | w | h.

     Returns { ok: false, error } rather than throwing or returning null, so
     the caller can say what is wrong with which row. The original tool
     collapsed "nothing entered", "RH above 100" and "off the chart" into a
     single generic message, which is the least useful thing an input error
     can do. */
  function state(tC, mode, value, p) {
    if (!isFinite(tC)) { return { ok: false, error: 'Enter a dry-bulb temperature.' }; }
    if (!isFinite(value)) { return { ok: false, error: 'Enter a humidity value.' }; }
    if (!isFinite(p) || p <= 0) { return { ok: false, error: 'Barometric pressure must be above zero.' }; }
    if (tC < T_MIN || tC > T_MAX) {
      /* `code` and `data` (SI) let the page word the message in the unit
         system on show; `error` stays as the SI wording. */
      return { ok: false, code: 'db-range', data: { min: T_MIN, max: T_MAX },
               error: 'Dry bulb must be between ' + T_MIN + ' and ' + T_MAX + ' °C.' };
    }

    var W;
    switch (mode) {
      case 'rh':
        if (value < 0 || value > 100) { return { ok: false, error: 'Relative humidity must be between 0 and 100%.' }; }
        W = humRatioFromRH(tC, value, p);
        break;
      case 'wb':
        if (value > tC + 1e-9) { return { ok: false, error: 'Wet bulb cannot be above dry bulb.' }; }
        W = humRatioFromWetBulb(tC, value, p);
        if (W < 0) { return { ok: false, error: 'That wet bulb is too low for this dry bulb — the air would hold less than no moisture.' }; }
        break;
      case 'dp':
        if (value > tC + 1e-9) { return { ok: false, error: 'Dew point cannot be above dry bulb.' }; }
        W = humRatioFromDewPoint(value, p);
        break;
      case 'w':
        if (value < 0) { return { ok: false, error: 'Humidity ratio cannot be negative.' }; }
        W = value / 1000;                    /* entered in g/kg             */
        break;
      case 'h':
        W = humRatioFromEnthalpy(tC, value);
        if (W < 0) { return { ok: false, error: 'That enthalpy is below the dry-air value at this temperature.' }; }
        break;
      default:
        return { ok: false, error: 'Unknown humidity input mode.' };
    }

    if (!isFinite(W)) { return { ok: false, error: 'That combination has no physical solution.' }; }

    var Ws = satHumRatio(tC, p);
    if (W > Ws * (1 + 1e-6)) {
      return {
        ok: false,
        code: 'above-saturation',
        data: { t: tC, p: p, wMax: Ws },
        error: 'Above saturation — at ' + tC.toFixed(1) + ' °C and ' + p.toFixed(1) +
               ' kPa the air holds at most ' + (Ws * 1000).toFixed(2) + ' g/kg.'
      };
    }
    if (W < 0) { W = 0; }

    return {
      ok: true,
      p: p,
      db: tC,
      W: W,
      rh: Math.min(100, rhFromHumRatio(tC, W, p)),
      wb: wetBulb(tC, W, p),
      dp: W > 0 ? dewPoint(W, p) : NaN,
      h: enthalpy(tC, W),
      v: specificVolume(tC, W, p),
      rho: density(tC, W, p),
      pw: vapPressureFromHumRatio(W, p),
      mu: degreeOfSaturation(tC, W, p),
      cp: specificHeat(W)
    };
  }

  /* ------------------------------------------------------------ processes */

  /* Classify the change between two states.

     `tol` values are deliberately in engineering units rather than relative:
     0.1 K and 0.05 g/kg are about the resolution anyone reads off a chart or
     trusts from a sensor, so a change smaller than that is called constant.
     Without a tolerance every real cooling coil reads as "cooling and
     dehumidification and a bit of something else". */
  var T_TOL = 0.1;          /* K     */
  var W_TOL = 0.05 / 1000;  /* kg/kg */

  function classify(s1, s2) {
    var dT = s2.db - s1.db;
    var dW = s2.W - s1.W;
    var dWB = s2.wb - s1.wb;

    var warmer = dT > T_TOL;
    var cooler = dT < -T_TOL;
    var wetter = dW > W_TOL;
    var drier = dW < -W_TOL;

    if (!warmer && !cooler && !wetter && !drier) {
      return { key: 'none', name: 'No change', note: 'The two states are the same within reading tolerance.' };
    }
    if (!wetter && !drier) {
      return warmer
        ? { key: 'heat', name: 'Sensible heating', note: 'Moisture content is unchanged, so relative humidity falls as the air warms. A heating coil, a fan, or duct gain.' }
        : { key: 'cool', name: 'Sensible cooling', note: 'Moisture content is unchanged, so the coil surface stayed above the entering dew point. Relative humidity rises as the air cools.' };
    }
    if (!warmer && !cooler) {
      return wetter
        ? { key: 'humid', name: 'Isothermal humidification', note: 'Moisture added at constant dry bulb — the signature of steam injection.' }
        : { key: 'dehumid', name: 'Isothermal dehumidification', note: 'Moisture removed at constant dry bulb. Usually a cooling coil followed by reheat, shown as one step.' };
    }
    if (cooler && drier) {
      return { key: 'cooldehumid', name: 'Cooling and dehumidification', note: 'The coil surface is below the entering dew point, so both sensible and latent heat are removed. The everyday AHU cooling process.' };
    }
    if (warmer && wetter) {
      return { key: 'heathumid', name: 'Heating and humidification', note: 'Both temperature and moisture rise — a heating coil followed by a humidifier, or a heat wheel in winter.' };
    }
    if (cooler && wetter) {
      /* Evaporative if the wet bulb held; otherwise the air was also cooled. */
      var adiabatic = Math.abs(dWB) < 0.3;
      return adiabatic
        ? { key: 'evap', name: 'Evaporative cooling', note: 'Moisture added and temperature dropped along a near-constant wet bulb — the water takes its latent heat from the air itself.' }
        : { key: 'coolhumid', name: 'Cooling with humidification', note: 'Cooled and moistened, but the wet bulb moved, so this is not purely adiabatic. Check for a separate moisture source.' };
    }
    return { key: 'heatdehumid', name: 'Dehumidification with heating', note: 'Drier and warmer — desiccant adsorption, which releases its heat of sorption into the airstream.' };
  }

  /* Loads across a process.

     Airflow is the volume flow at the ENTERING state, which is where a fan or
     a flow station actually measures it, so the mass flow of dry air is V/v1.
     Averaging the two specific volumes, as is sometimes done, quietly invents
     a flow that exists at neither end.

     Total is the enthalpy change; sensible uses the moist-air specific heat at
     the mean humidity ratio; latent is the remainder. Taking latent as
     m·hfg·dW independently, as the original did, leaves sensible + latent not
     equal to total, and there is no way to tell a user which of the three to
     believe. */
  function loads(s1, s2, flowM3s) {
    if (!isFinite(flowM3s) || flowM3s <= 0) { return null; }
    var mDa = flowM3s / s1.v;                       /* kg dry air per second */
    var Wm = (s1.W + s2.W) / 2;
    var total = mDa * (s2.h - s1.h);                /* kW, signed            */
    var sensible = mDa * specificHeat(Wm) * (s2.db - s1.db);
    var latent = total - sensible;
    var moisture = mDa * (s2.W - s1.W) * 3600;      /* kg/h, signed          */
    return {
      massFlowDryAir: mDa,
      total: total,
      sensible: sensible,
      latent: latent,
      moisture: moisture,
      /* SHR is only meaningful when there is a total load to divide by. When
         sensible and latent all but cancel (evaporative cooling) the ratio is
         a huge number that says nothing, so it is left blank. */
      shr: Math.abs(total) > 0.02 * (Math.abs(sensible) + Math.abs(latent)) && Math.abs(total) > 1e-9
        ? sensible / total : NaN
    };
  }

  /* Apparatus dew point and coil bypass factor.

     The straight process line on the chart is extended past the leaving state
     until it meets the saturation curve; that intersection is the ADP, the
     effective mean coil surface temperature. The bypass factor is the fraction
     of air that behaves as though it never touched the fin:

        BF = (t2 - tadp) / (t1 - tadp)

     Only meaningful for a cooling and dehumidifying process. A line that never
     reaches saturation means no ADP exists — a real result, not a failure. It
     says the leaving condition cannot be produced by one coil from that
     entering condition, which happens at low sensible heat ratios where the
     process line runs steeper than the saturation curve and the two diverge.
     Reported as null and explained in the UI rather than fudged to a number. */
  function apparatusDewPoint(s1, s2) {
    var dT = s2.db - s1.db;
    var dW = s2.W - s1.W;
    if (!(dT < 0) || !(dW < 0)) { return null; }

    /* Distance from the extended process line to the saturation curve. */
    function gap(t) {
      var frac = (t - s1.db) / dT;                 /* 0 at s1, 1 at s2      */
      var W = s1.W + frac * dW;
      return W - satHumRatio(t, s1.p);
    }

    /* The line can cross the curve twice: once at the ADP, and again far below
       where the line's humidity ratio has fallen through zero. Only the first
       crossing below the leaving state is the ADP, so the bracket is found by
       stepping down rather than by assuming a fixed lower bound. A quarter of
       a degree is fine enough that no real crossing is stepped over. */
    var step = 0.25;
    var floorT = Math.max(T_MIN, s1.db - Math.abs(s1.W / (dW / dT)) - 1);
    var hi = s2.db;
    if (gap(hi) > 0) { return null; }              /* already at/over sat   */
    var lo = null;
    for (var t = hi - step; t >= floorT; t -= step) {
      if (gap(t) >= 0) { lo = t; break; }
      hi = t;
    }
    if (lo === null) { return null; }              /* never meets the curve */

    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (gap(mid) > 0) { lo = mid; } else { hi = mid; }
      if (Math.abs(hi - lo) < 1e-9) { break; }
    }
    var tadp = (lo + hi) / 2;
    var denom = s1.db - tadp;
    if (Math.abs(denom) < 1e-9) { return null; }
    var bf = (s2.db - tadp) / denom;
    return {
      t: tadp,
      W: satHumRatio(tadp, s1.p),
      bypassFactor: bf,
      contactFactor: 1 - bf
    };
  }

  /* Adiabatic mixing of two airstreams — Eq 45/46. Kept here because the
     chart tool draws the mixed point, and because it is the one process that
     is a junction rather than a step. Flows are volume flows at each inlet. */
  function mix(sA, flowA, sB, flowB) {
    var mA = flowA / sA.v;
    var mB = flowB / sB.v;
    var m = mA + mB;
    if (!(m > 0)) { return { ok: false, error: 'Both airflows are zero.' }; }
    var W = (mA * sA.W + mB * sB.W) / m;
    var h = (mA * sA.h + mB * sB.h) / m;
    /* Dry bulb follows from h and W rather than being mass-averaged directly,
       because enthalpy is the conserved quantity, not temperature. */
    var t = (h - W * H_FG0) / (C_PA + W * C_PV);
    var s = state(t, 'w', W * 1000, sA.p);
    if (s.ok) { s.massFlowDryAir = m; }
    return s;
  }

  /* ------------------------------------------------- unit conversion edge */

  var ip = {
    tempToF: function (c) { return c * 9 / 5 + 32; },
    tempToC: function (f) { return (f - 32) * 5 / 9; },
    deltaTToF: function (dc) { return dc * 9 / 5; },
    /* Enthalpy datums differ: SI is zero for dry air at 0°C, IP at 0°F. */
    enthalpyToIP: function (kJkg) { return kJkg / 2.326 + 7.6800; },
    enthalpyToSI: function (btulb) { return (btulb - 7.6800) * 2.326; },
    volumeToIP: function (m3kg) { return m3kg * 16.018463; },
    densityToIP: function (kgm3) { return kgm3 / 16.018463; },
    pressureToIP: function (kPa) { return kPa * 0.295299830714; },  /* inHg  */
    pressureToPsi: function (kPa) { return kPa * 0.1450377377; },
    lengthToFt: function (m) { return m / 0.3048; },
    lengthToM: function (ft) { return ft * 0.3048; },
    powerToBtuh: function (kW) { return kW * 3412.142; },
    powerToTons: function (kW) { return kW / 3.516853; },
    flowToCfm: function (m3s) { return m3s * 2118.88; },
    flowToM3s: function (cfm) { return cfm / 2118.88; },
    massFlowToLbh: function (kgs) { return kgs * 7936.641; },
    /* grains of moisture per lb of dry air — the IP humidity ratio unit */
    humRatioToGrains: function (kgkg) { return kgkg * 7000; }
  };

  var flowToM3s = {
    'm3h': function (v) { return v / 3600; },
    'ls': function (v) { return v / 1000; },
    'm3s': function (v) { return v; },
    'cfm': function (v) { return v / 2118.88; }
  };

  /* --------------------------------------------------------------- export */

  return {
    P_STD: P_STD,
    T_MIN: T_MIN,
    T_MAX: T_MAX,
    MW_RATIO: MW_RATIO,
    H_FG0: H_FG0,
    satPressure: satPressure,
    enhancementFactor: enhancementFactor,
    satPressureMoist: satPressureMoist,
    pressureAtAltitude: pressureAtAltitude,
    altitudeAtPressure: altitudeAtPressure,
    humRatioFromVapPressure: humRatioFromVapPressure,
    vapPressureFromHumRatio: vapPressureFromHumRatio,
    satHumRatio: satHumRatio,
    humRatioFromRH: humRatioFromRH,
    humRatioFromDewPoint: humRatioFromDewPoint,
    humRatioFromWetBulb: humRatioFromWetBulb,
    humRatioFromEnthalpy: humRatioFromEnthalpy,
    rhFromHumRatio: rhFromHumRatio,
    dewPoint: dewPoint,
    wetBulb: wetBulb,
    enthalpy: enthalpy,
    specificVolume: specificVolume,
    density: density,
    degreeOfSaturation: degreeOfSaturation,
    specificHeat: specificHeat,
    state: state,
    classify: classify,
    loads: loads,
    apparatusDewPoint: apparatusDewPoint,
    mix: mix,
    ip: ip,
    flowToM3s: flowToM3s
  };
}));
