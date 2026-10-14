# Psychrometric chart — DAME Tools Hub

Tool id: `psychrometric-chart` · Tile: General · Pattern: Quicktools legacy layer (STANDARDS.md § 2a)

## Install

1. Copy this folder to `tools/psychrometric-chart/` in the site repo.
2. Admin > Tools: add a tool with id `psychrometric-chart`, name "Psychrometric chart",
   tagline e.g. "ASHRAE chart, air states and coil loads", category General, path
   `tools/psychrometric-chart/index.html`, status Live.
3. No database change. Nothing from this tool is saved to Supabase; states live in the user's
   browser, one saved set per signed-in user name (`dame.psychro.v1:<username>`).

## What changed from the Quicktools version

- **Values now match ASHRAE.** The water-vapour enhancement factor (Hyland–Wexler real-gas
  correction, Greenspan fit) is applied to saturation pressure everywhere. The old build
  used the plain perfect-gas equations and read 0.4–0.6 % low on humidity ratio against
  ASHRAE Table 2 / Chart No. 1; it now agrees to within 0.03 %. Run `node test-psychro.js`.
- Chart redrawn in ASHRAE Chart No. 1 style: fine grid, wet-bulb lines every 1 °C with
  values on the saturation curve, enthalpy scale outside the curve, pressure/altitude caption
  on the chart. Specific volume lines are off by default (tick "Specific volume" to show them).
  Axis numbers that were being clipped are fixed.
- IP mode draws the whole chart in IP (°F, gr/lb, Btu/lb, ft³/lb, in.Hg, cfm) with round IP
  ticks. The engine stays SI; figures are converted at display, there is no second equation set.
- "Mix two states" adds an adiabatic mixed condition (ASHRAE eq. 45/46) as a new row. The row
  remembers its two sources: the step into it is shown as mixing (dashed, no coil load), and
  the page says so if the sources are changed afterwards.
- Properties table adds saturation vapour pressure and moist-air specific heat.
- Multiple states, process steps, loads, SHR, ADP/bypass factor, CSV / PNG / print — unchanged.
- Hub integration: shell.css + legacy-tools.css, `window.psyProfile = Hub.requireLogin({ tool: "psychrometric-chart" })` (the page logic waits for it),
  Daikin tokens only (series palette defined in styles.css from hub tokens), no fonts or CDN,
  user-typed names written with textContent, boots without the old `tn:ready` event.
