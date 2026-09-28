/* Demo workspace so a new user can see the app populated. */
(function (NX) {
  'use strict';
  const U = NX.util;

  function build() {
    const t = U.todayISO();
    const d = (n) => U.addDays(t, n);
    const acc = (id, name, industry, partner) => ({ id, name, industry, partner, contacts: [] });
    const accounts = [
      acc('acc_demo_1', 'Contoso Health', 'Healthcare', 'CDW'),
      acc('acc_demo_2', 'Fabrikam Manufacturing', 'Manufacturing', 'SHI'),
      acc('acc_demo_3', 'Northwind University', 'Education', 'Presidio'),
      acc('acc_demo_4', 'Tailspin Logistics', 'Transportation', 'WWT'),
    ];
    accounts[0].contacts = [{ name: 'Dana Whitfield', title: 'Director of Infrastructure', email: 'dana@contoso.example', role: 'Champion' }];
    const deal = (id, accountId, name, stage, amount, closeDate, extra) => ({ id, accountId, name, stage, amount, closeDate, position: Number(id.slice(-1)) * 1000, ...extra });
    const deals = [
      deal('deal_demo_1', 'acc_demo_1', 'VMware exit – 3 site AHV migration', 'tech_diff', 850000, d(60), { products: ['NCI Pro', 'Prism Central', 'Move'], competitors: ['VMware', 'Azure Local'], partner: 'CDW', successCriteria: 'Epic ODB performance parity; <15 min failover in DR test', nextStep: 'Finalize POC success criteria sign-off' }),
      deal('deal_demo_2', 'acc_demo_2', 'Plant floor edge refresh', 'discovery', 240000, d(120), { products: ['NCI Starter'], competitors: ['Dell VxRail'], nextStep: 'Quantify downtime cost with plant ops' }),
      deal('deal_demo_3', 'acc_demo_3', 'VDI for research labs', 'develop', 410000, d(90), { products: ['NCI', 'Omnissa Horizon'], nextStep: 'Stakeholder workshop with CIO office' }),
      deal('deal_demo_4', 'acc_demo_4', 'NC2 on AWS DR', 'identified', 180000, d(150), { products: ['NC2'], nextStep: 'Review with manager' }),
      deal('deal_demo_5', 'acc_demo_1', 'Nutanix Files for PACS archive', 'tech_win', 320000, d(20), { products: ['NUS Files'], nextStep: 'AE to deliver final quote' }),
      deal('deal_demo_6', 'acc_demo_2', 'NDB database modernization', 'closed_lost', 150000, d(-30), { lostReason: 'Budget moved to FY27' }),
    ];
    const meetings = [{
      id: 'mtg_demo_1', accountId: 'acc_demo_1', dealId: 'deal_demo_1', title: 'Contoso Health – POC planning', date: d(-2),
      attendees: [{ name: 'Dana Whitfield', organization: 'Contoso Health' }, { name: 'Sam Ortiz', organization: 'CDW' }],
      summary: 'Reviewed the POC scope for migrating the primary data center off vSphere ahead of the Broadcom renewal in Q2. Contoso wants proof that Epic ODB performs at parity on AHV and that DR failover meets a 15 minute RTO. Agreed on a 3-node POC in the Dallas DC starting in two weeks.',
      painPoints: ['VMware renewal quote up 3.2x after Broadcom licensing change', 'Manual DR runbooks; last failover test took 6 hours'],
      requirements: ['Epic ODB latency parity', 'RTO < 15 minutes, RPO < 1 hour', 'Integration with existing Commvault backups'],
      risks: ['CFO has not yet approved budget for FY26'],
      decisions: ['3-node NX POC in Dallas DC'],
      processedBy: 'manual', stageBefore: 'develop', stageAfter: 'tech_diff',
    }];
    const task = (title, dueDate, extra) => ({ title, dueDate, owner: 'me', priority: 'medium', ...extra });
    const tasks = [
      task('Send POC success criteria document to Dana', d(-1), { accountId: 'acc_demo_1', dealId: 'deal_demo_1', meetingId: 'mtg_demo_1', priority: 'high' }),
      task('Ship POC nodes to Dallas DC', d(3), { accountId: 'acc_demo_1', dealId: 'deal_demo_1', meetingId: 'mtg_demo_1', owner: 'partner', ownerName: 'Sam Ortiz' }),
      task('Provide Epic ODB performance baseline', d(5), { accountId: 'acc_demo_1', dealId: 'deal_demo_1', meetingId: 'mtg_demo_1', owner: 'customer', ownerName: 'Dana Whitfield' }),
      task('Build downtime cost model for plant ops', d(0), { accountId: 'acc_demo_2', dealId: 'deal_demo_2', priority: 'high' }),
      task('Prep deck for CIO stakeholder workshop', d(6), { accountId: 'acc_demo_3', dealId: 'deal_demo_3' }),
      task('Review NC2 DR opportunity with manager', d(2), { accountId: 'acc_demo_4', dealId: 'deal_demo_4' }),
      task('Confirm final Files BOM with AE', d(1), { accountId: 'acc_demo_1', dealId: 'deal_demo_5', owner: 'account_exec' }),
    ].map((x, i) => ({ id: 'task_demo_' + i, ...x }));
    return { schemaVersion: NX.schema.SCHEMA_VERSION, savedAt: new Date().toISOString(), accounts, deals, meetings, tasks, settings: {} };
  }

  async function load() {
    const store = NX.app.store;
    const c = store.workspace.counts();
    if (c.deals + c.accounts > 0 && !(await NX.ui.confirmDialog({ title: 'Load sample data?', message: 'Sample accounts, deals and tasks will be added alongside your existing data.', confirmLabel: 'Add samples' }))) return;
    await NX.ui.run(() => store.workspace.load(build(), 'merge'), 'Sample data loaded');
  }

  NX.sample = { build, load };
})(globalThis.NX = globalThis.NX || {});
