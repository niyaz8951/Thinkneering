/* The AHU rule book (owner, 16 Oct 2026: "upgrade the AHU AI rule book with the logic and rules of the Compliance AI
   walkthrough, based on Product Options and the specs"). Added to a rule book for AHUs by Create from template or
   Update from template (map.ts seedTree / upgradeAiMap); a branch someone edited is never touched.

   Where it comes from:
     - the Riyadh Metro AHU specification (MasterFormat 23 73 13) walked through clause by clause
       (Compliance-AI-Walkthrough.md): the four kinds of clause (site work, reference, submittal, product
       requirement) and the gaps G3 / G8 / G9;
     - the AHU compliance library of the Thinkneering v3 site (AHU-UAE.xlsx): how people answered each section
       (site works and related divisions "In Contractor's Scope", submittal data "provided in the AHU datasheet",
       references "Noted" with the certification, belt-drive items "Not Applicable" with EC plug fans ...), and its
       Eurovent ratings sheet (D-AHU ranges, made in Dubai and Riyadh);
     - the owner's AHU compliance engine v2 (v3 docs): supply scope versus site execution, "Comply as equivalent",
       the default configuration of the KSA factory.

   Logic goes in the Part branches: instructions on how to answer, and fixed answers only for pure scope (site work,
   seismic design by others). What is TRUE about the units goes in Facts: the model may cite a fact ([F1]) for
   Comply; an instruction rule alone is never enough (draft.ts). Facts that are commercial or that this note could
   not confirm for every factory come in "to verify" (off): a person checks them in Maps and marks them verified.
   Product values per factory (panel thickness, fan type, filter make ...) stay in Product Options, which the AI
   reads for every clause through the row mapping. */
import type { Seed } from "./map";

const SITE = "Remark: By Contractor / others. Daikin scope is supply of equipment.";

export function isAhu(product: string): boolean {
  return /\bahus?\b|air[\s-]*handling/i.test(product);
}

/* ---------- Part branches: how to answer ---------- */

