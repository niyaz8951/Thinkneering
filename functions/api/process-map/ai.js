/**
 * POST /api/process-map/ai
 *
 * Body:    { action, map: {title, project, computed, nodes[], edges[]}, selectedId?, card? }
 * Returns: { ok: true, result: { title?, summary?, sections?: [{heading, text?, items[]}] } }
 *
 * Cloudflare Workers AI. Bindings required on the Pages project:
 *   AI  -> Workers AI
 *   DB  -> D1 (thinkneering-db), used for the suggestion log only
 */

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/* ── Domain framing ───────────────────────────────────────────────
   The model is told what business it is looking at. Without this it
   answers like a generic management consultant and the output is
   useless to an application engineer.
   ---------------------------------------------------------------- */

const DOMAIN = [
  'You are a process analyst for an HVAC equipment manufacturer and supplier delivering equipment',
  '(air handling units, fan coil units, chillers, ventilation and controls) into MEP construction',
  'projects, mainly in the GCC. You understand how these orders actually run: a consultant issues a',
  'specification, the supplier bids with a compliance matrix, the main contractor holds the commercial',
  'relationship, technical submittals go to the consultant for approval and usually come back "revise',
  'and resubmit", the factory will not book a slot before the advance or LC clears, long-lead components',
  'set the real delivery date, a witnessed factory acceptance test is often specified, and the shipment',
  'has to clear customs against a conformity certificate before it reaches site. You know the common',
  'reference standards (Eurovent, EN 1886, EN 13053, AHRI 430/440/410/550, ISO 16890, ASHRAE 62.1 and',
  '90.1) and the regional approval regimes (SASO/SABER, ESMA/ECAS, Dubai Municipality, QCS, Kahramaa,',
  'Civil Defence) but you never claim a specific product complies with any of them.'
].join(' ');

const GUARDRAILS = [
  'Work ONLY from the process data supplied.',
  'NEVER invent specific capacities, dimensions, class ratings, certificate numbers, model numbers,',
  'prices, lead times or dates that are not in the data. If a specific value is needed but missing,',
  'write "TO VERIFY" instead of guessing.',
  'NEVER state or imply that equipment complies with a standard — compliance is established by the',
  'submittal and test certificates, not by you.',
  'Qualitative observations, pattern-based warnings and general recommendations are fine.',
  'Fabricated specifics are not, ever.',
  'Where the data already contains a computed figure (critical path days, slack, forecast date), use',
  'that figure exactly rather than estimating your own.',
  'Write in plain professional English an application engineer would use in a project email.',
  'Be concise. No preamble, no apologies, no restating the question.'
].join(' ');

const SECTIONS_SHAPE = '{"title":"string","summary":"string","sections":[{"heading":"string","items":["string"]}]}';

