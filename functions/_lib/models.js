/**
 * Every model this site calls, named once.
 * =============================================================================
 * Model names were hardcoded in nine files. They are not stable identifiers:
 * ai-suggest.js already carries a comment recording that
 * `@cf/meta/llama-3.1-8b-instruct` was deprecated and had to be swapped — so
 * this has happened once already, and it will happen again.
 *
 * When it does, the fix is one line here rather than a search across the
 * codebase, half of which is easy to miss because the string appears inside
 * template literals and comments.
 *
 * If a model is retired and answers start failing, change it here, redeploy,
 * then run /api/knowledge/eval and compare the headline with the last one you
 * recorded. That is what tells you whether the replacement is as good.
 */

/* General reasoning: clause review, answering, judging a gap, dictionary
   lookups. Chosen for latency — every one of these sits in front of someone
   waiting. */
export const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/* Embeddings for semantic retrieval. Changing this is NOT a one-line change:
   the dimension count must match the Vectorize index, so a different model
   means creating a new index and re-running /api/knowledge/reindex. The
   dimensions are recorded here so the mismatch is obvious before it becomes a
   confusing runtime rejection. */
export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBED_DIMENSIONS = 768;

/* Recorded on answers so a future confusing result can be traced to the model
   that produced it. A wrong answer from six months ago is far easier to
   explain when you know which model wrote it. */
export const MODEL_VERSIONS = {
  text: TEXT_MODEL,
  embed: EMBED_MODEL
};
