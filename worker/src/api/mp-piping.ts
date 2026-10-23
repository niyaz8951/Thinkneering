/* Piping maps (owner, 23 Oct 2026: "can we create a map for water flow: water flowing to the chiller and from it to the
   AHUs and FCUs and back to the chiller; it needs to show water temperatures (as per input) and water flow rate").

   A piping map is a map of kind knowledge with purpose 'piping' (as a wiring map is purpose 'wiring'): the AI does not
   read it. Its branches are equipment, headers and pipe runs; its links between branches are pipes, Supply or Return
   (MP_RELS "p-*"), with the same details a wire has: the connection at each end (from_t, to_t), the pipe size (cable),
   a label (signal) and who installs it (by).

   The inputs are special notes, typed by people (maps.js and mp-water.js read them, the server only keeps them):
     "Source: chiller"        water starts here (a chiller, a heat exchanger, a district cooling ETS)
     "Leaving: 6.7 °C"        the water temperature leaving that branch (a source: supply set point; a unit: off its coil)
     "Flow: 12.5 l/s"         a unit's design water flow (l/s, m³/h or US gpm)
     "Load: 290 kW"           instead of Leaving: the unit's cooling load (kW or TR); the leaving temperature is computed
     "Design flow: 30 l/s"    a source's design flow (how the flow is shared between sources, and the check against it)
     "Valve: closed"          passes no water until it is opened;  "Pump: standby" a pump that does not run
   What the map computes (mp-water.js, in the browser): the flow in every pipe (the units' flows summed towards the
   sources), the supply temperature everywhere, the mixed return temperature, each unit's and each source's load
   (4.19 kW per l/s per K, water at about 10 °C) and the share of each source against its design flow.

   The template is one building as a typical chilled-water system: an example, not the project's drawing. Every branch
   comes in "to verify"; flows and temperatures are example figures to replace with the project's selections. */
import type { WiringSeed, WNode, Wire } from "./mp-wiring";

export const PIPING_TEMPLATES = ["chilled-water"];

function guide(): WNode {
  return { key: "guide", title: "How this map works", notes:
    "The chilled water of a building as one map: from the chillers through the supply headers and risers to the AHUs and FCUs, " +
    "and back through the return risers, the return header and the pumps to the chillers. Open the diagram branch: its columns run from left to right, " +
    "Chiller plant | Supply (CHWS) | Units | Return (CHWR).\n\n" +
    "What you type (special notes, or Flow and temperatures in a unit's card): a chiller has \"Source: chiller\", \"Leaving: 6.7 °C\" (its supply set point) " +
    "and \"Design flow: 30 l/s\"; each AHU or FCU group has \"Flow: 12 l/s\" and \"Leaving: 13 °C\" (the water leaving its coil), or \"Load: 290 kW\" instead of Leaving. " +
    "Flows in l/s, m³/h or US gpm; temperatures in °C or °F; loads in kW or TR.\n\n" +
    "What the map works out: the flow in every pipe (the units' flows added up towards the chillers), the supply temperature, the mixed return temperature " +
    "(each unit's leaving water weighted by its flow), each unit's load and each chiller's load: load = 4.19 kW per l/s per K (water at about 10 °C) × flow × (leaving − entering). " +
    "The flow is shared between the running chillers in proportion to their design flow; a chiller above its design flow is flagged.\n\n" +
    "Moving dots run along every pipe that has flow, faster where more water flows: Supply lines away from the chillers, Return lines back to them. " +
    "A grey line and a faded branch have no flow. Click a unit, a pump or a chiller: its card gives its figures, and Close valve / Stop pump / Stop chiller " +
    "tries what happens (a simulation in your browser only: nothing is saved, a reload starts again). P-3 starts on standby: stop P-1 and start P-3.\n\n" +
    "Special notes the map reads: \"Source: ...\", \"Leaving: ...\", \"Flow: ...\", \"Load: ...\", \"Design flow: ...\", \"Valve: closed\", \"Pump: standby\".\n\n" +
    "Adding a unit: Edit, click the group (AHUs, FCUs), press Tab and name it. Then double-click it, Add link > Another branch: Supply from the header or riser " +
    "that feeds it, and Return to the one it goes back to (a pipe can be added from either end). Give it its Flow and Leaving temperature in its card.\n\n" +
    "This is a typical example, not the project's drawing: every branch is \"to verify\" and the figures are examples. Rename the equipment as the project's " +
    "schematic, type the selections' flows and temperatures, and fill each pipe's size and connections (Edit, then the pipe's Change). " +
    "Pipe schedule (above the map) gives every pipe with its flow and temperature as an Excel list.",
    kids: [] };
}

const CH = (n: number): WNode => ({ key: "ch" + n, title: "Chiller CH-" + n, special: ["Source: chiller", "Leaving: 6.7 °C", "Design flow: 30 l/s"],
  notes: "Sends chilled water to the supply header at its set point. Replace the design flow and set point with the chiller's selection." });
