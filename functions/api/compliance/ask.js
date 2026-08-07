// functions/api/compliance/ask.js
// One short question, one compliance answer — the same path a converted row
// takes, without the document.
//
//   POST { product, factory, question, context, history }
//   -> { answer: { status, remarks }, settled }   an answer
//   -> { clarify: "..." }                         needs one thing first
//
// WHY THIS EXISTS SEPARATELY FROM ai-suggest: a chat turn is one clause with
// no hierarchy, no datasheet and no row to fill, and it is allowed to ask a
// question back — none of which the batch path does. What it must NOT do is
// answer by different rules, so it shares the knowledge base, the criteria,
// the deterministic comparison, and the status vocabulary.
//
// Short questions only. A pasted specification belongs in the converter,
// where it gets hierarchy, library pre-fill and an audit trail; answering a
// wall of text in a chat box would quietly bypass all three.

import {
  requireUser, json, PRODUCTS, isValidFactory, complianceTier, withErrorHandling,
  loadFacts, pickFacts, factsBlock, loadCriteria, matchCriterion,
  compareValues, compareClasses, classTokens,
} from '../../_compliance.js';
import { loadKb, kbForClause, kbLines } from '../../_kb.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_Q = 400;
const MAX_TURNS = 8;

const STATUSES = ['Comply', 'Comply with remarks', 'Not Applicable', 'By Contractor', 'Noted', 'TO VERIFY'];

function systemPrompt(product, factory, reference, kb, ctx) {
  return `You answer single compliance questions about ${product} units built at the ${factory} factory,
for engineers preparing a submission. You are not a general assistant: every answer is a compliance
answer, in the same form as a row of a compliance matrix.

REPLY WITH JSON ONLY, one of these two shapes:
  {"clarify":"<one short question>"}
  {"status":"<one of: ${STATUSES.join(' | ')}>","remarks":"<one or two sentences>"}

ASK FIRST when the question is missing something you need — which section, which duty, whether it is
about supply or installation. One question, under 20 words. Do not ask more than twice in a row, and
never ask when the answer is already determined below.

ANSWERING RULES, identical to the compliance matrix:
1. What we offer, below, is the source of truth for what the unit IS. Quote its values.
2. If our standard meets the requirement, status is "Comply".
3. If what we supply differs from the wording but still meets the intent, status is
   "Comply with remarks" and the remark states WHAT WE ACTUALLY OFFER. This is the common case.
4. Site execution — installation, rigging, commissioning, connections — is "By Contractor",
   remark "Daikin scope is equipment supply only."
5. Something that does not apply to this product is "Not Applicable", with one line saying why.
6. If nothing below supports an answer, status is "TO VERIFY" naming what is missing.
   NEVER invent a number, material, class or model. A wrong value is worse than no answer.
7. THE REMARK CONTINUES THE STATUS, it never repeats it.
   RIGHT: "By Contractor" / "Daikin scope is equipment supply only."
   WRONG: "By Contractor" / "By Contractor. Daikin scope is..."

${reference}
${kb ? 'WHAT WE OFFER:\n' + kb : 'Nothing is on file about this product yet — answer only from the past answers below, if any.'}
${ctx ? '\nPAST VERIFIED ANSWERS to similar clauses:\n' + ctx : ''}`;
}

