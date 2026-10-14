/* DAME Tools Hub - Standards library content.
   One object per standard. To add a standard, add an object here; nothing else changes.
     id       address of the page (standard.html#id), lower case, no spaces
     code     short name shown on the tile
     title    full title or plain description
     body     publishing organisation
     group    one of GROUPS below
     products any of "ahu", "fcu", "chiller"
     edition  latest edition known when this was written (always to be checked)
     keys     how the standard is written in specifications (used by "Check a specification").
              Only names of this standard: a different number (90.2 for 90.1) is never a key.
     near     optional { word, words: [] } for a body with several programmes ("Eurovent"):
              the word counts for this page only when one of the words is close to it
     covers   what the standard is about
     spec     how it shows up in a specification
     points   key points, in our own words
     table    optional { caption, head: [], rows: [[]] }
     check    what to check before answering a compliance line
     related  ids of related standards
   The text is a summary in our own words. It never copies the standard. */
(function () {
  "use strict";

  var GROUPS = [
    { id: "unit",      name: "AHU unit and casing" },
    { id: "coils",     name: "Coils" },
    { id: "fans",      name: "Fans" },
    { id: "filters",   name: "Filtration" },
    { id: "recovery",  name: "Heat recovery" },
    { id: "dampers",   name: "Dampers and ductwork" },
    { id: "hygiene",   name: "Hygiene and healthcare" },
    { id: "vent",      name: "Ventilation and energy" },
    { id: "fire",      name: "Fire and product safety" },
    { id: "elec",      name: "Motors and electrical" },
    { id: "sound",     name: "Sound" },
    { id: "materials", name: "Materials and corrosion" },
    { id: "fcu",       name: "Fan coil units" },
    { id: "chiller",   name: "Chillers and refrigerants" },
    { id: "regional",  name: "Gulf codes" },
    { id: "quality",   name: "Quality systems" }
  ];

  var ITEMS = [

  /* ------------------------------------------------ AHU unit and casing */
  { id: "en-1886", code: "EN 1886", title: "Air handling units - Mechanical performance", body: "CEN", group: "unit", products: ["ahu"],
    edition: "EN 1886:2007",
    keys: ["EN 1886", "BS EN 1886", "DIN EN 1886"],
    covers: "The European test for AHU casings. It gives a class for casing strength (D), casing air leakage (L), filter bypass leakage (F), thermal transmittance (T) and thermal bridging (TB). It also covers the acoustic insulation of the casing.",
    spec: "Usually one line in Part 2 under Casing: \"casing shall be D1 / L1 / F9 / T2 / TB2 to EN 1886\". Sometimes the spec asks for the Eurovent certificate as proof.",
    points: [
      "Classes are measured either on a model box (suffix M) or on a real unit (suffix R). Eurovent certified classes are model box values.",
      "Leakage is tested at 400 Pa negative pressure, and at 700 Pa positive pressure for sections that run under positive pressure.",
      "Filter bypass leakage is a percentage of the unit airflow. The better the filter, the lower the allowed bypass.",
      "T is the U-value of the casing. TB is the thermal bridging factor: a higher factor means less risk of condensation on the casing.",
      "Lower number is better for every class (D1, L1, T1, TB1). For filter bypass, F9 is the tightest."
    ],
    table: { caption: "Class limits in EN 1886:2007",
      head: ["Property", "Class", "Limit"],
      rows: [
        ["Casing strength", "D1", "Deflection up to 4 mm/m"],
        ["", "D2", "Deflection up to 10 mm/m"],
        ["", "D3", "Deflection over 10 mm/m"],
        ["Casing leakage at -400 Pa", "L1", "0.15 l/s per m²"],
        ["", "L2", "0.44 l/s per m²"],
        ["", "L3", "1.32 l/s per m²"],
        ["Casing leakage at +700 Pa", "L1", "0.22 l/s per m²"],
        ["", "L2", "0.63 l/s per m²"],
        ["", "L3", "1.90 l/s per m²"],
        ["Filter bypass (share of airflow)", "F9", "0.5 %"],
        ["", "F8", "1 %"],
        ["", "F7", "2 %"],
        ["", "F6", "4 %"],
        ["", "G1 to F5", "6 %"],
        ["Thermal transmittance U", "T1", "Up to 0.5 W/m²K"],
        ["", "T2", "Over 0.5 up to 1.0 W/m²K"],
        ["", "T3", "Over 1.0 up to 1.4 W/m²K"],
        ["", "T4", "Over 1.4 up to 2.0 W/m²K"],
        ["", "T5", "No requirement"],
        ["Thermal bridging factor kb", "TB1", "0.75 to 1.00"],
        ["", "TB2", "0.60 to 0.75"],
        ["", "TB3", "0.45 to 0.60"],
        ["", "TB4", "0.30 to 0.45"],
        ["", "TB5", "No requirement"]
      ] },
    check: [
      "Which classes the offered range and panel thickness hold on its Eurovent certificate. Classes change with panel type.",
      "Whether the spec means model box (M) or real unit (R) values.",
      "A spec written in AHRI 1350 classes (CD, CL, CT) is a different scale. Do not answer it with EN 1886 classes without saying so."
    ],
    related: ["en-13053", "eurovent-ahu", "ahri-1350"] },

  { id: "en-13053", code: "EN 13053", title: "Air handling units - Rating and performance for units, components and sections", body: "CEN", group: "unit", products: ["ahu"],
    edition: "EN 13053:2019",
    keys: ["EN 13053", "BS EN 13053", "DIN EN 13053"],
    covers: "How the performance of a complete AHU and of its sections is rated and tested: airflow, pressure, fan power, coils, heat recovery, humidifiers, filters and sound. It is the companion of EN 1886.",
    spec: "Part 1 references, and Part 2 lines such as \"face velocity class V3 or better\", \"heat recovery class H2\" or \"power class P2 to EN 13053\".",
    points: [
      "Velocity classes V1 to V9 are based on the air velocity in the empty casing cross-section at the filter section, not at the coil face.",
      "Heat recovery classes (H) combine the dry efficiency and the pressure drop of the recovery device.",
      "Power classes (P) compare the fan's absorbed power with a reference value for that airflow and pressure.",
      "It also sets design rules: drain pans, access, filter section length, coil fin spacing limits for cleaning."
    ],
    table: { caption: "Velocity classes (velocity in the casing cross-section)",
      head: ["Class", "Velocity"],
      rows: [["V1", "Up to 1.6 m/s"], ["V2", "Over 1.6 up to 1.8 m/s"], ["V3", "Over 1.8 up to 2.0 m/s"], ["V4", "Over 2.0 up to 2.2 m/s"], ["V5", "Over 2.2 up to 2.5 m/s"], ["V6", "Over 2.5 up to 2.8 m/s"], ["V7", "Over 2.8 up to 3.2 m/s"], ["V8", "Over 3.2 up to 3.6 m/s"], ["V9", "Over 3.6 m/s"]] },
    check: [
      "The class printed on the selection for this unit. Classes are per selection, not per range.",
      "The H and P class limits changed between editions. Answer with the edition the selection software uses."
    ],
    related: ["en-1886", "eurovent-ahu", "erp-1253"] },

  { id: "eurovent-ahu", code: "Eurovent AHU", title: "Eurovent Certified Performance - Air handling units", body: "Eurovent Certita Certification", group: "unit", products: ["ahu"],
    edition: "Programme rules are revised regularly",
    near: { word: "Eurovent", words: ["air handling", "AHU", "EN 1886", "EN 13053"] },
    keys: ["Eurovent AHU", "Eurovent Certified Performance AHU"],
    covers: "Third-party certification of an AHU range and its selection software. Casing classes to EN 1886 and performance to EN 13053 are checked by independent tests, and certified ranges are listed in a public directory.",
    spec: "\"Units shall be Eurovent certified\" or \"manufacturer shall take part in the Eurovent AHU programme; submit the certificate\". Often also \"energy class A or better\".",
    points: [
      "The certificate is for a named range and a named software version, not for one project unit.",
      "The energy class (A+ to E) is worked out per selection from face velocity, heat recovery and fan power.",
      "The certified casing classes are model box values to EN 1886.",
      "Anyone can check a claim in the Eurovent directory. Consultants do."
    ],
    check: [
      "That the range and factory offered are on the current certificate.",
      "The energy class printed on the technical report for each unit."
    ],
    related: ["en-1886", "en-13053"] },

  { id: "ahri-430", code: "AHRI 430", title: "Performance rating of central station air-handling unit supply fans", body: "AHRI", group: "unit", products: ["ahu"],
    edition: "AHRI 430 (I-P) / 431 (SI), 2020",
    keys: ["AHRI 430", "ARI 430", "AHRI 431"],
    covers: "US method for rating the supply fan of a central station AHU as installed in the unit: airflow, static pressure, speed and power, with the effect of the cabinet included.",
    spec: "Common in US-based master specs: \"fan performance shall be rated and certified in accordance with AHRI 430\".",
    points: [
      "It rates the fan inside the unit, so cabinet effect is included. AMCA 210 rates the bare fan.",
      "AHRI runs a certification programme on it. \"Certified\" means the manufacturer is in that programme.",
      "European units are normally rated to EN 13053 with fans tested to ISO 5801."
    ],
    check: [
      "Whether the offered range is AHRI 430 certified. If not, state the basis actually used (EN 13053, ISO 5801 fan data, Eurovent certified software)."
    ],
    related: ["amca-210", "en-13053", "ahri-410"] },

  { id: "ahri-1350", code: "AHRI 1350", title: "Mechanical performance rating of central station air-handling unit casings", body: "AHRI", group: "unit", products: ["ahu"],
    edition: "AHRI 1350 (I-P), 2014",
    keys: ["AHRI 1350"],
    covers: "The US counterpart of EN 1886. It rates casing deflection, casing air leakage and thermal performance of an AHU casing.",
    spec: "\"Casing leakage class CL... and deflection class CD... to AHRI 1350\", mostly in US-origin specifications.",
    points: [
      "Deflection, leakage and thermal classes use their own scales and test pressures.",
      "The classes cannot be converted one-to-one into EN 1886 classes."
    ],
    check: [
      "If the unit is only tested to EN 1886, say so and offer the EN 1886 classes as the equivalent basis."
    ],
    related: ["en-1886"] },

  { id: "erp-1253", code: "EU 1253/2014", title: "Ecodesign requirements for ventilation units (ErP)", body: "European Commission", group: "unit", products: ["ahu"],
    edition: "Regulation (EU) No 1253/2014, second tier in force since 2018",
    keys: ["1253/2014", "ErP 2018", "ErP 2016", "Ecodesign"],
    covers: "EU law that sets minimum efficiency for ventilation units placed on the EU market: heat recovery, fan efficiency and internal specific fan power.",
    spec: "\"Units shall be ErP 2018 compliant\". It is not law in the Gulf, but consultants copy the line.",
    points: [
      "Two-way (supply and extract) units must have heat recovery with a thermal bypass.",
      "Minimum dry thermal efficiency since 2018: 73 % for wheels and plates, 68 % for run-around coils.",
      "There is a limit on internal specific fan power (SFPint), and fans must be multi-speed or variable speed.",
      "One-way units have a minimum fan efficiency instead."
    ],
    check: [
      "The ErP statement on the technical report for the unit.",
      "A recirculation unit or a unit without heat recovery falls outside the two-way rules. Say which case applies."
    ],
    related: ["en-13053", "en-308"] },

  /* ------------------------------------------------ Coils */
  { id: "ahri-410", code: "AHRI 410", title: "Forced-circulation air-cooling and air-heating coils", body: "AHRI", group: "coils", products: ["ahu", "fcu"],
    edition: "AHRI 410, 2001 with addenda",
    keys: ["AHRI 410", "ARI 410"],
    covers: "US rating standard for chilled water, hot water, steam and direct expansion coils. It fixes how coil capacity and air and water pressure drops are tested and calculated.",
    spec: "\"Coils shall be rated and certified in accordance with AHRI 410\". Usually next to limits on face velocity, fin spacing and rows.",
    points: [
      "Ratings are valid only inside the standard's range of velocities, temperatures and fluid conditions.",
      "AHRI certification covers the coil maker's selection software.",
      "The standard is about thermal rating. Materials, coatings and test pressure come from the project specification."
    ],
    check: [
      "Whether the coil selection is AHRI 410 certified or rated to EN 13053 / Eurovent certified software.",
      "Spec limits that sit beside it: face velocity, fins per inch, tube and fin material, test pressure."
    ],
    related: ["en-13053", "ahri-440"] },

  /* ------------------------------------------------ Fans */
  { id: "amca-210", code: "AMCA 210 / ISO 5801", title: "Laboratory methods of testing fans for aerodynamic performance", body: "AMCA / ASHRAE / ISO", group: "fans", products: ["ahu", "fcu"],
    edition: "ANSI/AMCA 210-16 (ASHRAE 51-16); ISO 5801:2017",
    keys: ["AMCA 210", "ASHRAE 51", "ISO 5801"],
    covers: "How a fan is tested in a laboratory for airflow, pressure, power and efficiency. A fan curve is only reliable if it was taken to one of these methods.",
    spec: "\"Fans shall be tested to AMCA 210 and bear the AMCA certified ratings seal\" or \"fan performance to ISO 5801\".",
    points: [
      "It is a test method. It sets no minimum performance.",
      "The test arrangement (free or ducted inlet and outlet) changes the result. A plug fan curve should be for free inlet, free outlet.",
      "The AMCA seal comes from the certified ratings programme (AMCA 211 for air, AMCA 311 for sound), not from the test standard itself.",
      "A fan tested alone does not include the cabinet effect of the AHU."
    ],
    check: [
      "Whether the fan maker's data is to ISO 5801 or AMCA 210, and whether the spec insists on the AMCA seal.",
      "If only ISO 5801 data is available, offer it as the equivalent test method."
    ],
    related: ["amca-300", "amca-204", "amca-205", "ahri-430"] },

  { id: "amca-300", code: "AMCA 300", title: "Reverberant room method for sound testing of fans", body: "AMCA", group: "fans", products: ["ahu"],
    edition: "ANSI/AMCA 300-14",
    keys: ["AMCA 300", "AMCA 301", "AMCA 311"],
    covers: "How fan sound power is measured in a reverberant room, in eight octave bands. AMCA 301 gives the calculation of ratings from test data and AMCA 311 is the certified sound ratings programme.",
    spec: "\"Fan sound power levels shall be tested to AMCA 300 and rated to AMCA 301\".",
    points: [
      "The result is sound power of the fan, not sound pressure in the room and not the sound of the whole AHU.",
      "AHU sound data (inlet, outlet, casing breakout) is normally calculated to EN 13053 or AHRI 260."
    ],
    check: [
      "Which sound figures the spec wants: fan alone, or unit inlet / outlet / casing radiated."
    ],
    related: ["amca-210", "ahri-260", "iso-3741"] },

  { id: "amca-204", code: "AMCA 204 / ISO 14694", title: "Balance quality and vibration levels for fans", body: "AMCA / ISO", group: "fans", products: ["ahu"],
    edition: "ANSI/AMCA 204-20; ISO 14694:2003",
    keys: ["AMCA 204", "ISO 14694"],
    covers: "Sets fan application categories (BV-1 to BV-5), the balance quality grade for each and the vibration limits at the factory and on site.",
    spec: "\"Fans shall be balanced to AMCA 204, category BV-3, grade G6.3\" or \"vibration shall not exceed ... mm/s\".",
    points: [
      "Most commercial HVAC fans fall in category BV-2 or BV-3.",
      "Vibration limits differ for rigid and flexible mounting, and for factory test and site start-up."
    ],
    table: { caption: "Balance grade by fan category",
      head: ["Category", "Balance quality grade"],
      rows: [["BV-1", "G16"], ["BV-2", "G16"], ["BV-3", "G6.3"], ["BV-4", "G2.5"], ["BV-5", "G1.0"]] },
    check: [
      "The balance grade stated by the fan maker for the offered fan (plug fans and EC fans are usually G6.3 or better).",
      "Whether the spec asks for a site vibration test, which is in the contractor's scope."
    ],
    related: ["iso-21940", "amca-210"] },

  { id: "iso-21940", code: "ISO 21940-11", title: "Rotor balancing - Balance tolerances for rigid rotors (formerly ISO 1940-1)", body: "ISO", group: "fans", products: ["ahu", "fcu"],
    edition: "ISO 21940-11:2016, replaced ISO 1940-1:2003",
    keys: ["ISO 21940-11", "ISO 1940"],
    covers: "Defines balance quality grades (G) for rotating parts such as fan impellers and motors.",
    spec: "\"Fan wheels shall be statically and dynamically balanced to ISO 1940 grade G2.5\" (or G6.3).",
    points: [
      "A lower G number is a finer balance. G6.3 is normal for fans, G2.5 is a tighter request.",
      "Specifications still quote ISO 1940. The grades are the same in ISO 21940-11."
    ],
    check: [
      "The grade on the fan maker's datasheet. Do not accept G2.5 unless the fan maker states it."
    ],
    related: ["amca-204"] },

  { id: "amca-205", code: "AMCA 205 / 208", title: "Fan efficiency grade (FEG) and fan energy index (FEI)", body: "AMCA", group: "fans", products: ["ahu"],
    edition: "ANSI/AMCA 205-19; ANSI/AMCA 208-18",
    keys: ["AMCA 205", "AMCA 208"],
    covers: "AMCA 205 classifies a fan by its peak efficiency (FEG). AMCA 208 defines the fan energy index (FEI), which compares the fan's power at the duty point with a reference fan.",
    spec: "\"Fans shall have a minimum FEG of 67 and be selected within 15 points of peak efficiency\" or, in newer specs, \"FEI of 1.0 or higher at the design point\".",
    points: [
      "FEG is a property of the fan. FEI depends on the duty point, so it must be checked per selection.",
      "ASHRAE 90.1 moved from FEG to FEI from its 2019 edition.",
      "An FEI of 1.0 means the fan uses the same power as the reference fan. Higher is better."
    ],
    check: [
      "Whether the fan maker publishes FEG or FEI for the offered fan and motor.",
      "European fans are normally declared to the EU fan regulation 327/2011 instead. Offer that if FEG / FEI is not published."
    ],
    related: ["amca-210", "ashrae-90-1"] },

  { id: "amca-230", code: "AMCA 230", title: "Laboratory methods of testing air circulating fans", body: "AMCA", group: "fans", products: ["ahu", "fcu"],
    edition: "ANSI/AMCA 230-15",
    keys: ["AMCA 230"],
    covers: "Test method for air circulating fans: ceiling fans, desk fans and similar fans that move air inside a room.",
    spec: "Appears in general fan reference lists that were copied into an AHU or FCU specification.",
    points: [
      "It does not apply to the fans inside an AHU or FCU. Those are covered by AMCA 210 / ISO 5801."
    ],
    check: [
      "Answer as not applicable to the offered equipment, and name the standard that does apply."
    ],
    related: ["amca-210"] },

  { id: "iso-281", code: "ISO 281 / ABMA 9", title: "Rolling bearings - Rating life (L10)", body: "ISO / ABMA", group: "fans", products: ["ahu"],
    edition: "ISO 281:2007; ABMA 9 (ball) and ABMA 11 (roller)",
    keys: ["ISO 281", "ABMA 9", "ABMA 11", "AFBMA 9", "AFBMA 11"],
    covers: "How the rating life of a bearing is calculated. L10 is the life that 90 % of a group of identical bearings will reach.",
    spec: "\"Bearings shall have an L10 life of not less than 200,000 hours\" (the figure varies: 40,000, 100,000, 200,000).",
    points: [
      "L50 (average life) is about five times L10. Check which one the spec asks for.",
      "Direct-drive plug fans and EC fans use the motor bearings. The life figure then comes from the motor maker."
    ],
    check: [
      "The bearing life stated by the fan or motor maker at the selected speed and load."
    ],
    related: ["amca-204"] },

  /* ------------------------------------------------ Filtration */
  { id: "iso-16890", code: "ISO 16890", title: "Air filters for general ventilation", body: "ISO", group: "filters", products: ["ahu", "fcu"],
    edition: "ISO 16890:2016, parts 1 to 4",
    keys: ["ISO 16890"],
    covers: "The current classification of general ventilation filters by how well they remove particles of a given size: ePM1, ePM2.5, ePM10 and Coarse. It replaced EN 779 in 2018.",
    spec: "\"Pre-filter ISO Coarse 65 %, final filter ePM1 60 %\". Many specs still write G4 + F7 and add \"or ISO 16890 equivalent\".",
    points: [
      "A filter joins a group when its efficiency for that particle range is 50 % or more. The value is reported in steps of 5 %.",
      "For ePM1 and ePM2.5 the minimum efficiency, measured after the electrostatic charge is removed, must also be 50 % or more.",
      "Filters under 50 % ePM10 are ISO Coarse, reported by gravimetric arrestance.",
      "There is no exact conversion from EN 779. The usual working equivalents are below; the filter maker's ISO 16890 rating is what counts."
    ],
    table: { caption: "Usual working equivalents (not an official conversion)",
      head: ["EN 779", "ISO 16890", "ASHRAE 52.2"],
      rows: [["G4", "ISO Coarse 60 % or more", "MERV 7 to 8"], ["M5", "ePM10 50 % or more", "MERV 9 to 10"], ["M6", "ePM2.5 50 % or more", "MERV 11 to 12"], ["F7", "ePM1 50 to 65 %", "MERV 13"], ["F8", "ePM1 65 to 80 %", "MERV 14"], ["F9", "ePM1 80 % or more", "MERV 15"]] },
    check: [
      "The ISO 16890 class on the filter maker's datasheet for the exact filter offered.",
      "If the spec is in EN 779 or MERV, give the ISO class and state it is offered as equivalent."
    ],
    related: ["en-779", "ashrae-52-2", "en-1822", "ul-900"] },

  { id: "en-779", code: "EN 779", title: "Particulate air filters for general ventilation (withdrawn)", body: "CEN", group: "filters", products: ["ahu", "fcu"],
    edition: "EN 779:2012, withdrawn in 2018",
    keys: ["EN 779", "BS EN 779"],
    covers: "The old European filter classes G1 to G4, M5 to M6 and F7 to F9. Withdrawn and replaced by ISO 16890, but still written in many Gulf specifications.",
    spec: "\"Panel filter G4 and bag filter F7 to EN 779\".",
    points: [
      "G classes are by arrestance, M and F classes by average efficiency at 0.4 micron.",
      "The 2012 edition added a minimum efficiency for F7 (35 %), F8 (55 %) and F9 (70 %)."
    ],
    check: [
      "Answer with the ISO 16890 class of the offered filter and the old class it is sold as."
    ],
    related: ["iso-16890", "ashrae-52-2"] },

  { id: "ashrae-52-2", code: "ASHRAE 52.2", title: "Method of testing general ventilation air-cleaning devices (MERV)", body: "ASHRAE", group: "filters", products: ["ahu", "fcu"],
    edition: "ANSI/ASHRAE 52.2-2017",
    keys: ["ASHRAE 52.2", "MERV"],
    covers: "US filter test that gives the MERV rating, from 1 to 16, based on efficiency in three particle size ranges (0.3 to 1, 1 to 3 and 3 to 10 micron).",
    spec: "\"Pre-filter MERV 8, final filter MERV 13 or 14\". ASHRAE 62.1, 90.1, 170 and LEED all quote MERV.",
    points: [
      "Higher MERV is a better filter. MERV 13 and above are graded on the smallest particle range.",
      "MERV-A (Appendix J) is the rating after the electrostatic charge is removed.",
      "ASHRAE 52.1 (dust spot efficiency) is obsolete but still appears as \"85 % dust spot\"."
    ],
    check: [
      "The MERV rating on the filter maker's datasheet, or the ISO 16890 class offered as equivalent."
    ],
    related: ["iso-16890", "en-779", "ashrae-170"] },

  { id: "en-1822", code: "EN 1822 / ISO 29463", title: "High efficiency air filters (EPA, HEPA and ULPA)", body: "CEN / ISO", group: "filters", products: ["ahu"],
    edition: "EN 1822-1:2019; ISO 29463 parts 2 to 5 for the test methods",
    keys: ["EN 1822", "ISO 29463", "BS EN 1822"],
    covers: "Classification and testing of EPA, HEPA and ULPA filters at their most penetrating particle size (MPPS).",
    spec: "\"Final filter H13 (or H14) to EN 1822, individually tested, with test certificate\". Found in hospital, pharmaceutical and clean room units.",
    points: [
      "HEPA filters (H13 and above) are leak tested one by one and carry their own test report.",
      "The filter frame and its sealing matter as much as the media. Check the holding frame and the bypass class of the casing.",
      "US specs may ask for \"99.97 % at 0.3 micron\", which is close to H13 but is a different test."
    ],
    table: { caption: "Classes (overall efficiency at MPPS)",
      head: ["Group", "Class", "Efficiency"],
      rows: [["EPA", "E10", "85 % or more"], ["", "E11", "95 % or more"], ["", "E12", "99.5 % or more"], ["HEPA", "H13", "99.95 % or more"], ["", "H14", "99.995 % or more"], ["ULPA", "U15", "99.9995 % or more"], ["", "U16", "99.99995 % or more"], ["", "U17", "99.999995 % or more"]] },
    check: [
      "Whether the HEPA stage is inside the AHU or at the room terminal. Terminal HEPA is outside the AHU scope.",
      "Fan static pressure allows for the dirty HEPA pressure drop."
    ],
    related: ["iso-16890", "din-1946-4", "ashrae-170"] },

  { id: "ul-900", code: "UL 900", title: "Air filter units - Flammability", body: "UL", group: "filters", products: ["ahu", "fcu"],
    edition: "UL 900, current edition",
    keys: ["UL 900"],
    covers: "Fire test for air filters: how much they burn and how much smoke they give off when exposed to flame.",
    spec: "\"Filters shall be UL 900 listed\" (older specs: \"UL Class 1\" or \"UL Class 2\"). NFPA 90A requires it.",
    points: [
      "The old Class 1 and Class 2 split was removed. Filters are now simply classified to UL 900.",
      "European filters are usually classified for fire to EN 13501-1 instead."
    ],
    check: [
      "The filter maker's UL 900 statement for the exact filter, or the EN 13501-1 class offered as equivalent."
    ],
    related: ["nfpa-90a", "en-13501-1", "iso-16890"] },

  { id: "iso-10121", code: "ISO 10121 / ASHRAE 145.2", title: "Gas-phase air cleaning media and devices", body: "ISO / ASHRAE", group: "filters", products: ["ahu"],
    edition: "ISO 10121-1 and -2; ANSI/ASHRAE 145.2",
    keys: ["ISO 10121", "ASHRAE 145.2"],
    covers: "Test methods for chemical (gas-phase) filters: activated carbon and impregnated media such as potassium permanganate on alumina. They measure removal efficiency and capacity against a challenge gas.",
    spec: "\"Chemical filter section with activated carbon / KMnO4 media, tested to ISO 10121\", often with a required residence time and target gases.",
    points: [
      "They are test methods. The target gas, efficiency and media life come from the project specification.",
      "Carbon is used mainly for volatile organic compounds and ozone; permanganate media for acid gases such as H2S and SO2. Many specs ask for a blend or two stages.",
      "Residence time fixes the bed depth and therefore the section length and pressure drop."
    ],
    check: [
      "Media type, bed depth and residence time against the spec, and the pressure drop used in the fan selection.",
      "A particle filter is needed before and after the chemical stage."
    ],
    related: ["iso-16890", "ashrae-62-1"] },

  { id: "ashrae-185", code: "ASHRAE 185.1 / 185.2", title: "Testing ultraviolet (UV-C) lamps for use in air handling units", body: "ASHRAE", group: "filters", products: ["ahu"],
    edition: "ANSI/ASHRAE 185.1 (air stream) and 185.2 (surfaces)",
    keys: ["ASHRAE 185.1", "ASHRAE 185.2"],
    covers: "Test methods for UV-C devices in AHUs and ducts: 185.1 for inactivating micro-organisms in the moving air, 185.2 for irradiating surfaces such as coils and drain pans.",
    spec: "\"UVGI lamps downstream of the cooling coil, tested to ASHRAE 185.2\", with a required intensity on the coil face.",
    points: [
      "They are test methods. The required dose or intensity comes from the project specification.",
      "UV-C damages unprotected plastics, cable insulation and filter media in line of sight.",
      "Door interlock switches and a viewing port are the usual safety requirements."
    ],
    check: [
      "UV maker's intensity calculation for the coil size, door interlocks, and UV-resistant materials near the lamps."
    ],
    related: ["ashrae-62-1", "ashrae-170"] },

  /* ------------------------------------------------ Heat recovery */
  { id: "en-308", code: "EN 308", title: "Test procedures for air-to-air heat recovery components", body: "CEN", group: "recovery", products: ["ahu"],
    edition: "EN 308:2022",
    keys: ["EN 308", "BS EN 308"],
    covers: "How the performance of heat recovery devices is tested: temperature and humidity efficiency, pressure drop and internal and external leakage. Covers wheels, plate exchangers and run-around coils.",
    spec: "\"Heat recovery efficiency shall be tested to EN 308\" and \"wheel shall be Eurovent certified\".",
    points: [
      "Efficiency is measured at balanced mass flow. With unbalanced supply and extract flows the real efficiency on the supply side changes.",
      "The 2022 edition added leakage figures for wheels: exhaust air transfer ratio (EATR) and outdoor air correction factor (OACF).",
      "Eurovent certifies wheels and plate exchangers on this test."
    ],
    check: [
      "Efficiency at the project airflows, not only at balanced flow.",
      "Whether sensible, latent or total efficiency is being asked for."
    ],
    related: ["ahri-1060", "en-13053", "erp-1253"] },

  { id: "ahri-1060", code: "AHRI 1060 / ASHRAE 84", title: "Rating of air-to-air exchangers for energy recovery", body: "AHRI / ASHRAE", group: "recovery", products: ["ahu"],
    edition: "AHRI 1060 (I-P) / 1061 (SI); ANSI/ASHRAE 84",
    keys: ["AHRI 1060", "ARI 1060", "AHRI 1061", "ASHRAE 84"],
    covers: "US rating of heat wheels, plates and heat pipes. ASHRAE 84 is the test method; AHRI 1060 sets the rating conditions and the certification programme.",
    spec: "\"Energy recovery wheel shall be AHRI 1060 certified and bear the AHRI seal\".",
    points: [
      "It reports sensible, latent and total effectiveness at 100 % and 75 % airflow, for summer and winter conditions.",
      "It also reports EATR (carry-over of exhaust air into supply) and OACF (extra outdoor air needed because of leakage and purge).",
      "The certificate is for the exchanger alone, not for the AHU."
    ],
    check: [
      "Whether the wheel maker is AHRI 1060 listed, Eurovent certified, or both.",
      "Effectiveness at the real airflow ratio of the project."
    ],
    related: ["en-308", "ashrae-90-1"] },

  /* ------------------------------------------------ Dampers and ductwork */
  { id: "en-1751", code: "EN 1751", title: "Air terminal devices - Aerodynamic testing of dampers and valves", body: "CEN", group: "dampers", products: ["ahu"],
    edition: "EN 1751:2014",
    keys: ["EN 1751", "BS EN 1751"],
    covers: "Test method and leakage classes for dampers: leakage past the closed blades and leakage through the damper casing.",
    spec: "\"Dampers shall be leakage class 2 (or 3, or 4) to EN 1751\".",
    points: [
      "Closed blade leakage classes run from 0 to 4. Class 4 is the tightest.",
      "Casing leakage classes are A, B and C. Class C is the tightest.",
      "A shut-off or isolating damper needs a higher class than a mixing or balancing damper."
    ],
    check: [
      "The class on the damper maker's datasheet for the size used.",
      "A spec in AMCA 511 classes uses a different scale."
    ],
    related: ["amca-500-d"] },

  { id: "amca-500-d", code: "AMCA 500-D / 511", title: "Testing and certified ratings of dampers", body: "AMCA", group: "dampers", products: ["ahu"],
    edition: "ANSI/AMCA 500-D; AMCA 511",
    keys: ["AMCA 500-D", "AMCA 511"],
    covers: "AMCA 500-D is the laboratory test for damper leakage and pressure drop. AMCA 511 is the certified ratings programme and defines the leakage classes.",
    spec: "\"Low leakage dampers, AMCA Class 1A at 1 in. wg, bearing the AMCA seal\".",
    points: [
      "Leakage is given per unit of damper face area at a stated pressure. Class 1A is the tightest."
    ],
    table: { caption: "AMCA 511 leakage classes at 1 in. wg (250 Pa)",
      head: ["Class", "Maximum leakage"],
      rows: [["1A", "3 cfm/ft²"], ["1", "4 cfm/ft²"], ["2", "10 cfm/ft²"], ["3", "40 cfm/ft²"]] },
    check: [
      "Whether the offered damper has AMCA data or EN 1751 data, and offer the available one as equivalent."
    ],
    related: ["en-1751"] },

  { id: "smacna", code: "SMACNA / DW 144", title: "Duct construction standards", body: "SMACNA / BESA", group: "dampers", products: ["ahu"],
    edition: "SMACNA HVAC Duct Construction Standards, Metal and Flexible; BESA DW/144",
    keys: ["SMACNA", "DW 144", "DW/144", "DW144"],
    covers: "How sheet metal ductwork is built, reinforced and sealed for a given pressure class. SMACNA is the US document, DW/144 the British one.",
    spec: "In an AHU spec it is usually in Part 3 for duct connections, flexible connectors and field-built plenums.",
    points: [
      "These apply to ductwork made and installed by the contractor, not to the factory-built AHU casing.",
      "The AHU casing is covered by EN 1886 or AHRI 1350."
    ],
    check: [
      "Normally answered as contractor's scope, or as not applicable to the unit casing."
    ],
    related: ["en-1886"] },

  /* ------------------------------------------------ Hygiene and healthcare */
  { id: "vdi-6022", code: "VDI 6022", title: "Hygiene requirements for ventilation and air-conditioning systems and units", body: "VDI", group: "hygiene", products: ["ahu"],
    edition: "VDI 6022 Part 1, 2018",
    keys: ["VDI 6022"],
    covers: "German guideline for hygienic design, manufacture, operation and maintenance of air handling systems. It is the basis of the term \"hygienic AHU\".",
    spec: "\"AHUs shall be of hygienic design to VDI 6022, with a certificate from an independent body\".",
    points: [
      "Inside surfaces must be smooth, closed-pore, cleanable and must not support microbial growth. Sealants and gaskets need a test certificate for this.",
      "Every component must be reachable for inspection and cleaning from both sides, or be removable.",
      "Drain pans must slope, drain fully and be corrosion resistant. No standing water anywhere in the unit.",
      "At least two filter stages. Filters must be kept dry: relative humidity at the filter is limited.",
      "It also covers operation: regular hygiene inspections and trained staff (category A and B training)."
    ],
    check: [
      "Whether the offered range has a VDI 6022 certificate, and for which options (materials, drain pans, access).",
      "Operation and inspection clauses belong to the building operator, not the manufacturer."
    ],
    related: ["din-1946-4", "en-13053", "htm-03-01"] },

  { id: "din-1946-4", code: "DIN 1946-4", title: "Ventilation in buildings and rooms of health care", body: "DIN", group: "hygiene", products: ["ahu"],
    edition: "DIN 1946-4:2018",
    keys: ["DIN 1946-4", "DIN 1946 Part 4", "DIN 1946 Teil 4"],
    covers: "German standard for ventilation of hospitals. It sets room classes and adds requirements for the AHU beyond VDI 6022.",
    spec: "\"Hospital AHUs shall comply with DIN 1946-4 and VDI 6022\".",
    points: [
      "Room class I (Ia and Ib) covers operating theatres and similar rooms and needs three filter stages, the last one HEPA at the room. Room class II needs two stages.",
      "It asks for higher casing classes to EN 1886, smooth inner walls, stainless steel or equally resistant drain pans and floors in wet sections, and dampers of a high leakage class at the unit inlets and outlets.",
      "Fans, coils and filters must be easy to reach and to clean; inspection windows and lights in the main sections."
    ],
    check: [
      "The DIN 1946-4 certificate or declaration for the offered hygienic range.",
      "The EN 1886 classes the spec asks for with it."
    ],
    related: ["vdi-6022", "en-1822", "ashrae-170"] },

  { id: "ashrae-170", code: "ASHRAE 170", title: "Ventilation of health care facilities", body: "ASHRAE / ASHE", group: "hygiene", products: ["ahu"],
    edition: "ANSI/ASHRAE/ASHE 170-2021",
    keys: ["ASHRAE 170"],
    covers: "Minimum ventilation for hospitals and clinics: air changes, outdoor air, pressure relationships, temperature, humidity and filtration by room type.",
    spec: "The design basis for Gulf hospitals. In the AHU spec it drives the filter stages and 100 % fresh air units.",
    points: [
      "Each space type has minimum total and outdoor air changes and a pressure relationship to adjoining spaces.",
      "Two filter banks are required for most patient care areas; the second is a high MERV filter, and HEPA is required for protective environment rooms.",
      "It also has AHU requirements: drain pans, access, outdoor air intake location, and no fibrous lining downstream of the final filter in some areas."
    ],
    check: [
      "The filter classes of each bank against the room types the unit serves.",
      "Room air changes and pressures are the designer's responsibility."
    ],
    related: ["ashrae-62-1", "ashrae-52-2", "en-1822", "din-1946-4"] },

  { id: "htm-03-01", code: "HTM 03-01", title: "Specialised ventilation for healthcare premises", body: "NHS England", group: "hygiene", products: ["ahu"],
    edition: "HTM 03-01, 2021 (Part A design, Part B operation)",
    keys: ["HTM 03-01", "HTM 03", "HTM 2025"],
    covers: "UK health service guidance for the design, installation and operation of hospital ventilation, with detailed requirements for the AHU.",
    spec: "\"AHUs shall comply with HTM 03-01\", in hospitals designed by UK consultants.",
    points: [
      "It sets requirements for the AHU layout, access, drainage, materials, fans, coils, humidifiers and filters.",
      "It asks for direct-drive fans, cleanable coils with limits on fin spacing and depth, and drainage that can be seen working.",
      "Part B covers inspection and verification in use, which is the operator's duty."
    ],
    check: [
      "Go through the AHU clauses one by one. It is more detailed than VDI 6022 on layout."
    ],
    related: ["vdi-6022", "din-1946-4", "ashrae-170"] },

  /* ------------------------------------------------ Ventilation and energy */
  { id: "ashrae-62-1", code: "ASHRAE 62.1", title: "Ventilation and acceptable indoor air quality", body: "ASHRAE", group: "vent", products: ["ahu", "fcu"],
    edition: "ANSI/ASHRAE 62.1-2022",
    keys: ["ASHRAE 62.1", "ASHRAE 62"],
    covers: "Minimum ventilation rates and other measures for acceptable indoor air quality in buildings other than homes and hospitals. Most Gulf building codes adopt its outdoor air rates, which size the fresh air unit.",
    spec: "Part 1 reference in almost every AHU and FCU specification. The designer uses it for airflow; a few of its equipment clauses fall on the manufacturer.",
    points: [
      "Ventilation Rate Procedure: breathing zone outdoor air = people rate x number of people + area rate x floor area (Vbz = Rp x Pz + Ra x Az). Rates are per space type in the standard's table.",
      "The result is divided by the zone air distribution effectiveness, and for systems serving several zones by the system ventilation efficiency.",
      "Two other routes exist: the IAQ Procedure (design to contaminant limits) and the Natural Ventilation Procedure.",
      "Equipment clauses: drain pan sloped to the outlet, outlet at the lowest point, drain seal sized for the fan pressure; access for inspection and cleaning of coils, pans and filters.",
      "A particle filter of at least MERV 8 is required upstream of cooling coils and other wetted surfaces. Higher classes apply where outdoor air quality is poor.",
      "Airstream surfaces must resist mould growth and erosion."
    ],
    check: [
      "For the manufacturer: drain pan design, access doors, filter class before the coil, liner materials.",
      "Airflows and outdoor air rates are the designer's responsibility.",
      "Hospitals follow ASHRAE 170 instead."
    ],
    related: ["ashrae-170", "ashrae-90-1", "ashrae-52-2", "ashrae-55"] },

  { id: "ashrae-90-1", code: "ASHRAE 90.1", title: "Energy standard for sites and buildings except low-rise residential", body: "ASHRAE / IES", group: "vent", products: ["ahu", "fcu", "chiller"],
    edition: "ANSI/ASHRAE/IES 90.1-2022",
    keys: ["ASHRAE 90.1", "ASHRAE 90"],
    covers: "Minimum energy efficiency for buildings and their systems. Gulf green building regulations are built on it or refer to it.",
    spec: "\"Equipment efficiency shall meet ASHRAE 90.1\". For AHUs this means fan power and energy recovery; for chillers the minimum full and part load efficiency.",
    points: [
      "Fan systems have a power limit for the whole system (supply, return and exhaust fans together). Older editions give it as power per airflow with pressure drop adjustments.",
      "Fans need a fan energy index (FEI) of 1.0 or more from the 2019 edition.",
      "Exhaust air energy recovery is required above an outdoor air fraction and airflow that depend on the climate zone.",
      "Chillers have minimum full load and IPLV values, with Path A (full load focus) and Path B (part load focus).",
      "Motors must meet minimum efficiency levels."
    ],
    check: [
      "Which edition the project uses. The limits change with every edition.",
      "Fan power is a system limit, so the designer has to confirm it. Give the fan power per unit.",
      "Chiller efficiency at AHRI conditions against the table, then at project ambient if the local code asks."
    ],
    related: ["ashrae-62-1", "amca-205", "ahri-550-590", "dubai-gbr"] },

  { id: "ashrae-55", code: "ASHRAE 55", title: "Thermal environmental conditions for human occupancy", body: "ASHRAE", group: "vent", products: ["ahu", "fcu"],
    edition: "ANSI/ASHRAE 55-2023",
    keys: ["ASHRAE 55"],
    covers: "The combinations of temperature, humidity, air speed, clothing and activity that most occupants find comfortable.",
    spec: "Part 1 reference. It sets the room design conditions used by the designer.",
    points: [
      "It is a design standard for the space. It places no requirement on the unit itself."
    ],
    check: [
      "Normally answered as noted, design by others."
    ],
    related: ["ashrae-62-1"] },

  /* ------------------------------------------------ Fire and product safety */
  { id: "nfpa-90a", code: "NFPA 90A", title: "Installation of air-conditioning and ventilating systems", body: "NFPA", group: "fire", products: ["ahu", "fcu"],
    edition: "NFPA 90A, 2024",
    keys: ["NFPA 90A", "NFPA 90 A"],
    covers: "US fire safety standard for air systems. It limits how materials inside the air stream burn and smoke, and sets rules for smoke detectors, fire dampers and controls. Gulf civil defence codes lean on it.",
    spec: "\"Insulation and all materials in the air stream shall comply with NFPA 90A: flame spread not over 25, smoke developed not over 50\".",
    points: [
      "Insulation, liners, adhesives, tapes and gaskets in the air stream need a flame spread index of 25 or less and a smoke developed index of 50 or less, tested to ASTM E84 / UL 723.",
      "Air filters must comply with UL 900.",
      "Duct smoke detectors: in the supply downstream of the filters for systems over 2,000 cfm, and in the return at each storey for systems over 15,000 cfm.",
      "Flexible connectors and electrical equipment in the air stream have their own limits."
    ],
    check: [
      "The ASTM E84 test report for the insulation actually used. Polyethylene (PE) foam does not normally pass 25 / 50.",
      "A European or Chinese fire class (EN 13501-1, BS 476, GB) is a different test. Offer it only as an alternative, never as the same thing.",
      "Smoke detectors and fire dampers are usually the contractor's supply."
    ],
    related: ["astm-e84", "ul-900", "en-13501-1", "bs-476"] },

  { id: "astm-e84", code: "ASTM E84 / UL 723", title: "Surface burning characteristics of building materials", body: "ASTM / UL", group: "fire", products: ["ahu", "fcu"],
    edition: "ASTM E84, current edition; UL 723",
    keys: ["ASTM E84", "ASTM E 84", "UL 723", "NFPA 255"],
    covers: "The tunnel test. A sample is burned in a 25 ft tunnel and given a flame spread index (FSI) and a smoke developed index (SDI).",
    spec: "\"Insulation shall have a flame spread of 25 and smoke developed of 50 when tested to ASTM E84\".",
    points: [
      "It is a test method. The 25 / 50 limit comes from NFPA 90A and the building codes.",
      "The result belongs to the material at the tested thickness and with the tested facing.",
      "UL 723 and the withdrawn NFPA 255 are the same test."
    ],
    check: [
      "The insulation maker's test report: FSI, SDI, thickness and facing."
    ],
    related: ["nfpa-90a", "en-13501-1", "bs-476"] },

  { id: "en-13501-1", code: "EN 13501-1", title: "Fire classification of construction products - Reaction to fire", body: "CEN", group: "fire", products: ["ahu", "fcu"],
    edition: "EN 13501-1:2018",
    keys: ["EN 13501-1", "BS EN 13501-1"],
    covers: "European reaction-to-fire classes for materials: A1, A2, B, C, D, E and F, with extra marks for smoke (s1 to s3) and flaming droplets (d0 to d2).",
    spec: "\"Panel insulation shall be non-combustible, class A1 to EN 13501-1\" or \"class B-s1, d0 or better\".",
    points: [
      "A1 and A2 are non-combustible or nearly so (mineral wool). B to F burn progressively more easily.",
      "s1 is the least smoke, d0 means no flaming droplets.",
      "Polyurethane foam panels are typically class B to E depending on the facing; mineral wool panels reach A1 or A2."
    ],
    check: [
      "The class on the panel or insulation maker's report, for the panel as built.",
      "It cannot be converted into ASTM E84 indices."
    ],
    related: ["astm-e84", "bs-476", "nfpa-90a"] },

  { id: "bs-476", code: "BS 476", title: "Fire tests on building materials and structures", body: "BSI", group: "fire", products: ["ahu", "fcu"],
    edition: "BS 476 Part 6 (fire propagation) and Part 7 (surface spread of flame)",
    keys: ["BS 476"],
    covers: "The older British fire tests. Part 7 gives a surface spread of flame class from 1 to 4. Part 6 gives fire propagation indices. Still common in Gulf specifications written by UK consultants.",
    spec: "\"Insulation shall be Class 1 to BS 476 Part 7\" or \"Class 0 to the Building Regulations\".",
    points: [
      "Class 1 is the best result of Part 7.",
      "\"Class 0\" is not a BS 476 class. It is defined in the UK Building Regulations: Class 1 to Part 7 together with low fire propagation indices to Part 6.",
      "In Europe these tests have been replaced by EN 13501-1."
    ],
    check: [
      "The insulation maker's report for Part 6 and Part 7, or the EN 13501-1 class offered as alternative."
    ],
    related: ["en-13501-1", "astm-e84"] },

  { id: "ul-1995", code: "UL 1995 / UL 60335-2-40", title: "Safety of heating and cooling equipment", body: "UL", group: "fire", products: ["ahu", "fcu", "chiller"],
    edition: "UL 1995 is being replaced by UL/CSA 60335-2-40",
    keys: ["UL 1995", "UL 60335-2-40"],
    covers: "US product safety standards for heating and cooling equipment: electrical safety, enclosure, wiring and, in UL 60335-2-40, the rules for flammable refrigerants.",
    spec: "\"Units shall be UL (or ETL) listed to UL 1995\".",
    points: [
      "Listing means a recognised laboratory has examined the product and the factory is audited.",
      "Units built in European or Gulf factories normally carry CE marking to the EN / IEC 60335 series and are not UL listed."
    ],
    check: [
      "Whether the factory offered has a UL or ETL listing for the product. If not, state CE marking and the IEC standards as the basis."
    ],
    related: ["iec-60335-2-40", "ul-508a", "nfpa-70"] },

  { id: "iec-60335-2-40", code: "IEC / EN 60335-2-40", title: "Safety of electrical heat pumps, air conditioners and dehumidifiers", body: "IEC / CENELEC", group: "fire", products: ["fcu", "chiller"],
    edition: "IEC 60335-2-40, edition 7 (2022)",
    keys: ["IEC 60335-2-40", "EN 60335-2-40"],
    covers: "International product safety standard for air conditioners and heat pumps with electric compressors, and for fan coils and dehumidifiers. It also sets the charge limits for flammable (A2L, A3) refrigerants.",
    spec: "\"Units shall comply with IEC 60335-2-40 and be CE marked\".",
    points: [
      "Used together with Part 1 (IEC 60335-1, general requirements).",
      "Large chillers often follow EN 378 and the machinery safety standards instead."
    ],
    check: [
      "The declaration of conformity of the offered unit and the standards listed on it."
    ],
    related: ["ul-1995", "en-378", "iec-60204-1"] },

  /* ------------------------------------------------ Motors and electrical */
  { id: "iec-60034-30-1", code: "IEC 60034-30-1", title: "Efficiency classes of line-operated AC motors (IE code)", body: "IEC", group: "elec", products: ["ahu", "fcu", "chiller"],
    edition: "IEC 60034-30-1:2014",
    keys: ["IEC 60034-30", "EN 60034-30"],
    covers: "Defines the motor efficiency classes IE1 to IE4 for motors that can run direct on line, 50 and 60 Hz.",
    spec: "\"Motors shall be IE3 (or IE4) premium efficiency to IEC 60034-30-1, IP55, class F insulation\".",
    points: [
      "IE1 standard, IE2 high, IE3 premium, IE4 super premium. IE5 is defined in a separate technical specification.",
      "EC motors and other motors that only run with their own drive are outside this standard; their efficiency is declared differently.",
      "In the EU, IE3 is the minimum for most motors from 0.75 kW and IE4 for 75 to 200 kW.",
      "NEMA Premium is about the same as IE3."
    ],
    check: [
      "The IE class on the motor nameplate data for the offered voltage and frequency (380 V 60 Hz for Saudi Arabia, 400 V 50 Hz for the UAE).",
      "For EC fans, state that the IE scale does not apply and give the fan's overall efficiency."
    ],
    related: ["nema-mg-1", "iec-60529"] },

  { id: "nema-mg-1", code: "NEMA MG 1", title: "Motors and generators", body: "NEMA", group: "elec", products: ["ahu", "chiller"],
    edition: "NEMA MG 1, current edition",
    keys: ["NEMA MG 1", "NEMA MG1", "NEMA MG-1"],
    covers: "US standard for motor construction, frame sizes, performance and efficiency. Part 31 covers motors made for use with variable frequency drives.",
    spec: "\"Motors shall be NEMA Premium efficiency and inverter duty to NEMA MG 1 Part 31\".",
    points: [
      "NEMA Premium is about the same as IE3.",
      "Part 31 inverter duty motors have insulation able to take the voltage peaks from a drive.",
      "NEMA frame sizes differ from IEC frame sizes. An IEC motor meets the intent, not the dimensions."
    ],
    check: [
      "For IEC motors, offer the IE class and the motor maker's statement that the motor is suitable for inverter supply."
    ],
    related: ["iec-60034-30-1"] },

  { id: "iec-60529", code: "IEC 60529", title: "Degrees of protection provided by enclosures (IP code)", body: "IEC", group: "elec", products: ["ahu", "fcu", "chiller"],
    edition: "IEC 60529, edition 2.2",
    keys: ["IEC 60529", "EN 60529"],
    covers: "The IP code. The first digit is protection against solid objects and dust (0 to 6), the second against water (0 to 9).",
    spec: "\"Motors IP55\", \"control panel IP54 indoor, IP65 outdoor\", \"isolator IP65\".",
    points: [
      "IP54: dust protected, splashing water. IP55: dust protected, water jets. IP65: dust tight, water jets.",
      "NEMA enclosure types (1, 3R, 4, 4X, 12) are a different system with no exact conversion."
    ],
    check: [
      "The IP rating of each item separately: motor, panel, isolator, actuators, sensors."
    ],
    related: ["iec-60034-30-1", "iec-60204-1"] },

  { id: "iec-60204-1", code: "IEC 60204-1", title: "Safety of machinery - Electrical equipment of machines", body: "IEC", group: "elec", products: ["ahu", "chiller"],
    edition: "IEC 60204-1:2016",
    keys: ["IEC 60204", "EN 60204"],
    covers: "General requirements for the electrical equipment of a machine: disconnecting means, protection against electric shock, wiring, earthing, control circuits and marking.",
    spec: "\"Factory wiring and control panels shall comply with IEC 60204-1\".",
    points: [
      "It is the usual basis for CE marking of factory-wired AHUs and chillers.",
      "It asks for a lockable supply disconnecting device for the machine."
    ],
    check: [
      "Whether the unit is supplied factory wired with a panel, or with loose components for site wiring."
    ],
    related: ["iec-60529", "ul-508a"] },

  { id: "ul-508a", code: "UL 508A", title: "Industrial control panels", body: "UL", group: "elec", products: ["ahu", "chiller"],
    edition: "UL 508A, current edition",
    keys: ["UL 508"],
    covers: "US standard for building industrial control panels: components, wiring, spacing, short-circuit current rating and marking.",
    spec: "\"Control panels shall be built and labelled to UL 508A\".",
    points: [
      "Only a panel shop in the UL programme can apply the UL 508A label.",
      "Panels built outside the US are normally made to IEC 61439 and IEC 60204-1."
    ],
    check: [
      "Offer the IEC basis unless the factory has a UL 508A panel shop."
    ],
    related: ["iec-60204-1", "nfpa-70", "ul-1995"] },

  { id: "nfpa-70", code: "NFPA 70", title: "National Electrical Code (NEC)", body: "NFPA", group: "elec", products: ["ahu", "fcu", "chiller"],
    edition: "NFPA 70, 2023",
    keys: ["NFPA 70", "National Electrical Code"],
    covers: "The US electrical installation code. Article 430 covers motors, Article 440 air-conditioning and refrigerating equipment.",
    spec: "\"Electrical work shall comply with NFPA 70\". Saudi Aramco and US-based specifications use it; other Gulf projects follow the local authority's wiring regulations based on IEC / BS 7671.",
    points: [
      "It is an installation code. Most of it falls on the electrical contractor.",
      "For the unit it affects disconnects, overcurrent protection and nameplate data (minimum circuit ampacity, maximum overcurrent protection)."
    ],
    check: [
      "Whether the nameplate data the spec asks for can be given for the offered unit."
    ],
    related: ["ul-508a", "ul-1995"] },

  /* ------------------------------------------------ Sound */
  { id: "ahri-260", code: "AHRI 260", title: "Sound rating of ducted air moving and conditioning equipment", body: "AHRI", group: "sound", products: ["ahu", "fcu"],
    edition: "AHRI 260 (I-P) / 261 (SI)",
    keys: ["AHRI 260", "ARI 260", "AHRI 261"],
    covers: "How the sound power of ducted equipment such as AHUs is determined and reported for each path: ducted discharge, ducted inlet and casing radiated.",
    spec: "\"Unit sound power levels shall be rated to AHRI 260 for inlet, discharge and casing radiated\".",
    points: [
      "It rates the complete unit, with the cabinet effect, in eight octave bands.",
      "European units report the same three paths calculated to EN 13053."
    ],
    check: [
      "Give the sound power per path from the technical report and state the basis used."
    ],
    related: ["amca-300", "iso-3741", "en-13053"] },

  { id: "iso-3741", code: "ISO 3741", title: "Sound power in a reverberation room (precision method)", body: "ISO", group: "sound", products: ["ahu", "fcu"],
    edition: "ISO 3741:2010",
    keys: ["ISO 3741"],
    covers: "Measurement of the sound power of a source in a reverberation test room. Fan coil and small unit sound data is usually taken this way.",
    spec: "\"Sound power levels shall be measured to ISO 3741\".",
    points: [
      "The result is sound power (Lw). Sound pressure in the room (Lp, NC, NR) depends on the room and the distance."
    ],
    check: [
      "Whether the spec asks for sound power or sound pressure, and at what distance."
    ],
    related: ["iso-3744", "ahri-260"] },

  { id: "iso-3744", code: "ISO 3744 / ISO 9614", title: "Sound power in a free field, or by sound intensity", body: "ISO", group: "sound", products: ["chiller", "ahu"],
    edition: "ISO 3744:2010; ISO 9614 parts 1 to 3",
    keys: ["ISO 3744", "ISO 9614"],
    covers: "Two ways to measure the sound power of large machines such as chillers: from sound pressure over a reflecting plane (ISO 3744) or by scanning sound intensity (ISO 9614).",
    spec: "\"Chiller sound power shall be measured to ISO 9614\" and \"sound pressure not over ... dB(A) at 1 m (or 10 m)\".",
    points: [
      "A sound pressure figure is worked out from the sound power for a stated distance in free field.",
      "Figures taken by the two methods are close but not identical. Compare bids on the same basis and the same distance.",
      "AHRI 370 is the US sound rating for outdoor chillers."
    ],
    check: [
      "The method and distance printed on the datasheet against what the spec asks."
    ],
    related: ["iso-3741", "eurovent-chiller"] },

  /* ------------------------------------------------ Materials and corrosion */
  { id: "astm-a653", code: "ASTM A653 / EN 10346", title: "Hot-dip galvanised steel sheet", body: "ASTM / CEN", group: "materials", products: ["ahu", "fcu"],
    edition: "ASTM A653/A653M; EN 10346:2015",
    keys: ["ASTM A653", "ASTM A 653", "EN 10346", "ASTM A525", "ASTM A527"],
    covers: "The steel sheet standards that define zinc coating weights such as G90 and Z275.",
    spec: "\"Panels of galvanised steel G90 to ASTM A653\" or \"Z275 to EN 10346\".",
    points: [
      "G90 is 0.90 oz/ft² of zinc, total of both sides. Z275 is 275 g/m², total of both sides. The two are practically the same coating.",
      "G60 is about Z180.",
      "Zinc-aluminium-magnesium coated sheet (ZM) is a different product with better edge protection, also covered by EN 10346."
    ],
    check: [
      "The coating designation on the panel datasheet for inner skin, outer skin and frame."
    ],
    related: ["iso-12944", "astm-b117"] },

  { id: "iso-12944", code: "ISO 12944", title: "Corrosion protection of steel structures by paint systems", body: "ISO", group: "materials", products: ["ahu", "chiller"],
    edition: "ISO 12944, parts 1 to 9 (2017 to 2019)",
    keys: ["ISO 12944"],
    covers: "Classifies how corrosive an environment is (C1 to C5 and CX) and what paint system and durability suit each.",
    spec: "\"Outdoor units shall have a coating system suitable for C4 (or C5) to ISO 12944\".",
    points: [
      "C3 is urban or light industrial. C4 is industrial or coastal with moderate salt. C5 is coastal or industrial with high salt. CX is offshore.",
      "Durability is given as low, medium, high or very high. It is time to first major repainting, not a guarantee period.",
      "Most Gulf coastal sites are treated as C4 or C5."
    ],
    check: [
      "The category and durability the paint or coating supplier certifies for the offered finish."
    ],
    related: ["astm-b117", "astm-a653"] },

  { id: "astm-b117", code: "ASTM B117", title: "Salt spray (fog) testing", body: "ASTM", group: "materials", products: ["ahu", "fcu", "chiller"],
    edition: "ASTM B117, current edition; ISO 9227 is the ISO counterpart",
    keys: ["ASTM B117", "ASTM B 117", "ISO 9227"],
    covers: "How a salt spray cabinet is run. Coated coils, casings and fasteners are exposed for a set number of hours.",
    spec: "\"Coil coating shall withstand 3,000 (or 5,000, or 10,000) hours salt spray to ASTM B117\".",
    points: [
      "It is a test method with no pass mark. The hours and the acceptance criteria come from the specification.",
      "Hours in the cabinet do not translate into years on site."
    ],
    check: [
      "The coating supplier's test report: hours, and how the result was judged."
    ],
    related: ["iso-12944"] },

  /* ------------------------------------------------ Fan coil units */
  { id: "ahri-440", code: "AHRI 440", title: "Performance rating of room fan-coils", body: "AHRI", group: "fcu", products: ["fcu"],
    edition: "AHRI 440, 2019",
    keys: ["AHRI 440", "ARI 440"],
    covers: "US rating standard for fan coil units: cooling and heating capacity, airflow and power input at standard conditions.",
    spec: "\"Fan coil units shall be rated and certified to AHRI 440\".",
    points: [
      "Standard cooling rating is at 45 °F (7.2 °C) entering water with a 10 °F (5.6 K) rise, and 80 / 67 °F (26.7 / 19.4 °C) entering air.",
      "Project conditions in the Gulf (district cooling water temperatures, higher external static) need a selection at those conditions."
    ],
    check: [
      "Whether the offered model is AHRI or Eurovent certified, and give the capacity at project conditions from the selection software."
    ],
    related: ["eurovent-fcu", "ahri-410", "iso-3741"] },

  { id: "eurovent-fcu", code: "Eurovent FCU / EN 1397", title: "Eurovent Certified Performance - Fan coil units", body: "Eurovent Certita Certification / CEN", group: "fcu", products: ["fcu"],
    edition: "EN 1397:2021; programme rules are revised regularly",
    near: { word: "Eurovent", words: ["fan coil", "FCU", "EN 1397"] },
    keys: ["EN 1397"],
    covers: "Third-party certification of fan coil capacity, airflow, power input and sound, tested to EN 1397.",
    spec: "\"Fan coil units shall be Eurovent certified\".",
    points: [
      "Certified data is published for the standard conditions (7 / 12 °C water, 27 °C dry bulb / 19 °C wet bulb air).",
      "Ducted units are rated at a stated external static pressure."
    ],
    check: [
      "That the model and factory offered are in the Eurovent directory."
    ],
    related: ["ahri-440", "iso-3741"] },

  /* ------------------------------------------------ Chillers and refrigerants */
  { id: "ahri-550-590", code: "AHRI 550/590", title: "Performance rating of water-chilling and heat pump water-heating packages", body: "AHRI", group: "chiller", products: ["chiller"],
    edition: "AHRI 550/590 (I-P) and 551/591 (SI), 2023",
    keys: ["AHRI 550", "ARI 550", "AHRI 590", "AHRI 551", "AHRI 591"],
    covers: "US rating standard for chillers: capacity and efficiency at full load and the integrated part load value (IPLV). It is the common baseline in tenders.",
    spec: "\"Chillers shall be rated and certified to AHRI 550/590\" plus a project rating at 46 °C or higher ambient.",
    points: [
      "Standard conditions: chilled water entering at 54 °F (12.2 °C) and leaving at 44 °F (6.7 °C); air-cooled at 95 °F (35 °C) entering air. Older editions fixed the water flow at 2.4 gpm per ton instead of the entering temperature.",
      "IPLV weights: 1 % at 100 % load, 42 % at 75 %, 45 % at 50 % and 12 % at 25 %.",
      "NPLV is the same calculation at non-standard conditions.",
      "The standard sets tolerances on capacity and efficiency. A witness test is judged against them.",
      "\"AHRI certified\" means the selection software is inside the AHRI verification programme. Units outside the programme's size or conditions are rated \"in accordance with\" the standard."
    ],
    check: [
      "Whether the model is inside the AHRI certification programme.",
      "That bids are compared at the same conditions: ambient, water temperatures, fouling factor, glycol."
    ],
    related: ["eurovent-chiller", "ashrae-90-1", "saso-2874"] },

  { id: "eurovent-chiller", code: "Eurovent LCP-HP / EN 14511", title: "Eurovent certified chillers; EN 14511 and EN 14825", body: "Eurovent Certita Certification / CEN", group: "chiller", products: ["chiller"],
    edition: "EN 14511:2022; EN 14825:2022",
    near: { word: "Eurovent", words: ["chiller", "chilling", "heat pump", "LCP", "EN 14511", "EN 14825"] },
    keys: ["EN 14511", "EN 14825"],
    covers: "EN 14511 is the European rating test for chillers and heat pumps at standard conditions. EN 14825 gives the seasonal figures (SEER, SCOP, SEPR). Eurovent certifies chillers on both.",
    spec: "\"Chillers shall be Eurovent certified, with EER and SEER to EN 14511 / EN 14825\".",
    points: [
      "Standard cooling conditions: 12 / 7 °C water, 35 °C air.",
      "ESEER is an older Eurovent figure and has been replaced by SEER.",
      "Eurovent also tests to SASO 2874 conditions for the Saudi market."
    ],
    check: [
      "That the model is in the Eurovent directory, and the figures are for the same refrigerant and options."
    ],
    related: ["ahri-550-590", "saso-2874", "iso-3744"] },

  { id: "ashrae-15", code: "ASHRAE 15 / 34", title: "Safety standard for refrigeration systems; designation and safety classification of refrigerants", body: "ASHRAE", group: "chiller", products: ["chiller"],
    edition: "ANSI/ASHRAE 15-2022 and 34-2022",
    keys: ["ASHRAE 15", "ASHRAE 34"],
    covers: "ASHRAE 34 names refrigerants and gives each a safety class. ASHRAE 15 says where and how a refrigeration system may be installed: machinery rooms, leak detection, ventilation and relief.",
    spec: "\"Refrigerant shall be classified A1 to ASHRAE 34\" and \"installation shall comply with ASHRAE 15\".",
    points: [
      "The letter is toxicity (A lower, B higher). The number is flammability: 1 none, 2L lower, 2 flammable, 3 higher.",
      "R-134a, R-513A and R-410A are A1. R-32, R-1234ze(E) and R-454B are A2L. R-290 is A3.",
      "An A2L chiller indoors needs leak detection and ventilation checked against the room size."
    ],
    check: [
      "The safety class of the offered refrigerant against a spec that says \"A1 only\".",
      "Machinery room requirements are the designer's and contractor's responsibility."
    ],
    related: ["en-378", "iec-60335-2-40"] },

  { id: "en-378", code: "EN 378", title: "Refrigerating systems and heat pumps - Safety and environmental requirements", body: "CEN", group: "chiller", products: ["chiller"],
    edition: "EN 378:2016, parts 1 to 4",
    keys: ["EN 378", "BS EN 378", "ISO 5149"],
    covers: "European safety standard for refrigerating systems: design, construction, charge limits by location, installation and maintenance. ISO 5149 is the international counterpart.",
    spec: "\"Chillers shall be designed and tested to EN 378 and the Pressure Equipment Directive\".",
    points: [
      "It links the refrigerant safety class to the permitted charge for the type of space and access.",
      "Pressure parts in Europe also follow the Pressure Equipment Directive; US-based specs ask for ASME vessels instead."
    ],
    check: [
      "The pressure vessel code of the offered unit (PED / CE or ASME) against the spec."
    ],
    related: ["ashrae-15", "iec-60335-2-40"] },

  /* ------------------------------------------------ Gulf codes */
  { id: "saso-2874", code: "SASO 2874", title: "Large capacity air conditioners - Minimum energy performance (Saudi Arabia)", body: "SASO", group: "regional", products: ["chiller"],
    edition: "SASO 2874, check SASO for the current issue",
    keys: ["SASO 2874"],
    covers: "Saudi minimum energy performance standard for large air conditioners, including chillers. Registration on the Saudi Label and Standard portal is needed before shipment. SASO 2663 covers small air conditioners up to 70,000 Btu/h.",
    spec: "\"Chillers shall be SASO 2874 registered\".",
    points: [
      "The unit is tested at Saudi conditions and registered. Customs check the registration.",
      "It does not cover AHUs or fan coil units."
    ],
    check: [
      "The registration status of the exact model, voltage and refrigerant.",
      "Lead time for registration before the first shipment."
    ],
    related: ["sbc-501-601", "ahri-550-590", "eurovent-chiller"] },

  { id: "sbc-501-601", code: "SBC 501 / SBC 601", title: "Saudi Building Code - Mechanical and energy conservation", body: "Saudi Building Code National Committee", group: "regional", products: ["ahu", "fcu", "chiller"],
    edition: "SBC 2018, check for the current issue",
    keys: ["SBC 501", "SBC 601", "Saudi Building Code"],
    covers: "The Saudi mechanical code (SBC 501, based on the International Mechanical Code) and the energy conservation code for buildings other than low-rise residential (SBC 601).",
    spec: "\"Equipment shall comply with the Saudi Building Code\".",
    points: [
      "SBC 601 sets minimum equipment efficiencies and fan power limits in the same way as ASHRAE 90.1.",
      "Mostadam is the voluntary Saudi green building rating that sits above it."
    ],
    check: [
      "Chiller efficiency and fan power against the SBC 601 tables for the project."
    ],
    related: ["saso-2874", "ashrae-90-1", "saes-k"] },

  { id: "saes-k", code: "SAES-K series", title: "Saudi Aramco engineering standards for HVAC", body: "Saudi Aramco", group: "regional", products: ["ahu", "fcu", "chiller"],
    edition: "Issued and revised by Saudi Aramco; use the revision named in the project",
    keys: ["SAES-K", "SAES K"],
    covers: "Aramco's own engineering standards for HVAC design and equipment, used on Aramco sites and many Saudi industrial projects. They sit above the building code.",
    spec: "\"HVAC equipment shall comply with SAES-K-001 and the related materials specifications\".",
    points: [
      "They set a high design ambient, corrosion protection requirements and vendor qualification.",
      "Related Aramco materials system specifications (32-SAMSS series) cover individual equipment.",
      "US standards (AHRI, AMCA, UL, NFPA 70) are the default references."
    ],
    check: [
      "Read the SAES and SAMSS documents named in the project before the catalogue. Deviations need Aramco's approval."
    ],
    related: ["sbc-501-601", "nfpa-70", "ul-1995"] },

  { id: "dubai-gbr", code: "Dubai Green Building Regulations", title: "Dubai Green Building Regulations and Al Sa'fat", body: "Dubai Municipality", group: "regional", products: ["ahu", "fcu", "chiller"],
    edition: "Al Sa'fat, check Dubai Municipality for the current issue",
    keys: ["Al Sa'fat", "Al Safat", "Dubai Green Building", "Green Building Regulations"],
    covers: "Dubai Municipality's mandatory green building rules: minimum equipment efficiency, fan power, heat recovery on fresh air, ventilation and metering. Al Sa'fat is the rating system built on them.",
    spec: "\"Equipment shall comply with Dubai Green Building Regulations\".",
    points: [
      "Chiller efficiency is checked against the regulation's tables; expect a schedule that also asks for performance at 46 °C ambient.",
      "Fresh air above a set airflow needs energy recovery with a minimum efficiency.",
      "Ventilation rates follow ASHRAE 62.1."
    ],
    check: [
      "Heat recovery efficiency and fan power of each fresh air unit, and chiller efficiency, against the regulation tables."
    ],
    related: ["ashrae-90-1", "ashrae-62-1", "estidama"] },

  { id: "estidama", code: "Estidama Pearl", title: "Estidama Pearl Rating System (Abu Dhabi)", body: "Abu Dhabi Department of Municipalities and Transport", group: "regional", products: ["ahu", "fcu", "chiller"],
    edition: "Pearl Building Rating System, check for the current issue",
    keys: ["Estidama", "Pearl Rating"],
    covers: "Abu Dhabi's sustainability rating. Pearl 1 is the mandatory minimum for all new buildings and Pearl 2 for government buildings.",
    spec: "\"Equipment shall support the project's Estidama Pearl 2 target\".",
    points: [
      "Its energy credits use ASHRAE 90.1 as the baseline.",
      "It has requirements on refrigerants, ventilation quality and commissioning."
    ],
    check: [
      "Efficiency data and refrigerant details for the Estidama submission."
    ],
    related: ["dubai-gbr", "ashrae-90-1"] },

  { id: "uae-fire-code", code: "UAE Fire and Life Safety Code", title: "UAE Fire and Life Safety Code of Practice", body: "UAE Civil Defence", group: "regional", products: ["ahu", "fcu"],
    edition: "2018 edition, check Civil Defence for the current issue",
    keys: ["Fire and Life Safety Code", "Civil Defence", "Civil Defense"],
    covers: "The UAE fire code. For air systems it follows NFPA 90A: fire behaviour of materials in the air stream, smoke detection and shut-down, fire and smoke dampers.",
    spec: "\"All materials shall be approved by Civil Defence\".",
    points: [
      "Insulation and other materials may need a Civil Defence approval or a listed test report, not only a manufacturer's statement.",
      "Units used for smoke control have extra requirements."
    ],
    check: [
      "Whether the insulation and flexible connectors offered have the approval the authority asks for."
    ],
    related: ["nfpa-90a", "astm-e84"] },

  /* ------------------------------------------------ Quality systems */
  { id: "iso-9001", code: "ISO 9001 / 14001 / 45001", title: "Quality, environmental and occupational health and safety management systems", body: "ISO", group: "quality", products: ["ahu", "fcu", "chiller"],
    edition: "ISO 9001:2015; ISO 14001:2015; ISO 45001:2018",
    keys: ["ISO 9001", "ISO 14001", "ISO 45001", "OHSAS 18001"],
    covers: "Management system standards. A certificate shows that a factory's quality, environmental or safety management has been audited by an outside body.",
    spec: "\"Manufacturer shall be ISO 9001 certified; submit the certificate\".",
    points: [
      "The certificate belongs to a named site and scope. It says nothing about the performance of the product.",
      "OHSAS 18001 was replaced by ISO 45001."
    ],
    check: [
      "A valid certificate for the factory that will build the units."
    ],
    related: [] }
  ];

  window.STD = { GROUPS: GROUPS, ITEMS: ITEMS };
})();
