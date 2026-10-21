/* ============================================================
   Projects - the project choice inside a tool.
   A tool that saves its work in a project puts a <select> and a
   hint line on its page and calls:

     PRPick.attach({ select, hint, profile, onChange })  -> Promise

   - Fills the select with the user's projects (Api.prList).
   - Starts on the project named in the address (?project=<id>), or the
     one last used in this tab, and
     keeps the address in step so a reload stays in the project.
   - With a project chosen, the Back button leads to the project page.
   - o.fixed: the tool was opened from a project page (?project=<id>&from=project): that project is the one, and
     the choice is locked, so work is never saved in another project by mistake (owner, 21 Oct 2026). To work
     for another project, open it from that project's page (or open the tool from the dashboard).
   - PRPick.current() -> { id, name } or null
   - PRPick.required() -> false when the Projects tool is not on for
     this account; the tool then works without a project, as before.
   ============================================================ */
(function () {
  'use strict';
  var KEEP = 'dame_pr_project';
  var Hub = window.Hub, sel = null, list = [], on = false, picked = null, locked = false;

  function hasProjects(profile) {
    return (profile.categories || []).some(function (c) { return c.allowed && c.tools.some(function (t) { return t.id === 'projects' && t.status === 'live'; }); });
  }
  function current() {
    if (!on || !sel) return null;
    var p = list.filter(function (x) { return x.id === sel.value; })[0];
    return p ? { id: p.id, name: p.name } : null;
  }
  function pageUrl(id) { return Hub.url('tools/projects/project.html?id=' + encodeURIComponent(id)); }

  function attach(o) {
    sel = o.select; on = hasProjects(o.profile);
    [].forEach.call(document.querySelectorAll('[data-project-box]'), function (box) { box.hidden = !on; });
    if (!on) return Promise.resolve(null);
    var say = function (text, bad) { o.hint.textContent = text; o.hint.classList.toggle('pr-bad', !!bad); };

    function changed() {
      var p = current();
      if ((p && p.id) === (picked && picked.id)) return;
      picked = p;
      try {
        var u = new URL(window.location.href);
        if (p) u.searchParams.set('project', p.id); else u.searchParams.delete('project');
        window.history.replaceState(null, '', u.href);
      } catch (e) { /* the address stays as it is */ }
      try { if (p) sessionStorage.setItem(KEEP, p.id); } catch (e2) { /* not kept */ }
      if (p) Hub.setBack(p.name, pageUrl(p.id));
      else Hub.setBack('Projects', Hub.url('tools/projects/'));
      say(p ? (locked ? 'Everything you make here is saved in ' + p.name + ', the project you came from.' : 'Everything you make here is saved in ' + p.name + '.')
            : (list.length ? 'Choose the project this work belongs to.' : 'You have no project yet. Add one first.'));
      if (o.onChange) o.onChange(p);
    }

    sel.disabled = true;
    return window.Api.prList(Hub.token()).then(function (res) {
      list = res.projects || [];
      sel.textContent = '';
      sel.appendChild(Hub.el('option', { value: '', text: list.length ? 'Choose a project' : 'No projects yet' }));
      list.forEach(function (p) { sel.appendChild(Hub.el('option', { value: p.id, text: p.name + ' - ' + p.client_name })); });
      sel.disabled = !list.length;
      var want = Hub.param('project');
      // back from the tool's edit screen: the address has lost the project, this tab remembers it
      try { want = want || sessionStorage.getItem(KEEP) || ''; } catch (e) { /* not kept */ }
      if (want) { sel.value = want; if (sel.value !== want) sel.value = ''; }
      // opened from a project page: that project, locked
      locked = !!o.fixed && !!Hub.param('project') && sel.value === Hub.param('project');
      if (locked) {
        // no choice to make: the project is shown as text, not as a list
        sel.disabled = true; sel.hidden = true;
        var shown = list.filter(function (x) { return x.id === sel.value; })[0];
        sel.parentNode.insertBefore(Hub.el('div', { 'class': 'input pr-fixed', role: 'note', 'aria-label': 'Project',
          style: 'display:flex;align-items:center;background:var(--surface-2);cursor:default;font-weight:600;overflow-wrap:anywhere',
          title: 'Opened from this project. To work for another project, open it from that project\'s page.',
          text: shown ? shown.name + (shown.client_name ? ' - ' + shown.client_name : '') : '' }), sel.nextSibling);
        [].forEach.call(document.querySelectorAll('[data-project-new]'), function (a) { a.hidden = true; });
      }
      sel.addEventListener('change', changed);
      picked = { id: '?' }; changed();
      return current();
    }, function (err) {
      sel.textContent = ''; sel.appendChild(Hub.el('option', { value: '', text: 'Could not load' }));
      say('Could not load your projects: ' + ((err && err.message) || err) + ' Refresh the page to try again.', true);
      if (o.onChange) o.onChange(null);
      return null;
    });
  }

  window.PRPick = { attach: attach, current: current, required: function () { return on; }, locked: function () { return locked; } };
})();
