// End-to-end test of deals/deal-tracker.html in Chromium, in its local (single-browser) mode.
// Two tabs act as two people ("you" and "josh") sharing one localStorage database,
// so we can check that one person's edits are highlighted for the other.
// Run: node tests/deals-e2e.mjs   (needs the `playwright` package)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
copyFileSync(join(root, 'deals', 'meddpicc.js'), join(dir, 'meddpicc.js'));   // the page loads the MEDDPICC rubric/scoring module next to it
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
await row.locator('.step').nth(0).locator('.bx').click();
await me.waitForFunction(() => document.querySelectorAll('.row .step.done').length === 1);
await row.locator('.step').nth(1).locator('.bx').click();
await me.waitForFunction(() => document.querySelectorAll('.row .step.done').length === 2);
await row.locator('.step.next .slabel').click();
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
// notes in place: "Add a note" on hover, click the note to edit it
await row.locator('.addnote').click();
await me.waitForSelector('.noteedit textarea');
await me.keyboard.type('Ogden wants HPE and Nutanix side by side');
await me.locator('.head h1').click();
await me.waitForFunction(() => document.querySelector('.row .note')?.textContent === 'Ogden wants HPE and Nutanix side by side');
await row.locator('.note').click(); await me.keyboard.type(' (3:1)'); await me.keyboard.press('Escape');
await me.waitForFunction(() => document.querySelector('.row .note')?.textContent === 'Ogden wants HPE and Nutanix side by side');
await me.reload(); await me.waitForSelector('.row .note');
assert.equal(await row.locator('.note').textContent(), 'Ogden wants HPE and Nutanix side by side', 'notes saved');
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
await dragTo(row.locator('.step', { hasText: 'PO received' }), row.locator('.step', { hasText: 'Sizer' }));
await me.waitForTimeout(150);
assert.deepEqual(await texts(), ['PO received', 'Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden', 'Proposal'], 'drag reorders steps');
await me.reload(); await me.waitForSelector('.row .step');
assert.equal((await texts())[0], 'PO received', 'reorder is saved');
assert.equal(await row.locator('.step.done').count(), 2, 'dragging does not toggle steps');

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

// ---------- MEDDPICC ----------
{
const strip = row.locator('.mstrip'), tiles = strip.locator('.mtile');
const tile = (i) => tiles.nth(i);
const dotsOn = (i) => tile(i).locator('.mdots i.on').count();
const doc = () => me.evaluate(() => Object.values(JSON.parse(localStorage.getItem('crm.localdb.v1')).deals)[0]);
assert.equal(await tiles.count(), 8);
assert.deepEqual(await tiles.locator('.mletter').allTextContents(), ['M', 'E', 'D', 'D', 'P', 'I', 'C', 'C']);
assert.deepEqual(await tiles.locator('.mname').allTextContents(), ['Metrics', 'Economic Buyer', 'Decision Criteria', 'Decision Process', 'Paper Process', 'Identified Pain', 'Champion', 'Competition']);
assert.equal(await row.locator('.msum').textContent(), '0 of 8 strong');
// at the bottom of the deal, across its full width, eight even tiles
{ const sb = await strip.boundingBox(), body = await row.locator('.body').boundingBox(), ck = await row.locator('.checks').boundingBox();
  const ws = await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  assert.ok(Math.max(...ws) - Math.min(...ws) < 1, 'tiles are evenly sized');
  assert.ok(Math.abs(sb.width - body.width) < 2, 'strip spans the deal');
  assert.ok(sb.y > ck.y + ck.height, 'strip sits below the rest of the deal'); }
assert.equal(await dotsOn(0), 0);
assert.equal(await tile(0).getAttribute('aria-label'), 'Metrics: Not started. Next step: Get a number the customer owns');
assert.equal(await tile(0).locator('.mnext').textContent(), 'Get a number the customer owns');
assert.ok(await tile(0).locator('.mnext').isVisible(), 'next step shown on a wide screen');
// hover: what "Strong" needs
let mtip = await tipFor(tile(1));
assert.ok(mtip.startsWith('Economic Buyer · Not started'), mtip);
assert.ok(mtip.includes('The person with the authority and discretionary budget to say the final yes, or no.'));
assert.ok(mtip.includes('To be strong:'));
assert.ok(mtip.includes('○Named · required (not met)') && mtip.includes('○Funding confirmed (not met)'), mtip);
await me.locator('.head h1').hover(); await me.waitForSelector('.ptip', { state: 'detached' });

// click: the detail panel with all eight letters, focused on the one clicked
// a small down arrow appears on hover, hidden otherwise
await me.waitForTimeout(250);   // let any earlier hover fade out
assert.equal(await tile(1).locator('.mchev').evaluate((e) => getComputedStyle(e).opacity), '0', 'arrow hidden until hover');
await tile(1).hover(); await me.waitForTimeout(200);
assert.equal(await tile(1).locator('.mchev').evaluate((e) => getComputedStyle(e).opacity), '1', 'arrow shows on hover');
await tile(1).locator('.mchev').click();   // clicking the arrow opens the evidence
await me.waitForSelector('.row .mpanel');
assert.equal(await me.locator('.mpanel .mgroup').count(), 8);
// each letter's box sits directly below its tile, same column width
{ const tb = await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.width, r.bottom]));
  const gb = await me.locator('.mpanel .mgroup').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.width, r.top]));
  gb.forEach(([l, w, top], i) => {
    assert.ok(Math.abs(l - tb[i][0]) < 1.5 && Math.abs(w - tb[i][1]) < 1.5, `box ${i} is under tile ${i} (${l.toFixed(1)}/${w.toFixed(1)} vs ${tb[i][0].toFixed(1)}/${tb[i][1].toFixed(1)})`);
    assert.ok(top > tb[i][2], `box ${i} is below its tile`);
  });
  assert.equal(new Set(gb.map((g) => Math.round(g[2]))).size, 1, 'all eight boxes in one row');
  assert.equal(await me.locator('.mpanel .mgroup').first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius), await tile(0).evaluate((e) => getComputedStyle(e).borderTopLeftRadius), 'boxes styled like the tiles'); }
