/*
 * packer.js — container / trailer loading engine
 * Thinkneering · Container Calculator
 *
 * Pure ES module, no dependencies, no DOM access.
 * Also runnable in Node for the headless tests in ../tests/.
 *
 * Coordinate system (metres, right-handed):
 *   x → along vehicle LENGTH  (0 = rear door / back of bed)
 *   y → across vehicle WIDTH
 *   z → vertical HEIGHT       (0 = floor)
 */

const EPS = 1e-6;

/* ------------------------------------------------------------------ *
 * Sort strategies
 *
 * Which item goes in first decides most of the outcome, and no single
 * ordering wins everywhere: across 120 benchmark shipments, largest-volume-
 * first was 20 vehicles worse than the best available order, and every other
 * rule lost more. So the packer runs several orders and keeps the winner.
 * Each pass is cheap, and one saved trailer is worth far more than 80 ms.
 * ------------------------------------------------------------------ */

const longSide = (i) => Math.max(i.l, i.w);
const shortSide = (i) => Math.min(i.l, i.w);

export const SORT_STRATEGIES = {
  /** Bulkiest first — the strongest single rule on mixed cargo. */
  volume: (a, b) =>
    (b.l * b.w * b.h) - (a.l * a.w * a.h) ||
    Math.max(b.l, b.w, b.h) - Math.max(a.l, a.w, a.h) ||
    b.weight - a.weight,
  /** Biggest floor area first — wins when height varies little. */
  footprint: (a, b) => (b.l * b.w) - (a.l * a.w) || b.h - a.h || b.weight - a.weight,
  /** Longest edge first, then the next longest. */
  lengthWidth: (a, b) => longSide(b) - longSide(a) || shortSide(b) - shortSide(a) || b.h - a.h || b.weight - a.weight,
  /** Widest first — good when full-width pieces must go in whole rows. */
  widthLength: (a, b) => shortSide(b) - shortSide(a) || longSide(b) - longSide(a) || b.h - a.h,
  /** Tallest first — helps when stacking is the binding constraint. */
  height: (a, b) => b.h - a.h || (b.l * b.w) - (a.l * a.w),
  /** Heaviest first — helps when payload, not space, runs out first. */
  weight: (a, b) => b.weight - a.weight || (b.l * b.w * b.h) - (a.l * a.w * a.h),
};

const STRATEGY_NAMES = Object.keys(SORT_STRATEGIES);

export const STRATEGY_LABELS = {
  volume: 'largest volume first',
  footprint: 'largest floor area first',
  lengthWidth: 'longest edge first',
  widthLength: 'widest first',
  height: 'tallest first',
  weight: 'heaviest first',
};

/**
 * Which orders to try. Every pass costs roughly one full packing run, so
 * very large manifests fall back to the two strongest rules to keep the
 * page responsive while typing.
 */
/* How many packing passes a run will take. The progress bar needs this to
   weight its two phases honestly — the fleet comparison is usually the more
   expensive half, and guessing 50/50 would make the bar stall at the midpoint. */
export function strategyCount(items, budget) {
  const pieces = items.reduce((s, i) => s + Math.max(1, Math.round(Number(i.qty) || 1)), 0);
  return strategiesFor(pieces, budget).length;
}

function strategiesFor(pieces, budget) {
  if (budget === 'single') return ['volume'];
  if (pieces > 260 || budget === 'fast') return ['volume', 'footprint'];
  return STRATEGY_NAMES;
}

/* ------------------------------------------------------------------ *
 * Vehicle presets — internal (usable) dimensions in metres.
 * Payload figures are typical maxima; always confirm with the carrier.
 * ------------------------------------------------------------------ */
