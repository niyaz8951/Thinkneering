// functions/_kb.js
// ============================================================================
// THE PRODUCT KNOWLEDGE BASE
// ----------------------------------------------------------------------------
// One module replacing four that grew separately — the unit-section list, the
// standard offering, the glossary, and the comparison rules. They were all
// describing the same thing from different angles: what this product is made
// of, what we offer for each part, what the terms mean, and how to judge a
// value against a requirement. Splitting that across four tables meant four
// admin screens, four downloads, and four chances for the same fact to
// disagree with itself.
//
// One row is one answerable thing:
//
//   AHU / Panel       / Insulation : ["62 mm Foam", "42 mm Foam"]
//   AHU / Fan Section / Fan type   : ["EC plug fan (EBM)", "DIDW fan (Nicotra)"]
//
// The first option is the default — what gets quoted when no datasheet says
// otherwise. Reordering that array in the exported sheet is the whole editing
// gesture: no status column to interpret, no flag to tick.
// ============================================================================

import { isMissingTable } from './_compliance.js';

export function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function kbPath(product, section, attribute) {
  return [norm(product), norm(section), norm(attribute)].join('|');
}

function parseOptions(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];
  } catch { return []; }
}

// ---------------------------------------------------------------- defaults
// Comparison direction is engineering semantics, not factory data: thicker
// insulation is better wherever it is made, and EN1886 defines TB1 as the best
// class for everybody. These seed a row's direction when a datasheet teaches
// us an attribute we have never seen; an admin edit always wins afterwards.
const DIRECTION_HINTS = [
  [/thick|insulat|gauge|skin|panel/i, 'higher', ''],
  [/pressure drop|resistance/i, 'lower', ''],
  [/leak|tightness/i, 'lower', ''],
  [/sound|noise|acoustic/i, 'lower', ''],
  [/efficien|sfp/i, 'higher', ''],
  [/velocity/i, 'lower', ''],
  [/thermal bridg/i, 'higher', 'TB5,TB4,TB3,TB2,TB1'],
  [/transmittance|u.?value/i, 'higher', 'T5,T4,T3,T2,T1'],
  [/casing strength|deflection/i, 'higher', 'D3,D2,D1'],
  [/casing leak/i, 'higher', 'L3,L2,L1'],
  [/filter class|filtration/i, 'higher', 'G1,G2,G3,G4,M5,M6,F7,F8,F9,H10,H11,H12,H13,H14'],
  [/voltage|phase|connection/i, 'exact', ''],
];

function guessDirection(section, attribute) {
  const hay = section + ' ' + attribute;
  for (const [re, dir, scale] of DIRECTION_HINTS) if (re.test(hay)) return { direction: dir, scale };
  return { direction: 'unknown', scale: '' };
}

// Datasheet labels arrive as "Filter Supply • Filter Class" or plain
// "Panel • Insulation". Split them into the section / attribute shape rather
// than storing the raw label, so the sheet reads like a product breakdown
// instead of a dump of whatever the PDF happened to call things.
export function splitLabel(label) {
  const parts = String(label || '').split('\u2022').map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const section = parts[0].replace(/\s+(supply|return|extract)$/i, '').trim();
    return { section: section || 'Unit', attribute: parts.slice(1).join(' ').trim() };
  }
  return { section: 'Unit', attribute: parts[0] || String(label || '').trim() };
}

// Fields that describe ONE job rather than the product range. They would add
// a row per project and bury the real options under serial numbers.
const SKIP_RE = /(serial|reference|ref\.|project|unit name|material name|date|drawing|order|quotation|tag|position|weight|air ?flow|flow design|capacity|temp|humidity|rpm|current|cog|centre of gravity|note)/i;

