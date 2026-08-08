// functions/api/compliance/ask.js
// Free-text question answering for the compliance chat.
//
// The answer is the same judgement a converted matrix row would carry, said
// out loud: a status from the matrix vocabulary, the remark that would sit
// beside it, and a short natural-language reply that reads as if an
// application engineer answered the question rather than filled a cell.
//
// Response shape is { status, remarks, answer } and the front end renders
// `answer` as the body with `status` as a chip. An earlier version returned a
// bare string here while the front end read `answer.status`, which is why
// every reply rendered as "TO VERIFY" with nothing under it.

import {
  requireUser, json, PRODUCTS, isValidFactory, complianceTier, withErrorHandling,
  loadFacts, pickFacts, factsBlock,
} from '../../_compliance.js';
import { loadKb, kbForClause, kbLines } from '../../_kb.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_Q = 400;
const MAX_TURNS = 8;

// The vocabulary real engineers write in these matrices. "Deviation" and
// "Not Comply" are deliberately absent — they are not used in practice.
const STATUSES = [
  'Comply',
  'Comply with remarks',
  'Not Applicable',
  'Noted',
  'TO VERIFY',
];

function engineeringPrompt(product, factory, reference, kb, ctx) {
  return `You are an application engineer answering a colleague's question about
${product} units built at the ${factory} factory. You answer the way you would
across a desk: direct, specific, no padding.

WHAT YOU KNOW
${reference}

${kb ? 'PRODUCT CAPABILITIES\n' + kb : 'No datasheet information is available for this question.'}
${ctx ? '\nPAST VERIFIED ANSWERS (these were checked by an engineer — follow them)\n' + ctx : ''}

HOW TO ANSWER

Pick one status from exactly this list:
${STATUSES.map(s => '  - ' + s).join('\n')}

  Comply                — the product meets the requirement as written.
  Comply with remarks   — it meets the intent, but with a qualification worth stating.
  Not Applicable        — the requirement does not apply to this product or scope.
  Noted                 — information only; nothing to confirm or supply.
  TO VERIFY             — you do not have the data to answer. Say what is missing.

Then write "remarks": the sentence you would type into the Remarks column.
Specific, factual, no more than about 30 words.

Then write "answer": two to four sentences replying to the colleague, in a
natural tone. It should carry the same judgement as the status and cover the
same ground as the remarks, but as speech rather than a cell — say what the
product actually offers and why that does or does not meet the requirement.
Do not open with the status word. Do not say "Compliance:" or "Remarks:".

HARD RULES
- Use only the values above. Never invent a number, class, rating, material or
  model that does not appear there. If a specific value is needed and you do
  not have it, the status is TO VERIFY and you say which value is missing.
- Never claim certification or conformity that is not stated above.
- Installation, rigging, commissioning and site work are the contractor's
  scope; the manufacturer supplies equipment only. Say so when it comes up.

Reply with one JSON object and nothing else:
{"status":"...","remarks":"...","answer":"..."}`;
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { return null; }
}

// Accept near-misses on the status wording rather than throwing the answer
// away — models reliably return the right judgement in slightly wrong case.
function normaliseStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'TO VERIFY';
  const hit = STATUSES.find(s => s.toLowerCase() === raw.toLowerCase());
  if (hit) return hit;
  const low = raw.toLowerCase();
  if (low.startsWith('comply with')) return 'Comply with remarks';
  if (low.startsWith('comply')) return 'Comply';
  if (low.includes('not applicable') || low === 'n/a' || low === 'na') return 'Not Applicable';
  if (low.startsWith('noted')) return 'Noted';
  return 'TO VERIFY';
}

function shape(parsed, fallbackText) {
  if (!parsed) {
    // The model wrote prose instead of JSON. Prose is still useful, so keep
    // it as the answer rather than discarding a good reply on a format slip.
    const text = String(fallbackText || '').trim();
    return text ? { status: 'TO VERIFY', remarks: '', answer: text.slice(0, 2000) } : null;
  }
  const status = normaliseStatus(parsed.status);
  const remarks = String(parsed.remarks || '').trim().slice(0, 600);
  let answer = String(parsed.answer || '').trim().slice(0, 2000);
  // If only remarks came back, that sentence is the answer.
  if (!answer) answer = remarks;
  if (!answer) return null;
  return { status, remarks, answer };
}

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const tier = await complianceTier(context);
  if (!tier.ai) {
    return json({ error: 'Ask is not enabled on your account yet — ask an admin for access.' }, 403);
  }
  if (!context.env.AI) return json({ error: 'AI binding "AI" is not configured.' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a product first.' }, 400);

  const factory = String(body.factory || '').trim();
  if (!isValidFactory(product, factory)) {
    return json({ error: `Select a valid factory for ${product}.` }, 400);
  }

  const question = String(body.question || '').trim();
  if (!question) return json({ error: 'Ask a question.' }, 400);
  if (question.length > MAX_Q) {
    return json({
      error: `Question too long (${question.length} chars). Paste specifications into the converter instead.`,
    }, 400);
  }

  const [facts, kb] = await Promise.all([
    loadFacts(context, product, factory),
    loadKb(context, product),
  ]);

  const kbHits = kbForClause(question, kb);
  const reference = factsBlock(product, factory, pickFacts([question], facts));

  const ctx = (Array.isArray(body.context) ? body.context : []).slice(0, 4)
    .map(c => `- "${String(c.spec || '').slice(0, 220)}"\n  -> ${String(c.compliance || '').slice(0, 120)}: ${String(c.remarks || '').slice(0, 200)}`)
    .join('\n');

  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_TURNS)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }));

  const messages = [
    { role: 'system', content: engineeringPrompt(product, factory, reference, kbLines(kbHits), ctx) },
    ...history,
    { role: 'user', content: question },
  ];

  // Two attempts: a tight one for accuracy, a looser one only if the first
  // came back unparseable.
  let result = null;
  let lastRaw = '';
  for (const opts of [{ temperature: 0.15 }, { temperature: 0.45 }]) {
    let raw = '';
    try {
      const res = await context.env.AI.run(MODEL, { messages, max_tokens: 500, ...opts });
      raw = (res && (res.response || res.result)) || '';
    } catch (err) {
      return json({ error: 'AI request failed: ' + (err.message || 'unknown') }, 502);
    }
    lastRaw = raw;
    result = shape(extractJson(raw), null);
    if (result) break;
  }
  if (!result) result = shape(null, lastRaw);

  if (!result) {
    return json({ error: 'The model returned an empty response. Try rephrasing the question.' }, 500);
  }

  return json({ ...result, source: 'ai' });
}

export const onRequestPost = withErrorHandling(handlePost);
