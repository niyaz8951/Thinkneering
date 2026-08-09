/**
 * POST /api/dictionary/usage
 * Body: { term, domain?, entryId?, outcome: "used" | "corrected" | "unanswered", note?, pagePath? }
 *
 * Records whether a lookup actually helped. Terms that collect "corrected"
 * outcomes are the queue an admin should review first.
 */

const OUTCOMES = ['used', 'corrected', 'unanswered'];
const ALLOWED_DOMAINS = ['general', 'english', 'hvac', 'business'];

export async function onRequestPost(context) {
  const { request, env, data } = context;

  if (!data?.user) return json({ error: 'Sign in first.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const termKey = normalise(body.term);
  const outcome = OUTCOMES.includes(body.outcome) ? body.outcome : null;
  const domain = ALLOWED_DOMAINS.includes(body.domain) ? body.domain : 'general';

  if (!termKey || !outcome) {
    return json({ error: 'A term and a valid outcome are required.' }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO dictionary_lookups (term_key, domain, entry_id, outcome, note, page_path, user_email)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    termKey,
    domain,
    Number.isInteger(body.entryId) ? body.entryId : null,
    outcome,
    body.note ? String(body.note).slice(0, 400) : null,
    body.pagePath ? String(body.pagePath).slice(0, 200) : null,
    data.user.email || data.user.id || null
  ).run();

  return json({ recorded: true });
}

function normalise(term) {
  return String(term || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^['\-]+|['\-]+$/g, '')
    .trim();
}
