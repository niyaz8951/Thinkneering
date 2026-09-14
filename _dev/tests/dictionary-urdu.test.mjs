/**
 * Dictionary — Urdu generation and script guards.
 *
 *   node --test _dev/tests/dictionary-urdu.test.mjs
 *
 * No dependencies. env.AI is a stub that records every call, which is how the
 * central claim is tested: the Urdu pass must never be shown the Hindi word.
 * That single fact is the whole reason Urdu came back as Devanagari respelled
 * in Urdu letters, so it is the thing worth a regression test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generate,
  cleanHindi,
  cleanUrdu,
  cleanRoman
} from '../../functions/api/dictionary/lookup.js';

/** Answers the entry pass and the Urdu pass by looking at the schema asked for. */
function stubAI(answers) {
  const calls = [];
  return {
    calls,
    AI: {
      async run(model, options) {
        const fields = Object.keys(options.response_format.json_schema.properties);
        const kind = fields.includes('meaning') ? 'entry' : 'urdu';
        calls.push({ kind, model, messages: options.messages });
        const answer = answers[kind];
        if (typeof answer === 'function') return answer(calls.length);
        if (answer instanceof Error) throw answer;
        return { response: answer };
      }
    }
  };
}

const ENTRY = {
  meaning: 'The set of rules a country is governed by.',
  usage: ['The constitution guarantees a fair trial.'],
  senses: [],
  synonyms: ['charter', 'statute', 'framework'],
  antonyms: ['lawlessness'],
  concepts: ['parliament'],
  memoryHook: 'Constitution — what a state is constituted of.',
  origin: 'Latin constituere, to set up.',
  connection: 'Often confused with a bill of rights, which is one part of it.',
  hindi: 'संविधान'
};

test('the Urdu pass never sees the Hindi word', async () => {
  const stub = stubAI({
    entry: ENTRY,
    urdu: { urdu: 'آئین', urduRoman: 'Aaeen' }
  });

  await generate(stub, 'constitution', 'The constitution was amended.', 'english');

  const urduCall = stub.calls.find((c) => c.kind === 'urdu');
  assert.ok(urduCall, 'a dedicated Urdu call is made');

  const sent = urduCall.messages.map((m) => m.content).join('\n');
  assert.ok(!/[\u0900-\u097F]/.test(sent), 'no Devanagari reaches the Urdu prompt');
  assert.ok(sent.includes('constitution'), 'the English word does');
  assert.ok(sent.includes('governed by'), 'and so does the meaning, for the sense');
});

test('the Urdu pass result replaces nothing else on the entry', async () => {
  const stub = stubAI({
    entry: ENTRY,
    urdu: { urdu: 'آئین', urduRoman: 'Aaeen' }
  });

  const result = await generate(stub, 'constitution', '', 'english');

  assert.equal(result.urdu, 'آئین');
  assert.equal(result.urduRoman, 'Aaeen');
  assert.equal(result.hindi, 'संविधान');
  assert.equal(result.meaning, ENTRY.meaning);
});

test('Devanagari offered as Urdu is dropped, not shown', async () => {
  const stub = stubAI({
    entry: ENTRY,
    // The old failure, now arriving from the second pass instead.
    urdu: { urdu: 'संविधान', urduRoman: 'Samvidhan' }
  });

  const result = await generate(stub, 'constitution', '', 'english');
  assert.equal(result.urdu, null, 'a wrong-script answer is worse than none');
  assert.equal(result.urduRoman, null);
  assert.equal(result.meaning, ENTRY.meaning, 'the rest of the entry survives');
});

test('an Urdu answer written in roman letters is dropped', async () => {
  const stub = stubAI({
    entry: ENTRY,
    urdu: { urdu: 'Aaeen', urduRoman: 'Aaeen' }
  });

  const result = await generate(stub, 'constitution', '', 'english');
  assert.equal(result.urdu, null);
});

test('a failed Urdu pass still yields a usable entry', async () => {
  const stub = stubAI({
    entry: ENTRY,
    urdu: new Error('daily allocation reached')
  });

  const result = await generate(stub, 'constitution', '', 'english');
  assert.equal(result.meaning, ENTRY.meaning);
  assert.equal(result.hindi, 'संविधान');
  assert.equal(result.urdu, null);
});

test('the Urdu pass retries once before giving up', async () => {
  const stub = stubAI({
    entry: ENTRY,
    urdu: (call) => ({ response: call === 2 ? { urdu: '', urduRoman: '' } : { urdu: 'آئین', urduRoman: 'Aaeen' } })
  });

  const result = await generate(stub, 'constitution', '', 'english');
  assert.equal(stub.calls.filter((c) => c.kind === 'urdu').length, 2);
  assert.equal(result.urdu, 'آئین');
});

test('synonyms and antonyms come through, capped at three', async () => {
  const stub = stubAI({
    entry: Object.assign({}, ENTRY, {
      synonyms: ['charter', 'statute', 'framework', 'code'],
      antonyms: ['lawlessness', 'anarchy']
    }),
    urdu: { urdu: 'آئین', urduRoman: 'Aaeen' }
  });

  const result = await generate(stub, 'constitution', '', 'english');
  assert.deepEqual(result.related.synonyms, ['charter', 'statute', 'framework']);
  assert.deepEqual(result.related.antonyms, ['lawlessness', 'anarchy']);
});

test('a word with no opposite is not forced to invent one', async () => {
  const stub = stubAI({
    entry: Object.assign({}, ENTRY, { synonyms: ['chiller'], antonyms: [] }),
    urdu: { urdu: 'چلر', urduRoman: 'Chiller' }
  });

  const result = await generate(stub, 'chiller', '', 'hvac');
  assert.deepEqual(result.related.antonyms, []);
  assert.deepEqual(result.related.synonyms, ['chiller']);
});

test('a shared Hindustani word is allowed to be the same in both', async () => {
  const stub = stubAI({
    entry: Object.assign({}, ENTRY, { hindi: 'पानी' }),
    urdu: { urdu: 'پانی', urduRoman: 'Paani' }
  });

  const result = await generate(stub, 'water', '', 'general');
  assert.equal(result.urdu, 'پانی', 'not every match is a transliteration');
});

test('script guards accept the right script and refuse the others', () => {
  assert.equal(cleanHindi('संविधान'), 'संविधान');
  assert.equal(cleanHindi('آئین'), null);
  assert.equal(cleanHindi('constitution'), null);

  assert.equal(cleanUrdu('آئین'), 'آئین');
  assert.equal(cleanUrdu('संविधान'), null);
  assert.equal(cleanUrdu(''), null);
  assert.equal(cleanUrdu(null), null);

  assert.equal(cleanRoman('Aaeen'), 'Aaeen');
  assert.equal(cleanRoman('آئین'), null);
  assert.equal(cleanRoman('संविधान'), null);
});

test('the entry pass is asked for no Urdu at all', async () => {
  const stub = stubAI({
    entry: ENTRY,
    urdu: { urdu: 'آئین', urduRoman: 'Aaeen' }
  });

  await generate(stub, 'constitution', '', 'english');

  const entryCall = stub.calls.find((c) => c.kind === 'entry');
  const prompt = entryCall.messages.map((m) => m.content).join('\n').toLowerCase();
  assert.ok(!prompt.includes('urdu'), 'nothing in the entry prompt mentions Urdu');
});
