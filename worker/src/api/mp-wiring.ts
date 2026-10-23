/* Wiring maps (owner, 23 Oct 2026: "maps have great potential to show wiring diagrams and their notes for electrical
   connections"; then, the same day: "per product doesn't help. Imagine a complete project like a mall or an airport,
   only for AHU, chiller and FCU connections: main power input and connections going right up to the FCUs, in one map
   called Electricity, showing the flow of current; later the same for water").

   A wiring map is a map of kind knowledge with purpose 'wiring' (as a vocabulary map is purpose 'vocabulary'): the
   AI does not read it. Its branches are equipment, grouped in four columns (Supply by others | panel or electrical box |
   on the unit | site by others); its links between branches are wires, one of six wire kinds (MP_RELS "w-*") with their
   details: terminal at each end, cable, signal and who wires it (Daikin = factory wiring, others = site wiring).
   A branch with the special note "Layout: columns" shows its branches side by side (maps.js).

   The template is one building, supply to equipment, as a single-line diagram: a typical starting point, not a project's
   drawing: every branch comes in "to verify" until a person has checked it against the project's single-line diagram and
   renamed the panels and equipment. No figures that depend on the project (voltages, ratings, cable sizes) are written
   in. The map shows current flowing (maps.js): special note "Source: ..." marks where power comes from, "Switch: open"
   a branch that passes no power until it is closed (the generator incomer); power flows along Power wires, from end to
   end, through every branch that is not open. The BMS (owner, same day: "just do BMS for now"): the branch with the
   special note "Control: BMS" starts and stops the units its control wires reach; "Schedule: occupied" units stop at
   night; a stopped unit draws no current, so its power line stays energized without flow. */
import type { Env } from "../env";
import { uuid } from "../lib/sql";

export const WIRING_TEMPLATES = ["electricity"];
export const WIRING_NAMES: Record<string, string> = { electricity: "Electricity" };

export interface WNode { key: string; title: string; notes?: string; special?: string[]; kids?: WNode[] }
export interface Wire { from: string; to: string; rel: string; from_t?: string; to_t?: string; cable?: string; signal?: string; len?: string; by?: "daikin" | "others" }
export interface WiringSeed { guide: WNode; nodes: WNode[]; wires: Wire[] }

const COLS = "Layout: columns";
const SITE = "By the electrical design";
const OCC = "Schedule: occupied";

function guide(): WNode {
  return { key: "guide", title: "How this map works", notes:
    "The power supply of a building's HVAC equipment, as one map: from the utility supply and the standby generator, through the main switchboard, " +
    "sub-main boards and distribution boards, right up to the chillers, AHUs and FCUs. Open the diagram branch: its columns run from left to right, " +
    "Supply | Main distribution | Sub-distribution | Final distribution | HVAC equipment | Controls.\n\n" +
    "Current flow: moving dots run along every power line that has supply, from the source to the load. A grey line and a faded branch have no supply. " +
    "Click a panel or a piece of equipment: its card says where its power comes from, and Isolate / Reconnect tries what happens downstream " +
    "(a simulation in your browser only: nothing is saved, a reload starts again). The generator incomer starts open: isolate the utility supply, " +
    "close the generator incomer and see the building run on standby.\n\n" +
    "BMS: the BMS (Controls column) starts and stops each chiller, AHU and FCU circuit through its control wires and reads back the run status. " +
    "Click the BMS: Day / Night switches the schedule (units marked \"Schedule: occupied\" stop at night), Start all / Stop all; click a unit: BMS Start / Stop. " +
    "A running unit has a green dot; a stopped one draws no current, so the dots stop on its power line, and on the feeders above it when nothing they feed runs.\n\n" +
    "Special notes the map reads: \"Source: utility\" or \"Source: standby\" (power starts here), \"Switch: open\" (passes no power until closed), " +
    "\"Control: BMS\" (this branch commands the units its control wires reach), \"Schedule: occupied\" (stops at night). " +
    "Wires: Power carries the flow; Earth, Control supply, signals and buses can be added and are drawn but carry no flow.\n\n" +
    "Adding equipment: Edit, click the group (AHUs, FCUs, Chillers), press Tab and name the new branch. Then double-click it, Add link > Another branch: " +
    "Power to the board that feeds it, and a Communication bus or Digital wire to the BMS (a wire can be added from either end). " +
    "Adding a unit's own wiring diagram: click the unit, then in its card choose AHU with EC fans or DC motors, FCU with EC or DC motor, or Chiller, and Add: " +
    "the unit's panel, parts and wires come in under it, joined to its feeder and to the BMS. In this view the unit stays one line marked \"diagram ›\"; " +
    "click it to open its diagram, and the chips under it lead back to its board and the BMS.\n\n" +
    "This is a typical example, not the project's drawing: every branch is \"to verify\". Rename the boards and equipment as the project's single-line diagram, " +
    "add or delete branches, and fill each wire's cable and terminals (Edit, then the wire's Change). Cable schedule (above the map) gives every wire as an Excel list.",
    kids: [] };
}

