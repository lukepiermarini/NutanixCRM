/* Meetings log + Accounts list. */
(function (NX) {
  'use strict';
  const { h, icon, clear } = NX.dom;
  const U = NX.util;
  const S = NX.schema;
  const ui = NX.ui;
  const store = () => NX.app.store;

  // ---------------------------------------------------------------- Meetings
  const mView = { accountId: '', q: '' };

  function renderMeetings(root) {
    const listEl = h('div.meeting-table');
    const paint = () => {
      const q = U.normalize(mView.q);
      let rows = store().meetings.list(mView.accountId ? { accountId: mView.accountId } : undefined);
      if (q) rows = rows.filter((m) => U.normalize([m.title, m.summary, m.rawNotes.slice(0, 5000)].join(' ')).includes(q));
      clear(listEl);
      if (!rows.length) {
        listEl.appendChild(ui.emptyState('No meetings yet', 'Click "New meeting", paste your Zoom notes, and get a summary plus dated next steps.',
          h('button.btn.btn-primary', { onclick: () => ui.openNewMeeting() }, icon('spark'), 'New meeting')));
        return;
      }
      for (const m of rows) {
        const acct = store().accounts.get(m.accountId);
        const deal = store().deals.get(m.dealId);
        const tasks = store().tasks.list({ meetingId: m.id });
        const open = tasks.filter((t) => t.status === 'open').length;
        listEl.appendChild(h('button.meeting-row', { onclick: () => ui.openMeeting(m.id) },
          h('div.meeting-date', h('span.d', U.formatDate(m.date, { day: 'numeric' })), h('span.m', U.formatDate(m.date, { month: 'short' }))),
          h('div.meeting-main',
            h('div.row.wrap', h('strong', m.title), m.processedBy === 'ai' ? h('span.chip.chip-ai', icon('spark'), 'AI') : null),
            h('div.muted.small', [acct && acct.name, deal && deal.name].filter(Boolean).join(' · ')),
            m.summary ? h('div.clamp-2', m.summary) : null),
          h('div.meeting-side', tasks.length ? h('span.pill', icon('check'), `${tasks.length - open}/${tasks.length}`) : null,
            m.stageAfter && m.stageBefore !== m.stageAfter ? ui.stageBadge(m.stageAfter) : null),
        ));
      }
    };
    clear(root).append(
      h('div.page-head',
        h('div.row.wrap',
          ui.accountSelect(mView.accountId, { onchange: (e) => { mView.accountId = e.target.value; paint(); } }, { allowEmpty: 'All accounts' }),
          h('input.input.search', { type: 'search', placeholder: 'Search meetings & notes…', value: mView.q, oninput: (e) => { mView.q = e.target.value; paint(); } })),
        h('button.btn.btn-primary', { onclick: () => ui.openNewMeeting() }, icon('spark'), 'New meeting'),
      ),
      listEl,
    );
    paint();
  }

  // ---------------------------------------------------------------- Accounts
  const aView = { q: '' };

  function renderAccounts(root) {
    const grid = h('div.account-grid');
    const paint = () => {
      const q = U.normalize(aView.q);
      const rows = store().accounts.list().filter((a) => !q || U.normalize(a.name + ' ' + a.partner + ' ' + a.industry).includes(q));
      clear(grid);
      if (!rows.length) {
        grid.appendChild(ui.emptyState('No accounts', 'Accounts are created automatically from meetings, or add one manually.',
          h('button.btn.btn-primary', { onclick: () => ui.openAccountEditor() }, icon('plus'), 'New account')));
        return;
      }
      for (const a of rows) {
        const deals = store().deals.list({ accountId: a.id });
        const openDeals = deals.filter((d) => S.stageById(d.stage).open);
        const tasks = store().tasks.list({ accountId: a.id, status: 'open' });
        const overdue = tasks.filter((t) => t.dueDate && t.dueDate < U.todayISO()).length;
        const last = store().meetings.list({ accountId: a.id })[0];
        grid.appendChild(h('button.account-card', { onclick: () => ui.openAccountDrawer(a.id) },
          h('div.account-name', a.name),
          h('div.muted.small', [a.industry, a.partner && 'via ' + a.partner].filter(Boolean).join(' · ') || ' '),
          h('div.account-stats',
            h('span', h('strong', U.formatMoney(openDeals.reduce((s, d) => s + d.amount, 0))), ' open'),
            h('span', h('strong', openDeals.length), ' deals'),
            h('span' + (overdue ? '.text-danger' : ''), h('strong', tasks.length), ' tasks', overdue ? ` (${overdue} overdue)` : '')),
          h('div.row.wrap', openDeals.slice(0, 3).map((d) => ui.stageBadge(d.stage))),
          h('div.muted.small', last ? 'Last meeting ' + U.formatDate(last.date) : 'No meetings yet'),
        ));
      }
    };
    clear(root).append(
      h('div.page-head',
        h('input.input.search', { type: 'search', placeholder: 'Search accounts…', value: aView.q, oninput: (e) => { aView.q = e.target.value; paint(); } }),
        h('button.btn', { onclick: () => ui.openAccountEditor() }, icon('plus'), 'Account'),
      ),
      grid,
    );
    paint();
  }

  NX.views = NX.views || {};
  NX.views.meetings = { title: 'Meetings', render: renderMeetings };
  NX.views.accounts = { title: 'Accounts', render: renderAccounts };
})(globalThis.NX = globalThis.NX || {});
