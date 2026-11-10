// End-to-end test of deals/deal-tracker.html in Chromium, in its local (single-browser) mode.
// Two tabs act as two people ("you" and "josh") sharing one localStorage database,
// so we can check that one person's edits are highlighted for the other.
// Run: node tests/deals-e2e.mjs   (needs the `playwright` package)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS_DIR || join(root, 'tests', 'screenshots');
mkdirSync(shots, { recursive: true });

// The page is authored as a fragment (claude.ai adds the document skeleton), so wrap it for local runs.
const dir = join(tmpdir(), 'deal-tracker-e2e'); mkdirSync(dir, { recursive: true });
const file = join(dir, 'index.html');
writeFileSync(file, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">'
  + readFileSync(join(root, 'deals', 'deal-tracker.html'), 'utf8') + '</body></html>');
const url = pathToFileURL(file).href;

const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
const errors = [];
const open = async (who) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(who + ': ' + e.message));
  await p.goto(url + '?as=' + who + '#deals');
  await p.waitForSelector('.empty:not([hidden]), .row');
  return p;
};

const me = await open('you');
await me.evaluate(() => localStorage.clear());
await me.reload(); await me.waitForSelector('.empty:not([hidden])');
assert.match(await me.textContent('#empty'), /No deals yet/);

// Create a deal, add steps, a due date, links and a checklist answer.
await me.fill('#addIn', 'Ogden School District build (3:1 ratio) HPE and NX');
await me.press('#addIn', 'Enter');
// A new deal goes straight into adding steps inline (no separate edit page)
await me.waitForSelector('.row .addstep-in');
assert.equal(await me.evaluate(() => document.activeElement.classList.contains('addstep-in')), true, 'add-step box is focused');
const row = me.locator('.row').first();
for (const [i, s] of ['Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden'].entries()) {
  await me.keyboard.type(s); await me.keyboard.press('Enter');
  await me.waitForFunction((n) => document.querySelectorAll('.row .step').length === n, i + 1);
}
await me.keyboard.press('Escape');
assert.equal(await me.locator('.ed').count(), 0, 'no edit page for deals');
assert.equal(await me.locator('.mstrip, .meddp, .mpanel').count(), 0, 'no MEDDPICC section');
await row.locator('.step').nth(0).locator('.bx').click();
await me.waitForFunction(() => document.querySelectorAll('.row .step.done').length === 1);
await row.locator('.step').nth(1).locator('.bx').click();
await me.waitForFunction(() => document.querySelectorAll('.row .step.done').length === 2);
await row.locator('li:has(.step.next) .adddate').click();
await me.fill('.duedit input[type=date]', '2030-03-05'); await me.fill('.duedit input[type=time]', '11:30');
await me.click('.duedit .btn.primary');
for (const [label, url] of [['Hybrid', 'https://sizer.nutanix.com/#/scenario/S-1753764'], ['All flash', 'sizer.nutanix.com/#/scenario/S-1753621']]) {
  await row.locator('.lnkadd').click();
  await me.fill('.linkadd .u', url); await me.fill('.linkadd .l', label); await me.press('.linkadd .l', 'Enter');
  await me.waitForSelector('.linkadd', { state: 'detached' });
}
await row.locator('.chk', { hasText: 'Impl. strategy' }).click();
await me.waitForFunction(() => /Yes/.test(document.querySelectorAll('.row .chk')[1]?.textContent || ''));

assert.equal(await row.locator('.step').count(), 4);
assert.equal(await row.locator('.step.done').count(), 2);
assert.match(await row.locator('.step.next').textContent(), /Meeting with Wilden/);
assert.equal(await row.locator('.lnk').count(), 2, 'unlimited links render');
assert.match(await row.locator('.lnk').nth(1).getAttribute('href'), /^https:\/\/sizer/);
assert.match(await row.locator('.chk', { hasText: 'Impl. strategy' }).textContent(), /Yes/);
assert.match(await row.locator('li:has(.step.next) .sdue .due').textContent(), /11:30/, 'next step date sits under the NEXT pill');
assert.equal(await me.locator('.row.upd').count(), 0, 'own edits are not highlighted');
assert.equal(await row.evaluate((e) => getComputedStyle(e).borderBottomWidth), '2px', 'bold divider between deals');

// "No" answers are red, "Yes" answers are not
const noBg = await row.locator('.chk:not(.yes) b').first().evaluate((b) => getComputedStyle(b).backgroundColor);
const yesBg = await row.locator('.chk.yes b').first().evaluate((b) => getComputedStyle(b).backgroundColor);
assert.equal(noBg, 'rgb(214, 58, 58)', 'No badge is red');
assert.notEqual(yesBg, noBg);

// Land & Expand / Renewal toggle sits right after the deal name
const dt = row.locator('.dtype');
const tb0 = await row.locator('.title').boundingBox(), db0 = await dt.boundingBox();
assert.ok(db0.x - (tb0.x + tb0.width) < 20 && Math.abs(db0.y - tb0.y) < 12, 'toggle is directly right of the name');
assert.deepEqual(await dt.locator('button').allTextContents(), ['Land & Expand', 'Renewal']);
const pressed = () => dt.locator('button[aria-pressed=true]').allTextContents();
assert.deepEqual(await pressed(), [], 'starts unset');
await dt.locator('button.land').click();
await me.waitForFunction(() => document.querySelector('.row .dtype .land')?.getAttribute('aria-pressed') === 'true');
await dt.locator('button.renewal').click();
await me.waitForFunction(() => document.querySelector('.row .dtype .renewal')?.getAttribute('aria-pressed') === 'true');
assert.deepEqual(await pressed(), ['Renewal'], 'only one option at a time');
await me.reload(); await me.waitForSelector('.row .dtype');
assert.deepEqual(await pressed(), ['Renewal'], 'saved');
await dt.locator('button.renewal').click();
await me.waitForFunction(() => !document.querySelector('.row .dtype [aria-pressed=true]'));

// ---------- Deal progress: Sales Stage + Tech Close ----------
const prog = row.locator('.prog');
const st = (n) => prog.locator(`[data-fk="st${n}"]`);
const tc = (v) => prog.locator(`[data-fk="tc${v}"]`);
const box = (l) => l.boundingBox();
const dealDoc = () => me.evaluate(() => Object.values(JSON.parse(localStorage.getItem('crm.localdb.v1')).deals)[0]);
const current = async (rowSel) => prog.locator(`.pseg.${rowSel}[aria-current="step"]`).evaluateAll((els) => els.map((e) => e.dataset.fk));
// Placement: directly right of Land & Expand / Renewal, same row
await me.setViewportSize({ width: 1600, height: 1100 });
{ const d = await box(row.locator('.dtype')), p = await box(prog);
  assert.ok(p.x >= d.x + d.width && p.x - (d.x + d.width) < 24 && Math.abs(p.y - d.y) < 14, 'tracker sits right of the deal-type toggle');
  assert.ok(p.width > 600, 'tracker stretches into the free space (' + Math.round(p.width) + 'px)');
  const w = await prog.locator('.pseg.tc').first().evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(w >= 50, 'Tech Close cells have room (' + Math.round(w) + 'px)'); }
