// Thinkneering — shared server helpers (Cloudflare Pages Functions)

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
  });

export const bad = (message, status = 400) => json({ error: message }, status);

export const now = () => new Date().toISOString();

export const id = (prefix) =>
  prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ------------------------------------------------------------ passwords
// PBKDF2-SHA256. Stronger than a single SHA-256 pass and still Web Crypto only.
const ITERATIONS = 100000;

export async function hashPassword(password, saltHex) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPassword(password, saltHex, expected) {
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ------------------------------------------------------------- sessions
export const SESSION_DAYS = 7;

export function sessionCookie(sid, maxAgeSeconds) {
  return `tn_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const found = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export async function currentUser(env, request) {
  const sid = readCookie(request, 'tn_session');
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.plan, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1`
  ).bind(sid).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(sid).run();
    return null;
  }
  if (row.status === 'suspended') return { ...row, suspended: true };
  return row;
}

// --------------------------------------------------------------- access
const ACCESS_RANK = { public: 0, auth: 1, restricted: 2 };
const PLAN_RANK = { free: 0, member: 1, pro: 2 };

export const strictest = (a, b) =>
  (ACCESS_RANK[a] ?? 0) >= (ACCESS_RANK[b] ?? 0) ? (a || 'public') : (b || 'public');

/**
 * Single source of truth for "can this visitor open this thing".
 * grantKeys is a Set of "type:id" strings the user has been granted.
 */
export function canAccess(user, accessLevel, requiredPlan, grantKeys, scopeKey) {
  if (user && user.role === 'admin') return true;
  if (user && user.suspended) return false;
  const level = accessLevel || 'public';
  const plan = requiredPlan || 'free';
  if (level === 'public' && plan === 'free') return true;
  if (!user || user.status !== 'active') return false;
  if (level === 'auth' && plan === 'free') return true;
  if (grantKeys && scopeKey && grantKeys.has(scopeKey)) return true;
  return (PLAN_RANK[user.plan] ?? 0) >= (PLAN_RANK[plan] ?? 0);
}

export async function loadGrants(env, user) {
  if (!user) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT scope_type, scope_id FROM grants
      WHERE user_id = ?1 AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).bind(user.id).all();
  return new Set((results || []).map((r) => r.scope_type + ':' + r.scope_id));
}

export async function setting(env, key, fallback = '') {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first();
  return row ? row.value : fallback;
}

export async function audit(env, actor, action, target, meta) {
  await env.DB.prepare(
    `INSERT INTO audit_log (actor_id, actor_email, action, target, meta, created_at)
     VALUES (?1,?2,?3,?4,?5,?6)`
  ).bind(actor?.id || null, actor?.email || null, action, target || null,
    meta ? JSON.stringify(meta) : null, now()).run();
}

export async function track(env, user, action, target, anonId) {
  try {
    await env.DB.prepare(
      `INSERT INTO usage_events (user_id, anon_id, action, target, created_at) VALUES (?1,?2,?3,?4,?5)`
    ).bind(user?.id || null, anonId || null, action, target || null, now()).run();
  } catch (e) { /* analytics must never break a request */ }
}

export function requireAdmin(user) {
  if (!user || user.role !== 'admin') throw Object.assign(new Error('Admin access required'), { status: 403 });
  return user;
}
