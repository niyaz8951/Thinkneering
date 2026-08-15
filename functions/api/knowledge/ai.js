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

const DOMAIN_ENGLISH = [
  'You are a lexicographer building a word map for an adult reader who is deepening their',
  'English. You think in terms of roots and affixes, parts of speech, sense distinctions,',
  'register, collocation, and the pairs people reliably confuse. You explain where a word came',
  'from and what else shares its root, because that is what makes vocabulary stick. You never',
  'invent an etymology you are not sure of.'
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

/* Mirrors the relation keys in tools/knowledge/domain-*.js. Pages Functions
   cannot import a browser global, so this is duplicated by necessity — if you
   add a relation to a pack, add it here too, or the model is never told the
   name and every connection using it is discarded on the way back in. */
const RELATION_NAMES = {
  hvac: ['contains', 'part_of', 'supplies', 'receives', 'flows_to', 'controls',
         'monitors', 'depends_on', 'produces', 'requires', 'connected_to',
         'governed_by', 'causes'],
  english: ['means', 'sense_of', 'built_from', 'builds', 'synonym_of', 'antonym_of',
            'confused_with', 'stronger_than', 'used_in', 'collocates',
            'governed_by', 'belongs_to', 'example_of'],
  business: ['precedes', 'contains', 'part_of', 'approves', 'requires', 'produces',
             'depends_on', 'responsible', 'connected_to', 'causes']
};

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

  /* Run from the dashboard. This is the one that proposes real structural
     changes rather than prose, so its shape is machine-applicable and the
     handler filters it against each node's ai_open flag before anything is
     written. */
  review_and_align: {
    shape: '{"summary":"string",' +
           '"lanes":[{"label":"string","reason":"string","nodes":["string"]}],' +
           '"moves":[{"node":"string","lane":"string","why":"string"}],' +
           '"connections":[{"from":"string","relation":"string","to":"string","why":"string"}],' +
           '"nodeNotes":[{"node":"string","note":"string"}],' +
           '"sections":[{"heading":"string","items":["string"]}]}',
    instruction:
      'Review the whole map and propose how to tidy it. Produce four things. ' +
      '(1) lanes: the columns this map should have, in reading order, each with a one-line ' +
      'reason. Keep an existing lane label unchanged where it still works. ' +
      '(2) moves: nodes that sit in the wrong lane, giving the exact node title and the exact ' +
      'lane label it belongs in. ' +
      '(3) connections: relationships that are clearly missing, using ONLY node titles that ' +
      'appear in the map and ONLY relation names from the list given. ' +
      '(4) nodeNotes: for each node you were shown, two or three sentences on what you ' +
      'understand it to mean, what is missing from it, and anything worth adding. Write this ' +
      'for the reader of that node, not as a report. ' +
      'Use exact node titles everywhere \u2014 anything that does not match a real title is discarded.'
  },

  answer_question: {
    shape: '{"answered":true,"summary":"string",' +
           '"sections":[{"heading":"string","items":["string"]}],' +
           '"usedNodes":["exact node title"]}',
    instruction:
      'Answer the question using ONLY the map above. The map is your entire world for this answer.\n' +
      'Reason across it, do not just look words up: follow the connections between nodes, use the ' +
      'lane a node sits in, and use aliases so a question that names something differently still ' +
      'finds it. If several nodes connect to the answer, say how they relate rather than listing ' +
      'them flatly.\n' +
      'Set "answered" to true only if the map genuinely contains the answer. If it does not, set ' +
      '"answered" to false, say plainly that this map does not cover it, and name what would need ' +
      'to be added — do NOT answer from your own knowledge, and do NOT guess.\n' +
      'List in "usedNodes" the exact titles of every node you drew on. If that list would be empty, ' +
      '"answered" must be false.'
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

  /* Applying a review is a replay, not a fresh question. Re-prompting here
     was the bug behind "Apply does nothing": the model is not deterministic,
     so the second generation proposed different nodes to the ones the user
     had just agreed to, and titles that no longer resolved were silently
     dropped. The proposal is stored when it is first shown; apply loads that
     row and writes it. No model call, no drift, and it is instant. */
  if (body.action === 'review_and_align' && body.apply === true) {
    if (!(await requireRole(env, user, body.mapId, 'contributor'))) {
      return json({ error: 'You need contributor access to apply a review' }, 403);
    }
    if (!body.reviewId) return json({ error: 'Missing reviewId' }, 400);

    const row = await env.DB.prepare(
      'SELECT detail_json FROM knowledge_reviews WHERE id = ? AND map_id = ?'
    ).bind(body.reviewId, map.id).first();

    if (!row || !row.detail_json) {
      return json({ error: 'That review has expired. Run the review again.' }, 404);
    }

    let saved;
    try { saved = JSON.parse(row.detail_json); }
    catch (err) { return json({ error: 'That review could not be read. Run it again.' }, 500); }

    const applied = await applyAlignment(env, map, user, nodes, saved, true);
    return json({ ok: true, result: saved, applied });
  }

  const spec = ACTIONS[body.action];
  const focus = body.node || nodes.find(n => n.id === body.nodeId) || null;
  const prompt = buildPrompt(spec, map, nodes, edges, focus, body.question,
                             Array.isArray(body.history) ? body.history : null);

  let raw;
  try { raw = await runModel(env, prompt); }
  catch (err) { return json({ error: 'AI service unavailable' }, 502); }

  const result = parseResult(raw);
  if (!result) return json({ error: 'The model returned an unusable answer. Try again.' }, 502);

  // Persist what belongs in the record.
  if (body.action === 'review_map') {
    context.waitUntil(saveReview(env, map, user, result));
  }

  // review_and_align is the only action that writes structural change back.
  // Everything it proposes is filtered against each node's ai_open flag first,
  // and per-node opinions land in ai_note — never in the node's own fields.
  //
  // The review is saved BEFORE returning, and its id goes back with the
  // proposal, so the Apply step can replay exactly what the user agreed to
  // instead of asking the model again. See the apply branch above.
  if (body.action === 'review_and_align') {
    const applied = await applyAlignment(env, map, user, nodes, result, false);
    const reviewId = await saveReview(env, map, user, result);
    return json({ ok: true, result, applied, reviewId });
  }
  if (body.action === 'draft_summary' && body.nodeId && result.summary) {
    context.waitUntil(saveNodeSuggestion(env, body.nodeId, result));
  }
  if (body.action === 'answer_question' && body.question) {
    /* Verify the grounding rather than taking the model's word for it.
       Every title in usedNodes has to be a real node; anything else is
       dropped. If nothing survives, the answer was not built from this map
       whatever it claims, so it is marked as a gap. The model saying
       "answered: true" is a claim, not evidence. */
    const titles = new Map(nodes.map(n => [String(n.title).trim().toLowerCase(), n.title]));
    const verified = (result.usedNodes || [])
      .map(t => titles.get(String(t).trim().toLowerCase()))
      .filter(Boolean);

    let used = Array.from(new Set(verified));

    /* If the model wrote a real answer but forgot to fill usedNodes, look for
       the grounding in the answer itself before calling it a gap. Declaring
       "this map does not cover that" about a map that plainly does is worse
       than a missing citation line. Titles and aliases both count, since the
       answer may well use the alias the question did. */
    if (!used.length) {
      const answerText = [
        result.summary || '',
        ...(result.sections || []).flatMap(sec =>
          [sec.heading || '', sec.text || '', ...(sec.items || [])])
      ].join(' ').toLowerCase();

      if (answerText.trim().length > 20) {
        const found = new Set();
        nodes.forEach(n => {
          const names = [n.title].concat(asArray(n.aliases));
          const hit = names.some(name => {
            const needle = String(name).trim().toLowerCase();
            // Two characters or fewer matches almost anything by accident.
            return needle.length > 2 && answerText.indexOf(needle) !== -1;
          });
          if (hit) found.add(n.title);
        });
        used = Array.from(found).slice(0, 25);
      }
    }

    result.usedNodes = used;
    // Only now, with nothing declared and nothing inferable, is it a gap.
    if (!used.length) result.answered = false;

    context.waitUntil(saveQuestion(env, map, user, body.question, result));
  }

  return json({ ok: true, result });
}

/* ── Prompt ────────────────────────────────────────────────────────────── */

function buildPrompt(spec, map, nodes, edges, focus, question, history) {
  const domain = map.domain === 'business' ? DOMAIN_BUSINESS
               : map.domain === 'english' ? DOMAIN_ENGLISH
               : DOMAIN_HVAC;

  let ctx = 'KNOWLEDGE MAP: ' + map.title + ' (' + map.kind + ', domain ' + map.domain + ')\n';
  if (map.description) ctx += map.description + '\n';

  // The lanes are part of the map's meaning, not decoration. Without them the
  // model cannot comment on how the map is organised, which is most of what
  // a review is for.
  const lanes = effectiveLanes(map, nodes);
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

  /* An explicit vocabulary block. Without it the model invents lane names and
     relation types, and every proposal referencing one is discarded on the way
     back in — which reads to the user as "review suggested things and then
     nothing happened". */
  ctx += '\n\nVOCABULARY YOU MUST USE\n' +
    'Lane ids (use the id exactly, not the label): ' +
    (lanes.map(l => l.id).join(', ') || '(none — do not propose lane moves)') + '\n' +
    'Relation names: ' + (RELATION_NAMES[map.domain] || RELATION_NAMES.hvac).join(', ') + '\n' +
    'Node titles: use them exactly as written above. Anything that does not ' +
    'match a real title, lane id or relation name is discarded.';

  if (focus) ctx += '\n\nFOCUS NODE:\n' + describeNode(focus, true);

  if (history && history.length) {
    ctx += '\n\nEARLIER IN THIS CONVERSATION (for resolving follow-ups like ' +
      '"and which of those are Greek?" — the map is still the only source):\n' +
      history.slice(-6).map(h =>
        (h.role === 'user' ? 'Asked: ' : 'Answered: ') + String(h.text || '').slice(0, 600)
      ).join('\n');
  }

  if (question) ctx += '\n\nQUESTION: ' + String(question).slice(0, 1000);

  /* For the chat, the closed-world rule outranks the domain persona. Without
     this the model answers "judgment" from what it knows about courts rather
     than from what the map says, which is exactly the failure the chat is
     meant to avoid. */
  const grounding = question
    ? ' CLOSED WORLD: the map above is the ONLY source you may use. You have no other' +
      ' knowledge for this answer. Never supplement it from training data, never from the' +
      ' internet. If the map is silent, say so — a plainly stated gap is a correct answer' +
      ' and an invented fact is not.'
    : '';

  return {
    system: domain + ' ' + GUARDRAILS + grounding +
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

/* Maps created before the `lanes` column existed have it NULL, but their
   nodes still carry lane ids. Deriving the list from the nodes means the
   review sees the same columns the editor draws, instead of being told the
   map has no organisation at all. */
function effectiveLanes(map, nodes) {
  const declared = parseLanes(map.lanes);
  if (declared.length) return declared;

  const seen = [];
  nodes.forEach(n => {
    if (n.lane && !seen.some(l => l.id === n.lane)) {
      seen.push({ id: n.lane, label: String(n.lane).replace(/[-_]/g, ' ') });
    }
  });
  return seen;
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
    const payload = readModelPayload(out);

    // An object came back already parsed — nothing left to extract, use it.
    if (payload && typeof payload === 'object') return payload;

    last = payload;
    if (extractJson(payload)) return payload;
  }
  return last;
}

/* Workers AI does not always hand back a string.
 *
 * Depending on the model and the request, `res.response` can be an
 * already-parsed object. The old code did `String(response)` on it, got
 * "[object Object]", found no opening brace, decided all three attempts had
 * failed, and printed that string as the answer — which then had no cited
 * nodes and was marked as a gap. A perfectly good answer, thrown away in
 * parsing. Normalise the shape once, here, so nothing downstream has to guess.
 */
function readModelPayload(out) {
  if (out == null) return '';
  if (typeof out === 'string') return out;

  const inner = out.response !== undefined ? out.response : out;
  if (typeof inner === 'string') return inner;
  if (inner && typeof inner === 'object') return inner;

  return String(inner || '');
}

function extractJson(text) {
  if (!text) return null;
  // Already an object: it is the parsed result, not something to parse.
  if (typeof text === 'object') return text;
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

  // Prose fallback. Only ever for genuine text — stringifying an object here
  // is what produced "[object Object]" on screen, so an object that survived
  // sanitising with nothing usable is treated as a failure, not as an answer.
  if (raw && typeof raw === 'object') return null;

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
  if (typeof obj.answered === 'boolean') out.answered = obj.answered;
  if (Array.isArray(obj.usedNodes)) {
    out.usedNodes = obj.usedNodes
      .filter(n => typeof n === 'string' && n.trim())
      .slice(0, 25).map(n => n.slice(0, 200));
  }
  if (Array.isArray(obj.moves)) {
    out.moves = obj.moves.slice(0, 100).map(m => ({
      node: String((m && m.node) || '').slice(0, 300),
      lane: String((m && m.lane) || '').slice(0, 60),
      why: String((m && m.why) || '').slice(0, 300)
    })).filter(m => m.node && m.lane);
  }
  if (Array.isArray(obj.connections)) {
    out.connections = obj.connections.slice(0, 80).map(c => ({
      from: String((c && c.from) || '').slice(0, 300),
      relation: String((c && c.relation) || '').slice(0, 40),
      to: String((c && c.to) || '').slice(0, 300),
      why: String((c && c.why) || '').slice(0, 300)
    })).filter(c => c.from && c.to && c.relation);
  }
  if (Array.isArray(obj.nodeNotes)) {
    out.nodeNotes = obj.nodeNotes.slice(0, 200).map(n => ({
      node: String((n && n.node) || '').slice(0, 300),
      note: String((n && n.note) || '').slice(0, 2000)
    })).filter(n => n.node && n.note);
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

/* ── Applying an alignment ─────────────────────────────────────────────────
   The trust boundary, enforced here rather than in the prompt.

   A node with ai_open = 0 is a node a human has declared finished. The model
   is still shown it \u2014 it needs the context to reason about the rest of the
   map \u2014 but nothing it says about that node is written anywhere. Locked
   nodes are not moved, do not receive an ai_note, and are not given new
   connections.

   `apply` false is a dry run: the counts come back so the user can see what
   would happen before agreeing to it.
   ------------------------------------------------------------------------ */

async function applyAlignment(env, map, user, nodes, result, apply) {
  const now = nowIso();
  const summary = { movedNodes: 0, addedEdges: 0, notedNodes: 0, skippedLocked: 0, applied: !!apply };

  // Title -> node, case-insensitive, so the model does not have to match case.
  const byTitle = new Map();
  nodes.forEach(n => byTitle.set(String(n.title).trim().toLowerCase(), n));
  const find = (title) => byTitle.get(String(title || '').trim().toLowerCase()) || null;

  const open = (n) => n && Number(n.aiOpen) === 1;

  // Counted so a review that proposes plenty but resolves to nothing can say
  // why, instead of returning three zeroes and looking broken.
  let unmatchedTitles = 0;

  /* Lane vocabulary.
     Two things were wrong here and both silently dropped every move:

     1. Maps created before the `lanes` column existed have it NULL. The HVAC
        and Business maps are in that state, which is why review appeared to
        work on the Dictionary (whose lanes were written by the migration)
        and do nothing everywhere else. The lanes actually in use on the
        nodes are a perfectly good fallback.
     2. Only the label was accepted. The model is shown each node's lane
        *id* — 'refrigeration', 'wordparts' — so it usually answers with the
        id, which then matched nothing. Both are accepted now. */
  // Squashing to letters and digits makes 'Air side', 'air-side' and 'airside'
  // the same key, so a lane still resolves however the model chose to write it.
  const laneKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const laneVocab = {};
  const addLane = (alias, id) => { const k = laneKey(alias); if (k) laneVocab[k] = id; };

  asArray(map.lanes).forEach(l => {
    if (!l || !l.id) return;
    addLane(l.id, l.id);
    if (l.label) addLane(l.label, l.id);
  });

  if (!Object.keys(laneVocab).length) {
    nodes.forEach(n => { if (n.lane) addLane(n.lane, n.lane); });
  }

  /* Lane moves */
  const moves = [];
  const unknownLanes = new Set();
  (result.moves || []).forEach(m => {
    const node = find(m.node);
    if (!node) { unmatchedTitles++; return; }
    if (!open(node)) { summary.skippedLocked++; return; }
    const laneId = laneVocab[laneKey(m.lane)];
    if (!laneId) { unknownLanes.add(String(m.lane)); return; }
    if (laneId === node.lane) return;
    moves.push({ id: node.id, lane: laneId });
  });
  summary.movedNodes = moves.length;
  // Surfaced rather than swallowed: a move that names a lane the map does not
  // have is worth telling the user about, not quietly discarding.
  if (unknownLanes.size) summary.unknownLanes = Array.from(unknownLanes).slice(0, 10);

  /* New connections \u2014 both ends must be unlocked, and the edge must not exist */
  const existing = await env.DB.prepare(
    'SELECT from_id, to_id, relation FROM knowledge_edges WHERE map_id = ?'
  ).bind(map.id).all();
  const seen = new Set(((existing && existing.results) || []).map(
    e => e.from_id + '|' + e.relation + '|' + e.to_id
  ));

  const validRelations = new Set(RELATION_NAMES[map.domain] || RELATION_NAMES.hvac);

  const newEdges = [];
  const unknownRelations = new Set();
  (result.connections || []).forEach(c => {
    const from = find(c.from), to = find(c.to);
    if (!from || !to || from.id === to.id) return;
    if (!open(from) || !open(to)) { summary.skippedLocked++; return; }
    // An invented relation name would render as an unlabelled line the editor
    // cannot describe. Better to drop it and say so.
    if (!validRelations.has(c.relation)) { unknownRelations.add(String(c.relation)); return; }
    const key = from.id + '|' + c.relation + '|' + to.id;
    if (seen.has(key)) return;
    seen.add(key);
    newEdges.push({ from: from.id, to: to.id, relation: c.relation, label: '' });
  });
  summary.addedEdges = newEdges.length;
  if (unknownRelations.size) summary.unknownRelations = Array.from(unknownRelations).slice(0, 10);

  /* Per-node opinions */
  const notes = [];
  (result.nodeNotes || []).forEach(n => {
    const node = find(n.node);
    if (!node) { unmatchedTitles++; return; }
    if (!open(node)) { summary.skippedLocked++; return; }
    notes.push({ id: node.id, note: n.note });
  });
  summary.notedNodes = notes.length;
  if (unmatchedTitles) summary.unmatchedTitles = unmatchedTitles;

  if (!apply) return summary;

  const uid = userId(user);
  const batch = [];

  if (moves.length) {
    const stmt = env.DB.prepare(
      'UPDATE knowledge_nodes SET lane = ?, updated_by = ?, updated_at = ? WHERE id = ?'
    );
    moves.forEach(m => batch.push(stmt.bind(m.lane, uid, now, m.id)));
  }

  if (notes.length) {
    const stmt = env.DB.prepare(
      'UPDATE knowledge_nodes SET ai_note = ?, ai_note_at = ? WHERE id = ?'
    );
    notes.forEach(n => batch.push(stmt.bind(n.note, now, n.id)));
  }

  if (newEdges.length) {
    const stmt = env.DB.prepare(
      'INSERT INTO knowledge_edges (id, map_id, from_id, to_id, relation, medium, label, status, ' +
      'created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    // Proposed edges arrive as draft. An AI suggestion is not approved
    // knowledge, and the graph must not start publishing a relationship
    // nobody has looked at.
    newEdges.forEach(e => batch.push(stmt.bind(
      newId('e'), map.id, e.from, e.to, e.relation, null, e.label, 'draft', uid, now
    )));
  }

  if (batch.length) await env.DB.batch(batch);
  return summary;
}

/* ── Persistence ───────────────────────────────────────────────────────── */

async function saveReview(env, map, user, result) {
  try {
    const now = nowIso();
    const id = newId('rev');
    await env.DB.prepare(
      'INSERT INTO knowledge_reviews (id, map_id, scope, scope_id, summary, detail_json, score, ' +
      'model, requested_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(
      id, map.id, 'map', null,
      String(result.summary || '').slice(0, 4000),
      JSON.stringify(result).slice(0, 100000),
      map.knowledge_score, MODEL, userId(user), now
    ).run();

    await env.DB.prepare('UPDATE knowledge_maps SET last_reviewed_at = ? WHERE id = ?')
      .bind(now, map.id).run();
    return id;
  } catch (err) {
    // Review history is not worth failing the response over, but without a
    // saved row there is nothing to apply, so the caller must know.
    return null;
  }
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
