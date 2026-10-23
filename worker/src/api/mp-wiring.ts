/* Wiring maps (owner, 23 Oct 2026: "maps have great potential to show wiring diagrams and their notes for electrical
   connections ... a new map for wiring diagrams for AHU, FCU, chillers; AHU and FCU with EC and DC motors").

   A wiring map is a map of kind knowledge with purpose 'wiring' (as a vocabulary map is purpose 'vocabulary'): the
   AI does not read it. Its branches are equipment, grouped in four columns (Supply by others | panel or electrical box |
   on the unit | site by others); its links between branches are wires, one of six wire kinds (MP_RELS "w-*") with their
   details: terminal at each end, cable, signal and who wires it (Daikin = factory wiring, others = site wiring).
   A branch with the special note "Layout: columns" shows its branches side by side (maps.js).

   The templates below are a typical starting point, not a factory drawing: every branch comes in "to verify" until a
   person has checked it against the factory wiring diagram of the unit and filled the real designations and
   terminals. No figures that depend on the unit (supply voltage, cable size) are written in: those come from the
   unit's datasheet and the electrical design. */
import type { Env } from "../env";
import { uuid } from "../lib/sql";

export const WIRING_TEMPLATES = ["ahu", "fcu", "chiller"];
export const WIRING_NAMES: Record<string, string> = { ahu: "Wiring : AHU", fcu: "Wiring : FCU", chiller: "Wiring : Chiller" };

interface WNode { key: string; title: string; notes?: string; special?: string[]; kids?: WNode[] }
interface Wire { from: string; to: string; rel: string; from_t?: string; to_t?: string; cable?: string; signal?: string; by?: "daikin" | "others" }
export interface WiringSeed { guide: WNode; nodes: WNode[]; wires: Wire[] }

const COLS = "Layout: columns";
const DRAWING = "Fill the designations and terminal numbers from the factory wiring diagram of the unit, then mark the branch verified.";

function guide(product: string): WNode {
  return { key: "guide", title: "How this map works", notes:
    `The electrical connections of ${product} units, as a map. Each variant below shows its equipment in four columns: ` +
    "Supply (by others) | the unit's panel or electrical box | on the unit | Site (by others). Click a branch to see its notes; " +
    "the lines between branches are wires.\n\n" +
    "Wire kinds: Power (thick solid), Control supply (thin solid), Analog signal (dashed, arrow = direction), Digital / volt-free contact " +
    "(dash-dot, arrow = direction), Communication bus (dotted), Earth (green). Each wire carries its terminals, cable, signal and who wires it: " +
    "Daikin (factory wiring) or others (site wiring, In Contractor's Scope).\n\n" +
    "This is a typical starting point, not the factory drawing: every branch is \"to verify\". Check it against the factory wiring diagram, " +
    "fill the real designations and terminals (Edit, then a wire's Change), add a link to the drawing itself (Add link > A web address), " +
    "and mark it verified. Cable schedule (above the map) gives the wires as an Excel list for submittals.",
    kids: [] };
}

/* ---------- AHU ---------- */

