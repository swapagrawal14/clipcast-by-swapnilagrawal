/* 05-export: WebM (VP9+Opus) export — ffprobe duration ≈ 3.0 s ±0.1,
   audio lands in the right windows (silencedetect on a speech-gapped clip),
   sane filesize at medium quality, cancel works. */
import { freshPage, closePage, check, ffprobe } from './harness.mjs';
import { execSync } from 'child_process';
import fs from 'fs';

const b64toFile = (b64, path) => fs.writeFileSync(path, Buffer.from(b64, 'base64'));

export async function run() {
  const { browser, page, errors } = await freshPage();
  await page.evaluate(() => { document.getElementById('welcomeModal').classList.add('hidden'); });

  /* load the 8 s sample, trim to 3 s */
  await page.evaluate(async () => {
    const clip = await AC.assets.sampleClip();
    AC.state.mutate((p) => {
      p.audio = { assetId: clip.id, name: 'sample.wav', duration: clip.duration, volume: 1, normalize: true };
      p.trim = { start: 0, end: 3 };
    });
    await AC.assets.peaksFor(clip.id, AC.waveform.BUCKETS);
  });

  /* ── export WebM (24 fps, medium, 100%) ── */
  const exp = await page.evaluate(() => AC._debug.export({ format: 'webm', fps: 24, quality: 'medium', scale: 1, audio: true }));
  check('WebM exported, sane filesize at medium', exp.ok && exp.size > 50_000 && exp.size < 30_000_000, `${exp.size} bytes`);
  b64toFile(exp.b64, 'test/out/export-sample.webm');
  const probe = ffprobe('test/out/export-sample.webm');
  const vstream = (probe.streams || []).find((s) => s.codec_type === 'video');
  const astream = (probe.streams || []).find((s) => s.codec_type === 'audio');
  const dur = probe.format ? parseFloat(probe.format.duration) : NaN;
  check('ffprobe: video stream is VP9', vstream && vstream.codec_name === 'vp9', JSON.stringify(vstream && vstream.codec_name));
  check('ffprobe: audio stream is Opus', astream && astream.codec_name === 'opus', JSON.stringify(astream && astream.codec_name));
  check('ffprobe: duration ≈ 3.00 s (±0.1)', isFinite(dur) && Math.abs(dur - 3.0) < 0.1, 'duration=' + dur);
  check('ffprobe: dimensions 1080×1920', vstream && vstream.width === 1080 && vstream.height === 1920,
    vstream ? `${vstream.width}×${vstream.height}` : 'no video');

  /* ── silencedetect: tone bursts at 0.5–1.5 and 2.0–3.0 → silence in [0,0.5],[1.5,2.0] ── */
  await page.evaluate(async () => {
    const sr = 44100, dur = 3;
    const ctx = new OfflineAudioContext(1, dur * sr, sr);
    const tone = (start, len) => {
      const o = ctx.createOscillator();
      o.frequency.value = 440;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
      g.gain.setValueAtTime(0.5, start + len - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, start + len);
      o.connect(g).connect(ctx.destination);
      o.start(start); o.stop(start + len + 0.01);
    };
    tone(0.5, 1.0);
    tone(2.0, 1.0);
    const buf = await ctx.startRendering();
    const blob = AC.assets.bufferToWavBlob(buf);
    const durl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    await AC._debug.loadAudioDataURL(durl, 'gap.wav');
    AC.state.mutate((p) => { p.trim = { start: 0, end: 3 }; p.captions.cues = []; });
  });
  const exp2 = await page.evaluate(() => AC._debug.export({ format: 'webm', fps: 24, quality: 'low', scale: 0.5, audio: true }));
  b64toFile(exp2.b64, 'test/out/export-gap.webm');
  const sdOut = execSync(`ffmpeg -y -v info -i "test/out/export-gap.webm" -af silencedetect=noise=-35dB:d=0.2 -f null - 2>&1`, { encoding: 'utf8' });
  const starts = [...sdOut.matchAll(/silence_start: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...sdOut.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const s0 = starts.find((s) => s < 0.4);
  const sMid = starts.find((s) => s > 1.2 && s < 1.9);
  const eFirst = ends.find((e) => Math.abs(e - 0.5) < 0.3);
  const eMid = ends.find((e) => Math.abs(e - 2.0) < 0.3);
  check('silencedetect: silence at [0,0.5) and (1.5,2.0) — audio lands in the right windows',
    s0 != null && sMid != null && eFirst != null && eMid != null,
    `starts=${starts.join(',')} ends=${ends.join(',')}`);

  /* ── cancel test ── */
  await page.evaluate(async () => {
    AC._debug.seek(0);
    const p = AC.state.current();
    AC.state.mutate((pp) => { pp.trim = { start: 0, end: Math.min(8, p.audio.duration) }; });
    window.__expProm = AC._debug.export({ format: 'webm', fps: 30, quality: 'high', scale: 1, audio: true }).catch(() => ({ cancelled: true }));
  });
  await page.waitForTimeout(2500); /* countdown + recording start */
  const wasRunning = await page.evaluate(() => AC.exporter.running);
  await page.evaluate(() => AC.exporter.cancel());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ running: AC.exporter.running }));
  check('cancel stops a running export', wasRunning && !after.running, `was=${wasRunning} after=${JSON.stringify(after)}`);

  /* ── UI-driven export: real clicks through the export modal ── */
  await page.evaluate(() => AC.state.mutate((pp) => { pp.trim = { start: 0, end: 3 }; }));
  await page.click('#btnExport');
  const modalOpen = await page.evaluate(() => !document.getElementById('exportModal').classList.contains('hidden'));
  check('Export button opens the modal', modalOpen);
  await page.selectOption('#expFmt', 'webm');
  await page.selectOption('#expFps', '24');
  await page.selectOption('#expQuality', 'low');
  await page.selectOption('#expScale', '0.5');
  await page.click('#expStart');
  await page.waitForFunction(() => {
    const d = document.getElementById('expDone');
    return d && !d.classList.contains('hidden');
  }, null, { timeout: 120000 });
  const uiResult = await page.evaluate(() => ({
    done: !document.getElementById('expDone').classList.contains('hidden'),
    dlBtn: !!document.getElementById('expDownload'),
    last: AC.exporter.lastExport ? AC.exporter.lastExport.name : null,
  }));
  check('UI export completes → done screen + download button', uiResult.done && uiResult.dlBtn && !!uiResult.last, JSON.stringify(uiResult));
  await page.click('#expAgain');

  check('zero errors in export section', errors.length === 0, errors.join(' | ').slice(0, 400));
  await closePage(browser);
}
