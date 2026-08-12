/**
 * dom.js — stage 2 of the pipeline: DOM harvesting.
 *
 * Uses Cloudflare's built-in HTMLRewriter (streaming HTML parser, no dependency,
 * no build step) to walk the document once and emit:
 *   - content blocks (paragraphs, headings, list items, quotes, code, tables, captions)
 *   - container candidates with ancestry, so scoring can pick a main-content root
 *   - page metadata (title, author, dates, canonical, language)
 *   - images with alt text
 *   - stats used to detect JavaScript-rendered pages
 *
 * It does NOT decide what the main content is — that is score.js. This module
 * only reports what is in the document.
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Elements whose entire subtree is never content.
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
  'object', 'video', 'audio', 'form', 'select', 'textarea', 'button',
  'nav', 'aside', 'dialog', 'menu', 'label', 'fieldset', 'legend',
]);

// Containers we consider as possible main-content roots.
const CONTAINER_TAGS = new Set(['body', 'article', 'main', 'section', 'div']);

const SEMANTIC_TAGS = new Set(['article', 'main']);

const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

const JUNK_ATTR =
  /(^|[-_ ])(nav|navbar|navigation|menu|sidebar|side-bar|footer|masthead|cookie|consent|gdpr|banner|advert|ads?|adsense|adslot|promo|popup|modal|overlay|lightbox|share|sharing|social|comment|comments|disqus|related|recommend|newsletter|subscribe|signup|breadcrumb|breadcrumbs|pagination|pager|widget|sticky|toolbar|skip-link|screen-reader|sr-only|visually-hidden|offscreen|searchbox|search-form|login|signin|paywall|meta-nav|site-header|global-header|utility)([-_ ]|$)/i;

const KEEP_ATTR =
  /(^|[-_ ])(article|articlebody|content|contents|post|postbody|entry|entry-content|story|storybody|main|mainbody|body-copy|text|textbody|blog|markdown|prose|rich-?text|page-?content|documentation|doc-?content|mw-parser-output)([-_ ]|$)/i;

const HIDDEN_ROLES = new Set([
  'navigation', 'banner', 'complementary', 'search', 'dialog',
  'alertdialog', 'menu', 'menubar', 'toolbar', 'tablist', 'form',
]);

const APP_ROOT = /(^|[-_ ])(root|app|__next|__nuxt|ember-app|react-root|main-app)([-_ ]|$)/i;

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function countWords(text) {
  if (!text) return 0;
  const matched = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  return matched ? matched.length : 0;
}

function absolute(href, baseUrl) {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

/**
 * Decide whether an element starts a subtree we should ignore entirely.
 */
function isDroppedElement(tag, attrs) {
  if (DROP_TAGS.has(tag)) return true;
  if (attrs.hidden !== null && attrs.hidden !== undefined) return true;
  if (attrs.ariaHidden === 'true') return true;
  if (attrs.role && HIDDEN_ROLES.has(attrs.role.toLowerCase())) return true;
  if (attrs.style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style)) return true;

  const signature = `${attrs.id || ''} ${attrs.className || ''} ${attrs.dataTestid || ''}`.trim();
  if (signature && JUNK_ATTR.test(signature) && !KEEP_ATTR.test(signature)) return true;

  return false;
}

/**
 * Walk the document and harvest content blocks.
 *
 * @param {string} html raw HTML
 * @param {string} baseUrl used to resolve relative image/canonical URLs
 * @returns {Promise<object>} harvest result
 */
