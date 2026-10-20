/* The knowledge map template (owner, 20 Oct 2026): one knowledge map per factory, kept by that factory's team. It is
   also the home of the Shazam-like vocabulary (docs/Vocabulary-Experiment-2026-10-19.md): no third map.

     <product> <factory> - knowledge
     |-- Product facts        what the factory's units are, in sentences the AI may quote (verified branches only)
     |-- Vocabulary           one branch per requirement type, under its component:
         |-- Filters
             |-- Final filter class        ! Terms: ...  ! Kind: class  ! Scale: G4, M5 ... F9  (read by code: identification)
                 |-- Offered (Riyadh)      what this factory offers, with its source: "to verify" until a person fills
                 |                         it in and verifies it; then the AI may quote it like a fact
                 |-- Equivalences          ! MERV 13 = F7 ... (to verify: an engineer approves them)

   The engineering lines (Terms, Kind, Unit, Direction, Scale, Tolerance) are general knowledge, not claims about the
   factory: they come verified. Everything the factory offers, and every equivalence, comes "to verify". The AI reads
   from this map only the verified Product facts and the verified Offered / Equivalences branches (map.ts knowledgeOf);
   the vocabulary lines are for the fingerprint engine (roadmap step A). */
import type { Seed } from "./map";

interface T { title: string; terms: string; kind: "value" | "class" | "choice" | "standard" | "presence"; unit?: string; dir?: "higher" | "lower" | "equal"; scale?: string; tol?: string; eq?: string[]; notes?: string }
type C = [string, string, T[]];   // component, its words, its types

