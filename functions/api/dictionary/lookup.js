/**
 * POST /api/dictionary/lookup
 * Body: { term, sentence?, domain? }
 *
 * Three-tier resolution:
 *   1. Approved knowledge_terms node   -> source: "kg",    status: "approved"
 *   2. Cached approved dictionary row  -> source: cached,  status: "approved"
 *   3. Workers AI                      -> source: "ai",    status: "pending"
 *
 * Tier 3 results are written back as pending and rendered as unverified.
 * `connection` and `origin` are stored but never returned until approved.
 *
 * Requires a signed-in account. _middleware.js does not gate /api/*, so
 * without this check an anonymous visitor could spend Workers AI quota at
 * will. Loosen it only if the overlay goes onto a public tool page.
 */

import { json } from '../../_lib.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_TERM_LENGTH = 48;
const MAX_TERM_WORDS = 4;
const ALLOWED_DOMAINS = ['general', 'english', 'hvac', 'business'];

/* ------------------------------------------------------------------ *
 * ADAPTER — the only block that depends on the knowledge graph schema.
 * If column names differ, change them here and nowhere else. A mismatch
 * throws, is caught, and the request degrades to tier 2 rather than 500.
 * ------------------------------------------------------------------ */
const KG_SQL = `
  SELECT n.id     AS node_id,
         n.title  AS term,
         n.summary AS meaning
  FROM knowledge_terms t
  JOIN knowledge_nodes n ON n.id = t.node_id
  WHERE t.term = ?1 AND n.status = 'approved'
  LIMIT 1
`;

export async function onRequestPost(context) {
  const { request, env, data } = context;

  if (!data?.user) {
    return json({ error: 'Sign in to use the dictionary.' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const term = String(body.term || '').trim();
  const sentence = String(body.sentence || '').trim().slice(0, 400);
  const domain = ALLOWED_DOMAINS.includes(body.domain) ? body.domain : 'general';

  const termKey = normalise(term);
  if (!termKey) {
    return json({ error: 'Select a word to look up.' }, 400);
  }
  if (term.length > MAX_TERM_LENGTH || termKey.split(' ').length > MAX_TERM_WORDS) {
    return json({ error: 'Select up to four words.' }, 400);
  }

  const userEmail = data.user.email || data.user.id || null;

  /* Tier 1 — knowledge graph -------------------------------------- */
  try {
    const node = await env.DB.prepare(KG_SQL).bind(termKey).first();
    if (node && node.meaning) {
      return json({
        term: node.term || term,
        domain,
        status: 'approved',
        source: 'kg',
        meaning: node.meaning,
        usage: [],
        senses: [],
        related: null,
        memoryHook: null,
        connection: null,
        origin: null
      });
    }
  } catch (err) {
    console.log('dictionary: knowledge graph tier skipped —', err.message);
  }

  /* Tier 2 — approved cache --------------------------------------- */
  const cached = await env.DB.prepare(
    `SELECT * FROM dictionary_entries
     WHERE term_key = ?1 AND domain = ?2 AND status = 'approved'
     LIMIT 1`
  ).bind(termKey, domain).first();

  if (cached) {
    return json(shape(cached, true));
  }

  /* Tier 2b — already pending: serve it, don't pay for it twice ---- */
  const pending = await env.DB.prepare(
    `SELECT * FROM dictionary_entries
     WHERE term_key = ?1 AND domain = ?2 AND status = 'pending'
     LIMIT 1`
  ).bind(termKey, domain).first();

  if (pending) {
    return json(shape(pending, false));
  }

  /* Tier 3 — Workers AI ------------------------------------------- */
  let generated;
  try {
    generated = await generate(env, term, sentence, domain);
  } catch (err) {
    console.log('dictionary: generation failed —', err.message);
    await logOutcome(env, termKey, domain, null, 'unanswered', userEmail, request);
    return json({ error: "That word couldn't be looked up just now. Try again in a moment." }, 502);
  }

  if (!generated || !generated.meaning) {
    await logOutcome(env, termKey, domain, null, 'unanswered', userEmail, request);
    return json({ error: 'No clear meaning found for that selection.' }, 404);
  }

  const insert = await env.DB.prepare(
    `INSERT INTO dictionary_entries
       (term, term_key, domain, meaning, usage_json, senses_json, related_json,
        memory_hook, connection, origin, source, status, model, context_seen, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'ai', 'pending', ?11, ?12, ?13)
     ON CONFLICT (term_key, domain) DO NOTHING`
  ).bind(
    term,
    termKey,
    domain,
    generated.meaning,
    stringifyOrNull(generated.usage),
    stringifyOrNull(generated.senses),
    stringifyOrNull(generated.related),
    generated.memoryHook,
    generated.connection,
    generated.origin,
    MODEL,
    sentence || null,
    userEmail
  ).run();

  return json({
    term,
    domain,
    status: 'pending',
    source: 'ai',
    entryId: insert?.meta?.last_row_id || null,
    meaning: generated.meaning,
    usage: generated.usage || [],
    senses: generated.senses || [],
    related: generated.related || null,
    memoryHook: generated.memoryHook || null,
    // Withheld by design until a human approves the row.
    connection: null,
    origin: null
  });
}

/* ------------------------------------------------------------------ */

async function generate(env, term, sentence, domain) {
  const domainLine = {
    general: 'General everyday English.',
    english: 'School English literature and comprehension reading.',
    hvac: 'HVAC and MEP engineering (AHUs, FCUs, chillers, VRF, submittals, standards).',
    business: 'Business process, tendering and project delivery.'
  }[domain];

  const system = [
    'You explain words so a reader understands and remembers them.',
    'Return ONLY a JSON object. No markdown, no code fences, no preamble.',
    '',
    'Schema (every key required, use null when a field is not worth showing):',
    '{',
    '  "meaning": string,            // one or two plain sentences, everyday language',
    '  "usage": string[] | null,     // 1-2 natural example sentences',
    '  "senses": [{"field": string, "sense": string}] | null,',
    '  "related": {"synonyms": string[], "antonyms": string[], "concepts": string[]} | null,',
    '  "memoryHook": string | null,',
    '  "connection": string | null,',
    '  "origin": string | null',
    '}',
    '',
    'Rules:',
    '- Prefer null over filler. Most words do not need every field.',
    '- "senses" only when the word genuinely changes meaning across fields.',
    '- Never invent people, events, quotes, dates, etymologies or facts.',
    '  If you are not certain something is true, set that field to null.',
    '- No current-affairs or news claims of any kind.',
    '- Keep every string under 220 characters.'
  ].join('\n');

  const user = [
    `Word or phrase: "${term}"`,
    `Reading context: ${domainLine}`,
    sentence ? `Sentence it appeared in: "${sentence}"` : 'No surrounding sentence available.',
    sentence ? 'Explain the sense used in that sentence first.' : ''
  ].filter(Boolean).join('\n');

  const res = await env.AI.run(MODEL, {
    max_tokens: 700,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });

  return parseModelJson(res?.response || '');
}

function parseModelJson(raw) {
  let text = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  return {
    meaning: cleanString(parsed.meaning),
    usage: cleanArray(parsed.usage),
    senses: cleanSenses(parsed.senses),
    related: cleanRelated(parsed.related),
    memoryHook: cleanString(parsed.memoryHook),
    connection: cleanString(parsed.connection),
    origin: cleanString(parsed.origin)
  };
}

function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed === '-') return null;
  return trimmed.slice(0, 240);
}

function cleanArray(value) {
  if (!Array.isArray(value)) return null;
  const items = value.map(cleanString).filter(Boolean).slice(0, 3);
  return items.length ? items : null;
}

function cleanSenses(value) {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => {
      const field = cleanString(item?.field);
      const sense = cleanString(item?.sense);
      return field && sense ? { field, sense } : null;
    })
    .filter(Boolean)
    .slice(0, 4);
  return items.length ? items : null;
}