function building(): { node: WNode; wires: Wire[] } {
  const node: WNode = { key: "b", title: "Power distribution to HVAC equipment", special: [COLS],
    notes: "Example: a mall with a central chiller plant, AHUs in plant rooms and FCUs on two levels. Replace the names with the project's.",
    kids: [
      { key: "sup", title: "Supply", notes: "Where power comes from.", kids: [
        { key: "mv", title: "Utility supply (MV)", special: ["Source: utility"], notes: "Medium-voltage supply from the utility, as the project's authority provides." },
        { key: "tr1", title: "Transformer TR-1 (MV/LV)", notes: "Steps the utility supply down to the building's low voltage." },
        { key: "g1", title: "Standby generator G-1", special: ["Source: standby"], notes: "Runs when the utility supply fails, for the loads the project keeps on standby." }] },
      { key: "main", title: "Main distribution", notes: "The main switchboard and its incomers.", kids: [
        { key: "q1", title: "Main incomer Q1 (utility)", notes: "Normally closed." },
        { key: "q2", title: "Generator incomer Q2", special: ["Switch: open"], notes: "Normally open: closes when the utility supply fails (automatic transfer or interlock), never together with Q1." },
        { key: "msb", title: "Main switchboard (MSB)", notes: "Busbar and outgoing feeders to the sub-main boards and MCCs." }] },
      { key: "sub", title: "Sub-distribution", notes: "Sub-main boards and motor control centres.", kids: [
        { key: "smdbch", title: "SMDB-CH, chiller plant room", notes: "Feeds the chillers." },
        { key: "mcc", title: "MCC-AHU, AHU plant rooms", notes: "Feeds the AHUs (or each AHU from its own isolator, as the project)." },
        { key: "smdb1", title: "SMDB-L1, Level 1", notes: "Feeds the distribution boards of Level 1." },
        { key: "smdb2", title: "SMDB-L2, Level 2", notes: "Feeds the distribution boards of Level 2." }] },
      { key: "fin", title: "Final distribution", notes: "Distribution boards with the final circuits to the FCUs.", kids: [
        { key: "db1a", title: "DB-L1-A, Level 1 zone A" },
        { key: "db1b", title: "DB-L1-B, Level 1 zone B" },
        { key: "db2a", title: "DB-L2-A, Level 2 zone A" }] },
      { key: "eq", title: "HVAC equipment", notes: "The loads: Daikin's scope of supply starts at each unit's isolator or terminals.", kids: [
        { key: "chg", title: "Chillers", kids: [
          { key: "ch1", title: "Chiller CH-1" }, { key: "ch2", title: "Chiller CH-2" }, { key: "ch3", title: "Chiller CH-3" }] },
        { key: "ahug", title: "AHUs", kids: [
          { key: "ahu1", title: "AHU-01, Level 1", special: [OCC] }, { key: "ahu2", title: "AHU-02, Level 1", special: [OCC] },
          { key: "ahu3", title: "AHU-03, Level 2", special: [OCC] }, { key: "ahu4", title: "AHU-04, Level 2", special: [OCC] }] },
        { key: "fcug", title: "FCUs", notes: "One final circuit feeds a group of FCUs, looped from unit to unit.", kids: [
          { key: "f1a1", title: "FCU circuit L1-A1 (FCU-L1-01 to 08)", special: [OCC] }, { key: "f1a2", title: "FCU circuit L1-A2 (FCU-L1-09 to 16)", special: [OCC] },
          { key: "f1b1", title: "FCU circuit L1-B1 (FCU-L1-17 to 24)", special: [OCC] },
          { key: "f2a1", title: "FCU circuit L2-A1 (FCU-L2-01 to 08)", special: [OCC] }, { key: "f2a2", title: "FCU circuit L2-A2 (FCU-L2-09 to 16)", special: [OCC] }] }] },
      { key: "ctl", title: "Controls", notes: "What commands the equipment.", kids: [
        { key: "bms", title: "BMS", special: ["Control: BMS"], notes: "Starts and stops each chiller, AHU and FCU circuit, reads back its run status, and runs the occupied / unoccupied schedule. By the controls contractor." }] }
    ] };
  const w = (from: string, to: string, signal: string, extra: Partial<Wire> = {}): Wire => ({ from, to, rel: "w-power", signal, cable: SITE, by: "others", ...extra });
  const wires: Wire[] = [
    w("mv", "tr1", "MV supply"),
    w("tr1", "q1", "LV 3Ph + N"), w("g1", "q2", "LV 3Ph + N"),
    w("q1", "msb", "LV 3Ph + N"), w("q2", "msb", "LV 3Ph + N"),
    w("msb", "smdbch", "Feeder 3Ph + N + PE"), w("msb", "mcc", "Feeder 3Ph + N + PE"), w("msb", "smdb1", "Feeder 3Ph + N + PE"), w("msb", "smdb2", "Feeder 3Ph + N + PE"),
    w("smdbch", "ch1", "3Ph + PE"), w("smdbch", "ch2", "3Ph + PE"), w("smdbch", "ch3", "3Ph + PE"),
    w("mcc", "ahu1", "3Ph + PE"), w("mcc", "ahu2", "3Ph + PE"), w("mcc", "ahu3", "3Ph + PE"), w("mcc", "ahu4", "3Ph + PE"),
    w("smdb1", "db1a", "Sub-main 3Ph + N + PE"), w("smdb1", "db1b", "Sub-main 3Ph + N + PE"), w("smdb2", "db2a", "Sub-main 3Ph + N + PE"),
    w("db1a", "f1a1", "Final circuit 1Ph + N + PE"), w("db1a", "f1a2", "Final circuit 1Ph + N + PE"), w("db1b", "f1b1", "Final circuit 1Ph + N + PE"),
    w("db2a", "f2a1", "Final circuit 1Ph + N + PE"), w("db2a", "f2a2", "Final circuit 1Ph + N + PE"),
    // the BMS: one control wire to each unit (12, the most a branch holds)
    ...["ch1", "ch2", "ch3"].map((k) => ({ from: "bms", to: k, rel: "w-bus", signal: "Enable / disable, run status (BACnet or Modbus)", cable: "As the protocol asks", by: "others" as const })),
    ...["ahu1", "ahu2", "ahu3", "ahu4"].map((k) => ({ from: "bms", to: k, rel: "w-digital", signal: "Start / stop, run status", by: "others" as const })),
    ...["f1a1", "f1a2", "f1b1", "f2a1", "f2a2"].map((k) => ({ from: "bms", to: k, rel: "w-bus", signal: "On / off through the room controllers", by: "others" as const }))
  ];
  return { node, wires };
}

