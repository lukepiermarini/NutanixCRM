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
await me.waitForSelector('#ed-newstep');
for (const s of ['Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden']) { await me.fill('#ed-newstep', s); await me.press('#ed-newstep', 'Enter'); }
assert.equal(await me.locator('.ed .srow').count(), 4);
await me.locator('.ed .srow input[type=checkbox]').nth(0).check();
await me.locator('.ed .srow input[type=checkbox]').nth(1).check();
await me.locator('.ed .srow').nth(2).locator('.sdate').fill('2030-03-05');
await me.locator('.ed .srow').nth(2).locator('.stime').fill('11:30');
await me.click('text=Add link');
await me.locator('.ed .lrow input').nth(0).fill('Hybrid');
await me.locator('.ed .lrow input').nth(1).fill('https://sizer.nutanix.com/#/scenario/S-1753764');
await me.click('text=Add link');
await me.locator('.ed .lrow input').nth(2).fill('All flash');
await me.locator('.ed .lrow input').nth(3).fill('sizer.nutanix.com/#/scenario/S-1753621');
await me.locator('.crow', { hasText: 'Implementation Strategy' }).locator('button.yes').click();
await me.click('.ed .btn.primary'); // Done
await me.waitForSelector('.row:not(.open)');

const row = me.locator('.row').first();
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
assert.notEqual(await st(3).evaluate((e) => getComputedStyle(e).boxShadow), 'none', 'current stage has a ring as well as the fill');
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
// Remove the extra link again so later checks see two
await row.locator('.info').click();
await me.locator('.ed .lrow').nth(2).locator('.ibtn').click();
await me.click('.ed .btn.primary');
await me.waitForFunction(() => document.querySelectorAll('.row .lnk').length === 2);

// Hovering a deal's name line shows an Edit button that opens the editor (not when hovering its steps)
const op2 = (loc) => loc.evaluate((e) => getComputedStyle(e).opacity);
await row.locator('.step').first().hover();
assert.equal(await op2(row.locator('.rowedit')), '0', 'no deal Edit button while hovering a step');
await row.locator('.title').hover();
assert.equal(await op2(row.locator('.rowedit')), '1', 'deal Edit button shows on hovering the name');
const tb = await row.locator('.prog').boundingBox(), eb = await row.locator('.rowedit').boundingBox();
assert.ok(eb.x - (tb.x + tb.width) < 20, 'Edit follows the name, deal-type toggle and progress tracker (gap ' + Math.round(eb.x - (tb.x + tb.width)) + 'px)');
await row.locator('.rowedit').click();
await me.waitForSelector('.row.open .ed');
assert.equal(await row.locator('.rowedit').count(), 0, 'Edit button hides while the editor is open');
await me.click('.ed .btn.primary');
await me.waitForSelector('.row.open', { state: 'detached' });

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

// Drag in the details panel using the grip handle, then remove the two test steps
await row.locator('.info').click();
await me.waitForSelector('.ed .grip');
await me.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await me.waitForTimeout(400);
const grips = me.locator('.ed .srow .grip');
await dragTo(grips.nth(0), me.locator('.ed .srow').nth(5), false);
await me.waitForTimeout(150);
const edOrder = await me.locator('.ed .srow input.fld:not(.sdate):not(.stime)').evaluateAll((els) => els.map((e) => e.value));
assert.deepEqual(edOrder, ['Sizer', 'Frontline', 'Meeting with Wilden', 'Discuss with Ogden', 'Proposal', 'PO received'], 'editor drag reorders');
await me.locator('.ed .srow').nth(5).locator('.ibtn').click();
await me.locator('.ed .srow').nth(4).locator('.ibtn').click();
await me.click('.ed .btn.primary');
await me.waitForTimeout(100);
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

// Open details: the editor also highlights
await me.locator('.row .info').first().click();
await me.waitForSelector('.ed .crow.hl');
await me.screenshot({ path: join(shots, 'deals-2-editor.png'), fullPage: true });
await me.click('.ed .btn.primary');

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