function ahuVariant(p: string, motors: "ec" | "dc"): { node: WNode; wires: Wire[] } {
  const ec = motors === "ec";
  const node: WNode = { key: p, title: ec ? "AHU with EC fans" : "AHU with DC motors and drives", special: [COLS],
    notes: ec
      ? "Fans with EC motors: the speed electronics are built into each motor. The motor takes the supply directly and a 0–10 V DC speed signal; no separate drive."
      : "Fans with DC motors (permanent magnet / brushless) run from a separate drive in the panel, one per motor: the supply goes to the drive, the drive feeds the motor. The controller gives each drive its speed reference.",
    kids: [
      { key: p + "sup", title: "Supply (by others)", notes: "What the electrical contractor brings to the unit.", kids: [
        { key: p + "mains", title: "Mains supply, 3Ph + PE", notes: "From the building's distribution board or MCC. Voltage and frequency as the unit's datasheet states (Power Supply row). Cable size and upstream protection by the electrical contractor." }] },
      { key: p + "pan", title: "Unit control panel", notes: "Factory-wired panel on the unit. " + DRAWING, kids: [
        { key: p + "q0", title: "Main isolator (Q0)", notes: "Lockable isolator for the whole unit." },
        { key: p + "pe", title: "Earth bar (PE)" },
        { key: p + "qf", title: ec ? "Fan circuit breakers (Q1, Q2)" : "Drive circuit breakers (Q1, Q2)", notes: "One protective device per " + (ec ? "fan" : "drive") + "." },
        ...(ec ? [] : [
          { key: p + "u1", title: "Supply fan drive (U1)", notes: "Drive of the supply fan's DC motor. Takes the supply, a speed reference and an enable; gives a fault contact." },
          { key: p + "u2", title: "Return fan drive (U2)", notes: "Drive of the return fan's DC motor." }]),
        { key: p + "t1", title: "Control transformer (T1)", notes: "Supplies the controls and actuators at 24 V AC." },
        { key: p + "a1", title: "Unit controller (A1)", notes: "With the factory controls package. Without it, the controls contractor brings his own controller and its wires are his." },
        { key: p + "x2", title: "Field terminal strip (X2)", notes: "Where site wiring lands: BMS, fire alarm, valve. Everything beyond it is by others." }] },
      { key: p + "unit", title: "On the unit", kids: [
        { key: p + "m1", title: ec ? "Supply EC fan (M1)" : "Supply fan DC motor (M1)", notes: ec ? "EC motor with integrated electronics." : "Fed by drive U1. Motor cable as the drive maker asks (screened)." },
        { key: p + "m2", title: ec ? "Return EC fan (M2)" : "Return fan DC motor (M2)", notes: ec ? "EC motor with integrated electronics." : "Fed by drive U2." },
        { key: p + "b1", title: "Filter differential pressure switch (B1)", notes: "Volt-free contact: dirty filter." },
        { key: p + "b2", title: "Supply air temperature sensor (B2)" },
        { key: p + "y1", title: "Fresh air damper actuator (Y1)", notes: "24 V AC actuator, modulating or open / close." }] },
      { key: p + "site", title: "Site (by others)", notes: "Equipment and wiring outside Daikin's scope of supply.", kids: [
        { key: p + "bms", title: "BMS", notes: "BACnet MS/TP or Modbus RTU over RS-485, as the controller offers." },
        { key: p + "fa", title: "Fire alarm panel", notes: "Volt-free contact that stops the unit on fire alarm." },
        { key: p + "vlv", title: "Chilled water valve actuator", notes: "Usually supplied by the controls contractor; the controller gives the position signal." }] }
    ] };
  const s1 = ec ? p + "m1" : p + "u1", s2 = ec ? p + "m2" : p + "u2";
  const wires: Wire[] = [
    { from: p + "mains", to: p + "q0", rel: "w-power", signal: "Mains 3Ph", to_t: "L1, L2, L3", cable: "By the electrical design", by: "others" },
    { from: p + "mains", to: p + "pe", rel: "w-earth", to_t: "PE", by: "others" },
    { from: p + "q0", to: p + "qf", rel: "w-power", by: "daikin" },
    { from: p + "qf", to: s1, rel: "w-power", to_t: "L1, L2, L3", by: "daikin" },
    { from: p + "qf", to: s2, rel: "w-power", to_t: "L1, L2, L3", by: "daikin" },
    ...(ec ? [] : [
      { from: p + "u1", to: p + "m1", rel: "w-power", from_t: "U, V, W", to_t: "U, V, W", cable: "Screened motor cable", by: "daikin" as const },
      { from: p + "u2", to: p + "m2", rel: "w-power", from_t: "U, V, W", to_t: "U, V, W", cable: "Screened motor cable", by: "daikin" as const }]),
    { from: p + "pe", to: p + "m1", rel: "w-earth", to_t: "PE", by: "daikin" },
    { from: p + "pe", to: p + "m2", rel: "w-earth", to_t: "PE", by: "daikin" },
    { from: p + "q0", to: p + "t1", rel: "w-power", signal: "Transformer primary", by: "daikin" },
    { from: p + "t1", to: p + "a1", rel: "w-control", signal: "24 V AC", by: "daikin" },
    { from: p + "t1", to: p + "y1", rel: "w-control", signal: "24 V AC", by: "daikin" },
    { from: p + "a1", to: s1, rel: "w-analog", signal: "0–10 V DC speed", to_t: ec ? "Speed input" : "Speed reference", by: "daikin" },
    { from: p + "a1", to: s2, rel: "w-analog", signal: "0–10 V DC speed", to_t: ec ? "Speed input" : "Speed reference", by: "daikin" },
    { from: p + "a1", to: s1, rel: "w-digital", signal: "Enable", by: "daikin" },
    { from: s1, to: p + "a1", rel: "w-digital", signal: "Fault (relay contact)", by: "daikin" },
    { from: s2, to: p + "a1", rel: "w-digital", signal: "Fault (relay contact)", by: "daikin" },
    { from: p + "b1", to: p + "a1", rel: "w-digital", signal: "Dirty filter (volt-free contact)", by: "daikin" },
    { from: p + "b2", to: p + "a1", rel: "w-analog", signal: "Temperature (sensor input)", by: "daikin" },
    { from: p + "a1", to: p + "y1", rel: "w-analog", signal: "0–10 V DC position", by: "daikin" },
    { from: p + "x2", to: p + "a1", rel: "w-digital", signal: "Fire alarm stop", by: "daikin" },
    { from: p + "fa", to: p + "x2", rel: "w-digital", signal: "Fire alarm stop (volt-free contact)", by: "others" },
    { from: p + "bms", to: p + "x2", rel: "w-bus", signal: "BACnet MS/TP or Modbus RTU (RS-485)", cable: "Screened twisted pair", by: "others" },
    { from: p + "x2", to: p + "a1", rel: "w-bus", signal: "BACnet MS/TP or Modbus RTU (RS-485)", by: "daikin" },
    { from: p + "a1", to: p + "x2", rel: "w-analog", signal: "0–10 V DC valve position", by: "daikin" },
    { from: p + "x2", to: p + "vlv", rel: "w-analog", signal: "0–10 V DC valve position", by: "others" }
  ];
  return { node, wires };
}

