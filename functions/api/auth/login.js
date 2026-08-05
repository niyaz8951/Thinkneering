import { json, bad, id, now, verifyPassword, sessionCookie, SESSION_DAYS } from '../../_lib.js';

export const onRequestPost = async ({ env, request }) => {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return bad('Enter your email and password.');

  const user = await env.DB.prepare(
    'SELECT id,email,name,password_hash,salt,role,status,plan FROM users WHERE email = ?1'
  ).bind(email).first();

  // Same message either way, so the form cannot be used to discover accounts.
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    return bad('That email and password do not match.', 401);
  }
  if (user.status === 'pending') return bad('This account is waiting for admin approval.', 403);
  if (user.status === 'suspended') return bad('This account has been suspended.', 403);

  const sid = id('ses');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (id,user_id,created_at,expires_at,user_agent) VALUES (?1,?2,?3,?4,?5)'
  ).bind(sid, user.id, now(), expires, request.headers.get('User-Agent') || null).run();
  await env.DB.prepare('UPDATE users SET last_login_at = ?1 WHERE id = ?2').bind(now(), user.id).run();

  return json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan } },
    200, { 'Set-Cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
};