// ------------------------------------------------------------------ learn
// Every datasheet read teaches the KB. New attributes arrive as drafts; a new
// value for a known attribute is appended as an option, never promoted over a
// default someone chose by hand.
export async function learnFromDatasheet(context, product, fields) {
  const rows = new Map();
  for (const f of (Array.isArray(fields) ? fields : [])) {
    const label = String(f.label || '').trim();
    const value = String(f.value || '').trim();
    if (!label || !value || value.length > 120 || SKIP_RE.test(label)) continue;
    const { section, attribute } = splitLabel(label);
    if (!attribute) continue;
    rows.set(kbPath(product, section, attribute), { section, attribute, value });
  }
  if (!rows.size) return 0;

  let existing = [];
  try {
    const ph = [...rows.keys()].map((_, i) => '?' + (i + 1)).join(',');
    ({ results: existing } = await context.env.DB.prepare(
      `SELECT id, path_norm, options FROM compliance_kb WHERE path_norm IN (${ph})`
    ).bind(...rows.keys()).all());
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return 0;
  }
  const byPath = new Map((existing || []).map(r => [r.path_norm, r]));

  const stmts = [];
  for (const [path, r] of rows) {
    const prior = byPath.get(path);
    if (prior) {
      const opts = parseOptions(prior.options);
      // Already known: nothing to write but the sighting count. A value we
      // have seen before must not jump the queue ahead of the default.
      if (opts.some(o => norm(o) === norm(r.value))) {
        stmts.push(context.env.DB.prepare(
          `UPDATE compliance_kb SET times_seen = times_seen + 1, updated_at = datetime('now') WHERE id = ?1`
        ).bind(prior.id));
      } else {
        opts.push(r.value);
        stmts.push(context.env.DB.prepare(
          `UPDATE compliance_kb SET options = ?2, times_seen = times_seen + 1, updated_at = datetime('now') WHERE id = ?1`
        ).bind(prior.id, JSON.stringify(opts.slice(0, 12))));
      }
    } else {
      const g = guessDirection(r.section, r.attribute);
      stmts.push(context.env.DB.prepare(
        `INSERT INTO compliance_kb
           (id, product, section, attribute, path_norm, options, aliases, direction, scale_order, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,datetime('now'))
         ON CONFLICT(path_norm) DO UPDATE SET times_seen = times_seen + 1, updated_at = datetime('now')`
      ).bind('kb_' + crypto.randomUUID().slice(0, 12), product, r.section, r.attribute, path,
             JSON.stringify([r.value]), norm(r.attribute), g.direction, g.scale));
    }
  }
  try {
    for (let i = 0; i < stmts.length; i += 100) await context.env.DB.batch(stmts.slice(i, i + 100));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return 0;
  }
  return rows.size;
}

// -------------------------------------------------------------------- read
export async function loadKb(context, product) {
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT * FROM compliance_kb WHERE product = ?1 AND status <> 'blocked'
        ORDER BY section, attribute LIMIT 600`
    ).bind(product).all();
    return (results || []).map(r => ({
      id: r.id, section: r.section, attribute: r.attribute,
      options: parseOptions(r.options), definition: r.definition,
      aliases: r.aliases, unit: r.unit, direction: r.direction,
      scale: r.scale_order, timesSeen: r.times_seen, status: r.status,
    }));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return [];
  }
}

// ------------------------------------------------------------- clause match
// Which KB entries a clause is about. Section and attribute words both count,
// so a casing clause reaches Panel/Insulation and a fan clause does not.
function tokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2));
}

const SYNONYMS = [
  ['casing', 'casings', 'panel', 'panels', 'skin', 'wall', 'enclosure', 'module', 'modules'],
  ['thickness', 'thick', 'depth', 'gauge', 'insulation', 'insulated'],
  ['filter', 'filters', 'filtration'],
  ['fan', 'fans', 'blower', 'impeller', 'plenum'],
  ['coil', 'coils'],
  ['motor', 'motors', 'drive'],
  ['damper', 'dampers'],
  ['door', 'doors', 'access', 'hinge', 'hinges'],
  ['drain', 'tray', 'pan'],
  ['frame', 'framework', 'profile'],
  ['control', 'controls', 'controller', 'bms'],
];

function expand(set) {
  const out = new Set(set);
  for (const w of set) for (const g of SYNONYMS) if (g.includes(w)) g.forEach(x => out.add(x));
  return out;
}

export function kbForClause(clauseText, kb, limit = 5) {
  const want = expand(tokens(clauseText));
  return kb
    .map(e => {
      const et = tokens(e.section + ' ' + e.attribute + ' ' + (e.aliases || ''));
      let hits = 0;
      for (const w of et) if (want.has(w)) hits++;
      return { e, score: et.size ? hits / Math.sqrt(et.size) : 0 };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.e);
}

// ------------------------------------------------------------------ render
// What the AI sees for a clause. Default first and labelled as such, because
// that is the value it should quote; the alternatives are there so it can say
// "we also offer X" instead of "not compliant".
export function kbLines(entries) {
  if (!entries.length) return '';
  return entries.map(e => {
    const [def, ...rest] = e.options;
    if (!def) return '';
    return `    - ${e.section} / ${e.attribute}: ${def} (standard)` +
      (rest.length ? `; we can also supply ${rest.join('; ')}` : '') +
      (e.definition ? ` — ${e.definition}` : '');
  }).filter(Boolean).join('\n');
}
