/* Domain model: pipeline stages, entity factories and normalizers.
 * Every record that enters the store goes through a normalizer so imported
 * or AI-generated data can never corrupt the shape of the database. */
(function (NX) {
  'use strict';
  const { uid, nowISO, todayISO } = NX.util;

  const SCHEMA_VERSION = 1;

  const STAGES = [
    {
      id: 'identified', order: 1, name: 'Identified Opportunity', short: 'Identified', color: '#64748b', open: true,
      definition: 'Discussed with End User or Partner. Believe there to be a fit/need. There are next steps planned to further discuss requirements and timing. Get ready to review with your manager.',
    },
    {
      id: 'discovery', order: 2, name: 'Opportunity Discovery', short: 'Discovery', color: '#0ea5e9', open: true,
      definition: 'Validated pain/gain/risk. Identify customer metrics. Reached mutual agreement to progress. "Why do anything" established.',
    },
    {
      id: 'develop', order: 3, name: 'Develop Opportunity', short: 'Develop', color: '#6366f1', open: true,
      definition: 'Focused on identifying and validating resources. Requirements, timing, and interests of key stakeholders established.',
    },
    {
      id: 'tech_diff', order: 4, name: 'Technical Differentiation', short: 'Tech Diff', color: '#a855f7', open: true,
      definition: 'Configuration being determined to solve agreed upon use case and pain points of customer. Actively engaged in POC or working toward agreed upon success criteria.',
    },
    {
      id: 'tech_win', order: 5, name: 'Technical Win', short: 'Tech Win', color: '#f59e0b', open: true,
      definition: 'Customer has agreed to Nutanix configuration and confirmed it can solve technical requirements.',
    },
    { id: 'closed_won', order: 6, name: 'Closed Won', short: 'Won', color: '#16a34a', open: false, definition: 'Deal closed — customer purchased.' },
    { id: 'closed_lost', order: 7, name: 'Closed Lost', short: 'Lost', color: '#dc2626', open: false, definition: 'Deal lost or abandoned. Capture the reason.' },
  ];
  const STAGE_IDS = STAGES.map((s) => s.id);
  const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

  const TASK_OWNERS = [
    { id: 'me', label: 'Me' },
    { id: 'account_exec', label: 'Account Exec' },
    { id: 'customer', label: 'Customer' },
    { id: 'partner', label: 'Partner' },
    { id: 'nutanix_other', label: 'Nutanix (other)' },
  ];
  const OWNER_IDS = TASK_OWNERS.map((o) => o.id);
  const PRIORITIES = ['high', 'medium', 'low'];

  const str = (v, max) => (v == null ? '' : String(v)).slice(0, max || 20000);
  const strList = (v) => (Array.isArray(v) ? v.map((x) => str(x, 2000).trim()).filter(Boolean) : []);
  const isoDateOrEmpty = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; };
  const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

  function stamp(rec, prefix) {
    const t = nowISO();
    return { id: rec.id || uid(prefix), createdAt: rec.createdAt || t, updatedAt: t };
  }

  const normalize = {
    account(a) {
      a = a || {};
      return {
        ...stamp(a, 'acc'),
        name: str(a.name, 200).trim() || 'Untitled account',
        industry: str(a.industry, 120),
        partner: str(a.partner, 200),
        website: str(a.website, 300),
        notes: str(a.notes),
        contacts: (Array.isArray(a.contacts) ? a.contacts : []).map((c) => ({
          id: c.id || uid('con'),
          name: str(c.name, 200),
          title: str(c.title, 200),
          email: str(c.email, 200),
          phone: str(c.phone, 60),
          role: str(c.role, 120),
        })).filter((c) => c.name),
      };
    },

    deal(d) {
      d = d || {};
      const stage = oneOf(d.stage, STAGE_IDS, 'identified');
      const history = Array.isArray(d.stageHistory) && d.stageHistory.length
        ? d.stageHistory.filter((h) => STAGE_IDS.includes(h.stage)).map((h) => ({ stage: h.stage, at: str(h.at, 40) }))
        : [{ stage, at: nowISO() }];
      return {
        ...stamp(d, 'deal'),
        accountId: str(d.accountId, 64),
        name: str(d.name, 200).trim() || 'Untitled opportunity',
        stage,
        position: typeof d.position === 'number' && isFinite(d.position) ? d.position : Date.now(),
        amount: num(d.amount),
        closeDate: isoDateOrEmpty(d.closeDate),
        useCase: str(d.useCase, 2000),
        products: strList(d.products),
        partner: str(d.partner, 200),
        accountExec: str(d.accountExec, 200),
        competitors: strList(d.competitors),
        successCriteria: str(d.successCriteria, 4000),
        nextStep: str(d.nextStep, 1000),
        lostReason: str(d.lostReason, 1000),
        stageHistory: history,
      };
    },

    meeting(m) {
      m = m || {};
      return {
        ...stamp(m, 'mtg'),
        accountId: str(m.accountId, 64),
        dealId: str(m.dealId, 64),
        title: str(m.title, 300).trim() || 'Meeting',
        date: isoDateOrEmpty(m.date) || todayISO(),
        attendees: (Array.isArray(m.attendees) ? m.attendees : []).map((a) =>
          typeof a === 'string' ? { name: a, organization: '', role: '' }
            : { name: str(a.name, 200), organization: str(a.organization, 200), role: str(a.role, 200) }
        ).filter((a) => a.name),
        summary: str(m.summary),
        discussionPoints: strList(m.discussionPoints),
        painPoints: strList(m.painPoints),
        requirements: strList(m.requirements),
        environment: strList(m.environment),
        competitors: strList(m.competitors),
        risks: strList(m.risks),
        decisions: strList(m.decisions),
        followUpEmail: str(m.followUpEmail),
        stageBefore: oneOf(m.stageBefore, STAGE_IDS, ''),
        stageAfter: oneOf(m.stageAfter, STAGE_IDS, ''),
        stageRationale: str(m.stageRationale, 2000),
        rawNotes: str(m.rawNotes, 500000),
        processedBy: oneOf(m.processedBy, ['ai', 'heuristic', 'manual'], 'manual'),
      };
    },

    task(t) {
      t = t || {};
      const status = oneOf(t.status, ['open', 'done'], 'open');
      return {
        ...stamp(t, 'task'),
        title: str(t.title, 500).trim() || 'Untitled task',
        details: str(t.details, 4000),
        dueDate: isoDateOrEmpty(t.dueDate),
        priority: oneOf(t.priority, PRIORITIES, 'medium'),
        owner: oneOf(t.owner, OWNER_IDS, 'me'),
        ownerName: str(t.ownerName, 200),
        status,
        completedAt: status === 'done' ? (t.completedAt || nowISO()) : '',
        accountId: str(t.accountId, 64),
        dealId: str(t.dealId, 64),
        meetingId: str(t.meetingId, 64),
      };
    },
  };

  /** Upgrades an exported workspace snapshot from any older schema version. */
  function migrateSnapshot(snap) {
    const s = snap && typeof snap === 'object' ? snap : {};
    const version = Number(s.schemaVersion) || 1;
    // Future migrations go here: if (version < 2) { ... }
    return {
      schemaVersion: Math.max(version, SCHEMA_VERSION),
      accounts: (s.accounts || []).map(normalize.account),
      deals: (s.deals || []).map(normalize.deal),
      meetings: (s.meetings || []).map(normalize.meeting),
      tasks: (s.tasks || []).map(normalize.task),
      settings: s.settings && typeof s.settings === 'object' ? s.settings : {},
    };
  }

  NX.schema = {
    SCHEMA_VERSION, STAGES, STAGE_IDS, stageById, TASK_OWNERS, OWNER_IDS, PRIORITIES,
    normalize, migrateSnapshot,
  };
})(globalThis.NX = globalThis.NX || {});
