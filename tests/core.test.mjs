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
  const p = (s) => NX.analyzer.parseDueDate(s, MON);
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
  assert.equal(NX.analyzer.cleanTranscript(vtt), 'Dana Whitfield: Hi all\n\nSam: Hello');
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

test('analyzer extracts actions, owners, dates, risks and account from a Zoom-style summary', () => {
  const accounts = [{ id: 'a1', name: 'Contoso Health' }, { id: 'a2', name: 'Fabrikam' }];
  const deals = [{ id: 'd1', accountId: 'a1', name: 'VMware exit', stage: 'develop' }];
  const r = NX.analyzer.processNotes(ZOOM_SUMMARY, { accounts, deals, userName: 'Jordan Lee', meetingDate: MON });
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
  const r = NX.analyzer.sanitize({ matchedAccountId: 'ghost', matchedDealId: 'ghost', suggestedStage: 'bogus',
    actionItems: [{ title: 'Do it', owner: 'someone', priority: 'urgent', dueDate: 'Friday' }] }, { accounts: [], deals: [], meetingDate: MON });
  assert.equal(r.matchedAccountId, '');
  assert.equal(r.suggestedStage, 'no_change');
  assert.equal(r.actionItems[0].owner, 'me');
  assert.equal(r.actionItems[0].priority, 'medium');
  assert.match(r.actionItems[0].dueDate, /^\d{4}-\d{2}-\d{2}$/);
});

async function freshStoreFrom(adapter) { return NX.createStore(adapter).init(); }
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

test('workspace export scrubs legacy AI settings and round-trips through import', async () => {
  const s = await freshStore();
  await s.settings.update({ apiKey: 'sk-ant-secret', userName: 'Jordan' });
  const acct = await s.accounts.create({ name: 'Acme' });
  await s.deals.create({ accountId: acct.id, name: 'D', amount: '$1,200' });
  const s1 = await freshStoreFrom(s.adapter); // reload: legacy keys are dropped on init
  const snap = s1.workspace.snapshot();
  assert.equal(snap.settings.apiKey, undefined);
  assert.ok(!JSON.stringify(snap).includes('sk-ant-secret'));
  assert.equal(snap.deals[0].amount, 1200);
  const s2 = await freshStore();
  await s2.workspace.load(JSON.parse(JSON.stringify(snap)));
  assert.equal(s2.deals.list()[0].name, 'D');
  assert.equal(s2.settings.get().userName, 'Jordan');
  await assert.rejects(() => s2.workspace.load({ foo: 1 }), /not a workspace/);
});

// ---------------------------------------------------------------------------
// Analyzer against realistic inputs (tests/fixtures)
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
const fixture = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const ACCOUNTS = [{ id: 'a1', name: 'Contoso Health', partner: 'CDW' }, { id: 'a2', name: 'Fabrikam Manufacturing' }, { id: 'a3', name: 'Tailspin Logistics' }];
const DEALS = [
  { id: 'd1', accountId: 'a1', name: 'VMware exit – 3 site AHV migration', stage: 'develop' },
  { id: 'd5', accountId: 'a1', name: 'Nutanix Files for PACS', stage: 'tech_win' },
  { id: 'd4', accountId: 'a3', name: 'NC2 on AWS DR', stage: 'identified' },
];
const run = (f, extra = {}) => plain(NX.analyzer.processNotes(fixture(f), { accounts: ACCOUNTS, deals: DEALS, userName: 'Jordan Lee', meetingDate: MON, ...extra }));
const find = (r, re) => r.actionItems.find((a) => re.test(a.title));

test('Zoom AI Companion summary: recap, topics, list actions, account/deal, stage', () => {
  const r = run('zoom-summary.txt');
  assert.equal(r.format, 'summary');
  assert.equal(r.meetingDate, '2026-09-25'); // taken from the Zoom title
  assert.equal(r.matchedAccountId, 'a1');
  assert.equal(r.matchedDealId, 'd1');
  assert.match(r.summary, /^Jordan and the Contoso Health infrastructure team/);
  assert.equal(r.discussionPoints.length, 3);
  assert.match(r.discussionPoints[0], /^VMware Renewal and Cost Pressure — /);
  assert.deepEqual(pick(find(r, /success criteria document/)), { owner: 'me', dueDate: '2026-09-30' });
  assert.deepEqual(pick(find(r, /Epic ODB performance baseline/)), { owner: 'customer', dueDate: '2026-10-02' });
  assert.equal(find(r, /Ship three NX-8155/).owner, 'partner'); // Sam (CDW) — account's partner
  assert.equal(find(r, /Ship three NX-8155/).priority, 'high');
  assert.equal(find(r, /rack space/).owner, 'customer');
  assert.ok(!r.actionItems.some((a) => /^Draft the success criteria/.test(a.title)), 'prose restating a listed step is not duplicated');
  assert.equal(r.suggestedStage, 'tech_diff');
  assert.ok(r.risks.some((x) => /CFO/.test(x)));
  assert.ok(!r.decisions.some((x) => /not yet approved/.test(x)), 'negated approval is not a decision');
  assert.ok(r.competitors.includes('Azure Local'));
  assert.match(r.followUpEmail, /Next steps:/);
});

