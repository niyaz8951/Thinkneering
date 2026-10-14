/*
 * draw.js — builds abstract "scenes" from a loading plan.
 *
 * A scene is renderer-agnostic geometry: an ordered list of polygons, lines
 * and labels in a plain 2D box. The SVG renderer paints it to the page and
 * the PDF writer paints the very same scene to paper, so the drawing a user
 * downloads is the drawing they saw.
 *
 * The list is ordered and both renderers walk it in one pass. That is what
 * keeps the floor grid under the cargo rather than over it.
 *
 * Colours are named design tokens ('primary', 'accent', …) — never raw hex.
 * Each renderer resolves those names its own way.
 */

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** Item colours, cycled by input row so every copy of a tag matches. */
export const PALETTE = ['primary', 'accent', 'success', 'warning', 'danger', 'primary-dark', 'text-muted'];

export function tokenFor(rowIndex) {
  return PALETTE[rowIndex % PALETTE.length];
}

/* The box to draw for a placement: the item itself. A placement's l and w
   include the clearance kept to the next item, so drawing those would show
   the cargo bigger than it is and hide the gaps. */
function shown(p) {
  return { x: p.x, y: p.y, z: p.z, l: p.il ?? p.l, w: p.iw ?? p.w, h: p.h };
}

function newScene(width, height) {
  const scene = { width, height, items: [] };
  scene.poly = (pts, opts = {}) => { scene.items.push({ type: 'poly', pts, ...opts }); return scene; };
  scene.line = (a, b, opts = {}) => { scene.items.push({ type: 'line', a, b, ...opts }); return scene; };
  scene.label = (x, y, text, opts = {}) => { scene.items.push({ type: 'label', x, y, text, ...opts }); return scene; };
  return scene;
}

function fitter(pts, width, height, pad) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1));
  const ox = pad + ((width - pad * 2) - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = pad + ((height - pad * 2) - (maxY - minY) * scale) / 2 - minY * scale;
  return { map: (x, y) => [x * scale + ox, y * scale + oy], scale };
}

/* ------------------------------------------------------------------ *
 * Isometric view
 * ------------------------------------------------------------------ */

function iso(x, y, z) {
  return [(x - y) * COS30, (x + y) * SIN30 - z];
}

function vehicleCorners(v) {
  const out = [];
  for (const x of [0, v.length]) for (const y of [0, v.width]) for (const z of [0, v.height]) out.push(iso(x, y, z));
  return out;
}

/** 3D isometric view of one loaded vehicle. */
/* ------------------------------------------------------------------ *
 * Pallet contents
 *
 * A palletised placement is one box to the packer but two things to the eye:
 * the deck, and the units standing on it. These helpers reopen the box so the
 * drawings can show the deck as a dotted outline with the real units inside,
 * in their row colour.
 *
 * The grid drawn here is the grid the calculation chose — cols, rows and the
 * item orientation all come from the packing, never re-derived — so the
 * picture cannot disagree with the numbers.
 * ------------------------------------------------------------------ */

/* Above this many individual units in one drawing, the contents are dropped
   and pallets render as solid boxes.
   Two reasons for the ceiling, and the tighter one is legibility: past roughly
   this many units each one is a couple of pixels in a 520-wide drawing and the
   picture says less than plain blocks would. Weight is the second — each unit
   costs about 700 bytes of SVG across its three faces, so 200 units is around
   140 KB per view, and every load has two views that also go into the PDF. */
const MAX_DRAWN_UNITS = 200;

function palletUnitCount(load) {
  let n = 0;
  for (const p of load.placements) if (p.pallet && !p.tilted) n += p.pallet.count;
  return n;
}

/* Deck rectangle and unit boxes for one placement, in vehicle coordinates.
   Returns null when the placement is not a pallet, or was tilted on its side
   by the packer — a pallet on its side has no meaningful layer grid, so it
   stays a solid block. */
