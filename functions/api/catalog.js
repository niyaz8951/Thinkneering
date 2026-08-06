import { json, bad, canAccess, loadGrants, strictest, setting, track } from '../_lib.js';

// GET /api/catalog                 -> chrome data (user + top-level nav)
// GET /api/catalog?path=hvac       -> a section, its subsections and items
// GET /api/catalog?path=hvac/standards
export const onRequestGet = async ({ env, request, data }) => {
  const url = new URL(request.url);
  const path = (url.searchParams.get('path') || '').replace(/^\/|\/$/g, '');
  const user = data.user;
  const isAdmin = !!user && user.role === 'admin';
  const grants = await loadGrants(env, user);

  const { results: allSections } = await env.DB.prepare(
    'SELECT * FROM sections ORDER BY sort_order, title'
  ).all();
  const visible = (allSections || []).filter((s) => isAdmin || s.is_published);

  const decorate = (s, inherited) => {
    const level = strictest(s.access_level, inherited);
    return {
      id: s.id, slug: s.slug, title: s.title, tagline: s.tagline, description: s.description,
      icon: s.icon, kind: 'section', access_level: level, required_plan: s.required_plan,
      is_published: !!s.is_published,
      href: null,
      allowed: canAccess(user, level, s.required_plan, grants, 'section:' + s.id)
    };
  };

  const payload = {
    user: user ? { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan } : null,
    announcement: await setting(env, 'announcement', ''),
    sections: visible.filter((s) => !s.parent_id).map((s) => decorate(s, 'public'))
  };

  if (!path) return json(payload);

  // ---- resolve the requested section by slug path
  const parts = path.split('/');
  let parent = null;
  let inherited = 'public';
  let node = null;
  const breadcrumb = [];
  for (const slug of parts) {
    node = visible.find((s) => s.slug === slug && (s.parent_id || null) === (parent ? parent.id : null));
    if (!node) return bad('That section does not exist.', 404);
    inherited = strictest(inherited, node.access_level);
    breadcrumb.push({ slug: node.slug, title: node.title });
    parent = node;
  }

  const sectionEntry = decorate(node, inherited);
  await track(env, user, sectionEntry.allowed ? 'view' : 'denied', 'section:' + node.id);

  const children = visible
    .filter((s) => s.parent_id === node.id)
    .map((s) => decorate(s, inherited));

  const { results: rawItems } = await env.DB.prepare(
    `SELECT i.*, b.slug AS book_slug, b.status AS book_status
       FROM items i LEFT JOIN books b ON b.id = i.book_id
      WHERE i.section_id = ?1 ORDER BY i.sort_order, i.title`
  ).bind(node.id).all();

  const items = (rawItems || [])
    .filter((i) => isAdmin || i.is_published)
    .filter((i) => isAdmin || i.kind !== 'book' || i.book_status === 'published')
    .map((i) => {
      const level = strictest(i.access_level, inherited);
      return {
        id: i.id, slug: i.slug, title: i.title, description: i.description, kind: i.kind,
        href: i.href, book_slug: i.book_slug, icon: i.icon, badge: i.badge, teaser: i.teaser,
        access_level: level, required_plan: i.required_plan, is_published: !!i.is_published,
        allowed: canAccess(user, level, i.required_plan, grants, 'item:' + i.id)
      };
    });

  return json({ ...payload, section: sectionEntry, breadcrumb, children, items });
};