export async function harvest(html, baseUrl) {
  const blocks = [];
  const containers = new Map(); // eid -> { eid, tag, depth, semantic, signature }
  const images = [];
  const meta = {
    title: '',
    ogTitle: '',
    author: '',
    published: '',
    modified: '',
    description: '',
    canonical: '',
    language: '',
    siteName: '',
  };

  const stack = [];
  let nextEid = 1;
  let dropDepth = 0;
  let linkDepth = 0;
  let openBlock = null;
  let table = null;
  let cell = null;
  let inTitle = false;
  const listStack = [];

  let scriptCount = 0;
  let appRootSeen = false;
  let totalTextChars = 0;

  const containerPath = () => stack.filter((frame) => frame.container).map((frame) => frame.eid);

  function startBlock(type, extra) {
    flushBlock();
    openBlock = {
      index: blocks.length,
      type,
      text: '',
      linkChars: 0,
      depth: stack.length,
      ancestors: containerPath(),
      ...extra,
    };
  }

  function flushBlock() {
    if (!openBlock) return;
    const text = collapse(openBlock.text);
    const block = openBlock;
    openBlock = null;
    if (!text) return;
    block.text = text;
    block.chars = text.length;
    block.words = countWords(text);
    block.index = blocks.length;
    blocks.push(block);
  }

  function pushText(chunk) {
    if (!chunk) return;
    totalTextChars += chunk.length;
    if (dropDepth > 0) return;
    if (cell) {
      cell.text += chunk;
      if (linkDepth > 0) cell.linkChars += chunk.length;
      return;
    }
    if (openBlock) {
      openBlock.text += chunk;
      if (linkDepth > 0) openBlock.linkChars += chunk.length;
    }
  }

  function closeTable() {
    if (!table) return;
    const finished = table;
    table = null;
    cell = null;
    const rows = finished.rows.filter((row) => row.some((value) => value.text));
    if (!rows.length) return;
    blocks.push({
      index: blocks.length,
      type: 'table',
      text: rows.map((row) => row.map((c) => c.text).join(' | ')).join('\n'),
      rows: rows.map((row) => row.map((c) => ({ text: c.text, header: c.header }))),
      chars: rows.reduce((sum, row) => sum + row.reduce((s, c) => s + c.text.length, 0), 0),
      words: rows.reduce((sum, row) => sum + row.reduce((s, c) => s + countWords(c.text), 0), 0),
      linkChars: rows.reduce((sum, row) => sum + row.reduce((s, c) => s + c.linkChars, 0), 0),
      depth: finished.depth,
      ancestors: finished.ancestors,
    });
  }

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(chunk) {
        if (!inTitle) return;
        meta.title += chunk.text;
      },
    })
    .on('meta', {
      element(el) {
        const property = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
        const content = collapse(el.getAttribute('content') || '');
        if (!property || !content) return;
        if (property === 'og:title' && !meta.ogTitle) meta.ogTitle = content;
        else if (property === 'og:site_name' && !meta.siteName) meta.siteName = content;
        else if (property === 'description' || property === 'og:description') {
          if (!meta.description) meta.description = content;
        } else if (/^(author|article:author|byl|dc\.creator|parsely-author|twitter:creator)$/.test(property)) {
          if (!meta.author) meta.author = content;
        } else if (/^(article:published_time|datepublished|publish-date|pubdate|dc\.date|parsely-pub-date)$/.test(property)) {
          if (!meta.published) meta.published = content;
        } else if (/^(article:modified_time|datemodified|lastmod)$/.test(property)) {
          if (!meta.modified) meta.modified = content;
        }
      },
    })
    .on('link', {
      element(el) {
        if ((el.getAttribute('rel') || '').toLowerCase() === 'canonical' && !meta.canonical) {
          meta.canonical = absolute(el.getAttribute('href'), baseUrl);
        }
      },
    })
    .on('html', {
      element(el) {
        if (!meta.language) meta.language = collapse(el.getAttribute('lang') || '');
      },
    })
    .on('time', {
      element(el) {
        const value = collapse(el.getAttribute('datetime') || '');
        if (value && !meta.published) meta.published = value;
      },
    })
    .on('img', {
      element(el) {
        if (dropDepth > 0) return;
        const src = absolute(el.getAttribute('src') || el.getAttribute('data-src'), baseUrl);
        const alt = collapse(el.getAttribute('alt') || '');
        if (!src) return;
        images.push({
          src,
          alt,
          caption: '',
          afterBlock: blocks.length,
          ancestors: containerPath(),
        });
      },
    })
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();

        if (tag === 'script') scriptCount += 1;
        if (tag === 'title') {
          inTitle = true;
          try {
            el.onEndTag(() => {
              inTitle = false;
            });
          } catch {
            /* void or unclosable */
          }
          return;
        }

        const attrs = {
          id: el.getAttribute('id'),
          className: el.getAttribute('class'),
          role: el.getAttribute('role'),
          style: el.getAttribute('style'),
          hidden: el.getAttribute('hidden'),
          ariaHidden: el.getAttribute('aria-hidden'),
          dataTestid: el.getAttribute('data-testid'),
        };

        if (!appRootSeen && APP_ROOT.test(`${attrs.id || ''} ${attrs.className || ''}`)) {
          appRootSeen = true;
        }

        const dropped = dropDepth > 0 || isDroppedElement(tag, attrs);
        const isContainer = !dropped && CONTAINER_TAGS.has(tag);
        const eid = nextEid;
        nextEid += 1;

        if (isContainer) {
          const signature = `${attrs.id || ''} ${attrs.className || ''}`.trim();
          containers.set(eid, {
            eid,
            tag,
            depth: stack.length,
            semantic: SEMANTIC_TAGS.has(tag),
            preferred: Boolean(signature && KEEP_ATTR.test(signature)),
            signature,
          });
        }

        const openedDrop = !!(dropDepth > 0 || isDroppedElement(tag, attrs));
        if (openedDrop) dropDepth += 1;

        if (!openedDrop) {
          if (tag === 'a') linkDepth += 1;
          else if (tag === 'ul' || tag === 'ol') listStack.push({ ordered: tag === 'ol' });
          else if (tag === 'table') {
            closeTable();
            table = { rows: [], depth: stack.length, ancestors: containerPath() };
            flushBlock();
          } else if (tag === 'tr' && table) {
            table.rows.push([]);
          } else if ((tag === 'td' || tag === 'th') && table) {
            if (!table.rows.length) table.rows.push([]);
            cell = { text: '', linkChars: 0, header: tag === 'th' };
            table.rows[table.rows.length - 1].push(cell);
          } else if (!table) {
            if (HEADING_LEVEL[tag]) startBlock('heading', { level: HEADING_LEVEL[tag] });
            else if (tag === 'p') startBlock('paragraph');
            else if (tag === 'li') {
              const list = listStack[listStack.length - 1];
              startBlock('listitem', {
                ordered: list ? list.ordered : false,
                level: Math.max(listStack.length, 1),
              });
            } else if (tag === 'blockquote') startBlock('quote');
            else if (tag === 'pre') startBlock('code');
            else if (tag === 'figcaption' || tag === 'caption') startBlock('caption');
            else if (tag === 'dt' || tag === 'dd') startBlock('paragraph');
          }
        }

        const frame = { tag, eid, container: isContainer, dropped: openedDrop };

        if (VOID_TAGS.has(tag) || el.selfClosing) {
          if (openedDrop) dropDepth -= 1;
          return;
        }

        stack.push(frame);

        try {
          el.onEndTag(() => {
            // Unwind to this frame in case of unclosed descendants.
            while (stack.length && stack[stack.length - 1].eid !== frame.eid) {
              const stray = stack.pop();
              if (stray.dropped) dropDepth = Math.max(0, dropDepth - 1);
              if (stray.tag === 'a') linkDepth = Math.max(0, linkDepth - 1);
            }
            if (stack.length) stack.pop();

            if (tag === 'a') linkDepth = Math.max(0, linkDepth - 1);
            else if (tag === 'ul' || tag === 'ol') listStack.pop();
            else if (tag === 'table') closeTable();
            else if (tag === 'td' || tag === 'th') {
              if (cell) cell.text = collapse(cell.text);
              cell = null;
            } else if (
              HEADING_LEVEL[tag] || tag === 'p' || tag === 'li' || tag === 'blockquote' ||
              tag === 'pre' || tag === 'figcaption' || tag === 'caption' ||
              tag === 'dt' || tag === 'dd'
            ) {
              if (tag === 'figcaption' && openBlock) {
                const captionText = collapse(openBlock.text);
                const lastImage = images[images.length - 1];
                if (lastImage && !lastImage.caption) lastImage.caption = captionText;
              }
              flushBlock();
            }

            if (openedDrop) dropDepth = Math.max(0, dropDepth - 1);
          });
        } catch {
          // Element cannot have an end tag — unwind immediately.
          stack.pop();
          if (openedDrop) dropDepth = Math.max(0, dropDepth - 1);
        }
      },

      text(chunk) {
        pushText(chunk.text);
      },
    });

  const response = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  await response.arrayBuffer();

  flushBlock();
  closeTable();

  meta.title = collapse(meta.title);

  return {
    blocks,
    containers,
    images,
    meta,
    stats: {
      htmlLength: html.length,
      scriptCount,
      appRootSeen,
      totalTextChars,
      blockCount: blocks.length,
    },
  };
}
