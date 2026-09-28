// End-to-end smoke test of the built single-file app in Chromium.
// Run: node build.mjs && node tests/e2e.mjs   (needs the `playwright` package)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(join(root, 'dist', 'se-pipeline.html')).href;
const shots = process.env.SHOTS_DIR || join(root, 'tests', 'screenshots');
mkdirSync(shots, { recursive: true });

const NOTES = `Quick recap
Contoso Health confirmed the AHV migration POC for the VMware exit succeeded and met all the success criteria. Dana approved the design.

Next steps
- I'll send the final BOM to Dana by Friday
- Dana Whitfield will get CFO budget sign-off next week`;

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
await page.waitForSelector('.empty');
await page.screenshot({ path: join(shots, '0-empty.png') });

// Sample data
await page.click('text=Load sample data');
await page.waitForSelector('.deal-card');
assert.equal(await page.locator('.column').count(), 7, 'seven stage columns');
await page.screenshot({ path: join(shots, '1-pipeline.png') });

// Drag "NC2 on AWS DR" from Identified to Discovery
const card = page.locator('.deal-card', { hasText: 'NC2 on AWS DR' });
await card.dragTo(page.locator('.column[data-stage="discovery"] .column-list'));
await page.waitForSelector('.column[data-stage="discovery"] .deal-card:has-text("NC2 on AWS DR")');
console.log('✓ drag and drop between columns');

// Drop into Closed Lost prompts for a reason
await page.locator('.deal-card', { hasText: 'Plant floor edge refresh' }).dragTo(page.locator('.column[data-stage="closed_lost"] .column-list'));
await page.fill('.modal input.input', 'Chose Dell VxRail');
await page.click('.modal >> text=Move to Closed Lost');
await page.waitForSelector('.column[data-stage="closed_lost"] .deal-card:has-text("Plant floor edge refresh")');
console.log('✓ closed lost with reason');

// New meeting — offline parser path
await page.click('.header-actions >> text=New meeting');
await page.fill('.notes-input', NOTES);
await page.click('text=Process notes');
await page.waitForSelector('text=Review meeting');
const acctVal = await page.locator('.modal select.input').first().inputValue();
assert.equal(acctVal, 'acc_demo_1', 'auto-detected Contoso Health');
assert.ok(await page.locator('.action-item').count() >= 3, 'action items extracted');
assert.ok(await page.locator('.stage-reco.is-suggested').count() === 1, 'stage move suggested');
await page.screenshot({ path: join(shots, '2-review.png'), fullPage: false });
await page.click('text=Save meeting & tasks');
await page.waitForSelector('.toast-success:has-text("Meeting saved")');
console.log('✓ offline meeting processing + save');

// Tasks page
await page.click('.nav >> text=Tasks');
await page.waitForSelector('.task-row:has-text("final BOM")');
await page.screenshot({ path: join(shots, '3-tasks.png') });
// Quick add
await page.fill('.quick-add', 'Send sizing to Tailspin Logistics by Friday !');
await page.press('.quick-add', 'Enter');
await page.waitForSelector('.task-row:has-text("Send sizing to Tailspin Logistics")');
console.log('✓ tasks page + quick add');

// Persistence across reload
await page.reload();
await page.waitForSelector('.task-row:has-text("Send sizing to Tailspin Logistics")');
await page.click('.nav >> text=Pipeline');
await page.waitForSelector('.column[data-stage="discovery"] .deal-card:has-text("NC2 on AWS DR")');
console.log('✓ data persisted after reload');

// Zoom transcript through the UI (no API key anywhere)
await page.click('.nav >> text=Settings');
await page.fill('input[placeholder="e.g. Jordan Lee"]', 'Jordan Lee');
await page.click('text=Save profile');
await page.keyboard.press('n');
await page.selectOption('.modal select.input >> nth=0', 'acc_demo_4');
await page.fill('.notes-input', readFileSync(join(root, 'tests', 'fixtures', 'zoom-transcript.vtt'), 'utf8'));
await page.click('text=Process notes');
await page.waitForSelector('text=Analyzed transcript');
const titles = await page.$$eval('.action-item .ai-title', (els) => els.map((e) => e.value));
assert.ok(titles.some((t) => /sizing for NC2 DR/.test(t)), 'SE commitment extracted');
assert.ok(titles.some((t) => /RVTools export/.test(t)), 'customer request extracted');
await page.screenshot({ path: join(shots, '2b-transcript-review.png') });
await page.click('text=Save meeting & tasks');
await page.waitForSelector('.toast-success:has-text("Meeting saved")');
const noKey = await page.evaluate(() => !('apiKey' in NX.app.store.settings.get()) && !document.body.innerText.includes('API key'));
assert.ok(noKey, 'no API key setting anywhere');
console.log('✓ transcript analyzed locally + saved');

// Deal drawer
await page.click('.nav >> text=Pipeline');
await page.click('.deal-card:has-text("NC2 on AWS DR")');
await page.waitForSelector('.drawer >> text=Put together a sizing for NC2 DR');
await page.screenshot({ path: join(shots, '4-deal-drawer.png') });
console.log('✓ deal drawer shows meeting tasks');

// File auto-save (File System Access API stubbed — native pickers can't be automated)
const written = await page.evaluate(async () => {
  const writes = [];
  const handle = {
    name: 'my-workspace.json',
    async createWritable() { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { writes.push(buf); } }; },
    async getFile() { return { text: async () => writes[writes.length - 1] || '' }; },
    async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
  };
  window.showSaveFilePicker = async () => handle;
  await NX.app.fileSync.createFile();
  const before = writes.length;
  await NX.app.store.tasks.create({ title: 'Autosave probe task' });
  await new Promise((r) => setTimeout(r, 1200));
  return { before, after: writes.length, last: writes[writes.length - 1], status: NX.app.fileSync.getState().status };
});
assert.ok(written.after > written.before, 'change triggered a file write');
assert.ok(written.last.includes('Autosave probe task'), 'file contains latest data');
assert.equal(written.status, 'saved');
await page.waitForSelector('.save-ind:has-text("my-workspace.json")');
console.log('✓ auto-save to linked file');

// Mobile layout
await page.setViewportSize({ width: 390, height: 844 });
await page.keyboard.press('Escape');
await page.screenshot({ path: join(shots, '5-mobile.png') });

assert.deepEqual(errors, [], 'no console errors');
console.log('\nAll e2e checks passed');
await browser.close();
