/* =====================================================================
   Thinkneering — Knowledge Graph: English language domain pack
   ---------------------------------------------------------------------
   A word map, not an equipment map. The HVAC pack asks "what is this made
   of and what flows through it". This one asks "where did this word come
   from, what else shares its root, and what would I confuse it with".

   Used by every Dictionary map. A word a reader looks up lands here as a
   `word` node in the lane for its part of speech, and the roots and
   affixes it is built from are already sitting in the Word parts lane
   waiting to be connected.
   ===================================================================== */

(function () {
  'use strict';

  /* ── Node kinds ────────────────────────────────────────────────── */

  var NODE_KINDS = {
    word:      { label: 'Word',        token: '--kg-word',      icon: 'book',
                 hint: 'A single word a reader looked up or you added.' },
    sense:     { label: 'Sense',       token: '--kg-sense',     icon: 'split',
                 hint: 'One specific meaning of a word that has several.' },
    root:      { label: 'Root',        token: '--kg-root',      icon: 'root',
                 hint: 'A Latin or Greek root that many words are built on.' },
    prefix:    { label: 'Prefix',      token: '--kg-affix',     icon: 'prefix',
                 hint: 'A beginning that changes meaning: un-, re-, pre-.' },
    suffix:    { label: 'Suffix',      token: '--kg-affix',     icon: 'suffix',
                 hint: 'An ending that changes the part of speech: -tion, -able.' },
    phrase:    { label: 'Phrase',      token: '--kg-phrase',    icon: 'quote',
                 hint: 'A set expression: "in the long run", "bear in mind".' },
    idiom:     { label: 'Idiom',       token: '--kg-idiom',     icon: 'sparkle',
                 hint: 'A phrase whose meaning is not its literal words.' },
    grammar:   { label: 'Grammar',     token: '--kg-grammar',   icon: 'rule',
                 hint: 'A rule or pattern: subjunctive, article use, tense.' },
    confusable:{ label: 'Confusable',  token: '--kg-confusable',icon: 'alert',
                 hint: 'A pair people mix up: affect / effect, its / it\u2019s.' },
    example:   { label: 'Example',     token: '--kg-example',   icon: 'quote',
                 hint: 'A sentence showing the word doing its work.' },
    mnemonic:  { label: 'Memory hook', token: '--kg-mnemonic',  icon: 'sparkle',
                 hint: 'The trick that makes it stick.' },
    topic:     { label: 'Topic',       token: '--kg-topic',     icon: 'layers',
                 hint: 'A grouping: legal words, weather words, feelings.' },
    note:      { label: 'Note',        token: '--kg-note',      icon: 'note',
                 hint: 'Anything that is not itself a word.' }
  };

  /* ── Relations ─────────────────────────────────────────────────── */

  var RELATIONS = {
    means:         { label: 'means',            inverse: null,         arrow: 'plain',   dash: '' },
    sense_of:      { label: 'is a sense of',    inverse: null,         arrow: 'plain',   dash: '' },
    built_from:    { label: 'is built from',    inverse: 'builds',     arrow: 'diamond', dash: '' },
    builds:        { label: 'builds',           inverse: 'built_from', arrow: 'plain',   dash: '' },
    synonym_of:    { label: 'similar to',       inverse: 'synonym_of', arrow: 'both',    dash: '' },
    antonym_of:    { label: 'opposite of',      inverse: 'antonym_of', arrow: 'both',    dash: '4 4' },
    confused_with: { label: 'confused with',    inverse: 'confused_with', arrow: 'both', dash: '3 4' },
    stronger_than: { label: 'stronger than',    inverse: null,         arrow: 'plain',   dash: '' },
    used_in:       { label: 'used in',          inverse: null,         arrow: 'plain',   dash: '' },
    collocates:    { label: 'goes with',        inverse: 'collocates', arrow: 'both',    dash: '6 5' },
    governed_by:   { label: 'follows rule',     inverse: null,         arrow: 'plain',   dash: '6 5' },
    belongs_to:    { label: 'belongs to',       inverse: null,         arrow: 'plain',   dash: '6 5' },
    example_of:    { label: 'example of',       inverse: null,         arrow: 'plain',   dash: '' }
  };

  /* ── Lanes — parts of speech and word machinery ────────────────── */

  var LANES = [
    { id: 'wordparts',   label: 'Word parts',          token: '--kg-lane-7' },
    { id: 'nouns',       label: 'Nouns',               token: '--kg-lane-1' },
    { id: 'verbs',       label: 'Verbs',               token: '--kg-lane-2' },
    { id: 'describing',  label: 'Adjectives & adverbs',token: '--kg-lane-3' },
    { id: 'phrases',     label: 'Phrases & idioms',    token: '--kg-lane-4' },
    { id: 'grammar',     label: 'Grammar & usage',     token: '--kg-lane-5' },
    { id: 'confusables', label: 'Easily confused',     token: '--kg-lane-6' }
  ];

  /* ── Seed ──────────────────────────────────────────────────────────
     Deliberately weighted towards Word parts. Roots and affixes are the
     highest-leverage thing in a word map: one root node connects to
     dozens of words a reader will meet later, so the map starts useful
     instead of starting empty. The handful of words included are there
     to demonstrate the connections, not to be a vocabulary list.
     ---------------------------------------------------------------- */

  var SEED = {
    title: 'English word map',
    kind: 'system',
    domain: 'english',
    description: 'Words, the roots they are built from, and the ones people mix up. Grows every time a reader looks something up.',

    nodes: [
      /* ── Latin and Greek roots ─────────────────────────────────── */
      { ref: 'r-spec', kind: 'root', lane: 'wordparts', title: 'spec- / spic-',
        aliases: ['spect', 'spec', 'spic', 'specere'],
        summary: 'Latin \u201cto look\u201d or \u201cto see\u201d.',
        body: 'Turns up wherever looking is involved: inspect (look into), spectator (one who looks), perspective (a way of looking through), conspicuous (easily seen), suspicious (looking up at from below). Once you notice it, a whole family of words stops being arbitrary.',
        tags: ['latin', 'high-yield'] },

      { ref: 'r-dict', kind: 'root', lane: 'wordparts', title: 'dict-',
        aliases: ['dic', 'dicere'],
        summary: 'Latin \u201cto say\u201d or \u201cto speak\u201d.',
        body: 'Dictate (say out to be written), predict (say before), contradict (speak against), verdict (a true saying), dictionary (a book of sayings), edict (a saying out).',
        tags: ['latin', 'high-yield'] },

      { ref: 'r-ject', kind: 'root', lane: 'wordparts', title: 'ject-',
        aliases: ['jact', 'jacere'],
        summary: 'Latin \u201cto throw\u201d.',
        body: 'Reject (throw back), project (throw forward), inject (throw in), eject (throw out), subject (thrown under), object (thrown against). The physical throwing has faded but the direction survives in the prefix.',
        tags: ['latin', 'high-yield'] },

      { ref: 'r-port', kind: 'root', lane: 'wordparts', title: 'port-',
        aliases: ['portare'],
        summary: 'Latin \u201cto carry\u201d.',
        body: 'Transport (carry across), import (carry in), export (carry out), portable (able to be carried), support (carry from below), report (carry back).',
        tags: ['latin', 'high-yield'] },

      { ref: 'r-scrib', kind: 'root', lane: 'wordparts', title: 'scrib- / script-',
        aliases: ['scribere', 'script'],
        summary: 'Latin \u201cto write\u201d.',
        body: 'Describe (write down), prescribe (write before), manuscript (written by hand), subscribe (write underneath \u2014 originally signing at the foot of a document), transcript (written across).',
        tags: ['latin', 'high-yield'] },

      { ref: 'r-graph', kind: 'root', lane: 'wordparts', title: 'graph- / gram-',
        aliases: ['graphein', 'gramma'],
        summary: 'Greek \u201cto write\u201d or \u201cwritten thing\u201d.',
        body: 'Photograph (light writing), paragraph, telegram (writing at a distance), diagram, grammar. The Greek twin of scrib-, and the two rarely appear in the same word.',
        tags: ['greek', 'high-yield'] },

      { ref: 'r-log', kind: 'root', lane: 'wordparts', title: 'log- / -logy',
        aliases: ['logos', 'logia'],
        summary: 'Greek \u201cword\u201d, \u201creason\u201d or \u201cstudy of\u201d.',
        body: 'Biology, geology, logic, dialogue, monologue, apology. As a suffix it names a field of study; as a root it points at reasoning.',
        tags: ['greek', 'high-yield'] },

      { ref: 'r-tract', kind: 'root', lane: 'wordparts', title: 'tract-',
        aliases: ['trahere'],
        summary: 'Latin \u201cto pull\u201d or \u201cto drag\u201d.',
        body: 'Attract (pull towards), distract (pull apart), extract (pull out), contract (pull together), tractor, subtract.',
        tags: ['latin'] },

      { ref: 'r-mit', kind: 'root', lane: 'wordparts', title: 'mit- / miss-',
        aliases: ['mittere'],
        summary: 'Latin \u201cto send\u201d.',
        body: 'Transmit (send across), submit (send under), emit (send out), mission, dismiss (send away), permit (send through).',
        tags: ['latin'] },

      { ref: 'r-vid', kind: 'root', lane: 'wordparts', title: 'vid- / vis-',
        aliases: ['videre'],
        summary: 'Latin \u201cto see\u201d.',
        body: 'Video, evident, vision, supervise (see from above), revise (see again), visible. Shares territory with spec- \u2014 both are seeing, but vis- leans towards what is seen rather than the act of looking.',
        tags: ['latin'] },

      /* ── Prefixes ──────────────────────────────────────────────── */
      { ref: 'p-re', kind: 'prefix', lane: 'wordparts', title: 're-',
        aliases: ['re'],
        summary: 'Back, or again.',
        body: 'Return, rewrite, review, recall. Two distinct senses that usually resolve from context: \u201cagain\u201d (rewrite) or \u201cback\u201d (return).',
        tags: ['high-yield'] },

      { ref: 'p-un', kind: 'prefix', lane: 'wordparts', title: 'un- / in- / im- / il- / ir-',
        aliases: ['un', 'in', 'im', 'il', 'ir'],
        summary: 'Not, or the reverse of.',
        body: 'The form changes to suit the letter that follows: impossible (before p), illegal (before l), irregular (before r), inaccurate elsewhere. Native English words usually take un-, Latin-derived ones take in-.',
        tags: ['high-yield'] },

      { ref: 'p-pre', kind: 'prefix', lane: 'wordparts', title: 'pre-',
        aliases: ['pre'],
        summary: 'Before, in time or position.',
        body: 'Predict, prepare, preview, precedent.' },

      { ref: 'p-sub', kind: 'prefix', lane: 'wordparts', title: 'sub- / sup- / suc-',
        aliases: ['sub', 'sup', 'suc', 'suf'],
        summary: 'Under, below, or slightly.',
        body: 'Submarine, subject, support, succeed, sufficient. Assimilates to the following consonant like in-.' },

      { ref: 'p-trans', kind: 'prefix', lane: 'wordparts', title: 'trans-',
        aliases: ['trans'],
        summary: 'Across, beyond, or through.',
        body: 'Transport, transmit, translate, transparent.' },

      { ref: 'p-con', kind: 'prefix', lane: 'wordparts', title: 'con- / com- / co-',
        aliases: ['con', 'com', 'co', 'col', 'cor'],
        summary: 'With, together.',
        body: 'Connect, combine, cooperate, collaborate, correspond.' },

      /* ── Suffixes ──────────────────────────────────────────────── */
      { ref: 's-tion', kind: 'suffix', lane: 'wordparts', title: '-tion / -sion',
        aliases: ['tion', 'sion', 'ation'],
        summary: 'Turns a verb into a noun: the act or result of doing it.',
        body: 'Create \u2192 creation, decide \u2192 decision, inspect \u2192 inspection. If you can spot the verb inside, you can usually guess the noun.',
        tags: ['high-yield'] },

      { ref: 's-able', kind: 'suffix', lane: 'wordparts', title: '-able / -ible',
        aliases: ['able', 'ible'],
        summary: 'Able to be, or worth being.',
        body: 'Portable, readable, visible, edible. -able attaches to whole English words (readable); -ible usually to Latin stems that cannot stand alone (visible, audible).',
        tags: ['high-yield'] },

      { ref: 's-ous', kind: 'suffix', lane: 'wordparts', title: '-ous / -ious',
        aliases: ['ous', 'ious'],
        summary: 'Full of, or characterised by.',
        body: 'Dangerous, ambitious, conspicuous, generous.' },

      { ref: 's-ment', kind: 'suffix', lane: 'wordparts', title: '-ment',
        aliases: ['ment'],
        summary: 'The result or means of an action, as a noun.',
        body: 'Judgment, movement, argument, equipment.' },

      { ref: 's-ly', kind: 'suffix', lane: 'wordparts', title: '-ly',
        aliases: ['ly'],
        summary: 'Usually makes an adverb; sometimes an adjective.',
        body: 'Quickly, carefully \u2014 adverbs. But friendly, lonely, likely are adjectives, which is why \u201che spoke friendly\u201d is wrong.' },

      /* ── Worked example words ──────────────────────────────────── */
      { ref: 'w-conspicuous', kind: 'word', lane: 'describing', title: 'conspicuous',
        aliases: ['conspicuously', 'conspicuousness'],
        summary: 'Easy to notice; standing out.',
        body: 'con- (together, intensifying) + spec- (look) + -ous (full of) \u2014 literally \u201cfull of being looked at\u201d. Often used of something that stands out when it should not: a conspicuous absence, conspicuous consumption.',
        tags: ['example-word'] },

      { ref: 'w-inspect', kind: 'word', lane: 'verbs', title: 'inspect',
        aliases: ['inspection', 'inspector', 'inspecting'],
        summary: 'To look at something closely, usually to check it.',
        body: 'in- (into) + spec- (look). The noun inspection and the person inspector come from the same stem with -tion and -or.',
        tags: ['example-word'] },

      { ref: 'w-judgment', kind: 'word', lane: 'nouns', title: 'judgment',
        aliases: ['judgement', 'judgments', 'judgemental'],
        summary: 'The ability to make considered decisions, or a decision reached.',
        body: 'judge + -ment. Spelled judgment in most legal and American usage, judgement in general British usage \u2014 both are accepted, but pick one and stay with it in a document.',
        tags: ['example-word', 'spelling-varies'] },

      /* ── Confusables ───────────────────────────────────────────── */
      { ref: 'c-affect', kind: 'confusable', lane: 'confusables', title: 'affect / effect',
        aliases: ['affect', 'effect', 'affected', 'effective'],
        summary: 'Affect is almost always the verb; effect is almost always the noun.',
        body: 'The rain affected the schedule (verb, to influence). The rain had an effect on the schedule (noun, the result). The exceptions are real but rare: effect as a verb means to bring about (\u201ceffect a change\u201d), and affect as a noun is a psychology term for observable emotion.',
        tags: ['high-yield'] },

      { ref: 'c-principal', kind: 'confusable', lane: 'confusables', title: 'principal / principle',
        aliases: ['principal', 'principle'],
        summary: 'Principal is the main one, or a person. Principle is a rule.',
        body: 'The principal reason; the school principal; the principal amount of a loan. A principle is a belief or law: a matter of principle. The principAL is your pAL, or the main one; a principLE is a ruLE.',
        tags: ['high-yield'] },

      { ref: 'c-complement', kind: 'confusable', lane: 'confusables', title: 'complement / compliment',
        aliases: ['complement', 'compliment', 'complementary', 'complimentary'],
        summary: 'Complement completes; compliment praises.',
        body: 'The wine complements the meal (completes it). She paid him a compliment (praise). Complimentary also means free of charge \u2014 a complimentary breakfast.' },

      /* ── Grammar ───────────────────────────────────────────────── */
      { ref: 'g-articles', kind: 'grammar', lane: 'grammar', title: 'A, an and the',
        aliases: ['articles', 'definite article', 'indefinite article'],
        summary: 'A/an introduces something new; the points at something already known.',
        body: '\u201cI saw a dog\u201d \u2014 you have not met it before. \u201cThe dog barked\u201d \u2014 the same dog, now known. Use an before a vowel SOUND, not a vowel letter: an hour, a university.' },

      { ref: 'g-thatwhich', kind: 'grammar', lane: 'grammar', title: 'That vs which',
        aliases: ['that which', 'restrictive clause', 'relative clause'],
        summary: 'That defines; which adds. A which clause takes commas.',
        body: '\u201cThe report that arrived on Monday\u201d \u2014 identifies which report. \u201cThe report, which arrived on Monday, was long\u201d \u2014 there is only one report and this is extra detail. If you can drop the clause and still know what is meant, use which and commas.' },

      /* ── Phrases ───────────────────────────────────────────────── */
      { ref: 'ph-longrun', kind: 'phrase', lane: 'phrases', title: 'in the long run',
        aliases: ['long run', 'in the long term'],
        summary: 'Over an extended period, once short-term effects have settled.',
        body: 'Often used to concede a short-term cost: \u201cit is expensive now, but cheaper in the long run\u201d.' },

      { ref: 'id-bearmind', kind: 'idiom', lane: 'phrases', title: 'bear in mind',
        aliases: ['bearing in mind', 'keep in mind'],
        summary: 'Remember and take into account while deciding.',
        body: 'Bear here is the old sense of carry, not the animal \u2014 you carry the thought with you.' }
    ],

    edges: [
      /* Words to their parts */
      ['w-conspicuous', 'built_from', 'p-con'],
      ['w-conspicuous', 'built_from', 'r-spec'],
      ['w-conspicuous', 'built_from', 's-ous'],
      ['w-inspect', 'built_from', 'r-spec'],
      ['w-judgment', 'built_from', 's-ment'],

      /* Root and affix families */
      ['r-spec', 'synonym_of', 'r-vid', null, 'both mean seeing'],
      ['r-scrib', 'synonym_of', 'r-graph', null, 'Latin and Greek twins'],
      ['p-re', 'used_in', 'r-ject'],
      ['p-trans', 'used_in', 'r-port'],
      ['p-trans', 'used_in', 'r-mit'],
      ['p-sub', 'used_in', 'r-ject'],
      ['p-pre', 'used_in', 'r-dict'],
      ['p-pre', 'used_in', 'r-scrib'],
      ['s-tion', 'used_in', 'r-ject'],
      ['s-tion', 'used_in', 'r-spec'],
      ['s-able', 'used_in', 'r-port'],
      ['p-un', 'antonym_of', 's-able', null, 'un- + -able reverses'],

      /* Confusables and rules */
      ['c-affect', 'governed_by', 'g-thatwhich'],
      ['w-judgment', 'belongs_to', 'g-articles'],
      ['ph-longrun', 'example_of', 'id-bearmind']
    ]
  };

  window.TN_KG_ENGLISH = {
    id: 'english',
    label: 'English words',
    kind: 'system',
    nodeKinds: NODE_KINDS,
    relations: RELATIONS,
    lanes: LANES,
    standards: [],
    seed: SEED
  };
})();