/* ---------- FCU ---------- */

function fcuVariant(p: string, motors: "ec" | "dc"): { node: WNode; wires: Wire[] } {
  const ec = motors === "ec";
  const motor = ec ? p + "m1" : p + "a2";
  const node: WNode = { key: p, title: ec ? "FCU with EC motor" : "FCU with DC motor", special: [COLS],
    notes: ec
      ? "EC motor: the speed electronics are built into the motor. It takes the supply and a 0–10 V DC speed signal from the room controller."
      : "DC motor (brushless): driven by a driver board in the FCU's electrical box. The supply goes to the board, the board feeds the motor; the room controller gives the board its speed signal.",
    kids: [
      { key: p + "sup", title: "Supply (by others)", notes: "What the electrical contractor brings to the unit, with its local isolator.", kids: [
        { key: p + "mains", title: "Mains supply, 1Ph + N + PE", notes: "Voltage and frequency as the unit's datasheet states (Power Source row). Cable, isolator and upstream protection by the electrical contractor." }] },
      { key: p + "box", title: "FCU electrical box", notes: "Factory-wired box on the unit. " + DRAWING, kids: [
        { key: p + "x1", title: "Terminal block (X1)", notes: "Where the supply and the site wiring land." },
        { key: p + "pe", title: "Earth terminal (PE)" },
        ...(ec ? [] : [{ key: p + "a2", title: "Motor driver board (A2)", notes: "Drives the DC motor: takes the supply and the speed signal, feeds the motor." }])] },
      { key: p + "unit", title: "On the unit", kids: [
        { key: p + "m1", title: ec ? "EC fan motor (M1)" : "DC fan motor (M1)", notes: ec ? "EC motor with integrated electronics." : "Fed by the driver board A2." },
        { key: p + "fs", title: "Condensate float switch (optional)", notes: "Volt-free contact: high condensate level." }] },
      { key: p + "site", title: "Site (by others)", notes: "Equipment and wiring outside Daikin's scope of supply.", kids: [
        { key: p + "rc", title: "Room controller / thermostat", notes: "Gives the fan speed signal and drives the valve. Supplied by others unless the order includes it." },
        { key: p + "vlv", title: "Chilled water valve actuator", notes: "On / off or modulating, voltage as the actuator's maker states." },
        { key: p + "bms", title: "BMS", notes: "Through the room controller: Modbus RTU or BACnet, as the controller offers." }] }
    ] };
  const wires: Wire[] = [
    { from: p + "mains", to: p + "x1", rel: "w-power", signal: "Mains 1Ph", to_t: "L, N", cable: "By the electrical design", by: "others" },
    { from: p + "mains", to: p + "pe", rel: "w-earth", to_t: "PE", by: "others" },
    { from: p + "x1", to: motor, rel: "w-power", to_t: "L, N", by: "daikin" },
    ...(ec ? [] : [{ from: p + "a2", to: p + "m1", rel: "w-power", signal: "Motor supply from the driver board", by: "daikin" as const }]),
    { from: p + "pe", to: p + "m1", rel: "w-earth", to_t: "PE", by: "daikin" },
    { from: p + "rc", to: p + "x1", rel: "w-analog", signal: "0–10 V DC fan speed", by: "others" },
    { from: p + "x1", to: motor, rel: "w-analog", signal: "0–10 V DC fan speed", by: "daikin" },
    { from: p + "fs", to: p + "x1", rel: "w-digital", signal: "Condensate alarm (volt-free contact)", by: "daikin" },
    { from: p + "x1", to: p + "rc", rel: "w-digital", signal: "Condensate alarm (volt-free contact)", by: "others" },
    { from: p + "rc", to: p + "vlv", rel: "w-control", signal: "Valve command (on / off or modulating)", by: "others" },
    { from: p + "bms", to: p + "rc", rel: "w-bus", signal: "Modbus RTU or BACnet", cable: "Screened twisted pair", by: "others" }
  ];
  return { node, wires };
}

