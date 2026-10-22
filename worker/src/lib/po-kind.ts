/* What a datasheet row is, for Product Options (owner, 21 Oct 2026; docs/Product-Options-Redesign.md).
     option     what the unit is made of or comes with: materials, construction, classes, models. Waits for approval;
                Product Options splits the options of a section into "common" and "model-specific" from the data.
     duty       a figure of one selection (flow, pressure, velocity, capacity, power, temperature, size, weight ...).
                Shown as "seen from - to", never waits for approval, never read by the AI as an option.
     accessory  a line of the datasheet's Options List (light, port hole, Magnehelic, SS304 drain pan ...).
     project    the project's own conditions (location, air density, altitude): not in Product Options at all.
     hide       printed notes ("Calculated in Wet Condition") and lines the reader could not split.
   The editor can set a row to option or duty on the Row mapping page (dn_map.kind); '' = decided here by name. */

export type PoKind = "option" | "duty" | "accessory" | "project" | "hide";
export const PO_KIND_OVERRIDES = ["", "option", "duty"] as const;

const PROJECT = /^unit data\|\|(location|air density|altitude)\s*(\([^)]*\))?$/;     // "Altitude(m)" on an FCU report too
/* a heat wheel's winter / summer blocks are one selection's conditions */
const DUTY_SUB = /(^|\W)(winter|summer|cooling|heating)(\W|$)|air side|fluid side/;
/* figures of one selection, by the component's name */
const DUTY = new RegExp([
  "flow", "pressure(?! drop design)", "velocity", "capacity", "heat transfer", "\\btemp\\b", "temperature", "humidity",
  "\\bpower\\b(?! supply)", "current", "speed work", "efficiency(?! class| epm)", "\\beff\\.", "weight", "length", "width", "height",
  "\\barea\\b", "torque", "volume", "\\bsfp", "steam", "voltage", "recirculated", "dimensions", "\\brows\\b", "circuit",
  "connection diam", "quantity", "steps number", "distributor", "pmref", "power class", "velocity class", "energy class \\(en13053\\)",
  "^model$"
].join("|"));

/* FCU technical report (McQuay Smart Tools; owner, 22 Oct 2026: as the AHU). An FCU is kept per unit model, so what
   is fixed for a model is an option (shown per model, waits for approval): its sizes, weight, coil area and rows, fins,
   connections, fan and motor counts, rated motor speed. What one selection gives is duty: flows, ESP, power and current,
   the cooling and heating figures, face velocity, the speed it was selected at, sound levels. The FCU headings are its
   own ("Configuration information", "Cooling coil (Cooling Mode)", "Acoustical performance"), so AHU rows never meet
   these rules; Unit Data and Electric Heater rows are told apart by the FCU's own names. */
const FCU_SECTION = /^(configuration information|cooling coil \((cooling|heating) mode\)|acoustical performance|sound pressure level\b.*)$/;
const FCU_UNIT_OPTION = /^(unit model|(net|shipping) dimension\b.*|unit net weight\b.*)$/;
const FCU_UNIT_DUTY = /^((application|design) (air flow|esp)\b.*|fan power input\b.*|running current\b.*|fan speed)$/;
const FCU_HEATER_DUTY = /^(heating capacity\b.*|e-heater maximum current\b.*|(on|off) coil \(db\).*)$/;
function fcuKind(section: string, component: string): PoKind | null {
  if (section === "unit data") return FCU_UNIT_OPTION.test(component) ? "option" : FCU_UNIT_DUTY.test(component) ? "duty" : null;
  if (section === "electric heater") return FCU_HEATER_DUTY.test(component) ? "duty" : null;
  if (!FCU_SECTION.test(section)) return null;
  if (section === "configuration information") return /^face velocity\b/.test(component) ? "duty" : "option";
  if (/^cooling coil/.test(section)) return /^coil rows$/.test(component) ? "option" : "duty";
  return "duty";                                                          // sound levels follow the speed and the ESP
}

/* the row key "section|sub|component" (DSParse.rowKey) -> its kind, before any editor's choice */
export function poAutoKind(rowKey: string): PoKind {
  const [section = "", sub = "", component = ""] = rowKey.split("|");
  if (/^options$/.test(sub) && component === "option") return "accessory";
  // a line the reader could not split carries the datasheet's footnote marks ("1[d]* x ekexva250 [a]* ekea"); a "*" alone
  // is not one: the FCU's "Net Dimension W*D*H (mm)" is a row (22 Oct 2026)
  if (component === "note" || /[[\]]/.test(component)) return "hide";
  if (PROJECT.test(rowKey)) return "project";
  // the NRVU block (EU 1253/2014) and the Electrical Power Inputs table (22 Oct 2026): figures of one selection, except
  // what the unit is (typology, drive type, HRS type, leakage and filter energy classes); outdoor conditions are the site's
  if (section === "nrvu") return /outdoor conditions/.test(component) ? "project"
    : /^(typology|drive type|hrs type|external leakage|filter energy|filter service)/.test(component) ? "option" : "duty";
  if (section === "electrical power inputs") return component === "electrical connection" ? "option" : "duty";
  const fcu = fcuKind(section, component);
  if (fcu) return fcu;
  if (/^coil\b/.test(section) && component === "model") return "hide";     // the coil code repeats rows, tubes and fins
  if (/^en ?13053$/.test(section)) return "duty";                           // power and velocity classes follow the selection
  if (/^(fan\b|.*\bfan$)/.test(section) && component === "model") return "option";
  if (section === "unit data" && component === "model") return "duty";      // the unit's size, H x W
  if (DUTY_SUB.test(sub) || DUTY.test(component)) return "duty";
  return "option";
}

/* the kind in use: the editor's choice (option / duty) wins over the name, except for notes and Options List lines */
export function poKind(rowKey: string, override: unknown): PoKind {
  const auto = poAutoKind(rowKey);
  if (auto === "accessory" || auto === "hide") return auto;
  return override === "option" || override === "duty" ? override : auto;
}