function palletParts(p) {
  if (!p.pallet || p.tilted) return null;
  const q = p.pallet;

  /* The packer may have turned the pallet 90 degrees. Work out which way it
     went by seeing which deck edge the placed footprint matches, then swap
     the whole grid to suit. */
  const turned = Math.abs(p.l - q.deckW) < Math.abs(p.l - q.deckL);
  const deckL = turned ? q.deckW : q.deckL;
  const deckW = turned ? q.deckL : q.deckW;
  const cols = turned ? q.rows : q.cols;
  const rows = turned ? q.cols : q.rows;
  const itemL = turned ? q.itemW : q.itemL;
  const itemW = turned ? q.itemL : q.itemW;

  // Centre the deck in the placed footprint; the surplus is handling clearance.
  const ox = p.x + (p.l - deckL) / 2;
  const oy = p.y + (p.w - deckW) / 2;

  const deck = { x: ox, y: oy, z: p.z, l: deckL, w: deckW, h: q.deck };

  const units = [];
  let left = q.count;
  const layers = Math.ceil(q.count / q.perLayer);
  for (let layer = 0; layer < layers && left > 0; layer++) {
    const z = p.z + q.deck + layer * q.itemH;
    for (let r = 0; r < rows && left > 0; r++) {
      for (let c = 0; c < cols && left > 0; c++) {
        units.push({ x: ox + c * itemL, y: oy + r * itemW, z, l: itemL, w: itemW, h: q.itemH });
        left--;
      }
    }
  }
  return { deck, units };
}

export function isoScene(load, vehicle, { width = 520, height = 330, pad = 20, labels = true } = {}) {
  const scene = newScene(width, height);
  const fit = fitter(vehicleCorners(vehicle), width, height, pad);
  const P = (x, y, z) => fit.map(...iso(x, y, z));
  const L = vehicle.length;
  const W = vehicle.width;
  const H = vehicle.height;

  // Back walls, then floor, then grid — everything the cargo sits in front of.
  scene.poly([P(0, 0, 0), P(L, 0, 0), P(L, 0, H), P(0, 0, H)], { fill: 'bg', shade: 1, stroke: 'border', strokeWidth: 0.5 });
  scene.poly([P(0, 0, 0), P(0, W, 0), P(0, W, H), P(0, 0, H)], { fill: 'bg', shade: 0.96, stroke: 'border', strokeWidth: 0.5 });
  scene.poly([P(0, 0, 0), P(L, 0, 0), P(L, W, 0), P(0, W, 0)], { fill: 'surface', shade: 1, stroke: 'border', strokeWidth: 0.6 });

  for (let x = 1; x < L - 1e-6; x += 1) scene.line(P(x, 0, 0), P(x, W, 0), { color: 'border', width: 0.4 });
  for (let y = 1; y < W - 1e-6; y += 1) scene.line(P(0, y, 0), P(L, y, 0), { color: 'border', width: 0.4 });

  // Cargo, far to near.
  const showContents = palletUnitCount(load) <= MAX_DRAWN_UNITS;
  const sorted = [...load.placements].sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z));

  /* One box, three visible faces: top, near end, near side. */
  const box = (b, c, opts = {}) => {
    const x0 = b.x; const x1 = b.x + b.l;
    const y0 = b.y; const y1 = b.y + b.w;
    const z0 = b.z; const z1 = b.z + b.h;
    const common = { stroke: opts.stroke || 'surface', strokeWidth: opts.strokeWidth || 0.5, dash: opts.dash || null, opacity: opts.opacity };
    scene.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], { fill: c, shade: 1, ...common });
    scene.poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], { fill: c, shade: 0.78, ...common });
    scene.poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], { fill: c, shade: 0.58, ...common });
  };

  for (const p of sorted) {
    const c = tokenFor(p.rowIndex);
    const parts = showContents ? palletParts(p) : null;

    if (parts) {
      /* Deck first, in muted timber tones with a dotted edge, then the units
         standing on it painted far-to-near so the near ones overlap correctly. */
      box(parts.deck, 'text-muted', { stroke: 'text-muted', strokeWidth: 0.7, dash: [2.5, 2], opacity: 0.55 });
      const near = [...parts.units].sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z));
      for (const u of near) box(u, c, { strokeWidth: 0.4 });
    } else {
      box(shown(p), c);
    }

    if (labels) {
      const q = parts ? p : shown(p);
      const mid = P(q.x + q.l / 2, q.y + q.w / 2, q.z + q.h);
      scene.label(mid[0], mid[1] + 3, String(p.no), { size: 8, color: 'surface', align: 'center', weight: 'bold' });
    }
  }

  // Vehicle envelope on top so the headroom stays legible.
  const edges = [
    [[0, 0, H], [L, 0, H]], [[L, 0, H], [L, W, H]], [[L, W, H], [0, W, H]], [[0, W, H], [0, 0, H]],
    [[L, 0, 0], [L, 0, H]], [[L, W, 0], [L, W, H]], [[0, W, 0], [0, W, H]],
    [[L, 0, 0], [L, W, 0]], [[0, W, 0], [L, W, 0]],
  ];
  for (const [a, b] of edges) scene.line(P(...a), P(...b), { color: 'text-muted', width: 0.5, dash: [3, 3] });
  return scene;
}