/* ---------- Chiller ---------- */

function chiller(): { node: WNode; wires: Wire[] } {
  const p = "ch";
  const node: WNode = { key: p, title: "Chiller field connections (typical)", special: [COLS],
    notes: "The connections between a chiller and the site: supply, the interlocks the chiller needs (water flow proven, pump command) and what it offers to the BMS. Inside the panel only the main blocks are shown; the compressor and fan circuits are on the factory diagram.",
    kids: [
      { key: p + "sup", title: "Supply (by others)", kids: [
        { key: p + "mains", title: "Main supply, 3Ph + PE", notes: "Voltage and frequency as the chiller's datasheet states. Cable size and upstream protection by the electrical contractor." }] },
      { key: p + "pan", title: "Chiller control panel", notes: "Factory-wired panel. " + DRAWING, kids: [
        { key: p + "q0", title: "Main isolator (Q0)" },
        { key: p + "pe", title: "Earth bar (PE)" },
        { key: p + "pw", title: "Power section (compressor and fan circuits)" },
        { key: p + "a1", title: "Unit controller (A1)" },
        { key: p + "xc", title: "Customer terminal strip (field connections)", notes: "Where the site wiring lands: interlocks, remote commands, alarms, analog inputs." }] },
      { key: p + "unit", title: "On the unit", kids: [
        { key: p + "cp", title: "Compressors" },
        { key: p + "cf", title: "Condenser fans", notes: "Air-cooled chillers only." }] },
      { key: p + "site", title: "Site (by others)", notes: "Equipment and wiring outside Daikin's scope of supply.", kids: [
        { key: p + "fl", title: "Chilled water flow switch", notes: "Proves water flow before the chiller starts. Supplied with the chiller or by others, as the order says; mounted and wired at site." },
        { key: p + "pump", title: "Chilled water pump starter", notes: "The chiller's pump command starts it." },
        { key: p + "ro", title: "Remote on / off" },
        { key: p + "al", title: "Remote alarm indication" },
        { key: p + "dl", title: "Demand limit / set point reset signal", notes: "Analog input, where the controller offers it." },
        { key: p + "bms", title: "BMS", notes: "Modbus RTU, BACnet or other, as the controller and its communication card offer." }] }
    ] };
  const wires: Wire[] = [
    { from: p + "mains", to: p + "q0", rel: "w-power", signal: "Mains 3Ph", to_t: "L1, L2, L3", cable: "By the electrical design", by: "others" },
    { from: p + "mains", to: p + "pe", rel: "w-earth", to_t: "PE", by: "others" },
    { from: p + "q0", to: p + "pw", rel: "w-power", by: "daikin" },
    { from: p + "pw", to: p + "cp", rel: "w-power", by: "daikin" },
    { from: p + "pw", to: p + "cf", rel: "w-power", by: "daikin" },
    { from: p + "a1", to: p + "pw", rel: "w-control", signal: "Control circuit", by: "daikin" },
    { from: p + "xc", to: p + "a1", rel: "w-digital", signal: "Field inputs and outputs", by: "daikin" },
    { from: p + "fl", to: p + "xc", rel: "w-digital", signal: "Flow proven (volt-free contact)", by: "others" },
    { from: p + "xc", to: p + "pump", rel: "w-digital", signal: "Pump command (volt-free contact)", by: "others" },
    { from: p + "ro", to: p + "xc", rel: "w-digital", signal: "Remote on / off (volt-free contact)", by: "others" },
    { from: p + "xc", to: p + "al", rel: "w-digital", signal: "General alarm (volt-free contact)", by: "others" },
    { from: p + "dl", to: p + "xc", rel: "w-analog", signal: "4–20 mA or 0–10 V DC", by: "others" },
    { from: p + "bms", to: p + "a1", rel: "w-bus", signal: "Modbus RTU / BACnet", cable: "As the protocol asks", by: "others" }
  ];
  return { node, wires };
}