assert.equal(await tile(1).getAttribute('aria-expanded'), 'true');
assert.equal(await tile(1).locator('.mchev').evaluate((e) => getComputedStyle(e).opacity), '1', 'arrow stays visible while open');
assert.equal(await me.locator('.mpanel .mgroup.mcur h4').textContent(), 'E Economic Buyer');
assert.equal(await tile(1).getAttribute('aria-expanded'), 'true');
const group = (name) => me.locator('.mpanel .mgroup', { has: me.locator('h4', { hasText: name }) });
const addEv = async (name, text, { criterion, source, who, risk } = {}) => {
  const g = group(name), n = await g.locator('.mbul').count();
  await g.getByRole('button', { name: `Add ${name} evidence` }).click();
  await me.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n + 1, [`#${await g.getAttribute('id')} .mbul`, n]);
  const r = g.locator('.mbul').last();
  assert.equal(await me.evaluate(() => document.activeElement.classList.contains('mtext')), true, 'new bullet is focused');
  await me.keyboard.type(text);
  if (criterion) await r.locator('select').first().selectOption(criterion);
  if (source) await r.locator('select').nth(1).selectOption(source);
  if (who) await r.locator('.mwho').fill(who);
  if (risk) await r.locator('.mriskbtn').click();
  await me.locator('.mp-head strong').click();   // focus leaves the panel: saves
  await me.waitForTimeout(80);
};
await addEv('Economic Buyer', 'Dana Whitfield, the CFO, signs the PO', { who: 'Dana Whitfield' });
assert.equal((await doc()).meddpicc.economicBuyer[0].criterion, 'named', 'new bullets default to the first unmet required criterion');
assert.equal(await dotsOn(1), 1, 'one of six met: Gap');
assert.equal(await tile(1).getAttribute('aria-label'), 'Economic Buyer: Gap. Next step: Confirm the EB with a second person');
await addEv('Economic Buyer', 'Mark confirmed Dana has the final say', { criterion: 'named', who: 'Mark Lee' });   // two people: confirmed
await addEv('Economic Buyer', 'Cutting VMware licensing is a top priority for her this year', { criterion: 'priorities', who: 'Mark Lee' });
assert.equal(await dotsOn(1), 2, '3 of 6 (half) is Partial');
assert.equal(await me.locator('.mpanel [data-meter="economicBuyer"] .mlvl').textContent(), 'Partial', 'meter label in the panel');
await addEv('Economic Buyer', 'Budget is approved for this fiscal year', { criterion: 'funding' });
assert.equal(await dotsOn(1), 2, '4 of 6: Partial (needs 75%)');
await addEv('Economic Buyer', 'About $400k, decision by March', { criterion: 'howMuch' });
assert.equal(await dotsOn(1), 3, '5 of 6 with both required: Strong');
assert.equal(await row.locator('.msum').textContent(), '1 of 8 strong');
assert.equal(await tile(1).locator('.mnext').textContent(), 'Get a meeting or an access plan');
// assumptions are reminders, not evidence
await addEv('Champion', 'Mark probably wants us to win', { criterion: 'identified', source: 'assumption' });
assert.equal(await dotsOn(6), 0, 'an assumption does not count');
// a risk caps at Partial and shows "!"
await addEv('Economic Buyer', 'CFO pushed back on the price', { criterion: 'funding', risk: true });
assert.equal(await dotsOn(1), 2, 'risk caps at Partial');
assert.equal(await tile(1).locator('.mrisk').textContent(), '!');
assert.match(await tile(1).getAttribute('aria-label'), /Economic Buyer: Partial, risk flagged\./);
assert.equal(await row.locator('.msum').textContent(), '0 of 8 strong · 1 with a risk');
mtip = await tipFor(tile(1));
assert.ok(mtip.includes('✓Named · required (met)') && mtip.includes('✓Confirmed by two or more people · required (met)') && mtip.includes('○Met, or an access plan agreed (not met)'), mtip);
assert.ok(mtip.includes('capped at Partial'));
await me.locator('.head h1').hover();
// survives a reload, with the data shape the spec asks for
await me.reload(); await me.waitForSelector('.row .mstrip');
assert.equal(await dotsOn(1), 2); assert.equal(await tile(1).locator('.mrisk').count(), 1);
{ const d = await doc(), eb = d.meddpicc.economicBuyer;
  assert.equal(eb.length, 6);
  for (const k of ['id', 'text', 'criterion', 'source', 'who', 'risk', 'createdAt', 'updatedAt']) assert.ok(k in eb[0], 'bullet has ' + k);
  assert.equal(eb[5].risk, true); assert.equal(d.meddpicc.champion[0].source, 'assumption');
  assert.ok(!('strength' in d.meddpicc) && !JSON.stringify(d).includes('"level"'), 'strength is calculated, never stored'); }
