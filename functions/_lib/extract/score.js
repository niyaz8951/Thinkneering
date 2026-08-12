/**
 * score.js — stage 3 of the pipeline: content scoring.
 *
 * Pure functions over the harvest result. No fetching, no DOM, no AI.
 * Decides which container is the main content and how confident we are.
 */

const BOILERPLATE =
  /(accept (all )?cookies|cookie (policy|settings|preferences)|we use cookies|consent|subscribe|newsletter|sign ?up|log ?in|create an account|advertisement|sponsored|all rights reserved|©|\ball rights\b|share this|follow us|read more|related (articles|posts|stories)|you may also like|privacy policy|terms of (use|service)|back to top|skip to (main )?content)/i;

const NAVISH = /^(home|menu|search|about|contact|login|sign in|sign up|next|previous|prev|more|share|tweet|close|back)$/i;

export function scoreBlock(block) {
  const words = block.words || 0;
  const chars = block.chars || 0;
  let score = 0;

  switch (block.type) {
    case 'paragraph':
      score = words >= 15 ? 6 + Math.sqrt(words - 14) : words * 0.18;
      break;
    case 'heading':
      score = words > 0 ? Math.max(1, 4 - (block.level - 1) * 0.4) : 0;
      break;
    case 'listitem':
      score = words >= 6 ? 1.4 + Math.sqrt(words) * 0.25 : words * 0.12;
      break;
    case 'table':
      score = 4 + Math.min((block.rows ? block.rows.length : 0) * 0.6, 12);
      break;
    case 'quote':
    case 'code':
      score = 3 + Math.sqrt(Math.max(words, 1));
      break;
    case 'caption':
      score = words >= 4 ? 1 : 0.3;
      break;
    default:
      score = words * 0.1;
  }

  const linkDensity = chars > 0 ? (block.linkChars || 0) / chars : 0;
  if (linkDensity > 0.35) score *= Math.max(0.05, 1 - linkDensity);

  if (words < 30 && BOILERPLATE.test(block.text)) score *= 0.2;
  if (NAVISH.test(block.text)) score *= 0.1;
  if (words < 4 && block.type !== 'heading' && block.type !== 'table') score *= 0.3;

  block.linkDensity = Number(linkDensity.toFixed(3));
  block.score = Number(Math.max(score, 0).toFixed(3));
  return block.score;
}

/**
 * Aggregate block scores onto every ancestor container, then pick the deepest
 * container that still holds essentially all of the content. Picking the
 * deepest near-maximal container is what stops <body> winning by default.
 */
export function pickContainer(harvest) {
  const { blocks, containers } = harvest;

  let totalScore = 0;
  for (const block of blocks) totalScore += scoreBlock(block);

  const totals = new Map();
  for (const block of blocks) {
    for (const eid of block.ancestors) {
      const entry = totals.get(eid) || {
        score: 0, words: 0, chars: 0, linkChars: 0, paragraphs: 0, blocks: 0,
      };
      entry.score += block.score;
      entry.words += block.words || 0;
      entry.chars += block.chars || 0;
      entry.linkChars += block.linkChars || 0;
      entry.blocks += 1;
      if (block.type === 'paragraph' || block.type === 'table') entry.paragraphs += 1;
      totals.set(eid, entry);
    }
  }

  let best = null;
  const candidates = [];

  for (const [eid, stats] of totals) {
    const info = containers.get(eid);
    if (!info) continue;
    let adjusted = stats.score;
    if (info.semantic) adjusted *= 1.3;
    if (info.preferred) adjusted *= 1.2;
    const candidate = { eid, info, stats, adjusted };
    candidates.push(candidate);
    if (!best || adjusted > best.adjusted) best = candidate;
  }

  if (!best) {
    return {
      containerId: null,
      method: 'whole-document',
      confidence: blocks.length ? 0.2 : 0.02,
      stats: { score: totalScore, words: 0, chars: 0, linkChars: 0, paragraphs: 0, blocks: blocks.length },
      semantic: false,
    };
  }

  // Among containers holding ~all the score, prefer the tightest (deepest) one.
  const threshold = best.adjusted * 0.9;
  let picked = best;
  for (const candidate of candidates) {
    if (candidate.adjusted < threshold) continue;
    if (candidate.stats.paragraphs < 1 && best.stats.paragraphs >= 1) continue;
    if (
      candidate.info.depth > picked.info.depth ||
      (candidate.info.depth === picked.info.depth && candidate.adjusted > picked.adjusted)
    ) {
      picked = candidate;
    }
  }

  const share = totalScore > 0 ? picked.stats.score / totalScore : 0;
  const linkDensity = picked.stats.chars > 0 ? picked.stats.linkChars / picked.stats.chars : 0;

  let confidence =
    0.35 * Math.min(share, 1) +
    0.25 * Math.min(picked.stats.words / 300, 1) +
    0.20 * (1 - Math.min(linkDensity / 0.4, 1)) +
    0.20 * (picked.info.semantic || picked.info.preferred ? 1 : 0.45);

  if (picked.stats.paragraphs === 0) confidence *= 0.5;
  confidence = Math.max(0.05, Math.min(0.98, confidence));

  return {
    containerId: picked.eid,
    method: picked.info.semantic
      ? `semantic-<${picked.info.tag}> + dom-heuristics`
      : 'dom-heuristics (text/link density)',
    confidence: Number(confidence.toFixed(2)),
    share: Number(share.toFixed(3)),
    linkDensity: Number(linkDensity.toFixed(3)),
    semantic: picked.info.semantic,
    tag: picked.info.tag,
    signature: picked.info.signature,
    stats: picked.stats,
  };
}

/**
 * Keep only blocks inside the chosen container, dropping obvious residue.
 */
export function selectBlocks(harvest, picked) {
  const kept = harvest.blocks.filter((block) => {
    if (picked.containerId !== null && !block.ancestors.includes(picked.containerId)) return false;
    if (block.score <= 0.15 && block.type !== 'heading') return false;
    return true;
  });

  // Trim leading/trailing low-value residue (nav crumbs, share rows).
  while (kept.length && kept[0].score < 0.6 && kept[0].type !== 'heading') kept.shift();
  while (kept.length && kept[kept.length - 1].score < 0.6) kept.pop();

  return kept;
}
