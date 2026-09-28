import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const NX = loadCore();
// Values created inside the vm context have foreign prototypes; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));
const U = NX.util;
// 2026-09-28 is a Monday
const MON = '2026-09-28';

test('stages: exactly the 7 pipeline stages in order', () => {
  assert.deepEqual([...NX.schema.STAGE_IDS], ['identified', 'discovery', 'develop', 'tech_diff', 'tech_win', 'closed_won', 'closed_lost']);
});

test('date helpers', () => {
  assert.equal(U.addBusinessDays('2026-10-02', 1), '2026-10-05'); // Fri -> Mon
  assert.equal(U.daysBetween(MON, '2026-10-01'), 3);
  assert.equal(U.addDays('2026-12-31', 1), '2027-01-01');
});

test('parseDueDate resolves natural language against the meeting date', () => {
  const p = (s) => NX.ai.parseDueDate(s, MON);
  assert.equal(p('send it today'), MON);
  assert.equal(p('by tomorrow'), '2026-09-29');
  assert.equal(p('by Friday'), '2026-10-02');
  assert.equal(p('by Monday'), '2026-10-05');
  assert.equal(p('next Tuesday'), '2026-10-06');
  assert.equal(p('end of week'), '2026-10-02');
  assert.equal(p('sometime next week'), '2026-10-09');
  assert.equal(p('in 2 weeks'), '2026-10-12');
  assert.equal(p('in 3 business days'), '2026-10-01');
  assert.equal(p('by 10/15'), '2026-10-15');
  assert.equal(p('by 3/1'), '2027-03-01'); // past month rolls to next year
  assert.equal(p('due Oct 20th'), '2026-10-20');
  assert.equal(p('EOM'), '2026-09-30');
  assert.equal(p('no date here'), '');
});

test('cleanTranscript strips WebVTT scaffolding', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nDana Whitfield: Hi all\n\n2\n00:00:05.000 --> 00:00:07.000\nSam: Hello';
  assert.equal(NX.ai.cleanTranscript(vtt), 'Dana Whitfield: Hi all\n\nSam: Hello');
});

const ZOOM_SUMMARY = `Quick recap
Contoso Health reviewed their plan to leave VMware after the Broadcom renewal tripled their costs. They want a POC of AHV in the Dallas data center.

Next steps
- Jordan will send the POC success criteria document by Wednesday
- Dana Whitfield to provide Epic performance baseline next week
- Partner to ship 3 NX nodes ASAP

Summary
Current environment
They run vSphere 7 on Dell R740s with a Pure SAN.
Risks
CFO budget approval is not confirmed.`;

test('heuristic parser extracts actions, owners, dates, risks and account', () => {
  const accounts = [{ id: 'a1', name: 'Contoso Health' }, { id: 'a2', name: 'Fabrikam' }];
  const deals = [{ id: 'd1', accountId: 'a1', name: 'VMware exit', stage: 'develop' }];
  const r = NX.ai.sanitize(NX.ai.heuristicParse(ZOOM_SUMMARY, { accounts, deals, userName: 'Jordan Lee', meetingDate: MON }), { accounts, deals, meetingDate: MON });
  assert.equal(r.matchedAccountId, 'a1');
  assert.equal(r.matchedDealId, 'd1');
  const byTitle = (s) => r.actionItems.find((a) => a.title.toLowerCase().includes(s));
  const poc = byTitle('success criteria');
  assert.ok(poc, 'captures POC action');
  assert.equal(poc.owner, 'me');
  assert.equal(poc.dueDate, '2026-09-30');
  const baseline = byTitle('baseline');
  assert.equal(baseline.owner, 'customer');
  assert.equal(baseline.ownerName, 'Dana Whitfield');
  assert.match(baseline.title, /^Provide Epic/);
  assert.equal(baseline.dueDate, '2026-10-09');
  const ship = byTitle('ship');
  assert.equal(ship.owner, 'partner');
  assert.equal(ship.priority, 'high');
  assert.ok(r.actionItems.some((a) => /recap/i.test(a.title)), 'adds recap task');
  assert.ok(r.risks.some((x) => /budget/i.test(x)));
  assert.ok(r.environment.some((x) => /vSphere/.test(x)));
  assert.ok(r.competitors.includes('VMware'));
  assert.equal(r.suggestedStage, 'tech_diff'); // POC signal from Develop
  assert.match(r.summary, /Contoso Health reviewed/);
});

test('sanitize rejects ids that are not in the workspace and invalid enums', () => {
  const r = NX.ai.sanitize({ matchedAccountId: 'ghost', matchedDealId: 'ghost', suggestedStage: 'bogus',
    actionItems: [{ title: 'Do it', owner: 'someone', priority: 'urgent', dueDate: 'Friday' }] }, { accounts: [], deals: [], meetingDate: MON });
  assert.equal(r.matchedAccountId, '');
  assert.equal(r.suggestedStage, 'no_change');
  assert.equal(r.actionItems[0].owner, 'me');
  assert.equal(r.actionItems[0].priority, 'medium');
  assert.match(r.actionItems[0].dueDate, /^\d{4}-\d{2}-\d{2}$/);
});

