/* ClipCast — timeline.js : trim waveform strip (draggable handles, scrub),
   numeric trim fields, loop toggle, captions cue list editor (SRT/VTT/plain
   import, split/merge/nudge). */
AC.timeline = (() => {
  'use strict';
  const U = AC.util;

  let tCanvas = null, tCtx = null;
  let capMode = 'trim';
  let _dragHandle = null;   /* 'start' | 'end' | 'scrub' | null */

  /* ═══════════ trim strip ═══════════ */
  function trimDuration(p) {
    return Math.max(0, (p.trim.end || 0) - (p.trim.start || 0));
  }
  function audioDur(p) { return (p.audio && p.audio.duration) || 0; }

  function drawTrim() {
    if (!tCtx || !tCanvas) return;
    const p = AC.state.current();
    if (!p) return;
    const W = tCanvas.width, H = tCanvas.height;
    const dur = audioDur(p);
    const peaks = p.audio && p.audio.assetId ? AC.assets.peaksSync(p.audio.assetId) : null;
    AC.waveform.drawStrip(tCtx, W, H, peaks, {
      audioDur: dur || 1,
      trimStart: p.trim.start,
      trimEnd: p.trim.end || dur,
      playhead: (p.trim.start || 0) + AC.stage.getTime(),
    });
  }

  function xToTime(x) {
    const p = AC.state.current();
    const r = tCanvas.getBoundingClientRect();
    const frac = (x - r.left) / r.width;
    return U.clamp(frac * audioDur(p), 0, audioDur(p));
  }

  function onTrimPointer(e) {
    const p = AC.state.current();
    if (!p || !audioDur(p)) return;
    const r = tCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = xToTime(e.clientX);
    if (e.type === 'pointerdown') {
      const sPx = ((p.trim.start || 0) / audioDur(p)) * r.width;
      const ePx = ((p.trim.end || audioDur(p)) / audioDur(p)) * r.width;
      const near = 14;
      if (Math.abs(x - sPx) < near && Math.abs(x - sPx) <= Math.abs(x - ePx)) _dragHandle = 'start';
      else if (Math.abs(x - ePx) < near) _dragHandle = 'end';
      else _dragHandle = 'scrub';
      tCanvas.setPointerCapture(e.pointerId);
      move(t);
    } else if (e.type === 'pointermove' && _dragHandle) {
      move(t);
    } else if (e.type === 'pointerup' || e.type === 'pointercancel') {
      _dragHandle = null;
    }
  }
  function move(t) {
    const p = AC.state.current();
    if (!p || !audioDur(p)) return;
    const dur = audioDur(p);
    if (_dragHandle === 'scrub') {
      const local = U.clamp(t - p.trim.start, 0, trimDuration(p));
      AC.stage.pause();
      AC.stage.setTime(local);
      return;
    }
    if (_dragHandle === 'start') {
      const end = p.trim.end || dur;
      AC.state.mutate((pp) => { pp.trim.start = U.clamp(t, 0, Math.max(0, end - 0.2)); });
      AC.stage.pause();
      AC.stage.setTime(0);
    } else if (_dragHandle === 'end') {
      const start = p.trim.start || 0;
      AC.state.mutate((pp) => { pp.trim.end = U.clamp(t, Math.min(dur, start + 0.2), dur); });
      AC.stage.pause();
      AC.stage.setTime(trimDuration(p));
    }
  }

  function syncTrimFields() {
    const p = AC.state.current();
    if (!p) return;
    const s = document.getElementById('trimStart');
    const e = document.getElementById('trimEnd');
    if (s && document.activeElement !== s) s.value = (p.trim.start || 0).toFixed(1);
    if (e && document.activeElement !== e) e.value = ((p.trim.end || audioDur(p)) || 0).toFixed(1);
    const lp = document.getElementById('loopPreview');
    if (lp) lp.checked = !!(p.play && p.play.loopPreview);
  }

  /* ═══════════ captions list ═══════════ */
  function renderCues() {
    const p = AC.state.current();
    const list = document.getElementById('cueList');
    const count = document.getElementById('cueCount');
    if (!list) return;
    if (!p) { list.innerHTML = ''; return; }
    const cues = p.captions.cues;
    if (count) count.textContent = `(${cues.length})`;
    list.innerHTML = '';
    if (!cues.length) {
      list.appendChild(U.el('div', { class: 'muted', style: 'padding:14px;text-align:center;font-size:12px;line-height:1.7' },
        'No captions yet.<br>Paste a transcript, import .srt/.vtt, or add a cue manually.'));
      return;
    }
    const t = AC.stage.getTime();
    const activeIdx = AC.captions.cueIndexAt(cues, t);
    cues.forEach((cue, i) => {
      const row = U.el('div', { class: 'cue-row' + (i === activeIdx ? ' active' : ''), role: 'listitem' });
      row.appendChild(U.el('span', { class: 'idx' }, String(i + 1)));
      const tWrap = U.el('span', { class: 't' });
      const sIn = U.el('input', {
        type: 'text', value: cue.start.toFixed(2), 'aria-label': 'cue start seconds',
        oninput: () => {
          const v = U.parseTimeStr(sIn.value);
          if (isFinite(v)) AC.state.mutate((pp) => { pp.captions.cues[i].start = Math.max(0, v); pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues); });
        },
      });
      const eIn = U.el('input', {
        type: 'text', value: cue.end.toFixed(2), 'aria-label': 'cue end seconds',
        oninput: () => {
          const v = U.parseTimeStr(eIn.value);
          if (isFinite(v)) AC.state.mutate((pp) => { pp.captions.cues[i].end = Math.max(pp.captions.cues[i].start + 0.2, v); pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues); });
        },
      });
      tWrap.appendChild(sIn); tWrap.appendChild(U.el('span', { class: 'muted' }, '–')); tWrap.appendChild(eIn);
      row.appendChild(tWrap);
      const txt = U.el('input', {
        class: 'txt', type: 'text', value: cue.text, 'aria-label': 'cue text',
        oninput: () => AC.state.mutate((pp) => { pp.captions.cues[i].text = txt.value; }),
        onclick: (ev) => { ev.stopPropagation(); },
      });
      row.appendChild(txt);
      const acts = U.el('span', { class: 'acts' });
      const mk = (label, title, fn, cls) => {
        const b = U.el('button', { title, 'aria-label': title, onclick: (ev) => { ev.stopPropagation(); fn(); } }, label);
        if (cls) b.className = cls;
        return b;
      };
      acts.appendChild(mk('−', 'Nudge start −0.1s', () => AC.state.mutate((pp) => { pp.captions.cues[i].start = Math.max(0, pp.captions.cues[i].start - 0.1); pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues); })));
      acts.appendChild(mk('+', 'Nudge start +0.1s', () => AC.state.mutate((pp) => { pp.captions.cues[i].start += 0.1; pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues); })));
      acts.appendChild(mk('⇉', 'Split at playhead', () => splitAt(i)));
      acts.appendChild(mk('⧉', 'Merge with next', () => merge(i)));
      acts.appendChild(mk('✕', 'Delete cue', () => AC.state.mutate((pp) => { pp.captions.cues.splice(i, 1); }), 'del'));
      row.appendChild(acts);
      row.addEventListener('click', () => AC.stage.setTime(cue.start));
      list.appendChild(row);
    });
  }

  function splitAt(i) {
    const p = AC.state.current();
    const cue = p.captions.cues[i];
    if (!cue) return;
    const t = AC.stage.getTime();
    const parts = AC.captions.splitCue(cue, t);
    if (!parts) { U.toast('Move the playhead inside the cue to split', 'bad'); return; }
    AC.state.mutate((pp) => {
      pp.captions.cues.splice(i, 1, parts[0], parts[1]);
      pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues);
    });
  }
  function merge(i) {
    const p = AC.state.current();
    const cues = p.captions.cues;
    if (i >= cues.length - 1) return;
    AC.state.mutate((pp) => {
      const a = pp.captions.cues[i], b = pp.captions.cues[i + 1];
      a.text = (a.text + ' ' + b.text).trim();
      a.end = b.end;
      pp.captions.cues.splice(i + 1, 1);
      pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues);
    });
  }

  /* ═══════════ imports ═══════════ */
  function importCues(cues) {
    const p = AC.state.current();
    const dur = trimDuration(p) || 5;
    AC.state.mutate((pp) => {
      const merged = pp.captions.cues.concat(cues.map((c) => Object.assign({}, c)));
      pp.captions.cues = AC.captions.sanitizeCues(merged, dur);
    });
  }
  function importSrtFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const cues = text.includes('WEBVTT') ? AC.captions.parseVTT(text) : AC.captions.parseSRT(text);
        if (!cues.length) { U.toast('No cues found in file', 'bad'); return; }
        importCues(cues);
        U.toast(`Imported ${cues.length} cues`, 'ok');
      } catch (e) { U.toast('Could not parse file: ' + e.message, 'bad'); }
    };
    reader.readAsText(file);
  }
  function openTranscriptModal() {
    document.getElementById('transcriptModal').classList.remove('hidden');
    document.getElementById('transcriptText').focus();
  }
  function applyTranscript() {
    const text = document.getElementById('transcriptText').value;
    const wpl = parseInt(document.getElementById('trWordsPerLine').value, 10) || 4;
    if (!text.trim()) { U.toast('Paste some words first', 'bad'); return; }
    const p = AC.state.current();
    const dur = trimDuration(p);
    if (dur < 0.5) { U.toast('Set a trim first so words can be distributed', 'bad'); return; }
    const cues = AC.captions.distribute(text, dur, wpl);
    AC.state.mutate((pp) => { pp.captions.cues = cues; });
    U.toast(`Distributed ${cues.length} cues across ${dur.toFixed(1)}s`, 'ok');
    document.getElementById('transcriptModal').classList.add('hidden');
  }

  /* ═══════════ wiring ═══════════ */
  function init(cv) {
    tCanvas = cv;
    tCtx = cv.getContext('2d');
    const fit = () => {
      const rect = tCanvas.getBoundingClientRect();
      tCanvas.width = Math.max(2, Math.round(rect.width));
      tCanvas.height = Math.max(2, Math.round(rect.height));
      drawTrim();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(tCanvas);
    window.addEventListener('resize', fit);

    tCanvas.addEventListener('pointerdown', onTrimPointer);
    tCanvas.addEventListener('pointermove', onTrimPointer);
    tCanvas.addEventListener('pointerup', onTrimPointer);
    tCanvas.addEventListener('pointercancel', onTrimPointer);

    const s = document.getElementById('trimStart');
    const e = document.getElementById('trimEnd');
    s.addEventListener('change', () => {
      const v = parseFloat(s.value);
      const p = AC.state.current();
      if (isFinite(v)) AC.state.mutate((pp) => { pp.trim.start = U.clamp(v, 0, Math.max(0, (pp.trim.end || audioDur(pp)) - 0.2)); });
      AC.stage.setTime(0);
    });
    e.addEventListener('change', () => {
      const v = parseFloat(e.value);
      const p = AC.state.current();
      if (isFinite(v)) AC.state.mutate((pp) => { pp.trim.end = U.clamp(v, (pp.trim.start || 0) + 0.2, audioDur(pp)); });
      AC.stage.setTime(trimDuration(AC.state.current()));
    });
    document.getElementById('btnTrimReset').addEventListener('click', () => {
      const p = AC.state.current();
      if (!p.audio || !p.audio.duration) { U.toast('No audio loaded', 'bad'); return; }
      AC.state.mutate((pp) => { pp.trim = { start: 0, end: pp.audio.duration }; });
      AC.stage.setTime(0);
    });
    document.getElementById('btnTrimToPlayhead').addEventListener('click', () => {
      const p = AC.state.current();
      const t = AC.stage.getTime() + (p.trim.start || 0);
      if (!p.audio || !p.audio.duration) return;
      AC.state.mutate((pp) => { pp.trim.end = Math.min(audioDur(pp), Math.max((pp.trim.start || 0) + 0.2, t)); });
    });
    document.getElementById('loopPreview').addEventListener('change', (ev) => {
      AC.state.mutate((pp) => { pp.play.loopPreview = ev.target.checked; });
    });
    document.getElementById('btnPlayTrim').addEventListener('click', () => AC.stage.togglePlay());

    /* captions tab */
    document.getElementById('btnAddCue').addEventListener('click', () => {
      const p = AC.state.current();
      const t = AC.stage.getTime();
      AC.state.mutate((pp) => {
        pp.captions.cues.push({ start: Math.max(0, t - 0.5), end: t + 1, text: 'New caption…' });
        pp.captions.cues = AC.captions.sanitizeCues(pp.captions.cues);
      });
      renderCues();
    });
    document.getElementById('btnPasteTranscript').addEventListener('click', openTranscriptModal);
    document.getElementById('trOk').addEventListener('click', applyTranscript);
    document.getElementById('trCancel').addEventListener('click', () => document.getElementById('transcriptModal').classList.add('hidden'));
    document.getElementById('btnImportSrt').addEventListener('click', () => document.getElementById('fileSrt').click());
    document.getElementById('fileSrt').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (f) importSrtFile(f);
      ev.target.value = '';
    });
    document.getElementById('capMode').addEventListener('change', (ev) => {
      AC.state.mutate((pp) => { pp.captions.style.mode = ev.target.value; });
    });
    document.getElementById('capPos').addEventListener('change', (ev) => {
      AC.state.mutate((pp) => { pp.captions.style.position = ev.target.value; });
    });

    AC.state.onChange(() => { drawTrim(); syncTrimFields(); renderCues(); });
    AC.stage.onEvent((ev) => {
      if (ev === 'frame' || ev === 'seek') drawTrim();
    });
    /* bottom tabs */
    const tabBtns = document.querySelectorAll('#bottom .tab-btn');
    tabBtns.forEach((b) => b.addEventListener('click', () => {
      const which = b.dataset.tab.slice(2);
      tabBtns.forEach((x) => x.classList.toggle('active', x === b));
      document.getElementById('panel-trim').classList.toggle('hidden', which !== 'trim');
      document.getElementById('panel-captions').classList.toggle('hidden', which !== 'captions');
      if (which === 'trim') drawTrim();
      else renderCues();
    }));
    renderCues();
    syncTrimFields();
  }

  return { init, drawTrim, renderCues, trimDuration, importCues };
})();
