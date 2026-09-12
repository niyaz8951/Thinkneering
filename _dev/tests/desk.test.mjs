/* The desk and "ask your graph".

   A knowledge base is a deposit system — in today, out in eight months — and
   nobody sustains that on discipline. The front door is therefore the place
   you ask it something, because a graph that pays you back is the only kind
   anyone keeps filling. These pin the parts that make that safe. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const ask = readFileSync(resolve(ROOT, 'functions/api/knowledge/ask.js'), 'utf8');
const home = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const css = readFileSync(resolve(ROOT, 'assets/css/global.css'), 'utf8');
const g = readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

// --- the answer path
t('sign-in is required', ask.includes("if (!user) return json({ error: 'Sign in required' }, 401)"));
t('retrieval is the shared one, so the approved-only rule is the same rule',
  ask.includes("from '../../_lib/graph-retrieval.js'"));
t('the model is told it has no other source',
  ask.includes('Use the knowledge block and nothing else'));
t('and told never to invent a value', ask.includes('Never invent a number'));

// The most important behaviour here: no matches means no model call at all.
t('an empty retrieval never reaches the model',
  ask.indexOf('if (!result.matches.length)') < ask.indexOf('env.AI.run'));
t('and says so plainly rather than guessing',
  ask.includes("answer: 'Nothing approved covers this yet.'"));
t('the unmatched terms come back — they name what to write next',
  ask.includes('gaps: result.unmatchedTerms'));

t('every measured value is checked against what the model was given',
  ask.includes('unsupportedMeasures(raw, allowed)'));
t('the question itself counts as a source for those values',
  ask.includes('const allowed = question'));
t('an invented figure is named, not hidden',
  ask.includes('should not be quoted'));
t('conflicting approved values are surfaced', ask.includes('detectConflicts'));
t('answers are cited', ask.includes('citations: cited'));
t('and logged, so a disputed answer walks back', ask.includes('logUsage'));

// Degrading rather than failing.
t('a missing AI binding still returns the matching nodes',
  /if \(!env\.AI\)[\s\S]{0,300}matches:/.test(ask));
t('an AI error still returns the matching nodes',
  /catch \(err\)[\s\S]{0,300}matches:/.test(ask));

// --- the fabrication guard is shared, not copied
const measures = readFileSync(resolve(ROOT, 'functions/_lib/measures.js'), 'utf8');
const cAsk = readFileSync(resolve(ROOT, 'functions/api/compliance/ask.js'), 'utf8');
t('there is one measure regex', (measures.match(/const MEASURE_RE/g) || []).length === 1);
t('compliance imports it rather than keeping its own',
  cAsk.includes("from '../../_lib/measures.js'") && !cAsk.includes('const MEASURE_RE'));
t('the shared unit list knows m/s, which this domain uses constantly',
  measures.includes('m\\/s'));

// --- the desk
t('the ask box is on the home page', home.includes('id="ask-form"'));
t('it is labelled for screen readers', home.includes('class="sr-only" for="ask"'));
t('the queues are counts, not lists — a desk you can finish',
  home.includes('function tile') && home.includes('desk__tile'));
t('an empty queue reads as finished, not broken', css.includes('.desk__tile.is-clear'));
t('nothing-on-file is styled as an answer, not an error',
  css.includes('.desk__answer.is-empty'));
t('the warning line about unquotable figures is loud', css.includes('.desk__note'));

// --- the rename
t('the tab bar says Maps and Library', g.includes("maps: 'Maps'") && g.includes("library: 'Library'"));
t('the footer points at the new slugs',
  g.includes('/s/maps') && g.includes('/s/library'));
t('no navigation still points at the old slugs',
  !/href=\\"\/s\/knowledge|href=\\"\/s\/education/.test(g));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
