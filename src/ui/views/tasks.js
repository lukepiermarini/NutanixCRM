/* Tasks & reminders: everything that needs doing, grouped by when it's due. */
(function (NX) {
  'use strict';
  const { h, icon, clear } = NX.dom;
  const U = NX.util;
  const ui = NX.ui;
  const store = () => NX.app.store;

  const view = { owner: 'me', accountId: '', q: '', showDone: false };

  function buckets(tasks) {
    const today = U.todayISO();
    const in7 = U.addDays(today, 7);
    const groups = [
      { id: 'overdue', title: 'Overdue', cls: 'grp-overdue', items: [] },
      { id: 'today', title: 'Today', cls: 'grp-today', items: [] },
      { id: 'week', title: 'Next 7 days', cls: '', items: [] },
      { id: 'later', title: 'Later', cls: '', items: [] },
      { id: 'nodate', title: 'No due date', cls: '', items: [] },
    ];
    for (const t of tasks) {
      const g = !t.dueDate ? 'nodate' : t.dueDate < today ? 'overdue' : t.dueDate === today ? 'today' : t.dueDate <= in7 ? 'week' : 'later';
      groups.find((x) => x.id === g).items.push(t);
    }
    return groups;
  }

  /** "Send sizing to Acme by Friday !" -> {title, dueDate, accountId, priority} */
  function parseQuickAdd(text) {
    let title = text.trim();
    const dueDate = NX.ai.parseDueDate(title, U.todayISO());
    const priority = /(^|\s)!(\s|$)|\burgent\b/i.test(title) ? 'high' : 'medium';
    title = title.replace(/(^|\s)!(\s|$)/, ' ').trim();
    const norm = ' ' + U.normalize(title) + ' ';
    const acct = store().accounts.list().find((a) => norm.includes(' ' + U.normalize(a.name) + ' '));
    return { title, dueDate: dueDate || U.addBusinessDays(U.todayISO(), 2), accountId: acct ? acct.id : '', priority };
  }

  function render(root) {
    const listEl = h('div.task-groups');
    const paint = () => {
      const q = U.normalize(view.q);
      let tasks = store().tasks.list();
      if (view.owner === 'me') tasks = tasks.filter((t) => t.owner === 'me');
      else if (view.owner === 'others') tasks = tasks.filter((t) => t.owner !== 'me');
      if (view.accountId) tasks = tasks.filter((t) => t.accountId === view.accountId);
      if (q) tasks = tasks.filter((t) => U.normalize(t.title + ' ' + t.details + ' ' + t.ownerName).includes(q));
      const open = tasks.filter((t) => t.status === 'open');
      const done = tasks.filter((t) => t.status === 'done').sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      clear(listEl);
      if (!open.length && !done.length) {
        listEl.appendChild(ui.emptyState('Nothing to do 🎉', store().tasks.list().length ? 'No tasks match these filters.' : 'Tasks are created automatically from meeting notes, or add one above.'));
        return;
      }
      for (const g of buckets(open)) {
        if (!g.items.length) continue;
        listEl.appendChild(h('section.task-group.' + (g.cls || 'grp'),
          h('h3.task-group-title', g.title, h('span.count', g.items.length)),
          h('div.task-list', g.items.map((t) => ui.taskRow(t)))));
      }
      if (view.showDone && done.length) {
        listEl.appendChild(h('section.task-group.grp-done',
          h('h3.task-group-title', 'Completed', h('span.count', done.length)),
          h('div.task-list', done.slice(0, 200).map((t) => ui.taskRow(t)))));
      }
    };

    const quick = h('input.input.quick-add', {
      placeholder: 'Quick add: "Send BOM to Acme by Friday !"  (dates & account names are detected, ! = high priority)',
      onkeydown: async (e) => {
        if (e.key !== 'Enter' || !quick.value.trim()) return;
        const t = parseQuickAdd(quick.value);
        await ui.run(() => store().tasks.create({ ...t, owner: 'me' }));
        quick.value = '';
        ui.toast(`Added · due ${U.relativeDue(t.dueDate)}`, 'success', 2000);
      },
    });
    const seg = (id, label) => h('button.seg' + (view.owner === id ? '.is-active' : ''), { onclick: (e) => { view.owner = id; e.target.parentNode.querySelectorAll('.seg').forEach((b) => b.classList.toggle('is-active', b === e.target)); paint(); } }, label);
    const remindersOn = store().settings.get().remindersEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted';

    clear(root).append(
      h('div.page-head',
        h('div.row.wrap',
          h('div.segmented', seg('me', 'My tasks'), seg('others', 'Others\' commitments'), seg('all', 'All')),
          ui.accountSelect(view.accountId, { onchange: (e) => { view.accountId = e.target.value; paint(); } }, { allowEmpty: 'All accounts' }),
          h('input.input.search', { type: 'search', placeholder: 'Search tasks…', value: view.q, oninput: (e) => { view.q = e.target.value; paint(); } }),
          h('label.toggle', h('input', { type: 'checkbox', checked: view.showDone, onchange: (e) => { view.showDone = e.target.checked; paint(); } }), 'Show completed'),
        ),
        h('div.row.wrap',
          typeof Notification !== 'undefined' ? h('button.btn.btn-ghost', {
            title: 'Desktop notifications for tasks due today / overdue while the app is open',
            onclick: () => NX.app.toggleReminders(),
          }, icon('bell'), remindersOn ? 'Reminders on' : 'Enable reminders') : null,
          h('button.btn', { onclick: () => ui.openTaskEditor(null) }, icon('plus'), 'Task'),
        ),
      ),
      quick,
      listEl,
    );
    paint();
  }

  NX.views = NX.views || {};
  NX.views.tasks = { title: 'Tasks', render, parseQuickAdd };
})(globalThis.NX = globalThis.NX || {});
