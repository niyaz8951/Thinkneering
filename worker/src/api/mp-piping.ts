/* Piping maps (owner, 23 Oct 2026: "can we create a map for water flow: water flowing to the chiller and from it to the
   AHUs and FCUs and back to the chiller; it needs to show water temperatures (as per input) and water flow rate"; later
   the same day: "a 2D view like the picture of a typical chilled water system, all its components in the sample, defined
   water flow, and the ability to decide water flow and pressure and see what is available at the last component").

   A piping map is a map of kind knowledge with purpose 'piping' (as a wiring map is purpose 'wiring'): the AI does not
   read it. Its branches are equipment, headers and pipe runs; its links are pipes of two circuits (MP_RELS "p-*"):
   chilled water supply / return (p-supply, p-return) and condenser water supply / return (p-cw-supply, p-cw-return), with
   a wire's fields in pipe words: connection at each end (from_t, to_t), pipe size (cable), label (signal), length (len)
   and who installs it (by). What the special notes mean and what the map works out: public/tools/maps/mp-water.js.
   Where each branch is drawn in the 2D view: its special note "Place: x, y" (headers "Place: x, y, w, h").

   The template is one building's water-cooled chilled water plant, as the owner's picture (cooling towers, condenser
   water pumps, chillers, chilled water pumps, air separator, expansion tank, AHUs, FCUs) laid out as a mall: an example,
   not the project's drawing. Every branch comes in "to verify"; flows, temperatures, pressure drops, pipe sizes and
   lengths are typical figures to replace with the project's selections. Engineering choices, checked:
   - variable primary chilled water: one pump per chiller on the return side, pumping into the evaporator; 2-way control
     valves at the units (each unit's "Pressure drop" is its coil and control valve at design flow);
   - air separator on the return before the pumps, expansion tank on the pumps' suction header (the point of no pressure
     change), fill pressure = static height of the highest unit + 0.5 bar;
   - condenser water is an open circuit: the pumps draw from the towers' basins and push into the condensers, the
     towers' static lift (basin to nozzles) is part of the pump head, no expansion tank;
   - Gulf design temperatures: chilled water 6.7 °C out, back about 12.5 to 13 °C; condenser water 32 °C from the towers,
     about 37 °C back (AHRI 550/590 rates at 29.4 / 35 °C); heat rejected = cooling load × (1 + 1 / COP);
   - pipes sized for about 1 to 2 m/s and under 400 Pa/m. */
import type { WiringSeed, WNode, Wire } from "./mp-wiring";

export const PIPING_TEMPLATES = ["chilled-water"];

function guide(): WNode {
  return { key: "guide", title: "How this map works", notes:
    "A building's chilled water plant as one map, as a typical schematic: cooling towers, condenser water pumps and the chillers' condensers " +
    "(condenser water, open circuit), the chillers' evaporators, chilled water pumps, air separator and expansion tank (chilled water, closed circuit), " +
    "the supply headers, risers and branches, the AHUs and FCU groups, and the return back to the pumps. Choose 2D view (above the map) to see it drawn " +
    "as a schematic. On the map the branches are Condenser water | Chiller plant | Supply (CHWS) | Return (CHWR), and each AHU and FCU group sits under " +
    "the riser or branch pipe that feeds it (that supply pipe runs along the branch line).\n\n" +
    "What you type (special notes, or the boxes of a unit's, chiller's or pump's card): chillers \"Source: chiller\", \"Leaving: 6.7 °C\", \"Design flow: 30 l/s\", " +
    "\"Pressure drop\" (evaporator), \"Condenser flow\", \"Condenser pressure drop\", \"COP\"; cooling towers \"Source: cooling tower\", \"Leaving: 32 °C\", " +
    "\"Design flow\", \"Static lift\" (basin to nozzles) and \"Pressure drop\" (nozzles); units \"Flow\", \"Leaving\" (or \"Load\") and \"Pressure drop\" " +
    "(coil and control valve at design flow); pumps \"Pump head\", \"Pump flow\", \"Pressure drop\" (strainer, check and isolating valves), \"Speed\"; " +
    "the expansion tank \"Fill pressure\"; any branch \"Height\" above the plant room. Pipes: size (DN or inches) and length in the pipe's Change sheet.\n\n" +
    "What the map works out: the flow in every pipe, the supply and mixed return temperatures, each unit's, chiller's and tower's load " +
    "(4.19 kW per l/s per K × flow × ΔT; a chiller rejects its load × (1 + 1/COP) to the condenser water), each pipe's pressure drop " +
    "(Darcy-Weisbach, steel, water at 10 °C, + 30 % for fittings), each pump's operating point on its curve (shut-off head 120 % of the design head), " +
    "and the pressure every unit has between its supply and return: what it needs is taken by its coil, the rest by its control valve. " +
    "A unit with less than it needs gets less water (marked \"short of pressure\"). With the expansion tank's fill pressure and the heights, " +
    "every branch has its pressure in bar; under 0.3 bar is flagged (air gets in at high points).\n\n" +
    "Try it: lower a pump's head in its card and see the last unit go short; stop P-1 and start P-3; close an AHU's valve. " +
    "Limits: a chiller's \"Capacity\" (and a tower's) is the most it can do: over it, it runs at capacity and its leaving water rises (stop CH-2: CH-1 takes the whole load " +
    "and the supply goes warmer, drawn in amber); a header's, riser's or pipe run's \"Max flow\" (its balancing valve) is the most it passes: the units it feeds share it " +
    "and their pipes turn amber (lower the AHU riser's Max flow to 35 l/s). Every header, riser and pipe run shows the load it carries (the sum of its units). " +
    "Nothing you try in a card's simulation buttons is saved; the boxes (flow, head, temperatures, capacity, max flow) are saved to the map.\n\n" +

    "This is a typical example, not the project's drawing: every branch is \"to verify\" and every figure is an example. " +
    "Rename the equipment as the project's schematic and type the selections' figures.",
    kids: [] };
}

