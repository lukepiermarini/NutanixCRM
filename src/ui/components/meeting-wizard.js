/* "New meeting" flow: capture notes -> analyze -> review & edit -> save.
 * Saving creates the meeting, the accepted action items as dated tasks,
 * the account / opportunity if new, and applies the accepted stage move. */
(function (NX) {
  'use strict';
  const { h, icon, clear } = NX.dom;
  const U = NX.util;
  const S = NX.schema;
  const ui = NX.ui;
  const store = () => NX.app.store;

  const TEXT_EXT = /\.(txt|vtt|srt|md|markdown|text|csv|log|json|html?)$/i;

  async function readDroppedFile(file) {
    if (!TEXT_EXT.test(file.name) && !/^text\//.test(file.type)) {
      throw new Error(`"${file.name}" isn't a text file. Export Zoom notes as .txt/.vtt, or copy & paste them.`);
    }
    let text = await file.text();
    if (/\.html?$/i.test(file.name)) text = new DOMParser().parseFromString(text, 'text/html').body.innerText;
    return text;
  }

  function openNewMeeting(defaults = {}) {
    const state = {
      step: 'capture',
      accountId: defaults.accountId || '',
      dealId: defaults.dealId || '',
      date: U.todayISO(),
      dateTouched: false,
      notes: '',
    };
    const p = ui.openPanel({
      title: 'New meeting', size: 'lg', sticky: true,
      body: h('div'),
      beforeClose: () => {
        if (state.step === 'review' || (state.step === 'capture' && state.notes.trim().length > 40)) {
          return window.confirm('Discard this meeting? Your notes and analysis will be lost.');
        }
        return true;
      },
    });

    // ------------------------------------------------------------ Step 1
    function renderCapture() {
      state.step = 'capture';
      p.setTitle('New meeting');
      const settings = store().settings.get();
      const acctSel = ui.accountSelect(state.accountId, {}, { allowEmpty: 'Auto-detect from notes' });
      const dealWrap = h('div');
      const paintDeal = () => {
        clear(dealWrap).appendChild(ui.dealSelect(acctSel.value, state.dealId, { onchange: (e) => (state.dealId = e.target.value) }, { allowEmpty: acctSel.value ? 'Auto-detect / none' : 'Auto-detect' }));
      };
      acctSel.addEventListener('change', () => { state.accountId = acctSel.value; state.dealId = ''; paintDeal(); });
      paintDeal();
      const date = h('input.input', { type: 'date', value: state.date, onchange: (e) => { state.date = e.target.value; state.dateTouched = true; } });
      const ta = h('textarea.input.notes-input', {
        value: state.notes, rows: 14, autofocus: true,
        placeholder: 'Paste the Zoom transcript, Zoom AI Companion summary, or your own rough notes here…\n\nOr drag & drop a .txt / .vtt / .md file anywhere in this box.',
        oninput: (e) => { state.notes = e.target.value; counter.textContent = e.target.value.length.toLocaleString() + ' chars'; },
      });
      const counter = h('span.muted.small', state.notes.length.toLocaleString() + ' chars');
      const drop = h('div.dropzone', ta, h('div.dropzone-hint', icon('upload'), 'Drop notes file'));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
      drop.addEventListener('drop', async (e) => {
        e.preventDefault();
        const files = [...(e.dataTransfer.files || [])];
        if (!files.length) return;
        try {
          const texts = await Promise.all(files.map(readDroppedFile));
          state.notes = (state.notes ? state.notes + '\n\n' : '') + texts.join('\n\n');
          ta.value = state.notes; ta.dispatchEvent(new Event('input'));
          ui.toast(`Loaded ${files.length} file(s)`, 'success');
        } catch (err) { ui.toast(err.message, 'error', 6000); }
      });
      const fileBtn = h('input', { type: 'file', accept: '.txt,.vtt,.srt,.md,.html,text/*', multiple: true, hidden: true,
        onchange: async (e) => {
          try {
            const texts = await Promise.all([...e.target.files].map(readDroppedFile));
            state.notes = (state.notes ? state.notes + '\n\n' : '') + texts.join('\n\n');
            ta.value = state.notes; ta.dispatchEvent(new Event('input'));
          } catch (err) { ui.toast(err.message, 'error', 6000); }
        } });

      const engineNote = h('div.stack-sm',
        h('span.engine.engine-ai', icon('spark'), 'Works best with a Zoom AI Companion summary or a Zoom transcript (.vtt/.txt). Rough notes work too.'),
        settings.userName ? null : h('span.engine', icon('info'), 'Tip: add your name in ',
          h('a.link', { href: '#/settings', onclick: () => p.close() }, 'Settings'), ' so your own action items are assigned to you.'));

      p.setBody(h('div.stack',
        h('div.form-grid.cols-3',
          ui.field('Account', acctSel), h('label.field', h('span.field-label', 'Opportunity'), dealWrap), ui.field('Meeting date', date)),
        h('div.field', h('div.row', h('span.field-label', 'Meeting notes'), h('span.grow'), counter,
          h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => fileBtn.click() }, icon('upload'), 'Choose file'), fileBtn), drop),
        engineNote,
      ));
      p.setFooter(h('div.row',
        h('button.btn.btn-ghost', { onclick: () => { state.notes = ''; renderReview(blankResult(), 'manual'); } }, 'Skip — enter manually'),
        h('span.grow'),
        h('button.btn', { onclick: () => p.close() }, 'Cancel'),
        h('button.btn.btn-primary', { onclick: analyze }, icon('spark'), 'Process notes'),
      ));
    }

    function blankResult() {
      const acct = store().accounts.get(state.accountId);
      return NX.analyzer.sanitize({
        title: acct ? acct.name + ' – meeting' : 'Meeting', meetingDate: state.date,
        matchedAccountId: state.accountId, matchedDealId: state.dealId, actionItems: [], suggestedStage: 'no_change',
      }, aiContext());
    }

    function aiContext() {
      return {
        accounts: store().accounts.list(), deals: store().deals.list(),
        userName: store().settings.get().userName, meetingDate: state.date,
        accountId: state.accountId, dealId: state.dealId, meetingDateLocked: state.dateTouched,
      };
    }

    // ------------------------------------------------------------ Step 2
    function analyze() {
      if (!state.notes.trim()) return ui.toast('Paste or drop your meeting notes first', 'error');
      try {
        renderReview(NX.analyzer.processNotes(state.notes, aiContext()), 'auto');
      } catch (err) {
        console.error(err);
        ui.toast(err.message || String(err), 'error', 6000);
      }
    }

    // ------------------------------------------------------------ Step 3
    function renderReview(r, engine) {
      state.step = 'review';
      p.setTitle('Review meeting');
      const model = {
        accountId: state.accountId || r.matchedAccountId || '',
        newAccountName: r.suggestedAccountName,
        dealId: state.dealId || r.matchedDealId || '',
        newDealName: r.suggestedDealName,
        items: r.actionItems.map((a) => ({ ...a, include: true })),
      };
      if (model.accountId && !store().accounts.get(model.accountId)) model.accountId = '';
      if (!model.accountId && model.newAccountName) {
        const existing = store().accounts.findByName(model.newAccountName);
        if (existing) model.accountId = existing.id;
      }

      // --- Account / deal association
      const acctSel = ui.accountSelect(model.accountId || (model.newAccountName ? '__new__' : ''), {}, { allowEmpty: 'Select account…', allowNew: true });
      const newAcct = h('input.input', { value: model.newAccountName, placeholder: 'New account name' });
      const dealWrap = h('div');
      const newDeal = h('input.input', { value: model.newDealName || '', placeholder: 'New opportunity name' });
      const stageWrap = h('div');
      let dealSel;
      const paintAssoc = () => {
        newAcct.hidden = acctSel.value !== '__new__';
        const acctId = acctSel.value === '__new__' ? '' : acctSel.value;
        const currentDeal = acctId && store().deals.get(model.dealId) && store().deals.get(model.dealId).accountId === acctId ? model.dealId : '';
        dealSel = ui.dealSelect(acctId, currentDeal || (model.newDealName ? '__new__' : ''), {}, { allowEmpty: 'No opportunity', allowNew: true });
        dealSel.addEventListener('change', () => { newDeal.hidden = dealSel.value !== '__new__'; paintStage(); });
        clear(dealWrap).append(dealSel, newDeal);
        newDeal.hidden = dealSel.value !== '__new__';
        paintStage();
      };
      acctSel.addEventListener('change', paintAssoc);

      // --- Stage recommendation
      const moveChk = h('input', { type: 'checkbox' });
      const moveSel = ui.stageSelect(r.suggestedStage !== 'no_change' ? r.suggestedStage : 'identified');
      const paintStage = () => {
        const deal = dealSel && store().deals.get(dealSel.value);
        const isNew = dealSel && dealSel.value === '__new__';
        clear(stageWrap);
        if (!deal && !isNew) return;
        const current = deal ? deal.stage : 'identified';
        const suggested = r.suggestedStage !== 'no_change' && r.suggestedStage !== current;
        moveChk.checked = suggested;
        if (suggested) moveSel.value = r.suggestedStage; else moveSel.value = current;
        stageWrap.append(h('div.stage-reco' + (suggested ? '.is-suggested' : ''),
          h('div.row.wrap', h('span', 'Current stage:'), ui.stageBadge(current)),
          h('label.row.wrap', moveChk, h('span', 'Move opportunity to'), moveSel),
          r.stageRationale ? h('p.muted.small', icon('spark'), r.stageRationale) : null,
        ));
      };

      // --- Editable content
      const title = h('input.input', { value: r.title });
      const date = h('input.input', { type: 'date', value: r.meetingDate || state.date });
      const summary = h('textarea.input', { rows: 4, value: r.summary });
      const nextStep = h('input.input', { value: r.dealNextStep, placeholder: 'One-line next step shown on the deal card' });
      const listArea = (arr) => h('textarea.input', { rows: Math.min(8, Math.max(2, arr.length + 1)), value: arr.map((x) => '• ' + x).join('\n') });
      const areas = {
        discussionPoints: listArea(r.discussionPoints), painPoints: listArea(r.painPoints), requirements: listArea(r.requirements),
        environment: listArea(r.environment), risks: listArea(r.risks), decisions: listArea(r.decisions),
      };
      const attendees = h('input.input', { value: r.attendees.map((a) => a.name + (a.organization ? ` (${a.organization})` : '')).join(', ') });
      const competitors = h('input.input', { value: r.competitors.join(', ') });
      const email = h('textarea.input.mono', { rows: 8, value: r.followUpEmail });

      // --- Action items table
      const itemsEl = h('div.action-items');
      const paintItems = () => {
        clear(itemsEl);
        if (!model.items.length) itemsEl.appendChild(h('p.muted', 'No action items found.'));
        model.items.forEach((it, i) => {
          itemsEl.appendChild(h('div.action-item' + (it.include ? '' : '.is-excluded'),
            h('input', { type: 'checkbox', checked: it.include, title: 'Create task', onchange: (e) => { it.include = e.target.checked; paintItems(); } }),
            h('input.input.ai-title', { value: it.title, oninput: (e) => (it.title = e.target.value) }),
            ui.ownerSelect(it.owner, { onchange: (e) => (it.owner = e.target.value), title: 'Owner' }),
            h('input.input.ai-owner', { value: it.ownerName, placeholder: 'Name', oninput: (e) => (it.ownerName = e.target.value) }),
            h('input.input.input-date', { type: 'date', value: it.dueDate, onchange: (e) => (it.dueDate = e.target.value) }),
            ui.prioritySelect(it.priority, { onchange: (e) => (it.priority = e.target.value) }),
            h('button.icon-btn', { title: 'Remove', onclick: () => { model.items.splice(i, 1); paintItems(); } }, icon('x')),
            it.details ? h('div.ai-details.muted.small', it.details) : null,
          ));
        });
      };
      paintItems();
      paintAssoc();

      const parseList = (ta) => ta.value.split('\n').map((l) => l.replace(/^\s*[•\-*]\s*/, '').trim()).filter(Boolean);

      const save = async () => {
        let accountId = acctSel.value;
        const newAccountName = accountId === '__new__' ? newAcct.value.trim() : '';
        if (accountId === '__new__') accountId = '';
        if (!accountId && !newAccountName) return ui.toast('Choose which account this meeting belongs to', 'error');
        let dealId = dealSel.value, newDealName = '';
        if (dealId === '__new__') { newDealName = newDeal.value.trim(); dealId = ''; if (!newDealName) return ui.toast('Name the new opportunity', 'error'); }
        const deal = store().deals.get(dealId);
        const moveToStage = moveChk.checked && (deal || newDealName) ? moveSel.value : '';
        const input = {
          accountId, newAccountName, dealId, newDealName, moveToStage,
          nextStep: nextStep.value.trim(),
          competitors: competitors.value.split(',').map((s) => s.trim()).filter(Boolean),
          meeting: {
            title: title.value, date: date.value, summary: summary.value,
            attendees: attendees.value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
              const m = s.match(/^(.*?)\s*\((.*)\)$/); return m ? { name: m[1], organization: m[2] } : { name: s };
            }),
            discussionPoints: parseList(areas.discussionPoints), painPoints: parseList(areas.painPoints),
            requirements: parseList(areas.requirements), environment: parseList(areas.environment),
            risks: parseList(areas.risks), decisions: parseList(areas.decisions),
            competitors: competitors.value.split(',').map((s) => s.trim()).filter(Boolean),
            followUpEmail: email.value, stageRationale: r.stageRationale,
            rawNotes: state.notes, processedBy: engine,
          },
          tasks: model.items.filter((i) => i.include && i.title.trim()),
        };
        // If "moving" to a new deal, it starts in the chosen stage.
        const res = await ui.run(() => store().meetings.ingest(input));
        state.step = 'done';
        p.close();
        ui.toast(`Meeting saved · ${res.tasks.length} task(s) created${moveToStage && res.deal ? ' · moved to ' + S.stageById(res.deal.stage).short : ''}`, 'success', 5000);
      };

      const g = (label, el) => ui.field(label, el);
      p.setBody(h('div.stack',
        h('div.engine' + (engine === 'auto' ? '.engine-ai' : ''), icon(engine === 'auto' ? 'spark' : 'info'),
          engine === 'auto'
            ? `Analyzed ${{ summary: 'Zoom summary', transcript: 'transcript', notes: 'notes' }[r.format] || 'notes'} — found ${r.actionItems.length} next step(s). Review and adjust before saving.`
            : 'Manual entry'),
        h('div.card.stack',
          h('h3', 'Where does this go?'),
          h('div.form-grid', h('div', g('Account', acctSel), newAcct), h('label.field', h('span.field-label', 'Opportunity'), dealWrap)),
          stageWrap,
        ),
        h('div.card.stack',
          h('div.row', h('h3', `Next steps → tasks (${model.items.length})`), h('span.grow'),
            h('button.btn.btn-ghost.btn-sm', { onclick: () => { model.items.push({ title: '', details: '', owner: 'me', ownerName: '', dueDate: U.addBusinessDays(date.value || U.todayISO(), 2), priority: 'medium', include: true }); paintItems(); itemsEl.lastChild.querySelector('.ai-title').focus(); } }, icon('plus'), 'Add')),
          h('div.action-head.muted.small', h('span'), h('span', 'Action'), h('span', 'Owner'), h('span', 'Name'), h('span', 'Due'), h('span', 'Priority'), h('span')),
          itemsEl,
          g('Deal next step', nextStep),
        ),
        h('div.card.stack',
          h('h3', 'Meeting record'),
          h('div.form-grid', g('Title', title), g('Date', date)),
          g('Summary', summary),
          g('Attendees', attendees),
          h('div.form-grid',
            g('Pain points / drivers', areas.painPoints), g('Requirements / success criteria', areas.requirements),
            g('Current environment', areas.environment), g('Risks / open questions', areas.risks),
            g('Decisions', areas.decisions), g('Discussion points', areas.discussionPoints)),
          g('Competitors', competitors),
        ),
        h('div.card.stack',
          h('div.row', h('h3', 'Follow-up email draft'), h('span.grow'), h('button.btn.btn-ghost.btn-sm', { onclick: () => ui.copyText(email.value) }, icon('copy'), 'Copy')),
          email),
      ));
      p.setFooter(h('div.row',
        h('button.btn.btn-ghost', { onclick: () => renderCapture() }, '← Back to notes'),
        h('span.grow'),
        h('button.btn', { onclick: () => p.close() }, 'Cancel'),
        h('button.btn.btn-primary', { onclick: save }, icon('check'), 'Save meeting & tasks'),
      ));
      p.el.querySelector('.panel-body').scrollTop = 0;
    }

    renderCapture();
    return p;
  }

  // ------------------------------------------------------------ Meeting detail
  function openMeeting(meetingId) {
    return ui.liveDrawer({
      title: 'Meeting',
      exists: () => !!store().meetings.get(meetingId),
      render: (panel) => {
        const m = store().meetings.get(meetingId);
        panel.setTitle(m.title);
        const acct = store().accounts.get(m.accountId);
        const deal = store().deals.get(m.dealId);
        const tasks = store().tasks.list({ meetingId });
        const rawToggle = h('details.raw', h('summary', 'Original notes'), h('pre.pre', m.rawNotes || '(none)'));
        return h('div.stack',
          h('div.row.wrap',
            h('span.muted', icon('cal'), U.formatDate(m.date)),
            acct ? h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); ui.openAccountDrawer(acct.id); } }, acct.name) : null,
            deal ? h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); ui.openDealDrawer(deal.id); } }, deal.name) : null,
            m.stageBefore && m.stageAfter && m.stageBefore !== m.stageAfter ? h('span.row', ui.stageBadge(m.stageBefore), '→', ui.stageBadge(m.stageAfter)) : null,
            h('span.grow'),
            h('button.btn.btn-sm', { onclick: () => ui.copyText(recapText(m, tasks)) }, icon('copy'), 'Copy recap'),
            h('button.btn.btn-ghost.btn-sm.danger', {
              onclick: async () => {
                if (await ui.confirmDialog({ title: 'Delete meeting?', message: 'The meeting record is deleted. Tasks created from it are kept.', confirmLabel: 'Delete', danger: true })) {
                  ui.run(() => store().meetings.remove(meetingId), 'Meeting deleted');
                }
              },
            }, icon('trash')),
          ),
          m.summary ? ui.section('Summary', h('p.pre', m.summary)) : null,
          ui.section('Action items', tasks.length ? h('div.task-list', tasks.map((t) => ui.taskRow(t, { showContext: false }))) : h('p.muted', 'No tasks were created.')),
          m.attendees.length ? ui.section('Attendees', h('p', m.attendees.map((a) => a.name + (a.organization ? ` (${a.organization})` : '')).join(', '))) : null,
          ui.section('Pain points / drivers', ui.list(m.painPoints)),
          ui.section('Requirements / success criteria', ui.list(m.requirements)),
          ui.section('Current environment', ui.list(m.environment)),
          ui.section('Risks / open questions', ui.list(m.risks)),
          ui.section('Decisions', ui.list(m.decisions)),
          ui.section('Discussion', ui.list(m.discussionPoints)),
          m.competitors.length ? ui.section('Competitors', h('p', m.competitors.join(', '))) : null,
          m.stageRationale ? ui.section('Stage assessment', h('p.muted', m.stageRationale)) : null,
          m.followUpEmail ? ui.section('Follow-up email', h('pre.pre.mono', m.followUpEmail), h('button.btn.btn-ghost.btn-sm', { onclick: () => ui.copyText(m.followUpEmail) }, icon('copy'), 'Copy')) : null,
          rawToggle,
        );
      },
    });
  }

  function recapText(m, tasks) {
    const lines = [m.title + ' — ' + U.formatDate(m.date), '', m.summary, ''];
    const add = (title, arr) => { if (arr.length) lines.push(title + ':', ...arr.map((x) => '• ' + x), ''); };
    add('Pain points', m.painPoints); add('Requirements', m.requirements); add('Risks', m.risks); add('Decisions', m.decisions);
    if (tasks.length) lines.push('Next steps:', ...tasks.map((t) => `• ${t.title} (${ui.ownerLabel(t.owner)}${t.ownerName ? ' – ' + t.ownerName : ''}) – due ${U.formatDate(t.dueDate)}`));
    return lines.join('\n').trim();
  }

  NX.ui = Object.assign(NX.ui || {}, { openNewMeeting, openMeeting });
})(globalThis.NX = globalThis.NX || {});
