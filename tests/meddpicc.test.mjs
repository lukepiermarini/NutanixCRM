// Unit tests for deals/meddpicc.js: scoreLetter and the meeting-notes extractor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({ Date, JSON, Math, RegExp });
vm.runInContext(readFileSync(join(root, 'deals', 'meddpicc.js'), 'utf8'), ctx, { filename: 'deals/meddpicc.js' });
const M = ctx.MEDDPICC;
const plain = (v) => JSON.parse(JSON.stringify(v));
const b = (criterion, extra = {}) => ({ id: criterion + Math.random(), text: 'Evidence for ' + criterion, criterion, source: 'customer', who: '', risk: false, ...extra });

test('rubric: eight letters in MEDDPICC order, each with required criteria and next steps', () => {
  assert.equal(M.RUBRIC.map((L) => L.letter).join(''), 'MEDDPICC');
  assert.deepEqual(plain(M.RUBRIC.map((L) => L.id)), ['metrics', 'economicBuyer', 'decisionCriteria', 'decisionProcess', 'paperProcess', 'identifiedPain', 'champion', 'competition']);
  for (const L of M.RUBRIC) {
    assert.ok(L.criteria.filter((c) => c.required).length === 2, L.id + ' has two required criteria');
    for (const c of L.criteria) assert.ok(c.id && c.text && c.next, L.id + '/' + c.id);
  }
});

test('scoreLetter: all five levels', () => {
  // Metrics has 6 criteria, 2 required (customerOwned, businessOutcome)
  let s = M.scoreLetter('metrics', []);
  assert.equal(s.level, 'none'); assert.equal(s.dots, 0); assert.equal(s.label, 'Not started');
  assert.equal(s.next, 'Get a number the customer owns', 'first unmet required criterion');

  s = M.scoreLetter('metrics', [b('baselineTarget'), b('proofPoint')]);       // 2/6 < half
  assert.equal(s.level, 'gap'); assert.equal(s.dots, 1); assert.equal(s.label, 'Gap');
  assert.equal(s.next, 'Get a number the customer owns');

  s = M.scoreLetter('metrics', [b('baselineTarget'), b('proofPoint'), b('technicalMeasure')]);   // 3/6 = half, required missing
  assert.equal(s.level, 'partial'); assert.equal(s.dots, 2);

  s = M.scoreLetter('metrics', [b('customerOwned'), b('businessOutcome'), b('baselineTarget'), b('proofPoint'), b('technicalMeasure')]);   // 5/6, required met
  assert.equal(s.level, 'strong'); assert.equal(s.dots, 3); assert.equal(s.label, 'Strong');
  assert.equal(s.next, 'Get the EB to sign up to the metrics', 'then the first unmet optional criterion');

  s = M.scoreLetter('metrics', M.BY_ID.metrics.criteria.map((c) => b(c.id)));
  assert.equal(s.level, 'strong'); assert.equal(s.next, 'Strong: keep it current');

  // all met but required missing can't be Strong: 4/6 with one required missing -> Partial
  s = M.scoreLetter('metrics', [b('customerOwned'), b('baselineTarget'), b('proofPoint'), b('technicalMeasure')]);
  assert.equal(s.level, 'partial'); assert.equal(s.next, 'Tie it to a business outcome');
  // required met but under 75%: 3/6 -> Partial
  s = M.scoreLetter('metrics', [b('customerOwned'), b('businessOutcome'), b('baselineTarget')]);
  assert.equal(s.level, 'partial');
});

test('scoreLetter: assumptions and blank bullets are not evidence', () => {
  let s = M.scoreLetter('champion', [b('identified', { source: 'assumption' }), b('tested', { source: 'assumption' })]);
  assert.equal(s.level, 'none');
  assert.deepEqual(plain(s.met), []);
  s = M.scoreLetter('champion', [b('identified', { text: '   ' })]);
  assert.equal(s.level, 'none');
  s = M.scoreLetter('champion', [b('identified', { source: 'notes', noteDate: '2026-11-02' }), b('tested', { source: 'confirmed' })]);
  assert.deepEqual(plain(s.met), ['identified', 'tested'], '"From notes" and "Confirmed" both count');
});