function cleanRelated(value) {
  if (!value || typeof value !== 'object') return null;
  const related = {
    synonyms: cleanArray(value.synonyms) || [],
    antonyms: cleanArray(value.antonyms) || [],
    concepts: cleanArray(value.concepts) || []
  };
  const total = related.synonyms.length + related.antonyms.length + related.concepts.length;
  return total ? related : null;
}

function shape(row, approved) {
  return {
    term: row.term,
    domain: row.domain,
    status: row.status,
    source: approved ? 'cache' : 'ai',
    entryId: row.id,
    meaning: row.meaning,
    usage: parseOr(row.usage_json, []),
    senses: parseOr(row.senses_json, []),
    related: parseOr(row.related_json, null),
    memoryHook: row.memory_hook || null,
    connection: approved ? (row.connection || null) : null,
    origin: approved ? (row.origin || null) : null
  };
}

function parseOr(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyOrNull(value) {
  if (!value) return null;
  if (Array.isArray(value) && !value.length) return null;
  return JSON.stringify(value);
}

async function logOutcome(env, termKey, domain, entryId, outcome, userEmail, request) {
  try {
    await env.DB.prepare(
      `INSERT INTO dictionary_lookups (term_key, domain, entry_id, outcome, page_path, user_email)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(termKey, domain, entryId, outcome, new URL(request.url).pathname, userEmail).run();
  } catch (err) {
    console.log('dictionary: outcome log failed —', err.message);
  }
}

export function normalise(term) {
  return String(term || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^['\-]+|['\-]+$/g, '')
    .trim();
}