export const AHU_PART1: Seed[] = [
  { title: "Fan selection at the scheduled duty", notes: "Fans and motors are selected by the selection software at the scheduled air flow and pressure: the operating point, margins and efficiency are on the AHU datasheet (fan curve). Answer Comply citing the project datasheet or the fact 'AHU datasheet', remark: 'Fans are selected at the scheduled conditions; the fan curve with the operating point is in the AHU datasheet.' A deviation the clause invites (a smaller motor when pressure drops are lower) is the selection engineer's decision: Noted.",
    special: ["When: operating point, stable operation, peak static pressure, static efficiency, design conditions, smaller fan motor, operating limits, AMCA 99, safety factor"] },
  { title: "Seismic and vibration isolation design", notes: "Seismic restraint and vibration-isolation design, calculations and certificates signed by an engineer are the contractor's (library practice: a compliance statement is given for the air handling units only). The unit's own strength (casing deflection, self-supporting base) is a product clause: the Unless line keeps this rule off it.",
    special: ["When: seismic, delegated design, delegated-design, vibration isolation, seismic restraint, seismic-restraint, ASCE, earthquake, withstand", "Unless: casing panel, casing panels, deflection, self-supporting, self supporting, structural performance", "Answer: In Contractor's Scope", "Remark: Seismic restraint and vibration isolation design by Contractor / others. A compliance statement is provided for the air handling units only."] },
  { title: "Submittals", notes: "Data the AHU datasheet gives (fact 'AHU datasheet': fan curves and operating point, fan and motor data, coil performance, sound power, internal pressure drops, dimensions and weights) -> Comply, the remark says where: 'Fan and motor data are provided in the AHU datasheet.' Contractor's documents (coordination drawings, room layouts, seismic and vibration calculations, field and commissioning reports, external static pressure confirmation, wiring outside the unit) -> In Contractor's Scope. Operation and maintenance data -> Comply, 'IOM manuals are provided.' Warranties and spare-parts lists -> Noted. Never promise a document that no fact or library answer says the factory issues: leave that clause for a person.",
    special: ["Section: submittals, submittal, product data, shop drawings, action submittals, informational submittals, closeout submittals"] },
  { title: "Contractor's documents", notes: "Documents only the contractor can produce.",
    special: ["When: coordination drawings, field commissioning reports, commissioning reports, field test reports, field quality-control reports, delegated-design submittal, design calculations, mechanical-room layout", "Unless: manufacturer's, factory", "Answer: In Contractor's Scope", SITE] },
  { title: "Quality assurance and listings", notes: "Certifications, listings and labels come from facts only (Eurovent, AHRI coils, IEC motors, insulation fire rating). A listing no fact gives (a UL / ETL label on the whole unit, an AMCA seal on EC plug fans) is not Comply: answer Comply with Remarks naming what is offered when a fact gives it, otherwise leave the clause for a person. A condensation guarantee during the guarantee period and tests the contractor arranges are In Contractor's Scope.",
    special: ["Section: quality assurance"] },
  { title: "Delivery, packing and lifting", notes: "What the factory does (assembly into modules, packing, crating, lifting points on the base frame) is answered from the fact 'Delivery and packing': Comply. Storage and handling at site, unloading and protection after delivery are the contractor's. A clause with both: answer the supply part and add 'Storage and handling at site by Contractor / others.' to the remark.",
    special: ["When: deliver, delivery, crating, crated, shipped, shipping, lifting lug, lifting lugs, lifting points, lifting holes, factory-assembled module, protective covering"] },
  { title: "Storage and handling at site", notes: "Keeping and moving the units at site.",
    special: ["When: store in, stored in, storage at site, site storage, protect from weather, construction traffic, handle carefully, handled and stored, lift and support", "Unless: crating, crated, packed, packing, packaged, factory, furnish, extra materials", "Answer: In Contractor's Scope", SITE] },
  { title: "Extra materials and spare parts", notes: "Extra materials (filters, belts, gaskets, cylinders) are a commercial item: Noted, the remark from the fact 'Spare parts' when it is on file. Fan belts with EC plug fans: Not Applicable.",
    special: ["Section: extra materials, spare parts, maintenance material, maintenance materials"] },
  { title: "Warranty", notes: "Answer from the fact 'Warranty period': a period that matches it -> Comply; a longer period -> Comply with Remarks stating the standard warranty (a longer one is a commercial matter); a list of failures covered -> Noted. Without the fact, leave the clause for a person.",
    special: ["Section: warranty, warranties"] }
];