// the panel was closed by the reload; open it again with the keyboard
await tile(0).focus(); await me.keyboard.press('Shift+Tab'); await me.keyboard.press('Tab');
await me.waitForSelector('.ptip'); assert.ok((await me.locator('.ptip').textContent()).startsWith('Metrics · Not started'), 'tooltip on keyboard focus');
await me.keyboard.press('Escape'); await me.waitForSelector('.ptip', { state: 'detached' });
await me.keyboard.press('Tab'); await me.keyboard.press('Enter');   // Economic Buyer
await me.waitForSelector('.mpanel .mgroup.mcur');
assert.equal(await me.locator('.mpanel .mgroup.mcur h4').textContent(), 'E Economic Buyer');
// delete the risk -> Strong again; inline edit of text persists
await group('Economic Buyer').locator('.mbul').last().getByRole('button', { name: /Delete evidence/ }).click();
await me.waitForFunction(() => document.querySelectorAll('.row .mtile')[1].querySelectorAll('.mdots i.on').length === 3);
assert.equal(await tile(1).locator('.mrisk').count(), 0);
await group('Economic Buyer').locator('.mbul').first().locator('.mtext').fill('Dana Whitfield (CFO) signs every PO over $100k');
await me.locator('.mp-head strong').click(); await me.waitForTimeout(80);
await me.reload(); await me.waitForSelector('.row .mstrip');
assert.equal((await doc()).meddpicc.economicBuyer[0].text, 'Dana Whitfield (CFO) signs every PO over $100k');
// clicking the same letter again collapses; so does the close button
await tile(3).click(); await me.waitForSelector('.mpanel');
await tile(3).click(); await me.waitForSelector('.mpanel', { state: 'detached' });
await tile(3).click(); await me.waitForSelector('.mpanel');
await me.getByRole('button', { name: 'Close MEDDPICC details' }).click(); await me.waitForSelector('.mpanel', { state: 'detached' });