await me.setViewportSize({ width: 1280, height: 1100 });
// Not enough room beside a long title: it moves to its own line at full width instead of squishing
{ const d = await box(row.locator('.dtype')), p = await box(prog);
  const sameRow = Math.abs(p.y - d.y) < 14;
  assert.ok(sameRow ? p.width >= 440 : (p.y > d.y + d.height && p.width > 600), `tracker stays readable at 1280px (sameRow=${sameRow}, width ${Math.round(p.width)})`);
  assert.ok(await prog.locator('.pseg.tc').first().evaluate((e) => e.getBoundingClientRect().width) >= 34, 'Tech Close cells not squished'); }
// Names, order and unset default
assert.deepEqual(await prog.locator('.pseg.st:not(.nine)').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
  ['Stage 1: Identified Opportunity', 'Stage 2: Opportunity Discovery', 'Stage 3: Develop Opportunity', 'Stage 4: Technical Differentiation',
   'Stage 5: Technical Win', 'Stage 6: Commercial Win', 'Stage 7: Order Statuses', 'Stage 8: Closed Won']);
assert.deepEqual(await prog.locator('.pseg.tc').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
  ['Tech Close 0%: Acknowledgement', 'Tech Close 25%: Discovery', 'Tech Close 50%: Solutioning', 'Tech Close 75%: Proposal Review',
   'Tech Close 99%: Executive Validation', 'Tech Close 100%: Tech Closed']);
