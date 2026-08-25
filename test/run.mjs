/* ClipCast acceptance suite — runs all test sections.
   Usage: node test/run.mjs [section-filter] */
import { freshPage, closePage, summary } from './harness.mjs';

const filter = process.argv[2] || '';

const sections = [
  ['smoke', () => import('./01-smoke.mjs')],
  ['trim', () => import('./02-trim.mjs')],
  ['captions', () => import('./03-captions.mjs')],
  ['render', () => import('./04-render.mjs')],
  ['export', () => import('./05-export.mjs')],
  ['gifpng', () => import('./06-gif-png.mjs')],
  ['json', () => import('./07-json.mjs')],
  ['polish', () => import('./08-polish.mjs')],
  ['sandbox', () => import('./09-sandbox.mjs')],
];

for (const [name, load] of sections) {
  if (filter && !name.includes(filter)) continue;
  console.log(`\n═══ section: ${name} ═══`);
  try {
    const mod = await load();
    if (typeof mod.run === 'function') await mod.run();
  } catch (e) {
    console.error(`❌ section ${name} crashed:`, e);
    process.exitCode = 1;
  }
}
summary();
