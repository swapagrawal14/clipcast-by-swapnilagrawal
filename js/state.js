/* ClipCast — state.js : project model, templates, localStorage autosave,
   multi-project manager, undo/redo. Blobs live in IndexedDB (assets.js);
   project JSON here only references asset ids (never base64 in LS). */
AC.state = (() => {
  'use strict';
  const U = AC.util;

  const ASPECTS = {
    '1:1': { w: 1080, h: 1080, label: '1:1 Square' },
    '9:16': { w: 1080, h: 1920, label: '9:16 Reels' },
    '16:9': { w: 1920, h: 1080, label: '16:9 Wide' },
    '4:5': { w: 1080, h: 1350, label: '4:5 Portrait' },
  };

  const LS_META = 'ac.meta.v1';
  const LS_CUR = 'ac.cur.v1';
  const LS_PROJ = (id) => 'ac.proj.v1.' + id;

  const defaultWF = () => ({
    style: 'bars', bars: 48, gap: 0.18, rounded: true,
    color: '#2dd4bf', color2: '#374151', color3: 'rgba(255,255,255,0.10)',
    lineWidth: 2.5, rows: 5, glow: '#2dd4bf', sparkles: false,
    bounce: true, playhead: true, meter: false,
  });

  const defaultCaptions = () => ({
    cues: [],
    style: AC.captions.defaultStyle(),
  });

  function freshProject(name, templateId) {
    const aspect = ASPECTS['9:16'];
    return {
      id: U.uid('p'), name: name || 'Untitled audiogram', version: 1,
      aspect: '9:16', canvasW: aspect.w, canvasH: aspect.h,
      template: templateId || 'podcast-minimal',
      bg: { type: 'aurora', c1: '#0f172a', c2: '#134e4a', angle: 135, assetId: null },
      wf: defaultWF(),
      blocks: [],
      captions: defaultCaptions(),
      audio: { assetId: null, name: '', duration: 0, volume: 1, normalize: true },
      bgm: { assetId: null, name: '', duration: 0, volume: 0.5, duck: true, loop: true, duckDb: 8 },
      trim: { start: 0, end: 0 },
      play: { loopPreview: false, showSafe: false, showGrid: false },
      createdAt: Date.now(), updatedAt: Date.now(),
    };
  }

  /* ═══════════ TEMPLATES ═══════════ */
  const T = {
    'podcast-minimal': {
      name: 'Podcast Minimal', blurb: 'Clean bars + karaoke captions',
      css: 'linear-gradient(135deg,#050a12 0%, #0f2e33 60%, #134e4a 100%)',
      apply(p) {
        p.bg = { type: 'aurora', c1: '#0f172a', c2: '#134e4a', angle: 135, assetId: null };
        p.wf = Object.assign(defaultWF(), { style: 'bars', bars: 48, color: '#2dd4bf', color2: '#31415a' });
        p.captions.style = Object.assign(AC.captions.defaultStyle(), { mode: 'karaoke', font: 'inter', size: 0.068, color: '#f1f5f9', hl: '#2dd4bf', dim: '#7d8ba3', position: 'bottom', maxWords: 4 });
        p.blocks = [
          blk('title', { x: 0.5, y: 0.115, w: 0.84, h: 0.1, text: 'That One Episode', font: 'montserrat', size: 0.062, color: '#f8fafc', bold: true, align: 'center', shadow: true }),
          blk('subtitle', { x: 0.5, y: 0.195, w: 0.6, h: 0.045, text: '@yourpodcast', font: 'inter', size: 0.032, color: '#9fd9cf', bold: true, align: 'center' }),
          blk('waveform', { x: 0.5, y: 0.63, w: 0.86, h: 0.15 }),
          blk('progress', { x: 0.5, y: 0.87, w: 0.72, h: 0.02, color: '#2dd4bf', glow: true }),
          blk('timer', { x: 0.5, y: 0.93, w: 0.3, h: 0.04 }),
        ];
      },
    },
    'hormozi': {
      name: 'Hormozi Captions', blurb: 'Big words, pop-in, high contrast',
      css: 'linear-gradient(135deg,#0b0e14,#1a2231)',
      apply(p) {
        p.bg = { type: 'solid', c1: '#0b0e14', c2: '#0b0e14', angle: 135, assetId: null };
        p.wf = Object.assign(defaultWF(), { style: 'mirror', bars: 90, color: '#fb7185', color2: '#2b3547', lineWidth: 3 });
        p.captions.style = Object.assign(AC.captions.defaultStyle(), { mode: 'bigword', font: 'oswald', size: 0.1, color: '#f8fafc', hl: '#fb7185', dim: '#94a3b8', position: 'bottom', maxWords: 2, caps: true, outline: 0.018 });
        p.blocks = [
          blk('title', { x: 0.5, y: 0.1, w: 0.9, h: 0.09, text: 'THE REAL LESSON', font: 'anton', size: 0.085, color: '#f8fafc', bold: true, caps: true, align: 'center' }),
          blk('subtitle', { x: 0.5, y: 0.175, w: 0.7, h: 0.04, text: '@businesshandle', font: 'inter', size: 0.03, color: '#fb7185', bold: true, align: 'center' }),
          blk('waveform', { x: 0.5, y: 0.64, w: 0.88, h: 0.17 }),
          blk('progress', { x: 0.5, y: 0.885, w: 0.74, h: 0.02, color: '#fb7185', glow: false }),
        ];
      },
    },
    'neon-rings': {
      name: 'Neon Rings', blurb: 'Radial donut on neon dark',
      css: 'radial-gradient(circle at 50% 40%,#111827,#05060a 70%)',
      apply(p) {
        p.bg = { type: 'neon', c1: '#0b0e14', c2: '#0b0e14', angle: 135, assetId: null };
        p.wf = Object.assign(defaultWF(), { style: 'radial', bars: 64, color: '#22d3ee', color2: '#1d3a5c' });
        p.captions.style = Object.assign(AC.captions.defaultStyle(), { mode: 'phrase', font: 'montserrat', size: 0.062, color: '#e0f2fe', hl: '#22d3ee', dim: '#64748b', position: 'bottom', maxWords: 6 });
        p.blocks = [
          blk('title', { x: 0.5, y: 0.09, w: 0.86, h: 0.09, text: 'NEON TALK', font: 'montserrat', size: 0.06, color: '#f0f9ff', bold: true, align: 'center' }),
          blk('waveform', { x: 0.5, y: 0.6, w: 0.44, h: 0.44 }),
          blk('subtitle', { x: 0.5, y: 0.86, w: 0.6, h: 0.04, text: '@yourchannel', font: 'inter', size: 0.028, color: '#7dd3fc', bold: true, align: 'center' }),
          blk('progress', { x: 0.5, y: 0.925, w: 0.6, h: 0.018, color: '#22d3ee', glow: true }),
        ];
      },
    },
    'quote-card': {
      name: 'Quote Card', blurb: 'Serif quote on paper grain',
      css: 'linear-gradient(#f1ead8,#efe6cf)',
      apply(p) {
        p.bg = { type: 'paper', c1: '#f1ead8', c2: '#e7dcbf', angle: 135, assetId: null };
        p.wf = Object.assign(defaultWF(), { style: 'spectrum', bars: 96, color: '#1e293b', color2: '#b7ab8d', glow: '#d4c9a8', sparkles: false });
        p.captions.style = Object.assign(AC.captions.defaultStyle(), { mode: 'karaoke', font: 'merriweather', size: 0.052, color: '#292524', hl: '#b45309', dim: '#a8a29e', position: 'middle', maxWords: 4, outline: 0, shadow: false });
        p.blocks = [
          blk('title', { x: 0.5, y: 0.14, w: 0.86, h: 0.12, text: '“Success is the sum of small efforts, repeated day in and day out.”', font: 'merriweather', size: 0.045, color: '#292524', bold: true, align: 'center', shadow: false }),
          blk('subtitle', { x: 0.5, y: 0.235, w: 0.6, h: 0.04, text: '— Robert Collier', font: 'caveat', size: 0.036, color: '#8a7a4e', bold: true, align: 'center', shadow: false }),
          blk('waveform', { x: 0.5, y: 0.64, w: 0.84, h: 0.15 }),
          blk('progress', { x: 0.5, y: 0.875, w: 0.7, h: 0.016, color: '#b45309', glow: false, track: 'rgba(41,37,36,0.14)' }),
        ];
      },
    },
    'lofi-desk': {
      name: 'Lofi Desk', blurb: 'Warm sunset, dots, script font',
      css: 'linear-gradient(180deg,#1e1b4b,#7c2d12 55%,#fb923c)',
      apply(p) {
        p.bg = { type: 'sunset', c1: '#1e1b4b', c2: '#fb923c', angle: 135, assetId: null };
        p.wf = Object.assign(defaultWF(), { style: 'dots', bars: 40, rows: 5, color: '#fcd34d', color2: '#8a5a2e', color3: 'rgba(255,255,255,0.12)' });
        p.captions.style = Object.assign(AC.captions.defaultStyle(), { mode: 'phrase', font: 'caveat', size: 0.082, color: '#fffbeb', hl: '#fcd34d', dim: '#d6bba3', position: 'middle', maxWords: 8, shadow: true });
        p.blocks = [
          blk('title', { x: 0.5, y: 0.1, w: 0.86, h: 0.09, text: 'lofi beats to podcast to', font: 'pacifico', size: 0.058, color: '#ffedd5', bold: false, align: 'center', shadow: true }),
          blk('cover', { x: 0.5, y: 0.36, w: 0.3, h: 0.3, assetId: null, rounded: 0.06, shadow: true, kenburns: true, grayscale: false }),
          blk('waveform', { x: 0.5, y: 0.72, w: 0.84, h: 0.12 }),
          blk('progress', { x: 0.5, y: 0.86, w: 0.7, h: 0.016, color: '#fcd34d', glow: false }),
          blk('timer', { x: 0.5, y: 0.915, w: 0.3, h: 0.04, format: 'remaining' }),
        ];
      },
    },
    'breaking-news': {
      name: 'Breaking News', blurb: 'Red-alert ticker energy',
      css: 'linear-gradient(135deg,#2d1b2e,#7f1d1d)',
      apply(p) {
        p.bg = { type: 'grad2', c1: '#2d1b2e', c2: '#7f1d1d', angle: 135, assetId: null };
        p.wf = Object.assign(defaultWF(), { style: 'bars', bars: 56, color: '#fecaca', color2: '#57141c', gap: 0.22 });
        p.captions.style = Object.assign(AC.captions.defaultStyle(), { mode: 'karaoke', font: 'oswald', size: 0.072, color: '#fff1f2', hl: '#fecdd3', dim: '#fda4af', position: 'bottom', maxWords: 3, caps: true, outline: 0.022, outlineColor: '#450a0a' });
        p.blocks = [
          blk('title', { x: 0.5, y: 0.1, w: 0.9, h: 0.09, text: 'BREAKING NEWS', font: 'anton', size: 0.09, color: '#fecaca', bold: true, caps: true, align: 'center' }),
          blk('subtitle', { x: 0.5, y: 0.17, w: 0.86, h: 0.04, text: 'LIVE — breakingnewsfeed.com', font: 'inter', size: 0.026, color: '#fecdd3', bold: true, align: 'center' }),
          blk('waveform', { x: 0.5, y: 0.63, w: 0.88, h: 0.16 }),
          blk('progress', { x: 0.5, y: 0.87, w: 0.74, h: 0.018, color: '#fecaca', glow: false }),
          blk('timer', { x: 0.5, y: 0.925, w: 0.3, h: 0.04, format: 'remaining' }),
        ];
      },
    },
  };
  const TEMPLATES = Object.entries(T).map(([id, v]) => Object.assign({ id }, v));
  const templateById = (id) => T[id] || T['podcast-minimal'];

  function blk(type, props) {
    const b = AC.engine.defaultBlock(type);
    return Object.assign(b, props, { id: U.uid('blk') });
  }

  /* ═══════════ store ═══════════ */
  let _current = null;
  let _meta = null; // [{id,name,updatedAt,aspect,dur}]
  const _listeners = new Set();
  const _dirtyListeners = new Set();
  let dirty = false;

  function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
  function onDirty(fn) { _dirtyListeners.add(fn); return () => _dirtyListeners.delete(fn); }
  function emit() { for (const fn of _listeners) { try { fn(); } catch (e) { console.error(e); } } }
  function emitDirty() { for (const fn of _dirtyListeners) { try { fn(dirty); } catch (e) { console.error(e); } } }

  function loadMeta() {
    try { _meta = JSON.parse(localStorage.getItem(LS_META)) || []; }
    catch (e) { _meta = []; }
    return _meta;
  }
  function saveMeta() {
    try { localStorage.setItem(LS_META, JSON.stringify(_meta)); } catch (e) { /* quota */ }
  }
  function touchMeta(p) {
    const m = _meta.find((x) => x.id === p.id);
    const entry = { id: p.id, name: p.name, updatedAt: Date.now(), aspect: p.aspect, dur: Math.max(0, (p.trim.end || 0) - (p.trim.start || 0)) };
    if (m) Object.assign(m, entry);
    else _meta.push(entry);
    saveMeta();
  }

  const autosave = U.debounce(() => saveNow(), 500);
  function saveNow() {
    if (!_current) return;
    try {
      localStorage.setItem(LS_PROJ(_current.id), JSON.stringify(_current));
    } catch (e) { U.toast('Autosave failed (storage full?)', 'bad'); }
    touchMeta(_current);
    setDirty(false);
  }

  function setDirty(v) {
    if (dirty === v) return;
    dirty = v;
    emitDirty();
  }

  /* serializable deep clone (no blobs — asset ids only) */
  function clone(p) { return JSON.parse(JSON.stringify(p)); }

  /* ── undo / redo (two explicit stacks — undo saves pre-state, redo saves
     the state that was current before undo; never loses the newest edit) ── */
  const HIST_MAX = 60;
  let _hist = [];   // undo stack: serialized PRE-mutation states
  let _redo = [];   // redo stack: states popped by undo
  const canUndo = () => _hist.length > 0;
  const canRedo = () => _redo.length > 0;
  function snapshot() { _hist.push(JSON.stringify(_current)); if (_hist.length > HIST_MAX) _hist.shift(); }
  function undo() {
    if (!canUndo()) return;
    _redo.push(JSON.stringify(_current));
    _current = JSON.parse(_hist.pop());
    afterRestore();
  }
  function redo() {
    if (!canRedo()) return;
    _hist.push(JSON.stringify(_current));
    _current = JSON.parse(_redo.pop());
    afterRestore();
  }
  function afterRestore() {
    dirty = true;
    autosave();
    emit();
    emitDirty();
  }

  /* ── mutations ── */
  function mutate(fn) {
    if (!_current) return;
    snapshot();
    _redo = []; /* new edit invalidates redo history */
    try { fn(_current); }
    catch (e) { console.error('mutate failed', e); return; }
    _current.updatedAt = Date.now();
    setDirty(true);
    autosave();
    emit();
  }

  /* ── project ops ── */
  function current() { return _current; }

  function setCurrent(p, { silent } = {}) {
    _current = p;
    try { localStorage.setItem(LS_CUR, p.id); } catch (e) {}
    touchMeta(p);
    if (!silent) { emit(); }
  }

  function newProject(name, templateId) {
    const p = freshProject(name, templateId);
    if (templateId && T[templateId]) T[templateId].apply(p);
    p.template = templateId || 'podcast-minimal';
    p.trim = { start: 0, end: 0 };
    _hist = []; _redo = [];
    setCurrent(p);
    setDirty(false);
    saveNow();
    return p;
  }

  function loadProject(id) {
    try {
      const raw = localStorage.getItem(LS_PROJ(id));
      if (!raw) return null;
      const p = JSON.parse(raw);
      p.id = id;
      /* coerce to current shape */
      p.canvasW = (ASPECTS[p.aspect] || ASPECTS['9:16']).w;
      p.canvasH = (ASPECTS[p.aspect] || ASPECTS['9:16']).h;
      if (!p.wf) p.wf = defaultWF();
      if (!p.captions || !p.captions.style) p.captions = defaultCaptions();
      if (!p.bgm) p.bgm = freshProject().bgm;
      if (!p.play) p.play = { loopPreview: false, showSafe: false, showGrid: false };
      p.blocks = (p.blocks || []).map((b) => {
        const d = AC.engine.defaultBlock(b.type);
        return Object.assign(d, b);
      });
      p.captions.cues = AC.captions.sanitizeCues(p.captions.cues || []);
      _hist = []; _redo = [];
      setCurrent(p);
      return p;
    } catch (e) {
      console.error('loadProject failed', e);
      return null;
    }
  }

  function duplicateProject(id) {
    const raw = localStorage.getItem(LS_PROJ(id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    p.id = U.uid('p');
    p.name = p.name + ' (copy)';
    p.createdAt = Date.now(); p.updatedAt = Date.now();
    localStorage.setItem(LS_PROJ(p.id), JSON.stringify(p));
    touchMeta(p);
    return p;
  }

  function deleteProject(id) {
    localStorage.removeItem(LS_PROJ(id));
    _meta = _meta.filter((m) => m.id !== id);
    saveMeta();
  }

  function listProjects() {
    loadMeta();
    return _meta.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function renameProject(name) {
    mutate((p) => { p.name = String(name || 'Untitled audiogram').slice(0, 80); });
    touchMeta(_current);
  }

  function setAspect(id) {
    const a = ASPECTS[id];
    if (!a) return;
    mutate((p) => {
      p.aspect = id; p.canvasW = a.w; p.canvasH = a.h;
    });
  }

  function applyTemplate(id) {
    const tpl = T[id];
    if (!tpl) return;
    mutate((p) => {
      tpl.apply(p);
      p.template = id;
      /* keep trim + audio */
      if (p.audio && p.audio.assetId && !p.trim.end) p.trim.end = p.audio.duration;
    });
  }

  /* norm gain for -1 dBFS peak normalization */
  function normGain(p) {
    if (!p.audio || !p.audio.normalize || !p.audio.assetId) return 1;
    const peaks = AC.assets.peaksSync(p.audio.assetId);
    if (!peaks) return 1;
    let peak = 0.0001;
    for (let i = 0; i < peaks.length; i += 2) {
      const v = Math.max(Math.abs(peaks[i]), Math.abs(peaks[i + 1]));
      if (v > peak) peak = v;
    }
    return Math.min(1.5, 0.891 / peak);
  }

  function init() {
    loadMeta();
    let lastId = null;
    try { lastId = localStorage.getItem(LS_CUR); } catch (e) { /* storage blocked */ }
    let p = null;
    if (lastId) p = loadProject(lastId);
    if (!p) p = newProject('Untitled audiogram', 'podcast-minimal');
    return p;
  }

  return {
    ASPECTS, TEMPLATES, templateById, defaultWF,
    init, current, setCurrent, newProject, loadProject, duplicateProject, deleteProject,
    listProjects, renameProject, setAspect, applyTemplate,
    mutate, undo, redo, canUndo, canRedo,
    onChange, onDirty, saveNow, normGain, clone,
    get dirty() { return dirty; },
  };
})();
