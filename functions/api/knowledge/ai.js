/**
 * /api/knowledge/ai
 *
 * POST { action, mapId, nodeId?, node?, question? }
 *
 * Two jobs:
 *   Authoring assistance — draft a summary, find gaps, suggest aliases and
 *   relationships while someone is writing a node.
 *   Review engine — read a whole map and report what it understands, what is
 *   missing and what conflicts.
 *
 * Everything it produces lands as a DRAFT suggestion attached to a node or a
 * review record. Nothing the model writes becomes approved knowledge without
 * a person pressing approve. That boundary is the reason Compliance Maker can
 * trust what comes out of the graph.
 */

import {
  json, readJson, userOf, userId, roleOnMap, requireRole,
  nowIso, newId, asArray, rowToNode, withJson
} from '../../_lib/knowledge.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

const DOMAIN_HVAC = [
  'You are a knowledge engineer working with an HVAC equipment manufacturer that supplies air',
  'handling units, fan coil units, chillers and controls into MEP construction projects, mainly in',
  'the GCC. You understand equipment hierarchy, air and chilled water flow paths, the refrigeration',
  'cycle, control strategies, and the parameters a consultant calls out in a specification. You know',
  'the common reference standards (Eurovent, EN 1886, EN 13053, AHRI 430/440/410/550, ISO 16890,',
  'ASHRAE 62.1 and 90.1) and the regional approval regimes.'
].join(' ');

const DOMAIN_BUSINESS = [
  'You are a knowledge engineer mapping business processes for a manufacturing and sales',
  'organisation: departments, hand-offs, decisions, approvals, documents and exception paths.'
].join(' ');

const GUARDRAILS = [
  'Work ONLY from the knowledge supplied.',
  'NEVER invent specific capacities, dimensions, class ratings, certificate numbers, model numbers,',
  'prices or performance figures that are not already in the data. Where a specific value is needed',
  'and missing, write "TO VERIFY".',
  'NEVER state or imply that a product complies with a standard. Compliance is established by a',
  'submittal and test certificates, not by you. You may say which standard governs a parameter.',
  'Distinguish clearly between what the knowledge base says and what is missing from it.',
  'Write plainly, the way an experienced engineer would explain something to a colleague.',
  'Be concise. No preamble.'
].join(' ');

const ACTIONS = {
  draft_summary: {
    shape: '{"summary":"string","aliases":["string"],"gaps":["string"],"confidence":0}',
    instruction:
      'Draft a one or two sentence summary of this node in plain English: what it is and why it ' +
      'matters. Then suggest aliases — the other names a specification clause might use for it, ' +
      'including abbreviations and common misspellings of the concept. Then list what information ' +
      'is missing before this node would be genuinely useful to answer a specification clause. ' +
      'Confidence is 0-100 for how complete the node currently is.'
  },

  suggest_attributes: {
    shape: '{"title":"string","sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'List the parameters a consultant specification would call out for this node. Give the ' +
      'parameter NAME and the standard or document that would establish it — never a value. ' +
      'Group under: Always specified, Sometimes specified, Governing standards.'
  },

  suggest_relations: {
    shape: '{"title":"string","sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Given this node and the other node titles in the map, suggest relationships that are missing. ' +
      'Format each as "Relation | This node | Other node — reason". Only suggest relationships ' +
      'between nodes that already exist in the map. Group under: Hierarchy, Flow, Control, Dependency.'
  },

  find_duplicates: {
    shape: '{"title":"string","sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Looking at the node titles and aliases in this map, identify pairs or groups that describe the ' +
      'same concept and should be merged. For each, say which one should survive and why. If there ' +
      'are none, say so plainly rather than inventing weak matches.'
  },

  explain_node: {
    shape: '{"title":"string","summary":"string","sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Explain this node to an engineer meeting it for the first time. Sections: What it is, How it ' +
      'works, What it connects to, What typically goes wrong, What a specification asks about it.'
  },

  review_map: {
    shape: '{"title":"string","summary":"string","sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Review this knowledge map. Work from the lanes and nodes listed above and name the ' +
      'specific nodes and lanes you mean — a review that could apply to any map is worthless. ' +
      'Sections, in this order: Executive summary (2-3 sentences on what this map is FOR); ' +
      'Lane by lane (one line per lane naming what it holds and whether its contents belong ' +
      'together); What is solid; Missing knowledge; Likely duplicates; Suggested next nodes. ' +
      'Where a section has nothing, write one line saying so. Keep every item under 25 words.'
  },

  suggest_lanes: {
    shape: '{"title":"string","summary":"string","lanes":[{"label":"string","reason":"string","nodes":["string"]}],"sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Propose how this map should be organised into lanes. A lane is a column grouping nodes ' +
      'that belong together — a subsystem, a department, a stage, a part of speech, whatever ' +
      'suits THIS material. Read the actual node titles before deciding; do not reach for HVAC ' +
      'subsystems unless the nodes are actually HVAC. ' +
      'Return between 2 and 7 lanes. For each: a short label (max 24 characters), one line on ' +
      'why it exists, and the titles of existing nodes that would sit in it. ' +
      'Every node listed must already exist in the map — do not invent nodes. ' +
      'If a node fits nowhere, leave it out rather than forcing it. ' +
      'In sections, add one heading "Nodes left over" listing anything you could not place.'
  },

  summarise_nodes: {
    shape: '{"title":"string","summary":"string","sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Write a one-line summary for each node that has none, and say which nodes need an alias ' +
      'before a specification clause could find them. Format each item as ' +
      '"Node title — suggested summary". ' +
      'SKIP any node whose status is approved: those have been checked by a person and are not ' +
      'yours to rewrite. List skipped approved nodes under a heading "Already approved, untouched".'
  },

  answer_question: {
    shape: '{"summary":"string","sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Answer the question using ONLY the knowledge in this map. State plainly which nodes the answer ' +
      'comes from. If the map does not contain enough to answer, say exactly that and list what would ' +
      'need to be added. Do not fill the gap from general knowledge.'
  }
};