export function wiringSeed(_template: string): WiringSeed {
  const b = building();
  return { guide: guide(), nodes: [b.node], wires: b.wires };
}

/* ---------- a product's own wiring diagram, under its equipment branch (owner, 23 Oct 2026: "can he add his
   product wiring diagrams to this map easily") ----------
   Added from the equipment's card (Add its wiring diagram): the equipment branch gets "Layout: columns" and the columns
   of its unit (panel or electrical box | on the unit | site by others), with a Power wire from the equipment branch to
   the unit's incoming isolator or terminal block, so the building's feeder flows on into the unit. The building's BMS
   stays the BMS: its wire reaches the equipment branch, so the unit's fans follow its start / stop and schedule. */
export const PRODUCT_TEMPLATES: Record<string, string> = {
  "ahu-ec": "AHU with EC fans", "ahu-dc": "AHU with DC motors and drives", "fcu-ec": "FCU with EC motor", "fcu-dc": "FCU with DC motor", "chiller": "Chiller field connections"
};
const DRAWING = "Fill the designations and terminal numbers from the factory wiring diagram of the unit, then mark the branch verified.";

function ahuUnit(ec: boolean): { kids: WNode[]; wires: Wire[]; entry: string; notes: string } {
  const kids: WNode[] = [
    { key: "pan", title: "Unit control panel", notes: "Factory-wired panel on the unit. " + DRAWING, kids: [
      { key: "q0", title: "Main isolator (Q0)", notes: "Lockable isolator for the whole unit; the building's feeder lands here." },
      { key: "pe", title: "Earth bar (PE)" },
      { key: "qf", title: ec ? "Fan circuit breakers (Q1, Q2)" : "Drive circuit breakers (Q1, Q2)" },
      ...(ec ? [] : [
        { key: "u1", title: "Supply fan drive (U1)", notes: "Drive of the supply fan's DC motor: supply in, motor out, speed reference and enable in, fault contact out." },
        { key: "u2", title: "Return fan drive (U2)", notes: "Drive of the return fan's DC motor." }]),
      { key: "t1", title: "Control transformer (T1)", notes: "Supplies the controls and actuators at 24 V AC." },
      { key: "a1", title: "Unit controller (A1)", notes: "With the factory controls package; it takes the BMS command at X2." },
      { key: "x2", title: "Field terminal strip (X2)", notes: "Where site wiring lands: BMS, fire alarm, valve." }] },
    { key: "unit", title: "On the unit", kids: [
      { key: "m1", title: ec ? "Supply EC fan (M1)" : "Supply fan DC motor (M1)", notes: ec ? "EC motor with integrated electronics." : "Fed by drive U1 (screened motor cable)." },
      { key: "m2", title: ec ? "Return EC fan (M2)" : "Return fan DC motor (M2)", notes: ec ? "EC motor with integrated electronics." : "Fed by drive U2." },
      { key: "b1", title: "Filter differential pressure switch (B1)", notes: "Volt-free contact: dirty filter." },
      { key: "b2", title: "Supply air temperature sensor (B2)" },
      { key: "y1", title: "Fresh air damper actuator (Y1)", notes: "24 V AC actuator." }] },
    { key: "site", title: "Site (by others)", kids: [
      { key: "fa", title: "Fire alarm panel (shutdown contact)", notes: "Volt-free contact that stops the unit on fire alarm." },
      { key: "vlv", title: "Chilled water valve actuator", notes: "Usually by the controls contractor; the controller gives the position signal." }] }];
  const s1 = ec ? "m1" : "u1", s2 = ec ? "m2" : "u2";
  const wires: Wire[] = [
    { from: "q0", to: "qf", rel: "w-power", by: "daikin" },
    { from: "qf", to: s1, rel: "w-power", to_t: "L1, L2, L3", by: "daikin" }, { from: "qf", to: s2, rel: "w-power", to_t: "L1, L2, L3", by: "daikin" },
    ...(ec ? [] : [{ from: "u1", to: "m1", rel: "w-power", from_t: "U, V, W", to_t: "U, V, W", cable: "Screened motor cable", by: "daikin" as const },
                   { from: "u2", to: "m2", rel: "w-power", from_t: "U, V, W", to_t: "U, V, W", cable: "Screened motor cable", by: "daikin" as const }]),
    { from: "pe", to: "m1", rel: "w-earth", to_t: "PE", by: "daikin" }, { from: "pe", to: "m2", rel: "w-earth", to_t: "PE", by: "daikin" },
    { from: "q0", to: "t1", rel: "w-power", signal: "Transformer primary", by: "daikin" },
    { from: "t1", to: "a1", rel: "w-control", signal: "24 V AC", by: "daikin" }, { from: "t1", to: "y1", rel: "w-control", signal: "24 V AC", by: "daikin" },
    { from: "a1", to: s1, rel: "w-analog", signal: "0–10 V DC speed", by: "daikin" }, { from: "a1", to: s2, rel: "w-analog", signal: "0–10 V DC speed", by: "daikin" },
    { from: s1, to: "a1", rel: "w-digital", signal: "Fault (relay contact)", by: "daikin" }, { from: s2, to: "a1", rel: "w-digital", signal: "Fault (relay contact)", by: "daikin" },
    { from: "b1", to: "a1", rel: "w-digital", signal: "Dirty filter (volt-free contact)", by: "daikin" },
    { from: "b2", to: "a1", rel: "w-analog", signal: "Temperature (sensor input)", by: "daikin" },
    { from: "a1", to: "y1", rel: "w-analog", signal: "0–10 V DC position", by: "daikin" },
    { from: "x2", to: "a1", rel: "w-digital", signal: "BMS start / stop, fire alarm stop", by: "daikin" },
    { from: "fa", to: "x2", rel: "w-digital", signal: "Fire alarm stop (volt-free contact)", by: "others" },
    { from: "a1", to: "x2", rel: "w-analog", signal: "0–10 V DC valve position", by: "daikin" },
    { from: "x2", to: "vlv", rel: "w-analog", signal: "0–10 V DC valve position", by: "others" }];
  return { kids, wires, entry: "q0", notes: ec ? "Fans with EC motors: the speed electronics are built into each motor." : "Fans with DC motors (permanent magnet / brushless), each run from its own drive in the panel." };
}
function fcuUnit(ec: boolean): { kids: WNode[]; wires: Wire[]; entry: string; notes: string } {
  const motor = ec ? "m1" : "a2";
  const kids: WNode[] = [
    { key: "box", title: "FCU electrical box", notes: "Factory-wired box on the unit. " + DRAWING, kids: [
      { key: "x1", title: "Terminal block (X1)", notes: "The final circuit from the distribution board lands here, looped on to the next FCU." },
      { key: "pe", title: "Earth terminal (PE)" },
      ...(ec ? [] : [{ key: "a2", title: "Motor driver board (A2)", notes: "Drives the DC motor: supply and speed signal in, motor out." }])] },
    { key: "unit", title: "On the unit", kids: [
      { key: "m1", title: ec ? "EC fan motor (M1)" : "DC fan motor (M1)", notes: ec ? "EC motor with integrated electronics." : "Fed by the driver board A2." },
      { key: "fs", title: "Condensate float switch (optional)", notes: "Volt-free contact: high condensate level." }] },
    { key: "site", title: "Site (by others)", kids: [
      { key: "rc", title: "Room controller / thermostat", notes: "Gives the fan speed signal and drives the valve; networked to the BMS." },
      { key: "vlv", title: "Chilled water valve actuator" }] }];
  const wires: Wire[] = [
    { from: "x1", to: motor, rel: "w-power", to_t: "L, N", by: "daikin" },
    ...(ec ? [] : [{ from: "a2", to: "m1", rel: "w-power", signal: "Motor supply from the driver board", by: "daikin" as const }]),
    { from: "pe", to: "m1", rel: "w-earth", to_t: "PE", by: "daikin" },
    { from: "rc", to: "x1", rel: "w-analog", signal: "0–10 V DC fan speed", by: "others" }, { from: "x1", to: motor, rel: "w-analog", signal: "0–10 V DC fan speed", by: "daikin" },
    { from: "fs", to: "x1", rel: "w-digital", signal: "Condensate alarm (volt-free contact)", by: "daikin" },
    { from: "rc", to: "vlv", rel: "w-control", signal: "Valve command (on / off or modulating)", by: "others" }];
  return { kids, wires, entry: "x1", notes: ec ? "EC motor: speed electronics built into the motor, 0–10 V DC speed signal." : "DC (brushless) motor run from a driver board in the electrical box." };
}
function chillerUnit(): { kids: WNode[]; wires: Wire[]; entry: string; notes: string } {
  const kids: WNode[] = [
    { key: "pan", title: "Chiller control panel", notes: "Factory-wired panel. " + DRAWING, kids: [
      { key: "q0", title: "Main isolator (Q0)", notes: "The building's feeder lands here." },
      { key: "pw", title: "Power section (compressor and fan circuits)" },
      { key: "a1", title: "Unit controller (A1)", notes: "Takes the BMS enable over its communication card." },
      { key: "xc", title: "Customer terminal strip (field connections)" }] },
    { key: "unit", title: "On the unit", kids: [{ key: "cp", title: "Compressors" }, { key: "cf", title: "Condenser fans", notes: "Air-cooled chillers only." }] },
    { key: "site", title: "Site (by others)", kids: [
      { key: "fl", title: "Chilled water flow switch", notes: "Proves water flow before the chiller starts." },
      { key: "pump", title: "Chilled water pump starter" },
      { key: "al", title: "Remote alarm indication" }] }];
  const wires: Wire[] = [
    { from: "q0", to: "pw", rel: "w-power", by: "daikin" }, { from: "pw", to: "cp", rel: "w-power", by: "daikin" }, { from: "pw", to: "cf", rel: "w-power", by: "daikin" },
    { from: "a1", to: "pw", rel: "w-control", signal: "Control circuit", by: "daikin" }, { from: "xc", to: "a1", rel: "w-digital", signal: "Field inputs and outputs", by: "daikin" },
    { from: "fl", to: "xc", rel: "w-digital", signal: "Flow proven (volt-free contact)", by: "others" },
    { from: "xc", to: "pump", rel: "w-digital", signal: "Pump command (volt-free contact)", by: "others" },
    { from: "xc", to: "al", rel: "w-digital", signal: "General alarm (volt-free contact)", by: "others" }];
  return { kids, wires, entry: "q0", notes: "The connections of the chiller to the site; the circuits inside the power section are on the factory diagram." };
}
export function productSeed(template: string): { kids: WNode[]; wires: Wire[]; entry: string; notes: string } {
  if (template === "ahu-ec" || template === "ahu-dc") return ahuUnit(template === "ahu-ec");
  if (template === "fcu-ec" || template === "fcu-dc") return fcuUnit(template === "fcu-ec");
  return chillerUnit();
}

