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
