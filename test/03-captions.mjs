/* 03-captions: paste an SRT with 4 cues → parsed exactly; word-karaoke
   highlight index matches t (interpolated even split); split/merge work. */
import { freshPage, closePage, check } from './harness.mjs';

const SRT = `1
00:00:00,000 --> 00:00:01,000
one two three

2
00:00:01,000 --> 00:00:02,000
four five six

3
00:00:02,000 --> 00:00:03,000
seven eight nine

4
00:00:03,000 --> 00:00:04,000
ten eleven twelve
`;

export async function run() {
  const { browser, page, errors } = await freshPage();
  await page.evaluate(() => {
    document.getElementById('welcomeModal').classList.add('hidden');
    const clip = { id: 'none', duration: 8 };
  });

  /* import SRT via the debug hook (same parser the UI uses) */
  const n = await page.evaluate((srt) => AC._debug.importSrt(srt), SRT);
  check('SRT parses into 4 cues', n === 4, `got ${n}`);

  const cues = await page.evaluate(() => AC.state.current().captions.cues.map((c) => [c.start, c.end, c.text]));
  check('cue timestamps parsed exactly (0,1,2,3 s)',
    JSON.stringify(cues) === JSON.stringify([
      [0, 1, 'one two three'], [1, 2, 'four five six'], [2, 3, 'seven eight nine'], [3, 4, 'ten eleven twelve'],
    ]), JSON.stringify(cues));

  /* karaoke word index at known times */
  const probe = await page.evaluate(() => ({
    t14: AC._debug.karaokeAt(1.4),   // cue 1 (four five six), word 1 → "five"
    t19: AC._debug.karaokeAt(1.9),   // cue 1, word 2 → "six"
    t0: AC._debug.karaokeAt(0.05),   // cue 0, word 0
    t35: AC._debug.karaokeAt(3.5),   // cue 3, word 1
  }));
  check('karaoke cue index matches t',
    probe.t14.cue === 1 && probe.t19.cue === 1 && probe.t0.cue === 0 && probe.t35.cue === 3,
    JSON.stringify(probe));
  check('karaoke word index matches t (even interpolation)',
    probe.t14.word === 1 && probe.t19.word === 2 && probe.t0.word === 0 && probe.t35.word === 1,
    JSON.stringify(probe));

  /* split cue 1 at t=1.4 → 2 cues: "four" / "five six" */
  await page.evaluate(() => {
    AC._debug.seek(1.4);
    const p = AC.state.current();
    const parts = AC.captions.splitCue(p.captions.cues[1], 1.4);
    AC.state.mutate((pp) => { pp.captions.cues.splice(1, 1, parts[0], parts[1]); pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues); });
  });
  const afterSplit = await page.evaluate(() => ({
    n: AC.state.current().captions.cues.length,
    c1: AC.state.current().captions.cues[1],
    c2: AC.state.current().captions.cues[2],
  }));
  check('split at playhead produces two cues (snaps to word boundary)',
    afterSplit.n === 5 && afterSplit.c1.text === 'four' && Math.abs(afterSplit.c1.start - 1) < 0.001
    && afterSplit.c2.text === 'five six' && Math.abs(afterSplit.c2.start - (1 + 1 / 3)) < 0.01,
    JSON.stringify(afterSplit));

  /* merge them back */
  await page.evaluate(() => {
    const p = AC.state.current();
    const a = p.captions.cues[1], b = p.captions.cues[2];
    a.text = (a.text + ' ' + b.text).trim();
    a.end = b.end;
    AC.state.mutate((pp) => { pp.captions.cues.splice(2, 1); pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues); });
  });
  const afterMerge = await page.evaluate(() => ({ n: AC.state.current().captions.cues.length, t: AC.state.current().captions.cues[1].text }));
  check('merge with next restores one cue', afterMerge.n === 4 && afterMerge.t === 'four five six', JSON.stringify(afterMerge));

  /* VTT parse sanity */
  const vttN = await page.evaluate(() => {
    const cues = AC.captions.parseVTT('WEBVTT\n\n00:00.000 --> 00:01.500 align:start position:10%\nhello vtt world\n\n00:02.000 --> 00:03.000\nsecond cue');
    return cues.length + '|' + cues[0].start + '|' + cues[0].text + '|' + cues[1].end;
  });
  check('VTT parser handles MM:SS.mmm + cue settings', vttN === '2|0|hello vtt world|3', vttN);

  /* plain transcript distribution */
  const dist = await page.evaluate(() => {
    const cues = AC.captions.distribute('a b c d e f g h', 4, 4);
    return { n: cues.length, first: cues[0].text, last: cues[1].text, start: cues[0].start, end: cues[1].end };
  });
  check('plain transcript distributes evenly', dist.n === 2 && dist.first === 'a b c d' && dist.last === 'e f g h'
    && Math.abs(dist.end - 4) < 0.6, JSON.stringify(dist));

  check('zero errors in captions section', errors.length === 0, errors.join(' | ').slice(0, 300));
  await closePage(browser);
}
