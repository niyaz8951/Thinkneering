import { json, bad, id, now, slugify, hashPassword, audit, requireAdmin } from '../../_lib.js';

const guard = (data) => {
  try { requireAdmin(data.user); return null; }
  catch (e) { return bad('Admin access required.', 403); }
};

const seg = (params) => (Array.isArray(params.path) ? params.path : [params.path].filter(Boolean));

// ------------------------------------------------------------------ reads
export const onRequestGet = async ({ env, params, request, data }) => {
  const stop = guard(data); if (stop) return stop;
  const [resource, arg] = seg(params);
  const url = new URL(request.url);
  const DB = env.DB;

  switch (resource) {
    case 'overview': {
      const counts = await DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM users) AS users,
           (SELECT COUNT(*) FROM users WHERE status='pending') AS pending,
           (SELECT COUNT(*) FROM users WHERE status='suspended') AS suspended,
           (SELECT COUNT(*) FROM sections) AS sections,
           (SELECT COUNT(*) FROM items) AS items,
           (SELECT COUNT(*) FROM books) AS books,
           (SELECT COUNT(*) FROM sessions WHERE expires_at > datetime('now')) AS active_sessions`
      ).first();
      const { results: daily } = await DB.prepare(
        `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM usage_events
          WHERE created_at > datetime('now','-7 days') GROUP BY day ORDER BY day`
      ).all();
      const { results: top } = await DB.prepare(
        `SELECT target, COUNT(*) AS n FROM usage_events
          WHERE created_at > datetime('now','-30 days') AND action IN ('view','open')
          GROUP BY target ORDER BY n DESC LIMIT 8`
      ).all();
      const { results: denied } = await DB.prepare(
        `SELECT target, COUNT(*) AS n FROM usage_events
          WHERE created_at > datetime('now','-30 days') AND action='denied'
          GROUP BY target ORDER BY n DESC LIMIT 8`
      ).all();
      const { results: recent } = await DB.prepare(
        `SELECT id,email,name,status,plan,created_at FROM users ORDER BY created_at DESC LIMIT 8`
      ).all();
      return json({ counts, daily, top, denied, recent });
    }

    case 'users': {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const status = url.searchParams.get('status') || '';
      const { results } = await DB.prepare(
        `SELECT id,email,name,role,status,plan,notes,created_at,last_login_at
           FROM users
          WHERE (?1 = '' OR lower(email) LIKE '%'||?1||'%' OR lower(IFNULL(name,'')) LIKE '%'||?1||'%')
            AND (?2 = '' OR status = ?2)
          ORDER BY created_at DESC LIMIT 200`
      ).bind(q, status).all();
      const { results: grants } = await DB.prepare('SELECT * FROM grants').all();
      return json({ users: results || [], grants: grants || [] });
    }

    case 'catalog': {
      const { results: sections } = await DB.prepare(
        'SELECT * FROM sections ORDER BY sort_order, title').all();
      const { results: items } = await DB.prepare(
        'SELECT * FROM items ORDER BY sort_order, title').all();
      return json({ sections: sections || [], items: items || [] });
    }

    case 'books': {
      if (arg) {
        const book = await DB.prepare('SELECT * FROM books WHERE id = ?1').bind(arg).first();
        if (!book) return bad('Book not found.', 404);
        const { results: chapters } = await DB.prepare(
          'SELECT * FROM chapters WHERE book_id = ?1 ORDER BY sort_order').bind(arg).all();
        return json({ book, chapters: chapters || [] });
      }
      const { results } = await DB.prepare('SELECT * FROM books ORDER BY updated_at DESC').all();
      return json({ books: results || [] });
    }

    case 'chapter': {
      const chapter = await DB.prepare('SELECT * FROM chapters WHERE id = ?1').bind(arg).first();
      if (!chapter) return bad('Chapter not found.', 404);
      const { results } = await DB.prepare(
        'SELECT * FROM blocks WHERE chapter_id = ?1 ORDER BY sort_order').bind(arg).all();
      const blocks = (results || []).map((b) => {
        let parsed = {};
        try { parsed = JSON.parse(b.data); } catch (e) {}
        return { id: b.id, type: b.type, data: parsed };
      });
      return json({ chapter, blocks });
    }

    case 'settings': {
      const { results } = await DB.prepare('SELECT * FROM settings').all();
      const map = {};
      (results || []).forEach((r) => { map[r.key] = r.value; });
      return json({ settings: map });
    }

    case 'audit': {
      const { results } = await DB.prepare(
        'SELECT * FROM audit_log ORDER BY id DESC LIMIT 150').all();
      return json({ entries: results || [] });
    }

    default:
      return bad('Unknown admin resource.', 404);
  }
};

// ----------------------------------------------------------------- writes
export const onRequestPost = async ({ env, request, data }) => {
  const stop = guard(data); if (stop) return stop;
  const actor = data.user;
  const body = await request.json().catch(() => ({}));
  const op = body.op;
  const ts = now();

  try {
    return await run(env, actor, body, op, ts);
  } catch (e) {
    // Most failures here are unique-constraint hits on a slug.
    const msg = String(e && e.message || e);
    if (msg.includes('UNIQUE')) return bad('That slug is already used in the same place. Pick another.');
    return bad('Could not save: ' + msg, 500);
  }
};

async function run(env, actor, body, op, ts) {
  const DB = env.DB;

  const log = (target, meta) => audit(env, actor, op, target, meta);

  switch (op) {
    // ------------------------------------------------------------ users
    case 'user.update': {
      const fields = ['name', 'role', 'status', 'plan', 'notes'];
      const set = [], vals = [];
      fields.forEach((f) => {
        if (body[f] !== undefined) { set.push(f + ' = ?' + (vals.length + 1)); vals.push(body[f]); }
      });
      if (!set.length) return bad('Nothing to change.');
      if (body.id === actor.id && body.role && body.role !== 'admin') {
        return bad('You cannot remove your own admin role.');
      }
      vals.push(body.id);
      await DB.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
      if (body.status === 'suspended') {
        await DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(body.id).run();
      }
      await log(body.id, body);
      return json({ ok: true });
    }

    case 'user.reset_password': {
      const pwd = String(body.password || '');
      if (pwd.length < 8) return bad('Temporary password must be at least 8 characters.');
      const { hash, salt } = await hashPassword(pwd);
      await DB.prepare('UPDATE users SET password_hash=?1, salt=?2 WHERE id=?3')
        .bind(hash, salt, body.id).run();
      await DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(body.id).run();
      await log(body.id);
      return json({ ok: true, message: 'Password reset. Share the temporary password with the user.' });
    }

    case 'user.delete': {
      if (body.id === actor.id) return bad('You cannot delete your own account.');
      await DB.prepare('DELETE FROM users WHERE id = ?1').bind(body.id).run();
      await log(body.id);
      return json({ ok: true });
    }

    case 'grant.add': {
      await DB.prepare(
        `INSERT OR REPLACE INTO grants (id,user_id,scope_type,scope_id,granted_by,granted_at,expires_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)`
      ).bind(id('grt'), body.user_id, body.scope_type, body.scope_id, actor.id, ts, body.expires_at || null).run();
      await log(body.user_id, { scope: body.scope_type + ':' + body.scope_id });
      return json({ ok: true });
    }

    case 'grant.remove': {
      await DB.prepare('DELETE FROM grants WHERE user_id=?1 AND scope_type=?2 AND scope_id=?3')
        .bind(body.user_id, body.scope_type, body.scope_id).run();
      await log(body.user_id, { scope: body.scope_type + ':' + body.scope_id });
      return json({ ok: true });
    }

    // --------------------------------------------------------- sections
    case 'section.save': {
      const rec = {
        id: body.id || id('sec'),
        parent_id: body.parent_id || null,
        slug: slugify(body.slug || body.title),
        title: String(body.title || '').trim(),
        tagline: body.tagline || null,
        description: body.description || null,
        icon: body.icon || 'grid',
        access_level: body.access_level || 'public',
        required_plan: body.required_plan || 'free',
        sort_order: Number(body.sort_order || 0),
        is_published: body.is_published ? 1 : 0
      };
      if (!rec.title) return bad('Give the section a title.');
      if (!rec.slug) return bad('Give the section a URL slug.');
      if (rec.parent_id === rec.id) return bad('A section cannot be its own parent.');
      await DB.prepare(
        `INSERT INTO sections (id,parent_id,slug,title,tagline,description,icon,access_level,required_plan,sort_order,is_published,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(id) DO UPDATE SET parent_id=?2,slug=?3,title=?4,tagline=?5,description=?6,icon=?7,
           access_level=?8,required_plan=?9,sort_order=?10,is_published=?11,updated_at=?12`
      ).bind(rec.id, rec.parent_id, rec.slug, rec.title, rec.tagline, rec.description, rec.icon,
        rec.access_level, rec.required_plan, rec.sort_order, rec.is_published, ts).run();
      await log(rec.id, { title: rec.title });
      return json({ ok: true, id: rec.id });
    }

    case 'section.delete': {
      const kids = await DB.prepare('SELECT COUNT(*) AS n FROM sections WHERE parent_id = ?1').bind(body.id).first();
      const items = await DB.prepare('SELECT COUNT(*) AS n FROM items WHERE section_id = ?1').bind(body.id).first();
      if ((kids.n || 0) + (items.n || 0) > 0 && !body.force) {
        return bad('This section still holds ' + kids.n + ' subsection(s) and ' + items.n +
          ' item(s). Move them first, or confirm a forced delete.');
      }
      await DB.prepare('DELETE FROM sections WHERE id = ?1').bind(body.id).run();
      await log(body.id);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ items
    case 'item.save': {
      const rec = {
        id: body.id || id('itm'),
        section_id: body.section_id,
        slug: slugify(body.slug || body.title),
        title: String(body.title || '').trim(),
        description: body.description || null,
        kind: body.kind || 'tool',
        href: body.href || null,
        book_id: body.book_id || null,
        icon: body.icon || 'square',
        badge: body.badge || null,
        access_level: body.access_level || 'public',
        required_plan: body.required_plan || 'free',
        teaser: body.teaser || null,
        sort_order: Number(body.sort_order || 0),
        is_published: body.is_published ? 1 : 0
      };
      if (!rec.section_id) return bad('Choose a section for this item.');
      if (!rec.title) return bad('Give the item a title.');
      if (rec.kind === 'book' && !rec.book_id) return bad('Link a book, or change the item type.');
      if (rec.kind !== 'book' && !rec.href) return bad('Give the item a link, or change the item type.');
      await DB.prepare(
        `INSERT INTO items (id,section_id,slug,title,description,kind,href,book_id,icon,badge,access_level,required_plan,teaser,sort_order,is_published,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
         ON CONFLICT(id) DO UPDATE SET section_id=?2,slug=?3,title=?4,description=?5,kind=?6,href=?7,
           book_id=?8,icon=?9,badge=?10,access_level=?11,required_plan=?12,teaser=?13,sort_order=?14,
           is_published=?15,updated_at=?16`
      ).bind(rec.id, rec.section_id, rec.slug, rec.title, rec.description, rec.kind, rec.href, rec.book_id,
        rec.icon, rec.badge, rec.access_level, rec.required_plan, rec.teaser, rec.sort_order,
        rec.is_published, ts).run();
      await log(rec.id, { title: rec.title });
      return json({ ok: true, id: rec.id });
    }

    case 'item.delete': {
      await DB.prepare('DELETE FROM items WHERE id = ?1').bind(body.id).run();
      await log(body.id);
      return json({ ok: true });
    }

    case 'reorder': {
      // body.table = 'sections' | 'items' | 'chapters', body.order = [id, ...]
      const table = ['sections', 'items', 'chapters'].includes(body.table) ? body.table : null;
      if (!table) return bad('Unknown list.');
      const stmts = (body.order || []).map((rowId, i) =>
        DB.prepare(`UPDATE ${table} SET sort_order = ?1 WHERE id = ?2`).bind(i + 1, rowId));
      if (stmts.length) await DB.batch(stmts);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ books
    case 'book.save': {
      const rec = {
        id: body.id || id('bk'),
        slug: slugify(body.slug || body.title),
        title: String(body.title || '').trim(),
        subtitle: body.subtitle || null,
        author: body.author || null,
        cover_url: body.cover_url || null,
        description: body.description || null,
        access_level: body.access_level || 'public',
        required_plan: body.required_plan || 'free',
        status: body.status === 'published' ? 'published' : 'draft'
      };
      if (!rec.title) return bad('Give the book a title.');
      await DB.prepare(
        `INSERT INTO books (id,slug,title,subtitle,author,cover_url,description,access_level,required_plan,status,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(id) DO UPDATE SET slug=?2,title=?3,subtitle=?4,author=?5,cover_url=?6,description=?7,
           access_level=?8,required_plan=?9,status=?10,updated_at=?11`
      ).bind(rec.id, rec.slug, rec.title, rec.subtitle, rec.author, rec.cover_url, rec.description,
        rec.access_level, rec.required_plan, rec.status, ts).run();
      await log(rec.id, { title: rec.title, status: rec.status });
      return json({ ok: true, id: rec.id, slug: rec.slug });
    }

    case 'book.delete': {
      await DB.prepare('DELETE FROM books WHERE id = ?1').bind(body.id).run();
      await log(body.id);
      return json({ ok: true });
    }

    case 'chapter.save': {
      const rec = {
        id: body.id || id('ch'),
        book_id: body.book_id,
        slug: slugify(body.slug || body.title),
        title: String(body.title || '').trim(),
        summary: body.summary || null,
        access_level: body.access_level || 'inherit',
        sort_order: Number(body.sort_order || 0),
        is_published: body.is_published ? 1 : 0
      };
      if (!rec.book_id) return bad('Chapters need a book.');
      if (!rec.title) return bad('Give the chapter a title.');
      await DB.prepare(
        `INSERT INTO chapters (id,book_id,slug,title,summary,access_level,sort_order,is_published,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET book_id=?2,slug=?3,title=?4,summary=?5,access_level=?6,
           sort_order=?7,is_published=?8,updated_at=?9`
      ).bind(rec.id, rec.book_id, rec.slug, rec.title, rec.summary, rec.access_level,
        rec.sort_order, rec.is_published, ts).run();
      await log(rec.id, { title: rec.title });
      return json({ ok: true, id: rec.id });
    }

    case 'chapter.delete': {
      await DB.prepare('DELETE FROM chapters WHERE id = ?1').bind(body.id).run();
      await log(body.id);
      return json({ ok: true });
    }

    case 'blocks.save': {
      // The editor sends the whole chapter body; replace it in one transaction.
      const chapterId = body.chapter_id;
      if (!chapterId) return bad('Missing chapter.');
      const blocks = Array.isArray(body.blocks) ? body.blocks : [];
      const stmts = [DB.prepare('DELETE FROM blocks WHERE chapter_id = ?1').bind(chapterId)];
      blocks.forEach((b, i) => {
        stmts.push(DB.prepare(
          'INSERT INTO blocks (id,chapter_id,type,data,sort_order) VALUES (?1,?2,?3,?4,?5)'
        ).bind(b.id || id('blk'), chapterId, b.type, JSON.stringify(b.data || {}), i + 1));
      });
      stmts.push(DB.prepare('UPDATE chapters SET updated_at = ?1, source_md = ?2 WHERE id = ?3')
        .bind(ts, typeof body.source_md === 'string' ? body.source_md : null, chapterId));
      await DB.batch(stmts);
      await log(chapterId, { blocks: blocks.length });
      return json({ ok: true, count: blocks.length });
    }

    // --------------------------------------------------------- settings
    case 'settings.save': {
      const entries = Object.entries(body.settings || {});
      if (!entries.length) return bad('Nothing to save.');
      await DB.batch(entries.map(([k, v]) =>
        DB.prepare('INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2')
          .bind(k, String(v))));
      await log('settings', body.settings);
      return json({ ok: true });
    }

    default:
      return bad('Unknown operation: ' + op, 400);
  }
}