export const AHU_PART2: Seed[] = [
  { title: "Manufacturer", notes: "Standard products of a manufacturer regularly engaged, local service organisation, single source: Comply from the fact 'Manufacturing and support'. Never write years of experience, certificates or service details that no fact gives.",
    special: ["Section: manufacturers, manufacturer", "When: manufacturer, regularly engaged, local service, service organization, service organisation, single manufacturer"] },
  { title: "Casing and panels (EN 1886)", notes: "Panel thickness, insulation and the casing classes come from the project datasheet, Product Options and the fact 'Eurovent certification' for the range on the datasheet. EN 1886 scales: casing strength D1 <= 4 mm/m, D2 <= 10 mm/m; casing leakage at -400 Pa L1 <= 0.15, L2 <= 0.44, L3 <= 1.32 l/(s.m2); thermal transmittance T1 U <= 0.5, T2 0.5-1.0, T3 1.0-1.4, T4 1.4-2.0 W/(m2.K); thermal bridging TB1 0.75-1.0 (best), TB2 0.60-0.75, TB3 0.45-0.60, TB4 0.30-0.45. A U-value asked (e.g. 0.68 W/m2K) is met by T1 only; T2 does not prove it: Comply with Remarks stating the class, confidence low. A thicker panel or a better class than asked: Comply with Remarks stating what is offered. Another material (foam instead of glass fibre, an aluminium profile instead of a steel framework, galvanised instead of aluminium inner skin): Comply with Remarks stating the offered material, unless Product Options or a rule says it cannot be offered.",
    special: ["When: casing, panel, panels, double wall, double skin, outer skin, inner skin, outside casing, inside casing, thermal conductance, thermal transmittance, thermal bridging, deflection, casing leakage, air leakage, structural performance, framework, profile"] },
  { title: "Insulation", notes: "Insulation type, thickness and density from the datasheet, Product Options and the Eurovent fact (foam in the Energy ranges, mineral wool in the Sound ranges). Glass fibre asked and foam offered: Comply with Remarks stating the offered insulation and its fire rating (fact 'Insulation fire rating'). A density asked for glass fibre does not apply to foam: state what is offered rather than Not Comply.",
    special: ["When: insulation, insulated, polyurethane, foam, glass fiber, glass fibre, mineral wool, rock wool, density, CFC free, flame spread, smoke developed"] },
  { title: "Drain pans", notes: "Material, double slope, insulation and connections from Product Options and the datasheet. A grade below the one asked (304 where 316 is asked): Comply with Remarks stating the grade offered, or the special option when Product Options lists 316.",
    special: ["When: drain pan, drain pans, drip pan, condensate pan, intermediate drain, drain trough"] },
  { title: "Access doors, lights and windows", notes: "Doors, hinges and latches from Product Options. Lights, switches, inspection windows and convenience outlets are options: Comply with Remarks naming the option when Product Options lists it; an item Product Options does not list is left for a person.",
    special: ["When: access door, access doors, access panel, hinge, hinges, latch, latches, inspection window, inspection windows, vapor-proof, vapour-proof, light switch, lights, convenience outlet, duplex outlet, pilot light"] },
  { title: "Fans", notes: "The fan type comes from the datasheet and Product Options (EC plug fans with integrated EC motors are the standard; belt-driven fans where the selection says so). A belt-driven centrifugal fan or a scroll housing asked and EC plug fans offered: Comply with Remarks, 'Direct-driven EC plug fans with integrated EC motors are offered.' Parts that exist only on belt-driven fans (shafts with keyways, pillow-block bearings, separate fan base on spring isolators, flexible connection between fan and housing) are Not Applicable with EC plug fans. Bearing life or AMCA ratings asked: only from a fact or the datasheet.",
    special: ["When: fan, fans, fan section, impeller, scroll, centrifugal, plug fan, plug fans, backward, airfoil, shaft, shafts, bearing, bearings"] },
  { title: "Motors", notes: "With EC plug fans the motor is the integrated EC motor: belt thrust, adjustable motor bases and slide rails do not apply (Not Applicable); 'NEMA or equivalent' -> Comply with Remarks citing the fact 'Motor standards' (IEC). An efficiency class asked (IE3, premium): Comply when a fact or the datasheet gives an equal or higher class. Starters and wiring specified in Division 26 are by the electrical contractor unless Product Options lists a starter panel.",
    special: ["When: motor, motors, IE3, IE4, IE5, premium efficiency, NEMA, service factor, insulation class, dripproof, drip-proof, TEFC, overload protection, starter, starters, torque"] },
  { title: "Coils", notes: "Rows, fin spacing, face velocity and pressure drops come from the datasheet (compared by code). Materials (copper tubes, aluminium fins, galvanised or stainless casing, tube thickness) from Product Options: copper fins or a heavier tube than offered -> Comply with Remarks stating what is offered, or the special option when Product Options lists it. AHRI 410 rating: from the fact 'Coils AHRI certified' only. Steam or DX coils the selection does not have: Not Applicable.",
    special: ["When: coil, coils, fins, tubes, header, headers, circuits, rows, fin spacing, face velocity, water velocity, steam coil, refrigerant coil, direct-expansion"] },
  { title: "Dampers and mixing boxes", notes: "Damper type, blades and leakage class from Product Options. Damper actuators and their wiring are by the controls contractor unless Product Options lists factory-fitted actuators. Face-and-bypass or zone dampers the selection does not have: Not Applicable.",
    special: ["When: damper, dampers, mixing box, mixing boxes, mixing section, face and bypass, zone damper, zone dampers, AMCA 500"] },
  { title: "Filters", notes: "Filter classes are compared on their published scales by code. MERV (ASHRAE 52.2) and ISO 16890 / EN 779 are different test methods: state the offered class ('ISO ePM1 55%') and never claim an equivalence no fact gives. Washable or permanent metal filters, construction filters and spare sets: Product Options, else left for a person. Filter gauges: the gauge Product Options lists; its own details (dial size, colours, accuracy, range) follow the gauge offered: Comply with Remarks naming it.",
    special: ["When: filter, filters, MERV, ISO 16890, EN 779, ePM1, ePM2.5, ePM10, arrestance, bag filter, panel filter, pre-filter, prefilter, filter gauge, filter gage, magnehelic, manometer, filter housing"] },
  { title: "Energy recovery", notes: "Answer only when the selection has the component (a section of the datasheet). A clause about a device the selection does not have: Not Applicable, or confidence low and the reason says it is a commercial question.",
    special: ["When: heat recovery, energy recovery, heat wheel, thermal wheel, enthalpy wheel, heat pipe, heat pipes, plate heat exchanger, run-around"] },
  { title: "Controls and speed control", notes: "Field controls, the BMS and the wiring between the unit and the building are by the controls contractor (In Contractor's Scope) unless Product Options lists the factory-fitted item. EC fans have integrated speed control: a separate variable speed drive asked for an EC fan -> Comply with Remarks, 'Speed control is integrated in the EC motors.'",
    special: ["When: DDC, BMS, BACnet, Modbus, controller, controls, sensor, sensors, variable speed, motor control centers, motor-control centers"] },
  { title: "Controls specified elsewhere", notes: "A clause that hands the item to the BMS or electrical sections.",
    special: ["When: specified in section building management system, specified in division 26, specified in other sections", "Unless: factory installed, factory-installed, factory mounted, factory wired, factory-wired, variable speed, variable frequency, vfd, vsd, inverter", "Answer: In Contractor's Scope", SITE] },
  { title: "Factory tests", notes: "Eurovent certification covers the rated performance (fact 'Eurovent certification'). Unit factory tests and witnessing are commercial: Comply with Remarks from the fact 'Factory acceptance test'. Fan tests to AMCA 210 / 300: from the fact 'AMCA' only. A repeat test after a failure and written results before shipping follow the factory test: Comply with Remarks with the same fact.",
    special: ["When: factory test, factory tests, factory tested, tested prior to shipment, witness, witnessed, AMCA 210, AMCA 300, AMCA 301, AHRI 430, test procedure, source quality control"] },
  { title: "Humidifiers, heaters and UV lamps", notes: "Options: answer from Product Options and the datasheet (type, capacity, control). A component the selection does not have: Not Applicable. Without Product Options, leave the clause for a person.",
    special: ["When: humidifier, humidifiers, steam generator, electric heater, heater battery, electric heating, UV lamp, UV lamps, ultraviolet"] }
];

