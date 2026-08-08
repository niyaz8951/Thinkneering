/* Thinkneering — admin.js
   Panels: Overview, People, Catalogue, Books, Settings, Activity. */
(function () {
  'use strict';
  var esc = TN.esc, icon = TN.icon, el = TN.el;

  var PANELS = [
    { key: 'overview', label: 'Overview',  icon: 'activity' },
    { key: 'users',    label: 'People',    icon: 'users' },
    { key: 'catalog',  label: 'Catalogue', icon: 'layers' },
    { key: 'books',    label: 'Books',     icon: 'book-open' },
    { key: 'compliance', label: 'Compliance', icon: 'file-check' },
    { key: 'settings', label: 'Settings',  icon: 'settings' },
    { key: 'audit',    label: 'Activity',  icon: 'list' }
  ];

  var ACCESS_OPTS = [
    ['public', 'Free — anyone'],
    ['auth', 'Signed in'],
    ['restricted', 'Restricted — plan or grant']
  ];
  var PLAN_OPTS = [['free', 'Free'], ['member', 'Member'], ['pro', 'Pro']];

  var state = { panel: 'overview', catalog: null, users: null, book: null, chapter: null,
                blocks: [], md: '', editMode: 'markdown', dirty: false };

  // ------------------------------------------------------------ helpers
  function opt(list, value) {
    return list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  function field(label, inner, hint) {
    return '<div class="field"><label>' + esc(label) + '</label>' + inner +
      (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') + '</div>';
  }
  function post(body) { return TN.api('/api/admin/op', { method: 'POST', body: body }); }
  function get(path) { return TN.api('/api/admin/' + path); }

  var modal = el('#modal');
  function openModal(title, html, onSave) {
    el('#modal-title').textContent = title;
    el('#modal-body').innerHTML = html;
    el('#modal-save').onclick = async function () {
      try { await onSave(); modal.close(); }
      catch (err) { TN.toast(err.message, 'error'); }
    };
    el('#modal-cancel').onclick = function () { modal.close(); };
    modal.showModal();
  }
  function v(name) { var n = el('[name="' + name + '"]', el('#modal-body')); return n ? n.value : ''; }
  function chk(name) { var n = el('[name="' + name + '"]', el('#modal-body')); return !!(n && n.checked); }

  // ----------------------------------------------------------- overview
  async function renderOverview() {
    var d = await get('overview');
    var c = d.counts || {};
    var stats = [
      ['Accounts', c.users], ['Awaiting approval', c.pending], ['Suspended', c.suspended],
      ['Sections', c.sections], ['Items', c.items], ['Books', c.books], ['Live sessions', c.active_sessions]
    ].map(function (s) {
      return '<div class="stat"><div class="stat__value">' + (s[1] || 0) + '</div><div class="stat__label">' + esc(s[0]) + '</div></div>';
    }).join('');

    var chart = TNBlocks.chartSVG({
      chartType: 'line',
      labels: (d.daily || []).map(function (r) { return r.day.slice(5); }),
      values: (d.daily || []).map(function (r) { return r.n; })
    });

    var listOf = function (rows, emptyText) {
      if (!rows || !rows.length) return '<div class="empty">' + esc(emptyText) + '</div>';
      return '<div class="table-wrap"><table class="data"><tbody>' + rows.map(function (r) {
        return '<tr><td>' + esc(r.target || '—') + '</td><td class="num">' + r.n + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    };

    var pending = (d.recent || []).filter(function (u) { return u.status === 'pending'; });

    return '<div class="page-head"><p class="eyebrow">Admin</p><h1>Overview</h1>' +
      '<p>Who is here, what they open, and what they are being turned away from.</p></div>' +
      (pending.length
        ? '<div class="notice notice--warning" style="margin-bottom:var(--space-4)">' + icon('users', 18) +
          '<div><strong>' + pending.length + ' account(s) waiting for approval.</strong><br>' +
          '<button class="btn btn--sm btn--ghost" data-go="users" style="margin-top:var(--space-2)">Review in People</button></div></div>'
        : '') +
      '<div class="stat-grid">' + stats + '</div>' +
      '<div class="panel" style="margin-top:var(--space-4)"><h2>Activity, last 7 days</h2>' + chart + '</div>' +
      '<div class="grid" style="margin-top:var(--space-4)">' +
      '<div class="panel"><h2>Most opened, 30 days</h2>' + listOf(d.top, 'No activity recorded yet.') + '</div>' +
      '<div class="panel"><h2>Blocked at the lock, 30 days</h2>' +
      '<p class="hint">What free visitors tried to open. This is your upgrade list.</p>' +
      listOf(d.denied, 'Nobody has hit a lock yet.') + '</div></div>';
  }

  // -------------------------------------------------------------- users
  async function renderUsers() {
    var d = await get('users?q=' + encodeURIComponent(state.userQ || '') +
      '&status=' + encodeURIComponent(state.userStatus || ''));
    state.users = d.users;
    state.grants = d.grants;

    var rows = d.users.map(function (u) {
      var g = d.grants.filter(function (x) { return x.user_id === u.id; }).length;
      var statusChip = { active: 'chip--free', pending: 'chip--auth', suspended: 'chip--danger' }[u.status] || '';
      return '<tr>' +
        '<td><strong>' + esc(u.name || '—') + '</strong><br><span class="muted">' + esc(u.email) + '</span></td>' +
        '<td><span class="chip ' + statusChip + '">' + esc(u.status) + '</span></td>' +
        '<td>' + esc(u.plan) + '</td><td>' + esc(u.role) + '</td>' +
        '<td class="num">' + g + '</td>' +
        '<td class="num">' + esc((u.last_login_at || '').slice(0, 10) || 'never') + '</td>' +
        '<td><div class="row-actions">' +
        (u.status === 'pending' ? '<button class="btn btn--sm btn--primary" data-approve="' + u.id + '">Approve</button>' : '') +
        '<button class="btn btn--sm btn--ghost" data-edit-user="' + u.id + '">Edit</button>' +
        '<button class="btn btn--sm btn--ghost" data-grants="' + u.id + '">Access</button>' +
        '</div></td></tr>';
    }).join('');

    return '<div class="page-head"><p class="eyebrow">Admin</p><h1>People</h1>' +
      '<p>Approve accounts, set plans, and unlock individual sections or tools.</p></div>' +
      '<div class="toolbar">' +
      '<input type="search" id="user-q" placeholder="Search name or email" value="' + esc(state.userQ || '') + '" aria-label="Search people">' +
      '<select id="user-status" aria-label="Filter by status">' +
      opt([['', 'All statuses'], ['pending', 'Pending'], ['active', 'Active'], ['suspended', 'Suspended']], state.userStatus || '') +
      '</select></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Person</th><th>Status</th><th>Plan</th><th>Role</th><th class="num">Grants</th><th class="num">Last seen</th><th>Actions</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="7">No accounts match.</td></tr>') + '</tbody></table></div>';
  }

  function editUser(id) {
    var u = state.users.find(function (x) { return x.id === id; });
    openModal('Edit ' + (u.name || u.email),
      field('Name', '<input name="name" type="text" value="' + esc(u.name || '') + '">') +
      field('Status', '<select name="status">' + opt([['pending', 'Pending'], ['active', 'Active'], ['suspended', 'Suspended']], u.status) + '</select>',
        'Suspending signs the person out everywhere.') +
      field('Plan', '<select name="plan">' + opt(PLAN_OPTS, u.plan) + '</select>',
        'Plan opens restricted content that asks for this level or lower.') +
      field('Role', '<select name="role">' + opt([['user', 'User'], ['editor', 'Editor'], ['admin', 'Admin']], u.role) + '</select>') +
      field('Internal note', '<textarea name="notes">' + esc(u.notes || '') + '</textarea>') +
      '<div class="modal__actions" style="justify-content:flex-start">' +
      '<button class="btn btn--sm btn--ghost" id="reset-pw" type="button">Set temporary password</button>' +
      '<button class="btn btn--sm btn--danger" id="del-user" type="button">Delete account</button></div>',
      async function () {
        await post({ op: 'user.update', id: id, name: v('name'), status: v('status'), plan: v('plan'), role: v('role'), notes: v('notes') });
        TN.toast('Saved', 'success');
        show('users');
      });

    el('#reset-pw').onclick = async function () {
      var pwd = prompt('Temporary password (at least 8 characters):');
      if (!pwd) return;
      try { var r = await post({ op: 'user.reset_password', id: id, password: pwd }); TN.toast(r.message, 'success'); }
      catch (e) { TN.toast(e.message, 'error'); }
    };
    el('#del-user').onclick = async function () {
      if (!confirm('Delete this account permanently? Their sessions and grants go too.')) return;
      try { await post({ op: 'user.delete', id: id }); modal.close(); TN.toast('Account deleted'); show('users'); }
      catch (e) { TN.toast(e.message, 'error'); }
    };
  }

  async function editGrants(userId) {
    if (!state.catalog) state.catalog = await get('catalog');
    var books = (await get('books')).books;
    var mine = state.grants.filter(function (g) { return g.user_id === userId; });
    var key = function (t, i) { return t + ':' + i; };
    var have = new Set(mine.map(function (g) { return key(g.scope_type, g.scope_id); }));

    var rows = []
      .concat(state.catalog.sections.map(function (s) { return { t: 'section', id: s.id, label: 'Section — ' + s.title }; }))
      .concat(state.catalog.items.map(function (i) { return { t: 'item', id: i.id, label: 'Item — ' + i.title }; }))
      .concat(books.map(function (b) { return { t: 'book', id: b.id, label: 'Book — ' + b.title }; }));

    openModal('Unlock content for this person',
      '<p class="hint">A grant opens one restricted thing for one person, whatever their plan says.</p>' +
      '<div class="table-wrap" style="max-height:340px;overflow:auto"><table class="data"><tbody>' +
      rows.map(function (r) {
        var on = have.has(key(r.t, r.id));
        return '<tr><td>' + esc(r.label) + '</td><td style="width:110px">' +
          '<button class="btn btn--sm ' + (on ? 'btn--primary' : 'btn--ghost') + '" data-grant="' +
          r.t + '|' + r.id + '|' + (on ? 'off' : 'on') + '">' + (on ? 'Granted' : 'Grant') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>',
      async function () { show('users'); });

    el('#modal-body').onclick = async function (ev) {
      var btn = ev.target.closest('[data-grant]');
      if (!btn) return;
      var p = btn.getAttribute('data-grant').split('|');
      try {
        await post({ op: p[2] === 'on' ? 'grant.add' : 'grant.remove', user_id: userId, scope_type: p[0], scope_id: p[1] });
        state.grants = (await get('users')).grants;
        modal.close();
        editGrants(userId);
      } catch (e) { TN.toast(e.message, 'error'); }
    };
  }

  // ------------------------------------------------------------ catalog
  async function renderCatalog() {
    var d = await get('catalog');
    state.catalog = d;
    var byParent = function (pid) {
      return d.sections.filter(function (s) { return (s.parent_id || null) === pid; })
        .sort(function (a, b) { return a.sort_order - b.sort_order; });
    };
    var accessChip = function (o) {
      var cls = { public: 'chip--free', auth: 'chip--auth', restricted: 'chip--restricted' }[o.access_level] || '';
      return '<span class="chip ' + cls + '">' + esc(o.access_level) +
        (o.required_plan && o.required_plan !== 'free' ? ' · ' + esc(o.required_plan) : '') + '</span>';
    };
    var itemsOf = function (sid) {
      return d.items.filter(function (i) { return i.section_id === sid; })
        .sort(function (a, b) { return a.sort_order - b.sort_order; })
        .map(function (i) {
          return '<div class="tree-row tree-row--child"><div class="tree-row__main">' +
            '<span class="tree-row__title">' + esc(i.title) + '</span> ' +
            '<span class="chip">' + esc(i.kind) + '</span> ' + accessChip(i) +
            (i.is_published ? '' : ' <span class="chip chip--danger">hidden</span>') +
            '</div><div class="row-actions">' +
            '<button class="btn btn--sm btn--ghost" data-edit-item="' + i.id + '">' + icon('edit', 16) + '</button>' +
            '<button class="btn btn--sm btn--danger" data-del-item="' + i.id + '">' + icon('trash', 16) + '</button>' +
            '</div></div>';
        }).join('');
    };

    var html = byParent(null).map(function (s) {
      var children = byParent(s.id);
      return '<div class="panel" style="padding:0;margin-bottom:var(--space-3)">' +
        '<div class="tree-row"><span class="card__icon">' + icon(s.icon, 18) + '</span>' +
        '<div class="tree-row__main"><span class="tree-row__title">' + esc(s.title) + '</span> ' +
        '<span class="chip">/s/' + esc(s.slug) + '</span> ' + accessChip(s) +
        (s.is_published ? '' : ' <span class="chip chip--danger">hidden</span>') + '</div>' +
        '<div class="row-actions">' +
        '<button class="btn btn--sm btn--ghost" data-add-item="' + s.id + '">' + icon('plus', 16) + ' Item</button>' +
        '<button class="btn btn--sm btn--ghost" data-add-sub="' + s.id + '">' + icon('plus', 16) + ' Subsection</button>' +
        '<button class="btn btn--sm btn--ghost" data-edit-sec="' + s.id + '">' + icon('edit', 16) + '</button>' +
        '<button class="btn btn--sm btn--danger" data-del-sec="' + s.id + '">' + icon('trash', 16) + '</button>' +
        '</div></div>' + itemsOf(s.id) +
        children.map(function (c) {
          return '<div class="tree-row tree-row--child"><div class="tree-row__main">' +
            '<span class="tree-row__title">' + esc(c.title) + '</span> ' +
            '<span class="chip">/s/' + esc(s.slug) + '/' + esc(c.slug) + '</span> ' + accessChip(c) +
            (c.is_published ? '' : ' <span class="chip chip--danger">hidden</span>') + '</div>' +
            '<div class="row-actions">' +
            '<button class="btn btn--sm btn--ghost" data-add-item="' + c.id + '">' + icon('plus', 16) + '</button>' +
            '<button class="btn btn--sm btn--ghost" data-edit-sec="' + c.id + '">' + icon('edit', 16) + '</button>' +
            '<button class="btn btn--sm btn--danger" data-del-sec="' + c.id + '">' + icon('trash', 16) + '</button>' +
            '</div></div>' + itemsOf(c.id);
        }).join('') +
        '</div>';
    }).join('');

    return '<div class="page-head"><p class="eyebrow">Admin</p><h1>Catalogue</h1>' +
      '<p>Sections, subsections and the tools inside them. Access set here is what visitors actually get — a section always wins over a looser item.</p></div>' +
      '<div class="toolbar"><button class="btn btn--primary btn--sm" data-add-sec>' + icon('plus', 16) + ' New section</button></div>' +
      (html || '<div class="empty">No sections yet.</div>');
  }

  function sectionForm(s, parentId) {
    s = s || {};
    return field('Title', '<input name="title" type="text" value="' + esc(s.title || '') + '">') +
      field('URL slug', '<input name="slug" type="text" value="' + esc(s.slug || '') + '">', 'Lower case, dashes. Becomes /s/slug.') +
      field('Tagline', '<input name="tagline" type="text" value="' + esc(s.tagline || '') + '">') +
      field('Description', '<textarea name="description">' + esc(s.description || '') + '</textarea>') +
      field('Icon', '<input name="icon" type="text" value="' + esc(s.icon || 'grid') + '">', 'Key from the shared icon set, e.g. grid, wind, book-open.') +
      field('Who can open it', '<select name="access_level">' + opt(ACCESS_OPTS, s.access_level || 'public') + '</select>') +
      field('Plan needed', '<select name="required_plan">' + opt(PLAN_OPTS, s.required_plan || 'free') + '</select>') +
      field('Order', '<input name="sort_order" type="number" value="' + (s.sort_order || 0) + '">') +
      '<label style="display:flex;gap:var(--space-2);align-items:center"><input name="is_published" type="checkbox"' +
      (s.id === undefined || s.is_published ? ' checked' : '') + '> Published</label>' +
      '<input type="hidden" name="parent_id" value="' + esc(parentId || s.parent_id || '') + '">';
  }

  function itemForm(i, sectionId, books) {
    i = i || {};
    return field('Title', '<input name="title" type="text" value="' + esc(i.title || '') + '">') +
      field('Slug', '<input name="slug" type="text" value="' + esc(i.slug || '') + '">') +
      field('Description', '<textarea name="description">' + esc(i.description || '') + '</textarea>') +
      field('Type', '<select name="kind">' + opt([['tool', 'Tool'], ['book', 'Book'], ['link', 'Link'], ['page', 'Page']], i.kind || 'tool') + '</select>') +
      field('Link', '<input name="href" type="text" value="' + esc(i.href || '') + '">', 'For tools, pages and links, e.g. /tools/word-counter/') +
      field('Book', '<select name="book_id"><option value="">— none —</option>' +
        opt(books.map(function (b) { return [b.id, b.title]; }), i.book_id || '') + '</select>', 'Only used when the type is Book.') +
      field('Icon', '<input name="icon" type="text" value="' + esc(i.icon || 'square') + '">') +
      field('Badge', '<input name="badge" type="text" value="' + esc(i.badge || '') + '">', 'Small label such as New, Beta, Pro.') +
      field('Who can open it', '<select name="access_level">' + opt(ACCESS_OPTS, i.access_level || 'public') + '</select>') +
      field('Plan needed', '<select name="required_plan">' + opt(PLAN_OPTS, i.required_plan || 'free') + '</select>') +
      field('Locked-card message', '<textarea name="teaser">' + esc(i.teaser || '') + '</textarea>',
        'Shown instead of the description when someone cannot open it.') +
      field('Order', '<input name="sort_order" type="number" value="' + (i.sort_order || 0) + '">') +
      '<label style="display:flex;gap:var(--space-2);align-items:center"><input name="is_published" type="checkbox"' +
      (i.id === undefined || i.is_published ? ' checked' : '') + '> Published</label>' +
      '<input type="hidden" name="section_id" value="' + esc(sectionId || i.section_id || '') + '">';
  }

  function collect(extra) {
    return Object.assign({
      title: v('title'), slug: v('slug'), description: v('description'), icon: v('icon'),
      access_level: v('access_level'), required_plan: v('required_plan'),
      sort_order: v('sort_order'), is_published: chk('is_published')
    }, extra);
  }

  // -------------------------------------------------------------- books
  async function renderBooks() {
    if (state.chapter) return renderEditor();
    if (state.book) return renderBook();
    var d = await get('books');
    var rows = d.books.map(function (b) {
      return '<div class="tree-row"><span class="card__icon">' + icon('book-open', 18) + '</span>' +
        '<div class="tree-row__main"><span class="tree-row__title">' + esc(b.title) + '</span> ' +
        '<span class="chip ' + (b.status === 'published' ? 'chip--free' : 'chip--auth') + '">' + esc(b.status) + '</span> ' +
        '<span class="chip">/read/' + esc(b.slug) + '</span></div>' +
        '<div class="row-actions">' +
        '<button class="btn btn--sm btn--primary" data-open-book="' + b.id + '">Open</button>' +
        '<button class="btn btn--sm btn--ghost" data-edit-book="' + b.id + '">' + icon('edit', 16) + '</button>' +
        '</div></div>';
    }).join('');
    return '<div class="page-head"><p class="eyebrow">Admin</p><h1>Books</h1>' +
      '<p>Write chapters as blocks — text, images, tables and charts. Readers see the same blocks, without the editing chrome.</p></div>' +
      '<div class="toolbar"><button class="btn btn--primary btn--sm" data-add-book>' + icon('plus', 16) + ' New book</button></div>' +
      '<div class="panel" style="padding:0">' + (rows || '<div class="empty">No books yet.</div>') + '</div>';
  }

  async function renderBook() {
    var d = await get('books/' + state.book);
    state.bookData = d.book;
    var rows = d.chapters.map(function (c) {
      return '<div class="tree-row"><div class="tree-row__main">' +
        '<span class="tree-row__title">' + esc(c.title) + '</span> ' +
        '<span class="chip">' + esc(c.access_level) + '</span>' +
        (c.is_published ? '' : ' <span class="chip chip--danger">hidden</span>') + '</div>' +
        '<div class="row-actions">' +
        '<button class="btn btn--sm btn--primary" data-open-chapter="' + c.id + '">Write</button>' +
        '<button class="btn btn--sm btn--ghost" data-edit-chapter="' + c.id + '">' + icon('edit', 16) + '</button>' +
        '<button class="btn btn--sm btn--danger" data-del-chapter="' + c.id + '">' + icon('trash', 16) + '</button>' +
        '</div></div>';
    }).join('');
    return '<div class="page-head"><p class="eyebrow"><button class="btn btn--sm btn--quiet" data-back-books>← All books</button></p>' +
      '<h1>' + esc(d.book.title) + '</h1><p>' + esc(d.book.subtitle || '') + '</p></div>' +
      '<div class="toolbar">' +
      '<button class="btn btn--primary btn--sm" data-add-chapter>' + icon('plus', 16) + ' New chapter</button>' +
      '<button class="btn btn--ghost btn--sm" data-edit-book="' + d.book.id + '">Book details</button>' +
      '<a class="btn btn--ghost btn--sm" href="/read/' + esc(d.book.slug) + '" target="_blank" rel="noopener">' + icon('eye', 16) + ' Reader view</a>' +
      '</div><div class="panel" style="padding:0">' + (rows || '<div class="empty">No chapters yet.</div>') + '</div>';
  }

  // -------------------------------------------------- block editor
  async function renderEditor() {
    var d = await get('chapter/' + state.chapter);
    state.blocks = d.blocks;
    state.chapterData = d.chapter;
    // Prefer what the writer typed; fall back to text rebuilt from blocks for
    // chapters that predate the markdown editor (or were imported as SQL).
    state.md = (d.chapter.source_md != null && d.chapter.source_md !== '')
      ? d.chapter.source_md
      : TNMarkdown.serialize(d.blocks);
    state.dirty = false;
    return editorHTML();
  }

  function markDirty() {
    state.dirty = true;
    var n = el('#save-state');
    if (n) { n.textContent = 'Unsaved changes'; n.className = 'chip chip--auth'; }
    clearTimeout(state.autosave);
    state.autosave = setTimeout(saveChapter, 4000);   // autosave after a pause
  }

  async function saveChapter() {
    clearTimeout(state.autosave);
    if (!state.chapter) return;
    var n = el('#save-state');
    if (n) { n.textContent = 'Saving…'; n.className = 'chip'; }
    try {
      if (state.editMode !== 'blocks') state.blocks = TNMarkdown.parse(state.md);
      else state.md = TNMarkdown.serialize(state.blocks);
      await post({ op: 'blocks.save', chapter_id: state.chapter, blocks: state.blocks, source_md: state.md });
      state.dirty = false;
      if (n) { n.textContent = 'Saved ' + new Date().toLocaleTimeString(); n.className = 'chip chip--free'; }
    } catch (e) {
      if (n) { n.textContent = 'Not saved'; n.className = 'chip chip--danger'; }
      TN.toast(e.message, 'error');
    }
  }

  function blockFields(b, i) {
    var d = b.data || {};
    var t = function (name, label, value, rows) {
      return '<label class="label">' + esc(label) + '</label><textarea data-bi="' + i + '" data-bk="' + name + '"' +
        (rows ? ' style="min-height:' + rows + 'px"' : '') + '>' + esc(value || '') + '</textarea>';
    };
    var inp = function (name, label, value) {
      return '<label class="label">' + esc(label) + '</label><input type="text" data-bi="' + i + '" data-bk="' + name + '" value="' + esc(value || '') + '">';
    };
    switch (b.type) {
      case 'heading': return inp('text', 'Heading text', d.text) +
        '<label class="label">Level</label><select data-bi="' + i + '" data-bk="level">' + opt([['2', 'H2'], ['3', 'H3']], String(d.level || 2)) + '</select>';
      case 'text': return t('text', 'Paragraphs', d.text, 140);
      case 'image': return inp('url', 'Image URL', d.url) + inp('alt', 'Alt text', d.alt) + inp('caption', 'Caption', d.caption);
      case 'table': return inp('caption', 'Caption', d.caption) +
        t('headersCsv', 'Header row (comma separated)', (d.headers || []).join(', ')) +
        t('rowsTsv', 'Rows (one per line, cells separated by |)', (d.rows || []).map(function (r) { return r.join(' | '); }).join('\n'), 120);
      case 'chart': return '<label class="label">Chart type</label><select data-bi="' + i + '" data-bk="chartType">' +
        opt([['bar', 'Bar'], ['line', 'Line']], d.chartType || 'bar') + '</select>' +
        inp('title', 'Title', d.title) + inp('unit', 'Unit', d.unit) +
        t('labelsCsv', 'Labels (comma separated)', (d.labels || []).join(', ')) +
        t('valuesCsv', 'Values (comma separated)', (d.values || []).join(', '));
      case 'list': return '<label class="label">Style</label><select data-bi="' + i + '" data-bk="ordered">' +
        opt([['false', 'Bulleted'], ['true', 'Numbered']], String(!!d.ordered)) + '</select>' +
        t('itemsLines', 'Items (one per line)', (d.items || []).join('\n'));
      case 'callout': return '<label class="label">Tone</label><select data-bi="' + i + '" data-bk="tone">' +
        opt([['info', 'Info'], ['success', 'Success'], ['warning', 'Warning'], ['danger', 'Danger']], d.tone || 'info') + '</select>' +
        inp('title', 'Title', d.title) + t('text', 'Text', d.text);
      case 'quote': return t('text', 'Quote', d.text) + inp('cite', 'Attribution', d.cite);
      case 'code': return t('text', 'Code', d.text, 140);
      default: return '<p class="hint">Nothing to configure.</p>';
    }
  }

  function editorHTML() {
    if (state.editMode === 'blocks') return blocksEditorHTML();
    return shellHTML(
      '<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
      '<div><p class="eyebrow">Markdown</p>' +
      '<textarea id="md" class="md-input" spellcheck="true" ' +
      'aria-label="Chapter text in markdown">' + esc(state.md) + '</textarea>' +
      '<p class="hint">' + esc('## heading  ·  > quote  ·  - list  ·  --- divider  ·  ' +
        '*italic*  **bold**  ·  ![alt](url "caption")  ·  | tables |  ·  ```chart') + '</p></div>' +
      '<div><p class="eyebrow">Reader preview</p>' +
      '<div class="reader__body panel" id="preview">' + TNBlocks.render(TNMarkdown.parse(state.md)) +
      '</div></div></div>');
  }

  function shellHTML(inner) {
    return '<div class="page-head"><p class="eyebrow">' +
      '<button class="btn btn--sm btn--quiet" data-back-book>← Chapters</button></p>' +
      '<h1>' + esc(state.chapterData.title) + '</h1></div>' +
      '<div class="toolbar">' +
      '<div class="segmented" role="group" aria-label="Editing mode">' +
      '<button type="button" data-edit-mode="markdown" aria-pressed="' + (state.editMode !== 'blocks') + '">Write</button>' +
      '<button type="button" data-edit-mode="blocks" aria-pressed="' + (state.editMode === 'blocks') + '">Blocks</button>' +
      '</div>' +
      '<button class="btn btn--primary btn--sm" data-save-blocks>Save chapter</button>' +
      '<span id="save-state" class="chip">Saved</span>' +
      '<a class="btn btn--ghost btn--sm" href="/read/' + esc(state.bookData ? state.bookData.slug : '') +
      '/' + esc(state.chapterData.slug) + '" target="_blank" rel="noopener">' + icon('eye', 16) + ' Reader view</a>' +
      '</div>' + inner;
  }

  function blocksEditorHTML() {
    var list = state.blocks.map(function (b, i) {
      return '<div class="panel" style="margin-bottom:var(--space-3)">' +
        '<div class="panel__head"><span class="chip">' + esc(b.type) + '</span>' +
        '<div class="row-actions">' +
        '<button class="btn btn--sm btn--quiet" data-mv="' + i + '|-1" aria-label="Move up">' + icon('up', 16) + '</button>' +
        '<button class="btn btn--sm btn--quiet" data-mv="' + i + '|1" aria-label="Move down">' + icon('down', 16) + '</button>' +
        '<button class="btn btn--sm btn--danger" data-rm="' + i + '" aria-label="Remove block">' + icon('trash', 16) + '</button>' +
        '</div></div>' + blockFields(b, i) + '</div>';
    }).join('');

    var adders = TNBlocks.TYPES.map(function (t) {
      return '<button class="btn btn--sm btn--ghost" data-add-block="' + t.type + '">' + esc(t.label) + '</button>';
    }).join('');

    return shellHTML(
      '<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">' +
      '<div><div class="toolbar" style="flex-wrap:wrap">' + adders + '</div>' +
      (list || '<div class="empty">Add your first block.</div>') + '</div>' +
      '<div><p class="eyebrow">Reader preview</p><div class="reader__body panel" id="preview">' +
      TNBlocks.render(state.blocks) + '</div></div></div>');
  }

  function syncBlockField(input) {
    var i = Number(input.getAttribute('data-bi'));
    var k = input.getAttribute('data-bk');
    var b = state.blocks[i];
    var val = input.value;
    if (k === 'headersCsv') b.data.headers = val.split(',').map(function (s) { return s.trim(); });
    else if (k === 'rowsTsv') b.data.rows = val.split('\n').filter(Boolean).map(function (r) { return r.split('|').map(function (c) { return c.trim(); }); });
    else if (k === 'labelsCsv') b.data.labels = val.split(',').map(function (s) { return s.trim(); });
    else if (k === 'valuesCsv') b.data.values = val.split(',').map(function (s) { return Number(s.trim()) || 0; });
    else if (k === 'itemsLines') b.data.items = val.split('\n').filter(function (s) { return s.length; });
    else if (k === 'ordered') b.data.ordered = val === 'true';
    else if (k === 'level') b.data.level = Number(val);
    else b.data[k] = val;
    var pv = el('#preview');
    if (pv) pv.innerHTML = TNBlocks.render(state.blocks);
    markDirty();
  }

  // ----------------------------------------------------------- settings
  async function renderSettings() {
    var d = await get('settings');
    var s = d.settings;
    return '<div class="page-head"><p class="eyebrow">Admin</p><h1>Settings</h1>' +
      '<p>Site-wide switches. Changes take effect on the next page load.</p></div>' +
      '<div class="panel" style="max-width:560px"><form id="settings-form">' +
      field('Who can create an account',
        '<select name="signup_mode">' + opt([['open', 'Anyone, active immediately'], ['approval', 'Anyone, but an admin approves'], ['closed', 'Nobody right now']], s.signup_mode) + '</select>') +
      field('Plan given to new accounts', '<select name="default_plan">' + opt(PLAN_OPTS, s.default_plan) + '</select>') +
      field('Site announcement', '<textarea name="announcement">' + esc(s.announcement || '') + '</textarea>',
        'Shown as a banner on every page. Leave empty to hide it.') +
      field('Maintenance mode', '<select name="maintenance">' + opt([['off', 'Off'], ['on', 'On — only admins can use the site']], s.maintenance) + '</select>') +
      field('AI features', '<select name="ai_features">' + opt([['on', 'On'], ['off', 'Off']], s.ai_features) + '</select>',
        'Turns off AI-backed tool modes for everyone, whatever their plan.') +
      '<button class="btn btn--primary" style="margin-top:var(--space-4)" type="submit">Save settings</button>' +
      '</form></div>';
  }

  async function renderAudit() {
    var d = await get('audit');
    var rows = d.entries.map(function (e) {
      return '<tr><td class="num">' + esc(e.created_at.replace('T', ' ').slice(0, 16)) + '</td>' +
        '<td>' + esc(e.actor_email || 'system') + '</td><td>' + esc(e.action) + '</td>' +
        '<td class="num">' + esc(e.target || '') + '</td></tr>';
    }).join('');
    return '<div class="page-head"><p class="eyebrow">Admin</p><h1>Activity</h1>' +
      '<p>Every change an admin makes, newest first.</p></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="4">Nothing logged yet.</td></tr>') + '</tbody></table></div>';
  }

  // -------------------------------------------------------------- shell
  // -------------------------------------------------------- compliance
  // The Compliance Maker's knowledge base. Nothing about a product is
  // hardcoded any more, so this is the only place it can be corrected —
  // and the only place a learned summary can be overruled.
  var comp = { product: 'AHU', factory: 'UAE', data: null };

  var FACT_STATUS = [['trusted', 'Trusted — used in prompts'],
                     ['draft', 'Draft — learned, not used yet'],
                     ['blocked', 'Blocked — never use']];

  function factRow(f) {
    return '<tr><td>' + esc(f.topic || '—') + '</td><td>' + esc(f.label) + '</td>' +
      '<td>' + esc(f.value) + '</td><td class="muted">' + esc(f.source || '—') + '</td>' +
      '<td><span class="chip' + (f.status === 'trusted' ? ' chip--free' : f.status === 'blocked' ? ' chip--danger' : '') +
      '">' + esc(f.status) + '</span></td>' +
      '<td class="row-actions"><button class="btn btn--quiet btn--sm" data-edit-fact="' + esc(f.id) + '">' +
      icon('edit', 16) + '</button><button class="btn btn--quiet btn--sm" data-del-fact="' + esc(f.id) + '">' +
      icon('trash', 16) + '</button></td></tr>';
  }

  function sectionRow(r) {
    return '<tr><td>' + esc(r.path_label || r.path_norm) + '</td>' +
      '<td>' + (r.summary ? esc(r.summary) : '<span class="muted">no summary yet</span>') +
      (r.summary_locked ? ' <span class="chip">edited</span>' : '') + '</td>' +
      '<td class="num">' + r.n_answers + '</td><td>' + esc(r.typical_status || '—') + '</td>' +
      '<td class="row-actions"><button class="btn btn--quiet btn--sm" data-edit-section="' + esc(r.id) + '">' +
      icon('edit', 16) + '</button></td></tr>';
  }

  async function renderCompliance() {
    var d = await get('compliance?product=' + encodeURIComponent(comp.product) +
                      '&factory=' + encodeURIComponent(comp.factory));
    comp.data = d;
    var factories = (d.pairs && d.pairs[comp.product]) || [];

    return '<div class="page-head"><p class="eyebrow">Admin</p><h1>Compliance knowledge</h1>' +
      '<p>What the AI knows about each product and factory. Facts are quoted as standard ' +
      'configuration; section profiles tell it what a part of the specification is about. ' +
      'Both are learned from confirmed answers — never from the AI\'s own suggestions.</p></div>' +

      '<div class="toolbar">' +
      '<select data-comp-product>' + opt(Object.keys(d.pairs || {}), comp.product) + '</select>' +
      '<select data-comp-factory>' + opt(factories, comp.factory) + '</select>' +
      '<button class="btn btn--ghost btn--sm" data-add-fact>' + icon('plus', 16) + ' Add fact</button>' +
      '<button class="btn btn--ghost btn--sm" data-rebuild-sections>' + icon('repeat', 16) + ' Rebuild sections</button>' +
      '<button class="btn btn--ghost btn--sm" data-summarize-sections>' + icon('sparkles', 16) + ' Write missing summaries</button>' +
      '</div>' +

      '<div class="section-block"><div class="section-block__head"><h2>Reference facts</h2>' +
      '<span class="muted">' + d.facts.length + '</span></div>' +
      (d.facts.length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Topic</th><th>Label</th>' +
          '<th>Value</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.facts.map(factRow).join('') + '</tbody></table></div>'
        : '<div class="empty">No facts on file. The AI will say so rather than invent — ' +
          'add what you can vouch for, or let confirmed answers fill this in.</div>') +
      '</div>' +

      (d.tally && (d.tally.accepted || d.tally.corrected || d.tally['new'])
        ? '<div class="section-block"><div class="section-block__head"><h2>Training so far</h2></div>' +
          '<div class="legend" style="margin-bottom:var(--space-3)">' +
          '<span class="chip">' + (d.tally.corrected || 0) + ' corrected</span>' +
          '<span class="chip">' + (d.tally.accepted || 0) + ' kept as suggested</span>' +
          '<span class="chip">' + (d.tally['new'] || 0) + ' new clauses</span></div>' +
          (d.feedback.length
            ? '<div class="table-wrap"><table class="data"><thead><tr><th>Clause</th>' +
              '<th>AI said</th><th>Shipped</th></tr></thead><tbody>' +
              d.feedback.map(function (f) {
                return '<tr><td>' + esc(String(f.spec_text).slice(0, 160)) + '</td>' +
                  '<td class="muted">' + esc(f.ai_status) + (f.ai_remarks ? ' — ' + esc(String(f.ai_remarks).slice(0, 80)) : '') + '</td>' +
                  '<td>' + esc(f.final_status) + (f.final_remarks ? ' — ' + esc(String(f.final_remarks).slice(0, 80)) : '') + '</td></tr>';
              }).join('') + '</tbody></table></div>' +
              '<p class="hint">A clause corrected again and again usually means a missing or wrong fact above.</p>'
            : '') +
          '</div>'
        : '') +

      '<div class="section-block"><div class="section-block__head"><h2>Comparison rules</h2>' +
      '<button class="btn btn--ghost btn--sm" data-add-crit>' + icon('plus', 16) + ' Add rule</button></div>' +
      '<p class="muted" style="margin-bottom:var(--space-3)">Which way is better. 62 mm of insulation ' +
      'where 50 mm was asked for is a better panel, not a deviation — and TB2 beats TB3 even though the ' +
      'number is smaller. Anything not listed here uses a built-in engineering default; add a rule to ' +
      'override one.</p>' +
      ((d.criteria || []).length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Criterion</th><th>Better when</th>' +
          '<th>Unit</th><th>Class scale</th><th></th></tr></thead><tbody>' +
          d.criteria.map(criterionRow).join('') + '</tbody></table></div>'
        : '<div class="empty">Using built-in defaults only. Download the knowledge tree from the tool ' +
          'to see them, and add a rule here to override any that is wrong for you.</div>') +
      '</div>' +

      '<div class="section-block"><div class="section-block__head"><h2>Specification topics — ' + esc(d.product) + '</h2>' +
      '<span class="muted">' + (d.specTopics || []).length + '</span></div>' +
      '<p class="muted" style="margin-bottom:var(--space-3)">What kind of question each section of ' +
      'a specification asks, learned from confirmed answers. A contractor-scope section is answered ' +
      'By Contractor without checking the datasheet; a standards section is never answered with a ' +
      'measurement. Editing one freezes it against future rollups.</p>' +
      ((d.specTopics || []).length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Section</th><th>Kind</th>' +
          '<th>Notes</th><th class="num">Answers</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.specTopics.map(topicRow).join('') + '</tbody></table></div>'
        : '<div class="empty">Nothing classified yet. A section needs two confirmed answers to be ' +
          'classified and five to be trusted automatically — upload a completed matrix to start.</div>') +
      '</div>' +

      '<div class="section-block"><div class="section-block__head"><h2>Unit sections — ' + esc(d.product) + '</h2>' +
      (d.unitSections.filter(function (u) { return u.status === 'draft'; }).length
        ? '<button class="btn btn--ghost btn--sm" data-trust-usecs>Confirm all drafts</button>' : '') +
      '</div>' +
      '<p class="muted" style="margin-bottom:var(--space-3)">Read from uploaded selection reports. ' +
      'Confirmed sections let the AI tell when a clause asks for something the selected unit ' +
      'does not have — and stop one section\'s values being used to answer another\'s clause.</p>' +
      (d.unitSections.length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Section</th><th>Notes</th>' +
          '<th class="num">Seen</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.unitSections.map(unitSectionRow).join('') + '</tbody></table></div>'
        : '<div class="empty">Nothing yet. Sections appear here the first time someone runs ' +
          'AI review with a selection datasheet attached.</div>') +
      '</div>' +

      '<div class="section-block"><div class="section-block__head"><h2>Section profiles</h2>' +
      '<span class="muted">' + d.sections.length + '</span></div>' +
      (d.sections.length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Section</th><th>What it covers</th>' +
          '<th class="num">Answers</th><th>Usual status</th><th></th></tr></thead><tbody>' +
          d.sections.map(sectionRow).join('') + '</tbody></table></div>'
        : '<div class="empty">Nothing rolled up yet. Profiles are built from downloaded matrices ' +
          'that were answered from the library — press Rebuild sections once there are some.</div>') +
      '</div>';
  }

  var USEC_STATUS = [['trusted', 'Confirmed — this product can have it'],
                     ['draft', 'Draft — seen, not confirmed'],
                     ['blocked', 'Not a real section — ignore it']];

  function unitSectionRow(u) {
    return '<tr><td>' + esc(u.name) + '</td>' +
      '<td class="muted">' + (u.notes ? esc(u.notes) : '—') + '</td>' +
      '<td class="num">' + u.times_seen + '</td>' +
      '<td><span class="chip' + (u.status === 'trusted' ? ' chip--free' : u.status === 'blocked' ? ' chip--danger' : '') +
      '">' + esc(u.status) + '</span></td>' +
      '<td class="row-actions"><button class="btn btn--quiet btn--sm" data-edit-usec="' + esc(u.id) + '">' +
      icon('edit', 16) + '</button><button class="btn btn--quiet btn--sm" data-del-usec="' + esc(u.id) + '">' +
      icon('trash', 16) + '</button></td></tr>';
  }

  var SCOPE_OPTS = [
    ['product', 'Product requirement — check against the datasheet'],
    ['contractor', 'Contractor scope — site execution, By Contractor'],
    ['reference', 'Standards / certification — never a datasheet number'],
    ['unknown', 'Unclassified'],
  ];
  var SCOPE_CHIP = { contractor: ' chip--restricted', reference: '', product: ' chip--free' };

  function topicRow(t) {
    return '<tr><td>' + esc(t.name) + '</td>' +
      '<td><span class="chip' + (SCOPE_CHIP[t.scope] || '') + '">' + esc(t.scope) + '</span></td>' +
      '<td class="muted">' + (t.notes ? esc(t.notes) : '—') + '</td>' +
      '<td class="num">' + t.times_seen + '</td>' +
      '<td><span class="chip">' + esc(t.status) + '</span></td>' +
      '<td class="row-actions"><button class="btn btn--quiet btn--sm" data-edit-topic="' + esc(t.id) + '">' +
      icon('edit', 16) + '</button><button class="btn btn--quiet btn--sm" data-del-topic="' + esc(t.id) + '">' +
      icon('trash', 16) + '</button></td></tr>';
  }

  var DIRECTIONS = [
    ['higher', 'Higher is better (thickness, efficiency)'],
    ['lower', 'Lower is better (pressure drop, leakage, sound)'],
    ['exact', 'Must match exactly (voltage, connection size)'],
    ['unknown', 'Not established — never conclude from the number'],
  ];

  function criterionRow(c) {
    return '<tr><td>' + esc(c.name) + '</td>' +
      '<td>' + esc(c.direction) + '</td><td class="muted">' + esc(c.unit || '—') + '</td>' +
      '<td class="muted">' + esc(c.scale_order || '—') + '</td>' +
      '<td class="row-actions"><button class="btn btn--quiet btn--sm" data-edit-crit="' + esc(c.id) + '">' +
      icon('edit', 16) + '</button><button class="btn btn--quiet btn--sm" data-del-crit="' + esc(c.id) + '">' +
      icon('trash', 16) + '</button></td></tr>';
  }

  function critForm(c) {
    c = c || {};
    return field('Name', '<input type="text" name="name" value="' + esc(c.name || '') + '">') +
      field('Matches these words', '<input type="text" name="terms" value="' + esc(c.match_terms || '') + '">',
        'Comma separated. Used to spot which clauses and fields this rule is about.') +
      field('Better when', '<select name="direction">' + opt(DIRECTIONS, c.direction || 'higher') + '</select>') +
      field('Unit', '<input type="text" name="unit" value="' + esc(c.unit || '') + '">',
        'mm, pa, %, kw — or blank for classed values.') +
      field('Class scale', '<input type="text" name="scale" value="' + esc(c.scale_order || '') + '">',
        'Worst to best, comma separated, e.g. TB5,TB4,TB3,TB2,TB1. Blank for plain numbers.') +
      field('Notes', '<input type="text" name="notes" value="' + esc(c.notes || '') + '">');
  }

  function factForm(f) {
    f = f || {};
    return field('Topic', '<input type="text" name="topic" value="' + esc(f.topic || '') + '">',
        'Groups related facts, e.g. Panel, Filter, Fan.') +
      field('Label', '<input type="text" name="label" value="' + esc(f.label || '') + '">') +
      field('Value', '<input type="text" name="value" value="' + esc(f.value || '') + '">') +
      field('Source', '<input type="text" name="source" value="' + esc(f.source || '') + '">',
        'Where this came from — a datasheet, a submittal, a person.') +
      field('Status', '<select name="status">' + opt(FACT_STATUS, f.status || 'trusted') + '</select>');
  }

  var RENDER = {
    overview: renderOverview, users: renderUsers, catalog: renderCatalog,
    books: renderBooks, compliance: renderCompliance, settings: renderSettings, audit: renderAudit
  };

  async function show(panel) {
    state.panel = panel;
    TN.els('#admin-nav button').forEach(function (b) {
      b.setAttribute('aria-current', b.dataset.panel === panel ? 'true' : 'false');
    });
    var host = el('#panel');
    host.innerHTML = '<p class="muted">Loading…</p>';
    try { host.innerHTML = await RENDER[panel](); }
    catch (err) { host.innerHTML = '<div class="notice notice--danger"><div>' + esc(err.message) + '</div></div>'; }
  }

  function mountNav() {
    el('#admin-nav').innerHTML = PANELS.map(function (p) {
      return '<button data-panel="' + p.key + '">' + icon(p.icon, 18) + esc(p.label) + '</button>';
    }).join('');
  }

  // one delegated listener for the whole portal
  document.addEventListener('click', async function (ev) {
    var t = ev.target.closest('[data-add-crit],[data-edit-crit],[data-del-crit],' +
      '[data-edit-topic],[data-del-topic],' +
      '[data-edit-usec],[data-del-usec],[data-trust-usecs],' +
      '[data-add-fact],[data-edit-fact],[data-del-fact],[data-edit-section],' +
      '[data-rebuild-sections],[data-summarize-sections],' +
      '[data-panel],[data-go],[data-approve],[data-edit-user],[data-grants],' +
      '[data-add-sec],[data-add-sub],[data-edit-sec],[data-del-sec],[data-add-item],[data-edit-item],[data-del-item],' +
      '[data-add-book],[data-edit-book],[data-open-book],[data-back-books],[data-add-chapter],[data-edit-chapter],' +
      '[data-del-chapter],[data-open-chapter],[data-back-book],[data-add-block],[data-rm],[data-mv],' +
      '[data-save-blocks],[data-edit-mode]');
    if (!t) return;
    var D = t.dataset;

    if (D.panel) return show(D.panel);
    if (D.go) return show(D.go);

    if (D.approve) {
      await post({ op: 'user.update', id: D.approve, status: 'active' });
      TN.toast('Account approved', 'success'); return show('users');
    }
    if (D.editUser) return editUser(D.editUser);
    if (D.grants) return editGrants(D.grants);

    // ------------------------------------------------------- compliance
    if (t.hasAttribute('data-add-fact')) {
      return openModal('New fact', factForm(null), async function () {
        await post({ op: 'compliance.fact.save', product: comp.product, factory: comp.factory,
          topic: v('topic'), label: v('label'), value: v('value'), source: v('source'), status: v('status') });
        TN.toast('Fact saved', 'success'); show('compliance');
      });
    }
    if (D.editFact) {
      var fact = (comp.data.facts || []).find(function (x) { return x.id === D.editFact; });
      return openModal('Edit fact', factForm(fact), async function () {
        await post({ op: 'compliance.fact.save', id: fact.id, product: comp.product, factory: comp.factory,
          topic: v('topic'), label: v('label'), value: v('value'), source: v('source'), status: v('status') });
        TN.toast('Fact saved', 'success'); show('compliance');
      });
    }
    if (D.delFact) {
      if (!confirm('Delete this fact? The AI stops quoting it immediately.')) return;
      await post({ op: 'compliance.fact.delete', id: D.delFact });
      TN.toast('Fact deleted', 'success'); return show('compliance');
    }
    if (D.editSection) {
      var sec = (comp.data.sections || []).find(function (x) { return x.id === D.editSection; });
      return openModal('Edit section profile',
        '<p class="hint">' + esc(sec.path_label || sec.path_norm) + '</p>' +
        field('What this section covers', '<textarea name="summary">' + esc(sec.summary || '') + '</textarea>',
          'Saving locks this text — a rebuild will not overwrite it.') +
        field('Status', '<select name="status">' + opt([['trusted', 'Used in prompts'], ['blocked', 'Never used']], sec.status) + '</select>'),
        async function () {
          await post({ op: 'compliance.section.save', id: sec.id, summary: v('summary'), status: v('status') });
          TN.toast('Section saved', 'success'); show('compliance');
        });
    }
    if (t.hasAttribute('data-add-crit')) {
      return openModal('New comparison rule', critForm(null), async function () {
        await post({ op: 'compliance.criterion.save', product: comp.product, name: v('name'),
          terms: v('terms'), direction: v('direction'), unit: v('unit'), scale: v('scale'), notes: v('notes') });
        TN.toast('Rule saved', 'success'); show('compliance');
      });
    }
    if (D.editCrit) {
      var cr = (comp.data.criteria || []).find(function (x) { return x.id === D.editCrit; });
      return openModal('Edit comparison rule', critForm(cr), async function () {
        await post({ op: 'compliance.criterion.save', id: cr.id, product: comp.product, name: v('name'),
          terms: v('terms'), direction: v('direction'), unit: v('unit'), scale: v('scale'), notes: v('notes') });
        TN.toast('Rule saved', 'success'); show('compliance');
      });
    }
    if (D.delCrit) {
      if (!confirm('Delete this rule? The built-in default takes over again.')) return;
      await post({ op: 'compliance.criterion.delete', id: D.delCrit });
      TN.toast('Rule deleted', 'success'); return show('compliance');
    }
    if (D.editTopic) {
      var tp = (comp.data.specTopics || []).find(function (x) { return x.id === D.editTopic; });
      return openModal('Edit specification topic',
        '<p class="hint">' + esc(tp.name) + '</p>' +
        field('Kind', '<select name="scope">' + opt(SCOPE_OPTS, tp.scope) + '</select>') +
        field('Notes', '<input type="text" name="notes" value="' + esc(tp.notes || '') + '">',
          'Added to the instruction the AI gets for clauses in this section.') +
        field('Status', '<select name="status">' + opt([['trusted', 'Used in prompts'], ['draft', 'Not used yet'], ['blocked', 'Never used']], tp.status) + '</select>'),
        async function () {
          await post({ op: 'compliance.topic.save', id: tp.id, scope: v('scope'),
            notes: v('notes'), status: v('status') });
          TN.toast('Topic saved', 'success'); show('compliance');
        });
    }
    if (D.delTopic) {
      if (!confirm('Delete this topic? It will be relearned on the next rollup.')) return;
      await post({ op: 'compliance.topic.delete', id: D.delTopic });
      TN.toast('Topic deleted', 'success'); return show('compliance');
    }
    if (D.editUsec) {
      var us = (comp.data.unitSections || []).find(function (x) { return x.id === D.editUsec; });
      return openModal('Edit unit section',
        field('Name', '<input type="text" name="name" value="' + esc(us.name) + '">') +
        field('Notes', '<input type="text" name="notes" value="' + esc(us.notes || '') + '">',
          'Shown to the AI alongside the name — say what the section does if it is not obvious.') +
        field('Status', '<select name="status">' + opt(USEC_STATUS, us.status) + '</select>',
          'Only confirmed sections are used to tell the AI that a unit is MISSING something.'),
        async function () {
          await post({ op: 'compliance.unitsection.save', id: us.id, name: v('name'),
            notes: v('notes'), status: v('status') });
          TN.toast('Section saved', 'success'); show('compliance');
        });
    }
    if (D.delUsec) {
      if (!confirm('Delete this section? It will reappear if another datasheet lists it.')) return;
      await post({ op: 'compliance.unitsection.delete', id: D.delUsec });
      TN.toast('Section deleted', 'success'); return show('compliance');
    }
    if (t.hasAttribute('data-trust-usecs')) {
      var res = await post({ op: 'compliance.unitsections.trust_all', product: comp.product });
      TN.toast(res.changed + ' section(s) confirmed', 'success'); return show('compliance');
    }
    if (t.hasAttribute('data-rebuild-sections')) {
      var r = await post({ op: 'compliance.sections.rebuild', product: comp.product, factory: comp.factory });
      TN.toast(r.sections + ' section(s) rolled up', 'success'); return show('compliance');
    }
    if (t.hasAttribute('data-summarize-sections')) {
      TN.toast('Asking AI to describe the sections…');
      var w = await post({ op: 'compliance.sections.summarize', product: comp.product, factory: comp.factory });
      TN.toast(w.summarized + ' summary(ies) written', 'success'); return show('compliance');
    }

    if (D.addSec !== undefined && t.hasAttribute('data-add-sec')) {
      return openModal('New section', sectionForm(null, ''), async function () {
        await post(Object.assign({ op: 'section.save', parent_id: v('parent_id') || null, tagline: v('tagline') }, collect()));
        TN.toast('Section created', 'success'); show('catalog');
      });
    }
    if (D.addSub) {
      return openModal('New subsection', sectionForm(null, D.addSub), async function () {
        await post(Object.assign({ op: 'section.save', parent_id: v('parent_id') || null, tagline: v('tagline') }, collect()));
        TN.toast('Subsection created', 'success'); show('catalog');
      });
    }
    if (D.editSec) {
      var s = state.catalog.sections.find(function (x) { return x.id === D.editSec; });
      return openModal('Edit section', sectionForm(s), async function () {
        await post(Object.assign({ op: 'section.save', id: s.id, parent_id: v('parent_id') || null, tagline: v('tagline') }, collect()));
        TN.toast('Saved', 'success'); show('catalog');
      });
    }
    if (D.delSec) {
      if (!confirm('Delete this section? Subsections and items inside it go too.')) return;
      try { await post({ op: 'section.delete', id: D.delSec }); }
      catch (e) {
        if (!confirm(e.message + '\n\nDelete everything inside it anyway?')) return;
        await post({ op: 'section.delete', id: D.delSec, force: true });
      }
      TN.toast('Section deleted'); return show('catalog');
    }

    if (D.addItem) {
      var books1 = (await get('books')).books;
      return openModal('New item', itemForm(null, D.addItem, books1), async function () {
        await post(Object.assign({ op: 'item.save', section_id: v('section_id'), kind: v('kind'), href: v('href'),
          book_id: v('book_id') || null, badge: v('badge'), teaser: v('teaser') }, collect()));
        TN.toast('Item created', 'success'); show('catalog');
      });
    }
    if (D.editItem) {
      var it = state.catalog.items.find(function (x) { return x.id === D.editItem; });
      var books2 = (await get('books')).books;
      return openModal('Edit item', itemForm(it, it.section_id, books2), async function () {
        await post(Object.assign({ op: 'item.save', id: it.id, section_id: v('section_id'), kind: v('kind'),
          href: v('href'), book_id: v('book_id') || null, badge: v('badge'), teaser: v('teaser') }, collect()));
        TN.toast('Saved', 'success'); show('catalog');
      });
    }
    if (D.delItem) {
      if (!confirm('Delete this item?')) return;
      await post({ op: 'item.delete', id: D.delItem });
      TN.toast('Item deleted'); return show('catalog');
    }

    if (t.hasAttribute('data-add-book')) {
      return openModal('New book', bookForm(null), async function () {
        var r = await post(bookPayload());
        state.book = r.id; TN.toast('Book created', 'success'); show('books');
      });
    }
    if (D.editBook) {
      var bd = (await get('books/' + D.editBook)).book;
      return openModal('Book details', bookForm(bd), async function () {
        await post(Object.assign(bookPayload(), { id: bd.id }));
        TN.toast('Saved', 'success'); show('books');
      });
    }
    if (D.openBook) { state.book = D.openBook; state.chapter = null; return show('books'); }
    if (t.hasAttribute('data-back-books')) { state.book = null; state.chapter = null; return show('books'); }
    if (t.hasAttribute('data-back-book')) { state.chapter = null; return show('books'); }

    if (t.hasAttribute('data-add-chapter')) {
      return openModal('New chapter', chapterForm(null), async function () {
        await post(Object.assign({ op: 'chapter.save', book_id: state.book }, chapterPayload()));
        TN.toast('Chapter created', 'success'); show('books');
      });
    }
    if (D.editChapter) {
      var cd = (await get('chapter/' + D.editChapter)).chapter;
      return openModal('Edit chapter', chapterForm(cd), async function () {
        await post(Object.assign({ op: 'chapter.save', id: cd.id, book_id: state.book }, chapterPayload()));
        TN.toast('Saved', 'success'); show('books');
      });
    }
    if (D.delChapter) {
      if (!confirm('Delete this chapter and everything written in it?')) return;
      await post({ op: 'chapter.delete', id: D.delChapter });
      TN.toast('Chapter deleted'); return show('books');
    }
    if (D.openChapter) { state.chapter = D.openChapter; return show('books'); }

    if (D.editMode) {
      // Carry the work across: whichever pane you leave becomes the other.
      if (D.editMode === 'blocks' && state.editMode !== 'blocks') state.blocks = TNMarkdown.parse(state.md);
      if (D.editMode === 'markdown' && state.editMode === 'blocks') state.md = TNMarkdown.serialize(state.blocks);
      state.editMode = D.editMode;
      el('#panel').innerHTML = editorHTML();
      return;
    }
    if (D.addBlock) {
      state.blocks.push({ type: D.addBlock, data: TNBlocks.blank(D.addBlock) });
      el('#panel').innerHTML = editorHTML(); markDirty(); return;
    }
    if (D.rm !== undefined && t.hasAttribute('data-rm')) {
      state.blocks.splice(Number(D.rm), 1);
      el('#panel').innerHTML = editorHTML(); markDirty(); return;
    }
    if (D.mv) {
      var p = D.mv.split('|'), from = Number(p[0]), to = from + Number(p[1]);
      if (to < 0 || to >= state.blocks.length) return;
      var moved = state.blocks.splice(from, 1)[0];
      state.blocks.splice(to, 0, moved);
      el('#panel').innerHTML = editorHTML(); markDirty(); return;
    }
    if (t.hasAttribute('data-save-blocks')) return saveChapter();
  });

  function bookForm(b) {
    b = b || {};
    return field('Title', '<input name="title" type="text" value="' + esc(b.title || '') + '">') +
      field('Slug', '<input name="slug" type="text" value="' + esc(b.slug || '') + '">', 'Becomes /read/slug.') +
      field('Subtitle', '<input name="subtitle" type="text" value="' + esc(b.subtitle || '') + '">') +
      field('Author', '<input name="author" type="text" value="' + esc(b.author || '') + '">') +
      field('Cover image URL', '<input name="cover_url" type="text" value="' + esc(b.cover_url || '') + '">') +
      field('Description', '<textarea name="description">' + esc(b.description || '') + '</textarea>') +
      field('Who can read it', '<select name="access_level">' + opt(ACCESS_OPTS, b.access_level || 'public') + '</select>',
        'Individual chapters can be stricter than the book.') +
      field('Plan needed', '<select name="required_plan">' + opt(PLAN_OPTS, b.required_plan || 'free') + '</select>') +
      field('Status', '<select name="status">' + opt([['draft', 'Draft — admins only'], ['published', 'Published']], b.status || 'draft') + '</select>');
  }
  function bookPayload() {
    return { op: 'book.save', title: v('title'), slug: v('slug'), subtitle: v('subtitle'), author: v('author'),
      cover_url: v('cover_url'), description: v('description'), access_level: v('access_level'),
      required_plan: v('required_plan'), status: v('status') };
  }
  function chapterForm(c) {
    c = c || {};
    return field('Title', '<input name="title" type="text" value="' + esc(c.title || '') + '">') +
      field('Slug', '<input name="slug" type="text" value="' + esc(c.slug || '') + '">') +
      field('Summary', '<textarea name="summary">' + esc(c.summary || '') + '</textarea>') +
      field('Who can read it', '<select name="access_level">' +
        opt([['inherit', 'Same as the book']].concat(ACCESS_OPTS), c.access_level || 'inherit') + '</select>') +
      field('Order', '<input name="sort_order" type="number" value="' + (c.sort_order || 0) + '">') +
      '<label style="display:flex;gap:var(--space-2);align-items:center"><input name="is_published" type="checkbox"' +
      (c.id === undefined || c.is_published ? ' checked' : '') + '> Published</label>';
  }
  function chapterPayload() {
    return { title: v('title'), slug: v('slug'), summary: v('summary'), access_level: v('access_level'),
      sort_order: v('sort_order'), is_published: chk('is_published') };
  }

  document.addEventListener('input', function (ev) {
    if (ev.target.hasAttribute && ev.target.hasAttribute('data-bi')) syncBlockField(ev.target);
    if (ev.target.id === 'md') {
      state.md = ev.target.value;
      clearTimeout(state.pvTimer);
      state.pvTimer = setTimeout(function () {
        var pv = el('#preview');
        if (pv) pv.innerHTML = TNBlocks.render(TNMarkdown.parse(state.md));
      }, 250);
      markDirty();
    }
  });

  // Ctrl/Cmd+S saves without leaving the keyboard.
  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && state.chapter) {
      ev.preventDefault(); saveChapter();
    }
  });

  window.addEventListener('beforeunload', function (ev) {
    if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'user-status') { state.userStatus = ev.target.value; show('users'); }
    if (ev.target.hasAttribute && ev.target.hasAttribute('data-bi')) syncBlockField(ev.target);
  });
  document.addEventListener('keyup', function (ev) {
    if (ev.target.id === 'user-q') {
      clearTimeout(state.qTimer);
      state.userQ = ev.target.value;
      state.qTimer = setTimeout(function () { show('users'); }, 350);
    }
  });
  document.addEventListener('submit', async function (ev) {
    if (ev.target.id !== 'settings-form') return;
    ev.preventDefault();
    var out = {};
    TN.els('#settings-form [name]').forEach(function (n) { out[n.name] = n.value; });
    try { await post({ op: 'settings.save', settings: out }); TN.toast('Settings saved', 'success'); }
    catch (e) { TN.toast(e.message, 'error'); }
  });

  // The product/factory pair the Compliance panel is looking at. Changing
  // the product resets the factory, because the valid factories differ per
  // product (AHU has UAE and KSA, FCU only China) and a stale value would
  // silently query the wrong pair.
  document.addEventListener('change', function (ev) {
    var n = ev.target;
    if (n.matches('[data-comp-product]')) {
      comp.product = n.value;
      var list = (comp.data && comp.data.pairs && comp.data.pairs[comp.product]) || [];
      comp.factory = list[0] || '';
      return show('compliance');
    }
    if (n.matches('[data-comp-factory]')) {
      comp.factory = n.value;
      return show('compliance');
    }
  });

  document.addEventListener('tn:ready', async function (e) {
    var u = e.detail.user;
    if (!u || u.role !== 'admin') {
      el('#panel').innerHTML = '<div class="notice notice--danger"><div><strong>Admins only.</strong><br>' +
        'Sign in with an admin account to open this portal.</div></div>';
      return;
    }
    mountNav();
    show('overview');
  });
})();
