/**
 * engine.js — pipeline orchestrator.
 *
 * fetch → (optional render) → DOM harvest → scoring → structured output
 *
 * The engine is UI-independent on purpose: the Knowledge Repository, ebook
 * reader and any future ingestion job can import extract() directly.
 *
 * RENDERER SEAM
 * -------------
 * JavaScript-rendered pages need a real browser, which cannot run inside a
 * Cloudflare Worker. When a self-hosted renderer exists (a small Python
 * FastAPI + Playwright service, for example), set these two variables on the
 * Pages project and this engine will use it automatically for pages that look
 * empty after a static fetch:
 *
 *   EXTRACT_RENDERER_URL    e.g. https://render.example.com/render
 *   EXTRACT_RENDERER_TOKEN  shared secret, sent as Authorization: Bearer …
 *
 * Contract expected of that service:
 *   POST { "url": "<page url>", "waitMs": 2500 }
 *   ->   { "html": "<fully rendered DOM>", "finalUrl": "..." }
 *
 * Until it is configured, static extraction runs alone and thin pages are
 * reported with a warning rather than silently returning nothing.
 */

import { checkRobots } from './robots.js';
import { fetchPage, validateTarget, USER_AGENT } from './fetcher.js';
import { harvest } from './dom.js';
import { pickContainer, selectBlocks } from './score.js';
import { assemble } from './assemble.js';

const THIN_WORDS = 90;

function looksJsRendered(harvestResult, blocks) {
  const words = blocks.reduce((sum, block) => sum + (block.words || 0), 0);
  if (words >= THIN_WORDS) return false;
  const { stats } = harvestResult;
  return stats.appRootSeen || stats.scriptCount >= 5 || stats.htmlLength > 40000;
}

function buildWarnings({ harvestResult, picked, blocks, fetchInfo, rendererAvailable }) {
  const warnings = [];
  const words = blocks.reduce((sum, block) => sum + (block.words || 0), 0);

  if (!blocks.length) {
    warnings.push({
      level: 'error',
      code: 'no-content',
      message: 'No readable content blocks were found on this page.',
    });
  } else if (words < THIN_WORDS) {
    warnings.push({
      level: 'warning',
      code: 'thin-content',
      message: `Only ${words} words were extracted. The page may load its content with JavaScript.`,
    });
  }

  if (looksJsRendered(harvestResult, blocks) && !rendererAvailable) {
    warnings.push({
      level: 'warning',
      code: 'renderer-unavailable',
      message: 'This page looks JavaScript-rendered. No browser renderer is configured, so only the initial HTML was read.',
    });
  }

  if (picked.confidence < 0.45) {
    warnings.push({
      level: 'warning',
      code: 'low-confidence',
      message: 'Content boundaries were uncertain — check the result against the original before saving.',
    });
  }

  if ((picked.linkDensity ?? 0) > 0.35) {
    warnings.push({
      level: 'warning',
      code: 'high-link-density',
      message: 'The selected region contains a lot of links; navigation may have been included.',
    });
  }

  if (fetchInfo.truncated) {
    warnings.push({
      level: 'warning',
      code: 'truncated',
      message: 'The page exceeded the size limit and was read only partially.',
    });
  }

  if (!harvestResult.meta.title && !blocks.some((b) => b.type === 'heading')) {
    warnings.push({
      level: 'info',
      code: 'no-title',
      message: 'No page title or heading was found.',
    });
  }

  return warnings;
}

async function renderWithService(url, env) {
  const endpoint = env && env.EXTRACT_RENDERER_URL;
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        ...(env.EXTRACT_RENDERER_TOKEN ? { authorization: `Bearer ${env.EXTRACT_RENDERER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ url, waitMs: 2500 }),
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.text();
    if (!res.ok) return null;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed.html !== 'string' || parsed.html.length < 200) return null;
    return { html: parsed.html, finalUrl: parsed.finalUrl || url };
  } catch {
    return null;
  }
}

async function runPipeline(html, baseUrl, sourceUrl, fetchInfo) {
  const harvestResult = await harvest(html, baseUrl);
  const picked = pickContainer(harvestResult);
  const blocks = selectBlocks(harvestResult, picked);
  return { harvestResult, picked, blocks, fetchInfo };
}

/**
 * @param {string} rawUrl
 * @param {object} options
 * @param {object} options.env Pages env bindings (for the renderer seam)
 * @param {'auto'|'static'|'render'} [options.method]
 * @param {boolean} [options.ignoreRobots] admin/diagnostic use only
 */
export async function extract(rawUrl, { env = {}, method = 'auto', ignoreRobots = false } = {}) {
  const target = validateTarget(rawUrl);
  if (!target.ok) {
    return { ok: false, error: target.error, message: target.message, sourceUrl: String(rawUrl) };
  }
  const sourceUrl = target.url.toString();

  if (!ignoreRobots) {
    const robots = await checkRobots(sourceUrl, { userAgent: USER_AGENT });
    if (!robots.allowed) {
      return {
        ok: false,
        error: 'robots-disallowed',
        message: 'This site\u2019s robots.txt asks automated tools not to read this page.',
        sourceUrl,
        detail: robots.reason,
      };
    }
  }

  const rendererAvailable = Boolean(env && env.EXTRACT_RENDERER_URL);
  let html = '';
  let finalUrl = sourceUrl;
  let fetchInfo = { renderer: 'static-fetch' };

  if (method !== 'render') {
    const fetched = await fetchPage(sourceUrl);
    if (!fetched.ok) {
      return { ok: false, error: fetched.error, message: fetched.message, sourceUrl, status: fetched.status || null };
    }
    html = fetched.html;
    finalUrl = fetched.finalUrl;
    fetchInfo = {
      renderer: 'static-fetch',
      status: fetched.status,
      bytes: fetched.bytes,
      truncated: fetched.truncated,
      contentType: fetched.contentType,
    };
  }

  let result = html ? await runPipeline(html, finalUrl, sourceUrl, fetchInfo) : null;

  const shouldRender =
    rendererAvailable &&
    (method === 'render' || (method === 'auto' && result && looksJsRendered(result.harvestResult, result.blocks)));

  if (shouldRender) {
    const rendered = await renderWithService(sourceUrl, env);
    if (rendered) {
      const renderedInfo = { ...fetchInfo, renderer: 'browser-render' };
      const renderedResult = await runPipeline(rendered.html, rendered.finalUrl, sourceUrl, renderedInfo);
      const staticWords = result ? result.blocks.reduce((s, b) => s + (b.words || 0), 0) : 0;
      const renderedWords = renderedResult.blocks.reduce((s, b) => s + (b.words || 0), 0);
      // Candidate comparison: keep whichever pass actually produced content.
      if (!result || renderedWords > staticWords) {
        result = renderedResult;
        finalUrl = rendered.finalUrl;
      }
    } else if (method === 'render') {
      return {
        ok: false,
        error: 'renderer-failed',
        message: 'The browser renderer did not return a usable page.',
        sourceUrl,
      };
    }
  }

  if (!result) {
    return { ok: false, error: 'no-html', message: 'Nothing could be fetched for this URL.', sourceUrl };
  }

  const warnings = buildWarnings({
    harvestResult: result.harvestResult,
    picked: result.picked,
    blocks: result.blocks,
    fetchInfo: result.fetchInfo,
    rendererAvailable,
  });

  return assemble({
    harvest: result.harvestResult,
    picked: result.picked,
    blocks: result.blocks,
    sourceUrl,
    finalUrl,
    fetchInfo: result.fetchInfo,
    warnings,
  });
}
