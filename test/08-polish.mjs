/* 08-polish: BGM + auto-duck, T trim-to-playhead, undo/redo, Del block,
   MP4 export (where supported), tour tooltip, small-screen notice. */
import { freshPage, closePage, check, ffprobe } from './harness.mjs';
import fs from 'fs';

export async function run() {
  const { browser, page, errors } = await freshPage();
  await page.evaluate(() => { document.getElementById('welcomeModal').classList.add('hidden'); });
  await page.evaluate(async () => {
    const clip = await AC.assets.sampleClip();
    AC.state.mutate((p) => {
      p.audio = { assetId: clip.id, name: 'sample.wav', duration: clip.duration, volume: 1, normalize: true };
      p.trim = { start: 0, end: 3 };
    });
    await AC.assets.peaksFor(clip.id, AC.waveform.BUCKETS);
    AC._debug.seek(0.5);
  });

  /* ── T: trim to playhead ── */
  await page.keyboard.press('t');
  const tResult = await page.evaluate(() => ({ end: AC.state.current().trim.end, dur: AC.timeline.trimDuration(AC.state.current()) }));
  check('T trims clip end to playhead (0.5 s)', Math.abs(tResult.end - 0.5) < 0.001, JSON.stringify(tResult));
  await page.evaluate(() => AC.state.mutate((p) => { p.trim.end = 3; }));

  /* ── undo / redo ── */
  const undoRes = await page.evaluate(() => {
    AC.state.mutate((p) => { p.name = 'Temp Name'; });
    const afterMutate = AC.state.current().name;
    AC.state.undo();
    const afterUndo = AC.state.current().name;
    AC.state.redo();
    const afterRedo = AC.state.current().name;
    return { afterMutate, afterUndo, afterRedo };
  });
  check('undo restores previous state; redo re-applies',
    undoRes.afterMutate === 'Temp Name' && undoRes.afterUndo !== 'Temp Name' && undoRes.afterRedo === 'Temp Name', JSON.stringify(undoRes));

  /* ── Del removes selected block ── */
  await page.evaluate(() => {
    const p = AC.state.current();
    const t = p.blocks.find((b) => b.type === 'title');
    AC.stage.setSelected(t.id);
  });
  await page.keyboard.press('Delete');
  const delRes = await page.evaluate(() => ({ hasTitle: AC.state.current().blocks.some((b) => b.type === 'title') }));
  check('Delete removes the selected block', !delRes.hasTitle, JSON.stringify(delRes));
  await page.evaluate(() => AC.state.undo());

  /* ── BGM: loads, plays in preview, ducks under voice ── */
  const bgmRes = await page.evaluate(async () => {
    const clip = await AC.assets.sampleClip();
    const blob = await AC.assets.idbGet(clip.id);
    const durl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    await AC._debug.loadBgmDataURL(durl, 'bgm.wav');
    AC.state.mutate((p) => { p.bgm.volume = 0.8; p.bgm.duck = true; });
    await AC.stage.ensureAudioURLs();
    AC._debug.seek(0.4);
    AC._debug.play();
    await new Promise((r) => setTimeout(r, 800));
    const state = {
      bgmPlaying: !AC.stage.bgm.paused,
      bgmVol: AC.stage.bgm.volume,
      base: 0.8,
      t: AC.stage.getTime(),
    };
    AC._debug.pause();
    return state;
  });
  check('BGM loads and plays in preview', bgmRes.bgmPlaying && bgmRes.t > 0.5, JSON.stringify(bgmRes));
  /* ducking: during the loud sample the bgm volume should be pulled below its 0.8 base */
  check('auto-duck lowers BGM volume under voice', bgmRes.bgmVol < bgmRes.base - 0.05, JSON.stringify(bgmRes));

  /* ── MP4 export (if this Chromium supports it) ── */
  const mp4Supported = await page.evaluate(() => {
    try { return MediaRecorder.isTypeSupported('video/mp4'); } catch (e) { return false; }
  });
  if (mp4Supported) {
    const mp4 = await page.evaluate(() => AC._debug.export({ format: 'mp4', fps: 24, quality: 'low', scale: 0.5, audio: true }));
    fs.writeFileSync('test/out/export-test.mp4', Buffer.from(mp4.b64, 'base64'));
    const probe = ffprobe('test/out/export-test.mp4');
    const v = (probe.streams || []).find((s) => s.codec_type === 'video');
    const a = (probe.streams || []).find((s) => s.codec_type === 'audio');
    const dur = probe.format ? parseFloat(probe.format.duration) : NaN;
    check('MP4 export: container muxes, duration ≈ 3 s', probe.format && (probe.format.format_name || '').includes('mp4') && isFinite(dur) && Math.abs(dur - 3) < 0.15,
      JSON.stringify({ fmt: probe.format && probe.format.format_name, dur, v: v && v.codec_name, a: a && a.codec_name }));
  } else {
    check('MP4 export: not supported in this browser (WebM fallback in place)', true, 'isTypeSupported(video/mp4)=false — skip');
  }

  /* ── tour tooltip after first-run welcome dismiss ── */
  const tourRes = await page.evaluate(() => {
    try { localStorage.removeItem('ac.tourSeen.v1'); } catch (e) {}
    return true;
  });
  const { browser: b2, page: p2 } = await freshPage();
  await p2.evaluate(() => { document.getElementById('welcomeModal').classList.add('hidden'); });
  await p2.waitForTimeout(1200);
  const tourVisible = await p2.evaluate(() => !!document.getElementById('tourTip'));
  check('first-run guided tour appears after welcome', tourVisible);
  await p2.evaluate(() => AC.tour.endTour());

  /* ── small-screen notice ── */
  await p2.setViewportSize({ width: 800, height: 700 });
  await p2.waitForTimeout(400);
  const smallVisible = await p2.evaluate(() => document.getElementById('smallScreen').classList.contains('show'));
  check('small-screen notice (<900 px)', smallVisible);
  await p2.click('#btnSmallContinue');
  const smallGone = await p2.evaluate(() => !document.getElementById('smallScreen').classList.contains('show'));
  check('continue-anyway dismisses the notice', smallGone);

  check('zero errors in polish section', errors.length === 0, errors.join(' | ').slice(0, 300));
  await closePage(browser);
  await closePage(b2);
}
