/* Thinkneering — HVAC engine: solar geometry & clear-sky irradiance
   Solar position from standard declination / hour-angle geometry, and
   clear-sky irradiance from the ASHRAE A-B-C clear-sky model. Written out
   rather than pulled from a library: it is ~80 lines and removes a dependency.

   This is a design-day estimator. It is not a substitute for measured or
   TMY irradiance data on a project that warrants it. */
(function () {
  'use strict';
  var H = (window.HVAC = window.HVAC || {});
  var U = H.units;
  var RAD = Math.PI / 180;

  // Surface azimuths, degrees clockwise from north.
  var ORIENTATIONS = [
    { id: 'N', name: 'North', azimuth: 0 },
    { id: 'NE', name: 'North-east', azimuth: 45 },
    { id: 'E', name: 'East', azimuth: 90 },
    { id: 'SE', name: 'South-east', azimuth: 135 },
    { id: 'S', name: 'South', azimuth: 180 },
    { id: 'SW', name: 'South-west', azimuth: 225 },
    { id: 'W', name: 'West', azimuth: 270 },
    { id: 'NW', name: 'North-west', azimuth: 315 },
    { id: 'H', name: 'Horizontal (roof)', azimuth: 0, tilt: 0 }
  ];

  /* ASHRAE clear-sky model constants by month (1-12).
     A  apparent extraterrestrial irradiance, W/m2
     B  atmospheric extinction coefficient
     C  diffuse radiation factor */
  var ABC = [
    null,
    { A: 1230, B: 0.142, C: 0.058 }, { A: 1215, B: 0.144, C: 0.060 },
    { A: 1186, B: 0.156, C: 0.071 }, { A: 1136, B: 0.180, C: 0.097 },
    { A: 1104, B: 0.196, C: 0.121 }, { A: 1088, B: 0.205, C: 0.134 },
    { A: 1085, B: 0.207, C: 0.136 }, { A: 1107, B: 0.201, C: 0.122 },
    { A: 1152, B: 0.177, C: 0.092 }, { A: 1193, B: 0.160, C: 0.073 },
    { A: 1221, B: 0.149, C: 0.063 }, { A: 1234, B: 0.142, C: 0.057 }
  ];

  // Representative day-of-year for the 21st of each month.
  var DOY = [0, 21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];

  function declination(month) {
    var n = DOY[month];
    return 23.45 * Math.sin(RAD * 360 * (284 + n) / 365);
  }

  /* Solar position for a latitude, month and solar hour (0-24).
     Returns altitude and azimuth in degrees. Azimuth is clockwise from north. */
  function position(latitude, month, hour) {
    var dec = declination(month) * RAD;
    var lat = latitude * RAD;
    var ha = (hour - 12) * 15 * RAD;                   // hour angle

    var sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
    sinAlt = U.clamp(sinAlt, -1, 1);
    var alt = Math.asin(sinAlt);

    var cosAz = (Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha)) /
      Math.max(Math.cos(alt), 1e-6);
    var az = Math.acos(U.clamp(cosAz, -1, 1));
    if (ha > 0) az = 2 * Math.PI - az;                  // afternoon -> west of north

    return { altitude: alt / RAD, azimuth: az / RAD, declination: dec / RAD };
  }

  /* Clear-sky direct normal and diffuse horizontal irradiance, W/m2. */
  function clearSky(altitudeDeg, month) {
    if (altitudeDeg <= 0) return { dni: 0, dhi: 0 };
    var k = ABC[month];
    var beta = altitudeDeg * RAD;
    var dni = k.A / Math.exp(k.B / Math.sin(beta));
    return { dni: dni, dhi: k.C * dni };
  }

  /* Total irradiance on a surface, W/m2.
     surfaceAzimuth: degrees clockwise from north. tilt: 90 vertical, 0 horizontal.
     ground reflectance defaults to 0.2 (0.3+ is fair for desert / light paving). */
  function surfaceIrradiance(latitude, month, hour, surfaceAzimuth, tilt, groundRefl) {
    var pos = position(latitude, month, hour);
    if (pos.altitude <= 0) return { total: 0, direct: 0, diffuse: 0, reflected: 0, incidence: 90, altitude: pos.altitude };

    var sky = clearSky(pos.altitude, month);
    var t = (tilt == null ? 90 : tilt) * RAD;
    var beta = pos.altitude * RAD;
    var gamma = (pos.azimuth - surfaceAzimuth) * RAD;    // surface-solar azimuth

    // Angle of incidence on the tilted surface.
    var cosTheta = Math.cos(beta) * Math.cos(gamma) * Math.sin(t) + Math.sin(beta) * Math.cos(t);
    cosTheta = Math.max(cosTheta, 0);

    var direct = sky.dni * cosTheta;

    // Diffuse: ratio Y for vertical surfaces per the ASHRAE treatment,
    // simple tilt factor otherwise.
    var diffuse;
    if (t > 60 * RAD) {
      var Y = Math.max(0.45, 0.55 + 0.437 * cosTheta + 0.313 * cosTheta * cosTheta);
      diffuse = sky.dhi * Y;
    } else {
      diffuse = sky.dhi * (1 + Math.cos(t)) / 2;
    }

    var rho = groundRefl == null ? 0.2 : groundRefl;
    var ghi = sky.dni * Math.sin(beta) + sky.dhi;
    var reflected = ghi * rho * (1 - Math.cos(t)) / 2;

    return {
      total: direct + diffuse + reflected,
      direct: direct, diffuse: diffuse, reflected: reflected,
      incidence: Math.acos(U.clamp(cosTheta, 0, 1)) / RAD,
      altitude: pos.altitude, azimuth: pos.azimuth
    };
  }

  /* Sol-air temperature, C.
       Tsa = To + (alpha * Et / ho) - (dR / ho)
     alpha/ho ~ 0.052 for dark surfaces, 0.026 for light.
     dR/ho is taken as 3.9 K for surfaces facing the sky, 0 for vertical. */
  function solAir(outdoorT, irradiance, absorptance, ho, faceSky) {
    var h = ho || 17.0;                       // W/m2.K outdoor film coefficient
    var a = absorptance == null ? 0.7 : absorptance;
    return outdoorT + a * irradiance / h - (faceSky ? 3.9 : 0);
  }

  /* Fraction of the daily range subtracted from the design dry bulb, by hour.
     Standard design-day temperature profile. */
  var RANGE_FRACTION = [0.87, 0.92, 0.96, 0.99, 1.00, 0.98, 0.93, 0.84, 0.71,
    0.56, 0.39, 0.23, 0.11, 0.03, 0.00, 0.03, 0.10, 0.21, 0.34, 0.47, 0.58,
    0.68, 0.76, 0.82];

  /* Hourly outdoor dry bulb across a design day. */
  function outdoorProfile(designDB, dailyRange) {
    var out = [];
    for (var h = 0; h < 24; h++) out.push(designDB - dailyRange * RANGE_FRACTION[h]);
    return out;
  }

  function orientation(id) {
    for (var i = 0; i < ORIENTATIONS.length; i++) if (ORIENTATIONS[i].id === id) return ORIENTATIONS[i];
    return ORIENTATIONS[0];
  }

  H.solar = {
    ORIENTATIONS: ORIENTATIONS, RANGE_FRACTION: RANGE_FRACTION,
    declination: declination, position: position, clearSky: clearSky,
    surfaceIrradiance: surfaceIrradiance, solAir: solAir,
    outdoorProfile: outdoorProfile, orientation: orientation
  };
})();
