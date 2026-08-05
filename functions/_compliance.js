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
  return {
    signedIn: true,
    tier: ai ? 'pro' : 'member',
    maxPages: MEMBER_PAGES,
    ai,
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
  const { results } = await context.env.DB.prepare(
    `SELECT topic, label, value, source FROM compliance_facts
      WHERE product = ?1 AND factory = ?2 AND status = 'trusted'
      ORDER BY confirmations DESC, updated_at DESC LIMIT 300`
  ).bind(product, factory).all();
  return results || [];
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
  const { results } = await context.env.DB.prepare(
    `SELECT path_norm, path_label, summary, typical_status, n_answers
       FROM compliance_sections
      WHERE product = ?1 AND factory = ?2 AND status <> 'blocked' AND summary <> ''
      ORDER BY length(path_norm) DESC LIMIT 500`
  ).bind(product, factory).all();

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
