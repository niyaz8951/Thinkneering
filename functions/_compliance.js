// Thinkneering — Compliance Maker server helpers.
//
// The tool arrived with its own `_auth.js` (its own cookie name, its own
// `users.compliance_mode` column, its own admin endpoint to set it). None of
// that is needed here: this site already has a session layer and an access
// model, and re-implementing them alongside would give the same question two
// answers. So this file keeps the tool's helper NAMES — the endpoints import
// the same symbols they always did — but every one of them now delegates to
// _lib.js and the catalogue.
//
// The one rule worth stating plainly: WHO GETS AI is no longer a private
// column. It is the `ai-review` item in the `compliance-maker` section, so
// it is granted the same way as anything else on the site — by plan, or by
// an explicit grant in /admin/. Nothing here to keep in sync.

import { json as libJson, currentUser, canAccess, loadGrants, strictest } from './_lib.js';

export const json = libJson;

// Page budget per tier. Guests get enough to try the tool on a real
// document; the rest is behind an account.
export const GUEST_PAGES = 10;
export const MEMBER_PAGES = 50;

// The tool's old requireUser() returned null for anyone who couldn't be
// served, so callers just check for null. Same contract here, on top of the
// site's session: _middleware.js has already resolved the user for every
// /api/ request, so the common path costs no extra query.
export async function requireUser(context) {
  let user = context.data && context.data.user;
  if (user === undefined) user = await currentUser(context.env, context.request);
  if (!user || user.suspended || user.status !== 'active') return null;
  return user;
}

// True if this visitor may open the given item in the Compliance Maker
// section — the same call the catalogue makes to decide whether to draw the
// card unlocked, so the page and the API can never disagree.
export async function itemAllowed(context, user, grants, itemSlug) {
  const row = await context.env.DB.prepare(
    `SELECT i.id, i.access_level, i.required_plan, s.access_level AS section_level
       FROM items i JOIN sections s ON s.id = i.section_id
      WHERE s.slug = 'compliance-maker' AND s.parent_id IS NULL AND i.slug = ?1`
  ).bind(itemSlug).first();
  // Item deleted or renamed in /admin/: fail closed for everyone but admins,
  // rather than silently opening the feature to all signed-in users.
  if (!row) return !!user && user.role === 'admin';
  return canAccess(
    user,
    strictest(row.access_level, row.section_level),
    row.required_plan,
    grants,
    'item:' + row.id
  );
}

// The single tier decision, used by the page (GET /api/compliance/access)
// and re-checked inside every endpoint that needs it.
//   guest  — signed out: convert + highlight, GUEST_PAGES, no network work
//   member — signed in: + library pre-fill, conflicts, answer log
//   pro    — member + the `ai-review` item: + datasheet, AI suggestions
export async function complianceTier(context) {
  const user = await requireUser(context);
  if (!user) return { signedIn: false, tier: 'guest', maxPages: GUEST_PAGES, ai: false };
  const grants = await loadGrants(context.env, user);
  const ai = await itemAllowed(context, user, grants, 'ai-review');
  // Teaching is a SEPARATE grant from using. Someone can be trusted to run
  // AI review on their own work without being trusted to decide what every
  // other user's answers should look like — which is what submitting a
  // completed matrix does.
  const canTrain = await itemAllowed(context, user, grants, 'training');
  return {
    signedIn: true,
    tier: ai ? 'pro' : 'member',
    maxPages: MEMBER_PAGES,
    ai,
    canTrain,
    plan: user.plan,
  };
}

// Wraps a handler so ANY uncaught error returns clean JSON instead of
// Cloudflare's HTML error page — without this, a client calling .json() on
// the response sees "Unexpected token '<'" rather than a readable message.
export function withErrorHandling(handler) {
  return async function (context) {
    try {
      return await handler(context);
    } catch (err) {
      console.error('[compliance]', (err && err.stack) || err);
      return json({ error: (err && err.message) || 'Internal error — check the Functions logs.' }, 500);
    }
  };
}

export const PRODUCTS = ['AHU', 'FCU', 'Air Cooled Chiller'];

