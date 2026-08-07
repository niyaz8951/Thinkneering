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
    if (!groups.has(key)) groups.set(key, { label: r.path, statuses: {}, samples: [], rows: [], n: 0 });
    const g = groups.get(key);
    g.n++;
    const st = String(r.compliance || '').replace(/^\[GUESS\]\s*/, '').trim();
    if (st) g.statuses[st] = (g.statuses[st] || 0) + 1;
    if (g.samples.length < 6) g.samples.push(String(r.spec_text || '').slice(0, 240));
    // Kept for classification: what KIND of section this is depends on the
    // clause wording and the statuses together, not on the counts alone.
    if (g.rows.length < 60) g.rows.push({ compliance: st, spec_text: r.spec_text });
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

  // Classify each section while we already have its confirmed answers in
  // hand — the two rollups read exactly the same rows.
  try { await learnSpecTopics(context, product, groups); }
  catch (err) { console.error('[compliance] spec-topic classification:', err && err.message); }

  return batch.length;
}

/* ==========================================================================
   UNIT SECTION CATALOGUE
   --------------------------------------------------------------------------
   What sections a product can physically have — Mixing Box, Filter, Coil
   Cooling DX, Fan, Empty Section — learned from the selection reports people
   upload, never typed into code.

   Two payoffs. First, datasheet values stop crossing between sections, so a
   casing clause is never answered with the cooling coil's tube thickness.
   Second, the model can tell whether a clause is even ABOUT something this
   unit has, instead of assuming every requirement applies.

   New sections arrive as 'draft' and an admin promotes them. A datasheet is
   evidence, not authority: one badly parsed PDF should not be able to teach
   the system that "Page 4/12" is a section of an air handling unit.
   ========================================================================== */

export function normSectionName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function learnUnitSections(context, product, names) {
  const clean = [...new Set(
    (Array.isArray(names) ? names : [])
      .map(n => String(n || '').replace(/\s+/g, ' ').trim())
      .filter(n => n.length >= 4 && n.length <= 60)
  )].slice(0, 30);
  if (!clean.length) return 0;

  const stmt = context.env.DB.prepare(
    `INSERT INTO compliance_unit_sections (id, product, name_norm, name, times_seen, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1, datetime('now'))
     ON CONFLICT(product, name_norm) DO UPDATE SET
       times_seen = times_seen + 1, name = ?4, updated_at = datetime('now')`
  );
  try {
    await context.env.DB.batch(clean.map(n =>
      stmt.bind('cus_' + crypto.randomUUID().slice(0, 12), product, normSectionName(n), n)));
    return clean.length;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return 0;
  }
}

