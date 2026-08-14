# Container & trailer calculator

`/tools/container-calculator/` — works out how many containers or trailers a
shipment needs, draws the stowage, and exports a PDF report.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page. Standard skeleton: title → controls → results → notes. |
| `styles.css` | Tool styles. Every value comes from the global design tokens. |
| `js/packer.js` | 3D packing engine. Pure, no DOM, runs in Node for the tests. |
| `js/draw.js` | Builds renderer-agnostic scenes; also holds the SVG renderer. |
| `js/pdf.js` | Minimal vector PDF writer (core fonts, no dependencies). |
| `js/xlsx-io.js` | Reads .xlsx/.csv, writes .xlsx. Uses native `DecompressionStream`. |
| `tests/*.test.mjs` | Headless tests. Not required at runtime — safe to exclude from deploy. |

## Dependencies

None at runtime. The tests use `jsdom` as a dev-only dependency:

```
npm install --no-save jsdom
node tests/packer.test.mjs
node tests/io.test.mjs
node tests/ui.test.mjs
```

## Browser support

`.xlsx` reading needs `DecompressionStream('deflate-raw')` — Chrome 80+,
Edge 80+, Safari 16.4+, Firefox 113+. Older browsers get a clear message
telling them to upload CSV instead; everything else in the tool still works.

## Notes

- All dimensions are stored internally in metres. The mm/m switch is display only.
- Vehicle figures in `VEHICLE_PRESETS` are internal usable dimensions, not door openings.
- `PRINT_FALLBACK` in `js/app.js` is the one place raw hex appears. It mirrors the
  global tokens so a report printed from a dark theme still comes out on white paper.
  Replace it with a `--print-*` token set in `global.css` if you would rather it lived in CSS.
