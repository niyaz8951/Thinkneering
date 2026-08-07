/**
 * /api/data/process-map
 *
 * GET    -> { ok, data: <map>, maps: [{id, title, project_code, required_on_site, slack_days, health, updated_at}] }
 * POST   -> save (insert or update by map id) -> { ok, id }
 * DELETE -> ?id=<mapId>
 *
 * Bindings: DB (thinkneering-db). Auth comes from functions/_middleware.js,
 * which puts the signed-in user on context.data.user.
 */

export async function onRequestGet(context) {
  const { env } = context;
  const user = context.data && context.data.user;
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const userId = String(user.id || user.username);
  const wanted = new URL(context.request.url).searchParams.get('id');

  const list = await env.DB.prepare(
    'SELECT id, title, project_code, product_line, factory, required_on_site, ' +
    'critical_path_days, slack_days, health, updated_at FROM process_maps ' +
    'WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100'
  ).bind(userId).all();

  const row = wanted
    ? await env.DB.prepare('SELECT data FROM process_maps WHERE user_id = ? AND id = ?')
        .bind(userId, wanted).first()
    : await env.DB.prepare('SELECT data FROM process_maps WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
        .bind(userId).first();

  let data = null;
  if (row && row.data) {
    try { data = JSON.parse(row.data); } catch (err) { data = null; }
  }

  return json({ ok: true, data, maps: (list && list.results) || [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = context.data && context.data.user;
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  let map;
  try { map = await request.json(); }
  catch (err) { return json({ error: 'Invalid JSON body' }, 400); }

  if (!map || !Array.isArray(map.nodes)) return json({ error: 'Invalid map' }, 400);
  if (map.nodes.length > 500) return json({ error: 'Too many cards (max 500)' }, 413);

  const payload = JSON.stringify(map);
  if (payload.length > 900000) return json({ error: 'Map too large to save' }, 413);

  const p = map.project || {};
  const userId = String(user.id || user.username);
  const id = String(map.id || crypto.randomUUID());
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO process_maps (id, user_id, title, project_code, product_line, factory, consultant, ' +
    'contractor, required_on_site, critical_path_days, slack_days, health, data, created_at, updated_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT(id) DO UPDATE SET title = excluded.title, project_code = excluded.project_code, ' +
    'product_line = excluded.product_line, factory = excluded.factory, consultant = excluded.consultant, ' +
    'contractor = excluded.contractor, required_on_site = excluded.required_on_site, ' +
    'critical_path_days = excluded.critical_path_days, slack_days = excluded.slack_days, ' +
    'health = excluded.health, data = excluded.data, updated_at = excluded.updated_at'
  ).bind(
    id,
    userId,
    String(map.title || 'Untitled process').slice(0, 200),
    str(p.code, 80),
    str(p.productLine, 80),
    str(p.factory, 40),
    str(p.consultant, 120),
    str(p.contractor, 120),
    str(p.requiredOnSite, 20),
    num(map.criticalPathDays),
    num(map.slackDays),
    num(map.health),
    payload,
    now,
    now
  ).run();

  return json({ ok: true, id, updated_at: now });
}

export async function onRequestDelete(context) {
  const { env } = context;
  const user = context.data && context.data.user;
  if (!user) return json({ error: 'Sign in required' }, 401);
  if (!env.DB) return json({ error: 'Database not configured' }, 500);

  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  await env.DB.prepare('DELETE FROM process_maps WHERE user_id = ? AND id = ?')
    .bind(String(user.id || user.username), id).run();

  return json({ ok: true });
}

function str(v, max) {
  if (v == null || v === '') return null;
  return String(v).slice(0, max);
}

function num(v) {
  return Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