export async function loadUnitSections(context, product) {
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT name, name_norm, notes, status, times_seen FROM compliance_unit_sections
        WHERE product = ?1 AND status <> 'blocked'
        ORDER BY times_seen DESC LIMIT 60`
    ).bind(product).all();
    return results || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return [];
  }
}

// The prompt block. Says what this unit HAS, what the product can have but
// this unit does NOT, and what to do about the difference.
export function unitSectionsBlock(product, present, catalogue) {
  if (!present.length && !catalogue.length) return '';
  const here = present.map(n => String(n).trim()).filter(Boolean);
  const hereNorm = new Set(here.map(normSectionName));
  // Only sections an admin has confirmed are used to assert an absence.
  const absent = catalogue
    .filter(c => c.status === 'trusted' && !hereNorm.has(c.name_norm))
    .map(c => c.name + (c.notes ? ' (' + c.notes + ')' : ''));

  let out = '\nUNIT CONFIGURATION\n';
  if (here.length) {
    out += `The selected unit is built from these sections, in order: ${here.join(', ')}.\n` +
      `Datasheet values are labelled with the section they belong to. A value from one ` +
      `section NEVER describes another — the coil's tube thickness is not the casing's ` +
      `panel thickness, whatever the clause asks about.\n`;
  }
  if (absent.length) {
    out += `Sections a ${product} can have but THIS unit does not: ${absent.join(', ')}.\n` +
      `If a clause requires one of these, the selected unit does not include it. You may ` +
      `NOT answer Comply on configuration grounds. Unless a past verified answer shows how ` +
      `such a clause is normally answered, use TO VERIFY and name the section that is ` +
      `missing — the absence is a commercial question, not a technical one you can settle.\n`;
  }
  return out;
}

/* ==========================================================================
   VOCABULARY
   --------------------------------------------------------------------------
   Terms the tool has met, and what is known about them generally.

   THE BOUNDARY, restated because it is the whole point: nothing here is ever
   a SOURCE for an answer. General market knowledge is not this factory's
   data, and a consultant is being told what THIS unit is. Vocabulary earns
   its place by improving RETRIEVAL — connecting a clause's words to the right
   datasheet field — and by letting the tool warn a human when a value looks
   unusual. It never writes a remark.
   ========================================================================== */

// Candidate terms out of a clause. Deliberately narrow: acronyms, and the
// label a clause leads with ("Casings:", "Filters:"). Broad noun-phrase
// extraction produced mostly noise, and a review queue nobody reads is worse
// than no queue at all.
const STOP_TERMS = new Set([
  'THE', 'AND', 'FOR', 'WITH', 'SHALL', 'ALL', 'ANY', 'NOT', 'PART', 'SECTION',
  'END', 'OF', 'GENERAL', 'PRODUCTS', 'EXECUTION', 'WORK', 'PROVIDE',
]);

export function candidateTerms(clauseText) {
  const text = String(clauseText || '');
  const out = new Set();
  // Acronyms and standards: AHRI, ASHRAE, EUROVENT, BMS, EN1886.
  (text.match(/\b[A-Z]{2,10}(?:\s?\d{2,5})?\b/g) || []).forEach((t) => {
    const base = t.trim();
    if (!STOP_TERMS.has(base.replace(/\s?\d+$/, ''))) out.add(base);
  });
  // The leading label of a clause: "Casings: Component modules shall be..."
  const lead = text.match(/^([A-Z][A-Za-z /-]{2,40}):/);
  if (lead) out.add(lead[1].trim());
  return [...out].slice(0, 12);
}

// Record terms as seen. Nothing is described here — description costs an AI
// call and is an admin action, so discovery stays free and silent.
export async function noteTerms(context, product, terms) {
  const clean = [...new Set((terms || []).map(t => String(t).trim()).filter(t => t.length >= 2 && t.length <= 60))];
  if (!clean.length) return 0;
  const stmt = context.env.DB.prepare(
    `INSERT INTO compliance_terms (id, product, term, term_norm, times_seen, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1, datetime('now'))
     ON CONFLICT(product, term_norm) DO UPDATE SET
       times_seen = times_seen + 1, updated_at = datetime('now')`
  );
  try {
    await context.env.DB.batch(clean.map(t =>
      stmt.bind('ctm_' + crypto.randomUUID().slice(0, 12), product, t, normSectionName(t))));
    return clean.length;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return 0;
  }
}

// Confirmed vocabulary only. Drafts describe themselves from the model's
// general knowledge and are not yet anyone's opinion but the machine's.
export async function loadTerms(context, product) {
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT term, term_norm, kind, definition, aliases, typical_range,
              range_min, range_max, range_unit
         FROM compliance_terms
        WHERE product = ?1 AND status = 'trusted'
        ORDER BY times_seen DESC LIMIT 200`
    ).bind(product).all();
    return results || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return [];
  }
}

// Confirmed aliases, as synonym groups the field matcher can use. This is
// what lets the hardcoded TERM_GROUPS list stop growing: a term confirmed in
// /admin/ extends the matcher at runtime, no deploy needed.
export function aliasGroups(terms) {
  return terms
    .filter(t => t.aliases && t.aliases.trim())
    .map(t => [t.term_norm].concat(t.aliases.split(',').map(a => normSectionName(a)))
      .filter(Boolean));
}

// Plausibility. Returns a note for a HUMAN when a value sits outside what is
// normal in the market — never a correction, and never anything the model is
// invited to repeat as fact. A range being unusual is a reason to look, not
// a reason to change the answer.
export function plausibilityNote(terms, label, value) {
  const nums = String(value || '').match(/(\d+(?:\.\d+)?)\s*([a-z%°]+)/i);
  if (!nums) return '';
  const n = parseFloat(nums[1]);
  const unit = nums[2].toLowerCase();
  const hay = normSectionName(label);
  for (const t of terms) {
    if (t.range_min == null || t.range_max == null) continue;
    if (String(t.range_unit || '').toLowerCase() !== unit) continue;
    const names = [t.term_norm].concat(String(t.aliases || '').split(',').map(a => normSectionName(a)));
    if (!names.some(nm => nm && hay.includes(nm))) continue;
    if (n < t.range_min || n > t.range_max) {
      return `${label} is ${nums[0]}, outside the usual ${t.typical_range} for ${t.term}. Worth a look.`;
    }
  }
  return '';
}