// meeting notes -> proposals -> review -> apply
const NOTES = `Maria Gomez: We're paying way too much for VMware since the Broadcom renewal, it went up 300% to about $400k a year.
Lee Park: Procurement and legal will need to review the MSA, that usually takes about six weeks.
Maria Gomez: Our CIO has the final say on the budget.
Lee Park: Honestly the RFP criteria were written around VxRail.`;
await row.locator('.mhead').getByRole('button', { name: 'Add meeting notes' }).click();
await me.waitForSelector('dialog.mdlg[open]');
assert.equal(await me.evaluate(() => document.activeElement.tagName), 'TEXTAREA', 'focus starts in the notes box');
await me.fill('dialog.mdlg input[type=date]', '2026-10-30');
await me.fill('dialog.mdlg input[data-dk="att"]', 'Maria Gomez, Lee Park');
await me.fill('dialog.mdlg textarea', NOTES);
await me.click('dialog.mdlg [data-dk="go"]');
await me.waitForSelector('dialog.mdlg .prop');
const props = me.locator('dialog.mdlg .prop');
const nProps = await props.count();
assert.ok(nProps >= 5, 'several proposals (' + nProps + ')');
assert.deepEqual(await me.locator('dialog.mdlg .pgroup h3').allTextContents(),
  ['E Economic Buyer', 'D Decision Criteria', 'P Paper Process', 'I Identified Pain', 'C Competition'], 'grouped by letter in MEDDPICC order');
{ const pp = me.locator('dialog.mdlg .prop', { hasText: 'Procurement' }).first();
  assert.match(await pp.locator('.pquote').textContent(), /“Procurement and legal will need to review the MSA, that usually takes about six weeks\.” — Lee Park/); }
assert.equal(await me.locator('dialog.mdlg .prop', { hasText: 'VxRail' }).first().locator('.pbadge').textContent(), '! Risk', 'risk suggested');
assert.equal((await doc()).meetingNotes, undefined, 'nothing saved before applying');
await me.click('dialog.mdlg [data-dk="accall"]');
assert.equal(await me.locator('dialog.mdlg .prop.accepted').count(), nProps);
await me.locator('dialog.mdlg .prop', { hasText: 'VxRail' }).first().getByRole('button', { name: 'Reject' }).click();
const ebProp = me.locator('dialog.mdlg .pgroup', { hasText: 'Economic Buyer' }).locator('.prop').first();
await ebProp.getByRole('button', { name: 'Edit' }).click();
await ebProp.locator('.ptxt').fill('Maria: the CIO has the final say on the budget');
await ebProp.getByRole('button', { name: 'Done' }).click();
assert.equal(await me.locator('dialog.mdlg .prop.accepted').count(), nProps - 1);
await me.click('dialog.mdlg [data-dk="apply"]');
await me.waitForSelector('dialog.mdlg', { state: 'detached' });
await me.waitForSelector('.row .mpanel');   // opens on the first letter that got evidence
assert.ok(await dotsOn(5) >= 1, 'Identified Pain meter moved');
assert.ok(await dotsOn(4) >= 1, 'Paper Process meter moved');
{ const d = await doc();
  assert.equal(d.meetingNotes.length, 1);
  assert.deepEqual([d.meetingNotes[0].date, d.meetingNotes[0].attendees, d.meetingNotes[0].text], ['2026-10-30', 'Maria Gomez, Lee Park', NOTES]);
  assert.ok(d.meddpicc.economicBuyer.some((b) => b.text === 'Maria: the CIO has the final say on the budget' && b.source === 'notes' && b.noteDate === '2026-10-30'), 'edited proposal applied');
  assert.ok(!(d.meddpicc.decisionCriteria || []).some((b) => /VxRail/.test(b.text)), 'rejected proposal not applied');
  assert.ok(d.meddpicc.paperProcess.some((b) => b.who === 'Lee Park')); }
