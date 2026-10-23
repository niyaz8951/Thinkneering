/* ============================================================
   Thinkneering Tools - Maps: signs of common components (owner, 23 Oct 2026: "any map is useless without signs and
   icons of common components").
   One small line drawing per kind of component, in the style of HVAC and electrical schematics (a pump is a circle with a
   triangle, a valve a bow-tie, a transformer two circles ...). Drawn with currentColor only, so the theme decides the
   colour (day and night). A branch gets its sign:
     - from its special note "Icon: pump" (an id or a name below; "Icon: none" for no sign), set in the note's Sign row;
     - otherwise from its name (MPSigns.guess): "Pump P-1" is a pump, "MCC-AHU" a panel, "Chiller control panel" a panel.
   scripts/mp-signs-check.mjs checks the guesses on the Electricity and Chilled water templates (part of `npm test`).
   ============================================================ */
(function (root) {
  "use strict";
  var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">', E = "</svg>";
  var SIGNS = {
    chiller: ["Chiller", '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 8.5v7M8.97 10.25l6.06 3.5M8.97 13.75l6.06-3.5M6 18v2.5M18 18v2.5"/>'],
    tower: ["Cooling tower", '<path d="M6.5 20.5 8.5 7h7l2 13.5zM5 20.5h14M9 4h6M12 4v3"/>'],
    pump: ["Pump", '<circle cx="12" cy="12" r="8"/><path d="M9.5 8.3 16.4 12l-6.9 3.7z" fill="currentColor"/>'],
    valve: ["Valve", '<path d="M4 9v10l8-5zM20 9v10l-8-5zM12 14V6M9 6h6"/>'],
    ahu: ["AHU", '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 8.5l2 1.75-2 1.75 2 1.75-2 1.75M11 6v12"/><circle cx="16.5" cy="12" r="3"/><path d="M16.5 12l1.6-1.4M16.5 12l-.4 2"/>'],
    fcu: ["FCU", '<rect x="3" y="7.5" width="18" height="9" rx="1.5"/><path d="M6 14h12M6 10.5h3"/><circle cx="14.5" cy="10.5" r="1.4"/>'],
    fan: ["Fan", '<circle cx="12" cy="12" r="8.5"/><path d="M12 12c-.3-2.6 1-4.6 3.2-4.4 1.6.2 1.4 2.6-.4 3.4zM12 12c2.4 1.1 3.3 3.3 1.8 4.9-1.1 1.2-3.1-.2-2.8-2.2zM12 12c-2.1 1.5-4.5 1.3-5.1-.8-.5-1.6 1.7-2.6 3.3-1.4z"/>'],
    motor: ["Motor", '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 15.5v-7l3.5 4.5 3.5-4.5v7"/>'],
    compressor: ["Compressor", '<circle cx="12" cy="12" r="8.5"/><path d="M4.6 8.4 19.3 9.8M4.6 15.6l14.7-1.4"/>'],
    coil: ["Coil", '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M6 12l2-4 2.7 8 2.6-8 2.7 8 2-4"/>'],
    filter: ["Filter", '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M5 20.5 19 3.5M5 12l7-8.5M12 20.5l7-8.5"/>'],
    damper: ["Damper / actuator", '<path d="M4 5v14M20 5v14M7.5 16 16.5 8"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'],
    header: ["Header", '<rect x="2.5" y="7" width="19" height="4" rx="1"/><path d="M6.5 11v7M12 11v7M17.5 11v7"/>'],
    pipe: ["Pipe run", '<path d="M3 8.5h18M3 15.5h18M9.5 12h5.5M13 10l2 2-2 2"/>'],
    separator: ["Air separator", '<rect x="7" y="3" width="10" height="18" rx="4"/><path d="M3 12h4M17 12h4M12 3V1.5M10 8.5h.01M13.5 10.5h.01M11 13h.01"/>'],
    tank: ["Tank", '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M6.5 13h11"/>'],
    hx: ["Heat exchanger", '<rect x="4" y="4.5" width="16" height="15" rx="1"/><path d="M8 4.5v15M12 4.5v15M16 4.5v15"/>'],
    transformer: ["Transformer", '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>'],
    generator: ["Generator", '<circle cx="12" cy="12" r="8.5"/><path d="M7.3 12c1.2-2.8 3.5-2.8 4.7 0s3.5 2.8 4.7 0"/>'],
    utility: ["Utility supply", '<path d="M12 3 7 21M12 3l5 18M5 7h14M8.4 12h7.2M6.9 17.5h10.2"/>'],
    breaker: ["Breaker / isolator", '<path d="M3 15h4.5M8.5 14.4l8.2-5.4M16.5 15H21"/><circle cx="7.5" cy="15" r="1"/><circle cx="16.5" cy="15" r="1"/>'],
    panel: ["Panel / board", '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 7h8M8 10.5h8M8 14h4M14.5 17h1.5"/>'],
    terminal: ["Terminals", '<rect x="3" y="8.5" width="18" height="7" rx="1"/><path d="M7.5 8.5v7M12 8.5v7M16.5 8.5v7"/><circle cx="5.3" cy="12" r=".6" fill="currentColor"/><circle cx="9.8" cy="12" r=".6" fill="currentColor"/><circle cx="14.3" cy="12" r=".6" fill="currentColor"/><circle cx="18.8" cy="12" r=".6" fill="currentColor"/>'],
    controller: ["Controller / BMS", '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4M6.5 12.5l3-3 2.5 2 5-4.5"/>'],
    sensor: ["Sensor / switch", '<circle cx="12" cy="12" r="2.6"/><path d="M7.6 7.6a6.2 6.2 0 0 0 0 8.8M16.4 7.6a6.2 6.2 0 0 1 0 8.8"/>'],
    drive: ["Drive (VFD)", '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 20 20 4M6.5 9c.8-1.6 2-1.6 2.8 0s2 1.6 2.8 0M13 15.5h4.5M13 17.5h4.5"/>'],
    earth: ["Earth", '<path d="M12 4v8M6 12h12M8.5 15.5h7M10.7 19h2.6"/>'],
    alarm: ["Alarm", '<path d="M6 16v-4.5a6 6 0 0 1 12 0V16l1.8 2H4.2zM10 20.5h4"/>']
  };
  // the name decides: the first rule that matches wins (the most particular first: "Chiller control panel" is a panel)
  var RULES = [
    ["alarm", /\bfire alarm\b|\balarm\b/],
    ["earth", /\bearth\b|\bpe\)|\(pe\)/],
    ["terminal", /\bterminal\b/],
    ["sensor", /\bsensor\b|\bthermometer\b|\b(flow|pressure|float|differential pressure|level)\s+switch\b|\btransmitter\b/],
    ["controller", /\bbms\b|\bcontroller\b|\bthermostat\b|\bplc\b|\bddc\b|\bscada\b/],
    ["transformer", /\btransformer\b|\btr-?\d/],
    ["breaker", /\bincomer\b|\bbreakers?\b|\bisolator\b|\bmcc?b\b|\bacb\b|\brcd\b|\bstarter\b|\bcontactor\b|\bfuse\b|\bq\d\b/],
    ["drive", /\bdrives?\b|\bvfd\b|\bvsd\b|\binverter\b|\bdriver board\b/],
    // "DB" only in capitals: "dB(A)" is a sound level, not a distribution board
    ["panel", /\bpanel\b|\bswitchboard\b|\bmsb\b|\bs?mdb\b|\bdistribution board\b|\bmcc\b|\belectrical box\b|\bpower section\b|\bconsumer unit\b/, /\bDB\b|\bDB-/],
    ["generator", /\bgenerator\b|\bgenset\b|\bg-\d/],
    ["utility", /\butility\b|\bgrid\b|\bmv supply\b|\bsubstation\b/],
    ["tower", /\bcooling towers?\b/],
    ["hx", /\bheat exchangers?\b|\bphe\b|\bhx\b|\bets\b/],
    ["separator", /\b(air|dirt) separators?\b|\bdeaerator\b/],
    ["tank", /\btanks?\b|\bexpansion vessel\b|\bbuffer\b/],
    ["header", /\bheaders?\b|\bmanifold\b/],
    ["pipe", /\briser\b|\bchw[sr]\b|\bcw[sr]\b|\bpipe\b|\bpiping\b/],
    ["pump", /\bpumps?\b|\bp-\d/],
    ["valve", /\bvalves?\b|\bpicv\b|\bdpcv\b/],
    ["damper", /\bdampers?\b|\bactuators?\b/],
    ["chiller", /\bchillers?\b|\bch-\d/],
    ["ahu", /\bahus?\b|\bair handling\b|\bfahu\b/],
    ["fcu", /\bfcus?\b|\bfan coils?\b/],
    ["compressor", /\bcompressors?\b/],
    ["motor", /\bmotors?\b/],
    ["fan", /\bfans?\b|\bblower\b/],
    ["coil", /\bcoils?\b/],
    ["filter", /\bfilters?\b/]
  ];
  function guess(title) {
    var o = " " + String(title || "") + " ", t = o.toLowerCase();
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(t) || (RULES[i][2] && RULES[i][2].test(o))) return RULES[i][0];
    return "";
  }
  // a special note "Icon: ..." wins: an id, a name ("Heat exchanger"), or none / off / no
  function chosen(special) {
    for (var i = 0; i < (special || []).length; i++) {
      var m = /^\s*(?:icon|sign)\s*:\s*(.+)$/i.exec(special[i]);
      if (!m) continue;
      var v = m[1].trim().toLowerCase();
      if (/^(none|off|no)$/.test(v)) return { id: "", set: true };
      if (SIGNS[v]) return { id: v, set: true };
      for (var k in SIGNS) if (SIGNS[k][0].toLowerCase() === v || SIGNS[k][0].toLowerCase().split(" / ")[0] === v) return { id: k, set: true };
      return { id: guess(v), set: true };
    }
    return { id: "", set: false };
  }
  function of(n) { var c = chosen(n.special); return c.set ? c.id : guess(n.title); }
  function svg(id) { return SIGNS[id] ? S + SIGNS[id][1] + E : ""; }
  function name(id) { return SIGNS[id] ? SIGNS[id][0] : ""; }
  root.MPSigns = { SIGNS: SIGNS, ids: Object.keys(SIGNS), guess: guess, chosen: chosen, of: of, svg: svg, name: name };
})(typeof window !== "undefined" ? window : this);
