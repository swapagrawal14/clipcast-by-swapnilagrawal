/* ClipCast — engine.js : the pure canvas renderer.
   render(project, tSeconds, ctx[, opts]) draws ONE frame of the audiogram
   in project canvas coordinates. tSeconds is EDIT-time (0 … trim duration).
   No DOM, no side effects (bounce smoothing uses module state, reset via
   resetBounce() on seeks). Deterministic → identical in preview and export. */
AC.engine = (() => {
  'use strict';
  const U = AC.util;
  const WAV = () => AC.waveform;

  /* ── bounce smoothing (energy near playhead) ── */
  let bounceVal = 0, lastT = -1;
  function resetBounce() { bounceVal = 0; lastT = -1; }

  /* ── background definitions ── */
  const BG_DEFS = [
    { id: 'solid', label: 'Solid', css: 'linear-gradient(135deg,#0f172a,#0f172a)' },
    { id: 'grad1', label: 'Slate Teal', css: 'linear-gradient(135deg,#0f172a,#134e4a)' },
    { id: 'grad2', label: 'Coral Dusk', css: 'linear-gradient(135deg,#2d1b2e,#7f1d1d)' },
    { id: 'grad3', label: 'Deep Ocean', css: 'linear-gradient(160deg,#020617,#1e3a8a)' },
    { id: 'grad4', label: 'Forest', css: 'linear-gradient(135deg,#052e16,#065f46)' },
    { id: 'paper', label: 'Paper', css: 'linear-gradient(#f1ead8,#efe6cf)' },
    { id: 'grid', label: 'Grid', css: 'linear-gradient(#0b0e14,#0b0e14)' },
    { id: 'dots', label: 'Dots', css: 'linear-gradient(#0b0e14,#0b0e14)' },
    { id: 'chalk', label: 'Chalk', css: 'linear-gradient(#101418,#0c0f13)' },
    { id: 'neon', label: 'Neon Dark', css: 'radial-gradient(circle at 50% 40%,#111827,#05060a 70%)' },
    { id: 'sunset', label: 'Sunset', css: 'linear-gradient(180deg,#1e1b4b,#7c2d12 55%,#fb923c)' },
    { id: 'aurora', label: 'Aurora', css: 'linear-gradient(#050a12,#050a12)' },
    { id: 'custom', label: 'Custom', css: 'linear-gradient(135deg,#334155,#0f172a)' },
    { id: 'image', label: 'Image', css: 'linear-gradient(#111827,#111827)' },
  ];
  const bgById = (id) => BG_DEFS.find((b) => b.id === id) || BG_DEFS[0];

  /* noise pattern (tiled) */
  let _noise = null;
  function noisePat() {
    if (_noise) return _noise;
    const c = U.makeCanvas(128, 128);
    const x = c.getContext('2d');
    const img = x.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    _noise = c;
    return _noise;
  }
  function tileNoise(ctx, W, H, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ctx.createPattern(noisePat(), 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawBackground(ctx, p, t) {
    const bg = p.bg || {};
    const W = p.canvasW, H = p.canvasH;
    const type = bg.type || 'aurora';
    /* curated gradient presets carry their own colors */
    const PRESET_COLORS = {
      grad1: ['#0f172a', '#134e4a'], grad2: ['#2d1b2e', '#7f1d1d'],
      grad3: ['#020617', '#1e3a8a'], grad4: ['#052e16', '#065f46'],
    };
    let c1 = bg.c1 || '#0f172a', c2 = bg.c2 || '#134e4a';
    if (PRESET_COLORS[type]) { c1 = PRESET_COLORS[type][0]; c2 = PRESET_COLORS[type][1]; }
    if (type === 'solid') { c1 = bg.c1 || '#0f172a'; c2 = c1; }
    const angle = (bg.angle ?? 135) * Math.PI / 180;
    const lin = () => {
      const g = ctx.createLinearGradient(
        W / 2 - Math.cos(angle) * W * 0.75, H / 2 - Math.sin(angle) * H * 0.75,
        W / 2 + Math.cos(angle) * W * 0.75, H / 2 + Math.sin(angle) * H * 0.75);
      g.addColorStop(0, c1); g.addColorStop(1, c2);
      return g;
    };
    switch (type) {
      case 'solid':
        ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H); break;
      case 'grad1': case 'grad2': case 'grad3': case 'grad4': case 'custom':
        ctx.fillStyle = lin(); ctx.fillRect(0, 0, W, H); break;
      case 'paper': {
        ctx.fillStyle = c1 || '#f1ead8'; ctx.fillRect(0, 0, W, H);
        tileNoise(ctx, W, H, 0.05);
        ctx.fillStyle = 'rgba(120,100,60,0.10)';
        for (let i = 0; i < 5; i++) {
          const y = H * (0.15 + i * 0.18);
          ctx.fillRect(0, y, W, 1.2);
        }
        break;
      }
      case 'grid': {
        ctx.fillStyle = c1 || '#0b0e14'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.055)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 8; i++) { const x = W * i / 8; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let i = 1; i < 8; i++) { const y = H * i / 8; ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
        break;
      }
      case 'dots': {
        ctx.fillStyle = c1 || '#0b0e14'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        const step = Math.max(14, W / 16);
        for (let y = step / 2; y < H; y += step)
          for (let x = step / 2; x < W; x += step) {
            ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
          }
        break;
      }
      case 'chalk': {
        ctx.fillStyle = c1 || '#101418'; ctx.fillRect(0, 0, W, H);
        tileNoise(ctx, W, H, 0.09);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(-W * 0.1, H * (0.1 + i * 0.16));
          ctx.lineTo(W * 1.1, H * (0.06 + i * 0.16));
          ctx.stroke();
        }
        break;
      }
      case 'neon': {
        ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
        const blobs = [
          [0.3, 0.32, 0.55, 'rgba(45,212,191,0.17)'],
          [0.78, 0.68, 0.5, 'rgba(192,132,252,0.14)'],
          [0.62, 0.18, 0.4, 'rgba(251,113,133,0.10)'],
        ];
        for (const [fx, fy, fr, col] of blobs) {
          const g = ctx.createRadialGradient(W * fx, H * fy, 0, W * fx, H * fy, W * fr);
          g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      case 'sunset': {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#1e1b4b'); g.addColorStop(0.45, '#7c2d12'); g.addColorStop(0.75, '#fb923c'); g.addColorStop(1, '#fdba74');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const cx = W * 0.5, cy = H * 0.66, r = W * 0.13;
        ctx.save();
        ctx.shadowColor = 'rgba(253,186,116,0.9)'; ctx.shadowBlur = W * 0.05;
        ctx.fillStyle = '#fdba74';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        tileNoise(ctx, W, H, 0.04);
        break;
      }
      case 'aurora': {
        ctx.fillStyle = '#050a12'; ctx.fillRect(0, 0, W, H);
        const blobs = [
          [0.22, 0.28, 0.62, 'rgba(45,212,191,0.20)'],
          [0.82, 0.62, 0.55, 'rgba(129,140,248,0.17)'],
          [0.55, 0.92, 0.5, 'rgba(251,113,133,0.10)'],
        ];
        for (const [fx, fy, fr, col] of blobs) {
          const g = ctx.createRadialGradient(W * fx, H * fy, 0, W * fx, H * fy, W * fr);
          g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      case 'image': {
        const img = AC.assets.imageSync(bg.assetId);
        if (img) {
          const iw = img.width, ih = img.height;
          const s = Math.max(W / iw, H / ih);
          const dw = iw * s, dh = ih * s;
          ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } else {
          ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      default:
        ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
    }
  }

  /* ── block geometry: x/y = CENTER fractions, w/h = size fractions ── */
  function getRect(p, b) {
    return {
      x: b.x * p.canvasW, y: b.y * p.canvasH,
      w: b.w * p.canvasW, h: b.h * p.canvasH,
    };
  }

  /* ── block defaults ── */
  function defaultBlock(type) {
    const b = {
      id: U.uid('blk'), type, visible: true,
      x: 0.5, y: 0.5, w: 0.8, h: 0.18,
    };
    switch (type) {
      case 'cover':
        Object.assign(b, { assetId: null, rounded: 0.05, shadow: true, kenburns: true, grayscale: false, x: 0.5, y: 0.5, w: 0.34, h: 0.34 });
        break;
      case 'title':
        Object.assign(b, { text: 'Podcast Name', font: 'montserrat', size: 0.075, color: '#f8fafc', bold: true, caps: false, align: 'center', outline: 0, outlineColor: '#0b0e14', shadow: true, x: 0.5, y: 0.14, w: 0.84, h: 0.1 });
        break;
      case 'subtitle':
        Object.assign(b, { text: '@yourhandle', font: 'inter', size: 0.038, color: '#cbd5e1', bold: true, caps: false, align: 'center', outline: 0, outlineColor: '#0b0e14', shadow: true, x: 0.5, y: 0.235, w: 0.6, h: 0.05 });
        break;
      case 'progress':
        Object.assign(b, { color: '#2dd4bf', track: 'rgba(255,255,255,0.14)', height: 0.008, rounded: true, glow: true, x: 0.5, y: 0.88, w: 0.72, h: 0.02 });
        break;
      case 'timer':
        Object.assign(b, { font: 'inter', size: 0.03, color: '#f8fafc', format: 'elapsed', chip: true, x: 0.5, y: 0.94, w: 0.3, h: 0.04 });
        break;
      case 'watermark':
        Object.assign(b, { text: 'Made with ClipCast', font: 'inter', size: 0.022, color: '#f8fafc', bold: false, align: 'center', opacity: 0.5, x: 0.5, y: 0.985, w: 0.4, h: 0.03 });
        break;
      case 'waveform':
        Object.assign(b, { x: 0.5, y: 0.62, w: 0.86, h: 0.16 });
        break;
    }
    return b;
  }

  /* ── sliced peaks for the trimmed window (cached) ── */
  const _sliceCache = new Map();
  function slicedPeaks(p) {
    const a = p.audio;
    if (!a || !a.assetId) return null;
    const full = AC.assets.peaksSync(a.assetId);
    if (!full) return null;
    const dur = a.duration || 1;
    const key = a.assetId + '|' + p.trim.start.toFixed(3) + '|' + p.trim.end.toFixed(3);
    if (_sliceCache.has(key)) return _sliceCache.get(key);
    const nb = full.length / 2;
    const off = (p.trim.start / dur) * nb;
    const span = Math.max(0.0001, ((p.trim.end - p.trim.start) / dur) * nb);
    const out = new Float32Array(nb * 2);
    for (let i = 0; i < nb; i++) {
      const f = off + span * (i / nb);
      const j = Math.min(nb - 1, Math.floor(f));
      const k = Math.min(nb - 1, j + 1);
      const fr = f - Math.floor(f);
      out[i * 2] = U.lerp(full[j * 2], full[k * 2], fr);
      out[i * 2 + 1] = U.lerp(full[j * 2 + 1], full[k * 2 + 1], fr);
    }
    if (_sliceCache.size > 12) _sliceCache.clear();
    _sliceCache.set(key, out);
    return out;
  }

  /* ── text helpers ── */
  function wrapText(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = w; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  const fontCss = (fontId, weight, px) => `${weight} ${Math.round(px)}px ${AC.assets.fontById(fontId).css}`;

  /* ── text block ── */
  function drawTextBlock(ctx, p, b, t) {
    const rect = getRect(p, b);
    const H = p.canvasH;
    let px = Math.max(6, b.size * H);
    const text = U.safeText(b.caps ? b.text : b.text, b.font);
    if (!text.trim()) return;
    const fontW = () => fontCss(b.font, b.bold ? 800 : 400, px);
    ctx.font = fontW();
    ctx.textBaseline = 'middle';
    const maxW = Math.max(40, rect.w - px * 0.12);
    let lines = wrapText(ctx, text, maxW);
    /* fit-to-width safeguard: scale down unbreakable lines (single long word) */
    {
      let fitW = 0;
      for (const l of lines) fitW = Math.max(fitW, ctx.measureText(l).width);
      if (fitW > maxW && fitW > 0) {
        px = Math.max(6, px * (maxW / fitW));
        ctx.font = fontW();
        lines = wrapText(ctx, text, maxW);
      }
    }
    const lh = px * 1.24;
    const totalH = lines.length * lh;
    let y0 = rect.y + rect.h / 2 - totalH / 2 + lh / 2;
    const x0 = b.align === 'left' ? rect.x : b.align === 'right' ? rect.x + rect.w : rect.x + rect.w / 2;
    ctx.textAlign = b.align === 'left' ? 'left' : b.align === 'right' ? 'right' : 'center';
    for (const line of lines) {
      if (b.outline > 0) {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = b.outlineColor || '#0b0e14';
        ctx.lineWidth = Math.max(1, b.outline * H);
        ctx.strokeText(line, x0, y0);
      }
      if (b.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = px * 0.14;
        ctx.shadowOffsetY = px * 0.06;
      }
      ctx.fillStyle = b.color || '#f8fafc';
      ctx.fillText(line, x0, y0);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      y0 += lh;
    }
  }

  /* ── cover block ── */
  function drawCover(ctx, p, b, t) {
    const rect = getRect(p, b);
    const img = b.assetId ? AC.assets.imageSync(b.assetId) : null;
    const r = Math.max(0, Math.min(0.5, b.rounded || 0)) * Math.min(rect.w, rect.h);
    const trimDur = Math.max(0.001, p.trim.end - p.trim.start);
    const kb = b.kenburns ? 1 + 0.08 * (U.clamp(t / trimDur, 0, 1)) : 1;
    const kbX = b.kenburns ? Math.sin(t / trimDur * Math.PI * 0.6) * 0.02 : 0;

    ctx.save();
    if (b.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = rect.w * 0.05;
      ctx.shadowOffsetY = rect.w * 0.025;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, r);
    ctx.clip();
    if (img) {
      const iw = img.width, ih = img.height;
      const s = Math.max(rect.w / iw, rect.h / ih) * kb;
      const dw = iw * s, dh = ih * s;
      const dx = rect.x + rect.w / 2 - dw / 2 + kbX * rect.w;
      const dy = rect.y + rect.h / 2 - dh / 2;
      if (b.grayscale) {
        ctx.filter = 'grayscale(1)';
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.filter = 'none';
      } else {
        ctx.drawImage(img, dx, dy, dw, dh);
      }
    } else {
      /* vector placeholder icon — no emoji (missing from embedded fonts → tofu) */
      const icW = rect.w * 0.22, icH = rect.h * 0.16;
      const icX = rect.x + rect.w / 2 - icW / 2;
      const icY = rect.y + rect.h / 2 - icH / 2 - rect.h * 0.06;
      ctx.strokeStyle = 'rgba(148,163,184,0.6)';
      ctx.fillStyle = 'rgba(148,163,184,0.6)';
      ctx.lineWidth = Math.max(1.5, rect.w * 0.012);
      roundRect(ctx, icX, icY, icW, icH, icW * 0.14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(icX + icW * 0.3, icY + icH * 0.34, icW * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(icX + icW * 0.08, icY + icH * 0.86);
      ctx.lineTo(icX + icW * 0.38, icY + icH * 0.44);
      ctx.lineTo(icX + icW * 0.6, icY + icH * 0.68);
      ctx.lineTo(icX + icW * 0.78, icY + icH * 0.5);
      ctx.lineTo(icX + icW * 0.92, icY + icH * 0.86);
      ctx.closePath();
      ctx.stroke();
      ctx.font = `600 ${Math.round(rect.w * 0.045)}px Inter, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('upload cover', rect.x + rect.w / 2, rect.y + rect.h / 2 + rect.h * 0.18);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ── progress bar ── */
  function drawProgress(ctx, p, b, t) {
    const rect = getRect(p, b);
    const trimDur = Math.max(0.001, p.trim.end - p.trim.start);
    const frac = U.clamp(t / trimDur, 0, 1);
    const hgt = Math.max(2, b.height * p.canvasH);
    const r = b.rounded ? hgt / 2 : 0;
    ctx.fillStyle = b.track || 'rgba(255,255,255,0.14)';
    roundRect(ctx, rect.x, rect.y - hgt / 2, rect.w, hgt, r);
    ctx.fill();
    if (frac > 0.003) {
      ctx.save();
      if (b.glow) { ctx.shadowColor = b.color || '#2dd4bf'; ctx.shadowBlur = hgt * 2.2; }
      ctx.fillStyle = b.color || '#2dd4bf';
      roundRect(ctx, rect.x, rect.y - hgt / 2, Math.max(hgt, rect.w * frac), hgt, r);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ── timer chip ── */
  function drawTimer(ctx, p, b, t) {
    const rect = getRect(p, b);
    const trimDur = Math.max(0.001, p.trim.end - p.trim.start);
    const px = Math.max(9, b.size * p.canvasH);
    const elapsed = U.clamp(t, 0, trimDur);
    const text = b.format === 'remaining'
      ? '-' + U.fmtTimeFull(trimDur - elapsed)
      : U.fmtTimeFull(elapsed) + ' / ' + U.fmtTimeFull(trimDur);
    ctx.font = fontCss(b.font, 700, px);
    const tw = ctx.measureText(text).width;
    const chipW = tw + px * 1.4, chipH = px * 1.8;
    ctx.save();
    if (b.chip) {
      ctx.fillStyle = 'rgba(8,11,17,0.62)';
      roundRect(ctx, rect.x + rect.w / 2 - chipW / 2, rect.y - chipH / 2, chipW, chipH, chipH / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      roundRect(ctx, rect.x + rect.w / 2 - chipW / 2, rect.y - chipH / 2, chipW, chipH, chipH / 2);
      ctx.stroke();
    }
    ctx.fillStyle = b.color || '#f8fafc';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, rect.x + rect.w / 2, rect.y + px * 0.06);
    ctx.restore();
  }

  /* ── watermark ── */
  function drawWatermark(ctx, p, b, t) {
    const rect = getRect(p, b);
    const px = Math.max(8, b.size * p.canvasH);
    const text = U.safeText(b.text || '', b.font);
    if (!text.trim()) return;
    ctx.font = fontCss(b.font, b.bold ? 700 : 400, px);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = b.color || '#f8fafc';
    ctx.globalAlpha = b.opacity ?? 0.5;
    ctx.fillText(text, rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.globalAlpha = 1;
  }

  /* ── waveform block ── */
  function drawWaveformBlock(ctx, p, b, t, opts) {
    const st = p.wf;
    const rect = getRect(p, b);
    const trimDur = Math.max(0.001, p.trim.end - p.trim.start);
    const t01 = U.clamp(t / trimDur, 0, 1);
    const peaks = slicedPeaks(p);
    if (!peaks) {
      /* no audio loaded: draw placeholder */
      ctx.fillStyle = 'rgba(148,163,184,0.18)';
      ctx.font = '600 14px Inter, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('load audio to see the waveform', rect.x + rect.w / 2, rect.y + rect.h / 2);
      return;
    }
    /* energy bounce smoothing */
    let bounce = 0;
    if (st.bounce) {
      const target = WAV().localEnergy(peaks, t01, 0.06);
      if (Math.abs(t - lastT) < 0.2) bounceVal = U.lerp(bounceVal, target, 0.22);
      else bounceVal = target;
      bounce = bounceVal;
    } else bounceVal = 0;
    lastT = t;

    WAV().drawStyle(ctx, rect, peaks, t01, st, bounce);

    /* playhead */
    if (opts.showPlayhead !== false) {
      const x = rect.x + t01 * rect.w;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, rect.y + 2); ctx.lineTo(x, rect.y + rect.h - 2); ctx.stroke();
      ctx.fillStyle = st.color || '#2dd4bf';
      ctx.shadowColor = st.color || '#2dd4bf';
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, rect.y + rect.h - 5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    /* level meter */
    if (opts.meter && st.meter) {
      const segs = 10;
      const mw = 6, mh = rect.h * 0.8;
      const mx = rect.x + rect.w - 14, my = rect.y + rect.h - mh - 4;
      const level = WAV().localEnergy(peaks, t01, 0.05);
      for (let i = 0; i < segs; i++) {
        const frac = (i + 1) / segs;
        ctx.fillStyle = level >= frac - 0.12 ? U.mix('#2dd4bf', '#fb7185', i / segs) : 'rgba(255,255,255,0.12)';
        ctx.fillRect(mx, my + mh - (i + 1) * (mh / segs) + 1, mw, mh / segs - 1.5);
      }
    }
  }

  /* ── captions ── */
  const CAP_Y = { top: 0.13, middle: 0.46, bottom: 0.74 };

  function drawCaptions(ctx, p, t, opts) {
    const cs = p.captions.style;
    const cues = p.captions.cues;
    if (!cs || cs.mode === 'none' || !cues.length) return;
    const W = p.canvasW, H = p.canvasH;
    const idx = AC.captions.cueIndexAt(cues, t);
    if (idx < 0) return;
    const cue = cues[idx];
    const yBase = H * (CAP_Y[cs.position] ?? 0.74);
    const maxW = W * 0.86;

    const withOutline = (fn) => {
      ctx.save();
      if (cs.outline > 0) {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = cs.outlineColor || '#0b0e14';
        ctx.lineWidth = Math.max(1.5, cs.outline * H);
      }
      if (cs.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = Math.max(2, cs.size * H * 0.18);
        ctx.shadowOffsetY = Math.max(1, cs.size * H * 0.06);
      }
      fn();
      ctx.restore();
    };

    if (cs.mode === 'phrase') {
      let px = Math.max(12, cs.size * H);
      const text = U.safeText(cs.caps ? cue.text.toUpperCase() : cue.text, cs.font);
      if (!text.trim()) return;
      ctx.font = fontCss(cs.font, 800, px);
      ctx.textBaseline = 'middle';
      let lines = wrapText(ctx, text, maxW);
      /* fit-to-width (covers unbreakable single words) */
      {
        let longest = 0;
        for (const l of lines) longest = Math.max(longest, ctx.measureText(l).width);
        if (longest > maxW && longest > 0) {
          px = Math.max(12, px * (maxW / longest));
          ctx.font = fontCss(cs.font, 800, px);
          lines = wrapText(ctx, text, maxW);
        }
      }
      const lh = px * 1.3;
      const totalH = lines.length * lh;
      let y0 = yBase - totalH / 2 + lh / 2;
      /* fade in/out 0.18 s */
      let alpha = 1;
      const fi = U.clamp((t - cue.start) / 0.18, 0, 1);
      const fo = U.clamp((cue.end - t) / 0.18, 0, 1);
      alpha = Math.min(fi, fo);
      ctx.globalAlpha = Math.max(0.05, alpha);
      ctx.textAlign = 'center';
      withOutline(() => {
        ctx.fillStyle = cs.color;
        for (const line of lines) { ctx.fillText(line, W / 2, y0); y0 += lh; }
      });
      ctx.globalAlpha = 1;
      return;
    }

    if (cs.mode === 'bigword') {
      const ws = AC.captions.cueWords(cue);
      const wi = AC.captions.wordIndexAt(cue, t);
      if (wi < 0) return;
      const maxN = Math.max(1, Math.min(3, cs.maxWords || 3));
      const group = ws.slice(wi, wi + maxN);
      let px = Math.max(16, cs.size * H * 1.75);
      /* fit-to-width for long words */
      {
        ctx.font = fontCss(cs.font, 900, px);
        const wMax = W * 0.9;
        let longest = 0;
        for (const wd of group) longest = Math.max(longest, ctx.measureText(U.safeText(cs.caps ? wd.w.toUpperCase() : wd.w, cs.font)).width);
        if (longest > wMax && longest > 0) px = Math.max(16, px * (wMax / longest));
      }
      const lh = px * 1.22;
      const totalH = group.length * lh;
      let y = yBase - totalH / 2 + lh / 2;
      for (let g = 0; g < group.length; g++) {
        const word = group[g];
        const txt = U.safeText(cs.caps ? word.w.toUpperCase() : word.w, cs.font);
        ctx.font = fontCss(cs.font, 900, px);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        let scale = 1;
        const isCur = g === 0;
        if (isCur) {
          const local = U.clamp((t - word.s) / Math.max(0.001, word.e - word.s), 0, 1);
          scale = 1 + 0.16 * (1 - U.easeOutBack(Math.min(1, local / 0.22)));
        }
        withOutline(() => {
          ctx.fillStyle = isCur ? cs.hl : (cs.color);
          ctx.save();
          ctx.translate(W / 2, y);
          ctx.scale(scale, scale);
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        });
        y += lh;
      }
      return;
    }

    /* karaoke (default) */
    let px = Math.max(12, cs.size * H);
    const ws = AC.captions.cueWords(cue);
    const wi = AC.captions.wordIndexAt(cue, t);
    const maxWords = Math.max(1, cs.maxWords || 4);
    const lines = [];
    for (let i = 0; i < ws.length; i += maxWords) lines.push(ws.slice(i, i + maxWords));
    /* fit-to-width: scale down so the longest line never exceeds the safe frame */
    {
      ctx.font = fontCss(cs.font, 800, px);
      const sp0 = ctx.measureText(' ').width;
      let longest = 0;
      for (const line of lines) {
        let w = 0;
        for (const wd of line) w += ctx.measureText(U.safeText(cs.caps ? wd.w.toUpperCase() : wd.w, cs.font)).width;
        w += sp0 * (line.length - 1);
        if (w > longest) longest = w;
      }
      if (longest > maxW && longest > 0) px = Math.max(12, px * (maxW / longest));
    }
    const lh = px * 1.28;
    const totalH = lines.length * lh;
    let y = yBase - totalH / 2 + lh / 2;
    ctx.textBaseline = 'middle';
    let gIdx = 0;
    for (const line of lines) {
      ctx.font = fontCss(cs.font, 800, px);
      const widths = line.map((wd) => ctx.measureText(U.safeText(cs.caps ? wd.w.toUpperCase() : wd.w, cs.font)).width);
      const spaceW = ctx.measureText(' ').width;
      const lineW = widths.reduce((a, b) => a + b, 0) + spaceW * (line.length - 1);
      let x = cs.align === 'left' ? W / 2 - maxW / 2 : cs.align === 'right' ? W / 2 + maxW / 2 - lineW : W / 2 - lineW / 2;
      for (let i = 0; i < line.length; i++) {
        const word = line[i];
        const txt = U.safeText(cs.caps ? word.w.toUpperCase() : word.w, cs.font);
        const isCur = gIdx === wi;
        const isPast = gIdx < wi;
        withOutline(() => {
          ctx.fillStyle = isCur ? cs.hl : (isPast ? cs.dim : cs.color);
          ctx.textAlign = 'left';
          ctx.fillText(txt, x, y);
        });
        x += widths[i] + spaceW;
        gIdx++;
      }
      y += lh;
    }
  }

  /* ── main render ── */
  function render(p, t, ctx, opts = {}) {
    ctx.save();
    ctx.clearRect(0, 0, p.canvasW, p.canvasH);
    drawBackground(ctx, p, t);
    const blocks = (p.blocks || []).filter((b) => b.visible !== false);
    for (const b of blocks) {
      ctx.save();
      switch (b.type) {
        case 'waveform': drawWaveformBlock(ctx, p, b, t, opts); break;
        case 'cover': drawCover(ctx, p, b, t); break;
        case 'title': case 'subtitle': drawTextBlock(ctx, p, b, t); break;
        case 'progress': drawProgress(ctx, p, b, t); break;
        case 'timer': drawTimer(ctx, p, b, t); break;
        case 'watermark': drawWatermark(ctx, p, b, t); break;
      }
      ctx.restore();
    }
    if (opts.captions !== false) drawCaptions(ctx, p, t, opts);
    ctx.restore();
  }

  /* waveform-only thumbnail (for the thumbnail PNG export) */
  function renderWaveformOnly(p, t, ctx, opts = {}) {
    ctx.save();
    ctx.clearRect(0, 0, p.canvasW, p.canvasH);
    drawBackground(ctx, p, t);
    const b = (p.blocks || []).find((x) => x.type === 'waveform');
    if (b) drawWaveformBlock(ctx, p, b, t, { showPlayhead: true });
    ctx.restore();
  }

  /* small deterministic preview used by style chips */
  function drawStylePreview(canvas, styleId, st) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#10141d';
    ctx.fillRect(0, 0, w, h);
    const peaks = new Float32Array(AC.waveform.BUCKETS * 2);
    for (let i = 0; i < AC.waveform.BUCKETS; i++) {
      const v = Math.sin(i * 0.12) * 0.55 + Math.sin(i * 0.033) * 0.45;
      peaks[i * 2] = -v; peaks[i * 2 + 1] = v;
    }
    const rect = { x: 4, y: 4, w: w - 8, h: h - 8 };
    const st2 = Object.assign({}, st, { bounce: false });
    WAV().drawStyle(ctx, rect, peaks, 0.42, st2, 0);
  }

  return {
    render, renderWaveformOnly, drawStylePreview, resetBounce,
    getRect, defaultBlock, slicedPeaks, BG_DEFS, bgById,
  };
})();
