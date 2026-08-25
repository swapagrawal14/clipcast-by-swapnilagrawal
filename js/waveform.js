/* ClipCast — waveform.js : peaks envelope (min/max buckets), the 6 visual
   styles (bars · filled · mirror · radial · dots · spectrum), strip renderer
   for the timeline. Pure canvas drawing — no DOM state. */
AC.waveform = (() => {
  'use strict';
  const U = AC.util;

  const BUCKETS = 1024;

  /* mono-summed min/max envelope: Float32Array [min0,max0,min1,max1,…] */
  function computePeaks(buffer, buckets = BUCKETS) {
    const n = buffer.length;
    const ch = buffer.numberOfChannels;
    const out = new Float32Array(buckets * 2);
    const per = Math.max(1, Math.floor(n / buckets));
    for (let b = 0; b < buckets; b++) {
      let mn = 1, mx = -1;
      const start = b * per;
      const end = b === buckets - 1 ? n : start + per;
      for (let i = start; i < end; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += buffer.getChannelData(c)[i];
        s /= ch;
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
      out[b * 2] = mn; out[b * 2 + 1] = mx;
    }
    return out;
  }

  /* sample peak amplitude at normalized position t01 (0..1) → 0..1 */
  function sampleEnv(peaks, t01) {
    if (!peaks) return 0;
    const nb = peaks.length / 2;
    const f = U.clamp(t01, 0, 0.9999) * nb;
    const i = Math.floor(f);
    const frac = f - i;
    const a = Math.max(Math.abs(peaks[i * 2]), Math.abs(peaks[i * 2 + 1]));
    const b = Math.max(Math.abs(peaks[Math.min(nb - 1, i + 1) * 2]), Math.abs(peaks[Math.min(nb - 1, i + 1) * 2 + 1]));
    return U.lerp(a, b, frac);
  }
  /* local energy around t01 (window = fraction of clip) → smoothed 0..1 */
  function localEnergy(peaks, t01, window01 = 0.06) {
    if (!peaks) return 0;
    const nb = peaks.length / 2;
    const half = Math.max(1, Math.round(nb * window01 * 0.5));
    const center = Math.round(U.clamp(t01, 0, 0.9999) * nb);
    let sum = 0, cnt = 0;
    for (let i = Math.max(0, center - half); i < Math.min(nb, center + half); i++) {
      sum += Math.max(Math.abs(peaks[i * 2]), Math.abs(peaks[i * 2 + 1]));
      cnt++;
    }
    return cnt ? sum / cnt : 0;
  }

  /* ────────────────────────────────────────────────────────────
     Style renderers. Signature:
       drawX(ctx, rect{x,y,w,h}, peaks, t01, st, playedT01)
     st = waveform style object (colors, bar count, gap, …)
     t01     = playhead position as fraction of clip
     Return value: the bounce energy (0..1) used by callers, or null.
     All renderers draw ONLY the waveform (no playhead line — engine draws it). */

  const STYLES = [
    { id: 'bars', label: 'Bars' },
    { id: 'filled', label: 'Filled' },
    { id: 'mirror', label: 'Mirror line' },
    { id: 'radial', label: 'Radial donut' },
    { id: 'dots', label: 'Dot matrix' },
    { id: 'spectrum', label: 'Spectrum' },
  ];

  function roundedRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ── 1. bars — classic vertical bars ── */
  function drawBars(ctx, rect, peaks, t01, st, bounce) {
    const n = Math.max(8, Math.round(st.bars || 48));
    const gap = (st.gap ?? 0.18) * (rect.w / n);
    const bw = Math.max(1, rect.w / n - gap);
    const cy = rect.y + rect.h / 2;
    const amp = (rect.h / 2) * (1 + (st.bounce ? bounce * 0.55 : 0));
    const playedX = t01 * rect.w;
    for (let i = 0; i < n; i++) {
      const x = rect.x + (i + 0.5) * (rect.w / n) - bw / 2;
      const p01 = i / n;
      const v = sampleEnv(peaks, p01);
      const hgt = Math.max(1.5, v * amp);
      const played = x < playedX;
      ctx.fillStyle = played ? st.color : st.color2;
      if (st.rounded) roundedRectPath(ctx, x, cy - hgt / 2, bw, hgt, bw * 0.5);
      else { ctx.beginPath(); ctx.rect(x, cy - hgt / 2, bw, hgt); }
      ctx.fill();
    }
  }

  /* ── 2. filled — continuous mirrored silhouette ── */
  function drawFilled(ctx, rect, peaks, t01, st, bounce) {
    const n = Math.max(16, Math.round((st.bars || 96) * 0.75));
    const cy = rect.y + rect.h / 2;
    const amp = (rect.h / 2) * (1 + (st.bounce ? bounce * 0.4 : 0));
    const step = rect.w / (n - 1);
    const playedX = t01 * rect.w;
    /* top path (played → accent up to playhead) */
    ctx.beginPath();
    ctx.moveTo(rect.x, cy);
    for (let i = 0; i < n; i++) {
      const x = rect.x + i * step;
      const v = sampleEnv(peaks, i / (n - 1));
      ctx.lineTo(x, cy - Math.max(1.5, v * amp));
    }
    ctx.lineTo(rect.x + rect.w, cy);
    ctx.closePath();
    ctx.fillStyle = st.color2;
    ctx.fill();
    /* played overlay — clip to region left of playhead */
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, Math.max(0, playedX - rect.x), rect.h);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(rect.x, cy);
    for (let i = 0; i < n; i++) {
      const x = rect.x + i * step;
      const v = sampleEnv(peaks, i / (n - 1));
      ctx.lineTo(x, cy - Math.max(1.5, v * amp));
    }
    ctx.lineTo(rect.x + rect.w, cy);
    ctx.closePath();
    ctx.fillStyle = st.color;
    ctx.fill();
    ctx.restore();
  }

  /* ── 3. mirror — audacity-style center mirror lines ── */
  function drawMirror(ctx, rect, peaks, t01, st, bounce) {
    const n = Math.max(24, Math.round(st.bars || 90));
    const cy = rect.y + rect.h / 2;
    const amp = (rect.h / 2 - 2) * (1 + (st.bounce ? bounce * 0.35 : 0));
    const playedX = t01 * rect.w;
    ctx.lineWidth = st.lineWidth || 2.5;
    for (let i = 0; i < n; i++) {
      const x = rect.x + (i + 0.5) * (rect.w / n);
      const v = sampleEnv(peaks, i / n);
      const hgt = Math.max(1.5, v * amp);
      ctx.strokeStyle = x < playedX ? st.color : st.color2;
      ctx.beginPath();
      ctx.moveTo(x, cy - hgt);
      ctx.lineTo(x, cy + hgt);
      ctx.stroke();
    }
  }

  /* ── 4. radial — donut around center of the block ── */
  function drawRadial(ctx, rect, peaks, t01, st, bounce) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const n = Math.max(24, Math.round(st.bars || 64));
    const radius = Math.min(rect.w, rect.h) / 2 - 4;
    const thickness = Math.max(2.5, radius * 0.16);
    const inner = radius - thickness;
    const startA = -Math.PI / 2;
    const span = Math.PI * 2;
    const playedA = t01 * span;
    const amp = (radius - inner) * (1 + (st.bounce ? bounce * 0.5 : 0));
    ctx.lineWidth = Math.max(2, thickness * 0.72);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = startA + (i + 0.5) / n * span;
      const v = sampleEnv(peaks, i / n);
      const len = 2 + v * amp;
      const r1 = inner - len * 0.45, r2 = inner + len * 0.55;
      ctx.strokeStyle = a - startA < playedA ? st.color : st.color2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    /* hub dot */
    ctx.fillStyle = st.color;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, thickness * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ── 5. dots — dot matrix ── */
  function drawDots(ctx, rect, peaks, t01, st, bounce) {
    const cols = Math.max(12, Math.round((st.bars || 48) * 0.8));
    const rows = Math.max(4, Math.round((st.rows || 5)));
    const pad = 3;
    const cellW = (rect.w - pad * 2) / cols;
    const cellH = (rect.h - pad * 2) / rows;
    const dotR = Math.max(1, Math.min(cellW, cellH) * 0.32);
    const playedX = t01 * rect.w;
    for (let c = 0; c < cols; c++) {
      const v = sampleEnv(peaks, c / cols);
      const lit = Math.round(v * rows);
      for (let r = 0; r < rows; r++) {
        const x = rect.x + pad + c * cellW + cellW / 2;
        const y = rect.y + pad + (rows - 1 - r) * cellH + cellH / 2;
        const on = r < lit;
        ctx.fillStyle = on
          ? (x < playedX ? st.color : st.color2)
          : st.color3 || 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.arc(x, y, on ? dotR : dotR * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ── 6. spectrum — smooth mirror spectrum + glow + sparkles ── */
  function drawSpectrum(ctx, rect, peaks, t01, st, bounce) {
    const n = Math.max(24, Math.round((st.bars || 96) * 0.66));
    const cy = rect.y + rect.h / 2;
    const amp = (rect.h / 2 - 3) * (1 + (st.bounce ? bounce * 0.45 : 0));
    const step = rect.w / n;
    const playedX = t01 * rect.w;
    /* smoothed column heights */
    const hs = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const raw = sampleEnv(peaks, i / n);
      hs[i] = U.lerp(prev, raw, 0.55);
      prev = raw;
    }
    ctx.save();
    ctx.shadowBlur = Math.max(4, step * 1.6);
    ctx.shadowColor = st.glow || st.color;
    for (let i = 0; i < n; i++) {
      const x = rect.x + i * step;
      const hgt = Math.max(1.5, hs[i] * amp);
      const played = x < playedX;
      ctx.fillStyle = played ? st.color : st.color2;
      roundedRectPath(ctx, x + 0.5, cy - hgt / 2, Math.max(1, step - 1), hgt, step * 0.35);
      ctx.fill();
    }
    ctx.restore();
    /* deterministic sparkle particles (seeded per bucket + time step) */
    if (st.sparkles) {
      const tick = Math.floor(t01 * 24);
      const rnd = U.mulberry32(0xC1A5 + tick * 97);
      for (let i = 0; i < 14; i++) {
        const px = rect.x + rnd() * rect.w;
        const py = rect.y + rnd() * rect.h;
        const r = 0.8 + rnd() * 1.6;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + rnd() * 0.4) + ')';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const DRAW = { bars: drawBars, filled: drawFilled, mirror: drawMirror, radial: drawRadial, dots: drawDots, spectrum: drawSpectrum };

  function drawStyle(ctx, rect, peaks, t01, st, bounce) {
    const fn = DRAW[st.style] || drawBars;
    fn(ctx, rect, peaks, t01, st, bounce);
  }

  /* ── timeline strip renderer ── */
  function drawStrip(ctx, w, h, peaks, opts) {
    /* opts: {trimStart, trimEnd, audioDur, playhead (source secs), accent, dim, dragging} */
    ctx.clearRect(0, 0, w, h);
    const padX = 10;
    const innerW = w - padX * 2;
    const mapT = (t) => padX + (t / Math.max(0.001, opts.audioDur)) * innerW;
    /* faint full waveform */
    const n = Math.max(60, Math.round(innerW / 3));
    const cy = h / 2;
    for (let i = 0; i < n; i++) {
      const v = sampleEnv(peaks, i / n);
      const x = padX + (i + 0.5) * (innerW / n);
      const hgt = Math.max(1.5, v * (h - 26));
      ctx.fillStyle = 'rgba(140,150,170,0.28)';
      roundedRectPath(ctx, x - 1, cy - hgt / 2, 2, hgt, 1);
      ctx.fill();
    }
    /* trim window (played region) */
    const x0 = mapT(opts.trimStart), x1 = mapT(opts.trimEnd);
    ctx.fillStyle = 'rgba(45,212,191,0.16)';
    ctx.fillRect(x0, 6, Math.max(0, x1 - x0), h - 12);
    /* region boundary lines + handles */
    for (const [tx, col] of [[x0, '#2dd4bf'], [x1, '#fb7185']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, 4); ctx.lineTo(tx, h - 4);
      ctx.stroke();
      ctx.fillStyle = col;
      roundedRectPath(ctx, tx - 5, (h - 20) / 2, 10, 20, 4);
      ctx.fill();
    }
    /* playhead */
    const ph = mapT(opts.playhead);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ph, 4); ctx.lineTo(ph, h - 4); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(ph - 4, 4); ctx.lineTo(ph + 4, 4); ctx.lineTo(ph, 10); ctx.closePath(); ctx.fill();
    /* time labels */
    ctx.fillStyle = 'rgba(150,160,180,0.8)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(U.fmtTime(opts.trimStart), x0 + 4, 8);
    ctx.fillText(U.fmtTime(opts.trimEnd), x1 - 40, 8);
  }

  return { BUCKETS, computePeaks, sampleEnv, localEnergy, drawStyle, drawStrip, STYLES, DRAW };
})();