/* ------------------------------------------------------------------ *
 * Plan view — the drawing a loading crew actually uses
 * ------------------------------------------------------------------ */

export function planScene(load, vehicle, { width = 520, height = 190, pad = 26, labels = true } = {}) {
  const scene = newScene(width, height);
  const L = vehicle.length;
  const W = vehicle.width;
  const fit = fitter([[0, 0], [L, 0], [L, W], [0, W]], width, height, pad);
  const P = (x, y) => fit.map(x, y);

  scene.poly([P(0, 0), P(L, 0), P(L, W), P(0, W)], { fill: 'bg', shade: 1, stroke: 'border', strokeWidth: 0.8 });

  // Lowest tier solid, anything stacked above outlined so both stay readable.
  const showContents = palletUnitCount(load) <= MAX_DRAWN_UNITS;
  const sorted = [...load.placements].sort((a, b) => a.z - b.z);
  for (const p of sorted) {
    const c = tokenFor(p.rowIndex);
    const upper = p.z > 1e-6;
    const parts = showContents ? palletParts(p) : null;

    if (parts) {
      // Deck outline dotted, then one layer of units seen from above.
      const d = parts.deck;
      scene.poly([P(d.x, d.y), P(d.x + d.l, d.y), P(d.x + d.l, d.y + d.w), P(d.x, d.y + d.w)], {
        fill: 'bg', shade: 1, opacity: upper ? 0.3 : 0.7,
        stroke: 'text-muted', strokeWidth: 0.9, dash: [2.5, 2],
      });
      const top = parts.units.filter((u) => Math.abs(u.z - parts.units[0].z) < 1e-6);
      for (const u of top) {
        scene.poly([P(u.x, u.y), P(u.x + u.l, u.y), P(u.x + u.l, u.y + u.w), P(u.x, u.y + u.w)], {
          fill: c, shade: upper ? 1 : 0.9, opacity: upper ? 0.45 : 1,
          stroke: 'surface', strokeWidth: 0.4,
        });
      }
    } else {
      const b = shown(p);
      scene.poly([P(b.x, b.y), P(b.x + b.l, b.y), P(b.x + b.l, b.y + b.w), P(b.x, b.y + b.w)], {
        fill: c,
        shade: upper ? 1 : 0.9,
        opacity: upper ? 0.45 : 1,
        stroke: upper ? c : 'surface',
        strokeWidth: upper ? 1 : 0.6,
        dash: upper ? [2, 2] : null,
      });
    }

    if (labels) {
      const q = parts ? p : shown(p);
      const mid = P(q.x + q.l / 2, q.y + q.w / 2);
      scene.label(mid[0], mid[1] + 3, String(p.no), { size: 8, color: upper || parts ? 'text' : 'surface', align: 'center', weight: 'bold' });
    }
  }

  // Length scale along the bottom.
  const base = P(0, W)[1] + 13;
  const step = Math.max(1, Math.round(L / 12));
  scene.line([P(0, 0)[0], base], [P(L, 0)[0], base], { color: 'text-muted', width: 0.5 });
  for (let x = 0; x <= L + 1e-6; x += step) {
    const sx = P(x, 0)[0];
    scene.line([sx, base - 3], [sx, base + 3], { color: 'text-muted', width: 0.5 });
    scene.label(sx, base + 13, `${x}`, { size: 6.5, color: 'text-muted', align: 'center' });
  }
  scene.label(P(L / 2, 0)[0], base + 25, 'metres from nose', { size: 6.5, color: 'text-muted', align: 'center' });

  // Centre of gravity.
  const cgx = P(load.cg, 0)[0];
  scene.line([cgx, P(0, 0)[1] - 9], [cgx, P(0, W)[1] + 4], { color: 'danger', width: 1, dash: [4, 2] });
  scene.label(cgx, P(0, 0)[1] - 13, `CG ${load.cgPercent}%`, { size: 6.5, color: 'danger', align: 'center', weight: 'bold' });
  return scene;
}