/* The statements that add a product's diagram under an equipment branch (all "to verify"), and the equipment's own
   new links (its feeder flows on into the unit's entry: the incoming isolator or terminal block). */
export function productStatements(env: Env, mapId: string, equipment: { id: string; links: Record<string, string>[] }, template: string, userId: string, at: string, firstSort: number):
  { stmts: D1PreparedStatement[]; links: Record<string, string>[]; count: number } {
  const seed = productSeed(template);
  const ids = new Map<string, string>(), titles = new Map<string, string>();
  const walk = (n: WNode) => { ids.set(n.key, uuid()); titles.set(n.key, n.title); (n.kids || []).forEach(walk); };
  seed.kids.forEach(walk);
  const links = new Map<string, Record<string, string>[]>();
  for (const w of seed.wires) {
    const to = ids.get(w.to), from = ids.get(w.from);
    if (!to || !from) throw new Error(`product template ${template}: unknown branch ${!to ? w.to : w.from}`);
    const l: Record<string, string> = { kind: "node", node: to, map: mapId, label: titles.get(w.to)!, rel: w.rel };
    for (const k of ["from_t", "to_t", "cable", "signal", "len", "by"] as const) if (w[k]) l[k] = w[k] as string;
    const list = links.get(w.from) || []; list.push(l); links.set(w.from, list);
  }
  const stmts: D1PreparedStatement[] = [];
  let count = 0;
  const add = (n: WNode, parent: string, sort: number) => {
    count++;
    stmts.push(env.DB.prepare(`INSERT INTO mp_nodes (id, map_id, parent_id, title, notes, special, links, sort, verified, created_by, created_at, updated_by, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(ids.get(n.key)!, mapId, parent, n.title, n.notes || "", JSON.stringify(n.special || []), JSON.stringify(links.get(n.key) || []), sort, userId, at, userId, at));
    (n.kids || []).forEach((k, i) => add(k, ids.get(n.key)!, i));
  };
  seed.kids.forEach((k, i) => add(k, equipment.id, firstSort + i));
  const entry: Record<string, string> = { kind: "node", node: ids.get(seed.entry)!, map: mapId, label: titles.get(seed.entry)!, rel: "w-power", signal: "Incoming supply", by: "others" };
  return { stmts, links: [...equipment.links, entry], count };
}

/* The statements that put a template's branches and wires under the root of a new map. The guide is verified when
   the maker may verify; the diagram branches always wait "to verify" (they are typical, not the project's drawing).
   Shared by the wiring and the piping templates (mp-piping.ts): a wire and a pipe are both a link with details. */
export function seedStatements(env: Env, mapId: string, rootId: string, seed: WiringSeed, what: string, userId: string, at: string, mayVerify: boolean): D1PreparedStatement[] {
  const ids = new Map<string, string>(), titles = new Map<string, string>();
  const walk = (n: WNode) => { ids.set(n.key, uuid()); titles.set(n.key, n.title); (n.kids || []).forEach(walk); };
  walk(seed.guide); seed.nodes.forEach(walk);
  const links = new Map<string, Record<string, string>[]>();
  for (const w of seed.wires) {
    const to = ids.get(w.to), from = ids.get(w.from);
    if (!to || !from) throw new Error(`${what}: unknown branch ${!to ? w.to : w.from}`);
    const l: Record<string, string> = { kind: "node", node: to, map: mapId, label: titles.get(w.to)!, rel: w.rel };
    for (const k of ["from_t", "to_t", "cable", "signal", "len", "by"] as const) if (w[k]) l[k] = w[k] as string;
    const list = links.get(w.from) || []; list.push(l); links.set(w.from, list);
  }
  for (const [k, list] of links) if (list.length > 12) throw new Error(`${what}: ${k} has ${list.length} links (12 at most)`);
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
export function wiringStatements(env: Env, mapId: string, rootId: string, template: string, userId: string, at: string, mayVerify: boolean): D1PreparedStatement[] {
  return seedStatements(env, mapId, rootId, wiringSeed(template), `wiring template ${template}`, userId, at, mayVerify);
}