assert.equal(await prog.locator('[aria-current]').count(), 0, 'new deals start unset');
assert.equal(await prog.locator('.pseg.on').count(), 0);
assert.equal(await prog.locator('.plbl').first().textContent(), 'Stage');
assert.equal(await prog.locator('.plbl').nth(1).textContent(), 'Tech Close');
// Shape: each bar is one capsule of equal cells; Tech Close spans Stages 1–5 and ends at Stage 5
{ const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} (${a.toFixed(1)} vs ${b.toFixed(1)})`);
  const stBar = await box(prog.locator('.pbar.st')), tcBar = await box(prog.locator('.pbar.tc'));
  assert.equal(await prog.locator('.pbar.st > .pseg').count(), 8, 'eight stage cells inside the Sales Stage bar');
  assert.equal(await prog.locator('.pbar.tc > .pseg').count(), 6, 'six cells inside the Tech Close bar');
  for (const sel of ['.pbar.st > .pseg', '.pbar.tc > .pseg']) {
    const ws = await prog.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    assert.ok(Math.max(...ws) - Math.min(...ws) < 1, `${sel} cells are all the same size (${ws.map((w) => w.toFixed(1)).join(', ')})`);
  }
  assert.equal(await prog.locator('.pbar.st').evaluate((e) => getComputedStyle(e).borderTopLeftRadius), '999px', 'capsule shape');
  const s1 = await box(st(1)), s5 = await box(st(5)), s6 = await box(st(6));
  near(tcBar.x, stBar.x, 1, 'Tech Close starts with Sales Stage');
  near(tcBar.x + tcBar.width, s5.x + s5.width, 4, 'Tech Close ends at Stage 5');
  assert.ok(tcBar.x + tcBar.width < s6.x, 'nothing under Stages 6–8');
  near(tcBar.height, stBar.height, 0.5, 'both bars are the same height');
  assert.ok(tcBar.y > stBar.y + stBar.height - 1, 'Tech Close is below Sales Stage');
  assert.deepEqual(await prog.locator('.pseg.tc').allTextContents(), ['0%', '25%', '50%', '75%', '99%', '100%'], 'percentages inside the cells');
  assert.deepEqual(await prog.locator('.pbar.st > .pseg').allTextContents(), ['1', '2', '3', '4', '5', '6', '7', '8'], 'stage numbers inside the cells');
  assert.equal(await prog.locator('.phelp').count(), 0, 'no "?" button'); }
// Breathing room: progress bars -> steps, and step dates -> links
{ const pb = await box(prog.locator('.pbar.tc')), tr = await box(row.locator('.track')), mt = await box(row.locator('.meta'));
  const dates = await row.locator('.track .sdue').evaluateAll((els) => Math.max(0, ...els.map((e) => e.getBoundingClientRect().bottom)));
  assert.ok(tr.y - (pb.y + pb.height) >= 20, 'space between Tech Close and the steps (' + Math.round(tr.y - (pb.y + pb.height)) + 'px)');
  assert.ok(mt.y - Math.max(tr.y + tr.height, dates) >= 20, 'space between the step dates and the links (' + Math.round(mt.y - Math.max(tr.y + tr.height, dates)) + 'px)'); }
// Click sets immediately; fill up to and including current
await st(3).click();
await me.waitForFunction(() => document.querySelector('.row [data-fk="st3"]')?.getAttribute('aria-current') === 'step');
assert.deepEqual(await prog.locator('.pseg.st.on').evaluateAll((els) => els.map((e) => e.dataset.fk)), ['st1', 'st2', 'st3']);
assert.equal(await st(3).evaluate((e) => getComputedStyle(e).boxShadow), 'none', 'no outline on the current stage');
assert.equal(await st(3).evaluate((e) => getComputedStyle(e).fontWeight), '800', 'current stage is bold');
assert.equal(await st(2).evaluate((e) => getComputedStyle(e).boxShadow), 'none');
await tc(50).click();
await me.waitForFunction(() => document.querySelector('.row [data-fk="tc50"]')?.getAttribute('aria-current') === 'step');
assert.deepEqual(await prog.locator('.pseg.tc.on').evaluateAll((els) => els.map((e) => e.dataset.fk)), ['tc0', 'tc25', 'tc50']);
assert.deepEqual(await current('st'), ['st3'], 'Tech Close does not change the stage');
{ const d = await dealDoc(); assert.equal(d.salesStage, 3); assert.equal(d.techClose, 50); assert.equal(d.orderStatus ?? null, null); }
// Keyboard: segments are reachable and operable, and focus stays put through the save
await st(5).focus(); await me.keyboard.press('Enter');
await me.waitForFunction(() => document.querySelector('.row [data-fk="st5"]')?.getAttribute('aria-current') === 'step');
assert.equal(await me.evaluate(() => document.activeElement?.dataset.fk), 'st5', 'focus stays on the segment after saving');
await me.keyboard.press('Tab');
assert.equal(await me.evaluate(() => document.activeElement?.dataset.fk), 'st6', 'Tab moves to the next stage');
await tc(99).focus(); await me.keyboard.press('Space');
await me.waitForFunction(() => document.querySelector('.row [data-fk="tc99"]')?.getAttribute('aria-current') === 'step');
assert.deepEqual(await current('st'), ['st5'], 'stage unchanged by Tech Close');
// Survives reload
await me.reload(); await me.waitForSelector('.row .prog');
assert.deepEqual(await current('st'), ['st5']); assert.deepEqual(await current('tc'), ['tc99']);
// Stage 7 opens the order-status menu (keyboard)
await st(7).focus(); await me.keyboard.press('Enter');
await me.waitForSelector('.pop[role="menu"]');
assert.deepEqual(await me.locator('.pop .mi').allTextContents(), ['Order with Reseller', 'Order with Distributor', 'Order with OEM', 'Order with Nutanix', 'SP Proxy Closed']);
await me.waitForFunction(() => document.querySelector('.row [data-fk="st7"]')?.getAttribute('aria-current') === 'step');
await me.keyboard.press('ArrowDown');   // first item -> second
await me.keyboard.press('Enter');
await me.waitForSelector('.pop', { state: 'detached' });
await me.waitForFunction(() => document.querySelector('.row .olbl')?.textContent.includes('Distributor'));
assert.match(await st(7).getAttribute('aria-label'), /Stage 7: Order Statuses \(Order with Distributor\)/);
{ const d = await dealDoc(); assert.equal(d.salesStage, 7); assert.equal(d.orderStatus, 'distributor'); }
// Esc closes a menu without changing anything, and returns focus
await st(7).click(); await me.waitForSelector('.pop[role="menu"]');
assert.equal(await me.locator('.pop .mi[aria-checked="true"]').textContent(), 'Order with Distributor');
await me.keyboard.press('Escape');
await me.waitForSelector('.pop', { state: 'detached' });
assert.equal(await me.evaluate(() => document.activeElement?.dataset.fk), 'st7', 'focus returns to Stage 7');
assert.equal(await me.locator('.row.open').count(), 0, 'Esc on the menu does not touch the details panel');
// Stage 9 outcome: asks, greys out the stage bar, red badge; Tech Close untouched
await st(9).click(); await me.waitForSelector('.pop[role="menu"]');
assert.deepEqual(await me.locator('.pop .mi').allTextContents(), ['Closed Lost', 'Disqualified']);
await me.locator('.pop .mi', { hasText: 'Disqualified' }).click();
await me.waitForFunction(() => document.querySelector('.row .prog')?.classList.contains('is-out'));
assert.equal(await st(9).locator('.full').textContent(), 'Disqualified');
assert.equal(await st(9).evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(214, 58, 58)', 'red outcome badge');
assert.equal(await prog.locator('.pseg.st.on:not(.nine)').count(), 0, 'stage progress greyed out');
assert.equal(await prog.locator('.olbl').count(), 0, 'order status cleared off Stage 7');
assert.deepEqual(await current('tc'), ['tc99'], 'Tech Close independent of the outcome');
{ const d = await dealDoc(); assert.equal(d.salesStage, 9); assert.equal(d.closedOutcome, 'disqualified'); assert.equal(d.orderStatus, null); }
// Choosing a stage 1–8 clears the outcome
await st(4).click();
await me.waitForFunction(() => !document.querySelector('.row .prog').classList.contains('is-out'));
{ const d = await dealDoc(); assert.equal(d.salesStage, 4); assert.equal(d.closedOutcome, null); }
// Hover tooltips: what each step requires and what it takes to reach the next one
const tipFor = async (loc) => { await me.locator('.head h1').hover(); await me.waitForSelector('.ptip', { state: 'detached' }); await loc.hover(); await me.waitForSelector('.ptip'); return me.locator('.ptip').textContent(); };
let tip = await tipFor(st(3));
assert.ok(tip.startsWith('Stage 3: Develop Opportunity'), tip);
assert.ok(tip.includes('RequirementsResources identified and validated; requirements, timing and key stakeholders\' interests established.'), tip);
assert.ok(tip.includes('To move to Stage 4: Technical DifferentiationConfiguration being set for the agreed use case;'), tip);
assert.equal(await st(3).getAttribute('aria-describedby'), 'ptip', 'tooltip is the cell\'s description');
assert.equal(await me.locator('.ptip').getAttribute('role'), 'tooltip');
{ const tb = await box(me.locator('.ptip')); assert.ok(tb.x >= 15 && tb.x + tb.width <= 1281 - 15, 'tooltip stays on screen'); }
await me.locator('.head h1').hover(); await me.waitForSelector('.ptip', { state: 'detached' });
assert.equal(await st(3).getAttribute('aria-describedby'), null);
assert.match(await tipFor(st(4)), /Current stage\. Click again to clear it\./, 'current stage says how to clear');
assert.match(await tipFor(st(7)), /Click to set this stage, then choose the order status\./);
tip = await tipFor(st(8));
assert.ok(tip.includes('A clean PO received and processed by the Orders Team.') && tip.includes('This is the final stage.'), tip);
tip = await tipFor(st(9));
assert.ok(tip.includes("Lost means we competed and lost (Stage 2 or later); Disqualified means we didn't compete."), tip);
tip = await tipFor(tc(75));
assert.ok(tip.startsWith('Tech Close 75%: Proposal Review') && tip.includes('Engage Bid Desk.') && tip.includes('To move to 99%: Executive Validation') && tip.includes('Implementation plan final;'), tip);
assert.match(await tipFor(tc(99)), /Current\. Click again to clear it\./);
tip = await tipFor(tc(100));
assert.ok(tip.includes('firm "Why Nutanix"') && tip.includes('This is the final Tech Close step.'), tip);
for (const [fk, title] of [['st1', 'Stage 1: Identified Opportunity'], ['st2', 'Stage 2: Opportunity Discovery'], ['st5', 'Stage 5: Technical Win'], ['st6', 'Stage 6: Commercial Win'],
  ['tc0', 'Tech Close 0%: Acknowledgement'], ['tc25', 'Tech Close 25%: Discovery'], ['tc50', 'Tech Close 50%: Solutioning']])
  assert.ok((await tipFor(prog.locator(`[data-fk="${fk}"]`))).startsWith(title), 'tooltip for ' + fk);
await me.locator('.head h1').hover(); await me.waitForSelector('.ptip', { state: 'detached' });
// Keyboard focus shows it too; Esc hides it without closing anything else
await st(1).focus(); await me.keyboard.press('Tab');
await me.waitForSelector('.ptip');
assert.ok((await me.locator('.ptip').textContent()).startsWith('Stage 2: Opportunity Discovery'));
await me.keyboard.press('Escape'); await me.waitForSelector('.ptip', { state: 'detached' });
assert.equal(await me.evaluate(() => document.activeElement?.dataset.fk), 'st2', 'focus stays put');
await me.keyboard.press('Shift+Tab'); await me.waitForSelector('.ptip');   // moving focus shows the next one
await me.locator('.head h1').click(); await me.waitForSelector('.ptip', { state: 'detached' });
// Clearing: clicking the current cell again clears that bar (the other bar is untouched)
await st(4).click();
await me.waitForFunction(() => !document.querySelector('.row .prog .pseg.st[aria-current]'));
assert.deepEqual(await current('tc'), ['tc99'], 'clearing the stage leaves Tech Close');
await tc(99).click();
await me.waitForFunction(() => !document.querySelector('.row .prog [aria-current]'));
await me.reload(); await me.waitForSelector('.row .prog');
assert.equal(await prog.locator('[aria-current]').count(), 0, 'cleared values stay cleared after reload');
assert.equal(await prog.locator('.pseg.on').count(), 0);
{ const d = await dealDoc(); assert.equal(d.salesStage, null); assert.equal(d.techClose, null); assert.equal(d.orderStatus, null); assert.equal(d.closedOutcome, null); }
// ...and Stage 7 / Stage 9 menus have a Clear option once set
await st(7).click(); await me.locator('.pop .mi', { hasText: 'Order with OEM' }).click();
await me.waitForFunction(() => document.querySelector('.row .olbl')?.textContent.includes('OEM'));
await st(7).click(); await me.waitForSelector('.pop[role="menu"]');
await me.locator('.pop .mi', { hasText: 'Clear Sales Stage' }).click();
await me.waitForFunction(() => !document.querySelector('.row .prog [aria-current]') && !document.querySelector('.row .olbl'));
await st(9).click(); assert.equal(await me.locator('.pop .mi', { hasText: 'Clear' }).count(), 0, 'nothing to clear yet');
await me.locator('.pop .mi', { hasText: 'Closed Lost' }).click();
await me.waitForFunction(() => document.querySelector('.row .prog.is-out'));
await st(9).click(); await me.locator('.pop .mi', { hasText: 'Clear Sales Stage' }).click();
await me.waitForFunction(() => !document.querySelector('.row .prog.is-out') && !document.querySelector('.row .prog [aria-current]'));
{ const d = await dealDoc(); assert.equal(d.salesStage, null); assert.equal(d.closedOutcome, null); }
// Leave a value set for the two-person check below
await tc(25).click();
await me.waitForFunction(() => document.querySelector('.row [data-fk="tc25"]')?.getAttribute('aria-current') === 'step');

// Checklist pill wording
assert.match(await row.locator('.chk').first().textContent(), /^Updated Recent Notes/);

// Links: blue icons and a + square after the last link opens an inline add box
assert.equal(await row.locator('.lnk > svg').first().evaluate((e) => getComputedStyle(e).color), 'rgb(23, 105, 224)', 'link icons are blue');
assert.equal(await row.locator('.lnk code').first().evaluate((e) => getComputedStyle(e).color), 'rgb(23, 105, 224)', 'Sizer ID is the same blue');
assert.equal(await row.locator('.lnk > span:last-child svg').first().evaluate((e) => getComputedStyle(e).color), 'rgb(23, 105, 224)', 'open-in-new-tab arrow is the same blue');
await row.locator('.lnkadd').click();
await me.fill('.linkadd .u', 'https://sizer.nutanix.com/#/scenario/S-1757241');
await me.fill('.linkadd .l', 'Half the cores');
await me.press('.linkadd .l', 'Enter');
await me.waitForFunction(() => document.querySelectorAll('.row .lnk').length === 3);
assert.match(await row.locator('.lnk').nth(2).textContent(), /Half the cores.*S-1757241/);
assert.equal(await row.locator('.lnkadd').count(), 1, 'the + returns after adding');

// Past step: the check box still unticks, but clicking the name shows its date (or a place to add one)
await row.locator('.step', { hasText: 'Sizer' }).locator('.slabel').click();
await row.locator('li:has(.step:has-text("Sizer")) .adddate').click();
await me.fill('.duedit input[type=date]', '2030-01-02');
await me.fill('.duedit input[type=time]', '09:15');
await me.click('.duedit .btn.primary');
await me.waitForFunction(() => /9:15/.test(document.querySelector('.row li:first-child .sdue')?.textContent || ''));
assert.equal(await row.locator('.step.done').count(), 2, 'clicking the name does not untick the step');
await row.locator('.step', { hasText: 'Sizer' }).locator('.slabel').click();
assert.equal(await row.locator('li:has(.step:has-text("Sizer")) .sdue').count(), 0, 'clicking again hides it');
await row.locator('.step', { hasText: 'Frontline' }).locator('.bx').click();
await me.waitForFunction(() => document.querySelectorAll('.row .step.done').length === 1);
await row.locator('.step', { hasText: 'Frontline' }).locator('.bx').click();
await me.waitForFunction(() => document.querySelectorAll('.row .step.done').length === 2);
// Links edit in place: hover shows a pencil; change the label and address, then delete it
const l3 = row.locator('.lnkw').nth(2);
assert.equal(await l3.locator('.lnkedit').evaluate((e) => getComputedStyle(e).opacity), '0', 'link pencil hidden until hover');
await l3.hover();
assert.equal(await l3.locator('.lnkedit').evaluate((e) => getComputedStyle(e).opacity), '1', 'link pencil shows on hover');
await l3.locator('.lnkedit').click();
await me.waitForSelector('.linkadd .l');
assert.equal(await me.inputValue('.linkadd .l'), 'Half the cores');
await me.fill('.linkadd .l', 'Half the cores v2');
await me.fill('.linkadd .u', 'https://sizer.nutanix.com/#/scenario/S-1757999');
await me.press('.linkadd .u', 'Enter');
await me.waitForSelector('.linkadd', { state: 'detached' });
assert.match(await row.locator('.lnk').nth(2).textContent(), /Half the cores v2.*S-1757999/);
await row.locator('.lnkw').nth(2).hover(); await row.locator('.lnkw').nth(2).locator('.lnkedit').click();
await me.press('.linkadd .l', 'Escape'); await me.waitForSelector('.linkadd', { state: 'detached' });
assert.equal(await row.locator('.lnk').count(), 3, 'Esc cancels');
await row.locator('.lnkw').nth(2).hover(); await row.locator('.lnkw').nth(2).locator('.lnkedit').click();
await me.locator('.linkadd').getByRole('button', { name: 'Delete' }).click();
await me.waitForFunction(() => document.querySelectorAll('.row .lnk').length === 2);

// The deal name: text cursor on hover, click to rename in place; no Edit pill or details page for deals
assert.equal(await row.locator('.title').evaluate((e) => getComputedStyle(e).cursor), 'text');
assert.equal(await row.locator('.rowedit').count(), 0); assert.equal(await row.locator('.info').count(), 0);
await row.locator('.title').click();
await me.waitForSelector('.titleedit input');
assert.equal(await me.inputValue('.titleedit input'), 'Ogden School District build (3:1 ratio) HPE and NX');
await me.fill('.titleedit input', 'Ogden SD build');
await me.press('.titleedit input', 'Enter');
await me.waitForFunction(() => document.querySelector('.row .title')?.textContent === 'Ogden SD build');
await row.locator('.title').click(); await me.fill('.titleedit input', 'zzz'); await me.press('.titleedit input', 'Escape');
await me.waitForFunction(() => document.querySelector('.row .title')?.textContent === 'Ogden SD build');
assert.equal(await me.locator('.ed').count(), 0, 'Esc only cancelled the rename');
await row.locator('.title').click(); await me.fill('.titleedit input', 'Ogden School District build (3:1 ratio) HPE and NX');
await me.locator('.head h1').click();   // clicking away saves
await me.waitForFunction(() => document.querySelector('.row .title')?.textContent === 'Ogden School District build (3:1 ratio) HPE and NX');
// Salesforce account link right below the deal name
await row.getByRole('button', { name: 'Add Salesforce link' }).click();
await me.fill('.sfedit-form input', 'https://nutanix.lightning.force.com/lightning/r/Opportunity/006Ab00000XyZ12/view');
await me.press('.sfedit-form input', 'Enter');
await me.waitForSelector('.row .sflink');
{ const tb = await row.locator('.title').boundingBox(), lb = await row.locator('.sflink').boundingBox();
  assert.ok(lb.y >= tb.y + tb.height - 1 && Math.abs(lb.x - tb.x) < 2, 'link sits right below the name'); }
assert.equal(await row.locator('.sflink').getAttribute('href'), 'https://nutanix.lightning.force.com/lightning/r/Opportunity/006Ab00000XyZ12/view');
assert.equal(await row.locator('.sflink').getAttribute('target'), '_blank');
assert.match(await row.locator('.sflink').textContent(), /^Salesforce Account$/);
await row.locator('.sfw').hover(); await row.getByRole('button', { name: 'Change the Salesforce link' }).click();
await me.fill('.sfedit-form input', 'https://nutanix.lightning.force.com/lightning/r/Opportunity/006Ab00000XyZ99/view'); await me.press('.sfedit-form input', 'Enter');
await me.reload(); await me.waitForSelector('.row .sflink');
assert.match(await row.locator('.sflink').getAttribute('href'), /XyZ99/, 'saved');
await row.locator('.sfw').hover(); await row.getByRole('button', { name: 'Change the Salesforce link' }).click();
await me.locator('.sfedit-form').getByRole('button', { name: 'Remove' }).click();
await me.waitForSelector('.row .addsf');
await row.getByRole('button', { name: 'Add Salesforce link' }).click();
await me.fill('.sfedit-form input', 'https://nutanix.lightning.force.com/lightning/r/Opportunity/006Ab00000XyZ12/view'); await me.press('.sfedit-form input', 'Enter');
await me.waitForSelector('.row .sflink');

// No deal-level notes: notes live on steps. Click a step to reveal its date and a post-it button
assert.equal(await row.locator('.addnote, p.note').count(), 0, 'no deal-level notes section');
const sz = () => row.locator('.step', { hasText: 'Sizer' });
await sz().locator('.slabel').click();
assert.equal(await sz().locator('.slabel').getAttribute('aria-expanded'), 'true');
await row.locator('li:has(.step:has-text("Sizer")) .addpost').click();
await me.waitForSelector('.snote textarea');
await me.keyboard.type('Sizer run with 3:1 ratio for HPE and NX');
await me.locator('.head h1').click();   // click away saves
await me.waitForFunction(() => document.querySelector('.row .snote .snote-t')?.textContent === 'Sizer run with 3:1 ratio for HPE and NX');
assert.equal(await row.locator('li:has(.step:has-text("Sizer")) .addpost').textContent(), 'Add another note', 'more notes can be added');
{ const nb = await row.locator('.snote').boundingBox(), pb = await sz().boundingBox();
  assert.ok(nb.y > pb.y + pb.height && Math.abs(nb.x - pb.x) < 1.5, 'note sits directly under its step');
  assert.ok(Math.abs(nb.width - pb.width) < 1.5, `note is exactly as wide as its step (${nb.width.toFixed(1)} vs ${pb.width.toFixed(1)})`); }
// steps are never narrower than ~"Meeting with Wilden", so details under neighbouring steps don't collide
assert.ok((await row.locator('.step').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))).every((w) => w >= 199.5), 'minimum step width');
await row.locator('.step', { hasText: 'Frontline' }).locator('.slabel').click();
{ const boxes = await row.locator('.track > li[data-sid]').evaluateAll((els) => els.slice(0, 3).map((li) => [...li.querySelectorAll('.sdue > *, .snote')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; })));
  const cols = await row.locator('.track > li[data-sid] .step').evaluateAll((els) => els.slice(0, 3).map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  boxes.forEach((bs, i) => bs.forEach(([l, r]) => assert.ok(l >= cols[i][0] - 0.5 && r <= cols[i][1] + 0.5, `details of step ${i} stay within its pill (${l.toFixed(0)}-${r.toFixed(0)} vs ${cols[i][0].toFixed(0)}-${cols[i][1].toFixed(0)})`))); }
await row.locator('.step', { hasText: 'Frontline' }).locator('.slabel').click();
// click the step again: note hidden, a small post-it mark shows it has one
await sz().locator('.slabel').click();
assert.equal(await row.locator('.snote').count(), 0);
assert.equal(await sz().locator('.snote-mk').count(), 1);
// reveal and edit: Esc cancels, click-away saves
await sz().locator('.slabel').click();
await row.locator('.snote .snote-t').click(); await me.keyboard.type(' zzz'); await me.keyboard.press('Escape');
await me.waitForFunction(() => document.querySelector('.row .snote .snote-t')?.textContent === 'Sizer run with 3:1 ratio for HPE and NX');
await row.locator('.snote .snote-t').click(); await me.keyboard.type(' (confirmed)'); await me.locator('.head h1').click();
await me.waitForFunction(() => document.querySelector('.row .snote .snote-t')?.textContent === 'Sizer run with 3:1 ratio for HPE and NX (confirmed)');
// several notes per step
await row.locator('li:has(.step:has-text("Sizer")) .addpost').click();
await me.keyboard.type('Second pass at 4:1 for the DR site, which ended up needing a lot more storage than the first estimate suggested'); await me.locator('.head h1').click();
await me.waitForFunction(() => !document.querySelector('.row .snote.editing') && document.querySelectorAll('.row .snote').length === 2);
const sNotes = row.locator('li:has(.step:has-text("Sizer")) .snote');
assert.deepEqual(await sNotes.locator('.snote-t').allTextContents(), ['Sizer run with 3:1 ratio for HPE and NX (confirmed)', 'Second pass at 4:1 for the DR site, which ended up needing a lot more storage than the first estimate suggested']);
// notes start collapsed to one line with "…"; the arrow expands (and collapses) them
assert.equal(await sNotes.locator('.snote-t').first().evaluate((e) => getComputedStyle(e).textOverflow), 'ellipsis');
assert.equal(await row.locator('.snote.collapsed').count(), 2, 'collapsed by default');
const n2 = sNotes.nth(1), short = (await n2.boundingBox()).height;
assert.ok(await n2.locator('.snote-t').evaluate((e) => e.scrollWidth > e.clientWidth), 'long note is cut off with …');
await n2.getByRole('button', { name: 'Expand note' }).click();
await me.waitForFunction(() => document.querySelectorAll('.row .snote.collapsed').length === 1);
const tall = (await n2.boundingBox()).height;
assert.ok(tall > short + 10, `expanded note shows all of it (${tall} > ${short})`);
await n2.getByRole('button', { name: 'Collapse note' }).click();
await me.waitForFunction(() => document.querySelectorAll('.row .snote.collapsed').length === 2);
await n2.getByRole('button', { name: 'Expand note' }).click();
await me.reload(); await me.waitForSelector('.row .step'); await sz().locator('.slabel').click();
assert.equal(await row.locator('.snote.collapsed').count(), 1, 'what you expanded is remembered in this browser');
assert.equal(await sNotes.nth(1).getAttribute('class').then((c) => c.includes('collapsed')), false);
// grey for a done/past step, purple for the upcoming next step (like the dates)
assert.equal(await sNotes.first().evaluate((e) => getComputedStyle(e).backgroundColor), await row.locator('.lnk').first().evaluate((e) => getComputedStyle(e).backgroundColor), 'done step: grey note');
// delete the second note from its editor
await sNotes.nth(1).locator('.snote-t').click();
await me.locator('.snote.editing').getByRole('button', { name: 'Delete' }).click();
await me.waitForFunction(() => !document.querySelector('.row .snote.editing') && document.querySelectorAll('.row .snote').length === 1);
// the next step works the same way (its date stays visible; the note shows on click)
await row.locator('.step.next .slabel').click();
await row.locator('li:has(.step.next) .addpost').click();
await me.keyboard.type('Bring the HPE quote'); await me.locator('.head h1').click();
await me.waitForFunction(() => !document.querySelector('.row .snote.editing') && document.querySelectorAll('.row .snote').length === 2);
assert.equal(await row.locator('li:has(.step.next) .snote').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(241, 237, 255)', 'upcoming step: purple note (the accent tint its upcoming date uses)');
assert.equal(await row.locator('li:has(.step.next) .snote .snote-ic').evaluate((e) => getComputedStyle(e).color), 'rgb(91, 55, 230)', 'purple post-it icon');
await row.locator('.step.next .slabel').click();
assert.equal(await row.locator('li:has(.step.next) .due').count(), 1, 'next step keeps its date visible');
await me.reload(); await me.waitForSelector('.row .step');
assert.equal(await row.locator('.snote').count(), 0, 'notes start hidden');
assert.equal(await row.locator('.snote-mk').count(), 2, 'marks show which steps have notes');
{ const d = await me.evaluate(() => Object.values(JSON.parse(localStorage.getItem('crm.localdb.v1')).deals)[0]);
  const sn = d.steps.find((st) => st.text === 'Sizer');
  assert.deepEqual(sn.notes.map((n) => n.text), ['Sizer run with 3:1 ratio for HPE and NX (confirmed)']); assert.equal(sn.note, undefined, 'stored as a list'); }
// clear the next step's note again so later checks start from a clean step
await row.locator('.step.next .slabel').click(); await row.locator('li:has(.step.next) .snote .snote-t').click();
await me.keyboard.press('ControlOrMeta+a'); await me.keyboard.press('Delete'); await me.locator('.head h1').click();
await me.waitForFunction(() => !document.querySelector('.row .snote.editing') && document.querySelectorAll('.row .snote').length === 0);
await row.locator('.step.next .slabel').click();
// deleting a deal is inline too (with a confirm)
await me.fill('#addIn', 'Temporary deal'); await me.press('#addIn', 'Enter');
await me.waitForSelector('.row .addstep-in'); await me.keyboard.press('Escape');
const tmp = me.locator('.row', { hasText: 'Temporary deal' });
await tmp.getByRole('button', { name: 'Delete deal: Temporary deal' }).click();
await tmp.getByRole('button', { name: 'Cancel' }).click();
await tmp.getByRole('button', { name: 'Delete deal: Temporary deal' }).click();
await tmp.locator('.delask').getByRole('button', { name: 'Delete' }).click();
await me.waitForFunction(() => ![...document.querySelectorAll('.row .title')].some((e) => e.textContent === 'Temporary deal'));

// Hovering a step shows a pencil on its right; clicking it renames the step in place
const fl = row.locator('.step', { hasText: 'Frontline' });
assert.equal(await fl.locator('.sedit').evaluate((e) => getComputedStyle(e).opacity), '0', 'pencil hidden until hover');
await fl.hover();
assert.equal(await fl.locator('.sedit').evaluate((e) => getComputedStyle(e).opacity), '1', 'pencil shows on hover');
await fl.locator('.sedit').click();
await me.waitForSelector('.stepedit-in');
await me.fill('.stepedit-in', 'Frontline review');
await me.press('.stepedit-in', 'Enter');
await me.waitForFunction(() => [...document.querySelectorAll('.row .stext')].some((e) => e.textContent === 'Frontline review'));
assert.equal(await row.locator('.step.done').count(), 2, 'renaming keeps the step ticked');
await row.locator('.step', { hasText: 'Frontline review' }).hover();
await row.locator('.step', { hasText: 'Frontline review' }).locator('.sedit').click();
await me.fill('.stepedit-in', 'zzz');
await me.press('.stepedit-in', 'Escape');
await me.waitForSelector('.stepedit-in', { state: 'detached' });
assert.ok((await row.locator('.step .stext').allTextContents()).includes('Frontline review'), 'Esc cancels');
assert.equal(await me.locator('.row.open').count(), 0, 'Esc does not touch the details panel');
await row.locator('.step', { hasText: 'Frontline review' }).hover();
await row.locator('.step', { hasText: 'Frontline review' }).locator('.sedit').click();
await me.fill('.stepedit-in', 'Frontline');
await me.locator('.head h1').click();   // clicking away saves
await me.waitForFunction(() => [...document.querySelectorAll('.row .stext')].some((e) => e.textContent === 'Frontline'));

// The + after the last step adds steps inline (Enter keeps the box open for the next one)
await row.locator('.addstep').click();
await me.fill('.addstep-in', 'Proposal');
await me.press('.addstep-in', 'Enter');
await me.waitForFunction(() => document.querySelectorAll('.row .step').length === 5);
assert.ok(await me.evaluate(() => document.activeElement && document.activeElement.classList.contains('addstep-in')), 'add box keeps focus');
await me.keyboard.type('PO received');
await me.keyboard.press('Enter');
await me.waitForFunction(() => document.querySelectorAll('.row .step').length === 6);
await me.keyboard.press('Escape');
await me.waitForSelector('.row .addstep');
const texts = async () => (await row.locator('.step .stext').allTextContents());
assert.deepEqual((await texts()).slice(-2), ['Proposal', 'PO received']);

// Drag a step chip on the list to reorder it
const dragTo = async (from, to, before = true) => {
  const a = await from.boundingBox(), b = await to.boundingBox();
  await me.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await me.mouse.down();
  await me.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 2, { steps: 3 });
  await me.mouse.move(before ? b.x + 4 : b.x + b.width - 4, before ? b.y + b.height / 2 : b.y + b.height * 0.8, { steps: 8 });
  await me.mouse.up();
};
// mid-drag: a lifted copy follows the pointer, the original stays as a placeholder, neighbours glide aside
{ const a = await row.locator('.step', { hasText: 'Frontline' }).boundingBox();
  await me.mouse.move(a.x + 40, a.y + a.height / 2); await me.mouse.down();
  await me.mouse.move(a.x + 46, a.y + a.height / 2 + 1, { steps: 2 });
  await me.waitForSelector('.drag-ghost');
  assert.equal(await me.locator('.track > li.dragging').count(), 1, 'placeholder shown');
  const g0 = await me.locator('.drag-ghost').boundingBox();
  await me.mouse.move(a.x + 120, a.y + a.height / 2 + 30, { steps: 6 }); await me.waitForTimeout(60);
  const g1 = await me.locator('.drag-ghost').boundingBox();
  assert.ok(g1.x - g0.x > 60 && g1.y - g0.y > 20, 'the copy follows the pointer');
  const sb = await row.locator('.step', { hasText: 'Sizer' }).boundingBox();
  await me.evaluate(() => { window.__glided = false; new MutationObserver((ms) => { if (ms.some((m) => /translate/.test(m.target.style.transform))) window.__glided = true; })
    .observe(document.querySelector('.row .track'), { subtree: true, attributes: true, attributeFilter: ['style'] }); });
  await me.mouse.move(sb.x + 6, sb.y + sb.height / 2, { steps: 10 }); await me.waitForTimeout(40);
  assert.ok(await me.evaluate(() => window.__glided), 'neighbours animate into place');
  await me.waitForTimeout(250);
  assert.equal(await me.evaluate(() => [...document.querySelectorAll('.row .track > li[data-sid]')].findIndex((li) => li.classList.contains('dragging'))), 0, 'placeholder moved to the front');
  // Esc cancels the drag and puts everything back
  await me.keyboard.press('Escape'); await me.mouse.up(); await me.waitForTimeout(300);
  assert.equal(await me.locator('.drag-ghost').count(), 0);
  assert.deepEqual(await texts(), ['Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden', 'Proposal', 'PO received'], 'Esc cancels');
  assert.equal(await row.locator('.step.done').count(), 2, 'cancelling a drag does not tick a step'); }
await dragTo(row.locator('.step', { hasText: 'PO received' }), row.locator('.step', { hasText: 'Sizer' }));
await me.waitForTimeout(400);
assert.equal(await me.locator('.drag-ghost').count(), 0, 'the copy settles and disappears');
assert.deepEqual(await texts(), ['PO received', 'Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden', 'Proposal'], 'drag reorders steps');
await me.reload(); await me.waitForSelector('.row .step');
assert.equal((await texts())[0], 'PO received', 'reorder is saved');
assert.equal(await row.locator('.step.done').count(), 2, 'dragging does not toggle steps');
// drag across to the end, and into the middle
await dragTo(row.locator('.step', { hasText: 'PO received' }), row.locator('.step', { hasText: 'Proposal' }), false);
await me.waitForTimeout(400);
assert.deepEqual(await texts(), ['Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden', 'Proposal', 'PO received'], 'drag to the end');
await dragTo(row.locator('.step', { hasText: 'PO received' }), row.locator('.step', { hasText: 'Frontline' }));
await me.waitForTimeout(400);
assert.deepEqual(await texts(), ['Sizer', 'PO received', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden', 'Proposal'], 'drag into the middle');
await dragTo(row.locator('.step', { hasText: 'PO received' }), row.locator('.step', { hasText: 'Sizer' }));
await me.waitForTimeout(400);
assert.equal((await texts())[0], 'PO received');

// Remove the two test steps from the step's rename box (× next to the name)
for (const name of ['PO received', 'Proposal']) {
  const pill = row.locator('.step', { hasText: name });
  await pill.hover(); await pill.locator('.sedit').click();
  await me.waitForSelector('.stepedit-in');
  await row.locator('.step.editing .sdel').click();
  await me.waitForFunction((n) => ![...document.querySelectorAll('.row .stext')].some((e) => e.textContent === n), name);
}
await me.reload(); await me.waitForSelector('.row .step');
assert.deepEqual(await texts(), ['Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden']);
await me.screenshot({ path: join(shots, 'deals-0-list.png'), fullPage: true });

// A task on the Tasks page
await me.click('#tab-tasks');
await me.fill('#addIn', 'Get in contact with Dell for Ogden');
await me.press('#addIn', 'Enter');
await me.waitForSelector('.row');
assert.equal(await me.textContent('#h1'), 'Tasks');
// Hovering anywhere on a task shows an Edit button on the right that opens the editor
const trow = me.locator('.row').first();
const op = (loc) => loc.evaluate((e) => getComputedStyle(e).opacity);
assert.equal(await op(trow.locator('.rowedit')), '0', 'Edit hidden until hover');
await trow.locator('.circle').hover();
assert.equal(await op(trow.locator('.rowedit')), '1', 'Edit shows when hovering anywhere on the task');
await trow.locator('.rowedit').click();
await me.waitForSelector('.row.open #ed-title');
await me.fill('#ed-title', 'Call Dell about Ogden');
await me.click('.ed .btn.primary');
await me.waitForFunction(() => document.querySelector('.row .title')?.textContent === 'Call Dell about Ogden');
await trow.hover(); await trow.locator('.rowedit').click();
await me.fill('#ed-title', 'Get in contact with Dell for Ogden');
await me.click('.ed .btn.primary');
await me.waitForFunction(() => document.querySelector('.row .title')?.textContent === 'Get in contact with Dell for Ogden');
await me.click('#tab-deals');

// Second person: first visit sees nothing highlighted
const josh = await open('josh');
await josh.waitForSelector('.row');
assert.equal(await josh.locator('.row.upd').count(), 0, 'first visit starts clean');
// Josh ticks a step and flips a checklist item
await josh.locator('.row .step', { hasText: 'Meeting with Wilden' }).locator('.bx').click();
await josh.locator('.row .chk', { hasText: 'Impl. plan' }).click();
await josh.locator('.row .dtype button.land').click();
await josh.locator('.row .prog [data-fk="st2"]').click();
await josh.waitForTimeout(150);

// Back to me: the change shows up live, highlighted, with who did it
await me.bringToFront();
await me.waitForSelector('.row.upd');
assert.match(await me.textContent('#banner'), /Josh made changes/);
assert.match(await me.textContent('.updchip'), /Josh changed (?=.*steps)(?=.*Impl\. plan)(?=.*Land & Expand \/ Renewal)/);
assert.equal(await me.locator('.dtype.hl').count(), 1, 'deal type change highlighted');
assert.equal(await me.locator('.prog.hl').count(), 1, 'sales stage change highlighted');
assert.match(await me.textContent('.updchip'), /sales stage/);
assert.equal(await me.locator('.step.hl').count(), 1, 'only the changed step is highlighted');
assert.match(await me.locator('.step.hl').textContent(), /Meeting with Wilden/);
assert.equal(await me.locator('.chk.hl').count(), 1);
await me.screenshot({ path: join(shots, 'deals-1-highlight.png'), fullPage: true });


// Mark seen clears it (and it stays cleared after reload)
await me.click('.updchip button');
assert.equal(await me.locator('.row.upd').count(), 0);
await me.reload(); await me.waitForSelector('.row');
await me.waitForTimeout(100);
assert.equal(await me.locator('.row.upd').count(), 0, 'seen state persists');

// Josh deletes the task -> I get a restore option
await josh.bringToFront();
await josh.click('#tab-tasks');
await josh.locator('.row .info').first().click();
await josh.click('.ed .btn.danger');
await josh.click('.ed .btn.danger.solid');
await me.bringToFront();
await me.waitForSelector('.banner .gone');
assert.match(await me.textContent('.banner .gone'), /Josh deleted “Get in contact with Dell for Ogden”/);
await me.click('.banner .gone button');
await me.click('#tab-tasks');
await me.waitForSelector('.row');

// Complete the deal: it moves to "Completed"
await me.click('#tab-deals');
await me.locator('.row .circle').first().click();
await me.waitForSelector('.empty:not([hidden])');
assert.match(await me.textContent('#doneGrp'), /1 Completed/);

// Full width: the list spans the window on a wide monitor
await me.setViewportSize({ width: 2400, height: 1000 });
const mainW = await me.evaluate(() => document.querySelector('main').getBoundingClientRect().width);
assert.ok(mainW > 2300, 'page stretches across a wide window (' + mainW + 'px)');

// Theme switch: Light forces a white background even when the system is dark
await me.emulateMedia({ colorScheme: 'dark' });
assert.equal(await me.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(19, 19, 19)', 'auto follows dark system');
await me.click('.theme button[data-t="light"]');
assert.equal(await me.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', 'light = white');
await me.reload(); await me.waitForSelector('.theme');
assert.equal(await me.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', 'choice remembered');
await me.click('.theme button[data-t="dark"]');
await me.emulateMedia({ colorScheme: 'light' });
assert.equal(await me.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(19, 19, 19)', 'dark forced');
await me.click('.theme button[data-t="auto"]');
assert.equal(await me.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', 'auto back to system');

// Phone width: no horizontal scroll
await me.click('#doneGrp >> text=Show');
await me.setViewportSize({ width: 390, height: 844 });
await me.waitForTimeout(100);
const overflow = await me.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(overflow <= 0, 'no horizontal scroll at phone width (' + overflow + 'px)');
{ const p = await me.locator('.row .prog').first().boundingBox(); assert.ok(p.x >= 0 && p.x + p.width <= 390, 'tracker fits at phone width'); }
// Phone width with a Stage 9 outcome: the red badge is fully visible and nothing overflows
await me.locator('.row .prog [data-fk="st9"]').first().click(); await me.locator('.pop .mi', { hasText: 'Disqualified' }).click();
await me.waitForFunction(() => document.querySelector('.row .prog.is-out'));
{ const n = me.locator('.row .prog [data-fk="st9"]').first(), nb = await n.boundingBox();
  assert.equal(await n.evaluate((e) => e.scrollWidth <= e.clientWidth), true, 'outcome badge text not clipped');
  assert.equal(await n.locator('.short').textContent(), 'DQ');
  assert.ok(nb.x + nb.width <= 390 - 16 + 1, 'badge fits inside the gutter');
  assert.ok(await me.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'still no horizontal scroll'); }
await me.screenshot({ path: join(shots, 'deals-3-phone.png'), fullPage: true });

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('deals e2e: all checks passed');
