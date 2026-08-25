/* ClipCast acceptance suite — shared helpers + smoke test.
   Run: node test/run.mjs [filter]
   Uses playwright-core with the downloaded headless chromium. */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BASE = 'http://127.0.0.1:8123/index.html';
const OUT = new URL('.', import.meta.url).pathname.replace(/\/$/, '') + '/out';
fs.mkdirSync(OUT, { recursive: true });

export const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
export async function freshPage() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--disable-gpu',
      '--mute-audio',
    ],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.AC && AC.state && AC.state.current(), null, { timeout: 15000 });
  return { browser, context, page, errors };
}
export async function closePage(browser) { await browser.close(); }
export function ffprobe(file) {
  try {
    const out = execSync(`ffprobe -v error -show_format -show_streams -of json "${file}"`, { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) { return { error: String(e.stderr || e.message) }; }
}
export function ffmpeg(args) {
  try { return execSync(`ffmpeg -y -v error ${args} 2>&1`, { encoding: 'utf8' }); }
  catch (e) { return String(e.stdout || e.message) + '\n' + String(e.stderr || ''); }
}
export async function downloadLatest(page, waitMs = 20000) {
  const dl = page.waitForEvent('download', { timeout: waitMs });
  return dl;
}
export function saveB64(name, b64) {
  const m = b64.match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) { fs.writeFileSync(path.join(OUT, name), b64, 'utf8'); return path.join(OUT, name); }
  fs.writeFileSync(path.join(OUT, name), Buffer.from(m[2], 'base64'));
  return path.join(OUT, name);
}
export function summary() {
  const fail = results.filter((r) => !r.ok);
  console.log(`\n━━━━ ${results.length - fail.length}/${results.length} checks passed ━━━━`);
  if (fail.length) {
    for (const f of fail) console.log(`  ✗ ${f.name} :: ${f.detail}`);
    process.exitCode = 1;
  }
}
export { OUT };