const AHU: C[] = [
  ["Casing", "casing, cabinet, panel, panels, double skin, double wall", [
    { title: "Panel thickness", terms: "panel thickness, casing thickness, panel, wall thickness", kind: "value", unit: "mm", dir: "higher" },
    { title: "Panel construction and skins", terms: "double skin, double wall, inner skin, outer skin, galvanized, galvanised, precoated, pre-painted, stainless", kind: "choice", notes: "Material words: precoated galvanised steel is galvanised steel with a coating." },
    { title: "Casing leakage class (EN 1886)", terms: "casing leakage, air leakage, air tightness, leakage class", kind: "class", scale: "L3, L2, L1", dir: "higher" },
    { title: "Casing strength class (EN 1886)", terms: "mechanical strength, casing strength, deflection", kind: "class", scale: "D3, D2, D1", dir: "higher" },
    { title: "Thermal transmittance class (EN 1886)", terms: "thermal transmittance, thermal transmit, u value", kind: "class", scale: "T5, T4, T3, T2, T1", dir: "higher" },
    { title: "Thermal bridging class (EN 1886)", terms: "thermal bridging, thermal bridge, thermal break", kind: "class", scale: "TB5, TB4, TB3, TB2, TB1", dir: "higher" },
    { title: "Corrosion resistance", terms: "salt spray, corrosion, ISO 9227, ASTM B117", kind: "value", unit: "h", dir: "higher" }]],
  ["Insulation", "insulation, insulated, foam, polyurethane, mineral wool, glass fibre, fiberglass", [
    { title: "Insulation material", terms: "insulation material, polyurethane, PU foam, mineral wool, rock wool, glass fibre, ASTM C 1071", kind: "choice" },
    { title: "Insulation density", terms: "density", kind: "value", unit: "kg/m3", dir: "higher" },
    { title: "Insulation fire rating", terms: "flame spread, smoke developed, ASTM E84, UL 723, BS 476, fire rating, class 1, class 0", kind: "standard" }]],
  ["Filters", "filter, filters, filtration, prefilter, pre-filter, bag filter, panel filter, final filter", [
    { title: "Pre-filter class", terms: "prefilter, pre-filter, panel filter, MERV, ISO coarse, G4, efficiency", kind: "class", scale: "G1, G2, G3, G4, M5, M6, F7", dir: "higher", eq: ["MERV 7 = G4", "MERV 8 = G4", "ISO Coarse 60% = G4"] },
    { title: "Final filter class", terms: "final filter, bag filter, secondary filter, MERV, ePM1, ePM2.5, F7, F8, F9, efficiency", kind: "class", scale: "M5, M6, F7, F8, F9, E10, E11, E12, H13, H14", dir: "higher", eq: ["MERV 13 = F7", "MERV 14 = F8", "ePM1 50-65% = F7", "ePM1 70-80% = F8"] },
    { title: "Filter depth", terms: "filter thickness, filter depth, thick", kind: "value", unit: "mm", dir: "equal", tol: "5%" },
    { title: "Filter face velocity", terms: "face velocity, filter velocity", kind: "value", unit: "m/s", dir: "lower" }]],
  ["Fans", "fan, fans, plug fan, impeller, fan wheel, fan section", [
    { title: "Fan type", terms: "plug fan, EC fan, centrifugal, backward curved, forward curved, belt driven, direct driven", kind: "choice" },
    { title: "Fan bearing life", terms: "bearing life, rated life, L10, ABMA 9", kind: "value", unit: "h", dir: "higher" },
    { title: "Fan balancing", terms: "balanced, balancing, G 6.3, ISO 21940, ISO 1940", kind: "standard" }]],
  ["Motors", "motor, motors", [
    { title: "Motor efficiency class", terms: "NEMA premium, premium efficiency, efficiency class, IE2, IE3, IE4, IE5", kind: "class", scale: "IE1, IE2, IE3, IE4, IE5", dir: "higher", eq: ["NEMA Premium = IE3", "NEMA EPAct = IE2"] },
    { title: "Motor enclosure", terms: "enclosure, IP54, IP55, TEFC, ODP", kind: "class" }]],
  ["Variable speed drives", "variable frequency, VFD, VFC, frequency converter, inverter", [
    { title: "Drive provided", terms: "variable frequency drive, VFD, VFC, frequency converter", kind: "presence", notes: "With EC fans the speed control is in the motor electronics: say so in Offered." }]],
  ["Coils", "coil, coils, cooling coil, heating coil", [
    { title: "Coil rating standard", terms: "AHRI 410, ASHRAE 33, rated, ratings, tested", kind: "standard" },
    { title: "Coil face velocity", terms: "face velocity, coil velocity", kind: "value", unit: "m/s", dir: "lower" },
    { title: "Fin and tube material", terms: "fin material, tube material, copper, aluminium, coated fins", kind: "choice" }]],
  ["Dampers", "damper, dampers", [
    { title: "Damper leakage", terms: "damper leakage, leakage rate, AMCA 500, EN 1751, class 2, class 3, class 4", kind: "class", eq: ["AMCA 500 <= 2% at 1000 Pa ~ EN 1751 class 2 (check per case)"] },
    { title: "Damper blades", terms: "blade, blades, aerofoil, airfoil, opposed blade, parallel blade, aluminium", kind: "choice" }]],
  ["Heat recovery", "heat wheel, rotary heat exchanger, enthalpy wheel, heat recovery, plate heat exchanger", [
    { title: "Heat recovery efficiency", terms: "efficiency, effectiveness, EN 308", kind: "value", unit: "%", dir: "higher" },
    { title: "Heat recovery class (EN 13053)", terms: "heat recovery class, H1, H2, H3", kind: "class", scale: "H6, H5, H4, H3, H2, H1", dir: "higher" }]],
  ["Drain pan", "drain pan, condensate pan, drip tray", [
    { title: "Drain pan material", terms: "stainless steel, SS304, SS316, precoated, drain pan material", kind: "choice" }]],
  ["Access doors", "access door, access doors, access panel, inspection door", [
    { title: "Access door width", terms: "access door, door width, wide, size", kind: "value", unit: "mm", dir: "higher" }]],
  ["Unit", "air handling unit, AHU, unit", [
    { title: "Velocity class (EN 13053)", terms: "velocity class, V1, V2, V3, V4", kind: "class", scale: "V9, V8, V7, V6, V5, V4, V3, V2, V1", dir: "higher" },
    { title: "Power class (EN 13053)", terms: "power class, P1, P2, P3", kind: "class", scale: "P7, P6, P5, P4, P3, P2, P1", dir: "higher" },
    { title: "Certification", terms: "Eurovent, AHRI, certified, certification", kind: "standard" },
    { title: "Warranty period", terms: "warranty, guarantee", kind: "value", unit: "months", dir: "higher" },
    { title: "Power supply", terms: "power supply, voltage, phase, Hz", kind: "choice" }]]
];

