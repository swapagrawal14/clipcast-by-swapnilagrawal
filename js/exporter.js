/* ClipCast — exporter.js : video export (WebM/MP4) with deterministic
   frame stepping (canvas.captureStream(0) + requestFrame), sample-accurate
   WebAudio scheduling (voice + ducked BGM), WebM EBML Duration patch,
   GIF89a/LZW encoder, PNG snapshot + waveform-only thumbnail.

   Times are SECONDS. Export scope = trimmed region (edit-time 0…trimDur). */
AC.exporter = (() => {
  'use strict';
  const U = AC.util;

  const BPS = { low: 2_500_000, medium: 6_000_000, high: 12_000_000 };
  let running = null;         /* export session or null */
  let lastExport = null;      /* {blob, mime, name, info} for tests/UI */

  /* ── mime detection (fallback chain per spec) ── */
  function detectMimes() {
    const candidates = [
      { fmt: 'mp4', mime: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: 'mp4' },
      { fmt: 'mp4', mime: 'video/mp4', ext: 'mp4' },
      { fmt: 'webm', mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { fmt: 'webm', mime: 'video/webm;codecs=vp8', ext: 'webm' },
      { fmt: 'webm', mime: 'video/webm', ext: 'webm' },
    ];
    const ok = [];
    for (const c of candidates) {
      try { if (MediaRecorder.isTypeSupported(c.mime)) ok.push(c); } catch (e) {}
    }
    return ok;
  }

  function outDims(p, scale) {
    let w = Math.round(p.canvasW * scale), h = Math.round(p.canvasH * scale);
    w = Math.min(w, 4096); h = Math.min(h, 4096);
    return { w: w - (w % 2), h: h - (h % 2) };
  }

  /* ═══════════ UI wiring ═══════════ */
  function init() {
    const mimes = detectMimes();
    const fmtSel = document.getElementById('expFmt');
    fmtSel.innerHTML = '';
    fmtSel.appendChild(U.el('option', { value: 'webm', selected: 'selected' }, 'WebM (VP9) — universal'));
    if (mimes.some((m) => m.fmt === 'mp4')) fmtSel.appendChild(U.el('option', { value: 'mp4' }, 'MP4 (H.264)'));
    fmtSel.appendChild(U.el('option', { value: 'gif' }, 'GIF loop (muted, 12 fps)'));
    fmtSel.appendChild(U.el('option', { value: 'png' }, 'PNG frame snapshot'));
    fmtSel.appendChild(U.el('option', { value: 'thumb' }, 'PNG thumbnail (waveform only)'));
    if (!mimes.some((m) => m.fmt === 'mp4')) U.toast('MP4 not supported in this browser — WebM available', 'info', 5000);

    document.getElementById('btnExport').addEventListener('click', openDialog);
    document.getElementById('expCancel').addEventListener('click', closeDialog);
    document.getElementById('expAgain').addEventListener('click', () => show('setup'));
    document.getElementById('expStart').addEventListener('click', startFromUI);
    document.getElementById('expCancelRun').addEventListener('click', () => { if (running) running.cancelled = true; });
    document.getElementById('expDownload').addEventListener('click', () => {
      if (lastExport) U.downloadBlob(lastExport.blob, lastExport.name);
    });
    ['expFmt', 'expFps', 'expQuality', 'expScale'].forEach((id) => document.getElementById(id).addEventListener('change', syncSetup));
    document.getElementById('expAudio').addEventListener('change', syncSetup);
  }

  function openDialog() {
    const p = AC.state.current();
    if (!p.audio || !p.audio.assetId) { U.toast('Load an audio clip first', 'bad'); return; }
    const dur = AC.timeline.trimDuration(p);
    if (dur < 0.3) { U.toast('Your trim is shorter than 0.3 s — extend it first', 'bad'); return; }
    document.getElementById('exportModal').classList.remove('hidden');
    show('setup');
    syncSetup();
  }
  function closeDialog() {
    if (running && running !== 'cancel') running.cancelled = true;
    document.getElementById('exportModal').classList.add('hidden');
  }
  function show(which) {
    document.getElementById('expSetup').classList.toggle('hidden', which !== 'setup');
    document.getElementById('expProgress').classList.toggle('hidden', which !== 'progress');
    document.getElementById('expDone').classList.toggle('hidden', which !== 'done');
  }

  function syncSetup() {
    const p = AC.state.current();
    if (!p) return;
    const fmt = document.getElementById('expFmt').value;
    const scale = +document.getElementById('expScale').value;
    const fps = +document.getElementById('expFps').value;
    const dur = AC.timeline.trimDuration(p);
    const { w, h } = outDims(p, scale);
    document.getElementById('expDur').textContent = dur.toFixed(2) + ' s';
    document.getElementById('expDims').textContent = w + '×' + h;
    const q = document.getElementById('expQuality').value;
    let est = '';
    if (fmt === 'gif') est = `~${Math.max(1, Math.round(dur * 12))} frames @ 12 fps, ≈ ${(dur * w * h * 0.09 / 1048576).toFixed(1)} MB, muted`;
    else if (fmt === 'png') est = `One PNG frame at the playhead (${w}×${h})`;
    else if (fmt === 'thumb') est = `Waveform-only thumbnail PNG at the playhead (${w}×${h})`;
    else est = `${dur.toFixed(2)} s → ≈ ${(BPS[q] * dur / 8 / 1048576).toFixed(1)} MB · ${w}×${h} @ ${fps} fps`;
    document.getElementById('expEstimate').textContent = 'Estimate: ' + est;
  }

  async function startFromUI() {
    const p = AC.state.current();
    const opts = {
      format: document.getElementById('expFmt').value,
      fps: +document.getElementById('expFps').value,
      quality: document.getElementById('expQuality').value,
      scale: +document.getElementById('expScale').value,
      audio: document.getElementById('expAudio').checked,
      autoDownload: false, /* UI flow: show done screen → user clicks Download */
    };
    try {
      await start(opts);
    } catch (e) {
      console.error(e);
      U.toast('Export failed: ' + (e.message || e), 'bad');
      show('setup');
      running = null;
    }
  }

  /* ═══════════ the export pipeline ═══════════ */
  async function start(opts) {
    if (running) return;
    const p = AC.state.current();
    AC.stage.pause();
    AC.engine.resetBounce();
    if (opts.format === 'png') { const r = await snapshotPNG(); closeDialog(); return r && r.b64 ? r : null; }
    if (opts.format === 'thumb') { const r = await thumbnailPNG(); closeDialog(); return r && r.b64 ? r : null; }
    if (opts.format === 'gif') return exportGIF(opts);
    return exportVideo(opts);
  }

  /* ── video (WebM / MP4) ── */
  async function exportVideo(opts) {
    const p = AC.state.current();
    const fps = opts.fps || 30;
    const scale = opts.scale || 1;
    const { w, h } = outDims(p, scale);
    const dur = AC.timeline.trimDuration(p);
    const total = Math.max(1, Math.round(dur * fps));
    const mimes = detectMimes();
    const mime = opts.format === 'mp4'
      ? (mimes.find((m) => m.fmt === 'mp4') || {}).mime || 'video/mp4'
      : (mimes.find((m) => m.fmt === 'webm') || { mime: 'video/webm' }).mime;
    const isWebm = mime.includes('webm');
    const bps = BPS[opts.quality || 'medium'] * (scale >= 1.5 ? 1.6 : 1);

    const canvas = U.makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false });
    const stream = canvas.captureStream(0);
    const vtrack = stream.getVideoTracks()[0];
    const canReq = !!(vtrack && vtrack.requestFrame);

    /* audio graph: decode once, schedule on the AudioContext clock */
    let audio = null;
    if (opts.audio !== false && p.audio && p.audio.assetId) {
      try { audio = await buildAudioGraph(p, dur); }
      catch (e) { console.warn('[export] audio graph failed', e); audio = null; }
    }
    let recStream = stream;
    if (audio && audio.dest.stream.getAudioTracks().length) {
      recStream = new MediaStream([vtrack, ...audio.dest.stream.getAudioTracks()]);
    }
    const rec = new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });

    /* countdown 3-2-1 */
    show('progress');
    document.getElementById('expStatus').textContent = 'Preparing…';
    const countEl = document.getElementById('expCount');
    countEl.classList.remove('hidden');
    for (let i = 3; i >= 1; i--) {
      countEl.textContent = String(i);
      await U.sleep(650);
      if (running === 'cancel') throw new Error('cancelled');
    }
    countEl.classList.add('hidden');

    const session = { cancelled: false };
    running = session;
    document.getElementById('expStatus').textContent = 'Recording…';
    /* schedule every source on the AudioContext clock, THEN start the
       recorder exactly at the audio start moment → file-time 0 == audio 0 */
    if (audio && audio.startClips) {
      try { audio.startClips(0.35); }
      catch (e) { console.warn('[export] scheduling failed', e); }
    }
    const waitStart = performance.now();
    await new Promise((res) => {
      const iv = setInterval(() => {
        const acOk = !audio || !audio.schedWhen || audio.ac.currentTime >= audio.schedWhen - 0.01;
        if (acOk || performance.now() - waitStart > 1500) { clearInterval(iv); res(); }
      }, 10);
    });
    let t0 = performance.now();
    rec.start(250);
    const frameInterval = 1000 / fps;
    let nextSlot = performance.now();
    let frames = 0;

    await new Promise((resolve, reject) => {
      const step = () => {
        if (session.cancelled) { resolve(); return; }
        if (frames >= total) { resolve(); return; }
        const t = U.clamp((performance.now() - t0) / 1000, 0, dur);
        try {
          ctx.setTransform(w / p.canvasW, 0, 0, h / p.canvasH, 0, 0);
          ctx.clearRect(0, 0, w, h);
          AC.engine.render(p, t, ctx, { showPlayhead: true, meter: true, export: true });
        } catch (e) { reject(e); return; }
        if (canReq) vtrack.requestFrame();
        frames++;
        const elapsed = performance.now() - t0;
        const pct = frames / total;
        document.getElementById('expBar').style.width = (pct * 100).toFixed(1) + '%';
        const eta = elapsed / Math.max(0.01, pct) - elapsed;
        document.getElementById('expStatus').textContent = `Frame ${frames}/${total}`;
        document.getElementById('expEta').textContent = `${U.fmtTime(frames / fps)} of ${U.fmtTime(dur)} · ~${Math.max(1, Math.ceil(eta / 1000))}s left`;
        nextSlot += frameInterval;
        setTimeout(step, Math.max(0, nextSlot - performance.now()));
      };
      step();
    });

    rec.stop();
    await stopped;
    if (audio) stopAudioGraph(audio);
    running = null;
    if (session.cancelled) { show('setup'); U.toast('Export cancelled', 'bad'); return; }

    let blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (isWebm) {
      try { blob = await patchWebMDuration(blob, frames / fps); }
      catch (e) { console.warn('[export] EBML duration patch skipped:', e); }
    }
    return finalize({
      blob, name: fileName(p, isWebm ? 'webm' : 'mp4', w, h, fps),
      info: `${U.fmtTime(frames / fps)}s · ${w}×${h} @ ${fps}fps · ${U.fmtBytes(blob.size)}`,
    }, opts);
  }

  /* ── WebAudio graph: voice + BGM with ducking, sample-accurate ── */
  async function buildAudioGraph(p, durSec) {
    /* own context per export — never reuse/close the shared decode context */
    const ACx = new (window.AudioContext || window.webkitAudioContext)();
    if (ACx.state === 'suspended') await ACx.resume();
    const dest = ACx.createMediaStreamDestination();
    const nodes = { ac: ACx, dest, srcs: [] };

    if (p.audio && p.audio.assetId) {
      const buf = await AC.assets.decodeBuffer(p.audio.assetId);
      const g = ACx.createGain();
      g.gain.value = U.clamp((p.audio.volume ?? 1) * AC.state.normGain(p), 0, 1);
      nodes.voice = { buf, gain: g };
      g.connect(dest);
    }
    if (p.bgm && p.bgm.assetId) {
      const buf = await AC.assets.decodeBuffer(p.bgm.assetId);
      const g = ACx.createGain();
      const base = U.clamp(p.bgm.volume ?? 0.5, 0, 1);
      nodes.bgm = { buf, gain: g, base };
      g.connect(dest);
    }
    nodes.startClips = (lead) => {
      const now = ACx.currentTime;
      const when = now + lead;
      nodes.schedWhen = when;
      if (nodes.voice) {
        const src = ACx.createBufferSource();
        src.buffer = nodes.voice.buf;
        const off = U.clamp(p.trim.start, 0, Math.max(0, nodes.voice.buf.duration - 0.02));
        const playDur = Math.min(durSec + 0.05, nodes.voice.buf.duration - off);
        src.connect(nodes.voice.gain);
        src.start(when, off, Math.max(0.01, playDur));
        nodes.srcs.push(src);
      }
      if (nodes.bgm) {
        const src = ACx.createBufferSource();
        src.buffer = nodes.bgm.buf;
        src.loop = !!(p.bgm && p.bgm.loop);
        const bdur = nodes.bgm.buf.duration;
        const startOff = (p.trim.start + 0) % Math.max(0.001, bdur);
        src.connect(nodes.bgm.gain);
        src.start(when, startOff, durSec + 0.05);
        nodes.srcs.push(src);
        /* duck curve: energy-gated, -duckDb dB under voice */
        const step = 0.05;
        const n = Math.max(2, Math.ceil(durSec / step));
        const curve = new Float32Array(n);
        const db = (p.bgm && p.bgm.duckDb) || 8;
        const duckGain = Math.pow(10, -db / 20);
        const ducking = !!(p.bgm && p.bgm.duck && p.audio && p.audio.assetId && AC.assets.peaksSync(p.audio.assetId));
        if (ducking) {
          const peaks = AC.assets.peaksSync(p.audio.assetId);
          const adur = Math.max(0.001, p.audio.duration || 1);
          let level = 1;
          for (let i = 0; i < n; i++) {
            const t = (i * step) / durSec;
            const srcT = p.trim.start + t * (p.trim.end - p.trim.start);
            const env = AC.waveform.sampleEnv(peaks, srcT / adur);
            const target = env > 0.06 ? duckGain : 1;
            const k = target < level ? 0.3 : 0.07;
            level = U.lerp(level, target, k);
            curve[i] = nodes.bgm.base * level;
          }
        } else {
          for (let i = 0; i < n; i++) curve[i] = nodes.bgm.base;
        }
        try {
          nodes.bgm.gain.gain.setValueAtTime(curve[0], when);
          nodes.bgm.gain.gain.setValueCurveAtTime(curve, when + 0.001, Math.max(0.002, durSec - 0.001));
        } catch (e) { console.warn('[export] duck curve failed', e); }
      }
    };
    return nodes;
  }

  function stopAudioGraph(nodes) {
    if (!nodes) return;
    try { for (const s of nodes.srcs) { try { s.stop(); } catch (e) {} } } catch (e) {}
    try { nodes.ac.close(); } catch (e) {}
  }

  /* ═══════════ EBML Duration patch ═══════════
     MediaRecorder WebM streams have no Duration element in Segment Info
     (and often an unknown Segment size) → players report unknown duration.
     We write the exact duration (frames/fps) as a float64 into Info,
     inserting the element when missing and fixing ancestor sizes. */
  async function patchWebMDuration(blob, durationSec) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const readVint = (o, keepMarker) => {
      if (o >= buf.length) return null;
      const first = buf[o];
      let len = 1;
      while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
      if (len > 8 || o + len > buf.length) return null;
      let val = keepMarker ? first : (first & (0xFF >> len));
      for (let i = 1; i < len; i++) val = val * 256 + buf[o + i];
      return { len, val };
    };
    const isUnknown = (sz) => sz.val === Math.pow(2, 7 * sz.len) - 1;
    const ID = { Segment: 0x18538067, Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489, Cluster: 0x1F43B675, Tracks: 0x1654AE6B };

    let el = readVint(0, true);
    if (!el || el.val !== 0x1A45DFA3) return blob;          /* not EBML */
    const ebmlSize = readVint(el.len);
    if (!ebmlSize) return blob;
    let pos = el.len + ebmlSize.len + ebmlSize.val;
    el = readVint(pos, true);
    if (!el || el.val !== ID.Segment) return blob;
    const segSizeOff = pos + el.len;
    const segSize = readVint(segSizeOff);
    if (!segSize) return blob;
    pos = segSizeOff + segSize.len;
    const segUnknown = isUnknown(segSize);
    const segEnd = segUnknown ? buf.length : pos + segSize.val;

    /* find Info (stop at first Cluster) */
    let infoOff = -1, infoSize = null, infoSizeOff = 0;
    while (pos + 4 < segEnd && pos + 4 < buf.length) {
      const id = readVint(pos, true);
      if (!id) break;
      const sz = readVint(pos + id.len);
      if (!sz) break;
      if (id.val === ID.Info) { infoOff = pos + id.len + sz.len; infoSize = sz; infoSizeOff = pos + id.len; break; }
      if (id.val === ID.Cluster) break;
      if (isUnknown(sz)) break;
      pos = pos + id.len + sz.len + sz.val;
    }
    if (infoOff < 0) return blob;
    const infoUnknown = isUnknown(infoSize);
    const infoEnd = infoUnknown ? Math.min(segEnd, buf.length) : infoOff + infoSize.val;

    /* read TimecodeScale, locate existing Duration */
    let scale = 1000000, durOff = -1, durLen = 0, tailOff = -1;
    let p2 = infoOff;
    while (p2 + 3 < infoEnd) {
      const id = readVint(p2, true);
      if (!id) break;
      const sz = readVint(p2 + id.len);
      if (!sz) break;
      const dataOff = p2 + id.len + sz.len;
      if (dataOff + sz.val > buf.length) break;
      if (id.val === ID.TimecodeScale && sz.val <= 8) {
        let v = 0;
        for (let i = 0; i < sz.val; i++) v = v * 256 + buf[dataOff + i];
        if (v > 0) scale = v;
      }
      if (id.val === ID.Duration) { durOff = dataOff; durLen = sz.val; }
      tailOff = dataOff + sz.val;
      p2 = tailOff;
      if (durOff >= 0) break;
    }
    const durVal = durationSec * 1e9 / scale;

    /* overwrite existing 8- or 4-byte Duration */
    if (durOff >= 0 && (durLen === 8 || durLen === 4)) {
      const out = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      if (durLen === 8) out.setFloat64(durOff, durVal, false);
      else out.setFloat32(durOff, durVal, false);
      return new Blob([buf], { type: blob.type });
    }

    /* insert a new Duration element: id(0x44 0x89) size(0x88) + float64 */
    if (tailOff < 0 || tailOff > infoEnd) return blob;
    if (infoUnknown) return blob;
    const addLen = 11;
    const newInfoSize = infoSize.val + addLen;
    if (newInfoSize >= Math.pow(2, 7 * infoSize.len) - 1) return blob;
    const merged = new Uint8Array(buf.length + addLen);
    merged.set(buf.subarray(0, tailOff), 0);
    merged[tailOff] = 0x44; merged[tailOff + 1] = 0x89; merged[tailOff + 2] = 0x88;
    new DataView(merged.buffer).setFloat64(tailOff + 3, durVal, false);
    merged.set(buf.subarray(tailOff), tailOff + addLen);
    /* rewrite Info size (same VINT length) */
    let tmp = newInfoSize;
    for (let i = infoSize.len - 1; i >= 0; i--) { merged[infoSizeOff + i] = tmp & 0xFF; tmp >>= 8; }
    merged[infoSizeOff] |= (0x80 >> (infoSize.len - 1));
    /* rewrite Segment size if known */
    if (!segUnknown && newInfoSize < Math.pow(2, 7 * segSize.len) - 1) {
      const newSegSize = segSize.val + addLen;
      let t2 = newSegSize;
      for (let i = segSize.len - 1; i >= 0; i--) { merged[segSizeOff + i] = t2 & 0xFF; t2 >>= 8; }
      merged[segSizeOff] |= (0x80 >> (segSize.len - 1));
    }
    return new Blob([merged], { type: blob.type });
  }

  /* ═══════════ GIF (GIF89a + LZW + Floyd–Steinberg) ═══════════ */
  async function exportGIF(opts) {
    const p = AC.state.current();
    const fps = 12;
    const scale = opts.scale || 1;
    let { w, h } = outDims(p, scale);
    const maxW = 640;
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    w -= w % 2; h -= h % 2;
    const dur = AC.timeline.trimDuration(p);
    const total = Math.max(2, Math.round(dur * fps));
    const session = { cancelled: false };
    running = session;
    show('progress');
    document.getElementById('expStatus').textContent = 'Encoding GIF…';

    const canvas = U.makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const enc = new GifEncoder(w, h, true);
    enc.writeHeader();
    enc.setRepeat(0);
    const t0 = performance.now();
    for (let f = 0; f < total; f++) {
      if (session.cancelled) break;
      const t = U.clamp(f / fps, 0, dur);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(w / p.canvasW, 0, 0, h / p.canvasH, 0, 0);
      AC.engine.render(p, t, ctx, { showPlayhead: true, meter: true, export: true });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      enc.addFrame(ctx.getImageData(0, 0, w, h).data, Math.round(100 / fps), f === 0);
      if (f % 4 === 0) {
        const pct = f / total;
        document.getElementById('expBar').style.width = (pct * 100).toFixed(1) + '%';
        const elapsed = performance.now() - t0;
        const eta = elapsed / Math.max(0.01, pct) - elapsed;
        document.getElementById('expStatus').textContent = `GIF frame ${f}/${total}`;
        document.getElementById('expEta').textContent = `~${Math.max(1, Math.ceil(eta / 1000))}s left`;
        await U.sleep(0);
      }
    }
    const bytes = enc.finish();
    running = null;
    if (session.cancelled) { show('setup'); U.toast('Export cancelled', 'bad'); return; }
    return finalize({
      blob: new Blob([bytes], { type: 'image/gif' }),
      name: fileName(p, 'gif', w, h, fps),
      info: `${total} frames · ${w}×${h} @ ${fps}fps · ${U.fmtBytes(bytes.length)}`,
    }, opts);
  }

  /* GIF89a encoder: global 6×6×6 web palette + error diffusion + LZW */
  function GifEncoder(w, h, dither) {
    const out = [];
    const push = (...bytes) => { for (const b of bytes) out.push(b & 255); };
    const short = (v) => push(v & 255, (v >> 8) & 255);
    const palette = [];
    for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) palette.push(r * 51, g * 51, b * 51);
    while (palette.length < 256 * 3) palette.push(0);
    const palIndex = (r, g, b) => Math.min(5, Math.round(r / 51)) * 36 + Math.min(5, Math.round(g / 51)) * 6 + Math.min(5, Math.round(b / 51));

    function quantize(px) {
      const idx = new Uint8Array(w * h);
      if (!dither) {
        for (let i = 0; i < w * h; i++) idx[i] = palIndex(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
        return idx;
      }
      const buf = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { buf[i * 3] = px[i * 4]; buf[i * 3 + 1] = px[i * 4 + 1]; buf[i * 3 + 2] = px[i * 4 + 2]; }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 3;
          const r = buf[i], g = buf[i + 1], b = buf[i + 2];
          const pi = palIndex(r, g, b);
          idx[y * w + x] = pi;
          const nr = (pi / 36 | 0) * 51, ng = ((pi % 36) / 6 | 0) * 51, nb = (pi % 6) * 51;
          const er = r - nr, eg = g - ng, eb = b - nb;
          const spread = (xx, yy, f) => {
            if (xx < 0 || xx >= w || yy >= h) return;
            const j = (yy * w + xx) * 3;
            buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
          };
          spread(x + 1, y, 7 / 16); spread(x - 1, y + 1, 3 / 16); spread(x, y + 1, 5 / 16); spread(x + 1, y + 1, 1 / 16);
        }
      }
      return idx;
    }

    function lzw(indices, minCodeSize) {
      const bytes = [];
      let cur = 0, curBits = 0;
      const emit = (code, size) => {
        cur |= code << curBits; curBits += size;
        while (curBits >= 8) { bytes.push(cur & 255); cur >>= 8; curBits -= 8; }
      };
      const CLEAR = 1 << minCodeSize, EOI = CLEAR + 1;
      let dict, next, codeSize;
      const reset = () => { dict = new Map(); next = EOI + 1; codeSize = minCodeSize + 1; };
      reset();
      emit(CLEAR, codeSize);
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = (prefix << 8) | k;
        if (dict.has(key)) { prefix = dict.get(key); continue; }
        emit(prefix, codeSize);
        dict.set(key, next++);
        if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
        if (next >= 4095) { emit(CLEAR, codeSize); reset(); }
        prefix = k;
      }
      emit(prefix, codeSize);
      emit(EOI, codeSize);
      if (curBits > 0) bytes.push(cur & 255);
      return bytes;
    }

    return {
      writeHeader() {
        for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
        short(w); short(h);
        push(0xF7, 0, 0);
        push(...palette);
      },
      setRepeat(loop) {
        push(0x21, 0xFF, 11);
        for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0));
        push(3, 1); short(loop); push(0);
      },
      addFrame(rgba, delayCs) {
        push(0x21, 0xF9, 4, 1); short(delayCs); push(0, 0);
        push(0x2C); short(0); short(0); short(w); short(h); push(0);
        push(8);
        const data = lzw(quantize(rgba), 8);
        for (let i = 0; i < data.length; i += 255) {
          const chunk = data.slice(i, i + 255);
          push(chunk.length, ...chunk);
        }
        push(0);
      },
      finish() { push(0x3B); return new Uint8Array(out); },
    };
  }

  /* ═══════════ PNG snapshot + thumbnail ═══════════ */
  async function snapshotPNG(t) {
    const p = AC.state.current();
    const c = U.makeCanvas(p.canvasW, p.canvasH);
    const ctx = c.getContext('2d');
    AC.engine.render(p, t != null ? t : AC.stage.getTime(), ctx, { showPlayhead: true, meter: true });
    const blob = await canvasToBlob(c);
    const exp = { blob, name: fileName(p, 'png', p.canvasW, p.canvasH, 0), info: `PNG ${p.canvasW}×${p.canvasH}` };
    if (t == null) return finalize(exp, { autoDownload: true, returnB64: true });
    return exp;
  }

  async function thumbnailPNG(t) {
    const p = AC.state.current();
    const c = U.makeCanvas(p.canvasW, p.canvasH);
    const ctx = c.getContext('2d');
    AC.engine.renderWaveformOnly(p, t != null ? t : AC.stage.getTime(), ctx, {});
    const blob = await canvasToBlob(c);
    return finalize({ blob, name: fileName(p, 'thumb', p.canvasW, p.canvasH, 0), info: `waveform-only PNG ${p.canvasW}×${p.canvasH}` }, { autoDownload: true, returnB64: true });
  }

  function canvasToBlob(c) {
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('canvas blob failed'))), 'image/png'));
  }

  /* ═══════════ helpers ═══════════ */
  function blobToB64(blob) {
    return blob.arrayBuffer().then((ab) => {
      const bytes = new Uint8Array(ab);
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(bin);
    });
  }
  /* programmatic completion: download + return blob info (+ optional base64) */
  async function finalize(exp, opts) {
    lastExport = exp;
    if (opts.autoDownload) U.downloadBlob(exp.blob, exp.name);
    else show('done');
    return {
      ok: true, name: exp.name, mime: exp.blob.type, size: exp.blob.size, info: exp.info,
      b64: opts.returnB64 ? await blobToB64(exp.blob) : null,
    };
  }
  function fileName(p, ext, w, h, fps) {
    const base = (p.name || 'clipcast').toLowerCase().replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'clipcast';
    const extra = fps ? `-${w}x${h}@${fps}fps` : `-${w}x${h}`;
    return `${base}${extra}.${ext}`;
  }
  function finish(exp, silent) {
    show('done');
    document.getElementById('expDoneInfo').textContent = `✓ ${exp.info}`;
    if (silent) {
      /* programmatic path (tests / thumbnail): auto-download */
      U.downloadBlob(exp.blob, exp.name);
      U.toast('Saved ' + exp.name, 'ok');
    }
  }

  function cancel() { if (running && running !== 'cancel') running.cancelled = true; running = running || 'cancel'; }

  return {
    init, openDialog, closeDialog, start, cancel, detectMimes, patchWebMDuration, snapshotPNG, thumbnailPNG,
    get running() { return !!running; },
    get lastExport() { return lastExport; },
  };
})();
