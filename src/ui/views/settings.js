/* Settings: profile, AI engine, storage / backup. */
(function (NX) {
  'use strict';
  const { h, icon, clear } = NX.dom;
  const U = NX.util;
  const ui = NX.ui;
  const store = () => NX.app.store;

  function render(root) {
    const s = store().settings.get();
    const fs = NX.app.fileSync;
    const fsState = fs.getState();

    const userName = h('input.input', { value: s.userName, placeholder: 'e.g. Jordan Lee' });
    const wsName = h('input.input', { value: s.workspaceName });
    const apiKey = h('input.input', { type: 'password', value: s.apiKey, placeholder: 'sk-ant-…', autocomplete: 'off' });
    const model = h('select.input', { value: s.model }, NX.ai.MODELS.map((m) => h('option', { value: m.id }, m.label)));
    const effort = h('select.input', { value: s.effort }, ['low', 'medium', 'high'].map((e) => h('option', { value: e }, e[0].toUpperCase() + e.slice(1))));
    const testOut = h('span.small');

    const saveProfile = () => ui.run(() => store().settings.update({ userName: userName.value.trim(), workspaceName: wsName.value.trim() || 'My Workspace' }), 'Saved');
    const saveAI = () => ui.run(() => store().settings.update({ apiKey: apiKey.value.trim(), model: model.value, effort: effort.value }), 'AI settings saved');

    const c = store().workspace.counts();
    const fileStatus = {
      unsupported: 'This browser can\'t write files directly (use Chrome or Edge for auto-save to a file). Your data is saved in this browser — use Export regularly as a backup.',
      disconnected: 'Not linked. Data is saved inside this browser on this PC. Link a file to also keep a live copy on disk.',
      'needs-permission': `Linked to "${fsState.fileName}" — click Reconnect to resume auto-saving (browsers ask again after a restart).`,
      saving: `Saving to "${fsState.fileName}"…`,
      saved: `Auto-saving to "${fsState.fileName}"${fsState.lastSavedAt ? ' · last saved ' + new Date(fsState.lastSavedAt).toLocaleTimeString() : ''}.`,
      error: `Could not write "${fsState.fileName}": ${fsState.error}`,
    }[fsState.status];

    const act = (fn, msg) => async () => { try { await fn(); if (msg) ui.toast(msg, 'success'); } catch (e) { if (e.name !== 'AbortError') ui.toast(e.message, 'error', 6000); } };

    clear(root).append(h('div.settings',
      h('section.card.stack',
        h('h3', 'Profile'),
        h('div.form-grid',
          ui.field('Your name', userName, 'Used to recognise your own action items in notes.'),
          ui.field('Workspace name', wsName)),
        h('div.row.end', h('button.btn.btn-primary', { onclick: saveProfile }, 'Save profile')),
      ),

      h('section.card.stack',
        h('h3', icon('spark'), 'AI meeting analysis (Claude)'),
        h('p.muted', 'With an Anthropic API key, meeting notes are analyzed by Claude for far better summaries, owners and due dates. Without one, a built-in offline parser is used. ',
          'Your key is stored only in this browser and is never included in exports or the save file. Notes are sent directly from your browser to api.anthropic.com — check your company\'s policy on customer data before enabling.'),
        h('div.form-grid',
          h('div.span-2', ui.field('Anthropic API key', apiKey, 'Create one at console.anthropic.com → API keys.')),
          ui.field('Model', model), ui.field('Analysis effort', effort, 'Higher = more thorough, slower.')),
        h('div.row.wrap',
          h('button.btn', {
            onclick: async () => {
              testOut.textContent = 'Testing…'; testOut.className = 'small muted';
              try { const m = await NX.ai.testConnection({ apiKey: apiKey.value.trim(), model: model.value }); testOut.textContent = '✓ Connected (' + m + ')'; testOut.className = 'small text-success'; }
              catch (e) { testOut.textContent = '✗ ' + e.message; testOut.className = 'small text-danger'; }
            },
          }, 'Test connection'),
          testOut, h('span.grow'),
          h('button.btn.btn-primary', { onclick: saveAI }, 'Save AI settings')),
      ),

      h('section.card.stack',
        h('h3', icon('save'), 'Storage & backup'),
        h('p', `${c.accounts} accounts · ${c.deals} opportunities · ${c.meetings} meetings · ${c.tasks} tasks`),
        h('div.storage-status.status-' + fsState.status, fileStatus),
        h('div.row.wrap',
          fs.supported && fsState.status === 'needs-permission' ? h('button.btn.btn-primary', { onclick: act(() => fs.reconnect(), 'Reconnected') }, 'Reconnect save file') : null,
          fs.supported ? h('button.btn', { onclick: act(() => fs.createFile(), 'Auto-save file linked') }, icon('save'), fsState.fileName ? 'Save to a new file…' : 'Auto-save to a file…') : null,
          fs.supported ? h('button.btn', { onclick: act(() => fs.openFile(), 'Workspace loaded from file') }, icon('upload'), 'Open workspace file…') : null,
          fs.supported && fsState.fileName ? h('button.btn.btn-ghost', { onclick: act(() => fs.disconnect(), 'File unlinked') }, 'Unlink file') : null,
        ),
        h('div.row.wrap',
          h('button.btn', { onclick: () => NX.files.downloadJSON(store().workspace.snapshot(), `se-pipeline-backup-${U.todayISO()}.json`) }, 'Export backup (.json)'),
          h('button.btn', {
            onclick: act(async () => {
              const data = await NX.files.pickJSONFile(); if (!data) return;
              const merge = await ui.confirmDialog({ title: 'Import workspace', message: 'Merge the file into your current workspace? Choose Cancel to stop — to fully replace your data use "Open workspace file" or erase first.', confirmLabel: 'Merge' });
              if (merge) { await store().workspace.load(data, 'merge'); ui.toast('Imported', 'success'); }
            }),
          }, 'Import / merge backup…'),
        ),
      ),

      h('section.card.stack',
        h('h3', 'Demo & reset'),
        h('div.row.wrap',
          h('button.btn', { onclick: () => NX.sample.load() }, 'Load sample data'),
          h('button.btn.btn-danger', {
            onclick: async () => {
              if (await ui.confirmDialog({ title: 'Erase workspace?', message: 'Deletes every account, opportunity, meeting and task in this browser (and the linked file on next save). Export a backup first!', confirmLabel: 'Erase everything', danger: true })) {
                await ui.run(() => store().workspace.reset(), 'Workspace erased');
              }
            },
          }, icon('trash'), 'Erase workspace'),
        ),
      ),
      h('p.muted.small.center', 'SE Pipeline · data schema v' + NX.schema.SCHEMA_VERSION + ' · all data stays on this computer'),
    ));
  }

  NX.views = NX.views || {};
  NX.views.settings = { title: 'Settings', render };
})(globalThis.NX = globalThis.NX || {});