export const AHU_PART3: Seed[] = [
  { title: "Field tests and commissioning", notes: "Tests, settings and measurements at site are the contractor's (the commissioning by the factory's representative goes to the model: Unless).",
    special: ["When: field quality control, perform tests, tests and inspections, testing adjusting and balancing, measure and record, record fan performance, set zone dampers, set face-and-bypass, set outside-air, manually operate dampers, energize motor, comb coil fins, install clean filters", "Unless: factory-authorized, factory authorized, factory-authorised, manufacturer's representative, service representative, factory test, train, training", "Answer: In Contractor's Scope", SITE] },
  { title: "Manufacturer's service at site", notes: "A factory-authorised representative for inspection, start-up or supervision at site is a service Daikin can offer at extra cost: answer In Contractor's Scope with the remark from the fact 'Supervision by a Daikin engineer' when it is on file; otherwise In Contractor's Scope with the standard site remark and confidence low.",
    special: ["When: factory-authorized, factory authorized, factory-authorised, manufacturer's representative, service representative, manufacturer's field, field inspection, startup service, start-up service, supervise, supervision, local representative"] },
  { title: "Training and demonstration", notes: "Training the owner's staff is a commercial service: Noted, with the remark from a fact or library answer that says what is offered; without one, leave the clause for a person.",
    special: ["When: train, training, demonstration, demonstrate, instruct"] }
];

