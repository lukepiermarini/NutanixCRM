/* Service layer ("the API"). All reads come from an in-memory cache hydrated
 * at startup; all writes are validated, applied to the cache, persisted
 * atomically through the adapter, and broadcast as change events.
 *
 * The method surface mirrors the REST endpoints in docs/ARCHITECTURE.md, e.g.
 *   api.deals.move(id, stage)   <->   POST /api/v1/deals/:id/move
 * so a cloud backend can be introduced by swapping the adapter. */
(function (NX) {
  'use strict';
  const { normalize, migrateSnapshot, SCHEMA_VERSION, stageById } = NX.schema;
  const { nowISO } = NX.util;

  const SETTINGS_DEFAULTS = {
    userName: '',
    workspaceName: 'My Workspace',
    apiKey: '',
    model: 'claude-opus-5',
    effort: 'high',
    remindersEnabled: false,
  };
  // Secrets never leave the browser via export / file sync.
  const PRIVATE_SETTINGS = ['apiKey'];

  function createStore(adapter) {
    const cache = { accounts: new Map(), deals: new Map(), meetings: new Map(), tasks: new Map() };
    let settings = { ...SETTINGS_DEFAULTS };
    const listeners = new Set();

    function emit(evt) { for (const fn of listeners) { try { fn(evt); } catch (e) { console.error(e); } } }

    /** Applies ops to cache + adapter. ops: [{collection, put} | {collection, del}] */
    async function commit(ops, evt) {
      for (const op of ops) {
        if (op.put) cache[op.collection].set(op.put.id, op.put);
        else cache[op.collection].delete(op.del);
      }
      await adapter.commit(ops);
      await adapter.setMeta('lastChangeAt', nowISO());
      emit(evt || { type: 'change' });
    }

    function must(collection, id) {
      const rec = cache[collection].get(id);
      if (!rec) throw new Error(`${collection.slice(0, -1)} ${id} not found`);
      return rec;
    }

    const list = (collection, filter) => {
      let rows = [...cache[collection].values()];
      if (filter) for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== '') rows = rows.filter((r) => r[k] === v);
      return rows;
    };

    // ---------------- Accounts ----------------
    const accounts = {
      list: (f) => list('accounts', f).sort((a, b) => a.name.localeCompare(b.name)),
      get: (id) => cache.accounts.get(id) || null,
      findByName(name) {
        const n = NX.util.normalize(name);
        return n ? accounts.list().find((a) => NX.util.normalize(a.name) === n) || null : null;
      },
      async create(data) {
        const rec = normalize.account(data);
        await commit([{ collection: 'accounts', put: rec }], { type: 'accounts.create', id: rec.id });
        return rec;
      },
      async update(id, patch) {
        const rec = normalize.account({ ...must('accounts', id), ...patch, id });
        await commit([{ collection: 'accounts', put: rec }], { type: 'accounts.update', id });
        return rec;
      },
      /** Cascades to the account's deals, meetings and tasks. */
      async remove(id) {
        const ops = [{ collection: 'accounts', del: id }];
        for (const c of ['deals', 'meetings', 'tasks']) for (const r of list(c, { accountId: id })) ops.push({ collection: c, del: r.id });
        await commit(ops, { type: 'accounts.remove', id });
      },
    };

    // ---------------- Deals ----------------
    const deals = {
      list: (f) => list('deals', f).sort((a, b) => a.position - b.position),
      get: (id) => cache.deals.get(id) || null,
      async create(data) {
        const rec = normalize.deal(data);
        if (!rec.accountId || !cache.accounts.has(rec.accountId)) throw new Error('A deal must belong to an existing account');
        await commit([{ collection: 'deals', put: rec }], { type: 'deals.create', id: rec.id });
        return rec;
      },
      async update(id, patch) {
        const prev = must('deals', id);
        const next = { ...prev, ...patch, id };
        if (patch.stage && patch.stage !== prev.stage) next.stageHistory = [...prev.stageHistory, { stage: patch.stage, at: nowISO() }];
        const rec = normalize.deal(next);
        await commit([{ collection: 'deals', put: rec }], { type: 'deals.update', id });
        return rec;
      },
      /** Moves a deal to a stage and (optionally) between two neighbours for manual ordering. */
      async move(id, stage, beforeId) {
        const prev = must('deals', id);
        const column = deals.list({ stage }).filter((d) => d.id !== id);
        let position;
        const idx = beforeId ? column.findIndex((d) => d.id === beforeId) : -1;
        if (idx === -1) position = column.length ? column[column.length - 1].position + 1000 : Date.now();
        else {
          const after = column[idx].position;
          const before = idx > 0 ? column[idx - 1].position : after - 2000;
          position = (before + after) / 2;
        }
        const patch = { stage, position };
        if (stage !== 'closed_lost') patch.lostReason = prev.stage === 'closed_lost' ? '' : prev.lostReason;
        return deals.update(id, patch);
      },
      async remove(id) {
        const ops = [{ collection: 'deals', del: id }];
        for (const t of list('tasks', { dealId: id })) ops.push({ collection: 'tasks', del: t.id });
        for (const m of list('meetings', { dealId: id })) ops.push({ collection: 'meetings', put: { ...m, dealId: '' } });
        await commit(ops, { type: 'deals.remove', id });
      },
    };

    // ---------------- Meetings ----------------
    const meetings = {
      list: (f) => list('meetings', f).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)),
      get: (id) => cache.meetings.get(id) || null,
      async update(id, patch) {
        const rec = normalize.meeting({ ...must('meetings', id), ...patch, id });
        await commit([{ collection: 'meetings', put: rec }], { type: 'meetings.update', id });
        return rec;
      },
      async remove(id, { removeTasks = false } = {}) {
        const ops = [{ collection: 'meetings', del: id }];
        for (const t of list('tasks', { meetingId: id })) {
          ops.push(removeTasks ? { collection: 'tasks', del: t.id } : { collection: 'tasks', put: { ...t, meetingId: '' } });
        }
        await commit(ops, { type: 'meetings.remove', id });
      },
      /**
       * Composite write used by the "New meeting" flow (POST /api/v1/meetings/ingest).
       * Creates the account / deal if needed, stores the meeting, creates the
       * accepted action items as tasks and applies an optional stage move — atomically.
       */
      async ingest(input) {
        const ops = [];
        let account = input.accountId ? must('accounts', input.accountId) : null;
        if (!account) {
          const name = String(input.newAccountName || '').trim();
          if (!name) throw new Error('Choose an account or enter a new account name');
          account = accounts.findByName(name) || normalize.account({ name });
          ops.push({ collection: 'accounts', put: account });
        }
        let deal = input.dealId ? must('deals', input.dealId) : null;
        if (!deal && input.newDealName) {
          deal = normalize.deal({ accountId: account.id, name: input.newDealName, stage: 'identified' });
        }
        const stageBefore = deal ? deal.stage : '';
        if (deal) {
          const patch = {};
          if (input.moveToStage && input.moveToStage !== deal.stage) {
            patch.stage = input.moveToStage;
            patch.stageHistory = [...deal.stageHistory, { stage: input.moveToStage, at: nowISO() }];
            patch.position = Date.now();
          }
          if (input.nextStep) patch.nextStep = input.nextStep;
          if (input.competitors && input.competitors.length) patch.competitors = [...new Set([...deal.competitors, ...input.competitors])];
          deal = normalize.deal({ ...deal, ...patch });
          ops.push({ collection: 'deals', put: deal });
        }
        const meeting = normalize.meeting({
          ...input.meeting,
          accountId: account.id,
          dealId: deal ? deal.id : '',
          stageBefore,
          stageAfter: deal ? deal.stage : '',
        });
        ops.push({ collection: 'meetings', put: meeting });
        const tasks = (input.tasks || []).map((t) => normalize.task({
          ...t, accountId: account.id, dealId: deal ? deal.id : '', meetingId: meeting.id, status: 'open',
        }));
        for (const t of tasks) ops.push({ collection: 'tasks', put: t });
        await commit(ops, { type: 'meetings.ingest', id: meeting.id });
        return { account, deal, meeting, tasks };
      },
    };

    // ---------------- Tasks ----------------
    const tasks = {
      list: (f) => list('tasks', f).sort((a, b) =>
        (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
        ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority)),
      get: (id) => cache.tasks.get(id) || null,
      async create(data) {
        const rec = normalize.task(data);
        await commit([{ collection: 'tasks', put: rec }], { type: 'tasks.create', id: rec.id });
        return rec;
      },
      async update(id, patch) {
        const prev = must('tasks', id);
        const next = { ...prev, ...patch, id };
        if (patch.status === 'open') next.completedAt = '';
        const rec = normalize.task(next);
        await commit([{ collection: 'tasks', put: rec }], { type: 'tasks.update', id });
        return rec;
      },
      complete: (id, done = true) => tasks.update(id, { status: done ? 'done' : 'open', completedAt: done ? nowISO() : '' }),
      async remove(id) { await commit([{ collection: 'tasks', del: id }], { type: 'tasks.remove', id }); },
    };

    // ---------------- Settings ----------------
    const settingsApi = {
      get: () => ({ ...settings }),
      async update(patch) {
        settings = { ...settings, ...patch };
        await adapter.setMeta('settings', settings);
        emit({ type: 'settings.update', local: Object.keys(patch).every((k) => PRIVATE_SETTINGS.includes(k)) });
        return settingsApi.get();
      },
    };

    // ---------------- Workspace (export / import) ----------------
    const workspace = {
      snapshot() {
        const publicSettings = { ...settings };
        PRIVATE_SETTINGS.forEach((k) => delete publicSettings[k]);
        return {
          app: 'nutanix-se-pipeline',
          schemaVersion: SCHEMA_VERSION,
          savedAt: nowISO(),
          settings: publicSettings,
          accounts: [...cache.accounts.values()],
          deals: [...cache.deals.values()],
          meetings: [...cache.meetings.values()],
          tasks: [...cache.tasks.values()],
        };
      },
      /** mode: 'replace' wipes the workspace first; 'merge' upserts by id. */
      async load(raw, mode = 'replace') {
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.deals)) throw new Error('That file is not a workspace export');
        const snap = migrateSnapshot(raw);
        const merged = {};
        for (const c of ['accounts', 'deals', 'meetings', 'tasks']) {
          const base = mode === 'merge' ? new Map(cache[c]) : new Map();
          for (const r of snap[c]) base.set(r.id, r);
          merged[c] = [...base.values()];
        }
        await adapter.replaceAll(merged);
        for (const c of Object.keys(merged)) cache[c] = new Map(merged[c].map((r) => [r.id, r]));
        const keep = {}; PRIVATE_SETTINGS.forEach((k) => (keep[k] = settings[k]));
        settings = { ...SETTINGS_DEFAULTS, ...settings, ...snap.settings, ...keep };
        await adapter.setMeta('settings', settings);
        await adapter.setMeta('lastChangeAt', raw.savedAt || nowISO());
        emit({ type: 'workspace.load' });
      },
      async reset() {
        await workspace.load({ deals: [], accounts: [], meetings: [], tasks: [] }, 'replace');
      },
      lastChangeAt: () => adapter.getMeta('lastChangeAt'),
      counts: () => ({ accounts: cache.accounts.size, deals: cache.deals.size, meetings: cache.meetings.size, tasks: cache.tasks.size }),
    };

    // ---------------- Derived queries used by several views ----------------
    const queries = {
      dealSummary(dealId) {
        const open = list('tasks', { dealId, status: 'open' }).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
        const ms = meetings.list({ dealId });
        return { openTasks: open.length, nextTask: open[0] || null, lastMeeting: ms[0] || null, meetingCount: ms.length };
      },
      stageLabel: (id) => stageById(id).name,
    };

    return {
      adapter,
      async init() {
        for (const c of Object.keys(cache)) cache[c] = new Map((await adapter.getAll(c)).map((r) => [r.id, r]));
        settings = { ...SETTINGS_DEFAULTS, ...((await adapter.getMeta('settings')) || {}) };
        return this;
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      accounts, deals, meetings, tasks, settings: settingsApi, workspace, queries,
    };
  }

  NX.createStore = createStore;
  NX.SETTINGS_DEFAULTS = SETTINGS_DEFAULTS;
})(globalThis.NX = globalThis.NX || {});
