/* Create/edit forms and detail drawers for deals, accounts and tasks. */
(function (NX) {
  'use strict';
  const { h, icon } = NX.dom;
  const U = NX.util;
  const S = NX.schema;
  const ui = NX.ui;
  const store = () => NX.app.store;

  const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

  /** Keeps a drawer in sync with the store; closes it if its record disappears. */
  function liveDrawer({ title, size, render, exists }) {
    let off;
    const panel = ui.openPanel({ kind: 'drawer', size: size || 'lg', title, body: h('div'), onClose: () => off && off() });
    const paint = () => {
      if (!exists()) return panel.close();
      const scroll = panel.el.querySelector('.panel-body').scrollTop;
      panel.setBody(render(panel));
      panel.el.querySelector('.panel-body').scrollTop = scroll;
    };
    off = store().on(paint);
    paint();
    return panel;
  }

  async function run(fn, okMsg) {
    try { const r = await fn(); if (okMsg) ui.toast(okMsg, 'success'); return r; }
    catch (err) { console.error(err); ui.toast(err.message || String(err), 'error', 6000); throw err; }
  }

  // ---------------------------------------------------------------- Deals
  function openDealEditor(dealId, defaults = {}) {
    const deal = dealId ? store().deals.get(dealId) : null;
    const d = deal || { stage: 'identified', ...defaults };
    const f = {};
    f.account = ui.accountSelect(d.accountId || '', {}, { allowEmpty: 'Select account…', allowNew: true });
    f.newAccount = h('input.input', { placeholder: 'New account name', hidden: true });
    f.account.addEventListener('change', () => { f.newAccount.hidden = f.account.value !== '__new__'; if (!f.newAccount.hidden) f.newAccount.focus(); });
    f.name = h('input.input', { value: d.name || '', placeholder: 'e.g. VMware exit – 12 node AHV cluster', autofocus: true });
    f.stage = ui.stageSelect(d.stage);
    f.amount = h('input.input', { type: 'number', min: 0, step: 1000, value: d.amount || '', placeholder: '0' });
    f.closeDate = h('input.input', { type: 'date', value: d.closeDate || '' });
    f.useCase = h('textarea.input', { rows: 2, value: d.useCase || '', placeholder: 'Primary use case / workload' });
    f.products = h('input.input', { value: (d.products || []).join(', '), placeholder: 'NCI, NC2, NUS, NDB…' });
    f.partner = h('input.input', { value: d.partner || '' });
    f.ae = h('input.input', { value: d.accountExec || '' });
    f.competitors = h('input.input', { value: (d.competitors || []).join(', '), placeholder: 'VMware, Dell VxRail…' });
    f.success = h('textarea.input', { rows: 2, value: d.successCriteria || '', placeholder: 'POC / technical success criteria' });
    f.nextStep = h('input.input', { value: d.nextStep || '' });
    f.lost = h('input.input', { value: d.lostReason || '', placeholder: 'Why was it lost?' });
    const lostField = ui.field('Lost reason', f.lost);
    const syncLost = () => { lostField.hidden = f.stage.value !== 'closed_lost'; };
    f.stage.addEventListener('change', syncLost); syncLost();

    const save = async () => {
      let accountId = f.account.value;
      if (accountId === '__new__') {
        const name = f.newAccount.value.trim();
        if (!name) return ui.toast('Enter the new account name', 'error');
        accountId = (store().accounts.findByName(name) || await store().accounts.create({ name })).id;
      }
      if (!accountId) return ui.toast('Pick an account', 'error');
      const data = {
        accountId, name: f.name.value, stage: f.stage.value, amount: f.amount.value, closeDate: f.closeDate.value,
        useCase: f.useCase.value, products: csv(f.products.value), partner: f.partner.value, accountExec: f.ae.value,
        competitors: csv(f.competitors.value), successCriteria: f.success.value, nextStep: f.nextStep.value,
        lostReason: f.stage.value === 'closed_lost' ? f.lost.value : '',
      };
      await run(() => (deal ? store().deals.update(deal.id, data) : store().deals.create(data)), deal ? 'Deal updated' : 'Deal created');
      p.close();
    };

    const p = ui.openPanel({
      title: deal ? 'Edit opportunity' : 'New opportunity',
      body: h('form.form-grid', { onsubmit: (e) => { e.preventDefault(); save(); } },
        h('div.span-2', ui.field('Account', f.account), f.newAccount),
        h('div.span-2', ui.field('Opportunity name', f.name)),
        ui.field('Stage', f.stage), ui.field('Amount (USD)', f.amount),
        ui.field('Target close date', f.closeDate), ui.field('Partner', f.partner),
        ui.field('Account Exec', f.ae), ui.field('Competitors', f.competitors),
        h('div.span-2', ui.field('Products', f.products)),
        h('div.span-2', ui.field('Use case', f.useCase)),
        h('div.span-2', ui.field('Success criteria', f.success)),
        h('div.span-2', ui.field('Next step', f.nextStep)),
        h('div.span-2', lostField),
        h('button', { type: 'submit', hidden: true }),
      ),
      footer: () => h('div.row.end', h('button.btn', { onclick: () => p.close() }, 'Cancel'), h('button.btn.btn-primary', { onclick: save }, deal ? 'Save' : 'Create')),
    });
    return p;
  }

  function openDealDrawer(dealId) {
    return liveDrawer({
      title: 'Opportunity',
      exists: () => !!store().deals.get(dealId),
      render: (panel) => {
        const d = store().deals.get(dealId);
        const acct = store().accounts.get(d.accountId);
        panel.setTitle(d.name);
        const tasks = store().tasks.list({ dealId });
        const meetings = store().meetings.list({ dealId });
        const stageSel = ui.stageSelect(d.stage, {
          onchange: async (e) => {
            const patch = { stage: e.target.value };
            if (e.target.value === 'closed_lost') {
              const reason = await ui.promptDialog({ title: 'Closed lost', label: 'Reason (optional)', value: d.lostReason });
              patch.lostReason = reason || '';
            }
            run(() => store().deals.update(dealId, patch), 'Stage updated');
          },
        });
        return h('div.stack',
          h('div.row.wrap',
            h('button.btn.btn-primary', { onclick: () => NX.ui.openNewMeeting({ accountId: d.accountId, dealId }) }, icon('spark'), 'New meeting'),
            h('button.btn', { onclick: () => openTaskEditor(null, { accountId: d.accountId, dealId }) }, icon('plus'), 'Task'),
            h('button.btn', { onclick: () => openDealEditor(dealId) }, icon('edit'), 'Edit'),
            h('span.grow'),
            h('button.btn.btn-ghost.danger', {
              onclick: async () => {
                if (await ui.confirmDialog({ title: 'Delete opportunity?', message: `"${d.name}" and its tasks will be deleted. Meetings are kept on the account.`, confirmLabel: 'Delete', danger: true })) {
                  run(() => store().deals.remove(dealId), 'Deal deleted');
                }
              },
            }, icon('trash'), 'Delete'),
          ),
          h('div.kv-grid',
            h('div', h('span.k', 'Account'), acct ? h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); openAccountDrawer(acct.id); } }, acct.name) : '—'),
            h('div', h('span.k', 'Stage'), stageSel),
            h('div', h('span.k', 'Amount'), U.formatMoney(d.amount)),
            h('div', h('span.k', 'Close date'), d.closeDate ? U.formatDate(d.closeDate) : '—'),
            h('div', h('span.k', 'Partner'), d.partner || '—'),
            h('div', h('span.k', 'Account Exec'), d.accountExec || '—'),
            h('div', h('span.k', 'Products'), d.products.join(', ') || '—'),
            h('div', h('span.k', 'Competitors'), d.competitors.join(', ') || '—'),
          ),
          h('p.stage-def', icon('info'), S.stageById(d.stage).definition),
          d.nextStep ? ui.section('Next step', h('p', d.nextStep)) : null,
          d.useCase ? ui.section('Use case', h('p.pre', d.useCase)) : null,
          d.successCriteria ? ui.section('Success criteria', h('p.pre', d.successCriteria)) : null,
          d.lostReason ? ui.section('Lost reason', h('p', d.lostReason)) : null,
          ui.section(`Tasks (${tasks.filter((t) => t.status === 'open').length} open)`,
            tasks.length ? h('div.task-list', tasks.map((t) => ui.taskRow(t, { showContext: false }))) : h('p.muted', 'No tasks yet.')),
          ui.section(`Meetings (${meetings.length})`,
            meetings.length ? h('div.meeting-list', meetings.map(meetingItem)) : h('p.muted', 'No meetings logged yet.')),
          ui.section('Stage history', h('ol.timeline', [...d.stageHistory].reverse().map((s) =>
            h('li', ui.stageBadge(s.stage), h('span.muted', new Date(s.at).toLocaleString()))))),
        );
      },
    });
  }

  function meetingItem(m) {
    return h('button.meeting-item', { onclick: () => NX.ui.openMeeting(m.id) },
      h('div.meeting-item-head', h('strong', m.title), h('span.muted', U.formatDate(m.date))),
      m.summary ? h('div.muted.clamp-2', m.summary) : null);
  }

  // ---------------------------------------------------------------- Accounts
  function openAccountEditor(accountId) {
    const a = accountId ? store().accounts.get(accountId) : {};
    const f = {
      name: h('input.input', { value: a.name || '', autofocus: true }),
      industry: h('input.input', { value: a.industry || '' }),
      partner: h('input.input', { value: a.partner || '' }),
      website: h('input.input', { value: a.website || '' }),
      notes: h('textarea.input', { rows: 4, value: a.notes || '' }),
    };
    const contacts = (a.contacts || []).map((c) => ({ ...c }));
    const contactsEl = h('div.contacts-edit');
    const paintContacts = () => {
      NX.dom.clear(contactsEl);
      contacts.forEach((c, i) => {
        const inp = (k, ph) => h('input.input', { value: c[k] || '', placeholder: ph, oninput: (e) => (c[k] = e.target.value) });
        contactsEl.appendChild(h('div.contact-row', inp('name', 'Name'), inp('title', 'Title'), inp('email', 'Email'), inp('role', 'Role (champion, DM…)'),
          h('button.icon-btn', { type: 'button', title: 'Remove', onclick: () => { contacts.splice(i, 1); paintContacts(); } }, icon('x'))));
      });
      contactsEl.appendChild(h('button.btn.btn-ghost', { type: 'button', onclick: () => { contacts.push({ name: '' }); paintContacts(); } }, icon('plus'), 'Add contact'));
    };
    paintContacts();
    const save = async () => {
      if (!f.name.value.trim()) return ui.toast('Account name is required', 'error');
      const dup = store().accounts.findByName(f.name.value);
      if (dup && dup.id !== accountId) return ui.toast('An account with that name already exists', 'error');
      const data = { name: f.name.value, industry: f.industry.value, partner: f.partner.value, website: f.website.value, notes: f.notes.value, contacts };
      await run(() => (accountId ? store().accounts.update(accountId, data) : store().accounts.create(data)), accountId ? 'Account updated' : 'Account created');
      p.close();
    };
    const p = ui.openPanel({
      title: accountId ? 'Edit account' : 'New account',
      body: h('div.form-grid',
        h('div.span-2', ui.field('Account name', f.name)),
        ui.field('Industry', f.industry), ui.field('Partner / reseller', f.partner),
        h('div.span-2', ui.field('Website', f.website)),
        h('div.span-2', h('span.field-label', 'Contacts'), contactsEl),
        h('div.span-2', ui.field('Notes', f.notes)),
      ),
      footer: () => h('div.row.end', h('button.btn', { onclick: () => p.close() }, 'Cancel'), h('button.btn.btn-primary', { onclick: save }, 'Save')),
    });
  }

  function openAccountDrawer(accountId) {
    return liveDrawer({
      title: 'Account',
      exists: () => !!store().accounts.get(accountId),
      render: (panel) => {
        const a = store().accounts.get(accountId);
        panel.setTitle(a.name);
        const deals = store().deals.list({ accountId });
        const tasks = store().tasks.list({ accountId });
        const meetings = store().meetings.list({ accountId });
        return h('div.stack',
          h('div.row.wrap',
            h('button.btn.btn-primary', { onclick: () => NX.ui.openNewMeeting({ accountId }) }, icon('spark'), 'New meeting'),
            h('button.btn', { onclick: () => openDealEditor(null, { accountId }) }, icon('plus'), 'Opportunity'),
            h('button.btn', { onclick: () => openTaskEditor(null, { accountId }) }, icon('plus'), 'Task'),
            h('button.btn', { onclick: () => openAccountEditor(accountId) }, icon('edit'), 'Edit'),
            h('span.grow'),
            h('button.btn.btn-ghost.danger', {
              onclick: async () => {
                if (await ui.confirmDialog({ title: 'Delete account?', message: `This permanently deletes "${a.name}" with ${deals.length} deal(s), ${meetings.length} meeting(s) and ${tasks.length} task(s).`, confirmLabel: 'Delete everything', danger: true })) {
                  run(() => store().accounts.remove(accountId), 'Account deleted');
                }
              },
            }, icon('trash'), 'Delete'),
          ),
          h('div.kv-grid',
            h('div', h('span.k', 'Industry'), a.industry || '—'),
            h('div', h('span.k', 'Partner'), a.partner || '—'),
            h('div', h('span.k', 'Website'), a.website || '—'),
            h('div', h('span.k', 'Open pipeline'), U.formatMoney(deals.filter((d) => S.stageById(d.stage).open).reduce((s, d) => s + d.amount, 0))),
          ),
          a.notes ? ui.section('Notes', h('p.pre', a.notes)) : null,
          a.contacts.length ? ui.section('Contacts', h('div.contacts', a.contacts.map((c) =>
            h('div.contact', h('strong', c.name), h('span.muted', [c.title, c.role].filter(Boolean).join(' · ')), c.email ? h('a.link', { href: 'mailto:' + c.email }, c.email) : null)))) : null,
          ui.section(`Opportunities (${deals.length})`, deals.length ? h('div.deal-mini-list', deals.map((d) =>
            h('button.deal-mini', { onclick: () => openDealDrawer(d.id) }, h('strong', d.name), ui.stageBadge(d.stage), h('span.muted', U.formatMoney(d.amount)))))
            : h('p.muted', 'No opportunities yet.')),
          ui.section(`Tasks (${tasks.filter((t) => t.status === 'open').length} open)`, tasks.length ? h('div.task-list', tasks.map((t) => ui.taskRow(t, { showContext: false }))) : h('p.muted', 'No tasks.')),
          ui.section(`Meetings (${meetings.length})`, meetings.length ? h('div.meeting-list', meetings.map(meetingItem)) : h('p.muted', 'No meetings yet.')),
        );
      },
    });
  }

  // ---------------------------------------------------------------- Tasks
  function openTaskEditor(taskId, defaults = {}) {
    const t = taskId ? store().tasks.get(taskId) : { priority: 'medium', owner: 'me', dueDate: U.addBusinessDays(U.todayISO(), 2), ...defaults };
    if (!t) return;
    const f = {
      title: h('input.input', { value: t.title || '', autofocus: true, placeholder: 'What needs to happen?' }),
      details: h('textarea.input', { rows: 3, value: t.details || '' }),
      due: h('input.input', { type: 'date', value: t.dueDate || '' }),
      priority: ui.prioritySelect(t.priority),
      owner: ui.ownerSelect(t.owner),
      ownerName: h('input.input', { value: t.ownerName || '', placeholder: 'Person (optional)' }),
      account: ui.accountSelect(t.accountId || ''),
    };
    const dealWrap = h('div');
    const paintDeals = (val) => { NX.dom.clear(dealWrap).appendChild(f.deal = ui.dealSelect(f.account.value, val || '')); };
    paintDeals(t.dealId);
    f.account.addEventListener('change', () => paintDeals(''));

    const save = async () => {
      if (!f.title.value.trim()) return ui.toast('Task title is required', 'error');
      const data = { title: f.title.value, details: f.details.value, dueDate: f.due.value, priority: f.priority.value, owner: f.owner.value, ownerName: f.ownerName.value, accountId: f.account.value, dealId: f.deal.value };
      await run(() => (taskId ? store().tasks.update(taskId, data) : store().tasks.create(data)), taskId ? 'Task updated' : 'Task added');
      p.close();
    };
    const p = ui.openPanel({
      title: taskId ? 'Edit task' : 'New task', size: 'md',
      body: h('form.form-grid', { onsubmit: (e) => { e.preventDefault(); save(); } },
        h('div.span-2', ui.field('Task', f.title)),
        ui.field('Due date', f.due), ui.field('Priority', f.priority),
        ui.field('Owner', f.owner), ui.field('Owner name', f.ownerName),
        ui.field('Account', f.account), h('label.field', h('span.field-label', 'Opportunity'), dealWrap),
        h('div.span-2', ui.field('Details', f.details)),
        h('button', { type: 'submit', hidden: true }),
      ),
      footer: () => h('div.row',
        taskId ? h('button.btn.btn-ghost.danger', { onclick: async () => { await run(() => store().tasks.remove(taskId), 'Task deleted'); p.close(); } }, icon('trash'), 'Delete') : null,
        taskId ? h('button.btn.btn-ghost', { onclick: () => ui.downloadICS(store().tasks.get(taskId)) }, icon('cal'), 'Add to calendar') : null,
        h('span.grow'),
        h('button.btn', { onclick: () => p.close() }, 'Cancel'),
        h('button.btn.btn-primary', { onclick: save }, 'Save')),
    });
  }

  NX.ui = Object.assign(NX.ui || {}, { openDealEditor, openDealDrawer, openAccountEditor, openAccountDrawer, openTaskEditor, meetingItem, liveDrawer, run });
})(globalThis.NX = globalThis.NX || {});