/* ---------- Facts: what is true about the units (cited as [F]) ---------- */

/* off: comes in "to verify" (a person checks it in Maps and marks it verified to let the AI use it). */
export const AHU_FACTS: Seed[] = [
  { title: "Eurovent certification", notes: "Daikin AHUs (D-AHU) are Eurovent certified (EN 1886, EN 13053), made in Dubai and Riyadh. Certified classes by range (panel, insulation, casing strength, casing leakage at -400 Pa / +700 Pa, filter bypass leakage, thermal transmittance, thermal bridging): Energy F2: 42 mm, foam, D1(M), L1(M) / L1(M), F9(M), T3, TB4. Energy S2: 62 mm, foam, D1(M), L1(M) / L1(M), M6(M), T3, TB4. Energy TermiC F2: 42 mm, foam, thermal-break profile, D1(M), L1(M) / L1(M), F9(M), T2, TB2. Energy TermiC S2: 62 mm, foam, thermal-break profile, D1(M), L1(M) / L1(M), F9(M), T2, TB2. Sound F2: 42 mm, mineral wool, D2(M), L1(M) / L1(M), M6(M), T3, TB4. Sound S2: 62 mm, mineral wool, D2(M), L1(M) / L3(M), F9(M), T3, TB3. Sound TermiC F2: 42 mm, mineral wool, thermal-break profile, D1(M), L1(M) / L2(M), F9(M), T2, TB2. Sound TermiC S2: 62 mm, mineral wool, thermal-break profile, D1(M), L1(M) / L2(M), F9(M), T2, TB2. The range of a project is the one on its AHU datasheet.",
    special: ["When: eurovent, EN 1886, EN 13053, casing strength, casing leakage, air leakage, filter bypass, bypass leakage, thermal transmittance, thermal bridging, thermal conductance, deflection, panel thickness, double wall, double skin, certified, certification"] },
  { title: "AHU datasheet", notes: "The AHU datasheet (selection report) of each unit gives: fan curves with the operating point, fan and motor data (air flow, pressures, power, speed, electrical data), coil performance (air side and water side, entering and leaving conditions, pressure drops), sound power levels by octave band, internal pressure drops of every component, filter classes, dimensions and weights.",
    special: ["When: product data, datasheet, data sheet, fan curve, fan curves, sound power, coil performance, coil-performance, motor ratings, electrical characteristics, pressure drop, pressure drops, static pressure, dimensions, weights, equipment schedule, selection"] },
  { title: "Manuals", notes: "Installation, operation and maintenance (IOM) manuals are provided with the units.",
    special: ["When: operation and maintenance, maintenance manual, maintenance manuals, o&m, IOM, maintenance data, troubleshooting, lists of parts, parts list"] },
  { title: "Coils AHRI certified", off: true, notes: "Cooling coils are AHRI certified (AHRI 410).",
    special: ["When: AHRI 410, coil performance, coil-performance, certified coil, coil ratings, coil rating"] },
  { title: "AMCA", off: true, notes: "AMCA 210 certified fans can be provided on request; EC plug fans are not AMCA certified.",
    special: ["When: AMCA"] },
  { title: "Warranty period", off: true, notes: "Standard AHU warranty: 12 months from start-up or 18 months from delivery, whichever comes first. A longer period is a commercial matter.",
    special: ["When: warranty, warranties, guarantee, guarantee period"] },
  { title: "Factory acceptance test", off: true, notes: "Daikin AHUs are Eurovent certified and made in an ISO certified facility. A factory acceptance test, and its witnessing, can be provided at extra cost on request.",
    special: ["When: factory test, factory tests, factory tested, factory acceptance, witness, witnessed, tested prior to shipment, tested at the manufacturer"] },
  { title: "Spare parts", off: true, notes: "Spare parts (filters, belts, gaskets) can be provided at extra cost on request.",
    special: ["When: extra materials, spare, spares, spare parts, furnish 1 set, replacement cylinder"] },
  { title: "Supervision by a Daikin engineer", off: true, notes: "A Daikin engineer can be provided to supervise the assembly or installation at site, at extra cost.",
    special: ["When: supervise, supervision, local representative, factory-authorized, factory authorized, manufacturer's representative, service representative, field inspection"] },
  { title: "Delivery and packing", off: true, notes: "Units are delivered nylon wrapped on wooden crating, with lifting holes on the base frame. Daikin delivers to site without unloading.",
    special: ["When: crating, crated, packing, packaging, shipped, shipping, deliver, delivery, lifting lug, lifting lugs, lifting points, lifting holes, protective covering"] },
  { title: "Insulation fire rating", off: true, notes: "Foam insulation: surface spread of flame class 1 per ASTM E84 (flame spread index below 25, smoke developed index below 250); fire resistance class 1 per BS 476 parts 6 and 7.",
    special: ["When: flame spread, smoke developed, smoke generation, ASTM E84, ASTM 84, fire rating, BS 476"] },
  { title: "Motor standards", off: true, notes: "AHU motors comply with IEC standards. EC plug fans have integrated EC motors with built-in speed control.",
    special: ["When: IEC, NEMA, motor efficiency, IE3, IE4, premium efficiency, EC motor, EC motors"] },
  { title: "Manufacturing and support", off: true, notes: "Daikin AHUs are manufactured in an ISO certified facility and supported by Daikin's local service and technical support organisation.",
    special: ["When: manufacturer, regularly engaged, local service, service organization, service organisation, single manufacturer, technical support"] }
];