const P = (x: number, y: number, w?: number, h?: number) => "Place: " + [x, y].concat(w ? [w, h || 14] : []).join(", ");
const CT = (n: number, x: number): WNode => ({ key: "ct" + n, title: "Cooling tower CT-" + n,
  special: ["Source: cooling tower", "Leaving: 32 °C", "Design flow: 38 l/s", "Static lift: 4 m", "Pressure drop: 20 kPa", "Height: 18 m", "Capacity: 900 kW", P(x, 40)],
  notes: "Open counterflow tower on the roof. Capacity: the heat it rejects at its design conditions (above it, its leaving water rises). Leaving water 32 °C is a Gulf design figure (wet bulb about 29 °C + 3 K approach). Static lift = basin water level to the spray nozzles; Pressure drop = the nozzles at design flow." });
const CWP = (n: number, x: number, standby: boolean): WNode => ({ key: "cwp" + n, title: "Condenser water pump CWP-" + n + (standby ? " (standby)" : ""),
  special: [standby ? "Pump: standby" : "Pump: duty", "Pump flow: 38 l/s", "Pump head: 15 m", "Pressure drop: 15 kPa", P(x, 380)],
  notes: "Draws from the towers' basins (CWS header) and pushes into its chiller's condenser. Pressure drop = suction strainer, check valve and isolating valves at the pump flow." });
const CH = (n: number, x: number): WNode => ({ key: "ch" + n, title: "Chiller CH-" + n,
  special: ["Source: chiller", "Leaving: 6.7 °C", "Design flow: 30 l/s", "Pressure drop: 55 kPa", "Condenser flow: 38 l/s", "Condenser pressure drop: 55 kPa", "COP: 5.5", "Capacity: 750 kW", P(x, 520)],
  notes: "Water-cooled chiller: evaporator on the chilled water, condenser on the condenser water. Capacity 750 kW (213 TR): with more load it cannot hold 6.7 °C and its leaving water rises (stop CH-2 to see CH-1 at capacity). Pressure drop = evaporator at the design flow; the condenser flow is constant, set by its balancing valve." });
const CHP = (n: number, x: number, standby: boolean): WNode => ({ key: "p" + n, title: "Chilled water pump P-" + n + (standby ? " (standby)" : ""),
  special: [standby ? "Pump: standby" : "Pump: duty", "Pump flow: 30 l/s", "Pump head: 18 m", "Pressure drop: 15 kPa", P(x, 880)],
  notes: standby ? "Standby pump with its chiller: start it in its card to try it." : "Variable primary: one pump per chiller, from the suction header into its chiller's evaporator. Pressure drop = suction strainer, check valve and isolating valves at the pump flow." });
const UNIT = (key: string, title: string, flow: string, leaving: string, dp: string, height: number, place: string, notes?: string): WNode =>
  ({ key, title, special: ["Flow: " + flow, "Leaving: " + leaving, "Pressure drop: " + dp, "Height: " + height + " m", place], notes });
const RUN = (key: string, title: string, height: number, place: string, notes?: string): WNode => ({ key, title, special: ["Height: " + height + " m", place], notes });

