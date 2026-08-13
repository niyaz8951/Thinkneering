/**
 * POST /api/dictionary/lookup
 * Body: { term, sentence?, domain? }
 *
 * Three-tier resolution:
 *   1. Approved dictionary entry       -> source: cached,  status: "approved"
 *   2. Approved knowledge_terms node   -> source: "kg",    status: "approved"
 *   3. Workers AI                      -> source: "ai",    status: "pending"
 *
 * Tier 3 results are written back as pending and rendered as unverified.
 * `connection` and `origin` are stored but never returned until approved.
 *
 * Tier 3 is two AI calls, not one: the entry, and then the Urdu word on its
 * own. See generateUrdu() for why they cannot share a call.
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
 * Tier 2 — the knowledge graph.
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

async function handleLookup(context) {
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
  const book = body.book ? String(body.book).slice(0, 120) : null;

  const termKey = normalise(term);
  if (!termKey) {
    return json({ error: 'Select a word to look up.' }, 400);
  }
  if (term.length > MAX_TERM_LENGTH || termKey.split(' ').length > MAX_TERM_WORDS) {
    return json({ error: 'Select up to four words.' }, 400);
  }

  const userEmail = data.user.email || data.user.id || null;

  // An admin is shown the withheld fields on an unapproved entry. Approving
  // from the reader would otherwise mean publishing an origin and a
  // connection nobody had read — the exact claims the model invents most
  // freely. Readers still never see them until the row is approved.
  const admin = data.user.role === 'admin';

  /* Tier 1 — this word's own approved entry ------------------------
   *
   * The dictionary row is checked before the graph, and that order matters.
   * Approving a word writes a node whose summary is the meaning and nothing
   * else, so a graph-first lookup answered every approved word with one
   * sentence and threw away the scripts, examples, senses, origin and hook
   * that were sitting in dictionary_entries. Approving a word made its entry
   * worse, which was exactly backwards.
   */
  const cached = await env.DB.prepare(
    `SELECT * FROM dictionary_entries
     WHERE term_key = ?1 AND domain = ?2 AND status = 'approved'
     LIMIT 1`
  ).bind(termKey, domain).first();

  if (cached) {
    await logOutcome(env, termKey, domain, cached.id, 'served', userEmail, request, book);
    return json(shape(cached, true, admin));
  }

  /* Tier 2 — the knowledge graph -----------------------------------
   *
   * Reached only for terms with no dictionary entry of their own: an
   * engineering node someone wrote by hand, say. One sentence is all such a
   * node holds, so one sentence is all this can return.
   */
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
      await logOutcome(env, termKey, domain, null, 'served', userEmail, request, book);
      return json({
        isAdmin: admin,
        term: node.term || term,
        domain,
        status: 'approved',
        source: 'kg',
        meaning: node.meaning,
        usage: [],
        senses: [],
        related: null,
        memoryHook: null,
        hindi: null,
        urdu: null,
        urduRoman: null,
        connection: null,
        origin: null,
        mapId: node.map_id,
        mapTitle: node.map_title
      });
    }
  } catch (err) {
    console.log('dictionary: knowledge graph tier skipped —', err.message);
  }

  /* Tier 2b — already pending: serve it, don't pay for it twice ---- */
  const pending = await env.DB.prepare(
    `SELECT * FROM dictionary_entries
     WHERE term_key = ?1 AND domain = ?2 AND status = 'pending'
     LIMIT 1`
  ).bind(termKey, domain).first();

  if (pending) {
    await logOutcome(env, termKey, domain, pending.id, 'served', userEmail, request, book);
    return json(shape(pending, false, admin));
  }

  /* Tier 3 — Workers AI ------------------------------------------- */
  let generated;
  try {
    generated = await generate(env, term, sentence, domain);
  } catch (err) {
    console.log('dictionary: generation failed —', err.message);
    await logOutcome(env, termKey, domain, null, 'unanswered', userEmail, request, book);
    return json({ error: "That word couldn't be looked up just now. Try again in a moment." }, 502);
  }

  if (!generated || !generated.meaning) {
    await logOutcome(env, termKey, domain, null, 'unanswered', userEmail, request, book);
    return json({ error: 'No clear meaning found for that selection.' }, 404);
  }

  const insert = await env.DB.prepare(
    `INSERT INTO dictionary_entries
       (term, term_key, domain, meaning, usage_json, senses_json, related_json,
        memory_hook, connection, origin, hindi, urdu, urdu_roman,
        source, status, model, context_seen, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
             'ai', 'pending', ?14, ?15, ?16)
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
    generated.hindi,
    generated.urdu,
    generated.urduRoman,
    MODEL,
    sentence || null,
    userEmail
  ).run();

  await logOutcome(env, termKey, domain, insert?.meta?.last_row_id || null,
    'served', userEmail, request, book);

  return json({
    isAdmin: admin,
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
    hindi: generated.hindi,
    urdu: generated.urdu,
    urduRoman: generated.urduRoman,
    // Withheld by design until a human approves the row — except from the
    // person who is being asked to approve it.
    connection: admin ? generated.connection : null,
    origin: admin ? generated.origin : null
  });
}

/* ------------------------------------------------------------------ */

export async function generate(env, term, sentence, domain) {
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
    '- hindi is required and must never be empty. Give the ordinary word a',
    '  Hindi speaker would use for this sense, in Devanagari, and write only',
    '  Devanagari in that field. Where formal Hindi uses the Sanskrit-derived',
    '  word, that is the one to give. If English is genuinely what is spoken,',
    '  write the English word in Devanagari.',
    '- synonyms and antonyms are required. Give up to three of each: words',
    '  with the same sense the word carries here, and words with the opposite',
    '  sense. Return an empty array when the word honestly has none — a proper',
    '  noun, a piece of equipment, a term with only one name. Never pad a list',
    '  with words that are merely related; those belong in concepts.',
    '- concepts: up to three ideas a reader meets alongside this word.',
    '- origin is required and must never be empty. Name the language it came',
    '  from and the root word, and say what that root meant. If you are not',
    '  certain of the root, name only the language it reached English from',
    '  and stop there. A short true answer beats a detailed invented one.',
    '- connection is required and must never be empty. Give one thing worth',
    '  knowing about the word beyond its meaning: where it turns up, what it',
    '  is commonly confused with, how its use has shifted, or a work, person',
    '  or event it is firmly attached to. Only name a person, work, event,',
    '  date or quotation if you are certain it is real — otherwise write',
    '  something true about how the word is used instead. An observation',
    '  about usage is always available and is never a fabrication.',
    '- memoryHook: a simple way to remember the word, when one fits.',
    '- senses: only when the word genuinely changes meaning across fields.',
    '- Never invent people, events, quotes, dates, etymologies or scripts.',
    '  Everything you write must be something you are confident is true.',
    '  If you are not sure, leave that one field empty and fill the rest.',
    '- Say nothing about current events or recent news. You have no way to',
    '  know what has happened lately, so any such claim would be a guess.',
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
        max_tokens: 900,
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
              synonyms: { type: 'array', maxItems: 3, items: { type: 'string' } },
              antonyms: { type: 'array', maxItems: 3, items: { type: 'string' } },
              concepts: { type: 'array', maxItems: 3, items: { type: 'string' } },
              memoryHook: { type: 'string' },
              origin: { type: 'string' },
              connection: { type: 'string' },
              hindi: { type: 'string' }
              // No urdu here. See generateUrdu().
            },
            // Listing a field here is the only reliable way to get it filled.
            // Asking in the prompt alone leaves the model free to emit "" for
            // anything optional, which is what it did for every entry so far.
            // synonyms and antonyms are listed for that reason; an empty array
            // still satisfies the requirement, so a word with no opposite is
            // not forced to invent one.
            required: ['meaning', 'hindi', 'synonyms', 'antonyms', 'origin', 'connection']
          }
        }
      });
    } catch (err) {
      // A thrown call will throw again on retry — usually the daily free
      // allocation, which resets at 00:00 UTC. Stop rather than burn it.
      throw new Error('AI request failed: ' + (err.message || 'unknown'));
    }

    const parsed = readResponse(res);
    if (parsed && parsed.meaning) {
      const urdu = await generateUrdu(env, term, parsed.meaning, domain);
      if (urdu) {
        parsed.urdu = urdu.urdu;
        parsed.urduRoman = urdu.urduRoman;
      }
      return parsed;
    }
  }

  return null;
}

/**
 * Second pass — Urdu only.
 *
 * Urdu used to be generated in the same JSON object as Hindi, a few tokens
 * after it, and what came back was the Hindi word respelled in Urdu letters:
 * سمویدھان for "constitution" where an Urdu speaker says آئین. Nothing in the
 * prompt fixed it, because the cause was not the prompt. A model completing
 * one object attends to what it has just written, and the Devanagari word was
 * sitting right there.
 *
 * So Urdu is generated on its own, from the English word and the meaning,
 * with the Hindi form never shown to it. There is nothing to transliterate
 * from. This costs one extra AI call, and only on a word nobody has looked up
 * before — every later reader is served the stored row.
 *
 * A failure here returns null and leaves the entry without Urdu rather than
 * with a wrong Urdu. The overlay already drops a missing form, and the review
 * console has a field for filling it in by hand.
 */
async function generateUrdu(env, term, meaning, domain) {
  const system = [
    'You give the Urdu word for an English word. Answer in the given JSON',
    'shape only.',
    '',
    'Rules:',
    '- urdu: the word an Urdu speaker actually uses for this sense, in Urdu',
    '  script. Urdu draws its formal vocabulary from Persian and Arabic, so',
    '  the answer is often not the Hindi word: constitution is آئین, not',
    '  سنودھان; system is نظام; construction is تعمیر.',
    '- Spelling an English or a Sanskrit word in Urdu letters is not a',
    '  translation. Do it only where Urdu has genuinely borrowed the word and',
    '  speakers use it as it stands: کمپیوٹر, برانڈ, چلر.',
    '- Words shared by everyday Hindustani are correct exactly as they are.',
    '  پانی is the real Urdu word for water, not a transliteration of Hindi.',
    '- Write the word only. No English, no Devanagari, no explanation, no',
    '  vowel marks unless the word is normally written with them.',
    '- urduRoman: that same word in roman letters as it sounds, capitalised —',
    '  Aaeen, Nizaam, Tameer. The same word as urdu, in a different script,',
    '  never a different word.',
    '- One word, or a short phrase where the language has no single word.'
  ].join('\n');

  const user = [
    `English word or phrase: "${term}"`,
    `It is being used to mean: ${meaning}`,
    domain === 'hvac' || domain === 'business'
      ? 'This is technical vocabulary. If Urdu speakers in the trade use the ' +
        'English term, give it in Urdu script; otherwise give the Urdu word.'
      : 'Give the word an Urdu newspaper or a schoolbook would print.'
  ].join('\n');

  for (const temperature of [0.1, 0.4]) {
    let res;
    try {
      res = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        max_tokens: 160,
        temperature,
        response_format: {
          type: 'json_schema',
          json_schema: {
            type: 'object',
            properties: {
              urdu: { type: 'string' },
              urduRoman: { type: 'string' }
            },
            required: ['urdu', 'urduRoman']
          }
        }
      });
    } catch (err) {
      // Usually the daily allocation. The main pass already succeeded, so the
      // entry is still worth keeping — it just goes in without Urdu.
      console.log('dictionary: urdu pass failed —', err.message);
      return null;
    }

    const parsed = readUrduResponse(res);
    if (parsed) return parsed;
  }

  return null;
}

function readUrduResponse(res) {
  if (!res) return null;

  let parsed = null;
  const payload = res.response;

  if (payload && typeof payload === 'object') {
    parsed = payload;
  } else {
    const text = String(typeof payload === 'string' ? payload : (res.result || ''))
      .replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  const urdu = cleanUrdu(parsed.urdu);
  if (!urdu) return null;
  return { urdu, urduRoman: cleanRoman(parsed.urduRoman) };
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
    origin: cleanString(parsed.origin),
    hindi: cleanHindi(parsed.hindi),
    // Filled by generateUrdu(), not by this pass.
    urdu: null,
    urduRoman: null
  };
}

/* Script guards -----------------------------------------------------
 *
 * A field is only worth keeping if it is written in the script it claims.
 * Devanagari in the Urdu slot is the failure this whole change is about, and
 * roman letters in it are the model answering in English. Both are dropped
 * rather than shown, because a reader who cannot read one of these scripts
 * has no way to tell a wrong answer from a right one.
 */
const DEVANAGARI = /[\u0900-\u097F]/;
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN = /[A-Za-z]/;

export function cleanHindi(value) {
  const text = cleanScriptString(value);
  if (!text || ARABIC.test(text) || !DEVANAGARI.test(text)) return null;
  return text;
}

export function cleanUrdu(value) {
  const text = cleanScriptString(value);
  if (!text || DEVANAGARI.test(text) || !ARABIC.test(text)) return null;
  return text;
}

export function cleanRoman(value) {
  const text = cleanScriptString(value);
  if (!text || DEVANAGARI.test(text) || ARABIC.test(text) || !LATIN.test(text)) return null;
  return text;
}

/** A script form is a word, not a sentence. 60 characters is generous. */
function cleanScriptString(value) {
  const text = cleanString(value);
  return text ? text.slice(0, 60) : null;
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

function shape(row, approved, admin) {
  const reveal = approved || admin;
  return {
    isAdmin: Boolean(admin),
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
    hindi: row.hindi || null,
    urdu: row.urdu || null,
    urduRoman: row.urdu_roman || null,
    connection: reveal ? (row.connection || null) : null,
    origin: reveal ? (row.origin || null) : null,
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

async function logOutcome(env, termKey, domain, entryId, outcome, userEmail, request, book) {
  try {
    await env.DB.prepare(
      `INSERT INTO dictionary_lookups
         (term_key, domain, entry_id, outcome, page_path, book_slug, user_email)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(termKey, domain, entryId, outcome, new URL(request.url).pathname,
      book, userEmail).run();
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

/**
 * Any throw that escapes a Pages Function is served as an HTML error page,
 * and a client calling response.json() on that gets a parse failure rather
 * than the real reason. Wrapping every handler keeps the contract JSON, so
 * "no such column: hindi" reaches the browser as those words.
 */
function withJson(handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      console.log('dictionary error:', err && err.stack ? err.stack : err);
      return json({ error: (err && err.message) || 'Unexpected server error.' }, 500);
    }
  };
}

export const onRequestPost = withJson(handleLookup);