/* Facts that hold for one factory only (its own rule book), from the owner's AHU compliance engine v2: "Default
   Daikin KSA factory configuration; the selection report always overrides these defaults". All "to verify". */
export function factoryFacts(product: string, factory: string): Seed[] {
  if (!isAhu(product) || !/riyadh|ksa|saudi/i.test(factory)) return [];
  const f = factory.trim() || "Riyadh";
  return [
    { title: "Panels (" + f + ")", off: true, notes: `${f} factory standard: Besta double-skin panels with PU foam insulation, unless the project selection says otherwise.`,
      special: ["When: panel, panels, casing, double skin, double wall, insulation, foam"] },
    { title: "Filters (" + f + ")", off: true, notes: `${f} factory standard: AAF filters, unless the project selection says otherwise.`,
      special: ["When: filter, filters, filter media"] },
    { title: "Fans (" + f + ")", off: true, notes: `${f} factory standard: ebm-papst RadiPac EC fans, or Yilida belt-driven EC fans, as the project selection says.`,
      special: ["When: fan, fans, plug fan, belt, belts, belt-driven, EC motor"] },
    { title: "Controls (" + f + ")", off: true, notes: `${f} factory standard controls: starter panel; WL9 PT10K potentiometer.`,
      special: ["When: controls, control panel, starter, starters, potentiometer, speed control"] },
    { title: "Filter bypass leakage (" + f + ")", off: true, notes: "Filter bypass leakage per EN 1886: front-withdrawal filters F9; side-withdrawal filters F7.",
      special: ["When: filter bypass, bypass leakage, EN 1886, front withdrawal, side withdrawal"] }
  ];
}

export const FACTS_NOTES = "What is true about the units, for the AI to cite ([F1]) when it answers Comply, Comply with Remarks, Not Comply or Not Applicable: an instruction rule alone is never enough. Title = the subject, notes = the fact as it may be quoted, When = the words of the clauses it is about (a fact without When or Section is shown on every clause). A fact \"to verify\" is not used: check it, edit it if needed and mark it verified. Values that differ per project or factory stay in the datasheet and Product Options.";