const PUMP = (n: number, standby: boolean): WNode => ({ key: "p" + n, title: "Pump P-" + n + (standby ? " (standby)" : ""), special: [standby ? "Pump: standby" : "Pump: duty"],
  notes: standby ? "Standby pump: runs when a duty pump is stopped (start it in its card to try it)." : "Duty pump: takes water from the return header into its chiller (variable primary flow)." });
const UNIT = (key: string, title: string, flow: string, leaving: string, notes?: string): WNode => ({ key, title, special: ["Flow: " + flow, "Leaving: " + leaving], notes });

function building(): { node: WNode; wires: Wire[] } {
  const node: WNode = { key: "b", title: "Chilled water system", special: ["Layout: columns"],
    notes: "Example: a mall with three chillers (two duty, one standby), AHUs in plant rooms and FCU groups on two levels, variable primary flow. Replace the names and figures with the project's.",
    kids: [
      { key: "plant", title: "Chiller plant", notes: "Where the chilled water is made and pumped.", kids: [
        { key: "chg", title: "Chillers", kids: [CH(1), CH(2), CH(3)] },
        { key: "pg", title: "Pumps", notes: "One pump per chiller, on the return side.", kids: [PUMP(1, false), PUMP(2, false), PUMP(3, true)] }] },
      { key: "sup", title: "Supply (CHWS)", notes: "Chilled water supply: from the chillers to the units.", kids: [
        { key: "hs", title: "CHWS header, plant room", notes: "Collects the chillers' supply and sends it to the risers." },
        { key: "rs", title: "CHWS riser to AHU plant rooms" },
        { key: "sl1", title: "CHWS branch, Level 1" },
        { key: "sl2", title: "CHWS branch, Level 2" }] },
      { key: "units", title: "Units", notes: "The loads: each takes water at the supply temperature and sends it back warmer.", kids: [
        { key: "ahug", title: "AHUs", kids: [
          UNIT("ahu1", "AHU-01, Level 1", "12 l/s", "13.0 °C"), UNIT("ahu2", "AHU-02, Level 1", "12 l/s", "13.0 °C"),
          UNIT("ahu3", "AHU-03, Level 2", "9.5 l/s", "12.5 °C"), UNIT("ahu4", "AHU-04, Level 2", "9.5 l/s", "12.5 °C")] },
        { key: "fcug", title: "FCUs", notes: "One branch pipe feeds a group of FCUs; the group's flow is the sum of its FCUs.", kids: [
          UNIT("f1a1", "FCU group L1-A1 (FCU-L1-01 to 08)", "2 l/s", "12.0 °C"), UNIT("f1a2", "FCU group L1-A2 (FCU-L1-09 to 16)", "2 l/s", "12.0 °C"),
          UNIT("f1b1", "FCU group L1-B1 (FCU-L1-17 to 24)", "1.6 l/s", "12.0 °C"),
          UNIT("f2a1", "FCU group L2-A1 (FCU-L2-01 to 08)", "2 l/s", "12.0 °C"), UNIT("f2a2", "FCU group L2-A2 (FCU-L2-09 to 16)", "1.8 l/s", "12.0 °C")] }] },
      { key: "ret", title: "Return (CHWR)", notes: "Chilled water return: from the units back to the pumps and chillers.", kids: [
        { key: "rl1", title: "CHWR branch, Level 1" },
        { key: "rl2", title: "CHWR branch, Level 2" },
        { key: "rr", title: "CHWR riser from AHU plant rooms" },
        { key: "hr", title: "CHWR header, plant room", notes: "Collects the return water and sends it to the pumps." }] }
    ] };
  const pipe = (from: string, to: string, rel: "p-supply" | "p-return"): Wire => ({ from, to, rel, signal: rel === "p-supply" ? "CHWS" : "CHWR", by: "others" });
  const S = (from: string, to: string) => pipe(from, to, "p-supply"), R = (from: string, to: string) => pipe(from, to, "p-return");
  const wires: Wire[] = [
    S("ch1", "hs"), S("ch2", "hs"), S("ch3", "hs"),
    S("hs", "rs"), S("hs", "sl1"), S("hs", "sl2"),
    S("rs", "ahu1"), S("rs", "ahu2"), S("rs", "ahu3"), S("rs", "ahu4"),
    S("sl1", "f1a1"), S("sl1", "f1a2"), S("sl1", "f1b1"), S("sl2", "f2a1"), S("sl2", "f2a2"),
    R("ahu1", "rr"), R("ahu2", "rr"), R("ahu3", "rr"), R("ahu4", "rr"),
    R("f1a1", "rl1"), R("f1a2", "rl1"), R("f1b1", "rl1"), R("f2a1", "rl2"), R("f2a2", "rl2"),
    R("rr", "hr"), R("rl1", "hr"), R("rl2", "hr"),
    R("hr", "p1"), R("hr", "p2"), R("hr", "p3"),
    R("p1", "ch1"), R("p2", "ch2"), R("p3", "ch3")
  ];
  return { node, wires };
}

export function pipingSeed(_template: string): WiringSeed {
  const b = building();
  return { guide: guide(), nodes: [b.node], wires: b.wires };
}