function building(): { node: WNode; wires: Wire[] } {
  // a feed tree (owner, 23 Oct 2026): the circuits and the plant are the top branches; each unit sits under the riser or
  // branch pipe that feeds it. Every pipe is still a link with its size and length (flow, pressures, pipe schedule, 2D view).
  const node: WNode = { key: "b", title: "Chilled water system",
    notes: "Example: a mall with a water-cooled plant in the basement (three chillers, two duty and one standby), cooling towers on the roof, AHUs in plant rooms and FCU groups on two levels; variable primary chilled water. Replace the names and figures with the project's.\n\n" +
      "The units take water at the supply temperature and send it back warmer; a 2-way control valve on each. One branch pipe feeds a group of FCUs; the group's flow is the sum of its FCUs, its pressure drop the farthest FCU's coil, valve and group pipework.",
    kids: [
      { key: "cond", title: "Condenser water", notes: "Open circuit: towers on the roof, pumps and condensers in the plant room.", kids: [
        { key: "ctg", title: "Cooling towers", kids: [CT(1, 75), CT(2, 435), CT(3, 795)] },
        { key: "cwsh", title: "CWS header, plant room", special: ["Height: 0 m", P(40, 330, 920)], notes: "Collects the towers' cold water for the condenser water pumps." },
        { key: "cwpg", title: "Condenser water pumps", kids: [CWP(1, 72, false), CWP(2, 432, false), CWP(3, 792, true)] },
        { key: "cwrh", title: "CWR header, plant room", special: ["Height: 0 m", P(40, 250, 920)], notes: "Collects the condensers' warm water and sends it up to the towers." }] },
      { key: "plant", title: "Chiller plant", notes: "Where the chilled water is made and pumped.", kids: [
        { key: "chg", title: "Chillers", kids: [CH(1, 60), CH(2, 420), CH(3, 780)] },
        { key: "pg", title: "Chilled water pumps", notes: "One pump per chiller, on the return side.", kids: [CHP(1, 72, false), CHP(2, 432, false), CHP(3, 792, true)] },
        { key: "sh", title: "Pump suction header", special: ["Height: 0 m", P(40, 1020, 920)], notes: "The chilled water pumps draw from it; the expansion tank joins it (the point of no pressure change)." },
        { key: "et", title: "Expansion tank ET-1", special: ["Fill pressure: 1.7 bar", "Height: 0 m", P(250, 1080)],
          notes: "Closed diaphragm tank on the pumps' suction header. Fill pressure = static height of the highest unit (about 12 m = 1.2 bar) + 0.5 bar so air stays out at the high points." },
        { key: "as", title: "Air separator AS-1", special: ["Pressure drop: 10 kPa", "Design flow: 60 l/s", "Height: 0 m", P(1000, 990)],
          notes: "On the return before the pumps: takes out the air the water releases." }] },
      { key: "sup", title: "Supply (CHWS)", notes: "Chilled water supply: from the chillers to the units, each unit under the pipe that feeds it.", kids: [
        { key: "hs", title: "CHWS header, plant room", special: ["Height: 0 m", P(1040, 700, 16, 160)], notes: "Collects the chillers' supply and sends it to the risers." },
        { key: "rs", title: "CHWS riser to AHU plant rooms", special: ["Height: 5 m", "Max flow: 45 l/s", P(1150, 760)],
          notes: "Max flow 45 l/s: the riser's balancing valve setting (and its size, DN 200 at under 2 m/s). Lower it and the AHUs share less water.", kids: [
          UNIT("ahu1", "AHU-01, Level 1", "12 l/s", "13.0 °C", "60 kPa", 5, P(1250, 400)), UNIT("ahu2", "AHU-02, Level 1", "12 l/s", "13.0 °C", "60 kPa", 5, P(1250, 570)),
          UNIT("ahu3", "AHU-03, Level 2", "9.5 l/s", "12.5 °C", "60 kPa", 10, P(1250, 60)), UNIT("ahu4", "AHU-04, Level 2", "9.5 l/s", "12.5 °C", "60 kPa", 10, P(1250, 230))] },
        { ...RUN("sl1", "CHWS branch, Level 1", 5, P(1580, 560)), kids: [
          UNIT("f1a1", "FCU group L1-A1 (FCU-L1-01 to 08)", "2 l/s", "12.0 °C", "40 kPa", 5, P(1680, 380)), UNIT("f1a2", "FCU group L1-A2 (FCU-L1-09 to 16)", "2 l/s", "12.0 °C", "40 kPa", 5, P(1680, 520)),
          UNIT("f1b1", "FCU group L1-B1 (FCU-L1-17 to 24)", "1.6 l/s", "12.0 °C", "40 kPa", 5, P(1680, 660))] },
        { ...RUN("sl2", "CHWS branch, Level 2", 10, P(1580, 140)), kids: [
          UNIT("f2a1", "FCU group L2-A1 (FCU-L2-01 to 08)", "2 l/s", "12.0 °C", "40 kPa", 10, P(1680, 60)), UNIT("f2a2", "FCU group L2-A2 (FCU-L2-09 to 16)", "1.8 l/s", "12.0 °C", "40 kPa", 10, P(1680, 200))] }] },
      { key: "ret", title: "Return (CHWR)", notes: "Chilled water return: from the units back to the air separator, the pumps and the chillers.", kids: [
        RUN("rl1", "CHWR branch, Level 1", 5, P(1880, 560)),
        RUN("rl2", "CHWR branch, Level 2", 10, P(1880, 140)),
        RUN("rr", "CHWR riser from AHU plant rooms", 5, P(1440, 760)),
        { key: "hr", title: "CHWR header, plant room", special: ["Height: 0 m", P(1100, 1020, 900)], notes: "Collects the return water and sends it through the air separator to the pumps." }] }
    ] };
  const pipe = (from: string, to: string, rel: string, size: string, len: number): Wire =>
    ({ from, to, rel, signal: ({ "p-supply": "CHWS", "p-return": "CHWR", "p-cw-supply": "CWS", "p-cw-return": "CWR" } as Record<string, string>)[rel], cable: size, len: len + " m", by: "others" });
  const S = (a: string, b: string, size: string, len: number) => pipe(a, b, "p-supply", size, len);
  const R = (a: string, b: string, size: string, len: number) => pipe(a, b, "p-return", size, len);
  const CS = (a: string, b: string, size: string, len: number) => pipe(a, b, "p-cw-supply", size, len);
  const CR = (a: string, b: string, size: string, len: number) => pipe(a, b, "p-cw-return", size, len);
  const wires: Wire[] = [
    // condenser water: towers > CWS header > pumps > condensers > CWR header > towers
    CS("ct1", "cwsh", "DN 200", 25), CS("ct2", "cwsh", "DN 200", 25), CS("ct3", "cwsh", "DN 200", 25),
    CS("cwsh", "cwp1", "DN 150", 4), CS("cwsh", "cwp2", "DN 150", 4), CS("cwsh", "cwp3", "DN 150", 4),
    CS("cwp1", "ch1", "DN 150", 5), CS("cwp2", "ch2", "DN 150", 5), CS("cwp3", "ch3", "DN 150", 5),
    CR("ch1", "cwrh", "DN 150", 5), CR("ch2", "cwrh", "DN 150", 5), CR("ch3", "cwrh", "DN 150", 5),
    CR("cwrh", "ct1", "DN 200", 25), CR("cwrh", "ct2", "DN 200", 25), CR("cwrh", "ct3", "DN 200", 25),
    // chilled water supply: chillers > header > riser and branches > units
    S("ch1", "hs", "DN 150", 8), S("ch2", "hs", "DN 150", 8), S("ch3", "hs", "DN 150", 8),
    S("hs", "rs", "DN 200", 40), S("hs", "sl1", "DN 80", 45), S("hs", "sl2", "DN 65", 60),
    S("rs", "ahu1", "DN 100", 20), S("rs", "ahu2", "DN 100", 25), S("rs", "ahu3", "DN 100", 35), S("rs", "ahu4", "DN 100", 40),
    S("sl1", "f1a1", "DN 50", 20), S("sl1", "f1a2", "DN 50", 40), S("sl1", "f1b1", "DN 50", 60), S("sl2", "f2a1", "DN 50", 30), S("sl2", "f2a2", "DN 50", 55),
    // chilled water return: units > branches and riser > header > air separator > suction header > pumps > chillers
    R("ahu1", "rr", "DN 100", 20), R("ahu2", "rr", "DN 100", 25), R("ahu3", "rr", "DN 100", 35), R("ahu4", "rr", "DN 100", 40),
    R("f1a1", "rl1", "DN 50", 20), R("f1a2", "rl1", "DN 50", 40), R("f1b1", "rl1", "DN 50", 60), R("f2a1", "rl2", "DN 50", 30), R("f2a2", "rl2", "DN 50", 55),
    R("rr", "hr", "DN 200", 40), R("rl1", "hr", "DN 80", 45), R("rl2", "hr", "DN 65", 60),
    R("hr", "as", "DN 200", 4), R("as", "sh", "DN 200", 4), R("et", "sh", "DN 25", 3),
    R("sh", "p1", "DN 150", 3), R("sh", "p2", "DN 150", 3), R("sh", "p3", "DN 150", 3),
    R("p1", "ch1", "DN 150", 5), R("p2", "ch2", "DN 150", 5), R("p3", "ch3", "DN 150", 5)
  ];
  return { node, wires };
}

export function pipingSeed(_template: string): WiringSeed {
  const b = building();
  return { guide: guide(), nodes: b.node.kids || [], wires: b.wires, root: { special: [], notes: b.node.notes || "" } };
}
