import { json, bad, id, now, hashPassword, sessionCookie, setting, audit, SESSION_DAYS } from '../../_lib.js';

export const onRequestPost = async ({ env, request }) => {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 80);

  // The confirm field is a typo guard, not a security control — whoever sends
  // the request controls both values. So it is only checked when it is
  // actually sent. Requiring it outright would mean any caller that predates
  // the second field gets "Passwords do not match" on a perfectly good
  // password, which is a much worse failure than the typo it prevents.
  const confirmPassword = body.confirmPassword == null ? null : String(body.confirmPassword);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Enter a valid email address.');
  if (password.length < 8) return bad('Use at least 8 characters for your password.');
  if (confirmPassword !== null && password !== confirmPassword) {
    return bad('The two passwords do not match.');
  }

  const mode = await setting(env, 'signup_mode', 'open');
  if (mode === 'closed') return bad('New accounts are paused right now.', 403);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (exists) return bad('That email already has an account. Sign in instead.', 409);

  const { hash, salt } = await hashPassword(password);
  const userId = id('usr');
  const status = mode === 'approval' ? 'pending' : 'active';
  const plan = await setting(env, 'default_plan', 'member');

  await env.DB.prepare(
    `INSERT INTO users (id,email,name,password_hash,salt,role,status,plan,created_at)
     VALUES (?1,?2,?3,?4,?5,'user',?6,?7,?8)`
  ).bind(userId, email, name || null, hash, salt, status, plan, now()).run();

  await audit(env, { id: userId, email }, 'user.signup', userId, { status });

  if (status === 'pending') {
    return json({ ok: true, status: 'pending', message: 'Account created. An admin will approve it shortly.' });
  }

  const sid = id('ses');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (id,user_id,created_at,expires_at,user_agent) VALUES (?1,?2,?3,?4,?5)'
  ).bind(sid, userId, now(), expires, request.headers.get('User-Agent') || null).run();

  return json({ ok: true, status: 'active', user: { id: userId, email, name, role: 'user', plan } },
    200, { 'Set-Cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
};