test('scoreLetter: a risk caps the letter at Partial, flags it, and is not evidence', () => {
  const all = M.BY_ID.champion.criteria.map((c) => b(c.id));
  assert.equal(M.scoreLetter('champion', all).level, 'strong');
  const s = M.scoreLetter('champion', [...all, b('tested', { risk: true, text: 'Champion failed to introduce us to the CIO' })]);
  assert.equal(s.level, 'partial'); assert.equal(s.risk, true); assert.equal(s.riskCount, 1);
  assert.equal(s.next, 'Resolve the flagged risk');
  // a risk bullet alone does not meet its criterion
  const r = M.scoreLetter('competition', [b('alternatives', { risk: true })]);
  assert.equal(r.level, 'none'); assert.equal(r.risk, true);
  // a risk doesn't lift a lower level
  assert.equal(M.scoreLetter('competition', [b('backers'), b('alternatives', { risk: true })]).level, 'gap');
});

test('scoreLetter: Economic Buyer "confirmed by two or more people" rule', () => {
  const confirmed = (s) => plain(s.met).includes('confirmed2');
  // one person saying it is not enough, even when tagged with the criterion
  assert.equal(confirmed(M.scoreLetter('economicBuyer', [b('named', { who: 'Dana' }), b('confirmed2', { who: 'Dana' })])), false);
  // a bullet sourced "Confirmed by 2+ people"
  assert.equal(confirmed(M.scoreLetter('economicBuyer', [b('named', { source: 'confirmed' })])), true);
  // two met bullets naming different people
  assert.equal(confirmed(M.scoreLetter('economicBuyer', [b('named', { who: 'Dana Whitfield' }), b('named', { who: 'Mark Lee' })])), true);
  // ...but not if one of them is only our assumption, or a risk
  assert.equal(confirmed(M.scoreLetter('economicBuyer', [b('named', { who: 'Dana' }), b('named', { who: 'Mark', source: 'assumption' })])), false);
  assert.equal(confirmed(M.scoreLetter('economicBuyer', [b('named', { who: 'Dana' }), b('named', { who: 'Mark', risk: true })])), false);
  // same person twice (case/spacing differences) is still one person
  assert.equal(confirmed(M.scoreLetter('economicBuyer', [b('named', { who: 'Dana ' }), b('confirmed2', { who: 'dana' })])), false);
  // EB can only be Strong with both required criteria
  const s = M.scoreLetter('economicBuyer', [b('named', { who: 'Dana' }), b('priorities'), b('howMuch'), b('funding'), b('access')]);
  assert.equal(s.level, 'partial'); assert.equal(s.next, 'Confirm the EB with a second person');
  assert.equal(M.scoreLetter('economicBuyer', [b('named', { who: 'Dana' }), b('named', { who: 'Mark' }), b('priorities'), b('howMuch'), b('funding')]).level, 'strong');
});

test('extractor: proposes the right letter and criterion for sample sentences', () => {
  const cases = [
    ['Dana Whitfield, the CFO, has final sign-off on the budget.', 'economicBuyer', 'named'],
    ['Our VMware renewal went up 4x and will cost us an extra $400k next year.', 'identifiedPain', 'quantified'],
    ['Our VMware renewal went up 4x and will cost us an extra $400k next year.', 'competition', 'alternatives'],
    ['They want to run a POC in January before it goes to the board for approval.', 'decisionProcess', 'validation'],
    ['Procurement and legal need to review the MSA, which usually takes about six weeks.', 'paperProcess', 'procurement'],
    ['Procurement and legal need to review the MSA, which usually takes about six weeks.', 'paperProcess', 'duration'],
    ['Mark introduced us to the CIO and walked us through their internal pitch.', 'champion', 'tested'],
    ['We need to cut backup times from 10 hours to 2 hours.', 'metrics', 'baselineTarget'],
    ['The board wants to see a lower TCO over five years.', 'metrics', 'businessOutcome'],
    ["We'll go through CDW as the reseller like last time.", 'paperProcess', 'route'],
  ];
  for (const [sentence, letter, criterion] of cases) {
    const ps = plain(M.extractMeddpiccFromNotes({ text: sentence, date: '2026-11-02' }, {}, M.RUBRIC));
    assert.ok(ps.some((p) => p.letter === letter && p.criterion === criterion), `${letter}/${criterion} from "${sentence}" — got ${ps.map((p) => p.letter + '/' + p.criterion).join(', ')}`);
    for (const p of ps) { assert.equal(p.source, 'notes'); assert.equal(p.noteDate, '2026-11-02'); assert.equal(p.quote, sentence); }
  }
});