const FCU: C[] = [
  ["Unit", "fan coil, fan coil unit, FCU, unit", [
    { title: "Cooling capacity", terms: "cooling capacity, total capacity, sensible capacity", kind: "value", unit: "kW", dir: "higher" },
    { title: "Heating capacity", terms: "heating capacity", kind: "value", unit: "kW", dir: "higher" },
    { title: "Unit type", terms: "ducted, concealed, exposed, cassette, floor standing, ceiling mounted, high static", kind: "choice" },
    { title: "External static pressure", terms: "external static pressure, ESP", kind: "value", unit: "Pa", dir: "higher" },
    { title: "Sound level", terms: "sound pressure, sound power, noise, dB(A)", kind: "value", unit: "dB(A)", dir: "lower" },
    { title: "Certification", terms: "Eurovent, AHRI 440, certified", kind: "standard" },
    { title: "Power supply", terms: "power supply, voltage, phase, Hz", kind: "choice" }]],
  ["Fan and motor", "fan, fans, motor, blower", [
    { title: "Motor type", terms: "EC motor, AC motor, PSC, brushless, DC motor", kind: "choice" },
    { title: "Fan speeds", terms: "speeds, 3-speed, three speed, variable speed", kind: "value", dir: "higher" }]],
  ["Coil", "coil, coils, water coil", [
    { title: "Coil rows", terms: "rows, row coil", kind: "value", dir: "equal" },
    { title: "Water pressure drop", terms: "water pressure drop, water side pressure drop", kind: "value", unit: "kPa", dir: "lower" },
    { title: "Coil working pressure", terms: "working pressure, test pressure", kind: "value", unit: "kPa", dir: "higher" },
    { title: "Fin and tube material", terms: "copper, aluminium, fins, tubes", kind: "choice" }]],
  ["Drain pan", "drain pan, condensate pan", [
    { title: "Drain pan material", terms: "stainless steel, insulated, plastic, ABS, drain pan material", kind: "choice" }]],
  ["Filter", "filter, filters", [
    { title: "Filter class", terms: "filter class, MERV, G3, G4, ISO coarse, washable", kind: "class", scale: "G1, G2, G3, G4, M5, M6, F7", dir: "higher", eq: ["MERV 7 = G4", "MERV 8 = G4"] }]],
  ["Casing", "casing, cabinet", [
    { title: "Casing material", terms: "galvanised, galvanized, steel, insulated casing", kind: "choice" }]],
  ["Valves and controls", "valve, valves, thermostat, controller, controls", [
    { title: "Valve type", terms: "2-way, two way, 3-way, three way, PICV, on/off, modulating", kind: "choice" },
    { title: "Controls and BMS", terms: "thermostat, controller, BMS, BACnet, Modbus", kind: "choice" }]]
];

const CHILLER: C[] = [
  ["Unit", "chiller, chillers, unit", [
    { title: "Cooling capacity", terms: "cooling capacity, capacity, tons, TR", kind: "value", unit: "kW", dir: "higher" },
    { title: "Full-load efficiency", terms: "EER, COP, kW/TR, full load efficiency", kind: "value", dir: "higher", notes: "kW/TR runs the other way: lower is better." },
    { title: "Part-load efficiency", terms: "IPLV, NPLV, ESEER, SEER, part load", kind: "value", dir: "higher" },
    { title: "Condenser type", terms: "air cooled, water cooled", kind: "choice" },
    { title: "Sound level", terms: "sound pressure, sound power, noise, dB(A)", kind: "value", unit: "dB(A)", dir: "lower" },
    { title: "Certification", terms: "AHRI 550/590, AHRI 551/591, Eurovent, certified", kind: "standard" },
    { title: "Power supply", terms: "power supply, voltage, phase, Hz", kind: "choice" },
    { title: "Warranty period", terms: "warranty, guarantee", kind: "value", unit: "months", dir: "higher" }]],
  ["Compressor", "compressor, compressors", [
    { title: "Compressor type", terms: "screw, scroll, centrifugal, magnetic bearing, oil free, inverter", kind: "choice" },
    { title: "Number of circuits", terms: "circuits, refrigerant circuits, independent circuits", kind: "value", dir: "higher" },
    { title: "Starter type", terms: "star delta, soft starter, VFD, direct on line", kind: "choice" }]],
  ["Refrigerant", "refrigerant", [
    { title: "Refrigerant", terms: "R-134a, R134a, R-513A, R-1234ze, R-32, R-410A, low GWP", kind: "choice" }]],
  ["Evaporator", "evaporator, cooler, heat exchanger", [
    { title: "Evaporator type", terms: "shell and tube, flooded, DX, brazed plate", kind: "choice" },
    { title: "Water pressure drop", terms: "water pressure drop, evaporator pressure drop", kind: "value", unit: "kPa", dir: "lower" },
    { title: "Water side working pressure", terms: "working pressure, design pressure", kind: "value", unit: "kPa", dir: "higher" }]],
  ["Condenser", "condenser, condenser coil, microchannel", [
    { title: "Condenser coil", terms: "microchannel, copper fin, coated fins, aluminium", kind: "choice" },
    { title: "Condenser fans", terms: "EC fans, condenser fans, axial fans", kind: "choice" }]],
  ["Controls", "controller, controls, BMS, panel", [
    { title: "BMS protocol", terms: "BACnet, Modbus, LonWorks, BMS interface", kind: "choice" }]]
];

/* The facts the owner kept as AI notes for AHU Riyadh (moved to Maps on 19 Oct 2026), offered again in a Riyadh template,
   "to verify". */
