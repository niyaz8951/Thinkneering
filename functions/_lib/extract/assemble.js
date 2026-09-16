/**
 * assemble.js — stage 4 of the pipeline: structured output.
 *
 * Turns selected blocks into the documented result shape. This module never
 * invents text: every string it emits comes from the harvested blocks.
 */

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normaliseDate(value) {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString();
}

function pickTitle(meta, blocks) {
  const firstH1 = blocks.find((block) => block.type === 'heading' && block.level === 1);
  if (firstH1 && firstH1.words >= 2) return firstH1.text;
  if (meta.ogTitle) return meta.ogTitle;
  if (meta.title) {
    // Strip trailing " | Site Name" / " - Site Name" boilerplate.
    const cleaned = meta.title.replace(/\s*[|\u2013\u2014-]\s*[^|\u2013\u2014-]{2,40}$/, '').trim();
    return cleaned.length >= 8 ? cleaned : meta.title;
  }
  return '';
}

function escapeCell(text) {
  return text.replace(/\|/g, '\\|');
}

function groupLists(blocks) {
  const lists = [];
  let current = null;
  for (const block of blocks) {
    if (block.type !== 'listitem') {
      if (current) lists.push(current);
      current = null;
      continue;
    }
    if (!current || current.ordered !== !!block.ordered || current.level !== block.level) {
      if (current) lists.push(current);
      current = { ordered: !!block.ordered, level: block.level || 1, items: [] };
    }
    current.items.push(block.text);
  }
  if (current) lists.push(current);
  return lists;
}

function toMarkdown(blocks) {
  const parts = [];
  let counter = 0;
  const push = (md, kind) => parts.push({ md, kind });

  blocks.forEach((block, i) => {
    switch (block.type) {
      case 'heading':
        counter = 0;
        push(`${'#'.repeat(Math.min(block.level, 6))} ${block.text}`, 'heading');
        break;
      case 'paragraph':
        counter = 0;
        push(block.text, 'paragraph');
        break;
      case 'listitem': {
        const indent = '  '.repeat(Math.max((block.level || 1) - 1, 0));
        if (block.ordered) {
          const previous = blocks[i - 1];
          counter = previous && previous.type === 'listitem' && previous.ordered ? counter + 1 : 1;
          push(`${indent}${counter}. ${block.text}`, 'listitem');
        } else {
          counter = 0;
          push(`${indent}- ${block.text}`, 'listitem');
        }
        break;
      }
      case 'quote':
        counter = 0;
        push(block.text.split('\n').map((line) => `> ${line}`).join('\n'), 'quote');
        break;
      case 'code':
        counter = 0;
        push('```\n' + block.text + '\n```', 'code');
        break;
      case 'caption':
        counter = 0;
        push(`*${block.text}*`, 'caption');
        break;
      case 'table': {
        counter = 0;
        const rows = block.rows || [];
        if (!rows.length) break;
        const width = Math.max(...rows.map((row) => row.length));
        const pad = (row) => {
          const cells = row.map((cell) => escapeCell(cell.text));
          while (cells.length < width) cells.push('');
          return cells;
        };
        const lines = [];
        const [head, ...rest] = rows;
        lines.push(`| ${pad(head).join(' | ')} |`);
        lines.push(`| ${new Array(width).fill('---').join(' | ')} |`);
        for (const row of rest) lines.push(`| ${pad(row).join(' | ')} |`);
        push(lines.join('\n'), 'table');
        break;
      }
      default:
        break;
    }
  });

  return parts
    .map((part, i) => {
      if (i === 0) return part.md;
      const tight = part.kind === 'listitem' && parts[i - 1].kind === 'listitem';
      return (tight ? '\n' : '\n\n') + part.md;
    })
    .join('')
    .trim();
}

function toPlainText(blocks) {
  return blocks
    .map((block) => {
      if (block.type === 'table') {
        return (block.rows || []).map((row) => row.map((cell) => cell.text).join('\t')).join('\n');
      }
      if (block.type === 'listitem') return `• ${block.text}`;
      return block.text;
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function assemble({ harvest, picked, blocks, sourceUrl, finalUrl, fetchInfo, warnings }) {
  const { meta } = harvest;
  const title = pickTitle(meta, blocks);

  const headings = blocks
    .filter((block) => block.type === 'heading')
    .map((block) => ({ level: block.level, text: block.text, id: slug(block.text) }));

  const tables = blocks
    .filter((block) => block.type === 'table')
    .map((block) => ({
      rows: (block.rows || []).map((row) => row.map((cell) => cell.text)),
      headerRow: (block.rows || [])[0] ? (block.rows[0] || []).every((cell) => cell.header) : false,
    }));

  const images = harvest.images
    .filter((image) => picked.containerId === null || image.ancestors.includes(picked.containerId))
    .filter((image) => image.alt || image.caption)
    .slice(0, 60)
    .map((image) => ({ src: image.src, alt: image.alt, caption: image.caption }));

  const markdown = toMarkdown(blocks);
  const text = toPlainText(blocks);
  const words = blocks.reduce((sum, block) => sum + (block.words || 0), 0);

  return {
    ok: true,
    sourceUrl,
    finalUrl,
    canonicalUrl: meta.canonical || '',
    title,
    siteName: meta.siteName || '',
    author: meta.author || '',
    publishedAt: normaliseDate(meta.published),
    modifiedAt: normaliseDate(meta.modified),
    language: meta.language || '',
    description: meta.description || '',
    extraction: {
      method: picked.method,
      confidence: picked.confidence,
      contentShare: picked.share ?? null,
      linkDensity: picked.linkDensity ?? null,
      container: picked.tag ? `<${picked.tag}>${picked.signature ? ` ${picked.signature}` : ''}` : 'document',
      renderer: fetchInfo.renderer || 'static-fetch',
      httpStatus: fetchInfo.status || null,
      bytes: fetchInfo.bytes || 0,
      truncated: !!fetchInfo.truncated,
      aiReviewed: false,
    },
    counts: {
      words,
      characters: text.length,
      blocks: blocks.length,
      paragraphs: blocks.filter((b) => b.type === 'paragraph').length,
      headings: headings.length,
      lists: groupLists(blocks).length,
      tables: tables.length,
      images: images.length,
    },
    headings,
    lists: groupLists(blocks),
    tables,
    images,
    markdown,
    text,
    blocks: blocks.map((block) => ({
      type: block.type,
      level: block.level || null,
      ordered: block.ordered ?? null,
      text: block.text,
      words: block.words,
      score: block.score,
      linkDensity: block.linkDensity,
    })),
    warnings,
  };
}