/* ==========================================================================
   SPEC-TOPIC CLASSIFICATION (the specification side of the knowledge tree)
   --------------------------------------------------------------------------
   A datasheet and a specification are different documents asking different
   things, and until now the tool treated every clause identically.
   A specification section is one of:
     product     — a requirement about the equipment. Answer from the
                   datasheet and the library.
     contractor  — site execution. Not a technical question at all; it is a
                   scope-of-supply answer with fixed wording.
     reference   — standards, certification, submittals. Answer from the
                   library and facts, NEVER from a datasheet measurement,
                   because a dimension does not answer "is it certified".
     unknown     — too few confirmed answers to say.

   This matters because "shall be 50 mm" means different things in each. In a
   product topic it is a value to check against the unit. Inside an
   installation clause it is somebody else's problem, and answering it from
   the datasheet is confidently answering the wrong question.

   Learned from CONFIRMED answers only — same rule as everything else.
   ========================================================================== */

const CONTRACTOR_RE = /\b(by\s+contractor|by\s+others)\b/i;
const STANDARD_RE = /\b(AHRI|ASHRAE|EUROVENT|ISO|ASTM|NFPA|SASO|SMACNA|UL|DIN|BS\s?EN|EN\s?\d{3,5})\b/;

// Enough agreement to act on, and enough evidence to trust it.
const SCOPE_SHARE = 0.6;
const AUTO_TRUST_AT = 5;

function classifyTopic(rows) {
  const n = rows.length;
  if (n < 2) return { scope: 'unknown', n };
  const contractor = rows.filter(r => CONTRACTOR_RE.test(r.compliance || '')).length;
  if (contractor / n >= SCOPE_SHARE) return { scope: 'contractor', n };
  const standards = rows.filter(r => STANDARD_RE.test(r.spec_text || '')).length;
  if (standards / n >= SCOPE_SHARE) return { scope: 'reference', n };
  return { scope: 'product', n };
}

// Called from rebuildSections so a submitted matrix classifies its own
// sections. Promotes draft -> trusted once a topic has enough confirmed
// answers behind it, and never touches a node an admin has blocked.
export async function learnSpecTopics(context, product, groups) {
  const rows = [];
  for (const [key, g] of groups) {
    const { scope, n } = classifyTopic(g.rows);
    if (scope === 'unknown') continue;
    rows.push({ key, label: g.label, scope, n });
  }
  if (!rows.length) return 0;

  const stmt = context.env.DB.prepare(
    `INSERT INTO compliance_tree (id, product, kind, name, name_norm, scope, times_seen, status, updated_at)
     VALUES (?1, ?2, 'spec-topic', ?3, ?4, ?5, ?6, ?7, datetime('now'))
     ON CONFLICT(product, kind, name_norm) DO UPDATE SET
       name = ?3,
       times_seen = ?6,
       -- An admin's decision outranks the statistics: only a node still
       -- sitting at 'draft' is reclassified or promoted.
       scope  = CASE WHEN status = 'draft' THEN ?5 ELSE scope END,
       status = CASE WHEN status = 'draft' AND ?6 >= ${AUTO_TRUST_AT} THEN 'trusted' ELSE status END,
       updated_at = datetime('now')`
  );
  try {
    await context.env.DB.batch(rows.map(r => stmt.bind(
      'ctree_' + crypto.randomUUID().slice(0, 12), product, r.label, r.key, r.scope, r.n,
      r.n >= AUTO_TRUST_AT ? 'trusted' : 'draft')));
    return rows.length;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return 0;
  }
}