// Factory is NOT a fixed pair shared by every product — each product has its
// own real factories and they don't overlap consistently. This is the single
// source of truth; the client's Factory dropdown mirrors it exactly.
export const PRODUCT_FACTORIES = {
  'AHU': ['UAE', 'KSA'],
  'FCU': ['China'],
  'Air Cooled Chiller': ['Italy', 'KSA'],
};

export function isValidFactory(product, factory) {
  const list = PRODUCT_FACTORIES[product];
  return !!list && list.indexOf(factory) !== -1;
}

// One D1 table per (product, factory) PAIR. Table names are ALWAYS derived
// here from already-validated values — the hardcoded PRODUCT_FACTORIES
// membership check above is what makes a string-built SQL identifier safe,
// since no raw request string ever reaches the query unless it first matched
// a fixed, known-good value.
const PRODUCT_SLUG = { 'AHU': 'ahu', 'FCU': 'fcu', 'Air Cooled Chiller': 'chiller' };
export function answerLogTable(product, factory) {
  if (!isValidFactory(product, factory)) return null;
  return 'answer_log_' + PRODUCT_SLUG[product] + '_' + factory.toLowerCase();
}

/* ==========================================================================
   LEARNED KNOWLEDGE — retrieval
   --------------------------------------------------------------------------
   Nothing about a product or a factory is written in code. Facts and section
   profiles are rows in D1, and both tables start empty: with nothing on file
   the prompt says so plainly and the model works from the datasheet and the
   library alone. That is the correct cold-start behaviour — an empty
   knowledge base should make the AI more cautious, not make it invent.

   Retrieval is token overlap, not embeddings. It is crude but it is honest
   about being crude, needs no extra service, and can be swapped for
   embeddings later without changing any caller.
   ========================================================================== */

// Same normalisation on both sides of every comparison.
function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(t => t.length > 2);
}

