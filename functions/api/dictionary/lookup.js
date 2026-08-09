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
import { normaliseTerm, singular } from '../../_lib/knowledge.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_TERM_LENGTH = 48;
const MAX_TERM_WORDS = 4;
const ALLOWED_DOMAINS = ['general', 'english', 'hvac', 'business'];

/* ------------------------------------------------------------------ *
 * Tier 1 — the knowledge graph.
 *
 * Scoped three ways on purpose:
 *   - same domain, so an HVAC node never answers an English lookup
 *   - visible to this user, using the same predicate as visibleMaps()
 *   - Dictionary maps rank above other maps, then by term weight
 *
 * knowledge_terms was built with normaliseTerm(), so the lookup key has to
 * be built the same way. That is a different normaliser from the one used
 * for dictionary_entries.term_key, which keeps accented characters.
 * ------------------------------------------------------------------ */
const KG_SQL = `
  SELECT n.id      AS node_id,
         n.title   AS term,
         n.summary AS meaning,
         m.id      AS map_id,
         m.title   AS map_title
  FROM knowledge_terms t
  JOIN knowledge_nodes n ON n.id = t.node_id
  JOIN knowledge_maps  m ON m.id = t.map_id
  LEFT JOIN knowledge_map_access a ON a.map_id = m.id AND a.user_id = ?2
  WHERE t.term = ?1
    AND n.status = 'approved'
    AND m.status = 'active'
    AND m.domain = ?3
    AND (a.user_id IS NOT NULL OR m.visibility = 'org' OR m.owner_id = ?2)
  ORDER BY (m.slug LIKE 'dictionary-%') DESC, t.weight DESC
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
  const uid = data.user.id || data.user.user_id || data.user.email;
  try {
    const graphKey = normaliseTerm(term);
    let node = await env.DB.prepare(KG_SQL).bind(graphKey, uid, domain).first();

    // "filters" should still find a node titled "Air filter".
    if (!node) {
      const stem = graphKey.split(' ').map(singular).join(' ');
      if (stem !== graphKey) {
        node = await env.DB.prepare(KG_SQL).bind(stem, uid, domain).first();
      }
    }

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
        origin: null,
        mapId: node.map_id,
        mapTitle: node.map_title
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
    'Answer in the given JSON shape only.',
    '',
    'Rules:',
    '- meaning: one or two plain sentences in everyday language. Always fill this.',
    '- Leave any other field as an empty string or empty array when it is not',
    '  worth showing. Most words do not need every field. Empty is expected.',
    '- senses: only when the word genuinely changes meaning across fields.',
    '- Never invent people, events, quotes, dates, etymologies or facts.',
    '  If you are not certain something is true, leave that field empty.',
    '- No current-affairs or news claims of any kind.',
    '- Keep every string under 220 characters.'
  ].join('\n');

  const user = [
    `Word or phrase: "${term}"`,
    `Reading context: ${domainLine}`,
    sentence ? `Sentence it appeared in: "${sentence}"` : 'No surrounding sentence available.',
    sentence ? 'Explain the sense used in that sentence first.' : ''
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];

  // Second pass runs warmer. A cold model that has decided to return nothing
  // will keep returning nothing; a small nudge is usually enough.
  for (const temperature of [0.2, 0.5]) {
    let res;
    try {
      res = await env.AI.run(MODEL, {
        messages,
        max_tokens: 700,
        temperature,
        // JSON Mode constrains the output grammar at the API level instead of
        // relying on the prompt. Without it an 8B model returns prose or a
        // fenced block often enough that lookups fail outright.
        //
        // Every optional field is a plain string or array rather than a
        // nullable one: the grammar subset does not take union types, and an
        // empty value carries the same "not worth showing" meaning.
        response_format: {
          type: 'json_schema',
          json_schema: {
            type: 'object',
            properties: {
              meaning: { type: 'string' },
              usage: { type: 'array', maxItems: 2, items: { type: 'string' } },
              senses: {
                type: 'array',
                maxItems: 3,
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    sense: { type: 'string' }
                  },
                  required: ['field', 'sense']
                }
              },
              synonyms: { type: 'array', maxItems: 4, items: { type: 'string' } },
              antonyms: { type: 'array', maxItems: 4, items: { type: 'string' } },
              concepts: { type: 'array', maxItems: 4, items: { type: 'string' } },
              memoryHook: { type: 'string' },
              origin: { type: 'string' },
              connection: { type: 'string' }
            },
            required: ['meaning']
          }
        }
      });
    } catch (err) {
      // A thrown call will throw again on retry — usually the daily free
      // allocation, which resets at 00:00 UTC. Stop rather than burn it.
      throw new Error('AI request failed: ' + (err.message || 'unknown'));
    }

    const parsed = readResponse(res);
    if (parsed && parsed.meaning) return parsed;
  }

  return null;
}

/**
 * JSON Mode hands back an already-parsed object on the happy path, and a
 * string when it falls through. Both shapes have to be handled — treating
 * the object as text is what turned every lookup into "no clear meaning".
 */
function readResponse(res) {
  if (!res) return null;

  const payload = res.response;
  if (payload && typeof payload === 'object') return shapeGenerated(payload);

  const raw = typeof payload === 'string' ? payload : (res.result || '');
  let text = String(raw).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  try {
    return shapeGenerated(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function shapeGenerated(parsed) {
  // The flat schema is rebuilt into the nested shape the client renders.
  const related = cleanRelated({
    synonyms: parsed.synonyms,
    antonyms: parsed.antonyms,
    concepts: parsed.concepts
  }) || cleanRelated(parsed.related);

  return {
    meaning: cleanString(parsed.meaning),
    usage: cleanArray(parsed.usage),
    senses: cleanSenses(parsed.senses),
    related,
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
    origin: approved ? (row.origin || null) : null,
    mapId: approved ? (row.map_id || null) : null,
    mapTitle: null
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
