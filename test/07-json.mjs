/* 07-json: .json project export → fresh page import → state identical
   (trim, cues, block positions) and audio plays; hand-written spec with
   bad ids → warn-and-skip, valid parts build. */
import { freshPage, closePage, check, saveB64 } from './harness.mjs';
import fs from 'fs';

export async function run() {
  const { browser, page, errors } = await freshPage();
  await page.evaluate(() => { document.getElementById('welcomeModal').classList.add('hidden'); });

  /* build a project with everything: audio, cover, bgm, cues, trims, moved blocks */
  await page.evaluate(async () => {
    const clip = await AC.assets.sampleClip();
    const coverBlob = await AC.assets.makeCoverArt('Cover', '#0f766e', '#134e4a');
    const cover = await AC.assets.loadImageFile(new File([coverBlob], 'cover.png', { type: 'image/png' }));
    AC.assets.getImage(cover.id);
    AC.state.mutate((p) => {
      p.name = 'Round Trip Test';
      p.audio = { assetId: clip.id, name: 'sample.wav', duration: clip.duration, volume: 0.9, normalize: true };
      p.trim = { start: 1.2, end: 5.6 };
      p.captions.cues = [
        { start: 0.0, end: 1.2, text: 'Round trip' },
        { start: 1.3, end: 2.5, text: 'must survive' },
        { start: 2.6, end: 4.2, text: 'the JSON journey' },
      ];
      p.captions.style = { ...p.captions.style, mode: 'bigword', font: 'oswald', hl: '#fb7185', caps: true, position: 'top' };
      let cov = p.blocks.find((b) => b.type === 'cover');
      if (!cov) { cov = AC.engine.defaultBlock('cover'); p.blocks.push(cov); }
      cov.assetId = cover.id; cov.x = 0.31; cov.y = 0.44; cov.kenburns = true;
      const title = p.blocks.find((b) => b.type === 'title');
      if (title) { title.text = 'Round Trip'; title.x = 0.6; title.font = 'merriweather'; }
      p.wf.style = 'mirror';
      p.bg.type = 'sunset';
    });
    await AC.assets.peaksFor(clip.id, AC.waveform.BUCKETS);
  });

  /* snapshot state, export spec */
  const before = await page.evaluate(() => {
    const p = AC.state.current();
    return {
      name: p.name, aspect: p.aspect, trim: { ...p.trim }, audioVol: p.audio.volume,
      style: p.captions.style, cues: JSON.parse(JSON.stringify(p.captions.cues)),
      blocks: p.blocks.map((b) => ({ type: b.type, x: Math.round(b.x * 1000) / 1000, y: Math.round(b.y * 1000) / 1000, text: b.text || null, assetId: !!b.assetId })),
      bg: p.bg.type, wf: p.wf.style, hasBgm: !!p.bgm.assetId,
    };
  });
  const spec = await page.evaluate(() => AC._debug.projectJSON());
  check('spec exports with clipcast:1 + audio dataURL', spec.clipcast === 1 && typeof spec.audio.src === 'string' && spec.audio.src.startsWith('data:audio'),
    `audio src: ${(spec.audio && spec.audio.src || '').slice(0, 30)}`);
  check('spec carries cover dataURL + bgm? (none set) → cover yes', (spec.blocks.find((b) => b.type === 'cover') || {}).src ? true : false, 'cover src present');

  /* import into a FRESH page (simulated reload) */
  await closePage(browser);
  const { browser: b2, page: p2, errors: errors2 } = await freshPage();
  await p2.evaluate(() => { document.getElementById('welcomeModal').classList.add('hidden'); });
  const warnings = await p2.evaluate(async (spec) => {
    const { project, warnings } = await AC.jsonio.specToProject(spec);
    AC.state.setCurrent(project);
    AC.state.mutate(() => {});
    return warnings;
  }, spec);
  check('spec import produces zero warnings (round-trip)', warnings.length === 0, warnings.join('|'));

  const after = await p2.evaluate(() => {
    const p = AC.state.current();
    return {
      name: p.name, aspect: p.aspect, trim: { ...p.trim }, audioVol: p.audio.volume,
      style: p.captions.style, cues: JSON.parse(JSON.stringify(p.captions.cues)),
      blocks: p.blocks.map((b) => ({ type: b.type, x: Math.round(b.x * 1000) / 1000, y: Math.round(b.y * 1000) / 1000, text: b.text || null, assetId: !!b.assetId })),
      bg: p.bg.type, wf: p.wf.style, hasBgm: !!p.bgm.assetId,
    };
  });
  const keys = ['name', 'aspect', 'audioVol', 'bg', 'wf'];
  const keyOk = keys.every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]));
  check('round-trip: name/aspect/audio/vol/bg/wf identical', keyOk, JSON.stringify({ before: keys.map((k) => before[k]), after: keys.map((k) => after[k]) }));
  check('round-trip: trim identical', Math.abs(before.trim.start - after.trim.start) < 1e-6 && Math.abs(before.trim.end - after.trim.end) < 1e-6,
    JSON.stringify({ b: before.trim, a: after.trim }));
  check('round-trip: cues identical', JSON.stringify(before.cues) === JSON.stringify(after.cues), JSON.stringify({ b: before.cues, a: after.cues }));
  check('round-trip: caption style identical (mode/font/hl/caps/position)',
    ['mode', 'font', 'hl', 'caps', 'position'].every((k) => before.style[k] === after.style[k]), JSON.stringify({ b: before.style, a: after.style }));
  check('round-trip: block positions + texts identical',
    JSON.stringify(before.blocks) === JSON.stringify(after.blocks), JSON.stringify({ b: before.blocks, a: after.blocks }));
  check('round-trip: cover asset restored', after.blocks.find((b) => b.type === 'cover').assetId, 'cover assetId set');

  /* imported project plays */
  await p2.evaluate(async () => {
    AC._debug.seek(0.2);
    AC._debug.play();
    await new Promise((r) => setTimeout(r, 800));
  });
  const playState = await p2.evaluate(() => ({ playing: AC.stage.playing, t: AC.stage.getTime() }));
  check('imported project audio plays', playState.playing && playState.t > 0.5, JSON.stringify(playState));
  await p2.evaluate(() => AC._debug.pause());

  /* ── hand-written spec with invalid ids → warn-and-skip ── */
  const handSpec = {
    clipcast: 1,
    name: 'AI Generated Spec',
    aspect: '9:16',
    trim: { start: 0, end: 3 },
    template: 'neon-rings',
    bg: { type: 'plasma', c1: '#112233' },
    wf: { style: 'hologram', bars: 99, gap: 0.3 },
    blocks: [
      { type: 'title', x: 'left', y: 0.1, w: 0.8, h: 0.1, text: 'AI Title', font: 'comic-sans-ms' },
      { type: 'unicorn', x: 0.5, y: 0.5 },
      { type: 'waveform', x: 800, y: 1100, w: 0.8, h: 0.15 },
      { type: 'subtitle', x: 'center', y: 'bottom', w: 200, h: 0.05, text: '@ai' },
    ],
    captions: { srt: '1\n00:00:00,000 --> 00:00:01,500\nHello AI\n\n2\n00:00:01,500 --> 00:00:03,000\nWorld' },
    audio: null,
  };
  const imp = await p2.evaluate(async (spec) => {
    const { project, warnings } = await AC.jsonio.specToProject(spec);
    return {
      warnings,
      blocks: project.blocks.map((b) => b.type),
      titleX: project.blocks.find((b) => b.type === 'title') && project.blocks.find((b) => b.type === 'title').x,
      wfX: project.blocks.find((b) => b.type === 'waveform') && project.blocks.find((b) => b.type === 'waveform').x,
      subY: project.blocks.find((b) => b.type === 'subtitle') && project.blocks.find((b) => b.type === 'subtitle').y,
      cues: project.captions.cues.length,
      font: project.captions.style.font,
      wfStyle: project.wf.style,
      bg: project.bg.type,
    };
  }, handSpec);
  check('hand spec: unknown ids warn + skip (plasma, hologram, unicorn, comic-sans)',
    imp.warnings.length >= 4, imp.warnings.join(' | '));
  check('hand spec: valid parts build — blocks title/waveform/subtitle',
    imp.blocks.includes('title') && imp.blocks.includes('waveform') && imp.blocks.includes('subtitle') && !imp.blocks.includes('unicorn'),
    imp.blocks.join(','));
  check('hand spec: keyword coords — left=0, center=0.5, bottom=1, px→fraction (800/1080≈0.741)',
    imp.titleX === 0 && imp.subY === 1 && Math.abs(imp.wfX - 800 / 1080) < 0.01, JSON.stringify({ titleX: imp.titleX, subY: imp.subY, wfX: imp.wfX }));
  check('hand spec: SRT cues imported', imp.cues === 2, `cues=${imp.cues}`);
  check('hand spec: defaults applied for bad enums', imp.font === 'inter' && imp.wfStyle === 'bars' && imp.bg === 'aurora',
    JSON.stringify({ font: imp.font, wf: imp.wfStyle, bg: imp.bg }));

  check('zero errors in json section', errors.length === 0 && errors2.length === 0, [...errors, ...errors2].join(' | ').slice(0, 300));
  await closePage(b2);
}