const ACTIONS = {
  summarise_card: {
    shape: '{"summary":"string"}',
    instruction:
      'Write one paragraph (max 45 words) summarising the selected card: what happens, who does it, ' +
      'why it matters to the delivery date, and what the next party needs from it.'
  },

  explain_process: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Explain this supply process to someone new to the business — a graduate engineer or a new ' +
      'salesperson. Cover: what it delivers, how the order moves from tender to site, who owns each ' +
      'phase, where the hand-offs are, and which gates cannot be skipped.'
  },

  submittal_readiness: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Review the engineering and submittal stage. Judge whether the submittal pack modelled here is ' +
      'likely to survive a consultant review first time. Sections: What is covered, What a consultant ' +
      'usually asks for that is missing here, Most likely reason for a revise-and-resubmit, ' +
      'What to add before issuing. Base this on the cards present, not on assumed content.'
  },

  delivery_risk: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Assess the risk of missing the required-on-site date. Use the supplied criticalPathDays, ' +
      'slackDays and forecastOnSite exactly as given. Sections: Position (state the computed numbers), ' +
      'What is driving the duration (name the cards on the critical path), Where the schedule is fragile, ' +
      'Options to compress. Do not invent alternative durations.'
  },

  bottlenecks: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Focus on stopper, waiting and approval cards. For each one give: the likely root cause in this ' +
      'kind of supply chain, what downstream work it blocks, an impact level (low/medium/high), and one ' +
      'practical mitigation the supplier can actually control.'
  },

  detect_missing: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Identify steps missing from this supply process. Look specifically for: unhandled decision or ' +
      'approval branches, no resubmittal loop, no compliance matrix, no factory or third-party ' +
      'inspection, no payment or LC gate, no export or conformity documentation, no customs step, no ' +
      'site access confirmation, no handover or O&M deliverable, dead-end cards. One line each with ' +
      'the reason it matters.'
  },

  optimize: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Analyse where time and margin leak out of this process. Sections: Duplicated or redundant work, ' +
      'Approval and review load, Work that could run in parallel instead of in series, Steps that could ' +
      'start earlier at acceptable risk, Automation or template opportunities.'
  },

  risk_register: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Produce a risk register for this order. Group by stage. For each risk give: the event, the ' +
      'trigger to watch for, likely schedule or cost consequence in qualitative terms, the owner, and ' +
      'the mitigation. Do not put numbers on consequences that are not in the data.'
  },

  generate_sop: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Write a standard operating procedure for this process. Sections: Purpose, Scope, ' +
      'Responsibilities (by party), Procedure (numbered, in flow order, naming the responsible party ' +
      'per step), Records and deliverables, Hold points that require approval before proceeding.'
  },

  generate_itp: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Draft an inspection and test plan covering the quality stage of this process. For each ' +
      'inspection or test card give: what is verified, the acceptance basis (reference the standards ' +
      'listed on the card, or write TO VERIFY where none is given), who performs it, who witnesses it, ' +
      'and the record produced. Mark each as a hold point, witness point or review point.'
  },

  delivery_checklist: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Produce a site delivery checklist from this process. Sections: Before the truck is loaded, ' +
      'Documents that must travel with the shipment, Site access confirmations needed before dispatch, ' +
      'On arrival, Sign-off and handover. One short action per line, starting with a verb.'
  },

  consultant_response: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Draft the structure of a response to consultant comments on a technical submittal, based on ' +
      'this process. Sections: Suggested response format (comment / response / action / revision ' +
      'reference), Points to address explicitly given the cards present, Tone and evidence to attach, ' +
      'What to avoid. Do not draft answers to comments that are not in the data — provide the frame.'
  },

  generate_quiz: {
    shape: SECTIONS_SHAPE,
    instruction:
      'Create a short training quiz for a new engineer learning this process: 6 questions testing ' +
      'understanding of the sequence, the gates and who owns what. Format each item as ' +
      '"Q: ... A: ..." on a single line.'
  },

  label_connection: {
    shape: '{"summary":"string"}',
    instruction:
      'Propose a short connector label (max 4 words) describing the relationship between two cards, ' +
      'in the vocabulary of this business — for example "Approval required", "Revise and resubmit", ' +
      '"Payment cleared", "Released by customs", "Awaiting site access".'
  }
};

/* ── Handler ─────────────────────────────────────────────────────── */

export async function onRequestPost(context) {
  const { request, env } = context;

  // Site middleware authenticates; this is a second gate in case the
  // middleware order ever changes.
  const user = context.data && context.data.user;
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body;
  try { body = await request.json(); }
  catch (err) { return json({ error: 'Invalid JSON body' }, 400); }

  const action = ACTIONS[body.action] ? body.action : null;
  if (!action) return json({ error: 'Unknown action' }, 400);
  if (!body.map || !Array.isArray(body.map.nodes) || !body.map.nodes.length) {
    return json({ error: 'No process data supplied' }, 400);
  }
  if (body.map.nodes.length > 200) return json({ error: 'Process too large (max 200 cards)' }, 413);

  const spec = ACTIONS[action];
  const prompt = buildPrompt(spec, body);

  let raw;
  try { raw = await runModel(env, prompt); }
  catch (err) { return json({ error: 'AI service unavailable' }, 502); }

  const result = parseResult(raw);
  if (!result) return json({ error: 'The model returned an unusable answer. Try again.' }, 502);

  context.waitUntil(logSuggestion(env, user, action, body, result));
  return json({ ok: true, result });
}

/* ── Prompt building ─────────────────────────────────────────────── */

function buildPrompt(spec, body) {
  const map = body.map;
  const selected = body.card || (map.nodes || []).find(n => n.id === body.selectedId) || null;

  let ctx = 'PROCESS: ' + (map.title || 'Untitled') + '\n';
  ctx += describeProject(map.project, map.computed);
  ctx += '\n\n' + describeCards(map);
  ctx += '\n\n' + describeLinks(map);
  if (selected) ctx += '\n\nSELECTED CARD:\n' + describeCard(selected);

  return {
    system: DOMAIN + ' ' + GUARDRAILS +
      ' Respond with a single JSON object matching this shape and nothing else: ' + spec.shape +
      ' Do not wrap it in markdown fences.',
    user: ctx + '\n\nTASK: ' + spec.instruction
  };
}