export function normPath(p) {
  return String(p || '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*>\s*/g, ' > ').trim();
}

// Trusted facts only. A 'draft' fact has been learned but not confirmed
// enough to be quoted at a consultant, and 'blocked' means an admin has
// ruled it out — neither belongs in a prompt.
export async function loadFacts(context, product, factory) {
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT topic, label, value, source FROM compliance_facts
        WHERE product = ?1 AND factory = ?2 AND status = 'trusted'
        ORDER BY confirmations DESC, updated_at DESC LIMIT 300`
    ).bind(product, factory).all();
    return results || [];
  } catch (err) {
    // Before db/compliance.sql has been run there is no knowledge base —
    // which is the same situation as an empty one, and the prompt already
    // handles that honestly. Not a reason to fail the request.
    if (!isMissingTable(err)) throw err;
    return [];
  }
}

// The facts worth showing THIS batch. Scored against the clauses actually
// being answered, so a casing clause doesn't carry the filter facts along
// with it and eat the context window.
export function pickFacts(clauseTexts, facts, limit = 10) {
  if (!facts.length) return [];
  const want = new Set();
  clauseTexts.forEach(t => tokens(t).forEach(w => want.add(w)));
  return facts
    .map(f => {
      const ft = tokens(f.topic + ' ' + f.label + ' ' + f.value);
      let hits = 0;
      for (const w of ft) if (want.has(w)) hits++;
      return { fact: f, score: ft.length ? hits / Math.sqrt(ft.length) : 0 };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.fact);
}

// Profiles for the paths in this batch. Exact match first; failing that the
// longest stored path that is a prefix of the clause's path, so a brand new
// "2.07 DAMPERS" still inherits what is known about "PART 2 PRODUCTS".
export async function loadSectionProfiles(context, product, factory, paths) {
  const wanted = [...new Set(paths.map(normPath).filter(Boolean))];
  if (!wanted.length) return new Map();
  let results = [];
  try {
    ({ results } = await context.env.DB.prepare(
      `SELECT path_norm, path_label, summary, typical_status, n_answers
         FROM compliance_sections
        WHERE product = ?1 AND factory = ?2 AND status <> 'blocked' AND summary <> ''
        ORDER BY length(path_norm) DESC LIMIT 500`
    ).bind(product, factory).all());
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return new Map();
  }

  const out = new Map();
  for (const path of wanted) {
    const exact = (results || []).find(r => r.path_norm === path);
    if (exact) { out.set(path, exact); continue; }
    const prefix = (results || []).find(r => path.startsWith(r.path_norm + ' >'));
    if (prefix) out.set(path, prefix);
  }
  return out;
}

// The reference-data block for the system prompt. When the knowledge base is
// empty this returns the sentence that matters most: there is nothing on
// file, so do not pretend otherwise.
export function factsBlock(product, factory, facts) {
  if (!facts.length) {
    return `No reference data is on file for ${product} / ${factory} yet. ` +
      `You have the selection datasheet and past verified answers and nothing else — ` +
      `do not state any configuration detail that neither of them supports.`;
  }
  return `REFERENCE DATA ON FILE for ${product} / ${factory} — confirmed by your team, ` +
    `not by you. The selection datasheet always overrides it. Cite it as standard ` +
    `configuration; never extend it by inference:\n` +
    facts.map(f => `- ${f.topic ? f.topic + ' • ' : ''}${f.label}: ${f.value}` +
      (f.source ? ` (source: ${f.source})` : '')).join('\n');
}

// True when D1 is complaining that a table doesn't exist. The answer-log
// tables come from db/compliance.sql, which is a manual migration step —
// until it has been run, every signed-in conversion would otherwise surface
// a raw "D1_ERROR: no such table" where a plain sentence belongs, and the
// conflict check would take the whole conversion down with it. A tool that
// works apart from one un-migrated feature should say so and carry on.
export function isMissingTable(err) {
  return /no such table/i.test(String((err && err.message) || err));
}

export const SETUP_HINT =
  'The answer log has not been set up on this database yet. Run ' +
  'db/compliance.sql against it (wrangler d1 execute … --remote) and try again.';

// Roll section profiles up from the answer log. Shared by the admin button
// and by the training ingest, so a submitted matrix updates the profiles
// immediately instead of waiting for someone to remember to press rebuild.
//
// AI-SOURCED ROWS ARE EXCLUDED. This is the line that keeps the whole loop
// honest: learning from unconfirmed AI output is how a tool like this drifts
// steadily wrong while looking more and more confident. Only library, rule
// and human-confirmed answers count.
export async function rebuildSections(context, product, factory, actorId) {
  const table = answerLogTable(product, factory);
  if (!table) return 0;

  let results = [];
  try {
    ({ results } = await context.env.DB.prepare(
      `SELECT path, compliance, spec_text FROM ${table}
        WHERE path IS NOT NULL AND path <> '' AND source NOT LIKE 'ai%'`
    ).all());
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return 0;
  }

  const groups = new Map();
  for (const r of results || []) {
    const key = normPath(r.path);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { label: r.path, statuses: {}, samples: [], n: 0 });
    const g = groups.get(key);
    g.n++;
    const st = String(r.compliance || '').replace(/^\[GUESS\]\s*/, '').trim();
    if (st) g.statuses[st] = (g.statuses[st] || 0) + 1;
    if (g.samples.length < 6) g.samples.push(String(r.spec_text || '').slice(0, 240));
  }
  if (!groups.size) return 0;

  const stmt = context.env.DB.prepare(
    `INSERT INTO compliance_sections
       (id,product,factory,path_norm,path_label,typical_status,sample_clauses,n_answers,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,datetime('now'))
     ON CONFLICT(product,factory,path_norm) DO UPDATE SET
       path_label=?5, typical_status=?6, sample_clauses=?7, n_answers=?8, updated_at=datetime('now')`
  );
  const batch = [];
  for (const [key, g] of groups) {
    const typical = Object.entries(g.statuses).sort((a, b) => b[1] - a[1])[0];
    batch.push(stmt.bind('csec_' + crypto.randomUUID().slice(0, 12), product, factory, key, g.label,
      typical ? typical[0] : '', JSON.stringify(g.samples), g.n));
  }
  await context.env.DB.batch(batch);
  return batch.length;
}
