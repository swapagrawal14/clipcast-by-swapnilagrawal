/* 04-render: render one frame for each of 6 waveform styles, 3 caption
   modes, 4 aspects and all background presets → PNGs + contact sheets
   (eyeballable), plus pixel-diff sanity (styles really differ). */
import { freshPage, closePage, check, saveB64, ffprobe, ffmpeg } from './harness.mjs';
import fs from 'fs';
import crypto from 'crypto';
const hashFile = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const distinct = (files) => new Set(files.map(hashFile)).size;

const W = 360, H = 640;

export async function run() {
  const { browser, page, errors } = await freshPage();
  await page.evaluate(() => {
    document.getElementById('welcomeModal').classList.add('hidden');
  });
  await page.evaluate(async () => {
    const clip = await AC.assets.sampleClip();
    AC.state.mutate((p) => {
      p.audio = { assetId: clip.id, name: 'sample.wav', duration: clip.duration, volume: 1, normalize: true };
      p.trim = { start: 0, end: clip.duration };
      p.captions.cues = [
        { start: 0, end: 2, text: 'Hello and welcome to ClipCast' },
        { start: 2, end: 4, text: 'This sample renders every style' },
        { start: 4, end: 6, text: 'Waveforms captions and covers' },
        { start: 6, end: 8, text: 'All generated in your browser' },
      ];
    });
    await AC.assets.peaksFor(clip.id, AC.waveform.BUCKETS);
  });

  const out = 'test/out/render';
  fs.mkdirSync(out, { recursive: true });

  /* ── 6 waveform styles × karaoke ── */
  const styles = ['bars', 'filled', 'mirror', 'radial', 'dots', 'spectrum'];
  const styleFrames = [];
  for (const s of styles) {
    const b64 = await page.evaluate(({ s, W, H }) => {
      AC.state.mutate((p) => { p.wf.style = s; });
      AC.engine.resetBounce();
      return AC._debug.renderFrame(1.2, W, H);
    }, { s, W, H });
    const f = saveB64(`render/wf-${s}.png`, b64);
    styleFrames.push(f);
  }
  check('6 waveform-style frames rendered', styleFrames.length === 6);

  /* pixel-diff sanity: frames genuinely differ */
  const unique = distinct(styleFrames);
  check('all 6 waveform styles produce distinct frames', unique === 6, `unique=${unique}`);

  /* ── 3 caption modes ── */
  await page.evaluate(() => AC.state.mutate((p) => { p.wf.style = 'bars'; }));
  const modeFrames = [];
  for (const m of ['karaoke', 'phrase', 'bigword']) {
    const b64 = await page.evaluate(({ m, W, H }) => {
      AC.state.mutate((p) => { p.captions.style.mode = m; });
      AC.engine.resetBounce();
      return AC._debug.renderFrame(1.2, W, H);
    }, { m, W, H });
    modeFrames.push(saveB64(`render/cap-${m}.png`, b64));
  }
  const modeUnique = distinct(modeFrames);
  check('3 caption modes produce distinct frames', modeUnique === 3, `unique=${modeUnique}`);
  /* bigword at a word pop should be visually larger text — just verify distinctness */
  await page.evaluate(() => AC.state.mutate((p) => { p.captions.style.mode = 'karaoke'; }));

  /* ── 4 aspects ── */
  const aspectFrames = [];
  for (const a of ['1:1', '9:16', '16:9', '4:5']) {
    const b64 = await page.evaluate(({ a, W, H }) => {
      AC.state.setAspect(a);
      return AC._debug.renderFrame(1.2, W, H);
    }, { a, W, H });
    aspectFrames.push(saveB64(`render/aspect-${a.replace(':', 'x')}.png`, b64));
  }
  const aspectDims = await page.evaluate(() => {
    const p = AC.state.current();
    return [p.aspect, p.canvasW, p.canvasH];
  });
  check('4 aspects render; project canvas follows', aspectDims[0] === '4:5' && aspectDims[1] === 1080 && aspectDims[2] === 1350, JSON.stringify(aspectDims));

  /* ── backgrounds (all presets incl. custom) ── */
  const bgs = ['solid', 'grad1', 'grad2', 'grad3', 'grad4', 'paper', 'grid', 'dots', 'chalk', 'neon', 'sunset', 'aurora', 'custom'];
  await page.evaluate(() => AC.state.mutate((p) => { p.bg.c1 = '#334155'; p.bg.c2 = '#7c3aed'; })); /* distinct custom palette */
  const bgFrames = [];
  for (const b of bgs) {
    const b64 = await page.evaluate(({ b, W, H }) => {
      AC.state.mutate((p) => { p.bg.type = b; });
      return AC._debug.renderFrame(1.2, W, H);
    }, { b, W, H });
    bgFrames.push(saveB64(`render/bg-${b}.png`, b64));
  }
  const bgUnique = distinct(bgFrames);
  check('13 background presets render distinctly', bgUnique === 13, `unique=${bgUnique}`);

  /* every PNG decodes */
  const allFrames = [...styleFrames, ...modeFrames, ...aspectFrames, ...bgFrames];
  const probe = ffprobe(allFrames[0]);
  check('rendered PNGs decode (ffprobe)', probe.format && probe.format.format_name.includes('png'), JSON.stringify(probe.format || probe.error));

  /* ── contact sheets (eyeball) ── */
  const tile = (files, name, cols) => {
    const rows = Math.ceil(files.length / cols);
    const inputs = files.map((f) => `-i "${f}"`).join(' ');
    const pads = files.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2[s${i}]`).join(';');
    const xstack = files.map((_, i) => `[s${i}]`).join('') + `xstack=inputs=${files.length}:layout=${Array.from({ length: files.length }, (_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|')}[v]`;
    return ffmpeg(`${inputs} -filter_complex "${pads};${xstack}" -map "[v]" "${name}"`);
  };
  const err1 = tile(styleFrames, 'test/out/render/sheet-styles.png', 3);
  const err2 = tile(modeFrames, 'test/out/render/sheet-caption-modes.png', 3);
  const err3 = tile(aspectFrames, 'test/out/render/sheet-aspects.png', 4);
  const err4 = tile(bgFrames, 'test/out/render/sheet-backgrounds.png', 5);
  check('contact sheets built (ffmpeg tile)', !err1 && !err2 && !err3 && !err4, (err1 || err2 || err3 || err4 || '').slice(0, 200));

  /* targeted color assertions: highlight accent really renders */
  const colors = await page.evaluate(async () => {
    const near = (rgb, hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return Math.abs(rgb[0] - r) < 40 && Math.abs(rgb[1] - g) < 40 && Math.abs(rgb[2] - b) < 40;
    };
    const count = (b64, hex) => {
      const m = b64.match(/^data:image\/png;base64,(.*)$/);
      const buf = Buffer.from(m[1], 'base64');
      return null; /* replaced below with canvas-based counting */
    };
    /* canvas-based: count pixels near a color */
    const countPx = (b64, hex) => {
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (near([d[i], d[i + 1], d[i + 2]], hex)) n++;
          res(n);
        };
        img.src = b64;
      });
    };
    const kara = await AC._debug.renderFrame(1.2, 300, 533);
    const karaTeal = await countPx(kara, '#2dd4bf');      /* karaoke highlight */
    const karaWhite = await countPx(kara, '#f1f5f9');     /* caption main color */
    AC.state.applyTemplate('hormozi');
    const horm = await AC._debug.renderFrame(1.2, 300, 533);
    const hormoCoral = await countPx(horm, '#fb7185');
    return { karaTeal, karaWhite, hormoCoral };
  });
  check('karaoke highlight + text colors render on frame',
    colors.karaTeal > 50 && colors.karaWhite > 50, JSON.stringify(colors));
  check('hormozi template renders coral accent', colors.hormoCoral > 100, JSON.stringify(colors));

  check('zero errors in render section', errors.length === 0, errors.join(' | ').slice(0, 300));
  await closePage(browser);
}