test('extractor: suggests a risk flag for bad news', () => {
  const ps = plain(M.extractMeddpiccFromNotes('Honestly the RFP criteria were written around VxRail.', {}, M.RUBRIC));
  const dc = ps.find((p) => p.letter === 'decisionCriteria');
  assert.ok(dc && dc.risk === true, 'criteria written around a competitor is a risk');
  const champ = plain(M.extractMeddpiccFromNotes('Our champion failed to introduce us to the CFO.', {}, M.RUBRIC));
  assert.ok(champ.some((p) => p.letter === 'champion' && p.criterion === 'tested' && p.risk));
  const ok = plain(M.extractMeddpiccFromNotes('Dana Whitfield, the CFO, has final sign-off on the budget.', {}, M.RUBRIC));
  assert.ok(ok.every((p) => !p.risk), 'good news is not flagged');
});

test('extractor: takes speakers from transcripts and attendees from mentions', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Maria Gomez>We are paying way too much for VMware since Broadcom.</v>\n\n2\n00:00:05.000 --> 00:00:08.000\nLee Park: Procurement will need a security review before anything is signed.\n';
  const ps = plain(M.extractMeddpiccFromNotes({ text: vtt, date: '2026-11-02' }, {}, M.RUBRIC));
  assert.equal(ps.find((p) => p.letter === 'identifiedPain').who, 'Maria Gomez');
  assert.equal(ps.find((p) => p.letter === 'paperProcess').who, 'Lee Park');
  assert.ok(!ps.some((p) => /-->|WEBVTT|^\d+$/.test(p.text)), 'no transcript scaffolding in bullets');

  const zoom = readFileSync(join(root, 'tests/fixtures/zoom-transcript-web.txt'), 'utf8');
  const zp = plain(M.extractMeddpiccFromNotes(zoom, {}, M.RUBRIC));
  const pain = zp.find((p) => p.letter === 'identifiedPain');
  assert.ok(pain && pain.who === 'Maria Gomez', 'Zoom "Name  00:00:09" headers set the speaker');

  const mention = plain(M.extractMeddpiccFromNotes({ text: 'Dana has the final say on the budget.', attendees: 'Dana Whitfield, Mark Lee' }, {}, M.RUBRIC));
  assert.equal(mention.find((p) => p.criterion === 'named').who, 'Dana Whitfield');
  // headings aren't speakers
  assert.deepEqual(plain(M.parseNotes('Next steps:\nPain: they pay too much for licensing')).map((x) => x.speaker), ['']);
});

test('extractor: skips evidence the deal already has for the same criterion', () => {
  const sentence = 'Dana Whitfield, the CFO, has final sign-off on the budget.';
  const existing = { economicBuyer: [{ id: 'x', text: 'Dana Whitfield, the CFO, has final sign-off on the budget', criterion: 'named', source: 'customer', risk: false }] };
  const ps = plain(M.extractMeddpiccFromNotes(sentence, existing, M.RUBRIC));
  assert.ok(!ps.some((p) => p.letter === 'economicBuyer' && p.criterion === 'named'), 'duplicate skipped');
  // a different criterion with the same sentence is still allowed
  const other = { economicBuyer: [{ id: 'x', text: sentence, criterion: 'funding', source: 'customer' }] };
  assert.ok(plain(M.extractMeddpiccFromNotes(sentence, other, M.RUBRIC)).some((p) => p.criterion === 'named'));
});

test('extractor hook can be swapped and restored', () => {
  M.setExtractor(() => [{ id: 'z', letter: 'metrics', criterion: 'customerOwned', text: 'stub' }]);
  assert.equal(M.extractMeddpiccFromNotes('anything', {}, M.RUBRIC)[0].text, 'stub');
  M.setExtractor(null);
  assert.deepEqual(plain(M.extractMeddpiccFromNotes('Nothing relevant was said here today at all.', {}, M.RUBRIC)), []);
});