function describeProject(p, computed) {
  if (!p) return '';
  const bits = [];
  if (p.code) bits.push('reference ' + p.code);
  if (p.productLine) bits.push('product ' + p.productLine);
  if (p.factory) bits.push('factory ' + p.factory);
  if (p.consultant) bits.push('consultant ' + p.consultant);
  if (p.contractor) bits.push('main contractor ' + p.contractor);
  if (p.workWeek) bits.push(p.workWeek + '-day working week');

  let out = bits.length ? 'PROJECT: ' + bits.join(', ') : '';
  if (computed) {
    const c = [];
    if (computed.criticalPathDays != null) c.push('critical path ' + computed.criticalPathDays + ' calendar days');
    if (computed.forecastOnSite) c.push('forecast on site ' + computed.forecastOnSite);
    if (p.requiredOnSite) c.push('required on site ' + p.requiredOnSite);
    if (computed.slackDays != null) {
      c.push(computed.slackDays >= 0
        ? computed.slackDays + ' days of float'
        : Math.abs(computed.slackDays) + ' days LATE');
    }
    if (c.length) out += '\nCOMPUTED (use these figures exactly): ' + c.join(', ');
  }
  return out;
}

function describeCard(n) {
  const b = ['- ' + (n.title || 'Untitled') + ' [' + (n.type || 'step') + ' | ' + (n.stage || 'no stage') + ']'];
  if (n.party) b.push('  responsible: ' + n.party);
  if (n.leadCalendarDays) b.push('  lead time: ' + n.leadCalendarDays + ' calendar days');
  if (n.onCriticalPath) b.push('  ON CRITICAL PATH');
  if (n.docRef) b.push('  document ref: ' + n.docRef);
  if (n.standards && n.standards.length) b.push('  standards cited: ' + n.standards.join(', '));
  if (n.tags && n.tags.length) b.push('  tags: ' + n.tags.join(', '));
  if (n.description) b.push('  description: ' + n.description);
  if (n.notes) b.push('  notes: ' + n.notes);
  return b.join('\n');
}

function describeCards(map) {
  const byStage = {};
  map.nodes.forEach(n => {
    const s = n.stage || 'unassigned';
    (byStage[s] = byStage[s] || []).push(n);
  });
  return 'CARDS BY STAGE:\n' + Object.keys(byStage).map(stage => {
    return stage.toUpperCase() + '\n' + byStage[stage].map(describeCard).join('\n');
  }).join('\n\n');
}

function describeLinks(map) {
  const byId = {};
  map.nodes.forEach(n => { byId[n.id] = n; });
  const lines = (map.edges || []).map(e => {
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) return null;
    return '- ' + a.title + ' --[' + e.kind + (e.label ? ': ' + e.label : '') + ']--> ' + b.title;
  }).filter(Boolean);
  return 'FLOW:\n' + (lines.join('\n') || '(no connections recorded)');
}

/* ── Model call with a retry ladder ──────────────────────────────── */

async function runModel(env, prompt) {
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const attempts = [
    { max_tokens: 1400, temperature: 0.2 },
    { max_tokens: 1400, temperature: 0.5 },
    { max_tokens: 900, temperature: 0.1 }
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

/* ── Response handling ───────────────────────────────────────────── */

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch (err) { return null; }
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
  if (Array.isArray(obj.sections)) {
    out.sections = obj.sections.slice(0, 12).map(sec => {
      const s = {};
      if (sec && typeof sec.heading === 'string') s.heading = sec.heading.slice(0, 160);
      if (sec && typeof sec.text === 'string') s.text = sec.text.slice(0, 2000);
      if (sec && Array.isArray(sec.items)) {
        s.items = sec.items.slice(0, 30)
          .map(i => (typeof i === 'string' ? i : (i && i.text) || ''))
          .filter(Boolean)
          .map(i => i.slice(0, 700));
      }
      return s;
    }).filter(s => s.heading || s.text || (s.items && s.items.length));
  }
  return (out.title || out.summary || (out.sections && out.sections.length)) ? out : null;
}

/* ── Suggestion log (mirrors the Compliance Maker ingest loop) ───── */

async function logSuggestion(env, user, action, body, result) {
  if (!env.DB) return;
  try {
    const p = body.map.project || {};
    await env.DB.prepare(
      'INSERT INTO process_map_ai_log (id, user_id, action, map_title, project_code, product_line, ' +
      'factory, node_count, edge_count, critical_path_days, slack_days, request_json, response_json, ' +
      'model, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(
      crypto.randomUUID(),
      String(user.id || user.username || 'unknown'),
      action,
      String(body.map.title || ''),
      String(p.code || ''),
      String(p.productLine || ''),
      String(p.factory || ''),
      body.map.nodes.length,
      (body.map.edges || []).length,
      body.map.computed ? body.map.computed.criticalPathDays : null,
      body.map.computed ? body.map.computed.slackDays : null,
      JSON.stringify(body.map).slice(0, 120000),
      JSON.stringify(result).slice(0, 60000),
      MODEL,
      new Date().toISOString()
    ).run();
  } catch (err) {
    // Logging must never break the user-facing response.
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
