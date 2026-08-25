/* 06-gif-png: GIF89a loop export (valid per ffmpeg, right duration),
   PNG frame snapshot + waveform-only thumbnail decode. */
import { freshPage, closePage, check, ffprobe } from './harness.mjs';
import fs from 'fs';

const b64toFile = (b64, path) => fs.writeFileSync(path, Buffer.from(b64, 'base64'));

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
  });

  /* ── GIF (muted loop, 12 fps) ── */
  const gif = await page.evaluate(() => AC._debug.export({ format: 'gif', scale: 0.5 }));
  b64toFile(gif.b64, 'test/out/export-loop.gif');
  const head = fs.readFileSync('test/out/export-loop.gif').subarray(0, 6).toString('ascii');
  check('GIF is a valid GIF89a file', head === 'GIF89a', head);
  const probe = ffprobe('test/out/export-loop.gif');
  const dur = probe.format ? parseFloat(probe.format.duration) : NaN;
  check('GIF decodes in ffmpeg with sane duration (≈36 frames @ 12 fps)',
    probe.format && probe.format.format_name.includes('gif') && isFinite(dur) && dur > 2.4 && dur < 3.2,
    JSON.stringify({ dur, fmt: probe.format && probe.format.format_name, streams: probe.streams && probe.streams.length }));
  check('GIF has no audio (muted)', !(probe.streams || []).some((s) => s.codec_type === 'audio'));

  /* ── PNG snapshot at playhead ── */
  await page.evaluate(() => AC._debug.seek(1.5));
  const png = await page.evaluate(() => AC._debug.export({ format: 'png' }));
  b64toFile(png.b64, 'test/out/snapshot.png');
  const pprobe = ffprobe('test/out/snapshot.png');
  check('PNG snapshot decodes (ffprobe png_pipe)', pprobe.format && pprobe.format.format_name.includes('png'),
    JSON.stringify(pprobe.format || pprobe.error));
  check('PNG snapshot is full canvas size', pprobe.streams && pprobe.streams[0].width === 1080 && pprobe.streams[0].height === 1920,
    pprobe.streams ? `${pprobe.streams[0].width}×${pprobe.streams[0].height}` : 'n/a');

  /* ── waveform-only thumbnail ── */
  const thumb = await page.evaluate(() => AC._debug.export({ format: 'thumb' }));
  b64toFile(thumb.b64, 'test/out/thumbnail.png');
  const tprobe = ffprobe('test/out/thumbnail.png');
  check('waveform-only thumbnail decodes', tprobe.format && tprobe.format.format_name.includes('png'),
    JSON.stringify(tprobe.format || tprobe.error));
  const thumbBytes = fs.statSync('test/out/thumbnail.png').size;
  const snapBytes = fs.statSync('test/out/snapshot.png').size;
  check('thumbnail is smaller than the full snapshot (waveform only)',
    thumbBytes > 10_000 && thumbBytes < snapBytes, `${thumbBytes} vs ${snapBytes}`);

  check('zero errors in gif/png section', errors.length === 0, errors.join(' | ').slice(0, 300));
  await closePage(browser);
}
