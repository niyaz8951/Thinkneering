// Attaches the current user to every function request and blocks the site
// when maintenance mode is on (admins excepted).
import { currentUser, setting, json } from './_lib.js';

export const onRequest = async (context) => {
  const { env, request, next, data } = context;
  try {
    data.user = await currentUser(env, request);
  } catch (e) {
    data.user = null;
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
    const mode = await setting(env, 'maintenance', 'off');
    if (mode === 'on' && (!data.user || data.user.role !== 'admin')) {
      return json({ error: 'Thinkneering is down for maintenance. Try again shortly.' }, 503);
    }
  }
  return next();
};