const AHU_RIYADH_RAW: [string, string][] = [
  ["Filters", "Standard filters are G4 synthetic pre-filters and F7 final filters on aluminium slide-in racks; other grades to the project schedule; filter sections designed for 2 m/s face velocity."],
  ["Certification and testing", "AHUs are Eurovent certified; air performance measured to ISO 5801 and AMCA 210; health and safety certified to ISO 45001."],
  ["Delivery and packing", "Units are nylon wrapped and delivered on wooden crating; lifting holes are provided on the base frame of every module or mono-block unit."],
  ["Heat recovery wheels", "Heat recovery wheels are Eurovent certified, aluminium (non-combustible), molecular sieve 3 Å coating for enthalpy wheels, double bristle brush seals; wound wheels up to 2400 mm, segmented from 2500 mm."],
  ["Corrosion protection", "Outer and inner panels pass 1000 hours salt spray to ISO 9227 / ASTM B117; outer panel is corrosion-resistant precoated."],
  ["Warranty", "Warranty is 2 years from the date of system acceptance, within 6 months from equipment delivery."],
  ["Casing and insulation", "Double-wall casing, 62 mm panels with PU foam insulation; inner and outer skin precoated galvanised steel 1.0 mm; solid 1.2 mm galvanised floor plate; framework of extruded aluminium profiles 60x60 mm, min 2 mm thick; casing mechanical strength D1 to EN 1886 (Eurovent)."],
  ["Fire rating of insulation", "Foam insulation: surface spread of flame class 1 to ASTM E84 (FSI < 25, SDI < 250); fire resistance class 1 to BS 476 parts 6 and 7."],
  ["Access doors", "Hinged access doors, 450 to 800 mm wide depending on the section, with zinc die-cast / glass-fibre reinforced polyamide (PA6) handles operable from both sides and a safety latch."],
  ["Dampers", "Dampers have aluminium blades and frame with nylon bushings; leakage class 2 to EN 1751."],
  ["Fans and motors", "Fans are direct-driven EC plug fans (no belts, no separate VFD), EC external-rotor motors of IE4 / IE5 efficiency to IEC standards."]
];
const AHU_RIYADH_FACTS: Seed[] = AHU_RIYADH_RAW.map(([title, notes]) => ({ title, notes, off: true }));

export const FILL_IN = "Fill in what the factory offers";

function typeSeed(t: T, factory: string): Seed {
  const special = [`Terms: ${t.terms}`, `Kind: ${t.kind}`, ...(t.unit ? [`Unit: ${t.unit}`] : []), ...(t.dir ? [`Direction: ${t.dir}`] : []),
    ...(t.scale ? [`Scale: ${t.scale}`] : []), ...(t.tol ? [`Tolerance: ${t.tol}`] : [])];
  return { title: t.title, notes: t.notes || "", special, kids: [
    { title: `Offered (${factory})`, off: true,
      notes: `${FILL_IN} (${factory}): the value, class or standard; standard build, option or not offered; and the source (certificate, catalogue, datasheet). Then verify this branch: the AI may quote it from then on.` },
    ...(t.eq ? [{ title: "Equivalences", off: true, notes: "Equal on another scale or standard. An engineer checks them and verifies this branch.", special: t.eq }] : [])
  ] };
}

export function knowledgeSeed(product: string, factory: string): Seed[] {
  const p = product.toLowerCase();
  const comps = /\bahu\b|air handling/.test(p) ? AHU : /\bfcu\b|fan coil/.test(p) ? FCU : /chiller/.test(p) ? CHILLER : [];
  const facts = /\bahu\b|air handling/.test(p) && /riyadh|ksa|saudi/i.test(factory) ? AHU_RIYADH_FACTS : [];
  return [
    { title: "Product facts", notes: `What ${product} units made in ${factory} are, in sentences the AI may quote (title = the subject, notes = the fact). A fact "to verify" is not used: check it, edit it and verify it. Values that differ per project stay in the datasheet and Product Options.`,
      kids: facts },
    { title: "Vocabulary", notes: `The requirement types of ${product} specifications (the Shazam-like vocabulary): each branch under a component is one thing a clause can ask. Terms, Kind, Unit, Direction, Scale and Tolerance are read by code to recognise the clause (engineering knowledge, verified). Under each type, "Offered (${factory})" is what this factory offers: fill it in and verify it, then the AI may quote it. "Equivalences" (to verify) let code compare across scales once an engineer approves them. Add types and terms as specifications teach you new wording.`,
      kids: comps.map(([name, words, types]) => ({ title: name, notes: "", special: [`Terms: ${words}`], kids: types.map((t) => typeSeed(t, factory)) })) }
  ];
}