async function handlePost(context) {
  const user = await requireUser(context);
  if (!user) return json({ error: 'Not signed in' }, 401);

  const tier = await complianceTier(context);
  if (!tier.ai) {
    return json({ error: 'Ask is not enabled on your account yet — ask an admin for access to AI clause review.' }, 403);
  }
  if (!context.env.AI) return json({ error: 'AI binding "AI" is not configured on this project.' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const product = String(body.product || '').trim();
  if (!PRODUCTS.includes(product)) return json({ error: 'Select a product first.' }, 400);
  const factory = String(body.factory || '').trim();
  if (!isValidFactory(product, factory)) return json({ error: 'Select a factory for ' + product + ' first.' }, 400);

  const question = String(body.question || '').trim();
  if (!question) return json({ error: 'Ask a question.' }, 400);
  if (question.length > MAX_Q) {
    return json({
      error: 'That is too long for a question (' + question.length + ' characters). ' +
        'Paste a specification into the converter instead — it gives you the hierarchy, ' +
        'library pre-fill and an exportable sheet, which a chat answer cannot.',
    }, 400);
  }

  const [facts, criteria, kb] = await Promise.all([
    loadFacts(context, product, factory),
    loadCriteria(context, product),
    loadKb(context, product),
  ]);

  const kbHits = kbForClause(question, kb);
  const reference = factsBlock(product, factory, pickFacts([question], facts));

  // The nearest past answers, matched in the browser against the loaded
  // library and sent with the question — the same source the converter uses.
  const ctx = (Array.isArray(body.context) ? body.context : []).slice(0, 4)
    .map(c => `- "${String(c.spec || '').slice(0, 220)}"\n  status="${String(c.compliance || '').slice(0, 120)}", ` +
              `remark="${String(c.remarks || '').slice(0, 200)}"` +
              (c.note ? `\n  Internal note (guidance, never quote): "${String(c.note).slice(0, 220)}"` : ''))
    .join('\n');

  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_TURNS)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }));

  let raw = '';
  try {
    const res = await context.env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: systemPrompt(product, factory, reference, kbLines(kbHits), ctx) },
        ...history,
        { role: 'user', content: question },
      ],
      max_tokens: 300,
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          properties: {
            clarify: { type: 'string' },
            status: { type: 'string' },
            remarks: { type: 'string' },
          },
        },
      },
    });
    raw = res && (typeof res.response === 'object' ? JSON.stringify(res.response)
      : (res.response || res.result || ''));
  } catch (err) {
    return json({ error: 'AI request failed: ' + (err.message || 'unknown') +
      ' (the daily free allocation may be exhausted — it resets at 00:00 UTC).' }, 502);
  }

  let parsed = {};
  try {
    const m = String(raw).match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  } catch { parsed = {}; }

  if (parsed.clarify && !parsed.status) {
    return json({ clarify: String(parsed.clarify).slice(0, 200) });
  }

  const status = STATUSES.find(s => s.toLowerCase() === String(parsed.status || '').trim().toLowerCase());
  if (!status) {
    return json({
      answer: { status: 'TO VERIFY', remarks: '' },
      note: 'The model did not return a usable answer. Try asking it more specifically.',
    });
  }

  // Same treatment a matrix row gets: the remark continues the status rather
  // than repeating it, and a measurement no source provided is removed.
  let remarks = String(parsed.remarks || '').trim();
  const esc = status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  remarks = remarks.replace(new RegExp('^\\s*' + esc + '\\s*(?:/\\s*Others)?\\s*[.:,;–—-]*\\s*', 'i'), '');

  const MEASURE = /(\d+(?:\.\d+)?)\s*(mm|cm|m|kg|kw|w|pa|%|micron|deg|°c)\b/gi;
  const sourceText = kbHits.map(e => e.options.join(' ')).join(' ') + ' ' + ctx + ' ' + reference;
  const used = String(remarks).match(new RegExp(MEASURE)) || [];
  const unsupported = used.filter(v => !sourceText.toLowerCase().includes(String(v).toLowerCase().replace(/\s+/g, ' ')));
  if (unsupported.length) {
    return json({
      answer: { status: 'TO VERIFY', remarks: '' },
      note: 'The answer quoted ' + unsupported.join(', ') + ', which no datasheet field or past ' +
            'answer provides, so it was withdrawn. Confirm that value before using it.',
    });
  }

  return json({ answer: { status, remarks: remarks.charAt(0).toUpperCase() + remarks.slice(1) } });
}

export const onRequestPost = withErrorHandling(handlePost);
