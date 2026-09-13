/**
 * Retrieval evaluation set.
 *
 * Every prompt change and every retrieval tweak is a guess until something
 * measures it. This is that something: real questions, and the node slugs a
 * correct retrieval must surface.
 *
 * It scores RETRIEVAL, not prose. Whether the right nodes came back is
 * objective and cheap to check; whether the sentence reads well is neither.
 * If retrieval is wrong the answer cannot be right, so this is the half
 * worth measuring first.
 *
 * expect      — slugs that MUST appear in the top results.
 * expectNone  — questions the graph genuinely cannot answer. These matter
 *               more than the hits: a system that confidently answers what
 *               it does not know is worse than one that answers less.
 * topK        — how far down the list a hit still counts.
 *
 * Add a case every time you catch a bad answer. That is the whole method:
 * the set grows from real failures, not from imagined ones.
 *
 * This file lives in functions/_lib/, NOT in _dev/, and that matters.
 *
 * Cloudflare Pages bundles the Functions directory. An import that reaches
 * outside it — `../../../_dev/...` — cannot be resolved at build time, and a
 * single unresolvable import fails the WHOLE Functions build. Every /api/
 * route then errors, the header renders empty because /api/catalog is one of
 * them, and the site looks broken in a way that has nothing to do with the
 * page you are looking at.
 *
 * Nothing under functions/ may import from outside functions/.
 * _dev/tests/engine.test.mjs enforces it.
 *
 * A module rather than a .json file: importing JSON needs an import attribute
 * in Node and a loader in the bundler, and the two disagree. A plain export
 * works everywhere and is just as easy to edit.
 */

export const CASES = [
  {
    "q": "what does TQRQ mean",
    "expect": [
      "sbu_tqrq"
    ],
    "topK": 5,
    "why": "Acronym straight to its node. If this misses, nothing else will work."
  },
  {
    "q": "technical query pipeline",
    "expect": [
      "sbu_tqrq"
    ],
    "topK": 5,
    "why": "Alias rather than the title. Checks knowledge_terms indexed aliases."
  },
  {
    "q": "who do I chase when a factory has not come back",
    "expect": [
      "sbu_factoryclar",
      "sbu_r_factorylag"
    ],
    "topK": 8,
    "why": "No shared words with either node title. This is the case keyword search cannot win and semantic should."
  },
  {
    "q": "explosion proof requirements",
    "expect": [
      "sbu_atex"
    ],
    "topK": 8,
    "why": "ATEX by meaning, not by name. The canonical semantic case."
  },
  {
    "q": "sound power limits on air handling units",
    "expect": [
      "sbu_acoustics",
      "sbu_ahu"
    ],
    "topK": 8,
    "why": "Two nodes, one question. Both should surface."
  },
  {
    "q": "which factory builds fan coil units",
    "expect": [
      "sbu_fac_in",
      "sbu_fcu"
    ],
    "topK": 8,
    "why": "Answer lives in an edge, so both ends must be retrieved."
  },
  {
    "q": "hygienic construction for a hospital",
    "expect": [
      "sbu_hygiene"
    ],
    "topK": 8,
    "why": "Hospital appears nowhere on the node. Meaning only."
  },
  {
    "q": "how do we reduce cost without losing compliance",
    "expect": [
      "sbu_ve"
    ],
    "topK": 8,
    "why": "Value engineering described rather than named."
  },
  {
    "q": "where do enquiries get stuck",
    "expect": [
      "sbu_r_factorylag",
      "sbu_m_ageing"
    ],
    "topK": 10,
    "why": "Vague question, specific nodes. Tests that risks are reachable."
  },
  {
    "q": "who covers Oman",
    "expect": [
      "sbu_mkt_oman"
    ],
    "topK": 8,
    "why": "Will start failing usefully once engineers are added and should return them too."
  },
  {
    "q": "Eurovent certification",
    "expect": [
      "sbu_certs"
    ],
    "topK": 8,
    "why": "A standard named inside a requirement node."
  },
  {
    "q": "what is the boiling point of nitrogen",
    "expectNone": true,
    "why": "Plausible-sounding engineering question with nothing behind it. Must return nothing rather than the nearest node."
  },
  {
    "q": "who won the cricket last night",
    "expectNone": true,
    "why": "Obvious nonsense. A semantic index will always have a nearest neighbour; MIN_SCORE has to reject this."
  },
  {
    "q": "what is our discount for Qatar projects",
    "expectNone": true,
    "why": "Commercial, not on the graph, and the kind of question someone will genuinely ask. Answering it would be inventing."
  }
];