async function _onRequestPost(context) {
  const { env, request } = context;
  const user = userOf(context);
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.AI) return json({ error: 'AI binding not configured' }, 500);

  const body = await readJson(request);
  if (!body || !ACTIONS[body.action]) return json({ error: 'Unknown action' }, 400);
  if (!body.mapId) return json({ error: 'Missing mapId' }, 400);

  const role = await roleOnMap(env, user, body.mapId);
  if (!role) return json({ error: 'You do not have access to this map' }, 403);

  const map = await env.DB.prepare('SELECT * FROM knowledge_maps WHERE id = ?').bind(body.mapId).first();
  if (!map) return json({ error: 'Map not found' }, 404);

  const nodeRows = await env.DB.prepare(
    'SELECT * FROM knowledge_nodes WHERE map_id = ? ORDER BY lane LIMIT 300'
  ).bind(body.mapId).all();
  const edgeRows = await env.DB.prepare(
    'SELECT e.*, nf.title AS from_title, nt.title AS to_title FROM knowledge_edges e ' +
    'JOIN knowledge_nodes nf ON nf.id = e.from_id JOIN knowledge_nodes nt ON nt.id = e.to_id ' +
    'WHERE e.map_id = ? LIMIT 800'
  ).bind(body.mapId).all();

  const nodes = ((nodeRows && nodeRows.results) || []).map(rowToNode);
  const edges = (edgeRows && edgeRows.results) || [];
  if (!nodes.length) return json({ error: 'This map has no nodes yet' }, 400);

  const spec = ACTIONS[body.action];
  const focus = body.node || nodes.find(n => n.id === body.nodeId) || null;
  const prompt = buildPrompt(spec, map, nodes, edges, focus, body.question);

  let raw;
  try { raw = await runModel(env, prompt); }
  catch (err) { return json({ error: 'AI service unavailable' }, 502); }

  const result = parseResult(raw);
  if (!result) return json({ error: 'The model returned an unusable answer. Try again.' }, 502);

  // Persist what belongs in the record.
  if (body.action === 'review_map') {
    context.waitUntil(saveReview(env, map, user, result));
  }
  if (body.action === 'draft_summary' && body.nodeId && result.summary) {
    context.waitUntil(saveNodeSuggestion(env, body.nodeId, result));
  }
  if (body.action === 'answer_question' && body.question) {
    context.waitUntil(saveQuestion(env, map, user, body.question, result));
  }

  return json({ ok: true, result });
}

/* ── Prompt ────────────────────────────────────────────────────────────── */

