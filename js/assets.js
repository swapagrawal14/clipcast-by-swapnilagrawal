/* ClipCast — assets.js : IndexedDB blob store, audio decode + peaks cache,
   image loading, in-page sample clip synthesis (no external files), fonts. */
AC.assets = (() => {
  'use strict';
  const U = AC.util;

  /* ── IndexedDB — one store 'assets': id → Blob ── */
  let _db = null;
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open('clipcast', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
      };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }
  function idbPut(id, blob) {
    return openDB().then((db) => new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(blob, id);
      tx.oncomplete = () => res(id);
      tx.onerror = () => rej(tx.error);
    }));
  }
  function idbGet(id) {
    return openDB().then((db) => new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readonly');
      const rq = tx.objectStore('assets').get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    }));
  }
  function idbDel(id) {
    return openDB().then((db) => new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    }));
  }
  function idbKeys() {
    return openDB().then((db) => new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readonly');
      const rq = tx.objectStore('assets').getAllKeys();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    }));
  }

  const storeBlob = (blob) => { const id = U.uid('a'); return idbPut(id, blob).then(() => id); };

  /* ── blob ⇄ dataURL ── */
  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(durl) {
    const m = String(durl).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error('bad data URL');
    const mime = m[1] || 'application/octet-stream';
    let bytes;
    if (m[2]) {
      const bin = atob(m[3]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
    }
    return new Blob([bytes], { type: mime });
  }

  /* ── audio context (shared; resumed inside user gestures) ── */
  let _ac = null;
  function ac() {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    return _ac;
  }
  function resumeAC() { const a = ac(); if (a.state === 'suspended') return a.resume(); return Promise.resolve(); }

  /* decode cache: id → Promise<AudioBuffer> */
  const _bufCache = new Map();
  function decodeBuffer(id) {
    if (_bufCache.has(id)) return _bufCache.get(id);
    const p = idbGet(id).then((blob) => {
      if (!blob) throw new Error('asset missing: ' + id);
      return blob.arrayBuffer().then((ab) => ac().decodeAudioData(ab.slice(0)));
    });
    _bufCache.set(id, p.catch((e) => { _bufCache.delete(id); throw e; }));
    return p;
  }
  /* peaks cache: id → Float32Array(min0,max0,min1,max1,…) */
  const _peakCache = new Map();
  const _peakSync = new Map();
  function peaksFor(id, buckets) {
    const key = id + ':' + buckets;
    if (_peakCache.has(key)) return _peakCache.get(key);
    const p = decodeBuffer(id).then((buf) => {
      const pk = AC.waveform.computePeaks(buf, buckets);
      _peakSync.set(id, pk); /* engine reads synchronously */
      return pk;
    });
    _peakCache.set(key, p);
    return p;
  }
  function peaksSync(id) { return _peakSync.get(id) || null; }
  function setPeaksSync(id, pk) { _peakSync.set(id, pk); }

  /* image sync cache (engine reads synchronously) */
  const _imgSync = new Map();
  function imageSync(id) { return _imgSync.get(id) || null; }
  function setImageSync(id, img) { _imgSync.set(id, img); }

  /* object-URL cache */
  const _urlCache = new Map();
  function blobURL(id) {
    if (_urlCache.has(id)) return Promise.resolve(_urlCache.get(id));
    return idbGet(id).then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      _urlCache.set(id, url);
      return url;
    });
  }
  function revokeURL(id) {
    const u = _urlCache.get(id);
    if (u) { URL.revokeObjectURL(u); _urlCache.delete(id); }
    _bufCache.delete(id);
    _peakSync.delete(id);
    _imgSync.delete(id);
    for (const k of Array.from(_peakCache.keys())) if (k.startsWith(id + ':')) _peakCache.delete(k);
  }

  /* ── load audio file ── */
  const MAX_AUDIO_BYTES = 80 * 1048576;
  async function loadAudioFile(file) {
    if (file.size > MAX_AUDIO_BYTES) throw new Error('Audio too large (max 80 MB)');
    const id = await storeBlob(file);
    let duration = 0;
    try {
      const buf = await decodeBuffer(id);
      duration = buf.duration;
    } catch (e) { /* decode happens later; duration unknown */ }
    return { id, name: file.name, mime: file.type || 'audio/*', size: file.size, duration };
  }

  /* ── images ── */
  const _imgCache = new Map(); // id → Promise<ImageBitmap|HTMLImageElement>
  function getImage(id) {
    if (_imgCache.has(id)) return _imgCache.get(id);
    const p = idbGet(id).then(async (blob) => {
      if (!blob) throw new Error('image asset missing');
      let img;
      if (window.createImageBitmap) {
        try { img = await createImageBitmap(blob); }
        catch (e) { /* fallthrough */ }
      }
      if (!img) {
        img = await new Promise((res, rej) => {
          const url = URL.createObjectURL(blob);
          const im = new Image();
          im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(url), 60000); };
          im.onerror = () => rej(new Error('image decode failed'));
          im.src = url;
        });
      }
      _imgSync.set(id, img);
      return img;
    });
    _imgCache.set(id, p);
    return p;
  }
  async function loadImageFile(file) {
    const id = await storeBlob(file);
    let w = 0, h = 0;
    try {
      const bmp = await getImage(id);
      w = bmp.width || bmp.naturalWidth || 0;
      h = bmp.height || bmp.naturalHeight || 0;
    } catch (e) { /* ignore */ }
    return { id, name: file.name, mime: file.type || 'image/*', size: file.size, w, h };
  }

  /* ── sample clip: 8 s pleasant synth loop, generated in-page → WAV ── */
  const SAMPLE_SECONDS = 8;
  function makeSampleClip() {
    const sr = 44100;
    const n = SAMPLE_SECONDS * sr;
    const ctx = new OfflineAudioContext(2, n, sr);
    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    /* chord progression: C  Am  F  G (roots) */
    const roots = [261.63, 220.0, 174.61, 196.0]; // C4 A3 F3 G3
    const segDur = SAMPLE_SECONDS / roots.length;
    const chords = [[0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]]; // major, minor, major, major
    const t0 = ctx.currentTime;

    function pad(freq, start, dur, gain) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0 + start);
        g.gain.linearRampToValueAtTime(gain, t0 + start + 0.6);
        g.gain.setValueAtTime(gain, t0 + start + dur - 0.8);
        g.gain.linearRampToValueAtTime(0.0001, t0 + start + dur);
        o.connect(g).connect(master);
        o.start(t0 + start);
        o.stop(t0 + start + dur + 0.05);
      }
    }
    function pluck(freq, at, vel) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.5 * vel, t0 + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.32);
      o.connect(g).connect(master);
      o.start(t0 + at);
      o.stop(t0 + at + 0.4);
    }
    function bass(freq, start, dur) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq / 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + start + 0.15);
      g.gain.setValueAtTime(0.4, t0 + start + dur - 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g).connect(master);
      o.start(t0 + start);
      o.stop(t0 + start + dur + 0.05);
    }

    for (let s = 0; s < roots.length; s++) {
      const start = s * segDur;
      const root = roots[s];
      pad(root, start, segDur * 0.98, 0.16);
      pad(root * 2, start, segDur * 0.98, 0.10);
      for (const iv of chords[s]) pad(root * Math.pow(2, iv / 12), start, segDur * 0.98, 0.07);
      bass(root, start, segDur * 0.95);
      /* 16th-note pluck arpeggio */
      const notes = [0, 12, 7, 12, 3, 12, 7, 12, 4, 12, 7, 12, 0, 12, 7, 12];
      const step = segDur / 16;
      for (let i = 0; i < 16; i++) {
        const f = root * Math.pow(2, notes[i] / 12);
        pluck(f, start + i * step + 0.02, 0.5 + 0.3 * Math.sin(i * 1.7));
      }
    }
    return ctx.startRendering().then((buffer) => bufferToWavBlob(buffer));
  }

  function bufferToWavBlob(buffer) {
    const sr = buffer.sampleRate;
    const ch = buffer.numberOfChannels;
    const n = buffer.length;
    const bytesPer = 2;
    const block = ch * bytesPer;
    const dataSize = n * block;
    const buf = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(buf);
    const wstr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * block, true);
    dv.setUint16(32, block, true); dv.setUint16(34, 16, true);
    wstr(36, 'data'); dv.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        let v = buffer.getChannelData(c)[i];
        v = Math.max(-1, Math.min(1, v));
        dv.setInt16(off, v < 0 ? v * 32768 : v * 32767, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  let _samplePromise = null;
  function sampleClip() {
    if (!_samplePromise) _samplePromise = makeSampleClip().then((blob) =>
      loadAudioFile(new File([blob], 'clipcast-sample.wav', { type: 'audio/wav' })));
    return _samplePromise;
  }

  /* ── generated cover art (used by welcome templates) ── */
  function makeCoverArt(seedText, c1, c2) {
    const c = U.makeCanvas(1200, 1200);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 1200, 1200);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 1200);
    for (let i = 0; i < 3; i++) {
      const r = 140 + i * 90;
      ctx.beginPath();
      ctx.arc(950 - i * 130, 260 + i * 100, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '900 110px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = String(seedText).split(/\s+/).slice(0, 3);
    words.forEach((w, i) => ctx.fillText(w, 600, 520 + i * 130));
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  }

  /* ── fonts manifest for captions / text blocks ── */
  const FONTS = [
    { id: 'inter', fam: 'Inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
    { id: 'montserrat', fam: 'Montserrat', label: 'Montserrat', css: "'Montserrat', system-ui, sans-serif" },
    { id: 'oswald', fam: 'Oswald', label: 'Oswald', css: "'Oswald', system-ui, sans-serif" },
    { id: 'anton', fam: 'Anton', label: 'Anton', css: "'Anton', system-ui, sans-serif" },
    { id: 'bebas', fam: 'Bebas Neue', label: 'Bebas Neue', css: "'Bebas Neue', system-ui, sans-serif" },
    { id: 'merriweather', fam: 'Merriweather', label: 'Merriweather', css: "'Merriweather', Georgia, serif" },
    { id: 'pacifico', fam: 'Pacifico', label: 'Pacifico', css: "'Pacifico', cursive" },
    { id: 'caveat', fam: 'Caveat', label: 'Caveat', css: "'Caveat', cursive" },
    { id: 'system', fam: 'System', label: 'System (emoji ok)', css: "system-ui, -apple-system, 'Segoe UI Emoji', sans-serif" },
  ];
  const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

  function loadFontsForCanvas() {
    /* ensure @font-face files are loaded before canvas text uses them */
    const faces = FONTS.filter((f) => f.id !== 'system');
    return Promise.allSettled(
      faces.map((f) => document.fonts.load(`400 1px ${f.fam}`).catch(() => null))
    ).then(() => document.fonts.ready);
  }

  return {
    storeBlob, idbGet, idbDel, idbKeys,
    blobToDataURL, dataURLToBlob,
    ac, resumeAC, decodeBuffer, peaksFor, peaksSync, setPeaksSync,
    imageSync, setImageSync, blobURL, revokeURL,
    loadAudioFile, getImage, loadImageFile,
    sampleClip, makeCoverArt, bufferToWavBlob,
    FONTS, fontById, loadFontsForCanvas,
    SAMPLE_SECONDS,
  };
})();
