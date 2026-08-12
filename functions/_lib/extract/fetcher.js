/**
 * fetcher.js — stage 1 of the pipeline.
 *
 * Plain HTTP fetch with redirect following, hard timeout, byte cap and a
 * content-type guard. Returns raw HTML; knows nothing about extraction.
 */

export const USER_AGENT =
  'Mozilla/5.0 (compatible; ThinkneeringExtractor/1.0; +https://thinkneering.com/tools/web-text-extractor/)';

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)/i;

const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

/**
 * Reject non-public targets so the Function cannot be used to probe internal
 * addresses from Cloudflare's network.
 */
export function validateTarget(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    return { ok: false, error: 'invalid-url', message: 'That does not look like a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'unsupported-protocol', message: 'Only http:// and https:// URLs can be extracted.' };
  }
  if (BLOCKED_HOSTS.test(url.hostname) || !url.hostname.includes('.')) {
    return { ok: false, error: 'blocked-host', message: 'Only public internet addresses can be extracted.' };
  }
  return { ok: true, url };
}

function charsetFrom(contentType) {
  const match = /charset=([^;\s]+)/i.exec(contentType || '');
  if (!match) return 'utf-8';
  return match[1].replace(/["']/g, '').toLowerCase();
}

/**
 * @returns {Promise<{ok:boolean, html?:string, finalUrl?:string, status?:number,
 *   contentType?:string, bytes?:number, truncated?:boolean, error?:string, message?:string}>}
 */
export async function fetchPage(url, { timeoutMs = 15000, maxBytes = 3000000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en,*;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const aborted = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      error: aborted ? 'timeout' : 'network-error',
      message: aborted
        ? 'The site took too long to respond.'
        : 'The site could not be reached. It may be offline or blocking automated requests.',
    };
  }

  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    return {
      ok: false,
      error: 'http-error',
      status: res.status,
      finalUrl: res.url || url,
      message: `The site responded with HTTP ${res.status}.`,
    };
  }

  if (contentType && !HTML_TYPES.test(contentType)) {
    return {
      ok: false,
      error: 'unsupported-content-type',
      status: res.status,
      contentType,
      finalUrl: res.url || url,
      message: `This URL returned "${contentType.split(';')[0]}", which is not a web page.`,
    };
  }

  // Stream with a byte cap so a huge page cannot exhaust the Worker.
  const chunks = [];
  let bytes = 0;
  let truncated = false;

  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (bytes + value.byteLength > maxBytes) {
          chunks.push(value.slice(0, Math.max(0, maxBytes - bytes)));
          bytes = maxBytes;
          truncated = true;
          try {
            await reader.cancel();
          } catch {
            /* already closed */
          }
          break;
        }
        chunks.push(value);
        bytes += value.byteLength;
      }
    } catch {
      return { ok: false, error: 'read-error', message: 'The response could not be read completely.' };
    }
  }

  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let html;
  try {
    html = new TextDecoder(charsetFrom(contentType), { fatal: false }).decode(buffer);
  } catch {
    html = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }

  return {
    ok: true,
    html,
    finalUrl: res.url || url,
    status: res.status,
    contentType,
    bytes,
    truncated,
  };
}