/* Internal dimensions in metres and payload in kg, to published ISO / industry
   specification. `cost` is an INDICATIVE sample in USD, pre-filled when a
   vehicle is picked purely so the freight estimate shows something sensible —
   it is not a quote and every real shipment should overwrite it.
   Container figures track the Drewry World Container Index global average for
   a 40 ft box (about USD 4,300 in August 2026), scaled by the usual ratios: a
   20 ft runs roughly 60-70% of a 40 ft, high cube carries a small premium,
   open top and flat rack are special-equipment surcharged. Trailer figures are
   per-trip regional haulage and vary far more with distance than anything
   else, so treat them as the roughest of the set. */
export const VEHICLE_PRESETS = [
  { id: '20gp',    name: "20 ft GP container",        length: 5.898,  width: 2.352, height: 2.393, payload: 28200, cost: 2800, group: 'Container' },
  { id: '40gp',    name: "40 ft GP container",        length: 12.032, width: 2.352, height: 2.393, payload: 26700, cost: 4300, group: 'Container' },
  { id: '40hc',    name: "40 ft HC container",        length: 12.032, width: 2.352, height: 2.698, payload: 26460, cost: 4500, group: 'Container' },
  { id: '45hc',    name: "45 ft HC container",        length: 13.556, width: 2.352, height: 2.698, payload: 27600, cost: 5000, group: 'Container' },
  { id: '20ot',    name: "20 ft open top",            length: 5.898,  width: 2.352, height: 2.311, payload: 28000, cost: 3400, group: 'Container' },
  { id: '40ot',    name: "40 ft open top",            length: 12.032, width: 2.352, height: 2.311, payload: 26500, cost: 5200, group: 'Container' },
  { id: '20fr',    name: "20 ft flat rack",           length: 5.940,  width: 2.350, height: 2.350, payload: 31260, cost: 3600, group: 'Container' },
  { id: '40fr',    name: "40 ft flat rack",           length: 12.080, width: 2.400, height: 2.140, payload: 39340, cost: 5600, group: 'Container' },
  { id: 'tr12',    name: "12 m flatbed trailer",      length: 12.000, width: 2.400, height: 3.300, payload: 24000, cost: 900,  group: 'Trailer' },
  { id: 'tr136',   name: "13.6 m curtain-side",       length: 13.600, width: 2.450, height: 2.700, payload: 24000, cost: 1000, group: 'Trailer' },
  { id: 'lowbed',  name: "Low-bed trailer",           length: 12.000, width: 3.000, height: 3.500, payload: 40000, cost: 1600, group: 'Trailer' },
  { id: 'tr76',    name: "7.6 m rigid truck",         length: 7.600,  width: 2.400, height: 2.600, payload: 12000, cost: 550,  group: 'Trailer' },
];

/* ------------------------------------------------------------------ *
 * Pallets
 *
 * Deck sizes and deadweights are the published nominal specs; real
 * pallets vary by a few millimetres and a couple of kilograms with
 * timber, moisture and grade.
 *
 *   EUR 1 / EPAL   1200 x 800 x 144 mm, ~25 kg, SWL 1500 kg
 *   EUR 2          1200 x 1000 x 162 mm, ~28 kg
 *   GMA 48 x 40    1219 x 1016 x 145 mm, ~17 kg
 *   ISO / Asia     1100 x 1100 x 150 mm, ~23 kg
 *   Australian     1165 x 1165 x 150 mm, ~40 kg
 *
 * `deck` is added to the height of whatever sits on the pallet, and the
 * pallet's own weight counts against the vehicle payload.
 * ------------------------------------------------------------------ */
