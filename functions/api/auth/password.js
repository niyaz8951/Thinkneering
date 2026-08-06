import { json, bad, hashPassword, verifyPassword, audit } from '../../_lib.js';

export const onRequestPost = async ({ env, request, data }) => {
  if (!data.user) return bad('Sign in first.', 401);
  const body = await request.json().catch(() => ({}));
  const next = String(body.new_password || '');
  if (next.length < 8) return bad('Use at least 8 characters for your new password.');

  const row = await env.DB.prepare('SELECT password_hash, salt FROM users WHERE id = ?1')
    .bind(data.user.id).first();
  if (!(await verifyPassword(String(body.current_password || ''), row.salt, row.password_hash))) {
    return bad('Your current password is not correct.', 403);
  }
  const { hash, salt } = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ?1, salt = ?2 WHERE id = ?3')
    .bind(hash, salt, data.user.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(data.user.id).run();
  await audit(env, data.user, 'user.password_changed', data.user.id);
  return json({ ok: true, message: 'Password changed. Sign in again.' });
};
