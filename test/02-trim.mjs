/* 02-trim: trim to 2.0 s → preview plays and stops exactly at 2.0 s. */
import { freshPage, closePage, check } from './harness.mjs';

export async function run() {
  const { browser, page, errors } = await freshPage();
  await page.evaluate(() => {
    document.getElementById('welcomeModal').classList.add('hidden');
  });

  /* load the 8 s sample audio directly */
  await page.evaluate(async () => {
    const clip = await AC.assets.sampleClip();
    AC.state.mutate((p) => {
      p.audio = { assetId: clip.id, name: 'sample.wav', duration: clip.duration, volume: 1, normalize: true };
      p.trim = { start: 0, end: clip.duration };
    });
    await AC.assets.peaksFor(clip.id, AC.waveform.BUCKETS);
    await AC.stage.ensureAudioURLs();
    AC.stage.setTime(0);
  });

  /* trim to 2.0 s */
  await page.evaluate(() => AC._debug.setTrim(0, 2.0));
  const trimInfo = await page.evaluate(() => ({
    end: AC.state.current().trim.end,
    dur: AC.timeline.trimDuration(AC.state.current()),
  }));
  check('trim set to 2.0 s', Math.abs(trimInfo.dur - 2.0) < 0.01, JSON.stringify(trimInfo));

  /* play from 0; after 3 s wall time it must have stopped at 2.0 s */
  await page.evaluate(async () => {
    AC._debug.seek(0);
    AC._debug.play();
    await new Promise((r) => setTimeout(r, 3200));
  });
  const after = await page.evaluate(() => ({
    t: AC.stage.getTime(),
    playing: AC.stage.playing,
    voicePaused: AC.stage.voice.paused,
  }));
  check('preview stops at exactly 2.0 s (not past it)',
    Math.abs(after.t - 2.0) < 0.02 && !after.playing && after.voicePaused, JSON.stringify(after));

  /* loop-preview: with loop on, it wraps back around */
  await page.evaluate(() => AC.state.mutate((p) => { p.play.loopPreview = true; }));
  await page.evaluate(async () => {
    AC._debug.seek(0);
    AC._debug.play();
    await new Promise((r) => setTimeout(r, 3100));
  });
  const looped = await page.evaluate(() => ({ t: AC.stage.getTime(), playing: AC.stage.playing }));
  check('loop preview wraps back into the clip',
    looped.playing && looped.t < 1.5, JSON.stringify(looped));
  await page.evaluate(() => AC.state.mutate((p) => { p.play.loopPreview = false; AC._debug.pause(); }));

  /* trim handles: numeric field edit */
  await page.evaluate(() => {
    const inp = document.getElementById('trimStart');
    inp.value = '1.0';
    inp.dispatchEvent(new Event('change'));
  });
  const afterField = await page.evaluate(() => ({
    start: AC.state.current().trim.start,
    t: AC.stage.getTime(),
  }));
  check('trim start field updates project', Math.abs(afterField.start - 1.0) < 0.001, JSON.stringify(afterField));

  check('zero errors in trim section', errors.length === 0, errors.join(' | ').slice(0, 300));
  await closePage(browser);
}