async function freshStore() {
  const adapter = await new NX.db.MemoryAdapter().open();
  return NX.createStore(adapter).init();
}

test('store: CRUD, drag-move ordering and stage history', async () => {
  const s = await freshStore();
  const acct = await s.accounts.create({ name: 'Acme' });
  await assert.rejects(() => s.deals.create({ name: 'x' }), /existing account/);
  const a = await s.deals.create({ accountId: acct.id, name: 'A', position: 1000 });
  const b = await s.deals.create({ accountId: acct.id, name: 'B', position: 2000 });
  const c = await s.deals.create({ accountId: acct.id, name: 'C', stage: 'discovery' });
  await s.deals.move(c.id, 'identified', b.id); // drop C between A and B
  assert.deepEqual(plain(s.deals.list({ stage: 'identified' }).map((d) => d.name)), ['A', 'C', 'B']);
  assert.deepEqual(plain(s.deals.get(c.id).stageHistory.map((h) => h.stage)), ['discovery', 'identified']);
  await s.deals.move(a.id, 'tech_win');
  assert.equal(s.deals.get(a.id).stage, 'tech_win');
});

test('store: meetings.ingest creates account, deal, meeting, tasks and moves stage atomically', async () => {
  const s = await freshStore();
  let events = 0; s.on(() => events++);
  const res = await s.meetings.ingest({
    newAccountName: 'Northwind', newDealName: 'VDI refresh', moveToStage: 'discovery', nextStep: 'Send recap',
    meeting: { title: 'Kickoff', date: MON, summary: 'Good call', rawNotes: 'raw' },
    tasks: [{ title: 'Send recap', dueDate: '2026-09-29', owner: 'me' }, { title: 'Share RVTools', owner: 'customer', dueDate: '2026-10-02' }],
  });
  assert.equal(events, 1, 'single change event');
  assert.equal(s.accounts.list().length, 1);
  assert.equal(res.deal.stage, 'discovery');
  assert.equal(res.deal.nextStep, 'Send recap');
  assert.equal(res.meeting.stageBefore, 'identified');
  assert.equal(res.meeting.stageAfter, 'discovery');
  assert.equal(s.tasks.list({ meetingId: res.meeting.id }).length, 2);
  assert.ok(s.tasks.list().every((t) => t.accountId === res.account.id && t.dealId === res.deal.id));
  // Re-using an existing account by name does not duplicate it
  await s.meetings.ingest({ newAccountName: 'northwind', meeting: { title: 'Follow-up' }, tasks: [] });
  assert.equal(s.accounts.list().length, 1);
});

test('store: cascade deletes and task ordering', async () => {
  const s = await freshStore();
  const acct = await s.accounts.create({ name: 'Acme' });
  const d = await s.deals.create({ accountId: acct.id, name: 'D' });
  await s.tasks.create({ title: 'later', dueDate: '2026-12-01', accountId: acct.id, dealId: d.id });
  const soon = await s.tasks.create({ title: 'soon', dueDate: '2026-10-01', accountId: acct.id });
  await s.tasks.create({ title: 'nodate', accountId: acct.id });
  assert.deepEqual(plain(s.tasks.list().map((t) => t.title)), ['soon', 'later', 'nodate']);
  await s.tasks.complete(soon.id);
  assert.equal(s.tasks.list()[2].title, 'soon');
  await s.deals.remove(d.id);
  assert.equal(s.tasks.list().length, 2);
  await s.accounts.remove(acct.id);
  assert.deepEqual(plain(s.workspace.counts()), { accounts: 0, deals: 0, meetings: 0, tasks: 0 });
});

test('workspace export excludes the API key and round-trips through import', async () => {
  const s = await freshStore();
  await s.settings.update({ apiKey: 'sk-ant-secret', userName: 'Jordan' });
  const acct = await s.accounts.create({ name: 'Acme' });
  await s.deals.create({ accountId: acct.id, name: 'D', amount: '$1,200' });
  const snap = s.workspace.snapshot();
  assert.equal(snap.settings.apiKey, undefined);
  assert.ok(!JSON.stringify(snap).includes('sk-ant-secret'));
  assert.equal(snap.deals[0].amount, 1200);
  const s2 = await freshStore();
  await s2.workspace.load(JSON.parse(JSON.stringify(snap)));
  assert.equal(s2.deals.list()[0].name, 'D');
  assert.equal(s2.settings.get().userName, 'Jordan');
  await assert.rejects(() => s2.workspace.load({ foo: 1 }), /not a workspace/);
});

test('RESULT_SCHEMA is valid for structured outputs (every object closed & fully required)', () => {
  const walk = (node, path) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, v] of Object.entries(node.properties)) walk(v, path + '.' + k);
    }
    if (node.type === 'array') walk(node.items, path + '[]');
  };
  walk(NX.ai.RESULT_SCHEMA, '$');
});