export async function loadSpecTopics(context, product) {
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT name, name_norm, scope, notes, times_seen FROM compliance_tree
        WHERE product = ?1 AND kind = 'spec-topic' AND status = 'trusted'
        ORDER BY length(name_norm) DESC LIMIT 400`
    ).bind(product).all();
    return results || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return [];
  }
}

// Exact path first, then the longest stored path that is a prefix, so a new
// subsection inherits its parent's classification.
export function topicForPath(topics, path) {
  const p = normPath(path);
  if (!p) return null;
  return topics.find(t => t.name_norm === p) ||
         topics.find(t => p.startsWith(t.name_norm + ' >')) || null;
}

const SCOPE_GUIDANCE = {
  contractor: 'This section is SITE EXECUTION work. It is not a technical question about the ' +
    'equipment: answer By Contractor with the fixed wording, and do not check any measurement ' +
    'in it against the datasheet.',
  reference: 'This section is about STANDARDS, CERTIFICATION or SUBMITTALS. Answer from past ' +
    'verified answers and reference data. A datasheet dimension does not answer whether ' +
    'something is certified — do not use one here.',
  product: 'This section is a REQUIREMENT ABOUT THE EQUIPMENT. Check it against the datasheet ' +
    'fields for this clause first, then past verified answers.',
};

export function topicLine(topic) {
  if (!topic || !SCOPE_GUIDANCE[topic.scope]) return '';
  return `\n  Kind of section (learned from ${topic.times_seen} confirmed answer(s)): ` +
    `${topic.scope.toUpperCase()}. ${SCOPE_GUIDANCE[topic.scope]}` +
    (topic.notes ? ` ${topic.notes}` : '');
}

/* ==========================================================================
   COMPARISON DIRECTION — is this value better or worse than what was asked?
   --------------------------------------------------------------------------
   Reading "clause wants 50 mm, unit has 62 mm" is not enough to answer. For
   panel thickness more is better and 62 SATISFIES the requirement; for
   pressure drop more is worse; for a thermal bridging class TB2 beats TB3 and
   the digits run backwards. The tool answered Not Comply on a compliant unit
   because nothing here knew which way was up.

   The defaults below are ENGINEERING SEMANTICS AND PUBLISHED STANDARD
   SCALES, not facts about anyone's factory — thicker insulation is better
   wherever it is made, and EN1886 defines TB1 as the best class for
   everybody. They are shipped so the tool is useful on day one, and every
   one of them is overridden by a row in compliance_criteria for that
   product. If a default is wrong for you, add the criterion in /admin/ and
   it wins.
   ========================================================================== */

const DEFAULT_CRITERIA = [
  { name: 'Panel / casing thickness', terms: 'panel,casing,skin,wall,thickness,insulation', direction: 'higher', unit: 'mm' },
  { name: 'Insulation thickness', terms: 'insulation,thermal,acoustic,foam,polyurethane', direction: 'higher', unit: 'mm' },
  { name: 'Sheet / tube gauge', terms: 'gauge,sheet,tube,fin,plate', direction: 'higher', unit: 'mm' },
  { name: 'Thermal transmittance (U value)', terms: 'thermal coefficient,u value,transmittance,w/m', direction: 'lower', unit: '' },
  { name: 'Pressure drop', terms: 'pressure drop,resistance', direction: 'lower', unit: 'pa' },
  { name: 'Leakage', terms: 'leakage,leak,air tightness', direction: 'lower', unit: '%' },
  { name: 'Sound power', terms: 'sound,noise,acoustic level,db', direction: 'lower', unit: '' },
  { name: 'Efficiency', terms: 'efficiency,efficient,sfp', direction: 'higher', unit: '%' },
  { name: 'Air flow', terms: 'air flow,airflow,flow rate,capacity', direction: 'higher', unit: '' },
  { name: 'Air velocity', terms: 'velocity,face velocity', direction: 'lower', unit: '' },
  { name: 'Motor power', terms: 'motor power,absorbed power,power input', direction: 'lower', unit: 'kw' },
  { name: 'Voltage / electrical supply', terms: 'voltage,volt,phase,supply', direction: 'exact', unit: '' },

  // Classed scales from EN1886 and EN779/ISO16890. Published standards, not
  // anyone's product data. Stored worst -> best because the digits do not
  // agree on a direction: TB1 is the best thermal bridging class, F9 is a
  // better filter than F7.
  { name: 'Thermal bridging class (EN1886)', terms: 'thermal bridging,tb class,tb', direction: 'higher', unit: '', scale: 'TB5,TB4,TB3,TB2,TB1' },
  { name: 'Thermal transmittance class (EN1886)', terms: 'transmittance class,t class', direction: 'higher', unit: '', scale: 'T5,T4,T3,T2,T1' },
  { name: 'Casing strength class (EN1886)', terms: 'casing strength,mechanical strength,d class', direction: 'higher', unit: '', scale: 'D3,D2,D1' },
  { name: 'Casing leakage class (EN1886)', terms: 'casing leakage,l class', direction: 'higher', unit: '', scale: 'L3,L2,L1' },
  { name: 'Filter class (EN779)', terms: 'filter class,filtration,filter grade', direction: 'higher', unit: '', scale: 'G1,G2,G3,G4,M5,M6,F7,F8,F9,H10,H11,H12,H13,H14' },
];

export async function loadCriteria(context, product) {
  let rows = [];
  try {
    ({ results: rows } = await context.env.DB.prepare(
      `SELECT name, name_norm, match_terms, direction, unit, scale_order, notes
         FROM compliance_criteria WHERE product = ?1 AND status = 'trusted' LIMIT 200`
    ).bind(product).all());
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    rows = [];
  }
  const custom = (rows || []).map(r => ({
    name: r.name,
    terms: String(r.match_terms || ''),
    direction: r.direction,
    unit: String(r.unit || '').toLowerCase(),
    scale: String(r.scale_order || ''),
    notes: r.notes || '',
    custom: true,
  }));
  // A configured criterion of the same name replaces its default.
  const taken = new Set(custom.map(c => normSectionName(c.name)));
  return custom.concat(DEFAULT_CRITERIA.filter(d => !taken.has(normSectionName(d.name))));
}

// Which criterion a piece of text is about. Longest matching term wins, so
// "thermal bridging" beats a bare "thermal".
export function matchCriterion(text, criteria, unit) {
  const hay = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  let best = null, bestLen = 0;
  for (const c of criteria) {
    if (c.unit && unit && c.unit !== unit) continue;
    for (const t of String(c.terms || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
      if (t.length > bestLen && hay.includes(' ' + t) ) { best = c; bestLen = t.length; }
    }
  }
  return best;
}

// Classed values: TB2, F7, D1, H13.
const CLASS_RE = /\b(TB[1-5]|T[1-5]|D[1-3]|L[1-3]|[GMFH]\d{1,2})\b/g;
export function classTokens(text) {
  return [...new Set(String(text || '').toUpperCase().match(CLASS_RE) || [])];
}

// The verdict, computed rather than left to the model. Returns null when the
// direction is not established — and that is a real answer, not a failure:
// it tells the prompt to stop short of a conclusion.
export function compareValues(required, actual, criterion) {
  if (!criterion || criterion.direction === 'unknown') return null;
  if (criterion.direction === 'exact') {
    return required === actual
      ? { ok: true, why: 'matches the required value exactly' }
      : { ok: false, why: 'differs from the required value, which must be matched exactly' };
  }
  const better = criterion.direction === 'higher';
  if (actual === required) return { ok: true, why: 'is exactly the required value' };
  const actualBetter = better ? actual > required : actual < required;
  return actualBetter
    ? { ok: true, why: `is ${better ? 'greater' : 'lower'} than required, which is BETTER for ${criterion.name.toLowerCase()} — the requirement is satisfied` }
    : { ok: false, why: `is ${better ? 'lower' : 'greater'} than required, which is WORSE for ${criterion.name.toLowerCase()} — the requirement is not met` };
}

// Same, for classed values, using the stored worst -> best order.
export function compareClasses(requiredTok, actualTok, criterion) {
  if (!criterion || !criterion.scale) return null;
  const order = String(criterion.scale).split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  const ri = order.indexOf(String(requiredTok).toUpperCase());
  const ai = order.indexOf(String(actualTok).toUpperCase());
  if (ri < 0 || ai < 0) return null;
  if (ai === ri) return { ok: true, why: `is the required class` };
  return ai > ri
    ? { ok: true, why: `is a BETTER class than ${requiredTok} on the ${criterion.name} scale — the requirement is satisfied` }
    : { ok: false, why: `is a WORSE class than ${requiredTok} on the ${criterion.name} scale — the requirement is not met` };
}

/* ==========================================================================
   STANDARD OFFERING — what the factory builds, learned from every datasheet
   --------------------------------------------------------------------------
   A selection report describes one unit and is then discarded. Across many
   reports the same fields recur with a small set of values, and that set is
   the product range. Recording it lets the tool answer a casing clause with
   no datasheet attached — from the standard offering rather than from
   nothing, which until now meant TO VERIFY.

   PRIORITY IS UNCHANGED AND MUST STAY THAT WAY: an attached datasheet
   describes the unit actually selected for this project and always wins. The
   offering is what we can build, not what was bought.
   ========================================================================== */

function valueNorm(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Fields worth remembering. Anything unique to one job is noise here: it
// accumulates a row per project and never repeats, so it would bury the real
// options under serial numbers and job weights.
const OPTION_SKIP_RE = /(serial|reference|ref\.|project|unit name|material name|date|drawing|order|quotation|tag|position|weight|air ?flow|flow design|capacity|temp|humidity|rpm|current|cog|centre of gravity)/i;

export async function learnOptions(context, product, fields) {
  const clean = (Array.isArray(fields) ? fields : [])
    .map(f => ({ label: String(f.label || '').trim().slice(0, 120), value: String(f.value || '').trim().slice(0, 200) }))
    .filter(f => f.label && f.value && f.value.length <= 120 && !OPTION_SKIP_RE.test(f.label))
    .slice(0, 120);
  if (!clean.length) return 0;

  const stmt = context.env.DB.prepare(
    `INSERT INTO compliance_options (id, product, field, field_norm, value, value_norm, times_seen, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, datetime('now'))
     ON CONFLICT(product, field_norm, value_norm) DO UPDATE SET
       times_seen = times_seen + 1, field = ?3, value = ?5, updated_at = datetime('now')`
  );
  try {
    await context.env.DB.batch(clean.map(f => stmt.bind(
      'copt_' + crypto.randomUUID().slice(0, 12), product,
      f.label, normSectionName(f.label), f.value, valueNorm(f.value))));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return 0;
  }

  // The most-seen value becomes the default for its field, unless a human
  // has already chosen one. Re-uploading the exported sheet is how that
  // choice is made, and this must never overwrite it.
  try {
    await context.env.DB.prepare(
      `UPDATE compliance_options SET is_default = 1
        WHERE product = ?1
          AND field_norm IN (SELECT field_norm FROM compliance_options
                              WHERE product = ?1
                              GROUP BY field_norm HAVING SUM(is_default) = 0)
          AND id IN (SELECT id FROM compliance_options o2
                      WHERE o2.product = ?1 AND o2.field_norm = compliance_options.field_norm
                      ORDER BY times_seen DESC, updated_at DESC LIMIT 1)`
    ).bind(product).run();
  } catch { /* defaults can be set later; the values are already saved */ }

  return clean.length;
}

// Grouped by field, default first. Blocked rows never leave the database.
export async function loadOptions(context, product) {
  let rows = [];
  try {
    ({ results: rows } = await context.env.DB.prepare(
      `SELECT field, field_norm, value, is_default, times_seen, status
         FROM compliance_options
        WHERE product = ?1 AND status <> 'blocked'
        ORDER BY field_norm, is_default DESC, times_seen DESC LIMIT 1200`
    ).bind(product).all());
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return [];
  }
  const byField = new Map();
  for (const r of rows || []) {
    if (!byField.has(r.field_norm)) byField.set(r.field_norm, { field: r.field, values: [] });
    byField.get(r.field_norm).values.push(r);
  }
  return [...byField.values()];
}

// The prompt block. Only fields confirmed by an admin, or seen on more than
// one unit, are offered — a value seen exactly once is as likely to be a
// project quirk as a standard offering, and quoting it as the standard is the
// kind of confident wrongness this system exists to avoid.
export function offeringBlock(product, grouped, hasDatasheet, limit = 40) {
  const usable = grouped
    .map(g => ({ field: g.field, values: g.values.filter(v => v.status === 'trusted' || v.times_seen > 1) }))
    .filter(g => g.values.length)
    .slice(0, limit);
  if (!usable.length) return '';

  const lines = usable.map(g => {
    const def = g.values.find(v => v.is_default) || g.values[0];
    const others = g.values.filter(v => v !== def).map(v => v.value);
    return `- ${g.field}: ${def.value}` +
      (others.length ? ` (standard). Also available: ${others.join('; ')}` : ' (standard)');
  });

  return `\nSTANDARD OFFERING for ${product} — what this factory builds, gathered from ` +
    `past selection reports:\n${lines.join('\n')}\n` +
    (hasDatasheet
      ? `THE ATTACHED DATASHEET OVERRIDES ALL OF THIS. It describes the unit actually selected ` +
        `for this project; the list above is only what could be selected. Use it only for a ` +
        `property the datasheet does not state.\n`
      : `No datasheet is attached, so this is your best source for what the unit will be. ` +
        `Quote the standard value. If the standard value does not meet the clause but a listed ` +
        `option does, say so and name the option — that is a real Comply, not a deviation. ` +
        `Mark these answers verified: false, because no project selection has confirmed them.\n`);
}
