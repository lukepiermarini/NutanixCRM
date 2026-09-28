/* Reusable presentational pieces shared across views. */
(function (NX) {
  'use strict';
  const { h, icon } = NX.dom;
  const U = NX.util;
  const S = NX.schema;
  const store = () => NX.app.store;

  function field(label, input, hint) {
    return h('label.field', h('span.field-label', label), input, hint ? h('small.hint', hint) : null);
  }

  function stageBadge(stageId) {
    const s = S.stageById(stageId);
    return h('span.badge', { style: { '--c': s.color }, title: s.definition }, s.name);
  }

  function priorityChip(p) { return h(`span.chip.prio-${p}`, p); }

  const ownerLabel = (id) => (S.TASK_OWNERS.find((o) => o.id === id) || S.TASK_OWNERS[0]).label;

  function dueChip(task) {
    const diff = task.dueDate ? U.daysBetween(U.todayISO(), task.dueDate) : null;
    const cls = task.status === 'done' ? 'due-done' : diff === null ? 'due-none' : diff < 0 ? 'due-overdue' : diff === 0 ? 'due-today' : diff <= 3 ? 'due-soon' : 'due-later';
    return h(`span.due.${cls}`, { title: task.dueDate ? U.formatDate(task.dueDate) : '' }, icon('cal'), U.relativeDue(task.dueDate));
  }

  function stageSelect(value, attrs) {
    return h('select.input', { value, ...attrs }, S.STAGES.map((s) => h('option', { value: s.id }, `${s.order}. ${s.name}`)));
  }

  function ownerSelect(value, attrs) {
    return h('select.input', { value, ...attrs }, S.TASK_OWNERS.map((o) => h('option', { value: o.id }, o.label)));
  }

  function prioritySelect(value, attrs) {
    return h('select.input', { value, ...attrs }, S.PRIORITIES.map((p) => h('option', { value: p }, p[0].toUpperCase() + p.slice(1))));
  }

  function accountSelect(value, attrs, { allowEmpty = 'None', allowNew = false } = {}) {
    return h('select.input', { value, ...attrs },
      allowEmpty ? h('option', { value: '' }, allowEmpty) : null,
      allowNew ? h('option', { value: '__new__' }, '+ New account…') : null,
      store().accounts.list().map((a) => h('option', { value: a.id }, a.name)));
  }

  function dealSelect(accountId, value, attrs, { allowEmpty = 'None', allowNew = false } = {}) {
    const deals = accountId ? store().deals.list({ accountId }) : [];
    return h('select.input', { value, ...attrs },
      allowEmpty ? h('option', { value: '' }, allowEmpty) : null,
      allowNew ? h('option', { value: '__new__' }, '+ New opportunity…') : null,
      deals.map((d) => h('option', { value: d.id }, `${d.name} (${S.stageById(d.stage).short})`)));
  }

  function emptyState(title, text, action) {
    return h('div.empty', h('div.empty-title', title), text ? h('p.muted', text) : null, action || null);
  }

  /** A single task line with inline complete / reschedule. */
  function taskRow(task, { showContext = true } = {}) {
    const acct = task.accountId ? store().accounts.get(task.accountId) : null;
    const deal = task.dealId ? store().deals.get(task.dealId) : null;
    const done = task.status === 'done';
    const date = h('input.input.input-date', {
      type: 'date', value: task.dueDate, title: 'Reschedule',
      onchange: (e) => store().tasks.update(task.id, { dueDate: e.target.value }),
      onclick: (e) => e.stopPropagation(),
    });
    return h('div.task-row' + (done ? '.is-done' : ''), { dataset: { id: task.id } },
      h('input.check', {
        type: 'checkbox', checked: done, title: done ? 'Mark open' : 'Mark done', 'aria-label': 'Complete task',
        onchange: (e) => store().tasks.complete(task.id, e.target.checked),
      }),
      h('div.task-main', { onclick: () => NX.ui.openTaskEditor(task.id) },
        h('div.task-title', task.title),
        h('div.task-meta',
          dueChip(task),
          priorityChip(task.priority),
          h('span.muted', ownerLabel(task.owner) + (task.ownerName ? ' · ' + task.ownerName : '')),
          showContext && acct ? h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); e.stopPropagation(); NX.ui.openAccountDrawer(acct.id); } }, acct.name) : null,
          showContext && deal ? h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); e.stopPropagation(); NX.ui.openDealDrawer(deal.id); } }, deal.name) : null,
          task.meetingId && store().meetings.get(task.meetingId)
            ? h('a.link.muted', { href: '#', onclick: (e) => { e.preventDefault(); e.stopPropagation(); NX.ui.openMeeting(task.meetingId); } }, icon('doc'), 'meeting') : null,
        ),
      ),
      date,
    );
  }

  function list(items, className) {
    return items && items.length ? h('ul.' + (className || 'bullets'), items.map((i) => h('li', i))) : null;
  }

  function section(title, content, extra) {
    if (!content) return null;
    return h('section.section', h('div.section-head', h('h3', title), extra || null), content);
  }

  /** Download a single task as an .ics calendar reminder. */
  function downloadICS(task) {
    const d = (task.dueDate || U.todayISO()).replace(/-/g, '');
    const next = U.addDays(task.dueDate || U.todayISO(), 1).replace(/-/g, '');
    const esc = (s) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
    const acct = task.accountId ? store().accounts.get(task.accountId) : null;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SE Pipeline//EN', 'BEGIN:VEVENT',
      'UID:' + task.id + '@se-pipeline', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''),
      'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + next,
      'SUMMARY:' + esc((acct ? acct.name + ': ' : '') + task.title),
      'DESCRIPTION:' + esc(task.details || ''),
      'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = h('a', { href: url, download: 'task-' + d + '.ics' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  NX.ui = Object.assign(NX.ui || {}, {
    field, stageBadge, priorityChip, ownerLabel, dueChip, stageSelect, ownerSelect, prioritySelect,
    accountSelect, dealSelect, emptyState, taskRow, list, section, downloadICS,
  });
})(globalThis.NX = globalThis.NX || {});
