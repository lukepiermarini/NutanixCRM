/* Application shell: bootstrap, routing, header, save status, reminders. */
(function (NX) {
  'use strict';
  const { h, icon, clear } = NX.dom;
  const U = NX.util;

  const ROUTES = ['pipeline', 'tasks', 'meetings', 'accounts', 'settings'];
  const app = (NX.app = { store: null, fileSync: null, route: 'pipeline' });

  function currentRoute() {
    const r = (location.hash || '').replace(/^#\/?/, '');
    return ROUTES.includes(r) ? r : 'pipeline';
  }
  app.navigate = (r) => { location.hash = '#/' + r; };

  // ------------------------------------------------------------ Header
  function renderHeader() {
    const hdr = document.getElementById('app-header');
    const overdue = app.store.tasks.list({ status: 'open', owner: 'me' }).filter((t) => t.dueDate && t.dueDate <= U.todayISO()).length;
    const nav = ROUTES.map((r) => h('a.nav-link' + (app.route === r ? '.is-active' : ''), { href: '#/' + r },
      NX.views[r].title, r === 'tasks' && overdue ? h('span.nav-badge', { title: 'Due today or overdue' }, overdue) : null));
    clear(hdr).append(
      h('div.brand', h('span.logo', 'SE'), h('div', h('div.brand-name', 'Pipeline'), h('div.brand-ws', app.store.settings.get().workspaceName))),
      h('nav.nav', nav),
      h('div.header-actions', saveIndicator(),
        h('button.btn.btn-primary', { onclick: () => NX.ui.openNewMeeting(), title: 'New meeting (N)' }, icon('spark'), h('span.hide-sm', 'New meeting'))),
    );
  }

  function saveIndicator() {
    const s = app.fileSync.getState();
    const map = {
      unsupported: ['ok', 'Saved on this PC (browser)'],
      disconnected: ['ok', 'Saved on this PC (browser)'],
      saving: ['busy', 'Saving to ' + s.fileName + '…'],
      saved: ['ok', 'Auto-saved to ' + s.fileName],
      'needs-permission': ['warn', 'Click to resume file auto-save'],
      error: ['err', 'File save failed — click for details'],
    };
    const [cls, text] = map[s.status];
    return h('button.save-ind.save-' + cls, {
      title: text,
      onclick: async () => {
        if (s.status === 'needs-permission') {
          try { await app.fileSync.reconnect(); NX.ui.toast('File auto-save resumed', 'success'); } catch (e) { NX.ui.toast(e.message, 'error'); }
        } else app.navigate('settings');
      },
    }, h('span.save-dot'), h('span.hide-sm', text));
  }

  // ------------------------------------------------------------ Rendering
  let raf = 0;
  function scheduleRender() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  }

  function render() {
    app.route = currentRoute();
    const main = document.getElementById('app-main');
    // Preserve focus/caret on inputs across re-renders triggered by data changes.
    const active = document.activeElement;
    const focusKey = active && main.contains(active) && active.placeholder ? active.placeholder : null;
    const scroll = main.querySelector('.board') ? main.querySelector('.board').scrollLeft : 0;
    renderHeader();
    main.dataset.route = app.route;
    NX.views[app.route].render(main);
    document.title = NX.views[app.route].title + ' · SE Pipeline';
    if (scroll && main.querySelector('.board')) main.querySelector('.board').scrollLeft = scroll;
    if (focusKey) { const el = [...main.querySelectorAll('input,textarea')].find((x) => x.placeholder === focusKey); if (el) el.focus(); }
  }

  // ------------------------------------------------------------ Reminders
  const NOTIFIED_KEY = 'se-pipeline-notified';
  function checkReminders() {
    if (!app.store.settings.get().remindersEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const today = U.todayISO();
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '{}'); } catch { /* storage unavailable */ }
    const due = app.store.tasks.list({ status: 'open', owner: 'me' }).filter((t) => t.dueDate && t.dueDate <= today && seen[t.id] !== today);
    if (!due.length) return;
    const n = new Notification(due.length === 1 ? 'Task due: ' + due[0].title : `${due.length} tasks due today or overdue`, {
      body: due.slice(0, 4).map((t) => '• ' + t.title).join('\n'), tag: 'se-pipeline-due',
    });
    n.onclick = () => { window.focus(); app.navigate('tasks'); };
    due.forEach((t) => (seen[t.id] = today));
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(seen)); } catch { /* ignore */ }
  }

  app.toggleReminders = async () => {
    const on = app.store.settings.get().remindersEnabled && Notification.permission === 'granted';
    if (on) { await app.store.settings.update({ remindersEnabled: false }); NX.ui.toast('Reminders off'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { NX.ui.toast('Notifications are blocked for this page in your browser settings', 'error', 6000); return; }
    await app.store.settings.update({ remindersEnabled: true });
    NX.ui.toast('Reminders on — you\'ll be notified about due tasks while this page is open', 'success', 5000);
    checkReminders();
  };

  // ------------------------------------------------------------ Boot
  async function boot() {
    const adapter = await NX.db.openDatabase();
    app.store = await NX.createStore(adapter).init();
    app.fileSync = NX.createFileSync(app.store);

    // Keep other open tabs of this app in sync.
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('se-pipeline') : null;
    let fromPeer = false;
    if (channel) channel.onmessage = async () => { fromPeer = true; await app.store.init(); fromPeer = false; scheduleRender(); };

    app.store.on((evt) => {
      if (!fromPeer && !(evt && evt.local)) app.fileSync.notifyChange();
      if (channel && !fromPeer) channel.postMessage(evt.type);
      scheduleRender();
    });
    app.fileSync.onChange(() => renderHeader());
    await app.fileSync.init().catch((e) => console.warn('File sync init failed', e));

    if (adapter.kind === 'memory') NX.ui.toast('This browser blocked local storage — changes will be lost on close. Use Export in Settings.', 'error', 12000);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    window.addEventListener('hashchange', render);
    window.addEventListener('beforeunload', () => app.fileSync.flush());
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.backdrop')) return;
      if (e.key === 'n') { e.preventDefault(); NX.ui.openNewMeeting(); }
      else if (e.key === 't') { e.preventDefault(); NX.ui.openTaskEditor(null); }
      else if (/^[1-5]$/.test(e.key)) app.navigate(ROUTES[Number(e.key) - 1]);
    });

    render();
    document.getElementById('app-loading')?.remove();
    checkReminders();
    setInterval(checkReminders, 15 * 60 * 1000);
    // Refresh relative dates ("Today", "overdue") when the day rolls over.
    let day = U.todayISO();
    setInterval(() => { if (U.todayISO() !== day) { day = U.todayISO(); render(); } }, 60 * 1000);
  }

  boot().catch((err) => {
    console.error(err);
    const el = document.getElementById('app-loading');
    if (el) el.textContent = 'Could not start: ' + err.message;
  });
})(globalThis.NX = globalThis.NX || {});
