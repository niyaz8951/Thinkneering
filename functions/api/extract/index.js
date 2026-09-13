/**
 * POST /api/extract   { "url": "...", "method": "auto" | "static" | "render" }
 * GET  /api/extract?url=...&method=auto        (convenience for testing)
 *
 * Thin transport layer only — the pipeline lives in /functions/_lib/extract/
 * so the Knowledge Repository, the reader and any future ingestion job can
 * import extract() without going through HTTP.
 *
 * Errors follow the site convention: { error: "<sentence a person can read>" }.
 */

import { json, track } from '../../_lib.js';
import { extract } from '../../_lib/extract/engine.js';

const ERROR_STATUS = {
  'invalid-url': 400,
  'unsupported-protocol': 400,
  'blocked-host': 400,
  'missing-url': 400,
  'robots-disallowed': 403,
  'unsupported-content-type': 415,
  'http-error': 502,
  'network-error': 502,
  'read-error': 502,
  'renderer-failed': 502,
  'no-html': 502,
  timeout: 504,
};

/** Read the body as text first: res.json() on an error page hides the real cause. */
async function readJson(request) {
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return { ok: false, message: 'That request could not be read.' };
  }
  if (!raw.trim()) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, message: 'That request was not valid JSON.' };
  }
}

async function run(url, method, env, user) {
  if (!url) return json({ ok: false, code: 'missing-url', error: 'Put a web address in first.' }, 400);

  const requested = ['auto', 'static', 'render'].includes(method) ? method : 'auto';

  let result;
  try {
    result = await extract(url, { env, method: requested });
  } catch (err) {
    return json(
      {
        ok: false,
        code: 'extraction-failed',
        error: 'Something went wrong while reading that page.',
        detail: err && err.message ? err.message : String(err),
      },
      500,
    );
  }

  if (!result.ok) {
    return json(
      { ok: false, code: result.error, error: result.message, sourceUrl: result.sourceUrl },
      ERROR_STATUS[result.error] || 400,
    );
  }

  try {
    await track(env, user, 'extract', 'tool:web-text-extractor');
  } catch {
    /* usage tracking must never fail a working extraction */
  }

  return json(result);
}

export const onRequestPost = async ({ request, env, data }) => {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, code: 'bad-request', error: body.message }, 400);
  return run(body.data.url, body.data.method, env, data && data.user);
};

export const onRequestGet = async ({ request, env, data }) => {
  const params = new URL(request.url).searchParams;
  return run(params.get('url'), params.get('method'), env, data && data.user);
};
