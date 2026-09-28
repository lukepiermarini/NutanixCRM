/* Kanban pipeline: 7 stage columns with drag-and-drop between and within columns. */
(function (NX) {
  'use strict';
  const { h, icon, clear } = NX.dom;
  const U = NX.util;
  const S = NX.schema;
  const ui = NX.ui;
  const store = () => NX.app.store;

  const view = { filter: '', showClosed: true };

  function dealCard(d) {
    const acct = store().accounts.get(d.accountId);
    const sum = store().queries.dealSummary(d.id);
    const overdue = sum.nextTask && sum.nextTask.dueDate && sum.nextTask.dueDate < U.todayISO();
    const card = h('article.deal-card', {
      draggable: 'true', tabIndex: 0, dataset: { id: d.id },
      'aria-label': `${d.name}, ${acct ? acct.name : ''}. Press Enter to open.`,
      onclick: () => ui.openDealDrawer(d.id),
      onkeydown: (e) => {
        if (e.key === 'Enter') ui.openDealDrawer(d.id);
        // Keyboard move: Alt/Option + arrow keys
        if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          const i = S.STAGE_IDS.indexOf(d.stage) + (e.key === 'ArrowRight' ? 1 : -1);
          if (i >= 0 && i < S.STAGE_IDS.length) moveDeal(d.id, S.STAGE_IDS[i], null);
        }
      },
    },
      h('div.deal-card-account', acct ? acct.name : 'Unknown account'),
      h('div.deal-card-name', d.name),
      h('div.deal-card-meta',
        d.amount ? h('span.amount', U.formatMoney(d.amount)) : null,
        d.closeDate ? h('span.muted', icon('cal'), U.formatDate(d.closeDate, { month: 'short', day: 'numeric' })) : null,
      ),
      sum.nextTask ? h('div.deal-card-next' + (overdue ? '.is-overdue' : ''), { title: sum.nextTask.title },
        h('span.clamp-1', sum.nextTask.title), h('span.due-inline', U.relativeDue(sum.nextTask.dueDate)))
        : (d.nextStep ? h('div.deal-card-next.muted', h('span.clamp-1', d.nextStep)) : null),
      h('div.deal-card-foot',
        sum.openTasks ? h('span.pill', { title: 'Open tasks' }, icon('check'), sum.openTasks) : null,
        sum.lastMeeting ? h('span.pill', { title: 'Last meeting ' + U.formatDate(sum.lastMeeting.date) }, icon('doc'), U.formatDate(sum.lastMeeting.date, { month: 'short', day: 'numeric' })) : null,
        h('span.grow'),
        h('button.icon-btn.sm', { title: 'New meeting for this deal', onclick: (e) => { e.stopPropagation(); ui.openNewMeeting({ accountId: d.accountId, dealId: d.id }); } }, icon('spark')),
      ),
    );
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', d.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => card.classList.add('is-dragging'));
    });
    card.addEventListener('dragend', () => { card.classList.remove('is-dragging'); document.querySelectorAll('.drop-marker').forEach((m) => m.remove()); });
    return card;
  }

  async function moveDeal(id, stage, beforeId) {
    const deal = store().deals.get(id);
    if (!deal) return;
    let lostReason;
    if (stage === 'closed_lost' && deal.stage !== 'closed_lost') {
      lostReason = await ui.promptDialog({ title: 'Closed lost', label: 'Why was this opportunity lost? (optional)', confirmLabel: 'Move to Closed Lost' });
      if (lostReason === null) return; // cancelled
    }
    await ui.run(async () => {
      await store().deals.move(id, stage, beforeId);
      if (lostReason) await store().deals.update(id, { lostReason });
    });
    if (stage !== deal.stage) ui.toast(`Moved to ${S.stageById(stage).name}`, 'success', 2000);
  }

  /** Card the pointer is above, used to compute the insert position. */
  function cardAfter(list, y) {
    const cards = [...list.querySelectorAll('.deal-card:not(.is-dragging)')];
    return cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
  }

  function column(stage, deals) {
    const total = deals.reduce((s, d) => s + d.amount, 0);
    const list = h('div.column-list', { dataset: { stage: stage.id } },
      deals.length ? deals.map(dealCard) : h('div.column-empty', 'Drop deals here'));
    const col = h('section.column', { style: { '--c': stage.color }, dataset: { stage: stage.id } },
      h('header.column-head',
        h('div.row', h('span.dot'), h('h3', stage.name), h('span.count', deals.length)),
        h('div.column-sub', h('span', U.formatMoney(total)),
          h('button.icon-btn.sm', { title: stage.definition, 'aria-label': 'Stage definition', onclick: (e) => { e.stopPropagation(); col.classList.toggle('show-def'); } }, icon('info'))),
        h('p.column-def', stage.definition),
      ),
      list,
      stage.open ? h('button.column-add', { onclick: () => ui.openDealEditor(null, { stage: stage.id }) }, icon('plus'), 'Add opportunity') : null,
    );
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('is-over');
      const after = cardAfter(list, e.clientY);
      let marker = document.querySelector('.drop-marker') || h('div.drop-marker');
      if (after) list.insertBefore(marker, after); else list.appendChild(marker);
    });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) { col.classList.remove('is-over'); } });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('is-over');
      const id = e.dataTransfer.getData('text/plain');
      const after = cardAfter(list, e.clientY);
      document.querySelectorAll('.drop-marker').forEach((m) => m.remove());
      if (id) moveDeal(id, stage.id, after ? after.dataset.id : null);
    });
    return col;
  }

  function render(root) {
    const matches = (d) => {
      const q = U.normalize(view.filter);
      if (!q) return true;
      const acct = store().accounts.get(d.accountId);
      return U.normalize([d.name, acct && acct.name, d.partner, d.accountExec, d.products.join(' ')].join(' ')).includes(q);
    };
    const all = store().deals.list().filter(matches);
    const open = all.filter((d) => S.stageById(d.stage).open);
    const won = all.filter((d) => d.stage === 'closed_won');
    const wonAmt = won.reduce((s, d) => s + d.amount, 0);
    const openAmt = open.reduce((s, d) => s + d.amount, 0);
    const overdue = store().tasks.list({ status: 'open' }).filter((t) => t.dueDate && t.dueDate < U.todayISO()).length;

    const search = h('input.input.search', {
      type: 'search', placeholder: 'Filter deals, accounts, partners…', value: view.filter,
      oninput: (e) => { view.filter = e.target.value; paintBoard(); },
    });
    const board = h('div.board');
    const paintBoard = () => {
      const rows = store().deals.list().filter(matches);
      clear(board).append(...S.STAGES.filter((s) => s.open || view.showClosed).map((s) => column(s, rows.filter((d) => d.stage === s.id))));
    };
    paintBoard();

    clear(root).append(
      h('div.page-head',
        h('div.stats',
          h('div.stat', h('span.stat-v', U.formatMoney(openAmt)), h('span.stat-l', `Open pipeline · ${open.length} deals`)),
          h('div.stat', h('span.stat-v', U.formatMoney(wonAmt)), h('span.stat-l', `Closed won · ${won.length}`)),
          h('div.stat' + (overdue ? '.stat-warn' : ''), { onclick: () => NX.app.navigate('tasks'), style: { cursor: 'pointer' } },
            h('span.stat-v', overdue), h('span.stat-l', 'Overdue tasks')),
        ),
        h('div.row.wrap',
          search,
          h('label.toggle', h('input', { type: 'checkbox', checked: view.showClosed, onchange: (e) => { view.showClosed = e.target.checked; paintBoard(); } }), 'Show closed'),
          h('button.btn', { onclick: () => ui.openDealEditor(null) }, icon('plus'), 'Opportunity'),
        ),
      ),
      store().deals.list().length ? board : ui.emptyState('Your pipeline is empty',
        'Add your first opportunity, or click "New meeting" and paste notes — the account and deal are created for you.',
        h('div.row', h('button.btn.btn-primary', { onclick: () => ui.openNewMeeting() }, icon('spark'), 'New meeting'),
          h('button.btn', { onclick: () => ui.openDealEditor(null) }, icon('plus'), 'Add opportunity'),
          h('button.btn.btn-ghost', { onclick: () => NX.sample.load() }, 'Load sample data'))),
    );
  }

  NX.views = NX.views || {};
  NX.views.pipeline = { title: 'Pipeline', render };
})(globalThis.NX = globalThis.NX || {});
