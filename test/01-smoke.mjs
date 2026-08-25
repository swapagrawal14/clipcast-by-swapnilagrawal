/* 01-smoke: page boots, welcome shows, sample template renders, play works
   with audible graph (HTMLAudioElement currentTime advances, paused=false). */
import { freshPage, closePage, check, saveB64 } from './harness.mjs';

export async function run() {
  const { browser, page, errors } = await freshPage();

  /* welcome modal visible on first run */
  const welcomeVisible = await page.evaluate(() => !document.getElementById('welcomeModal').classList.contains('hidden'));
  check('welcome modal shows on first run', welcomeVisible);

  /* start the Podcast Minimal sample (generates 8s synth clip in-page) */
  await page.evaluate(() => AC.tour.startSample ? null : null);
  const btns = await page.$$('#welcomeTmplGrid .tmpl-big');
  check('welcome offers 3 templates', btns.length === 3, `got ${btns.length}`);
  await btns[0].click();
  await page.waitForFunction(() => AC.state.current().audio && AC.state.current().audio.assetId && AC.state.current().captions.cues.length >= 4, null, { timeout: 30000 });
  const p0 = await page.evaluate(() => {
    const p = AC.state.current();
    return { name: p.name, trimEnd: p.trim.end, cues: p.captions.cues.length, blocks: p.blocks.length };
  });
  check('sample project built (audio + trim + cues + blocks)',
    p0.trimEnd > 7 && p0.cues === 4 && p0.blocks >= 4, JSON.stringify(p0));

  /* stage canvas renders non-blank */
  await page.waitForTimeout(600);
  const blank = await page.evaluate(() => {
    const c = document.getElementById('stageCanvas');
    const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let non = 0;
    for (let i = 0; i < x.length; i += 400) if (x[i] + x[i + 1] + x[i + 2] > 30) non++;
    return non;
  });
  check('stage canvas renders pixels', blank > 50, `non-bg samples: ${blank}`);
  await page.screenshot({ path: 'test/out/01-sample-preview.png' });

  /* play: currentTime advances, paused=false */
  const probe = await page.evaluate(async () => {
    await AC._debug.seek(0.5);
    AC._debug.play();
    await new Promise((r) => setTimeout(r, 700));
    const v = AC.stage.voice;
    const state = {
      playing: AC.stage.playing,
      t0: AC.stage.getTime(),
      voice: { paused: v.paused, ct: v.currentTime, src: v.src.slice(0, 40) },
    };
    AC._debug.pause();
    return state;
  });
  check('play starts and time advances (audible graph)',
    probe.playing && probe.t0 > 0.6, JSON.stringify(probe));
  check('HTMLAudioElement exists, playing, currentTime > 0',
    !probe.voice.paused && probe.voice.ct > 0.3, JSON.stringify(probe.voice));

  /* ── real UI: Space toggles play, play overlay button works ── */
  await page.evaluate(() => AC._debug.seek(0));
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const spaceOn = await page.evaluate(() => AC.stage.playing);
  await page.keyboard.press('Space');
  const spaceOff = await page.evaluate(() => AC.stage.playing);
  check('Space key toggles play/pause', spaceOn && !spaceOff, `on=${spaceOn} off=${spaceOff}`);
  await page.click('#playOverlay');
  await page.waitForTimeout(400);
  const overlayOn = await page.evaluate(() => AC.stage.playing);
  await page.evaluate(() => AC._debug.pause());
  check('play overlay button plays', overlayOn);

  /* ── theme toggle ── */
  await page.click('#btnTheme');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#btnTheme');
  const theme2 = await page.evaluate(() => document.documentElement.dataset.theme);
  check('theme toggles dark ↔ light and back', theme === 'light' && theme2 === 'dark', `${theme} → ${theme2}`);

  /* ── drag & drop an audio file onto the page ── */
  const dropState = await page.evaluate(async () => {
    const clip = await AC.assets.sampleClip();
    const blob = await AC.assets.idbGet(clip.id);
    const file = new File([blob], 'dropped.wav', { type: 'audio/wav' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return new Promise((res) => setTimeout(() => res({ name: AC.state.current().audio.name, dur: AC.state.current().audio.duration }), 2500));
  });
  check('drag & drop loads audio', dropState.name === 'dropped.wav' && dropState.dur > 7, JSON.stringify(dropState));

  /* ── persistence: rename, reload page → project + audio restored ── */
  await page.evaluate(() => AC.state.renameProject('Persisted Project'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.AC && AC.state && AC.state.current(), null, { timeout: 15000 });
  const persisted = await page.evaluate(() => ({
    name: AC.state.current().name,
    hasAudio: !!AC.state.current().audio.assetId,
  }));
  check('opened-at-boot: project + audio survive reload (localStorage + IDB)', persisted.name === 'Persisted Project' && persisted.hasAudio, JSON.stringify(persisted));

  /* zero console errors */
  await page.waitForTimeout(400);
  check('zero console/page errors during smoke', errors.length === 0, errors.join(' | ').slice(0, 400));

  await closePage(browser);
}
