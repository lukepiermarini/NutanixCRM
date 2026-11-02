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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
await me.fill('#ed-date', '2030-03-05'); await me.fill('#ed-time', '11:30');
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
assert.match(await row.locator('.due').textContent(), /11:30/);
assert.equal(await me.locator('.row.upd').count(), 0, 'own edits are not highlighted');

// A task on the Tasks page
await me.click('#tab-tasks');
await me.fill('#addIn', 'Get in contact with Dell for Ogden');
await me.press('#addIn', 'Enter');
await me.waitForSelector('.row');
assert.equal(await me.textContent('#h1'), 'Tasks');
await me.click('#tab-deals');

// Second person: first visit sees nothing highlighted
const josh = await open('josh');
await josh.waitForSelector('.row');
assert.equal(await josh.locator('.row.upd').count(), 0, 'first visit starts clean');
// Josh ticks a step and flips a checklist item
await josh.locator('.row .step', { hasText: 'Meeting with Wilden' }).click();
await josh.locator('.row .chk', { hasText: 'Impl. plan' }).click();
await josh.waitForTimeout(150);

// Back to me: the change shows up live, highlighted, with who did it
await me.bringToFront();
await me.waitForSelector('.row.upd');
assert.match(await me.textContent('#banner'), /Josh made changes/);
assert.match(await me.textContent('.updchip'), /Josh changed steps, Impl\. plan/);
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

// Phone width: no horizontal scroll
await me.click('#doneGrp >> text=Show');
await me.setViewportSize({ width: 390, height: 844 });
await me.waitForTimeout(100);
const overflow = await me.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
assert.ok(overflow <= 0, 'no horizontal scroll at phone width (' + overflow + 'px)');
await me.screenshot({ path: join(shots, 'deals-3-phone.png'), fullPage: true });

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('deals e2e: all checks passed');