function buildPrompt(spec, map, nodes, edges, focus, question) {
  const domain = map.domain === 'business' ? DOMAIN_BUSINESS : DOMAIN_HVAC;

  let ctx = 'KNOWLEDGE MAP: ' + map.title + ' (' + map.kind + ', domain ' + map.domain + ')\n';
  if (map.description) ctx += map.description + '\n';

  // The lanes are part of the map's meaning, not decoration. Without them the
  // model cannot comment on how the map is organised, which is most of what
  // a review is for.
  const lanes = parseLanes(map.lanes);
  ctx += '\nLANES (columns this map is organised into):\n' +
    (lanes.length
      ? lanes.map(l => '- ' + l.label + ' [id ' + l.id + '] — ' +
          nodes.filter(n => n.lane === l.id).length + ' nodes').join('\n')
      : '(none defined yet — this map has no columns)');

  const unplaced = nodes.filter(n => !n.lane || !lanes.some(l => l.id === n.lane));
  if (unplaced.length) {
    ctx += '\nNodes not in any lane: ' + unplaced.length;
  }

  ctx += '\n\nNODES:\n' + nodes.map(describeNode).join('\n');
  ctx += '\n\nRELATIONSHIPS:\n' + (edges.map(e =>
    '- ' + e.from_title + ' --[' + e.relation + (e.medium ? '/' + e.medium : '') +
    (e.label ? ': ' + e.label : '') + ']--> ' + e.to_title
  ).join('\n') || '(none recorded)');

  if (focus) ctx += '\n\nFOCUS NODE:\n' + describeNode(focus, true);
  if (question) ctx += '\n\nQUESTION: ' + String(question).slice(0, 1000);

  return {
    system: domain + ' ' + GUARDRAILS +
      ' Respond with a single JSON object matching this shape and nothing else: ' + spec.shape +
      ' Do not wrap it in markdown fences.',
    user: ctx + '\n\nTASK: ' + spec.instruction
  };
}

function parseLanes(raw) {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch (err) { return []; }
}

function describeNode(n, full) {
  const bits = ['- ' + n.title + ' [' + n.kind + (n.lane ? ' | ' + n.lane : '') +
                ' | ' + (n.status || 'draft') + ']'];
  const aliases = asArray(n.aliases);
  if (aliases.length) bits.push('  also called: ' + aliases.join(', '));
  if (n.summary) bits.push('  summary: ' + n.summary);
  const standards = asArray(n.standards);
  if (standards.length) bits.push('  standards: ' + standards.join(', '));
  const attrs = asArray(n.attributes);
  if (attrs.length) {
    bits.push('  parameters: ' + attrs.map(a =>
      a.name + (a.value ? ' = ' + a.value : '') + (a.unit ? ' ' + a.unit : '')
    ).join('; '));
  }
  if (full && n.body) bits.push('  detail: ' + String(n.body).slice(0, 1500));
  return bits.join('\n');
}

/* ── Model ─────────────────────────────────────────────────────────────── */

async function runModel(env, prompt) {
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];
  // A truncated reply is unparseable JSON, which used to fall through to the
  // prose branch and print the raw half-written JSON on screen. More room
  // first, and a repair pass below for when it still runs out.
  const attempts = [
    { max_tokens: 2600, temperature: 0.2 },
    { max_tokens: 2600, temperature: 0.45 },
    { max_tokens: 1600, temperature: 0.1 }
  ];

  let last = null;
  for (const opts of attempts) {
    const out = await env.AI.run(MODEL, Object.assign({ messages }, opts));
    const text = typeof out === 'string' ? out : (out.response || '');
    last = text;
    if (extractJson(text)) return text;
  }
  return last;
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  const end = cleaned.lastIndexOf('}');
  if (end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (err) { /* fall through */ }
  }
  return repairJson(cleaned.slice(start));
}

/* Close a reply that ran out of tokens mid-object.
 *
 * The model writes valid JSON until it is cut off, so everything before the
 * cut is good. Trim back to the last complete element, then close whatever
 * brackets are still open. Recovering five of six sections beats showing the
 * user a wall of raw JSON, which is what happened before. */
function repairJson(text) {
  let inString = false, escaped = false;
  const stack = [];
  let lastSafe = -1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      stack.pop();
      // A closed element at depth 1 or 2 is a safe place to cut back to.
      if (stack.length <= 2) lastSafe = i;
    } else if (c === ',' && stack.length <= 2) {
      lastSafe = i - 1;
    }
  }

  if (lastSafe < 0) return null;

  let head = text.slice(0, lastSafe + 1);
  // Recount what is still open after trimming.
  const open = [];
  inString = false; escaped = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') open.push(c);
    else if (c === '}' || c === ']') open.pop();
  }
  while (open.length) head += open.pop() === '{' ? '}' : ']';

  try { return JSON.parse(head); } catch (err) { return null; }
}

