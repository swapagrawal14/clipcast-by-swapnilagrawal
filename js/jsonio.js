/* ClipCast — jsonio.js : project ⇄ .json spec round-trip.
   The .json export IS the AI-authorable spec ({clipcast:1, …}) — everything
   including audio + images travels as base64 data-URLs. The importer is
   tolerant: fraction-or-px-or-keyword coords, enum validation with
   warn-and-skip, auto defaults for anything missing. */
AC.jsonio = (() => {
  'use strict';
  const U = AC.util;

  /* ── project → spec (async: resolves blobs → dataURLs) ── */
  async function projectToSpec(p) {
    const spec = {
      clipcast: 1,
      name: p.name,
      aspect: p.aspect,
      trim: { start: round(p.trim.start), end: round(p.trim.end) },
      template: p.template,
      bg: Object.assign({}, p.bg),
      wf: JSON.parse(JSON.stringify(p.wf)),
      blocks: JSON.parse(JSON.stringify(p.blocks)),
      captions: {
        cues: JSON.parse(JSON.stringify(p.captions.cues)),
        style: JSON.parse(JSON.stringify(p.captions.style)),
      },
      play: JSON.parse(JSON.stringify(p.play || {})),
    };
    delete spec.bg.assetId;
    if (p.audio && p.audio.assetId) {
      const blob = await AC.assets.idbGet(p.audio.assetId);
      if (blob) spec.audio = { src: await AC.assets.blobToDataURL(blob), volume: p.audio.volume, normalize: p.audio.normalize };
    }
    if (p.bgm && p.bgm.assetId) {
      const blob = await AC.assets.idbGet(p.bgm.assetId);
      if (blob) spec.bgm = { src: await AC.assets.blobToDataURL(blob), volume: p.bgm.volume, duck: p.bgm.duck, loop: p.bgm.loop, duckDb: p.bgm.duckDb };
    }
    for (const b of spec.blocks) {
      if (b.type === 'cover' && b.assetId) {
        const blob = await AC.assets.idbGet(b.assetId);
        if (blob) { b.src = await AC.assets.blobToDataURL(blob); delete b.assetId; }
      }
    }
    if (spec.bg.type === 'image' && p.bg.assetId) {
      const blob = await AC.assets.idbGet(p.bg.assetId);
      if (blob) { spec.bg.src = await AC.assets.blobToDataURL(blob); }
    }
    return spec;
  }
  const round = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

  /* ── spec → project (tolerant importer) ── */
  async function specToProject(obj, { nameHint } = {}) {
    const warnings = [];
    const warn = (msg) => { warnings.push(msg); console.warn('[jsonio]', msg); };
    const src = (obj && typeof obj === 'object') ? obj : {};

    if (src.clipcast !== 1) warn('"clipcast" version missing or ≠ 1 — assuming clipcast:1');

    /* aspect */
    const aspects = AC.state.ASPECTS;
    let aspect = '9:16';
    if (src.aspect != null) {
      if (aspects[String(src.aspect)]) aspect = String(src.aspect);
      else warn(`unknown aspect "${src.aspect}" — default 9:16`);
    }
    const A = aspects[aspect];

    /* template */
    let template = 'podcast-minimal';
    if (src.template != null) {
      if (AC.state.templateById(src.template) && AC.state.TEMPLATES.some((t) => t.id === src.template)) template = String(src.template);
      else warn(`unknown template "${src.template}" — skipped (using current layout)`);
    }

    /* build fresh project manually to avoid touching the current one */
    const fresh = {
      id: U.uid('p'), name: String(src.name || nameHint || 'Imported audiogram').slice(0, 80), version: 1,
      aspect, canvasW: A.w, canvasH: A.h,
      template,
      bg: { type: 'aurora', c1: '#0f172a', c2: '#134e4a', angle: 135, assetId: null },
      wf: AC.state.defaultWF(),
      blocks: [],
      captions: { cues: [], style: AC.captions.defaultStyle() },
      audio: { assetId: null, name: '', duration: 0, volume: 1, normalize: true },
      bgm: { assetId: null, name: '', duration: 0, volume: 0.5, duck: true, loop: true, duckDb: 8 },
      trim: { start: 0, end: 0 },
      play: { loopPreview: false, showSafe: false, showGrid: false },
      createdAt: Date.now(), updatedAt: Date.now(),
    };

    /* bg */
    if (src.bg && typeof src.bg === 'object') {
      const bgs = AC.engine.BG_DEFS.map((b) => b.id);
      const bt = String(src.bg.type || 'aurora');
      if (bgs.includes(bt)) fresh.bg.type = bt;
      else warn(`unknown bg type "${bt}" — default aurora`);
      if (typeof src.bg.c1 === 'string') fresh.bg.c1 = src.bg.c1;
      if (typeof src.bg.c2 === 'string') fresh.bg.c2 = src.bg.c2;
      if (isFinite(Number(src.bg.angle))) fresh.bg.angle = U.clamp(Number(src.bg.angle), 0, 360);
      if (src.bg.src) {
        try {
          const blob = AC.assets.dataURLToBlob(src.bg.src);
          const img = await AC.assets.loadImageFile(new File([blob], 'bg-image', { type: blob.type || 'image/png' }));
          fresh.bg.assetId = img.id;
          fresh.bg.type = 'image';
        } catch (e) { warn('bg.src data-URL unreadable — skipped'); }
      }
    }

    /* wf */
    if (src.wf && typeof src.wf === 'object') {
      const wf = fresh.wf;
      const styles = AC.waveform.STYLES.map((s) => s.id);
      if (styles.includes(String(src.wf.style))) wf.style = src.wf.style;
      else if (src.wf.style != null) warn(`unknown waveform style "${src.wf.style}" — default bars`);
      if (isFinite(Number(src.wf.bars))) wf.bars = U.clamp(Math.round(src.wf.bars), 12, 160);
      if (isFinite(Number(src.wf.gap))) wf.gap = U.clamp(Number(src.wf.gap), 0, 0.5);
      if (isFinite(Number(src.wf.rows))) wf.rows = U.clamp(Math.round(src.wf.rows), 3, 10);
      if (isFinite(Number(src.wf.lineWidth))) wf.lineWidth = U.clamp(Number(src.wf.lineWidth), 1, 8);
      for (const k of ['color', 'color2', 'color3', 'glow']) if (typeof src.wf[k] === 'string') wf[k] = src.wf[k];
      for (const k of ['rounded', 'bounce', 'playhead', 'meter', 'sparkles']) if (typeof src.wf[k] === 'boolean') wf[k] = src.wf[k];
    }

    /* blocks */
    if (Array.isArray(src.blocks)) {
      const types = new Set(['waveform', 'cover', 'title', 'subtitle', 'progress', 'timer', 'watermark']);
      for (const b of src.blocks) {
        if (!b || typeof b !== 'object') continue;
        if (!types.has(String(b.type))) { warn(`unknown block type "${b && b.type}" — skipped`); continue; }
        const nb = AC.engine.defaultBlock(String(b.type));
        nb.x = coord(b.x, A.w, nb.x);
        nb.y = coord(b.y, A.h, nb.y);
        nb.w = coord(b.w, A.w, nb.w, true);
        nb.h = coord(b.h, A.h, nb.h, true);
        const fontIds = AC.assets.FONTS.map((f) => f.id);
        for (const k of Object.keys(nb)) {
          if (k === 'x' || k === 'y' || k === 'w' || k === 'h' || k === 'id' || k === 'type') continue;
          if (b[k] === undefined) continue;
          if (k === 'font' && !fontIds.includes(String(b[k]))) { warn(`unknown font "${b[k]}" on block — default ${nb.font}`); continue; }
          if (typeof nb[k] === 'boolean') nb[k] = !!b[k];
          else if (typeof nb[k] === 'number') { const v = Number(b[k]); if (isFinite(v)) nb[k] = v; }
          else nb[k] = b[k];
        }
        if (b.type === 'cover' && b.src) {
          try {
            const blob = AC.assets.dataURLToBlob(b.src);
            const img = await AC.assets.loadImageFile(new File([blob], 'cover', { type: blob.type || 'image/png' }));
            nb.assetId = img.id;
          } catch (e) { warn('cover src data-URL unreadable — skipped'); }
        }
        fresh.blocks.push(nb);
      }
    }

    /* captions */
    const cs = src.captions && typeof src.captions === 'object' ? src.captions : {};
    if (Array.isArray(cs.cues) && cs.cues.length) {
      fresh.captions.cues = AC.captions.sanitizeCues(cs.cues.map((c) => ({
        start: Number(c.start), end: Number(c.end), text: String(c.text ?? ''),
      })));
    } else if (typeof cs.srt === 'string' && cs.srt.trim()) {
      fresh.captions.cues = AC.captions.parseAny(cs.srt);
      if (!fresh.captions.cues.length) warn('captions.srt parsed to zero cues');
    } else if (typeof cs.text === 'string' && cs.text.trim()) {
      const wpl = Number(cs.wordsPerLine) || 4;
      fresh.captions.cues = AC.captions.distribute(cs.text, Math.max(1, (fresh.trim.end || 1) - fresh.trim.start), wpl);
    }
    if (cs.style && typeof cs.style === 'object') {
      const st = fresh.captions.style;
      const modes = ['karaoke', 'phrase', 'bigword', 'none'];
      const fonts = AC.assets.FONTS.map((f) => f.id);
      const pos = ['top', 'middle', 'bottom'];
      if (modes.includes(String(cs.style.mode))) st.mode = cs.style.mode;
      else if (cs.style.mode != null) warn(`unknown caption mode "${cs.style.mode}" — default karaoke`);
      if (fonts.includes(String(cs.style.font))) st.font = cs.style.font;
      else if (cs.style.font != null) warn(`unknown caption font "${cs.style.font}" — default inter`);
      if (pos.includes(String(cs.style.position))) st.position = cs.style.position;
      if (isFinite(Number(cs.style.size))) st.size = U.clamp(Number(cs.style.size), 0.02, 0.3);
      if (isFinite(Number(cs.style.maxWords))) st.maxWords = U.clamp(Math.round(cs.style.maxWords), 1, 12);
      for (const k of ['color', 'hl', 'dim', 'outlineColor']) if (typeof cs.style[k] === 'string') st[k] = cs.style[k];
      if (typeof cs.style.outline === 'number') st.outline = U.clamp(cs.style.outline, 0, 0.1);
      else if (typeof cs.style.outline === 'boolean') st.outline = cs.style.outline ? 0.02 : 0;
      for (const k of ['shadow', 'caps']) if (typeof cs.style[k] === 'boolean') st[k] = cs.style[k];
      if (['left', 'center', 'right'].includes(String(cs.style.align))) st.align = cs.style.align;
    }

    /* audio */
    if (src.audio && src.audio.src) {
      try {
        const blob = AC.assets.dataURLToBlob(src.audio.src);
        const meta = await AC.assets.loadAudioFile(new File([blob], 'audio', { type: blob.type || 'audio/mpeg' }));
        fresh.audio.assetId = meta.id;
        fresh.audio.name = String(src.audio.name || 'audio').slice(0, 60);
        fresh.audio.duration = meta.duration;
        fresh.audio.volume = U.clamp(Number(src.audio.volume ?? 1), 0, 1);
        fresh.audio.normalize = src.audio.normalize !== false;
        /* make peaks available synchronously for the engine */
        AC.assets.peaksFor(meta.id, AC.waveform.BUCKETS).catch(() => {});
      } catch (e) { warn('audio.src data-URL unreadable — audio skipped'); }
    }

    /* bgm */
    if (src.bgm && src.bgm.src) {
      try {
        const blob = AC.assets.dataURLToBlob(src.bgm.src);
        const meta = await AC.assets.loadAudioFile(new File([blob], 'bgm', { type: blob.type || 'audio/mpeg' }));
        fresh.bgm.assetId = meta.id;
        fresh.bgm.name = String(src.bgm.name || 'bgm').slice(0, 60);
        fresh.bgm.duration = meta.duration;
        fresh.bgm.volume = U.clamp(Number(src.bgm.volume ?? 0.5), 0, 1);
        fresh.bgm.duck = src.bgm.duck !== false;
        fresh.bgm.loop = src.bgm.loop !== false;
        if (isFinite(Number(src.bgm.duckDb))) fresh.bgm.duckDb = U.clamp(Number(src.bgm.duckDb), 3, 24);
      } catch (e) { warn('bgm.src data-URL unreadable — bgm skipped'); }
    }

    /* trim (seconds; if no audio, keep authored times) */
    const adur = fresh.audio.duration || 0;
    const t1 = isFinite(Number(src.trim && src.trim.start)) ? Number(src.trim.start) : 0;
    const t2 = isFinite(Number(src.trim && src.trim.end)) ? Number(src.trim.end) : (adur || 5);
    if (adur) {
      fresh.trim.start = U.clamp(t1, 0, Math.max(0, adur - 0.2));
      fresh.trim.end = U.clamp(t2, fresh.trim.start + 0.2, adur);
    } else {
      fresh.trim.start = Math.max(0, t1);
      fresh.trim.end = Math.max(fresh.trim.start + 0.2, t2);
    }

    /* play prefs */
    if (src.play && typeof src.play === 'object') {
      for (const k of ['loopPreview', 'showSafe', 'showGrid']) if (typeof src.play[k] === 'boolean') fresh.play[k] = src.play[k];
    }

    return { project: fresh, warnings };
  }

  /* coordinates: keyword | fraction | px */
  function coord(v, pxDim, def, isSize) {
    if (typeof v === 'string') {
      const k = v.trim().toLowerCase();
      if (k === 'left' || k === 'top') return 0;
      if (k === 'center' || k === 'middle') return 0.5;
      if (k === 'right' || k === 'bottom') return 1;
      v = parseFloat(v);
    }
    v = Number(v);
    if (!isFinite(v)) return def;
    if (Math.abs(v) > 1) return U.clamp(v / Math.max(1, pxDim), 0, 1);
    return U.clamp(v, 0, 1);
  }

  /* ── file operations ── */
  async function downloadProject(p) {
    const spec = await projectToSpec(p);
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const base = (p.name || 'clipcast').toLowerCase().replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'clipcast';
    U.downloadBlob(blob, base + '.clipcast.json');
    return spec;
  }

  async function importFile(file) {
    const text = await file.text();
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { throw new Error('Not valid JSON: ' + e.message); }
    const { project, warnings } = await specToProject(obj, { nameHint: file.name.replace(/\.json$/i, '') });
    AC.state.setCurrent(project);
    AC.state.mutate(() => {});
    if (warnings.length) U.toast(`Imported with ${warnings.length} warning(s) — see console`, 'info', 5000);
    else U.toast('Imported project ✓', 'ok');
    AC.engine.resetBounce();
    return { project, warnings };
  }

  return { projectToSpec, specToProject, downloadProject, importFile };
})();