/* ------------------------------------------------------------------ *
 * Side elevation — stacking tiers and headroom
 * ------------------------------------------------------------------ */

export function elevationScene(load, vehicle, { width = 520, height = 190, pad = 26, labels = true } = {}) {
  const scene = newScene(width, height);
  const L = vehicle.length;
  const H = vehicle.height;
  const fit = fitter([[0, 0], [L, 0], [L, H], [0, H]], width, height, pad);
  const P = (x, z) => fit.map(x, H - z); // flip so z points up

  scene.poly([P(0, 0), P(L, 0), P(L, H), P(0, H)], { fill: 'bg', shade: 1, stroke: 'border', strokeWidth: 0.8 });

  const sorted = [...load.placements].sort((a, b) => b.y - a.y);
  for (const p of sorted) {
    const c = tokenFor(p.rowIndex);
    const b = shown(p);
    scene.poly([P(b.x, b.z), P(b.x + b.l, b.z), P(b.x + b.l, b.z + b.h), P(b.x, b.z + b.h)], {
      fill: c, shade: 0.9, opacity: 0.85, stroke: 'surface', strokeWidth: 0.6,
    });
    if (labels) {
      const mid = P(b.x + b.l / 2, b.z + b.h / 2);
      scene.label(mid[0], mid[1] + 3, String(p.no), { size: 7.5, color: 'surface', align: 'center', weight: 'bold' });
    }
  }

  const top = P(0, H);
  scene.label(top[0], top[1] - 6, `Internal height ${vehicle.height.toFixed(2)} m`, { size: 6.5, color: 'text-muted', align: 'left' });
  if (load.usedHeight < H - 0.05) {
    const line = P(0, load.usedHeight)[1];
    scene.line([P(0, 0)[0], line], [P(L, 0)[0], line], { color: 'success', width: 0.7, dash: [4, 3] });
    scene.label(P(L, 0)[0], line - 5, `load height ${load.usedHeight.toFixed(2)} m`, { size: 6.5, color: 'success', align: 'right' });
  }
  return scene;
}

/* ------------------------------------------------------------------ *
 * SVG renderer
 * ------------------------------------------------------------------ */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const anchor = (align) => (align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start');

/**
 * Render a scene to an SVG string. Face shading is a flat overlay of
 * --color-text, so every colour on screen still comes from a token.
 * `minFont` is the smallest label size in drawing units; the page raises it
 * so the labels stay readable when the drawing is shown small.
 */
export function sceneToSvg(scene, title = '', minFont = 0) {
  const out = [
    `<svg viewBox="0 0 ${scene.width} ${scene.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">`,
  ];
  if (title) out.push(`<title>${esc(title)}</title>`);

  for (const it of scene.items) {
    if (it.type === 'poly') {
      const pts = it.pts.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(' ');
      const shade = it.shade ?? 1;
      out.push(
        `<polygon points="${pts}" fill="var(--color-${it.fill})" fill-opacity="${(it.opacity ?? 1).toFixed(2)}"` +
        (it.stroke ? ` stroke="var(--color-${it.stroke})" stroke-width="${it.strokeWidth ?? 0.5}"` : ' stroke="none"') +
        (it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : '') + ' />'
      );
      if (shade < 0.999) {
        out.push(`<polygon points="${pts}" fill="var(--color-text)" fill-opacity="${((1 - shade) * 0.6).toFixed(3)}" stroke="none" />`);
      }
    } else if (it.type === 'line') {
      out.push(
        `<line x1="${it.a[0].toFixed(2)}" y1="${it.a[1].toFixed(2)}" x2="${it.b[0].toFixed(2)}" y2="${it.b[1].toFixed(2)}" ` +
        `stroke="var(--color-${it.color})" stroke-width="${it.width ?? 0.5}"` +
        (it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : '') + ' />'
      );
    } else {
      out.push(
        `<text x="${it.x.toFixed(2)}" y="${it.y.toFixed(2)}" font-size="${Math.max(it.size, minFont)}" fill="var(--color-${it.color})" ` +
        `text-anchor="${anchor(it.align)}" font-family="var(--font-mono)"` +
        (it.weight === 'bold' ? ' font-weight="600"' : '') + `>${esc(it.text)}</text>`
      );
    }
  }
  out.push('</svg>');
  return out.join('');
}
