/* ClipCast — main.js : boot, top bar, theme, keyboard shortcuts, drag-drop,
   project manager, file I/O, and the window.AC._debug hooks used by the
   automated acceptance suite. */
AC.main = (() => {
  'use strict';
  const U = AC.util;

  /* ── theme ── */
  function initTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem('ac.theme') || 'dark'; } catch (e) {}
    document.documentElement.dataset.theme = theme;
    syncThemeIcon();
    document.getElementById('btnTheme').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('ac.theme', next); } catch (e) {}
      syncThemeIcon();
    });
  }
  function syncThemeIcon() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.getElementById('icoMoon').classList.toggle('hidden', !dark);
    document.getElementById('icoSun').classList.toggle('hidden', dark);
  }

  /* ── top bar state ── */
  function refreshTopbar() {
    const p = AC.state.current();
    document.getElementById('projectName').textContent = p ? p.name : '—';
    document.getElementById('aspectSelect').value = p ? p.aspect : '9:16';
    document.getElementById('btnUndo').disabled = !AC.state.canUndo();
    document.getElementById('btnRedo').disabled = !AC.state.canRedo();
  }

  /* ── project manager modal ── */
  function renderProjects() {
    const list = document.getElementById('projList');
    list.innerHTML = '';
    const items = AC.state.listProjects();
    if (!items.length) {
      list.appendChild(U.el('p', { class: 'muted' }, 'No projects yet — create one!'));
      return;
    }
    for (const m of items) {
      const row = U.el('div', { class: 'proj-row' });
      const info = U.el('div', { class: 'info' });
      info.appendChild(U.el('b', {}, m.name));
      info.appendChild(U.el('span', {}, `${m.aspect} · ${m.dur ? m.dur.toFixed(1) + 's' : 'no audio'} · ${new Date(m.updatedAt).toLocaleString()}`));
      row.appendChild(info);
      const acts = U.el('div', { class: 'acts' });
      const open = U.el('button', { class: 'btn btn-sm btn-primary' }, 'Open');
      const dup = U.el('button', { class: 'btn btn-sm' }, 'Duplicate');
      const del = U.el('button', { class: 'btn btn-sm btn-coral' }, 'Delete');
      open.addEventListener('click', () => {
        AC.state.loadProject(m.id);
        document.getElementById('projectModal').classList.add('hidden');
        refreshTopbar();
        AC.stage.resize();
        AC.stage.setTime(0);
      });
      dup.addEventListener('click', () => { AC.state.duplicateProject(m.id); renderProjects(); });
      del.addEventListener('click', () => {
        if (confirm('Delete project "' + m.name + '"? This cannot be undone.')) {
          AC.state.deleteProject(m.id);
          if (AC.state.current() && AC.state.current().id === m.id) {
            const rest = AC.state.listProjects();
            if (rest.length) AC.state.loadProject(rest[0].id);
            else AC.state.newProject('Untitled audiogram', 'podcast-minimal');
          }
          renderProjects();
          refreshTopbar();
          AC.stage.resize();
        }
      });
      acts.appendChild(open); acts.appendChild(dup); acts.appendChild(del);
      row.appendChild(acts);
      list.appendChild(row);
    }
  }

  /* ── audio loading (main voice + bgm) ── */
  async function loadAudio(file, { bgm } = {}) {
    try {
      const meta = await AC.assets.loadAudioFile(file);
      AC.state.mutate((pp) => {
        const target = bgm ? pp.bgm : pp.audio;
        target.assetId = meta.id;
        target.name = file.name;
        target.duration = meta.duration;
        if (!bgm) {
          pp.trim = { start: 0, end: meta.duration };
          pp.captions.cues = pp.captions.cues.filter((c) => c.start <= meta.duration);
        }
      });
      /* precompute peaks so the engine renders instantly */
      AC.assets.peaksFor(meta.id, AC.waveform.BUCKETS).then((pk) => AC.assets.setPeaksSync(meta.id, pk));
      AC.stage.ensureAudioURLs();
      AC.stage.setTime(0);
      U.toast((bgm ? 'BGM' : 'Audio') + ' loaded: ' + file.name, 'ok');
    } catch (e) {
      U.toast('Could not load audio: ' + e.message, 'bad');
      console.error(e);
    }
  }

  /* ── drag & drop ── */
  function initDragDrop() {
    let depth = 0;
    const center = document.getElementById('center');
    const onDragOver = (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      center.classList.add('dropping');
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (!depth) center.classList.remove('dropping');
    };
    const onDrop = (e) => {
      e.preventDefault();
      depth = 0;
      center.classList.remove('dropping');
      const files = Array.from(e.dataTransfer.files || []);
      for (const f of files) {
        if (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|aac|flac|webm|oga)$/i.test(f.name)) {
          loadAudio(f);
          return;
        }
      }
      for (const f of files) {
        if (f.type.startsWith('image/')) {
          /* dropping an image with a cover block selected → set it as cover */
          AC.assets.loadImageFile(f).then((img) => {
            AC.assets.getImage(img.id).then(() => {
              AC.state.mutate((pp) => {
                const sel = pp.blocks.find((b) => b.id === AC.stage.selected());
                if (sel && sel.type === 'cover') { sel.assetId = img.id; return; }
                let cov = pp.blocks.find((b) => b.type === 'cover');
                if (!cov) { cov = AC.engine.defaultBlock('cover'); cov.visible = true; pp.blocks.push(cov); }
                cov.assetId = img.id;
              });
              U.toast('Cover image set', 'ok');
            });
          });
          return;
        }
      }
      U.toast('Drop an audio file (mp3/wav/m4a/ogg/aac/flac)', 'bad');
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
  }

  /* ── keyboard ── */
  function isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  }
  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const typing = isTyping();
      const modalOpen = document.querySelector('.modal-back:not(.hidden)') != null;
      if (e.key === 'Escape') {
        for (const m of document.querySelectorAll('.modal-back')) m.classList.add('hidden');
        AC.tour.endTour();
        return;
      }
      if (typing) return;
      if (modalOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          AC.stage.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          AC.stage.seekBy(e.shiftKey ? -5 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          AC.stage.seekBy(e.shiftKey ? 5 : 1);
          break;
        case 't': case 'T':
          {
            const p = AC.state.current();
            if (p && p.audio && p.audio.duration) {
              const end = AC.stage.getTime() + (p.trim.start || 0);
              AC.state.mutate((pp) => { pp.trim.end = Math.min(p.audio.duration, Math.max((pp.trim.start || 0) + 0.2, end)); });
            }
            break;
          }
        case 's': case 'S':
          {
            /* split the active caption cue at the playhead */
            const p = AC.state.current();
            const i = AC.captions.cueIndexAt(p.captions.cues, AC.stage.getTime());
            if (i >= 0) {
              const parts = AC.captions.splitCue(p.captions.cues[i], AC.stage.getTime());
              if (parts) AC.state.mutate((pp) => { pp.captions.cues.splice(i, 1, parts[0], parts[1]); pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues); });
            }
            break;
          }
        case 'Delete': case 'Backspace':
          {
            const sel = AC.stage.selected();
            if (sel) AC.state.mutate((pp) => { pp.blocks = pp.blocks.filter((b) => b.id !== sel); });
            AC.stage.setSelected(null);
            break;
          }
      }
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); AC.state.undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); AC.state.redo(); }
        else if (k === 's') { e.preventDefault(); AC.jsonio.downloadProject(AC.state.current()); }
        else if (k === 'e') { e.preventDefault(); AC.exporter.openDialog(); }
      }
    });
  }

  /* ═══════════ boot ═══════════ */
  function init() {
    initTheme();

    /* state first */
    AC.state.init();
    AC.state.onDirty((d) => document.getElementById('dirtyDot').classList.toggle('on', d));
    AC.state.onChange(refreshTopbar);

    AC.assets.loadFontsForCanvas().then(() => AC.stage.draw());

    AC.stage.init(document.getElementById('stageCanvas'));
    AC.timeline.init(document.getElementById('trimCanvas'));
    AC.panels.init();
    AC.exporter.init();
    AC.tour.init();
    initDragDrop();
    initKeyboard();

    /* top bar */
    document.getElementById('btnNew').addEventListener('click', AC.tour.openWelcome);
    document.getElementById('btnProjects').addEventListener('click', () => {
      renderProjects();
      document.getElementById('projectModal').classList.remove('hidden');
    });
    document.getElementById('btnProjNew').addEventListener('click', () => {
      document.getElementById('projectModal').classList.add('hidden');
      AC.tour.openWelcome();
    });
    document.getElementById('btnProjClose').addEventListener('click', () => document.getElementById('projectModal').classList.add('hidden'));
    document.getElementById('btnUndo').addEventListener('click', () => AC.state.undo());
    document.getElementById('btnRedo').addEventListener('click', () => AC.state.redo());
    document.getElementById('aspectSelect').addEventListener('change', (e) => AC.state.setAspect(e.target.value));
    document.getElementById('btnExportJson').addEventListener('click', async () => {
      await AC.jsonio.downloadProject(AC.state.current());
      U.toast('Project .json downloaded (audio included)', 'ok');
    });
    document.getElementById('btnImportJson').addEventListener('click', () => document.getElementById('fileJson').click());
    document.getElementById('fileJson').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (f) {
        try { await AC.jsonio.importFile(f); }
        catch (e) { U.toast('Import failed: ' + e.message, 'bad'); console.error(e); }
      }
      ev.target.value = '';
    });
    document.getElementById('btnHelp').addEventListener('click', () => document.getElementById('helpModal').classList.remove('hidden'));
    document.getElementById('helpClose').addEventListener('click', () => document.getElementById('helpModal').classList.add('hidden'));

    /* stage tools */
    document.getElementById('btnFit').addEventListener('click', () => AC.stage.resize());
    document.getElementById('btnSafe').addEventListener('click', () => {
      AC.state.mutate((pp) => { pp.play.showSafe = !pp.play.showSafe; });
      document.getElementById('btnSafe').classList.toggle('active', AC.state.current().play.showSafe);
    });
    document.getElementById('btnGrid').addEventListener('click', () => {
      AC.state.mutate((pp) => { pp.play.showGrid = !pp.play.showGrid; });
      document.getElementById('btnGrid').classList.toggle('active', AC.state.current().play.showGrid);
    });

    /* file pickers */
    document.getElementById('fileAudio').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (f) loadAudio(f);
      ev.target.value = '';
    });
    document.getElementById('fileBgm').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (f) loadAudio(f, { bgm: true });
      ev.target.value = '';
    });
    document.getElementById('btnPickAudio').addEventListener('click', () => document.getElementById('fileAudio').click());

    /* BGM panel is reached via… the block list has no bgm entry; add a subtle hook:
       double-click stageInfo to add BGM (discoverable in help). Also expose button. */
    document.getElementById('stageInfo').addEventListener('dblclick', () => document.getElementById('fileBgm').click());
    document.getElementById('stageInfo').title = 'BGM: double-click here to add background music';

    refreshTopbar();
    AC.stage.resize();
    AC.stage.updateInfo && AC.stage.updateInfo();

    /* welcome on first run; tour after welcome */
    if (!AC.tour.tourSeen()) {
      AC.tour.openWelcome();
      const open = document.getElementById('welcomeModal');
      /* start the tour once welcome is dismissed */
      const obs = new MutationObserver(() => {
        if (open.classList.contains('hidden')) {
          obs.disconnect();
          setTimeout(() => AC.tour.startTour(), 600);
        }
      });
      obs.observe(open, { attributes: true, attributeFilter: ['class'] });
    } else {
      AC.tour.markTourSeen();
    }
  }

  /* ═══════════ debug hooks (acceptance suite) ═══════════ */
  function installDebug() {
    AC._debug = {
      state: () => AC.state.current(),
      play: () => AC.stage.play(),
      pause: () => AC.stage.pause(),
      seek: (t) => AC.stage.setTime(t),
      time: () => AC.stage.getTime(),
      playing: () => AC.stage.playing,
      voiceCurrentTime: () => document.querySelector('audio') ? null : null,
      setTrim: (s, e) => AC.state.mutate((p) => { p.trim.start = s; p.trim.end = e; }),
      importSrt: (text) => {
        const cues = AC.captions.parseSRT(text);
        AC.state.mutate((p) => { p.captions.cues = cues; });
        return cues.length;
      },
      karaokeAt: (t) => {
        const p = AC.state.current();
        const i = AC.captions.cueIndexAt(p.captions.cues, t);
        if (i < 0) return { cue: -1, word: -1 };
        return { cue: i, word: AC.captions.wordIndexAt(p.captions.cues[i], t) };
      },
      setCaptionMode: (m) => AC.state.mutate((p) => { p.captions.style.mode = m; }),
      setWaveformStyle: (s) => AC.state.mutate((p) => { p.wf.style = s; }),
      setAspect: (a) => AC.state.setAspect(a),
      setBg: (t) => AC.state.mutate((p) => { p.bg.type = t; }),
      applyTemplate: (id) => AC.state.applyTemplate(id),
      loadAudioDataURL: async (durl, name) => {
        const blob = AC.assets.dataURLToBlob(durl);
        const meta = await AC.assets.loadAudioFile(new File([blob], name || 'test.wav', { type: blob.type || 'audio/wav' }));
        AC.state.mutate((p) => {
          p.audio = { assetId: meta.id, name: name || 'test.wav', duration: meta.duration, volume: 1, normalize: true };
          p.trim = { start: 0, end: meta.duration };
        });
        const pk = await AC.assets.peaksFor(meta.id, AC.waveform.BUCKETS);
        AC.assets.setPeaksSync(meta.id, pk);
        await AC.stage.ensureAudioURLs();
        AC.stage.setTime(0);
        return { id: meta.id, duration: meta.duration };
      },
      loadBgmDataURL: async (durl, name) => {
        const blob = AC.assets.dataURLToBlob(durl);
        const meta = await AC.assets.loadAudioFile(new File([blob], name || 'bgm.wav', { type: blob.type || 'audio/wav' }));
        AC.state.mutate((p) => {
          p.bgm = { assetId: meta.id, name: name || 'bgm.wav', duration: meta.duration, volume: 0.6, duck: true, loop: true, duckDb: 8 };
        });
        await AC.stage.ensureAudioURLs();
        return { id: meta.id, duration: meta.duration };
      },
      renderFrame: (t, w, h, opts) => {
        const p = AC.state.current();
        const c = U.makeCanvas(w || p.canvasW, h || p.canvasH);
        const x = c.getContext('2d');
        x.setTransform(c.width / p.canvasW, 0, 0, c.height / p.canvasH, 0, 0);
        AC.engine.render(p, t, x, Object.assign({ showPlayhead: true, meter: true }, opts || {}));
        return c.toDataURL('image/png');
      },
      renderThumb: (t) => {
        const p = AC.state.current();
        const c = U.makeCanvas(p.canvasW, p.canvasH);
        const x = c.getContext('2d');
        x.setTransform(1, 0, 0, 1, 0, 0);
        AC.engine.renderWaveformOnly(p, t, x, {});
        return c.toDataURL('image/png');
      },
      export: (opts) => AC.exporter.start(Object.assign({ format: 'webm', fps: 24, quality: 'medium', scale: 1, audio: true, autoDownload: true, returnB64: true }, opts || {})),
      lastExport: () => AC.exporter.lastExport,
      lastWarnings: () => (window.__acWarnings = window.__acWarnings || []),
      projectJSON: () => AC.jsonio.projectToSpec(AC.state.current()),
      importJSON: (obj) => AC.jsonio.specToProject(obj),
      theme: (t) => { document.documentElement.dataset.theme = t; },
      reset: () => { try { localStorage.clear(); } catch (e) {} },
    };
  }

  /* never lose the last edit: flush debounced autosave on unload */
  window.addEventListener('pagehide', () => AC.state.saveNow());
  window.addEventListener('beforeunload', () => AC.state.saveNow());

  document.addEventListener('DOMContentLoaded', () => {
    installDebug();
    init();
  });

  return { init, refreshTopbar };
})();