assert.ok((await me.locator('.mpanel .mgroup', { hasText: 'Paper Process' }).locator('select').nth(1).locator('option:checked').textContent()).startsWith('From notes (Oct 30'), 'source shows the notes date');
assert.match(await me.locator('.mpanel .mnotes').textContent(), /Oct 30.*Maria Gomez, Lee Park/);
await me.reload(); await me.waitForSelector('.row .mstrip');
assert.ok(await dotsOn(5) >= 1, 'applied bullets survive a reload');
// re-process: only the rejected proposal comes back (duplicates are skipped); Esc closes without saving
await tile(0).click(); await me.waitForSelector('.mpanel .mnotes');
await me.locator('.mpanel .mnotes').getByRole('button', { name: 'Re-process' }).click();
await me.waitForSelector('dialog.mdlg[open]');
{ const groups = await me.locator('dialog.mdlg .pgroup h3').allTextContents(), texts = await me.locator('dialog.mdlg .prop .ptext').allTextContents();
  assert.ok(!groups.includes('P Paper Process') && !groups.includes('I Identified Pain'), 'already-applied evidence is not proposed again: ' + groups);
  assert.ok(!texts.some((t) => /final say/.test(t)), 'the edited-and-applied EB bullet is not proposed again');
  assert.ok(texts.some((t) => /VxRail/.test(t)), 'the rejected proposal comes back'); }
await me.keyboard.press('Escape');
await me.waitForSelector('dialog.mdlg', { state: 'detached' });
assert.equal(await me.locator('.row .mpanel').count(), 1, 'Esc closed only the dialog');
assert.equal((await doc()).meetingNotes.length, 1, 'cancel saved nothing');
// read, then delete the notes (bullets stay)
await me.locator('.mpanel .mnotes').getByRole('button', { name: 'Read' }).click();
assert.equal(await me.locator('.mpanel .mn-text').textContent(), NOTES);
const before = JSON.stringify((await doc()).meddpicc);
await me.locator('.mpanel .mnotes').getByRole('button', { name: 'Delete' }).click();
await me.locator('.mpanel .mnotes .confirm').getByRole('button', { name: 'Delete' }).click();
await me.waitForSelector('.mpanel .mnotes', { state: 'detached' });
assert.equal((await doc()).meetingNotes.length, 0);
assert.equal(JSON.stringify((await doc()).meddpicc), before, 'deleting notes keeps the bullets');
await me.getByRole('button', { name: 'Close MEDDPICC details' }).click();
}

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
await josh.locator('.row .mtile').nth(6).click(); await josh.waitForSelector('.row .mpanel');
await josh.getByRole('button', { name: 'Add Champion evidence' }).click();
await josh.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('mtext'));
await josh.keyboard.type('Mark walked us through the business case he is taking to the board');
await josh.locator('.mp-head strong').click(); await josh.waitForTimeout(100);
await josh.waitForTimeout(150);

// Back to me: the change shows up live, highlighted, with who did it
await me.bringToFront();
await me.waitForSelector('.row.upd');
assert.match(await me.textContent('#banner'), /Josh made changes/);
assert.match(await me.textContent('.updchip'), /Josh changed (?=.*steps)(?=.*Impl\. plan)(?=.*Land & Expand \/ Renewal)/);
assert.equal(await me.locator('.dtype.hl').count(), 1, 'deal type change highlighted');
assert.equal(await me.locator('.prog.hl').count(), 1, 'sales stage change highlighted');
assert.match(await me.textContent('.updchip'), /sales stage/);
assert.equal(await me.locator('.row .mtile.hl').count(), 1, 'the MEDDPICC letter Josh changed is highlighted');
assert.equal(await me.locator('.row .mtile.hl .mletter').textContent(), 'C');
assert.match(await me.textContent('.updchip'), /MEDDPICC Champion/);
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
// Phone width: the MEDDPICC strip wraps to two rows of four; letters and dots stay, the next step goes first
{ const t = me.locator('.row .mstrip').first().locator('.mtile');
  const ys = await t.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.deepEqual([...new Set(ys)].length, 2, 'two rows'); assert.equal(ys.filter((y) => y === ys[0]).length, 4, 'four per row');
  assert.ok(await t.first().locator('.mletter').isVisible() && await t.first().locator('.mdots').isVisible());
  assert.equal(await t.first().locator('.mnext').isVisible(), false, 'next step dropped first'); }
await me.screenshot({ path: join(shots, 'deals-3-phone.png'), fullPage: true });

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('deals e2e: all checks passed');
