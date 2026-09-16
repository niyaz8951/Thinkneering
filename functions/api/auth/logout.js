import { json, readCookie } from '../../_lib.js';

export const onRequestPost = async ({ env, request }) => {
  const sid = readCookie(request, 'tn_session');
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(sid).run();
  return json({ ok: true }, 200,
    { 'Set-Cookie': 'tn_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
};
