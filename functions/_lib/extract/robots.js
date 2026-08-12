/**
 * robots.js — robots.txt fetch + matcher.
 *
 * Deliberately conservative: if robots.txt is missing or unreachable we allow,
 * if it is present and disallows our path we refuse to fetch the page at all.
 * No external dependency.
 */

export const UA_TOKEN = 'ThinkneeringExtractor';

/**
 * Parse robots.txt into { agentToken: [{ allow: bool, pattern: string }] }.
 */
export function parseRobots(txt) {
  const groups = new Map();
  let currentAgents = [];
  let expectingAgents = false;

  for (const rawLine of String(txt).split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!expectingAgents) currentAgents = [];
      const agent = value.toLowerCase();
      currentAgents.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
      expectingAgents = true;
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      expectingAgents = false;
      if (!currentAgents.length) continue;
      for (const agent of currentAgents) {
        groups.get(agent).push({ allow: field === 'allow', pattern: value });
      }
    }
  }

  return groups;
}

function patternToRegex(pattern) {
  // robots.txt wildcards: * = any run of chars, $ = end of URL. Everything else literal.
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') source += '.*';
    else if (ch === '$' && i === pattern.length - 1) source += '$';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + source);
}

/**
 * Longest-match-wins, Allow beats Disallow on equal length (Google/RFC 9309 behaviour).
 */
export function isAllowedByRules(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (rule.pattern === '') continue; // empty Disallow means "allow everything"
    let re;
    try {
      re = patternToRegex(rule.pattern);
    } catch {
      continue;
    }
    if (!re.test(path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

/**
 * @returns {Promise<{ allowed: boolean, reason: string }>}
 */
export async function checkRobots(targetUrl, { timeoutMs = 5000, userAgent } = {}) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return { allowed: false, reason: 'invalid-url' };
  }

  let res;
  try {
    res = await fetch(new URL('/robots.txt', url.origin).toString(), {
      headers: { 'user-agent': userAgent || UA_TOKEN, accept: 'text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { allowed: true, reason: 'robots-unreachable' };
  }

  if (res.status === 401 || res.status === 403) {
    return { allowed: false, reason: 'robots-forbidden' };
  }
  if (!res.ok) {
    return { allowed: true, reason: 'no-robots' };
  }

  let txt = '';
  try {
    txt = (await res.text()).slice(0, 200000);
  } catch {
    return { allowed: true, reason: 'robots-unreadable' };
  }

  const groups = parseRobots(txt);
  const own = groups.get(UA_TOKEN.toLowerCase());
  const star = groups.get('*');
  const rules = own && own.length ? own : star || [];
  if (!rules.length) return { allowed: true, reason: 'no-matching-group' };

  const path = url.pathname + url.search;
  const allowed = isAllowedByRules(rules, path);
  return {
    allowed,
    reason: allowed ? 'allowed-by-robots' : 'disallowed-by-robots',
  };
}
