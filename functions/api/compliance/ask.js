// functions/api/compliance/ask.js
// Natural-language product engineering assistant.
// Still uses the same datasheet, KB, and deterministic comparison logic,
// but answers like an engineer instead of a compliance matrix row.

import {
  requireUser, json, PRODUCTS, isValidFactory, complianceTier, withErrorHandling,
  loadFacts, pickFacts, factsBlock, loadCriteria, matchCriterion,
} from '../../_compliance.js';
import { loadKb, kbForClause, kbLines } from '../../_kb.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_Q = 400;
const MAX_TURNS = 8;

function engineeringPrompt(product, factory, reference, kb, ctx) {
  return `
You are a Product Engineering Assistant supporting engineers working with
${product} units manufactured at the ${factory} factory.

Your job is to answer technical and compliance-related questions in **clear,
natural language**, with engineering-grade accuracy.

### Answering Principles
1. **Use only the datasheet facts and KB values provided.**
   Quote values exactly. Never invent numbers, materials, classes, or ratings.

2. **Explain compliance clearly.**
   If the product meets the requirement, say so directly.
   If it meets the intent but uses different wording, explain what the product
   actually provides and why it satisfies the requirement.

3. **Clarify scope.**
   If the requirement refers to installation, rigging, commissioning, or site work,
   state that these activities fall under the contractor’s scope and the
   manufacturer supplies equipment only.

4. **Handle non-applicable requirements.**
   If the requirement does not apply to this product, explain why.

5. **Handle missing information.**
   If the datasheet does not contain enough information to answer, say so clearly
   and specify what detail is missing. Never guess.

6. **Style requirements.**
   - Answer in 2–5 sentences.
   - Use precise engineering language.
   - Avoid vague statements.
   - Do not output JSON.
   - Do not use compliance matrix vocabulary (status, remarks).

### Datasheet Reference
${reference}

${kb ? '### Product Capabilities\n' + kb : '### No datasheet information available.'}

${ctx ? '\n### Past Verified Answers\n' + ctx : ''}
`;
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

  const [facts, criteria, kb] = await Promise.all([
    loadFacts(context, product, factory),
    loadCriteria(context, product),
    loadKb(context, product),
  ]);

  const kbHits = kbForClause(question, kb);
  const reference = factsBlock(product, factory, pickFacts([question], facts));

  const ctx = (Array.isArray(body.context) ? body.context : []).slice(0, 4)
    .map(c => `- "${String(c.spec || '').slice(0, 220)}"\n  → ${String(c.compliance || '').slice(0, 120)}: ${String(c.remarks || '').slice(0, 200)}`)
    .join('\n');

  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_TURNS)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }));

  let raw = '';
  try {
    const res = await context.env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: engineeringPrompt(product, factory, reference, kbLines(kbHits), ctx) },
        ...history,
        { role: 'user', content: question },
      ],
      max_tokens: 350,
      temperature: 0.1,
    });
    raw = res && (res.response || res.result || '');
  } catch (err) {
    return json({ error: 'AI request failed: ' + (err.message || 'unknown') }, 502);
  }

  const answer = String(raw).trim();
  if (!answer) {
    return json({
      error: 'The model returned an empty response. Try rephrasing the question.',
    }, 500);
  }

  return json({ answer });
}

export const onRequestPost = withErrorHandling(handlePost);