function parseResult(raw) {
  const parsed = extractJson(raw);
  if (parsed) {
    const clean = sanitise(parsed);
    if (clean) return clean;
  }
  const text = String(raw || '').trim();
  return text ? { summary: text.slice(0, 6000) } : null;
}

function sanitise(obj) {
  const out = {};
  if (typeof obj.title === 'string') out.title = obj.title.slice(0, 200);
  if (typeof obj.summary === 'string') out.summary = obj.summary.slice(0, 4000);
  if (Number.isFinite(obj.confidence)) out.confidence = Math.max(0, Math.min(100, Math.round(obj.confidence)));
  if (Array.isArray(obj.aliases)) {
    out.aliases = obj.aliases.filter(a => typeof a === 'string').slice(0, 20).map(a => a.slice(0, 120));
  }
  if (Array.isArray(obj.lanes)) {
    out.lanes = obj.lanes.slice(0, 10).map(l => ({
      label: String((l && l.label) || '').slice(0, 60),
      reason: String((l && l.reason) || '').slice(0, 300),
      nodes: Array.isArray(l && l.nodes)
        ? l.nodes.filter(n => typeof n === 'string').slice(0, 60).map(n => n.slice(0, 200))
        : [],
    })).filter(l => l.label);
  }
  if (Array.isArray(obj.gaps)) {
    out.gaps = obj.gaps.filter(g => typeof g === 'string').slice(0, 20).map(g => g.slice(0, 400));
  }
  if (Array.isArray(obj.sections)) {
    out.sections = obj.sections.slice(0, 12).map(sec => {
      const s = {};
      if (sec && typeof sec.heading === 'string') s.heading = sec.heading.slice(0, 160);
      if (sec && typeof sec.text === 'string') s.text = sec.text.slice(0, 2000);
      if (sec && Array.isArray(sec.items)) {
        s.items = sec.items
          .map(i => (typeof i === 'string' ? i : (i && i.text) || ''))
          .filter(Boolean).slice(0, 30).map(i => i.slice(0, 700));
      }
      return s;
    }).filter(s => s.heading || s.text || (s.items && s.items.length));
  }
  return Object.keys(out).length ? out : null;
}

/* ── Persistence ───────────────────────────────────────────────────────── */

async function saveReview(env, map, user, result) {
  try {
    const now = nowIso();
    await env.DB.prepare(
      'INSERT INTO knowledge_reviews (id, map_id, scope, scope_id, summary, detail_json, score, ' +
      'model, requested_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(
      newId('rev'), map.id, 'map', null,
      String(result.summary || '').slice(0, 4000),
      JSON.stringify(result).slice(0, 100000),
      map.knowledge_score, MODEL, userId(user), now
    ).run();

    await env.DB.prepare('UPDATE knowledge_maps SET last_reviewed_at = ? WHERE id = ?')
      .bind(now, map.id).run();
  } catch (err) { /* review history is not worth failing the response over */ }
}

async function saveNodeSuggestion(env, nodeId, result) {
  try {
    await env.DB.prepare(
      'UPDATE knowledge_nodes SET ai_summary = ?, ai_gaps = ?, confidence = ? WHERE id = ?'
    ).bind(
      String(result.summary || '').slice(0, 2000),
      JSON.stringify(result.gaps || []),
      Number.isFinite(result.confidence) ? result.confidence : null,
      nodeId
    ).run();
  } catch (err) { /* ignore */ }
}

async function saveQuestion(env, map, user, question, result) {
  try {
    const now = nowIso();
    await env.DB.prepare(
      'INSERT INTO knowledge_questions (id, map_id, user_id, question, ai_answer, status, ' +
      'created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(
      newId('q'), map.id, userId(user),
      String(question).slice(0, 2000),
      JSON.stringify(result).slice(0, 20000),
      'answered', now, now
    ).run();
  } catch (err) { /* ignore */ }
}

/* Wrapped so a database or runtime failure returns JSON the front end
   can read, instead of Cloudflare's HTML error page. */
export const onRequestPost = withJson(_onRequestPost);
