/* Builds data/knowledge-imports/*.csv from the sources beside them.
   ============================================================================
     node _dev/build-imports.mjs

   Two imports:
     dictionary-ncert-words.csv   nodes for the Dictionary (English) map
     hvac-gulf-nodes.csv          nodes for the HVAC knowledge base map
     hvac-gulf-edges.csv          edges for the same map (import after nodes)

   The CSVs are exactly what /api/admin/import reads (Knowledge admin →
   Import CSV). Everything lands as DRAFT; nothing here approves anything. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'data/knowledge-imports');

const cell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (header, rows) =>
  '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/* ── 1. Dictionary ─────────────────────────────────────────────────────── */

const words = readFileSync(resolve(OUT, 'ncert-words.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const seen = new Set();
const dictRows = [];
for (const line of words) {
  const [title, kind, lane, forms, meaning, hindi, urdu, roman, use, source] = line.split('|').map((s) => s.trim());
  const key = title.toLowerCase();
  if (seen.has(key)) continue;            // one word, one node; the first chapter wins
  seen.add(key);
  const aliases = [...(forms ? forms.split(';') : []), hindi, urdu, roman]
    .map((s) => (s || '').trim()).filter(Boolean);
  const body = [
    `${hindi} · ${urdu} (${roman})`, '',
    '**In use**', '', `- ${use}`, '',
    `*From ${source}.*`
  ].join('\n');
  dictRows.push([kind, title, aliases.join('; '), meaning, body, lane, 'general', source]);
}
writeFileSync(resolve(OUT, 'dictionary-ncert-words.csv'),
  csv(['kind', 'title', 'aliases', 'summary', 'body', 'lane', 'scope', 'source_ref'], dictRows));

/* ── 2. HVAC — AHU, FCU, air-cooled chiller for UAE and KSA ────────────── */

const N = [];   // [kind, title, aliases, summary, body, lane, scope, source_ref]
const E = [];   // [from, to, relation, note]
const node = (kind, title, summary, opts = {}) => {
  N.push([kind, title, (opts.aliases || []).join('; '), summary, opts.body || '',
    opts.lane || 'equipment', opts.scope || 'general', opts.src || 'Manufacturer catalogues and Gulf specifications — verify against the current edition']);
  return title;
};
const under = (child, parent) => E.push([parent, child, 'under', '']);
const edge = (from, to, rel, note = '') => E.push([from, to, rel, note]);

/* The three products, as top-level lines of the outline. */
const AHU = node('equipment', 'Air handling unit (AHU)',
  'A factory-built cabinet that filters, cools, dehumidifies and moves air for a building or zone. In the Gulf it is nearly always chilled-water, double-skin, and specified against Eurovent and EN 1886.',
  { aliases: ['AHU', 'FAHU', 'fresh air handling unit', 'air handler'],
    body: 'What a UAE or KSA specification usually fixes: casing class to EN 1886 (D1/L1/T2/TB2 or better), Eurovent-certified performance, ePM1 filtration, coated coils, plug fans with VFD, and a design ambient of 46 °C (UAE) to 48–50 °C (KSA). A fresh-air unit (FAHU) adds heat recovery because Gulf outdoor air at 46 °C / high humidity is the dominant load.' });
const FCU = node('equipment', 'Fan coil unit (FCU)',
  'A small terminal unit — fan, chilled-water coil, filter and drain pan — serving one room or zone. Concealed ducted units dominate Gulf hotels, apartments and offices.',
  { aliases: ['FCU', 'fan coil', 'terminal unit'],
    body: 'Gulf specifications turn on: 2-pipe cooling-only (heating is rare), high external static for ducted units, EC motors for energy codes, Eurovent-certified capacity, insulated drain pans with auxiliary pan, and coils rated for district-cooling water temperatures where Empower or Tabreed supply the site.' });
const CH = node('equipment', 'Air-cooled chiller',
  'A packaged outdoor machine that makes chilled water using refrigerant compressors and air-cooled condenser coils — no cooling tower, no water treatment. The Gulf default below about 1,500 TR.',
  { aliases: ['air cooled chiller', 'ACCH', 'packaged chiller'],
    body: 'The Gulf changes everything about a chiller selection: capacity is quoted at 46 °C ambient (not the AHRI 35 °C), the unit must keep running at 50–52 °C, condenser coils must survive salt and sand, and the electrical supply differs between the UAE (50 Hz) and KSA (60 Hz). Part-load efficiency (IPLV / ESEER) decides energy-code compliance; full-load EER decides the tender comparison.',
    lane: 'refrigeration' });

/* ── AHU components ─────────────────────────────────────────────────── */
const comp = (parent, title, summary, body = '', lane = 'airside', aliases = []) => {
  node('component', title, summary, { body, lane, aliases });
  under(title, parent);
  edge(parent, title, 'contains');
  return title;
};
comp(AHU, 'AHU casing and panels', 'Double-skin sandwich panels, usually 50 mm, on a thermal-break frame. The casing class decides leakage, deflection and heat gain — all tested to EN 1886.',
  'Gulf norm: 50 mm panels, PU foam or 40–60 kg/m³ mineral wool, outer skin pre-painted galvanised (PPGI) or aluzinc, inner skin galvanised; thermal bridging class TB2 or better so the outside never sweats at 46 °C / 80 % RH. Hospitals ask for stainless inner skin and hygienic (VDI 6022) construction.');
comp(AHU, 'Thermal-break frame', 'The extruded aluminium or composite frame that stops heat conducting from the hot skin to the cold one. Without it, condensation forms on the outside of a Gulf AHU.',
  'EN 1886 thermal bridging class TB1–TB5; specifications ask for TB2 or TB1. Check the pentapost frame, not just the panel.');
comp(AHU, 'Supply fan', 'Moves the air. Modern Gulf AHUs use direct-driven plug (backward-curved) fans with a VFD or EC motor; belt-driven forward-curved fans are legacy.',
  'Performance to AMCA 210 / ISO 5801; motors IE3 minimum, IE4 common; fan arrays (multiple small plug fans) for redundancy in data halls and hospitals. Specific fan power (SFP) is what Dubai Green Building and ASHRAE 90.1 limit.');
comp(AHU, 'Return / exhaust fan', 'The second fan in a full AHU or heat-recovery FAHU, handling return or exhaust air. Same construction as the supply fan.');
comp(AHU, 'Chilled-water cooling coil', 'Copper tubes, aluminium fins, 6–8 rows in Gulf fresh-air units to take 46 °C / 80 % RH air down to 12–14 °C. Rated to AHRI 410.',
  'Face velocity 2.0–2.5 m/s keeps carry-over off the fins; fin spacing 8–12 fpi; 0.4–0.5 mm tube wall; hydrophilic or epoxy/e-coated fins where coastal. Entering/leaving water 6.7/12.2 °C on chillers, or 5.5/14.5 °C on district cooling — the coil is selected for the water the site actually has.',
  'waterside', ['cooling coil', 'CHW coil']);
comp(AHU, 'DX cooling coil', 'A direct-expansion coil for AHUs paired with VRV or condensing units instead of chilled water. Daikin sells this as a matched system.',
  'Multiple circuits (up to four) for capacity staging; refrigerant R-410A or R-32 — the R-32 AHU coils Daikin now offers across Compact, Modular and Professional ranges.',
  'refrigeration', ['direct expansion coil']);
comp(AHU, 'Heat-recovery section', 'A rotary wheel or plate exchanger that pre-cools incoming fresh air with the building\'s exhaust. The biggest single energy saver on a Gulf FAHU.',
  'Enthalpy (sorption) wheels recover latent heat too, which is where the Gulf load is; plate exchangers avoid cross-contamination for hospitals. Efficiency to EN 308; Daikin Modular P uses a counter-flow plate, Modular R a rotary wheel.',
  'airside', ['ERV', 'energy recovery', 'rotary wheel', 'plate heat exchanger']);
comp(AHU, 'Air filters', 'Pre-filter plus fine filter as standard; HEPA for hospitals and clean areas. Classes now follow ISO 16890 (ePM10, ePM2.5, ePM1), which replaced EN 779 G/M/F classes.',
  'Typical Gulf stack: ePM10 50 % (old G4) panel + ePM1 55–80 % (old F7–F9) bag or compact. Hospital: add H13/H14 HEPA to EN 1822. Sand and dust make filter pressure switches and generous filter face area non-negotiable.',
  'airside', ['pre-filter', 'bag filter', 'HEPA filter']);
comp(AHU, 'Dampers', 'Opposed-blade aluminium dampers on fresh, return and exhaust; motorised for economiser or mixing control.',
  'Leakage class to EN 1751 (class 3 or 4 specified); fire and smoke dampers in the ductwork answer to the Civil Defence, not to the AHU.');
comp(AHU, 'Drain pan', 'Collects condensate under the cooling coil. In the Gulf the coil is always wet, so the pan is sloped, insulated and stainless.',
  'Stainless steel 304, double-sloped to the drain, trapped drain sized for negative fan pressure. Corroded or flat pans are the most common cause of AHU water damage.');
comp(AHU, 'UV-C section', 'Germicidal lamps mounted downstream of the coil to keep the wet coil and drain pan biologically clean. Common in hospital and hospitality specifications.');
comp(AHU, 'Sound attenuator', 'Splitter silencers on supply or return to meet room NC levels. Often factory-fitted as an AHU section.');
comp(AHU, 'AHU control panel', 'The DDC controller, VFD and sensors — temperature, humidity, CO₂, filter DP — wired at the factory, talking BACnet or Modbus to the BMS.',
  'Daikin ships its AHUs with or without Daikin Digital Control (up to 310 I/O); a factory-tested panel removes the site commissioning risk that a loose-supplied panel brings.',
  'controls', ['DDC', 'AHU controller']);

/* ── AHU parameters ─────────────────────────────────────────────────── */
const param = (parent, title, summary, body = '', lane = 'airside', aliases = []) => {
  node('parameter', title, summary, { body, lane, aliases });
  under(title, parent);
  edge(parent, title, 'has_parameter');
  return title;
};
param(AHU, 'Airflow', 'The volume of air the unit moves, in m³/h or CFM. The first number on any schedule.', 'Daikin Professional reaches 144,000 m³/h; Modular P 20,000 m³/h; Compact L/T 3,450–4,200 m³/h.');
param(AHU, 'External static pressure (ESP)', 'The pressure the fan must overcome outside the unit — ductwork, diffusers, filters downstream. Wrong ESP is the most common reason an installed AHU under-delivers.', '', 'airside', ['ESP']);
param(AHU, 'Casing leakage class', 'EN 1886 class L1 (tightest) to L3 for air leakage through the casing at −400 Pa and +700 Pa. Gulf specifications call L1 or L2.', '', 'airside', ['L1', 'L2']);
param(AHU, 'Casing deflection class', 'EN 1886 class D1 to D3 for how far panels bow under pressure. D1 for hospitals and pressurised units.', '', 'airside', ['D1']);
param(AHU, 'Thermal transmittance class', 'EN 1886 class T1 to T5 for heat gain through the casing. T2 is the Gulf norm; T1 for very cold supply air.', '', 'airside', ['T2']);
param(AHU, 'Thermal bridging class', 'EN 1886 class TB1 to TB5. Decides whether the outside of the casing sweats in Gulf humidity. Ask for TB2 or better.', '', 'airside', ['TB2']);
param(AHU, 'Filter bypass leakage class', 'EN 1886 class F9 to F5 for air that sneaks around the filter frame. Matters more than filter class in a dusty climate.');
param(AHU, 'Specific fan power (SFP)', 'Fan power divided by airflow, W per l/s or kW per m³/s. Energy codes (ASHRAE 90.1, Dubai Green Building) cap it.', '', 'airside', ['SFP']);
param(AHU, 'Sound power level', 'Noise radiated to the duct and to the plant room, in dB(A) per octave band. Selected with the attenuator, not after it.', '', 'airside', ['Lw', 'sound power']);

/* ── FCU components ─────────────────────────────────────────────────── */
comp(FCU, 'FCU fan and motor', 'Forward-curved centrifugal blowers; EC (brushless DC) motors now, three-speed PSC motors before. EC is what makes an FCU pass an energy audit.',
  'EC motor: 0–10 V or Modbus speed control, 50–70 % less power than PSC at part speed. Daikin concealed units run four usable speeds with self-diagnosis.', 'airside', ['EC motor', 'blower']);
comp(FCU, 'FCU coil', 'Copper-tube, aluminium-fin coil of 3 or 4 rows; 4 rows where district cooling supplies 5.5 °C water at a high ΔT, or where humidity control matters.',
  'Rated to AHRI 440 / Eurovent at 45/55 °F (7/12 °C) entering/leaving water; a district-cooling site needs re-rating at its own temperatures, which most selection software can do.', 'waterside');
comp(FCU, 'FCU drain pan', 'Insulated pan under the coil, with an auxiliary pan under the valve set. The single most common FCU call-back in the Gulf is a leaking or sweating pan.',
  'Polypropylene or stainless, closed-cell insulation, sloped to the drain; condensate pump where gravity drain is impossible.');
comp(FCU, 'FCU filter', 'Washable nylon or aluminium mesh, G2–G3 class. Site dust means it is cleaned quarterly, so access is a design point.');
comp(FCU, 'FCU casing', 'Galvanised steel, 10–20 mm internal insulation, with hanging brackets. Concealed ducted units are the Gulf norm; cassette and exposed units for retail and lobbies.', '', 'airside', ['concealed ducted', 'cassette', 'exposed']);
comp(FCU, 'FCU control valve', 'Two-way on/off or modulating valve on the return, or a pressure-independent control valve (PICV) where the chilled-water system is variable-flow.',
  'Valveless units are offered where the valve is supplied separately; Daikin quotes both. PICVs are increasingly required by district-cooling providers to protect their ΔT.', 'waterside', ['PICV', '2-way valve']);
comp(FCU, 'FCU thermostat / controller', 'Room thermostat with fan speed and setpoint, wired or wireless; BMS-connected units carry a Modbus or BACnet controller.', '', 'controls');

/* ── FCU parameters ─────────────────────────────────────────────────── */
param(FCU, 'Cooling capacity (total and sensible)', 'Total capacity removes heat and moisture; sensible capacity is the part that lowers temperature. Gulf loads are latent-heavy, so both are checked.', '', 'waterside', ['sensible capacity', 'latent capacity']);
param(FCU, 'FCU external static pressure', 'What a ducted unit can push against. Standard 30–50 Pa; high-static 100–200 Pa for long duct runs in villas and hotel corridors.', '', 'airside', ['high static']);
param(FCU, 'Chilled-water entering / leaving temperature', 'The water the coil is rated at. Chiller sites: 6.7/12.2 °C (44/54 °F). District cooling: 5.5/14.5 °C or 5.5/16 °C, a much higher ΔT.', '', 'waterside', ['EWT', 'LWT', 'delta T']);
param(FCU, 'FCU sound level', 'NC or dB(A) at each fan speed, measured to ISO 3741. Bedrooms are usually held to NC 30–35 at medium speed.');
param(FCU, 'FCU power input', 'Watts drawn at each speed. EC units are compared on this line; PSC units lose.');

/* ── Chiller components ─────────────────────────────────────────────── */
comp(CH, 'Compressor', 'The heart of the chiller. Air-cooled Gulf units use scroll (tandem/trio) up to about 200 TR, screw — fixed-speed or inverter — from 150 to 600+ TR, and oil-free magnetic-bearing centrifugal in premium ranges.',
  'Inverter screw (Daikin EWAD-TZ, York YVAA) wins on part-load efficiency, which is how energy codes are met; fixed-speed screw wins on price. Scroll ranges (Daikin EWAT-B on R-32, York YLAA) cover the small end.', 'refrigeration', ['screw compressor', 'scroll compressor', 'inverter compressor']);
comp(CH, 'Air-cooled condenser coil', 'Rejects heat to the outside air. Microchannel aluminium (MCHE) or round-tube plate-fin copper/aluminium. Coastal and industrial sites need a protective coating.',
  'MCHE: less refrigerant, lighter, but harder to repair and needs a proven coating (e-coat) near the sea. RTPF with epoxy or Blygold coating is the conservative Gulf choice. Sand loading argues for wider fin spacing and hinged coil guards for cleaning.', 'refrigeration', ['MCHE', 'microchannel', 'condenser']);
comp(CH, 'Condenser fans', 'Axial fans, now EC or VFD-driven, that pull air across the condenser. Speed control is how the chiller holds head pressure at 20 °C and 50 °C alike.', '', 'refrigeration', ['EC fans']);
comp(CH, 'Evaporator', 'Where refrigerant chills the water: shell-and-tube (flooded, falling-film or DX) on screw units, brazed-plate on scroll units.',
  'Gulf specifications often ask for a fouling factor of 0.044 m²K/kW instead of the AHRI 0.0176, and for glycol only in process jobs; check the freeze protection logic when the plant sits idle in winter.', 'waterside', ['flooded evaporator', 'BPHE']);
comp(CH, 'Refrigerant', 'The working fluid. R-134a and its lower-GWP drop-in R-513A on screw units; R-410A giving way to R-32 or R-454B on scroll units; R-1234ze on some oil-free ranges.',
  'GWP is not yet regulated in the UAE or KSA the way the EU F-gas rule does, but Kigali ratification and green-building credits make low-GWP a tender advantage. Safety classification to ASHRAE 34: R-32 and R-454B are A2L (mildly flammable), which affects plant-room and roof siting.', 'refrigeration', ['R-134a', 'R-513A', 'R-32', 'R-410A', 'R-454B', 'R-1234ze']);
comp(CH, 'Electronic expansion valve', 'Meters refrigerant into the evaporator; electronic control is what allows stable operation across the Gulf ambient swing.', '', 'refrigeration', ['EXV']);
comp(CH, 'Chiller control panel', 'The unit controller (Daikin MicroTech, York Smart Connect / OptiView) with BACnet or Modbus to the BMS, plus VFDs, soft starters and phase protection.',
  'Ask for: remote setpoint, demand limit, run hours per compressor, refrigerant leak alarm, and a cloud link (Daikin on Site, JCI Connected) where the operator wants it.', 'controls', ['MicroTech', 'BMS interface']);
comp(CH, 'Integrated pump package', 'Factory-mounted chilled-water pumps, expansion tank and strainer on the chiller frame. Saves a plant room on small sites; check redundancy.', '', 'waterside', ['hydronic kit', 'pump kit']);
comp(CH, 'Sound attenuation package', 'Low-noise fans, compressor acoustic jackets, and night-mode fan limits. Needed wherever a chiller sits near residences.', '', 'refrigeration', ['low noise', 'acoustic jacket']);
comp(CH, 'High-ambient package', 'Larger condenser surface, uprated fans and motors, and control limits that keep the chiller online at 50–55 °C instead of tripping. Standard in KSA, common in UAE.', '', 'refrigeration', ['high ambient kit', '52 °C operation']);

/* ── Chiller parameters ─────────────────────────────────────────────── */
param(CH, 'Cooling capacity at design ambient', 'The capacity the chiller delivers at the site ambient — 46 °C in most UAE specs, 46–50 °C in KSA — not the 35 °C AHRI rating. A chiller loses roughly 20–25 % between the two.', '', 'refrigeration', ['TR', 'kW cooling']);
param(CH, 'Full-load EER / COP', 'Cooling output over electrical input at full load and design conditions. The number tenders compare; energy codes set minimums.', '', 'refrigeration', ['EER', 'COP']);
param(CH, 'Part-load efficiency (IPLV / ESEER)', 'A weighted average of efficiency at 100/75/50/25 % load. IPLV per AHRI 550/590, ESEER per Eurovent. This is where inverter and oil-free machines earn their price.', '', 'refrigeration', ['IPLV', 'ESEER', 'SEER']);
param(CH, 'Ambient operating range', 'The outdoor temperature band the chiller runs in — up to 52 °C or 55 °C with a high-ambient package, and down to the winter minimum with head-pressure control.', '', 'refrigeration', ['maximum ambient']);
param(CH, 'Chilled-water temperatures and ΔT', 'Leaving and entering water: 6.7/12.2 °C (44/54 °F) is the AHRI default; Gulf specifications use it or 5.5/12.2 °C; larger ΔT lowers pump energy.', '', 'waterside', ['LCHWT', 'ECHWT']);
param(CH, 'Power supply', 'UAE: 400 V, 3-phase, 50 Hz. KSA: 380 V, 3-phase, 60 Hz. The same model number is a different unit — motors, fans, VFDs and capacity all change with frequency.', '', 'controls', ['50 Hz', '60 Hz', 'voltage']);
param(CH, 'Chiller sound power', 'Sound power in dB(A) to ISO 9614 or ISO 3744, at full and part load. Night-time limits near residential plots are set by the municipality.');
param(CH, 'Minimum turndown', 'The lowest stable load the chiller can hold before cycling — 10–15 % on inverter screw and oil-free units, higher on scroll. Matters for hotels at 3 a.m.');

/* ── Standards ──────────────────────────────────────────────────────── */
const std = (title, summary, body, parents, aliases = []) => {
  node('standard', title, summary, { body, lane: 'reference', aliases });
  for (const p of parents) { under(title, p); edge(p, title, 'governed_by'); }
  return title;
};
std('EN 1886', 'The European test for AHU casings: mechanical strength (D), air leakage (L), filter bypass (F), thermal transmittance (T) and thermal bridging (TB) — each a class.',
  'The classes a Gulf specification quotes: D1 / L1 (or L2) / F9 / T2 / TB2. Eurovent-certified units publish these from third-party tests; unlisted units are claims.', [AHU]);
std('EN 13053', 'Rating and performance of AHUs and their components as a whole — how the numbers on the datasheet are to be measured.', 'The companion to EN 1886; together they are what "Eurovent AHU certified" means.', [AHU]);
std('Eurovent Certified Performance — AHU', 'Third-party certification of AHU casing classes and thermal/acoustic performance, with a public directory of certified ranges and software.',
  'Widely specified in UAE and KSA because it lets a consultant check a claim without a test. Daikin Professional and Systemair Geniox are certified ranges; confirm each model size on the Eurovent directory.', [AHU], ['Eurovent AHU']);
std('AHRI 410', 'US rating standard for forced-circulation air-cooling and heating coils. The coil capacity on an AHU or FCU datasheet is stated to it.', '', [AHU, FCU]);
std('AMCA 210 / ISO 5801', 'Laboratory methods for testing fans for aerodynamic performance. A fan curve is only a fan curve if it was taken to one of these.', 'AMCA-licensed fans carry the certified ratings seal; AMCA 300 covers sound.', [AHU], ['AMCA 210', 'ISO 5801']);
std('ISO 16890', 'The current filter classification by particle size (ePM1, ePM2.5, ePM10, coarse), which replaced EN 779 G/M/F classes in 2018.', 'Specifications still written as G4 + F7 translate to roughly ePM10 50 % + ePM1 55 %. Ask the filter maker for the ISO 16890 rating, not a conversion.', [AHU, FCU], ['EN 779', 'ePM1']);
std('EN 1822', 'Classification and testing of HEPA and ULPA filters (H13, H14, U15…). Required for operating theatres, isolation rooms, pharma and clean rooms.', '', [AHU], ['HEPA']);
std('EN 1751', 'Air-terminal and damper leakage classes. A specification asking for "class 3" or "class 4" dampers means this standard.', '', [AHU]);
std('EN 308', 'Test method for the effectiveness of air-to-air heat recovery devices — wheels, plates, run-around coils.', '', [AHU]);
std('ASHRAE 62.1', 'Ventilation for acceptable indoor air quality: the fresh-air rates most Gulf codes adopt, which size the FAHU.', 'Dubai and Abu Dhabi building regulations reference it; hospitals use ASHRAE 170 instead.', [AHU], ['ventilation rate']);
std('ASHRAE 90.1', 'The US energy standard for buildings, adopted or referenced by Gulf green-building regulations for fan power, chiller efficiency and economiser rules.', 'Chiller minimum efficiencies in Table 6.8.1 (path A / path B) are what Dubai and Estidama compliance tables are derived from.', [AHU, FCU, CH]);
std('ASHRAE 170', 'Ventilation of health-care facilities: air changes, filtration and pressure relationships for hospitals. Drives HEPA and 100 % fresh-air AHUs in Gulf hospitals.', '', [AHU]);
std('NFPA 90A', 'US fire-safety standard for air-conditioning and ventilating systems: smoke detectors, fire dampers, duct materials. Adopted by Gulf civil-defence codes.', 'The UAE Fire and Life Safety Code and Saudi Civil Defence both lean on it for duct smoke detection and damper placement.', [AHU]);
std('UL 1995 / EN 60335-2-40', 'Product safety standards for heating and cooling equipment (UL, US) and for electrical heat pumps, air conditioners and dehumidifiers (IEC/EN). A unit sold in the Gulf is listed to one or both.', '', [FCU, CH], ['UL 1995', 'EN 60335-2-40', 'IEC 60335-2-40']);
std('VDI 6022 / DIN 1946-4', 'German hygiene standards for AHUs (VDI 6022) and hospital ventilation (DIN 1946-4). "Hygienic AHU" in a Gulf hospital tender means built and certified to these.', '', [AHU], ['hygienic AHU']);
std('AHRI 440', 'US rating standard for room fan-coil units: capacity, airflow and power at 45/55 °F water. FCU datasheets quote it.', '', [FCU]);
std('Eurovent Certified Performance — Fan coil units', 'Third-party certification of fan-coil capacity, airflow, power and sound, tested to EN 1397. The Gulf consultant\'s check on an FCU claim.', 'Certified data is published for standard water temperatures; district-cooling temperatures need the manufacturer\'s software, which Eurovent also certifies.', [FCU], ['Eurovent FCU', 'EN 1397']);
std('ISO 3741', 'Determination of sound power in a reverberation room. FCU and small-unit sound data is taken to it.', '', [FCU]);
std('AHRI 550/590', 'US rating standard for water-chilling packages: full-load EER/kW per ton and IPLV at AHRI conditions (35 °C ambient, 44/54 °F water). The universal tender baseline; the Gulf then re-rates at 46 °C.', 'AHRI 551/591 is the SI version. "AHRI certified" means the manufacturer\'s selection software has passed the AHRI verification programme.', [CH], ['AHRI 550', 'AHRI 590', 'AHRI 551/591', 'IPLV']);
std('Eurovent Certified Performance — Chillers (LCP-HP)', 'Third-party certification of chiller capacity, EER, ESEER/SEER and sound, tested to EN 14511 and EN 14825 — and to SASO 2874 for KSA.',
  'Eurovent explicitly lists SASO 2874 among its chiller test standards, which is why a Eurovent-certified chiller is the smooth route to Saudi registration.', [CH], ['Eurovent chiller', 'EN 14511', 'EN 14825', 'ESEER']);
std('SASO 2874', 'Saudi standard for the minimum energy performance of large-capacity air conditioners, including chillers, above the SASO 2663 ceiling of 70,000 Btu/h. Registration on the Saudi Label & Standard (SLS) portal is required to ship.',
  'Enforced through SASO / SEEC; the energy label and registration are checked at customs. The unit must be tested at Saudi conditions and registered before the first shipment, so build the lead time into the project.', [CH], ['SASO 2874/2016', 'SLS', 'SEEC']);
std('SASO 2663', 'Saudi energy-efficiency standard for air conditioners up to 70,000 Btu/h (about 20 kW): minimum EER, now moving to a seasonal (SEER) rating. Covers small split and packaged units, not FCUs or chillers.', '', [CH], ['SASO 2663/2014']);
std('UAE.S 5010 (ESMA / MoIAT)', 'The UAE energy-efficiency standards and labels for air conditioners, enforced through the ECAS certificate of conformity by ESMA (now within MoIAT). Higher minimum EERs took effect 1 January 2021.',
  'Applies to packaged and split air conditioners placed on the UAE market; chillers and AHUs are handled through project specifications and the Dubai / Abu Dhabi green-building regulations rather than a consumer label. Verify the current part and edition with MoIAT.', [CH], ['ESMA', 'MoIAT', 'ECAS']);
std('ASHRAE 15 / ASHRAE 34', 'Refrigerant safety (15) and refrigerant designation and safety classification (34). Together they decide where an A2L refrigerant chiller may sit and what leak detection it needs.', '', [CH], ['ASHRAE 15', 'ASHRAE 34', 'A2L']);
std('ISO 9614 / ISO 3744', 'Sound-power determination by intensity (9614) or sound pressure in a free field (3744). Chiller sound data is taken to one of these; the number is not comparable across the two.', '', [CH]);
std('Dubai Green Building Regulations (Al Sa\'fat)', 'Dubai Municipality\'s mandatory green-building code: minimum chiller efficiencies at Dubai conditions, fan-power limits, ventilation and metering. Al Sa\'fat is the rating system layered on it.',
  'Chiller efficiency is checked at 46 °C ambient; expect a schedule that quotes both full-load and IPLV at that ambient. DEWA approval and Dubai Municipality NOC follow the same tables.', [AHU, FCU, CH], ['Al Safat', 'Dubai Municipality', 'DEWA']);
std('Estidama Pearl Rating System', 'Abu Dhabi\'s mandatory sustainability rating; Pearl 1 minimum for all buildings, Pearl 2 for government. Sets HVAC efficiency and commissioning requirements for the emirate.', '', [AHU, FCU, CH], ['Estidama', 'Pearl 1', 'Pearl 2']);
std('Saudi Building Code — SBC 501 / SBC 601', 'The Kingdom\'s mechanical code (SBC 501, based on the IMC) and energy-conservation code (SBC 601, based on the IECC), mandatory for permits since 2021.', 'SBC 601 chiller and fan-power minimums are what the Saudi consultant checks; Mostadam is the voluntary rating above them.', [AHU, FCU, CH], ['SBC 501', 'SBC 601', 'Mostadam']);
std('Saudi Aramco SAES-K series', 'Aramco\'s engineering standards for HVAC (SAES-K-001 and following), applied on Aramco and many Saudi industrial sites: 50 °C+ design ambient, corrosion protection, and vendor qualification.', '', [AHU, CH], ['SAES-K', 'Aramco']);

/* ── Manufacturer ranges (equipment, under the product) ─────────────── */
const range = (parent, title, summary, body, aliases = [], lane = 'equipment') => {
  node('equipment', title, summary, { body, lane, aliases, src: 'Manufacturer website / catalogue, 2025–26 — verify model, size range and certification against the current edition' });
  under(title, parent);
  return title;
};
range(AHU, 'Daikin D-AHU Professional', 'Daikin\'s customised AHU range: up to 144,000 m³/h, any dimension, with or without factory controls, chilled water or DX (VRV / ERA), R-32-compatible coils, hygienic and ATEX options.',
  'Sold across Daikin Middle East (Dubai, Riyadh); Eurovent-certified sizes; factory-fitted Daikin Digital Control with up to 310 I/O and BMS integration through Intelligent Touch Manager.', ['D-AHU Professional', 'Daikin Professional AHU']);
range(AHU, 'Daikin D-AHU Modular P / Modular R', 'Daikin\'s modular ventilation units: Modular P (counter-flow plate heat exchanger, up to 20,000 m³/h, 10 sizes) and Modular R (rotary heat-recovery wheel). Indoor or outdoor, DX or water coils, controls optional.',
  'The usual pick for a Gulf FAHU below 20,000 m³/h where heat recovery is required by the energy code.', ['Modular P', 'Modular R', 'D-AHU Modular']);
range(AHU, 'Daikin D-AHU Compact L / Compact T', 'Small factory-configured AHUs: Compact L ceiling-suspended (up to 3,450 m³/h) and Compact T floor-mounted top-discharge (up to 4,200 m³/h), six sizes, counter-flow heat exchanger up to 92 % efficient, DX (R-410A / R-32), water or electric coils.', '', ['Compact L', 'Compact T']);
range(AHU, 'York (Johnson Controls) custom air handling units', 'JCI\'s custom-built AHU offering for the Middle East, sold through Johnson Controls Arabia (KSA) and JCI UAE: double-skin, Eurovent-listed constructions, with York or third-party controls.',
  'Confirm the current range name and certified sizes with JCI Middle East; the Solution and Solution XT platforms are the North American names and are not always what the Gulf factory ships.', ['York AHU', 'JCI AHU', 'Johnson Controls AHU']);
range(AHU, 'Systemair Geniox', 'Systemair\'s modular AHU platform: Eurovent-certified, plug-fan and EC options, rotary and plate heat recovery, indoor and outdoor versions, supplied to the Gulf from European and regional factories.',
  'Systemair also lists the DV (Danvent) and Topvex compact ranges; Geniox is the one most often offered against Daikin Professional in UAE tenders.', ['Geniox', 'Systemair AHU', 'Danvent DV', 'Topvex']);
range(FCU, 'Daikin concealed ceiling fan coil units (DMEA range)', 'Daikin Middle East\'s ducted FCUs: high external static, four usable fan speeds, left/right piping, double-protection drainage, valve or valveless, wired or wireless controller, self-diagnosis, NIM-able.',
  'Selected in Daikin\'s FCU selection software at project water temperatures; Eurovent-certified data for the standard conditions.', ['Daikin FCU', 'Daikin fan coil']);
range(FCU, 'York (Johnson Controls) fan coil units', 'JCI\'s FCU range for the Gulf — concealed ducted, cassette and exposed — sold alongside York chillers to give a single-vendor hydronic system.', 'Confirm the current model designations and Eurovent listing with JCI Middle East.', ['York FCU', 'JCI FCU']);
range(FCU, 'Systemair fan coil units', 'Systemair\'s FCU range for the region, offered with EC motors and Eurovent-certified performance, usually packaged with Geniox AHUs and Systemair chillers.', 'Confirm the current range name with Systemair Middle East (Dubai).', ['Systemair FCU']);
range(CH, 'Daikin EWAD-TZ (inverter screw)', 'Daikin Applied Europe\'s air-cooled inverter-screw chiller, R-134a (R-513A option), roughly 170–2,100 kW, single-screw compressors with VFD, MCHE or coated coils, high-ambient versions. The Daikin flagship for Gulf projects needing part-load efficiency.',
  'Eurovent-certified; MicroTech controls; sold and supported by Daikin Middle East. Quote at 46 °C with the high-ambient option checked.', ['EWAD-TZ', 'Daikin inverter screw chiller'], 'refrigeration');
range(CH, 'Daikin EWAT-B (R-32 scroll)', 'Daikin\'s air-cooled scroll chiller on R-32, roughly 80–700 kW, with Eurovent certification and a low-GWP story for green-building credits. Covers the small and medium end of Gulf projects.',
  'A2L refrigerant: check siting and leak-detection requirements under ASHRAE 15 / EN 378 with the authority.', ['EWAT-B', 'Daikin R-32 chiller'], 'refrigeration');
range(CH, 'York YVAA (variable-speed screw)', 'Johnson Controls\' air-cooled variable-speed screw chiller, R-134a (R-513A option), about 150–600 TR, with high-ambient (HA) versions engineered for 52–55 °C operation. The York flagship in KSA and UAE.',
  'Built and supported through Johnson Controls Arabia for the Kingdom; aligned with SASO and SEEC requirements per JCI. Smart Connect / OptiView controls, BACnet/Modbus.', ['YVAA', 'York inverter screw chiller', 'YVAA-HA'], 'refrigeration');
range(CH, 'York YLAA (scroll)', 'JCI\'s air-cooled scroll chiller, roughly 40–200 TR, R-410A (moving to R-454B), the workhorse for small commercial buildings and villa compounds.', '', ['YLAA', 'York scroll chiller'], 'refrigeration');
range(CH, 'Systemair SYSCROLL Air / SYSCREW Air', 'Systemair\'s air-cooled chiller families from Systemair AC (Italy): SYSCROLL (scroll) and SYSCREW (screw), offered in the Gulf with high-ambient and coated-coil options.',
  'Confirm current model names, refrigerant and Eurovent listing with Systemair Middle East before quoting.', ['SYSCROLL', 'SYSCREW', 'Systemair chiller'], 'refrigeration');

/* ── The two markets, as top-level outline lines ────────────────────── */
const UAE = node('note', 'UAE market — what changes for AHU, FCU and chillers',
  'Power 400 V / 3 ph / 50 Hz; design ambient 46 °C; Dubai Green Building Regulations and Estidama set efficiency; Eurovent certification is the consultant\'s check; coastal corrosion and district cooling shape the selections.',
  { lane: 'reference', aliases: ['UAE', 'Dubai', 'Abu Dhabi', 'United Arab Emirates'],
    body: 'Authorities: Dubai Municipality (DM) and DEWA in Dubai; DMT and Estidama in Abu Dhabi; Trakhees in the free zones; Civil Defence for fire and smoke. Energy conformity for packaged AC through MoIAT/ECAS. District cooling (Empower, Tabreed, Emicool) supplies much of Dubai and Abu Dhabi, so FCU and AHU coils are often rated at 5.5 °C supply and a high ΔT, and PICVs are demanded to protect the provider\'s ΔT.' });
const KSA = node('note', 'KSA market — what changes for AHU, FCU and chillers',
  'Power 380 V / 3 ph / 60 Hz; design ambient 46–50 °C with 52–55 °C operation expected; SASO 2874 registration for chillers; SBC 501/601 for permits; dust and sand drive filtration and coil design.',
  { lane: 'reference', aliases: ['KSA', 'Saudi Arabia', 'Riyadh', 'Jeddah', 'Saudi'],
    body: '60 Hz is the first check on any Saudi enquiry: a 50 Hz selection is the wrong unit. Registration on the SASO SLS portal and the energy label must exist before shipment. Aramco, Ma\'aden and SABIC sites apply their own standards (SAES-K) above the code. Giga-projects (NEOM, Red Sea, Diriyah) add LEED / Mostadam targets and low-GWP refrigerant preferences.' });

const mk = (parent, title, summary, body = '') => {
  node('note', title, summary, { body, lane: 'reference' });
  under(title, parent);
};
mk(UAE, 'UAE electrical supply — 50 Hz', '400 V, 3-phase, 50 Hz (230 V single-phase). Fans, compressors and VFDs are 50 Hz builds; a 60 Hz KSA unit will not do.');
mk(UAE, 'UAE design ambient — 46 °C', 'ASHRAE 0.4 % design for Dubai is about 43.6 °C dry-bulb, but specifications quote 46 °C for chillers and condensing units, and expect operation to 50–52 °C without tripping.');
mk(UAE, 'Coastal corrosion protection', 'Dubai, Abu Dhabi and the northern emirates are salt-air sites: coated condenser coils (e-coat or Blygold), stainless hardware, and marine-grade paint on outdoor AHUs and chillers are standard clauses.');
mk(UAE, 'District cooling design temperatures', 'Empower / Tabreed / Emicool deliver 5.5 °C supply with a contracted return of 13.5–16 °C. Every FCU and AHU coil on the site is selected at those temperatures, and low-ΔT penalties push PICVs and 4-row coils.');
mk(UAE, 'Dubai Civil Defence — ducts, dampers and smoke', 'The UAE Fire and Life Safety Code governs fire/smoke dampers, duct smoke detectors and fan shutdown; the AHU must accept the DCD-required interlocks.');
mk(KSA, 'KSA electrical supply — 60 Hz', '380 V, 3-phase, 60 Hz (220 V single-phase). Motors run 20 % faster, fan curves shift, chiller capacity and power both change — every selection is re-run at 60 Hz.');
mk(KSA, 'KSA design ambient — 46 to 50 °C', 'Riyadh, Dammam and the Eastern Province specify 46–50 °C design with continuous operation to 52 °C or 55 °C; Jeddah adds humidity. High-ambient chiller packages are the norm, not the option.');
mk(KSA, 'SASO / SLS registration before shipment', 'Chillers and large AC fall under SASO 2874; small units under SASO 2663. The SLS registration and energy label are checked at customs — allow weeks in the programme.');
mk(KSA, 'Dust and sand', 'Sand-trap louvres on fresh-air intakes, generous filter face area, filter DP monitoring, wider condenser fin spacing and hinged coil guards for washing are Saudi standard practice.');
mk(KSA, 'Industrial owner standards — Aramco, SABIC, Ma\'aden', 'Owner engineering standards sit above the Saudi Building Code: SAES-K for Aramco HVAC, with vendor pre-qualification, 50 °C+ design and corrosion classes. Read them before the catalogue.');

/* ── cross-links between the products ──────────────────────────────── */
edge(CH, FCU, 'connected_to', 'Chilled water loop');
edge(CH, AHU, 'connected_to', 'Chilled water loop');

writeFileSync(resolve(OUT, 'hvac-gulf-nodes.csv'),
  csv(['kind', 'title', 'aliases', 'summary', 'body', 'lane', 'scope', 'source_ref'], N));
writeFileSync(resolve(OUT, 'hvac-gulf-edges.csv'),
  csv(['from', 'to', 'relation', 'note'], E));

console.log(`dictionary: ${dictRows.length} words · hvac: ${N.length} nodes, ${E.length} edges`);
