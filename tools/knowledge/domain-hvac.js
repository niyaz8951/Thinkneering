/* =====================================================================
   Thinkneering — Knowledge Graph: HVAC domain pack
   ---------------------------------------------------------------------
   Node kinds, relationship types, lanes, standards, and a seed graph
   covering the refrigeration cycle, the air side, the water side, air
   distribution, controls and the parameters consultants actually ask
   about in a specification.

   Rule applied throughout the seed: parameter NAMES are knowledge,
   parameter VALUES for a specific product are not. Anything that varies
   by selection carries "Per selection" and has to be filled from a real
   datasheet before it is approved. Nothing here asserts that any product
   complies with any standard.
   ===================================================================== */

(function () {
  'use strict';

  /* ── Node kinds ────────────────────────────────────────────────── */

  var NODE_KINDS = {
    system:      { label: 'System',       token: '--kg-system',      icon: 'layers',
                   hint: 'A complete system or subsystem, e.g. chilled water system.' },
    equipment:   { label: 'Equipment',    token: '--kg-equipment',   icon: 'box',
                   hint: 'A deliverable unit of plant: AHU, FCU, chiller, pump.' },
    component:   { label: 'Component',    token: '--kg-component',   icon: 'puzzle',
                   hint: 'A part inside equipment: coil, fan, filter, compressor.' },
    parameter:   { label: 'Parameter',    token: '--kg-parameter',   icon: 'gauge',
                   hint: 'A measurable property a specification will call out.' },
    control:     { label: 'Control',      token: '--kg-control',     icon: 'sliders',
                   hint: 'Sensing, control logic, BMS points.' },
    medium:      { label: 'Flow / medium',token: '--kg-medium',      icon: 'wind',
                   hint: 'What moves through the system: air, chilled water, refrigerant.' },
    standard:    { label: 'Standard',     token: '--kg-standard',    icon: 'shield',
                   hint: 'A code, standard or certification scheme.' },
    document:    { label: 'Document',     token: '--kg-document',    icon: 'file',
                   hint: 'A submittal, datasheet, certificate or manual.' },
    failure:     { label: 'Failure mode', token: '--kg-failure',     icon: 'alert',
                   hint: 'A known way this fails, and how it presents.' },
    maintenance: { label: 'Maintenance',  token: '--kg-maintenance', icon: 'wrench',
                   hint: 'A recurring service task.' },
    term:        { label: 'Term',         token: '--kg-term',        icon: 'book',
                   hint: 'Vocabulary and unit definitions.' },
    note:        { label: 'Note',         token: '--kg-note',        icon: 'note',
                   hint: 'Context that is not itself a concept.' }
  };

  /* ── Relationship types ────────────────────────────────────────── */

  var RELATIONS = {
    contains:     { label: 'contains',      inverse: 'part_of',   arrow: 'diamond', dash: '' },
    part_of:      { label: 'is part of',    inverse: 'contains',  arrow: 'plain',   dash: '' },
    supplies:     { label: 'supplies',      inverse: 'receives',  arrow: 'plain',   dash: '' },
    receives:     { label: 'receives from', inverse: 'supplies',  arrow: 'plain',   dash: '' },
    flows_to:     { label: 'flows to',      inverse: null,        arrow: 'plain',   dash: '' },
    controls:     { label: 'controls',      inverse: null,        arrow: 'plain',   dash: '4 4' },
    monitors:     { label: 'monitors',      inverse: null,        arrow: 'plain',   dash: '4 4' },
    depends_on:   { label: 'depends on',    inverse: null,        arrow: 'plain',   dash: '6 5' },
    produces:     { label: 'produces',      inverse: null,        arrow: 'plain',   dash: '' },
    requires:     { label: 'requires',      inverse: null,        arrow: 'plain',   dash: '6 5' },
    connected_to: { label: 'connected to',  inverse: null,        arrow: 'both',    dash: '' },
    governed_by:  { label: 'governed by',   inverse: null,        arrow: 'plain',   dash: '6 5' },
    causes:       { label: 'can cause',     inverse: null,        arrow: 'plain',   dash: '3 4' }
  };

  /* ── Lanes (subsystem grouping on the canvas) ──────────────────── */

  var LANES = [
    { id: 'refrigeration', label: 'Refrigeration cycle',  token: '--kg-lane-1' },
    { id: 'airside',       label: 'Air side',             token: '--kg-lane-2' },
    { id: 'waterside',     label: 'Water side',           token: '--kg-lane-3' },
    { id: 'equipment',     label: 'Equipment',            token: '--kg-lane-4' },
    { id: 'distribution',  label: 'Air distribution',     token: '--kg-lane-5' },
    { id: 'controls',      label: 'Controls & BMS',       token: '--kg-lane-6' },
    { id: 'reference',     label: 'Standards & terms',    token: '--kg-lane-7' }
  ];

  /* ── Standards ─────────────────────────────────────────────────── */

  var STANDARDS = [
    { id: 'eurovent',  label: 'Eurovent certification', note: 'Third-party performance certification' },
    { id: 'en1886',    label: 'EN 1886',      note: 'AHU casing: D, L, F, T and TB classes' },
    { id: 'en13053',   label: 'EN 13053',     note: 'AHU performance ratings' },
    { id: 'ahri430',   label: 'AHRI 430',     note: 'Central station air handling units' },
    { id: 'ahri440',   label: 'AHRI 440',     note: 'Room fan coil units' },
    { id: 'ahri410',   label: 'AHRI 410',     note: 'Forced circulation coils' },
    { id: 'ahri550',   label: 'AHRI 550/590', note: 'Water chilling packages' },
    { id: 'iso16890',  label: 'ISO 16890',    note: 'Air filter classification (replaces EN 779)' },
    { id: 'en1822',    label: 'EN 1822',      note: 'HEPA and ULPA filters' },
    { id: 'ashrae621', label: 'ASHRAE 62.1',  note: 'Ventilation for acceptable indoor air quality' },
    { id: 'ashrae901', label: 'ASHRAE 90.1',  note: 'Energy standard for buildings' },
    { id: 'ashrae55',  label: 'ASHRAE 55',    note: 'Thermal environmental conditions' },
    { id: 'en13501',   label: 'EN 13501 / UL 900', note: 'Reaction to fire classification' },
    { id: 'iec60204',  label: 'IEC 60204-1',  note: 'Electrical equipment of machines' },
    { id: 'iso9001',   label: 'ISO 9001',     note: 'Quality management system' },
    { id: 'qcs',       label: 'QCS (Qatar)',        note: 'Qatar Construction Specifications' },
    { id: 'dm',        label: 'Dubai Municipality', note: 'Green building and product approval' },
    { id: 'esma',      label: 'ESMA / ECAS (UAE)',  note: 'Conformity marking' },
    { id: 'saso',      label: 'SASO / SABER (KSA)', note: 'Conformity certificate for import' },
    { id: 'sbc601',    label: 'SBC 601 (KSA)',      note: 'Saudi energy conservation code' },
    { id: 'estidama',  label: 'Estidama (Abu Dhabi)', note: 'Pearl rating requirements' }
  ];

  var PER_SELECTION = 'Per selection — verify against datasheet';

  /* ── Seed graph ────────────────────────────────────────────────────
     ref is a local key; the API resolves refs into node ids on import.
     ---------------------------------------------------------------- */

  var SEED = {
    title: 'HVAC Knowledge Base',
    kind: 'system',
    domain: 'hvac',
    description: 'Equipment, components, flows, controls and the parameters a specification calls out. Feeds Compliance Maker once nodes are approved.',

    nodes: [
      /* ── Root ─────────────────────────────────────────────────── */
      { ref: 'hvac', kind: 'system', lane: 'equipment', title: 'HVAC system',
        aliases: ['HVAC', 'heating ventilation and air conditioning', 'air conditioning system'],
        summary: 'Heating, ventilation and air conditioning: the combined systems that maintain temperature, humidity and air quality in a building.',
        body: 'Splits into an air side (moves and conditions air), a water side (transports cooling capacity as chilled water) and a refrigeration cycle (produces the cooling effect). Controls tie them together.',
        tags: ['root'] },

      /* ── Refrigeration cycle ──────────────────────────────────── */
      { ref: 'refcycle', kind: 'system', lane: 'refrigeration', title: 'Refrigeration cycle',
        aliases: ['vapour compression cycle', 'refrigerant cycle', 'DX cycle'],
        summary: 'The four-stage vapour compression loop that moves heat from inside a building to outside it.',
        body: 'Compressor raises pressure and temperature of refrigerant vapour. Condenser rejects heat to outside air or water and condenses it to liquid. Expansion valve drops pressure and temperature. Evaporator absorbs heat from indoor air and boils the refrigerant back to vapour. The loop repeats.',
        tags: ['principle'] },

      { ref: 'compressor', kind: 'component', lane: 'refrigeration', title: 'Compressor',
        aliases: ['compressor', 'scroll compressor', 'screw compressor', 'centrifugal compressor'],
        summary: 'Compresses low-pressure low-temperature refrigerant vapour into high-pressure high-temperature vapour.',
        body: 'The energy input to the cycle and normally the largest electrical load in the equipment. Type (scroll, screw, centrifugal, reciprocating) is usually specified and drives part-load efficiency.',
        attributes: [
          { name: 'Compressor type', value: PER_SELECTION, basis: 'Specification / selection' },
          { name: 'Quantity per circuit', value: PER_SELECTION, basis: 'Selection' },
          { name: 'Capacity steps / unloading', value: PER_SELECTION, basis: 'Selection' },
          { name: 'Refrigerant', value: PER_SELECTION, basis: 'Specification' }
        ],
        tags: ['long-lead', 'spec-item'], standards: ['ahri550', 'eurovent'] },

      { ref: 'condenser', kind: 'component', lane: 'refrigeration', title: 'Condenser',
        aliases: ['condenser', 'condenser coil', 'condensing coil'],
        summary: 'Rejects heat to outside air or condenser water and condenses high-pressure refrigerant vapour into liquid.',
        body: 'Air cooled condensers use fans and finned coils; water cooled condensers use a shell-and-tube heat exchanger and a cooling tower. Ambient design temperature matters heavily in the Gulf and is a common source of deviation on tender selections.',
        attributes: [
          { name: 'Condenser type', value: 'Air cooled or water cooled', basis: 'Specification' },
          { name: 'Design ambient temperature', value: PER_SELECTION, basis: 'Project design conditions' },
          { name: 'Coil material / coating', value: PER_SELECTION, basis: 'Specification — coastal sites often require coating' }
        ],
        tags: ['spec-item'] },

      { ref: 'expvalve', kind: 'component', lane: 'refrigeration', title: 'Expansion valve',
        aliases: ['expansion valve', 'TXV', 'EXV', 'electronic expansion valve', 'thermostatic expansion valve'],
        summary: 'Reduces the pressure and temperature of the refrigerant liquid before it enters the evaporator.',
        body: 'Meters refrigerant flow to match load. Electronic expansion valves give better part-load control than thermostatic ones and are commonly specified on larger equipment.',
        attributes: [{ name: 'Valve type', value: PER_SELECTION, basis: 'Specification' }],
        tags: ['spec-item'] },

      { ref: 'evaporator', kind: 'component', lane: 'refrigeration', title: 'Evaporator',
        aliases: ['evaporator', 'evaporator coil', 'DX coil', 'direct expansion coil'],
        summary: 'Absorbs heat from indoor air or from water and evaporates the refrigerant into low-pressure vapour.',
        body: 'In a DX system this is the cooling coil in the air stream. In a chiller it is a shell-and-tube or plate heat exchanger cooling water.',
        tags: ['spec-item'] },

      { ref: 'refrigerant', kind: 'medium', lane: 'refrigeration', title: 'Refrigerant',
        aliases: ['refrigerant', 'R32', 'R410A', 'R134a', 'R1234ze'],
        summary: 'The working fluid that carries heat around the refrigeration cycle by changing phase.',
        body: 'Refrigerant selection is increasingly specified for GWP reasons and can affect capacity, pressure ratings and safety classification. The specified refrigerant is a common compliance matrix line.',
        attributes: [
          { name: 'Refrigerant type', value: PER_SELECTION, basis: 'Specification' },
          { name: 'GWP', value: PER_SELECTION, basis: 'Refrigerant datasheet' },
          { name: 'Safety classification', value: PER_SELECTION, basis: 'ASHRAE 34 / project spec' }
        ],
        tags: ['spec-item'] },

      /* ── Air side ─────────────────────────────────────────────── */
      { ref: 'airside', kind: 'system', lane: 'airside', title: 'Air side system',
        aliases: ['air side', 'air system'],
        summary: 'Everything that conditions and moves air: mixing, filtration, cooling, heating and fans.',
        tags: ['principle'] },

      { ref: 'outsideair', kind: 'medium', lane: 'airside', title: 'Outside air',
        aliases: ['outside air', 'fresh air', 'OA', 'ventilation air'],
        summary: 'Untreated air drawn from outside to meet ventilation requirements.',
        body: 'Quantity is normally set by ASHRAE 62.1 or the local code and is a fixed input to AHU selection. In the Gulf it arrives hot and humid, so it dominates the latent load.',
        attributes: [{ name: 'Outside air quantity', value: PER_SELECTION, basis: 'ASHRAE 62.1 / project ventilation schedule' }],
        standards: ['ashrae621'] },

      { ref: 'returnair', kind: 'medium', lane: 'airside', title: 'Return air',
        aliases: ['return air', 'RA'],
        summary: 'Air drawn back from the conditioned space to be reconditioned.' },

      { ref: 'supplyair', kind: 'medium', lane: 'airside', title: 'Supply air',
        aliases: ['supply air', 'SA', 'conditioned air'],
        summary: 'Conditioned air delivered to the space.',
        attributes: [
          { name: 'Supply air volume', value: PER_SELECTION, unit: 'CFM or m³/h', basis: 'Schedule of equipment' },
          { name: 'Supply air temperature', value: PER_SELECTION, unit: '°C', basis: 'Design conditions' }
        ] },

      { ref: 'mixingbox', kind: 'component', lane: 'airside', title: 'Mixing box',
        aliases: ['mixing box', 'mixing section', 'mixing chamber'],
        summary: 'Blends return air with outside air before filtration.',
        body: 'Contains dampers that set the outside air fraction. Damper leakage class is sometimes specified.',
        attributes: [{ name: 'Damper leakage class', value: PER_SELECTION, basis: 'Specification' }] },

      { ref: 'filter', kind: 'component', lane: 'airside', title: 'Air filter',
        aliases: ['filter', 'air filter', 'pre-filter', 'bag filter', 'panel filter', 'HEPA filter'],
        summary: 'Removes particulate from the air stream before it reaches the coil and the space.',
        body: 'Classified under ISO 16890 (ePM1 / ePM2.5 / ePM10), which replaced the older EN 779 G and F grades. HEPA grades fall under EN 1822. Filter class, stage count and initial/final pressure drop are all common specification lines, and filter pressure drop feeds directly into fan static pressure.',
        attributes: [
          { name: 'Filter class', value: PER_SELECTION, basis: 'ISO 16890 / specification' },
          { name: 'Number of filter stages', value: PER_SELECTION, basis: 'Specification' },
          { name: 'Initial pressure drop', value: PER_SELECTION, unit: 'Pa', basis: 'Filter datasheet' },
          { name: 'Final (dirty) pressure drop', value: PER_SELECTION, unit: 'Pa', basis: 'Specification' },
          { name: 'Fire classification', value: PER_SELECTION, basis: 'EN 13501 / UL 900' }
        ],
        tags: ['spec-item'], standards: ['iso16890', 'en1822', 'en13501'] },

      { ref: 'coolingcoil', kind: 'component', lane: 'airside', title: 'Cooling coil',
        aliases: ['cooling coil', 'chilled water coil', 'CHW coil', 'DX coil', 'cooling section'],
        summary: 'Transfers heat from the air stream into chilled water or refrigerant, cooling and dehumidifying the air.',
        body: 'Rows, fin spacing, face velocity, tube and fin material and water-side pressure drop are all specified. Face velocity is usually capped to prevent moisture carryover, and the cap is a frequent deviation point when a consultant specifies a lower limit than standard selection.',
        attributes: [
          { name: 'Coil type', value: 'Chilled water or direct expansion', basis: 'Specification' },
          { name: 'Number of rows', value: PER_SELECTION, basis: 'Selection' },
          { name: 'Fin spacing', value: PER_SELECTION, unit: 'fins per inch or mm', basis: 'Selection' },
          { name: 'Face velocity', value: PER_SELECTION, unit: 'm/s', basis: 'Specification limit — check carryover clause' },
          { name: 'Tube material', value: PER_SELECTION, basis: 'Specification' },
          { name: 'Fin material / coating', value: PER_SELECTION, basis: 'Specification' },
          { name: 'Water pressure drop', value: PER_SELECTION, unit: 'kPa', basis: 'Selection' }
        ],
        tags: ['spec-item', 'long-lead'], standards: ['ahri410', 'eurovent'] },

      { ref: 'heatingcoil', kind: 'component', lane: 'airside', title: 'Heating coil',
        aliases: ['heating coil', 'reheat coil', 'electric heater', 'LPHW coil'],
        summary: 'Raises air temperature after cooling, usually for humidity control rather than heating.',
        body: 'In Gulf projects this is most often a reheat coil serving humidity control in critical spaces, not comfort heating.',
        attributes: [{ name: 'Heating medium', value: PER_SELECTION, basis: 'Specification — electric, LPHW or hot gas' }] },

      { ref: 'supplyfan', kind: 'component', lane: 'airside', title: 'Supply fan',
        aliases: ['supply fan', 'supply air fan', 'plug fan', 'plenum fan', 'centrifugal fan', 'SAF'],
        summary: 'Moves conditioned air through the coil and duct system into the space.',
        body: 'External static pressure, fan type, motor efficiency class and drive arrangement are specified. Fan selection has to carry the dirty-filter pressure drop, not the clean one, which is a common selection error.',
        attributes: [
          { name: 'Fan type', value: PER_SELECTION, basis: 'Specification — plug, plenum, belt driven' },
          { name: 'Air volume', value: PER_SELECTION, unit: 'CFM or m³/h', basis: 'Schedule of equipment' },
          { name: 'External static pressure', value: PER_SELECTION, unit: 'Pa', basis: 'Schedule of equipment' },
          { name: 'Motor efficiency class', value: PER_SELECTION, basis: 'IE class per specification' },
          { name: 'Motor IP rating', value: PER_SELECTION, basis: 'Specification' },
          { name: 'Speed control', value: PER_SELECTION, basis: 'VFD or EC motor per specification' }
        ],
        tags: ['spec-item'], standards: ['iec60204', 'eurovent'] },

      { ref: 'returnfan', kind: 'component', lane: 'airside', title: 'Return fan',
        aliases: ['return fan', 'return air fan', 'extract fan', 'RAF'],
        summary: 'Draws air back from the space to the air handling unit and maintains building pressure balance.' },

      /* ── Equipment ────────────────────────────────────────────── */
      { ref: 'ahu', kind: 'equipment', lane: 'equipment', title: 'Air handling unit (AHU)',
        aliases: ['AHU', 'air handling unit', 'air handler', 'AHU unit'],
        summary: 'A packaged assembly of sections — mixing, filtration, coil, fan — that conditions and delivers air to a zone or building.',
        body: 'Built as a casing carrying the sections in sequence. The casing itself is specified under EN 1886 using D (deflection), L (leakage), F (filter bypass leakage), T (thermal transmittance) and TB (thermal bridging) classes, and those five letters are usually the first five lines of an AHU compliance matrix.',
        attributes: [
          { name: 'Casing mechanical strength class', value: PER_SELECTION, basis: 'EN 1886 D class' },
          { name: 'Casing air leakage class', value: PER_SELECTION, basis: 'EN 1886 L class' },
          { name: 'Filter bypass leakage class', value: PER_SELECTION, basis: 'EN 1886 F class' },
          { name: 'Thermal transmittance class', value: PER_SELECTION, basis: 'EN 1886 T class' },
          { name: 'Thermal bridging class', value: PER_SELECTION, basis: 'EN 1886 TB class' },
          { name: 'Panel thickness', value: PER_SELECTION, unit: 'mm', basis: 'Specification' },
          { name: 'Panel insulation', value: PER_SELECTION, basis: 'Specification — type and density' },
          { name: 'Certification', value: PER_SELECTION, basis: 'Eurovent / AHRI 430 as specified' }
        ],
        tags: ['spec-item', 'product-line'], standards: ['en1886', 'en13053', 'ahri430', 'eurovent'] },

      { ref: 'fcu', kind: 'equipment', lane: 'equipment', title: 'Fan coil unit (FCU)',
        aliases: ['FCU', 'fan coil unit', 'fan coil'],
        summary: 'A small terminal unit with a fan and a coil that conditions the air in a single room or zone.',
        body: 'Ducted or cassette, exposed or concealed. Sound power level and available static pressure at the specified speed are the usual points of contention, because catalogue data is often quoted at a speed that will not deliver the scheduled airflow.',
        attributes: [
          { name: 'Unit type', value: PER_SELECTION, basis: 'Specification — ducted, cassette, exposed' },
          { name: 'Air volume at specified speed', value: PER_SELECTION, unit: 'CFM', basis: 'Schedule of equipment' },
          { name: 'Available external static pressure', value: PER_SELECTION, unit: 'Pa', basis: 'Selection at scheduled speed' },
          { name: 'Sound power level', value: PER_SELECTION, unit: 'dB(A)', basis: 'Specification limit' },
          { name: 'Motor type', value: PER_SELECTION, basis: 'Specification — EC or AC' },
          { name: 'Drain pan arrangement', value: PER_SELECTION, basis: 'Specification' }
        ],
        tags: ['spec-item', 'product-line'], standards: ['ahri440', 'eurovent'] },

      { ref: 'acchiller', kind: 'equipment', lane: 'equipment', title: 'Air cooled chiller',
        aliases: ['air cooled chiller', 'ACC', 'air cooled water chiller', 'chiller'],
        summary: 'Produces chilled water by running a refrigeration cycle and rejecting heat to outside air.',
        body: 'Rated under AHRI 550/590 for full and part load. In the Gulf, the design ambient used for the rating is critical — capacity at 46°C ambient is very different from capacity at the standard rating point, and a matrix line asking for capacity "at site ambient" needs the selection re-run, not the catalogue figure.',
        attributes: [
          { name: 'Cooling capacity at design ambient', value: PER_SELECTION, unit: 'kW or TR', basis: 'Selection at project design ambient' },
          { name: 'Design ambient temperature', value: PER_SELECTION, unit: '°C', basis: 'Project design conditions' },
          { name: 'Full load efficiency', value: PER_SELECTION, unit: 'COP / EER', basis: 'AHRI 550/590 rating' },
          { name: 'Part load efficiency', value: PER_SELECTION, unit: 'IPLV / NPLV', basis: 'AHRI 550/590 rating' },
          { name: 'Sound power level', value: PER_SELECTION, unit: 'dB(A)', basis: 'Specification limit' },
          { name: 'Number of circuits', value: PER_SELECTION, basis: 'Selection' },
          { name: 'Certification', value: PER_SELECTION, basis: 'Eurovent / AHRI as specified' }
        ],
        tags: ['spec-item', 'product-line', 'long-lead'], standards: ['ahri550', 'eurovent', 'ashrae901'] },

      { ref: 'wcchiller', kind: 'equipment', lane: 'equipment', title: 'Water cooled chiller',
        aliases: ['water cooled chiller', 'WCC', 'water cooled water chiller'],
        summary: 'Produces chilled water and rejects heat to condenser water, normally via a cooling tower.',
        body: 'Higher efficiency than air cooled but requires a condenser water system, cooling tower and water treatment — which brings other trades into the scope boundary.',
        attributes: [
          { name: 'Cooling capacity', value: PER_SELECTION, unit: 'kW or TR', basis: 'Selection' },
          { name: 'Condenser water flow and temperatures', value: PER_SELECTION, basis: 'Design conditions' },
          { name: 'Full load efficiency', value: PER_SELECTION, unit: 'kW/TR or COP', basis: 'AHRI 550/590' }
        ],
        tags: ['spec-item', 'product-line'], standards: ['ahri550'] },

      { ref: 'vrf', kind: 'equipment', lane: 'equipment', title: 'VRF / VRV system',
        aliases: ['VRF', 'VRV', 'variable refrigerant flow', 'variable refrigerant volume'],
        summary: 'A refrigerant-based system where one outdoor unit serves multiple indoor units with variable refrigerant flow.',
        body: 'Suits medium to large buildings where individual room control matters. Pipe length and level difference limits between outdoor and indoor units are hard constraints, and a layout that exceeds them is a design problem, not a selection one.',
        attributes: [
          { name: 'Cooling capacity', value: PER_SELECTION, unit: 'kW', basis: 'Selection' },
          { name: 'Maximum pipe length', value: PER_SELECTION, unit: 'm', basis: 'Manufacturer limit' },
          { name: 'Maximum level difference', value: PER_SELECTION, unit: 'm', basis: 'Manufacturer limit' },
          { name: 'Indoor unit types served', value: PER_SELECTION, basis: 'Selection' }
        ],
        tags: ['spec-item', 'product-line'] },

      { ref: 'splitdx', kind: 'equipment', lane: 'equipment', title: 'Split system (DX)',
        aliases: ['split system', 'split unit', 'DX split', 'direct expansion split'],
        summary: 'An indoor unit paired with an outdoor condensing unit, connected by refrigerant piping.',
        body: 'The most common arrangement for homes and small buildings: lower initial cost, straightforward installation, typically in the 1 to 5 ton range.',
        attributes: [{ name: 'Typical capacity range', value: '1 to 5 ton', basis: 'General reference — confirm per selection' }] },

      { ref: 'pump', kind: 'equipment', lane: 'waterside', title: 'Chilled water pump',
        aliases: ['pump', 'chilled water pump', 'CHW pump', 'primary pump', 'secondary pump'],
        summary: 'Circulates chilled water between the chiller and the coils.',
        attributes: [
          { name: 'Flow rate', value: PER_SELECTION, unit: 'l/s or m³/h', basis: 'System design' },
          { name: 'Head', value: PER_SELECTION, unit: 'kPa or m', basis: 'System design' },
          { name: 'Motor efficiency class', value: PER_SELECTION, basis: 'Specification' }
        ] },

      /* ── Water side ───────────────────────────────────────────── */
      { ref: 'chwsystem', kind: 'system', lane: 'waterside', title: 'Chilled water system',
        aliases: ['chilled water system', 'CHW system', 'central chilled water'],
        summary: 'Uses chilled water as the medium to carry cooling from a central chiller to coils around the building.',
        body: 'Suits large buildings; centralised, high capacity and efficient. Comes with pumps, pipework, expansion, water treatment and a control strategy that all sit in someone\'s scope — usually the contractor\'s, not the equipment supplier\'s.',
        tags: ['principle'] },

      { ref: 'chilledwater', kind: 'medium', lane: 'waterside', title: 'Chilled water',
        aliases: ['chilled water', 'CHW'],
        summary: 'Water cooled by the chiller and circulated to cooling coils.',
        attributes: [
          { name: 'Supply / return temperatures', value: PER_SELECTION, unit: '°C', basis: 'Project design conditions' },
          { name: 'Delta T', value: PER_SELECTION, unit: 'K', basis: 'Project design conditions' }
        ] },

      /* ── Air distribution ─────────────────────────────────────── */
      { ref: 'ductwork', kind: 'component', lane: 'distribution', title: 'Ductwork',
        aliases: ['ductwork', 'ducting', 'ducts', 'duct system'],
        summary: 'Distributes air safely and efficiently between the air handling unit and the spaces.',
        attributes: [
          { name: 'Duct material and gauge', value: PER_SELECTION, basis: 'Specification' },
          { name: 'Insulation', value: PER_SELECTION, basis: 'Specification' },
          { name: 'Leakage class', value: PER_SELECTION, basis: 'Specification' }
        ] },

      { ref: 'diffuser', kind: 'component', lane: 'distribution', title: 'Supply diffuser',
        aliases: ['supply diffuser', 'diffuser', 'air outlet', 'grille'],
        summary: 'Delivers conditioned air into the space with the intended throw and mixing pattern.',
        attributes: [
          { name: 'Throw', value: PER_SELECTION, unit: 'm', basis: 'Selection' },
          { name: 'Sound level', value: PER_SELECTION, unit: 'NC or dB(A)', basis: 'Specification limit' }
        ] },

      { ref: 'returngrille', kind: 'component', lane: 'distribution', title: 'Return grille',
        aliases: ['return grille', 'return air grille', 'extract grille'],
        summary: 'Returns air from the space back to the air handling unit for reconditioning.' },

      { ref: 'damper', kind: 'component', lane: 'distribution', title: 'Volume damper',
        aliases: ['volume damper', 'VCD', 'volume control damper', 'balancing damper'],
        summary: 'Balances airflow between branches of the duct system.' },

      /* ── Controls ─────────────────────────────────────────────── */
      { ref: 'thermostat', kind: 'control', lane: 'controls', title: 'Thermostat',
        aliases: ['thermostat', 'room thermostat', 'space thermostat'],
        summary: 'Senses space temperature and calls for cooling or heating.',
        attributes: [{ name: 'Setpoint range', value: PER_SELECTION, basis: 'Specification' }] },

      { ref: 'bms', kind: 'control', lane: 'controls', title: 'BMS / controls',
        aliases: ['BMS', 'building management system', 'BAS', 'controls', 'building automation'],
        summary: 'Central system that monitors and controls the HVAC plant and reports alarms and trends.',
        body: 'The scope boundary between the equipment supplier\'s factory-fitted controls and the BMS contractor\'s field devices is one of the most common sources of a variation. Fix the points list and the protocol at submittal stage, in writing.',
        attributes: [
          { name: 'Communication protocol', value: PER_SELECTION, basis: 'Specification — BACnet, Modbus, LON' },
          { name: 'Points list', value: PER_SELECTION, basis: 'Agreed at submittal stage' },
          { name: 'Scope boundary', value: PER_SELECTION, basis: 'Specification — factory-fitted vs field-installed' }
        ],
        tags: ['spec-item', 'scope-risk'] },

      /* ── Parameters ───────────────────────────────────────────── */
      { ref: 'comfortcool', kind: 'parameter', lane: 'reference', title: 'Comfort range — cooling',
        aliases: ['cooling setpoint', 'comfort cooling temperature'],
        summary: 'Typical comfort cooling range of 22 to 26 °C.',
        body: 'General reference figure. The project design conditions and the specification always take precedence — never quote this in a submittal.',
        attributes: [{ name: 'Range', value: '22 – 26', unit: '°C', basis: 'General reference — project spec governs' }],
        standards: ['ashrae55'] },

      { ref: 'comfortheat', kind: 'parameter', lane: 'reference', title: 'Comfort range — heating',
        aliases: ['heating setpoint'],
        summary: 'Typical comfort heating range of 20 to 24 °C.',
        attributes: [{ name: 'Range', value: '20 – 24', unit: '°C', basis: 'General reference — project spec governs' }],
        standards: ['ashrae55'] },

      { ref: 'rh', kind: 'parameter', lane: 'reference', title: 'Relative humidity range',
        aliases: ['relative humidity', 'RH'],
        summary: 'Typical comfort relative humidity of 40 to 60 %.',
        attributes: [{ name: 'Range', value: '40 – 60', unit: '%', basis: 'General reference — project spec governs' }],
        standards: ['ashrae55', 'ashrae621'] },

      /* ── Terms ────────────────────────────────────────────────── */
      { ref: 'term-ton', kind: 'term', lane: 'reference', title: 'Ton of refrigeration',
        aliases: ['ton', 'TR', 'ton of refrigeration', 'refrigeration ton'],
        summary: 'One ton of refrigeration equals 12,000 BTU per hour.',
        attributes: [{ name: 'Conversion', value: '1 TR = 12,000 BTU/h', basis: 'Standard definition' }] },

      { ref: 'term-cop', kind: 'term', lane: 'reference', title: 'COP',
        aliases: ['COP', 'coefficient of performance'],
        summary: 'Coefficient of performance: cooling output divided by electrical input, both in the same units.' },

      { ref: 'term-eer', kind: 'term', lane: 'reference', title: 'EER / SEER',
        aliases: ['EER', 'SEER', 'energy efficiency ratio', 'seasonal energy efficiency ratio'],
        summary: 'Energy efficiency ratio, and its seasonal average variant.' },

      { ref: 'term-cfm', kind: 'term', lane: 'reference', title: 'CFM',
        aliases: ['CFM', 'cubic feet per minute'],
        summary: 'Cubic feet per minute — the imperial unit of air volume flow rate.' },

      { ref: 'term-btu', kind: 'term', lane: 'reference', title: 'BTU',
        aliases: ['BTU', 'British thermal unit'],
        summary: 'British thermal unit — the imperial unit of heat energy.' },

      /* ── Failure modes ────────────────────────────────────────── */
      { ref: 'fail-filter', kind: 'failure', lane: 'airside', title: 'Blocked filter',
        aliases: ['dirty filter', 'blocked filter', 'filter clogging'],
        summary: 'Pressure drop across the filter rises, airflow falls, and the coil ices or the space stops holding setpoint.',
        body: 'Presents as reduced airflow and rising space temperature despite the unit running. If the fan was selected on clean-filter pressure drop rather than dirty, this arrives much earlier than expected.',
        tags: ['troubleshooting'] },

      { ref: 'fail-refrigerant', kind: 'failure', lane: 'refrigeration', title: 'Low refrigerant charge',
        aliases: ['refrigerant leak', 'low charge', 'undercharge'],
        summary: 'Capacity falls, suction pressure drops, and the compressor may run continuously without meeting load.',
        tags: ['troubleshooting'] },

      { ref: 'fail-carryover', kind: 'failure', lane: 'airside', title: 'Moisture carryover',
        aliases: ['carryover', 'water carryover', 'condensate carryover'],
        summary: 'Condensate is blown off the cooling coil into the duct because face velocity is too high.',
        body: 'Usually a selection issue rather than a defect. This is why specifications cap coil face velocity, and why a matrix line on face velocity should never be answered from a catalogue maximum.',
        tags: ['troubleshooting', 'spec-item'] },

      /* ── Maintenance ──────────────────────────────────────────── */
      { ref: 'maint-filter', kind: 'maintenance', lane: 'airside', title: 'Filter replacement',
        aliases: ['change filters', 'filter replacement', 'clean filters'],
        summary: 'Clean or replace air filters on a regular interval to hold airflow and air quality.' },

      { ref: 'maint-coil', kind: 'maintenance', lane: 'airside', title: 'Coil cleaning',
        aliases: ['clean coils', 'coil cleaning'],
        summary: 'Clean coils to restore heat transfer performance.' },

      { ref: 'maint-refrigerant', kind: 'maintenance', lane: 'refrigeration', title: 'Refrigerant and pressure check',
        aliases: ['refrigerant check', 'pressure check'],
        summary: 'Verify refrigerant level and operating pressures.' },

      { ref: 'maint-duct', kind: 'maintenance', lane: 'distribution', title: 'Duct leakage inspection',
        aliases: ['duct inspection', 'duct leak check'],
        summary: 'Inspect ductwork for leaks that waste conditioned air.' }
    ],

    edges: [
      /* Hierarchy */
      ['hvac', 'contains', 'airside'], ['hvac', 'contains', 'chwsystem'], ['hvac', 'contains', 'refcycle'],
      ['hvac', 'contains', 'bms'],

      /* Refrigeration cycle */
      ['refcycle', 'contains', 'compressor'], ['refcycle', 'contains', 'condenser'],
      ['refcycle', 'contains', 'expvalve'], ['refcycle', 'contains', 'evaporator'],
      ['compressor', 'flows_to', 'condenser', 'refrigerant', 'High pressure, high temperature vapour'],
      ['condenser', 'flows_to', 'expvalve', 'refrigerant', 'High pressure liquid'],
      ['expvalve', 'flows_to', 'evaporator', 'refrigerant', 'Low pressure, low temperature liquid'],
      ['evaporator', 'flows_to', 'compressor', 'refrigerant', 'Low pressure, low temperature vapour'],
      ['refrigerant', 'part_of', 'refcycle'],

      /* Air side sequence */
      ['airside', 'contains', 'mixingbox'], ['airside', 'contains', 'filter'],
      ['airside', 'contains', 'coolingcoil'], ['airside', 'contains', 'heatingcoil'],
      ['airside', 'contains', 'supplyfan'], ['airside', 'contains', 'returnfan'],
      ['outsideair', 'flows_to', 'mixingbox', 'air'],
      ['returnair', 'flows_to', 'mixingbox', 'air'],
      ['mixingbox', 'flows_to', 'filter', 'air'],
      ['filter', 'flows_to', 'coolingcoil', 'air'],
      ['coolingcoil', 'flows_to', 'heatingcoil', 'air'],
      ['heatingcoil', 'flows_to', 'supplyfan', 'air'],
      ['supplyfan', 'produces', 'supplyair'],
      ['returnfan', 'produces', 'returnair'],

      /* Equipment composition */
      ['ahu', 'contains', 'mixingbox'], ['ahu', 'contains', 'filter'],
      ['ahu', 'contains', 'coolingcoil'], ['ahu', 'contains', 'heatingcoil'],
      ['ahu', 'contains', 'supplyfan'],
      ['fcu', 'contains', 'coolingcoil'], ['fcu', 'contains', 'supplyfan'], ['fcu', 'contains', 'filter'],
      ['acchiller', 'contains', 'compressor'], ['acchiller', 'contains', 'condenser'],
      ['acchiller', 'contains', 'evaporator'], ['acchiller', 'contains', 'expvalve'],
      ['wcchiller', 'contains', 'compressor'], ['wcchiller', 'contains', 'evaporator'],
      ['vrf', 'contains', 'compressor'], ['vrf', 'contains', 'expvalve'],
      ['splitdx', 'contains', 'compressor'], ['splitdx', 'contains', 'evaporator'],

      /* Water side */
      ['chwsystem', 'contains', 'acchiller'], ['chwsystem', 'contains', 'pump'],
      ['acchiller', 'produces', 'chilledwater'],
      ['pump', 'supplies', 'chilledwater'],
      ['chilledwater', 'flows_to', 'coolingcoil', 'chilled_water'],
      ['coolingcoil', 'requires', 'chilledwater'],

      /* Distribution */
      ['supplyair', 'flows_to', 'ductwork', 'air'],
      ['ductwork', 'flows_to', 'diffuser', 'air'],
      ['diffuser', 'supplies', 'supplyair'],
      ['returngrille', 'supplies', 'returnair'],
      ['damper', 'controls', 'ductwork'],

      /* Controls */
      ['thermostat', 'monitors', 'supplyair'],
      ['thermostat', 'controls', 'fcu'],
      ['bms', 'monitors', 'ahu'], ['bms', 'monitors', 'acchiller'],
      ['bms', 'controls', 'supplyfan'], ['bms', 'controls', 'pump'],

      /* Standards governance */
      ['ahu', 'governed_by', 'comfortcool'],

      /* Failures */
      ['filter', 'causes', 'fail-filter'],
      ['refrigerant', 'causes', 'fail-refrigerant'],
      ['coolingcoil', 'causes', 'fail-carryover'],

      /* Maintenance */
      ['filter', 'requires', 'maint-filter'],
      ['coolingcoil', 'requires', 'maint-coil'],
      ['refcycle', 'requires', 'maint-refrigerant'],
      ['ductwork', 'requires', 'maint-duct']
    ]
  };

  window.TN_KG_HVAC = {
    id: 'hvac',
    label: 'HVAC knowledge',
    kind: 'system',
    nodeKinds: NODE_KINDS,
    relations: RELATIONS,
    lanes: LANES,
    standards: STANDARDS,
    seed: SEED
  };
})();