export const PALLET_PRESETS = [
  { id: 'eur1', name: 'EUR 1 / EPAL (1200 × 800)',  length: 1.200, width: 0.800, deck: 0.144, weight: 25, swl: 1500, region: 'Europe' },
  { id: 'eur2', name: 'EUR 2 industrial (1200 × 1000)', length: 1.200, width: 1.000, deck: 0.162, weight: 28, swl: 1500, region: 'Europe' },
  { id: 'gma',  name: 'GMA 48 × 40 in (1219 × 1016)', length: 1.219, width: 1.016, deck: 0.145, weight: 17, swl: 1250, region: 'North America' },
  { id: 'iso',  name: 'ISO / Asia (1100 × 1100)',   length: 1.100, width: 1.100, deck: 0.150, weight: 23, swl: 1200, region: 'Asia' },
  /* Heavy-duty timber skids of the kind used for FCU and coil shipments out
     of China. These are NOT a GB/T standard size — the Chinese standards are
     1200 x 1000 and 1100 x 1100, same as the ISO sizes above. Deck height,
     deadweight and safe working load are therefore estimates for a skid of
     this footprint, not published figures: confirm them with your supplier
     and edit if they differ. */
  { id: 'cn2015', name: 'China skid (2000 × 1500)', length: 2.000, width: 1.500, deck: 0.150, weight: 60, swl: 2000, region: 'China' },
  { id: 'cn2020', name: 'China skid (2000 × 2000)', length: 2.000, width: 2.000, deck: 0.150, weight: 80, swl: 2500, region: 'China' },
  { id: 'au',   name: 'Australian (1165 × 1165)',   length: 1.165, width: 1.165, deck: 0.150, weight: 40, swl: 2000, region: 'Australia' },
];

/* Space a forklift needs around a palletised load to place and pick it
   without striking the neighbour. SEMA guidance for racking is 75-100 mm
   between adjacent loads; 100 mm is the common working figure and is used
   as the default here. */
export const DEFAULT_PALLET_CLEARANCE = 0.100;

export const DEFAULT_OPTIONS = {
  allowStacking: true,   // may items be placed on top of other items
  allowTilt: false,      // may items be turned onto their side / end (6 rotations vs 2)
  gap: 0,                // clearance kept BETWEEN items along length & width, metres.
                         // Not applied to the walls: an item may touch them.
  supportRatio: 0.8,     // fraction of an item's base that must rest on something solid
  maxVehicles: 400,      // safety stop
  sortBy: null,          // force one strategy by name, or null to search several
  budget: null,          // null | 'fast' (two strategies) | 'single' (one)
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function round(n, p = 3) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

/** Distinct box orientations, largest footprint first. */
function orientations(l, w, h, allowTilt) {
  const raw = allowTilt
    ? [[l, w, h], [w, l, h], [l, h, w], [h, l, w], [w, h, l], [h, w, l]]
    : [[l, w, h], [w, l, h]];
  const seen = new Set();
  const out = [];
  for (const o of raw) {
    const key = o.map((v) => v.toFixed(4)).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ l: o[0], w: o[1], h: o[2] });
  }
  return out;
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.l - EPS && b.x < a.x + a.l - EPS &&
    a.y < b.y + b.w - EPS && b.y < a.y + a.w - EPS &&
    a.z < b.z + b.h - EPS && b.z < a.z + a.h - EPS
  );
}

function footprintOverlap(a, b) {
  const dx = Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y);
  return dx > EPS && dy > EPS ? dx * dy : 0;
}

/**
 * Expand the item list into individual physical units and apply the
 * clearance gap. Rows that cannot ever ship are reported, not silently kept.
 */
function expandUnits(items) {
  const units = [];
  items.forEach((item, i) => {
    const qty = Math.max(1, Math.round(Number(item.qty) || 1));
    for (let n = 0; n < qty; n++) {
      units.push({
        uid: `${i}-${n}`,
        rowIndex: Number.isInteger(item.srcRow) ? item.srcRow : i,
        tag: item.tag || `Item ${i + 1}`,
        copy: n + 1,
        qty,
        // true size, kept for reporting
        rawL: Number(item.length),
        rawW: Number(item.width),
        rawH: Number(item.height),
        // size used for sorting; the clearance is added at placement
        l: Number(item.length),
        w: Number(item.width),
        h: Number(item.height),
        weight: Number(item.weight) || 0,
        stackable: item.stackable !== false,
        // Pallet contents, when the caller palletised first. Opaque to the
        // packer — carried so the drawings can show what is on the deck.
        pallet: item.pallet || null,
        volume: Number(item.length) * Number(item.width) * Number(item.height),
      });
    }
  });
  return units;
}