export function wiringSeed(template: string): WiringSeed {
  if (template === "ahu") { const a = ahuVariant("ec-", "ec"), b = ahuVariant("dc-", "dc"); return { guide: guide("air handling"), nodes: [a.node, b.node], wires: [...a.wires, ...b.wires] }; }
  if (template === "fcu") { const a = fcuVariant("ec-", "ec"), b = fcuVariant("dc-", "dc"); return { guide: guide("fan coil"), nodes: [a.node, b.node], wires: [...a.wires, ...b.wires] }; }
  const c = chiller();
  return { guide: guide("chiller"), nodes: [c.node], wires: c.wires };
}

/* The statements that put a template's branches and wires under the root of a new map. The guide is verified when
   the maker may verify; the diagram branches always wait "to verify" (they are typical, not the factory drawing). */
export function wiringStatements(env: Env, mapId: string, rootId: string, template: string, userId: string, at: string, mayVerify: boolean): D1PreparedStatement[] {
  const seed = wiringSeed(template);
  const ids = new Map<string, string>(), titles = new Map<string, string>();
  const walk = (n: WNode) => { ids.set(n.key, uuid()); titles.set(n.key, n.title); (n.kids || []).forEach(walk); };
  walk(seed.guide); seed.nodes.forEach(walk);
  const links = new Map<string, Record<string, string>[]>();
  for (const w of seed.wires) {
    const to = ids.get(w.to), from = ids.get(w.from);
    if (!to || !from) throw new Error(`wiring template ${template}: unknown branch ${!to ? w.to : w.from}`);
    const l: Record<string, string> = { kind: "node", node: to, map: mapId, label: titles.get(w.to)!, rel: w.rel };
    for (const k of ["from_t", "to_t", "cable", "signal", "by"] as const) if (w[k]) l[k] = w[k] as string;
    const list = links.get(w.from) || []; list.push(l); links.set(w.from, list);
  }
  for (const [k, list] of links) if (list.length > 12) throw new Error(`wiring template ${template}: ${k} has ${list.length} wires (12 at most)`);
  const stmts: D1PreparedStatement[] = [];
  const add = (n: WNode, parent: string, sort: number, verified: boolean) => {
    const id = ids.get(n.key)!;
    stmts.push(env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, links, sort, verified, verified_by, verified_at, created_by, created_at, updated_by, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, mapId, parent, n.title, n.notes || "", JSON.stringify(n.special || []), JSON.stringify(links.get(n.key) || []), sort, verified ? 1 : 0,
            verified ? userId : null, verified ? at : null, userId, at, userId, at));
    (n.kids || []).forEach((k, i) => add(k, id, i, verified));
  };
  add(seed.guide, rootId, 0, mayVerify);
  seed.nodes.forEach((n, i) => add(n, rootId, i + 1, false));
  return stmts;
}
