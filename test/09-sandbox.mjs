/* Simulates the sandboxed preview iframe: IndexedDB + localStorage blocked.
   The app must still boot, render, and play the sample. */
/* 09-sandbox: the embedded-preview worst case — IndexedDB + localStorage
   blocked. The app must still boot, load the sample, and play, with zero
   console errors (in-memory storage fallback). */
import { chromium } from 'playwright-core';
import { check } from './harness.mjs';

export async function run() {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--mute-audio'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.AC && AC.state && AC.state.current(), null, { timeout: 15000 });
await page.evaluate(() => {
  document.getElementById('welcomeModal').classList.add('hidden');
  document.querySelector('#welcomeTmplGrid .tmpl-big').click();
});
await page.waitForFunction(() => AC.state.current().audio && AC.state.current().audio.assetId, null, { timeout: 30000 });
await page.evaluate(async () => {
  AC._debug.seek(0.5);
  AC._debug.play();
  await new Promise((r) => setTimeout(r, 700));
});
const state = await page.evaluate(() => ({
  playing: AC.stage.playing,
  t: AC.stage.getTime(),
  sampleLoaded: !!AC.state.current().audio.assetId,
}));
check('sandboxed (no storage): sample loads + plays', state.playing && state.t > 0.4 && state.sampleLoaded, JSON.stringify(state));
check('sandboxed (no storage): zero console errors', errors.length === 0, errors.join(' | ').slice(0, 400));
await browser.close();
}