test('Zoom summary with next steps grouped under each person', () => {
  const r = run('zoom-summary-grouped.txt');
  assert.equal(r.matchedAccountId, 'a3');
  assert.equal(r.matchedDealId, 'd4');
  assert.equal(r.suggestedStage, 'tech_win'); // "POC was successful", "approved the design"
  assert.deepEqual(pick(find(r, /final BOM/)), { owner: 'me', dueDate: '2026-09-29' });
  assert.equal(find(r, /pricing/).dueDate, '2026-10-02');
  assert.deepEqual(pick(find(r, /VPC design/)), { owner: 'customer', dueDate: '2026-10-01' });
  const mark = find(r, /trial credits/);
  assert.equal(mark.owner, 'nutanix_other');
  assert.equal(mark.ownerName, 'Mark Chen');
  assert.ok(!r.attendees.some((a) => /Workshop/.test(a.name)));
});

test('WebVTT transcript: commitments, requests answered by the other speaker, follow-up meeting', () => {
  const r = run('zoom-transcript.vtt');
  assert.equal(r.format, 'transcript');
  assert.deepEqual(r.attendees.map((a) => a.name), ['Jordan Lee', 'Lee Park']);
  assert.deepEqual(pick(find(r, /sizing for NC2 DR/)), { owner: 'me', dueDate: '2026-10-02' });
  assert.equal(find(r, /TCO comparison/).dueDate, '2026-10-02', 'second clause inherits the sentence date');
  const rv = find(r, /RVTools export/);
  assert.equal(rv.owner, 'customer');
  assert.equal(rv.ownerName, 'Lee Park');
  assert.equal(rv.dueDate, '2026-09-29', '"I can get that to you tomorrow" sets the due date');
  assert.ok(!r.actionItems.some((a) => /get that/i.test(a.title)), 'vague reply is merged, not a new task');
  assert.ok(find(r, /calendar invite for follow-up call/));
  assert.ok(!r.actionItems.some((a) => /Thursday/.test(a.ownerName)));
  assert.equal(r.suggestedDealName, 'DR solution');
  assert.ok(r.risks.some((x) => /Budget is tight/.test(x)));
  assert.ok(!/um\b/i.test(r.summary), 'filler words removed');
});

test('Zoom web transcript layout ("Name  00:00:04" then text)', () => {
  const r = run('zoom-transcript-web.txt');
  assert.equal(r.format, 'transcript');
  assert.deepEqual(pick(find(r, /migration plan/)), { owner: 'me', dueDate: '2026-09-30' });
  assert.equal(find(r, /meeting with our CIO/).owner, 'customer');
  assert.equal(r.suggestedStage, 'develop');
  assert.ok(r.painPoints.some((x) => /4x/.test(x)));
});

test('rough bullet notes: imperative bullets, named owners, header attendees', () => {
  const r = run('rough-notes.txt');
  assert.equal(r.format, 'notes');
  assert.equal(r.matchedAccountId, 'a2');
  assert.deepEqual(r.attendees.filter((a) => a.role).map((a) => [a.name, a.role]), [['Maria', 'IT dir'], ['Tom', 'plant ops']]);
  assert.deepEqual(pick(find(r, /reference architecture deck/)), { owner: 'me', dueDate: '2026-09-29' });
  assert.deepEqual(pick(find(r, /site inventory/)), { owner: 'customer', dueDate: '2026-10-08' });
  assert.ok(find(r, /^Loop in AE on pricing$/));
  assert.ok(find(r, /Schedule workshop on edge architecture/));
  assert.ok(r.risks.some((x) => /^Budget not approved/.test(x)));
  assert.ok(r.competitors.includes('VxRail'));
});

test('owner falls back sensibly when the SE has not set their name', () => {
  const r = plain(NX.analyzer.processNotes('Next steps\n- Jordan to send the BOM by Friday\n- Dana to share RVTools', { accounts: [], deals: [], userName: '', meetingDate: MON }));
  assert.equal(find(r, /BOM/).owner, 'me'); // SE deliverable
  assert.equal(find(r, /RVTools/).owner, 'customer');
});

function pick(a) { assert.ok(a, 'action item exists'); return { owner: a.owner, dueDate: a.dueDate }; }
