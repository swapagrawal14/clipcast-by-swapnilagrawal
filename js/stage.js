/* ClipCast — stage.js : preview canvas, playback (HTMLAudioElement voice +
   BGM with drift-corrected clock), scrubbing, block drag with snap guides,
   safe-area / grid overlays, block selection. */
AC.stage = (() => {
  'use strict';
  const U = AC.util;

  let canvas = null, ctx = null;
  let fit = 1, dpr = 1;
  let playing = false;
  let editTime = 0;              /* seconds, relative to trim start */
  let rafId = 0;
  let lastNow = 0;
  let expectedAt = 0;            /* perf.now() when editTime was set */
  let _rafRunning = false;

  const voiceEl = new Audio();
  voiceEl.preload = 'auto';
  const bgmEl = new Audio();
  bgmEl.preload = 'auto';

  let voiceURL = null, bgmURL = null;
  let _drag = null;              /* {block, mode:'move'|'resize'?, offX, offY, guides} */
  let _scrub = false;
  let selectedId = null;

  /* duck curve cache for preview (bgm volume per 50 ms) */
  let duckCache = null, duckFor = null;

  const listeners = new Set();
  function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(ev, data) { for (const fn of listeners) { try { fn(ev, data); } catch (e) { console.error(e); } } }

  /* ── sizing ── */
  function resize() {
    const p = AC.state.current();
    if (!p) return;
    const wrap = document.getElementById('center');
    const availW = wrap.clientWidth - 8;
    const availH = wrap.clientHeight - 8;
    fit = Math.min(availW / p.canvasW, availH / p.canvasH, 1);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(2, Math.round(p.canvasW * fit * dpr));
    const ch = Math.max(2, Math.round(p.canvasH * fit * dpr));
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = cw / dpr + 'px';
    canvas.style.height = ch / dpr + 'px';
    draw();
  }

  /* ── pointer → canvas coords ── */
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * AC.state.current().canvasW,
      y: ((e.clientY - r.top) / r.height) * AC.state.current().canvasH,
    };
  }

  /* ── draw one frame ── */
  function draw() {
    const p = AC.state.current();
    if (!p || !ctx) return;
    ctx.setTransform(dpr * fit, 0, 0, dpr * fit, 0, 0);
    AC.engine.render(p, editTime, ctx, {
      showPlayhead: true,
      meter: true,
    });
    drawOverlays(p);
    emit('frame');
  }

  function drawOverlays(p) {
    const W = p.canvasW, H = p.canvasH;
    ctx.setTransform(dpr * fit, 0, 0, dpr * fit, 0, 0);
    if (p.play.showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(W * i / 3, 0); ctx.lineTo(W * i / 3, H);
        ctx.moveTo(0, H * i / 3); ctx.lineTo(W, H * i / 3);
      }
      ctx.stroke();
    }
    if (p.play.showSafe) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
      ctx.setLineDash([]);
    }
    /* selected block outline */
    const sel = p.blocks.find((b) => b.id === selectedId);
    if (sel) {
      const r = AC.engine.getRect(p, sel);
      ctx.strokeStyle = 'rgba(45,212,191,0.9)';
      ctx.lineWidth = 2 / dpr;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      /* corner handles */
      ctx.fillStyle = '#2dd4bf';
      for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
        ctx.fillRect(hx - 3, hy - 3, 6, 6);
      }
    }
    /* snap guides */
    if (_drag && _drag.guides) {
      ctx.strokeStyle = 'rgba(251,113,133,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const g of _drag.guides) {
        if (g.vert) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, H); }
        else { ctx.moveTo(0, g.y); ctx.lineTo(W, g.y); }
      }
      ctx.stroke();
    }
  }

  /* ═══════════ playback ═══════════ */
  function trimDur(p) { return Math.max(0, (p.trim.end || 0) - (p.trim.start || 0)); }
  function getTime() { return editTime; }
  function setTime(t, { keepPlaying } = {}) {
    const p = AC.state.current();
    if (!p) return;
    const dur = trimDur(p);
    editTime = U.clamp(t, 0, dur);
    if (!playing || keepPlaying) repositionAudio();
    expectedAt = performance.now();
    AC.engine.resetBounce();
    emit('seek');
    updateInfo();
  }

  async function ensureAudioURLs() {
    const p = AC.state.current();
    if (!p) return;
    if (p.audio && p.audio.assetId) {
      if (!voiceURL || voiceEl.dataset.aid !== p.audio.assetId) {
        const url = await AC.assets.blobURL(p.audio.assetId);
        if (url) { voiceEl.src = url; voiceEl.dataset.aid = p.audio.assetId; voiceURL = url; }
      }
    } else { voiceEl.removeAttribute('src'); voiceURL = null; }
    if (p.bgm && p.bgm.assetId) {
      if (!bgmURL || bgmEl.dataset.aid !== p.bgm.assetId) {
        const url = await AC.assets.blobURL(p.bgm.assetId);
        if (url) { bgmEl.src = url; bgmEl.dataset.aid = p.bgm.assetId; bgmURL = url; }
      }
    } else { bgmEl.removeAttribute('src'); bgmURL = null; }
  }

  function duckAt(p, t) {
    /* energy-gated duck curve: -duckDb dB under voice, smoothed */
    if (!p.bgm || !p.bgm.duck || !p.audio || !p.audio.assetId) return 1;
    const peaks = AC.assets.peaksSync(p.audio.assetId);
    if (!peaks) return 1;
    if (!duckCache || duckFor !== p.audio.assetId + p.trim.start + p.trim.end) {
      const step = 0.05;
      const dur = trimDur(p);
      const n = Math.max(1, Math.ceil(dur / step));
      const db = p.bgm.duckDb || 8;
      const gain = Math.pow(10, -db / 20);
      const arr = new Float32Array(n);
      const thr = 0.06;
      let level = 0;
      for (let i = 0; i < n; i++) {
        const t01 = U.clamp((i * step) / dur, 0, 0.999);
        const srcT = p.trim.start + t01 * (p.trim.end - p.trim.start);
        const env = AC.waveform.sampleEnv(peaks, srcT / Math.max(0.001, p.audio.duration));
        const target = env > thr ? gain : 1;
        const k = target < level ? 0.3 : 0.08; /* fast attack, slow release */
        level = U.lerp(level, target, k);
        arr[i] = level;
      }
      duckCache = arr; duckFor = p.audio.assetId + p.trim.start + p.trim.end;
    }
    const i = Math.min(duckCache.length - 1, Math.floor(t / 0.05));
    return duckCache[Math.max(0, i)];
  }

  function repositionAudio() {
    const p = AC.state.current();
    if (!p) return;
    const t = editTime;
    if (voiceEl.src && p.audio && p.audio.assetId) {
      try { voiceEl.currentTime = p.trim.start + t; } catch (e) {}
    }
    if (bgmEl.src && p.bgm && p.bgm.assetId) {
      try {
        const bdur = Math.max(0.001, p.bgm.duration || 1);
        bgmEl.currentTime = (p.trim.start + t) % bdur;
      } catch (e) {}
    }
  }

  async function play() {
    const p = AC.state.current();
    if (!p) return;
    if (playing) return;
    const dur = trimDur(p);
    if (!dur) { U.toast('Nothing to play — load audio and set a trim', 'bad'); return; }
    if (editTime >= dur) { editTime = 0; }
    await ensureAudioURLs();
    await AC.assets.resumeAC(); /* user gesture context */
    /* volumes */
    const norm = AC.state.normGain(p);
    voiceEl.volume = U.clamp((p.audio ? p.audio.volume : 1) * norm, 0, 1);
    bgmEl.volume = U.clamp((p.bgm ? p.bgm.volume : 0.5), 0, 1) * duckAt(p, editTime);
    repositionAudio();
    try {
      if (voiceEl.src) { voiceEl.play(); }
      if (bgmEl.src) { bgmEl.loop = !!(p.bgm && p.bgm.loop); bgmEl.play(); }
    } catch (e) { console.warn('play failed', e); }
    playing = true;
    lastNow = performance.now();
    expectedAt = lastNow;
    if (!_rafRunning) startRaf();
    syncPlayOverlay();
    emit('playchange', true);
    updateInfo();
  }

  function pause() {
    playing = false;
    try { voiceEl.pause(); } catch (e) {}
    try { bgmEl.pause(); } catch (e) {}
    syncPlayOverlay();
    emit('playchange', false);
    updateInfo();
  }

  function syncPlayOverlay() {
    const p = AC.state.current();
    const ov = document.getElementById('playOverlay');
    if (!ov) return;
    const hasAudio = !!(p && p.audio && p.audio.assetId && trimDur(p) > 0.2);
    ov.classList.toggle('hidden', playing || !hasAudio);
    ov.setAttribute('aria-label', playing ? 'Pause preview (Space)' : 'Play preview (Space)');
  }

  function togglePlay() { playing ? pause() : play(); }

  function startRaf() {
    _rafRunning = true;
    const loop = (now) => {
      if (!_rafRunning) return;
      rafId = requestAnimationFrame(loop);
      if (playing) {
        const p = AC.state.current();
        const dur = trimDur(p);
        /* drift correction: trust <audio> when it drifts > 0.15 s */
        if (voiceEl.src && !voiceEl.paused && isFinite(voiceEl.currentTime)) {
          const expected = p.trim.start + editTime;
          const actual = voiceEl.currentTime;
          if (Math.abs(actual - expected) > 0.15) {
            editTime = U.clamp(actual - p.trim.start, 0, dur);
            expectedAt = now;
          }
        } else {
          const dt = (now - expectedAt) / 1000;
          editTime = U.clamp(editTime + dt, 0, dur);
          expectedAt = now;
        }
        /* live duck on bgm */
        if (bgmEl.src && p.bgm && p.bgm.duck) {
          const target = (p.bgm.volume || 0.5) * duckAt(p, editTime);
          if (Math.abs(bgmEl.volume - target) > 0.01) bgmEl.volume = U.lerp(bgmEl.volume, target, 0.25);
        }
        if (editTime >= dur) {
          editTime = dur;
          if (p.play.loopPreview) { editTime = 0; repositionAudio(); }
          else { pause(); }
        }
      }
      draw();
      updateInfo();
    };
    rafId = requestAnimationFrame(loop);
  }

  function updateInfo() {
    const p = AC.state.current();
    if (!p) return;
    const el1 = document.getElementById('infoTime');
    const el2 = document.getElementById('infoDur');
    const el3 = document.getElementById('infoAudio');
    if (el1) el1.textContent = U.fmtTime(editTime);
    if (el2) el2.textContent = U.fmtTime(trimDur(p));
    if (el3) el3.textContent = p.audio && p.audio.name ? p.audio.name : '—';
  }

  /* ═══════════ selection & dragging ═══════════ */
  function hitTest(x, y) {
    const p = AC.state.current();
    const blocks = p.blocks.filter((b) => b.visible !== false);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const r = AC.engine.getRect(p, blocks[i]);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return blocks[i];
    }
    return null;
  }

  function select(id) {
    selectedId = id;
    emit('select', id);
    draw();
  }
  function selected() { return selectedId; }
  function setSelected(id) { select(id); }

  const SNAP_PTS = [0, 0.5, 1];
  const MARGIN = 0.04;
  function snapBlock(p, b, px, py) {
    /* returns snapped center (fractions) + guides */
    const guides = [];
    let cx = px, cy = py;
    const candX = [];
    for (const s of SNAP_PTS) candX.push(s * p.canvasW);
    for (const o of p.blocks) {
      if (o.id === b.id) continue;
      candX.push(o.x * p.canvasW, o.x * p.canvasW + o.w * p.canvasW / 2, o.x * p.canvasW - o.w * p.canvasW / 2);
    }
    const candY = [];
    for (const s of SNAP_PTS) candY.push(s * p.canvasH);
    for (const o of p.blocks) {
      if (o.id === b.id) continue;
      candY.push(o.y * p.canvasH, o.y * p.canvasH + o.h * p.canvasH / 2, o.y * p.canvasH - o.h * p.canvasH / 2);
    }
    const T = 10;
    let bestX = null, bestXD = T;
    for (const c of candX) {
      const d = Math.abs(px - c);
      if (d < bestXD) { bestXD = d; bestX = c; }
    }
    if (bestX != null && bestXD <= T) { cx = bestX; guides.push({ vert: true, x: bestX }); }
    let bestY = null, bestYD = T;
    for (const c of candY) {
      const d = Math.abs(py - c);
      if (d < bestYD) { bestYD = d; bestY = c; }
    }
    if (bestY != null && bestYD <= T) { cy = bestY; guides.push({ vert: false, y: bestY }); }
    /* clamp to margins (keep inside canvas with margin) */
    cx = U.clamp(cx, b.w / 2 + MARGIN * p.canvasW, p.canvasW - b.w / 2 - MARGIN * p.canvasW);
    cy = U.clamp(cy, b.h / 2 + MARGIN * p.canvasH, p.canvasH - b.h / 2 - MARGIN * p.canvasH);
    return { x: cx / p.canvasW, y: cy / p.canvasH, guides };
  }

  function onPointerDown(e) {
    const p = AC.state.current();
    if (!p) return;
    if (e.target !== canvas) return;
    const pt = toCanvas(e);
    const blk = hitTest(pt.x, pt.y);
    if (blk) {
      select(blk.id);
      _drag = { block: blk, mode: 'move', offX: pt.x - blk.x * p.canvasW, offY: pt.y - blk.y * p.canvasH, guides: [] };
      canvas.setPointerCapture(e.pointerId);
      pause();
      e.preventDefault();
    } else {
      /* scrub on empty area */
      select(null);
      _scrub = true;
      canvas.setPointerCapture(e.pointerId);
      pause();
      setTime((pt.x / p.canvasW) * trimDur(p));
    }
  }
  function onPointerMove(e) {
    const p = AC.state.current();
    if (!p) return;
    const pt = toCanvas(e);
    if (_drag) {
      const nx = pt.x - _drag.offX;
      const ny = pt.y - _drag.offY;
      const snapped = snapBlock(p, _drag.block, nx, ny);
      _drag.guides = snapped.guides;
      AC.state.mutate((pp) => {
        const b = pp.blocks.find((x) => x.id === _drag.block.id);
        if (b) { b.x = snapped.x; b.y = snapped.y; }
      });
      draw();
    } else if (_scrub) {
      setTime(U.clamp((pt.x / p.canvasW) * trimDur(p), 0, trimDur(p)));
    }
  }
  function onPointerUp(e) {
    if (_drag) { _drag = null; draw(); }
    _scrub = false;
  }

  /* ── keyboard-ish API ── */
  function seekBy(dt) { setTime(editTime + dt); }
  function seekToPlayheadFrac(f) { setTime(f * trimDur(AC.state.current())); }

  /* ── init ── */
  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', () => resize());
    document.getElementById('playOverlay').addEventListener('click', () => togglePlay());
    AC.state.onChange(() => {
      resize();
      syncPlayOverlay();
      updateInfo();
    });
    resize();
  }

  function pauseAllAudio() { pause(); }

  return {
    init, resize, draw, play, pause, togglePlay, pauseAllAudio,
    getTime, setTime, seekBy, trimDur,
    selected, setSelected, hitTest,
    onEvent, ensureAudioURLs, repositionAudio,
    get playing() { return playing; },
    get voice() { return voiceEl; },
    get bgm() { return bgmEl; },
  };
})();
