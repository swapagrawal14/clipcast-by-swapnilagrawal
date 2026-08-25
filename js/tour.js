/* ClipCast — tour.js : welcome modal (3 sample templates + sample audio),
   first-run guided tour (6 steps), small-screen notice. */
AC.tour = (() => {
  'use strict';
  const U = AC.util;
  const LS_SEEN = 'ac.tourSeen.v1';

  /* ═══════════ welcome modal ═══════════ */
  function renderWelcomeTemplates() {
    const grid = document.getElementById('welcomeTmplGrid');
    grid.innerHTML = '';
    const picks = ['podcast-minimal', 'hormozi', 'neon-rings'];
    for (const id of picks) {
      const t = AC.state.templateById(id);
      const card = U.el('button', {
        class: 'tmpl-big', 'aria-label': 'Start with template ' + t.name,
        onclick: () => startSample(id),
      });
      const thumb = U.el('div', { class: 'thumb', style: 'background:' + t.css });
      thumb.appendChild(U.el('div', { class: 'mini', html: AC.panels.ICONS.wave }));
      card.appendChild(thumb);
      const meta = U.el('div', { class: 'meta' });
      meta.appendChild(U.el('b', {}, t.name));
      meta.appendChild(U.el('span', {}, t.blurb));
      card.appendChild(meta);
      grid.appendChild(card);
    }
  }

  async function startSample(templateId) {
    /* new project with the template + generated sample audio + cover */
    const p = AC.state.newProject('Sample audiogram', templateId);
    try {
      const clip = await AC.assets.sampleClip();
      AC.state.mutate((pp) => {
        pp.audio = { assetId: clip.id, name: 'clipcast-sample.wav', duration: clip.duration, volume: 1, normalize: true };
        pp.trim = { start: 0, end: Math.min(clip.duration, AC.assets.SAMPLE_SECONDS) };
      });
      await AC.assets.peaksFor(clip.id, AC.waveform.BUCKETS);
      AC.assets.setPeaksSync(clip.id, await AC.assets.peaksFor(clip.id, AC.waveform.BUCKETS));
      const coverBlob = await AC.assets.makeCoverArt('ClipCast', '#0f766e', '#134e4a');
      const cover = await AC.assets.loadImageFile(new File([coverBlob], 'cover.png', { type: 'image/png' }));
      AC.assets.getImage(cover.id).then(() => {
        AC.state.mutate((pp) => {
          const b = pp.blocks.find((x) => x.type === 'cover');
          if (b) b.assetId = cover.id;
        });
      });
      const srt = ['Hello and welcome to the very first ClipCast sample.','This is a fully synthesized demo clip.','No files were downloaded — it was generated right inside your browser.','Drop your own audio to replace it anytime.'];
      let t = 0;
      const cues = srt.map((s, i) => {
        const dur = 1.7;
        const cue = { start: t, end: t + dur, text: s };
        t += dur;
        return cue;
      });
      AC.state.mutate((pp) => { pp.captions.cues = cues; });
      AC.stage.setTime(0);
      U.toast('Sample project ready — press Space to play', 'ok');
    } catch (e) {
      console.error(e);
      U.toast('Sample setup failed: ' + e.message, 'bad');
    }
    document.getElementById('welcomeModal').classList.add('hidden');
    markTourSeen();
    AC.stage.resize();
  }

  function openWelcome() {
    renderWelcomeTemplates();
    document.getElementById('welcomeModal').classList.remove('hidden');
  }
  function closeWelcome() { document.getElementById('welcomeModal').classList.add('hidden'); }

  /* ═══════════ guided tour ═══════════ */
  const STEPS = [
    { target: '#center', title: 'Preview stage', text: 'This is your canvas. Drop an audio file anywhere on the page, then drag blocks around on the preview to compose the frame.' },
    { target: '#trimCanvas', title: 'Trim your clip', text: 'Drag the teal / coral handles to trim the clip. Captions and exports always use this trimmed region. Press T to trim to the playhead.' },
    { target: '#panel-trim .tab-btn:nth-child(2)', title: 'Captions', text: 'Paste a transcript, import an .srt/.vtt file, or edit cues by hand. Word-karaoke highlights each word as it is spoken.' },
    { target: '#panel-style', title: 'Style', text: 'Pick from 6 waveform styles, tune colors and bars, and style the captions — font, size, highlight color, ALL-CAPS and more.' },
    { target: '#playOverlay', title: 'Preview', text: 'Hit Space or the play button to preview with audio. ←/→ seek by one second (Shift for five).' },
    { target: '#btnExport', title: 'Export', text: 'Export WebM/MP4 video, a looping GIF, or PNG snapshots. No watermark, ever — everything renders on your device.' },
  ];
  let tourStep = -1;
  let tourActive = false;

  function tourSeen() { try { return localStorage.getItem(LS_SEEN) === '1'; } catch (e) { return true; } }
  function markTourSeen() { try { localStorage.setItem(LS_SEEN, '1'); } catch (e) {} }

  function startTour() {
    if (tourActive) return;
    tourActive = true;
    tourStep = -1;
    nextStep();
  }
  function endTour() {
    tourActive = false;
    const tip = document.getElementById('tourTip');
    const hl = document.getElementById('tourHl');
    if (tip) tip.remove();
    if (hl) hl.remove();
    markTourSeen();
  }
  function nextStep() {
    tourStep++;
    if (tourStep >= STEPS.length) { endTour(); return; }
    const step = STEPS[tourStep];
    const target = U.$(step.target);
    const tip = document.getElementById('tourTip');
    const hl = document.getElementById('tourHl');
    if (!target) { endTour(); return; }
    const r = target.getBoundingClientRect();
    if (!hl) {
      const n = U.el('div', { id: 'tourHl', class: 'tour-highlight' });
      document.body.appendChild(n);
    }
    const hlEl = document.getElementById('tourHl');
    hlEl.style.left = r.left - 4 + 'px';
    hlEl.style.top = r.top - 4 + 'px';
    hlEl.style.width = r.width + 8 + 'px';
    hlEl.style.height = r.height + 8 + 'px';
    if (!tip) {
      const t = U.el('div', { id: 'tourTip', class: 'tour-tip', role: 'dialog', 'aria-label': 'Tour step' });
      document.body.appendChild(t);
    }
    const tipEl = document.getElementById('tourTip');
    tipEl.innerHTML = '';
    tipEl.appendChild(U.el('b', {}, step.title));
    tipEl.appendChild(U.el('span', {}, step.text));
    const acts = U.el('div', { class: 'tour-acts' });
    const dots = U.el('div', { class: 'dots' });
    STEPS.forEach((_, i) => dots.appendChild(U.el('i', { class: i <= tourStep ? 'on' : '' })));
    const skip = U.el('button', { class: 'btn btn-sm' }, 'Skip');
    const next = U.el('button', { class: 'btn btn-sm btn-primary' }, tourStep === STEPS.length - 1 ? 'Done' : 'Next');
    skip.addEventListener('click', endTour);
    next.addEventListener('click', nextStep);
    acts.appendChild(dots);
    acts.appendChild(U.el('span', { style: 'display:flex;gap:6px' }, skip, next));
    tipEl.appendChild(acts);
    /* place tooltip near target */
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = U.clamp(r.left, 8, vw - 308);
    let top = r.bottom + 12;
    if (top + 190 > vh) top = Math.max(8, r.top - 190);
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }

  /* ═══════════ small-screen notice ═══════════ */
  let smallSeen = false;
  function checkSmallScreen() {
    if (window.innerWidth < 900 && !smallSeen) {
      document.getElementById('smallScreen').classList.add('show');
      smallSeen = true;
    }
  }

  /* ═══════════ init ═══════════ */
  function init() {
    document.getElementById('btnWelcomeAudio').addEventListener('click', () => {
      document.getElementById('welcomeModal').classList.add('hidden');
      markTourSeen();
      document.getElementById('fileAudio').click();
    });
    document.getElementById('btnBlank').addEventListener('click', () => {
      const p = AC.state.newProject('Untitled audiogram', 'podcast-minimal');
      document.getElementById('welcomeModal').classList.add('hidden');
      markTourSeen();
      U.toast('Blank project created — drop an audio file to start', 'info');
    });
    document.getElementById('btnSmallContinue').addEventListener('click', () => {
      document.getElementById('smallScreen').classList.remove('show');
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth < 900 && !smallSeen) {
        document.getElementById('smallScreen').classList.add('show');
        smallSeen = true;
      }
    });
    renderWelcomeTemplates();
    checkSmallScreen();
  }

  return { init, openWelcome, closeWelcome, startTour, endTour, tourSeen, markTourSeen };
})();