/* The clearance is a gap between items, not to the walls, so whether an item
   fits the empty vehicle is judged on its real size. */
function fitsAnywhere(u, vehicle, opt) {
  for (const o of orientations(u.rawL, u.rawW, u.rawH, opt.allowTilt && !u.pallet)) {
    if (o.l <= vehicle.length + EPS && o.w <= vehicle.width + EPS && o.h <= vehicle.height + EPS) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Placement — extreme-point first-fit
 * ------------------------------------------------------------------ */

function newVehicle(index, vehicle) {
  return {
    index,
    vehicle,
    placements: [],
    points: [{ x: 0, y: 0, z: 0 }],
    weight: 0,
    volume: 0,
  };
}

function supported(cand, bin, opt) {
  if (cand.z <= EPS) return true;
  if (!opt.allowStacking) return false;
  const base = cand.l * cand.w;
  let area = 0;
  for (const p of bin.placements) {
    if (Math.abs(p.z + p.h - cand.z) > 1e-3) continue;
    if (!p.stackable) return false; // nothing may rest on this item
    area += footprintOverlap(cand, p);
  }
  return area >= base * opt.supportRatio - EPS;
}

function tryPlace(bin, unit, opt) {
  const v = bin.vehicle;
  if (bin.weight + unit.weight > v.payload + EPS) return false;

  /* Each item occupies its real size plus the clearance on its far side in
     length and width. That keeps the gap between neighbours; the last item
     in a row may touch the wall, so the wall check uses the real size. */
  const gap = opt.gap || 0;
  let best = null;
  for (const pt of bin.points) {
    /* A loaded pallet is never turned on its side, whatever the tilt setting. */
    for (const o of orientations(unit.rawL, unit.rawW, unit.rawH, opt.allowTilt && !unit.pallet)) {
      const cand = { x: pt.x, y: pt.y, z: pt.z, l: o.l + gap, w: o.w + gap, h: o.h, il: o.l, iw: o.w, stackable: unit.stackable };
      if (cand.x + cand.il > v.length + EPS) continue;
      if (cand.y + cand.iw > v.width + EPS) continue;
      if (cand.z + cand.h > v.height + EPS) continue;
      let clash = false;
      for (const p of bin.placements) {
        if (overlaps(cand, p)) { clash = true; break; }
      }
      if (clash) continue;
      if (!supported(cand, bin, opt)) continue;

      // Prefer: lowest, then closest to the nose, then closest to the near side.
      const score = cand.z * 1e6 + cand.x * 1e3 + cand.y;
      if (!best || score < best.score) best = { cand, score };
    }
  }
  if (!best) return false;

  const c = best.cand;
  bin.placements.push({
    uid: unit.uid,
    rowIndex: unit.rowIndex,
    tag: unit.tag,
    copy: unit.copy,
    x: round(c.x, 6), y: round(c.y, 6), z: round(c.z, 6),
    // l, w: space taken, clearance included. il, iw: the item itself as placed.
    l: round(c.l, 6), w: round(c.w, 6), h: round(c.h, 6),
    il: round(c.il, 6), iw: round(c.iw, 6),
    rawL: unit.rawL, rawW: unit.rawW, rawH: unit.rawH,
    weight: unit.weight,
    stackable: unit.stackable,
    pallet: unit.pallet,
    tilted: Math.abs(c.h - unit.rawH) > 1e-6,
  });
  bin.weight = round(bin.weight + unit.weight, 3);
  bin.volume = round(bin.volume + unit.volume, 4);

  // Retire the consumed point, add the three new extreme points.
  bin.points = bin.points.filter((p) => !(p.x === c.x && p.y === c.y && p.z === c.z));
  const fresh = [
    { x: c.x + c.l, y: c.y, z: c.z },
    { x: c.x, y: c.y + c.w, z: c.z },
    { x: c.x, y: c.y, z: c.z + c.h },
  ];
  for (const p of fresh) {
    if (p.x > v.length - EPS || p.y > v.width - EPS || p.z > v.height - EPS) continue;
    /* Six decimals, not three: rounding a point to the millimetre moved a
       1.1965 m tier up to 1.197 m and the piece above it no longer fitted. */
    if (bin.points.some((q) => Math.abs(q.x - p.x) < 1e-4 && Math.abs(q.y - p.y) < 1e-4 && Math.abs(q.z - p.z) < 1e-4)) continue;
    bin.points.push({ x: round(p.x, 6), y: round(p.y, 6), z: round(p.z, 6) });
  }
  bin.points.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  return true;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Pack items using one specific ordering.
 * @returns {Object} loading plan for that ordering
 */
/* `tick` is called with a 0-1 fraction as placement proceeds. It fires every
   64 units rather than every unit: the callback crosses a postMessage boundary
   in the worker, and reporting 12,000 times would cost more than the packing. */
function packOnce(items, vehicle, opt, strategy, tick) {
  const units = expandUnits(items);
  const rejected = [];
  const shippable = [];

  for (const u of units) {
    if (!(u.rawL > 0 && u.rawW > 0 && u.rawH > 0)) {
      rejected.push({ ...u, reason: 'Missing or zero dimension' });
    } else if (u.weight > vehicle.payload + EPS) {
      rejected.push({ ...u, reason: 'Heavier than the vehicle payload' });
    } else if (!fitsAnywhere(u, vehicle, opt)) {
      rejected.push({ ...u, reason: 'Too large for the vehicle in any orientation' });
    } else {
      shippable.push(u);
    }
  }

  shippable.sort(SORT_STRATEGIES[strategy] || SORT_STRATEGIES.volume);

  const bins = [];
  for (let idx = 0; idx < shippable.length; idx++) {
    const u = shippable[idx];
    /* Squared: each piece is tried against every vehicle opened so far, so
       the later pieces take longer and a straight count would run ahead. */
    if (tick && (idx & 63) === 0) tick((idx / shippable.length) ** 2);
    let done = false;
    for (const bin of bins) {
      if (tryPlace(bin, u, opt)) { done = true; break; }
    }
    if (done) continue;
    if (bins.length >= opt.maxVehicles) {
      rejected.push({ ...u, reason: 'Vehicle limit reached' });
      continue;
    }
    const bin = newVehicle(bins.length + 1, vehicle);
    if (tryPlace(bin, u, opt)) {
      bins.push(bin);
    } else {
      rejected.push({ ...u, reason: 'Could not be placed' });
    }
  }

  const vehicleVolume = vehicle.length * vehicle.width * vehicle.height;
  const loads = bins.map((bin) => {
    const usedLength = bin.placements.reduce((m, p) => Math.max(m, p.x + p.il), 0);
    const usedHeight = bin.placements.reduce((m, p) => Math.max(m, p.z + p.h), 0);
    let moment = 0;
    for (const p of bin.placements) moment += p.weight * (p.x + p.il / 2);
    const cg = bin.weight > 0 ? moment / bin.weight : vehicle.length / 2;
    return {
      index: bin.index,
      placements: bin.placements,
      pieces: bin.placements.length,
      weight: round(bin.weight, 1),
      cbm: round(bin.volume, 2),
      usedLength: round(usedLength, 3),
      usedHeight: round(usedHeight, 3),
      volumeUse: round(bin.volume / vehicleVolume, 4),
      floorUse: round(usedLength / vehicle.length, 4),
      weightUse: round(bin.weight / vehicle.payload, 4),
      cg: round(cg, 3),
      cgPercent: round((cg / vehicle.length) * 100, 1),
    };
  });

  const totalCbm = round(loads.reduce((s, l) => s + l.cbm, 0), 2);
  const totalWeight = round(loads.reduce((s, l) => s + l.weight, 0), 1);
  const totalPieces = loads.reduce((s, l) => s + l.pieces, 0);

  return {
    vehicle,
    /* onProgress is stripped: the plan is posted back across a worker
       boundary, and structuredClone throws on a function. Callers that read
       plan.options want the packing settings, never the callback. */
    options: { ...opt, onProgress: undefined },
    strategy,
    loads,
    rejected,
    summary: {
      vehicles: loads.length,
      pieces: totalPieces,
      rejectedPieces: rejected.length,
      totalCbm,
      totalWeight,
      avgVolumeUse: loads.length ? round(totalCbm / (loads.length * vehicleVolume), 4) : 0,
      avgWeightUse: loads.length ? round(totalWeight / (loads.length * vehicle.payload), 4) : 0,
      vehicleCbm: round(vehicleVolume, 2),
      strategy,
      strategyLabel: STRATEGY_LABELS[strategy] || strategy,
    },
  };
}

/**
 * Pack items into as few vehicles as the heuristic can manage.
 *
 * Tries several loading orders and returns the best result. Set
 * `options.sortBy` to a strategy name to force one specific order.
 *
 * @param {Array} items    rows of { tag, length, width, height, weight, qty, stackable }
 * @param {Object} vehicle { name, length, width, height, payload }
 * @param {Object} options see DEFAULT_OPTIONS
 * @returns {Object} loading plan
 */
export function packItems(items, vehicle, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const report = typeof opt.onProgress === 'function' ? opt.onProgress : null;

  if (opt.sortBy && SORT_STRATEGIES[opt.sortBy]) {
    return packOnce(items, vehicle, opt, opt.sortBy, report);
  }

  const pieces = items.reduce((s, i) => s + Math.max(1, Math.round(Number(i.qty) || 1)), 0);
  const tried = strategiesFor(pieces, opt.budget);

  let best = null;
  for (let si = 0; si < tried.length; si++) {
    const strategy = tried[si];
    // Each strategy owns an equal slice of the reported progress.
    const plan = packOnce(items, vehicle, opt, strategy,
      report ? (f) => report((si + f) / tried.length) : null);
    // Fewest vehicles wins; on a tie prefer the tighter pack.
    const better = !best
      || plan.summary.vehicles < best.summary.vehicles
      || (plan.summary.vehicles === best.summary.vehicles
        && plan.summary.avgVolumeUse > best.summary.avgVolumeUse + 1e-9);
    if (better) best = plan;
  }
  best.summary.strategiesTried = tried.length;
  if (report) report(1);
  return best;
}

/**
 * Run the same cargo against every preset so the user can see which
 * vehicle actually costs the fewest trips.
 *
 * This runs once per preset, so it uses the reduced strategy set. The
 * chosen vehicle still gets the full search in packItems.
 */
export function compareFleet(items, options = {}, presets = VEHICLE_PRESETS) {
  const report = typeof options.onProgress === 'function' ? options.onProgress : null;
  return presets
    .map((v, vi) => {
      /* onProgress is replaced, not forwarded: the inner packItems would
         otherwise report its own 0-1 once per preset and the bar would
         restart twelve times. */
      const plan = packItems(items, v, {
        ...options,
        budget: 'fast',
        onProgress: report ? (f) => report((vi + f) / presets.length) : undefined,
      });
      return {
        id: v.id,
        name: v.name,
        group: v.group,
        vehicles: plan.summary.vehicles,
        rejectedPieces: plan.summary.rejectedPieces,
        volumeUse: plan.summary.avgVolumeUse,
        weightUse: plan.summary.avgWeightUse,
      };
    })
    .sort((a, b) => a.rejectedPieces - b.rejectedPieces || a.vehicles - b.vehicles || b.volumeUse - a.volumeUse);
}
