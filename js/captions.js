/* ClipCast — captions.js : SRT/VTT parsing, transcript distribution,
   karaoke word interpolation, cue sanitizing. Times in seconds. */
AC.captions = (() => {
  'use strict';
  const U = AC.util;

  /* ── timestamp parsing ── */
  /* "HH:MM:SS,mmm" (srt) or "HH:MM:SS.mmm" / "MM:SS.mmm" (vtt) → seconds */
  function tsToSec(str) {
    const s = String(str).trim().replace(/,/g, '.');
    const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/);
    if (!m) return NaN;
    return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  }

  /* ── SRT ── */
  function parseSRT(text) {
    const blocks = String(text).replace(/^\uFEFF/, '').split(/\r?\n\r?\n/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      let timeIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) { timeIdx = i; break; }
      }
      if (timeIdx < 0) continue;
      const tm = lines[timeIdx].match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
      if (!tm) continue;
      const start = tsToSec(tm[1]);
      const end = tsToSec(tm[2]);
      const textLines = lines.slice(timeIdx + 1);
      if (!textLines.length) continue;
      cues.push({ start, end, text: textLines.join('\n') });
    }
    return sanitizeCues(cues);
  }

  /* ── VTT ── */
  function parseVTT(text) {
    let t = String(text).replace(/^\uFEFF/, '');
    t = t.replace(/^\s*WEBVTT[^\n]*\n?/, '');
    /* strip STYLE / REGION blocks */
    t = t.replace(/^(STYLE|REGION)[\s\S]*?(?=^\s*$|\n\s*\n)/gm, '');
    const blocks = t.split(/\r?\n\r?\n/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      if (lines[0] === 'NOTE' || lines[0].startsWith('NOTE ')) continue; // NOTE blocks
      let timeIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) { timeIdx = i; break; }
      }
      if (timeIdx < 0) continue;
      /* strip settings after end time: "00:01.000 --> 00:02.000 align:start position:10%" */
      const tm = lines[timeIdx].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
      if (!tm) continue;
      const start = tsToSec(tm[1]);
      const end = tsToSec(tm[2]);
      const textLines = lines.slice(timeIdx + 1);
      if (!textLines.length) continue;
      cues.push({ start, end, text: textLines.join('\n') });
    }
    return sanitizeCues(cues);
  }

  function parseAny(text, kind) {
    if (kind === 'srt' || /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text)) return parseSRT(text);
    if (kind === 'vtt' || /WEBVTT/.test(text)) return parseVTT(text);
    return parseSRT(text);
  }

  /* ── plain transcript → evenly distributed cues ── */
  function distribute(text, durSec, wordsPerLine) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    const wpl = Math.max(1, Math.min(30, Math.round(wordsPerLine || 4)));
    const cues = [];
    if (!words.length) return cues;
    const total = words.length;
    const per = durSec / Math.ceil(total / wpl);
    let start = 0;
    for (let i = 0; i < total; i += wpl) {
      const chunk = words.slice(i, i + wpl);
      const end = Math.min(durSec, start + per * chunk.length / wpl);
      cues.push({ start, end: Math.max(start + 0.3, end), text: chunk.join(' ') });
      start = cues[cues.length - 1].end;
    }
    return sanitizeCues(cues);
  }

  /* ── sanitize / normalize ── */
  function sanitizeCues(cues, durSec) {
    const out = [];
    for (const c of Array.isArray(cues) ? cues : []) {
      let s = Number(c.start);
      let e = Number(c.end);
      if (!isFinite(s) || s < 0) s = 0;
      if (!isFinite(e) || e <= s) e = s + 1.5;
      const txt = String(c.text ?? '').trim();
      if (!txt) continue;
      out.push({ start: s, end: e, text: txt });
    }
    out.sort((a, b) => a.start - b.start);
    /* enforce minimum gaps / clamp to duration */
    const res = [];
    for (const c of out) {
      if (res.length) {
        const prev = res[res.length - 1];
        if (c.start < prev.end) {
          const mid = (prev.end + c.start) / 2;
          prev.end = Math.max(prev.start + 0.2, mid);
          c.start = Math.max(c.start, mid);
        }
        c.end = Math.max(c.end, c.start + 0.3);
      }
      if (durSec && c.start >= durSec) continue;
      if (durSec) c.end = Math.min(c.end, durSec + 0.5);
      res.push(c);
    }
    return res;
  }

  /* ── karaoke: per-word interpolated timing inside a cue (even split) ── */
  function cueWords(cue) {
    const words = String(cue.text ?? '').trim().split(/\s+/).filter(Boolean);
    const dur = Math.max(0.2, (cue.end || cue.start + 1) - cue.start);
    const per = dur / words.length;
    return words.map((w, i) => ({ w, s: cue.start + i * per, e: cue.start + (i + 1) * per }));
  }

  function cueIndexAt(cues, t) {
    for (let i = cues.length - 1; i >= 0; i--) {
      if (t >= cues[i].start - 1e-6) return i;
    }
    return -1;
  }
  function wordIndexAt(cue, t) {
    if (!cue) return -1;
    const ws = cueWords(cue);
    for (let i = ws.length - 1; i >= 0; i--) {
      if (t >= ws[i].s - 1e-6) return i;
    }
    return -1;
  }

  /* split cue at offset t (returns [left, right] or null if t outside) */
  function splitCue(cue, t) {
    const ws = cueWords(cue);
    let splitIdx = -1;
    for (let i = 0; i < ws.length; i++) {
      if (t >= ws[i].s - 0.001 && t < ws[i].e) { splitIdx = i; break; }
    }
    if (splitIdx <= 0 || splitIdx >= ws.length) return null;
    const left = { start: cue.start, end: ws[splitIdx].s, text: ws.slice(0, splitIdx).map((x) => x.w).join(' ') };
    const right = { start: ws[splitIdx].s, end: cue.end, text: ws.slice(splitIdx).map((x) => x.w).join(' ') };
    return [left, right];
  }

  /* default caption style */
  function defaultStyle() {
    return {
      mode: 'karaoke',
      font: 'inter',
      size: 0.075,            /* fraction of canvas height */
      color: '#f1f5f9',
      hl: '#2dd4bf',
      dim: '#94a3b8',
      outline: 0.02,          /* fraction of canvas height */
      outlineColor: '#0b0e14',
      shadow: true,
      caps: false,
      maxWords: 4,
      position: 'bottom',     /* top | middle | bottom */
      align: 'center',        /* left | center | right */
    };
  }

  return { parseSRT, parseVTT, parseAny, distribute, sanitizeCues, cueWords, cueIndexAt, wordIndexAt, splitCue, defaultStyle, tsToSec };
})();
