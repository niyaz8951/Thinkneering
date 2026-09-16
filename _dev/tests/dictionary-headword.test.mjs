/**
 * Dictionary — headwords, dictionary case, and the lane a word lands in.
 *
 *   node --test _dev/tests/dictionary-headword.test.mjs
 *
 * No dependencies. The claims worth a regression test:
 *   - "running" is filed as Run, "went" as Go, and a model that answers with
 *     a synonym instead of a lemma is ignored in favour of the selection;
 *   - dictionary case capitalises the first letter and nothing else, except
 *     for words that carry their own capitals;
 *   - the part of speech decides the lane and the node kind on a word map.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { pickHeadword, dictionaryCase, cleanPos, generate } from '../../functions/api/dictionary/lookup.js';
import { laneFor, kindFor } from '../../functions/_lib/dictionary.js';

test('the model headword is used when it is the same word', () => {
  assert.equal(pickHeadword('run', 'running'), 'run');
  assert.equal(pickHeadword('book', 'books'), 'book');
  assert.equal(pickHeadword('go', 'went'), 'go');
  assert.equal(pickHeadword('happy', 'happier'), 'happy');
  assert.equal(pickHeadword('bear in mind', 'bearing in mind'), 'bear in mind');
});

test('a synonym, a blank or a definition is not a headword', () => {
  assert.equal(pickHeadword('sprint', 'running'), 'running');
  assert.equal(pickHeadword('', 'running'), 'running');
  assert.equal(pickHeadword('a fast way of moving on foot', 'running'), 'running');
});

test('dictionary case: first letter up, rest down, names keep their capitals', () => {
  assert.equal(dictionaryCase('run'), 'Run');
  assert.equal(dictionaryCase('RUNNING'), 'Running');
  assert.equal(dictionaryCase('constitution'), 'Constitution');
  assert.equal(dictionaryCase('AHU'), 'AHU');
  assert.equal(dictionaryCase('new York'), 'New York');
});

test('part of speech is normalised to the seven values', () => {
  assert.equal(cleanPos('verb'), 'verb');
  assert.equal(cleanPos('Adjective'), 'adjective');
  assert.equal(cleanPos('adv.'), 'adverb');
  assert.equal(cleanPos('proper noun'), 'other');
  assert.equal(cleanPos(''), null);
});

test('the lane and kind follow the part of speech on a word map', () => {
  assert.equal(laneFor('english', 'verb'), 'verbs');
  assert.equal(laneFor('english', 'noun'), 'nouns');
  assert.equal(laneFor('english', 'adjective'), 'describing');
  assert.equal(laneFor('english', 'adverb'), 'describing');
  assert.equal(laneFor('english', 'idiom'), 'phrases');
  assert.equal(laneFor('english', null), 'nouns');
  assert.equal(laneFor('hvac', 'noun'), 'terms');
  assert.equal(kindFor('english', 'phrase'), 'phrase');
  assert.equal(kindFor('english', 'verb'), 'word');
  assert.equal(kindFor('hvac', 'noun'), 'term');
});

test('the entry pass asks for headword and part of speech and keeps them', async () => {
  const calls = [];
  const env = {
    AI: {
      async run(model, options) {
        const props = options.response_format.json_schema.properties;
        calls.push(options);
        if (props.meaning) {
          assert.ok(props.headword && props.partOfSpeech, 'schema carries the two new fields');
          assert.ok(options.response_format.json_schema.required.includes('headword'));
          return { response: { headword: 'run', partOfSpeech: 'verb', meaning: 'To move fast on foot.',
            synonyms: ['sprint'], antonyms: ['walk'], origin: 'Old English rinnan.',
            connection: 'Also used of machines and of standing for office.', hindi: 'दौड़ना' } };
        }
        return { response: { urdu: 'دوڑنا', urduRoman: 'Daurna' } };
      }
    }
  };
  const out = await generate(env, 'running', 'He was running late.', 'english');
  assert.equal(out.headword, 'run');
  assert.equal(out.pos, 'verb');
  assert.equal(out.meaning, 'To move fast on foot.');
  assert.equal(calls.length, 2);
});

import { reviewerNotes, looksInflected, askHeadword } from '../../functions/api/dictionary/lookup.js';

test('an inflected selection gets a second, narrow look', () => {
  assert.equal(looksInflected('running'), true);
  assert.equal(looksInflected('books'), true);
  assert.equal(looksInflected('glass'), false);
  assert.equal(looksInflected('run'), false);
  assert.equal(looksInflected('bear in mind'), false);
});

test('the reviewer corrections reach the prompt', async () => {
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { return sql.includes('dictionary_guidance') ? { value: 'One plain sentence.' } : null; },
        async all() { return { results: [
          { term: 'Run', field: 'meaning', ai_value: 'To move at a speed faster than a walk, never having both feet on the ground.', human_value: 'To move fast on foot.' }
        ] }; }
      };
    }
  };
  const lines = await reviewerNotes({ DB: db }, 'english');
  const text = lines.join('\n');
  assert.ok(text.includes('One plain sentence.'), 'the standing note is included');
  assert.ok(text.includes('Run / meaning'), 'a correction is shown as an example');
  assert.ok(text.includes('To move fast on foot.'), 'with what the reviewer wrote');
});

test('generate works with no notes available', async () => {
  const env = { AI: { async run(model, o) {
    const props = o.response_format.json_schema.properties;
    if (props.meaning) return { response: { headword: 'go', partOfSpeech: 'verb', meaning: 'To move.', synonyms: [], antonyms: [], origin: 'Old English.', connection: 'Everyday word.', hindi: 'जाना' } };
    return { response: { urdu: 'جانا', urduRoman: 'Jana' } };
  } } };
  const out = await generate(env, 'went', '', 'english');
  assert.equal(out.headword, 'go');
});

test('the second look returns a headword and never throws', async () => {
  const env = { AI: { async run() { return { response: { headword: 'run' } }; } } };
  assert.equal(await askHeadword(env, 'running', 'To move fast.'), 'run');
  const broken = { AI: { async run() { throw new Error('quota'); } } };
  assert.equal(await askHeadword(broken, 'running', ''), null);
});
